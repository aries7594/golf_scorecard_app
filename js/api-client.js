    // =========================================================================
    // GitHub direct-execution API adapter & automatic Google Sheet bootstrapper
    // - Runs directly on GitHub Pages rather than inside a Google Sheet-bound Apps Script web app.
    // - Auto-creates a Google Sheet from TournamentConfig.js if none exists yet.
    // - Dynamically applies latest server tournament settings created via admin.html.
    // =========================================================================
    var GAS_URL_STORAGE_KEY = "golf_gas_api_url_v1";

    function normalizeTournamentSlug(raw) {
      return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    }

    function resolveTournamentSlugFromUrl() {
      try {
        var params = new URLSearchParams(window.location.search || "");
        return normalizeTournamentSlug(params.get("t") || params.get("tournament") || "");
      } catch (e) {
        return "";
      }
    }

    var ACTIVE_TOURNAMENT_SLUG = resolveTournamentSlugFromUrl();
    var CACHED_REMOTE_CFG_KEY = "golf_cfg_v2_" + (ACTIVE_TOURNAMENT_SLUG || "none");
    var CACHED_SCOPE_KEY = "golf_scope_v2_" + (ACTIVE_TOURNAMENT_SLUG || "none");

    function resolveGasApiUrl() {
      try {
        var params = new URLSearchParams(window.location.search || "");
        var qApi = (params.get("api") || "").trim();
        if (qApi && /^https?:\/\//i.test(qApi)) {
          try { localStorage.setItem(GAS_URL_STORAGE_KEY, qApi); } catch (e) { }
          return qApi;
        }
      } catch (e) { }
      if (typeof GAS_BACKEND_URL === "string" && GAS_BACKEND_URL.trim()) {
        return GAS_BACKEND_URL.trim();
      }
      try {
        var savedUrl = (localStorage.getItem(GAS_URL_STORAGE_KEY) || "").trim();
        if (savedUrl) return savedUrl;
      } catch (e2) { }
      return "";
    }

    var GAS_API_URL = resolveGasApiUrl();
    var ACTIVE_TOURNAMENT_SCOPE = ACTIVE_TOURNAMENT_SLUG || "";
    try {
      var savedScope = localStorage.getItem(CACHED_SCOPE_KEY);
      if (savedScope) ACTIVE_TOURNAMENT_SCOPE = savedScope;
    } catch (e) { }

    (function autoEscapeKakaoInApp() {
      try {
        var ua = navigator.userAgent || "";
        if (/KAKAOTALK/i.test(ua) && window.top === window.self) {
          window.location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(window.location.href);
        }
      } catch (e) { }
    })();

    function callGasBackendRaw(fnName, argsArray) {
      var apiUrl = resolveGasApiUrl();
      if (!apiUrl) {
        return Promise.reject(new Error("NO_GAS_API_URL"));
      }
      var bodyStr = JSON.stringify({
        fn: fnName,
        t: ACTIVE_TOURNAMENT_SLUG,
        args: argsArray || []
      });
      var fetchOpts = {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: bodyStr
      };
      if (fnName === "saveGroupScores" && bodyStr.length < 60000) {
        fetchOpts.keepalive = true;
      }
      return fetch(apiUrl, fetchOpts)
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) return res.data;
          throw new Error((res && res.error) ? res.error : "서버 통신 오류");
        });
    }

    window.google = {
      script: {
        run: (function makeGasRunner(onOk, onErr) {
          var api = {
            withSuccessHandler: function (fn) { return makeGasRunner(fn, onErr); },
            withFailureHandler: function (fn) { return makeGasRunner(onOk, fn); }
          };
          ["getInitBundle", "getGroupList", "getGroupData", "getBirdieFeed", "getHallOfFameFeed", "saveGroupScores", "getEventBoardData"].forEach(function (name) {
            api[name] = function () {
              var args = Array.prototype.slice.call(arguments);
              callGasBackendRaw(name, args)
                .then(function (data) { if (onOk) onOk(data); })
                .catch(function (err) { if (onErr) onErr(err); });
            };
          });
          return api;
        })(null, null)
      }
    };

    var currentGroupData = null;
    var currentHole = 1;
    var isSaved = false;
    var isDirty = false;
    var isSaving = false;
    var saveTimeoutTimer = null;
    var toastTimer = null;
    var saveStartedAt = 0;
    var savedHoleSnapshot = "";
    var hasPendingLocalSave = false;
    var pendingLocalHoles = [];
    var dirtyScoreCells = {};
    // Save sequence ticket: generate per-device ID on launch and increment seq on every save request
    var saveDeviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var saveTicketNo = 0;
    var dirtyNoteHoles = {};
    var serverBaselineScores = [];
    var serverBaselineNotes = [];
    var myHomeGroup = "";
    var isViewOnly = false;
    var pendingGroupName = "";
    var isRefreshingGroup = false;
    var lastGroupSyncAt = 0;
    var activeSaveSeq = 0;
    var isSyncingOffline = false;

    function normalizeScoreVal(v) {
      return (v === "" || v === null || v === undefined || String(v).trim() === "" || isNaN(Number(v))) ? "" : Number(v);
    }

    function normalizeNoteVal(v) {
      return (v === null || v === undefined) ? "" : String(v).trim();
    }

    function updateServerBaseline(data) {
      if (!data) return;
      serverBaselineScores = (data.players || []).map(function (p) {
        return (p.scores || []).map(normalizeScoreVal);
      });
      serverBaselineNotes = [];
      for (var h = 0; h < 18; h++) {
        serverBaselineNotes.push(data.notes && data.notes[h] ? normalizeNoteVal(data.notes[h]) : "");
      }
    }

    function updateServerBaselineFromResponse(res) {
      if (!res) return;
      if (Array.isArray(res.mergedScores)) {
        serverBaselineScores = res.mergedScores.map(function (row) {
          return (row || []).map(normalizeScoreVal);
        });
      }
      if (Array.isArray(res.mergedNotes) && res.mergedNotes.length === 18) {
        serverBaselineNotes = [];
        for (var h = 0; h < 18; h++) {
          serverBaselineNotes.push(res.mergedNotes[h] ? normalizeNoteVal(res.mergedNotes[h]) : "");
        }
      }
    }

    function isHoleHasAnyInput(h) {
      if (!currentGroupData) return false;
      if (currentGroupData.players && currentGroupData.players.some(function (p) {
        return normalizeScoreVal(p.scores[h - 1]) !== "";
      })) {
        return true;
      }
      var nt = (currentGroupData.notes && currentGroupData.notes[h - 1]) ? normalizeNoteVal(currentGroupData.notes[h - 1]) : "";
      return nt !== "";
    }

    function hasDirtyChangesOnHole(h) {
      var holeNum = Number(h);
      if (dirtyNoteHoles[holeNum]) return true;
      if (!currentGroupData || !currentGroupData.players) return false;
      for (var p = 0; p < currentGroupData.players.length; p++) {
        if (dirtyScoreCells[p + "_" + holeNum]) return true;
      }
      return false;
    }

    function hasAnyDirtyChanges() {
      return Object.keys(dirtyScoreCells).length > 0 || Object.keys(dirtyNoteHoles).length > 0;
    }

    function buildSavePayload() {
      var payload = [];
      if (!currentGroupData || !currentGroupData.players) return payload;
      currentGroupData.players.forEach(function (p, pIdx) {
        var row = [];
        var pDirtyHoles = [];
        for (var h = 0; h < 18; h++) {
          row.push(normalizeScoreVal(p.scores[h]));
          if (dirtyScoreCells[pIdx + "_" + (h + 1)]) {
            pDirtyHoles.push(h + 1);
          }
        }
        payload.push({
          rowNumber: p.rowNumber,
          scores: row,
          dirtyHoles: pDirtyHoles
        });
      });
      return payload;
    }

    function getDirtyNoteHolesList() {
      var list = [];
      for (var h = 1; h <= 18; h++) {
        if (dirtyNoteHoles[h]) {
          list.push({
            hole: h,
            base: (serverBaselineNotes && serverBaselineNotes.length >= h) ? (serverBaselineNotes[h - 1] || "") : ""
          });
        }
      }
      return list;
    }

    var birdieBannerTimer = null;
    var activeBirdieBannerItems = [];

    // =========================================================================
    // Load tournament configuration and golf course catalog
    // - Course selection, notices, and event holes are managed via TournamentConfig / admin.html.
    // =========================================================================
    var HAS_SLUG_CACHED_CFG = false;
    var T_CFG = (typeof TOURNAMENT_CONFIG !== "undefined" && TOURNAMENT_CONFIG) ? TOURNAMENT_CONFIG : {};
    if (ACTIVE_TOURNAMENT_SLUG) {
      try {
        var cachedRemoteCfgRaw = localStorage.getItem(CACHED_REMOTE_CFG_KEY);
        if (cachedRemoteCfgRaw) {
          var cachedRemoteCfg = JSON.parse(cachedRemoteCfgRaw);
          if (cachedRemoteCfg && typeof cachedRemoteCfg === "object") {
            var mergedBootCfg = {};
            for (var bk in T_CFG) {
              if (Object.prototype.hasOwnProperty.call(T_CFG, bk)) mergedBootCfg[bk] = T_CFG[bk];
            }
            for (var rk in cachedRemoteCfg) {
              if (Object.prototype.hasOwnProperty.call(cachedRemoteCfg, rk) && cachedRemoteCfg[rk] !== undefined) {
                mergedBootCfg[rk] = cachedRemoteCfg[rk];
              }
            }
            T_CFG = mergedBootCfg;
            HAS_SLUG_CACHED_CFG = true;
          }
        }
      } catch (e) { }
    }

    var ALL_COURSES = (typeof COURSE_CATALOG !== "undefined" && COURSE_CATALOG) ? COURSE_CATALOG : {};
    var SELECTED_COURSE_KEY = "";

    var BASE_COURSE = {};
    var ACTIVE_COURSE = {};
    var longDriveHoles = [];
    var nearPinHoles = [];
    var COURSE_DATA = [];
    var COURSE_TEE_LIST = [];
    var SEEN_BIRDIES_STORAGE_KEY = "";

    // Build an exact-Par course shell from COURSE_MANIFEST or saved config.coursePars if courses/<key>.js fails in a dead zone
    function buildFallbackCourseShell(courseKey, cfgObj) {
      var meta = (typeof getCourseManifestEntry === "function" && courseKey) ? getCourseManifestEntry(courseKey) : null;
      var pars = (meta && Array.isArray(meta.pars) && meta.pars.length === 18)
        ? meta.pars
        : ((cfgObj && Array.isArray(cfgObj.coursePars) && cfgObj.coursePars.length === 18) ? cfgObj.coursePars : null);
      var cName = (meta && meta.name) || (cfgObj && cfgObj.courseName) || "";
      var cCity = (meta && meta.city) || "";
      var holesShell = [];
      if (pars) {
        for (var i = 0; i < 18; i++) {
          holesShell.push({ hole: i + 1, par: Number(pars[i]) || 4, hdcp: i + 1 });
        }
      }
      var parSum = pars ? pars.reduce(function (s, p) { return s + (Number(p) || 4); }, 0) : 72;
      return {
        key: courseKey || "",
        name: cName,
        heroVenue: cName ? (cName + " · Par " + parSum) : "",
        address: cCity ? (cCity + ", CA") : "",
        longDriveHoles: (meta && meta.longDriveHoles) || [],
        nearPinHoles: (meta && meta.nearPinHoles) || [],
        defaultTeeKey: "white",
        teeList: [],
        holes: holesShell,
        isFallbackShell: true
      };
    }

    function rebuildActiveCourseVars(cfgSource, sheetScopeOpt) {
      if (sheetScopeOpt) {
        ACTIVE_TOURNAMENT_SCOPE = String(sheetScopeOpt);
        try { localStorage.setItem(CACHED_SCOPE_KEY, ACTIVE_TOURNAMENT_SCOPE); } catch (e) { }
      }
      var nextCfg = cfgSource || T_CFG || {};
      T_CFG = nextCfg;
      var reqKey = (typeof normalizeCourseKey === "function") ? normalizeCourseKey(nextCfg.courseKey) : String(nextCfg.courseKey || "").trim();
      if (reqKey && typeof restoreCourseFromLocalCache === "function") {
        restoreCourseFromLocalCache(reqKey);
      }
      SELECTED_COURSE_KEY = reqKey;
      BASE_COURSE = (reqKey && ALL_COURSES[reqKey]) ? ALL_COURSES[reqKey] : buildFallbackCourseShell(reqKey, nextCfg);
      ACTIVE_COURSE = {};
      for (var ck in BASE_COURSE) {
        if (Object.prototype.hasOwnProperty.call(BASE_COURSE, ck)) ACTIVE_COURSE[ck] = BASE_COURSE[ck];
      }
      for (var tk in nextCfg) {
        if (Object.prototype.hasOwnProperty.call(nextCfg, tk) && nextCfg[tk] !== undefined) {
          ACTIVE_COURSE[tk] = nextCfg[tk];
        }
      }
      longDriveHoles = ACTIVE_COURSE.longDriveHoles || [];
      nearPinHoles = ACTIVE_COURSE.nearPinHoles || [];
      COURSE_DATA = ACTIVE_COURSE.holes || [];
      COURSE_TEE_LIST = ACTIVE_COURSE.teeList || [];
      var scopeSuffix = ACTIVE_TOURNAMENT_SCOPE || nextCfg.tournamentId || SELECTED_COURSE_KEY;
      SEEN_BIRDIES_STORAGE_KEY = "seen_birdies_v2_" + scopeSuffix;
      if (ACTIVE_COURSE.heroTitle || ACTIVE_COURSE.tournamentTitle) {
        document.title = String(ACTIVE_COURSE.heroTitle || ACTIVE_COURSE.tournamentTitle).replace(/^[⛳🏆🎯\s]+/, "").trim();
      }
      if (typeof hmState !== "undefined" && hmState && !hmState.open) {
        hmState.teeKey = ACTIVE_COURSE.defaultTeeKey || "white";
      }
    }

    rebuildActiveCourseVars(T_CFG, ACTIVE_TOURNAMENT_SCOPE);

    // Automatically prepend Google Maps pin icon to map links (e.g. after-party address)
    function addGmapsPinToMapLinks(rootEl) {
      if (!rootEl) return;
      var links = rootEl.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var href = String(links[i].getAttribute("href") || "");
        if (!/maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(href)) continue;
        if (links[i].querySelector(".gmaps-pin")) continue;
        var pin = document.createElement("span");
        pin.className = "gmaps-pin";
        pin.setAttribute("aria-hidden", "true");
        links[i].insertBefore(pin, links[i].firstChild);
      }
    }

    function applyCourseConfigUI() {
      if (ACTIVE_COURSE.tournamentTitle) {
        var topTitleEl = document.getElementById("topTitleText");
        if (topTitleEl) topTitleEl.innerText = ACTIVE_COURSE.tournamentTitle;
      }
      var heroImgEl = document.getElementById("heroImgEl");
      if (heroImgEl) {
        heroImgEl.src = "images/hero_hills.jpg";
        if (ACTIVE_COURSE.heroVenue) heroImgEl.alt = ACTIVE_COURSE.heroVenue;
      }
      var heroVenueEl = document.getElementById("heroVenueEl");
      if (heroVenueEl && ACTIVE_COURSE.heroVenue) heroVenueEl.innerText = ACTIVE_COURSE.heroVenue;
      var heroTitleEl = document.getElementById("heroTitleEl");
      if (heroTitleEl && ACTIVE_COURSE.heroTitle) heroTitleEl.innerText = ACTIVE_COURSE.heroTitle;
      var heroDescEl = document.getElementById("heroDescEl");
      if (heroDescEl) {
        heroDescEl.innerText = ACTIVE_COURSE.heroDesc || "";
        heroDescEl.style.display = ACTIVE_COURSE.heroDesc ? "block" : "none";
      }
      var heroAddrEl = document.getElementById("heroAddrEl");
      if (heroAddrEl) {
        if (ACTIVE_COURSE.address) {
          var mapQuery = (ACTIVE_COURSE.name ? ACTIVE_COURSE.name + ", " : "") + ACTIVE_COURSE.address;
          var mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery);
          heroAddrEl.innerHTML = "<a href=\"" + mapUrl + "\" target=\"_blank\" rel=\"noopener\">" +
            "<span class=\"gmaps-pin\" aria-hidden=\"true\"></span><span class=\"hero-addr-text\"></span></a>";
          heroAddrEl.querySelector(".hero-addr-text").textContent = ACTIVE_COURSE.address;
          heroAddrEl.style.display = "block";
        } else {
          heroAddrEl.style.display = "none";
        }
      }
      var noticeTitleEl = document.getElementById("noticeTitleEl");
      if (noticeTitleEl) noticeTitleEl.innerText = ACTIVE_COURSE.noticeTitle || "📢 경기 진행 안내";
      var noticeLeadEl = document.getElementById("noticeLeadEl");
      var noticeListEl = document.getElementById("noticeListEl");
      if (ACTIVE_COURSE.noticeBodyHtml !== undefined) {
        if (noticeLeadEl) {
          noticeLeadEl.innerHTML = ACTIVE_COURSE.noticeBodyHtml || "";
          noticeLeadEl.style.display = ACTIVE_COURSE.noticeBodyHtml ? "block" : "none";
        }
        if (noticeListEl) {
          noticeListEl.innerHTML = "";
          noticeListEl.style.display = "none";
        }
      } else {
        if (noticeLeadEl) {
          noticeLeadEl.innerHTML = ACTIVE_COURSE.noticeLeadHtml || "";
          noticeLeadEl.style.display = ACTIVE_COURSE.noticeLeadHtml ? "block" : "none";
        }
        if (noticeListEl) {
          var nItems = Array.isArray(ACTIVE_COURSE.noticeItems) ? ACTIVE_COURSE.noticeItems : [];
          noticeListEl.innerHTML = nItems.map(function (itemHtml) {
            return "<div class=\"notice-item\"><span class=\"notice-chk\">✔</span><span>" + itemHtml + "</span></div>";
          }).join("");
          noticeListEl.style.display = nItems.length > 0 ? "block" : "none";
        }
      }
      var quickTeeTitleEl = document.getElementById("quickTeeTitleEl");
      if (quickTeeTitleEl) {
        quickTeeTitleEl.innerText = ACTIVE_COURSE.teeBannerTitle || "";
        quickTeeTitleEl.style.display = ACTIVE_COURSE.teeBannerTitle ? "block" : "none";
      }
      var quickTeeSubEl = document.getElementById("quickTeeSubEl");
      if (quickTeeSubEl) {
        quickTeeSubEl.innerHTML = ACTIVE_COURSE.teeBannerSubHtml || "";
        quickTeeSubEl.style.display = ACTIVE_COURSE.teeBannerSubHtml ? "block" : "none";
      }
      var quickEventMainLineEl = document.getElementById("quickEventMainLineEl");
      if (quickEventMainLineEl) {
        var evParts = [];
        if (longDriveHoles.length > 0) evParts.push("장타: " + longDriveHoles.join(", ") + "번홀");
        if (nearPinHoles.length > 0) evParts.push("니어: " + nearPinHoles.join(", ") + "홀");
        quickEventMainLineEl.innerText = evParts.join(", ");
        quickEventMainLineEl.style.display = evParts.length > 0 ? "block" : "none";
      }
      var quickEventSubEl = document.getElementById("quickEventSubEl");
      if (quickEventSubEl) {
        quickEventSubEl.innerHTML = ACTIVE_COURSE.eventBannerSubHtml || "";
        quickEventSubEl.style.display = ACTIVE_COURSE.eventBannerSubHtml ? "block" : "none";
      }
      var quickAfterPartyEl = document.getElementById("quickAfterPartyEl");
      if (quickAfterPartyEl) {
        if (ACTIVE_COURSE.afterPartyHtml) {
          quickAfterPartyEl.innerHTML = ACTIVE_COURSE.afterPartyHtml;
          addGmapsPinToMapLinks(quickAfterPartyEl);
          quickAfterPartyEl.style.display = "block";
        } else {
          quickAfterPartyEl.style.display = "none";
        }
      }
      var appCopyrightEl = document.getElementById("appCopyrightEl");
      if (appCopyrightEl) {
        appCopyrightEl.innerHTML = ACTIVE_COURSE.copyrightHtml || "";
        appCopyrightEl.style.display = ACTIVE_COURSE.copyrightHtml ? "block" : "none";
        fitCopyrightOneLine();
      }
      if (COURSE_TEE_LIST.length > 0) {
        var defKey = ACTIVE_COURSE.defaultTeeKey || COURSE_TEE_LIST[0].key;
        var defTee = COURSE_TEE_LIST[0];
        for (var i = 0; i < COURSE_TEE_LIST.length; i++) {
          if (COURSE_TEE_LIST[i].key === defKey) {
            defTee = COURSE_TEE_LIST[i];
            break;
          }
        }
        var hmTeeBtnEl = document.getElementById("hmTeeBtn");
        if (hmTeeBtnEl && defTee.btnText) hmTeeBtnEl.innerText = defTee.btnText;
        var hmTotalYdsEl = document.getElementById("hmTotalYds");
        if (hmTotalYdsEl && defTee.yds && defTee.yds.length > 0) {
          hmTotalYdsEl.innerText = "전장: " + defTee.yds[0] + " yds";
        }
      }
    }

    // Auto-shrink copyright font size (down to 8px) so it fits on a single line on narrow phones
    function fitCopyrightOneLine() {
      var el = document.getElementById("appCopyrightEl");
      if (!el || el.style.display === "none") return;
      var size = 10.5;
      el.style.fontSize = size + "px";
      if (!el.clientWidth) return;
      while (el.scrollWidth > el.clientWidth && size > 8) {
        size -= 0.25;
        el.style.fontSize = size + "px";
      }
    }
    window.addEventListener("resize", fitCopyrightOneLine);
    window.addEventListener("orientationchange", fitCopyrightOneLine);

    // Warm boot: only reveal hero/notice immediately if BOTH tournament config AND exact course geometry are already cached in localStorage
    if (HAS_SLUG_CACHED_CFG && T_CFG && T_CFG.courseKey) {
      if (typeof isFullCourseLoaded === "function" && isFullCourseLoaded(T_CFG.courseKey)) {
        rebuildActiveCourseVars(T_CFG, ACTIVE_TOURNAMENT_SCOPE);
        applyCourseConfigUI();
        var hc = document.querySelector(".golf-hero-card");
        var nc = document.querySelector(".notice-card");
        if (hc) hc.style.display = "";
        if (nc) nc.style.display = "";
      } else if (typeof ensureCourseLoaded === "function") {
        ensureCourseLoaded(T_CFG.courseKey, function (loadedCourse) {
          if (loadedCourse) {
            rebuildActiveCourseVars(T_CFG, ACTIVE_TOURNAMENT_SCOPE);
            applyCourseConfigUI();
            var hc2 = document.querySelector(".golf-hero-card");
            var nc2 = document.querySelector(".notice-card");
            if (hc2) hc2.style.display = "";
            if (nc2) nc2.style.display = "";
          }
        });
      }
    }

