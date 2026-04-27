# ScholarScout 待解决问题

---

## ✅ 已完成

- **VALIDATED_LIMIT 扩展**：每源抓取上限 200 篇，展示上限 500 篇
- **对话上下文**：classify_intent / parse_query 携带最近 8 条历史
- **搜索召回修复**：自实现 arXiv 原生 API（OR 关键词 + 日期过滤）
- **批量下载 ZIP**：并发拉取 PDF 打包，失败明细写入 `failed_downloads.csv`
- **分页展示**：每页 20 篇，跨页选择持久
- **导出为 CSV**：全部结果一键导出
- **搜索源扩展至 10 个**：arXiv / S2 / OpenAlex / PubMed / Europe PMC / INSPIRE-HEP / CrossRef / CORE / NASA ADS / Google Scholar
- **Google Scholar 双保险**：scholarly + 代理优先，失败自动回退 SerpAPI
- **Unpaywall PDF 补全**：搜索后自动为有 DOI 但缺 PDF 的论文查找开放获取版本
- **智能去重合并**：DOI 精确匹配 + 标题规范化双重判断，合并最优字段
- **多来源链接展示**：同一论文被多个源命中时，卡片显示所有来源按钮
- **排序功能**：相关性 / 引用数 / 最新 / 最早
- **API Key 安全管理**：环境变量 + python-dotenv，.gitignore 已排除
- **Issue E**（Semantic Scholar Key）：申请被拒，用户可自行申请后填入环境变量
- **Issue F**（CI/CD）：GitHub Actions，21 个单元测试，backend pytest + frontend tsc
- **Issue G**（结构化日志）：所有 print 替换为 logging.warning，main.py 配置格式
- **Issue H**（健康检查）：`GET /api/health` 返回服务状态及各数据源 Key 情况
- **Issue J**（venue 标注）：从 10 源提取期刊/会议名，显示在作者行右侧
- **Issue K**（AI 筛选分开展示）：Tab 切换"AI 筛选后 / 全部结果"，被过滤论文带橙色标记
- **搜索历史**：localStorage 持久化最近 10 条，时钟图标，一键复用（跳过解析阶段）
- **PDF 深度查找（两级回退）**：
  - 第一级：Kimi 联网一次调用批量查找所有无 PDF 论文（需服务器配置 KIMI_API_KEY）
  - 第二级：规则拼接 8 个平台跳转链接（arXiv预印本/Sci-Hub/ResearchGate/S2/Google Scholar/CORE/BASE/Open Access Button）
  - 搜索结果立刻显示，PDF 查找在后台异步进行，不阻塞用户
- **搜索源多选**：前端顶部配置区始终展开，10 个数据源带颜色编码的多选框，全选/清空
- **搜索参数直接输入**：数字输入框替代滑块（blur 自动 clamp），配置区始终可见
- **一键复制标题**：论文卡片 hover 显示复制图标，成功变绿色对勾 2 秒
- **UI 全面美化**：
  - 论文卡片：左侧彩色竖条（10 色）、来源圆角彩色徽章、作者/venue 同行左右布局
  - 空状态：书本图标 + 描述 + 示例查询卡片
  - 加载状态：旋转圆环 + 实时进度文字
  - 分页：圆形按钮浮起效果
  - Header：蓝色 logo 方块
- **README 截图**：Playwright 自动截图 5 张，含 mock 数据搜索结果页
- **仓库清理**：移除 __pycache__ 追踪，补全 .gitignore，根目录 node_modules 已排除

---

## 🔲 待做事项

### Feature 4：每篇论文独立对话抽屉 🔴（高价值）

点击论文卡片右侧图标，右侧滑出抽屉式小窗，内置独立 DeepSeek 对话。

**设计方案**：
- 抽屉绑定当前点击的论文，切换论文时切换上下文（保留各论文历史）
- 系统 prompt 自动注入：论文标题 + 摘要 + venue + 来源
- 直接用用户的 DeepSeek Key 调用，不经过服务器，不污染主对话
- 可扩展：支持"固定"功能让抽屉变成浮窗（第二阶段）

**涉及改动**：
- `frontend/src/components/PaperCard.tsx`：加"分析"图标按钮
- `frontend/src/components/PaperChatDrawer.tsx`：新建，右侧抽屉组件
- `frontend/src/components/MainLayout.tsx`：管理抽屉开关和当前选中论文
- `frontend/src/hooks/usePaperChat.ts`：新建，管理每篇论文的独立对话历史

---

### KIMI_API_KEY 配置 🟡

在服务器 `/etc/scholarscout/env` 加：
```
KIMI_API_KEY=你的moonshot-key
```
然后 `sudo systemctl restart scholarscout-backend` 生效。
否则 PDF 深度查找只有第二级（平台跳转链接），无 Kimi 联网搜索。

---

### Issue I：Docker 支持 🟢（暂缓）

加 `Dockerfile` + `docker-compose.yml`，一条命令本地启动。

---

## 解决建议顺序

1. **KIMI_API_KEY 配置**：5 分钟，立刻启用 PDF 深度查找
2. **Feature 4**（论文对话抽屉）：最高价值的未实现功能
3. **Issue I**（Docker）：有需求再做
