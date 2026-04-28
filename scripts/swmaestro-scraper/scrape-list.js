/**
 * scrape-list.js
 *
 * swmaestro.ai 멘토특강/자유멘토링 목록을 페이지네이션 순회하며 전체 수집.
 *
 * 사용법:
 *   node scrape-list.js
 *   node scrape-list.js --max-pages=5     # 디버깅용 제한
 *   node scrape-list.js --headed          # 브라우저 보이기
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = resolve(__dirname, 'storage', 'swmaestro-state.json');
const OUTPUT_DIR = resolve(__dirname, 'output');
const BASE_URL = 'https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046';

const args = process.argv.slice(2);
const maxPages = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] ?? '999', 10);
const headed = args.includes('--headed');

function log(...msgs) { console.log('[scrape]', ...msgs); }

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

function extractRowsFromHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('.boardlist table.t tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    const no = clean($(tds[0]).text());
    const titleCell = $(tds[1]);
    const titleA = titleCell.find('a[href*="view.do"]').first().length
      ? titleCell.find('a[href*="view.do"]').first()
      : titleCell.find('a').first();
    const title = clean(titleA.text());
    const href = titleA.attr('href') ?? '';
    const idMatch = href.match(/qustnrSn=(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    const badge = clean(titleCell.find('.color-red').text());
    const detailLine = clean(titleCell.find('.bbs_m').text());

    const recruitPeriod = clean($(tds[2]).text());
    const schedule = clean($(tds[3]).text());
    const capacity = clean($(tds[4]).text());
    const opened = clean($(tds[5]).text());
    const status = clean($(tds[6]).text());
    const author = clean($(tds[7]).text());
    const registered = clean($(tds[8]).text());

    let category = '';
    if (/\[멘토\s*특강\]/.test(title)) category = '멘토특강';
    else if (/\[자유\s*멘토링\]/.test(title)) category = '자유멘토링';

    rows.push({
      id, no, category, title, badge,
      recruitPeriod, schedule, capacity, opened, status, author, registered,
      detailLine,
    });
  });
  return rows;
}

async function main() {
  if (!existsSync(SESSION_PATH)) {
    console.error(`❌ 세션 파일이 없습니다: ${SESSION_PATH}`);
    console.error('   먼저 node auth-setup.js 를 실행하세요.');
    process.exit(1);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  log('브라우저 시작...');
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const allRows = [];
  const seenIds = new Set();

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const url = `${BASE_URL}&pageIndex=${pageNo}`;
    log(`페이지 ${pageNo} 접속: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (page.url().includes('login')) {
      console.error('❌ 세션 만료. auth-setup.js 재실행 필요.');
      break;
    }

    // waitForSelector 대신 고정 대기 (페이지의 JS가 Playwright selector 엔진을 방해)
    await page.waitForTimeout(1500);

    const html = await page.content();
    const rows = extractRowsFromHtml(html);
    log(`  → ${rows.length}건 파싱`);
    if (rows.length === 0) break;

    // 중복 페이지 감지 (마지막 페이지 초과 시 같은 데이터가 반복될 수 있음)
    const newRows = rows.filter((r) => !seenIds.has(r.id));
    if (newRows.length === 0) {
      log('  → 전부 중복. 마지막 페이지로 간주.');
      break;
    }
    newRows.forEach((r) => seenIds.add(r.id));
    allRows.push(...newRows);
  }

  log(`총 ${allRows.length}건 수집`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = resolve(OUTPUT_DIR, `lectures-${timestamp}.json`);
  const csvPath = resolve(OUTPUT_DIR, `lectures-${timestamp}.csv`);

  writeFileSync(jsonPath, JSON.stringify(allRows, null, 2), 'utf-8');
  log(`JSON 저장: ${jsonPath}`);

  const headers = ['id', 'no', 'category', 'title', 'badge', 'recruitPeriod', 'schedule', 'capacity', 'opened', 'status', 'author', 'registered', 'detailLine'];
  const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
  const csvLines = [headers.join(',')];
  for (const r of allRows) csvLines.push(headers.map((h) => esc(r[h])).join(','));
  writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');
  log(`CSV 저장: ${csvPath}`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
