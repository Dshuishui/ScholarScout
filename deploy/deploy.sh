#!/bin/bash
# ScholarScout 更新部署脚本（首次部署请用 setup.sh）
# 使用方式：bash deploy/deploy.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_DIR="/var/www/scholarscout"
UV="$HOME/.local/bin/uv"

echo "=========================================="
echo "  ScholarScout 更新部署"
echo "=========================================="

echo ""
echo ">>> [1/5] 拉取最新代码..."
cd "$REPO_DIR"
git pull origin master

echo ""
echo ">>> [2/5] 更新后端依赖..."
cd "$REPO_DIR/backend"
"$UV" sync --no-dev
# uv sync 在 Linux 上会写入平台特定的 wheel hash，丢弃以保持 git 干净
git -C "$REPO_DIR" checkout -- backend/uv.lock 2>/dev/null || true

echo ""
echo ">>> [3/5] 构建前端..."
cd "$REPO_DIR/frontend"
npm install --silent
npm run build

echo ""
echo ">>> [4/5] 更新静态文件..."
sudo rsync -a --delete "$REPO_DIR/frontend/dist/" "$STATIC_DIR/"

echo ""
echo ">>> [5/5] 重启服务..."
sudo systemctl restart scholarscout-backend
sudo cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/scholarscout
sudo nginx -t && sudo systemctl reload nginx

sleep 1
if sudo systemctl is-active --quiet scholarscout-backend; then
    echo "    后端服务运行中 ✓"
else
    echo "    ⚠ 后端服务启动失败，查看日志：sudo journalctl -u scholarscout-backend -n 30"
    exit 1
fi

echo ""
echo "=========================================="
echo "  ✓ 更新完成！"
echo "  访问 http://118.25.192.117"
echo "=========================================="
