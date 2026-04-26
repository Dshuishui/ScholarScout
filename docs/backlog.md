# ScholarScout 待解决问题

---

## ✅ 已完成

- **VALIDATED_LIMIT 扩展**：每源抓取上限 200 篇，展示上限 500 篇
- **对话上下文**：classify_intent / parse_query 携带最近 8 条历史
- **搜索召回修复**：自实现 arXiv 原生 API（OR 关键词 + 日期过滤），修复 OpenAlex doi null 崩溃
- **批量下载 ZIP**：并发拉取 PDF 打包，失败明细写入 `failed_downloads.csv`
- **分页展示**：每页 20 篇，跨页选择持久
- **导出 CSV**：全部结果一键导出
- **前端参数配置**：右侧常驻参数栏可调整每源抓取数 / 验证后展示数，持久化 localStorage，修改后出现"重新搜索"按钮
- **关键词可视化确认与编辑**：AI 提取关键词后在左侧展示可编辑 Tag，用户确认后再搜索；结果页右侧持续显示关键词，支持增删及重新搜索（Issue B）
- **移除 paper-search-mcp**：改为直接依赖 feedparser，自实现所有搜索源
- **搜索源扩展至 10 个**：
  - 无需 Key：arXiv、Semantic Scholar、OpenAlex、PubMed、Europe PMC、INSPIRE-HEP、CrossRef
  - 需免费 Key：CORE、NASA ADS、Google Scholar（SerpAPI）
- **Google Scholar 双保险**：scholarly + 服务器代理优先，失败自动回退 SerpAPI
- **Unpaywall PDF 补全**：搜索后自动为有 DOI 但缺 PDF 的论文查找开放获取版本
- **智能去重合并**：DOI 精确匹配 + 标题规范化（Unicode/标点）双重判断，重复时合并最优字段（PDF、摘要取更长、引用数取最大）
- **多来源链接展示**：同一论文被多个源命中时，卡片底部显示所有来源按钮（[arXiv ↗] [Semantic Scholar ↗] …）
- **排序功能**：相关性优先 / 引用数最高 / 最新发表 / 最早发表，前端本地排序
- **API Key 安全管理**：通过环境变量 + python-dotenv 加载，不写入代码
- **本地开发**：`backend/.env` 文件配置 Key，`.gitignore` 已排除
- **服务器部署**：`/etc/scholarscout/env` 文件配置 Key，systemd EnvironmentFile 读取
- **仓库清理**：移除 __pycache__ 追踪，补全 .gitignore（.DS_Store 等）
- **README 完整更新**：功能列表、搜索源说明、Key 配置说明全部同步

---

## 🔲 待做事项

### Issue E：Semantic Scholar API Key 🟡

申请已提交，Key 到了后：
- `backend/config.py` 加 `SEMANTIC_SCHOLAR_API_KEY = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")`
- `backend/.env.example` 加对应注释
- `search_service.py` 的 `_search_semantic_scholar` 加请求头 `x-api-key`
- 申请地址：https://www.semanticscholar.org/product/api

---

### Issue J：期刊 / 会议标注 🟡

为论文卡片加 venue 标签（如 `NeurIPS 2024`、`Nature`）。

**涉及改动**：
- `backend/models.py`：Paper 加 `venue: Optional[str] = None`
- `backend/services/search_service.py`：各源提取 venue
  - Semantic Scholar：`pub.get("venue")`
  - CrossRef：`item.get("container-title", [None])[0]`
  - OpenAlex：`item.get("host_venue", {}).get("display_name")`
  - PubMed：XML 里的 `<Journal><Title>`
- `frontend/src/types/index.ts`：Paper 加 `venue?: string`
- `frontend/src/components/PaperCard.tsx`：作者行旁边显示灰色小标签

---

### Issue K：AI 筛选前后分开展示 🟡

AI 过滤后被认为不相关的论文折叠显示，用户可展开查看，防止误判导致漏看。

**涉及改动**：
- `backend/services/llm_service.py`：`validate_papers()` 同时返回 `(accepted, rejected)`
- `backend/routers/search.py`：SSE `done` 事件加 `rejected_papers` 字段
- `frontend/src/types/index.ts`：`SearchDoneEvent` 加 `rejected_papers`
- `frontend/src/hooks/useSearch.ts`：存储 `rejectedPapers` 状态
- `frontend/src/components/ResultsPanel.tsx`：主列表下方加折叠区域 "AI 认为不相关（N 篇）▶"

---

### Issue F：CI/CD + 自动化测试 🟢

每次推送自动跑测试。新建 `.github/workflows/ci.yml`：
```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd backend && uv sync && uv run pytest tests/ -q
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd frontend && npm install && npm run build
```

---

### Issue G：结构化日志 🟢

把所有 `print(f"xxx error: {e}")` 改为 `logging.warning(...)`，`main.py` 配置格式含时间戳和级别。

---

### Issue H：健康检查接口 🟢

加 `GET /api/health`，返回服务状态和各数据源 Key 配置情况：
```json
{"status": "ok", "sources": {"arxiv": true, "core": false, "nasa_ads": true, "serpapi": true}}
```

---

### Issue I：Docker 支持 🟢

加 `Dockerfile` + `docker-compose.yml`，一条命令本地启动：
```bash
docker compose up
```

---

## 解决建议顺序

1. **Issue E**（Semantic Scholar Key）— Key 到了直接加，10 分钟
2. **Issue J**（venue 标注）— 改动中等，用户体验提升明显
3. **Issue K**（AI 筛选分开展示）— 改动较大，防误判很有价值
4. **Issue F**（CI）— 工程质量保障
5. **Issue G/H**（日志 + 健康检查）— 小改动，运维质量提升
6. **Issue I**（Docker）— 有需求再做
