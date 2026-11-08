/* ============================================================================
 * [TournamentConfig.js] 기본 대회 설정 및 백엔드 API 연결 파일 (GitHub 직접 실행용)
 * ----------------------------------------------------------------------------
 * 1) GAS_BACKEND_URL: gas-backend/Code.gs를 내 구글 계정에 1회 배포한 뒤 받은 웹앱 URL을 적습니다.
 *    (총무용 웹화면 admin.html에서 대회명, 골프장, 참석자/핸디 명단을 입력해
 *     새 구글 시트를 자동 생성하면 서버에 저장된 최신 대회 설정이 우선 적용됩니다.)
 * 2) 아직 생성된 시트가 없을 때 index.html을 처음 열면, 아래 TOURNAMENT_CONFIG의
 *    기본 설정과 groups 명단으로 구글 드라이브에 대회 시트가 자동 생성됩니다.
 * ============================================================================ */

var GAS_BACKEND_URL = "";

var TOURNAMENT_CONFIG = {
  // 0. 대회 고유 식별자 (새 대회를 파일로 열 때 변경 가능, admin.html 사용 시 자동 관리)
  tournamentId: "2026-fall",

  // 1. 사용할 골프장 선택 ("wente", "moffett", 또는 "poppy_hills")
  courseKey: "wente",

  // 2. 대회 명칭 (상단 바 & 메인 배너 타이틀 & 생성될 구글 시트 파일명)
  sheetTitle: "2026년 회장배",
  tournamentTitle: "⛳ 2026 회장배 가을 골프대회",
  heroTitle: "2026 회장배 가을 골프대회",

  // 3. 이번 대회 장타(Long Drive) 및 니어(Near Pin) 이벤트 홀 번호
  longDriveHoles: [8],
  nearPinHoles: [3, 7, 11, 14],
  defaultTeeKey: "white",

  // 4. 경기 진행 안내 (공지사항 카드)
  noticeTitle: "📢 경기 진행 안내",
  noticeLeadHtml: '일몰시간으로 뒷조의 18홀 완주가 빠듯합니다. 뒷조를 배려하여 최대한 신속하게, 모든 조가 <b style="font-weight:900;">4시간 30분</b> 이내 완료하도록 적극 협조 부탁드립니다.',
  noticeItems: [
    "9홀 2시간 10분이내 완주. 수시로 시간 체크",
    "화장실은 경기시작전 미리미리",
    "공 찾는데 2 분이상 소모하지 않기 / 그린에서 컨시드 적극 활용",
    "드라이버 티샷은 준비된 사람이 먼저 치기",
    "앞조가 시야에서 사라지지 않도록 앞조와 간격 유지",
    '<b style="font-weight:900;">혼성조:</b> 남성 티샷 준비 중 여성분들은 미리 레이디 티박스로 이동',
    '<b style="font-weight:900;">세컨샷:</b> 동반자 공 봐주기보다, 자신의 샷위치로 미리 이동'
  ],

  // 5. 티박스 로컬룰 · 이벤트 안내 · 뒷풀이 장소 (경기 진행 안내 카드 하단에 통합 표시)
  teeBannerTitle: "남성:화이트티, 여성:레드티",
  teeBannerSubHtml: '시그니처 홀인 전후반 첫홀<b style="font-weight:900;">(1번홀, 10번홀)</b>만 남성:블루티, 여성:화이트티',
  eventBannerSubHtml: "장타상(남녀 별도)과 단타·리버스 니어상이 있으니 잘못 쳐도 페어웨이·그린에 올렸으면 기록해 주세요.<br>(단, 1등·꼴등만 시상하니 빠른 진행을 위해 해당 안 되면 생략)",
  afterPartyHtml: '뒷풀이: <span style="font-size:11px; font-weight:600; color:#451a03;">Canton Village (<a href="https://maps.app.goo.gl/HMbiCNwJqs5JsX6b8" target="_blank" style="color:#003876; text-decoration:underline; font-weight:600;">1070 E Stanley Blvd, Livermore, CA 94550</a>)</span>',

  // 6. 하단 제작자 저작권 및 이메일 표기
  copyrightHtml: '© Created by <a href="mailto:aries75@gmail.com" style="color:#444; text-decoration:underline; font-weight:700;">aries75@gmail.com</a>',

  // 7. 조별 티타임 (첫 화면 조 카드에 표시)
  firstTeeTime: "11:30",
  teeIntervalMin: 8,

  // 8. 기본 조 편성 및 핸디 명단 (구글 시트가 아직 없을 때 자동 생성용 / admin.html에서 언제든 덮어쓰기 가능)
  groups: [
    {
      name: "1조",
      players: [
        { name: "한기혁", handicap: 22 },
        { name: "박성준", handicap: 26 },
        { name: "이용일", handicap: 19 },
        { name: "이윤석", handicap: 21 }
      ]
    },
    {
      name: "2조",
      players: [
        { name: "류제니", handicap: 28 },
        { name: "정혜연", handicap: 36 },
        { name: "성기애", handicap: 25 },
        { name: "양희영", handicap: 28 }
      ]
    },
    {
      name: "3조",
      players: [
        { name: "김순곤", handicap: 18 },
        { name: "이춘우", handicap: 18 },
        { name: "류성욱", handicap: 10 },
        { name: "정재헌", handicap: 18 }
      ]
    },
    {
      name: "4조",
      players: [
        { name: "고재찬", handicap: 26 },
        { name: "한승훈", handicap: 23 },
        { name: "신준화", handicap: 16 },
        { name: "신이준", handicap: 28 }
      ]
    },
    {
      name: "5조",
      players: [
        { name: "이병준", handicap: 21 },
        { name: "안홍식", handicap: 18 },
        { name: "양순섭", handicap: 16 },
        { name: "김용훈", handicap: 12 }
      ]
    },
    {
      name: "6조",
      players: [
        { name: "김재협", handicap: 18 },
        { name: "이광영", handicap: 18 },
        { name: "김주완", handicap: 20 },
        { name: "우충기", handicap: 15 }
      ]
    },
    {
      name: "7조",
      players: [
        { name: "박숙민", handicap: 48 },
        { name: "곽재영", handicap: 23 },
        { name: "임진형", handicap: 23 },
        { name: "진건수", handicap: 16 }
      ]
    }
  ]
};
