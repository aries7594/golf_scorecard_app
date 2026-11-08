/* ============================================================================
 * [TournamentConfig.js] Default Tournament Config & Backend API Connection (GitHub Direct Execution)
 * ----------------------------------------------------------------------------
 * 1) GAS_BACKEND_URL: Paste the Web App URL obtained after deploying gas-backend/Code.gs once.
 *    (When a new Google Sheet is auto-generated from admin.html with tournament title, course,
 *     and player/handicap roster, the latest server-stored config takes precedence.)
 * 2) If index.html is opened when no sheet exists yet, a tournament Google Sheet is automatically
 *    created in Google Drive using TOURNAMENT_CONFIG and the default groups roster below.
 * ============================================================================ */

var GAS_BACKEND_URL = "";

var TOURNAMENT_CONFIG = {
  // 0. Unique tournament identifier (editable for static setup; managed automatically when using admin.html)
  tournamentId: "2026-fall",

  // 1. Golf course key to use ("wente", "moffett", or "poppy_hills")
  courseKey: "wente",

  // 2. Tournament titles (top bar, hero banner, and generated Google Sheet filename)
  sheetTitle: "2026년 회장배",
  tournamentTitle: "⛳ 2026 회장배 가을 골프대회",
  heroTitle: "2026 회장배 가을 골프대회",

  // 3. Long Drive and Near Pin event hole numbers for this tournament
  longDriveHoles: [8],
  nearPinHoles: [3, 7, 11, 14],
  defaultTeeKey: "white",

  // 4. Pace-of-play & tournament notice card
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

  // 5. Tee-box local rules, event guide, and after-party venue (displayed at bottom of notice card)
  teeBannerTitle: "남성:화이트티, 여성:레드티",
  teeBannerSubHtml: '시그니처 홀인 전후반 첫홀<b style="font-weight:900;">(1번홀, 10번홀)</b>만 남성:블루티, 여성:화이트티',
  eventBannerSubHtml: "장타상(남녀 별도)과 단타·리버스 니어상이 있으니 잘못 쳐도 페어웨이·그린에 올렸으면 기록해 주세요.<br>(단, 1등·꼴등만 시상하니 빠른 진행을 위해 해당 안 되면 생략)",
  afterPartyHtml: '뒷풀이: <span style="font-size:11px; font-weight:600; color:#451a03;">Canton Village (<a href="https://maps.app.goo.gl/HMbiCNwJqs5JsX6b8" target="_blank" style="color:#003876; text-decoration:underline; font-weight:600;">1070 E Stanley Blvd, Livermore, CA 94550</a>)</span>',

  // 6. Footer creator copyright and contact email
  copyrightHtml: '© Created by <a href="mailto:aries75@gmail.com" style="color:#444; text-decoration:underline; font-weight:700;">aries75@gmail.com</a>',

  // 7. Group tee times (shown on home screen group cards)
  firstTeeTime: "11:30",
  teeIntervalMin: 8,

  // 8. Default group & handicap roster (used for initial sheet auto-creation / can be overwritten anytime via admin.html)
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
