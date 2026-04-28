/**
 * inspect-dom.js
 * Slack 메시지 DOM 구조를 분석하여 정확한 셀렉터를 찾는다.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));

const targetSlug = process.argv.find(a => a.startsWith('--workspace='))?.split('=')[1] || 'workspace-a';
const workspace = config.workspaces.find(w => w.slug === targetSlug);
const sessionPath = resolve(__dirname, config.settings.sessionDir, `${workspace.slug}.json`);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath });
  const page = await context.newPage();

  const channelUrl = workspace.channels[0].url;
  console.log(`Opening: ${channelUrl}`);
  await page.goto(channelUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  // DOM 구조 분석
  const analysis = await page.evaluate(() => {
    const results = { messageContainers: [], sampleMessages: [] };

    // 가능한 메시지 컨테이너 셀렉터들
    const containerSelectors = [
      '[data-qa="virtual-list-item"]',
      '[data-qa="message_container"]',
      '.c-message_kit__background',
      '.c-message_kit__message',
      '.c-virtual_list__item',
      '[class*="message"]',
      '[data-qa="message-text"]',
      '.p-rich_text_section',
      '.c-message_kit__blocks',
    ];

    for (const sel of containerSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        results.messageContainers.push({
          selector: sel,
          count: els.length,
          sampleClasses: els[0].className?.substring(0, 100),
          sampleDataQa: els[0].getAttribute('data-qa'),
          innerHTML: els[0].innerHTML?.substring(0, 300)
        });
      }
    }

    // 메시지 요소에서 상세 분석
    const msgEls = document.querySelectorAll('[data-qa="virtual-list-item"]');
    if (msgEls.length === 0) {
      // fallback
      const fallback = document.querySelectorAll('.c-virtual_list__item');
      for (let i = 0; i < Math.min(3, fallback.length); i++) {
        results.sampleMessages.push({
          outerHTML: fallback[i].outerHTML?.substring(0, 1000),
          allDataQa: [...fallback[i].querySelectorAll('[data-qa]')].map(el => ({
            qa: el.getAttribute('data-qa'),
            tag: el.tagName,
            text: el.textContent?.substring(0, 50)
          }))
        });
      }
    }

    for (let i = 0; i < Math.min(3, msgEls.length); i++) {
      const el = msgEls[i];
      results.sampleMessages.push({
        outerHTML: el.outerHTML?.substring(0, 1000),
        allDataQa: [...el.querySelectorAll('[data-qa]')].map(el => ({
          qa: el.getAttribute('data-qa'),
          tag: el.tagName,
          text: el.textContent?.substring(0, 50)
        })),
        allDataTs: [...el.querySelectorAll('[data-ts]')].map(el => ({
          ts: el.getAttribute('data-ts'),
          tag: el.tagName
        })),
        timeElements: [...el.querySelectorAll('time, [datetime]')].map(el => ({
          tag: el.tagName,
          datetime: el.getAttribute('datetime'),
          text: el.textContent?.substring(0, 50)
        })),
        buttons: [...el.querySelectorAll('button[data-qa]')].map(el => ({
          qa: el.getAttribute('data-qa'),
          text: el.textContent?.substring(0, 50),
          ariaLabel: el.getAttribute('aria-label')
        })),
        // 스레드 관련
        threadIndicators: [...el.querySelectorAll('[data-qa*="thread"], [data-qa*="reply"], [class*="thread"], [class*="reply"]')].map(el => ({
          qa: el.getAttribute('data-qa'),
          className: typeof el.className === 'string' ? el.className.substring(0, 80) : '',
          text: el.textContent?.substring(0, 50)
        }))
      });
    }

    return results;
  });

  console.log(JSON.stringify(analysis, null, 2));
  await browser.close();
}

main().catch(console.error);
