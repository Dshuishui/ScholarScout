# 数据库备份与恢复

线上数据（账号、收藏、阅读记录、AI 对话、搜索快照、订阅）都在一个 SQLite 文件里：
`backend/scholarscout.db`。备份由 `deploy/backup.sh` 每天自动执行。

## 备份怎么跑

| 项目 | 值 |
|------|-----|
| 脚本 | `deploy/backup.sh` |
| 执行时间 | 每天 03:30（服务器时区，北京时间），cron |
| 存放位置 | `~/backups/scholarscout/daily/`、`~/backups/scholarscout/weekly/` |
| 保留策略 | 每日 14 份；周一那份额外进 weekly，保留 8 份 |
| 日志 | `~/backups/scholarscout/backup.log` |
| 状态文件 | `~/backups/scholarscout/last_success`（成功时写入 unix 时间戳） |

脚本做的事：

1. 用 `sqlite3 .backup` 做一致性快照——服务正在写库时直接 `cp` 可能拷到写了一半的状态；
2. 校验快照：`PRAGMA integrity_check` 必须返回 `ok`，且 `users`、`subscriptions` 两张表能正常读；
3. 校验通过才压缩归档（权限 600），并复制一份 `backend/.env`（含各种 API Key）；
4. 删除超出保留份数的旧备份；
5. 写状态文件。

**备份失效会告警**：后端每小时的健康检查会读状态文件，超过 `BACKUP_MAX_AGE_HOURS`（默认 36 小时）
没有成功就给 `ADMIN_EMAIL` 发邮件，同一问题每天最多一封。需要在 `backend/.env` 里配置：

```
BACKUP_STATUS_FILE=/home/ubuntu/backups/scholarscout/last_success
```

没配置这一项时不做检查（本地开发不会误报）。

## 服务器上的其他服务

这台机器上还跑着别的项目（例如 `wecom-todo.service` 占用 8010 端口）。临时起后端做演练时，
**先用 `ss -ltn "sport = :<端口>"` 确认端口空闲**，清理时按 PID `kill`，
不要用 `pkill -f "port 80xx"` 这种模糊匹配——它会连别的项目的进程一起杀掉。

## 手动备份一次

```bash
ssh tengxunOneYear 'bash /home/ubuntu/Github/ScholarScout/deploy/backup.sh'
```

## 把备份拉到本机（异地副本）

服务器上的备份和数据库在同一块磁盘，能防误删和数据损坏，防不了整台机器坏掉。
想要异地副本，在本机执行：

```bash
mkdir -p ~/Backups/scholarscout
rsync -av tengxunOneYear:backups/scholarscout/daily/ ~/Backups/scholarscout/
```

## 恢复步骤

**先演练再上手**：不要直接覆盖线上库，先恢复到临时文件确认数据正常。

```bash
# 1. 挑一份备份
ssh tengxunOneYear 'ls -lt ~/backups/scholarscout/daily/ | head'

# 2. 解压到临时文件并检查（不影响线上）
ssh tengxunOneYear '
  gunzip -c ~/backups/scholarscout/daily/scholarscout-YYYYMMDD-HHMM.db.gz > /tmp/restore-check.db
  sqlite3 /tmp/restore-check.db "PRAGMA integrity_check;"
  sqlite3 /tmp/restore-check.db "select count(*) from users; select count(*) from subscriptions; select count(*) from saved_papers;"
'

# 3. 确认无误后再覆盖线上库：停服务 → 备份现有库 → 覆盖 → 启服务
ssh tengxunOneYear '
  sudo systemctl stop scholarscout-backend
  cd /home/ubuntu/Github/ScholarScout/backend
  cp scholarscout.db scholarscout.db.before-restore-$(date +%Y%m%d-%H%M)
  cp /tmp/restore-check.db scholarscout.db
  sudo systemctl start scholarscout-backend
  sleep 8 && systemctl is-active scholarscout-backend
'

# 4. 验证：接口能返回、数据对得上
ssh tengxunOneYear 'curl -s http://127.0.0.1/api/health | head -c 200'
```

恢复后注意：

- 后端启动时会自动跑 Alembic 迁移。如果恢复的是旧备份，会自动升级到当前版本。
- 登录凭证不受影响（JWT 用 `JWT_SECRET` 签发），但恢复后 `token_version` 回到备份时的值，
  备份之后改过密码的用户，其旧凭证可能重新生效，必要时让相关用户再改一次密码。
- 向量库（chromadb）没有备份，它由搜索结果重建，丢失不影响核心数据。

## 没有备份的东西

- 向量检索索引：可重建。
- nginx 配置、systemd unit：在仓库 `deploy/` 里。
- 服务器上 `backend/.env`：脚本会复制到 `~/backups/scholarscout/env.backup`（权限 600），
  不随备份下载到本机，避免 Key 扩散。
