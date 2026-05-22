---
name: my-context-sync
description: User의 일일 컨텍스트 싱크. Slack(외부 워크스페이스), Gmail, Google Calendar에서 최근 정보를 수집하고, 마에스트로 데이터(my-maestro 결과 JSON + Webex)도 함께 통합해서 하나의 문서로 정리한다. "싱크", "sync", "정보 수집" 요청에 사용.
triggers:
  - "싱크"
  - "sync"
  - "정보 수집"
  - "컨텍스트 싱크"
---

# My Context Sync

흩어진 정보를 한곳에 모아 정리하는 스킬.

Slack, Gmail, Google Calendar에서 최근 정보를 수집하고,
하나의 마크다운 문서로 통합한다.

## 소스 정의

### 소스 1: Slack (외부 워크스페이스 — Playwright)

| 항목 | 값 |
|------|-----|
| 수집 도구 | `my-slack-scraper` 스킬 (Playwright) |
| 수집 범위 | 마지막 싱크 이후 (증분) |

> 개인 워크스페이스는 미사용. 모든 Slack 데이터는 외부 워크스페이스에서 수집.
> 게스트 권한으로 API/MCP 접근 불가 → Playwright 브라우저 자동화로 수집.

대상 워크스페이스:

```yaml
workspaces:
  - name: "Workspace A"
    slug: "workspace-a"
    role: "싱글채널 게스트"
  - name: "Workspace B"
    slug: "workspace-b"
    role: "기술튜터 — 기존 워크스페이스/채널"
  - name: "Workspace C"
    slug: "workspace-c"
    role: "기술튜터 — 신규 모집글 워크스페이스/채널"
```

수집 방법:
```
1. 세션 확인:
   cd scripts/slack-scraper && node check-session.js

2. 메시지 수집:
   cd scripts/slack-scraper && node sync-channels.js

3. 결과 읽기:
   scripts/slack-scraper/storage/messages/{slug}-{날짜}.json 파일을 Read 도구로 읽는다.
   Workspace B는 당분간 `{workspace-b, workspace-c}-{날짜}.json`을 모두 읽고 한 섹션에 병합한다.
```

> **폴백 (Playwright 세션 만료 시)**: Gmail 간접 수집(소스 2의 호출 2)으로 대체.
> Playwright 안정화 후 Gmail 간접 수집은 제거 예정.

추출할 정보:
- 중요 공지사항
- 의사결정 사항 ("확정", "결정", "합의" 키워드)
- 나에게 멘션된 메시지
- 답장이 필요한 질문
- 교육 일정 조율 및 기술튜터 모집글 (Workspace B 기존 + 신규)

### 소스 2: Gmail

| 항목 | 값 |
|------|-----|
| MCP 도구 | `mcp__claude_ai_Gmail__gmail_search_messages` |
| 수집 범위 | 최근 7일, 받은편지함 |

수집 방법:
```
mcp__claude_ai_Gmail__gmail_search_messages를 2회 호출한다.

호출 1 — 일반 안 읽은 메일:
  mcp__claude_ai_Gmail__gmail_search_messages(q="is:unread newer_than:7d", maxResults=20)

호출 2 — 외부 Slack 워크스페이스 이메일 알림 (간접 수집):
  mcp__claude_ai_Gmail__gmail_search_messages(q="from:notification@slack.com newer_than:7d", maxResults=20)
```

> **외부 Slack 워크스페이스 간접 수집 대상:**
> | 워크스페이스 | 역할 | 주요 내용 |
> |-------------|------|-----------|
> | Workspace A | 싱글채널 게스트 | AI프로젝트 진행 상황, 미팅 조율 |
> | Workspace B | 기술튜터 | 교육 일정 조율, 주요 교육 관련 대화 |
>
> 이메일 알림에서 워크스페이스명을 구분하여 각각의 섹션으로 정리한다.

추출할 정보:
- 안 읽은 이메일 수
- 중요 발신자 이메일 요약
- 회신이 필요한 이메일
- 일정 초대 (캘린더 연동)
- Workspace A Slack 알림 요약 (프로젝트 업데이트, 멘션 등)
- Workspace B Slack 알림 요약 (교육 일정 조율, 튜터 관련 공지)

### 소스 3: Google Calendar

| 항목 | 값 |
|------|-----|
| MCP 도구 | `mcp__claude_ai_Google_Calendar__gcal_list_events` |
| 수집 범위 | 오늘 ~ 7일 후 |

수집할 캘린더 목록:

```yaml
calendars:
  - id: "primary"
    name: "개인 캘린더"
    always: true
  - id: "c_xxxxxxxx_placeholder_calendar_id@group.calendar.google.com"
    name: "[지피터스] 21기 공통일정"
    expires: "2026-04-13"   # 21기 종료 후 수집 불필요
  - id: "pl_xxxxxxxx_placeholder_imported@import.calendar.google.com"
    name: "바이브코딩 입문자를 위한, 실수가 자유로운 개발 연습장 만들기"
    expires: "2026-04-13"   # 21기 종료 후 수집 불필요
```

수집 방법:
```
각 캘린더에 대해 mcp__claude_ai_Google_Calendar__gcal_list_events 호출.
calendarId, 시작/종료 시간, 타임존을 전달한다.
expires 날짜가 지난 캘린더는 수집하지 않는다.

호출 예시:
  mcp__claude_ai_Google_Calendar__gcal_list_events(calendarId="primary", timeMin="오늘", timeMax="7일후", timeZone="Asia/Seoul")
  mcp__claude_ai_Google_Calendar__gcal_list_events(calendarId="c_xxxxxxxx...@group.calendar.google.com", timeMin="오늘", timeMax="7일후", timeZone="Asia/Seoul")
  mcp__claude_ai_Google_Calendar__gcal_list_events(calendarId="pl_xxxxxxxx...@import.calendar.google.com", timeMin="오늘", timeMax="7일후", timeZone="Asia/Seoul")

3개 캘린더를 병렬로 호출한다.
```

추출할 정보:
- 오늘의 일정
- 이번 주 주요 미팅
- 준비가 필요한 미팅 (발표, 외부 미팅 등)
- 일정 충돌 여부
- 여러 캘린더의 일정이 겹치는 경우 시간순으로 통합 표시

### 소스 4: 마에스트로 (my-maestro 스킬에 위임)

| 항목 | 값 |
|------|-----|
| 위임 스킬 | `my-maestro` |
| 읽을 결과 파일 | `scripts/swmaestro-scraper/output/my-mentoring-latest.json` (서울 멘토링·보고서) |
|  | `scripts/swmaestro-scraper/output/my-mentoring-busan-latest.json` (부산) |
|  | `scripts/swmaestro-scraper/output/my-reservations-latest.json` (회의실 예약, 서울+부산) |
| Webex 메시지 | my-maestro 기능 4와 동일한 방식으로 직접 수집 (캐시 없음, 매번 fresh) |

> SWMaestro 홈페이지 스크래핑은 my-maestro에 위임. 이 스킬에서는 직접 호출하지 않고
> 최신 JSON 결과 파일만 읽어서 통합 문서에 포함한다.

#### 신선도(Staleness) 판단

각 JSON 파일의 `scrapedAt` 필드 기준:

```
4시간 이내   → 그대로 사용 (조용히)
4~24시간     → "N시간 전 수집된 데이터"로 표시 + 사용자에게 갱신 여부 한 번 묻기
24시간 초과  → my-maestro 자동 재실행 권장 (또는 사용자 확인 후 실행)
파일 없음    → my-maestro 첫 실행 권장
```

#### 수집 방법

```
1. JSON 파일 3개 Read (Read 도구):
   - my-mentoring-latest.json
   - my-mentoring-busan-latest.json
   - my-reservations-latest.json

2. 각 파일의 scrapedAt으로 신선도 체크. 24h 초과 또는 파일 없음 시:
   사용자에게 "마에스트로 데이터를 새로 수집할까요?" 묻기 → yes면 my-maestro 호출

3. Webex 메시지는 매번 fresh로 수집 (my-maestro 기능 4와 동일 절차):
   mcp__webex-messaging__list_rooms(sortBy="lastactivity", max=30)
   → 대상 방 필터링 → 병렬 list_messages → 24~48h 메시지 추출
```

#### 통합 출력 구조

마에스트로 섹션은 다음 4개 하위 섹션으로 출력:
- **MY 멘토링·특강 (서울 + 부산)**: 표 형식, 모집인원 현황, 신청자
- **보고서 현황 (서울 + 부산)**: 표 형식, 인정시간/지급액
- **회의실 예약내역 (서울 + 부산)**: 표 형식, 회의실/사용기간/제목/상태
- **Webex 메시지**: 공지사항/멘토 그룹/활동 그룹/개인 멘토링방별 하이라이트

> 자세한 출력 포맷은 my-maestro SKILL.md의 "통합 출력 포맷" 섹션 참조.

#### "5/23 빈 회의실 알려줘" 같은 즉석 요청

이 스킬이 아니라 **my-maestro 기능 3**으로 라우팅. 컨텍스트 싱크에는 빈 회의실 조회를 포함하지 않음.

## 실행 흐름

이 스킬이 트리거되면 아래 순서로 실행한다.

### 1단계: 병렬 수집

4개 소스를 수집한다. Playwright 기반 소스(소스 1)와 마에스트로 데이터 신선도 체크가 순차, 나머지는 병렬.

```
수집 시작
  ├── [소스 1] Slack scraper 실행 (Playwright)               ─── 순차 (1번째)
  ├── [소스 4 신선도 체크] my-maestro JSON 파일 3개 검사     ─── 순차 (2번째)
  │     └── 24h 초과 시 사용자에게 "my-maestro 새로 돌릴까요?" 한 번 묻기
  │
  ├── [소스 1 결과] scraper JSON 읽기                         ─┐
  ├── [소스 2-a] Gmail 안 읽은 메일                            │
  ├── [소스 2-b] Gmail 외부 Slack 알림 (폴백)                 ├── 병렬 실행
  ├── [소스 3-a] Google Calendar (primary) 일정 수집          │
  ├── [소스 3-b] 지피터스 21기 공통일정 수집                   │  ← expires 확인 후 수집
  ├── [소스 3-c] 바이브코딩 연습장 스터디 수집                 │  ← expires 확인 후 수집
  ├── [소스 4-a] my-maestro JSON 3개 Read (마에스트로/예약)    │
  ├── [소스 4-b] Webex list_rooms (방 목록)                    │
  └── [소스 4-c] Webex list_messages (대상 방 × N)            ─┘  ← 4-b 결과 기반
수집 완료
```

> **실행 순서 주의**: Slack scraper(소스 1)는 브라우저를 실행하므로 단독 순차.
> 마에스트로 스크래퍼는 my-maestro에 위임 — 이 스킬은 결과 JSON만 읽기.
> Webex MCP 호출은 마에스트로 JSON Read와 함께 병렬 가능.

```
# 1. Slack scraper 순차 실행
Bash: cd scripts/slack-scraper && node check-session.js
  → 세션 유효 시: cd scripts/slack-scraper && node sync-channels.js
  → 세션 만료 시: 사용자에게 안내 후 Gmail 폴백 사용

# 2. 마에스트로 데이터 신선도 체크 (순차, 사용자 인터랙션 가능)
Read: scripts/swmaestro-scraper/output/my-mentoring-latest.json (scrapedAt 확인)
Read: scripts/swmaestro-scraper/output/my-mentoring-busan-latest.json
Read: scripts/swmaestro-scraper/output/my-reservations-latest.json
  → 셋 중 하나라도 24h 초과 또는 파일 없음 시:
    사용자에게 "마에스트로 데이터 새로 수집할까요? (y/n)" 묻기
    → y면 my-maestro 기능 1+2 실행 (3개 스크래퍼)
    → n이면 stale 표시로 진행

# 3. 나머지 소스 병렬 수집
Task(description="Slack + Gmail 수집", prompt="scraper JSON 읽기 + 최근 7일 안 읽은 이메일 + 외부 Slack 알림(폴백)을 수집하라")
Task(description="Calendar 수집", prompt="오늘부터 7일간 일정을 primary + 지피터스 캘린더(expires 전이면)에서 수집하라")
Task(description="마에스트로 통합 (JSON 읽기 + Webex)", prompt="my-mentoring-latest.json + my-mentoring-busan-latest.json + my-reservations-latest.json 읽기. 그리고 mcp__webex-messaging__list_rooms로 방 목록 받고, '서울센터 활동 그룹'/'부산센터 활동그룹'/'멘토 그룹'/'[서울] 공지사항'/'[부산] 공지사항'/'User' 포함 방의 메시지를 최근 24~48시간 범위로 수집해 요약하라")
```

### 2단계: 결과 통합

수집된 정보를 하나의 문서로 합친다.

통합 규칙:
- 소스별 섹션으로 구분
- 각 섹션에서 "하이라이트" (중요 항목 3개 이내)를 선별
- 액션 아이템을 문서 하단에 모아서 정리
- 수집 실패한 소스는 "수집 실패" 표시와 함께 사유 기록

### 3단계: 문서 저장

결과 파일을 저장한다.

```
저장 위치: sync/YYYY-MM-DD-context-sync.md
```

### 4단계: 리포트

실행 결과를 사용자에게 보고한다.

```
싱크 완료!

수집 결과:
  Slack: 3개 채널, 47개 메시지
  Gmail: 12개 이메일 (안 읽음 5개)
  Calendar: 8개 일정
  Webex(마에스트로): 4개 방, 최근 24h 내 23개 메시지

하이라이트 4건:
  1. [Slack] #project-updates: 배포 일정 확정 (2/20)
  2. [Gmail] 파트너사 계약서 회신 필요 (기한: 2/18)
  3. [Calendar] 내일 10시 팀 미팅 (발표 자료 준비 필요)
  4. [Webex] 사무국 공지: 자유멘토링 보고서 페이지 지연 오픈

액션 아이템 5건:
  - [ ] 파트너사 계약서 회신
  - [ ] 팀 미팅 발표 자료 준비
  - [ ] Slack #general 공지 확인
  - [ ] 기한 초과 태스크 처리
  - [ ] 마에스트로 특강 증빙 자료 별도 보관

파일 저장: sync/2026-03-04-context-sync.md
```

> 의미 있는 변화가 있으면 다음 단계로 "위키 갱신"(wiki ingest) 트리거를 제안한다. 자동 ingest는 하지 않음 — Karpathy LLM Wiki 패턴은 선별적 ingest가 원칙. 자세한 운영은 `~/ai-workspace/CLAUDE.md`의 "Wiki 운영" 섹션 참고.

## 출력 포맷

3곳에 동시 출력한다:

1. **Markdown 파일** (기본, 항상 실행) -- `sync/YYYY-MM-DD-context-sync.md`에 저장
2. **Slack 메시지** -- 요약을 Slack 채널에 발송
3. **Notion DB 엔트리** -- `Context Sync DB`에 날짜별 엔트리로 누적 저장

### 출력 1: Markdown 파일

저장 위치: `sync/YYYY-MM-DD-context-sync.md`

```markdown
# Context Sync - YYYY-MM-DD

> 자동 수집 시각: HH:MM (KST)

## 하이라이트

- **[Slack]** 주요 공지 요약
- **[Gmail]** 중요 메일 요약
- **[Calendar]** 오늘 핵심 일정
- **[Webex]** 마에스트로 주요 공지/멘션

## Slack (개인 워크스페이스)

### #소셜
- 자유 채널 주요 메시지

### #전체
- 공지사항

## 외부 Slack (Gmail 간접 수집)

### Workspace A
- AI프로젝트 진행 상황, 미팅 조율

### Workspace B
- 교육 일정 조율, 튜터 관련 공지

## Webex — AI·SW마에스트로

### 🏛️ 서울센터 활동 그룹 (메인)
- 자유멘토링/특강 모집 (비기술 주제 우선)
- 화제/이슈 요약

### 👥 멘토 그룹
- 운영 규정 Q&A, 사무국 답변

### 📢 사무국 공지사항
- 공식 공지 (규정, 보고서, 설문 등)

### 💬 User 개인 멘토링방
- 멘티 질문, 답장 필요 항목

## SWMaestro — MY 멘토링 현황 (서울)

| 구분 | 제목 | 일시 | 신청/정원 | 상태 | 신청자 |
|------|------|------|-----------|------|--------|
| 자유멘토링 | 제목1 | 4/24(목) 10:00~12:00 | 3/5 | 접수중 | 홍길동, 김철수, 이영희 |
| 멘토특강 | 제목2 | 4/30(수) 14:00~16:00 | 0/8 | 접수중 | - |

## SWMaestro — MY 멘토링 현황 (부산)

| 구분 | 제목 | 일시 | 신청/정원 | 상태 | 신청자 |
|------|------|------|-----------|------|--------|
| 멘토특강 | 제목 | 5/22(금) 15:00~17:00 | 1/7 | 접수중 | 이동원 |

> 부산 0건이면 "부산 — 개설된 항목 없음"으로만 표시.
> 수집 실패 시: "SWMaestro {서울|부산} 세션 만료 — auth 재실행 필요" 표시

## SWMaestro — 보고서 제출 현황 (서울 + 부산)

| 센터 | 구분 | 진행날짜 | 상태 | 인정시간 | 지급액 |
|------|------|----------|------|----------|--------|
| 서울 | 자유 멘토링 | 2026-04-10 | 승인 | 02:00 | 400,000원 |
| 부산 | 멘토 특강 | 2026-05-22 | 접수중 | - | - |

> 미제출 건이 있으면 액션 아이템으로 표시. 부산 0건이면 행 생략.

## SWMaestro — 회의실 예약내역 (서울 + 부산)

| 센터 | 회의실 | 사용기간 | 제목 | 상태 |
|------|--------|----------|------|------|
| 서울 | 7층 스페이스 S1-2 | 2026.05.01 10:00~11:59 | 멘토특강 | 예약완료 |
| 부산 | 하이텐 - 22호실(8인) | 2026.05.23 10:00~11:59 | 멘토링특강 | 예약완료 |

> 회의실 예약은 됐는데 멘토링/특강 게시판에 안 올라온 건 = "강의 개설 누락" 가능성 → 액션 아이템으로 표시.

## Gmail

| 발신자 | 제목 | 상태 |
|--------|------|------|
| 발신자1 | 제목1 | 회신 필요 |
| 발신자2 | 제목2 | 읽음 |

## Google Calendar

### 오늘
- 09:00 미팅1 (30분)
- 14:00 미팅2 (1시간)

### 이번 주
- 주요 일정 목록

## 액션 아이템

- [ ] 액션1
- [ ] 액션2
```

### 출력 2: Slack 메시지

Markdown 저장 후, 하이라이트와 액션 아이템만 추려서 Slack에 발송한다.

```
발송 방법:
  mcp__claude_ai_Slack__slack_send_message 호출.
  channel_id와 message를 전달한다.

발송 채널: #user-personal의-워크스페이스-전체 (CXXXXXXXXX3)

메시지 형식:
  📋 **Context Sync - YYYY-MM-DD**

  **하이라이트**
  • [Slack] 주요 항목
  • [Gmail] 주요 항목
  • [Calendar] 주요 항목

  **액션 아이템**
  • 액션1
  • 액션2

  📄 전체 문서: sync/YYYY-MM-DD-context-sync.md
```

### 출력 3: Notion DB 엔트리

Markdown 저장 후, 전체 싱크 문서를 **Context Sync DB**에 신규 엔트리로 추가한다.
(개별 페이지를 난립시키지 않고 DB에 날짜별로 누적한다.)

```
생성 방법:
  mcp__claude_ai_Notion__notion-create-pages 호출.
  parent는 data_source_id 형태로 전달한다.
  properties에 DB 스키마 필드를 채운다.
  content에 마크다운 본문을 넣는다.
  아이콘: 📋

parent:
  {
    "type": "data_source_id",
    "data_source_id": "00000000-0000-0000-0000-000000000001"
  }

DB 위치:
  - 부모 페이지: "Context Sync" (page_id: 00000000-0000-0000-0000-000000000003)
  - DB: "Context Sync DB" (database_id: 00000000-0000-0000-0000-000000000002)
  - Data source: collection://00000000-0000-0000-0000-000000000001

DB 스키마 (정확한 property 이름 사용 필수):
  - "Title" (TITLE) → "Context Sync - YYYY-MM-DD"
  - "Date" (DATE) → 확장 속성으로 전달:
      "date:Date:start": "YYYY-MM-DD"
      "date:Date:is_datetime": 0
  - "Sources" (MULTI_SELECT) → JSON array string, 예: ["Slack","Gmail","Calendar","Webex"]
      (이번 싱크에서 실제로 수집에 성공한 소스만 포함. 수집 실패한 소스는 제외)
  - "Highlights" (NUMBER) → 하이라이트 개수 (정수)
  - "Actions" (NUMBER) → 액션 아이템 개수 (정수)
  - "Status" (SELECT) → "완료" / "일부 실패" / "실패"
      - 모든 소스 성공: "완료"
      - 1개 이상 실패: "일부 실패"
      - 전체 실패: "실패"

content:
  Markdown 파일과 동일한 전체 내용 (하이라이트, 소스별 섹션, 액션 아이템).
  페이지 타이틀은 properties의 "Title"에서만 설정하고, content 본문 상단에 #
  제목을 중복해서 넣지 않는다.

호출 예시:
  mcp__claude_ai_Notion__notion-create-pages(
    parent={"type": "data_source_id", "data_source_id": "00000000-0000-0000-0000-000000000001"},
    pages=[{
      "icon": "📋",
      "properties": {
        "Title": "Context Sync - 2026-04-14",
        "date:Date:start": "2026-04-14",
        "date:Date:is_datetime": 0,
        "Sources": "[\"Slack\",\"Gmail\",\"Calendar\",\"Webex\"]",
        "Highlights": 4,
        "Actions": 7,
        "Status": "완료"
      },
      "content": "<전체 마크다운 본문>"
    }]
  )
```

> **주의**: 절대 workspace-level 개별 페이지로 생성하지 말 것. 반드시 DB에 추가.
> DB/부모 페이지/data source ID가 변경되면 이 섹션의 하드코딩된 값을 업데이트할 것.

## 커스터마이징 가이드

### 소스 추가하기

새로운 소스를 추가하려면 "소스 정의" 섹션에 같은 형식으로 추가한다:

```markdown
### 소스 4: Notion

| 항목 | 값 |
|------|-----|
| MCP 도구 | Notion MCP 서버 |
| 수집 범위 | 지정된 데이터베이스 |

수집 방법:
  mcp__claude_ai_Notion__notion-search 호출.

추출할 정보:
- 진행 중인 태스크
- 기한이 임박한 항목
```

### 소스 제거하기

사용하지 않는 소스는 해당 "소스 N" 섹션 전체를 삭제한다.
실행 흐름의 병렬 수집 부분에서도 해당 줄을 제거한다.
