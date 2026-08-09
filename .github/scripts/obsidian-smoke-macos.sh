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
cli_path=''
cli_socket=''
mounted='false'

cleanup() {
  local exit_status="$?"
  trap - EXIT
  set +e
  if [[ "${exit_status}" -ne 0 && -x "${cli_path}" && -S "${cli_socket}" ]]; then
    "${cli_path}" 'vault=smart-composer-ci' dev:errors \
      > "${artifact_dir}/failure-javascript-errors.txt" 2>&1 || true
    "${cli_path}" 'vault=smart-composer-ci' dev:console level=error limit=200 \
      > "${artifact_dir}/failure-console-errors.txt" 2>&1 || true
    "${cli_path}" 'vault=smart-composer-ci' plugin id=smart-composer \
      > "${artifact_dir}/failure-plugin.txt" 2>&1 || true
    "${cli_path}" 'vault=smart-composer-ci' eval \
      'code=JSON.stringify({layoutReady: app.workspace?.layoutReady === true, pluginLoaded: Boolean(app.plugins.getPlugin("smart-composer")), settingsPopoutConfigured: app.vault?.getConfig("settingsPopoutWindow") === true, settingsPopoutOpen: app.setting?.isPopoutModal?.() === true, settingsDocumentIsMain: app.setting?.modalEl?.ownerDocument === document, settingsTabRegistered: app.setting?.pluginTabs?.some(tab => tab.id === "smart-composer") === true, settingsRoot: document.querySelector(".smtcmp-settings-root") !== null, loadError: document.querySelector(".smtcmp-settings-load-error") !== null, cardCount: document.querySelectorAll("[data-runtime-provider]").length, modalCount: document.querySelectorAll(".modal").length})' \
      > "${artifact_dir}/failure-structure.json" 2>&1 || true
    "${cli_path}" 'vault=smart-composer-ci' dev:screenshot \
      "path=${artifact_dir}/failure-settings.png" > /dev/null 2>&1 || true
  fi
  if [[ -n "${obsidian_pid}" ]]; then
    kill "${obsidian_pid}" 2>/dev/null || true
    wait "${obsidian_pid}" 2>/dev/null || true
  fi
  if [[ "${mounted}" == 'true' ]]; then
    hdiutil detach "${mount_dir}" -quiet 2>/dev/null || true
  fi
  exit "${exit_status}"
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
# Obsidian 1.13.4 defaults settingsPopoutWindow to true. Keep this disposable
# smoke in the main renderer so CLI eval, DOM assertions, and screenshots all
# observe the same document.
printf '{"settingsPopoutWindow":false}\n' > "${vault_path}/.obsidian/app.json"
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

is_true_output() {
  local output=''
  output="$(cat)"
  ! grep -Fq 'Error:' <<< "${output}" \
    && grep -Eq '^[[:space:]]*(=>[[:space:]]*)?true[[:space:]]*$' <<< "${output}"
}

wait_for_cli_ready() {
  local output=''
  for _ in {1..120}; do
    output="$(run_cli version 2>&1 || true)"
    if grep -Eq '(^|[^0-9])1\.13\.4([^0-9]|$)' <<< "${output}" \
      && ! grep -Eq '^Error:|not found|Failed to connect' <<< "${output}"; then
      printf '%s\n' "${output}" > "${artifact_dir}/obsidian-version.txt"
      return 0
    fi
    sleep 1
  done
  printf 'Timed out waiting for the documented Obsidian version command. Last result: %s\n' "${output}" >&2
  return 1
}

wait_for_true() {
  local expression="$1"
  local description="$2"
  local output=''
  for _ in {1..90}; do
    output="$(eval_obsidian "${expression}" 2>&1 || true)"
    if is_true_output <<< "${output}"; then
      return 0
    fi
    sleep 1
  done
  printf 'Timed out waiting for %s. Last result: %s\n' "${description}" "${output}" >&2
  return 1
}

wait_for_cli_ready
wait_for_true \
  'typeof app !== "undefined" && app.workspace?.layoutReady === true && app.vault != null && app.plugins != null && app.setting != null' \
  'the initial Obsidian workspace layout'
restrict_output="$(run_cli plugins:restrict off 2>&1)"
printf '%s\n' "${restrict_output}"
if grep -Fq 'Error:' <<< "${restrict_output}"; then
  exit 1
fi
sleep 2
wait_for_cli_ready
wait_for_true \
  'typeof app !== "undefined" && app.workspace?.layoutReady === true && app.vault != null && app.plugins != null && app.setting != null' \
  'the Obsidian workspace after restricted-mode reload'
errors_clear_output="$(run_cli dev:errors clear 2>&1)"
if grep -Fq 'Error:' <<< "${errors_clear_output}"; then
  printf '%s\n' "${errors_clear_output}" >&2
  exit 1
fi
baseline_errors="$(run_cli dev:errors 2>&1)"
if grep -Fq 'Error:' <<< "${baseline_errors}"; then
  printf '%s\n' "${baseline_errors}" >&2
  exit 1
fi
printf '%s\n' "${baseline_errors}" > "${artifact_dir}/javascript-errors-baseline.txt"
run_cli plugin:enable id=smart-composer filter=community
eval_obsidian 'globalThis.__smtcmpPreviousPlugin = app.plugins.getPlugin("smart-composer"); true' \
  | is_true_output
run_cli plugin:reload id=smart-composer
wait_for_true \
  'Boolean(app.plugins.getPlugin("smart-composer")) && app.plugins.getPlugin("smart-composer") !== globalThis.__smtcmpPreviousPlugin' \
  'the reloaded Smart Composer plugin instance'

wait_for_true \
  'app.vault?.getConfig("settingsPopoutWindow") === false' \
  'the disposable vault in-window Settings override'
settings_command_output="$(run_cli command id=app:open-settings 2>&1)"
printf '%s\n' "${settings_command_output}"
if ! grep -Fxq 'Executed: app:open-settings' <<< "${settings_command_output}"; then
  exit 1
fi
wait_for_true \
  'document.querySelector(".modal.mod-settings") !== null && app.setting?.isPopoutModal?.() !== true && app.setting?.modalEl?.ownerDocument === document' \
  'the main-window Obsidian settings modal'
wait_for_true \
  'app.setting?.pluginTabs?.some(tab => tab.id === "smart-composer") === true' \
  'the registered Smart Composer settings tab'
eval_obsidian 'Boolean(app.setting.openTabById("smart-composer"))' \
  | is_true_output
wait_for_true \
  'document.querySelector(".smtcmp-settings-root, .smtcmp-settings-load-error") !== null' \
  'the Smart Composer settings terminal state'
load_error_state="$(eval_obsidian 'document.querySelector(".smtcmp-settings-load-error") !== null' 2>&1 || true)"
if is_true_output <<< "${load_error_state}"; then
  echo 'Smart Composer rendered its settings load-error state.' >&2
  exit 1
fi
eval_obsidian 'JSON.stringify({appVersion: app.getVersion?.() ?? null, pluginLoaded: Boolean(app.plugins.getPlugin("smart-composer")), settingsOpen: document.querySelector(".modal.mod-settings") !== null})' \
  > "${artifact_dir}/startup-summary.json"
run_cli dev:screenshot "path=${artifact_dir}/settings-open.png" > /dev/null
wait_for_true \
  'document.querySelectorAll("[data-runtime-provider]").length >= 2' \
  'the Plan runtime cards'

verify_installer_modal() {
  local provider="$1"

  wait_for_true \
    "document.querySelector('[data-runtime-provider=\"${provider}\"] [data-runtime-action=\"install\"]') !== null" \
    "the ${provider} install action"
  eval_obsidian "(() => { const card = document.querySelector('[data-runtime-provider=\"${provider}\"]'); const button = card?.querySelector('[data-runtime-action=\"install\"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()" \
    | is_true_output
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
    | is_true_output
  wait_for_true \
    '(() => { const step = document.querySelector("[data-runtime-step=login]"); if (!(step instanceof HTMLElement)) return false; const action = step.querySelector("button"); return step.getAttribute("aria-disabled") !== "true" && !(action instanceof HTMLButtonElement && action.disabled); })()' \
    "the ${provider} login step to unlock without closing the modal"

  run_cli dev:screenshot "path=${artifact_dir}/${provider}-installer.png" > /dev/null
  eval_obsidian "(() => { const marker = document.querySelector('[data-runtime-installer=\"${provider}\"]'); if (!(marker instanceof HTMLElement)) return false; const container = marker.closest('.modal-container'); if (!(container instanceof HTMLElement)) return false; const backdrop = container.querySelector('.modal-bg'); if (!(backdrop instanceof HTMLElement)) return false; backdrop.click(); return true; })()" \
    | is_true_output
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
