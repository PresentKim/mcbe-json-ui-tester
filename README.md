# MCBE JSON UI Tester

마인크래프트 배드락 에디션 리소스팩의 JSON UI(`ui/*.json`)를 게임 없이 돌려 보는 실험 도구다. 바닐라 UI 위에 내 리소스팩을 얹어 화면을 그리고, 바인딩과 식을 계산하고, 엔진이 내는 오류 문구와 흔한 함정을 진단으로 보여 준다. 브라우저 GUI와 명령줄(`cli.mjs`) 두 가지로 쓴다.

**바로 써 보기: <https://presentkim.github.io/mcbe-json-ui-tester/>**

> 기준 바닐라 v1.26.50.4(`Mojang/bedrock-samples` 커밋 `46ba6ea`). **이 도구의 결과는 게임 동작이 아니다.** 엔진 규칙을 문서와 분석에서 옮긴 모델이라, 규칙이 틀렸거나 아직 모르는 곳에서는 게임과 다르다. 최종 확인은 게임에서 한다.

![가이드 레시피를 바닐라 서버 폼 위에서 돌린 화면. 집계 안 되는 버튼을 눌러 COL-04 응답이 뜨고, 진단 탭에 가려진 라벨 경고가 있다](./docs/server-form.jpg)

## 1. 무엇을 하나

| 기능 | 내용 |
| --- | --- |
| 바닐라 위에 내 팩 얹기 | 바닐라 `ui/` 207개 파일(정의 약 6,300개)을 읽고 내 팩을 팩 순서대로 병합한다. `modifications` 11개 연산, 같은 경로 병합, 경로 키(`"a/b/c"`)를 처리한다 |
| 화면 재현 | 서버 폼(액션·모달), HUD, 상자 화면 등 바닐라 화면을 해석 오류 없이 만들고 바닐라 텍스처로 그린다 |
| 흉내 데이터 | 폼 제목·본문·버튼, HUD 타이틀·액션바, 상자 칸을 넣어 화면 컨트롤러를 흉내 낸다 |
| 버튼 누름 | 버튼을 누르면 엔진의 응답을 흉내 낸다. 버튼 자신에 `collection_details`가 있으면 "selection = N", 없으면 "canceled" |
| 시간 흐름 | "다음 틱"으로 컨트롤 상태를 유지한 채 데이터를 다시 보내 `once`, `visibility_changed`(preserved title 래치)를 시험한다 |
| 진단 | 엔진 오류 문구(`Must define a source property name in the binding!` 등)와 규칙 ID가 붙은 경고. 없는 연산자, `* 1` 숫자 변환, 자기 `ignored`에 닿지 않는 `$변수`, 더 높은 레이어에 가려진 라벨 등 |
| 검사 | 컨트롤 트리, 정의 사슬, 사각형, 레이어, 속성 주머니, 바인딩, `$` 변수 |
| 식 실험 | 바인딩 식과 속성 주머니를 넣으면 값과 함정을 바로 보여 준다 |
| 아이템 아이콘 | `inventory_item_renderer`의 `#item_id_aux`(숫자 ID × 65536 + 데이터)와 상자 칸의 `#item_renderer_data`를 바닐라 아이템 아이콘으로 그린다. 블록은 인벤토리처럼 윗면·옆면 세 면의 입체, 꽃·횃불 같은 것은 납작한 그림 |

검증: 식 평가기는 Cinnabar(배드락 클라이언트 재구성) 평가기의 실행 결과 42건과 모두 같은 값을 내고, 크기 식도 16건이 같다. 실제 서버 팩(폼 레이아웃 13종, 버튼 93개짜리 분할 화면, 상자 기계 창, HUD 사이드바를 쓰는 리소스팩 5개 스택)을 해석 오류 없이 돌린다. 테스트는 84건이다.

## 2. 쓰는 법

### 2.1 웹에서

<https://presentkim.github.io/mcbe-json-ui-tester/>를 연다. 바닐라 UI는 GitHub의 `Mojang/bedrock-samples`에서 받는다(처음에 UI 파일 207개, 텍스처는 쓸 때). "내 리소스팩 폴더 추가"로 리소스팩 루트 폴더(`ui/`, `textures/`가 있는 곳)를 고른다. 내 팩 파일은 브라우저 밖으로 나가지 않는다.

| 영역 | 하는 일 |
| --- | --- |
| 위 막대 | 엔진 모델(실측 우선 / CN 그대로), 플랫폼 변수(데스크톱 / 휴대폰), 화면 크기, 배율, 윤곽·숨은 컨트롤 보기, "모르는 전역 `#visible`을 false로" |
| 왼쪽 "팩" | 바닐라, 내 리소스팩 폴더, 예제 팩을 넣고 순서를 바꾼다(위가 먼저 병합) |
| 왼쪽 "파일" | 읽은 UI 파일을 고쳐 바로 적용한다(Ctrl+Enter) |
| 가운데 | 화면. 컨트롤을 누르면 고르고, 버튼·토글이면 엔진의 응답을 흉내 낸다. 마우스를 올리면 호버 상태가 된다 |
| "처음부터 다시" / "다음 틱" | 트리를 새로 만든다 / 컨트롤 상태를 유지한 채 호스트 데이터를 다시 보낸다 |
| 오른쪽 "호스트" | 화면에 줄 데이터: 서버 폼, HUD, 상자, 직접 JSON(`globals`, `collections`, `factories`, `hostVars`) |
| 오른쪽 "검사"·"진단"·"식 실험" | 위 1절 |

엔진 모델 두 가지:

- **실측 우선**(기본): 게임에서 잰 기록이 재구성 코드와 다르면 실측을 따른다. 예: `#`가 없는 view 식은 그 컨트롤의 `bindings` 전체를 버린다, 다른 경로 파일의 `modifications`는 바닐라에 닿지 않는다, 문자열 리터럴은 `'%.Ns'`로 자르지 않는다, 식 안에 끼운 `$변수`는 치환하지 않는다.
- **CN 그대로**: Cinnabar 재구성 엔진의 규칙을 그대로 쓴다.

### 2.2 내 컴퓨터에서

```bash
git clone https://github.com/PresentKim/mcbe-json-ui-tester
cd mcbe-json-ui-tester
node serve.mjs            # http://localhost:5178
```

내 팩을 폴더 선택 없이 바로 띄우려면 아래쪽 팩부터 `--pack`으로 준다(뒤에 준 팩이 이긴다).

```bash
node serve.mjs 5180 --pack ../packs/theme --pack ../packs/server
```

저장해 둔 시험을 주소로 바로 띄울 수 있다. `?scenario=<JSON 주소>`는 `{ root, host, screen: {w, h}, zoom, mode, platform }`을 불러오고, `&view=stage`를 붙이면 화면만 왼쪽 위에 그려 게임 스크린숏과 픽셀로 맞대기 좋다. `--static <폴더>`는 그 폴더를 `/static/`으로 내어 준다.

```bash
node serve.mjs 5181 --static ./scenarios
# http://localhost:5181/?scenario=/static/research.json&view=stage
```

게임 창이 1920×1009이고 GUI 배율이 4면 화면은 480×252.25다. 소수 높이까지 그대로 넣어야 세로 가운데 정렬이 게임과 같아진다.

`serve.mjs`는 옆 폴더의 `bedrock-samples/resource_pack`(`../bedrock-samples` 또는 `../../bedrock-samples`)을 찾아 바닐라를 바로 불러온다. 다른 위치면 `VANILLA=<resource_pack 경로>`를 준다. 찾지 못하면 웹과 같이 GitHub에서 받는다(`node serve.mjs 5179 --no-vanilla`로 이 상태를 일부러 볼 수 있다). 외부 패키지는 필요 없다(Node 20+).

### 2.3 명령줄

```bash
node cli.mjs --vanilla ../bedrock-samples/resource_pack --pack ./my_rp --root server_form.third_party_server_screen --title "myui:v1 상점" --buttons "사과;빵"
```

진단과 보이는 라벨(글자, 위치)을 찍고, `error` 진단이 있으면 종료 코드 1을 낸다. `--json`이면 JSON으로, `--cn`이면 CN 모델로, `--host hud --hud-title T --actionbar A`면 HUD로 돈다. `--sample`은 내장 예제 팩을 얹는다. AI 에이전트나 CI가 리소스팩을 고친 뒤 정적 시뮬레이션으로 쓸 수 있다.

### 2.4 테스트

```bash
npm test
```

87건(식 50, 크기·JSON·글꼴 22, 정의 해석 10, 래치 1, 실제 팩 회귀 3, 아이템 아이콘 1). `node:test`로 돈다.

## 3. 규칙 ID와 근거

진단과 코드 주석의 `[EXP-16]`, `[COL-04]` 같은 ID는 지은이가 정리한 한국어 JSON UI 가이드(비공개 연구 저장소)의 규칙 번호다. 장 약어는 `FILE` 파일·정의, `MOD` 바닐라 화면 수정, `LAY` 레이아웃, `BND` 바인딩, `EXP` 식, `COL` 컬렉션·팩토리, `INP` 입력·버튼·토글, `TXT` 텍스트, `ANI` 이미지·애니메이션, `HOST` 화면 호스트, `PAT` 패턴, `DBG` 디버깅이다. 근거는 다음을 교차 검증한 것이다.

| 약어 | 근거 |
| --- | --- |
| 실측 | 게임 안 측정 기록(bedrock-core 저자의 실측, 지은이의 서버 실측) |
| 바닐라 | 바닐라 리소스팩 v1.26.50.4 `ui/` 전수 검색 |
| `CN` | Cinnabar(`cinnabar-mc/cinnabar`)의 JSON UI 재구성 엔진 코드와 그 평가기 실행 결과. 이 도구에 Cinnabar 코드는 들어 있지 않다(동작 규칙만 다시 구현) |
| `NB` | Android 1.26.52.3 클라이언트 바이너리에서 확인한 엔진 키와 오류 문구 |
| 커뮤니티 | Bedrock Wiki, Bedrock OSS·Bedrock Add-Ons 디스코드 |

## 4. 한계

- **게임이 아니다.** 두 엔진 모델 모두 틀릴 수 있다. 근거끼리 갈리는 곳(예: 식 안의 `$변수` 치환)은 진단에 "게임 확인 필요"로 적는다.
- **엔진 데이터는 흉내다.** 화면 컨트롤러가 주는 바인딩은 `src/engine/host.js`의 일부만 있다. 모르는 전역값은 없음(또는 `#visible` false)으로 본다. 종이 인형, 스크롤 동작, 애니메이션, 입력 포커스, 소리는 그리지 않는다(아이템이 아닌 엔진 렌더러는 "윤곽"을 켜면 자리표시로 보인다).
- **아이템 아이콘**: `data/item-atlas.json`(바닐라 1.26.50.4, 1,623개 중 1,538개에 텍스처)으로 숫자 ID를 아이콘에 잇는다. 텍스처가 없는 85개(새 스폰 알, 음반, 하네스 등)는 이름만 보인다. 숫자 ID는 버전과 커스텀 아이템 수에 따라 밀리므로(ANI-06) 다른 버전·서버에서는 다른 아이템이 보일 수 있다. 커스텀 아이템은 그리지 않는다. 블록은 게임에서 잰 카메라(45° 돌리고 30° 숙인 정사영, 정육면체 폭이 아이콘의 7/8)로 정육면체·반 블록·판유리 모양을 그린다. 계단·울타리 같은 다른 모델, 마법 부여 반짝임, 내구도 막대는 없다.
- **글자**: 줄바꿈과 글자 폭은 게임 글꼴의 폭표(`data/font-metrics.json`)로 잰다. 글자 모양은 브라우저 글꼴이라 획이 게임보다 1px쯤 위로 올라오고, 한 글자 안에서 1px쯤 어긋날 수 있다. 현지화는 하지 않는다(lang 키는 점선 밑줄로 표시).
- **텍스처**: PNG·JPG만 그린다(TGA 없음). 9-slice는 CSS `border-image`, 틴트는 곱하기 혼합이라 게임 색과 조금 다르다.
- **크래시는 흉내 내지 않는다.** 크기 바인딩에 숫자가 아닌 값, 문자열 나누기처럼 게임을 죽이는 식은 진단으로만 알린다.
- **버전**: 바닐라 1.26.50.4 구조 기준이다. 다른 버전의 바닐라 폴더를 넣으면 그 구조로 돈다.

## 5. 구조

| 파일 | 하는 일 | 근거 규칙 |
| --- | --- | --- |
| `src/engine/expr.js` | 토큰, 우선순위, 타입별 연산, 결과 재해석, 사전 조회, 함정 검사 | EXP-*, CN-26~30 |
| `src/engine/jsonc.js` | jsoncpp 규칙(주석 허용, 뒤따르는 쉼표·따옴표 없는 키는 오류, 오류 앞까지 로드) | FILE-30 |
| `src/engine/size.js` | 크기 식 | LAY-03, LAY-34~37 |
| `src/engine/catalog.js` | `_ui_defs` 정렬 로드, 같은 경로 병합, 경로 키, `modifications` 11개 연산 | FILE-20~22, MOD-* |
| `src/engine/resolve.js` | `@` 상속, `$` 스코프(확정값 우선), `variables`, `ignored`(부모 스코프, 가장 먼저) | FILE-*, NB |
| `src/engine/bind.js` | 속성 주머니, 팩토리·그리드·컬렉션, global/collection/view 바인딩, `binding_condition` 틱, 버튼·토글 상태, 누름 흉내 | BND-*, COL-*, INP-* |
| `src/engine/layout.js` | 크기, 앵커, 스택(숨은 자식 공간 없음), 그리드, 레이어, 클리핑, 가려짐 검사 | LAY-* |
| `src/engine/host.js` | 서버 폼, HUD, 상자 화면 흉내 데이터 | HOST-* |
| `src/render.js`, `src/app.js`, `index.html`, `app.css` | 브라우저 GUI | — |
| `samples/sample-pack.js` | 예제 팩: 커스텀 액션 폼(PAT-01·02), preserved title, 바닐라 없이 도는 놀이터(`demo.playground`) | PAT-01~02, BND-18 |
| `data/item-atlas.json`, `tools/build-item-atlas.mjs` | 숫자 아이템 ID → 아이콘 텍스처 표와 그것을 바닐라 샘플(`metadata/vanilladata_modules/mojang-items.json`, `item_texture.json`, `blocks.json`, `terrain_texture.json`)에서 만드는 스크립트 | ANI-06 |
| `src/engine/font.js`, `data/font-metrics.json`, `tools/build-font-metrics.mjs` | 글자 폭과 줄바꿈. 폭표는 설치된 게임의 `font.brarchive`(`default8.png`, `glyph_XX.png`)에서 글자마다 왼쪽·오른쪽 열만 뽑은 숫자다(글꼴 그림은 넣지 않는다) | TXT-* |
| `cli.mjs`, `serve.mjs` | 명령줄, 로컬 서버 | — |
| `.github/workflows/pages.yml` | `main`에 올 때마다 테스트 후 GitHub Pages 배포 | — |

## 6. 바닐라 파일

이 저장소에는 바닐라 파일이 없다. 웹 버전은 실행할 때 `Mojang/bedrock-samples`에서 받고, 로컬에서는 사용자가 가진 사본을 읽는다. `docs/`의 스크린샷에는 바닐라 UI 텍스처가 찍혀 있다.
