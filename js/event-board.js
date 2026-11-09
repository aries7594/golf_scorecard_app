    // ===================== Near-Pin / Long-Drive Scoreboard (Isolated Add-On Script Block) =====================
    // Isolated in its own <script> block so any error here cannot affect core scoring or saving
    var EB_AUTO_CLOSE_MS = 8000;       // Hole-arrival auto-popup closes automatically after 8 seconds
    var EB_FETCH_TIMEOUT_MS = 15000;   // Wait at most 15 seconds for scoreboard RPC (silently abort on timeout)
    var ebState = { hole: null, seq: 0, autoTimer: null, lastKey: "", shown: {} };

    function ebEscape(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    // Map hole number to its column index in 'Near/Long' tab (matching server syncNearPinToSheet), or null
    function getEventBoardInfo(hole) {
      var h = Number(hole);
      var nearList = Array.isArray(nearPinHoles) ? nearPinHoles : [];
      var longList = Array.isArray(longDriveHoles) ? longDriveHoles : [];
      if (longDriveHoles.indexOf(h) !== -1) {
        return { type: "long", nameCol: Math.max(nearList.length * 2 + 1, 9) - 1 + longList.indexOf(h) * 2 };
      }
      if (nearPinHoles.indexOf(h) !== -1) {
        return { type: "near", nameCol: nearList.indexOf(h) * 2 };
      }
      return null;
    }

    var EB_NEAR_RE = /^([0-9]+(?:\.[0-9]+)?)\s*'\s*(?:([0-9]+(?:\.[0-9]+)?)\s*"?)?$/;

    // Parse record into sortable number (smaller = better: inches for Near, yds-to-pin for Long; null if invalid)
    function parseEventBoardValue(type, raw) {
      var s = String(raw === null || raw === undefined ? "" : raw).trim();
      if (s === "") return null;
      if (type === "near") {
        var m = s.match(EB_NEAR_RE);
        if (m) return Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 0);
        return /^[0-9]+(?:\.[0-9]+)?$/.test(s) ? Number(s) * 12 : null;
      }
      s = s.replace(/\s*(yds?|y|야드)$/i, "");
      return /^[0-9]+(?:\.[0-9]+)?$/.test(s) ? Number(s) : null;
    }

    // Format display value: Near 05'08" -> 5'08", Long 150 -> 150y to pin
    function formatEventBoardValue(type, raw) {
      var s = String(raw).trim();
      if (type === "near") {
        var m = s.match(EB_NEAR_RE);
        if (!m) return Number(s) + "'00\"";
        var inch = m[2] ? String(Number(m[2])) : "0";
        if (inch.length < 2) inch = "0" + inch;
        return Number(m[1]) + "'" + inch + '"';
      }
      return "핀까지 " + Number(s.replace(/\s*(yds?|y|야드)$/i, "")) + "y";
    }

    // Render Top 3 (with ties) + Last place (with ties), inserting ellipsis when middle ranks are omitted
    function buildEventBoardHtml(hole, rows, isAuto) {
      var info = getEventBoardInfo(hole);
      var list = [];
      (rows || []).forEach(function (r) {
        if (!r) return;
        var nm = r[info.nameCol];
        var name = (nm === null || nm === undefined) ? "" : String(nm).trim();
        var v = parseEventBoardValue(info.type, r[info.nameCol + 1]);
        if (name && v !== null) list.push({ name: name, raw: r[info.nameCol + 1], v: v });
      });
      if (list.length === 0) {
        return { count: 0, html: '<div class="eb-msg">⛳ 아직 기록이 없습니다.<br>첫 기록의 주인공이 되어보세요!</div>' };
      }
      list.sort(function (a, b) { return a.v - b.v; });
      // Competition ranking: tied records share rank, next rank skips by tie count (e.g. 1, 2, 2, 4)
      var tieCount = {};
      list.forEach(function (x, i) {
        x.rank = (i > 0 && x.v === list[i - 1].v) ? list[i - 1].rank : i + 1;
        tieCount[x.rank] = (tieCount[x.rank] || 0) + 1;
      });
      var worst = list[list.length - 1].v;
      var tops = list.filter(function (x) { return x.rank <= 3; });
      var lasts = list.filter(function (x) { return x.rank > 3 && x.v === worst; });
      var MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };
      function row(cls, label, x) {
        return '<div class="eb-row ' + cls + '"><span class="eb-rank">' + label + '</span>' +
          '<span class="eb-name">' + ebEscape(x.name) + '</span>' +
          '<span class="eb-val">' + ebEscape(formatEventBoardValue(info.type, x.raw)) + '</span></div>';
      }
      var html = "";
      tops.forEach(function (x) {
        html += row(x.rank === 1 ? "eb-first" : "eb-top", MEDALS[x.rank] + " " + (tieCount[x.rank] > 1 ? "공동 " : "") + x.rank + "등", x);
      });
      if (list.length - tops.length - lasts.length > 0) html += '<div class="eb-gap">⋯</div>';
      lasts.forEach(function (x) { html += row("eb-last", lasts.length > 1 ? "🐢 공동 꼴등" : "🐢 꼴등", x); });
      html += '<div class="eb-foot">총 ' + list.length + '명 기록 · 저장된 기록 기준' +
        (isAuto ? '<br>💡 ' + (info.type === "long" ? "롱기순위" : "니어순위") + ' 버튼을 누르면 다시 볼 수 있어요' : '') + '</div>';
      return { count: list.length, html: html };
    }

    // Read-only fetch of 'Near/Long' tab rows: calls done(rows) on success or done(null) on error/15s timeout
    function fetchEventBoardRows(done) {
      var finished = false;
      var timer = setTimeout(function () { finish(null); }, EB_FETCH_TIMEOUT_MS);
      function finish(rows) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { done(rows); } catch (e) { }
      }
      try {
        google.script.run
          .withSuccessHandler(function (rows) { finish(Array.isArray(rows) ? rows : []); })
          .withFailureHandler(function () { finish(null); })
          .getEventBoardData();
      } catch (e) {
        finish(null);
      }
    }

    function setEventBoardContent(hole, bodyHtml) {
      var info = getEventBoardInfo(hole);
      var titleEl = document.getElementById("ebTitle");
      var bodyEl = document.getElementById("ebBody");
      if (titleEl) titleEl.innerText = (info && info.type === "long") ? ("🚀 " + hole + "H 롱기 전광판") : ("🎯 " + hole + "H 니어 전광판");
      if (bodyEl) bodyEl.innerHTML = bodyHtml;
    }

    function closeEventBoard() {
      if (ebState.autoTimer) {
        clearTimeout(ebState.autoTimer);
        ebState.autoTimer = null;
      }
      ebState.hole = null;
      ebState.seq++;
      var modal = document.getElementById("eventBoardModal");
      if (modal) modal.style.display = "none";
    }

    // Open scoreboard manually via header 3D button: shows loading state -> latest rankings (stays open until closed)
    function openEventBoard(hole) {
      if (!getEventBoardInfo(hole)) return;
      var modal = document.getElementById("eventBoardModal");
      if (!modal) return;
      if (ebState.autoTimer) {
        clearTimeout(ebState.autoTimer);
        ebState.autoTimer = null;
      }
      ebState.hole = hole;
      var mySeq = ++ebState.seq;
      setEventBoardContent(hole, '<div class="eb-msg">⏳ 기록을 불러오는 중입니다...</div>');
      modal.style.display = "flex";
      fetchEventBoardRows(function (rows) {
        if (mySeq !== ebState.seq || ebState.hole !== hole) return; // Discard response if modal was closed or user switched holes while loading
        setEventBoardContent(hole, rows ? buildEventBoardHtml(hole, rows).html
          : '<div class="eb-msg">⚠️ 기록을 불러오지 못했습니다.<br>잠시 후 다시 눌러주세요.</div>');
      });
    }

    function isOtherModalOpenForEventBoard() {
      var list = document.querySelectorAll(".mode-modal-backdrop");
      for (var i = 0; i < list.length; i++) {
        if (list[i].id !== "eventBoardModal" && list[i].style.display && list[i].style.display !== "none") return true;
      }
      var pl = document.getElementById("plDetailPop");
      return !!(pl && pl.style.display === "block");
    }

    // Hole-arrival auto-popup: triggers once per hole when advancing forward in Input mode
    function checkEventBoardArrival() {
      if (!currentGroupData || !currentGroupData.groupName) return;
      var g = currentGroupData.groupName, h = Number(currentHole);
      var key = g + "|" + h;
      if (key === ebState.lastKey) return;
      var prev = ebState.lastKey.split("|");
      ebState.lastKey = key;
      var movedForward = (prev[0] === g && Number(prev[1]) + 1 === h);
      if (!movedForward || isViewOnly || !getEventBoardInfo(h) || ebState.shown[key]) return;
      ebState.shown[key] = true;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      fetchEventBoardRows(function (rows) {
        if (!rows) return;                                                      // Silently ignore fetch error or timeout on auto-popup
        var tries = 0;
        (function showWhenReady() {
          if (!currentGroupData || currentGroupData.groupName !== g || Number(currentHole) !== h || isViewOnly) return;
          if (ebState.hole !== null || isOtherModalOpenForEventBoard()) return;  // Do not auto-open if another modal is currently open
          var toastEl = document.getElementById("toast");
          var bannerEl = document.getElementById("birdieBroadcastBanner");
          var busy = (toastEl && toastEl.style.display === "block") || (bannerEl && bannerEl.style.display === "block");
          if (busy && tries++ < 27) {   // Wait until save toast or birdie broadcast banner finishes before showing popup (up to 8s)
            setTimeout(showWhenReady, 300);
            return;
          }
          var built = buildEventBoardHtml(h, rows, true);
          if (built.count === 0) return;                                        // Do not open auto-popup when there are 0 recorded entries for this hole
          var modal = document.getElementById("eventBoardModal");
          if (!modal) return;
          ebState.hole = h;
          ebState.seq++;
          setEventBoardContent(h, built.html);
          modal.style.display = "flex";
          ebState.autoTimer = setTimeout(closeEventBoard, EB_AUTO_CLOSE_MS);
        })();
      });
    }

    (function initEventBoard() {
      try {
        var titleEl = document.getElementById("holeTitle");
        if (titleEl && window.MutationObserver) {
          new MutationObserver(function () {
            try { checkEventBoardArrival(); } catch (e) { }
          }).observe(titleEl, { childList: true });
        }
        var evEl = document.getElementById("holeEvent");
        if (evEl) {
          evEl.addEventListener("click", function (e) {
            if (e.target && e.target.closest && e.target.closest(".event-badge")) openEventBoard(currentHole);
          });
        }
        window.addEventListener("popstate", function () {
          var modal = document.getElementById("eventBoardModal");
          if (modal && modal.style.display === "flex") closeEventBoard();
        });
      } catch (e) { }
    })();
