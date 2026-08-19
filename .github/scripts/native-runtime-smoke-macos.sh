#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
download_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/smart-composer-native-installers"
mkdir -p "${download_dir}"

download_and_verify() {
  local artifact_id="$1"
  local url="$2"
  local destination="$3"

  curl --fail --silent --show-error --location \
    --proto '=https' --tlsv1.2 \
    "${url}" --output "${destination}"
  node "${repository_root}/.github/scripts/verify-pinned-artifact.mjs" \
    "${artifact_id}" "${destination}" "${url}"
}

assert_mach_o_architecture() {
  local executable="$1"
  local expected_architecture="$2"

  test -x "${executable}"
  file -b -L "${executable}" | tee /dev/stderr | grep -q 'Mach-O'
  lipo -archs "${executable}" | tr ' ' '\n' | grep -Fxq "${expected_architecture}"
}

case "$(uname -m)" in
  arm64)
    expected_architecture='arm64'
    ;;
  x86_64)
    expected_architecture='x86_64'
    ;;
  *)
    echo "Unsupported macOS runner architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

claude_path="${HOME}/.local/bin/claude"
antigravity_path="${HOME}/.local/bin/agy"

if [[ -e "${claude_path}" || -e "${antigravity_path}" ]]; then
  echo 'The macOS installer smoke test requires a clean runner without either target executable.' >&2
  exit 1
fi
if command -v claude >/dev/null 2>&1 || command -v agy >/dev/null 2>&1; then
  echo 'The macOS installer smoke test requires a clean runner without either executable on PATH.' >&2
  exit 1
fi

claude_installer="${download_dir}/claude-install.sh"
antigravity_installer="${download_dir}/antigravity-install.sh"

download_and_verify \
  'claude-macos-installer' \
  'https://claude.ai/install.sh' \
  "${claude_installer}"
download_and_verify \
  'antigravity-macos-installer' \
  'https://antigravity.google/cli/install.sh' \
  "${antigravity_installer}"

# These are fresh, ephemeral GitHub-hosted runners. Execute only the reviewed
# installer bytes above, then perform local file and --version checks. Never
# invoke login, auth status, model discovery, inference, or update commands.
bash "${claude_installer}"
bash "${antigravity_installer}"

assert_mach_o_architecture "${claude_path}" "${expected_architecture}"
assert_mach_o_architecture "${antigravity_path}" "${expected_architecture}"

claude_version="$("${claude_path}" --version | tr -d '\r' | head -n 1)"
antigravity_version="$("${antigravity_path}" --version | tr -d '\r' | head -n 1)"

test -n "${claude_version}"
test -n "${antigravity_version}"
printf 'Claude Code version: %s\n' "${claude_version}"
printf 'Antigravity CLI version: %s\n' "${antigravity_version}"
