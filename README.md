# ai-workspace-skills-showcase

Claude Code 기반 개인 자동화 시스템 — **Custom Skills 9개 + 보조 스크립트** 공개본.

> 2026-04-30 AI·SW마에스트로 멘토특강 *"Claude Code + Skills로 만든 개인 자동화 시스템"* 데모용 공개 저장소입니다. 실제 운영 환경(개인 워크스페이스)에서 분리·sanitize한 버전이라, 그대로 쓰려면 본인 환경에 맞게 ID/키/주소를 채워야 합니다.

## 무엇이 들어있나

```
ai-workspace-skills-showcase/
├── skills-source/            # 9개 Custom Skills (각 디렉터리 = 1 skill)
│   ├── my-clarify/           # 모호한 요구사항을 4분면으로 명확화
│   ├── my-content-digest/    # Quiz-First 학습 (퀴즈부터 내고 틀린 부분 학습)
│   ├── my-context-sync/      # Slack + Gmail + Calendar + Webex 통합 싱크
│   ├── my-fetch-tweet/       # X/Twitter 트윗 요약·번역
│   ├── my-fetch-youtube/     # YouTube 자막 추출 + 자동자막 보정 + 요약
│   ├── my-find-restaurant/   # 네이버 로컬 검색 + 캘린더 일정 반영
│   ├── my-route-planner/     # 출발지/도착지 경로 + 캘린더 자동 등록
│   ├── my-session-wrap/      # 세션 종료 시 작업 정리·학습 기록
│   └── my-slack-scraper/     # Playwright로 외부 Slack 게스트 채널 수집
└── scripts/
    ├── install-skills.sh     # skills-source/ → ~/.claude/skills/ 동기화
    ├── slack-scraper/        # Playwright 외부 Slack 워크스페이스 수집기
    ├── swmaestro-scraper/    # swmaestro.ai 마이페이지 수집기 (예시 도메인)
    └── webex-mcp/            # Webex Messaging MCP OAuth 레이어
```

## 설치 (요약)

```bash
# 1) skills 배포: skills-source/ → ~/.claude/skills/
./scripts/install-skills.sh

# 2) Playwright 기반 스크레이퍼 (각 디렉터리에서)
cd scripts/slack-scraper && npm install && npx playwright install chromium
cd scripts/swmaestro-scraper && npm install && npx playwright install chromium

# 3) Webex MCP (선택)
./scripts/webex-mcp/bootstrap.sh
cp scripts/webex-mcp/.env.example scripts/webex-mcp/.env  # 본인 OAuth Client 입력
node scripts/webex-mcp/oauth-setup.js
```

## 본인 환경에 맞게 채워야 하는 값

| 위치 | 무엇 |
|---|---|
| `skills-source/my-route-planner/SKILL.md` | 집 주소(`서울시 OO구 OO로 N`), 좌표(`127.0,37.0`) |
| `skills-source/my-find-restaurant/SKILL.md` | 동일 — 집 주소·좌표 |
| `skills-source/my-context-sync/SKILL.md` | Calendar ID(`c_xxxxxxxx_*`), Notion DB ID(`00000000-...`), Slack 채널 ID(`CXXXXXXXXX*`) |
| `skills-source/my-slack-scraper/SKILL.md` | Slack 채널 URL(`workspace-a.slack.com/archives/CXXXXXXXXX1`) |
| `scripts/slack-scraper/config.json` | `slug`, 워크스페이스 `T...`/채널 `C...` ID |
| `scripts/swmaestro-scraper/scrape-my-mentoring.js` | `MY_EMAIL`, `MY_NAME` (라인 322–323) |
| `scripts/webex-mcp/.env` | `WEBEX_CLIENT_ID`, `WEBEX_CLIENT_SECRET` |
| `~/.zshrc` | `NCP_CLIENT_ID/SECRET`, `NAVER_CLIENT_ID/SECRET`, `ODSAY_API_KEY`, `SWMAESTRO_ID/PW` |

## 환경변수 (외부 API 키, 모두 `~/.zshrc` 또는 셸에 직접)

| 변수 | 용도 |
|---|---|
| `NCP_CLIENT_ID` / `NCP_CLIENT_SECRET` | 네이버 클라우드 (Geocoding, Directions) — route-planner |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 개발자센터 (로컬 검색) — find-restaurant |
| `ODSAY_API_KEY` | ODsay 대중교통 API — route-planner |
| `SWMAESTRO_ID` / `SWMAESTRO_PW` | swmaestro.ai 자동 로그인 (해당 사이트 사용자만) |

## 메모리 시스템 / Notion 연동

`my-session-wrap`은 `~/.claude/memory/`에 학습 기록을 누적하며, `my-context-sync`는 Notion DB에 일자별 싱크 결과를 저장합니다. 두 기능 모두 **placeholder ID**가 들어있으니, 본인 Notion DB / 메모리 경로로 교체해야 동작합니다.

## 라이선스

MIT — 자유롭게 fork·수정·재배포하시되, 본인 워크플로우에 맞게 sanitize한 후 사용하시기 바랍니다.

## 참고

- Claude Code: https://claude.com/claude-code
- Anthropic Skills 문서: https://docs.claude.com (Skills, Slash Commands, Hooks)

---

**주의**: 이 저장소는 **공개용 sanitize 버전**입니다. 실제 운영 저장소는 `private.md` 참조, 개인 정보, Slack 채널/워크스페이스 ID, 캘린더 ID, Notion DB ID, 자택 주소·좌표 등이 포함되어 있어 별도 private repo로 관리됩니다. 이 공개본은 코드와 워크플로우 구조를 참고용으로 제공합니다.
