---
name: my-maestro
description: AI·SW마에스트로(서울/부산) 멘토 활동 통합 관리. MY 멘토링·보고서 현황, 회의실 예약내역, 빈 회의실 조회, Webex 메시지 수집을 담당. User 멘토 전용. "마에스트로", "MY 멘토링", "내 예약", "빈 회의실", "회의실 비어있", "보고서 현황", "마에스트로 공지" 요청에 사용.
triggers:
  - "마에스트로"
  - "MY 멘토링"
  - "내 멘토링"
  - "내 예약"
  - "예약 내역"
  - "예약 확인"
  - "빈 회의실"
  - "회의실 비어있"
  - "회의실 빈자리"
  - "보고서 현황"
  - "마에스트로 공지"
  - "마에스트로 메시지"
---

# My Maestro

AI·SW마에스트로 멘토(User, 비기술멘토 — 창업/투자) 활동 통합 관리 스킬.

서울센터 + 부산센터 양쪽을 모두 다룬다. SWMaestro 홈페이지(`swmaestro.ai`)는 Playwright 스크래퍼로,
Webex 메시지는 MCP 서버(`mcp__webex-messaging__*`)로 수집한다.

## 트리거 → 기능 매핑

| 사용자 요청 예시 | 호출할 기능 |
|------------------|-------------|
| "마에스트로 현황", "마에스트로 정리해줘" | 기능 1+2+3+4 모두 |
| "MY 멘토링", "내 멘토링 현황", "보고서 현황" | 기능 1 |
| "내 예약", "예약 내역", "예약 확인" | 기능 2 |
| "5/23 빈 회의실", "회의실 비어있는 시간" | 기능 3 |
| "마에스트로 공지", "마에스트로 메시지" | 기능 4 |

## 기능 1: MY 멘토링 + 보고서 현황 (서울 + 부산)

| 항목 | 값 |
|------|-----|
| 도구 | `scripts/swmaestro-scraper/scrape-my-mentoring.js` (Playwright) |
| 결과 | `output/my-mentoring-latest.json` (서울), `output/my-mentoring-busan-latest.json` (부산) |

수집 명령:
```bash
cd scripts/swmaestro-scraper
zsh -i -c 'node scrape-my-mentoring.js --with-applicants'                # 서울
zsh -i -c 'node scrape-my-mentoring.js --center=busan --with-applicants' # 부산
```

> ⚠️ `zsh -i -c '...'` 필수 — Claude Code Bash는 non-interactive 셸이라
>    ~/.zshrc의 `SWMAESTRO_ID/PW` 환경변수를 로드하지 않는다.

추출 데이터:
- **MY 멘토링/특강**: 제목, 카테고리(자유멘토링/멘토특강), 일시, 모집인원(신청/정원), 상태(접수중/마감/진행완료), 신청자 명단
- **보고서 제출**: 구분, 진행날짜, 상태(접수중/승인/반려), 인정시간, 지급액

## 기능 2: 회의실 예약내역 (서울 + 부산)

| 항목 | 값 |
|------|-----|
| 도구 | `scripts/swmaestro-scraper/scrape-my-reservations.js` |
| 결과 | `output/my-reservations-latest.json` (서울+부산 통합) |

수집 명령:
```bash
cd scripts/swmaestro-scraper && zsh -i -c 'node scrape-my-reservations.js'

옵션:
  --center=seoul|busan  # 한쪽만
  --month=YYYY-MM       # 특정 월 (기본: 이번 달)
```

추출 데이터: 회의실명, 사용기간, 제목, 작성자, 상태, 등록일

## 기능 3: 빈 회의실 조회 (날짜·시간·인원 필터)

| 항목 | 값 |
|------|-----|
| 도구 | `scripts/swmaestro-scraper/scrape-rooms.js` |
| 결과 | `output/rooms-{center}-{date}.json` |

수집 명령:
```bash
cd scripts/swmaestro-scraper
zsh -i -c 'node scrape-rooms.js --center=seoul --date=2026-05-23'

추가 필터:
  --time=HH:MM-HH:MM       # 그 시간대 전체가 비어있는 회의실만
  --capacity-min=N         # N인 이상
```

활용 예시:
- "5/23 부산 빈 회의실 알려줘" → `--center=busan --date=2026-05-23`
- "5/23 서울 14-16시 6인 이상" → `--center=seoul --date=2026-05-23 --time=14:00-16:00 --capacity-min=6`

> 페이지 구조 메모: HTML에서 `<span class="not-reserve">`는 **점유된** 슬롯 (역설적 클래스명).
> 클래스 없는 일반 `<span>`이 빈 슬롯이다.

## 기능 4: Webex 마에스트로 메시지 수집

| 항목 | 값 |
|------|-----|
| 도구 | `mcp__webex-messaging__list_rooms`, `mcp__webex-messaging__list_messages` |
| 수집 범위 | 최근 24~48시간 |

대상 채팅방 (우선순위 순):

```yaml
rooms:
  - title: "2026년 서울센터 활동 그룹"
    purpose: "서울 메인 — 멘토/연수생/사무국 공용, 자유멘토링·특강 모집글, 자기소개"
  - title: "2026년 부산센터 활동그룹"
    purpose: "부산 메인 — 멘토/엑스퍼트/사무국/부산센터 연수생"
  - title: " 멘토 그룹"
    purpose: "멘토 전용 Q&A — 운영 규정, 공문, 시간 인정 등 (서울/부산 통합)"
  - title: "[서울] 공지사항"
    purpose: "서울센터 사무국 공식 공지 (보고서 마감, 규정 변경 등)"
  - title: "[부산] 공지사항"
    purpose: "부산센터 사무국 공식 공지"
  - title: "공지사항"
    purpose: "팀별 공지사항 (서울/부산 각각의 team 하위)"
  - title: "User멘토_*", "*_User멘토_*", "서울_제17기_*"
    purpose: "User 개인 팀 멘토링방 — 멘티 메시지, 답장 필요 항목"
```

수집 절차:
```
1. mcp__webex-messaging__list_rooms(sortBy="lastactivity", max=30)
2. 위 대상 채팅방 제목과 매칭되는 roomId 추출
   - "User" 포함된 방, "서울_제17기_*" 직접 멘토링방 = 모두 수집
   - 정확 매칭 + 부분 매칭 혼용
3. 각 방에 대해 병렬로 list_messages(roomId=..., max=30)
4. created 타임스탬프 기준 최근 24~48시간 메시지만 필터링
```

추출할 정보:
- **자유멘토링/특강 모집**: 비기술(창업/투자/BM/UX) 주제 우선, 기술 주제는 제목·멘토명만
- **사무국 공지사항**: 규정 변경, 보고서 제출 마감, 설문 등
- **User 개인 멘토링방의 멘티 질문/답장 필요 항목**
- **비기술멘토 역할 관련 논의**: "비기술멘토", "창업", "VC" 키워드
- **오프라인 일정**: 센터 방문, 특강, 멘토링 시간

## 통합 출력 포맷

기능 1+2+3+4 모두 호출되는 "마에스트로 현황" 트리거 시 다음 마크다운 구조로 출력:

```markdown
# 마에스트로 현황 - YYYY-MM-DD

> 수집 시각: HH:MM (KST)

## 🚨 액션 아이템 (우선순위 순)
- [ ] (오늘/내일 마감인 보고서·설문)
- [ ] (회의실은 잡혔는데 멘토링/특강 게시판 미개설)
- [ ] (모객 부진 — 마감 임박한 미달 특강)
- [ ] (멘티 질문 답장 필요)

## 📚 MY 멘토링·특강 (서울)

| 카테고리 | 제목 | 일시 | 신청/정원 | 상태 | 신청자 |
|----------|------|------|-----------|------|--------|
| 멘토특강 | ... | ... | 1/10 | 접수중 | ... |

## 📚 MY 멘토링·특강 (부산)

(동일 표 형식)

## 📝 보고서 현황 (서울 + 부산)

| 센터 | 구분 | 진행날짜 | 상태 | 인정시간 | 지급액 |

## 🏢 회의실 예약내역 (서울 + 부산)

| 센터 | 회의실 | 사용기간 | 제목 | 상태 |

## 💬 Webex 마에스트로 (최근 24~48h)

### 📢 공지사항 (서울)
### 📢 공지사항 (부산)
### 👥 멘토 그룹 Q&A
### 🏛️ 서울센터 활동 그룹
### 🏛️ 부산센터 활동그룹
### 💬 User 개인 멘토링방
```

부분 트리거(예: "내 예약")일 때는 해당 섹션만 출력.

## 빈 회의실 조회 출력 포맷

"5/23 빈 회의실" 같은 즉석 요청 시:

```markdown
# 📅 {center.upper} 회의실 빈 슬롯 ({date})

(필터: ⏰ 14:00-16:00 / 👥 6인 이상)

## 🎯 조건 부합 회의실 (필터 적용 시)
- 스페이스 A1 (4인)
- ...

## 🟡 회의실별 가용 시간 구간
- ✅ 스페이스 A3 (4인): 전체 가능
- 🟡 스페이스 A1 (4인): 09:00~10:00, 15:00~15:30, 17:30~18:00
- ❌ 스페이스 M2 (8인): 빈 슬롯 없음
```

## 컨텍스트 싱크와의 관계

`my-context-sync`(일일 통합 싱크)는 my-maestro의 결과 JSON 파일을 직접 읽어 마에스트로 섹션을 구성한다.

- my-maestro가 결과 JSON을 갱신 → `scrapedAt` 타임스탬프 포함
- my-context-sync는 그 파일을 읽어 사용. 신선도 판단:
  - 4시간 이내 → 그대로 사용
  - 4~24시간 → "N시간 전 수집된 데이터"로 표시 + 갱신 여부 사용자에게 한 번 묻기
  - 24시간 초과 → my-maestro 자동 재실행 권장

## 초기 세팅 (맥별 1회)

```bash
cd ~/ai-workspace/scripts/swmaestro-scraper
npm install
npx playwright install chromium

# ~/.zshrc에 환경변수 설정
export SWMAESTRO_ID="아이디"
export SWMAESTRO_PW="비밀번호"
```

세션 만료 시 환경변수가 있으면 자동 재로그인. 없으면 `node auth-setup.js`로 수동.

서울/부산 세션 파일은 분리:
- 서울: `storage/swmaestro-state.json`
- 부산: `storage/swmaestro-busan-state.json`

Webex MCP는 별도 세팅 (`~/ai-workspace/CLAUDE.md`의 Webex MCP 섹션 참조).
