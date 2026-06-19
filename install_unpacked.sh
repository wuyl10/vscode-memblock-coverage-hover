#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ID="wuyuanlong-local.memblock-coverage-hover-0.1.0"

usage() {
  cat <<'USAGE'
Install MemBlock Coverage Hover as an unpacked VSCode extension.

Usage:
  ./install_unpacked.sh             # auto-pick ~/.vscode-server/extensions if present, else ~/.vscode/extensions
  ./install_unpacked.sh --remote    # install into ~/.vscode-server/extensions
  ./install_unpacked.sh --local     # install into ~/.vscode/extensions
  ./install_unpacked.sh --dir DIR   # install into custom extension directory

The script creates/updates a symlink only. Reload VSCode after installation.
USAGE
}

TARGET_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      TARGET_DIR="${HOME}/.vscode-server/extensions"
      shift
      ;;
    --local)
      TARGET_DIR="${HOME}/.vscode/extensions"
      shift
      ;;
    --dir)
      if [[ $# -lt 2 ]]; then
        echo "error: --dir requires a path" >&2
        exit 2
      fi
      TARGET_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${TARGET_DIR}" ]]; then
  if [[ -d "${HOME}/.vscode-server/extensions" ]]; then
    TARGET_DIR="${HOME}/.vscode-server/extensions"
  else
    TARGET_DIR="${HOME}/.vscode/extensions"
  fi
fi

mkdir -p "${TARGET_DIR}"
ln -sfn "${SCRIPT_DIR}" "${TARGET_DIR}/${EXT_ID}"

echo "Installed symlink:"
echo "  ${TARGET_DIR}/${EXT_ID} -> ${SCRIPT_DIR}"
echo
echo "Reload VSCode, then run: MemBlock Coverage Hover: Rescan Symbols"
