/**
 * ScholarScout 截图脚本
 *
 * 使用方法（在项目根目录执行）：
 *   npm install                        # 安装 playwright（首次）
 *   npx playwright install chromium    # 下载浏览器（首次，约 100MB）
 *   node scripts/screenshot.mjs        # 运行截图
 *
 * 截图保存到 docs/images/
 * 需要本地前端服务已启动：cd frontend && npm run build && npx vite preview --port 4173 --host
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT  = join(__dirname, '../docs/images');
const BASE = 'http://127.0.0.1:4173';

await mkdir(OUT, { recursive: true });

// ── Mock 数据 ─────────────────────────────────────────────────────────────────
const MOCK_PAPERS = [
  { paper_id:'1', title:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', authors:['Patrick Lewis','Ethan Perez','Aleksandra Piktus','Fabio Petroni'], published_date:'2020-05-22', doi:'10.48550/arXiv.2005.11401', pdf_url:'https://arxiv.org/pdf/2005.11401.pdf', url:'https://arxiv.org/abs/2005.11401', source:'arXiv', citations:6842, relevance_reason:'提出了 RAG 框架，将检索与生成结合，是该领域奠基性工作', source_links:[{source:'arXiv',url:'https://arxiv.org/abs/2005.11401'},{source:'Semantic Scholar',url:'https://semanticscholar.org/paper/58ed0'}], venue:'NeurIPS 2020' },
  { paper_id:'2', title:'REALM: Retrieval-Augmented Language Model Pre-Training', authors:['Kelvin Guu','Kenton Lee','Zora Tung','Panupong Pasupat','Ming-Wei Chang'], published_date:'2020-02-10', doi:'10.48550/arXiv.2002.08909', pdf_url:'https://arxiv.org/pdf/2002.08909.pdf', url:'https://arxiv.org/abs/2002.08909', source:'Semantic Scholar', citations:2341, relevance_reason:'首次在预训练阶段引入检索机制，与 RAG 核心思想高度相关', source_links:[{source:'Semantic Scholar',url:'https://arxiv.org/abs/2002.08909'}], venue:'ICML 2020' },
  { paper_id:'3', title:'Dense Passage Retrieval for Open-Domain Question Answering', authors:['Vladimir Karpukhin','Barlas Oğuz','Sewon Min','Patrick Lewis','Ledell Wu'], published_date:'2020-04-10', doi:'10.48550/arXiv.2004.04906', pdf_url:'https://arxiv.org/pdf/2004.04906.pdf', url:'https://arxiv.org/abs/2004.04906', source:'OpenAlex', citations:4127, relevance_reason:'提出 DPR 密集检索，是 RAG 系统中检索组件的核心基础', source_links:[{source:'OpenAlex',url:'https://arxiv.org/abs/2004.04906'}], venue:'EMNLP 2020' },
  { paper_id:'4', title:'Improving Language Models by Retrieving from Trillions of Tokens', authors:['Sebastian Borgeaud','Arthur Mensch','Jordan Hoffmann','Trevor Cai'], published_date:'2021-12-08', doi:'10.48550/arXiv.2112.04426', pdf_url:'https://arxiv.org/pdf/2112.04426.pdf', url:'https://arxiv.org/abs/2112.04426', source:'CrossRef', citations:1893, relevance_reason:'RETRO 展示了超大规模检索增强的效果', source_links:[{source:'CrossRef',url:'https://arxiv.org/abs/2112.04426'}], venue:'ICML 2022' },
  { paper_id:'5', title:'Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection', authors:['Akari Asai','Zeqiu Wu','Yizhong Wang','Avirup Sil','Hannaneh Hajishirzi'], published_date:'2023-10-17', doi:'10.48550/arXiv.2310.11511', pdf_url:'https://arxiv.org/pdf/2310.11511.pdf', url:'https://arxiv.org/abs/2310.11511', source:'arXiv', citations:892, relevance_reason:'提出自适应检索和自我批评机制，是 2023 年 RAG 领域重要进展', source_links:[{source:'arXiv',url:'https://arxiv.org/abs/2310.11511'}], venue:'ICLR 2024' },
];
const MOCK_REJECTED = [
  { paper_id:'r1', title:'A Survey of Information Retrieval Methods for Web Search', authors:['John Smith','Mary Johnson'], published_date:'2019-03-15', pdf_url:null, url:'https://example.com/1', source:'CrossRef', citations:45, relevance_reason:null, source_links:[{source:'CrossRef',url:'https://example.com/1'}], venue:'WWW 2019' },
  { paper_id:'r2', title:'Neural Machine Translation with Attention Mechanism', authors:['Wei Chen','Li Zhang'], published_date:'2018-06-01', pdf_url:null, url:'https://example.com/2', source:'Semantic Scholar', citations:312, relevance_reason:null, source_links:[{source:'Semantic Scholar',url:'https://example.com/2'}], venue:'ACL 2018' },
];

const SSE_BODY = [
  `event: progress\ndata: ${JSON.stringify({ message:'正在搜索关键词：RAG, retrieval augmented generation...' })}\n`,
  `event: progress\ndata: ${JSON.stringify({ message:'找到 89 篇论文，正在补全 PDF 链接...' })}\n`,
  `event: progress\ndata: ${JSON.stringify({ message:'正在验证相关性...' })}\n`,
  `event: done\ndata: ${JSON.stringify({ papers:MOCK_PAPERS, rejected_papers:MOCK_REJECTED, message:'为您找到 5 篇相关论文。' })}\n`,
].join('\n');

// Mock 对话消息，注入到抽屉截图用
const MOCK_CHAT_MESSAGES = [
  { role: 'user', content: '这篇论文的核心贡献是什么？' },
  { role: 'assistant', content: '这篇论文提出了 RAG（Retrieval-Augmented Generation）框架，核心贡献有三点：\n\n1. **结合检索与生成**：在生成时动态检索相关文档，使模型能访问训练数据之外的知识。\n\n2. **端到端训练**：检索器和生成器联合优化，无需单独标注检索结果。\n\n3. **广泛适用性**：在多个知识密集型任务上达到 SOTA，包括开放域问答、事实核查等。' },
];

// ── 辅助函数 ──────────────────────────────────────────────────────────────────
async function mockRoutes(page) {
  await page.route('**/api/parse', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ intent:'search', keywords:['RAG','retrieval augmented generation','large language model'], date_from:null, date_to:null }),
  }));
  await page.route('**/api/search', r => r.fulfill({
    status: 200, contentType: 'text/event-stream',
    headers: { 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' },
    body: SSE_BODY,
  }));
}

async function injectKey(page) {
  await page.addInitScript(() => {
    localStorage.setItem('scholarscout_deepseek_key', 'sk-demo-for-screenshot');
  });
}

async function doSearch(page) {
  await page.locator('textarea').first().fill('找2023年后关于RAG检索增强生成的综述论文');
  await page.locator('textarea').first().press('Enter');
  await page.waitForTimeout(900);
  await page.locator('button', { hasText: '开始搜索' }).click();
  await page.waitForTimeout(4000);
}

// ── 截图开始 ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const VP = { width: 1440, height: 860 };

async function newPage() {
  const ctx = await browser.newContext({ viewport: VP });
  return { page: await ctx.newPage(), ctx };
}

// 01. 新版封面（Key 输入页）
{
  const { page, ctx } = await newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01_key_setup.png` });
  console.log('✓ 01_key_setup.png');
  await ctx.close();
}

// 02. 搜索结果（AI 筛选后）
{
  const { page, ctx } = await newPage();
  await injectKey(page);
  await mockRoutes(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await doSearch(page);
  await page.screenshot({ path: `${OUT}/02_search_results.png` });
  console.log('✓ 02_search_results.png');
  await ctx.close();
}

// 03. AI 独立对话抽屉（核心特性优先展示）
{
  const page = await browser.newPage({ viewport: VP });
  await injectKey(page);
  await mockRoutes(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await doSearch(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/debug_03.png` });
  // 调试：列出页面上所有按钮文字
  const allBtns = await page.locator('button').all();
  for (const b of allBtns) {
    const t = (await b.textContent())?.trim().replace(/\s+/g, ' ');
    if (t) console.log('  BTN:', JSON.stringify(t));
  }
  // 找到第一个 AI 对话按钮并点击
  const analyzeBtn = page.locator('button').filter({ hasText: /AI\s*对话/ }).first();
  await analyzeBtn.waitFor({ timeout: 10000 });
  await analyzeBtn.click();
  await page.waitForTimeout(600);
  // 在输入框里输入问题（不提交，展示待询问状态）
  const drawerTextarea = page.locator('div[class*="fixed"][class*="right-0"] textarea');
  await drawerTextarea.fill('这篇论文的核心贡献和创新点是什么？');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03_ai_chat_drawer.png` });
  console.log('✓ 03_ai_chat_drawer.png');
  await page.close();
}

// 04. 按来源分组视图
{
  const page = await browser.newPage({ viewport: VP });
  await injectKey(page);
  await mockRoutes(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await doSearch(page);
  await page.locator('button[title="按来源分组"]').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04_grouped_view.png` });
  console.log('✓ 04_grouped_view.png');
  await page.close();
}

// 05. 全部结果 Tab（含 AI 过滤标记）
{
  const page = await browser.newPage({ viewport: VP });
  await injectKey(page);
  await mockRoutes(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await doSearch(page);
  await page.locator('button', { hasText: '全部结果' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05_all_results.png` });
  console.log('✓ 05_all_results.png');
  await page.close();
}

await browser.close();
console.log(`\n全部截图完成，保存于 ${OUT}`);
