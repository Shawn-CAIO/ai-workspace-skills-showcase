/**
 * check-session.js
 *
 * 저장된 세션이 유효한지 확인한다.
 * headless로 Slack에 접속해서 로그인 상태인지 체크.
 *
 * 사용법:
 *   node check-session.js
 *   node check-session.js --workspace=workspace-a
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));

const targetSlug = process.argv.find(a => a.startsWith('--workspace='))?.split('=')[1];

async function checkSession(workspace) {
  const sessionPath = resolve(__dirname, config.settings.sessionDir, `${workspace.slug}.json`);

  if (!existsSync(sessionPath)) {
    return { workspace: workspace.name, slug: workspace.slug, status: 'NO_SESSION', message: '세션 파일 없음. npm run auth 실행 필요' };
  }

  if (!workspace.url) {
    return { workspace: workspace.name, slug: workspace.slug, status: 'NO_URL', message: 'config.json에 URL 미설정' };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: sessionPath });
    const page = await context.newPage();

    await page.goto(workspace.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // 로그인 페이지로 리다이렉트되었는지 확인
    const url = page.url();
    const isLoginPage = url.includes('/signin') || url.includes('/sign_in') || url.includes('login');

    if (isLoginPage) {
      return { workspace: workspace.name, slug: workspace.slug, status: 'EXPIRED', message: '세션 만료. npm run auth 재실행 필요' };
    }

    return { workspace: workspace.name, slug: workspace.slug, status: 'VALID', message: '세션 유효' };
  } catch (err) {
    return { workspace: workspace.name, slug: workspace.slug, status: 'ERROR', message: err.message };
  } finally {
    await browser.close();
  }
}

async function main() {
  const workspaces = targetSlug
    ? config.workspaces.filter(w => w.slug === targetSlug)
    : config.workspaces;

  const results = [];
  for (const ws of workspaces) {
    const result = await checkSession(ws);
    results.push(result);
    const icon = result.status === 'VALID' ? '✅' : '❌';
    console.log(`${icon} ${result.workspace}: ${result.message}`);
  }

  // 결과를 JSON으로도 출력 (Claude Code가 파싱 가능)
  console.log('\n' + JSON.stringify(results));
}

main().catch(console.error);
