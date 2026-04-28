import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = resolve(__dirname, 'storage', 'swmaestro-state.json');
const LIST_URL = 'https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: SESSION_PATH, viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('URL:', page.url());
console.log('Title:', await page.title());

const info = await page.evaluate(() => {
  const tables = Array.from(document.querySelectorAll('table'));
  return {
    tableCount: tables.length,
    tables: tables.map((t, i) => ({
      i,
      cls: t.className,
      id: t.id,
      thCount: t.querySelectorAll('thead th').length,
      tbodyRowCount: t.querySelectorAll('tbody tr').length,
      firstRowPreview: t.querySelector('tbody tr')?.innerText?.slice(0, 200) ?? null,
    })),
    paginationHTML: document.querySelector('.pagination, .paging, .board_paging, nav')?.outerHTML?.slice(0, 500) ?? 'none',
    bodyPreview: document.body.innerText.slice(0, 500),
  };
});

console.log(JSON.stringify(info, null, 2));

const html = await page.content();
writeFileSync(resolve(__dirname, 'output', 'inspect.html'), html, 'utf-8');
console.log('saved inspect.html');

await page.waitForTimeout(1500);
await browser.close();
