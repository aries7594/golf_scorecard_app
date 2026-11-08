# ⛳ Golf ScoreCard App (Multi-Tournament · GitHub 직접 실행 + 구글 시트 자동 생성)

하나의 GitHub 웹앱에서 **여러 골프대회를 각각 독립된 전용 링크(`?t=대회코드`)와 전용 구글 시트로 동시에 운영·분양**할 수 있는 스코어카드 플랫폼입니다.

---

## 🔗 대회별 전용 주소 구조

대회를 생성할 때마다 고유 코드(예: `2026-fall`, `sv-alumni`)가 붙은 전용 링크가 자동 발급됩니다:

| 용도 | 주소 예시 |
| :--- | :--- |
| **마스터 통합 관리 콘솔 (본인용)** | `https://aries7594.github.io/golf_scorecard_app/admin.html` *(기본 마스터 PIN: `2026`)* |
| **A 대회 참가자 공유용 링크** | `https://aries7594.github.io/golf_scorecard_app/?t=2026-fall` |
| **A 대회 모임 총무 분양용 링크** | `https://aries7594.github.io/golf_scorecard_app/admin.html?t=2026-fall` *(A 대회 전용 PIN으로만 접속)* |
| **B 대회 참가자 공유용 링크** | `https://aries7594.github.io/golf_scorecard_app/?t=sv-alumni` |

* 코드 없이 기본 주소(`.../golf_scorecard_app/`)로 접속하면 타 모임 명단이 노출되지 않고 **대회 코드 입력 입장 화면**이 표시됩니다.
* 각 대회는 서로 완전히 분리된 구글 시트에 저장되며, 설정 정보도 각 시트 내부 숨김 탭(`_Config`)과 마스터 레지스트리 시트(`_GolfScoreCard_Master_Registry`)에 자동 보관되어 **대회 수 제한 없이** 개설할 수 있습니다.

---

## 🔄 `gas-backend/Code.gs` 업데이트 반영 방법 (기존 웹앱 URL 그대로 유지)

이미 Apps Script 웹앱을 1회 배포해 두셨다면, URL을 바꿀 필요 없이 코드만 덮어써서 새 버전으로 올리면 됩니다:

1. [Google Apps Script](https://script.google.com/home)에서 기존에 만든 프로젝트를 엽니다.
2. `gas-backend/Code.gs` 전체 내용을 복사해 덮어쓰고 **저장(`Cmd+S`)**합니다.
3. 우측 상단 **`[배포] ➔ [배포 관리]`** 클릭 ➔ 우측 상단 **연필 아이콘(✏️ 수정)** 클릭 ➔ **버전: `새 버전`** 선택 ➔ **`[배포]`** 클릭! *(기존 `GAS_BACKEND_URL` 주소가 그대로 유지됩니다.)*
