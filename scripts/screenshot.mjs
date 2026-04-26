/**
 * ScholarScout 截图脚本
 * 使用方法：
 *   npx playwright install chromium   # 首次运行前安装（约 100MB）
 *   node scripts/screenshot.mjs
 *
 * 截图保存到 docs/images/
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../docs/images');
const BASE_URL = 'http://118.25.192.117';
// 如需截取本地开发环境，改为：
// const BASE_URL = 'http://localhost:5173';

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('打开页面...');
await page.goto(BASE_URL, { waitUntil: 'networkidle' });

// 1. 首页（Key 输入页）
await page.screenshot({ path: join(OUT_DIR, '01_key_setup.png'), fullPage: false });
console.log('✓ 01_key_setup.png');

// 填入一个假 Key 看能不能进入主界面（如果已有 Key 存在 localStorage 会自动跳过）
// 如果页面上有 Key 输入框，填入后进入主界面
const keyInput = page.locator('input[placeholder*="sk-"]').first();
if (await keyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
  await keyInput.fill('sk-demo-key-for-screenshot');
  await page.locator('button', { hasText: '开始使用' }).click();
  await page.waitForTimeout(500);
}

// 2. 主界面空状态
await page.screenshot({ path: join(OUT_DIR, '02_empty_state.png'), fullPage: false });
console.log('✓ 02_empty_state.png');

await browser.close();
console.log('\n截图完成，保存于 docs/images/');
console.log('提示：搜索结果页需要真实 Key 才能截图，请手动截取后保存为:');
console.log('  docs/images/03_keyword_confirm.png  — 关键词确认界面');
console.log('  docs/images/04_search_results.png   — 搜索结果卡片');
console.log('  docs/images/05_all_results.png      — 全部结果 Tab（含不相关）');
