#!/bin/bash
# ScholarScout 首次部署脚本
# 使用方式：在服务器上 git clone 仓库后，执行 bash deploy/setup.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_DIR="/var/www/scholarscout"
UV="$HOME/.local/bin/uv"

echo "=========================================="
echo "  ScholarScout 首次部署"
echo "  项目目录: $REPO_DIR"
echo "=========================================="

# 1. Nginx
echo ""
echo ">>> [1/7] 安装 Nginx..."
sudo apt-get update -q
sudo apt-get install -y -q nginx
echo "    Nginx $(nginx -v 2>&1 | grep -o '[0-9.]*')"

# 2. Node.js
echo ""
echo ">>> [2/7] 安装 Node.js 20..."
if command -v node &>/dev/null; then
    echo "    已安装：$(node --version)"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -q
    sudo apt-get install -y -q nodejs
    echo "    安装完成：$(node --version)"
fi

# 3. uv
echo ""
echo ">>> [3/7] 安装 uv..."
if command -v "$UV" &>/dev/null; then
    echo "    已安装：$($UV --version)"
else
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo "    安装完成：$($UV --version)"
fi

# 4. 后端依赖
echo ""
echo ">>> [4/7] 安装后端依赖..."
cd "$REPO_DIR/backend"
"$UV" sync --no-dev
echo "    依赖安装完成"

# 5. 前端构建
echo ""
echo ">>> [5/7] 构建前端..."
cd "$REPO_DIR/frontend"
npm install --silent
npm run build
echo "    构建完成"

# 6. 部署静态文件
echo ""
echo ">>> [6/7] 部署前端静态文件..."
sudo mkdir -p "$STATIC_DIR"
sudo rsync -a --delete "$REPO_DIR/frontend/dist/" "$STATIC_DIR/"
echo "    静态文件已部署到 $STATIC_DIR"

# 7. Nginx + systemd
echo ""
echo ">>> [7/7] 配置 Nginx 和后台服务..."

sudo cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/scholarscout
sudo ln -sf /etc/nginx/sites-available/scholarscout /etc/nginx/sites-enabled/scholarscout
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

# 将 service 文件里的占位符替换为实际路径后再安装
sed "s|__REPO_DIR__|$REPO_DIR|g" "$REPO_DIR/deploy/scholarscout-backend.service" \
    | sudo tee /etc/systemd/system/scholarscout-backend.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable scholarscout-backend
sudo systemctl restart scholarscout-backend

# 等一秒确认服务起来了
sleep 1
if sudo systemctl is-active --quiet scholarscout-backend; then
    echo "    后端服务运行中 ✓"
else
    echo "    ⚠ 后端服务启动失败，查看日志：sudo journalctl -u scholarscout-backend -n 30"
    exit 1
fi

echo ""
echo "=========================================="
echo "  ✓ 部署完成！"
echo "  访问 http://118.25.192.117"
echo "=========================================="
