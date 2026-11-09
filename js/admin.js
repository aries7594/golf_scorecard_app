    var PIN_STORAGE_KEY = "golf_master_pin_v2";
    var AUTH_TOKEN_KEY = "golf_organizer_session_token_v1";
    var AUTH_EMAIL_KEY = "golf_organizer_email_v1";
    var currentAuthMode = "login"; // "login" | "register"
    var currentAuthToken = "";
    var currentAuthEmail = "";
    var editingExistingSlug = "";
    var editingExistingTitle = "";
    var editorGroups = [];
    var toastTimer = null;

    var TEE_KOR_LABELS = {
      white: "화이트티",
      blue: "블루티",
      black: "블랙티",
      gold: "골드티",
      red: "레드티"
    };

    function getSavedMasterPin() {
      try {
        var p = localStorage.getItem(PIN_STORAGE_KEY);
        if (p && p.trim()) return p.trim();
      } catch (e) { }
      return "2026";
    }

    function setSavedMasterPin(pin) {
      try { localStorage.setItem(PIN_STORAGE_KEY, String(pin || "").trim()); } catch (e) { }
    }

    function getAppBaseDirUrl() {
      var loc = window.location.href.split("?")[0].split("#")[0];
      return loc.replace(/\/admin\.html$/i, "/").replace(/\/?$/, "/");
    }

    function buildParticipantUrl(slug) {
      return getAppBaseDirUrl() + "?t=" + encodeURIComponent(slug);
    }

    function showToast(msg, ms) {
      var el = document.getElementById("toast");
      el.textContent = msg;
      el.style.display = "block";
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        el.style.display = "none";
      }, ms || 3500);
    }

    function escapeHtmlText(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function copyTextById(elId, label) {
      var txt = (document.getElementById(elId).textContent || "").trim();
      if (!txt) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          showToast("📋 " + label + "가 복사되었습니다!\n" + txt);
        });
      } else {
        prompt(label + " 복사:", txt);
      }
    }

    function getApiUrl() {
      try {
        var params = new URLSearchParams(window.location.search || "");
        var qApi = (params.get("api") || "").trim();
        if (qApi) return qApi;
      } catch (e) { }
      if (typeof GAS_BACKEND_URL === "string" && GAS_BACKEND_URL.trim()) {
        return GAS_BACKEND_URL.trim();
      }
      return "";
    }

    function callRawBackend(fnName, argsArr) {
      var url = getApiUrl();
      if (!url) {
        return Promise.reject(new Error("TournamentConfig.js에 GAS_BACKEND_URL이 설정되지 않았습니다."));
      }
      return fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ fn: fnName, args: argsArr || [] })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) return res.data;
          throw new Error((res && res.error) ? String(res.error) : "서버 오류");
        });
    }

    function callAdminApiWithPin(fnName, buildArgsFn) {
      var cred = currentAuthToken || getSavedMasterPin();
      return callRawBackend(fnName, buildArgsFn(cred)).catch(function (err) {
        var msg = String((err && err.message) || err || "");
        if (msg.indexOf("세션이 만료") !== -1 || msg.indexOf("세션이 유효하지") !== -1 || msg.indexOf("서명이 올바르지") !== -1) {
          logoutOrganizer("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
        }
        throw err;
      });
    }

    function switchAuthMode(mode, noticeTextOpt) {
      currentAuthMode = (mode === "register") ? "register" : "login";
      var tabLogin = document.getElementById("authTabLogin");
      var tabReg = document.getElementById("authTabRegister");
      var confirmField = document.getElementById("authConfirmField");
      var pwLabel = document.getElementById("authPasswordLabel");
      var submitBtn = document.getElementById("authSubmitBtn");
      var switchHint = document.getElementById("authSwitchHint");
      var noticeEl = document.getElementById("authNoticeBanner");
      var errEl = document.getElementById("authErrorBanner");

      if (errEl) errEl.style.display = "none";
      if (noticeEl) {
        if (noticeTextOpt) {
          noticeEl.textContent = noticeTextOpt;
          noticeEl.style.display = "block";
        } else {
          noticeEl.style.display = "none";
        }
      }

      if (currentAuthMode === "register") {
        if (tabLogin) tabLogin.classList.remove("active");
        if (tabReg) tabReg.classList.add("active");
        if (confirmField) confirmField.style.display = "block";
        if (pwLabel) pwLabel.textContent = "새 비밀번호 설정 (4자 이상)";
        if (submitBtn) submitBtn.textContent = "✨ 새 사용자 등록 및 시작하기";
        if (switchHint) switchHint.innerHTML = '이미 등록된 계정이 있으신가요? <a onclick="switchAuthMode(\'login\')">로그인 화면으로 이동</a>';
      } else {
        if (tabLogin) tabLogin.classList.add("active");
        if (tabReg) tabReg.classList.remove("active");
        if (confirmField) confirmField.style.display = "none";
        if (pwLabel) pwLabel.textContent = "비밀번호";
        if (submitBtn) submitBtn.textContent = "🔐 로그인";
        if (switchHint) switchHint.innerHTML = '처음 방문하셨나요? <a onclick="switchAuthMode(\'register\')">새 사용자 비밀번호 등록하기</a>';
      }
    }

    function showAuthError(msg) {
      var errEl = document.getElementById("authErrorBanner");
      if (!errEl) return;
      errEl.textContent = "⚠️ " + msg;
      errEl.style.display = "block";
    }

    function enterAuthenticatedAdmin(email, token) {
      currentAuthEmail = String(email || "").trim().toLowerCase();
      currentAuthToken = String(token || "").trim();
      try {
        sessionStorage.setItem(AUTH_TOKEN_KEY, currentAuthToken);
        sessionStorage.setItem(AUTH_EMAIL_KEY, currentAuthEmail);
      } catch (e) { }

      var gate = document.getElementById("authGateScreen");
      var appBox = document.getElementById("adminAppContainer");
      var pill = document.getElementById("loggedInUserEmailPill");
      var viewerBadge = document.getElementById("sheetViewerEmailBadge");
      if (gate) gate.style.display = "none";
      if (appBox) appBox.style.display = "block";
      if (pill) pill.textContent = "👤 " + currentAuthEmail;
      if (viewerBadge) viewerBadge.textContent = "🔒 열람 권한: " + currentAuthEmail + " (Viewer 전용)";
      startFreshTournamentForm();
    }

    function logoutOrganizer(optionalNotice) {
      currentAuthToken = "";
      currentAuthEmail = "";
      editingExistingSlug = "";
      editingExistingTitle = "";
      try {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_EMAIL_KEY);
      } catch (e) { }
      var gate = document.getElementById("authGateScreen");
      var appBox = document.getElementById("adminAppContainer");
      if (appBox) appBox.style.display = "none";
      if (gate) gate.style.display = "flex";
      document.getElementById("authPasswordInput").value = "";
      document.getElementById("authPasswordConfirmInput").value = "";
      switchAuthMode("login", optionalNotice || "");
    }

    function submitAuthForm(ev) {
      if (ev) ev.preventDefault();
      var email = String(document.getElementById("authEmailInput").value || "").trim().toLowerCase();
      var pw = String(document.getElementById("authPasswordInput").value || "");
      var confirmPw = String(document.getElementById("authPasswordConfirmInput").value || "");
      var submitBtn = document.getElementById("authSubmitBtn");
      var errEl = document.getElementById("authErrorBanner");
      if (errEl) errEl.style.display = "none";

      if (!email || email.indexOf("@") === -1) {
        showAuthError("올바른 이메일 주소를 입력해주세요.");
        return false;
      }
      if (pw.length < 4) {
        showAuthError("비밀번호를 4자 이상 입력해주세요.");
        return false;
      }

      if (currentAuthMode === "register") {
        if (pw !== confirmPw) {
          showAuthError("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
          document.getElementById("authPasswordConfirmInput").focus();
          return false;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "⏳ 계정 등록 중...";
        callRawBackend("authRegisterUser", [email, pw])
          .then(function (res) {
            enterAuthenticatedAdmin(res.email, res.token);
            showToast("🎉 새 계정이 등록되었습니다! 환영합니다 (" + res.email + ")");
          })
          .catch(function (err) {
            showAuthError(err.message || "계정 등록 중 오류가 발생했습니다.");
          })
          .finally(function () {
            submitBtn.disabled = false;
            if (currentAuthMode === "register") submitBtn.textContent = "✨ 새 사용자 등록 및 시작하기";
          });
        return false;
      }

      // Login mode: if email is unregistered, seamlessly transition to New-User Registration!
      submitBtn.disabled = true;
      submitBtn.textContent = "⏳ 확인 중...";
      callRawBackend("authLoginUser", [email, pw])
        .then(function (res) {
          if (res && res.status === "NEW_USER_NEEDS_REGISTER") {
            switchAuthMode(
              "register",
              "✨ 처음 방문하신 새 이메일(" + email + ")입니다! 비밀번호 확인을 한 번 더 입력해 새 사용자로 등록해 주세요."
            );
            document.getElementById("authPasswordConfirmInput").value = "";
            document.getElementById("authPasswordConfirmInput").focus();
            return;
          }
          enterAuthenticatedAdmin(res.email, res.token);
          showToast("👋 환영합니다! (" + res.email + ")");
        })
        .catch(function (err) {
          showAuthError(err.message || "로그인에 실패했습니다.");
        })
        .finally(function () {
          submitBtn.disabled = false;
          if (currentAuthMode === "login") submitBtn.textContent = "🔐 로그인";
          else submitBtn.textContent = "✨ 새 사용자 등록 및 시작하기";
        });
      return false;
    }

    // Google Docs-style Rich Text Editor Commands
    function execDocCmd(cmd, val) {
      var ed = document.getElementById("noticeRichEditor");
      ed.focus();
      try {
        document.execCommand("styleWithCSS", false, true);
      } catch (e) { }
      document.execCommand(cmd, false, val !== undefined ? val : null);
    }

    function applyDocFontSize(sizeVal) {
      execDocCmd("fontSize", sizeVal);
    }

    function clearNoticeEditor() {
      var ed = document.getElementById("noticeRichEditor");
      ed.innerHTML = "";
      ed.focus();
    }

    function insertSampleNoticeBody() {
      var ed = document.getElementById("noticeRichEditor");
      ed.innerHTML =
        '<ul>' +
        '<li>버디는 -1, 파는 0, 보기는 1, 이런 식으로 스코어카드 작성해주세요.</li>' +
        '<li>모든 홀에서 더블파 이상인경우 더블파점수를 적습니다.</li>' +
        '<li>컨시드' +
          '<ul>' +
            '<li>퍼터 길이 (34 inch) 보다 짧은 거리는 상대방의 허락이 없이도 컨시드를 받을수 있습니다.</li>' +
            '<li>퍼터 길이에 걸친 애매한 거리는 상대방이 컨시드를 줄수 있습니다.</li>' +
          '</ul>' +
        '</li>' +
        '<li>OB 와 Lost Ball' +
          '<ul>' +
            '<li>1 벌타후 없어졌다고 생각하는 지점의 경계에서 두클럽이내 드랍</li>' +
          '</ul>' +
        '</li>' +
        '<li>윈터룰을 적용하여, 볼이 있는 곳의 페어웨이 상태가 좋지않을 경우, 두클럽 이내에서 옮겨서 칠 수 있습니다.</li>' +
        '<li>로컬룰에 명시되지 않은 룰은 USGA Golf Rule 에 따라주시기 바랍니다.</li>' +
        '</ul>';
      showToast("📄 기본 예시문을 불러왔습니다. 자유롭게 수정하세요!");
    }

    // Support Tab / Shift+Tab inside rich editor to indent / outdent sub-bullets like Google Docs
    document.getElementById("noticeRichEditor").addEventListener("keydown", function (ev) {
      if (ev.key === "Tab") {
        ev.preventDefault();
        execDocCmd(ev.shiftKey ? "outdent" : "indent");
      }
    });

    function getCleanedEditorHtml() {
      var ed = document.getElementById("noticeRichEditor");
      var raw = (ed.innerHTML || "").trim();
      var plain = (ed.textContent || "").trim();
      if (!plain) return "";
      return raw;
    }

    // Synchronize Section 3 footer lines dynamically from Section 1 selections
    function syncGuideFooterUI() {
      var mTee = document.getElementById("menTeeSelect").value;
      var wTee = document.getElementById("womenTeeSelect").value;
      var teeStatic = document.getElementById("guideTeeStaticText");
      var teeCustomWrap = document.getElementById("guideTeeCustomWrap");

      if (mTee || wTee) {
        var teeParts = [];
        if (mTee && TEE_KOR_LABELS[mTee]) teeParts.push("남성:" + TEE_KOR_LABELS[mTee]);
        if (wTee && TEE_KOR_LABELS[wTee]) teeParts.push("여성:" + TEE_KOR_LABELS[wTee]);
        teeStatic.textContent = teeParts.join(", ");
        teeStatic.style.display = "inline";
        teeCustomWrap.style.display = "none";
      } else {
        teeStatic.style.display = "none";
        teeCustomWrap.style.display = "inline-flex";
      }

      var longList = parseIntList(document.getElementById("longHolesInput").value);
      var nearList = parseIntList(document.getElementById("nearHolesInput").value);
      var longStatic = document.getElementById("guideLongStaticPart");
      var longInputWrap = document.getElementById("guideLongInputPart");
      var nearStatic = document.getElementById("guideNearStaticPart");
      var nearInputWrap = document.getElementById("guideNearInputPart");
      var sec3Long = document.getElementById("sec3LongInput");
      var sec3Near = document.getElementById("sec3NearInput");

      if (longList.length > 0 && document.activeElement !== sec3Long) {
        longStatic.textContent = "장타: " + longList.join(",") + "번홀";
        longStatic.style.display = "inline";
        longInputWrap.style.display = "none";
        sec3Long.value = longList.join(", ");
      } else if (longList.length === 0) {
        longStatic.style.display = "none";
        longInputWrap.style.display = "inline-flex";
        if (document.activeElement !== sec3Long) sec3Long.value = "";
      }

      if (nearList.length > 0 && document.activeElement !== sec3Near) {
        nearStatic.textContent = "니어: " + nearList.join(",") + "홀";
        nearStatic.style.display = "inline";
        nearInputWrap.style.display = "none";
        sec3Near.value = nearList.join(", ");
      } else if (nearList.length === 0) {
        nearStatic.style.display = "none";
        nearInputWrap.style.display = "inline-flex";
        if (document.activeElement !== sec3Near) sec3Near.value = "";
      }
    }

    function onSec3EventTyping(kind, val) {
      if (kind === "long") {
        document.getElementById("longHolesInput").value = val;
      } else {
        document.getElementById("nearHolesInput").value = val;
      }
    }

    function refreshEditingModeUI() {
      var banner = document.getElementById("pageModeBanner");
      var backNewBtn = document.getElementById("backToNewBtn");
      var createBtn = document.getElementById("createSheetBtn");
      var saveCfgBtn = document.getElementById("saveConfigOnlyBtn");
      var resetBtn = document.getElementById("resetScoresBtn");
      var badge = document.getElementById("editingStateBadge");
      var secTitle = document.getElementById("formSectionTitle");

      if (editingExistingSlug) {
        banner.textContent = "⛳ " + (editingExistingTitle || editingExistingSlug);
        banner.classList.add("is-existing");
        backNewBtn.style.display = "inline-flex";
        badge.textContent = "저장된 대회 조회·수정 모드 (?t=" + editingExistingSlug + ")";
        badge.style.background = "#e0f2fe";
        badge.style.color = "#0369a1";
        badge.style.borderColor = "#7dd3fc";
        secTitle.textContent = "① 대회 정보 확인 및 수정";
        createBtn.style.display = "none";
        saveCfgBtn.style.display = "inline-flex";
        saveCfgBtn.textContent = "💾 변경사항 저장";
        resetBtn.style.display = "inline-flex";
      } else {
        banner.textContent = "신규 대회 생성";
        banner.classList.remove("is-existing");
        backNewBtn.style.display = "none";
        badge.textContent = "신규 대회 개설 모드 (코드 자동생성)";
        badge.style.background = "#fff0f3";
        badge.style.color = "#800020";
        badge.style.borderColor = "#f5c2cb";
        secTitle.textContent = "① 대회 기본 정보 설정";
        createBtn.style.display = "inline-flex";
        createBtn.textContent = "🚀 새 대회 구글 시트 자동 생성 & 전용 링크 발급";
        saveCfgBtn.style.display = "none";
        resetBtn.style.display = "none";
      }
    }

    function showIssuedLinksBanner(slug, resultsUrl, sheetTitle) {
      var box = document.getElementById("issuedLinksBox");
      var pUrl = buildParticipantUrl(slug);
      document.getElementById("issuedBannerTitle").textContent =
        "✅ [" + (sheetTitle || slug) + "] 대회 전용 링크 및 구글 시트";
      document.getElementById("participantShareUrlText").textContent = pUrl;
      document.getElementById("participantShareOpenBtn").href = pUrl;
      document.getElementById("sheetResultUrlText").textContent = resultsUrl || "";
      document.getElementById("sheetResultOpenBtn").href = resultsUrl || "#";
      var viewerBadge = document.getElementById("sheetViewerEmailBadge");
      if (viewerBadge && currentAuthEmail) {
        viewerBadge.textContent = "🔒 열람 권한: " + currentAuthEmail + " 계정에만 Viewer 권한 부여됨";
      }
      box.style.display = "flex";
    }

    function parseIntList(str) {
      return String(str || "")
        .split(/[,\s]+/)
        .map(function (s) { return parseInt(s, 10); })
        .filter(function (n) { return !isNaN(n) && n >= 1 && n <= 18; });
    }

    function getAllManifestCourses() {
      if (typeof COURSE_MANIFEST !== "undefined" && Array.isArray(COURSE_MANIFEST) && COURSE_MANIFEST.length > 0) {
        return COURSE_MANIFEST;
      }
      var catalog = (typeof COURSE_CATALOG !== "undefined" && COURSE_CATALOG) ? COURSE_CATALOG : {};
      var fallback = [];
      var seen = {};
      Object.keys(catalog).forEach(function (k) {
        var c = catalog[k];
        if (!c || !c.key || seen[c.key]) return;
        seen[c.key] = true;
        fallback.push({
          key: c.key,
          name: c.name || c.key,
          city: c.city || "",
          region: c.region || "NorCal",
          parTotal: Array.isArray(c.holes) ? c.holes.reduce(function (s, h) { return s + (Number(h.par) || 4); }, 0) : 72,
          pars: Array.isArray(c.holes) ? c.holes.map(function (h) { return Number(h.par) || 4; }) : [],
          longDriveHoles: c.longDriveHoles || [],
          nearPinHoles: c.nearPinHoles || []
        });
      });
      return fallback;
    }

    var courseComboKbIndex = -1;
    var courseComboFilteredKeys = [];

    function formatCourseDisplayLabel(c) {
      if (!c) return "";
      var locPart = c.city ? (" — " + c.city) : "";
      var parPart = c.parTotal ? (" · Par " + c.parTotal) : "";
      return (c.name || c.key) + locPart + parPart;
    }

    function syncCourseInputWithSelected() {
      var sel = document.getElementById("courseSelect");
      var inp = document.getElementById("courseSearchInput");
      if (!sel || !inp) return;
      var allList = getAllManifestCourses();
      var curKey = (typeof normalizeCourseKey === "function") ? normalizeCourseKey(sel.value) : sel.value;
      for (var i = 0; i < allList.length; i++) {
        if (allList[i].key === curKey) {
          inp.value = formatCourseDisplayLabel(allList[i]);
          return;
        }
      }
    }

    function populateCourseDropdown(filterTextOpt, keepValueOpt) {
      var sel = document.getElementById("courseSelect");
      var prevVal = keepValueOpt !== undefined ? keepValueOpt : sel.value;
      var allList = getAllManifestCourses();
      sel.innerHTML = "";
      allList.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.key;
        opt.textContent = formatCourseDisplayLabel(c);
        sel.appendChild(opt);
      });
      var normPrev = (typeof normalizeCourseKey === "function") ? normalizeCourseKey(prevVal) : prevVal;
      var exists = allList.some(function (c) { return c.key === normPrev; });
      sel.value = exists ? normPrev : (allList[0] ? allList[0].key : "");
      renderCourseComboMenu(filterTextOpt || "");
      if (!filterTextOpt) {
        syncCourseInputWithSelected();
      }
    }

    function renderCourseComboMenu(rawQuery) {
      var menu = document.getElementById("courseComboMenu");
      var hintEl = document.getElementById("courseCountHint");
      var sel = document.getElementById("courseSelect");
      if (!menu || !sel) return;

      var allList = getAllManifestCourses();
      var q = String(rawQuery || "").trim().toLowerCase();
      var filtered = allList.filter(function (c) {
        if (!q) return true;
        var blob = ((c.name || "") + " " + (c.city || "") + " " + (c.key || "") + " " + (c.region || "")).toLowerCase();
        return blob.indexOf(q) !== -1;
      });

      if (hintEl) {
        hintEl.textContent = q
          ? ("검색 결과 " + filtered.length + "개 / 전체 " + allList.length + "개")
          : ("캘리포니아 " + allList.length + "개 코스 지원");
      }

      menu.innerHTML = "";
      courseComboFilteredKeys = [];
      courseComboKbIndex = -1;

      if (filtered.length === 0) {
        var emptyDiv = document.createElement("div");
        emptyDiv.className = "course-combo-empty";
        emptyDiv.textContent = "'" + rawQuery + "' 검색 결과가 없습니다. (영문 골프장 이름 또는 도시명 입력)";
        menu.appendChild(emptyDiv);
        return;
      }

      var curKey = sel.value;
      var norcal = filtered.filter(function (c) { return c.region !== "SoCal"; });
      var socal = filtered.filter(function (c) { return c.region === "SoCal"; });

      function appendGroup(title, items) {
        if (items.length === 0) return;
        var hdr = document.createElement("div");
        hdr.className = "course-combo-group-hdr";
        hdr.textContent = title + " (" + items.length + "개)";
        menu.appendChild(hdr);

        items.forEach(function (c) {
          var idx = courseComboFilteredKeys.length;
          courseComboFilteredKeys.push(c.key);
          var row = document.createElement("div");
          row.className = "course-combo-item" + (c.key === curKey ? " selected-course" : "");
          row.setAttribute("data-key", c.key);
          row.setAttribute("data-idx", String(idx));

          var leftSpan = document.createElement("span");
          leftSpan.textContent = c.name;
          var rightSpan = document.createElement("span");
          rightSpan.className = "course-combo-item-sub";
          rightSpan.textContent = (c.city ? c.city + " · " : "") + "Par " + (c.parTotal || 72);

          row.appendChild(leftSpan);
          row.appendChild(rightSpan);
          row.onmousedown = function (ev) {
            ev.preventDefault();
            selectCourseFromCombo(c.key);
          };
          menu.appendChild(row);
        });
      }

      appendGroup("🌲 북가주 (NorCal)", norcal);
      appendGroup("🌴 남가주 (SoCal)", socal);
    }

    function openCourseComboOnFocus() {
      var inp = document.getElementById("courseSearchInput");
      var menu = document.getElementById("courseComboMenu");
      if (!inp || !menu) return;
      renderCourseComboMenu("");
      menu.classList.add("open");
      setTimeout(function () {
        try { inp.select(); } catch (e) { }
      }, 10);
    }

    function closeCourseComboMenu(restoreLabel) {
      var menu = document.getElementById("courseComboMenu");
      if (menu) menu.classList.remove("open");
      if (restoreLabel) {
        syncCourseInputWithSelected();
        var allList = getAllManifestCourses();
        var hintEl = document.getElementById("courseCountHint");
        if (hintEl) hintEl.textContent = "캘리포니아 " + allList.length + "개 코스 지원";
      }
    }

    function selectCourseFromCombo(courseKey) {
      var sel = document.getElementById("courseSelect");
      if (!sel || !courseKey) return;
      sel.value = courseKey;
      syncCourseInputWithSelected();
      closeCourseComboMenu(true);
      onCourseSelectChange(true);
      var inp = document.getElementById("courseSearchInput");
      if (inp) inp.blur();
    }

    function clearCourseSearchInput(ev) {
      if (ev) ev.preventDefault();
      var inp = document.getElementById("courseSearchInput");
      var menu = document.getElementById("courseComboMenu");
      if (!inp || !menu) return;
      inp.value = "";
      renderCourseComboMenu("");
      menu.classList.add("open");
      inp.focus();
    }

    function onCourseSearchInput(val) {
      var menu = document.getElementById("courseComboMenu");
      renderCourseComboMenu(val);
      if (menu) menu.classList.add("open");
      if (courseComboFilteredKeys.length === 1) {
        var sel = document.getElementById("courseSelect");
        if (sel && sel.value !== courseComboFilteredKeys[0]) {
          sel.value = courseComboFilteredKeys[0];
          onCourseSelectChange(true);
        }
      }
    }

    function onCourseComboKeydown(ev) {
      var menu = document.getElementById("courseComboMenu");
      if (!menu) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (!menu.classList.contains("open")) menu.classList.add("open");
        if (courseComboFilteredKeys.length > 0) {
          courseComboKbIndex = (courseComboKbIndex + 1) % courseComboFilteredKeys.length;
          highlightCourseComboKbRow();
        }
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (courseComboFilteredKeys.length > 0) {
          courseComboKbIndex = (courseComboKbIndex - 1 + courseComboFilteredKeys.length) % courseComboFilteredKeys.length;
          highlightCourseComboKbRow();
        }
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (courseComboKbIndex >= 0 && courseComboFilteredKeys[courseComboKbIndex]) {
          selectCourseFromCombo(courseComboFilteredKeys[courseComboKbIndex]);
        } else if (courseComboFilteredKeys.length > 0) {
          selectCourseFromCombo(courseComboFilteredKeys[0]);
        }
      } else if (ev.key === "Escape") {
        closeCourseComboMenu(true);
      }
    }

    function highlightCourseComboKbRow() {
      var menu = document.getElementById("courseComboMenu");
      if (!menu) return;
      var rows = menu.querySelectorAll(".course-combo-item");
      for (var i = 0; i < rows.length; i++) {
        if (i === courseComboKbIndex) {
          rows[i].classList.add("active-kb");
          rows[i].scrollIntoView({ block: "nearest" });
        } else {
          rows[i].classList.remove("active-kb");
        }
      }
    }

    document.addEventListener("mousedown", function (ev) {
      var wrap = document.getElementById("courseComboWrap");
      if (wrap && !wrap.contains(ev.target)) {
        closeCourseComboMenu(true);
      }
    });

    function getSelectedCourseObj() {
      var rawKey = document.getElementById("courseSelect").value;
      var key = (typeof normalizeCourseKey === "function") ? normalizeCourseKey(rawKey) : rawKey;
      var catalog = (typeof COURSE_CATALOG !== "undefined" && COURSE_CATALOG) ? COURSE_CATALOG : {};
      if (catalog[key]) return catalog[key];
      if (typeof getCourseManifestEntry === "function") {
        var meta = getCourseManifestEntry(key);
        if (meta) return meta;
      }
      var all = getAllManifestCourses();
      return all[0] || {};
    }

    function getSelectedCoursePars() {
      var cObj = getSelectedCourseObj();
      if (Array.isArray(cObj.holes) && cObj.holes.length === 18) {
        return cObj.holes.map(function (h) { return Number(h.par) || 4; });
      }
      if (Array.isArray(cObj.pars) && cObj.pars.length === 18) {
        return cObj.pars.map(function (p) { return Number(p) || 4; });
      }
      return [4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 3, 5, 4, 3, 5, 4, 4, 4];
    }

    function onCourseSelectChange(autoFillIfNew) {
      var cObj = getSelectedCourseObj();
      if (cObj && cObj.key && typeof ensureCourseLoaded === "function") {
        ensureCourseLoaded(cObj.key);
      }
      if (autoFillIfNew && !editingExistingSlug) {
        if (Array.isArray(cObj.longDriveHoles)) {
          document.getElementById("longHolesInput").value = cObj.longDriveHoles.join(", ");
        }
        if (Array.isArray(cObj.nearPinHoles)) {
          document.getElementById("nearHolesInput").value = cObj.nearPinHoles.join(", ");
        }
      }
      syncGuideFooterUI();
    }

    function fillRecommendedEventHoles() {
      var cObj = getSelectedCourseObj();
      if (Array.isArray(cObj.longDriveHoles)) {
        document.getElementById("longHolesInput").value = cObj.longDriveHoles.join(", ");
      }
      if (Array.isArray(cObj.nearPinHoles)) {
        document.getElementById("nearHolesInput").value = cObj.nearPinHoles.join(", ");
      }
      syncGuideFooterUI();
      showToast("선택한 골프장의 추천 장타·니어 홀 번호를 입력했습니다.");
    }

    function normalizeGroupsForEditor(rawGroups) {
      if (!Array.isArray(rawGroups)) return [];
      return rawGroups.map(function (g, idx) {
        var gName = String((g && g.name) || ((idx + 1) + "조")).trim();
        if (gName.indexOf("조") === -1) gName += "조";
        var pList = Array.isArray(g && g.players) ? g.players : [];
        return {
          name: gName,
          players: pList.map(function (p) {
            if (typeof p === "string") return { name: p, handicap: "" };
            return {
              name: String((p && p.name) || "").trim(),
              handicap: (p && p.handicap !== undefined && p.handicap !== null && p.handicap !== "") ? Number(p.handicap) : ""
            };
          })
        };
      });
    }

    function renderGroupsEditor() {
      var grid = document.getElementById("groupsEditorGrid");
      var emptyGuide = document.getElementById("emptyRosterGuide");
      grid.innerHTML = "";

      if (editorGroups.length === 0) {
        grid.style.display = "none";
        emptyGuide.style.display = "block";
        updateRosterBadgeCount();
        return;
      }

      emptyGuide.style.display = "none";
      grid.style.display = "grid";

      editorGroups.forEach(function (grp, gi) {
        var card = document.createElement("div");
        card.className = "group-edit-card";

        var head = document.createElement("div");
        head.className = "group-edit-head";

        var gInput = document.createElement("input");
        gInput.type = "text";
        gInput.value = grp.name;
        gInput.onchange = function () { editorGroups[gi].name = gInput.value.trim() || ((gi + 1) + "조"); };

        var btnWrap = document.createElement("div");
        btnWrap.style.display = "flex";
        btnWrap.style.gap = "4px";

        var addPBtn = document.createElement("button");
        addPBtn.type = "button";
        addPBtn.className = "btn btn-outline btn-sm";
        addPBtn.textContent = "+ 선수";
        addPBtn.onclick = function () {
          editorGroups[gi].players.push({ name: "", handicap: "" });
          renderGroupsEditor();
        };

        var delGBtn = document.createElement("button");
        delGBtn.type = "button";
        delGBtn.className = "btn btn-danger btn-sm";
        delGBtn.textContent = "조 삭제";
        delGBtn.onclick = function () {
          editorGroups.splice(gi, 1);
          renderGroupsEditor();
        };

        btnWrap.appendChild(addPBtn);
        btnWrap.appendChild(delGBtn);
        head.appendChild(gInput);
        head.appendChild(btnWrap);
        card.appendChild(head);

        grp.players.forEach(function (pl, pi) {
          var row = document.createElement("div");
          row.className = "player-row";

          var nameIn = document.createElement("input");
          nameIn.type = "text";
          nameIn.placeholder = "선수 이름";
          nameIn.value = pl.name || "";
          nameIn.oninput = function () {
            editorGroups[gi].players[pi].name = nameIn.value;
            updateRosterBadgeCount();
          };

          var hcpIn = document.createElement("input");
          hcpIn.type = "number";
          hcpIn.placeholder = "핸디";
          hcpIn.value = (pl.handicap !== "" && pl.handicap !== null && pl.handicap !== undefined) ? pl.handicap : "";
          hcpIn.oninput = function () {
            var v = hcpIn.value.trim();
            editorGroups[gi].players[pi].handicap = v === "" ? "" : Number(v);
          };

          var delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "player-del-btn";
          delBtn.title = "선수 삭제";
          delBtn.textContent = "✕";
          delBtn.onclick = function () {
            editorGroups[gi].players.splice(pi, 1);
            renderGroupsEditor();
          };

          row.appendChild(nameIn);
          row.appendChild(hcpIn);
          row.appendChild(delBtn);
          card.appendChild(row);
        });

        grid.appendChild(card);
      });

      updateRosterBadgeCount();
    }

    function updateRosterBadgeCount() {
      var pCount = 0;
      editorGroups.forEach(function (g) {
        (g.players || []).forEach(function (p) {
          if (p && String(p.name || "").trim()) pCount++;
        });
      });
      document.getElementById("rosterCountBadge").textContent = editorGroups.length + "개 조 · " + pCount + "명";
    }

    function addEmptyGroup() {
      var nextNum = editorGroups.length + 1;
      editorGroups.push({
        name: nextNum + "조",
        players: [
          { name: "", handicap: "" },
          { name: "", handicap: "" },
          { name: "", handicap: "" },
          { name: "", handicap: "" }
        ]
      });
      renderGroupsEditor();
    }

    // Parse [Group | Name | Handicap] text copied from Excel / Google Sheets
    function parseRosterTextToGroups(rawText) {
      var lines = String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      var groupsMap = {};
      var groupOrder = [];
      var currentGroup = "";
      var hasExplicitGroup = false;
      var ungroupedPlayers = [];

      function normalizeGroupLabel(rawG) {
        var s = String(rawG || "").trim();
        if (!s) return "";
        if (/^\d+$/.test(s)) return s + "조";
        if (/^\d+\s*조$/.test(s)) return s.replace(/\s+/g, "");
        return s;
      }

      function addPlayerToGroup(gName, pName, hcpRaw) {
        var cleanName = String(pName || "").trim();
        if (!cleanName) return;
        var hcpNum = "";
        var cleanHcp = String(hcpRaw !== undefined && hcpRaw !== null ? hcpRaw : "").replace(/[^0-9.-]/g, "").trim();
        if (cleanHcp !== "" && !isNaN(Number(cleanHcp))) {
          hcpNum = Number(cleanHcp);
        }
        if (!groupsMap[gName]) {
          groupsMap[gName] = [];
          groupOrder.push(gName);
        }
        groupsMap[gName].push({ name: cleanName, handicap: hcpNum });
      }

      var parsedRows = [];
      for (var pIdx = 0; pIdx < lines.length; pIdx++) {
        var rawLine = lines[pIdx];
        if (!rawLine || !rawLine.trim()) continue;
        var cols = rawLine.indexOf("\t") !== -1
          ? rawLine.split("\t")
          : (rawLine.indexOf(",") !== -1 ? rawLine.split(",") : rawLine.trim().split(/\s{2,}|\s+/));
        parsedRows.push(cols.map(function (c) { return String(c || "").trim(); }));
      }

      var minNonEmptyCol = Infinity;
      for (var rCheck = 0; rCheck < parsedRows.length; rCheck++) {
        for (var cCheck = 0; cCheck < parsedRows[rCheck].length; cCheck++) {
          if (parsedRows[rCheck][cCheck] !== "") {
            if (cCheck < minNonEmptyCol) minNonEmptyCol = cCheck;
            break;
          }
        }
      }
      if (minNonEmptyCol > 0 && minNonEmptyCol !== Infinity) {
        parsedRows = parsedRows.map(function (r) { return r.slice(minNonEmptyCol); });
      }

      for (var i = 0; i < parsedRows.length; i++) {
        var trimmedCols = parsedRows[i];
        var joinedHeader = trimmedCols.join("|");
        if (/(^|\|)(이름|성명|선수|name)(\||$)/i.test(joinedHeader) && /(핸디|handicap|hcp|조|team)/i.test(joinedHeader)) {
          continue;
        }

        if (trimmedCols.length >= 3) {
          var gCell = trimmedCols[0];
          var nameCell = trimmedCols[1];
          var hcpCell = trimmedCols[2];
          if (gCell !== "") {
            currentGroup = normalizeGroupLabel(gCell);
            hasExplicitGroup = true;
          }
          if (!nameCell) continue;
          if (currentGroup) {
            addPlayerToGroup(currentGroup, nameCell, hcpCell);
          } else {
            ungroupedPlayers.push({ name: nameCell, handicap: hcpCell });
          }
        } else if (trimmedCols.length === 2) {
          if (/^\d+\s*조?$/.test(trimmedCols[0]) && !/^\d+(\.\d+)?$/.test(trimmedCols[1])) {
            currentGroup = normalizeGroupLabel(trimmedCols[0]);
            hasExplicitGroup = true;
            addPlayerToGroup(currentGroup, trimmedCols[1], "");
          } else if (hasExplicitGroup && currentGroup) {
            addPlayerToGroup(currentGroup, trimmedCols[0], trimmedCols[1]);
          } else {
            ungroupedPlayers.push({ name: trimmedCols[0], handicap: trimmedCols[1] });
          }
        } else if (trimmedCols.length === 1 && trimmedCols[0]) {
          if (/^\d+\s*조$/.test(trimmedCols[0])) {
            currentGroup = normalizeGroupLabel(trimmedCols[0]);
            hasExplicitGroup = true;
          } else if (currentGroup) {
            addPlayerToGroup(currentGroup, trimmedCols[0], "");
          } else {
            ungroupedPlayers.push({ name: trimmedCols[0], handicap: "" });
          }
        }
      }

      if (!hasExplicitGroup && ungroupedPlayers.length > 0) {
        for (var u = 0; u < ungroupedPlayers.length; u++) {
          var autoG = (Math.floor(u / 4) + 1) + "조";
          addPlayerToGroup(autoG, ungroupedPlayers[u].name, ungroupedPlayers[u].handicap);
        }
      }

      return groupOrder.map(function (gName) {
        return { name: gName, players: groupsMap[gName] };
      });
    }

    function applyPastedRoster() {
      var raw = document.getElementById("rosterPasteInput").value;
      var parsed = parseRosterTextToGroups(raw);
      if (parsed.length === 0) {
        showToast("⚠️ 인식된 참석자 명단이 없습니다. 엑셀 표를 붙여넣어 주세요.");
        return;
      }
      editorGroups = parsed;
      renderGroupsEditor();
      var totalP = parsed.reduce(function (s, g) { return s + g.players.length; }, 0);
      showToast("✅ " + parsed.length + "개 조 · 총 " + totalP + "명 명단과 핸디가 세팅되었습니다!");
    }

    // Parse .xlsx files directly in browser using built-in DecompressionStream
    async function parseXlsxFileBuffer(arrayBuffer) {
      var bytes = new Uint8Array(arrayBuffer);
      var view = new DataView(arrayBuffer);
      var files = {};

      var eocdPos = -1;
      for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdPos = i;
          break;
        }
      }
      if (eocdPos < 0) throw new Error("유효한 .xlsx 파일이 아닙니다.");
      var cdEntries = view.getUint16(eocdPos + 10, true);
      var cdOffset = view.getUint32(eocdPos + 16, true);

      var ptr = cdOffset;
      var decoder = new TextDecoder("utf-8");
      for (var e = 0; e < cdEntries; e++) {
        if (view.getUint32(ptr, true) !== 0x02014b50) break;
        var method = view.getUint16(ptr + 10, true);
        var compSize = view.getUint32(ptr + 20, true);
        var nameLen = view.getUint16(ptr + 28, true);
        var extraLen = view.getUint16(ptr + 30, true);
        var commentLen = view.getUint16(ptr + 32, true);
        var localOffset = view.getUint32(ptr + 42, true);
        var name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
        ptr += 46 + nameLen + extraLen + commentLen;

        var lNameLen = view.getUint16(localOffset + 26, true);
        var lExtraLen = view.getUint16(localOffset + 28, true);
        var dataStart = localOffset + 30 + lNameLen + lExtraLen;
        var rawSlice = bytes.subarray(dataStart, dataStart + compSize);

        if (method === 0) {
          files[name] = decoder.decode(rawSlice);
        } else if (method === 8 && typeof DecompressionStream !== "undefined") {
          var ds = new DecompressionStream("deflate-raw");
          var writer = ds.writable.getWriter();
          writer.write(rawSlice);
          writer.close();
          var buf = await new Response(ds.readable).arrayBuffer();
          files[name] = decoder.decode(buf);
        }
      }

      var domParser = new DOMParser();
      var sharedStrings = [];
      if (files["xl/sharedStrings.xml"]) {
        var sstDoc = domParser.parseFromString(files["xl/sharedStrings.xml"], "application/xml");
        var siNodes = sstDoc.getElementsByTagName("si");
        for (var s = 0; s < siNodes.length; s++) {
          var tNodes = siNodes[s].getElementsByTagName("t");
          var acc = "";
          for (var ti = 0; ti < tNodes.length; ti++) acc += tNodes[ti].textContent || "";
          sharedStrings.push(acc);
        }
      }

      var wbDoc = domParser.parseFromString(files["xl/workbook.xml"], "application/xml");
      var relDoc = domParser.parseFromString(files["xl/_rels/workbook.xml.rels"], "application/xml");
      var relMap = {};
      var relNodes = relDoc.getElementsByTagName("Relationship");
      for (var ri = 0; ri < relNodes.length; ri++) {
        relMap[relNodes[ri].getAttribute("Id")] = "xl/" + relNodes[ri].getAttribute("Target").replace(/^\/+/, "");
      }

      function extractSheetMatrix(xmlText) {
        var doc = domParser.parseFromString(xmlText, "application/xml");
        var rowNodes = doc.getElementsByTagName("row");
        var matrix = [];
        for (var r = 0; r < rowNodes.length; r++) {
          var cNodes = rowNodes[r].getElementsByTagName("c");
          var rowArr = [];
          for (var c = 0; c < cNodes.length; c++) {
            var ref = cNodes[c].getAttribute("r") || "";
            var colLetters = ref.replace(/[0-9]/g, "");
            var colIdx = 0;
            for (var ci = 0; ci < colLetters.length; ci++) {
              colIdx = colIdx * 26 + (colLetters.charCodeAt(ci) - 64);
            }
            colIdx = Math.max(0, colIdx - 1);
            var cType = cNodes[c].getAttribute("t") || "";
            var vNode = cNodes[c].getElementsByTagName("v")[0];
            var val = vNode ? vNode.textContent : "";
            if (cType === "s" && val !== "") val = sharedStrings[parseInt(val, 10)] || "";
            while (rowArr.length <= colIdx) rowArr.push("");
            rowArr[colIdx] = val;
          }
          matrix.push(rowArr);
        }
        return matrix;
      }

      var sheetNodes = wbDoc.getElementsByTagName("sheet");
      var groupSheetsFound = [];
      for (var sh = 0; sh < sheetNodes.length; sh++) {
        var shName = sheetNodes[sh].getAttribute("name") || "";
        var rId = sheetNodes[sh].getAttribute("r:id") || sheetNodes[sh].getAttribute("id") || "";
        var targetPath = relMap[rId];
        if (shName.indexOf("조") !== -1 && shName.indexOf("결과") === -1 && files[targetPath]) {
          var mat = extractSheetMatrix(files[targetPath]);
          var pls = [];
          for (var mr = 2; mr < Math.min(mat.length, 10); mr++) {
            var pName = (mat[mr][0] || "").trim();
            if (!pName || pName === "홀파미션" || pName === "메모") {
              if (pName === "홀파미션") break;
              continue;
            }
            var hcpV = mat[mr][20];
            pls.push({ name: pName, handicap: (hcpV !== undefined && hcpV !== "" && !isNaN(Number(hcpV))) ? Number(hcpV) : "" });
          }
          if (pls.length > 0) groupSheetsFound.push({ name: shName, players: pls });
        }
      }
      if (groupSheetsFound.length > 0) return groupSheetsFound;

      var firstRId = sheetNodes[0].getAttribute("r:id") || sheetNodes[0].getAttribute("id");
      var firstMatrix = extractSheetMatrix(files[relMap[firstRId]]);
      var tsvLines = firstMatrix.map(function (r) { return r.join("\t"); }).join("\n");
      document.getElementById("rosterPasteInput").value = tsvLines;
      return parseRosterTextToGroups(tsvLines);
    }

    async function handleRosterFileUpload(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try {
        if (/\.xlsx$/i.test(file.name)) {
          var buf = await file.arrayBuffer();
          var groups = await parseXlsxFileBuffer(buf);
          if (groups.length > 0) {
            editorGroups = groups;
            renderGroupsEditor();
            var cnt = groups.reduce(function (s, g) { return s + g.players.length; }, 0);
            showToast("✅ '" + file.name + "'에서 " + groups.length + "개 조 · " + cnt + "명 명단을 불러왔습니다!");
          } else {
            showToast("⚠️ 엑셀 파일에서 명단을 찾지 못했습니다.");
          }
        } else {
          var txt = await file.text();
          document.getElementById("rosterPasteInput").value = txt;
          applyPastedRoster();
        }
      } catch (err) {
        showToast("❌ 파일 읽기 오류: " + err.message);
      }
      ev.target.value = "";
    }

    // Build clickable Google Maps HTML for after-party venue + address
    function buildAfterPartyHtml(place, addr) {
      var p = String(place || "").trim();
      var a = String(addr || "").trim();
      if (!p && !a) return "";
      if (p && !a) {
        return '뒷풀이: <span style="font-size:12px; font-weight:700; color:#451a03;">' + escapeHtmlText(p) + '</span>';
      }
      var href = /^https?:\/\//i.test(a)
        ? a
        : ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((p ? p + ", " : "") + a));
      var addrLabel = /^https?:\/\//i.test(a) ? (p || "지도 보기") : a;
      if (p && /^https?:\/\//i.test(a)) {
        return '뒷풀이: <span style="font-size:11.5px; font-weight:700; color:#451a03;"><a href="' + escapeHtmlText(href) + '" target="_blank" style="color:#003876; text-decoration:underline; font-weight:700;">' + escapeHtmlText(p) + '</a></span>';
      }
      return '뒷풀이: <span style="font-size:11.5px; font-weight:600; color:#451a03;">' +
        (p ? (escapeHtmlText(p) + ' (') : '') +
        '<a href="' + escapeHtmlText(href) + '" target="_blank" style="color:#003876; text-decoration:underline; font-weight:600;">' + escapeHtmlText(addrLabel) + '</a>' +
        (p ? ')' : '') + '</span>';
    }

    // Populate form for brand-new tournament (isNewDefault=true) or loaded past tournament (isNewDefault=false)
    function populateFormFromConfig(cfg, groupsOpt, isNewDefault) {
      cfg = cfg || {};
      var unifiedName = isNewDefault
        ? ""
        : String(cfg.heroTitle || cfg.sheetTitle || cfg.tournamentTitle || "").replace(/^[⛳🏆🎯\s]+/, "").trim();
      document.getElementById("tournamentNameInput").value = unifiedName;

      var courseSel = document.getElementById("courseSelect");
      if (cfg.courseKey) {
        courseSel.value = (typeof normalizeCourseKey === "function") ? normalizeCourseKey(cfg.courseKey) : cfg.courseKey;
      }
      syncCourseInputWithSelected();
      closeCourseComboMenu(false);
      onCourseSelectChange(false);

      var cObj = getSelectedCourseObj();
      if (isNewDefault) {
        document.getElementById("menTeeSelect").value = "white";
        document.getElementById("womenTeeSelect").value = "red";
        document.getElementById("customTeeTextInput").value = "";
        document.getElementById("longHolesInput").value = (cObj.longDriveHoles || []).join(", ");
        document.getElementById("nearHolesInput").value = (cObj.nearPinHoles || []).join(", ");
        document.getElementById("noticeRichEditor").innerHTML = "";
        document.getElementById("afterPartyPlaceInput").value = "";
        document.getElementById("afterPartyAddrInput").value = "";
        editorGroups = [];
      } else {
        // Restore tee selections or custom tee text
        var mKey = cfg.menTeeKey !== undefined ? cfg.menTeeKey : (cfg.defaultTeeKey || "");
        var wKey = cfg.womenTeeKey !== undefined ? cfg.womenTeeKey : "";
        if (cfg.menTeeKey === undefined && cfg.womenTeeKey === undefined && cfg.teeBannerTitle) {
          if (cfg.teeBannerTitle.indexOf("화이트") !== -1 && cfg.teeBannerTitle.indexOf("레드") !== -1) {
            mKey = "white";
            wKey = "red";
          } else {
            mKey = "";
            wKey = "";
          }
        }
        document.getElementById("menTeeSelect").value = mKey;
        document.getElementById("womenTeeSelect").value = wKey;
        document.getElementById("customTeeTextInput").value = (!mKey && !wKey) ? (cfg.teeBannerTitle || "") : "";

        document.getElementById("longHolesInput").value = (cfg.longDriveHoles || []).join(", ");
        document.getElementById("nearHolesInput").value = (cfg.nearPinHoles || []).join(", ");

        // Restore rich-text editor content (supports both new noticeBodyHtml and legacy noticeLeadHtml + noticeItems)
        var ed = document.getElementById("noticeRichEditor");
        if (cfg.noticeBodyHtml !== undefined) {
          ed.innerHTML = cfg.noticeBodyHtml || "";
        } else {
          var legacyParts = [];
          if (cfg.noticeLeadHtml) legacyParts.push("<p>" + cfg.noticeLeadHtml + "</p>");
          if (Array.isArray(cfg.noticeItems) && cfg.noticeItems.length > 0) {
            legacyParts.push("<ul>" + cfg.noticeItems.map(function (it) { return "<li>" + it + "</li>"; }).join("") + "</ul>");
          }
          ed.innerHTML = legacyParts.join("");
        }

        document.getElementById("afterPartyPlaceInput").value = cfg.afterPartyPlace || "";
        document.getElementById("afterPartyAddrInput").value = cfg.afterPartyAddr || "";

        var grpSource = (Array.isArray(groupsOpt) && groupsOpt.length > 0) ? groupsOpt : (cfg.groups || []);
        editorGroups = normalizeGroupsForEditor(grpSource);
      }

      document.getElementById("rosterPasteInput").value = "";
      renderGroupsEditor();
      syncGuideFooterUI();
    }

    function startFreshTournamentForm() {
      editingExistingSlug = "";
      editingExistingTitle = "";
      var baseCfg = (typeof TOURNAMENT_CONFIG !== "undefined" && TOURNAMENT_CONFIG) ? TOURNAMENT_CONFIG : {};
      populateFormFromConfig(baseCfg, [], true);
      document.getElementById("issuedLinksBox").style.display = "none";
      refreshEditingModeUI();
    }

    function collectCleanedGroups() {
      var out = [];
      editorGroups.forEach(function (g, idx) {
        var gName = String(g.name || ((idx + 1) + "조")).trim();
        if (gName.indexOf("조") === -1) gName += "조";
        var pls = [];
        (g.players || []).forEach(function (p) {
          var n = String((p && p.name) || "").trim();
          if (!n) return;
          var h = (p.handicap !== "" && p.handicap !== null && p.handicap !== undefined && !isNaN(Number(p.handicap)))
            ? Number(p.handicap)
            : "";
          pls.push({ name: n, handicap: h });
        });
        if (pls.length > 0) out.push({ name: gName, players: pls });
      });
      return out;
    }

    function collectConfigFromForm(slug) {
      var cleanName = document.getElementById("tournamentNameInput").value
        .replace(/^[⛳🏆🎯\s]+/, "")
        .trim();
      var sheetTitle = cleanName || "골프대회 스코어보드";
      var heroTitle = sheetTitle;
      var tournamentTitle = "⛳ " + sheetTitle;

      var mTee = document.getElementById("menTeeSelect").value;
      var wTee = document.getElementById("womenTeeSelect").value;
      var teeBannerTitle = "";
      if (mTee || wTee) {
        var tParts = [];
        if (mTee && TEE_KOR_LABELS[mTee]) tParts.push("남성:" + TEE_KOR_LABELS[mTee]);
        if (wTee && TEE_KOR_LABELS[wTee]) tParts.push("여성:" + TEE_KOR_LABELS[wTee]);
        teeBannerTitle = tParts.join(", ");
      } else {
        teeBannerTitle = document.getElementById("customTeeTextInput").value.trim();
      }

      var afterPlace = document.getElementById("afterPartyPlaceInput").value.trim();
      var afterAddr = document.getElementById("afterPartyAddrInput").value.trim();
      var baseCfg = (typeof TOURNAMENT_CONFIG !== "undefined" && TOURNAMENT_CONFIG) ? TOURNAMENT_CONFIG : {};

      return {
        tournamentId: slug,
        courseKey: document.getElementById("courseSelect").value,
        heroImgUrl: "images/hero_hills.jpg",
        sheetTitle: sheetTitle,
        tournamentTitle: tournamentTitle,
        heroTitle: heroTitle,
        menTeeKey: mTee,
        womenTeeKey: wTee,
        defaultTeeKey: mTee || wTee || "white",
        longDriveHoles: parseIntList(document.getElementById("longHolesInput").value),
        nearPinHoles: parseIntList(document.getElementById("nearHolesInput").value),
        noticeTitle: "📢 경기 진행 안내",
        noticeBodyHtml: getCleanedEditorHtml(),
        noticeLeadHtml: "",
        noticeItems: [],
        teeBannerTitle: teeBannerTitle,
        teeBannerSubHtml: "",
        eventBannerSubHtml: "",
        afterPartyPlace: afterPlace,
        afterPartyAddr: afterAddr,
        afterPartyHtml: buildAfterPartyHtml(afterPlace, afterAddr),
        copyrightHtml: baseCfg.copyrightHtml || "",
        firstTeeTime: "",
        groups: collectCleanedGroups()
      };
    }

    function syncSlugLocalCache(slug, cfg, sheetId) {
      try {
        if (slug && cfg) localStorage.setItem("golf_cfg_v2_" + slug, JSON.stringify(cfg));
        if (slug && sheetId) localStorage.setItem("golf_scope_v2_" + slug, String(sheetId));
      } catch (e) { }
    }

    // Smartphone First-Page Live Preview Handlers
    function openMobilePreviewModal() {
      var draftCfg = collectConfigFromForm(editingExistingSlug || "preview");
      if (!document.getElementById("tournamentNameInput").value.trim()) {
        draftCfg.heroTitle = "대회 이름 미입력 (예시)";
        draftCfg.tournamentTitle = "⛳ 대회 이름 미입력 (예시)";
      }
      var cleanedGroups = collectCleanedGroups();
      var groupList = cleanedGroups.map(function (g) {
        return {
          name: g.name,
          players: (g.players || []).map(function (p) { return p.name; })
        };
      });
      try {
        localStorage.setItem("golf_admin_live_preview_v1", JSON.stringify({
          config: draftCfg,
          groupList: groupList
        }));
      } catch (e) { }

      var modal = document.getElementById("mobilePreviewModal");
      var frame = document.getElementById("mobilePreviewFrame");
      modal.style.display = "flex";
      frame.src = "index.html?preview=1&_cb=" + Date.now();
    }

    function closeMobilePreviewModal() {
      var modal = document.getElementById("mobilePreviewModal");
      var frame = document.getElementById("mobilePreviewFrame");
      modal.style.display = "none";
      frame.src = "about:blank";
    }

    function onPreviewBackdropClick(ev) {
      if (ev.target && ev.target.id === "mobilePreviewModal") {
        closeMobilePreviewModal();
      }
    }

    // Past Tournaments Modal Handlers
    function onModalBackdropClick(ev) {
      if (ev.target && ev.target.id === "pastTournamentsModal") {
        closePastTournamentsModal();
      }
    }

    function closePastTournamentsModal() {
      document.getElementById("pastTournamentsModal").style.display = "none";
    }

    function openPastTournamentsModal() {
      var modal = document.getElementById("pastTournamentsModal");
      var body = document.getElementById("pastTournamentsListBody");
      modal.style.display = "flex";
      body.innerHTML = '<div style="text-align:center; padding:24px; color:#64748b; font-weight:700;">⏳ 예전 대회 목록을 불러오는 중입니다...</div>';

      callAdminApiWithPin("adminListTournaments", function (pin) { return [pin]; })
        .then(function (data) {
          var list = (data && Array.isArray(data.tournaments)) ? data.tournaments : [];
          if (list.length === 0) {
            body.innerHTML = '<div style="text-align:center; padding:28px 16px; color:#64748b; font-weight:700;">아직 저장된 예전 대회가 없습니다.</div>';
            return;
          }
          body.innerHTML = "";
          list.forEach(function (item) {
            var row = document.createElement("div");
            row.className = "past-item-row" + (editingExistingSlug === item.slug ? " active-item" : "");
            row.onclick = function () {
              closePastTournamentsModal();
              loadSingleTournamentIntoForm(item.slug);
            };

            var dateText = item.createdAt ? String(item.createdAt).slice(0, 10) : "";
            var left = document.createElement("div");
            left.innerHTML =
              "<div style='font-weight:900; font-size:15px; color:#0f172a;'>" +
              (item.sheetTitle || item.slug) +
              "<span class='slug-pill'>?t=" + item.slug + "</span></div>" +
              "<div style='font-size:12.5px; color:#64748b; margin-top:3px;'>골프장: <b>" + (item.courseKey || "-") + "</b>" +
              (dateText ? (" · 생성일: " + dateText) : "") + "</div>";

            var rightBtns = document.createElement("div");
            rightBtns.style.display = "flex";
            rightBtns.style.alignItems = "center";
            rightBtns.style.gap = "6px";

            var selectBtn = document.createElement("button");
            selectBtn.type = "button";
            selectBtn.className = "btn btn-blue btn-sm";
            selectBtn.textContent = "불러오기";
            selectBtn.onclick = function (ev) {
              ev.stopPropagation();
              closePastTournamentsModal();
              loadSingleTournamentIntoForm(item.slug);
            };

            var delItemBtn = document.createElement("button");
            delItemBtn.type = "button";
            delItemBtn.className = "btn btn-danger btn-sm";
            delItemBtn.textContent = "삭제";
            delItemBtn.onclick = function (ev) {
              ev.stopPropagation();
              deleteTournamentFromModal(item.slug, item.sheetTitle || item.slug);
            };

            rightBtns.appendChild(selectBtn);
            rightBtns.appendChild(delItemBtn);
            row.appendChild(left);
            row.appendChild(rightBtns);
            body.appendChild(row);
          });
        })
        .catch(function (err) {
          body.innerHTML = '<div style="text-align:center; padding:24px; color:#c92a2a; font-weight:700;">❌ 불러오기 실패: ' + err.message + '</div>';
        });
    }

    function loadSingleTournamentIntoForm(slug) {
      showToast("⏳ 대회 정보를 불러오는 중...");
      callAdminApiWithPin("adminGetTournament", function (pin) { return [slug, pin]; })
        .then(function (data) {
          editingExistingSlug = data.slug;
          editingExistingTitle = data.sheetTitle || (data.config && data.config.sheetTitle) || data.slug;
          populateFormFromConfig(data.config || {}, data.groups || [], false);
          refreshEditingModeUI();
          showIssuedLinksBanner(data.slug, data.resultsUrl, editingExistingTitle);
          syncSlugLocalCache(data.slug, data.config, data.sheetId);
          window.scrollTo({ top: 0, behavior: "smooth" });
          showToast("✅ [" + editingExistingTitle + "] 대회 내용을 불러왔습니다.");
        })
        .catch(function (err) {
          showToast("❌ 대회 불러오기 실패: " + err.message, 4500);
        });
    }

    function createOrRebuildTournamentSheet() {
      var nameVal = document.getElementById("tournamentNameInput").value.trim();
      if (!nameVal) {
        showToast("⚠️ 대회 이름을 먼저 입력해주세요!");
        document.getElementById("tournamentNameInput").focus();
        return;
      }
      var groups = collectCleanedGroups();
      if (groups.length === 0) {
        showToast("⚠️ 참석자 명단이 비어 있습니다. 명단을 붙여넣고 [조 편성 자동 세팅]을 눌러주세요!");
        return;
      }
      var isRebuild = Boolean(editingExistingSlug);
      var rawSlug = editingExistingSlug || "";
      var cfg = collectConfigFromForm(rawSlug);
      var totalP = groups.reduce(function (s, g) { return s + g.players.length; }, 0);

      var confirmMsg = isRebuild
        ? ("[" + cfg.sheetTitle + "] 대회의 구글 시트를 변경된 명단(" + groups.length + "개 조 " + totalP + "명)으로 새로 생성해 교체할까요?")
        : ("새 대회 [" + cfg.sheetTitle + "] 구글 시트를 자동 생성하고 전용 참가자 링크를 발급할까요?\n\n" +
          "• 골프장: " + cfg.courseKey + " (" + groups.length + "개 조, 총 " + totalP + "명)");

      if (!confirm(confirmMsg)) return;

      var btn = document.getElementById("createSheetBtn");
      btn.disabled = true;
      btn.textContent = "⏳ 구글 시트 및 전용 링크 생성 중... (약 5~10초)";

      callAdminApiWithPin("adminCreateTournament", function (pin) {
        return [
          pin,
          {
            slug: rawSlug,
            allowOverwrite: isRebuild,
            managerPin: "",
            config: cfg,
            groups: groups,
            pars: getSelectedCoursePars()
          }
        ];
      })
        .then(function (res) {
          if (!res || !res.slug) {
            throw new Error("구글 Apps Script에 아직 이전 버전 코드가 실행 중입니다.");
          }
          editingExistingSlug = res.slug;
          editingExistingTitle = res.sheetTitle || cfg.sheetTitle;
          refreshEditingModeUI();
          showIssuedLinksBanner(res.slug, res.resultsUrl, editingExistingTitle);
          syncSlugLocalCache(res.slug, res.config || cfg, res.sheetId);
          showToast("🎉 [" + editingExistingTitle + "] 구글 시트와 전용 링크가 발급되었습니다!", 5000);
          window.scrollTo({ top: 0, behavior: "smooth" });
        })
        .catch(function (err) {
          showToast("❌ 생성 실패: " + err.message, 5000);
        })
        .finally(function () {
          btn.disabled = false;
          refreshEditingModeUI();
        });
    }

    function saveConfigOnly() {
      var slug = editingExistingSlug;
      if (!slug) return;
      var nameVal = document.getElementById("tournamentNameInput").value.trim();
      if (!nameVal) {
        showToast("⚠️ 대회 이름을 입력해주세요!");
        document.getElementById("tournamentNameInput").focus();
        return;
      }
      var groups = collectCleanedGroups();
      if (groups.length === 0) {
        showToast("⚠️ 참석자 명단이 비어 있습니다!");
        return;
      }
      var cfg = collectConfigFromForm(slug);
      var pars = getSelectedCoursePars();
      var saveBtn = document.getElementById("saveConfigOnlyBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "⏳ 변경사항 저장 중...";

      callAdminApiWithPin("adminUpdateTournamentConfig", function (pin) { return [slug, pin, cfg, "", pars]; })
        .then(function (res) {
          editingExistingTitle = cfg.sheetTitle;
          refreshEditingModeUI();
          showIssuedLinksBanner(slug, res.resultsUrl, editingExistingTitle);
          syncSlugLocalCache(slug, cfg, res.sheetId);
          if (res && res.updateMode === "rebuilt_in_same_sheet") {
            showToast("✅ [" + editingExistingTitle + "] 변경된 명단과 설정이 기존 시트에 반영되었습니다!");
          } else if (res && res.updateMode === "roster_inplace") {
            showToast("✅ [" + editingExistingTitle + "] 선수 이름·핸디 및 설정이 저장되었습니다! (기존 점수 유지)");
          } else {
            showToast("✅ [" + editingExistingTitle + "] 변경사항이 저장되었습니다!");
          }
        })
        .catch(function (err) {
          showToast("❌ 변경사항 저장 실패: " + err.message, 4500);
        })
        .finally(function () {
          saveBtn.disabled = false;
          refreshEditingModeUI();
        });
    }

    function resetTournamentScores() {
      var slug = editingExistingSlug;
      if (!slug) return;
      if (!confirm("⚠️ [" + (editingExistingTitle || slug) + "] 대회의 모든 홀 점수와 니어/롱기 기록을 비울까요?\n(선수 이름, 핸디, 수식은 그대로 보존됩니다.)")) {
        return;
      }
      callAdminApiWithPin("adminResetTournamentScores", function (pin) { return [slug, pin]; })
        .then(function () {
          showToast("🧹 테스트 점수와 니어/롱기 기록이 모두 초기화되었습니다!");
        })
        .catch(function (err) {
          showToast("❌ 초기화 실패: " + err.message, 4500);
        });
    }

    function deleteTournamentFromModal(slug, title) {
      if (!slug) return;
      if (!confirm("⚠️ [" + title + "] 대회와 연결된 구글 시트를 함께 삭제할까요?\n(삭제된 시트는 구글 드라이브 휴지통으로 이동합니다.)")) {
        return;
      }
      callAdminApiWithPin("adminDeleteTournament", function (pin) { return [pin, slug]; })
        .then(function (res) {
          if (editingExistingSlug === slug) {
            startFreshTournamentForm();
          }
          if (res && res.sheetTrashError) {
            showToast("⚠️ 목록에서는 삭제되었으나 구글 시트 삭제 권한 승인이 필요합니다:\n" + res.sheetTrashError, 5500);
          } else {
            showToast("🗑️ [" + title + "] 대회와 연결된 구글 시트가 함께 삭제되었습니다.");
          }
          openPastTournamentsModal();
        })
        .catch(function (err) {
          showToast("❌ 삭제 실패: " + err.message, 4500);
        });
    }

    function promptChangeMasterPin() {
      var curPin = prompt("현재 관리자 비밀번호(PIN)를 입력하세요:", getSavedMasterPin());
      if (!curPin) return;
      var nextPin = prompt("새로 사용할 관리자 비밀번호(PIN, 4자리 이상)를 입력하세요:");
      if (!nextPin) return;
      setSavedMasterPin(curPin.trim());
      callAdminApiWithPin("adminChangeMasterPin", function () { return [curPin.trim(), nextPin.trim()]; })
        .then(function () {
          setSavedMasterPin(nextPin.trim());
          showToast("🔑 관리자 비밀번호(PIN)가 변경되었습니다!");
        })
        .catch(function (err) {
          showToast("❌ PIN 변경 실패: " + err.message, 4500);
        });
    }

    // Boot into Login Gate first; auto-restore active tab session if still valid
    (function initAdminConsole() {
      populateCourseDropdown();
      startFreshTournamentForm();
      try {
        var savedToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
        var savedEmail = sessionStorage.getItem(AUTH_EMAIL_KEY) || "";
        if (savedToken && savedEmail) {
          callRawBackend("authVerifySession", [savedToken])
            .then(function (res) {
              if (res && res.valid) {
                enterAuthenticatedAdmin(res.email || savedEmail, savedToken);
              }
            })
            .catch(function () {
              logoutOrganizer();
            });
          return;
        }
      } catch (e) { }
      switchAuthMode("login");
    })();
