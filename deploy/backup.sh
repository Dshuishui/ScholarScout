#!/bin/bash
# ScholarScout 数据库备份
#
# 用法：bash deploy/backup.sh          （由 cron 每天调用）
#
# - 用 sqlite3 的 .backup 做一致性快照：服务正在写库时直接 cp 可能拷到写了一半的状态
# - 备份完先校验（integrity_check + 关键表能不能读），校验不过不算成功、不写状态文件
# - 一并备份 backend/.env（里面是各种 API Key，权限 600）
# - 保留最近 DAILY_KEEP 天的每日备份 + WEEKLY_KEEP 份每周备份（周一那份）
# - 成功后更新状态文件，后端每小时的健康检查会看这个时间，超时给站长发告警邮件

set -u

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$REPO_DIR/backend/scholarscout.db"
ENV_FILE="$REPO_DIR/backend/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/scholarscout}"
STATUS_FILE="${BACKUP_STATUS_FILE:-$BACKUP_DIR/last_success}"
LOG_FILE="$BACKUP_DIR/backup.log"
DAILY_KEEP=14
WEEKLY_KEEP=8

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
chmod 700 "$BACKUP_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }
fail() { log "FAILED: $*"; exit 1; }

[ -f "$DB" ] || fail "找不到数据库 $DB"

STAMP="$(date '+%Y%m%d-%H%M')"
TMP="$BACKUP_DIR/.tmp-$STAMP.db"
OUT="$BACKUP_DIR/daily/scholarscout-$STAMP.db.gz"

# 1) 一致性快照
sqlite3 "$DB" ".backup '$TMP'" || fail "sqlite3 .backup 执行失败"

# 2) 校验：结构完整 + 关键表能读出来（只写日志，不打印数据）
CHECK="$(sqlite3 "$TMP" 'PRAGMA integrity_check;' 2>&1)"
[ "$CHECK" = "ok" ] || { rm -f "$TMP"; fail "完整性检查未通过：$CHECK"; }
USERS="$(sqlite3 "$TMP" 'select count(*) from users;' 2>&1)" || { rm -f "$TMP"; fail "读 users 表失败：$USERS"; }
SUBS="$(sqlite3 "$TMP" 'select count(*) from subscriptions;' 2>&1)" || { rm -f "$TMP"; fail "读 subscriptions 表失败：$SUBS"; }
case "$USERS" in ''|*[!0-9]*) rm -f "$TMP"; fail "users 计数异常：$USERS";; esac

# 3) 压缩归档
gzip -c "$TMP" > "$OUT" || { rm -f "$TMP"; fail "压缩失败"; }
rm -f "$TMP"
chmod 600 "$OUT"

# 周一的那份额外留一份周备份
if [ "$(date '+%u')" = "1" ]; then
    cp -p "$OUT" "$BACKUP_DIR/weekly/" || log "警告：周备份复制失败"
fi

# 4) 配置文件（含 API Key，仅本人可读；只留最新一份）
if [ -f "$ENV_FILE" ]; then
    cp -p "$ENV_FILE" "$BACKUP_DIR/env.backup" && chmod 600 "$BACKUP_DIR/env.backup"
fi

# 5) 清理过期备份
ls -1t "$BACKUP_DIR/daily/"*.db.gz 2>/dev/null | tail -n +$((DAILY_KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR/weekly/"*.db.gz 2>/dev/null | tail -n +$((WEEKLY_KEEP + 1)) | xargs -r rm -f

# 6) 记录成功时间，供健康检查读取
date '+%s' > "$STATUS_FILE"
log "OK $(basename "$OUT") $(du -h "$OUT" | cut -f1) users=$USERS subscriptions=$SUBS daily=$(ls -1 "$BACKUP_DIR/daily" | wc -l) weekly=$(ls -1 "$BACKUP_DIR/weekly" | wc -l)"
