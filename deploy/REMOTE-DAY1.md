# 内测服务器上线清单（购买后执行）

状态：待服务器/域名到位后执行。本文只列步骤，不包含密码。产品边界见 [内测身份与部署](../docs/internal-beta-identity-design.md)，完整部署说明见 [deploy/README.md](README.md)。

## 0. 购买前确认

- 2 vCPU / 2 GB RAM 起，20 GB 以上磁盘，Ubuntu 24.04 LTS，公网 IPv4。
- 地区优先香港/新加坡；美国也可，延迟更高。大陆服务器需备案，内测阶段不建议。
- 必须有 SSH 密钥登录和 sudo；不要用 root 密码登录。
- 需要一个可信 HTTPS 域名。域名不是必须买：可先用 DuckDNS 免费子域名；正式内测再买几十元/年的域名。
- 带宽：单用户首次加载约 12 MB；两人内测 1 TB/月足够。

## 1. 服务器初始化

```bash
sudo apt update && sudo apt upgrade -y
sudo adduser --disabled-password --gecos "" kvb
sudo usermod -aG sudo kvb
# 复制本机 SSH 公钥到 kvb:~/.ssh/authorized_keys，确认可登录后再禁用密码登录
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

只开放 22/80/443；不要开放 5432 或 8788。

## 2. 域名与 HTTPS

任选一种：

- **DuckDNS**：创建 `kvb-beta.duckdns.org`，A 记录指向服务器 IP；`PUBLIC_ORIGIN=https://kvb-beta.duckdns.org`。
- **已有域名**：添加 A 记录到服务器 IP；`PUBLIC_ORIGIN=https://snk.example.com`。
- 不建议直接用 IP：浏览器可信 HTTPS 需要域名；Cloudflare Tunnel 可作临时方案但链接不稳定。

Caddy 的 `{$PUBLIC_ORIGIN}` 会作为站点地址自动申请证书，要求 DNS 已生效且 80/443 可达。

## 3. 方案 A：Docker Compose（推荐）

在本地仓库准备资源并上传（`public/assets` 在 Git 外，必须显式传输）：

```bash
# 本机
cd /home/kevinbarrus/projects/snk
npm run assets:prepare && npm run audio:install
npm run deploy:check
rsync -av --exclude node_modules --exclude .cache --exclude dist \
  ./ kvb@<SERVER_IP>:/home/kvb/kvb-snooker/
rsync -av public/assets kvb@<SERVER_IP>:/home/kvb/kvb-snooker/public/
```

服务器：

```bash
cd /home/kvb/kvb-snooker
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
# 编辑：POSTGRES_PASSWORD、DATABASE_URL 中同密码、PUBLIC_ORIGIN=https://<域名>、
#       COOKIE_SECURE=1、TRUST_PROXY=1
docker compose config
docker compose build
docker compose up -d postgres
docker compose run --rm identity node .cache/identity/identity/cli.js migrate
docker compose run --rm identity node .cache/identity/identity/cli.js create-user --email <账号1邮箱> --role player
docker compose run --rm identity node .cache/identity/identity/cli.js create-user --email <账号2邮箱> --role player
docker compose up -d
docker compose --profile https up -d caddy
curl -fsS https://<域名>/api/health
```

若 Docker 镜像拉取失败，改用方案 B。

## 4. 方案 B：预构建包 + 原生 Node/PostgreSQL/Caddy

本机：

```bash
cd /home/kevinbarrus/projects/snk
npm run assets:prepare && npm run audio:install
npm run build && npm run identity:build
npm run deploy:bundle
# 输出 .cache/deploy/kvb-snooker-<时间戳>.tar.gz 与 .sha256
scp .cache/deploy/kvb-snooker-*.tar.gz .cache/deploy/*.sha256 kvb@<SERVER_IP>:/tmp/
```

服务器：

```bash
sudo apt install -y nodejs npm postgresql postgresql-contrib caddy
# Node 需 22+；Ubuntu 仓库版本过旧时用 NodeSource 安装 nodejs 22
sudo mkdir -p /opt/kvb-snooker
sudo tar -xzf /tmp/kvb-snooker-<时间戳>.tar.gz -C /opt/kvb-snooker
sudo chown -R kvb:kvb /opt/kvb-snooker

# PostgreSQL 用户/库（密码用随机值，不写日志）
sudo -u postgres psql
# CREATE ROLE kvb LOGIN PASSWORD '<强随机密码>';
# CREATE DATABASE kvb OWNER kvb;

# 环境文件
sudo mkdir -p /etc/kvb-snooker
sudo cp /opt/kvb-snooker/deploy/identity.env.example /etc/kvb-snooker/identity.env
sudo chmod 600 /etc/kvb-snooker/identity.env
# 编辑 DATABASE_URL、PUBLIC_ORIGIN、STATIC_DIR、MIGRATIONS_DIR、COOKIE_SECURE=1、TRUST_PROXY=1

sudo -u kvb env $(grep -v '^#' /etc/kvb-snooker/identity.env | xargs) \
  node /opt/kvb-snooker/.cache/identity/identity/cli.js migrate
# create-user 用同一环境变量；交互输入密码
sudo -u kvb env $(grep -v '^#' /etc/kvb-snooker/identity.env | xargs) \
  node /opt/kvb-snooker/.cache/identity/identity/cli.js create-user --email <账号1邮箱> --role player
# 重复创建账号2

sudo cp /opt/kvb-snooker/deploy/kvb-identity.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kvb-identity
sudo cp /opt/kvb-snooker/deploy/Caddyfile.native /etc/caddy/Caddyfile
sudo systemctl restart caddy
curl -fsS https://<域名>/api/health
```

注意：`env $(grep ...)` 会把密码放进命令行进程环境，仅服务器 root 可见；更稳妥的是先 `set -a; . /etc/kvb-snooker/identity.env; set +a` 再执行。不要把密码写进 shell 历史。

## 5. 上线验收

本机：

```bash
REMOTE_URL=https://<域名> \
REMOTE_EMAIL=<账号1邮箱> \
REMOTE_PASSWORD='<账号1密码>' \
npm run test:identity:remote
```

人工检查：

- 登录页显示；错误密码只显示错误，不进入游戏。
- 登录后右上角显示邮箱；双人入口灰色不可用。
- 预设球形、自由练习、我的球形、人机/900 正常。
- 我的球形创建后刷新仍在；退出登录后另一个账号看不到。
- `/api/health` 返回 `{"ok":true,"database":"up"}`。
- 浏览器没有数据库密码、密码明文或服务器密钥。
- 两台设备分别登录两个账号（本单元不做正式联机绑定，只验证身份）。

## 6. 运行、备份与重启

```bash
# 状态与日志
systemctl status kvb-identity
journalctl -u kvb-identity -n 100 --no-pager

# 数据库备份（每天/迁移前）
sudo -u postgres pg_dump kvb > /var/backups/kvb-$(date +%Y%m%dT%H%M%S).sql
chmod 600 /var/backups/kvb-*.sql

# 重启验证
sudo reboot
# 重启后检查 /api/health、Caddy、PostgreSQL 和两个账号登录
```

Docker 方案使用 `docker compose ps`、`docker compose logs -f identity`、`docker compose exec -T postgres pg_dump ...`。

## 7. 不要做

- 不要把 5432/8788 映射到公网。
- 不要把 `deploy/*.env`、数据库密码、账号密码提交 Git 或发到公开聊天。
- 不要删除 PostgreSQL 数据卷/目录来“重置”；回滚按 [deploy/README.md](README.md) §6。
- 不要把本地临时 PostgreSQL（`.cache/identity-pg`，端口 55432）当作服务器数据库。
- 不要在没有 HTTPS 和 `COOKIE_SECURE=1` 的情况下把服务称为已上线。
