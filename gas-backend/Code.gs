/**
 * ============================================================================
 * [Code.gs] Multi-Tournament Google Sheet Auto-Generator & Score API Engine
 * ----------------------------------------------------------------------------
 * - Deploy once under your Google account (https://script.google.com) and reuse for unlimited tournaments.
 * - Each tournament gets its own unique slug URL (?t=slug), its own Google Spreadsheet,
 *   and an optional per-tournament Manager PIN so club managers can only manage their own event.
 * - Tournament metadata is indexed in a Master Registry Spreadsheet ('_GolfScoreCard_Master_Registry')
 *   and full per-tournament config is stored in a hidden '_Config' sheet inside each tournament's
 *   Google Spreadsheet (with CacheService RAM caching for instant response and zero storage ceiling).
 * ============================================================================
 */

var GROUP_LIST_CACHE_TTL_SEC = 300;
var REGISTRY_CACHE_TTL_SEC = 21600;
var CONFIG_CACHE_TTL_SEC = 600;

var DEFAULT_MASTER_PIN = "2026";
var PROP_MASTER_PIN = "MASTER_ADMIN_PIN_V2";
var PROP_REGISTRY_SHEET_ID = "MASTER_REGISTRY_SHEET_ID_V2";
var PROP_GH_TOKEN = "GITHUB_PAT_TOKEN_V1";
var PROP_GH_REPO = "GITHUB_REPO_SLUG_V1";
var DEFAULT_GH_REPO = "aries7594/golf_scorecard_app";

// Per-request execution context populated inside doPost(e)
var CURRENT_REQ_SLUG = "";
var CURRENT_REQ_SHEET_ID = "";

function doGet() {
    return ContentService
        .createTextOutput("Golf ScoreCard Multi-Tournament API Engine is running.")
        .setMimeType(ContentService.MimeType.TEXT);
}

function normalizeSlug(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

function generateRandomSlug() {
    var chars = "abcdefghjkmnpqrstuvwxyz23456789";
    var out = "";
    for (var i = 0; i < 6; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}

function getMasterPin() {
    var props = PropertiesService.getScriptProperties();
    return props.getProperty(PROP_MASTER_PIN) || DEFAULT_MASTER_PIN;
}

function verifyMasterPin(pin) {
    if (String(pin || "").trim() !== String(getMasterPin()).trim()) {
        throw new Error("마스터 비밀번호(PIN)가 올바르지 않습니다.");
    }
}

function getOrCreateRegistrySpreadsheet() {
    var props = PropertiesService.getScriptProperties();
    var regId = props.getProperty(PROP_REGISTRY_SHEET_ID) || "";
    var ss = null;
    if (regId) {
        try {
            ss = SpreadsheetApp.openById(regId);
        } catch (e) {
            ss = null;
        }
    }
    if (!ss) {
        ss = SpreadsheetApp.create("_GolfScoreCard_Master_Registry");
        var defaultSheets = ss.getSheets();
        var sh = ss.insertSheet("Tournaments");
        sh.getRange(1, 1, 1, 8).setValues([[
            "slug", "sheetId", "sheetTitle", "courseKey", "managerPin", "resultsUrl", "createdAt", "updatedAt"
        ]])
            .setBackground("#1f2937")
            .setFontColor("#ffffff")
            .setFontWeight("bold");
        sh.setFrozenRows(1);
        for (var d = 0; d < defaultSheets.length; d++) {
            try { ss.deleteSheet(defaultSheets[d]); } catch (de) { }
        }
        SpreadsheetApp.flush();
        props.setProperty(PROP_REGISTRY_SHEET_ID, ss.getId());
    }
    var tSheet = ss.getSheetByName("Tournaments");
    if (!tSheet) {
        tSheet = ss.insertSheet("Tournaments");
        tSheet.getRange(1, 1, 1, 8).setValues([[
            "slug", "sheetId", "sheetTitle", "courseKey", "managerPin", "resultsUrl", "createdAt", "updatedAt"
        ]]);
    }
    return tSheet;
}

function readAllRegistryRecords() {
    var props = PropertiesService.getScriptProperties();
    var regId = props.getProperty(PROP_REGISTRY_SHEET_ID) || "";
    if (!regId) return [];
    var ss;
    try {
        ss = SpreadsheetApp.openById(regId);
    } catch (e) {
        return [];
    }
    var sh = ss.getSheetByName("Tournaments");
    if (!sh || sh.getLastRow() < 2) return [];
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
        var slug = normalizeSlug(rows[i][0]);
        var sheetId = String(rows[i][1] || "").trim();
        if (!slug || !sheetId) continue;
        out.push({
            rowNumber: i + 2,
            slug: slug,
            sheetId: sheetId,
            sheetTitle: String(rows[i][2] || ""),
            courseKey: String(rows[i][3] || ""),
            managerPin: String(rows[i][4] || ""),
            resultsUrl: String(rows[i][5] || ""),
            createdAt: String(rows[i][6] || ""),
            updatedAt: String(rows[i][7] || "")
        });
    }
    return out;
}

function lookupTournamentBySlug(rawSlug) {
    var slug = normalizeSlug(rawSlug);
    if (!slug) return null;
    var cacheKey = "REG_V2_" + slug;
    try {
        var cache = CacheService.getScriptCache();
        if (cache) {
            var hit = cache.get(cacheKey);
            if (hit) return JSON.parse(hit);
        }
    } catch (e) { }

    var all = readAllRegistryRecords();
    for (var i = 0; i < all.length; i++) {
        if (all[i].slug === slug) {
            try {
                var c2 = CacheService.getScriptCache();
                if (c2) c2.put(cacheKey, JSON.stringify(all[i]), REGISTRY_CACHE_TTL_SEC);
            } catch (ce) { }
            return all[i];
        }
    }
    return null;
}

function upsertTournamentInRegistry(rec) {
    var slug = normalizeSlug(rec.slug);
    if (!slug) throw new Error("유효한 대회 코드(slug)가 필요합니다.");
    var sh = getOrCreateRegistrySpreadsheet();
    var lastRow = sh.getLastRow();
    var nowIso = new Date().toISOString();
    var foundRow = -1;
    var createdAt = rec.createdAt || nowIso;

    if (lastRow >= 2) {
        var vals = sh.getRange(2, 1, lastRow - 1, 7).getValues();
        for (var i = 0; i < vals.length; i++) {
            if (normalizeSlug(vals[i][0]) === slug) {
                foundRow = i + 2;
                if (vals[i][6]) createdAt = String(vals[i][6]);
                break;
            }
        }
    }

    var rowData = [
        slug,
        String(rec.sheetId || ""),
        String(rec.sheetTitle || ""),
        String(rec.courseKey || ""),
        String(rec.managerPin || ""),
        String(rec.resultsUrl || ""),
        createdAt,
        nowIso
    ];

    if (foundRow > 0) {
        sh.getRange(foundRow, 1, 1, 8).setValues([rowData]);
    } else {
        sh.getRange(lastRow + 1, 1, 1, 8).setValues([rowData]);
    }
    SpreadsheetApp.flush();

    var savedObj = {
        slug: slug,
        sheetId: rowData[1],
        sheetTitle: rowData[2],
        courseKey: rowData[3],
        managerPin: rowData[4],
        resultsUrl: rowData[5],
        createdAt: rowData[6],
        updatedAt: rowData[7]
    };
    try {
        var cache = CacheService.getScriptCache();
        if (cache) cache.put("REG_V2_" + slug, JSON.stringify(savedObj), REGISTRY_CACHE_TTL_SEC);
    } catch (e) { }
    return savedObj;
}

function removeTournamentFromRegistry(rawSlug) {
    var slug = normalizeSlug(rawSlug);
    if (!slug) return false;
    var sh = getOrCreateRegistrySpreadsheet();
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
        var slugs = sh.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var r = slugs.length - 1; r >= 0; r--) {
            if (normalizeSlug(slugs[r][0]) === slug) {
                sh.deleteRow(r + 2);
            }
        }
    }
    try {
        var cache = CacheService.getScriptCache();
        if (cache) cache.remove("REG_V2_" + slug);
    } catch (e) { }
    return true;
}

function writeConfigToSpreadsheet(ss, configObj, managerPinOpt) {
    var sh = ss.getSheetByName("_Config");
    if (!sh) {
        sh = ss.insertSheet("_Config");
    }
    try { sh.hideSheet(); } catch (e) { }

    var raw = JSON.stringify(configObj || {});
    var chunkSize = 30000;
    var numChunks = Math.ceil(raw.length / chunkSize) || 1;
    var rows = [["CHUNKS", String(numChunks)], ["MANAGER_PIN", String(managerPinOpt || "")]];
    for (var i = 0; i < numChunks; i++) {
        rows.push(["CFG_" + i, raw.slice(i * chunkSize, (i + 1) * chunkSize)]);
    }
    sh.clearContents();
    sh.getRange(1, 1, rows.length, 2).setValues(rows);

    try {
        var cache = CacheService.getScriptCache();
        if (cache && raw.length < 90000) {
            cache.put("TCFG_V2_" + ss.getId().slice(0, 32), raw, CONFIG_CACHE_TTL_SEC);
        }
    } catch (ce) { }
}

function readConfigFromSpreadsheet(ss, sheetId) {
    var sid = sheetId || (ss ? ss.getId() : "");
    var cacheKey = "TCFG_V2_" + sid.slice(0, 32);
    try {
        var cache = CacheService.getScriptCache();
        if (cache) {
            var cached = cache.get(cacheKey);
            if (cached) return JSON.parse(cached);
        }
    } catch (e) { }

    var targetSs = ss || (sid ? SpreadsheetApp.openById(sid) : null);
    if (!targetSs) return null;
    var sh = targetSs.getSheetByName("_Config");
    if (!sh || sh.getLastRow() < 3) return null;

    var vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    var numChunks = Number(vals[0][1] || 0);
    if (numChunks <= 0) return null;
    var parts = [];
    for (var i = 0; i < numChunks; i++) {
        var rIdx = 2 + i;
        if (rIdx < vals.length) parts.push(String(vals[rIdx][1] || ""));
    }
    var joined = parts.join("");
    if (!joined) return null;
    try {
        var parsed = JSON.parse(joined);
        try {
            var c2 = CacheService.getScriptCache();
            if (c2 && joined.length < 90000) c2.put(cacheKey, joined, CONFIG_CACHE_TTL_SEC);
        } catch (ce) { }
        return parsed;
    } catch (pe) {
        return null;
    }
}

function invalidateSheetCaches(sheetId) {
    if (!sheetId) return;
    try {
        var cache = CacheService.getScriptCache();
        if (!cache) return;
        var pfx = sheetId.slice(0, 28) + "_";
        cache.remove("GL_" + pfx);
        cache.remove("BF_" + pfx);
        cache.remove("TCFG_V2_" + sheetId.slice(0, 32));
    } catch (e) { }
}

function setRequestTournamentContext(rawSlug) {
    CURRENT_REQ_SLUG = normalizeSlug(rawSlug);
    CURRENT_REQ_SHEET_ID = "";
    if (!CURRENT_REQ_SLUG) return null;
    var rec = lookupTournamentBySlug(CURRENT_REQ_SLUG);
    if (rec && rec.sheetId) {
        CURRENT_REQ_SHEET_ID = rec.sheetId;
    }
    return rec;
}

function getCurrentSheetScopePrefix(prefix) {
    var sid = CURRENT_REQ_SHEET_ID || "NOSHEET";
    return prefix + sid.slice(0, 28) + "_";
}

function getTargetSpreadsheet() {
    if (!CURRENT_REQ_SHEET_ID) {
        throw new Error("등록되지 않은 대회 코드이거나 연결된 구글 시트가 없습니다.");
    }
    return SpreadsheetApp.openById(CURRENT_REQ_SHEET_ID);
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
 * Spreadsheet Auto-Generator (exact layout, formulas, and styling)
 *   Generated visible tabs: ['Group 1'...'Group N', 'Results', 'Near/Long', 'Stat'] + hidden '_Config'
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

    var sheetTitle = String(cfg.sheetTitle || cfg.heroTitle || cfg.tournamentTitle || "Golf Tournament Scorecard")
        .replace(/^[⛳🏆🎯\s]+/, "")
        .trim() || "Golf Tournament Scorecard";

    // Build normalized group and player list
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

    var ss = spec.existingSs || null;
    var defaultSheets = [];
    if (ss) {
        try {
            if (ss.getName() !== sheetTitle) ss.rename(sheetTitle);
        } catch (renErr) { }
        var stagingSheet = ss.insertSheet("_RebuildTmp_" + new Date().getTime());
        defaultSheets = [stagingSheet];
        var oldTabs = ss.getSheets();
        for (var ot = 0; ot < oldTabs.length; ot++) {
            var tabName = oldTabs[ot].getName();
            if (oldTabs[ot] !== stagingSheet && tabName !== "_Config") {
                try { ss.deleteSheet(oldTabs[ot]); } catch (delTabErr) { }
            }
        }
    } else {
        ss = SpreadsheetApp.create(sheetTitle);
        defaultSheets = ss.getSheets();
    }

    // 1. Create group tabs (Group 1 ~ Group N)
    for (var idx = 0; idx < normGroups.length; idx++) {
        var grp = normGroups[idx];
        var gSheet = ss.insertSheet(grp.name);
        var pCount = grp.players.length;
        var lastPlayerRow = 2 + pCount;
        var guideRow = lastPlayerRow + 1;
        var missionRow = lastPlayerRow + 2;
        var memoRow = Math.max(15, missionRow + 3);

        var totalRows = memoRow;
        var grid = [];
        for (var r = 0; r < totalRows; r++) {
            var emptyRow = [];
            for (var c = 0; c < 21; c++) emptyRow.push("");
            grid.push(emptyRow);
        }

        // Row 1: Hole | 1..18 | TOT | Handicap
        grid[0][0] = "Hole";
        for (var h = 1; h <= 18; h++) grid[0][h] = h;
        grid[0][19] = "TOT";
        grid[0][20] = "핸디";

        // Row 2: Par | par1..par18 | =SUM(B2:S2) | ""
        grid[1][0] = "Par";
        for (var hp = 0; hp < 18; hp++) grid[1][hp + 1] = pars[hp];
        grid[1][19] = "=SUM(B2:S2)";

        // Rows 3..lastPlayerRow: Player Name | Empty (18 holes) | =SUM(B3:S3) | Handicap
        for (var p = 0; p < pCount; p++) {
            var rIdx = 2 + p;
            var rNum = rIdx + 1;
            grid[rIdx][0] = grp.players[p].name;
            grid[rIdx][19] = "=SUM(B" + rNum + ":S" + rNum + ")";
            grid[rIdx][20] = grp.players[p].handicap;
        }

        // Score input guide row (merged B7:T7)
        grid[guideRow - 1][1] = "파 대비 점수로 적어주세요: (보기:1, 더블:2, 버디:-1, ....)";

        // All-Par Mission row (A8 label, B8:S8 formulas)
        grid[missionRow - 1][0] = "홀파미션";
        for (var hm = 1; hm <= 18; hm++) {
            var colL = colIndexToLetter(hm + 1);
            grid[missionRow - 1][hm] = '=IF(COUNTBLANK(' + colL + '3:' + colL + lastPlayerRow + ') > 0, "도전", IF(SUM(' + colL + '3:' + colL + lastPlayerRow + ') <= 0, "성공!", "실패"))';
        }

        // Memo row (A15 label)
        grid[memoRow - 1][0] = "메모";

        gSheet.getRange(1, 1, totalRows, 21).setValues(grid);

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

    // 2. Create 'Results' tab
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
        var gBg = (gi2 % 2 === 0) ? "#fff2cc" : "#d9ead3";
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
                var srcColL = colIndexToLetter(h2 + 1);
                rowArr[1 + h2] = "='" + gEsc + "'!" + srcColL + pSheetRow;
            }
            rowArr[20] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(C' + r + ':T' + r + '), "")';
            rowArr[21] = "='" + gEsc + "'!U" + pSheetRow;
            rowArr[22] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), U' + r + '-V' + r + ', "")';
            rowArr[23] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', -1), "")';
            rowArr[24] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 0), "")';
            rowArr[25] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 1), "")';
            rowArr[26] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 2), "")';
            rowArr[27] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 3), "")';
            rowArr[28] = '=IF(ISNUMBER($U' + r + '), COUNTIF($C' + r + ':$T' + r + ', 4), "")';
            rowArr[29] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), ABS(SUM(C' + r + ':K' + r + ')-SUM(L' + r + ':T' + r + ')), "")';
            rowArr[30] = '=IF(AND(ISNUMBER(U' + r + '), ISNUMBER(V' + r + ')), ABS(U' + r + ' - V' + r + '), "")';
            rowArr[31] = '=IF(ISNUMBER($U' + r + '), INDEX(REDUCE({0, 0, -99}, C' + r + ':T' + r + ', LAMBDA(acc, v, LET(mx, INDEX(acc,1), cur, INDEX(acc,2), prv, INDEX(acc,3), ncur, IF(OR(v=0, v=1), IF(AND(OR(prv=0, prv=1), v<>prv), cur+1, 1), 0), {MAX(mx, ncur), ncur, v}))), 1), "")';
            rowArr[32] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(C' + r + ':K' + r + '), "")';
            rowArr[33] = '=IF(COUNT(C' + r + ':T' + r + ')=18, SUM(L' + r + ':T' + r + '), "")';
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

    // 3. Create 'Near/Long' tab
    var nearSheet = ss.insertSheet("니어/롱기");
    var longColBase = Math.max(nearHoles.length * 2 + 1, 9);
    var hofCol = Math.max(longColBase + longHoles.length * 2, 11);
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
    for (var nf = 0; nf < nearHoles.length; nf++) {
        nearSheet.getRange(2, nf * 2 + 2, 60, 1).setNumberFormat("@");
    }
    nearSheet.setColumnWidth(hofCol, 280);
    nearSheet.setFrozenRows(1);

    // 4. Create 'Stat' tab
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

    // 5. Store self-contained tournament config in hidden '_Config' tab
    cfg.groups = normGroups;
    writeConfigToSpreadsheet(ss, cfg, spec.managerPin || "");

    // Remove initial default blank sheet (Sheet1)
    for (var ds = 0; ds < defaultSheets.length; ds++) {
        try { ss.deleteSheet(defaultSheets[ds]); } catch (de) { }
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
        normGroups: normGroups,
        groupList: normGroups.map(function (g) {
            return {
                name: g.name,
                players: g.players.map(function (p) { return p.name; })
            };
        })
    };
}

/**
 * Called once when booting the participant app (index.html?t=slug):
 * - Resolves the tournament slug to its dedicated Google Spreadsheet and returns { config, groupList, sheetId, resultsUrl }.
 * - Returns { notFound: true } if the slug does not exist in the registry.
 */
function getInitBundle() {
    if (!CURRENT_REQ_SLUG) {
        return { missingSlug: true, groupList: [] };
    }
    var rec = lookupTournamentBySlug(CURRENT_REQ_SLUG);
    if (!rec || !rec.sheetId) {
        return { notFound: true, slug: CURRENT_REQ_SLUG, groupList: [] };
    }
    CURRENT_REQ_SHEET_ID = rec.sheetId;
    var cfg = readConfigFromSpreadsheet(null, rec.sheetId);
    var groupList = getGroupList();
    return {
        notFound: false,
        slug: rec.slug,
        sheetId: rec.sheetId,
        resultsUrl: rec.resultsUrl,
        config: cfg,
        groupList: groupList
    };
}

// [Fast] Fetch group list and player names (per-sheet isolated cache + single batch read from 'Results' tab)
function getGroupList() {
    var glCacheKey = getCurrentSheetScopePrefix("GL_");
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

// Find the 1-based row number labeled 'Memo' in column A from preloaded 2D values (throws if missing)
function findMemoRowFromValues(allValues, sheetName) {
    // Priority 1: Exact match for 'Memo' in column A
    for (var i = 0; i < allValues.length; i++) {
        var val = allValues[i][0] ? String(allValues[i][0]).trim() : "";
        if (val === "메모") {
            return i + 1;
        }
    }

    // Priority 2: Partial match containing 'Memo' in column A
    for (var j = 0; j < allValues.length; j++) {
        var val2 = allValues[j][0] ? String(allValues[j][0]).trim() : "";
        if (val2.indexOf("메모") !== -1) {
            return j + 1;
        }
    }

    throw new Error("'" + sheetName + "' 시트의 A열에서 '메모' 행을 찾을 수 없습니다.");
}

// Fetch data for a specific group (single batch read for Pars, dynamic player rows, and memo row)
function getGroupData(groupName) {
    var ss = getTargetSpreadsheet();
    var sheet = ss.getSheetByName(groupName);
    if (!sheet) throw new Error("해당 조를 찾을 수 없습니다.");

    // Read the entire sheet block (rows 1..max(lastRow,30), cols A..S) in a single API call
    var maxRow = Math.max(sheet.getLastRow(), 30);
    var allValues = sheet.getRange(1, 1, maxRow, 19).getValues();

    // 1. Hole Pars (Row 2 B2:S2 -> index 1, col 1..18)
    var pars = allValues[1].slice(1, 19);

    // 2. Player rows (scan rows 3..8 and record actual spreadsheet row numbers)
    var players = [];
    for (var r = 2; r <= 7 && r < allValues.length; r++) {
        var rowData = allValues[r];
        var name = rowData[0] ? String(rowData[0]).trim() : "";
        var actualRow = r + 1; // Actual 1-based spreadsheet row number (3 ~ 8)

        // Keep only valid player rows
        if (name && name !== "홀파미션" && name !== "메모" && name.indexOf("점수") === -1 && name.indexOf("Par") === -1) {
            var scores = [];
            for (var h = 1; h <= 18; h++) {
                var val = rowData[h];
                var strVal = (val === null || val === undefined) ? "" : String(val).trim();
                scores.push(strVal === "" || isNaN(Number(strVal)) ? "" : Number(strVal));
            }
            players.push({
                name: name,
                rowNumber: actualRow, // Pass the player's actual spreadsheet row number
                scores: scores
            });
        }
    }

    // 3. Locate the 'Memo' row in column A and read per-hole notes (cols B..S)
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

// Ultra-fast safe merge save for scores & memos (single batch read + contiguous row write + cell-level smart merge + multi-hole offline sync)
function saveGroupScores(groupName, scoreData, notesData, activeHole, nearPinHoles, longDriveHoles, dirtyNoteHoles, ticket) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000); // Wait up to 15 seconds for script lock to serialize concurrent saves

    try {
        // Sequence ticket check: if this device already saved a newer sequence number, ignore this delayed stale request
        var isStaleTicket = false;
        if (ticket && ticket.device && Number(ticket.seq) > 0) {
            try {
                var seqCache = CacheService.getScriptCache();
                var seqKey = getCurrentSheetScopePrefix("SAVESEQ_") + encodeURIComponent(groupName) + "_" + String(ticket.device).slice(0, 40);
                if (Number(ticket.seq) <= Number(seqCache.get(seqKey) || 0)) {
                    isStaleTicket = true;
                } else {
                    seqCache.put(seqKey, String(ticket.seq), 21600); // Remember sequence number for 6 hours
                }
            } catch (ce) { } // If cache fails, skip ticket check and proceed with normal save
        }
        if (isStaleTicket) {
            return { success: true, stale: true, message: "이미 더 최신 저장이 반영되어 있습니다." };
        }

        var ss = getTargetSpreadsheet();
        var sheet = ss.getSheetByName(groupName);
        if (!sheet) throw new Error("시트 '" + groupName + "'를 찾을 수 없습니다.");

        var numPlayers = scoreData ? scoreData.length : 0;
        if (numPlayers === 0) return { success: false, message: "저장할 데이터가 없습니다." };

        // Support activeHole as either a single hole number or an array of holes (including offline pending holes)
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

        // 1. Read the entire sheet block (rows 1..max(lastRow,30), cols A..S) in a single call
        var maxRow = Math.max(sheet.getLastRow(), 30);
        var allValues = sheet.getRange(1, 1, maxRow, 19).getValues();
        var memoRow = findMemoRowFromValues(allValues, groupName);

        var mergedScores = [];
        var targetRows = [];
        var groupPlayerNames = [];
        var newBirdies = [];
        var canceledBirdies = [];

        // 2. Cell-level in-memory merge between existing and incoming scores + detect new Birdies(-1) / Eagles(-2)
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

            // Check dirtyHoles touched on this device (falls back to activeHole mode for legacy callers)
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
                    // Cells explicitly touched/edited on this device: apply new value or cleared value ("") immediately
                    if (hasIncoming) {
                        var numIn = Number(incoming);
                        mergedRow.push(numIn);
                    } else {
                        mergedRow.push("");
                    }
                } else {
                    // Untouched player cells or other holes: preserve existing sheet score to protect companions' concurrent edits
                    if (hasExisting) {
                        mergedRow.push(Number(existing));
                    } else if (playerDirtyMap === null && hasIncoming) {
                        mergedRow.push(Number(incoming));
                    } else {
                        mergedRow.push("");
                    }
                }
            }

            // Based on merged full-round scores for this player, detect Birdie(-1) / Eagle(-2) / Par Streak (3, 4, 5 in a row) on saved holes
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

        // 2-1. Detect All-Par Mission (all players in group <= 0 on hole) success or cancellation
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

        // 3. Write all player rows in a single setValues call if contiguous (e.g. rows 3..6), or row-by-row if non-contiguous
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

        // 4. Safely merge and save the 'Memo' row (per-player smart 3-way merge for concurrent Near/Long entries)
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
            // 5. Write memo row & sync 'Near/Long' tab only when memos actually changed (skip extra sheet I/O on score-only saves)
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

        // 6. Update and reconcile shared Birdie / Eagle / All-Par Mission / Par-Streak broadcast feed
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
var BIRDIE_RETENTION_MS = 14 * 60 * 60 * 1000; // Retain feed items for 14 hours (keeps all records throughout tournament day)
var BIRDIE_MAX_ITEMS = 160; // Preserve up to 160 items so all Birdie / Par-Streak / All-Par records for 28 players across 18 holes are kept

// Compact array serialization (~45B vs ~170B per item, 73% smaller) to stay well within PropertiesService 9KB limit
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

// Format a broadcast event object into a single-line string stored below cell K2 on the 'Near/Long' tab
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

// Parse a single-line string from column K of the 'Near/Long' tab back into a broadcast event object
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
        if (propsOut) propsOut.setProperty(getCurrentSheetScopePrefix("BF_"), outJson);
    } catch (pe) { }
    try {
        var cacheOut = CacheService.getScriptCache();
        if (cacheOut) cacheOut.put(getCurrentSheetScopePrefix("BF_"), outJson, 21600);
    } catch (ce) { }
}

// Count consecutive Pars (0) ending at holeIdx (0-indexed)
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

// Read shared live broadcast feed for popup banners (queries CacheService first for zero sheet load)
function getBirdieFeed() {
    try {
        var now = Date.now();
        var raw = null;
        try {
            var cache = CacheService.getScriptCache();
            if (cache) raw = cache.get(getCurrentSheetScopePrefix("BF_"));
        } catch (ce) { }

        if (!raw) {
            var props = PropertiesService.getScriptProperties();
            if (props) raw = props.getProperty(getCurrentSheetScopePrefix("BF_"));
            if (raw) {
                try {
                    var cacheWrite = CacheService.getScriptCache();
                    if (cacheWrite) cacheWrite.put(getCurrentSheetScopePrefix("BF_"), raw, 21600);
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

// Read Hall of Fame feed directly from column K (below K2) of 'Near/Long' tab (clears cache if column K was manually cleared)
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

        // If column K differs from memory cache (e.g. manually edited/deleted in sheet), sync cache to column K immediately
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

// Automatically clean up ghost feed items for a group if scores were manually cleared directly in the sheet
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

// Add new Birdie(-1)/Eagle(-2)/All-Par Mission events, remove canceled ones on score edits, and sync column K of 'Near/Long' tab
function updateBirdieFeed(newBirdies, canceledBirdies, ssOpt) {
    try {
        var hasNew = Array.isArray(newBirdies) && newBirdies.length > 0;
        var hasCanceled = Array.isArray(canceledBirdies) && canceledBirdies.length > 0;
        var cachedFiltered = getBirdieFeed();
        if (!hasNew && !hasCanceled) {
            return cachedFiltered;
        }

        // Build lookup maps by slot (group_hole_player) and event ID from cached feed
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

        // Fast pre-check (~0.005s) whether any feed item actually changed (avoids unnecessary column K sheet I/O on normal Par/Bogey saves)
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

        // Read current lines below K2 in 'Near/Long' tab as source of truth (ensures manually deleted lines in sheet do not resurrect)
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

        // Remove feed entries from list and column K when a score edit breaks a previous Birdie/Eagle/All-Par condition
        if (hasCanceled) {
            for (var c = 0; c < canceledBirdies.length; c++) {
                var cb = canceledBirdies[c];
                filtered = filtered.filter(function (ev) {
                    return !(ev.group === cb.group && Number(ev.hole) === Number(cb.hole) && ev.player === cb.player);
                });
            }
        }

        // Append newly saved Birdie(-1) / Eagle(-2) / All-Par / Par-Streak events chronologically (keep original timestamp on duplicate saves)
        if (hasNew) {
            for (var n = 0; n < newBirdies.length; n++) {
                var nb = newBirdies[n];
                var evType = nb.type ? nb.type : (Number(nb.score) === -2 ? "EAGLE" : "BIRDIE");
                var deterministicId = nb.group + "_" + nb.hole + "H_" + nb.player + "_" + nb.score;
                var existingTs = 0;
                var existingTimeStr = "";

                // Replace existing entry for same group/hole/player (or __ALL_PAR__), preserving original timestamp if achievement type is unchanged
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

        // Write updated feed sequentially below K2 in 'Near/Long' tab (pad trailing rows with blanks when items shrink)
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

// Zero-pad integer part to at least 2 digits (e.g. "6" -> "06") so lexicographical sorting matches numeric order
function padTwoDigits(valStr) {
    var s = (valStr !== undefined && valStr !== null && String(valStr).trim() !== "") ? String(valStr).trim() : "0";
    var parts = s.split(".");
    if (parts[0].length < 2) {
        parts[0] = ("00" + parts[0]).slice(-2);
    }
    return parts.join(".");
}

// Split hole memo string by comma (,) into player segments (P:name) or plain text segments (T:text)
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

// Per-player / per-segment 3-way smart merge so concurrent Near/Long memo edits by groupmates never overwrite each other
function mergeHoleNoteSmart(exNote, inNote, baseNote) {
    var ex = (exNote !== undefined && exNote !== null) ? String(exNote).trim() : "";
    var inp = (inNote !== undefined && inNote !== null) ? String(inNote).trim() : "";
    var hasBase = (baseNote !== undefined && baseNote !== null);
    var base = hasBase ? String(baseNote).trim() : "";

    // If the server memo last seen by this device (baseNote) equals the current server memo (exNote),
    // no groupmate edited it in the meantime, so apply this user's input (inNote) directly
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

    // If the user cleared the memo: remove entries originally known to this device (baseMap),
    // while preserving entries newly added in the meantime by other groupmates (!baseMap)
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

    // 1) Iterate over entries currently on the server (exSegs):
    // - If also present in incoming input (inMap), update with incoming value (unless unchanged on this device)
    // - If missing from incoming input but present in baseMap, this device deleted it -> omit
    // - If unknown to baseMap (!baseMap, concurrently added by another groupmate) -> preserve
    for (var e = 0; e < exSegs.length; e++) {
        var eKey = exSegs[e].key;
        if (Object.prototype.hasOwnProperty.call(inMap, eKey)) {
            // If untouched on this phone (same as base value), keep latest server value so another phone's edit isn't reverted
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

    // 2) Iterate over entries present in incoming input (inSegs) but not currently on the server (exSegs):
    // - If baseMap already had the exact same text and it is now gone from exSegs,
    //   another groupmate just deleted it on the server -> do not resurrect it!
    // - Append only entries newly added or explicitly modified on this device
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

// Extract player name and 06'11" formatted distance from Near-Pin memo text
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

        // If the same player name appears multiple times in the same hole memo, keep the latest value
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

// Extract player name and numeric remaining yards from Long-Drive memo text
function parseLongDriveEntries(noteText) {
    var results = [];
    if (!noteText) return results;

    var str = String(noteText);
    var regex = /([^,:]+?)\s*:\s*(?:핀까지\s*)?\[?\s*([0-9.]+)\s*\]?\s*(?:야드|yds?)?/gi;
    var match;

    while ((match = regex.exec(str)) !== null) {
        var fullMatch = match[0] || "";
        // Ignore Near-Pin ('feet') segments if mixed in the same memo
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

// Sync Near-Pin (A:B, C:D, E:F, G:H) and Long-Drive (I:J) entries starting at row 2 of the 'Near/Long' tab
function syncNearPinToSheet(ss, mergedNotes, activeIdxMap, hasSpecificActiveHoles, groupPlayersMap, nearPinHoles, longDriveHoles) {
    try {
        var nearList = (Array.isArray(nearPinHoles) && nearPinHoles.length > 0) ? nearPinHoles : [3, 7, 11, 14];
        var longList = (Array.isArray(longDriveHoles) && longDriveHoles.length > 0) ? longDriveHoles : [5];
        var eventHoleCols = [];

        // 1. Near-Pin hole column mapping: 1st->A:B(1), 2nd->C:D(3), 3rd->E:F(5), 4th->G:H(7)
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

        // 2. Long-Drive hole column mapping: starts at cols I:J (colStart = 9, or after Near columns if >4 Near holes)
        var longColBase = Math.max(nearList.length * 2 + 1, 9);
        for (var lIdx = 0; lIdx < longList.length; lIdx++) {
            var lhNum = Number(longList[lIdx]);
            if (lhNum >= 1 && lhNum <= 18) {
                eventHoleCols.push({
                    hole: lhNum,
                    colStart: longColBase + lIdx * 2, // Col I (9): Player Name, Col J (10): Remaining Yards
                    type: "long"
                });
            }
        }

        // Check first whether this save request includes any event hole (Near-Pin or Long-Drive)
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

            // Extract valid [name, record] rows from the corresponding hole columns (row 2+) in the sheet
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
                    // Exclude group members whose record was deleted from this hole's memo
                    if (groupPlayersMap && groupPlayersMap[exName] && !Object.prototype.hasOwnProperty.call(parsedMap, exName)) {
                        continue;
                    }
                    existingList.push({ name: exName, dist: exDist });
                }
            }

            // Merge newly parsed entries (update distance if player exists, otherwise append at the bottom)
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
        // Protect main score save from failing even if an unexpected error occurs while syncing 'Near/Long' tab
    }
}

/**
 * [Scoreboard] Read-only fetch of 'Near/Long' tab display values (no sheet writes, no lock, isolated from scoring)
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
 * ============================================================================

/**
 * ============================================================================
 * Multi-Tournament Admin API (Master Admin Console + Per-Tournament Manager Mode)
 * ============================================================================
 */
function extractSpreadsheetId(idOrUrl) {
    var s = String(idOrUrl || "").trim();
    var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : s;
}

function verifyTournamentAccess(slug, pin) {
    var rec = lookupTournamentBySlug(slug);
    if (!rec) {
        throw new Error("등록되지 않은 대회 코드입니다: " + slug);
    }
    var p = String(pin || "").trim();
    var masterPin = String(getMasterPin()).trim();
    if (p === masterPin) return { role: "master", record: rec };
    if (rec.managerPin && p !== "" && p === String(rec.managerPin).trim()) {
        return { role: "manager", record: rec };
    }
    throw new Error("비밀번호(PIN)가 올바르지 않습니다.");
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


// Escape special HTML characters for safe <title> and <meta> tag injection
function escapeHtmlAttr(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Publish or update a lightweight title-only entry HTML (t/<slug>/index.html) on GitHub Pages
// so KakaoTalk link previews display the exact tournament name without photos.
function syncGithubSlugPreviewPage(slug, tournamentName, isDelete) {
    try {
        var props = PropertiesService.getScriptProperties();
        var token = (props.getProperty(PROP_GH_TOKEN) || "").trim();
        var repo = (props.getProperty(PROP_GH_REPO) || DEFAULT_GH_REPO).trim();
        if (!token || !repo || !slug) return { synced: false, reason: "no_token" };

        var apiPath = "https://api.github.com/repos/" + repo + "/contents/t/" + encodeURIComponent(slug) + "/index.html";
        var headers = {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        };

        // Check if file already exists to retrieve its current blob SHA
        var existingSha = "";
        var getResp = UrlFetchApp.fetch(apiPath, {
            method: "get",
            headers: headers,
            muteHttpExceptions: true
        });
        if (getResp.getResponseCode() === 200) {
            var parsedGet = JSON.parse(getResp.getContentText() || "{}");
            existingSha = parsedGet.sha || "";
        }

        if (isDelete) {
            if (!existingSha) return { synced: true, deleted: true };
            var delPayload = {
                message: "Remove tournament preview page: " + slug,
                sha: existingSha
            };
            var delResp = UrlFetchApp.fetch(apiPath, {
                method: "delete",
                contentType: "application/json",
                headers: headers,
                payload: JSON.stringify(delPayload),
                muteHttpExceptions: true
            });
            var delCode = delResp.getResponseCode();
            return { synced: delCode >= 200 && delCode < 300, status: delCode };
        }

        var cleanTitle = String(tournamentName || "골프대회 스코어보드").replace(/^[⛳🏆🎯\s]+/, "").trim();
        var displayTitle = "⛳ " + cleanTitle;
        var safeTitle = escapeHtmlAttr(displayTitle);
        var html =
            "<!DOCTYPE html>\n" +
            "<html lang=\"ko\">\n" +
            "<head>\n" +
            "  <meta charset=\"UTF-8\">\n" +
            "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
            "  <title>" + safeTitle + "</title>\n" +
            "  <meta property=\"og:type\" content=\"website\">\n" +
            "  <meta property=\"og:title\" content=\"" + safeTitle + "\">\n" +
            "  <meta property=\"og:description\" content=\"실시간 스코어카드 · 조 편성표\">\n" +
            "  <script>window.location.replace(\"../../?t=" + encodeURIComponent(slug) + "\");</script>\n" +
            "</head>\n" +
            "<body></body>\n" +
            "</html>\n";

        var b64Content = Utilities.base64Encode(html, Utilities.Charset.UTF_8);
        var putPayload = {
            message: "Publish tournament preview title: " + cleanTitle + " (" + slug + ")",
            content: b64Content
        };
        if (existingSha) putPayload.sha = existingSha;

        var putResp = UrlFetchApp.fetch(apiPath, {
            method: "put",
            contentType: "application/json",
            headers: headers,
            payload: JSON.stringify(putPayload),
            muteHttpExceptions: true
        });
        var code = putResp.getResponseCode();
        return { synced: code >= 200 && code < 300, status: code };
    } catch (e) {
        return { synced: false, error: String(e && e.message ? e.message : e) };
    }
}

function adminSaveGithubToken(masterPin, ghToken, ghRepoOpt) {
    verifyMasterPin(masterPin);
    var props = PropertiesService.getScriptProperties();
    var cleanToken = String(ghToken || "").trim();
    if (!cleanToken) {
        props.deleteProperty(PROP_GH_TOKEN);
        return { saved: false, hasGithubToken: false };
    }
    var repo = String(ghRepoOpt || props.getProperty(PROP_GH_REPO) || DEFAULT_GH_REPO).trim();
    props.setProperty(PROP_GH_TOKEN, cleanToken);
    props.setProperty(PROP_GH_REPO, repo);
    return { saved: true, hasGithubToken: true, ghRepo: repo };
}

// [Master Only] List all hosted tournaments in reverse chronological order
function adminListTournaments(masterPin) {
    verifyMasterPin(masterPin);
    var list = readAllRegistryRecords();
    list.sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    var props = PropertiesService.getScriptProperties();
    var hasGh = Boolean((props.getProperty(PROP_GH_TOKEN) || "").trim());
    var ghRepo = (props.getProperty(PROP_GH_REPO) || DEFAULT_GH_REPO).trim();
    return { tournaments: list, hasGithubToken: hasGh, ghRepo: ghRepo };
}

// [Master OR Club Manager] Load full details for a single tournament slug
function adminGetTournament(slug, pin) {
    var auth = verifyTournamentAccess(slug, pin);
    var rec = auth.record;
    var ss = SpreadsheetApp.openById(rec.sheetId);
    var cfg = readConfigFromSpreadsheet(ss, rec.sheetId) || {};
    var groups = readGroupsWithHandicapsFromSheet(ss);
    return {
        role: auth.role,
        slug: rec.slug,
        sheetId: rec.sheetId,
        sheetTitle: ss.getName(),
        resultsUrl: rec.resultsUrl,
        managerPin: rec.managerPin || "",
        config: cfg,
        groups: groups
    };
}

// [Master OR Club Manager rebuilding their own slug] Create a new tournament Google Sheet & register its unique slug
function adminCreateTournament(pin, spec) {
    spec = spec || {};
    var requestedSlug = normalizeSlug(spec.slug || (spec.config && spec.config.tournamentId) || "");
    var slug = requestedSlug || generateRandomSlug();
    var existing = lookupTournamentBySlug(slug);

    if (existing) {
        if (!spec.allowOverwrite) {
            throw new Error("이미 사용 중인 대회 코드('" + slug + "')입니다. 다른 대회 코드를 입력하거나 기존 대회를 선택해 수정해주세요.");
        }
        verifyTournamentAccess(slug, pin);
    } else {
        verifyMasterPin(pin);
        // Ensure auto-generated slug never collides
        while (lookupTournamentBySlug(slug)) {
            slug = generateRandomSlug();
        }
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        var cfg = spec.config || {};
        cfg.tournamentId = slug;
        var managerPin = String(spec.managerPin !== undefined ? spec.managerPin : (existing ? existing.managerPin : "")).trim();

        var created = createTournamentSpreadsheet({
            config: cfg,
            groups: spec.groups || cfg.groups || [],
            pars: spec.pars,
            managerPin: managerPin
        });

        if (existing && existing.sheetId) {
            invalidateSheetCaches(existing.sheetId);
        }
        invalidateSheetCaches(created.sheetId);

        var regSaved = upsertTournamentInRegistry({
            slug: slug,
            sheetId: created.sheetId,
            sheetTitle: created.sheetTitle,
            courseKey: cfg.courseKey || "",
            managerPin: managerPin,
            resultsUrl: created.resultsUrl,
            createdAt: existing ? existing.createdAt : ""
        });

        var ghSync = syncGithubSlugPreviewPage(regSaved.slug, created.sheetTitle, false);
        return {
            slug: regSaved.slug,
            sheetId: created.sheetId,
            sheetTitle: created.sheetTitle,
            resultsUrl: created.resultsUrl,
            managerPin: managerPin,
            ghPreviewSynced: Boolean(ghSync && ghSync.synced),
            config: cfg,
            groupList: created.groupList
        };
    } finally {
        lock.releaseLock();
    }
}

// Normalize raw group roster array into [{ name, players: [{ name, handicap }] }]
function normalizeTournamentGroups_(rawGroups) {
    var norm = [];
    if (!Array.isArray(rawGroups)) return norm;
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
            if (pName) cleanPlayers.push({ name: pName, handicap: pHcp });
        }
        if (cleanPlayers.length > 0) norm.push({ name: gName, players: cleanPlayers });
    }
    return norm;
}

// [Master OR Club Manager] Unified Save: updates config, player names/handicaps, or group tabs inside the SAME Google Sheet
function adminUpdateTournamentConfig(slug, pin, newConfig, newManagerPinOpt, parsOpt) {
    var auth = verifyTournamentAccess(slug, pin);
    var rec = auth.record;
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        var ss = SpreadsheetApp.openById(rec.sheetId);
        var oldCfg = readConfigFromSpreadsheet(ss, rec.sheetId) || {};
        var oldGroups = normalizeTournamentGroups_(readGroupsWithHandicapsFromSheet(ss));

        var cfg = newConfig || {};
        cfg.tournamentId = rec.slug;
        var normNewGroups = normalizeTournamentGroups_(cfg.groups || []);
        if (normNewGroups.length > 0) {
            cfg.groups = normNewGroups;
        }

        var nextManagerPin = (newManagerPinOpt !== undefined && newManagerPinOpt !== null && String(newManagerPinOpt).trim() !== "")
            ? String(newManagerPinOpt).trim()
            : rec.managerPin;

        var cleanSheetTitle = String(cfg.sheetTitle || rec.sheetTitle || ss.getName())
            .replace(/^[⛳🏆🎯\s]+/, "")
            .trim() || ss.getName();
        try {
            if (ss.getName() !== cleanSheetTitle) ss.rename(cleanSheetTitle);
        } catch (renErr2) { }

        var courseChanged = Boolean(cfg.courseKey && oldCfg.courseKey && cfg.courseKey !== oldCfg.courseKey);
        var eventHolesChanged =
            JSON.stringify(cfg.nearPinHoles || []) !== JSON.stringify(oldCfg.nearPinHoles || []) ||
            JSON.stringify(cfg.longDriveHoles || []) !== JSON.stringify(oldCfg.longDriveHoles || []);

        var sameShape = (oldGroups.length === normNewGroups.length);
        var samePlayers = sameShape;
        if (sameShape) {
            for (var i = 0; i < oldGroups.length; i++) {
                if (oldGroups[i].name !== normNewGroups[i].name || oldGroups[i].players.length !== normNewGroups[i].players.length) {
                    sameShape = false;
                    samePlayers = false;
                    break;
                }
                for (var j = 0; j < oldGroups[i].players.length; j++) {
                    var op = oldGroups[i].players[j];
                    var np = normNewGroups[i].players[j];
                    if (op.name !== np.name || String(op.handicap) !== String(np.handicap)) {
                        samePlayers = false;
                    }
                }
            }
        }

        var updateMode = "config_only";
        var nextResultsUrl = rec.resultsUrl;

        if (normNewGroups.length > 0 && (!sameShape || courseChanged || eventHolesChanged)) {
            // Rebuild tabs inside the SAME existing spreadsheet (same sheetId, zero duplicate files)
            var rebuilt = createTournamentSpreadsheet({
                existingSs: ss,
                config: cfg,
                groups: normNewGroups,
                pars: parsOpt,
                managerPin: nextManagerPin
            });
            nextResultsUrl = rebuilt.resultsUrl;
            updateMode = "rebuilt_in_same_sheet";
        } else {
            if (normNewGroups.length > 0 && sameShape && !samePlayers) {
                // Update only player names (col A) and handicaps (col U) in-place while preserving all entered hole scores
                for (var gi = 0; gi < normNewGroups.length; gi++) {
                    var gObj = normNewGroups[gi];
                    var gTab = ss.getSheetByName(gObj.name);
                    if (!gTab) continue;
                    var pCnt = gObj.players.length;
                    var nameCol = [];
                    var hcpCol = [];
                    for (var pi = 0; pi < pCnt; pi++) {
                        nameCol.push([gObj.players[pi].name]);
                        hcpCol.push([gObj.players[pi].handicap]);
                    }
                    gTab.getRange(3, 1, pCnt, 1).setValues(nameCol);
                    gTab.getRange(3, 21, pCnt, 1).setValues(hcpCol);
                }
                SpreadsheetApp.flush();
                updateMode = "roster_inplace";
            }
            writeConfigToSpreadsheet(ss, cfg, nextManagerPin);
        }

        invalidateSheetCaches(rec.sheetId);

        var saved = upsertTournamentInRegistry({
            slug: rec.slug,
            sheetId: rec.sheetId,
            sheetTitle: cleanSheetTitle,
            courseKey: cfg.courseKey || rec.courseKey || "",
            managerPin: nextManagerPin,
            resultsUrl: nextResultsUrl,
            createdAt: rec.createdAt
        });

        var ghSyncUpd = syncGithubSlugPreviewPage(saved.slug, saved.sheetTitle, false);
        return {
            updated: true,
            updateMode: updateMode,
            ghPreviewSynced: Boolean(ghSyncUpd && ghSyncUpd.synced),
            slug: saved.slug,
            sheetId: saved.sheetId,
            resultsUrl: saved.resultsUrl,
            managerPin: saved.managerPin,
            config: cfg
        };
    } finally {
        lock.releaseLock();
    }
}

// [Master Only] Bind a slug to an existing Google Spreadsheet URL/ID
function adminConnectExistingSheet(masterPin, rawSlug, sheetIdOrUrl, configOpt, managerPinOpt) {
    verifyMasterPin(masterPin);
    var slug = normalizeSlug(rawSlug) || generateRandomSlug();
    var sid = extractSpreadsheetId(sheetIdOrUrl);
    if (!sid) throw new Error("유효한 구글 시트 URL 또는 ID를 입력해주세요.");

    var ss = SpreadsheetApp.openById(sid);
    var resSheet = ss.getSheetByName("결과");
    var resultsGid = resSheet ? String(resSheet.getSheetId()) : "0";
    var resultsUrl = "https://docs.google.com/spreadsheets/d/" + sid + "/edit?gid=" + resultsGid + "#gid=" + resultsGid;
    var groups = readGroupsWithHandicapsFromSheet(ss);
    var existingCfg = readConfigFromSpreadsheet(ss, sid);
    var cfg = configOpt || existingCfg || {};
    cfg.tournamentId = slug;
    if (groups.length > 0) cfg.groups = groups;

    var managerPin = String(managerPinOpt || "").trim();
    writeConfigToSpreadsheet(ss, cfg, managerPin);
    invalidateSheetCaches(sid);

    var saved = upsertTournamentInRegistry({
        slug: slug,
        sheetId: sid,
        sheetTitle: ss.getName(),
        courseKey: cfg.courseKey || "",
        managerPin: managerPin,
        resultsUrl: resultsUrl
    });

    var ghSyncConn = syncGithubSlugPreviewPage(saved.slug, saved.sheetTitle, false);
    return {
        ghPreviewSynced: Boolean(ghSyncConn && ghSyncConn.synced),
        slug: saved.slug,
        sheetId: sid,
        sheetTitle: ss.getName(),
        resultsUrl: resultsUrl,
        managerPin: managerPin,
        groups: groups,
        config: cfg
    };
}

// [Master OR Club Manager] Clear test scores & Near/Long records on a specific tournament's sheet
function adminResetTournamentScores(slug, pin) {
    var auth = verifyTournamentAccess(slug, pin);
    var rec = auth.record;
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var ss = SpreadsheetApp.openById(rec.sheetId);
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
        CURRENT_REQ_SHEET_ID = rec.sheetId;
        PropertiesService.getScriptProperties().deleteProperty(getCurrentSheetScopePrefix("BF_"));
        invalidateSheetCaches(rec.sheetId);
        SpreadsheetApp.flush();
        return { cleared: true, slug: rec.slug, sheetId: rec.sheetId };
    } finally {
        lock.releaseLock();
    }
}

// Run once in Apps Script editor if prompted to grant Google Drive file-trash permission
function authorizeDrivePermission() {
    DriveApp.getRootFolder();
}

// [Master Only] Remove a tournament slug from the registry AND move its Google Sheet file to Google Drive Trash
function adminDeleteTournament(masterPin, slug) {
    verifyMasterPin(masterPin);
    var cleanSlug = normalizeSlug(slug);
    var rec = lookupTournamentBySlug(cleanSlug);
    var targetSheetId = (rec && rec.sheetId) ? String(rec.sheetId).trim() : "";

    removeTournamentFromRegistry(cleanSlug);
    if (targetSheetId) {
        invalidateSheetCaches(targetSheetId);
    }

    var sheetTrashed = false;
    var sheetTrashError = "";
    if (targetSheetId) {
        try {
            var regSheetId = String(PropertiesService.getScriptProperties().getProperty(PROP_REGISTRY_SHEET_ID) || "").trim();
            var remaining = readAllRegistryRecords();
            var stillReferenced = false;
            for (var i = 0; i < remaining.length; i++) {
                if (remaining[i].sheetId === targetSheetId) {
                    stillReferenced = true;
                    break;
                }
            }
            if (!stillReferenced && targetSheetId !== regSheetId) {
                DriveApp.getFileById(targetSheetId).setTrashed(true);
                sheetTrashed = true;
            }
        } catch (trashErr) {
            sheetTrashError = String((trashErr && trashErr.message) || trashErr || "");
        }
    }

    syncGithubSlugPreviewPage(cleanSlug, "", true);
    return {
        deleted: true,
        slug: cleanSlug,
        sheetId: targetSheetId,
        sheetTrashed: sheetTrashed,
        sheetTrashError: sheetTrashError
    };
}

// [Master Only] Change Master Admin PIN
function adminChangeMasterPin(oldMasterPin, newMasterPin) {
    verifyMasterPin(oldMasterPin);
    var cleaned = String(newMasterPin || "").trim();
    if (cleaned.length < 4) throw new Error("새 마스터 PIN은 4자리 이상 입력해주세요.");
    PropertiesService.getScriptProperties().setProperty(PROP_MASTER_PIN, cleaned);
    return { changed: true };
}

/**
 * JSON API endpoint for static GitHub Pages apps (index.html?t=slug & admin.html)
 */
function doPost(e) {
    try {
        var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
        var req = JSON.parse(raw);
        setRequestTournamentContext(req && req.t ? req.t : "");

        var allowed = {
            getInitBundle: getInitBundle,
            getGroupList: getGroupList,
            getGroupData: getGroupData,
            getBirdieFeed: getBirdieFeed,
            getHallOfFameFeed: getHallOfFameFeed,
            saveGroupScores: saveGroupScores,
            getEventBoardData: getEventBoardData,
            adminListTournaments: adminListTournaments,
            adminGetTournament: adminGetTournament,
            adminCreateTournament: adminCreateTournament,
            adminUpdateTournamentConfig: adminUpdateTournamentConfig,
            adminConnectExistingSheet: adminConnectExistingSheet,
            adminResetTournamentScores: adminResetTournamentScores,
            adminDeleteTournament: adminDeleteTournament,
            adminChangeMasterPin: adminChangeMasterPin,
            adminSaveGithubToken: adminSaveGithubToken
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
