---
name: my-market-summary
description: 딴지게시판 특정 작성자(EXAMPLE_USER_ID) 사용자의 미국·한국 증시 마감 요약 글을 자동 수집해 Slack #증시요약 발송 + ~/ai-workspace/market-summary/ 마크다운 적재. 매일 launchd cron으로 자동 실행, 사용자 수동 호출도 가능. "증시요약", "market summary", "딴지 증시" 요청에 사용.
triggers:
  - "증시요약"
  - "market summary"
  - "딴지 증시"
  - "ddanzi 증시"
---

# My Market Summary

딴지게시판 사용자 **특정 작성자** (user_id: `EXAMPLE_USER_ID`)가 매일 작성하는 증시 마감 요약 글을
자동 수집해 **Slack #증시요약** 발송 + `~/ai-workspace/market-summary/` 마크다운 적재.

## 인프라

- **수집 스크립트**: `scripts/ddanzi-scraper/check.js` (Node 18+, cheerio + turndown)
- **자동 실행**: macOS launchd plist (`scripts/ddanzi-scraper/launchd/*.plist`)
  - 미국장 마감 후: 매일 KST 06:30
  - 한국장 마감 후: 매일 KST 16:30
- **Slack 발송**: incoming webhook (`SLACK_WEBHOOK_MARKET_SUMMARY` 환경변수)
- **적재 위치**: `~/ai-workspace/market-summary/YYYY-MM-DD-{us|kr}.md` (git 추적)
- **자동 commit/push**: 스크립트 끝에서 새 파일을 ai-workspace repo에 push (다른 머신은 SessionStart hook의 `git pull --ff-only`로 자동 동기화)

## 왜 launchd인가 (Claude Code routine 아님)

ddanzi.com 서버가 Anthropic 클라우드 IP를 명시적으로 차단 (`Host not in allowlist` 403).
Claude Code routine은 클라우드 sandbox에서 실행되므로 ddanzi 페치 불가능.
**로컬 launchd**가 사용자 머신 IP로 fetch하면 통과. (2026-05-14 검증)

## 호출 패턴

### 1. 자동 (launchd cron)

설치되어 있으면 매일 06:30 + 16:30 KST에 알아서 실행. 별도 액션 불요.
설치 여부 확인: `launchctl list | grep market-summary`

### 2. 사용자 수동 호출 (Claude Code 스킬 trigger)

사용자가 "증시요약 한번 돌려줘", "ddanzi 증시 수집", "/my-market-summary" 등으로 호출 시:

```bash
cd ~/ai-workspace/scripts/ddanzi-scraper
npm run both   # us + kr 둘 다
# 또는
npm run us
npm run kr
```

결과 보고: 각 market별로 처리 결과(no_post / skipped / posted) + 새 파일 경로 +
Slack/git push 결과를 사용자에게 요약.

### 3. 머신 셋업 (1회)

새 머신에서 처음 돌릴 때 `scripts/ddanzi-scraper/README.md` 의 셋업 절차 참고:

```bash
cd ~/ai-workspace/scripts/ddanzi-scraper
npm install                                                       # cheerio, turndown
echo 'export SLACK_WEBHOOK_MARKET_SUMMARY="..."' >> ~/.zshrc       # webhook URL
source ~/.zshrc
cp launchd/*.plist ~/Library/LaunchAgents/
launchctl bootout gui/$UID/com.user.market-summary-us 2>/dev/null || true
launchctl bootout gui/$UID/com.user.market-summary-kr 2>/dev/null || true
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.user.market-summary-us.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.user.market-summary-kr.plist
```

주의: launchd의 기본 `PATH`에는 nvm Node가 없으므로 plist 명령은 `source "$HOME/.zshrc" 2>/dev/null; ... node ...` 형태여야 한다.

## 동작 (스크립트 내부)

1. KST 오늘 날짜 결정 → `https://www.ddanzi.com/index.php?mid=free&search_target=t_user_id&search_keyword=EXAMPLE_USER_ID` fetch
2. 정규식으로 `YYYY년 M월 D일 {미국|한국} 증시 {요약|마감 요약}` 제목 매칭. 오늘 우선, 없으면 어제 fallback. 둘 다 없으면 조용히 종료.
3. `market-summary/YYYY-MM-DD-{us|kr}.md` 이미 존재 → idempotent skip
4. 본문 페이지 fetch → cheerio로 본문 컨테이너 (`.rd_body article` 등) 추출 → turndown으로 markdown 변환 (이모지·▲▼ 보존)
5. frontmatter (date, market, source_author, source_url, posted_at, scraped_at) + 본문 + footer로 저장
6. Slack webhook POST (헤더 + 본문 + 원본·로컬 링크 푸터)
7. git add + commit + push

## 파일 형식

```markdown
---
date: YYYY-MM-DD
market: us | kr
source_author: 특정 작성자
source_url: https://www.ddanzi.com/index.php?mid=free&document_srl=...
posted_at: YYYY-MM-DD HH:MM
scraped_at: ISO-8601
---

# {원본 제목}

{본문 마크다운 — 이모지·▲▼·종목명·수치 보존}

---

*출처: [딴지게시판 특정 작성자](source_url) — my-market-summary 자동 수집*
```

## 휴장일·예외 처리

- 휴장일·미게시: 글이 없으면 자연 skip (별도 캘린더 체크 X)
- 늦은 게시: 어제 날짜 fallback으로 catch-up
- 본문 추출 실패: 에러 로깅 + 비-zero exit code (`/tmp/market-summary-{us,kr}.err` 확인)
- Slack 발송 실패: 파일은 저장됐으니 다음 실행 시 idempotent skip → 수동 재발송 또는 파일 삭제 후 재실행
- 이미 처리한 글 재수집 방지: 파일 존재로 idempotent

## 관련

- `scripts/ddanzi-scraper/README.md` — 셋업 및 운영 상세
- `~/ai-workspace/market-summary/` — 적재 디렉토리 (git 추적)
- `wiki/projects/market-summary.md` — 인프라 패턴·운영 메모
- 메모리:
  - `feedback_ddanzi_cloud_ip_blocked.md` — ddanzi가 Anthropic IP 차단 → 클라우드 routine 우회 패턴
  - `feedback_slack_mrkdwn_link.md` — Slack 링크 포맷 주의
