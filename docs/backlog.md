# ScholarScout 待解决问题

---

## ✅ 已完成

- **VALIDATED_LIMIT 15→50**
- **对话上下文**：classify_intent / parse_query 携带最近 8 条历史
- **搜索召回修复**：自实现 arXiv 原生 API（OR 关键词 + 日期过滤），修复 OpenAlex doi null 崩溃
- **批量下载 ZIP**：并发拉取 PDF 打包，失败明细写入 `failed_downloads.csv`
- **分页展示**：每页 20 篇，跨页选择持久
- **导出 CSV**：全部结果一键导出
- **前端参数配置**：右侧常驻参数栏可调整每源抓取数 / 验证后展示数（精度 1 篇），持久化到 localStorage，修改后出现"重新搜索"按钮
- **关键词可视化确认与编辑**：AI 提取关键词后在左侧展示可编辑 Tag，用户确认后再搜索；结果页右侧持续显示关键词，支持增删及重新搜索（Issue B）
- **移除 paper-search-mcp**：改为直接依赖 feedparser，自实现所有搜索源
- **搜索源扩展至 8 个**：
  - 无需 Key：arXiv、Semantic Scholar、OpenAlex、PubMed、Europe PMC、INSPIRE-HEP
  - 需免费 Key：CORE、NASA ADS
- **API Key 安全管理**：通过环境变量 + python-dotenv 加载，不写入代码
- **本地开发**：`backend/.env` 文件配置 Key，`.gitignore` 已排除
- **服务器部署**：`/etc/scholarscout/env` 文件配置 Key，systemd EnvironmentFile 读取
- **README 完整更新**：本地运行指南、服务器部署、搜索源说明、Key 配置说明

---

## 🔲 待做事项

### Issue E：Semantic Scholar API Key 🟡

申请已提交，Key 到了后：
- `backend/config.py` 加 `SEMANTIC_SCHOLAR_API_KEY = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")`
- `backend/.env.example` 加对应注释
- `search_service.py` 的 `_search_semantic_scholar` 加请求头 `x-api-key`
- 申请地址：https://www.semanticscholar.org/product/api

---

### Issue F：CI/CD + 自动化测试 🟢

**CI 是什么**：每次向 GitHub 推送代码，自动触发一套检查（跑测试、类型检查），如果检查失败会在 PR 上标红提示，防止把问题代码合入。

**ScholarScout 的 CI 应该跑什么**：
- 后端：`uv run pytest tests/ -q`（已有 11 个测试）
- 前端：`npm run build`（TypeScript 编译 + Vite 构建，等价于类型检查）

**实现方式**：在仓库根目录新建 `.github/workflows/ci.yml`，内容大约：
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

**待办**：
- [ ] 检查 `backend/tests/` 里现有 11 个测试是否仍然通过
- [ ] 新建 `.github/workflows/ci.yml`
- [ ] 推送后在 GitHub Actions 页面确认绿色通过

---

### Issue G：结构化日志 🟢

现在用 `print(f"xxx error: {e}")` 排查问题不方便，生产环境看不到日志级别。

**改法**：
- `backend/` 加 `logger = logging.getLogger(__name__)`
- 所有 `print(f"xxx search error")` 改为 `logger.warning(...)`
- `main.py` 配置 logging 格式（含时间戳、级别）

---

### Issue H：健康检查接口 🟢

加 `GET /api/health`，返回服务状态和各数据源 Key 配置情况：

```json
{
  "status": "ok",
  "sources": {
    "arxiv": true,
    "core": false,
    "nasa_ads": true
  }
}
```

运维和自我检查都方便。

---

### Issue I：Docker 支持 🟢

加 `Dockerfile` + `docker-compose.yml`，让本地部署不依赖 uv 和 Node 版本，一条命令启动：
```bash
docker compose up
```

---

## 解决建议顺序

1. **Issue E**（Semantic Scholar Key）— Key 到了直接加，10 分钟
2. **Issue F**（CI）— 工程质量保障，改动不大
3. **Issue B**（关键词编辑）— 交互改动最复杂
4. **Issue G/H**（日志 + 健康检查）— 小改动，生产质量提升
5. **Issue I**（Docker）— 有需求再做
