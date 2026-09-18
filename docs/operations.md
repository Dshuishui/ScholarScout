# 运维手册：你会收到哪些邮件，分别该怎么办

网站平时不需要维护。出问题或有值得知道的事情时，会给 `ADMIN_EMAIL`（`backend/.env` 里配置）发邮件。
**同一个问题每天最多一封**，不会刷屏。

## 一、告警邮件（标题以「[ScholarScout 告警]」开头）

| 邮件说的事 | 意味着什么 | 怎么处理 |
|---|---|---|
| **网站无法访问** | 服务器上的自检连续 2 次打不开网站或后端（每 5 分钟检查一次） | `sudo systemctl status scholarscout-backend`，必要时 `sudo systemctl restart scholarscout-backend`；nginx 也可以 `sudo systemctl restart nginx`。恢复后会再收到一封「已恢复」 |
| **DeepSeek 余额不足** | 余额低于 `DEEPSEEK_BALANCE_ALERT_CNY`（默认 ¥20） | 去 platform.deepseek.com 充值。余额为 0 会让搜索筛选、免费对话、订阅解读同时失效 |
| **N 个订阅超过 3 天没有推送** | 推送链路坏了，或队列空了补不上新论文 | 看 `sudo journalctl -u scholarscout-backend --since "1 day ago" | grep -i subscription` |
| **某数据源开始返回 0 篇 / 所有数据源都没有结果** | 外部学术接口故障、被限流，或服务器网络有问题 | 先看 http://118.25.192.117/api/health 里的 `source_activity`；全部为 0 多半是服务器网络或代理问题 |
| **数据库备份超过 36 小时没有成功** | 定时备份挂了 | `sudo journalctl -u cron | tail`、手动跑 `bash deploy/backup.sh` 看报错，详见 [backup.md](backup.md) |
| **磁盘已用 90% 以上** | 日志和备份会继续增长 | 清理 `/var/log`、删旧备份；`du -sh /home/ubuntu/backups/*` |
| **最近一小时错误日志突增** | 某个功能坏了但进程没崩 | `sudo journalctl -u scholarscout-backend -p err -n 100` |
| **订阅推送邮件发送失败** | SMTP 授权码失效，或对方邮箱拒收 | 检查 QQ 邮箱授权码是否过期；对方拒收的话在订阅管理里停用该订阅 |
| **免费体验用到每日上限 80%** | 来的人变多了（好事），也意味着花费在涨 | 看 DeepSeek 余额，必要时调整 `.env` 里的 `ANON_TRIAL_DAILY_CAP`、`CHAT_DAILY_CAP` |

## 二、好消息（只发一次）

| 邮件 | 含义 |
|---|---|
| **有人用了网站** | 第一次有人完成搜索时通知你一次。之后不再重复 |

## 三、周报（每周一早 9 点，只在这一周有人用时才发）

包含：打开网站次数、完成搜索次数、论文对话次数、新注册、新留言、收藏、订阅推送数量，
以及免费额度消耗、DeepSeek 余额。没有任何活动的那一周不会发信。

## 四、留言通知

有人在留言板发言时会收到通知；有人回复别人的留言时，被回复的用户也会收到邮件。

## 常用命令

```bash
ssh tengxunOneYear                                        # 登录服务器
sudo systemctl status  scholarscout-backend               # 后端状态
sudo systemctl restart scholarscout-backend               # 重启后端
sudo journalctl -u scholarscout-backend -n 100            # 最近日志
sudo journalctl -u scholarscout-backend -p err -n 100     # 只看错误
curl -s http://127.0.0.1/api/health | head -c 400         # 数据源健康状况
bash /home/ubuntu/Github/ScholarScout/deploy/backup.sh    # 手动备份
python3 /home/ubuntu/Github/ScholarScout/deploy/healthcheck.py   # 手动自检
crontab -l                                                # 查看定时任务
```

## 定时任务一览

| 时间（北京） | 做什么 |
|---|---|
| 每 5 分钟 | 网站自检，连续失败 2 次发告警邮件（cron） |
| 每小时 | 健康检查：数据源、订阅、备份、磁盘、错误数、余额（后端内部） |
| 每天 03:30 | 数据库备份（cron） |
| 每天 07:00 | 为当天要推送的论文生成解读 |
| 每天 08:00 | 发送订阅推送邮件 |
| 每天 03:30 UTC | 清理 90 天前的免费额度记录 |
| 每周一 09:00 | 周报（这一周有人用才发） |

## 外部监控（建议补上）

服务器自己宕机或断网时，上面的自检也发不出邮件。补一个免费的外部监控：

1. 打开 https://uptimerobot.com 注册（免费版够用）；
2. Add New Monitor → Monitor Type 选 **HTTP(s)**；
3. URL 填 `http://118.25.192.117/api/health`，Monitoring Interval 选 5 分钟；
4. Alert Contacts 选你的邮箱；
5. 保存。之后网站连不上时它会直接发邮件给你。
