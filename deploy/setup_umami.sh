#!/bin/bash
# Umami 统计系统部署脚本
# 使用方式：在服务器上执行 bash deploy/setup_umami.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/deploy/.umami.env"

echo "=========================================="
echo "  Umami 统计系统部署"
echo "=========================================="

# 1. 检查/安装 Docker
echo ""
echo ">>> [1/4] 检查 Docker..."
if ! command -v docker &>/dev/null; then
    echo "    安装 Docker..."
    # 取消代理，避免本地代理（scholarly 用）干扰 apt
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "    Docker 安装完成（当前 shell 需重新登录才能免 sudo 使用 docker）"
else
    echo "    Docker 已安装：$(docker --version | grep -o '[0-9.]*' | head -1)"
fi

# 2. 生成密钥（幂等：已存在则跳过）
echo ""
echo ">>> [2/4] 生成配置..."
if [ -f "$ENV_FILE" ]; then
    echo "    已存在 .umami.env，跳过生成"
else
    DB_PASS=$(openssl rand -hex 16)
    APP_SECRET=$(openssl rand -hex 32)
    cat > "$ENV_FILE" <<EOF
DB_PASSWORD=${DB_PASS}
APP_SECRET=${APP_SECRET}
EOF
    chmod 600 "$ENV_FILE"
    echo "    已生成 .umami.env（密钥已安全保存）"
fi

# 3. 启动服务
echo ""
echo ">>> [3/4] 启动 Umami + PostgreSQL..."
cd "$REPO_DIR/deploy"
sudo docker compose --env-file .umami.env -f umami-compose.yml up -d

echo "    等待服务就绪（约 30 秒）..."
for i in $(seq 1 12); do
    if curl -s http://127.0.0.1:3001/analytics >/dev/null 2>&1; then
        echo "    Umami 已就绪 ✓"
        break
    fi
    sleep 5
    echo "    等待中... ($((i*5))s)"
done

# 4. 更新 Nginx
echo ""
echo ">>> [4/4] 重载 Nginx..."
sudo nginx -t && sudo systemctl reload nginx
echo "    Nginx 重载完成 ✓"

echo ""
echo "=========================================="
echo "  ✓ 部署完成！"
echo ""
echo "  1. 访问 Umami 控制台："
echo "     http://118.25.192.117/analytics"
echo ""
echo "  2. 默认账号：admin / umami"
echo "     ⚠  请立即登录并修改密码！"
echo ""
echo "  3. 在 Umami 中添加网站："
echo "     设置 → 网站 → 添加网站"
echo "     名称：ScholarScout"
echo "     域名：118.25.192.117"
echo ""
echo "  4. 复制 Website ID，填入 frontend/index.html"
echo "     data-website-id=\"YOUR-ID\""
echo "     然后重新执行 bash deploy/deploy.sh"
echo "=========================================="
