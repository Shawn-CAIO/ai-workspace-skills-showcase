/**
 * auth-setup.js
 *
 * swmaestro.ai 웹 로그인 세션을 저장한다.
 * headed 모드로 브라우저가 열리면, 수동으로 로그인 → 터미널에서 Enter 키로 세션 저장.
 *
 * 사용법:
 *   node auth-setup.js
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = resolve(__dirname, 'storage', 'swmaestro-state.json');
const HOME_URL = 'https://www.swmaestro.ai/sw/main/main.do';

async function main() {
  mkdirSync(dirname(SESSION_PATH), { recursive: true });

  console.log('\n🔐 swmaestro.ai 로그인을 시작합니다...');
  console.log('   브라우저가 열리면 우측 상단 "로그인" 버튼을 눌러 ID/PW로 로그인하세요.');
  console.log('   로그인 완료 후 메인 페이지로 돌아오면 터미널에서 Enter를 눌러주세요.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`⚠️  초기 페이지 로딩 오류: ${e.message}`);
    console.log('   브라우저 주소창에 직접 https://www.swmaestro.ai/ 를 입력해도 됩니다.');
  }

  await new Promise((res) => {
    process.stdin.once('data', res);
  });

  await context.storageState({ path: SESSION_PATH });
  console.log(`✅ 세션 저장 완료: ${SESSION_PATH}`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
