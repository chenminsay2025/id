#!/usr/bin/env bash
# 从 GitHub 拉取 main 并构建、重启 PM2（宝塔站点根目录执行）
# 用法：
#   bash scripts/deploy-from-git.sh
#   PM2_NAME=id-svg bash scripts/deploy-from-git.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PM2_NAME="${PM2_NAME:-id-svg}"
BRANCH="${GIT_BRANCH:-main}"
REMOTE="${GIT_REMOTE:-origin}"

echo "[deploy] 目录: $ROOT"
echo "[deploy] 同步 $REMOTE/$BRANCH（与 GitHub 完全一致，丢弃服务器本地提交）"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误：当前目录不是 git 仓库。请先在网站根目录 git clone。"
  exit 1
fi

git fetch "$REMOTE" "$BRANCH"
git checkout "$BRANCH"
# 部署机不应在服务器上 git commit；用 hard reset 避免 divergent branches / pull 策略报错
git reset --hard "$REMOTE/$BRANCH"

if id www >/dev/null 2>&1; then
  chown -R www:www "$ROOT"
  RUN_AS=(sudo -u www)
else
  RUN_AS=()
fi

echo "[deploy] npm install"
"${RUN_AS[@]}" npm install

echo "[deploy] npm run build"
"${RUN_AS[@]}" npm run build

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    echo "[deploy] pm2 restart $PM2_NAME"
    pm2 restart "$PM2_NAME"
  else
    echo "[deploy] 未找到 PM2 应用 $PM2_NAME，请先在面板添加项目后重试。"
    exit 1
  fi
else
  echo "[deploy] 未找到 pm2，请手动在宝塔 PM2 管理器重启。"
fi

echo "[deploy] 完成 $(date -Iseconds)"
