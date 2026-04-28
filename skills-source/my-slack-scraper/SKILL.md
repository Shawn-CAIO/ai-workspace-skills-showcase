---
name: my-slack-scraper
description: Playwright로 외부 Slack 워크스페이스의 채널 메시지를 수집한다. 게스트 권한으로 API 접근이 불가능한 워크스페이스 대상. "슬랙 스크래핑", "외부 슬랙 싱크", "슬랙 수집" 요청에 사용.
triggers:
  - "슬랙 스크래핑"
  - "외부 슬랙 싱크"
  - "슬랙 수집"
  - "slack scrape"
---

# My Slack Scraper

Playwright로 외부 Slack 워크스페이스의 채널 메시지를 수집하는 스킬.

게스트(싱글채널/멀티채널) 권한으로는 Slack API/MCP 접근이 불가능하므로,
브라우저 자동화로 웹 클라이언트에서 직접 메시지를 읽어온다.

## 대상 워크스페이스

| 워크스페이스 | 역할 | 주요 채널 |
|-------------|------|-----------|
| Workspace A | 싱글채널 게스트 | AI프로젝트 |
| Workspace B | 기술튜터 | 교육 일정 조율, 주요 공지 |

## 사전 조건

1. Playwright가 설치되어 있어야 함
2. `config.json`에 워크스페이스 URL과 채널 정보가 설정되어야 함
3. 최초 1회 `npm run auth`로 로그인 세션 생성 필요

## 파일 구조

```
scripts/slack-scraper/
├── package.json
├── config.json           # 워크스페이스/채널 설정
├── auth-setup.js         # 세션 생성 (최초 1회, headed 모드)
├── check-session.js      # 세션 유효성 확인
├── sync-channels.js      # 메시지 수집 (메인 스크립트)
└── storage/
    ├── session/          # 브라우저 세션 (*.json)
    ├── messages/         # 수집된 메시지 (날짜별 JSON)
    └── last-sync.json    # 마지막 싱크 타임스탬프
```

## 실행 흐름

이 스킬이 트리거되면 아래 순서로 실행한다.

### 1단계: 세션 확인

```bash
cd scripts/slack-scraper && node check-session.js
```

결과에 따라 분기:
- `VALID` → 2단계로 진행
- `EXPIRED` 또는 `NO_SESSION` → 사용자에게 안내:
  ```
  ⚠️ {워크스페이스} 세션이 만료되었습니다.
  터미널에서 다음 명령을 실행해주세요:
    cd scripts/slack-scraper && npm run auth
  ```
  사용자가 세션을 갱신할 때까지 해당 워크스페이스는 건너뛴다.

### 2단계: 메시지 수집

```bash
cd scripts/slack-scraper && node sync-channels.js
```

옵션:
- `--workspace=workspace-a` — 특정 워크스페이스만
- `--since=2026-04-01` — 특정 날짜 이후만
- `--full` — 전체 재수집

기본 동작: 마지막 싱크 이후 메시지만 증분 수집

### 3단계: 결과 읽기

수집된 메시지는 `storage/messages/{slug}-{날짜}.json`에 저장된다.

```json
{
  "workspace": "Workspace A",
  "slug": "workspace-a",
  "syncedAt": "2026-04-02T10:30:00.000Z",
  "since": "2026-04-01",
  "channels": [
    {
      "channel": "ai-project",
      "status": "OK",
      "messages": [
        {
          "ts": "1775088115.745029",
          "author": "홍길동",
          "text": "메시지 내용",
          "datetime": "2026-04-02T09:00:00Z"
        }
      ]
    }
  ]
}
```

이 JSON을 읽어서 사용자에게 요약하거나, my-context-sync에서 참조한다.

## 초기 설정 가이드

### 1. config.json에 워크스페이스 정보 추가

사용자에게 다음 정보를 물어본다:
- 워크스페이스 Slack 웹 URL (예: `https://workspace-a.slack.com`)
- 수집할 채널 URL (예: `https://workspace-a.slack.com/archives/CXXXXXXXXX1`)

```json
{
  "workspaces": [
    {
      "name": "Workspace A",
      "slug": "workspace-a",
      "url": "https://workspace-a.slack.com",
      "channels": [
        { "name": "ai-project", "url": "https://workspace-a.slack.com/archives/CXXXXXXXXX1" }
      ]
    }
  ]
}
```

### 2. 세션 생성

```bash
cd scripts/slack-scraper && npm run auth
```

브라우저가 열리면 사용자가 직접 로그인.
로그인 완료 후 Enter → 세션 저장.

### 3. 테스트 실행

```bash
cd scripts/slack-scraper && npm run sync
```

## my-context-sync 연동

my-context-sync에서 이 스킬의 결과를 참조하려면:

1. 싱크 전에 `sync-channels.js`를 실행하여 최신 메시지 수집
2. `storage/messages/` 디렉토리에서 오늘 날짜의 JSON 파일을 읽기
3. 각 워크스페이스/채널별 메시지를 해당 섹션에 통합

## 세션 관리

- Slack 웹 세션은 약 **2주** 유지됨
- 세션 만료 시 `npm run auth`로 재로그인 필요
- `check-session.js`로 사전 확인 가능
- 싱크 스크립트에서도 세션 만료를 감지하여 자동 안내

## 주의사항

- **수집 속도**: 채널당 1.5초 간격으로 스크롤 (Slack 감지 방지)
- **headless 모드**: config.json의 `headless` 설정으로 제어. Slack이 차단하면 `false`(headed)로 전환
- **DOM 변경**: Slack 웹 UI 업데이트 시 셀렉터 수정이 필요할 수 있음
