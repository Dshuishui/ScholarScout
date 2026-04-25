# ScholarScout 待解决问题

---

## Issue 1：搜索结果太少 🔴 优先

**现象**：搜索"2026年RAFT相关论文"只返回 1 篇。

**已知原因**：
- `VALIDATED_LIMIT = 15` 限制了展示数量（用户要求改为 50）
- 更深层：年份过滤在客户端做，先取 50 篇再过滤，2026 年的论文本身就少，过滤完可能只剩 1-2 篇
- LLM 验证再过滤一遍，进一步减少

**待办**：
- [ ] `VALIDATED_LIMIT` 15 → 50
- [ ] 调查年份过滤策略，改为直接在 API query 里传时间范围（而非客户端过滤）

---

## Issue 2：意图切换上下文问题 🟡 待核查

**现象**：截图显示 chat 模式能正常响应"只有一个论文吗"和"您能再找啊"。

**待确认**：
1. **上下文是否传入 DeepSeek**：当前 `classify_intent` 和 `chat` 回复都只发单条消息给 DeepSeek，没有携带对话历史。用户说"您能再找啊"，DeepSeek 不知道之前找的是什么。
2. **搜索意图误判风险**："您能再找啊"被判断为 chat 而非重新搜索，这可能是合理的（用户在追问），但需要确认意图分类的边界够不够准确。

**待办**：
- [ ] 在 `classify_intent` 和 chat 回复时，带入最近 N 条对话历史
- [ ] 测试更多边界用例，确保"帮我再搜一次"走搜索而不是 chat

---

## Issue 3：域名配置 🟡

**情况**：IP `118.25.192.117` 已绑定域名 `zhenbucuo.online`。

**待办**：
- [ ] 修改 `deploy/nginx.conf` 的 `server_name`，从 IP 改为域名
- [ ] 同步更新 `frontend/` 里硬编码 IP 的地方（如果有）
- [ ] 推送后服务器执行 `deploy/deploy.sh`

---

## Issue 4：HTTPS 配置 🟡

**情况**：目前只有 HTTP，域名未开启 HTTPS。

**方案**：使用 Let's Encrypt + Certbot（免费证书，自动续期）。

**待办**：
- [ ] 服务器安装 certbot
- [ ] 申请 `zhenbucuo.online` 的证书
- [ ] Nginx 配置 443 端口 + 自动 HTTP→HTTPS 跳转
- [ ] 验证证书自动续期

---

## 解决顺序建议

1. Issue 1（搜索结果）— 代码改动，立刻可做
2. Issue 3（域名）— nginx 一行改动，最简单
3. Issue 4（HTTPS）— 依赖 Issue 3 先完成（证书要绑域名）
4. Issue 2（上下文）— 逻辑改动稍复杂，放最后
