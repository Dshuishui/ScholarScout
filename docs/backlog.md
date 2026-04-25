# ScholarScout 待解决问题

---

## ✅ 已解决

- **VALIDATED_LIMIT 15→50**：LLM 过滤后最多展示数量提升
- **对话上下文**：classify_intent 和 parse_query 携带最近 8 条历史
- **域名配置**：暂缓（ICP 备案问题），继续用 IP 访问
- **HTTPS**：暂缓（依赖备案），已验证 acme.sh + DNS-01 方案可行
- **搜索召回修复**：arXiv 改为 OR 关键词，修复 OpenAlex doi null 崩溃，修复 Semantic Scholar 客户端日期过滤
- **分页展示**：每页 20 篇，跨页选择持久
- **导出 CSV**：全部结果一键导出
- **批量下载 ZIP**：并发拉取 PDF 打包，右下角进度浮层

---

## Issue A：自实现 arXiv 搜索，替换 paper-search-mcp 🔴

**背景分析**：

paper-search-mcp 的 ArxivSearcher 本质很简单：
- 调 `http://export.arxiv.org/api/query` Atom API
- 用 `feedparser` 解析 XML
- 已经使用 `sortBy=submittedDate&sortOrder=descending`（最新优先）
- 无法传日期范围参数（我们加 `submittedDate:[...]` 时导致库解析崩溃）

**为什么自己实现更好**：
1. 完整控制日期范围查询（`submittedDate:[20230101 TO *]`）
2. 可按需切换 sortBy（相关性 vs 时间）
3. 去掉外部依赖，减少版本冲突风险
4. 可加 `ti:`（标题）和 `abs:`（摘要）字段权重

**实现方案**：
- 用 `httpx` 调 arXiv Atom API，用 `feedparser` 解析（和 paper-search-mcp 一样，只是自己控制参数）
- 无日期需求：`sortBy=relevance`
- 有日期需求：查询里加 `AND submittedDate:[YYYYMMDD TO *]`，`sortBy=submittedDate`
- 修改 `backend/services/search_service.py`，`_search_arxiv` 不再依赖 ArxivSearcher

**待办**：
- [ ] 在 `search_service.py` 中实现 `_search_arxiv_native()` 替换 ArxivSearcher
- [ ] 测试有/无日期的查询是否正常
- [ ] 从 `backend/pyproject.toml` 移除 paper-search-mcp 依赖

---

## Issue B：关键词可视化确认与编辑 🟡

**背景**：LLM 提取关键词有时偏差（如"RAFT"被提成分布式系统术语），用户无法干预。

**方案**：在正式搜索前，把提取的关键词推送给前端，用户可以删除/增加后再搜索。

**交互设计**：
1. `parse_query` 提取关键词后，先通过 SSE 推送 `keywords` 事件
2. 前端在 AI 消息气泡里渲染关键词 Tag 列表（每个 Tag 有 ✕）
3. 气泡下方有小输入框可追加关键词
4. 用户点"开始搜索"，前端把最终关键词集合发回后端继续执行搜索
5. 整个交互在聊天流中完成，不需要弹窗

**涉及改动**：
- 后端：新增 `keywords` SSE 事件类型，parse_query 后 yield 它，等待前端确认请求
- 前端：新增 `keywords` 事件处理，渲染可编辑 Tag 组件，点击确认后发第二次请求
- `types/index.ts`：新增 `SearchKeywordsEvent` 类型
- `SearchRequest`：支持直接传入 keywords 跳过 parse_query

**待办**：
- [ ] 后端设计两阶段搜索接口（第一阶段提取关键词，第二阶段执行搜索）
- [ ] 前端实现 Tag 可编辑组件
- [ ] 测试各种关键词边界用例

---

## Issue C：新增论文源（PubMed 优先）🟡

**当前覆盖**：arXiv（CS/物理/数学）、Semantic Scholar（综合）、OpenAlex（综合）

**推荐新增**：

| 源 | 优先级 | 理由 |
|---|---|---|
| **PubMed** | 🔴 高 | 医学/生物权威，paper-search-mcp 自带 PubMedSearcher，接入成本极低 |
| **CORE** | 🟡 中 | 1.7 亿篇开放获取，覆盖最广，有免费 API（需注册 key） |

**PubMed 接入方案**（成本最低）：
- paper-search-mcp 里已有 `PubMedSearcher`，直接 import
- 在 `search_service.py` 的 `search_all_sources` 里增加第四路并发
- 查询词用同样的英文关键词
- 注意：PubMed 返回的日期格式可能不同，需适配

**CORE 接入方案**：
- 注册 CORE API Key（免费）：https://core.ac.uk/services/api
- REST API：`https://api.core.ac.uk/v3/search/works`
- 支持全文搜索、日期过滤、开放获取过滤

**待办**：
- [ ] 接入 PubMed（复用 paper-search-mcp 的 PubMedSearcher）
- [ ] 注册 CORE API Key，实现 `_search_core()`
- [ ] 在 `config.py` 的 `SEARCH_SOURCES` 列表里加入新源
- [ ] 测试医学/生物类查询的结果质量

---

## Issue D：批量下载失败明细处理 🟡

**现状**：下载失败（付费墙/链接失效）时静默跳过，用户不知道哪些失败了。

**方案**：在 ZIP 包内附 `failed_downloads.csv`，记录失败论文信息。

**CSV 内容**：标题、作者、年份、PDF 链接、失败原因

**完成提示**改为：
> "15 篇下载成功，3 篇失败（详见压缩包内 `failed_downloads.csv`）"

**涉及改动**：
- `frontend/src/components/ResultsPanel.tsx`：`downloadSelected` 函数记录失败列表
- 生成失败 CSV 并通过 `zip.file('failed_downloads.csv', content)` 加入压缩包
- 完成提示文案更新

**待办**：
- [ ] `downloadSelected` 记录 `{title, authors, year, url, reason}` 失败列表
- [ ] 生成 CSV 内容（UTF-8 BOM），附入 ZIP
- [ ] 更新进度浮层的完成文案

---

## Issue E：Semantic Scholar API Key 🟡

**现状**：无 API Key，使用免费匿名额度（每 5 分钟 100 次），多用户并发时频繁 429。

**方案**：申请免费学术 API Key。

- 申请地址：https://www.semanticscholar.org/product/api
- 免费，审核约 1-3 天
- 加入后请求头加 `x-api-key: YOUR_KEY`，限速从 100/5min 提升到 1 req/s

**待办**：
- [ ] 申请 Semantic Scholar API Key
- [ ] 在 `config.py` 加 `SEMANTIC_SCHOLAR_API_KEY` 配置
- [ ] `search_service.py` 的 `_search_semantic_scholar` 加入请求头

---

## 解决顺序建议

1. **Issue E**（Semantic Scholar Key）— 申请即可，10 分钟，立竿见影提升稳定性
2. **Issue D**（下载失败明细）— 纯前端改动，半小时内完成
3. **Issue A**（自实现 arXiv）— 解决年份召回根本问题
4. **Issue C**（新增 PubMed）— 扩大覆盖面
5. **Issue B**（关键词编辑）— 交互改动最复杂，放最后
