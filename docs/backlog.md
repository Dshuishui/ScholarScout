# ScholarScout 待解决问题

---

## ✅ 已完成

### 核心功能
- **VALIDATED_LIMIT 扩展**：每源抓取上限 200 篇，展示上限 500 篇
- **对话上下文**：classify_intent / parse_query 携带最近 8 条历史
- **搜索召回修复**：自实现 arXiv 原生 API（OR 关键词 + 日期过滤）
- **批量下载 ZIP**：并发拉取 PDF 打包，失败明细写入 `failed_downloads.csv`
- **分页展示**：每页 20 篇，跨页选择持久
- **导出为 CSV**：全部结果一键导出
- **搜索源扩展至 10 个**：arXiv / S2 / OpenAlex / PubMed / Europe PMC / INSPIRE-HEP / CrossRef / CORE / NASA ADS / Google Scholar
- **Google Scholar 双保险**：scholarly + 代理优先，失败自动回退 SerpAPI
- **Unpaywall PDF 补全**：搜索后自动为有 DOI 但缺 PDF 的论文查找开放获取版本
- **智能去重合并**：DOI 精确匹配 + 标题规范化，合并最优字段
- **多来源链接展示**：卡片显示所有来源按钮
- **排序功能**：相关性 / 引用数 / 最新 / 最早
- **API Key 安全管理**：环境变量 + python-dotenv
- **CI/CD**：GitHub Actions，21 个单元测试，backend pytest + frontend tsc
- **结构化日志**：所有 print 替换为 logging.warning
- **健康检查**：`GET /api/health`
- **venue 标注**：从 10 源提取期刊/会议名，显示在作者行右侧
- **AI 筛选分开展示**：Tab 切换"AI 筛选后 / 全部结果"，被过滤论文带橙色标记
- **搜索历史**：localStorage 持久化最近 10 条，一键复用
- **PDF 深度查找（两级回退）**：Kimi 联网 + 8 平台跳转链接
- **搜索源多选**：10 个数据源带颜色编码的多选框，全选/清空
- **搜索参数直接输入**：数字输入框，blur 自动 clamp
- **一键复制标题**：点击复制按钮 + Toast 提示"快去学习吧 📚"
- **默认搜索近5年**：未指定日期时自动填近5年
- **Feature 4：每篇论文独立对话抽屉**：violet 按钮常驻，右侧滑出抽屉，DeepSeek 直接调用，独立上下文
- **可配置快捷提问**：抽屉快捷提问可增删编辑，localStorage 持久化
- **按来源分组视图**：列表/分组切换，分组 header 可折叠
- **紧凑/标准密度切换**：默认紧凑，摘要可展开，localStorage 持久化
- **Google Scholar 常驻按钮**：sky蓝色，精确标题搜索，替代格式导出需求
- **骨架屏**：shimmer 卡片替代 spinner
- **卡片出现动画**：55ms 错落 fadeUp
- **Favicon + 动态 Tab 标题**：蓝色书本图标，搜索后标题变关键词
- **键盘快捷键**：`/` 聚焦搜索，`Esc` 关闭抽屉
- **搜索结果统计**："共找到 X 篇 · AI 筛选保留 Y 篇"
- **空状态示例可点击**：直接触发搜索
- **封面大改版**：左右分栏，辉光球动效，打字机，App预览窗口，特性卡片，右侧 benefit 列表

---

## 🔲 待做事项

### 多模型支持 🔴（已预告）

在对话框和论文对话抽屉中支持多种大模型：
- Claude（Anthropic）
- GPT-4o（OpenAI）
- Gemini（Google）
- 当前只支持 DeepSeek

设计要点：
- Key 管理：每个模型的 Key 单独存 localStorage
- 切换器：下拉选择当前使用的模型
- 统一接口：各模型调用封装为相同接口

### 收藏/书签功能 🟡（设计复杂暂缓）

localStorage 持久化，跨搜索保存感兴趣的论文。
需要好好设计数据结构和 UI 入口。

### 封面截图更新 🟢

新封面（辉光球+预览窗口版本）需要重新截图：
- `docs/images/01_key_setup.png`
- 更新 README 展示

### Issue I：Docker 支持 🟢（暂缓）

加 `Dockerfile` + `docker-compose.yml`，一条命令本地启动。

---

## 解决建议顺序

1. **多模型支持**：最高价值，已在 README 预告，用户期待
2. **封面截图**：5 分钟，视觉更新
3. **收藏功能**：需设计，择机做
4. **Docker**：有需求再做
