#!/bin/bash
# 在云服务器上执行此脚本完成部署
# 使用方式：bash deploy/deploy.sh

set -e

REPO_DIR="/home/ubuntu/ScholarScout"
STATIC_DIR="/var/www/scholarscout"

echo "=== 1. 拉取最新代码 ==="
cd "$REPO_DIR"
git pull origin master

echo "=== 2. 安装/更新后端依赖 ==="
cd "$REPO_DIR/backend"
uv sync

echo "=== 3. 构建前端 ==="
cd "$REPO_DIR/frontend"
npm install
npm run build

echo "=== 4. 更新前端静态文件 ==="
sudo mkdir -p "$STATIC_DIR"
sudo rsync -av --delete dist/ "$STATIC_DIR/"

echo "=== 5. 重启后端服务 ==="
sudo systemctl restart scholarscout-backend
sudo systemctl status scholarscout-backend --no-pager

echo "=== 6. 重载 Nginx ==="
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "✓ 部署完成！访问 http://118.25.192.117"
