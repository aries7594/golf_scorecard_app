/**
 * ============================================================================
 * [Code.gs] 독립형(Standalone) 구글 시트 자동 생성 & 스코어 저장 백엔드 엔진
 * ----------------------------------------------------------------------------
 * - 내 구글 계정(https://script.google.com)에 딱 1번만 배포해 두고 평생 재사용합니다.
 * - 개별 대회 구글 시트 안에는 스크립트가 단 한 줄도 들어가지 않습니다.
 * - GitHub 메인 앱(index.html) 및 총무 설정 페이지(admin.html)와 JSON API로 통신하며,
 *   새 대회 설정과 참석자/핸디 명단을 받아 '2026년 회장배.xlsx'와 100% 동일한 구조·수식·서식의
 *   구글 스프레드시트('1조~N조', '결과', '니어/롱기', 'Stat')를 자동 생성합니다.
 * ============================================================================
 */

var GROUP_LIST_CACHE_TTL_SEC = 300;
var DEFAULT_ADMIN_PIN = "2026";
var PROP_ACTIVE_SHEET_ID = "ACTIVE_SHEET_ID_V1";
var PROP_ACTIVE_SHEET_URL = "ACTIVE_SHEET_URL_V1";
var PROP_ACTIVE_RESULTS_GID = "ACTIVE_RESULTS_GID_V1";
var PROP_ACTIVE_TOURNAMENT_ID = "ACTIVE_TOURNAMENT_ID_V1";
var PROP_ADMIN_PIN = "ADMIN_PIN_V1";
var PROP_HISTORY_JSON = "TOURNAMENT_HISTORY_V1";
var PROP_CFG_CHUNKS = "ACTIVE_CFG_CHUNKS_V1";
var PROP_CFG_PREFIX = "ACTIVE_CFG_PART_";

function doGet() {
    var state = readActiveStateMeta();
    var msg = state.sheetUrl
        ? "✅ Golf ScoreCard API Engine 정상 작동 중 (연결된 시트: " + state.sheetUrl + ")"
        : "✅ Golf ScoreCard API Engine 정상 작동 중 (아직 생성된 대회 시트 없음 — GitHub 앱 또는 admin.html에서 자동 생성됩니다)";
    return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

function getActiveSheetId() {
    try {
        var cache = CacheService.getScriptCache();
        if (cache) {
            var cid = cache.get(PROP_ACTIVE_SHEET_ID);
            if (cid) return cid;
        }
    } catch (e) { }
    var props = PropertiesService.getScriptProperties();
    var sid = props.getProperty(PROP_ACTIVE_SHEET_ID) || "";
    if (sid) {
        try {
            var c2 = CacheService.getScriptCache();
            if (c2) c2.put(PROP_ACTIVE_SHEET_ID, sid, 600);
        } catch (e2) { }
    }
    return sid;
}

function getScopedCacheKey(prefix) {
    var sid = getActiveSheetId() || "NOSHEET";
    return prefix + sid.slice(0, 28) + "_";
}

function getTargetSpreadsheet() {
    var sid = getActiveSheetId();
    if (!sid) {
        throw new Error("연결된 대회 구글 시트가 없습니다. 총무 페이지(admin.html)에서 시트를 생성해주세요.");
    }
    return SpreadsheetApp.openById(sid);
}

function saveChunkedConfig(props, configObj) {
    var raw = JSON.stringify(configObj || {});
    var chunkSize = 4000; // PropertiesService 9KB 한계 여유 확보 (UTF-8 한글 감안)
    var numChunks = Math.ceil(raw.length / chunkSize) || 1;
    var oldCount = Number(props.getProperty(PROP_CFG_CHUNKS) || 0);
    for (var i = 0; i < numChunks; i++) {
        props.setProperty(PROP_CFG_PREFIX + i, raw.slice(i * chunkSize, (i + 1) * chunkSize));
    }
    for (var j = numChunks; j < oldCount; j++) {
        props.deleteProperty(PROP_CFG_PREFIX + j);
    }
    props.setProperty(PROP_CFG_CHUNKS, String(numChunks));
    try {
        var cache = CacheService.getScriptCache();
        if (cache && raw.length < 90000) {
            cache.put("ACTIVE_CFG_CACHE_V1", raw, 300);
        }
    } catch (e) { }
}

function loadChunkedConfig() {
    try {
        var cache = CacheService.getScriptCache();
        if (cache) {
            var cached = cache.get("ACTIVE_CFG_CACHE_V1");
            if (cached) return JSON.parse(cached);
        }
    } catch (e) { }
    var props = PropertiesService.getScriptProperties();
    var count = Number(props.getProperty(PROP_CFG_CHUNKS) || 0);
    if (count <= 0) return null;
    var parts = [];
    for (var i = 0; i < count; i++) {
        parts.push(props.getProperty(PROP_CFG_PREFIX + i) || "");
    }
    var joined = parts.join("");
    if (!joined) return null;
    try {
        var parsed = JSON.parse(joined);
        try {
            var c2 = CacheService.getScriptCache();
            if (c2 && joined.length < 90000) c2.put("ACTIVE_CFG_CACHE_V1", joined, 300);
        } catch (ce) { }
        return parsed;
    } catch (pe) {
        return null;
    }
}

function readActiveStateMeta() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty(PROP_ACTIVE_SHEET_ID) || "";
    var sheetUrl = props.getProperty(PROP_ACTIVE_SHEET_URL) || (sheetId ? ("https://docs.google.com/spreadsheets/d/" + sheetId + "/edit") : "");
    var resultsGid = props.getProperty(PROP_ACTIVE_RESULTS_GID) || "";
    var resultsUrl = (sheetId && resultsGid !== "")
        ? ("https://docs.google.com/spreadsheets/d/" + sheetId + "/edit?gid=" + resultsGid + "#gid=" + resultsGid)
        : sheetUrl;
    var tournamentId = props.getProperty(PROP_ACTIVE_TOURNAMENT_ID) || "";
    return {
        sheetId: sheetId,
        sheetUrl: sheetUrl,
        resultsGid: resultsGid,
        resultsUrl: resultsUrl,
        tournamentId: tournamentId,
        config: loadChunkedConfig()
    };
}

function invalidateActiveCaches(sheetIdOpt) {
    try {
        var cache = CacheService.getScriptCache();
        if (!cache) return;
        cache.remove(PROP_ACTIVE_SHEET_ID);
        cache.remove("ACTIVE_CFG_CACHE_V1");
        if (sheetIdOpt) {
            var pfx = sheetIdOpt.slice(0, 28) + "_";
            cache.remove("GL_" + pfx);
            cache.remove("BF_" + pfx);
        }
    } catch (e) { }
}

function verifyAdminPin(pin) {
    var props = PropertiesService.getScriptProperties();
    var savedPin = props.getProperty(PROP_ADMIN_PIN) || DEFAULT_ADMIN_PIN;
    if (String(pin || "").trim() !== String(savedPin).trim()) {
        throw new Error("총무 비밀번호(PIN)가 올바르지 않습니다.");
    }
}

function colIndexToLetter(col1Based) {
    var temp, letter = "";
    var col = Number(col1Based);
    while (col > 0) {
        temp = (col - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        col = (col - temp - 1) / 26;
    }
    return letter;
}

/**
 * ============================================================================
 * 🏗️ '2026년 회장배.xlsx'와 100% 동일한 구글 스프레드시트 자동 생성기
 *   생성 탭: ['1조'...'N조', '결과', '니어/롱기', 'Stat']
 * ============================================================================
 */
function createTournamentSpreadsheet(spec) {
    spec = spec || {};
    var cfg = spec.config || {};
    var rawGroups = Array.isArray(spec.groups) ? spec.groups : (Array.isArray(cfg.groups) ? cfg.groups : []);
    if (rawGroups.length === 0) {
        throw new Error("생성할 조 편성(참석자 명단)이 비어 있습니다.");
    }

    var pars = (Array.isArray(spec.pars) && spec.pars.length === 18)
        ? spec.pars.map(function (p) { return Number(p) || 4; })
        : [4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 3, 5, 4, 3, 5, 4, 4, 4];

    var nearHoles = (Array.isArray(cfg.nearPinHoles) && cfg.nearPinHoles.length > 0)
        ? cfg.nearPinHoles.map(function (n) { return Number(n); }).filter(function (n) { return n >= 1 && n <= 18; })
        : [3, 7, 11, 14];
    var longHoles = (Array.isArray(cfg.longDriveHoles) && cfg.longDriveHoles.length > 0)
        ? cfg.longDriveHoles.map(function (n) { return Number(n); }).filter(function (n) { return n >= 1 && n <= 18; })
        : [8];

    var sheetTitle = String(cfg.sheetTitle || cfg.heroTitle || cfg.tournamentTitle || "골프대회 스코어보드")
        .replace(/^[⛳🏆🎯\s]+/, "")
        .trim() || "골프대회 스코어보드";

    // 정규화된 조 목록 구성
    var normGroups = [];
    for (var gi = 0; gi < rawGroups.length; gi++) {
        var g = rawGroups[gi] || {};
        var gName = String(g.name || ((gi + 1) + "조")).trim();
        if (gName.indexOf("조") === -1) gName = gName + "조";
        var pArr = Array.isArray(g.players) ? g.players : [];
        var cleanPlayers = [];
        for (var pi = 0; pi < pArr.length; pi++) {
            var pItem = pArr[pi];
            var pName = (typeof pItem === "string") ? pItem.trim() : String((pItem && pItem.name) || "").trim();
            var pHcp = (typeof pItem === "object" && pItem !== null && pItem.handicap !== undefined && pItem.handicap !== "")
                ? Number(pItem.handicap)
                : "";
            if (isNaN(pHcp)) pHcp = "";
            if (pName) {
                cleanPlayers.push({ name: pName, handicap: pHcp });
            }
        }
        if (cleanPlayers.length > 0) {
            normGroups.push({ name: gName, players: cleanPlayers });
        }
    }
    if (normGroups.length === 0) {
        throw new Error("유효한 참석자 이름이 최소 1명 이상 필요합니다.");
    }

    var ss = SpreadsheetApp.create(sheetTitle);
    var defaultSheets = ss.getSheets();

    // ------------------------------------------------------------------------
    // 1. 조별 탭 생성 ('1조' ~ 'N조')
    // ------------------------------------------------------------------------
    for (var idx = 0; idx < normGroups.length; idx++) {
        var grp = normGroups[idx];
        var gSheet = ss.insertSheet(grp.name);
        var pCount = grp.players.length;
        var lastPlayerRow = 2 + pCount;       // 4명일 때 6행, 3명일 때 5행
        var guideRow = lastPlayerRow + 1;     // 4명일 때 7행
        var missionRow = lastPlayerRow + 2;   // 4명일 때 8행
        var memoRow = Math.max(15, missionRow + 3); // 15행 ('메모')

        var totalRows = memoRow;
        var grid = [];
        for (var r = 0; r < totalRows; r++) {
            var emptyRow = [];
            for (var c = 0; c < 21; c++) emptyRow.push("");
            grid.push(emptyRow);
        }

        // 1행: Hole | 1..18 | TOT | 핸디
        grid[0][0] = "Hole";
        for (var h = 1; h <= 18; h++) grid[0][h] = h;
        grid[0][19] = "TOT";
        grid[0][20] = "핸디";

        // 2행: Par | par1..par18 | =SUM(B2:S2) | ""
        grid[1][0] = "Par";
        for (var hp = 0; hp < 18; hp++) grid[1][hp + 1] = pars[hp];
        grid[1][19] = "=SUM(B2:S2)";

        // 3행 ~ lastPlayerRow행: 선수명 | 빈칸(18홀) | =SUM(B3:S3) | 핸디
        for (var p = 0; p < pCount; p++) {
            var rIdx = 2 + p;
            var rNum = rIdx + 1;
            grid[rIdx][0] = grp.players[p].name;
            grid[rIdx][19] = "=SUM(B" + rNum + ":S" + rNum + ")";
            grid[rIdx][20] = grp.players[p].handicap;
        }

        // 안내문 행 (B7:T7 병합)
        grid[guideRow - 1][1] = "파 대비 점수로 적어주세요: (보기:1, 더블:2, 버디:-1, ....)";

        // 홀파미션 행 (A8: '홀파미션', B8:S8 수식)
        grid[missionRow - 1][0] = "홀파미션";
        for (var hm = 1; hm <= 18; hm++) {
            var colL = colIndexToLetter(hm + 1); // B..S
            grid[missionRow - 1][hm] = '=IF(COUNTBLANK(' + colL + '3:' + colL + lastPlayerRow + ') > 0, "도전", IF(SUM(' + colL + '3:' + colL + lastPlayerRow + ') <= 0, "성공!", "실패"))';
        }

        // 메모 행 (A15: '메모')
        grid[memoRow - 1][0] = "메모";

        gSheet.getRange(1, 1, totalRows, 21).setValues(grid);

        // 조별 시트 서식 지정 ('2026년 회장배.xlsx' 동일 스타일)
        gSheet.getRange(1, 1, 1, 21)
            .setBackground("#ff0000")
            .setFontColor("#ffffff")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");
        gSheet.getRange(2, 1, 1, 20)
            .setBackground("#f8f9fa")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");
        gSheet.getRange(3, 1, pCount, 21)
            .setHorizontalAlignment("center")
            .setVerticalAlignment("middle");
        gSheet.getRange(3, 1, pCount, 1).setFontWeight("bold");
        gSheet.getRange(1, 1, lastPlayerRow, 21)
            .setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);

        gSheet.getRange(guideRow, 2, 1, 19).merge()
            .setHorizontalAlignment("center")
            .setFontColor("#555555");

        var missionRange = gSheet.getRange(missionRow, 2, 1, 18);
        gSheet.getRange(missionRow, 1, 1, 19)
            .setHorizontalAlignment("center")
            .setFontWeight("bold")
            .setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);

        var cfRules = [
            SpreadsheetApp.newConditionalFormatRule()
                .whenTextContains("성공")
                .setBackground("#d9ead3")
                .setFontColor("#137333")
                .setBold(true)
                .setRanges([missionRange])
                .build(),
            SpreadsheetApp.newConditionalFormatRule()
                .whenTextContains("실패")
                .setBackground("#fce8e6")
                .setFontColor("#a50e0e")
                .setRanges([missionRange])
                .build()
        ];
        gSheet.setConditionalFormatRules(cfRules);

        gSheet.getRange(memoRow, 1).setFontWeight("bold").setBackground("#fff2cc").setHorizontalAlignment("center");
        gSheet.setColumnWidth(1, 88);
        gSheet.setColumnWidths(2, 18, 42);
        gSheet.setColumnWidth(20, 56);
        gSheet.setColumnWidth(21, 56);
        gSheet.setFrozenRows(2);
        gSheet.setFrozenColumns(1);
    }

    // ------------------------------------------------------------------------
    // 2. '결과' 탭 생성 (gid=659330907 동일 구조·수식·배경색·조건부서식)
    // ------------------------------------------------------------------------
    var resSheet = ss.insertSheet("결과");
    var totalPlayers = 0;
    for (var g0 = 0; g0 < normGroups.length; g0++) totalPlayers += normGroups[g0].players.length;
    var lastResRow = 1 + totalPlayers;

    var resHeaders = [
        "Team", "이름",
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
        "합계", "핸디", "넷 스코어",
        "버디", "파", "보기", "더블", "트리플", "쿼드러플",
        "잉꼬상", "정직상", "바이너리", "전반스코어", "후반스코어", "후반스코어"
    ];
    var resGrid = [resHeaders];
    var resBgGrid = [];
    var headerBg = [];
    for (var hc = 0; hc < 35; hc++) {
        headerBg.push((hc >= 2 && hc <= 19) ? "#ff0000" : "#f1f3f4");
    }
    resBgGrid.push(headerBg);

    var groupMergeRanges = [];
    var curResRow = 2;

    for (var gi2 = 0; gi2 < normGroups.length; gi2++) {
        var grp2 = normGroups[gi2];
        var gEsc = grp2.name.replace(/'/g, "''");
        var gBg = (gi2 % 2 === 0) ? "#fff2cc" : "#d9ead3"; // 홀수조 연노랑, 짝수조 연초록
        var groupStartRow = curResRow;

        for (var pi2 = 0; pi2 < grp2.players.length; pi2++) {
            var r = curResRow;
            var pSheetRow = 3 + pi2;
            var rowArr = new Array(35).fill("");

            if (pi2 === 0) {
                rowArr[0] = '=IFERROR(REGEXEXTRACT(CELL("address", \'' + gEsc + '\'!A1), "\'?([^\'!]+)\'?!"), "' + grp2.name + '")';
            }
            rowArr[1] = "='" + gEsc + "'!A" + pSheetRow;
            for (var h2 = 1; h2 <= 18; h2++) {
                var srcColL = colIndexToLetter(h2 + 1); // B..S
                rowArr[1 + h2] = "='" + gEsc + "'!" + srcColL + pSheetRow;
            }
            // U열(20): 합계
            rowArr[20] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(C' + r + ':T' + r + '), "")';
            // V열(21): 핸디
            rowArr[21] = "='" + gEsc + "'!U" + pSheetRow;
            // W열(22): 넷 스코어
            rowArr[22] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), U' + r + '-V' + r + ', "")';
            // X~AC열(23..28): 버디(-1), 파(0), 보기(1), 더블(2), 트리플(3), 쿼드러플(4)
            rowArr[23] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', -1), "")';
            rowArr[24] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 0), "")';
            rowArr[25] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 1), "")';
            rowArr[26] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 2), "")';
            rowArr[27] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 3), "")';
            rowArr[28] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 4), "")';
            // AD열(29): 잉꼬상 (전·후반 타수 편차 절대값)
            rowArr[29] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), ABS(SUM(C' + r + ':K' + r + ')-SUM(L' + r + ':T' + r + ')), "")';
            // AE열(30): 정직상 (실제 타수와 핸디 편차 절대값)
            rowArr[30] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), ABS(U' + r + ' - V' + r + '), "")';
            // AF열(31): 바이너리 (0과 1이 번갈아 나온 최장 연속 횟수 — 표준 내장 REDUCE/LAMBDA 수식)
            rowArr[31] = '=IF(ISNUMBER($U' + r + '), INDEX(REDUCE({0, 0, -99}, C' + r + ':T' + r + ', LAMBDA(acc, v, LET(mx, INDEX(acc,1), cur, INDEX(acc,2), prv, INDEX(acc,3), ncur, IF(OR(v=0, v=1), IF(AND(OR(prv=0, prv=1), v<>prv), cur+1, 1), 0), {MAX(mx, ncur), ncur, v}))), 1), "")';
            // AG열(32): 전반스코어
            rowArr[32] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(C' + r + ':K' + r + '), "")';
            // AH열(33): 후반스코어
            rowArr[33] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(L' + r + ':T' + r + '), "")';
            // AI열(34): 후반 타이브레이크 보조 합계
            rowArr[34] = '=IF(AND(ISNUMBER(D' + r + '), ISNUMBER(U' + r + ')), SUM(M' + r + ':U' + r + '), "")';

            resGrid.push(rowArr);
            resBgGrid.push(new Array(35).fill(gBg));
            curResRow++;
        }

        var groupEndRow = curResRow - 1;
        if (groupEndRow > groupStartRow) {
            groupMergeRanges.push([groupStartRow, groupEndRow - groupStartRow + 1]);
        }
    }

    resSheet.getRange(1, 1, resGrid.length, 35)
        .setValues(resGrid)
        .setBackgrounds(resBgGrid)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle")
        .setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);

    resSheet.getRange(1, 1, 1, 35).setFontWeight("bold");
    resSheet.getRange(1, 3, 1, 18).setFontColor("#ffffff");
    resSheet.getRange(2, 1, totalPlayers, 2).setFontWeight("bold");
    resSheet.getRange(2, 21, totalPlayers, 3).setFontWeight("bold");

    for (var gm = 0; gm < groupMergeRanges.length; gm++) {
        resSheet.getRange(groupMergeRanges[gm][0], 1, groupMergeRanges[gm][1], 1).merge();
    }

    // 최저타 상위 강조 조건부서식
    var uColRange = resSheet.getRange(2, 21, totalPlayers, 1);
    resSheet.setConditionalFormatRules([
        SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied("=AND(ISNUMBER(U2), U2=SMALL($U$2:$U$" + lastResRow + ", 1))")
            .setBackground("#ffd966")
            .setBold(true)
            .setRanges([uColRange])
            .build()
    ]);

    resSheet.setColumnWidth(1, 52);
    resSheet.setColumnWidth(2, 88);
    resSheet.setColumnWidths(3, 18, 38);
    resSheet.setColumnWidths(21, 15, 68);
    resSheet.setFrozenRows(1);
    resSheet.setFrozenColumns(2);

    // ------------------------------------------------------------------------
    // 3. '니어/롱기' 탭 생성
    // ------------------------------------------------------------------------
    var nearSheet = ss.insertSheet("니어/롱기");
    var longColBase = Math.max(nearHoles.length * 2 + 1, 9);
    var hofCol = Math.max(longColBase + longHoles.length * 2, 11); // 기본 K열(11)
    var nlHeader = new Array(hofCol).fill("");
    var nlMerges = [];
    var statEventDefs = [];

    for (var ni = 0; ni < nearHoles.length; ni++) {
        var nCol = ni * 2 + 1;
        var nTitle = "니어리스트 " + nearHoles[ni] + "번홀";
        nlHeader[nCol - 1] = nTitle;
        nlMerges.push(nCol);
        statEventDefs.push({ title: nTitle, nameCol: nCol, distCol: nCol + 1 });
    }
    for (var li = 0; li < longHoles.length; li++) {
        var lCol = longColBase + li * 2;
        var lTitle = "롱기스트 " + longHoles[li] + "번홀";
        nlHeader[lCol - 1] = lTitle;
        nlMerges.push(lCol);
        statEventDefs.push({ title: lTitle, nameCol: lCol, distCol: lCol + 1 });
    }
    nlHeader[hofCol - 1] = "명예의 전당";

    nearSheet.getRange(1, 1, 1, hofCol)
        .setValues([nlHeader])
        .setBackground("#fff2cc")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
    for (var nm = 0; nm < nlMerges.length; nm++) {
        nearSheet.getRange(1, nlMerges[nm], 1, 2).merge();
    }
    // 니어 피트/인치 텍스트 열(B, D, F, H)이 날짜/숫자로 자동 변환되지 않도록 텍스트 서식('@') 지정
    for (var nf = 0; nf < nearHoles.length; nf++) {
        nearSheet.getRange(2, nf * 2 + 2, 60, 1).setNumberFormat("@");
    }
    nearSheet.setColumnWidth(hofCol, 280);
    nearSheet.setFrozenRows(1);

    // ------------------------------------------------------------------------
    // 4. 'Stat' 탭 생성 (전 부문 실시간 자동 순위표 =SORT(...))
    // ------------------------------------------------------------------------
    var statSheet = ss.insertSheet("Stat");
    var statCategories = [
        { title: "최저타", colL: "U", asc: "TRUE" },
        { title: "넷 스코어", colL: "W", asc: "TRUE" },
        { title: "버디", colL: "X", asc: "FALSE" },
        { title: "파", colL: "Y", asc: "FALSE" },
        { title: "보기", colL: "Z", asc: "FALSE" },
        { title: "더블", colL: "AA", asc: "FALSE" },
        { title: "트리플", colL: "AB", asc: "FALSE" },
        { title: "쿼드러플", colL: "AC", asc: "FALSE" },
        { title: "잉꼬상", colL: "AD", asc: "TRUE" },
        { title: "정직상", colL: "AE", asc: "TRUE" },
        { title: "바이너리", colL: "AF", asc: "FALSE" },
        { title: "전반스코어", colL: "AG", asc: "TRUE" },
        { title: "후반스코어", colL: "AH", asc: "TRUE" }
    ];

    var totalStatPairs = statCategories.length + statEventDefs.length;
    var totalStatCols = totalStatPairs * 2;
    var statRow1 = new Array(totalStatCols).fill("");
    var statRow2 = new Array(totalStatCols).fill("");
    var nearMaxRow = Math.max(lastResRow, 50);

    for (var sc = 0; sc < statCategories.length; sc++) {
        var cBase = sc * 2;
        var cat = statCategories[sc];
        statRow1[cBase] = cat.title;
        statRow2[cBase] = "=IFERROR(SORT({'결과'!B2:B" + lastResRow + ", '결과'!" + cat.colL + "2:" + cat.colL + lastResRow + "}, 2, " + cat.asc + "), \"\")";
    }
    for (var se = 0; se < statEventDefs.length; se++) {
        var eBase = (statCategories.length + se) * 2;
        var evDef = statEventDefs[se];
        var nColL = colIndexToLetter(evDef.nameCol);
        var dColL = colIndexToLetter(evDef.distCol);
        statRow1[eBase] = evDef.title;
        statRow2[eBase] = "=IFERROR(SORT({'니어/롱기'!" + nColL + "2:" + nColL + nearMaxRow + ", '니어/롱기'!" + dColL + "2:" + dColL + nearMaxRow + "}, 2, TRUE), \"\")";
    }

    statSheet.getRange(1, 1, 2, totalStatCols).setValues([statRow1, statRow2]);
    statSheet.getRange(1, 1, 1, totalStatCols)
        .setBackground("#d9ead3")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
    for (var sp = 0; sp < totalStatPairs; sp++) {
        statSheet.getRange(1, sp * 2 + 1, 1, 2).merge();
    }
    statSheet.setFrozenRows(1);

    // 기본 생성 시트(Sheet1/시트1) 삭제
    for (var ds = 0; ds < defaultSheets.length; ds++) {
        try {
            ss.deleteSheet(defaultSheets[ds]);
        } catch (de) { }
    }

    ss.setActiveSheet(resSheet);
    SpreadsheetApp.flush();

    var resultsGid = String(resSheet.getSheetId());
    var sheetId = ss.getId();
    var sheetUrl = ss.getUrl();
    var resultsUrl = "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit?gid=" + resultsGid + "#gid=" + resultsGid;

    return {
        sheetId: sheetId,
        sheetUrl: sheetUrl,
        resultsGid: resultsGid,
        resultsUrl: resultsUrl,
        sheetTitle: sheetTitle,
        groupList: normGroups.map(function (g) {
            return {
                name: g.name,
                players: g.players.map(function (p) { return p.name; })
            };
        })
    };
}

function recordSheetHistory(entry) {
    try {
        var props = PropertiesService.getScriptProperties();
        var raw = props.getProperty(PROP_HISTORY_JSON);
        var list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];
        list = list.filter(function (item) { return item && item.sheetId !== entry.sheetId; });
        list.unshift(entry);
        if (list.length > 15) list = list.slice(0, 15);
        props.setProperty(PROP_HISTORY_JSON, JSON.stringify(list));
    } catch (e) { }
}

function getSheetHistoryList() {
    try {
        var props = PropertiesService.getScriptProperties();
        var raw = props.getProperty(PROP_HISTORY_JSON);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveActiveTournamentState(sheetInfo, configObj) {
    var oldSheetId = getActiveSheetId();
    var props = PropertiesService.getScriptProperties();
    props.setProperty(PROP_ACTIVE_SHEET_ID, sheetInfo.sheetId);
    props.setProperty(PROP_ACTIVE_SHEET_URL, sheetInfo.sheetUrl || "");
    props.setProperty(PROP_ACTIVE_RESULTS_GID, String(sheetInfo.resultsGid || ""));
    if (configObj && configObj.tournamentId) {
        props.setProperty(PROP_ACTIVE_TOURNAMENT_ID, String(configObj.tournamentId));
    }
    if (configObj) {
        saveChunkedConfig(props, configObj);
    }
    invalidateActiveCaches(oldSheetId);
    invalidateActiveCaches(sheetInfo.sheetId);
}

/**
 * GitHub 메인 앱(index.html) 부팅 시 1회 호출:
 * - 이미 생성된 활성 대회 시트가 있으면 즉시 { config, groupList, sheetId, resultsUrl } 반환
 * - 아직 시트가 하나도 없고 fallbackSpec에 기본 설정/명단이 함께 전달되면 Lock 보호 하에 자동으로 새 시트 생성!
 */
function getInitBundle(fallbackSpec) {
    var meta = readActiveStateMeta();
    if (!meta.sheetId && fallbackSpec && (fallbackSpec.groups || (fallbackSpec.config && fallbackSpec.config.groups))) {
        var lock = LockService.getScriptLock();
        lock.waitLock(30000);
        try {
            meta = readActiveStateMeta();
            if (!meta.sheetId) {
                var created = createTournamentSpreadsheet(fallbackSpec);
                var initCfg = fallbackSpec.config || {};
                saveActiveTournamentState(created, initCfg);
                recordSheetHistory({
                    sheetId: created.sheetId,
                    resultsUrl: created.resultsUrl,
                    title: created.sheetTitle,
                    createdAt: new Date().toISOString()
                });
                return {
                    autoCreated: true,
                    sheetId: created.sheetId,
                    sheetUrl: created.sheetUrl,
                    resultsUrl: created.resultsUrl,
                    config: initCfg,
                    groupList: created.groupList
                };
            }
        } finally {
            lock.releaseLock();
        }
    }

    var groupList = meta.sheetId ? getGroupList() : [];
    return {
        autoCreated: false,
        sheetId: meta.sheetId,
        sheetUrl: meta.sheetUrl,
        resultsUrl: meta.resultsUrl,
        config: meta.config || (fallbackSpec && fallbackSpec.config) || null,
        groupList: groupList
    };
}

// [초고속] 조 목록 및 선수 명단 가져오기 (시트별 격리 캐시 + '결과' 시트 1회 일괄 조회)
function getGroupList() {
    var glCacheKey = getScopedCacheKey("GL_");
    try {
        var cache = CacheService.getScriptCache();
        if (cache) {
            var cachedJson = cache.get(glCacheKey);
            if (cachedJson) {
                var parsed = JSON.parse(cachedJson);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        }
    } catch (ce) { }

    var ss = getTargetSpreadsheet();
    var resSheet = ss.getSheetByName("결과");
    var groupsMap = {};

    if (resSheet) {
        var lastRow = resSheet.getLastRow();
        if (lastRow >= 2) {
            var data = resSheet.getRange(2, 1, lastRow - 1, 2).getValues();
            var currentGroup = "";
            for (var i = 0; i < data.length; i++) {
                var rawGroup = data[i][0] ? String(data[i][0]).trim() : "";
                var pName = data[i][1] ? String(data[i][1]).trim() : "";
                if (rawGroup !== "") {
                    currentGroup = rawGroup;
                }
                if (currentGroup && currentGroup.indexOf("조") !== -1 && pName) {
                    if (!groupsMap[currentGroup]) {
                        groupsMap[currentGroup] = [];
                    }
                    groupsMap[currentGroup].push(pName);
                }
            }
        }
    }

    if (Object.keys(groupsMap).length === 0) {
        var sheets = ss.getSheets();
        sheets.forEach(function (s) {
            var name = s.getName();
            if (name.indexOf("조") !== -1 && name.indexOf("결과") === -1 && name.indexOf("Copy") === -1) {
                var players = [];
                try {
                    var rawPlayers = s.getRange("A3:A8").getValues();
                    for (var i = 0; i < rawPlayers.length; i++) {
                        var p = rawPlayers[i][0] ? String(rawPlayers[i][0]).trim() : "";
                        if (p && p !== "홀파미션" && p !== "메모" && p.indexOf("점수") === -1 && p.indexOf("Par") === -1) {
                            players.push(p);
                        }
                    }
                } catch (err) { }
                groupsMap[name] = players;
            }
        });
    }

    var groups = [];
    for (var name in groupsMap) {
        groups.push({
            name: name,
            players: groupsMap[name]
        });
    }

    groups.sort(function (a, b) {
        var numA = parseInt(a.name.replace(/[^0-9]/g, ""), 10) || 0;
        var numB = parseInt(b.name.replace(/[^0-9]/g, ""), 10) || 0;
        if (numA !== numB) return numA - numB;
        return a.name.localeCompare(b.name);
    });

    if (groups.length > 0) {
        try {
            var cacheOut = CacheService.getScriptCache();
            if (cacheOut) {
                cacheOut.put(glCacheKey, JSON.stringify(groups), GROUP_LIST_CACHE_TTL_SEC);
            }
        } catch (ce2) { }
    }

    return groups;
}

// 이미 읽어온 2차원 배열(A열)에서 "메모"라고 적힌 행 번호(1-based)를 탐색 (없을 경우 에러 발생)
function findMemoRowFromValues(allValues, sheetName) {
    // 1순위: A열 값이 정확히 "메모"인 행
    for (var i = 0; i < allValues.length; i++) {
        var val = allValues[i][0] ? String(allValues[i][0]).trim() : "";
        if (val === "메모") {
            return i + 1;
        }
    }

    // 2순위: A열 값에 "메모"가 포함된 행
    for (var j = 0; j < allValues.length; j++) {
        var val2 = allValues[j][0] ? String(allValues[j][0]).trim() : "";
        if (val2.indexOf("메모") !== -1) {
            return j + 1;
        }
    }

    throw new Error("'" + sheetName + "' 시트의 A열에서 '메모' 행을 찾을 수 없습니다.");
}

// 특정 조의 데이터 가져오기 (단 1번의 시트 읽기로 Par, 가변 선수 명단, 메모 행 동적 조회)
function getGroupData(groupName) {
    var ss = getTargetSpreadsheet();
    var sheet = ss.getSheetByName(groupName);
    if (!sheet) throw new Error("해당 조를 찾을 수 없습니다.");

    // 시트 전체(1행~최소30행, A열~S열)를 단 1번의 API 호출로 일괄 읽기
    var maxRow = Math.max(sheet.getLastRow(), 30);
    var allValues = sheet.getRange(1, 1, maxRow, 19).getValues();

    // 1. Par 타수 (2행 B2:S2 -> index 1, col 1..18)
    var pars = allValues[1].slice(1, 19);

    // 2. 선수 정보 (3행~8행 순회하며 실제 시트 행 번호 기록)
    var players = [];
    for (var r = 2; r <= 7 && r < allValues.length; r++) {
        var rowData = allValues[r];
        var name = rowData[0] ? String(rowData[0]).trim() : "";
        var actualRow = r + 1; // 실제 스프레드시트 행 번호 (3 ~ 8)

        // 유효한 선수명만 필터링
        if (name && name !== "홀파미션" && name !== "메모" && name.indexOf("점수") === -1 && name.indexOf("Par") === -1) {
            var scores = [];
            for (var h = 1; h <= 18; h++) {
                var val = rowData[h];
                var strVal = (val === null || val === undefined) ? "" : String(val).trim();
                scores.push(strVal === "" || isNaN(Number(strVal)) ? "" : Number(strVal));
            }
            players.push({
                name: name,
                rowNumber: actualRow, // ✅ 선수의 실제 시트 행 번호 전달
                scores: scores
            });
        }
    }

    // 3. A열에서 "메모"라고 적힌 행을 찾아 홀별 메모 읽기 (B열~S열)
    var memoRow = findMemoRowFromValues(allValues, groupName);
    var rawNotes = allValues[memoRow - 1].slice(1, 19);
    var notes = rawNotes.map(function (val) {
        return val !== null && val !== undefined ? String(val).trim() : "";
    });

    return {
        groupName: groupName,
        pars: pars,
        players: players,
        notes: notes,
        birdieFeed: reconcileGroupBirdieFeed(groupName, players, ss)
    };
}

// ✅ 초고속 스코어 및 메모 안전 병합 저장 (1회 일괄 읽기 + 연속 행 묶음 쓰기 + 셀 단위 스마트 병합 + 오프라인 다중 홀 동기화 지원)
function saveGroupScores(groupName, scoreData, notesData, activeHole, nearPinHoles, longDriveHoles, dirtyNoteHoles, ticket) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000); // 동시 저장 대기를 위해 15초 락 대기

    try {
        // 🔢 번호표 검사: 같은 폰이 이미 더 최신 번호를 저장했다면, 늦게 도착한 이 옛 요청은 시트에 쓰지 않음
        var isStaleTicket = false;
        if (ticket && ticket.device && Number(ticket.seq) > 0) {
            try {
                var seqCache = CacheService.getScriptCache();
                var seqKey = getScopedCacheKey("SAVESEQ_") + encodeURIComponent(groupName) + "_" + String(ticket.device).slice(0, 40);
                if (Number(ticket.seq) <= Number(seqCache.get(seqKey) || 0)) {
                    isStaleTicket = true;
                } else {
                    seqCache.put(seqKey, String(ticket.seq), 21600); // 6시간 기억
                }
            } catch (ce) { } // 캐시 오류 시 번호표 검사만 건너뛰고 저장은 정상 진행
        }
        if (isStaleTicket) {
            return { success: true, stale: true, message: "이미 더 최신 저장이 반영되어 있습니다." };
        }

        var ss = getTargetSpreadsheet();
        var sheet = ss.getSheetByName(groupName);
        if (!sheet) throw new Error("시트 '" + groupName + "'를 찾을 수 없습니다.");

        var numPlayers = scoreData ? scoreData.length : 0;
        if (numPlayers === 0) return { success: false, message: "저장할 데이터가 없습니다." };

        // activeHole이 단일 숫자이거나 배열(오프라인 임시저장 홀 포함)일 때 모두 대응
        var activeIdxMap = {};
        var hasSpecificActiveHoles = false;
        if (Array.isArray(activeHole)) {
            for (var k = 0; k < activeHole.length; k++) {
                var ah = Number(activeHole[k]);
                if (ah >= 1 && ah <= 18) {
                    activeIdxMap[ah - 1] = true;
                    hasSpecificActiveHoles = true;
                }
            }
        } else if (activeHole && Number(activeHole) >= 1 && Number(activeHole) <= 18) {
            activeIdxMap[Number(activeHole) - 1] = true;
            hasSpecificActiveHoles = true;
        }

        // 1. 시트 전체(1행~최소30행, A열~S열)를 단 1번만 읽기
        var maxRow = Math.max(sheet.getLastRow(), 30);
        var allValues = sheet.getRange(1, 1, maxRow, 19).getValues();
        var memoRow = findMemoRowFromValues(allValues, groupName);

        var mergedScores = [];
        var targetRows = [];
        var groupPlayerNames = [];
        var newBirdies = [];
        var canceledBirdies = [];

        // 2. 메모리 상에서 각 선수의 기존 점수와 신규 점수 셀 단위 병합 + 신규 버디(-1)/이글(-2) 감지
        for (var p = 0; p < numPlayers; p++) {
            var playerData = scoreData[p];
            var targetRow = (playerData && playerData.rowNumber) ? Number(playerData.rowNumber) : (3 + p);
            targetRows.push(targetRow);

            var playerName = (allValues[targetRow - 1] && allValues[targetRow - 1][0])
                ? String(allValues[targetRow - 1][0]).trim()
                : "";
            if (playerName) groupPlayerNames.push(playerName);
            var incomingScores = (playerData && playerData.scores) ? playerData.scores : playerData;
            var existingRow = (allValues[targetRow - 1]) ? allValues[targetRow - 1].slice(1, 19) : new Array(18).fill("");

            // 해당 기기에서 실제로 터치해 변경한 홀 목록(dirtyHoles) 확인 (구버전 호출 시 기존 activeHole 방식으로 폴백)
            var playerDirtyMap = null;
            if (playerData && Array.isArray(playerData.dirtyHoles)) {
                playerDirtyMap = {};
                for (var dh = 0; dh < playerData.dirtyHoles.length; dh++) {
                    var dHoleNum = Number(playerData.dirtyHoles[dh]);
                    if (dHoleNum >= 1 && dHoleNum <= 18) {
                        playerDirtyMap[dHoleNum - 1] = true;
                    }
                }
            }

            var mergedRow = [];

            for (var h = 0; h < 18; h++) {
                var incoming = incomingScores ? incomingScores[h] : "";
                var existing = existingRow ? existingRow[h] : "";

                var hasIncoming = (incoming !== "" && incoming !== null && incoming !== undefined && String(incoming).trim() !== "" && !isNaN(Number(incoming)));
                var hasExisting = (existing !== "" && existing !== null && existing !== undefined && String(existing).trim() !== "" && !isNaN(Number(existing)));
                var isActiveHole = !hasSpecificActiveHoles || !!activeIdxMap[h];
                var isCellDirty = (playerDirtyMap !== null) ? !!playerDirtyMap[h] : isActiveHole;

                if (isActiveHole && isCellDirty) {
                    // 👉 현재 기기에서 직접 터치하여 입력/수정한 선수 칸: 신규 값 또는 선택 취소("") 즉시 반영
                    if (hasIncoming) {
                        var numIn = Number(incoming);
                        mergedRow.push(numIn);
                    } else {
                        mergedRow.push("");
                    }
                } else {
                    // 👉 건드리지 않은 선수 칸 또는 그 외 홀: 동반자 입력값 보존을 위해 기존 시트 점수 최우선 유지
                    if (hasExisting) {
                        mergedRow.push(Number(existing));
                    } else if (playerDirtyMap === null && hasIncoming) {
                        mergedRow.push(Number(incoming));
                    } else {
                        mergedRow.push("");
                    }
                }
            }

            // 해당 선수의 병합된 전체 홀 점수를 기준으로 현재 저장한 홀의 버디(-1)/이글(-2)/연속파(3·4·5연속 파) 감지
            if (playerName) {
                for (var ahIdx = 0; ahIdx < 18; ahIdx++) {
                    var isHoleAct = !hasSpecificActiveHoles || !!activeIdxMap[ahIdx];
                    if (!isHoleAct) continue;

                    var curSc = mergedRow[ahIdx];
                    var hasCurSc = (curSc !== "" && curSc !== null && curSc !== undefined && !isNaN(Number(curSc)));
                    if (hasCurSc) {
                        var numCur = Number(curSc);
                        if (numCur === -1 || numCur === -2) {
                            newBirdies.push({
                                group: groupName,
                                hole: ahIdx + 1,
                                player: playerName,
                                score: numCur,
                                type: numCur === -2 ? "EAGLE" : "BIRDIE"
                            });
                        } else if (numCur === 0) {
                            var streakCnt = calcPlayerParStreakAtHole(mergedRow, ahIdx);
                            if (streakCnt === 3 || streakCnt === 4 || streakCnt === 5) {
                                newBirdies.push({
                                    group: groupName,
                                    hole: ahIdx + 1,
                                    player: playerName,
                                    score: streakCnt,
                                    type: "PAR_STREAK"
                                });
                            } else {
                                canceledBirdies.push({
                                    group: groupName,
                                    hole: ahIdx + 1,
                                    player: playerName
                                });
                            }
                        } else {
                            canceledBirdies.push({
                                group: groupName,
                                hole: ahIdx + 1,
                                player: playerName
                            });
                        }
                    } else {
                        canceledBirdies.push({
                            group: groupName,
                            hole: ahIdx + 1,
                            player: playerName
                        });
                    }
                }
            }

            mergedScores.push(mergedRow);
        }

        // 2-1. 홀파미션(우리 조 전원 파(0) 이하 세이브!) 성공 여부 감지 및 취소 처리
        if (numPlayers > 0) {
            var playersListStr = groupPlayerNames.join("·");
            for (var mh = 0; mh < 18; mh++) {
                var isMissionHoleActive = !hasSpecificActiveHoles || !!activeIdxMap[mh];
                if (!isMissionHoleActive) continue;

                var allParOrBetter = true;
                for (var mp = 0; mp < numPlayers; mp++) {
                    var mVal = mergedScores[mp][mh];
                    if (mVal === "" || mVal === null || mVal === undefined || isNaN(Number(mVal)) || Number(mVal) > 0) {
                        allParOrBetter = false;
                        break;
                    }
                }

                if (allParOrBetter) {
                    newBirdies.push({
                        group: groupName,
                        hole: mh + 1,
                        player: "__ALL_PAR__",
                        playersText: playersListStr,
                        score: 0,
                        type: "PAR_MISSION"
                    });
                } else {
                    canceledBirdies.push({
                        group: groupName,
                        hole: mh + 1,
                        player: "__ALL_PAR__"
                    });
                }
            }
        }

        // 3. 선수 행 번호가 연속(예: 3,4,5행 또는 3,4,5,6행)이면 단 1번의 setValues로 일괄 저장, 불연속이면 개별 행 저장
        var isContiguous = true;
        for (var rIdx = 1; rIdx < targetRows.length; rIdx++) {
            if (targetRows[rIdx] !== targetRows[rIdx - 1] + 1) {
                isContiguous = false;
                break;
            }
        }

        if (isContiguous) {
            sheet.getRange(targetRows[0], 2, numPlayers, 18).setValues(mergedScores);
        } else {
            for (var pIdx = 0; pIdx < numPlayers; pIdx++) {
                sheet.getRange(targetRows[pIdx], 2, 1, 18).setValues([mergedScores[pIdx]]);
            }
        }

        // 4. A열에서 찾은 "메모" 행 안전 병합 및 저장 (동반자 간 동시 니어/롱기 입력 시 선수 단위로 스마트 병합)
        var mergedNotes = new Array(18).fill("");
        if (notesData && Array.isArray(notesData) && notesData.length === 18) {
            var existingNotes = allValues[memoRow - 1].slice(1, 19);
            var dirtyNoteMap = null;
            var dirtyNoteBaseMap = {};
            if (Array.isArray(dirtyNoteHoles)) {
                dirtyNoteMap = {};
                for (var dn = 0; dn < dirtyNoteHoles.length; dn++) {
                    var dnItem = dirtyNoteHoles[dn];
                    var dnHole = (dnItem && typeof dnItem === "object") ? Number(dnItem.hole) : Number(dnItem);
                    if (dnHole >= 1 && dnHole <= 18) {
                        dirtyNoteMap[dnHole - 1] = true;
                        if (dnItem && typeof dnItem === "object" && dnItem.base !== undefined && dnItem.base !== null) {
                            dirtyNoteBaseMap[dnHole - 1] = String(dnItem.base).trim();
                        }
                    }
                }
            }

            var noteSyncIdxMap = {};
            var hasNoteToSync = false;
            for (var nh = 0; nh < 18; nh++) {
                var inNote = (notesData[nh] !== undefined && notesData[nh] !== null) ? String(notesData[nh]).trim() : "";
                var exNote = (existingNotes[nh] !== undefined && existingNotes[nh] !== null) ? String(existingNotes[nh]).trim() : "";
                var isNoteActive = !hasSpecificActiveHoles || !!activeIdxMap[nh];
                var isNoteDirty = (dirtyNoteMap !== null) ? !!dirtyNoteMap[nh] : isNoteActive;

                if (isNoteActive && isNoteDirty) {
                    var baseNote = Object.prototype.hasOwnProperty.call(dirtyNoteBaseMap, nh) ? dirtyNoteBaseMap[nh] : null;
                    mergedNotes[nh] = mergeHoleNoteSmart(exNote, inNote, baseNote);
                    noteSyncIdxMap[nh] = true;
                    hasNoteToSync = true;
                } else {
                    mergedNotes[nh] = exNote !== "" ? exNote : (dirtyNoteMap === null ? inNote : "");
                }
            }
            // 5. 메모가 실제로 변경된 홀에 대해서만 메모 행 쓰기 및 "니어/롱기" 탭에 자동 기록 (점수만 저장 시 불필요한 시트 I/O 생략)
            if (hasNoteToSync || dirtyNoteMap === null) {
                sheet.getRange(memoRow, 2, 1, 18).setValues([mergedNotes]);

                var groupPlayersMap = {};
                for (var gp = 0; gp < targetRows.length; gp++) {
                    var rNum = targetRows[gp];
                    if (allValues[rNum - 1] && allValues[rNum - 1][0]) {
                        var gpName = String(allValues[rNum - 1][0]).trim();
                        if (gpName) groupPlayersMap[gpName] = true;
                    }
                }
                var targetNoteIdxMap = (dirtyNoteMap !== null) ? noteSyncIdxMap : activeIdxMap;
                var hasSpecificNoteHoles = (dirtyNoteMap !== null) ? true : hasSpecificActiveHoles;
                syncNearPinToSheet(ss, mergedNotes, targetNoteIdxMap, hasSpecificNoteHoles, groupPlayersMap, nearPinHoles, longDriveHoles);
            }
        }

        // 6. 전체 참가자 공유 버디/이글/홀파미션/연속파 공지 피드 갱신 및 정합성 검증
        var updatedFeed = updateBirdieFeed(newBirdies, canceledBirdies, ss);
        var verifyPlayers = [];
        for (var vp = 0; vp < numPlayers; vp++) {
            var vRow = targetRows[vp];
            var vName = (allValues[vRow - 1] && allValues[vRow - 1][0]) ? String(allValues[vRow - 1][0]).trim() : "";
            if (vName) {
                verifyPlayers.push({ name: vName, scores: mergedScores[vp] });
            }
        }
        var birdieFeed = reconcileGroupBirdieFeed(groupName, verifyPlayers, ss, updatedFeed);

        SpreadsheetApp.flush();

        return {
            success: true,
            message: "정상 반영되었습니다.",
            mergedScores: mergedScores,
            mergedNotes: mergedNotes,
            birdieFeed: birdieFeed
        };
    } finally {
        lock.releaseLock();
    }
}

var BIRDIE_FEED_KEY = "BIRDIE_FEED_V1";
var BIRDIE_RETENTION_MS = 14 * 60 * 60 * 1000; // 14시간 보관 (당일 라운드 내 모든 기록 유지)
var BIRDIE_MAX_ITEMS = 160; // 28명 18홀 전원 버디/연속파/홀파미션 기록을 앞부분 삭제 없이 모두 보존

// PropertiesService 9KB(9,216B) 한계 방지를 위한 초경량 배열 직렬화/역직렬화 (항목당 약 170B -> 45B로 73% 압축)
function packBirdieFeedItem(ev) {
    var tCode = "B";
    if (ev.type === "EAGLE") tCode = "E";
    else if (ev.type === "PAR_STREAK") tCode = "S";
    else if (ev.type === "PAR_MISSION") tCode = "M";
    var arr = [Number(ev.ts), String(ev.group || ""), Number(ev.hole), String(ev.player || ""), Number(ev.score), tCode];
    if (ev.playersText) arr.push(String(ev.playersText));
    return arr;
}

function unpackBirdieFeedItem(rawItem) {
    if (!rawItem) return null;
    if (Array.isArray(rawItem)) {
        var ts = Number(rawItem[0]) || 0;
        var grp = String(rawItem[1] || "");
        var hole = Number(rawItem[2]) || 0;
        var player = String(rawItem[3] || "");
        var score = Number(rawItem[4]);
        var tCode = rawItem[5] || "B";
        var pText = rawItem[6] ? String(rawItem[6]) : "";
        var evType = "BIRDIE";
        if (tCode === "E") evType = "EAGLE";
        else if (tCode === "S") evType = "PAR_STREAK";
        else if (tCode === "M") evType = "PAR_MISSION";
        else if (score === -2) evType = "EAGLE";
        return {
            id: grp + "_" + hole + "H_" + player + "_" + score,
            ts: ts,
            timeStr: formatBirdieTimeServer(ts),
            group: grp,
            hole: hole,
            player: player,
            playersText: pText,
            score: score,
            type: evType
        };
    }
    if (typeof rawItem === "object" && rawItem.ts) {
        if (!rawItem.timeStr) rawItem.timeStr = formatBirdieTimeServer(rawItem.ts);
        return rawItem;
    }
    return null;
}

function formatBirdieTimeServer(ts) {
    if (!ts) return "";
    if (typeof ts === "string" && ts.indexOf(":") !== -1) return ts;
    var numTs = Number(ts);
    if (isNaN(numTs) || numTs <= 100000) return "";
    var d = new Date(numTs);
    if (isNaN(d.getTime())) return "";
    try {
        if (typeof Utilities !== "undefined" && typeof Session !== "undefined") {
            var tz = Session.getScriptTimeZone() || "America/Los_Angeles";
            return Utilities.formatDate(d, tz, "HH:mm");
        }
    } catch (e) { }
    var hh = d.getHours();
    var mm = d.getMinutes();
    return (hh < 10 ? "0" + hh : String(hh)) + ":" + (mm < 10 ? "0" + mm : String(mm));
}

// 공지 객체를 "니어/롱기" 탭 K2 셀 아래에 기록할 한 줄 텍스트로 변환
function formatBirdieSheetLine(ev) {
    if (!ev) return "";
    var tStr = ev.timeStr ? String(ev.timeStr) : formatBirdieTimeServer(ev.ts);
    var prefix = (tStr ? ("[" + tStr + "] ") : "") + "[" + String(ev.group || "") + "] " + Number(ev.hole) + "H ";
    if (ev.type === "PAR_MISSION" || ev.player === "__ALL_PAR__") {
        return prefix + "홀파미션" + (ev.playersText ? (" - " + String(ev.playersText)) : "");
    }
    if (ev.type === "PAR_STREAK") {
        var sNum = Number(ev.score) || 3;
        var sLabel = "3연속파";
        if (sNum === 4) sLabel = "아우디(4연속파)";
        else if (sNum >= 5) sLabel = "올림픽(5연속파)";
        return prefix + sLabel + " - " + String(ev.player || "");
    }
    if (ev.type === "EAGLE" || Number(ev.score) === -2) {
        return prefix + "이글(-2) - " + String(ev.player || "");
    }
    return prefix + "버디(-1) - " + String(ev.player || "");
}

// "니어/롱기" 탭 K2 셀 아래의 한 줄 텍스트를 공지 객체로 역변환
function parseBirdieSheetLine(cellText, rowIdx, cachedMap) {
    var str = (cellText !== null && cellText !== undefined) ? String(cellText).trim() : "";
    if (!str) return null;
    var regex = /^(?:\[(\d{1,2}:\d{2})\]\s*)?\[([^\]]+)\]\s*(\d+)H\s+(.+)$/;
    var m = regex.exec(str);
    if (!m) return null;

    var timeStr = m[1] ? String(m[1]).trim() : "";
    var grp = m[2] ? String(m[2]).trim() : "";
    var hole = Number(m[3]) || 0;
    var rest = m[4] ? String(m[4]).trim() : "";
    var sepIdx = rest.indexOf(" - ");
    var label = sepIdx !== -1 ? rest.slice(0, sepIdx).trim() : rest;
    var tail = sepIdx !== -1 ? rest.slice(sepIdx + 3).trim() : "";
    if (!grp || hole < 1 || hole > 18) return null;

    var evType = "BIRDIE";
    var score = -1;
    var player = tail;
    var playersText = "";

    if (label.indexOf("홀파미션") !== -1) {
        evType = "PAR_MISSION";
        score = 0;
        player = "__ALL_PAR__";
        playersText = tail;
    } else if (label.indexOf("올림픽") !== -1 || label.indexOf("5연속파") !== -1) {
        evType = "PAR_STREAK";
        score = 5;
    } else if (label.indexOf("아우디") !== -1 || label.indexOf("4연속파") !== -1) {
        evType = "PAR_STREAK";
        score = 4;
    } else if (label.indexOf("3연속파") !== -1) {
        evType = "PAR_STREAK";
        score = 3;
    } else if (label.indexOf("이글") !== -1 || label.indexOf("-2") !== -1) {
        evType = "EAGLE";
        score = -2;
    } else {
        evType = "BIRDIE";
        score = -1;
    }

    var id = grp + "_" + hole + "H_" + player + "_" + score;
    var cachedEv = (cachedMap && cachedMap[id]) ? cachedMap[id] : null;
    var ts = (cachedEv && Number(cachedEv.ts) > 100000) ? Number(cachedEv.ts) : (1000 + rowIdx);

    return {
        id: id,
        ts: ts,
        timeStr: timeStr || (cachedEv && cachedEv.timeStr ? cachedEv.timeStr : ""),
        group: grp,
        hole: hole,
        player: player,
        playersText: playersText || (cachedEv && cachedEv.playersText ? cachedEv.playersText : ""),
        score: score,
        type: evType
    };
}

function saveBirdieFeedToCacheAndProps(list) {
    var packedList = [];
    for (var pIdx = 0; pIdx < list.length; pIdx++) {
        packedList.push(packBirdieFeedItem(list[pIdx]));
    }
    var outJson = JSON.stringify(packedList);
    while (packedList.length > 1 && unescape(encodeURIComponent(outJson)).length > 8500) {
        packedList.shift();
        outJson = JSON.stringify(packedList);
    }
    try {
        var propsOut = PropertiesService.getScriptProperties();
        if (propsOut) propsOut.setProperty(getScopedCacheKey("BF_"), outJson);
    } catch (pe) { }
    try {
        var cacheOut = CacheService.getScriptCache();
        if (cacheOut) cacheOut.put(getScopedCacheKey("BF_"), outJson, 21600);
    } catch (ce) { }
}

// 특정 홀(0-indexed)까지의 연속 파(0) 개수 계산
function calcPlayerParStreakAtHole(scoresArray, holeIdx) {
    if (!Array.isArray(scoresArray) || holeIdx < 0 || holeIdx >= scoresArray.length) return 0;
    var streak = 0;
    for (var k = holeIdx; k >= 0; k--) {
        var v = scoresArray[k];
        var hasV = (v !== "" && v !== null && v !== undefined && String(v).trim() !== "" && !isNaN(Number(v)));
        if (hasV && Number(v) === 0) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// 전체 참가자 공용 실시간 속보 팝업용 목록 조회 (CacheService 우선 조회로 시트 부하 제로)
function getBirdieFeed() {
    try {
        var now = Date.now();
        var raw = null;
        try {
            var cache = CacheService.getScriptCache();
            if (cache) raw = cache.get(getScopedCacheKey("BF_"));
        } catch (ce) { }

        if (!raw) {
            var props = PropertiesService.getScriptProperties();
            if (props) raw = props.getProperty(getScopedCacheKey("BF_"));
            if (raw) {
                try {
                    var cacheWrite = CacheService.getScriptCache();
                    if (cacheWrite) cacheWrite.put(getScopedCacheKey("BF_"), raw, 21600);
                } catch (ce2) { }
            }
        }

        if (!raw) return [];
        var list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];

        var valid = [];
        for (var i = 0; i < list.length; i++) {
            var item = unpackBirdieFeedItem(list[i]);
            if (item && item.ts && (now - Number(item.ts) <= BIRDIE_RETENTION_MS)) {
                valid.push(item);
            }
        }
        valid.sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
        return valid;
    } catch (err) {
        return [];
    }
}

// [🏆 명예의 전당] 버튼 클릭 시 "니어/롱기" 탭 K2 셀 아래 내용을 직접 읽어와 반환 (K열 삭제 시 캐시도 즉시 초기화)
function getHallOfFameFeed(ssOpt) {
    try {
        var ss = ssOpt || getTargetSpreadsheet();
        var nearSheet = ss ? ss.getSheetByName("니어/롱기") : null;
        if (!nearSheet) return getBirdieFeed();

        var cachedList = getBirdieFeed();
        var cachedMap = {};
        for (var c = 0; c < cachedList.length; c++) {
            if (cachedList[c] && cachedList[c].id) {
                cachedMap[cachedList[c].id] = cachedList[c];
            }
        }

        var lastRow = Math.max(nearSheet.getLastRow(), 2);
        var numRows = Math.max(lastRow - 1, 1);
        var kValues = nearSheet.getRange(2, 11, numRows, 1).getValues();

        var sheetItems = [];
        for (var r = 0; r < kValues.length; r++) {
            var cellVal = kValues[r][0];
            var parsed = parseBirdieSheetLine(cellVal, r, cachedMap);
            if (parsed) {
                sheetItems.push(parsed);
            }
        }

        // 시트의 K2 아래 내용과 메모리 캐시가 다르면(예: 시트에서 직접 지운 경우) 캐시도 K열 기준으로 즉시 동기화
        if (sheetItems.length !== cachedList.length) {
            var syncCacheList = [];
            for (var s = 0; s < sheetItems.length; s++) {
                if (Number(sheetItems[s].ts) > 100000) {
                    syncCacheList.push(sheetItems[s]);
                }
            }
            saveBirdieFeedToCacheAndProps(syncCacheList);
        }

        return sheetItems;
    } catch (err) {
        return getBirdieFeed();
    }
}

// 시트에서 직접 점수를 지웠을 때(대회 전 테스트 데이터 삭제 등) 해당 조의 유령 공지 자동 정리
function reconcileGroupBirdieFeed(groupName, players, ssOpt, preloadedFeed) {
    try {
        var feed = Array.isArray(preloadedFeed) ? preloadedFeed : getBirdieFeed();
        if (!feed || feed.length === 0) return [];

        var scoreLookup = {};
        if (Array.isArray(players)) {
            for (var p = 0; p < players.length; p++) {
                var pl = players[p];
                if (pl && pl.name && Array.isArray(pl.scores)) {
                    scoreLookup[pl.name] = pl.scores;
                }
            }
        }

        var staleList = [];
        for (var i = 0; i < feed.length; i++) {
            var ev = feed[i];
            if (ev && ev.group === groupName) {
                if (ev.type === "PAR_MISSION" || ev.player === "__ALL_PAR__") {
                    var allStillPar = (Array.isArray(players) && players.length > 0 && ev.hole >= 1 && ev.hole <= 18);
                    if (allStillPar) {
                        for (var mp = 0; mp < players.length; mp++) {
                            var mSc = players[mp].scores ? players[mp].scores[ev.hole - 1] : "";
                            var hasM = (mSc !== "" && mSc !== null && mSc !== undefined && !isNaN(Number(mSc)));
                            if (!hasM || Number(mSc) > 0) {
                                allStillPar = false;
                                break;
                            }
                        }
                    }
                    if (!allStillPar) {
                        staleList.push({
                            group: groupName,
                            hole: ev.hole,
                            player: "__ALL_PAR__"
                        });
                    }
                } else if (ev.type === "PAR_STREAK") {
                    var psScores = scoreLookup[ev.player];
                    var actualStreak = (psScores && ev.hole >= 1 && ev.hole <= 18)
                        ? calcPlayerParStreakAtHole(psScores, ev.hole - 1)
                        : 0;
                    if (actualStreak !== Number(ev.score) || (actualStreak !== 3 && actualStreak !== 4 && actualStreak !== 5)) {
                        staleList.push({
                            group: groupName,
                            hole: ev.hole,
                            player: ev.player
                        });
                    }
                } else {
                    var pScores = scoreLookup[ev.player];
                    var actualScore = (pScores && ev.hole >= 1 && ev.hole <= 18) ? pScores[ev.hole - 1] : "";
                    var hasValidScore = (actualScore !== "" && actualScore !== null && actualScore !== undefined && !isNaN(Number(actualScore)));
                    var numActual = hasValidScore ? Number(actualScore) : null;
                    if (numActual !== Number(ev.score) || (numActual !== -1 && numActual !== -2)) {
                        staleList.push({
                            group: groupName,
                            hole: ev.hole,
                            player: ev.player
                        });
                    }
                }
            }
        }

        if (staleList.length > 0) {
            return updateBirdieFeed([], staleList, ssOpt);
        }
        return feed;
    } catch (err) {
        return getBirdieFeed();
    }
}

// 신규 버디(-1)/이글(-2)/홀파미션(전원 0 이하) 추가 및 점수 수정 취소 반영 + "니어/롱기" 탭 K2 셀 아래 동기화
function updateBirdieFeed(newBirdies, canceledBirdies, ssOpt) {
    try {
        var hasNew = Array.isArray(newBirdies) && newBirdies.length > 0;
        var hasCanceled = Array.isArray(canceledBirdies) && canceledBirdies.length > 0;
        var cachedFiltered = getBirdieFeed();
        if (!hasNew && !hasCanceled) {
            return cachedFiltered;
        }

        // 캐시된 기존 기록의 슬롯(조_홀_선수) 및 ID 맵 구성
        var cachedMap = {};
        var currentBySlot = {};
        for (var i = 0; i < cachedFiltered.length; i++) {
            var ev = cachedFiltered[i];
            if (ev) {
                var slotKey = ev.group + "_" + Number(ev.hole) + "_" + ev.player;
                currentBySlot[slotKey] = ev;
                if (ev.id) cachedMap[ev.id] = ev;
            }
        }

        // 실제로 추가/수정되거나 취소될 공지가 있는지 0.005초 만에 먼저 검사 (일반 파/보기 저장 시 불필요한 K열 시트 I/O 완벽 차단)
        var hasEffectiveChange = false;
        if (hasNew) {
            for (var nIdx = 0; nIdx < newBirdies.length; nIdx++) {
                var nbCheck = newBirdies[nIdx];
                var nbType = nbCheck.type ? nbCheck.type : (Number(nbCheck.score) === -2 ? "EAGLE" : "BIRDIE");
                var nbSlot = nbCheck.group + "_" + Number(nbCheck.hole) + "_" + nbCheck.player;
                var exSlotEv = currentBySlot[nbSlot];
                if (!exSlotEv || Number(exSlotEv.score) !== Number(nbCheck.score) || exSlotEv.type !== nbType) {
                    hasEffectiveChange = true;
                    break;
                }
            }
        }
        if (!hasEffectiveChange && hasCanceled) {
            for (var cIdx = 0; cIdx < canceledBirdies.length; cIdx++) {
                var cbCheck = canceledBirdies[cIdx];
                var cbSlot = cbCheck.group + "_" + Number(cbCheck.hole) + "_" + cbCheck.player;
                if (currentBySlot[cbSlot]) {
                    hasEffectiveChange = true;
                    break;
                }
            }
        }
        if (!hasEffectiveChange) {
            return cachedFiltered;
        }

        var now = Date.now();

        // "니어/롱기" 탭 K2 아래의 현재 기록을 읽어 기준 목록으로 삼음 (시트에서 수동 삭제한 기록이 부활하지 않도록 보장)
        var nearSheet = null;
        var origSheetKLen = 0;
        var filtered = [];
        try {
            var ss = ssOpt || getTargetSpreadsheet();
            nearSheet = ss ? ss.getSheetByName("니어/롱기") : null;
            if (nearSheet) {
                var lastRow = Math.max(nearSheet.getLastRow(), 2);
                var numRows = Math.max(lastRow - 1, 1);
                var kVals = nearSheet.getRange(2, 11, numRows, 1).getValues();
                for (var r = 0; r < kVals.length; r++) {
                    var cellStr = kVals[r][0] !== null && kVals[r][0] !== undefined ? String(kVals[r][0]).trim() : "";
                    if (cellStr !== "") {
                        origSheetKLen = r + 1;
                        var parsedK = parseBirdieSheetLine(cellStr, r, cachedMap);
                        if (parsedK) {
                            if (Number(parsedK.ts) <= 100000) {
                                parsedK.ts = now - ((kVals.length - r) * 1000);
                            }
                            filtered.push(parsedK);
                        }
                    }
                }
            } else {
                filtered = cachedFiltered;
            }
        } catch (se) {
            filtered = cachedFiltered;
        }

        // 버디/이글/홀파미션이었다가 점수가 수정되어 조건이 깨진 경우 공지 목록 및 K열에서 제거
        if (hasCanceled) {
            for (var c = 0; c < canceledBirdies.length; c++) {
                var cb = canceledBirdies[c];
                filtered = filtered.filter(function (ev) {
                    return !(ev.group === cb.group && Number(ev.hole) === Number(cb.hole) && ev.player === cb.player);
                });
            }
        }

        // 새로 저장된 버디(-1) / 이글(-2) / 홀파미션 / 연속파 시간순 추가 (동반자 추가 저장 시 기존 동일 기록은 최초 시각 유지하여 중복 공지 차단)
        if (hasNew) {
            for (var n = 0; n < newBirdies.length; n++) {
                var nb = newBirdies[n];
                var evType = nb.type ? nb.type : (Number(nb.score) === -2 ? "EAGLE" : "BIRDIE");
                var deterministicId = nb.group + "_" + nb.hole + "H_" + nb.player + "_" + nb.score;
                var existingTs = 0;
                var existingTimeStr = "";

                // 동일 조·동일 홀·동일 선수(또는 __ALL_PAR__)의 기존 항목이 있으면 교체하되, 동일 기록이면 최초 발생 시각 유지
                filtered = filtered.filter(function (ev) {
                    var isSameSlot = (ev.group === nb.group && Number(ev.hole) === Number(nb.hole) && ev.player === nb.player);
                    if (isSameSlot && ev.id === deterministicId && ev.type === evType && Number(ev.ts) > 0) {
                        existingTs = Number(ev.ts);
                        existingTimeStr = ev.timeStr || "";
                    }
                    return !isSameSlot;
                });
                var eventTs = existingTs > 0 ? existingTs : (now + n);
                var eventTimeStr = existingTimeStr || formatBirdieTimeServer(eventTs);
                filtered.push({
                    id: deterministicId,
                    ts: eventTs,
                    timeStr: eventTimeStr,
                    group: nb.group,
                    hole: Number(nb.hole),
                    player: nb.player,
                    playersText: nb.playersText || "",
                    score: Number(nb.score),
                    type: evType
                });
            }
        }

        filtered.sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
        if (filtered.length > BIRDIE_MAX_ITEMS) {
            filtered = filtered.slice(filtered.length - BIRDIE_MAX_ITEMS);
        }

        // "니어/롱기" 탭 K2 셀 아래에 순차 기록 (점수 수정 취소로 줄어든 행은 빈칸으로 깔끔히 지움)
        if (nearSheet) {
            try {
                var writeKLen = Math.max(filtered.length, origSheetKLen);
                if (writeKLen > 0) {
                    var kOutRows = [];
                    for (var w = 0; w < writeKLen; w++) {
                        if (w < filtered.length) {
                            kOutRows.push([formatBirdieSheetLine(filtered[w])]);
                        } else {
                            kOutRows.push([""]);
                        }
                    }
                    nearSheet.getRange(2, 11, writeKLen, 1).setValues(kOutRows);
                }
            } catch (we) { }
        }

        saveBirdieFeedToCacheAndProps(filtered);

        return filtered;
    } catch (err) {
        return [];
    }
}

// 숫자 문자열의 정수부를 최소 2자리(예: "6" -> "06", "11" -> "11")로 포맷팅 (문자열 정렬 시 자릿수 역전 방지)
function padTwoDigits(valStr) {
    var s = (valStr !== undefined && valStr !== null && String(valStr).trim() !== "") ? String(valStr).trim() : "0";
    var parts = s.split(".");
    if (parts[0].length < 2) {
        parts[0] = ("00" + parts[0]).slice(-2);
    }
    return parts.join(".");
}

// 홀 메모 문자열을 쉼표(,) 단위로 분리하여 선수별(P:이름) 또는 일반 텍스트(T:내용) 세그먼트 배열로 변환
function parseNoteSegments(noteStr) {
    var list = [];
    if (!noteStr) return list;
    var parts = String(noteStr).split(",");
    for (var i = 0; i < parts.length; i++) {
        var seg = String(parts[i]).trim();
        if (!seg) continue;
        var colonIdx = seg.indexOf(":");
        var playerKey = "";
        if (colonIdx > 0) {
            var pName = seg.slice(0, colonIdx).trim();
            if (pName) {
                playerKey = "P:" + pName;
            }
        }
        var key = playerKey || ("T:" + seg);
        var foundIdx = -1;
        for (var j = 0; j < list.length; j++) {
            if (list[j].key === key) {
                foundIdx = j;
                break;
            }
        }
        if (foundIdx !== -1) {
            list[foundIdx].text = seg;
        } else {
            list.push({ key: key, text: seg, isPlayer: !!playerKey });
        }
    }
    return list;
}

// 동반자 간 동시 니어/롱기/메모 입력 시 기존 동반자 기록이 증발하지 않도록 선수별/항목별 스마트 병합 (3-Way Merge)
function mergeHoleNoteSmart(exNote, inNote, baseNote) {
    var ex = (exNote !== undefined && exNote !== null) ? String(exNote).trim() : "";
    var inp = (inNote !== undefined && inNote !== null) ? String(inNote).trim() : "";
    var hasBase = (baseNote !== undefined && baseNote !== null);
    var base = hasBase ? String(baseNote).trim() : "";

    // 이 기기가 마지막으로 확인한 서버 메모(baseNote)와 현재 서버 메모(exNote)가 동일하면
    // 다른 동반자가 중간에 끼어들어 수정/삭제한 적이 없으므로 사용자의 수정본(inNote)을 그대로 반영
    if ((hasBase && ex === base) || (!hasBase && ex === "")) {
        return inp;
    }

    var exSegs = parseNoteSegments(ex);
    var inSegs = parseNoteSegments(inp);
    var baseSegs = parseNoteSegments(base);

    var inMap = {};
    for (var i = 0; i < inSegs.length; i++) {
        inMap[inSegs[i].key] = inSegs[i];
    }
    var baseMap = {};
    for (var b = 0; b < baseSegs.length; b++) {
        baseMap[baseSegs[b].key] = baseSegs[b];
    }

    // 사용자가 메모창을 비운 경우: 이 기기가 원래 알고 있던 항목(baseMap)은 삭제하되,
    // 그 사이에 다른 동반자가 새로 추가한 항목(!baseMap)은 증발하지 않게 보호
    if (inp === "") {
        if (!hasBase) return "";
        var keptOnClear = [];
        for (var c = 0; c < exSegs.length; c++) {
            if (!baseMap[exSegs[c].key]) {
                keptOnClear.push(exSegs[c].text);
            }
        }
        return keptOnClear.join(", ");
    }

    var mergedList = [];
    var addedMap = {};

    // 1) 서버에 이미 있던 항목(exSegs) 순회:
    // - 이번 입력(inMap)에도 있으면(사용자가 수정했거나 그대로 둔 항목) 새 값으로 반영
    // - 이번 입력에 없는데 이 기기가 원래 보고 있던 항목(baseMap)이면 이 기기 사용자가 삭제한 것이므로 제외
    // - 이 기기가 몰랐던 항목(!baseMap, 다른 동반자가 동시에 새로 저장한 기록)이면 보존
    for (var e = 0; e < exSegs.length; e++) {
        var eKey = exSegs[e].key;
        if (Object.prototype.hasOwnProperty.call(inMap, eKey)) {
            // 이 폰이 손대지 않은 기록(옛 값 그대로)이면 서버의 최신 값 유지 → 다른 폰이 고친 값이 되돌아가지 않음
            var untouched = hasBase && baseMap[eKey] && baseMap[eKey].text === inMap[eKey].text;
            mergedList.push(untouched ? exSegs[e].text : inMap[eKey].text);
            addedMap[eKey] = true;
        } else if (hasBase && baseMap[eKey]) {
            continue;
        } else {
            mergedList.push(exSegs[e].text);
            addedMap[eKey] = true;
        }
    }

    // 2) 현재 서버(exSegs)에는 없지만 이번 입력(inSegs)에 있는 항목 순회:
    // - 만약 이 기기의 옛날 기준값(baseMap)에 똑같은 텍스트로 이미 있던 항목이 현재 서버(exSegs)에서 사라진 상태라면,
    //   다른 동반자가 서버에서 방금 삭제한 기록이므로 다시 부활시키지 않고 제외!
    // - 이 기기에서 새로 추가했거나 값을 직접 수정한 항목만 이어붙임
    for (var n = 0; n < inSegs.length; n++) {
        var nKey = inSegs[n].key;
        if (!addedMap[nKey]) {
            if (hasBase && baseMap[nKey] && baseMap[nKey].text === inSegs[n].text) {
                continue;
            }
            mergedList.push(inSegs[n].text);
            addedMap[nKey] = true;
        }
    }

    return mergedList.join(", ");
}

// 니어 메모 텍스트(예: "류성욱:[6]피트[11]인치")에서 선수명과 06'11" 포맷 거리 추출
function parseNearPinEntries(noteText) {
    var results = [];
    if (!noteText) return results;

    var str = String(noteText);
    var regex = /([^,:]+?)\s*:\s*\[?\s*([0-9.]*)\s*\]?\s*피트(?:\s*\[?\s*([0-9.]*)\s*\]?\s*인치)?/g;
    var match;

    while ((match = regex.exec(str)) !== null) {
        var name = match[1] ? String(match[1]).trim() : "";
        var feet = match[2] !== undefined ? String(match[2]).trim() : "";
        var inch = match[3] !== undefined ? String(match[3]).trim() : "";

        if (!name || (feet === "" && inch === "")) continue;

        var feetVal = padTwoDigits(feet !== "" ? feet : "0");
        var inchVal = padTwoDigits(inch !== "" ? inch : "0");
        var formattedDist = feetVal + "'" + inchVal + '"';

        // 동일 홀 메모 내 같은 이름이 중복 적힌 경우 뒤에 적힌 최신 값으로 갱신
        var existingIdx = -1;
        for (var i = 0; i < results.length; i++) {
            if (results[i].name === name) {
                existingIdx = i;
                break;
            }
        }
        if (existingIdx !== -1) {
            results[existingIdx].dist = formattedDist;
        } else {
            results.push({ name: name, dist: formattedDist });
        }
    }
    return results;
}

// 롱기스트 메모 텍스트(예: "류성욱: 핀까지 [35]야드")에서 선수명과 순수 숫자(35)만 추출
function parseLongDriveEntries(noteText) {
    var results = [];
    if (!noteText) return results;

    var str = String(noteText);
    var regex = /([^,:]+?)\s*:\s*(?:핀까지\s*)?\[?\s*([0-9.]+)\s*\]?\s*(?:야드|yds?)?/gi;
    var match;

    while ((match = regex.exec(str)) !== null) {
        var fullMatch = match[0] || "";
        // 혹시 같은 메모 안에 "피트" 기록이 섞여 있으면 롱기에서 제외
        if (fullMatch.indexOf("피트") !== -1) continue;

        var name = match[1] ? String(match[1]).trim() : "";
        var numStr = match[2] !== undefined ? String(match[2]).trim() : "";
        if (!name || numStr === "" || isNaN(Number(numStr))) continue;

        var numVal = Number(numStr);

        var existingIdx = -1;
        for (var i = 0; i < results.length; i++) {
            if (results[i].name === name) {
                existingIdx = i;
                break;
            }
        }
        if (existingIdx !== -1) {
            results[existingIdx].dist = numVal;
        } else {
            results.push({ name: name, dist: numVal });
        }
    }
    return results;
}

// "니어/롱기" 탭에 니어(A:B, C:D, E:F, G:H) 및 롱기스트(I:J)를 2행부터 순차 기록/수정/삭제 동기화
function syncNearPinToSheet(ss, mergedNotes, activeIdxMap, hasSpecificActiveHoles, groupPlayersMap, nearPinHoles, longDriveHoles) {
    try {
        var nearList = (Array.isArray(nearPinHoles) && nearPinHoles.length > 0) ? nearPinHoles : [3, 7, 11, 14];
        var longList = (Array.isArray(longDriveHoles) && longDriveHoles.length > 0) ? longDriveHoles : [5];
        var eventHoleCols = [];

        // 1. 니어핀 홀 매핑: 1번째->A:B(1), 2번째->C:D(3), 3번째->E:F(5), 4번째->G:H(7)
        for (var idx = 0; idx < nearList.length; idx++) {
            var hNum = Number(nearList[idx]);
            if (hNum >= 1 && hNum <= 18) {
                eventHoleCols.push({
                    hole: hNum,
                    colStart: idx * 2 + 1,
                    type: "near"
                });
            }
        }

        // 2. 롱기스트 홀 매핑: I:J열(colStart = 9)부터 기록 (nearList가 4개 이하면 9열 고정, 그 이상이면 이어서 배치)
        var longColBase = Math.max(nearList.length * 2 + 1, 9);
        for (var lIdx = 0; lIdx < longList.length; lIdx++) {
            var lhNum = Number(longList[lIdx]);
            if (lhNum >= 1 && lhNum <= 18) {
                eventHoleCols.push({
                    hole: lhNum,
                    colStart: longColBase + lIdx * 2, // I열(9): 이름, J열(10): 숫자
                    type: "long"
                });
            }
        }

        // 이번 저장 요청에 이벤트 홀(니어 또는 롱기)이 포함되어 있는지 먼저 확인
        var activeEventHoles = [];
        for (var i = 0; i < eventHoleCols.length; i++) {
            var hIdx = eventHoleCols[i].hole - 1;
            if (!hasSpecificActiveHoles || !!activeIdxMap[hIdx]) {
                activeEventHoles.push(eventHoleCols[i]);
            }
        }
        if (activeEventHoles.length === 0) return;

        var nearSheet = ss.getSheetByName("니어/롱기");
        if (!nearSheet) return;

        var maxColNeeded = 10;
        for (var c = 0; c < eventHoleCols.length; c++) {
            if (eventHoleCols[c].colStart + 1 > maxColNeeded) {
                maxColNeeded = eventHoleCols[c].colStart + 1;
            }
        }

        var lastRow = Math.max(nearSheet.getLastRow(), 2);
        var numRowsToRead = Math.max(lastRow - 1, 1);
        var sheetData = nearSheet.getRange(2, 1, numRowsToRead, maxColNeeded).getValues();

        for (var k = 0; k < activeEventHoles.length; k++) {
            var holeNum = activeEventHoles[k].hole;
            var colStart = activeEventHoles[k].colStart; // 1-based (1, 3, 5, 7, 9)
            var evType = activeEventHoles[k].type;       // "near" or "long"
            var cIdx = colStart - 1;                     // 0-based (0, 2, 4, 6, 8)

            var noteText = mergedNotes[holeNum - 1] || "";
            var parsedEntries = (evType === "long")
                ? parseLongDriveEntries(noteText)
                : parseNearPinEntries(noteText);
            var parsedMap = {};
            for (var p = 0; p < parsedEntries.length; p++) {
                parsedMap[parsedEntries[p].name] = parsedEntries[p].dist;
            }

            // 기존 시트의 해당 홀 컬럼(2행~)에서 유효한 [이름, 기록] 목록 추출
            var existingList = [];
            var origMaxLen = 0;
            for (var r = 0; r < sheetData.length; r++) {
                var exName = sheetData[r][cIdx] !== null && sheetData[r][cIdx] !== undefined ? String(sheetData[r][cIdx]).trim() : "";
                var rawExDist = sheetData[r][cIdx + 1];
                var exDist = (rawExDist !== null && rawExDist !== undefined)
                    ? (evType === "long" && rawExDist !== "" && !isNaN(Number(rawExDist)) ? Number(rawExDist) : String(rawExDist).trim())
                    : "";
                if (exName !== "" || exDist !== "") {
                    origMaxLen = r + 1;
                }
                if (exName !== "") {
                    // 현재 저장 중인 조의 선수가 메모창에서 기록을 지운 경우 목록에서 제외
                    if (groupPlayersMap && groupPlayersMap[exName] && !Object.prototype.hasOwnProperty.call(parsedMap, exName)) {
                        continue;
                    }
                    existingList.push({ name: exName, dist: exDist });
                }
            }

            // 새로 파싱된 기록 반영 (이미 있는 이름이면 기록 업데이트, 없으면 맨 아래 빈 행에 추가)
            for (var m = 0; m < parsedEntries.length; m++) {
                var entry = parsedEntries[m];
                var found = false;
                for (var e = 0; e < existingList.length; e++) {
                    if (existingList[e].name === entry.name) {
                        existingList[e].dist = entry.dist;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    existingList.push({ name: entry.name, dist: entry.dist });
                }
            }

            var writeLen = Math.max(existingList.length, origMaxLen);
            if (writeLen > 0) {
                var outRows = [];
                for (var w = 0; w < writeLen; w++) {
                    if (w < existingList.length) {
                        outRows.push([existingList[w].name, existingList[w].dist]);
                    } else {
                        outRows.push(["", ""]);
                    }
                }
                nearSheet.getRange(2, colStart, writeLen, 2).setValues(outRows);
            }
        }
    } catch (err) {
        // "니어/롱기" 탭 동기화 중 예외가 발생하더라도 메인 스코어 저장은 정상 완료되도록 보호
    }
}

/**
 * 📊 [전광판] '니어/롱기' 탭의 기록을 읽기만 해서 돌려줌 (시트 수정 없음 · 락 없음 · 다른 기능과 무관)
 */
function getEventBoardData() {
    var sheet = getTargetSpreadsheet().getSheetByName("니어/롱기");
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = Math.min(sheet.getLastColumn(), 26);
    if (lastRow < 2 || lastCol < 1) return [];
    return sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
}

/**
 * github.io에서 iframe 없이 앱 전체 HTML(Index.html + CourseData.html)과 초기 조 목록을 한 번에 받아가기 위한 함수

/**
 * ============================================================================
 * 🛠️ 총무용 관리자 API (admin.html 전용 — PIN 인증 보호)
 * ============================================================================
 */
function extractSpreadsheetId(idOrUrl) {
    var s = String(idOrUrl || "").trim();
    var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : s;
}

function readGroupsWithHandicapsFromSheet(ss) {
    var groups = [];
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
        var sh = sheets[i];
        var name = sh.getName();
        if (name.indexOf("조") !== -1 && name.indexOf("결과") === -1 && name.indexOf("Copy") === -1) {
            var vals = sh.getRange(3, 1, 8, 21).getValues();
            var players = [];
            for (var r = 0; r < vals.length; r++) {
                var pName = vals[r][0] ? String(vals[r][0]).trim() : "";
                if (!pName || pName === "홀파미션" || pName === "메모" || pName.indexOf("점수") !== -1 || pName.indexOf("Par") !== -1) {
                    if (pName === "홀파미션" || pName.indexOf("점수") !== -1) break;
                    continue;
                }
                var hcpVal = vals[r][20];
                var hcp = (hcpVal !== "" && hcpVal !== null && hcpVal !== undefined && !isNaN(Number(hcpVal))) ? Number(hcpVal) : "";
                players.push({ name: pName, handicap: hcp });
            }
            if (players.length > 0) {
                groups.push({ name: name, players: players });
            }
        }
    }
    groups.sort(function (a, b) {
        var numA = parseInt(a.name.replace(/[^0-9]/g, ""), 10) || 0;
        var numB = parseInt(b.name.replace(/[^0-9]/g, ""), 10) || 0;
        return numA !== numB ? numA - numB : a.name.localeCompare(b.name);
    });
    return groups;
}

function adminGetStatus(pin) {
    verifyAdminPin(pin);
    var meta = readActiveStateMeta();
    var groupsWithHcp = [];
    var sheetTitle = "";
    if (meta.sheetId) {
        try {
            var ss = SpreadsheetApp.openById(meta.sheetId);
            sheetTitle = ss.getName();
            groupsWithHcp = readGroupsWithHandicapsFromSheet(ss);
        } catch (e) { }
    }
    return {
        sheetId: meta.sheetId,
        sheetUrl: meta.sheetUrl,
        resultsGid: meta.resultsGid,
        resultsUrl: meta.resultsUrl,
        sheetTitle: sheetTitle,
        config: meta.config,
        groups: groupsWithHcp,
        history: getSheetHistoryList()
    };
}

function adminCreateTournament(pin, spec) {
    verifyAdminPin(pin);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        var created = createTournamentSpreadsheet(spec);
        var cfg = (spec && spec.config) ? spec.config : {};
        cfg.groups = spec.groups || cfg.groups || [];
        saveActiveTournamentState(created, cfg);
        recordSheetHistory({
            sheetId: created.sheetId,
            resultsUrl: created.resultsUrl,
            title: created.sheetTitle,
            createdAt: new Date().toISOString()
        });
        return {
            sheetId: created.sheetId,
            sheetUrl: created.sheetUrl,
            resultsGid: created.resultsGid,
            resultsUrl: created.resultsUrl,
            sheetTitle: created.sheetTitle,
            config: cfg,
            groupList: created.groupList,
            history: getSheetHistoryList()
        };
    } finally {
        lock.releaseLock();
    }
}

function adminUpdateConfigOnly(pin, newConfig) {
    verifyAdminPin(pin);
    var props = PropertiesService.getScriptProperties();
    if (newConfig && newConfig.tournamentId) {
        props.setProperty(PROP_ACTIVE_TOURNAMENT_ID, String(newConfig.tournamentId));
    }
    saveChunkedConfig(props, newConfig || {});
    var meta = readActiveStateMeta();
    return {
        updated: true,
        sheetId: meta.sheetId,
        resultsUrl: meta.resultsUrl,
        config: newConfig
    };
}

function adminConnectExistingSheet(pin, sheetIdOrUrl, configOpt) {
    verifyAdminPin(pin);
    var sid = extractSpreadsheetId(sheetIdOrUrl);
    if (!sid) throw new Error("유효한 구글 시트 URL 또는 ID를 입력해주세요.");
    var ss = SpreadsheetApp.openById(sid);
    var resSheet = ss.getSheetByName("결과");
    var resultsGid = resSheet ? String(resSheet.getSheetId()) : "0";
    var resultsUrl = "https://docs.google.com/spreadsheets/d/" + sid + "/edit?gid=" + resultsGid + "#gid=" + resultsGid;
    var groupsWithHcp = readGroupsWithHandicapsFromSheet(ss);
    var cfg = configOpt || loadChunkedConfig() || {};
    if (groupsWithHcp.length > 0) cfg.groups = groupsWithHcp;

    saveActiveTournamentState({
        sheetId: sid,
        sheetUrl: ss.getUrl(),
        resultsGid: resultsGid
    }, cfg);
    recordSheetHistory({
        sheetId: sid,
        resultsUrl: resultsUrl,
        title: ss.getName(),
        createdAt: new Date().toISOString()
    });
    return {
        sheetId: sid,
        sheetUrl: ss.getUrl(),
        resultsUrl: resultsUrl,
        sheetTitle: ss.getName(),
        groups: groupsWithHcp,
        config: cfg,
        history: getSheetHistoryList()
    };
}

function adminResetScores(pin) {
    verifyAdminPin(pin);
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var ss = getTargetSpreadsheet();
        var sheets = ss.getSheets();
        for (var i = 0; i < sheets.length; i++) {
            var sh = sheets[i];
            var name = sh.getName();
            if (name.indexOf("조") !== -1 && name.indexOf("결과") === -1 && name.indexOf("Copy") === -1) {
                var maxR = Math.max(sh.getLastRow(), 20);
                var vals = sh.getRange(1, 1, maxR, 1).getValues();
                var pEnd = 2;
                var memoR = -1;
                for (var r = 2; r < vals.length; r++) {
                    var label = vals[r][0] ? String(vals[r][0]).trim() : "";
                    if (label === "메모" || label.indexOf("메모") !== -1) {
                        memoR = r + 1;
                    } else if (label === "홀파미션" || label.indexOf("점수") !== -1) {
                        if (pEnd === 2) pEnd = r;
                    } else if (label && pEnd === r) {
                        pEnd = r + 1;
                    }
                }
                if (pEnd >= 3) {
                    sh.getRange(3, 2, pEnd - 2, 18).clearContent();
                }
                if (memoR >= 3) {
                    sh.getRange(memoR, 2, 1, 18).clearContent();
                }
            }
        }
        var nearSheet = ss.getSheetByName("니어/롱기");
        if (nearSheet && nearSheet.getLastRow() >= 2) {
            nearSheet.getRange(2, 1, nearSheet.getLastRow() - 1, Math.max(nearSheet.getLastColumn(), 12)).clearContent();
        }
        var sid = getActiveSheetId();
        var props = PropertiesService.getScriptProperties();
        props.deleteProperty(getScopedCacheKey("BF_"));
        invalidateActiveCaches(sid);
        SpreadsheetApp.flush();
        return { cleared: true, sheetId: sid };
    } finally {
        lock.releaseLock();
    }
}

function adminChangePin(oldPin, newPin) {
    verifyAdminPin(oldPin);
    var cleaned = String(newPin || "").trim();
    if (cleaned.length < 4) throw new Error("새 비밀번호(PIN)는 4자리 이상 입력해주세요.");
    PropertiesService.getScriptProperties().setProperty(PROP_ADMIN_PIN, cleaned);
    return { changed: true };
}

/**
 * GitHub Pages 정적 웹앱(index.html / admin.html) 전용 JSON API 엔드포인트
 */
function doPost(e) {
    try {
        var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
        var req = JSON.parse(raw);
        var allowed = {
            getInitBundle: getInitBundle,
            getGroupList: getGroupList,
            getGroupData: getGroupData,
            getBirdieFeed: getBirdieFeed,
            getHallOfFameFeed: getHallOfFameFeed,
            saveGroupScores: saveGroupScores,
            getEventBoardData: getEventBoardData,
            adminGetStatus: adminGetStatus,
            adminCreateTournament: adminCreateTournament,
            adminUpdateConfigOnly: adminUpdateConfigOnly,
            adminConnectExistingSheet: adminConnectExistingSheet,
            adminResetScores: adminResetScores,
            adminChangePin: adminChangePin
        };
        if (!req || !req.fn || !allowed[req.fn]) {
            throw new Error("허용되지 않은 호출: " + (req && req.fn ? req.fn : "unknown"));
        }
        var result = allowed[req.fn].apply(null, Array.isArray(req.args) ? req.args : []);
        return ContentService
            .createTextOutput(JSON.stringify({ ok: true, data: result }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({
                ok: false,
                error: String(err && err.message ? err.message : err)
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}
