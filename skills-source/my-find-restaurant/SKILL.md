---
name: my-find-restaurant
description: 네이버 로컬 검색 API로 식당을 찾고, 선택한 식당을 캘린더 일정에 반영한다. "식당 찾아줘", "맛집 추천", "근처 밥집", "find restaurant" 요청에 사용.
triggers:
  - "식당 찾아줘"
  - "맛집 추천"
  - "근처 밥집"
  - "find restaurant"
---

# My Find Restaurant

네이버 로컬 검색 API를 활용하여 식당을 검색하고,
선택한 식당을 Google Calendar 일정에 반영하는 스킬.

- 검색 API: 네이버 로컬 검색 (developers.naver.com)
- 캘린더: Google Calendar MCP (claude.ai Connectors)

> 참고: route-planner의 NCP_CLIENT_ID(네이버 클라우드)와 다른 플랫폼(네이버 개발자센터). 별도 키 필요.

## 사전 검증

이 스킬이 트리거되면, 가장 먼저 환경변수가 설정되어 있는지 확인한다.

```bash
source ~/.zshrc && echo "NAVER_CLIENT_ID: ${NAVER_CLIENT_ID:-미설정}" && echo "NAVER_CLIENT_SECRET: $(if [ -n "$NAVER_CLIENT_SECRET" ]; then echo 설정됨; else echo 미설정; fi)"
```

하나라도 미설정이면 실행을 중단하고 안내한다:

```
환경변수가 설정되지 않았습니다. ~/.zshrc에 다음을 추가해주세요:

export NAVER_CLIENT_ID="네이버 개발자센터 Client ID"
export NAVER_CLIENT_SECRET="네이버 개발자센터 Client Secret"

발급: https://developers.naver.com → Application → 검색 API 선택
설정 후 터미널을 재시작하거나 source ~/.zshrc를 실행해주세요.
```

## 기본값 설정

```yaml
defaults:
  home_address: "서울시 OO구 OO로 N"
  home_coords: "127.0000000,37.0000000"
  default_display: 5
  sort: "comment"   # 리뷰 많은 순
```

장소 별칭:
```yaml
aliases:
  집: "서울시 OO구 OO로 N"
  집 근처: "양재동"
```

## 검색 흐름

### 1단계: 요청 파싱

사용자 요청에서 3가지를 추출한다:

| 항목 | 예시 | 미지정 시 |
|------|------|----------|
| 지역 | "매봉역", "홍천" | 집 주변 (양재동) |
| 카테고리 | "한식", "고기", "일식" | 미포함 |
| 조건 | "룸", "8인", "주차" | 미포함 |

### 2단계: 지역 결정

```
지역 직접 지정 → 그대로 사용
  ↓ (미지정)
캘린더 일정 연계 요청 → 해당 일정의 location에서 추출
  ↓ (location 없음)
집 주소 기본값 → "양재동"으로 변환
```

캘린더 일정 연계 시:
1. `gcal_list_events`로 해당 날짜 일정 조회
2. 일정의 `location` 필드에서 지역명 추출
3. location이 좌표가 아닌 주소인 경우 지역명(동/구/시) 추출

### 3단계: 검색어 자동 조합 & 다단계 검색

조건이 많으면 결과가 0건일 수 있으므로, 최대 3회 검색한다:

```
1차: "{지역} {카테고리} {조건1} {조건2}"   (전체)
2차: "{지역} {카테고리} {조건1}"            (조건 축소)
3차: "{지역} {카테고리}"                    (최소)
```

각 단계에서 결과가 2건 이상이면 다음 단계로 넘어가지 않는다.

### 4단계: API 호출

bash 코드블록으로 curl 호출. route-planner와 동일한 패턴:

```bash
source ~/.zshrc && curl -s "https://openapi.naver.com/v1/search/local.json?query=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("{검색어}"))')&display=5&sort=comment" \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET" | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
if 'items' in d:
    for i in d['items']:
        name = re.sub('<[^>]+>','',i['title'])
        print(f'{name}|{i[\"category\"]}|{i[\"roadAddress\"]}|{i[\"telephone\"]}|{i[\"mapx\"]}|{i[\"mapy\"]}')
else:
    print('ERROR:' + json.dumps(d, ensure_ascii=False))
"
```

### 5단계: 결과 병합 & 중복 제거

다단계 검색 결과를 합친 뒤 `roadAddress` 기준으로 중복 제거.

### 6단계: 블로그 후기 검색 (평판 보강)

로컬 검색 결과의 각 식당에 대해 블로그 후기를 검색한다.
검색어: "{지역} {식당명} 맛집" 또는 "{지역} {카테고리} 혼밥 맛집"

```bash
source ~/.zshrc && curl -s "https://openapi.naver.com/v1/search/blog.json?query=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("{검색어}"))')&display=3&sort=sim" \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET" | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
if 'items' in d:
    print(f'BLOG_TOTAL:{d[\"total\"]}')
    for i in d['items']:
        title = re.sub('<[^>]+>','',i['title'])
        print(f'{title}|{i[\"link\"]}|{i[\"postdate\"]}')
else:
    print('BLOG_ERROR')
"
```

블로그 검색 활용 규칙:
- 로컬 검색 결과가 나온 뒤, 해당 지역+카테고리로 블로그 1회 검색
- 블로그 후기 수(`total`)가 많을수록 검증된 식당
- 블로그 링크를 결과에 포함하여 사용자가 직접 후기 확인 가능
- 블로그 검색 실패 시 로컬 검색 결과만으로 진행 (에러 무시)

## 결과 출력

### 기본 결과 (로컬 검색)

```
🍽️ {지역} {카테고리} 검색 결과 ({N}건)

| # | 식당 | 카테고리 | 주소 | 전화 | 지도 |
|---|------|---------|------|------|------|
| 1 | OOO | 한식>소고기구이 | 언주로 201 | 02-xxxx-xxxx | 🗺️ |
| 2 | OOO | 한식>돼지갈비 | 남부순환로 2726 | — | 🗺️ |
```

### 블로그 후기 (평판 보강)

로컬 검색 결과 아래에 블로그 후기를 추가 표시한다:

```
📝 블로그 후기 ({total}건 중 상위 3건)

| # | 식당 | 블로그 한줄평 | 후기 |
|---|------|-------------|------|
| 1 | OOO | "혼밥으로 짱, 블루리본 선정" | 🔗 후기링크 |
| 2 | OOO | "개인화로, 저렴한 1인 고기" | 🔗 후기링크 |

번호를 말씀해 주시면 캘린더 일정에 반영합니다.
```

### 출력 규칙

- 🗺️ 링크: `https://map.naver.com/search/{식당명}` (네이버 지도 직접 연결)
- 전화번호 없는 경우 `—` 표시
- 블로그 한줄평: 블로그 제목에서 핵심 키워드 추출
- 블로그 후기가 없으면 로컬 검색 결과만 표시
- 0건인 경우: "검색 결과가 없습니다. 다른 키워드로 시도해 볼까요?"

## 캘린더 연동

사용자가 번호 또는 식당명으로 선택하면:

### 일정 탐색

```
사용자가 일정 명시 ("28일 가족점심에 넣어줘") → 해당 일정 검색
사용자가 미명시 → "어떤 일정에 연결할까요?" 질문
```

### 일정 업데이트

```
gcal_update_event(
  calendarId: "primary",
  eventId: "{대상 일정 ID}",
  event: {
    location: "{식당 도로명주소} {식당명}",
    description: 기존 설명 + "\n🍽️ 식당: {식당명}\n📞 {전화번호}\n🗺️ https://map.naver.com/search/{식당명}"
  }
)
```

### 확인 메시지

```
✅ "{일정명}" 일정에 {식당명} 추가 완료!
   📍 {주소}
   📞 {전화번호}
   🗺️ 네이버 지도 링크
```

### 캘린더 일정이 없는 경우

결과만 보여주고 종료. 불필요한 일정 생성은 하지 않는다.

## 에러 처리

| 상황 | 대응 |
|------|------|
| API 키 미설정 | 발급 안내 후 중단 |
| 검색 결과 0건 | 키워드 변경 제안 |
| API 호출 실패 / 네트워크 오류 | 에러 메시지 표시, 재시도 제안 |
| API Rate Limit 초과 (429) | "일일 API 호출 한도(25,000건) 초과" 안내 |
| 캘린더 일정 못 찾음 | 일정명 다시 확인 요청 |
| 캘린더 업데이트 실패 | 에러 메시지 표시, 일정 ID/권한 확인 요청 |

## 실행 흐름

### 시나리오 A: 직접 검색

"매봉역 8인 룸 한식" 과 같이 요청하면:

1. 요청에서 지역("매봉역"), 카테고리("한식"), 조건("8인", "룸") 파싱
2. 다단계 검색 실행 (3단계 참조)
3. 결과 테이블 출력
4. 사용자가 번호 선택 시 캘린더 연동

### 시나리오 B: 캘린더 일정 연계 검색

"홍천 교육 끝나고 저녁 먹을 곳" 과 같이 요청하면:

1. 캘린더에서 해당 일정 조회
   ```
   mcp__claude_ai_Google_Calendar__gcal_list_events(
     calendarId="primary",
     timeMin="{해당 날짜}T00:00:00",
     timeMax="{해당 날짜}T23:59:59",
     timeZone="Asia/Seoul"
   )
   ```
2. 일정의 location 필드에서 지역명 추출
3. 추출된 지역 + 사용자 요청 키워드로 검색
4. 결과 테이블 출력
5. 사용자가 번호 선택 시 캘린더 연동

### 시나리오 C: 지역 미지정

"근처 한식 룸" 과 같이 지역 없이 요청하면:

1. 집 주소 기본값 사용 → "양재동"으로 변환
2. "양재동 한식 룸"으로 검색
3. 이후 시나리오 A와 동일
