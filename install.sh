#!/usr/bin/env bash
# 猫咪血统证书 — 一键命令行安装（宝塔 SSH / 终端）
set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  猫咪血统证书 · 安装程序"
echo "=========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js，请在宝塔安装 Node 18+ 后重试。"
  exit 1
fi

node server/install-cli.js "$@"
