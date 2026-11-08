# ⛳ Golf ScoreCard App (GitHub 직접 실행 + 구글 시트 자동 생성)

구글 시트 내장 웹앱이 아닌 **GitHub Pages에서 곧바로 실행되는 메인 웹앱(`index.html`)** 과, 참석자 명단·핸디를 붙여넣어 **`2026년 회장배.xlsx`와 동일한 구글 시트(`1조~N조`, `결과`, `니어/롱기`, `Stat`)를 내 구글 드라이브에 자동 생성하는 총무용 웹화면(`admin.html`)** 입니다.

---

## 📂 폴더 구성

| 파일 | 역할 |
| :--- | :--- |
| `index.html` | **참가자용 메인 스코어카드 앱** (GitHub에서 즉시 실행, 코스맵/GPS, 니어·롱기 전광판 포함) |
| `admin.html` | **총무용 대회 설정 & 참석자/핸디 등록 & 구글 시트 자동 생성 페이지** (기본 PIN: `2026`) |
| `TournamentConfig.js` | 백엔드 엔진 URL(`GAS_BACKEND_URL`) 및 기본 대회 설정·명단 |
| `CourseData.js` | 골프장 DB (Wente Vineyards, Poppy Hills, Moffett Field — 18홀 Par·코스맵·그린경사도) |
| `gas-backend/Code.gs` | **내 구글 계정에 딱 1번만 배포해 두고 평생 재사용하는 시트 생성·저장 엔진** (개별 시트에는 스크립트 0줄) |

---

## 🚀 최초 1회 설치 방법 (3분 완료)

### 1단계. 구글 시트 생성·저장 엔진 1회 배포 (`script.google.com`)
1. [Google Apps Script](https://script.google.com/)에 접속하여 **`[+ 새 프로젝트]`** 를 클릭합니다. *(구글 시트 안에서 여는 것이 아니라 단독 프로젝트로 생성합니다.)*
2. 기본 `Code.gs` 내용을 지우고 이 폴더의 `gas-backend/Code.gs` 내용을 그대로 붙여넣고 저장(`Ctrl+S` / `Cmd+S`)합니다.
3. 우측 상단 **`[배포] ➔ [새 배포]`** 클릭:
   - 유형 선택(⚙️): **`웹 앱`**
   - 다음 사용자 인증 정보로 실행: **`나`**
   - 액세스 권한이 있는 사용자: **`모든 사용자 (Anyone)`**
4. **`[배포]`** 클릭 ➔ 권한 승인(최초 1회 Drive/Sheets 생성 권한 허용) 후 나온 **`웹 앱 URL (`https://script.google.com/macros/s/.../exec`)`** 을 복사합니다.

### 2단계. `TournamentConfig.js`에 엔진 URL 입력 후 GitHub에 Push
1. `TournamentConfig.js` 상단의 `GAS_BACKEND_URL`에 방금 복사한 URL을 넣습니다:
   ```js
   var GAS_BACKEND_URL = "https://script.google.com/macros/s/.../exec";
   ```
2. 이 폴더를 새 GitHub 저장소에 올리고 **Settings ➔ Pages**를 켜면 끝입니다!

---

## 🛠️ 매 대회마다 총무가 사용하는 방법 (`admin.html`)

앞으로 새 대회를 열 때는 코드를 고치거나 구글 시트를 손으로 만들 필요가 전혀 없습니다.

1. `https://<내-깃허브-아이디>.github.io/<저장소명>/admin.html` 접속 (기본 PIN: **`2026`**)
2. **대회명, 골프장, 장타/니어홀, 티타임, 공지사항** 확인/수정
3. 엑셀에 있는 **`[조 | 이름 | 핸디]`** 표(조 번호 셀이 병합되어 있어도 OK)를 드래그해 복사(`Ctrl+C`) ➔ 붙여넣기(`Ctrl+V`) 후 **`[✨ 붙여넣은 명단으로 조 편성 자동 세팅]`** 클릭 *(또는 `.xlsx` 파일 직접 선택)*
4. **`[🚀 새 대회 구글 시트 자동 생성 & 대회 오픈]`** 클릭!
   - 내 구글 드라이브에 `1조~N조`, `결과`, `니어/롱기`, `Stat` 탭과 모든 수식(합계, 핸디, 넷스코어, 버디~쿼드러플, 잉꼬상, 정직상, 바이너리, 전·후반, 부문별 자동 순위 `=SORT(...)`)이 세팅된 구글 시트가 자동으로 만들어집니다.
   - 참가자들에게는 `https://<내-깃허브-아이디>.github.io/<저장소명>/` 링크만 카톡으로 공유하면 됩니다!
