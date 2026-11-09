# ⛳ Golf ScoreCard App (Multi-Tournament · 411 California 3D LiDAR Courses)

하나의 GitHub 웹앱에서 **여러 골프대회를 각각 독립된 전용 링크(`?t=대회코드`)와 전용 구글 시트로 동시에 개설·운영**할 수 있는 스코어카드 플랫폼입니다.

---

## 🔗 주요 주소 및 권한 구조

| 용도 | 주소 예시 | 인증 및 열람 권한 |
| :--- | :--- | :--- |
| **대회 개설·관리 콘솔** | `https://aries7594.github.io/golf_scorecard_app/admin.html` | **이메일 + 비밀번호 로그인** (신규 이메일은 첫 화면에서 즉시 가입, 본인 개설 대회만 조회·수정·삭제) |
| **참가자 점수 입력 링크** | `https://aries7594.github.io/golf_scorecard_app/?t=8cgqps` | 로그인 없이 조 선택 후 점수·니어·롱기 입력 및 3D GPS 코스맵 이용 |
| **대회 전용 구글 시트** | 대회 개설 시 자동 생성 | 비공개(`PRIVATE`) 설정 후 **로그인한 개설자 이메일에만 읽기 전용(`Viewer`) 단독 공유** |

* 코드 없이 기본 주소(`.../golf_scorecard_app/`)로 접속하면 **대회 코드 입력 입장 화면**이 표시됩니다.
* 캘리포니아 전역 **411개 정규 18홀 골프장**(위성 홀 경로 + 그린 폴리곤 + 미 연방 지질조사국 USGS 3DEP 3D LiDAR 등고선)이 수록되어 있으며, 참가자 스마트폰에서는 해당 대회의 코스 파일 딱 1개(`~28KB`)만 동적으로 불러옵니다.

---

## 🔄 `gas-backend/Code.gs` 업데이트 반영 방법 (기존 웹앱 URL 그대로 유지)

1. [Google Apps Script](https://script.google.com/home)에서 기존에 만든 프로젝트를 엽니다.
2. `gas-backend/Code.gs` 전체 내용을 복사해 덮어쓰고 **저장(`Cmd+S`)**합니다.
3. 우측 상단 **`Deploy` ➔ `Manage deployments`** 클릭 ➔ 우측 상단 **연필 아이콘(✏️)** 클릭 ➔ **Version: `New version`** 선택 ➔ **`Deploy`** 클릭! *(기존 `GAS_BACKEND_URL` 주소가 그대로 유지됩니다.)*
