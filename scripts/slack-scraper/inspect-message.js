/**
 * inspect-message.js — 메시지 컨테이너 내부 구조 상세 분석
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
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

  await page.goto(workspace.channels[0].url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  const analysis = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-qa="message_container"]');
    const results = [];

    msgs.forEach((msg, i) => {
      // All data-qa attributes
      const allQa = [...msg.querySelectorAll('[data-qa]')].map(el => ({
        qa: el.getAttribute('data-qa'),
        tag: el.tagName,
        text: el.textContent?.substring(0, 60)?.trim()
      }));

      // All data-ts attributes
      const allTs = [...msg.querySelectorAll('[data-ts]')].map(el => ({
        ts: el.getAttribute('data-ts'),
        tag: el.tagName
      }));

      // Time elements
      const times = [...msg.querySelectorAll('time, [datetime]')].map(el => ({
        tag: el.tagName,
        datetime: el.getAttribute('datetime'),
        text: el.textContent?.trim()
      }));

      // Author candidates
      const authorCandidates = [
        msg.querySelector('[data-qa="message_sender_name"]'),
        msg.querySelector('.c-message__sender_button'),
        msg.querySelector('button[data-message-sender]'),
        msg.querySelector('[data-qa="message_sender_name"] .c-message__sender_link'),
      ].filter(Boolean).map(el => ({
        selector: el.getAttribute('data-qa') || el.className?.toString().substring(0, 60),
        text: el.textContent?.trim()
      }));

      // Thread reply indicators
      const threadBtns = [...msg.querySelectorAll('button')].filter(b => {
        const text = b.textContent || '';
        const aria = b.getAttribute('aria-label') || '';
        return text.includes('답글') || text.includes('reply') || text.includes('replies') ||
               aria.includes('reply') || aria.includes('답글') || aria.includes('thread');
      }).map(b => ({
        text: b.textContent?.trim().substring(0, 60),
        ariaLabel: b.getAttribute('aria-label'),
        dataQa: b.getAttribute('data-qa')
      }));

      // Message text
      const textEl = msg.querySelector('[data-qa="message-text"]');
      const text = textEl?.textContent?.trim().substring(0, 80);

      // data-item-key on parent
      const parent = msg.closest('[data-item-key]');
      const itemKey = parent?.getAttribute('data-item-key');

      results.push({
        index: i,
        itemKey,
        text,
        authorCandidates,
        allTs,
        times,
        threadBtns,
        qaCount: allQa.length,
        relevantQa: allQa.filter(q =>
          q.qa.includes('sender') || q.qa.includes('time') || q.qa.includes('thread') ||
          q.qa.includes('reply') || q.qa.includes('avatar') || q.qa.includes('message')
        )
      });
    });

    return results;
  });

  console.log(JSON.stringify(analysis, null, 2));
  await browser.close();
}

main().catch(console.error);
