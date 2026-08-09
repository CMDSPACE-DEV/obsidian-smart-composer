#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
smoke_root="${RUNNER_TEMP:?RUNNER_TEMP is required}/smart-composer-obsidian-smoke"
artifact_dir="${smoke_root}/artifacts"
mount_dir="${smoke_root}/mount"
application_path="${smoke_root}/Obsidian.app"
vault_path="${smoke_root}/smart-composer-ci"
plugin_path="${vault_path}/.obsidian/plugins/smart-composer"
obsidian_dmg="${smoke_root}/Obsidian-1.13.4.dmg"
obsidian_url='https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.4/Obsidian-1.13.4.dmg'
obsidian_pid=''
mounted='false'

cleanup() {
  if [[ -n "${obsidian_pid}" ]]; then
    kill "${obsidian_pid}" 2>/dev/null || true
    wait "${obsidian_pid}" 2>/dev/null || true
  fi
  if [[ "${mounted}" == 'true' ]]; then
    hdiutil detach "${mount_dir}" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

rm -rf "${smoke_root}"
mkdir -p "${artifact_dir}" "${mount_dir}" "${plugin_path}"

command -v osascript >/dev/null
if [[ ! -d '/System/Applications/Utilities/Terminal.app' && ! -d '/Applications/Utilities/Terminal.app' ]]; then
  echo 'Terminal.app was not found in a standard macOS application path.' >&2
  exit 1
fi

# This job must never diagnose a real account-bearing CLI. A different job
# verifies the official installer binaries with --version only.
runtime_candidates=(
  "${HOME}/.local/bin/claude"
  "${HOME}/.claude/local/claude"
  "${HOME}/.volta/bin/claude"
  "${HOME}/.asdf/shims/claude"
  "${HOME}/.npm-global/bin/claude"
  '/usr/local/bin/claude'
  '/opt/homebrew/bin/claude'
  '/usr/bin/claude'
  "${HOME}/.local/bin/agy"
  "${HOME}/.gemini/antigravity-cli/bin/agy"
  '/usr/local/bin/agy'
  '/opt/homebrew/bin/agy'
  '/usr/bin/agy'
)
for runtime_candidate in "${runtime_candidates[@]}"; do
  if [[ -e "${runtime_candidate}" ]]; then
    echo "Refusing Obsidian fixture smoke because a real runtime candidate exists: ${runtime_candidate}" >&2
    exit 1
  fi
done
if command -v claude >/dev/null 2>&1 || command -v agy >/dev/null 2>&1; then
  echo 'Refusing Obsidian fixture smoke because a real runtime is available on PATH.' >&2
  exit 1
fi

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "${obsidian_url}" --output "${obsidian_dmg}"
node "${repository_root}/.github/scripts/verify-pinned-artifact.mjs" \
  'obsidian-macos-dmg' "${obsidian_dmg}" "${obsidian_url}"

hdiutil attach "${obsidian_dmg}" -nobrowse -readonly -mountpoint "${mount_dir}" -quiet
mounted='true'
ditto "${mount_dir}/Obsidian.app" "${application_path}"
hdiutil detach "${mount_dir}" -quiet
mounted='false'

codesign --verify --deep --strict --verbose=2 "${application_path}"
file -b "${application_path}/Contents/MacOS/Obsidian" | tee /dev/stderr | grep -q 'Mach-O'
lipo -archs "${application_path}/Contents/MacOS/Obsidian" \
  | tr ' ' '\n' \
  | grep -Fxq "$(uname -m)"

cp "${repository_root}/main.js" "${plugin_path}/main.js"
cp "${repository_root}/manifest.json" "${plugin_path}/manifest.json"
cp "${repository_root}/styles.css" "${plugin_path}/styles.css"
printf '["smart-composer"]\n' > "${vault_path}/.obsidian/community-plugins.json"
printf '# Smart Composer CI smoke vault\n' > "${vault_path}/Smoke.md"

obsidian_user_data="${HOME}/Library/Application Support/obsidian"
mkdir -p "${obsidian_user_data}"
node --input-type=module - "${vault_path}" "${obsidian_user_data}/obsidian.json" <<'NODE'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const [, , vaultPath, configPath] = process.argv
const vaultId = createHash('sha256').update(vaultPath).digest('hex').slice(0, 16)
writeFileSync(
  configPath,
  `${JSON.stringify({
    cli: true,
    updateDisabled: true,
    vaults: {
      [vaultId]: {
        path: vaultPath,
        ts: Date.now(),
        open: true,
      },
    },
  })}\n`,
)
NODE

"${application_path}/Contents/MacOS/Obsidian" --disable-gpu \
  > "${artifact_dir}/obsidian.log" 2>&1 &
obsidian_pid="$!"

cli_path="${application_path}/Contents/MacOS/obsidian-cli"
cli_socket="${HOME}/.obsidian-cli.sock"

for _ in {1..120}; do
  [[ -S "${cli_socket}" ]] && break
  sleep 1
done
[[ -S "${cli_socket}" ]]

run_cli() {
  "${cli_path}" 'vault=smart-composer-ci' "$@"
}

eval_obsidian() {
  run_cli eval "code=$1"
}

wait_for_true() {
  local expression="$1"
  local description="$2"
  local output=''
  for _ in {1..90}; do
    output="$(eval_obsidian "${expression}" 2>&1 || true)"
    if grep -Fxq 'true' <<< "${output}"; then
      return 0
    fi
    sleep 1
  done
  printf 'Timed out waiting for %s. Last result: %s\n' "${description}" "${output}" >&2
  return 1
}

run_cli version | tee "${artifact_dir}/obsidian-version.txt"
run_cli plugins:restrict off
run_cli dev:errors clear
run_cli dev:errors > "${artifact_dir}/javascript-errors-baseline.txt"
run_cli plugin:enable id=smart-composer filter=community
run_cli plugin:reload id=smart-composer

eval_obsidian 'app.setting.open(); app.setting.openTabById("smart-composer"); true'
wait_for_true \
  'document.querySelectorAll("[data-runtime-provider]").length >= 2' \
  'the Plan runtime cards'
wait_for_true \
  'document.querySelector(".smtcmp-settings-load-error") === null' \
  'the settings renderer to remain healthy'

verify_installer_modal() {
  local provider="$1"

  wait_for_true \
    "document.querySelector('[data-runtime-provider=\"${provider}\"] [data-runtime-action=\"install\"]') !== null" \
    "the ${provider} install action"
  eval_obsidian "(() => { const card = document.querySelector('[data-runtime-provider=\"${provider}\"]'); const button = card?.querySelector('[data-runtime-action=\"install\"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()" \
    | grep -Fxq 'true'
  wait_for_true \
    "document.querySelector('[data-runtime-installer=\"${provider}\"]') !== null" \
    "the ${provider} installer modal"
  wait_for_true \
    'document.querySelectorAll("[role=tab][data-runtime-platform]").length === 2' \
    'the Windows and macOS platform tabs'
  wait_for_true \
    'document.querySelector("[role=tab][data-runtime-platform=darwin]")?.getAttribute("aria-selected") === "true"' \
    'macOS to be the selected platform'
  wait_for_true \
    'document.querySelector("[role=tab][data-runtime-platform=win32]")?.textContent?.includes("Windows") === true && document.querySelector("[role=tab][data-runtime-platform=darwin]")?.textContent?.includes("macOS") === true' \
    'the platform labels'

  mkdir -p "${HOME}/.local/bin"
  if [[ "${provider}" == 'claude' ]]; then
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'if [[ "${1:-}" == "--version" ]]; then printf "0.0.0-ci-fixture (Claude Code)\\n"; exit 0; fi' \
      'if [[ "${1:-}" == "auth" ]]; then exit 1; fi' \
      'exit 1' \
      > "${HOME}/.local/bin/claude"
    chmod 0755 "${HOME}/.local/bin/claude"
  else
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'if [[ "${1:-}" == "--version" ]]; then printf "0.0.0-ci-fixture (Antigravity CLI)\\n"; exit 0; fi' \
      'exit 1' \
      > "${HOME}/.local/bin/agy"
    chmod 0755 "${HOME}/.local/bin/agy"
  fi

  eval_obsidian '(() => { const button = document.querySelector("[data-runtime-action=check-installation]"); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()' \
    | grep -Fxq 'true'
  wait_for_true \
    '(() => { const step = document.querySelector("[data-runtime-step=login]"); if (!(step instanceof HTMLElement)) return false; const action = step.querySelector("button"); return step.getAttribute("aria-disabled") !== "true" && !(action instanceof HTMLButtonElement && action.disabled); })()' \
    "the ${provider} login step to unlock without closing the modal"

  run_cli dev:screenshot "path=${artifact_dir}/${provider}-installer.png" > /dev/null
  eval_obsidian '(() => { const close = document.querySelector(".modal-close-button"); if (!(close instanceof HTMLElement)) return false; close.click(); return true; })()' \
    | grep -Fxq 'true'
  wait_for_true \
    "document.querySelector('[data-runtime-installer=\"${provider}\"]') === null" \
    "the ${provider} installer modal to close"
}

verify_installer_modal claude
verify_installer_modal gemini

eval_obsidian 'JSON.stringify({cards: document.querySelectorAll("[data-runtime-provider]").length, loadError: document.querySelector(".smtcmp-settings-load-error") !== null})' \
  | tee "${artifact_dir}/dom-summary.json"
run_cli dev:errors | tee "${artifact_dir}/javascript-errors.txt"

if ! cmp -s \
  "${artifact_dir}/javascript-errors-baseline.txt" \
  "${artifact_dir}/javascript-errors.txt"; then
  echo 'Obsidian captured one or more JavaScript errors during the Smart Composer smoke test.' >&2
  exit 1
fi
