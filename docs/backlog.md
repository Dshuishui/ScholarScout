# ScholarScout 待解决问题

---

## ✅ 已完成

- **VALIDATED_LIMIT 扩展**：每源抓取上限 200 篇，展示上限 500 篇
- **对话上下文**：classify_intent / parse_query 携带最近 8 条历史
- **搜索召回修复**：自实现 arXiv 原生 API（OR 关键词 + 日期过滤），修复 OpenAlex doi null 崩溃
- **批量下载 ZIP**：并发拉取 PDF 打包，失败明细写入 `failed_downloads.csv`
- **分页展示**：每页 20 篇，跨页选择持久
- **导出 CSV**：全部结果一键导出
- **前端参数配置**：折叠式参数面板显示当前值（每源抓取 / 展示上限），修改后出现"重新搜索"按钮
- **关键词可视化确认与编辑**：AI 提取关键词后在左侧展示可编辑 Tag，用户确认后再搜索；结果页右侧持续显示关键词，支持增删及重新搜索
- **移除 paper-search-mcp**：改为直接依赖 feedparser，自实现所有搜索源
- **搜索源扩展至 10 个**：
  - 无需 Key：arXiv、Semantic Scholar、OpenAlex、PubMed、Europe PMC、INSPIRE-HEP、CrossRef
  - 需免费 Key：CORE、NASA ADS、Google Scholar（SerpAPI）
- **Google Scholar 双保险**：scholarly + 服务器代理优先，失败自动回退 SerpAPI
- **Unpaywall PDF 补全**：搜索后自动为有 DOI 但缺 PDF 的论文查找开放获取版本
- **智能去重合并**：DOI 精确匹配 + 标题规范化（Unicode/标点）双重判断，重复时合并最优字段
- **多来源链接展示**：同一论文被多个源命中时，卡片底部显示所有来源按钮
- **排序功能**：相关性优先 / 引用数最高 / 最新发表 / 最早发表
- **API Key 安全管理**：通过环境变量 + python-dotenv 加载
- **Issue E**（Semantic Scholar Key）：申请被拒，跳过；用户可自行申请后填入环境变量
- **Issue F**（CI/CD）：GitHub Actions 自动跑测试，21 个单元测试覆盖核心逻辑
- **Issue G**（结构化日志）：所有 print 替换为 logging.warning，main.py 配置格式含时间戳
- **Issue H**（健康检查）：`GET /api/health` 返回服务状态及各数据源 Key 配置情况
- **Issue J**（venue 标注）：从 10 个源提取期刊/会议名，显示在作者行右侧
- **Issue K**（AI 筛选分开展示）：Tab 切换"AI 筛选后 / 全部结果"，被过滤论文带橙色标记
- **搜索历史**：localStorage 持久化最近 10 条搜索，左侧一键复用，跳过解析阶段
- **UI 全面美化**：
  - 论文卡片：左侧彩色竖条按来源区分、来源圆角彩色徽章、作者/venue 同行左右布局
  - 空状态：书本图标 + 示例查询引导
  - 加载状态：旋转圆环 + 实时进度文字
  - 分页：圆形按钮、浮起效果
  - Header：蓝色 logo 方块

---

## 🔲 待做事项

### Issue I：Docker 支持 🟢（暂缓）

加 `Dockerfile` + `docker-compose.yml`，一条命令本地启动：
```bash
docker compose up
```

---

## 解决建议顺序

1. **Issue I**（Docker）— 有需求再做
