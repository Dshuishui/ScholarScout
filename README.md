# ScholarScout

> 用自然语言找论文，不需要懂技术。

[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://www.python.org)
[![uv](https://img.shields.io/badge/package_manager-uv-purple?logo=python)](https://github.com/astral-sh/uv)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/Dshuishui/ScholarScout/issues)
[![Made with Claude](https://img.shields.io/badge/Made%20with-Claude-orange?logo=anthropic)](https://claude.ai)

ScholarScout 是一个面向非计算机专业研究者的学术论文搜索工具。你只需要用中文描述自己的需求，它会自动理解、搜索、过滤，把真实存在的相关论文列表返回给你，并支持一键预览和下载 PDF。

---

## 功能

- **自然语言搜索**：直接说"找2023年后关于大模型幻觉问题的论文"，不需要手动拼关键词
- **多源并发搜索**：同时检索 arXiv、Semantic Scholar、OpenAlex 三个学术数据库
- **AI 相关性过滤**：搜索结果经过大模型二次验证，过滤掉不相关的内容
- **论文预览 & 下载**：每篇论文提供原文链接和 PDF 下载
- **智能对话**：不想搜论文时，也可以直接和 AI 聊，问问题、寻求解释

---

## 工作原理

![架构图](docs/images/Architecture.png)

---

## 使用方法

ScholarScout 需要你提供自己的 **DeepSeek API Key** 来驱动 AI 功能（Key 只保存在本地浏览器，不会上传服务器）。

**第一步：获取 DeepSeek API Key**

1. 访问 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 在控制台创建一个 API Key，格式为 `sk-xxxxxxxx`
3. DeepSeek 价格很低，日常搜索几乎可以忽略不计

**第二步：开始使用**

访问 [118.25.192.117](http://118.25.192.117)，粘贴你的 API Key，然后用中文描述你想找的论文即可。

> **注意**：演示站部署在我个人的云服务器上，预计开放至 **2027 年初**（大约一年）。纯粹是闲来无事搭着玩，服务稳定性不做任何承诺，建议重要场景自行部署。

**示例搜索**

```
找2023年后关于 RAG 检索增强生成的综述论文
diffusion model 在医学图像分割方面的应用，最近两年的
帮我找强化学习用于机器人控制的论文，要求是顶会发表的
```

---

## 本地部署

如果你想自己部署一份，克隆仓库后执行：

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout
bash deploy/setup.sh   # 首次部署（自动安装依赖、构建前端、配置 Nginx）
```

后续更新只需：

```bash
bash deploy/deploy.sh
```

**环境要求**：Ubuntu 22.04+，4 核 4 GB 内存以上，需要可访问境外网络（用于拉取学术数据）。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 | Python 3.11 + FastAPI + SSE 流式推送 |
| 包管理 | [uv](https://github.com/astral-sh/uv)（后端）/ npm（前端） |
| AI | DeepSeek API（意图识别、关键词解析、相关性验证） |
| 搜索源 | arXiv、Semantic Scholar、OpenAlex |
| 部署 | Nginx + systemd，支持一键脚本部署 |

---

## 搜索层说明

论文搜索目前基于 [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) 提供的 arXiv 连接器，以及直接调用 Semantic Scholar 和 OpenAlex 的开放 API。感谢 openags 的工作。

后续计划自己实现完整的多源搜索链路，进一步提升搜索质量和覆盖范围。

---

## Roadmap

当前已知问题和计划改进见 [docs/backlog.md](docs/backlog.md)，主要包括：

- [ ] 提升特定年份和小众领域的搜索召回率
- [ ] 加入对话上下文记忆，支持追问和多轮搜索
- [ ] 自研多源搜索链路，替换对 paper-search-mcp 的依赖
- [ ] HTTPS 支持

---

## 项目状态

🚧 **项目正在持续改进中**，目前处于早期阶段。

本项目的代码主要由 **AI（Claude）辅助生成**，作者利用业余时间玩着做的，并非严肃的生产级项目。如果你在使用过程中遇到 bug 或有改进想法，非常欢迎通过 [GitHub Issues](https://github.com/Dshuishui/ScholarScout/issues) 友好地告知——毕竟大家都是第一次，轻喷 🙏

---

## 致谢

- [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) — 提供了多源学术搜索的基础实现思路和 arXiv 连接器
- [DeepSeek](https://www.deepseek.com) — 提供 AI 推理能力
- [Semantic Scholar](https://www.semanticscholar.org) 和 [OpenAlex](https://openalex.org) — 提供免费开放的学术数据 API
- [astral-sh/uv](https://github.com/astral-sh/uv) — 极速 Python 包管理工具

---

## License

MIT © [Dshuishui](https://github.com/Dshuishui)
