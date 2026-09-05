#!/usr/bin/env bash
# Install aichat into /opt/aichat and expose the aichat command via npm link.
set -u

if [ "$(id -u)" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

set -e
SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_DIR="${AICHAT_INSTALL_DIR:-/opt/aichat}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "错误：需要先安装 Node.js 和 npm。" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
if [ "$SOURCE_DIR" != "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  cp -a "$SOURCE_DIR"/. "$TARGET_DIR"/
fi

cd "$TARGET_DIR"
npm install --omit=dev
npm link

chmod +x "$TARGET_DIR/bin/aiclaw.js"
echo "安装完成：$TARGET_DIR"
echo "命令：aichat --help"
