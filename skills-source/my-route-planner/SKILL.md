---
name: my-route-planner
description: 출발지/도착지 경로를 검색하고 소요시간을 역산하여 Google Calendar에 이동 일정을 자동 추가한다. 네이버 Directions 5(자동차) + ODsay(대중교통) API 사용. "이동경로", "경로 추가", "길찾기", "route" 요청에 사용.
triggers:
  - "이동경로"
  - "경로 추가"
  - "길찾기"
  - "route"
---

# My Route Planner

출발지/도착지 경로를 검색하고, 소요시간을 역산하여
Google Calendar에 이동 일정을 자동 추가하는 스킬.

- 자동차 경로: 네이버 Directions 5 API
- 대중교통 경로: ODsay API

## 사전 검증

이 스킬이 트리거되면, 가장 먼저 환경변수가 설정되어 있는지 확인한다.

```bash
source ~/.zshrc && echo "NCP_CLIENT_ID: ${NCP_CLIENT_ID:-미설정}" && echo "NCP_CLIENT_SECRET: $(if [ -n "$NCP_CLIENT_SECRET" ]; then echo 설정됨; else echo 미설정; fi)" && echo "ODSAY_API_KEY: $(if [ -n "$ODSAY_API_KEY" ]; then echo 설정됨; else echo 미설정; fi)" && echo "NAVER_CLIENT_ID: ${NAVER_CLIENT_ID:-미설정}" && echo "NAVER_CLIENT_SECRET: $(if [ -n "$NAVER_CLIENT_SECRET" ]; then echo 설정됨; else echo 미설정; fi)"
```

NCP 키 3개는 필수, NAVER 키 2개는 장소명 폴백용(선택)이다.
NCP 키가 하나라도 미설정이면 실행을 중단하고 안내한다.
NAVER 키가 미설정이면 경고만 출력하고 계속 진행한다 (장소명 검색 불가 안내).

```
[필수] 환경변수가 설정되지 않았습니다. ~/.zshrc에 다음을 추가해주세요:

export NCP_CLIENT_ID="네이버 클라우드 Client ID"
export NCP_CLIENT_SECRET="네이버 클라우드 Client Secret"
export ODSAY_API_KEY="ODsay Server API Key"

[선택 - 장소명 검색 폴백용]
export NAVER_CLIENT_ID="네이버 개발자센터 Client ID"
export NAVER_CLIENT_SECRET="네이버 개발자센터 Client Secret"

설정 후 터미널을 재시작하거나 source ~/.zshrc를 실행해주세요.
```

## 기본값 설정

```yaml
defaults:
  home_address: "서울시 OO구 OO로 N"
  home_coords: "127.0000000,37.0000000"
  buffer_minutes: 10
  transport_rule:
    서울: "transit"    # 🚇 대중교통 (ODsay)
    서울외: "driving"  # 🚗 자동차 (네이버 Directions 5)
  driving_option: "trafast"  # 가장 빠른 경로
```

장소 별칭:
```yaml
aliases:
  집: "서울시 OO구 OO로 N"
```

## API 호출

### 1단계: 주소 → 좌표 변환 (Geocoding)

주소를 좌표(위경도)로 변환한다. Bash 도구에서 curl로 호출한다.

**집 주소는 사전 캐싱된 좌표(127.0000000,37.0000000)를 사용하여 API 호출을 절약한다.**

"집" 등 별칭은 aliases에서 매핑하여 주소로 변환 후 처리한다.

```bash
source ~/.zshrc && curl -s "https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("{주소}"))')" \
  -H "x-ncp-apigw-api-key-id: $NCP_CLIENT_ID" \
  -H "x-ncp-apigw-api-key: $NCP_CLIENT_SECRET" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d['meta']['totalCount'] == 0:
    print('ERROR:NOT_FOUND')
elif d['meta']['totalCount'] > 1:
    print('MULTIPLE')
    for a in d['addresses']:
        print(f'{a[\"roadAddress\"]}|{a[\"x\"]},{a[\"y\"]}')
else:
    a=d['addresses'][0]
    print(f'{a[\"roadAddress\"]}|{a[\"x\"]},{a[\"y\"]}')
"
```

응답 추출:
- `addresses[0].x` → 경도 (longitude)
- `addresses[0].y` → 위도 (latitude)
- `addresses[0].roadAddress` → 도로명 주소 (서울 여부 판단에 사용)
- `addresses[0].jibunAddress` → 지번 주소 (roadAddress가 비어있을 때 폴백)

주소 추출 우선순위: `roadAddress` → `jibunAddress` (둘 중 비어있지 않은 것 사용)

Geocoding 에러 처리:
- 결과 0건 → **네이버 로컬 검색 API로 폴백** (아래 참조)
- 결과 여러 건 → 후보 목록을 보여주고 사용자가 선택

### 1-B단계: 장소명 폴백 (네이버 로컬 검색)

Geocoding 결과가 0건일 때 (장소명, 상호명, 건물명 등 주소가 아닌 입력),
네이버 로컬 검색 API로 장소를 찾아 좌표를 얻는다.

> 이 API는 `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` (네이버 개발자센터)을 사용한다.
> route-planner의 `NCP_CLIENT_ID` (네이버 클라우드)와 다른 키임에 주의.

```bash
source ~/.zshrc && curl -s "https://openapi.naver.com/v1/search/local.json?query=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("{장소명}"))')&display=5&sort=comment" \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET" | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
if 'items' in d and len(d['items']) > 0:
    for i in d['items']:
        name = re.sub('<[^>]+>','',i['title'])
        # mapx, mapy는 카텍(KATEC) 좌표 → WGS84 변환 필요
        print(f'{name}|{i[\"roadAddress\"]}|{i[\"mapx\"]}|{i[\"mapy\"]}')
else:
    print('ERROR:NOT_FOUND')
"
```

**좌표 변환 (KATEC → WGS84)**:
네이버 로컬 검색 API의 `mapx`, `mapy`는 카텍(KATEC) 좌표계이다.
Geocoding/Directions API에서 사용하는 WGS84(경위도)로 변환해야 한다.

로컬 검색에서 `roadAddress`를 얻은 후, 그 주소로 다시 **1단계 Geocoding**을 호출하여
정확한 WGS84 좌표를 얻는 방식으로 처리한다. (좌표 변환 라이브러리 불필요)

**폴백 흐름 요약**:
1. Geocoding 실패 (결과 0건)
2. 로컬 검색 API로 장소명 검색
3. 결과 1건 → 자동 선택 / 여러 건 → 사용자 선택
4. 선택된 장소의 `roadAddress`로 다시 Geocoding → WGS84 좌표 획득
5. 좌표를 경로 검색에 사용

로컬 검색도 결과 0건이면 → 사용자에게 정확한 주소 입력 요청

### 서울 여부 판단

Geocoding 응답의 주소 필드에서 판단한다.
`roadAddress`가 비어있으면 `jibunAddress`를 사용한다.

```
출발지 주소에 "서울" 포함 AND 도착지 주소에 "서울" 포함
  → 이동수단: 대중교통 (ODsay)
그 외
  → 이동수단: 자동차 (네이버 Directions 5)
```

사용자가 이동수단을 명시적으로 지정하면 이 규칙을 오버라이드한다.
예: "자동차로 이동경로 추가해줘" → 서울 내라도 자동차 경로 사용

### 2단계: 경로 검색

#### 자동차 경로 (네이버 Directions 5)

서울 외 지역이 포함된 경우 또는 사용자가 자동차를 지정한 경우 호출한다.

```bash
source ~/.zshrc && curl -s "https://maps.apigw.ntruss.com/map-direction/v1/driving?start={출발지lng},{출발지lat}&goal={도착지lng},{도착지lat}&option=trafast" \
  -H "x-ncp-apigw-api-key-id: $NCP_CLIENT_ID" \
  -H "x-ncp-apigw-api-key: $NCP_CLIENT_SECRET" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'route' not in d:
    print('ERROR:NO_ROUTE')
else:
    s=d['route']['trafast'][0]['summary']
    dist_km=s['distance']/1000
    duration_min=s['duration']//60000
    print(f'DRIVING|{duration_min}|{dist_km:.1f}')
"
```

추출 결과:
- `duration_min` → 소요시간 (분)
- `dist_km` → 거리 (km)

경로 실패 시: 사용자에게 "경로를 찾을 수 없습니다" 알림

#### 대중교통 경로 (ODsay)

출발지·도착지 모두 서울인 경우 기본 호출한다.

```bash
source ~/.zshrc && curl -s -G "https://api.odsay.com/v1/api/searchPubTransPathT" \
  --data-urlencode "SX={출발지lng}" \
  --data-urlencode "SY={출발지lat}" \
  --data-urlencode "EX={도착지lng}" \
  --data-urlencode "EY={도착지lat}" \
  --data-urlencode "apiKey=$ODSAY_API_KEY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'result' not in d:
    print('ERROR:NO_ROUTE')
else:
    path=d['result']['path'][0]
    info=path['info']
    total_min=info['totalTime']
    dist_km=info.get('totalDistance',0)/1000
    bus_cnt=info['busTransitCount']
    sub_cnt=info['subwayTransitCount']

    # 구간별 경로 요약 (한줄)
    segments=[]
    for sp in path['subPath']:
        t=sp['trafficType']
        if t==1:
            lanes=sp.get('lane',[{}])
            name=lanes[0].get('name','') if lanes else ''
            segments.append(f'{sp.get(\"startName\",\"\")}→{sp.get(\"endName\",\"\")}({name})')
        elif t==2:
            lanes=sp.get('lane',[])
            bus_no=lanes[0].get('busNo','') if lanes else ''
            segments.append(f'{bus_no}번버스 {sp.get(\"startName\",\"\")}→{sp.get(\"endName\",\"\")}')
    route_summary=' → '.join(segments)

    # 구간별 상세 경로 (캘린더 description용)
    step=0
    details=[]
    for sp in path['subPath']:
        t=sp['trafficType']
        step+=1
        sec_min=sp.get('sectionTime',0)
        dist=sp.get('distance',0)
        if t==3:
            details.append(f'{step}. 🚶 도보 {sec_min}분 ({dist}m)')
        elif t==1:
            lanes=sp.get('lane',[{}])
            name=lanes[0].get('name','') if lanes else ''
            sn=sp.get('startName','')
            en=sp.get('endName','')
            cnt=sp.get('stationCount','')
            details.append(f'{step}. 🚇 {name} ({sec_min}분, {cnt}정거장)')
            details.append(f'   승차: {sn} → 하차: {en}')
        elif t==2:
            lanes=sp.get('lane',[])
            bus_no=lanes[0].get('busNo','') if lanes else ''
            sn=sp.get('startName','')
            en=sp.get('endName','')
            cnt=sp.get('stationCount','')
            details.append(f'{step}. 🚌 {bus_no}번 버스 ({sec_min}분, {cnt}정거장)')
            details.append(f'   승차: {sn} → 하차: {en}')
    route_detail='\\n'.join(details)

    print(f'TRANSIT|{total_min}|{dist_km:.1f}|버스{bus_cnt}+지하철{sub_cnt}|{route_summary}')
    print(f'DETAIL|{route_detail}')
"
```

추출 결과:
- `total_min` → 총 소요시간 (분)
- `dist_km` → 총 거리 (km)
- `bus_cnt`, `sub_cnt` → 환승 횟수
- `route_summary` → 구간별 경로 한줄 요약 (역명, 노선)
- `route_detail` → 구간별 상세 경로 (도보 포함, 캘린더 description에 사용)

대중교통 경로 실패 시: "대중교통 경로를 찾을 수 없습니다. 자동차 경로로 대체할까요?" 제안

### 3단계: 시간 계산

도착시간(미팅 시작시간)에서 역산하여 출발시간을 계산한다.

```
출발시간 = 미팅시작시간 - 소요시간 - 버퍼(10분)
종료시간 = 미팅시작시간
```

이동 일정의 종료시간을 미팅 시작시간과 동일하게 설정하여
캘린더에서 이동→미팅이 빈틈 없이 연결되도록 한다.

예시: 미팅 08:00, 소요시간 46분, 버퍼 10분
→ 출발시간: 07:04
→ 이동 일정: 07:04 ~ 08:00

소요시간 표시 규칙:
- 60분 미만: `{N}분` (예: 46분)
- 60분 이상: `{시간}시간{분}분` (예: 1시간20분)

### 4단계: 캘린더 이벤트 생성

#### 충돌 감지

이동 일정을 생성하기 전에 primary 캘린더에서 해당 시간대에
기존 일정이 있는지 확인한다.

```
mcp__claude_ai_Google_Calendar__gcal_list_events(
  calendarId="primary",
  timeMin="{출발시간 RFC3339}",
  timeMax="{종료시간 RFC3339}",
  timeZone="Asia/Seoul"
)
```

- 종일 일정은 충돌로 보지 않는다
- 충돌 일정이 있으면 사용자에게 알리고 확인 요청
- 충돌 없으면 이동 일정 생성 진행

#### 이벤트 생성

```
mcp__claude_ai_Google_Calendar__gcal_create_event(
  calendarId="primary",
  summary="{이모지} 이동: {출발지} → {도착지} ({소요시간})",
  description="📍 {출발지} → {도착지}\n{이모지} {이동수단} | 총 {소요시간} | {거리}km\n⏰ 여유시간 10분 포함\n\n🗺️ <a href=\"{naver_directions_url}\">네이버지도로 경로 보기</a>\n\n{route_detail}",
  start="{출발시간 RFC3339}",
  end="{종료시간 RFC3339}",
  timeZone="Asia/Seoul",
  colorId="8"
)
```

네이버지도 경로 URL (`naver_directions_url`):
```
대중교통: https://map.naver.com/v5/directions/{출발lng},{출발lat},{출발지명(URL인코딩)}/{도착lng},{도착lat},{도착지명(URL인코딩)}/-/transit
자동차:   https://map.naver.com/v5/directions/{출발lng},{출발lat},{출발지명(URL인코딩)}/{도착lng},{도착lat},{도착지명(URL인코딩)}/-/car
```
Geocoding에서 얻은 좌표를 그대로 사용하며, 장소명은 URL 인코딩한다.
Google Calendar description은 HTML `<a>` 태그를 지원하므로 클릭 가능한 링크가 된다.

이모지 규칙:
- 대중교통: 🚇
- 자동차: 🚗

제목 예시:
- `🚇 이동: 집 → 농심 본사 (46분)`
- `🚗 이동: 농심 본사 → 화성 롤링힐스 (1시간5분)`

## 실행 흐름

### 시나리오 A: 기존 일정 기반 자동 생성

"내일 일정 이동경로 넣어줘" 와 같이 요청하면:

1. **일정 조회**: 해당 날짜의 캘린더 일정을 조회한다
   ```
   mcp__claude_ai_Google_Calendar__gcal_list_events(
     calendarId="primary",
     timeMin="{해당 날짜}T00:00:00",
     timeMax="{해당 날짜}T23:59:59",
     timeZone="Asia/Seoul"
   )
   ```

2. **필터링**: location(장소)이 있는 일정만 추출한다.
   이미 "이동:" 이 포함된 이벤트는 제외한다 (기존 이동 일정 중복 방지).

3. **각 일정에 대해 시간순으로**:
   a. 출발지 결정:
      - 직전 일정에 location이 있으면 → 그 장소를 출발지로
      - 없으면 → 집 주소 사용
   b. 도착지: 해당 일정의 location
   c. 출발지/도착지를 Geocoding → 좌표 변환
      (집 주소는 캐싱된 좌표 사용)
   d. 서울 여부 판단 → 이동수단 자동 선택
   e. 해당 API로 경로 검색
   f. 시간 역산 (미팅시작 - 소요시간 - 버퍼10분)
   g. 연쇄 이동 감지: 출발시간이 직전 일정 종료보다 빠르면 경고
   h. 충돌 감지 후 캘린더 이벤트 생성

4. **결과 리포트 출력**

### 시나리오 B: 직접 지정

"집에서 농심 본사까지 내일 8시 도착" 과 같이 요청하면:

1. 사용자 요청에서 파싱:
   - 출발지 (기본값: 집)
   - 도착지
   - 도착시간
   - 이동수단 (지정하지 않으면 자동 선택)

2. **캘린더 컨텍스트 확인** (중요):
   해당 날짜의 캘린더 일정을 조회하여, 출발지/도착지에 해당하는
   일정의 `location` 필드가 있으면 그 정확한 주소를 Geocoding에 사용한다.
   - 사용자가 "공덕에서"처럼 대략적 장소명을 말해도, 직전 일정의 location에
     정확한 주소가 있으면 그것을 우선 사용
   - 도착지도 해당 미팅 일정의 location이 있으면 그 주소를 사용

3. 출발지/도착지 Geocoding → 좌표 변환

4. 서울 여부 판단 → 이동수단 자동 선택
   (사용자 지정 시 오버라이드)

5. 해당 API로 경로 검색

6. 시간 역산 → 캘린더 이벤트 생성

7. 결과 리포트 출력

## 실행 리포트

모든 이동 일정 생성이 완료되면 결과를 보고한다.

```
🗺️ 이동경로 추가 완료!

📅 {날짜}
  {이모지} 이동: {출발지} → {도착지} ({소요시간})
     {출발시간} ~ {종료시간} | {경로 요약}
  ✅ 캘린더에 추가됨

총 {N}건 추가, 충돌 {M}건
```

충돌이 있었던 경우:
```
  ⚠️ {시간} 충돌: 기존 일정 "{일정명}"과 겹침
     → 사용자 확인 후 추가됨 / 건너뜀
```

연쇄 이동 불가:
```
  ❌ {시간} 물리적 불가: {직전 일정}이 {종료시간}에 끝나지만
     {다음 장소}까지 이동에 {소요시간}이 필요합니다
```
