# ScholarScout

> 用自然语言找论文，不需要懂技术。

ScholarScout 是一个面向非计算机专业研究者的学术论文搜索工具。你只需要用中文描述自己的需求，它会自动理解、搜索、过滤，把真实存在的相关论文列表返回给你，并支持一键预览和下载 PDF。

---

## 功能

- **自然语言搜索**：直接说"找2023年后关于大模型幻觉问题的论文"，不需要手动拼关键词
- **多源搜索**：同时检索 arXiv、Semantic Scholar、OpenAlex 三个学术数据库
- **AI 相关性过滤**：搜索结果经过大模型二次验证，过滤掉不相关的内容
- **论文预览 & 下载**：每篇论文提供原文链接和 PDF 下载
- **智能对话**：不想搜论文时，也可以直接和 AI 聊，问问题、寻求解释

---

## 使用方法

ScholarScout 需要你提供自己的 **DeepSeek API Key** 来驱动 AI 功能（Key 只保存在本地浏览器，不会上传服务器）。

**第一步：获取 DeepSeek API Key**

1. 访问 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 在控制台创建一个 API Key，格式为 `sk-xxxxxxxx`
3. DeepSeek 价格很低，日常搜索几乎可以忽略不计

**第二步：开始使用**

访问 [zhenbucuo.online](http://zhenbucuo.online)，粘贴你的 API Key，然后用中文描述你想找的论文即可。

**示例搜索**

```
找2023年后关于 RAG 检索增强生成的综述论文
diffusion model 在医学图像分割方面的应用，最近两年的
帮我找强化学习用于机器人控制的论文，要求是顶会发表的
```

---

## 本地部署

如果你想自己部署一份，克隆仓库后参考 `deploy/` 目录下的脚本。

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout
bash deploy/setup.sh   # 首次部署
```

后续更新：

```bash
bash deploy/deploy.sh
```

环境要求：Ubuntu 22.04+，4 核 4 GB 内存以上即可。

---

## 技术说明

**搜索层**

论文搜索目前基于 [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) 提供的 arXiv 连接器，以及直接调用 Semantic Scholar 和 OpenAlex 的开放 API。感谢 openags 的工作。

后续计划自己实现完整的多源搜索链路，进一步提升搜索质量和覆盖范围。

**技术栈**

- 前端：React + TypeScript + Vite + Tailwind CSS
- 后端：Python + FastAPI，SSE 流式推送进度
- AI：DeepSeek API（用户自带 Key）
- 搜索源：arXiv、Semantic Scholar、OpenAlex

---

## 项目状态

🚧 **项目正在持续改进中**，目前处于早期阶段，可能存在以下已知问题：

- 特定年份或小众领域的论文搜索结果较少
- 对话上下文记忆有限

欢迎通过 [GitHub Issues](https://github.com/Dshuishui/ScholarScout/issues) 反馈问题或提出建议，任何形式的贡献都非常欢迎。

---

## 致谢

- [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) — 提供了多源学术搜索的基础实现思路和 arXiv 连接器
- [DeepSeek](https://www.deepseek.com) — 提供 AI 推理能力
- [Semantic Scholar](https://www.semanticscholar.org) 和 [OpenAlex](https://openalex.org) — 提供免费开放的学术数据 API
