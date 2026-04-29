---
name: my-fetch-youtube
description: YouTube URL을 받으면 자막을 추출하고, Web Search로 자동자막 오류를 보정한 뒤, 요약-인사이트-전체 번역을 제공하는 스킬. "유튜브 번역", "영상 정리", "YouTube 요약" 요청에 사용.
---

# My Fetch YouTube

YouTube URL에서 자막을 추출하고, Web Search로 자동자막 오류를 보정한 뒤,
요약-인사이트-전체 번역 3단계 파이프라인으로 제공하는 스킬.

## 1단계: 메타데이터 + 자막 가용성 판정

먼저 `yt-dlp --dump-json`으로 메타데이터와 자막 가용성을 한 번에 조회한다.
이 결과로 어떤 자막을 받을지 결정한 뒤, 필요한 자막만 단일 다운로드한다.

```bash
yt-dlp --dump-json --no-download "{URL}"
```

### 핵심 필드

| 필드 | 설명 |
|------|------|
| `title` | 영상 제목 (Web Search 키워드 추출 입력) |
| `description` | 영상 설명 (동일) |
| `channel` | 채널명 |
| `duration` | 영상 길이 (초) |
| `chapters` | 챕터 목록 (있으면 번역 단계에서 구조화 사용) |
| `subtitles` | **수동 자막 가용 언어 dict** (예: `{"ko": [...], "en": [...]}`) |
| `automatic_captions` | **자동 자막 가용 언어 dict** |

### 자막 우선순위 (수동 > 자동, ko > en)

YouTube의 자막 키는 `ko`, `en`처럼 짧은 코드뿐 아니라 `ko-KR`, `en-US`, `en-orig`, `en-GB` 같은 **locale 변형**으로 들어오는 경우가 많다. 따라서 키 자체로 매치하지 않고 `key.split('-')[0]` 의 prefix로 비교한다.

1. `subtitles`에 prefix `ko` 인 키 존재 → 한국어 수동 자막
2. `subtitles`에 prefix `en` 인 키 존재 → 영어 수동 자막
3. `automatic_captions`에 prefix `ko` 인 키 존재 → 한국어 자동 자막
4. `automatic_captions`에 prefix `en` 인 키 존재 → 영어 자동 자막
5. 모두 없음 → "이 영상에는 자막이 없습니다. 다른 영상을 선택해주세요"

판정용 Python 헬퍼 (한 번에 4가지 결과를 뽑는다):

```python
import json, sys, subprocess
meta = json.loads(subprocess.check_output(['yt-dlp', '--dump-json', '--no-download', URL]))
subs = meta.get('subtitles') or {}
auto = meta.get('automatic_captions') or {}

def first_match(d, prefix):
    for k in d:
        if k.split('-')[0].lower() == prefix:
            return k
    return None

manual_ko = first_match(subs, 'ko')
manual_en = first_match(subs, 'en')
auto_ko = first_match(auto, 'ko')
auto_en = first_match(auto, 'en')
```

## 2단계: 자막 다운로드 (조건부 단일 호출)

위 판정 결과에 따라 **하나의 명령만** 실행한다. 무조건 `--write-auto-sub`을 호출하지 않는다 (수동 자막이 있는데 자동 자막을 받으면 품질 손실).

`--sub-lang` 에는 1단계에서 찾아둔 **실제 키**를 그대로 넘긴다 (예: `en-US`, `ko-KR`).

| 판정 결과 | 명령 |
|---|---|
| 수동 ko (`manual_ko`) | `yt-dlp --write-sub --sub-lang $manual_ko --skip-download --convert-subs vtt -o "%(title)s" "{URL}"` |
| 수동 en (`manual_en`) | `yt-dlp --write-sub --sub-lang $manual_en --skip-download --convert-subs vtt -o "%(title)s" "{URL}"` |
| 자동 ko/en | `yt-dlp --write-auto-sub --sub-lang "$auto_ko,$auto_en" --skip-download --convert-subs vtt -o "%(title)s" "{URL}"` (None인 쪽은 빼고) |

> `--write-sub`는 **수동 자막만**, `--write-auto-sub`는 **자동 자막만** 다운로드한다. 둘 다 받으려면 두 플래그를 같이 줘야 한다 (이 스킬은 우선순위에 따라 하나만 받는다).

옵션 의미:
- `--skip-download`: 영상 본체 다운로드 안 함 (자막만)
- `--convert-subs vtt`: VTT 형식으로 변환

### VTT → 순수 텍스트 정제

```bash
cat "{자막파일}.vtt" | \
  sed -E 's/^[0-9]+$//' | \
  sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}.*//g' | \
  sed -E 's/<[^>]+>//g' | \
  tr -s '\n' | \
  grep -v '^$'
```

1. 번호 줄 제거
2. 타임스탬프 줄 제거
3. HTML/웹 형식 태그 제거
4. 연속 빈 줄 하나로 압축
5. 빈 줄 제거

## 3단계: Web Search 보정 (자동 자막일 때만)

수동 자막은 사람이 작성했으므로 신뢰하고 보정 단계를 **건너뛴다**.
자동 자막일 때만 메타데이터의 키워드로 웹 검색하여 음성 인식 오류를 바로잡는다.

### Step 1: 키워드 추출

영상 제목(`title`)과 설명(`description`)에서 5-10개 키워드를 추출한다:

- **고유명사**: 사람 이름, 회사명, 제품명
- **전문 용어**: 기술 용어, 학술 용어
- **약어**: API, LLM, RAG 등

### Step 2: WebSearch 병렬 실행

추출한 키워드로 웹 검색을 병렬로 실행한다:

- `"{키워드} 정확한 표기"`
- `"{사람 이름} {회사명}"`
- `"{전문 용어} explained"`

### Step 3: 자동 자막 보정

검색 결과를 바탕으로 자막의 오류를 수정한다. 보정 내역을 기록한다.

### 보정 예시

| 보정 전 (자동 자막) | 보정 후 | 근거 |
|---------------------|---------|------|
| "Cloud can now..." | "**Claude** can now..." | Anthropic의 AI 모델명 |
| "앤트로피가 발표한" | "**Anthropic**이 발표한" | 회사명 정확한 표기 |
| "GP four turbo" | "**GPT-4 Turbo**" | OpenAI 모델명 |
| "a line of code" | "**Aline Lerner** of..." | 인터뷰 대상자 이름 |

## 4단계: 번역 파이프라인 — 3단계

보정된 자막(또는 신뢰 가능한 수동 자막 원본)을 바탕으로, fetch-tweet과 동일한 3단계로 번역한다.

### 4-1. 요약 (3-5문장)

- 영상의 핵심 내용을 한국어로 요약
- 채널명, 영상 길이 포함
- "이 영상이 뭘 말하는지 30초 만에 파악"

### 4-2. 인사이트 (3개)

- **핵심 메시지**: 이 영상이 정말 말하고 싶은 것
- **시사점**: 업계/트렌드에서의 의미
- **적용점**: 나(시청자)에게 어떤 의미인지

### 4-3. 전체 번역된 아티클

- 영상 전체를 읽기 쉬운 **아티클 형태**로 번역
- 챕터가 있으면 챕터별로 구분하여 구조화
- Web Search로 보정된 용어 사용 (자동 자막일 때만 해당)
- 전문 용어는 원문 병기 (예: "에이전트(Agent)")

## 긴 영상 처리

영상 길이가 10분 이상인 경우, 자막 텍스트가 매우 길어질 수 있다.
이 경우 **Task Agent**를 사용하여 별도 프로세스에서 번역을 처리한다.

```
긴 영상 → Task Agent에서 자막 정제 + (자동 자막일 때) 보정 + 번역 → 결과를 메인 세션에 반환
```
