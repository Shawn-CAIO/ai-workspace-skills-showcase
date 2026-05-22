---
name: my-session-wrap
description: 세션 종료 시 작업 정리, 문서 업데이트, 학습 기록을 하는 스킬. "/wrap", "세션 정리", "마무리" 요청에 사용.
---

# My Session Wrap

세션 마무리: **컨텍스트 수집 → 통합 보고서 → 기본 전부 실행**. 서브에이전트 없이 메인 LLM이 인라인으로 처리한다.

## Step 1: 컨텍스트 수집

병렬로:
- `git status` + `git diff --stat` (git 없으면 fallback: 대화에서 Write/Edit 한 파일 목록을 직접 수집)
- 대화 컨텍스트 스캔 — 새로 등장한 사람·회사·프로젝트·개념·결정·fact 추출 (wiki ingest 후보)

## Step 2: 통합 보고서

한 메시지로 아래 형식 출력. 변경 사항이 적으면 출력도 짧아야 한다.

```
## 세션 마무리

### 변경 요약
- 새로 생성: N개 / 수정: N개 / 삭제: N개

### 📚 학습 (learnings/ 저장 후보, 최대 5개)
- 핵심 한 줄 + (필요 시) 1~2줄 설명

### ✏️ 문서 업데이트
- CLAUDE.md / README 등에서 *실제 코드와 불일치* 발견 시만. 없으면 "없음".

### 🧠 Wiki ingest 후보
- 신규 페이지: [[people/...]], [[projects/...]] 등 (한 줄 사유)
- 갱신 페이지: 기존 페이지 + 갱신 사유 한 줄
- 없으면 "없음"

### ➡️ 다음 할 일 (최대 5개)
- TODO·FIXME·자연스러운 다음 단계
```

## Step 3: 기본 전부 실행 (사용자 confirm 없이)

보고서 출력 직후 아래를 자동 수행:

1. **learnings 저장** — `learnings/YYYY-MM-DD-session.md` (같은 날 두 번째면 `-session-2.md`)
2. **문서 업데이트** — 불일치 발견 항목이 있을 때만
3. **Wiki ingest** — 후보가 있을 때만. `wiki/concepts/llm-wiki-pattern.md` 규칙 따라 페이지 생성·갱신 + `wiki/index.md` 등록 + `wiki/log.md`에 `## [YYYY-MM-DD] ingest | ...` append
4. **git commit** — 변경 사항 있으면 보고서 요약을 메시지로

사용자가 보고서를 보고 "X는 빼자" 같이 막으면 그 항목만 스킵. 매번 4지선다로 묻지 않는다.

## Wiki ingest 후보 추출 기준

`wiki/` 디렉토리가 워크스페이스에 존재할 때만 작동 (Karpathy LLM Wiki 패턴 적용 시).

**후보 = 신규 또는 변경된 *사실(fact)*:**
- 새로 등장한 사람·회사·프로젝트·개념
- 기존 엔티티의 상태·사실 변화 (연락처, 계약 상태, 일정 등)
- 워크스페이스 외부 콘텐츠 학습 결과 (강의·트윗·논문 요약, content-digest 결과)
- 운영 규칙·반복되는 결정 패턴

**비-후보:**
- 단발성 작업 진행 상태 (TODO 같은 임시)
- 코드 변경 자체 (코드는 wiki 외부)
- 행동 규칙 — `~/.claude/memory/` (feedback type)이 더 적합

기준 모호하면 사용자에게 한 줄 확인 ("X 관련 fact를 wiki에 남길까요?").

## 세션 규모별 처리

- **작은 세션** (변경 0~3개 + wiki 후보 없음): 보고서만 짧게, "저장할 항목 없음" 결론 가능
- **보통 세션**: 위 흐름 그대로
- **거대 세션** (변경 100+ 또는 대화 매우 길어 메인 context로 분석 어려움): 분석 전담 서브에이전트 1개 호출 (escape hatch — 평소엔 사용 안 함)

## Fallback

- **Git 없음**: status·diff·commit 단계 스킵, learnings·wiki·문서는 그대로 진행
- **wiki/ 없음**: ingest 섹션 자체를 보고서에서 생략
