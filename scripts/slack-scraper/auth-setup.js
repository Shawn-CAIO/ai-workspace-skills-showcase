/**
 * auth-setup.js
 *
 * 워크스페이스별 Slack 웹 로그인 세션을 저장한다.
 * headed 모드로 브라우저가 열리면, 수동으로 로그인 → 세션이 자동 저장됨.
 *
 * 사용법:
 *   node auth-setup.js                  # 모든 워크스페이스
 *   node auth-setup.js --workspace=workspace-a  # 특정 워크스페이스만
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));

const targetSlug = process.argv.find(a => a.startsWith('--workspace='))?.split('=')[1];

async function setupAuth(workspace) {
  const sessionPath = resolve(__dirname, config.settings.sessionDir, `${workspace.slug}.json`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  if (!workspace.url) {
    console.log(`⚠️  ${workspace.name}: URL이 설정되지 않았습니다. config.json에 url을 추가해주세요.`);
    return;
  }

  console.log(`\n🔐 ${workspace.name} 로그인을 시작합니다...`);
  console.log(`   브라우저가 열리면 Slack에 로그인해주세요.`);
  console.log(`   로그인 완료 후 채널 목록이 보이면 터미널에서 Enter를 눌러주세요.\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(workspace.url);

  // 사용자가 로그인할 때까지 대기
  await new Promise((res) => {
    process.stdin.once('data', res);
  });

  // 세션 저장
  await context.storageState({ path: sessionPath });
  console.log(`✅ ${workspace.name} 세션 저장 완료: ${sessionPath}`);

  await browser.close();
}

async function main() {
  const workspaces = targetSlug
    ? config.workspaces.filter(w => w.slug === targetSlug)
    : config.workspaces;

  if (workspaces.length === 0) {
    console.log('❌ 해당 워크스페이스를 찾을 수 없습니다.');
    process.exit(1);
  }

  for (const ws of workspaces) {
    await setupAuth(ws);
  }

  console.log('\n🎉 모든 세션 저장 완료!');
  process.exit(0);
}

main().catch(console.error);
