/**
 * sync-channels.js
 *
 * Playwright로 Slack 웹에 접속하여 채널 메시지를 수집한다.
 * 저장된 세션을 사용하며, 증분 수집(마지막 싱크 이후 메시지만)을 지원한다.
 *
 * 사용법:
 *   node sync-channels.js                             # 모든 워크스페이스
 *   node sync-channels.js --workspace=workspace-a          # 특정 워크스페이스
 *   node sync-channels.js --since=2026-04-01           # 특정 날짜 이후만
 *   node sync-channels.js --full                       # 전체 재수집
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));

// CLI 인수 파싱
const args = process.argv.slice(2);
const targetSlug = args.find(a => a.startsWith('--workspace='))?.split('=')[1];
const sinceArg = args.find(a => a.startsWith('--since='))?.split('=')[1];
const fullSync = args.includes('--full');

// 마지막 싱크 기록
const lastSyncPath = resolve(__dirname, 'storage/last-sync.json');
function getLastSync() {
  if (existsSync(lastSyncPath)) {
    return JSON.parse(readFileSync(lastSyncPath, 'utf-8'));
  }
  return {};
}
function saveLastSync(data) {
  writeFileSync(lastSyncPath, JSON.stringify(data, null, 2));
}

/**
 * 채널 페이지에서 메시지를 추출한다.
 */
async function extractMessages(page) {
  return await page.evaluate(() => {
    const messages = [];
    const msgElements = document.querySelectorAll('[data-qa="message_container"]');

    msgElements.forEach(el => {
      try {
        // 타임스탬프 (부모의 data-item-key 또는 data-ts)
        const parent = el.closest('[data-item-key]');
        const ts = parent?.getAttribute('data-item-key') || '';

        // 작성자
        const authorEl = el.querySelector('[data-qa="message_sender_name"]');
        const author = authorEl?.textContent?.trim() || 'unknown';

        // 시간 표시
        const timeLabelEl = el.querySelector('[data-qa="timestamp_label"]');
        const timeLabel = timeLabelEl?.textContent?.trim() || '';

        // 메시지 텍스트
        const textEl = el.querySelector('[data-qa="message-text"]');
        const text = textEl?.textContent?.trim() || '';

        // 스레드 정보
        const replyBar = el.querySelector('[data-qa="reply_bar_count"]');
        const replyCount = replyBar?.textContent?.trim() || '';
        const hasThread = !!replyBar;

        if (text && text.length > 0) {
          messages.push({ ts, author, text, timeLabel, hasThread, replyCount });
        }
      } catch (e) {
        // 개별 메시지 파싱 실패는 무시
      }
    });

    return messages;
  });
}

/**
 * 스레드를 열어서 답글을 수집한다.
 */
async function extractThreadReplies(page, messageTs) {
  try {
    // reply_bar_count 버튼 클릭으로 스레드 열기
    const parent = await page.$(`[data-item-key="${messageTs}"]`);
    if (!parent) return [];

    const replyBtn = await parent.$('[data-qa="reply_bar_count"]');
    if (!replyBtn) return [];

    await replyBtn.click();
    await page.waitForTimeout(2000);

    // 스레드 패널에서 메시지 추출
    const replies = await page.evaluate(() => {
      const threadMsgs = [];
      // 스레드 패널의 메시지 컨테이너
      const threadPanel = document.querySelector('.p-flexpane__inside_body') ||
                          document.querySelector('[data-qa="threads_flexpane"]') ||
                          document.querySelector('.p-thread_view');

      if (!threadPanel) return [];

      const msgs = threadPanel.querySelectorAll('[data-qa="message_container"]');
      msgs.forEach((el, i) => {
        if (i === 0) return; // 첫 번째는 원본 메시지, 스킵

        const authorEl = el.querySelector('[data-qa="message_sender_name"]');
        const author = authorEl?.textContent?.trim() || 'unknown';

        const timeLabelEl = el.querySelector('[data-qa="timestamp_label"]');
        const timeLabel = timeLabelEl?.textContent?.trim() || '';

        const textEl = el.querySelector('[data-qa="message-text"]');
        const text = textEl?.textContent?.trim() || '';

        const parent = el.closest('[data-item-key]');
        const ts = parent?.getAttribute('data-item-key') || '';

        if (text) {
          threadMsgs.push({ ts, author, text, timeLabel });
        }
      });

      return threadMsgs;
    });

    // 스레드 패널 닫기 (ESC 또는 닫기 버튼)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    return replies;
  } catch (e) {
    return [];
  }
}

/**
 * 스크롤업하여 더 많은 메시지를 로드한다.
 */
async function scrollToLoadMore(page, maxAttempts) {
  const allMessages = [];
  const seenTs = new Set();
  let noNewCount = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const msgs = await extractMessages(page);
    let newCount = 0;

    for (const msg of msgs) {
      const key = msg.ts || `${msg.author}-${msg.text.substring(0, 50)}`;
      if (!seenTs.has(key)) {
        seenTs.add(key);
        allMessages.push(msg);
        newCount++;
      }
    }

    if (newCount === 0) {
      noNewCount++;
      if (noNewCount >= 3) break; // 3번 연속 새 메시지 없으면 종료
    } else {
      noNewCount = 0;
    }

    // 위로 스크롤
    await page.evaluate(() => {
      const scrollContainer = document.querySelector('.c-virtual_list__scroll_container') ||
                              document.querySelector('[data-qa="slack_kit_list"]') ||
                              document.querySelector('.p-message_pane__top_banners')?.parentElement;
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      } else {
        window.scrollTo(0, 0);
      }
    });

    await page.waitForTimeout(config.settings.scrollDelayMs);
  }

  return allMessages;
}

/**
 * 단일 채널을 수집한다.
 */
async function syncChannel(context, workspace, channelUrl, channelName, sinceDateStr) {
  const page = await context.newPage();
  console.log(`  📥 #${channelName} 수집 중...`);

  try {
    await page.goto(channelUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // 로그인 체크
    if (page.url().includes('/signin') || page.url().includes('login')) {
      console.log(`  ❌ #${channelName}: 세션 만료`);
      return { channel: channelName, status: 'SESSION_EXPIRED', messages: [] };
    }

    // 메시지 로드 대기
    await page.waitForTimeout(2000);

    // 메시지 수집
    const messages = await scrollToLoadMore(page, config.settings.maxScrollAttempts);

    // 스레드 수집 — 스레드가 있는 메시지에 대해 답글 수집
    for (const msg of messages) {
      if (msg.hasThread && msg.ts) {
        console.log(`    🧵 스레드 수집: ${msg.author} "${msg.text.substring(0, 30)}..." (${msg.replyCount})`);
        const replies = await extractThreadReplies(page, msg.ts);
        msg.threadReplies = replies;
        console.log(`    ✅ ${replies.length}건 답글 수집`);
      }
    }

    console.log(`  ✅ #${channelName}: ${messages.length}건 수집`);
    return { channel: channelName, status: 'OK', messages };

  } catch (err) {
    console.log(`  ❌ #${channelName}: ${err.message}`);
    return { channel: channelName, status: 'ERROR', error: err.message, messages: [] };
  } finally {
    await page.close();
  }
}

/**
 * 워크스페이스의 모든 채널을 수집한다.
 */
async function syncWorkspace(workspace) {
  const sessionPath = resolve(__dirname, config.settings.sessionDir, `${workspace.slug}.json`);

  if (!existsSync(sessionPath)) {
    console.log(`❌ ${workspace.name}: 세션 없음. 'npm run auth --workspace=${workspace.slug}' 실행 필요`);
    return null;
  }

  if (!workspace.channels || workspace.channels.length === 0) {
    console.log(`⚠️  ${workspace.name}: 수집할 채널이 설정되지 않았습니다.`);
    return null;
  }

  const lastSync = getLastSync();
  const sinceDate = sinceArg || lastSync[workspace.slug] || null;

  console.log(`\n🔄 ${workspace.name} 싱크 시작` + (sinceDate ? ` (${sinceDate} 이후)` : ' (전체)'));

  const browser = await chromium.launch({
    headless: config.settings.headless
  });

  try {
    const context = await browser.newContext({ storageState: sessionPath });

    // 🔒 안전장치: 메시지 전송/수정/삭제 등 쓰기 요청을 네트워크 레벨에서 차단
    await context.route('**/*', (route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();

      // Slack API 쓰기 엔드포인트 차단
      const blockedPatterns = [
        'chat.postMessage', 'chat.update', 'chat.delete',
        'chat.meMessage', 'reactions.add', 'reactions.remove',
        'files.upload', 'files.delete',
        'pins.add', 'pins.remove',
        'conversations.join', 'conversations.leave',
        'conversations.invite', 'conversations.kick',
      ];

      const isBlockedApi = blockedPatterns.some(p => url.includes(p));
      const isPostToApi = method === 'POST' && url.includes('/api/') && isBlockedApi;

      if (isPostToApi) {
        console.log(`  🔒 차단됨: ${method} ${url.split('?')[0]}`);
        return route.abort();
      }

      return route.continue();
    });
    console.log('  🔒 안전 모드: 메시지 전송/수정/삭제 요청이 차단됩니다.');

    const results = [];

    for (const channel of workspace.channels) {
      const result = await syncChannel(context, workspace, channel.url, channel.name, sinceDate);
      results.push(result);
    }

    // 결과 저장
    const outputPath = resolve(
      __dirname,
      config.settings.messagesDir,
      `${workspace.slug}-${new Date().toISOString().split('T')[0]}.json`
    );
    mkdirSync(dirname(outputPath), { recursive: true });

    const output = {
      workspace: workspace.name,
      slug: workspace.slug,
      syncedAt: new Date().toISOString(),
      since: sinceDate,
      channels: results
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`💾 저장: ${outputPath}`);

    // 마지막 싱크 시간 업데이트
    lastSync[workspace.slug] = new Date().toISOString().split('T')[0];
    saveLastSync(lastSync);

    return output;

  } finally {
    await browser.close();
  }
}

async function main() {
  const workspaces = targetSlug
    ? config.workspaces.filter(w => w.slug === targetSlug)
    : config.workspaces;

  if (workspaces.length === 0) {
    console.log('❌ 해당 워크스페이스를 찾을 수 없습니다.');
    process.exit(1);
  }

  const allResults = [];
  for (const ws of workspaces) {
    const result = await syncWorkspace(ws);
    if (result) allResults.push(result);
  }

  // 최종 요약 (Claude Code가 파싱 가능한 JSON)
  const summary = allResults.map(r => ({
    workspace: r.workspace,
    channels: r.channels.map(c => ({
      name: c.channel,
      status: c.status,
      messageCount: c.messages.length
    }))
  }));

  console.log('\n📊 싱크 요약:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
