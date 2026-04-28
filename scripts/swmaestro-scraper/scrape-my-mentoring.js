/**
 * scrape-my-mentoring.js
 *
 * swmaestro.ai 마이페이지에서 두 가지를 수집:
 * 1. 멘토링/특강게시판 > MY 멘토링: 모집인원 현황
 * 2. 보고 게시판: 보고서 제출/승인 현황
 *
 * 사용법:
 *   node scrape-my-mentoring.js                  # MY 멘토링 + 보고 게시판
 *   node scrape-my-mentoring.js --with-applicants # 상세 페이지에서 신청자 이름도 수집
 *   node scrape-my-mentoring.js --headed          # 브라우저 보이기
 *   node scrape-my-mentoring.js --inspect         # 페이지 구조 탐색 (디버깅)
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = resolve(__dirname, 'storage', 'swmaestro-state.json');
const OUTPUT_DIR = resolve(__dirname, 'output');

// 멘토링/특강게시판 목록 페이지 (MY 멘토링 탭 진입을 위한 베이스)
const LIST_URL = 'https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046';
const LOGIN_URL = 'https://www.swmaestro.ai/sw/member/user/forLogin.do?menuNo=200025';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const withApplicants = args.includes('--with-applicants');
const inspectMode = args.includes('--inspect');

function log(...msgs) { console.log('[my-mentoring]', ...msgs); }
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 자동 로그인 ──────────────────────────────────────────
// 환경변수 SWMAESTRO_ID / SWMAESTRO_PW가 설정되어 있으면 자동 로그인
async function autoLogin(context) {
  const id = process.env.SWMAESTRO_ID;
  const pw = process.env.SWMAESTRO_PW;
  if (!id || !pw) {
    console.error('❌ 세션 만료. 자동 로그인하려면 환경변수를 설정하세요:');
    console.error('   export SWMAESTRO_ID="아이디"');
    console.error('   export SWMAESTRO_PW="비밀번호"');
    console.error('   또는 수동 로그인: node auth-setup.js');
    process.exit(1);
  }

  log('세션 만료 → 자동 로그인 시도...');
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000);

  // ID/PW 입력
  await page.fill('#username', id);
  await page.fill('#password', pw);
  await wait(500);

  // 로그인 버튼 클릭
  await page.locator('button:has-text("로그인")').click();
  await wait(3000);

  // 로그인 성공 확인: 마이페이지 접근 가능 여부
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('forLogin')) {
    console.error('❌ 자동 로그인 실패. ID/PW를 확인하세요.');
    await page.close();
    process.exit(1);
  }

  // 세션 저장
  await context.storageState({ path: SESSION_PATH });
  log('✅ 자동 로그인 성공, 세션 저장 완료');
  await page.close();
}

// ─── 목록 행 파싱 ─────────────────────────────────────────
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

    // capacity 파싱: "2 /8" → { applied: 2, max: 8 }
    const capMatch = capacity.match(/(\d+)\s*\/\s*(\d+)/);
    const applied = capMatch ? parseInt(capMatch[1], 10) : null;
    const max = capMatch ? parseInt(capMatch[2], 10) : null;

    rows.push({
      id, no, category, title, badge,
      recruitPeriod, schedule,
      capacity, applied, max,
      opened, status, author, registered,
      detailLine,
      applicants: [],   // 상세 페이지에서 채움
    });
  });
  return rows;
}

// ─── 보고 게시판 행 파싱 ──────────────────────────────────
// 컬럼: NO. | 구분 | 제목 | 진행날짜 | 상태 | 작성자 | 등록일 | 인정시간 | 지급액
function extractReportRowsFromHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('.boardlist table.t tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    const no = clean($(tds[0]).text());
    const category = clean($(tds[1]).text());
    const title = clean($(tds[2]).text());
    const conductedDate = clean($(tds[3]).text());
    const status = clean($(tds[4]).text());
    const author = clean($(tds[5]).text());
    const registered = clean($(tds[6]).text());
    const approvedHours = clean($(tds[7]).text());
    const payment = clean($(tds[8]).text());

    rows.push({
      no, category, title, conductedDate,
      status, author, registered,
      approvedHours, payment,
    });
  });
  return rows;
}

// ─── 보고 게시판 수집 ─────────────────────────────────────
async function scrapeReports(page) {
  log('\n=== 보고 게시판 수집 ===');

  // 보고 게시판 URL 직접 접근
  const REPORT_URL = 'https://www.swmaestro.ai/sw/mypage/myReport/report.do?menuNo=200048';
  log(`보고 게시판 접속: ${REPORT_URL}`);
  await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000);

  if (page.url().includes('main/main.do') || page.url().includes('error')) {
    log('⚠️  보고 게시판 진입 실패 (세션 만료 또는 접근 불가)');
    return [];
  }
  log(`  → URL: ${page.url()}`);

  // "멘토링 보고서 제출내역" 탭이 기본 선택되어 있음
  const html = await page.content();
  const reports = extractReportRowsFromHtml(html);
  log(`  → 보고서 제출내역: ${reports.length}건`);

  // 페이지네이션 (보통 적은 건수)
  const allReports = [...reports];
  const seenNos = new Set(reports.map(r => r.no));
  for (let pageNo = 2; pageNo <= 10; pageNo++) {
    const pageUrl = `${REPORT_URL}&pageIndex=${pageNo}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(1500);

    const rows = extractReportRowsFromHtml(await page.content());
    if (rows.length === 0) break;

    const newRows = rows.filter(r => !seenNos.has(r.no));
    if (newRows.length === 0) break;

    newRows.forEach(r => seenNos.add(r.no));
    allReports.push(...newRows);
  }

  log(`  총 ${allReports.length}건 보고서 수집`);
  return allReports;
}

// ─── 상세 페이지에서 신청자 이름 수집 ──────────────────────
async function scrapeApplicants(page, id) {
  const detailUrl = `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${id}&menuNo=200046`;
  log(`  상세 페이지: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(1500);

  const html = await page.content();
  const $ = cheerio.load(html);
  const applicants = [];

  // "연수생" 헤더가 있는 테이블을 찾아서 파싱
  // 컬럼: NO. | 연수생 | 신청일 | 취소일 | 상태
  $('table').each((_, tbl) => {
    const headers = [];
    $(tbl).find('th').each((__, th) => headers.push(clean($(th).text())));
    if (!headers.includes('연수생')) return;

    const nameIdx = headers.indexOf('연수생');
    const statusIdx = headers.indexOf('상태');

    $(tbl).find('tr').each((__, tr) => {
      const tds = $(tr).find('td');
      if (tds.length === 0) return;

      const name = clean($(tds[nameIdx]).text());
      const status = statusIdx >= 0 ? clean($(tds[statusIdx]).text()) : '';
      const applyDate = clean($(tds[headers.indexOf('신청일')]).text());

      if (!name) return;

      applicants.push({
        name,
        status,
        applyDate,
      });
    });
  });

  return applicants;
}

// ─── inspect 모드: MY 멘토링 탭 구조 탐색 ──────────────────
async function inspectPage(page) {
  log('=== INSPECT 모드 ===');
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000);

  // 현재 URL 확인
  log(`현재 URL: ${page.url()}`);

  // 탭/메뉴 구조 탐색
  const html = await page.content();
  const $ = cheerio.load(html);

  // 탭 버튼들 찾기
  log('\n--- 탭/메뉴 요소 ---');
  const tabSelectors = [
    '.tab a', '.tab li a', '.tab_wrap a', '.tabmenu a',
    'ul.tabs a', 'ul.tab a', '.nav-tabs a',
    'a[href*="mentoLec"]',
    '.sub_tab a', '.sub_menu a',
    'select option',
  ];

  for (const sel of tabSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      log(`  [${sel}] ${found.length}개:`);
      found.each((i, el) => {
        const text = clean($(el).text());
        const href = $(el).attr('href') || $(el).attr('value') || '';
        const onclick = $(el).attr('onclick') || '';
        if (text || href) {
          log(`    ${i + 1}. "${text}" href="${href}" onclick="${onclick}"`);
        }
      });
    }
  }

  // "MY" 키워드 포함 요소 탐색
  log('\n--- "MY" 또는 "나의" 포함 요소 ---');
  $('a, button, li, option').each((_, el) => {
    const text = clean($(el).text());
    if (/my|나의|내\s/i.test(text)) {
      const tag = $(el).prop('tagName');
      const href = $(el).attr('href') || '';
      const onclick = $(el).attr('onclick') || '';
      log(`  <${tag}> "${text}" href="${href}" onclick="${onclick}"`);
    }
  });

  // 드롭다운/셀렉트 요소 탐색
  log('\n--- select/드롭다운 ---');
  $('select').each((_, sel) => {
    const name = $(sel).attr('name') || $(sel).attr('id') || '';
    log(`  <select name="${name}">`);
    $(sel).find('option').each((_, opt) => {
      log(`    <option value="${$(opt).attr('value')}">${clean($(opt).text())}</option>`);
    });
  });

  // 검색 폼 탐색
  log('\n--- form 요소 ---');
  $('form').each((i, form) => {
    const action = $(form).attr('action') || '';
    const method = $(form).attr('method') || '';
    log(`  form[${i}] action="${action}" method="${method}"`);
    $(form).find('input[type="hidden"]').each((_, inp) => {
      log(`    hidden: ${$(inp).attr('name')}="${$(inp).attr('value')}"`);
    });
  });

  // 전체 HTML 저장
  const inspectPath = resolve(OUTPUT_DIR, 'inspect-my-mentoring.html');
  writeFileSync(inspectPath, html, 'utf-8');
  log(`\n전체 HTML 저장: ${inspectPath}`);
}

// ─── MY 멘토링 탭으로 이동 ─────────────────────────────────
// 페이지의 searchMy(email, name) JS 함수를 호출하여 본인 항목만 필터링
const MY_EMAIL = 'user@example.com';
const MY_NAME = 'User';

async function navigateToMyMentoring(page) {
  // 1차: 목록 페이지 접속
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(1500);

  // 로그인 체크: swmaestro는 미인증 시 메인 페이지로 리다이렉트
  if (page.url().includes('login') || page.url().includes('main/main.do')) {
    await autoLogin(page.context());
    // 재시도
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(1500);
    if (page.url().includes('login') || page.url().includes('main/main.do')) {
      console.error('❌ 자동 로그인 후에도 접근 실패.');
      process.exit(1);
    }
  }

  // 2차: URL 직접 접근 (검증된 패턴 — 가장 안정적)
  try {
    const myUrl = `${LIST_URL}&searchCnd=2&searchId=${encodeURIComponent(MY_EMAIL)}&searchWrd=${encodeURIComponent(MY_NAME)}`;
    log(`MY 멘토링 URL 직접 접근...`);
    await page.goto(myUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(2000);
    const rows = extractRowsFromHtml(await page.content());
    if (rows.length > 0) {
      log(`  → ${rows.length}건 표시`);
      return true;
    }
  } catch { /* continue */ }

  // 3차: "MY 멘토링" 링크 클릭 (폴백)
  try {
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(1500);
    const myLink = page.locator('a:has-text("MY 멘토링")').first();
    if (await myLink.count() > 0) {
      log('"MY 멘토링" 탭 클릭...');
      await myLink.click();
      await wait(2500);
      log(`  → URL: ${page.url()}`);
      return true;
    }
  } catch { /* continue */ }

  // 4차: 전체 목록에서 author 필터 폴백
  log('⚠️  MY 멘토링 탭 자동 진입 실패. 전체 목록에서 본인 항목만 필터링합니다.');
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(1500);
  return false;
}

// ─── 메인 ──────────────────────────────────────────────────
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

  // inspect 모드
  if (inspectMode) {
    await inspectPage(page);
    await browser.close();
    process.exit(0);
  }

  // MY 멘토링 진입
  const isMyTab = await navigateToMyMentoring(page);

  // 목록 수집 (페이지네이션)
  const allRows = [];
  const seenIds = new Set();
  const maxPages = 20; // MY 목록은 보통 2-3페이지

  // 현재 페이지 URL 기반으로 페이지네이션
  const currentUrl = page.url();
  const baseUrl = currentUrl.split('&pageIndex=')[0];

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    if (pageNo > 1) {
      const pageUrl = `${baseUrl}&pageIndex=${pageNo}`;
      log(`페이지 ${pageNo} 접속: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await wait(1500);
    }

    const html = await page.content();
    const rows = extractRowsFromHtml(html);
    log(`  → ${rows.length}건 파싱`);
    if (rows.length === 0) break;

    const newRows = rows.filter((r) => !seenIds.has(r.id));
    if (newRows.length === 0) {
      log('  → 전부 중복. 마지막 페이지.');
      break;
    }
    newRows.forEach((r) => seenIds.add(r.id));
    allRows.push(...newRows);
  }

  // MY 탭 진입 실패 시 본인 항목만 필터
  let myRows = allRows;
  if (!isMyTab && allRows.length > 0) {
    // author 필드에서 본인 이름으로 필터
    const myName = 'User';
    myRows = allRows.filter((r) => r.author.includes(myName));
    log(`본인 항목 필터: ${allRows.length}건 → ${myRows.length}건 (author="${myName}")`);
  }

  log(`총 ${myRows.length}건 MY 멘토링 수집`);

  // 상세 페이지 신청자 수집 (옵션)
  if (withApplicants && myRows.length > 0) {
    log('\n--- 상세 페이지 신청자 수집 ---');
    for (const row of myRows) {
      if (!row.id) continue;
      try {
        row.applicants = await scrapeApplicants(page, row.id);
        log(`  ${row.title.slice(0, 40)}... → 신청자 ${row.applicants.length}명`);
      } catch (err) {
        log(`  ⚠️  ${row.id} 상세 페이지 오류: ${err.message}`);
      }
    }
  }

  // ─── 보고 게시판 수집 ──────────────────────────────────
  // 멘토링/특강게시판과 같은 마이페이지 내 탭이므로 이어서 수집
  const reports = await scrapeReports(page);

  // ─── 결과 저장 ────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = resolve(OUTPUT_DIR, `my-mentoring-${timestamp}.json`);

  const result = {
    scrapedAt: new Date().toISOString(),
    isMyTab,
    mentoring: {
      count: myRows.length,
      items: myRows,
    },
    reports: {
      count: reports.length,
      items: reports,
    },
  };

  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  log(`\nJSON 저장: ${jsonPath}`);

  // context-sync용 최신 파일도 저장 (덮어쓰기)
  const latestPath = resolve(OUTPUT_DIR, 'my-mentoring-latest.json');
  writeFileSync(latestPath, JSON.stringify(result, null, 2), 'utf-8');
  log(`최신 파일: ${latestPath}`);

  // 콘솔 요약 출력
  console.log('\n📊 MY 멘토링 현황:');
  console.log(JSON.stringify(myRows.map((r) => ({
    title: r.title.replace(/\[멘토\s*특강\]|\[자유\s*멘토링\]/, '').trim().slice(0, 50),
    category: r.category,
    schedule: r.schedule,
    capacity: r.capacity,
    applied: r.applied,
    max: r.max,
    status: r.status,
    applicants: r.applicants.filter((a) => a.status === '[신청완료]').map((a) => a.name),
  })), null, 2));

  console.log('\n📝 보고서 현황:');
  console.log(JSON.stringify(reports.map((r) => ({
    title: r.title.slice(0, 50),
    category: r.category,
    conductedDate: r.conductedDate,
    status: r.status,
    approvedHours: r.approvedHours || '-',
    payment: r.payment || '-',
  })), null, 2));

  await browser.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
