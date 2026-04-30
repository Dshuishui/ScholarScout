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
    echo "    安装 Docker (使用 Ubuntu 内置包，从腾讯云镜像下载，无需代理)..."
    # 取消所有代理：腾讯云镜像是内网，直连更快；外网包由 Docker daemon 代理处理
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    sudo apt-get -qq update
    sudo apt-get install -y -qq docker.io docker-compose-v2
    sudo usermod -aG docker "$USER"
    echo "    Docker 安装完成"
fi

# 给 Docker daemon 配置 HTTPS 代理（用于拉取 ghcr.io 镜像）
echo "    配置 Docker 代理（ghcr.io 需要走代理）..."
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/proxy.conf > /dev/null <<'PROXY_CONF'
[Service]
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
Environment="NO_PROXY=localhost,127.0.0.1,mirrors.tencentyun.com"
PROXY_CONF
sudo systemctl daemon-reload
sudo systemctl restart docker
echo "    Docker 已安装：$(docker --version | cut -d' ' -f3 | tr -d ',')"

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

# 4. 更新 Nginx（复制最新配置再重载）
echo ""
echo ">>> [4/4] 更新并重载 Nginx..."
sudo cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/scholarscout
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
