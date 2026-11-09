    function getLocalBackupKey(groupName) {
      var scope = ACTIVE_TOURNAMENT_SCOPE || (T_CFG && T_CFG.tournamentId) || SELECTED_COURSE_KEY || "default";
      return "golf_offline_pending_" + scope + "_" + groupName;
    }

    function addPendingLocalHole(h) {
      var holeNum = Number(h);
      if (holeNum >= 1 && holeNum <= 18 && pendingLocalHoles.indexOf(holeNum) === -1) {
        pendingLocalHoles.push(holeNum);
      }
    }

    function clearLocalBackup(groupName) {
      if (!groupName) return;
      var key = getLocalBackupKey(groupName);
      var legacyKey = "golf_2026_backup_" + groupName;
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(legacyKey);
      } catch (e) { }
      try {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(legacyKey);
      } catch (e) { }
    }

    function saveLocalBackup() {
      if (isViewOnly || !currentGroupData || !currentGroupData.groupName) return;
      if (!pendingLocalHoles || pendingLocalHoles.length === 0) {
        clearLocalBackup(currentGroupData.groupName);
        return;
      }
      var dataToSave = {
        updatedAt: Date.now(),
        players: currentGroupData.players,
        notes: currentGroupData.notes,
        pendingHoles: pendingLocalHoles,
        dirtyScoreCells: dirtyScoreCells,
        dirtyNoteHoles: dirtyNoteHoles,
        baseNotes: serverBaselineNotes
      };
      var serialized = "";
      try {
        serialized = JSON.stringify(dataToSave);
      } catch (e) {
        return;
      }
      var key = getLocalBackupKey(currentGroupData.groupName);
      try {
        localStorage.setItem(key, serialized);
      } catch (e) { }
      try {
        sessionStorage.setItem(key, serialized);
      } catch (e) { }
    }

    // Restore only unsynced offline cells/notes so groupmates' server scores and sheet resets are never overwritten
    function applyLocalBackupIfNewer(serverData) {
      if (isViewOnly || !serverData || !serverData.groupName) return;
      try {
        var key = getLocalBackupKey(serverData.groupName);
        var legacyKey = "golf_2026_backup_" + serverData.groupName;
        // Always purge legacy backup keys to prevent zombie data resurrection after a sheet reset
        try { localStorage.removeItem(legacyKey); } catch (e) { }
        try { sessionStorage.removeItem(legacyKey); } catch (e) { }

        var rawLocal = null;
        var rawSession = null;
        try { rawLocal = localStorage.getItem(key); } catch (e) { }
        try { rawSession = sessionStorage.getItem(key); } catch (e) { }
        if (!rawLocal && !rawSession) return;

        var backupLocal = null;
        var backupSession = null;
        if (rawLocal) {
          try { backupLocal = JSON.parse(rawLocal); } catch (e) { }
        }
        if (rawSession) {
          try { backupSession = JSON.parse(rawSession); } catch (e) { }
        }
        var backup = backupLocal || backupSession;
        if (backupLocal && backupSession) {
          backup = ((backupSession.updatedAt || 0) > (backupLocal.updatedAt || 0)) ? backupSession : backupLocal;
        }
        if (!backup || !backup.players || !backup.pendingHoles || !Array.isArray(backup.pendingHoles) || backup.pendingHoles.length === 0) {
          clearLocalBackup(serverData.groupName);
          return;
        }

        // Discard stale offline backups older than 6 hours (preserves data through tournament dinner)
        if (!backup.updatedAt || (Date.now() - backup.updatedAt > 6 * 3600 * 1000)) {
          clearLocalBackup(serverData.groupName);
          return;
        }

        var pendingMap = {};
        backup.pendingHoles.forEach(function (ph) {
          var num = Number(ph);
          if (num >= 1 && num <= 18) {
            pendingMap[num - 1] = true;
            addPendingLocalHole(num);
          }
        });

        var hasCellDirtyMap = !!(backup.dirtyScoreCells && typeof backup.dirtyScoreCells === "object");
        var hasNoteDirtyMap = !!(backup.dirtyNoteHoles && typeof backup.dirtyNoteHoles === "object");

        var restoredAny = false;
        for (var p = 0; p < serverData.players.length; p++) {
          var bPlayer = backup.players[p];
          if (!bPlayer || !bPlayer.scores) continue;
          for (var h = 0; h < 18; h++) {
            if (!pendingMap[h]) continue;
            var cellKey = p + "_" + (h + 1);
            var bVal = bPlayer.scores[h];
            var bHas = (bVal !== "" && bVal !== null && bVal !== undefined && String(bVal).trim() !== "" && !isNaN(Number(bVal)));
            if (hasCellDirtyMap) {
              if (!backup.dirtyScoreCells[cellKey]) continue;
              serverData.players[p].scores[h] = bHas ? Number(bVal) : "";
              dirtyScoreCells[cellKey] = true;
              restoredAny = true;
            } else if (bHas) {
              serverData.players[p].scores[h] = Number(bVal);
              dirtyScoreCells[cellKey] = true;
              restoredAny = true;
            }
          }
        }
        if (backup.notes && Array.isArray(backup.notes)) {
          for (var nh = 0; nh < 18; nh++) {
            if (!pendingMap[nh]) continue;
            var hNum = nh + 1;
            var bNote = backup.notes[nh] || "";
            if (hasNoteDirtyMap) {
              if (!backup.dirtyNoteHoles[hNum]) continue;
              serverData.notes[nh] = bNote;
              dirtyNoteHoles[hNum] = true;
              if (backup.baseNotes && Array.isArray(backup.baseNotes) && backup.baseNotes[nh] !== undefined) {
                serverBaselineNotes[nh] = normalizeNoteVal(backup.baseNotes[nh]);
              }
              restoredAny = true;
            } else if (String(bNote).trim() !== "") {
              serverData.notes[nh] = bNote;
              dirtyNoteHoles[hNum] = true;
              if (backup.baseNotes && Array.isArray(backup.baseNotes) && backup.baseNotes[nh] !== undefined) {
                serverBaselineNotes[nh] = normalizeNoteVal(backup.baseNotes[nh]);
              }
              restoredAny = true;
            }
          }
        }
        if (restoredAny && pendingLocalHoles.length > 0) {
          hasPendingLocalSave = true;
        } else {
          pendingLocalHoles = [];
          hasPendingLocalSave = false;
          clearLocalBackup(serverData.groupName);
        }
      } catch (e) { }
    }

    function clearSaveWatchdog() {
      if (saveTimeoutTimer) {
        clearTimeout(saveTimeoutTimer);
        saveTimeoutTimer = null;
      }
    }

    // On network timeout/error, save locally on phone and advance to next hole (opens full scorecard on 18H)
    function fallbackToLocalSave(targetHole, isAuto) {
      activeSaveSeq++;
      clearSaveWatchdog();
      isSaving = false;
      lastLocalFallbackAt = Date.now();
      var saveBtn = document.getElementById("saveBtn");
      if (saveBtn && !isViewOnly) saveBtn.disabled = false;

      addPendingLocalHole(targetHole);
      hasPendingLocalSave = true;
      saveLocalBackup();

      var movedNext = false;
      var openedScorecard = false;
      if (currentHole === targetHole) {
        isSaved = isHoleHasAnyInput(currentHole);
        isDirty = false;
        savedHoleSnapshot = getHoleSnapshot(currentHole);
        if (!isAuto && targetHole < 18) {
          movedNext = true;
          stopShotMeasureOnSave(targetHole);
          renderHole(targetHole + 1);
        } else {
          renderHole(currentHole, true);
          if (!isAuto && targetHole === 18) {
            openedScorecard = true;
            openScorecardModal();
          }
        }
      } else {
        updateNextBtnState();
        renderHoleBar(false);
      }

      if (!isAuto) {
        var prevMissing = getMissingHolesList(targetHole - 1);
        var missingWarn = prevMissing.length > 0
          ? ("\n⚠️ 이전 홀(" + prevMissing.map(function (m) { return m + "H"; }).join(", ") + ") 점수 입력이 누락되어 있습니다.")
          : "";
        if (movedNext) {
          showToast("📡 통신이 약해 " + targetHole + "H 임시 저장 후 " + (targetHole + 1) + "H로 이동합니다.\n(다음 저장 시 함께 반영됩니다)" + missingWarn, prevMissing.length > 0 ? 4000 : 2500);
        } else if (openedScorecard) {
          var unsentHoles = pendingLocalHoles.slice().sort(function (a, b) { return a - b; })
            .map(function (h) { return h + "H"; }).join(", ");
          showToast("⚠️ " + unsentHoles + " 점수가 아직 시트에 전송되지 않았습니다!\n" +
            "통신이 되는 곳에서 [저장]을 한 번 더 눌러주세요." + missingWarn, 7000);
        } else {
          showToast("📡 통신이 약해 폰에 임시 저장했습니다.\n(다음 저장 시 함께 반영됩니다)" + missingWarn, prevMissing.length > 0 ? 4000 : 2500);
        }
      }
    }

    function getHoleSnapshot(h) {
      if (!currentGroupData || !currentGroupData.players) return "";
      var sc = currentGroupData.players.map(function (p) {
        var v = p.scores[h - 1];
        return (v === "" || v === null || v === undefined || String(v).trim() === "" || isNaN(Number(v))) ? "" : Number(v);
      }).join(",");
      var nt = (currentGroupData.notes && currentGroupData.notes[h - 1]) ? String(currentGroupData.notes[h - 1]).trim() : "";
      return sc + "|" + nt;
    }

    function submitPortalTournamentSlug(ev) {
      if (ev) ev.preventDefault();
      var input = document.getElementById("portalSlugInput");
      var slug = normalizeTournamentSlug(input ? input.value : "");
      if (!slug) {
        showToast("⚠️ 대회 코드를 입력해주세요.");
        return false;
      }
      var nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("t", slug);
      window.location.href = nextUrl.toString();
      return false;
    }

    (function initInitialGroupList() {
      function setTournamentHeaderCardsVisible(show) {
        var heroCard = document.querySelector(".golf-hero-card");
        var noticeCard = document.querySelector(".notice-card");
        if (heroCard) heroCard.style.display = show ? "" : "none";
        if (noticeCard) noticeCard.style.display = show ? "" : "none";
      }

      function renderTournamentPortalCard(missingOrInvalidMsg) {
        setTournamentHeaderCardsVisible(false);
        document.title = "Golf ScoreCard";
        var quickGrid = document.getElementById("quickGroupGrid");
        if (!quickGrid) return;
        var alertHtml = missingOrInvalidMsg
          ? '<div style="background:#fff5f5; border:1px solid #ffc9c9; color:#c92a2a; border-radius:10px; padding:10px 12px; font-size:13px; font-weight:700; margin-bottom:14px;">' + missingOrInvalidMsg + '</div>'
          : '';
        quickGrid.innerHTML =
          '<div style="grid-column:1 / -1; background:#ffffff; border:1.5px solid #e2e8f0; border-radius:18px; padding:26px 18px; text-align:center; box-shadow:0 6px 20px rgba(15,23,42,0.06); margin-top:16px;">' +
          '<div style="font-size:34px; margin-bottom:6px;">⛳</div>' +
          '<div style="font-size:19px; font-weight:900; color:#800020; margin-bottom:6px;">실시간 골프대회 스코어보드</div>' +
          '<div style="font-size:13px; color:#4b5563; line-height:1.55; margin-bottom:16px;">카톡 등으로 전달받으신 <b>대회 전용 링크</b>로 접속하시거나,<br>안내받은 <b>대회 코드</b>를 아래에 입력해 주세요.</div>' +
          alertHtml +
          '<form onsubmit="return submitPortalTournamentSlug(event)" style="display:flex; gap:8px; justify-content:center; max-width:340px; margin:0 auto 16px auto;">' +
          '<input id="portalSlugInput" type="text" placeholder="대회 코드 (예: 2026-fall)" value="' + (ACTIVE_TOURNAMENT_SLUG || "") + '" ' +
          'style="flex:1; padding:11px 12px; border:1.5px solid #cbd5e1; border-radius:10px; font-size:14px; font-weight:700; text-transform:lowercase;">' +
          '<button type="submit" style="padding:11px 18px; border:none; border-radius:10px; background:linear-gradient(180deg,#9e0028 0%,#800020 100%); color:#fff; font-size:14px; font-weight:800; cursor:pointer; white-space:nowrap;">입장 ➔</button>' +
          '</form>' +
          '<div style="padding-top:12px; border-top:1px dashed #e2e8f0; font-size:12px; color:#64748b;">' +
          '새 대회를 개설하시나요? <a href="admin.html" style="color:#003876; font-weight:800; text-decoration:underline;">🛠️ 대회 개설/관리 콘솔 (admin.html)</a>' +
          '</div>' +
          '</div>';
      }

      function renderSetupRequiredCard() {
        setTournamentHeaderCardsVisible(false);
        var quickGrid = document.getElementById("quickGroupGrid");
        if (!quickGrid) return;
        quickGrid.innerHTML =
          '<div class="loading-notice" style="grid-column:1 / -1; background:#fff9db; border:1.5px solid #f59f00; border-radius:14px; padding:18px 14px; color:#5c3c00; line-height:1.55; margin-top:14px;">' +
          '<div style="font-size:15px; font-weight:900; color:#800020; margin-bottom:6px;">⚙️ 구글 시트 백엔드 연결이 필요합니다</div>' +
          '<div style="font-size:12.5px; margin-bottom:12px;">관리자 설정 페이지에서 백엔드 엔진 URL을 연결하고 대회를 생성해주세요.</div>' +
          '<a href="admin.html" style="display:inline-block; padding:10px 18px; border-radius:10px; background:#800020; color:#fff; font-weight:800; font-size:13.5px; text-decoration:none;">🛠️ 대회 관리 콘솔 (admin.html) 열기</a>' +
          '</div>';
      }

      function runInit() {
        try {
          var qParams = new URLSearchParams(window.location.search || "");
          if (qParams.get("preview") === "1") {
            var prevStyle = document.createElement("style");
            prevStyle.textContent = "html, body { scrollbar-width: none; -ms-overflow-style: none; } html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; width: 0; height: 0; }";
            document.head.appendChild(prevStyle);
            var rawDraft = localStorage.getItem("golf_admin_live_preview_v1");
            var draftObj = rawDraft ? JSON.parse(rawDraft) : {};
            var prevCfg = draftObj.config || T_CFG;
            setTournamentHeaderCardsVisible(true);
            ensureCourseLoaded(prevCfg && prevCfg.courseKey, function () {
              rebuildActiveCourseVars(prevCfg, "preview");
              applyCourseConfigUI();
              populateGroups(Array.isArray(draftObj.groupList) ? draftObj.groupList : []);
            });
            window.selectGroupQuick = function () {
              showToast("📱 첫 페이지 미리보기 화면입니다.");
            };
            window.selectFromGroupDropdown = function () {
              showToast("📱 첫 페이지 미리보기 화면입니다.");
            };
            return;
          }
        } catch (ePrev) { }
        if (window.__PRELOADED_GROUP_LIST__) {
          var preloaded = window.__PRELOADED_GROUP_LIST__;
          window.__PRELOADED_GROUP_LIST__ = null;
          populateGroups(preloaded);
          return;
        }
        if (!resolveGasApiUrl()) {
          renderSetupRequiredCard();
          return;
        }
        if (!ACTIVE_TOURNAMENT_SLUG) {
          renderTournamentPortalCard("");
          return;
        }
        if (!HAS_SLUG_CACHED_CFG) {
          // Hide default static template banners until this slug's own config arrives (~0.2s)
          setTournamentHeaderCardsVisible(false);
        }
        google.script.run
          .withSuccessHandler(function (bundle) {
            if (bundle && (bundle.missingSlug || bundle.notFound)) {
              renderTournamentPortalCard("⚠️ 등록되지 않은 대회 코드입니다: <b>" + (ACTIVE_TOURNAMENT_SLUG || "") + "</b><br>전달받으신 대회 전용 링크를 다시 확인해 주세요.");
              return;
            }
            setTournamentHeaderCardsVisible(true);
            if (bundle && typeof bundle === "object" && !Array.isArray(bundle)) {
              var scopeId = bundle.sheetId || ACTIVE_TOURNAMENT_SLUG;
              var targetCfg = (bundle.config && typeof bundle.config === "object") ? bundle.config : T_CFG;
              if (bundle.config && typeof bundle.config === "object") {
                try { localStorage.setItem(CACHED_REMOTE_CFG_KEY, JSON.stringify(bundle.config)); } catch (e) { }
              }
              ensureCourseLoaded(targetCfg && targetCfg.courseKey, function () {
                rebuildActiveCourseVars(targetCfg, scopeId);
                applyCourseConfigUI();
                populateGroups(bundle.groupList || []);
              });
              return;
            }
            populateGroups(Array.isArray(bundle) ? bundle : []);
          })
          .withFailureHandler(function (err) {
            var msg = String((err && err.message) || err || "");
            showToast("대회 정보 로드 실패: " + msg);
          })
          .getInitBundle();
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runInit);
      } else {
        runInit();
      }
    })();

    // Automatically flush pending offline holes when internet connection returns
    window.addEventListener("online", function () {
      if (!isViewOnly && hasPendingLocalSave && currentGroupData && !isSaving && !isDirty) {
        if (pendingLocalHoles.length > 0) {
          syncPendingOfflineHoles();
        }
      } else {
        silentRefreshGroupData(true);
      }
    });

    var syncOfflineStartedAt = 0;

    // Sync previously queued offline holes in background while current hole is clean (also updates birdie banner)
    function syncPendingOfflineHoles() {
      if (isViewOnly || !currentGroupData || isSaving || pendingLocalHoles.length === 0) return;
      if (isSyncingOffline) {
        if (Date.now() - syncOfflineStartedAt > 8000) {
          isSyncingOffline = false;
        } else {
          return;
        }
      }
      var targetGroup = currentGroupData.groupName;
      var mySyncSeq = ++activeSaveSeq;
      isSyncingOffline = true;
      syncOfflineStartedAt = Date.now();
      var holesToSync = pendingLocalHoles.slice();
      var syncedMap = {};
      holesToSync.forEach(function (hNum) { syncedMap[Number(hNum)] = true; });
      var payload = buildSavePayload();
      var notesPayload = (currentGroupData.notes || new Array(18).fill("")).slice();
      var dirtyNotesList = getDirtyNoteHolesList();

      google.script.run
        .withSuccessHandler(function (res) {
          isSyncingOffline = false;
          // Ignore stale response if group changed or user initiated a newer manual save while sync was in flight
          if (!currentGroupData || currentGroupData.groupName !== targetGroup || mySyncSeq !== activeSaveSeq) return;
          updateServerBaselineFromResponse(res);
          if (res && res.mergedScores && res.mergedScores.length === currentGroupData.players.length) {
            for (var i = 0; i < currentGroupData.players.length; i++) {
              for (var h = 0; h < 18; h++) {
                var hNum = h + 1;
                if (hNum === currentHole && isDirty) continue;
                var sentVal = (payload[i] && payload[i].scores) ? normalizeScoreVal(payload[i].scores[h]) : "";
                var curLocalVal = normalizeScoreVal(currentGroupData.players[i].scores[h]);
                if (syncedMap[hNum] && curLocalVal === sentVal) {
                  delete dirtyScoreCells[i + "_" + hNum];
                }
                if (!dirtyScoreCells[i + "_" + hNum]) {
                  currentGroupData.players[i].scores[h] = res.mergedScores[i][h];
                }
              }
            }
          }
          if (res && res.mergedNotes && res.mergedNotes.length === 18) {
            for (var nh = 0; nh < 18; nh++) {
              var nhNum = nh + 1;
              if (nhNum === currentHole && isDirty) continue;
              var sentNote = normalizeNoteVal(notesPayload[nh]);
              var curLocalNote = normalizeNoteVal(currentGroupData.notes[nh]);
              if (syncedMap[nhNum] && curLocalNote === sentNote) {
                delete dirtyNoteHoles[nhNum];
              }
              if (!dirtyNoteHoles[nhNum]) {
                currentGroupData.notes[nh] = res.mergedNotes[nh];
              }
            }
          }
          pendingLocalHoles = pendingLocalHoles.filter(function (ph) {
            return !syncedMap[Number(ph)] || hasDirtyChangesOnHole(Number(ph));
          });
          hasPendingLocalSave = pendingLocalHoles.length > 0;
          lastGroupSyncAt = Date.now();
          if (!hasPendingLocalSave) {
            clearLocalBackup(targetGroup);
          } else {
            saveLocalBackup();
          }
          if (!isDirty) {
            isSaved = isHoleHasAnyInput(currentHole);
            savedHoleSnapshot = getHoleSnapshot(currentHole);
            renderHole(currentHole, true);
          } else {
            updateNextBtnState();
            renderHoleBar(false);
            renderMiniScorecard(false);
          }
          if (res && Array.isArray(res.birdieFeed)) {
            processBirdieFeed(res.birdieFeed);
          }
        })
        .withFailureHandler(function () {
          isSyncingOffline = false;
        })
        .saveGroupScores(targetGroup, payload, notesPayload, holesToSync, nearPinHoles, longDriveHoles, dirtyNotesList,
          { device: saveDeviceId, seq: ++saveTicketNo });
    }

    var saveIsAuto = false;

    function hasUnsavedOrPendingData() {
      if (isViewOnly || !currentGroupData || !currentGroupData.groupName) return false;
      var holeDirty = isDirty && (isHoleHasAnyInput(currentHole) || hasDirtyChangesOnHole(currentHole));
      var hasPending = hasPendingLocalSave && pendingLocalHoles && pendingLocalHoles.length > 0;
      return !!(holeDirty || hasPending || isSaving);
    }

    // Immediately back up & flush unsaved (isDirty) or offline-pending holes on tab hide/close/reload/back
    function flushUnsavedOrPendingOnExit() {
      if (isViewOnly || !currentGroupData || !currentGroupData.groupName) return;
      var holeDirty = isDirty && (isHoleHasAnyInput(currentHole) || hasDirtyChangesOnHole(currentHole));
      if (holeDirty) {
        addPendingLocalHole(currentHole);
        hasPendingLocalSave = true;
        saveLocalBackup();
        if (!isSaving) {
          saveScores(true);
        }
      } else if (hasPendingLocalSave && pendingLocalHoles && pendingLocalHoles.length > 0) {
        saveLocalBackup();
        if (!isSaving) {
          syncPendingOfflineHoles();
        }
      }
    }

    // Pause GPS for battery & flush unsaved scores on screen lock/app switch; auto-resume & sync on wake
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        pauseHoleMapGpsForBattery();
        flushUnsavedOrPendingOnExit();
      } else if (document.visibilityState === "visible") {
        if ((hmState.open || hmState.shotMeasuring) && hmState.gpsWatchId === null) {
          startHoleMapGps(true);
        }
        if (isSaving && (Date.now() - saveStartedAt > 4000)) {
          fallbackToLocalSave(currentHole, saveIsAuto);
        } else {
          silentRefreshGroupData(true);
        }
      }
    });

    // Immediately back up and send to server on tab close / Safari pagehide
    window.addEventListener("pagehide", function () {
      flushUnsavedOrPendingOnExit();
    });

    // On browser refresh / window close: trigger background flush + show native unsaved-data confirmation
    window.addEventListener("beforeunload", function (e) {
      if (!hasUnsavedOrPendingData()) return;
      flushUnsavedOrPendingOnExit();
      e.preventDefault();
      e.returnValue = "";
      return "";
    });

    function pushAppHistoryGuard() {
      try {
        if (window.history && window.history.pushState) {
          window.history.pushState({ golfGuard: true }, "", window.location.href);
        }
      } catch (e) { }
    }

    function closeTopmostOpenModal() {
      var plPop = document.getElementById("plDetailPop");
      if (plPop && plPop.style.display === "block") {
        closePlaysLikeDetail();
        return true;
      }
      var ekModal = document.getElementById("eventKeypadModal");
      if (ekModal && ekModal.style.display === "flex") {
        closeEventKeypadModal();
        return true;
      }
      var hmModal = document.getElementById("holeMapModal");
      if (hmModal && hmModal.style.display === "flex") {
        closeHoleMapModal();
        return true;
      }
      var scModal = document.getElementById("scorecardModal");
      if (scModal && scModal.style.display === "flex") {
        closeScorecardModal();
        return true;
      }
      var hofModal = document.getElementById("hallOfFameModal");
      if (hofModal && hofModal.style.display === "flex") {
        closeHallOfFameModal();
        return true;
      }
      var mModal = document.getElementById("modeModal");
      if (mModal && mModal.style.display === "flex") {
        cancelGroupMode();
        return true;
      }
      return false;
    }

    // Prevent accidental app exit on mobile Back button + close topmost modal + flush unsaved data
    window.addEventListener("popstate", function () {
      flushUnsavedOrPendingOnExit();
      if (closeTopmostOpenModal()) {
        pushAppHistoryGuard();
        return;
      }
      if (currentGroupData && currentGroupData.groupName) {
        pushAppHistoryGuard();
      }
    });

    function showToast(msg, durationMs) {
      var t = document.getElementById("toast");
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      t.innerText = msg;
      t.style.display = "block";
      toastTimer = setTimeout(function () {
        t.style.display = "none";
        toastTimer = null;
      }, durationMs || 2500);
    }

    // Update bottom Save/Next button label and state based on saved status and view-only mode
    function updateNextBtnState() {
      var nextBtn = document.getElementById("nextBtn");
      var saveBtn = document.getElementById("saveBtn");
      var isLastHole = (currentHole === 18);

      if (isViewOnly) {
        if (nextBtn) {
          nextBtn.innerText = isLastHole ? "🏠 종료" : "다음 홀 ▶";
          nextBtn.classList.remove("disabled-btn");
          nextBtn.classList.add("next-ready");
        }
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.classList.remove("saved");
          saveBtn.innerText = "👀 구경 모드 (잠금)";
        }
        return;
      }

      var canGoNext = !isDirty;
      var isHoleReady = isSaved && !isDirty && isHoleFilled(currentHole);
      if (nextBtn) {
        nextBtn.innerText = isLastHole ? "🏠 종료" : "다음 홀 ▶";
        if (canGoNext) {
          nextBtn.classList.remove("disabled-btn");
        } else {
          nextBtn.classList.add("disabled-btn");
        }
        if (isHoleReady) {
          nextBtn.classList.add("next-ready");
        } else {
          nextBtn.classList.remove("next-ready");
        }
      }

      if (saveBtn && !isSaving) {
        saveBtn.disabled = false;
        if (isSaved && !isDirty) {
          saveBtn.classList.add("saved");
          var totalP = (currentGroupData && currentGroupData.players) ? currentGroupData.players.length : 0;
          var filledP = 0;
          if (totalP > 0) {
            currentGroupData.players.forEach(function (p) {
              if (normalizeScoreVal(p.scores[currentHole - 1]) !== "") filledP++;
            });
          }
          var isHolePendingOffline = hasPendingLocalSave && pendingLocalHoles.indexOf(currentHole) !== -1;
          if (isHolePendingOffline) {
            saveBtn.innerText = (totalP > 0 && filledP > 0 && filledP < totalP)
              ? ("✓ 임시저장 (" + filledP + "/" + totalP + "명)")
              : "✓ 임시저장됨";
          } else if (totalP > 0 && filledP === totalP) {
            saveBtn.innerText = "✓ 저장됨";
          } else if (totalP > 0 && filledP > 0) {
            saveBtn.innerText = "✓ 일부저장 (" + filledP + "/" + totalP + "명)";
          } else {
            saveBtn.innerText = "✓ 메모저장됨";
          }
        } else {
          saveBtn.classList.remove("saved");
          saveBtn.innerText = "💾 저장하기";
        }
      }
    }

    // Compute group tee time from group number: e.g. Group 3 -> firstTeeTime + (3-1) * interval (empty if unset)
    function getGroupTeeTime(groupName) {
      var first = ACTIVE_COURSE.firstTeeTime, step = Number(ACTIVE_COURSE.teeIntervalMin);
      var n = parseInt(String(groupName).replace(/[^0-9]/g, ""), 10);
      if (!first || !step || !n) return "";
      var p = String(first).split(":");
      var t = (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0) + (n - 1) * step;
      if (!isFinite(t)) return "";
      t = ((t % 1440) + 1440) % 1440;
      return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2);
    }

    function populateGroups(groups) {
      var sel = document.getElementById("groupSelect");
      sel.innerHTML = '<option value="">조 선택...</option>';

      var menu = document.getElementById("groupDropdownMenu");
      if (menu) {
        menu.innerHTML =
          '<div class="group-dropdown-item selected" data-group="" onclick="selectFromGroupDropdown(\'\')">' +
          '<span>🏠 전체 조 편성표 (첫 화면)</span>' +
          '<span class="group-dropdown-radio"></span>' +
          '</div>';
      }

      var grid = document.getElementById("quickGroupGrid");
      grid.innerHTML = "";

      if (!groups || groups.length === 0) {
        grid.innerHTML = '<div class="loading-notice">조 목록이 없습니다.</div>';
        return;
      }

      groups.forEach(function (g) {
        var groupName = (typeof g === 'object') ? g.name : g;
        var players = (typeof g === 'object' && g.players) ? g.players : [];
        var fullLabel = (players && players.length > 0)
          ? (groupName + " (" + players.join(", ") + ")")
          : groupName;

        var opt = document.createElement("option");
        opt.value = groupName;
        opt.innerText = fullLabel;
        sel.appendChild(opt);

        if (menu) {
          var item = document.createElement("div");
          item.className = "group-dropdown-item";
          item.setAttribute("data-group", groupName);
          item.onclick = function () {
            selectFromGroupDropdown(groupName);
          };
          item.innerHTML =
            '<span>' + fullLabel + '</span>' +
            '<span class="group-dropdown-radio"></span>';
          menu.appendChild(item);
        }

        var card = document.createElement("div");
        card.className = "quick-group-card";
        card.onclick = function () {
          selectGroupQuick(groupName);
        };

        var playerText = (players && players.length > 0) ? players.join(" · ") : "참가 선수 확인";
        var teeTime = getGroupTeeTime(groupName);
        card.innerHTML =
          '<div class="q-card-head">' +
          '<span class="q-card-left"><span class="q-card-badge">' + groupName + '</span>' +
          (teeTime ? '<span class="q-card-time">⏰ ' + teeTime + '</span>' : '') + '</span>' +
          '<span class="q-card-arrow">입장 ▶</span>' +
          '</div>' +
          '<div class="q-card-players">' + playerText + '</div>';

        grid.appendChild(card);
      });

      if (ACTIVE_COURSE.copyrightHtml) {
        var crCell = document.createElement("div");
        crCell.className = "q-copyright-cell" + (groups.length % 2 === 0 ? " full" : "");
        // Always format into 2 lines: "© To use this app for your tournament," / "contact: email"
        crCell.innerHTML = '<div class="q-cr-inner">' + String(ACTIVE_COURSE.copyrightHtml).replace(/,\s*contact:/i, ",<br>contact:") + '</div>';
        grid.appendChild(crCell);
        fitCopyrightCell();
      }
    }

    // Auto-fit home copyright text into 2 clean lines without wrapping (min 7.5px)
    function fitCopyrightCell() {
      var cell = document.querySelector(".q-copyright-cell");
      if (!cell) return;
      var inner = cell.querySelector(".q-cr-inner");
      if (!inner) return;
      var size = 10;
      cell.style.fontSize = size + "px";
      var avail = cell.clientWidth - 6;
      if (avail <= 0) return;
      while (inner.offsetWidth > avail && size > 7.5) {
        size -= 0.25;
        cell.style.fontSize = size + "px";
      }
    }
    window.addEventListener("resize", fitCopyrightCell);
    window.addEventListener("orientationchange", fitCopyrightCell);

    function toggleGroupDropdown(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var menu = document.getElementById("groupDropdownMenu");
      if (!menu) return;
      var isOpen = (menu.style.display === "block");
      menu.style.display = isOpen ? "none" : "block";
    }

    function closeGroupDropdown() {
      var menu = document.getElementById("groupDropdownMenu");
      if (menu) menu.style.display = "none";
    }

    function selectFromGroupDropdown(groupName) {
      closeGroupDropdown();
      var sel = document.getElementById("groupSelect");
      if (sel) {
        sel.value = groupName;
      }
      onGroupChange();
    }

    document.addEventListener("click", function (e) {
      var wrap = document.getElementById("groupSelectorWrap");
      if (wrap && !wrap.contains(e.target)) {
        closeGroupDropdown();
      }
    });

    // Tapping a group card on home screen: first chosen group opens in Input mode, other groups open in Spectator mode
    function selectGroupQuick(groupName) {
      if (!myHomeGroup || myHomeGroup === groupName) {
        myHomeGroup = groupName;
        loadGroupData(groupName, false);
      } else {
        loadGroupData(groupName, true);
      }
    }

    function updateGroupSelectLabel(groupName) {
      var lbl = document.getElementById("groupSelectLabel");
      if (lbl) {
        lbl.innerText = groupName ? (groupName + " ▾") : "조 선택... ▾";
      }
      var menu = document.getElementById("groupDropdownMenu");
      if (menu) {
        var items = menu.children;
        for (var i = 0; i < items.length; i++) {
          var itemGroup = items[i].getAttribute("data-group") || "";
          if (itemGroup === (groupName || "")) {
            items[i].classList.add("selected");
          } else {
            items[i].classList.remove("selected");
          }
        }
      }
    }

    // Switching groups via top-right dropdown: prompt modal for Score Input vs Spectator mode
    function onGroupChange() {
      var sel = document.getElementById("groupSelect");
      var g = sel.value;
      var cArea = document.getElementById("contentArea");
      var qArea = document.getElementById("quickSelectArea");

      if (isDirty) {
        showToast("⚠️ 먼저 💾 저장하기 버튼을 눌러주세요.");
        sel.value = currentGroupData ? currentGroupData.groupName : "";
        updateGroupSelectLabel(sel.value);
        return;
      }

      if (!g) {
        currentGroupData = null;
        updateGroupSelectLabel("");
        cArea.style.display = "none";
        qArea.style.display = "flex";
        fitCopyrightCell();
        var topBarEl = document.getElementById("topCompactBar");
        if (topBarEl) topBarEl.className = "top-compact-bar";
        var heroSlot = document.getElementById("heroGroupSlot");
        var gWrap = document.getElementById("groupSelectorWrap");
        if (heroSlot && gWrap) heroSlot.appendChild(gWrap);
        return;
      }

      openModeModal(g);
    }

    function openModeModal(groupName) {
      pendingGroupName = groupName;
      document.getElementById("modeModalTitle").innerText = "⛳ " + groupName + " 입장 모드 선택";
      var desc = "";
      if (myHomeGroup && myHomeGroup !== groupName) {
        desc = "현재 입력 중인 조는 [" + myHomeGroup + "]입니다.\n[" + groupName + "]를 어떻게 열까요?";
      } else {
        desc = "[" + groupName + "]에서 진행할 모드를 선택해주세요.";
      }
      document.getElementById("modeModalDesc").innerText = desc;
      document.getElementById("modeModal").style.display = "flex";
    }

    function confirmGroupMode(viewOnly) {
      document.getElementById("modeModal").style.display = "none";
      if (!pendingGroupName) return;
      var targetGroup = pendingGroupName;
      pendingGroupName = "";
      if (!viewOnly) {
        myHomeGroup = targetGroup;
      }
      loadGroupData(targetGroup, viewOnly);
    }

    function cancelGroupMode() {
      document.getElementById("modeModal").style.display = "none";
      pendingGroupName = "";
      var sel = document.getElementById("groupSelect");
      sel.value = currentGroupData ? currentGroupData.groupName : "";
      updateGroupSelectLabel(sel.value);
    }

    function loadGroupData(g, viewOnlyMode) {
      var sel = document.getElementById("groupSelect");
      var cArea = document.getElementById("contentArea");
      var qArea = document.getElementById("quickSelectArea");

      activeSaveSeq++;
      clearSaveWatchdog();
      isSaving = false;
      isSyncingOffline = false;
      sel.value = g;
      updateGroupSelectLabel(g);
      isViewOnly = !!viewOnlyMode;

      showToast(isViewOnly ? ("👀 " + g + " 점수 구경 모드로 불러오는 중...") : "데이터를 불러오는 중...");
      google.script.run
        .withSuccessHandler(function (data) {
          if (!data) {
            showToast("데이터를 가져오지 못했습니다.");
            return;
          }
          currentGroupData = data;
          if (Array.isArray(data.birdieFeed)) {
            latestBirdieFeedCache = data.birdieFeed;
          }
          lastGroupSyncAt = Date.now();
          isDirty = false;
          hasPendingLocalSave = false;
          pendingLocalHoles = [];
          dirtyScoreCells = {};
          dirtyNoteHoles = {};
          if (!currentGroupData.players) currentGroupData.players = [];
          currentGroupData.pars = getCourseOfficialPars();
          if (!currentGroupData.notes || currentGroupData.notes.length !== 18) {
            currentGroupData.notes = new Array(18).fill("");
          }
          updateServerBaseline(currentGroupData);
          if (!isViewOnly) {
            applyLocalBackupIfNewer(currentGroupData);
          }
          qArea.style.display = "none";
          cArea.style.display = "flex";
          fitCopyrightOneLine();
          var topBarEl = document.getElementById("topCompactBar");
          if (topBarEl) topBarEl.className = "top-compact-bar in-group";
          var topWrap = document.getElementById("topRightWrap");
          var gWrap = document.getElementById("groupSelectorWrap");
          if (topWrap && gWrap) topWrap.appendChild(gWrap);
          pushAppHistoryGuard();
          renderHole(getFirstIncompleteHole());
          if (!isViewOnly && hasPendingLocalSave && pendingLocalHoles && pendingLocalHoles.length > 0) {
            syncPendingOfflineHoles();
          }
          if (Array.isArray(data.birdieFeed)) {
            processBirdieFeed(data.birdieFeed);
          }
          if (isViewOnly) {
            showToast("👀 [" + g + "] 점수 구경 모드입니다.\n(상단 '구경모드' 배지를 누르면 모드 전환 가능)");
          }
        })
        .withFailureHandler(function (err) {
          showToast("에러: " + err.message);
        })
        .getGroupData(g);
    }

    function isHoleFilled(h) {
      if (!currentGroupData || !currentGroupData.players || currentGroupData.players.length === 0) return false;
      return currentGroupData.players.every(function (p) {
        var sc = p.scores[h - 1];
        return sc !== "" && sc !== null && sc !== undefined && String(sc).trim() !== "" && !isNaN(Number(sc));
      });
    }

    function getFirstIncompleteHole() {
      for (var h = 1; h <= 18; h++) {
        if (!isHoleFilled(h)) return h;
      }
      return 18;
    }

    function getMissingHolesList(maxHole) {
      var list = [];
      if (!currentGroupData || !currentGroupData.players || currentGroupData.players.length === 0) return list;
      for (var h = 1; h <= maxHole; h++) {
        if (!isHoleFilled(h)) {
          list.push(h);
        }
      }
      return list;
    }

    function renderHoleBar(scrollToActive) {
      var bar = document.getElementById("holeBar");
      if (!bar) return;
      var chips = bar.children;
      var needCreate = (chips.length !== 18);
      if (needCreate) {
        bar.innerHTML = "";
      }

      var activeChipEl = null;
      for (var h = 1; h <= 18; h++) {
        var btn = needCreate ? document.createElement("div") : chips[h - 1];
        var isActive = (h === currentHole);
        var hasData = isHoleFilled(h) && !(isActive && isDirty);

        var classNames = ["hole-chip"];
        if (hasData) classNames.push("has-data");
        if (isActive) classNames.push("active");

        btn.className = classNames.join(" ");
        if (needCreate) {
          btn.innerText = h + "H";
          btn.onclick = (function (holeNum) {
            return function () {
              if (holeNum === currentHole) {
                if (!isDirty) {
                  if (document.activeElement && document.activeElement.id === "holeNote") {
                    document.activeElement.blur();
                  }
                  silentRefreshGroupData(true);
                }
                return;
              }
              if (isDirty) {
                showToast("⚠️ 먼저 💾 저장하기 버튼을 눌러주세요.");
                return;
              }
              var missingList = [];
              if (!isViewOnly && holeNum > currentHole) {
                var checkUpTo = (holeNum === currentHole + 1 && !isHoleFilled(currentHole)) ? (currentHole - 1) : (holeNum - 1);
                missingList = getMissingHolesList(checkUpTo);
              }
              renderHole(holeNum);
              if (missingList.length > 0) {
                showToast("⚠️ 이전 홀(" + missingList.map(function (m) { return m + "H"; }).join(", ") + ")에 미입력 점수가 있습니다.", 3500);
              }
            };
          })(h);
          bar.appendChild(btn);
        }
        if (isActive) activeChipEl = btn;
      }
      if ((needCreate || scrollToActive) && activeChipEl) {
        requestAnimationFrame(function () {
          var chipCenter = activeChipEl.offsetLeft + (activeChipEl.offsetWidth / 2);
          bar.scrollLeft = Math.max(0, chipCenter - (bar.clientWidth / 2));
        });
      }
    }

    function renderHole(holeNum, keepDirty) {
      var holeChanged = (currentHole !== holeNum) || !keepDirty;
      currentHole = holeNum;
      if (!keepDirty) {
        if (document.activeElement && document.activeElement.id === "holeNote") {
          document.activeElement.blur();
        }
        isDirty = false;
        isSaved = isHoleHasAnyInput(holeNum);
        savedHoleSnapshot = getHoleSnapshot(holeNum);
      }
      updateNextBtnState();
      renderHoleBar(holeChanged);
      if (!keepDirty) {
        silentRefreshGroupData(false);
      }

      var viewBadgeHtml = isViewOnly
        ? '<span class="view-only-badge" style="cursor:pointer;" onclick="if(currentGroupData) openModeModal(currentGroupData.groupName)">👀 구경모드 ▾</span>'
        : '';
      document.getElementById("holeTitle").innerHTML =
        '<span class="hole-label">HOLE</span><span class="hole-num">' + holeNum + '</span>' + viewBadgeHtml;

      var eventHtml = "";
      if (longDriveHoles.indexOf(Number(holeNum)) !== -1) {
        eventHtml = '<span class="event-badge badge-longdrive">롱기순위</span>';
      } else if (nearPinHoles.indexOf(Number(holeNum)) !== -1) {
        eventHtml = '<span class="event-badge badge-nearpin">니어순위</span>';
      }
      document.getElementById("holeEvent").innerHTML = eventHtml;

      var hCourseObj = getHoleCourseObj(holeNum);
      var par = (hCourseObj && hCourseObj.par) ? hCourseObj.par : 4;
      document.getElementById("parBadge").innerText = "Par " + par;

      document.getElementById("noteLabel").innerText = "📝 " + holeNum + "H 메모";
      var noteInput = document.getElementById("holeNote");
      var noteVal = (currentGroupData && currentGroupData.notes && currentGroupData.notes[holeNum - 1]) ? currentGroupData.notes[holeNum - 1] : "";
      noteInput.value = noteVal;
      // Keep raw memo input hidden (Near/Long records are entered via keypad and shown on player badge buttons)
      noteInput.parentElement.style.display = "none";
      noteInput.readOnly = true;
      noteInput.disabled = isViewOnly;
      noteInput.placeholder = isViewOnly ? "👀 구경 모드 (메모 입력 잠금)" : "선수 이름 옆 [니어입력]/[롱기입력] 버튼으로 기록됩니다";

      var container = document.getElementById("playersList");
      container.innerHTML = "";

      if (!currentGroupData || !currentGroupData.players || currentGroupData.players.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>참가 선수 정보를 불러올 수 없습니다.</div>";
        return;
      }

      var presets = [-2, -1, 0, 1, 2, 3, 4, 5];
      var isLongHole = longDriveHoles.indexOf(Number(holeNum)) !== -1;
      var isNearHole = nearPinHoles.indexOf(Number(holeNum)) !== -1;

      currentGroupData.players.forEach(function (p, pIdx) {
        var card = document.createElement("div");
        card.className = "player-card";

        var val = p.scores[holeNum - 1];
        var valStr = (val === "" || val === null || isNaN(val)) ? "" : val;

        var eventBtnHtml = "";
        if (isNearHole) {
          eventBtnHtml = '<button type="button" class="player-event-btn btn-near" onclick="setPlayerEventNote(' + pIdx + ', \'near\')">✎ ' + (getPlayerEventLabel(noteVal, p.name, "near") || "니어입력") + ' ▸</button>';
        } else if (isLongHole) {
          eventBtnHtml = '<button type="button" class="player-event-btn btn-long" onclick="setPlayerEventNote(' + pIdx + ', \'long\')">✎ ' + (getPlayerEventLabel(noteVal, p.name, "long") || "롱기입력") + ' ▸</button>';
        }

        var html = '<div class="player-info">' +
          '<div class="player-name-wrap">' +
          '<span class="player-name">' + p.name + '</span>' +
          eventBtnHtml +
          '</div>' +
          '<div class="tot-score-box">총점: <b id="totDiff_' + pIdx + '">' + calcTotalScore(p) + '</b></div>' +
          '</div>';

        html += '<div class="btn-group">';
        presets.forEach(function (ps) {
          var isSel = (valStr !== "" && Number(valStr) === ps);
          var colorClass = ps < 0 ? 'birdie' : (ps === 0 ? 'par' : '');
          html += '<button type="button" class="score-btn ' + colorClass + (isSel ? ' selected' : '') + '" onclick="setScore(' + pIdx + ', ' + ps + ')">' + ps + '</button>';
        });
        html += '</div>';

        card.innerHTML = html;
        container.appendChild(card);
      });

      renderMiniScorecard(holeChanged);
    }

    function jumpToHoleFromMiniSc(holeNum) {
      if (holeNum === currentHole) {
        if (!isDirty) {
          if (document.activeElement && document.activeElement.id === "holeNote") {
            document.activeElement.blur();
          }
          silentRefreshGroupData(true);
        }
        return;
      }
      if (isDirty) {
        showToast("⚠️ 먼저 💾 저장하기 버튼을 눌러주세요.");
        return;
      }
      var missingList = [];
      if (!isViewOnly && holeNum > currentHole) {
        var checkUpTo = (holeNum === currentHole + 1 && !isHoleFilled(currentHole)) ? (currentHole - 1) : (holeNum - 1);
        missingList = getMissingHolesList(checkUpTo);
      }
      renderHole(holeNum);
      if (missingList.length > 0) {
        showToast("⚠️ 이전 홀(" + missingList.map(function (m) { return m + "H"; }).join(", ") + ")에 미입력 점수가 있습니다.", 3500);
      }
    }

    function renderMiniScorecard(scrollToActive) {
      var scrollEl = document.getElementById("miniScScroll");
      if (!scrollEl || !currentGroupData || !currentGroupData.players) return;

      var players = currentGroupData.players;
      var pars = getCourseOfficialPars();

      var html = "<table class=\"mini-sc-table\"><thead><tr>" +
        "<th class=\"msc-col-name\" onclick=\"openScorecardModal()\">이름</th>";
      for (var h = 1; h <= 18; h++) {
        var curThCls = (h === currentHole) ? " msc-cur-hole" : "";
        html += "<th class=\"msc-col-hole" + curThCls + "\" id=\"mscHoleTh_" + h + "\" onclick=\"jumpToHoleFromMiniSc(" + h + ")\">" + h + "</th>";
      }
      html += "<th class=\"msc-col-sum\" onclick=\"openScorecardModal()\">총점</th></tr></thead><tbody>";

      players.forEach(function (p) {
        var diffSum = 0;
        var strokeSum = 0;
        var filledCount = 0;

        html += "<tr><td class=\"msc-col-name\" onclick=\"openScorecardModal()\">" + p.name + "</td>";
        for (var h2 = 1; h2 <= 18; h2++) {
          var sc = p.scores[h2 - 1];
          var hasVal = (sc !== "" && sc !== null && sc !== undefined && String(sc).trim() !== "" && !isNaN(Number(sc)));
          var curTdCls = (h2 === currentHole) ? " msc-cur-hole" : "";
          if (hasVal) {
            var num = Number(sc);
            var hPar = Number(pars[h2 - 1]) || 4;
            diffSum += num;
            strokeSum += (hPar + num);
            filledCount++;
            var valCls = num < 0 ? " sc-val-birdie" : (num === 0 ? " sc-val-par" : "");
            html += "<td class=\"msc-col-hole" + curTdCls + valCls + "\" onclick=\"jumpToHoleFromMiniSc(" + h2 + ")\">" + num + "</td>";
          } else {
            html += "<td class=\"msc-col-hole" + curTdCls + "\" style=\"color:#adb5bd;\" onclick=\"jumpToHoleFromMiniSc(" + h2 + ")\">.</td>";
          }
        }

        var diffText = diffSum > 0 ? ("+" + diffSum) : String(diffSum);
        var sumCellText = "-";
        if (filledCount === 18) {
          sumCellText = diffText + "(" + strokeSum + ")";
        } else if (filledCount > 0) {
          sumCellText = diffText;
        }
        html += "<td class=\"msc-col-sum\" onclick=\"openScorecardModal()\">" + sumCellText + "</td></tr>";
      });

      html += "</tbody></table>";
      var prevScroll = scrollEl.scrollLeft;
      scrollEl.innerHTML = html;

      if (scrollToActive) {
        requestAnimationFrame(function () {
          var activeTh = document.getElementById("mscHoleTh_" + currentHole);
          if (activeTh && scrollEl) {
            var leftFixedW = 64;
            var rightFixedW = 68;
            var visibleW = scrollEl.clientWidth - leftFixedW - rightFixedW;
            var visibleCenter = leftFixedW + (visibleW / 2);
            var thCenter = activeTh.offsetLeft + (activeTh.offsetWidth / 2);
            scrollEl.scrollLeft = Math.max(0, thCenter - visibleCenter);
          }
        });
      } else {
        scrollEl.scrollLeft = prevScroll;
      }
    }

    var ekState = {
      playerName: "",
      type: "",
      step: 0,
      val1: "",
      val2: ""
    };

    // Open numeric keypad modal when tapping the Near/Long button next to a player's name
    function setPlayerEventNote(pIdx, type) {
      if (isViewOnly) {
        showToast("👀 점수 구경 모드입니다. (수정 불가)");
        return;
      }
      if (!currentGroupData || !currentGroupData.players || !currentGroupData.players[pIdx]) return;

      ekState.playerName = currentGroupData.players[pIdx].name;
      ekState.type = type;
      ekState.step = 0;
      ekState.val1 = "";
      ekState.val2 = "";

      var delBtn = document.getElementById("ekDeleteBtn");
      if (delBtn) delBtn.style.display = hasPlayerEventEntry(ekState.playerName) ? "" : "none";
      renderEventKeypadModal();
      document.getElementById("eventKeypadModal").style.display = "flex";
    }

    function setEventKeypadStep(stepIdx) {
      if (ekState.type !== "near") return;
      ekState.step = stepIdx;
      renderEventKeypadModal();
    }

    function renderEventKeypadModal() {
      var titleEl = document.getElementById("ekModalTitle");
      var stepEl = document.getElementById("ekModalStep");
      var displayRow = document.getElementById("ekDisplayRow");
      var confirmBtn = document.getElementById("ekConfirmBtn");
      if (!titleEl || !stepEl || !displayRow || !confirmBtn) return;

      var v1Text = ekState.val1 !== "" ? ekState.val1 : "_";
      var v2Text = ekState.val2 !== "" ? ekState.val2 : "_";

      if (ekState.type === "long") {
        titleEl.innerText = "🚀 " + ekState.playerName + " (롱기)";
        stepEl.innerText = "핀까지 거리를 입력 후 [닫기]를 누르세요";
        displayRow.innerHTML =
          '<div class="ek-field-box active">' +
          '<span class="ek-field-unit">핀까지</span>' +
          '<span class="ek-field-val">[' + v1Text + ']</span>' +
          '<span class="ek-field-unit">야드</span>' +
          '</div>';
        confirmBtn.innerText = "닫기 (메모 입력)";
        confirmBtn.className = "ek-btn-confirm";
      } else {
        titleEl.innerText = "🎯 " + ekState.playerName + " (니어)";
        if (ekState.step === 0) {
          stepEl.innerText = "1단계: [피트] 숫자를 입력 후 다음을 누르세요";
          confirmBtn.innerText = "다음 (인치 입력) ▶";
          confirmBtn.className = "ek-btn-confirm step-next";
        } else {
          stepEl.innerText = "2단계: [인치] 숫자를 입력 후 [닫기]를 누르세요";
          confirmBtn.innerText = "닫기 (메모 입력)";
          confirmBtn.className = "ek-btn-confirm";
        }
        displayRow.innerHTML =
          '<div class="ek-field-box ' + (ekState.step === 0 ? 'active' : '') + '" onclick="setEventKeypadStep(0)">' +
          '<span class="ek-field-val">[' + v1Text + ']</span>' +
          '<span class="ek-field-unit">피트</span>' +
          '</div>' +
          '<div class="ek-field-box ' + (ekState.step === 1 ? 'active' : '') + '" onclick="setEventKeypadStep(1)">' +
          '<span class="ek-field-val">[' + v2Text + ']</span>' +
          '<span class="ek-field-unit">인치</span>' +
          '</div>';
      }
    }

    function pressEventKey(key) {
      var cur = (ekState.step === 0) ? ekState.val1 : ekState.val2;
      if (key === "BS") {
        cur = cur.slice(0, -1);
      } else if (key === ".") {
        if (cur.indexOf(".") === -1) {
          cur = (cur === "") ? "0." : (cur + ".");
        }
      } else {
        if (cur.length < 5) {
          cur = (cur === "0") ? key : (cur + key);
        }
      }

      if (ekState.step === 0) {
        ekState.val1 = cur;
      } else {
        ekState.val2 = cur;
      }
      renderEventKeypadModal();
    }

    function handleEventKeypadAction() {
      if (ekState.type === "near" && ekState.step === 0) {
        ekState.step = 1;
        renderEventKeypadModal();
        return;
      }

      var v1 = String(ekState.val1 || "").replace(/\.$/, "").trim();
      var v2 = String(ekState.val2 || "").replace(/\.$/, "").trim();

      var newEntry = "";
      if (ekState.type === "long") {
        if (v1 === "" || isNaN(Number(v1))) {
          closeEventKeypadModal();
          return;
        }
        newEntry = ekState.playerName + ": 핀까지 [" + v1 + "]야드";
      } else {
        if ((v1 === "" || isNaN(Number(v1))) && (v2 === "" || isNaN(Number(v2)))) {
          closeEventKeypadModal();
          return;
        }
        var safeFeet = (v1 !== "" && !isNaN(Number(v1))) ? v1 : "0";
        var safeInch = (v2 !== "" && !isNaN(Number(v2))) ? v2 : "0";
        newEntry = ekState.playerName + ":[" + safeFeet + "]피트[" + safeInch + "]인치";
      }

      var noteInput = document.getElementById("holeNote");
      var existingNote = (noteInput && noteInput.value) ? String(noteInput.value).trim() : "";
      var noteText = newEntry;

      if (existingNote) {
        var parts = existingNote.split(",");
        var updatedParts = [];
        var replaced = false;
        for (var i = 0; i < parts.length; i++) {
          var seg = String(parts[i]).trim();
          if (!seg) continue;
          var colonIdx = seg.indexOf(":");
          var segName = colonIdx !== -1 ? seg.slice(0, colonIdx).trim() : "";
          if (segName === ekState.playerName) {
            if (!replaced) {
              updatedParts.push(newEntry);
              replaced = true;
            }
          } else {
            updatedParts.push(seg);
          }
        }
        if (!replaced) {
          updatedParts.push(newEntry);
        }
        noteText = updatedParts.join(", ");
      }

      if (noteInput) {
        noteInput.value = noteText;
      }
      onNoteChange(noteText);
      closeEventKeypadModal();
      renderHole(currentHole, true); // Immediately reflect updated Near/Long record on the button next to player's name
    }

    // Format badge label next to player name (Near: 10'05" / Long: 35y to pin), or "" if none
    function getPlayerEventLabel(note, playerName, type) {
      var segs = String(note || "").split(",");
      for (var i = 0; i < segs.length; i++) {
        var s = String(segs[i]).trim();
        var c = s.indexOf(":");
        if (c === -1 || s.slice(0, c).trim() !== playerName) continue;
        var rest = s.slice(c + 1);
        if (type === "near") {
          var m = rest.match(/\[?\s*([0-9.]*)\s*\]?\s*피트(?:\s*\[?\s*([0-9.]*)\s*\]?\s*인치)?/);
          if (m) {
            var ft = m[1] || "0";
            var inch = m[2] || "0";
            if (/^\d$/.test(inch)) inch = "0" + inch;
            return ft + "'" + inch + '"';
          }
        } else {
          var y = rest.match(/([0-9.]+)/);
          if (y) return "핀까지 " + y[1] + "y";
        }
        return rest.trim().replace(/[<>&]/g, "").slice(0, 10);
      }
      return "";
    }

    // Check whether this player has an existing Near/Long entry in memo (controls [Clear] button visibility)
    function hasPlayerEventEntry(playerName) {
      var noteInput = document.getElementById("holeNote");
      var note = (noteInput && noteInput.value) ? String(noteInput.value) : "";
      return note.split(",").some(function (seg) {
        var s = String(seg).trim();
        var c = s.indexOf(":");
        return c !== -1 && s.slice(0, c).trim() === playerName;
      });
    }

    // Remove only this player's record from hole memo (preserving other groupmates' records)
    function deletePlayerEventNote() {
      var noteInput = document.getElementById("holeNote");
      var note = (noteInput && noteInput.value) ? String(noteInput.value) : "";
      var kept = note.split(",").map(function (seg) { return String(seg).trim(); }).filter(function (s) {
        if (!s) return false;
        var c = s.indexOf(":");
        return !(c !== -1 && s.slice(0, c).trim() === ekState.playerName);
      });
      var noteText = kept.join(", ");
      if (noteInput) noteInput.value = noteText;
      onNoteChange(noteText);
      closeEventKeypadModal();
      renderHole(currentHole, true); // Immediately reflect updated Near/Long record on the button next to player's name
    }

    function closeEventKeypadModal() {
      document.getElementById("eventKeypadModal").style.display = "none";
    }

    function syncDirtyState() {
      var nowSnap = getHoleSnapshot(currentHole);
      if (nowSnap === savedHoleSnapshot) {
        isDirty = false;
        isSaved = isHoleHasAnyInput(currentHole);
      } else {
        isDirty = true;
        isSaved = false;
      }
    }

    // Auto-scroll on Android when virtual keyboard opens so memo field and Save button stay visible
    function onNoteFocus() {
      var ne = document.getElementById("holeNote");
      if (ne && ne.readOnly) return; // Read-only memo does not open virtual keyboard; skip auto-scroll
      setTimeout(function () {
        var cArea = document.getElementById("contentArea");
        var noteEl = document.getElementById("holeNote");
        if (cArea && noteEl) {
          var targetTop = noteEl.offsetTop - Math.max(40, Math.floor(cArea.clientHeight * 0.35));
          if (targetTop > cArea.scrollTop) {
            cArea.scrollTo({ top: targetTop, behavior: "smooth" });
          }
        }
      }, 280);
    }

    // Mark hole as dirty and record modified memo hole on manual memo change
    function onNoteChange(val) {
      if (isViewOnly || !currentGroupData) return;
      if (!currentGroupData.notes) currentGroupData.notes = new Array(18).fill("");
      currentGroupData.notes[currentHole - 1] = val;
      var baseNote = (serverBaselineNotes && serverBaselineNotes.length >= currentHole)
        ? serverBaselineNotes[currentHole - 1]
        : "";
      if (normalizeNoteVal(val) !== normalizeNoteVal(baseNote)) {
        dirtyNoteHoles[currentHole] = true;
      } else {
        delete dirtyNoteHoles[currentHole];
      }
      syncDirtyState();
      updateNextBtnState();
      renderHoleBar(false);
    }

    // Mark hole as dirty and record exact touched player/hole cell on score button tap
    function setScore(pIdx, val) {
      if (isViewOnly) {
        showToast("👀 점수 구경 모드입니다. (수정 불가)");
        return;
      }
      var curVal = currentGroupData.players[pIdx].scores[currentHole - 1];
      var isSame = (curVal !== "" && curVal !== null && !isNaN(curVal) && Number(curVal) === Number(val));
      var nextVal = isSame ? "" : val;
      currentGroupData.players[pIdx].scores[currentHole - 1] = nextVal;
      var baseVal = (serverBaselineScores[pIdx] && serverBaselineScores[pIdx].length >= currentHole)
        ? serverBaselineScores[pIdx][currentHole - 1]
        : "";
      if (normalizeScoreVal(nextVal) !== normalizeScoreVal(baseVal)) {
        dirtyScoreCells[pIdx + "_" + currentHole] = true;
      } else {
        delete dirtyScoreCells[pIdx + "_" + currentHole];
      }
      syncDirtyState();
      renderHole(currentHole, true);
    }

    function calcTotalScore(player) {
      var sum = 0;
      var hasAny = false;
      player.scores.forEach(function (s) {
        if (s !== "" && s !== null && !isNaN(s)) {
          sum += Number(s);
          hasAny = true;
        }
      });
      return hasAny ? (sum > 0 ? "+" + sum : sum) : "-";
    }

    function prevHole() {
      if (isDirty) {
        showToast("⚠️ 먼저 💾 저장하기 버튼을 눌러주세요.");
        return;
      }
      if (currentHole > 1) renderHole(currentHole - 1);
    }

    function handleNextClick() {
      if (isViewOnly) {
        if (currentHole < 18) {
          renderHole(currentHole + 1);
        } else {
          closeScorecardModal();
          selectFromGroupDropdown("");
          showToast("🏠 첫 화면으로 이동합니다.");
        }
        return;
      }

      if (isDirty) {
        showToast("⚠️ 먼저 💾 저장하기 버튼을 눌러주세요.");
        return;
      }

      if (currentHole < 18) {
        var checkUpTo = isHoleFilled(currentHole) ? currentHole : (currentHole - 1);
        var missingList = getMissingHolesList(checkUpTo);
        renderHole(currentHole + 1);
        if (missingList.length > 0) {
          showToast("⚠️ 이전 홀(" + missingList.map(function (m) { return m + "H"; }).join(", ") + ")에 미입력 점수가 있습니다.", 3500);
        }
      } else {
        var allMissing = getMissingHolesList(18);
        if (allMissing.length > 0) {
          renderHole(allMissing[0]);
          showToast("⚠️ 아직 미입력된 홀(" + allMissing.map(function (m) { return m + "H"; }).join(", ") + ")이 남아 있어 " + allMissing[0] + "H로 이동합니다.", 3800);
          return;
        }
        closeScorecardModal();
        selectFromGroupDropdown("");
        showToast("🏁 라운딩 종료! 첫 화면으로 이동합니다.");
      }
    }

    // Explicit save handler (supports partial group input or memo-only save with smart merge & next-hole advance)
    function saveScores(isAuto) {
      if (isViewOnly || !currentGroupData || isSaving) return;

      var hasHoleInput = isHoleHasAnyInput(currentHole);
      var hasHoleDirty = hasDirtyChangesOnHole(currentHole);

      // Clear offline-pending flag for hole if user erased edits back to exact server baseline
      if (isDirty && !hasHoleDirty) {
        pendingLocalHoles = pendingLocalHoles.filter(function (ph) { return Number(ph) !== Number(currentHole); });
        hasPendingLocalSave = pendingLocalHoles.length > 0;
        if (!hasPendingLocalSave && currentGroupData && currentGroupData.groupName) {
          clearLocalBackup(currentGroupData.groupName);
        } else {
          saveLocalBackup();
        }
        isDirty = false;
        isSaved = hasHoleInput;
        savedHoleSnapshot = getHoleSnapshot(currentHole);
        renderHole(currentHole, true);
        if (!hasPendingLocalSave) {
          if (!isAuto) showToast("✅ 변경 사항이 원래대로 취소되었습니다.");
          return;
        }
      }

      var hasOfflinePending = hasPendingLocalSave && pendingLocalHoles && pendingLocalHoles.length > 0;

      // Prompt user if Save is tapped on a completely blank hole with no changes or pending data
      if (!hasHoleInput && !hasHoleDirty && !hasOfflinePending) {
        if (!isAuto) {
          showToast("⚠️ 최소 1명 이상의 점수 또는 메모를 입력해주세요.");
        }
        return;
      }

      // If already saved with zero new changes, advance to next hole immediately without redundant server RPC
      if (!hasHoleDirty && !hasAnyDirtyChanges() && !hasOfflinePending) {
        if (!isAuto) {
          var fromH = currentHole;
          var prevMissingAlready = getMissingHolesList(fromH - 1);
          var missingWarnAlready = prevMissingAlready.length > 0
            ? ("\n⚠️ 이전 홀(" + prevMissingAlready.map(function (m) { return m + "H"; }).join(", ") + ") 점수 입력이 누락되어 있습니다.")
            : "";
          if (fromH < 18) {
            renderHole(fromH + 1);
            showToast("✅ " + fromH + "H 저장 완료! → " + (fromH + 1) + "H 이동" + missingWarnAlready, prevMissingAlready.length > 0 ? 3800 : 2500);
          } else {
            openScorecardModal();
            var allMissing18Already = getMissingHolesList(18);
            if (allMissing18Already.length > 0) {
              showToast("✅ 18H 저장 완료!\n⚠️ 미입력 홀(" + allMissing18Already.map(function (m) { return m + "H"; }).join(", ") + ")을 확인해주세요.", 4000);
            } else {
              showToast("🎉 18홀 모든 점수 저장 완료! 전체표를 표시합니다.");
            }
          }
        }
        return;
      }

      var targetHole = currentHole;
      var targetGroup = currentGroupData.groupName;
      saveIsAuto = !!isAuto;
      if (hasHoleDirty) {
        addPendingLocalHole(targetHole);
      }
      saveLocalBackup();

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        fallbackToLocalSave(targetHole, isAuto);
        return;
      }

      var saveBtn = document.getElementById("saveBtn");
      var mySaveSeq = ++activeSaveSeq;
      isSaving = true;
      saveStartedAt = Date.now();
      clearSaveWatchdog();
      // If server does not respond within 7s, fall back to local phone save and advance to next hole
      saveTimeoutTimer = setTimeout(function () {
        if (!currentGroupData || currentGroupData.groupName !== targetGroup) return;
        fallbackToLocalSave(targetHole, isAuto);
      }, 7000);

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.remove("saved");
        saveBtn.innerText = "⏳ 저장 중...";
      }

      var payload = buildSavePayload();
      var notesPayload = (currentGroupData.notes || new Array(18).fill("")).slice();
      var holesToSync = pendingLocalHoles.slice();
      var syncedMap = {};
      holesToSync.forEach(function (hNum) { syncedMap[Number(hNum)] = true; });
      var dirtyNotesList = getDirtyNoteHolesList();

      google.script.run
        .withSuccessHandler(function (res) {
          if (!currentGroupData || currentGroupData.groupName !== targetGroup) return;

          var wasTimedOut = (mySaveSeq !== activeSaveSeq);
          if (!wasTimedOut) {
            clearSaveWatchdog();
            isSaving = false;
            if (saveBtn && !isViewOnly) saveBtn.disabled = false;
          }

          // Update server baseline strictly from server-returned merged data (never mix in-progress local edits)
          updateServerBaselineFromResponse(res);

          // Sync merged server scores/notes while protecting any hole/cell currently being edited
          if (res && res.mergedScores && res.mergedScores.length === currentGroupData.players.length) {
            for (var i = 0; i < currentGroupData.players.length; i++) {
              for (var h = 0; h < 18; h++) {
                var hNum = h + 1;
                if (hNum === currentHole && isDirty && (wasTimedOut || currentHole !== targetHole)) continue;
                var sentVal = (payload[i] && payload[i].scores) ? normalizeScoreVal(payload[i].scores[h]) : "";
                var curLocalVal = normalizeScoreVal(currentGroupData.players[i].scores[h]);
                if (syncedMap[hNum] && curLocalVal === sentVal) {
                  delete dirtyScoreCells[i + "_" + hNum];
                }
                if (!dirtyScoreCells[i + "_" + hNum]) {
                  currentGroupData.players[i].scores[h] = res.mergedScores[i][h];
                }
              }
            }
          }
          if (res && res.mergedNotes && res.mergedNotes.length === 18) {
            for (var nh = 0; nh < 18; nh++) {
              var nhNum = nh + 1;
              if (nhNum === currentHole && isDirty && (wasTimedOut || currentHole !== targetHole)) continue;
              var sentNote = normalizeNoteVal(notesPayload[nh]);
              var curLocalNote = normalizeNoteVal(currentGroupData.notes[nh]);
              if (syncedMap[nhNum] && curLocalNote === sentNote) {
                delete dirtyNoteHoles[nhNum];
              }
              if (!dirtyNoteHoles[nhNum]) {
                currentGroupData.notes[nh] = res.mergedNotes[nh];
              }
            }
          }

          pendingLocalHoles = pendingLocalHoles.filter(function (ph) {
            return !syncedMap[Number(ph)] || hasDirtyChangesOnHole(Number(ph));
          });
          hasPendingLocalSave = pendingLocalHoles.length > 0;
          lastGroupSyncAt = Date.now();
          if (!hasPendingLocalSave) {
            clearLocalBackup(targetGroup);
          } else {
            saveLocalBackup();
          }

          // If 7s local fallback already fired before late server response arrived, silently reconcile pending flags only
          if (wasTimedOut) {
            if (!isDirty) {
              isSaved = isHoleHasAnyInput(currentHole);
              savedHoleSnapshot = getHoleSnapshot(currentHole);
              renderHole(currentHole, true);
            } else {
              updateNextBtnState();
              renderHoleBar(false);
              renderMiniScorecard(false);
            }
            if (!isAuto && res && res.birdieFeed) {
              processBirdieFeed(res.birdieFeed);
            }
            return;
          }

          var movedNext = false;
          var openedScorecard = false;
          if (currentHole === targetHole) {
            isDirty = hasDirtyChangesOnHole(currentHole);
            isSaved = !isDirty && isHoleHasAnyInput(currentHole);
            savedHoleSnapshot = getHoleSnapshot(currentHole);
            if (!isAuto && targetHole < 18) {
              movedNext = true;
              stopShotMeasureOnSave(targetHole);
              renderHole(targetHole + 1);
            } else {
              renderHole(currentHole, true);
              if (!isAuto && targetHole === 18) {
                openedScorecard = true;
                openScorecardModal();
              }
            }
          } else if (!isDirty) {
            isSaved = isHoleHasAnyInput(currentHole);
            savedHoleSnapshot = getHoleSnapshot(currentHole);
            renderHole(currentHole, true);
          } else {
            updateNextBtnState();
            renderHoleBar(false);
            renderMiniScorecard(false);
          }

          if (!isAuto) {
            if (res && res.birdieFeed) {
              processBirdieFeed(res.birdieFeed);
            }
            var prevMissing = getMissingHolesList(targetHole - 1);
            var missingWarn = prevMissing.length > 0
              ? ("\n⚠️ 이전 홀(" + prevMissing.map(function (m) { return m + "H"; }).join(", ") + ") 점수 입력이 누락되어 있습니다.")
              : "";
            if (movedNext) {
              showToast("✅ " + targetHole + "H 저장 완료! → " + (targetHole + 1) + "H 이동" + missingWarn, prevMissing.length > 0 ? 3800 : 2500);
            } else if (openedScorecard) {
              var allMissing18 = getMissingHolesList(18);
              if (allMissing18.length > 0) {
                showToast("✅ 18H 저장 완료!\n⚠️ 미입력 홀(" + allMissing18.map(function (m) { return m + "H"; }).join(", ") + ")을 확인해주세요.", 4000);
              } else {
                showToast("🎉 18홀 모든 점수 저장 완료! 전체표를 표시합니다.");
              }
            } else {
              showToast("✅ " + res.message + missingWarn, prevMissing.length > 0 ? 3800 : 2500);
            }
          }
        })
        .withFailureHandler(function (err) {
          if (!currentGroupData || currentGroupData.groupName !== targetGroup) return;
          if (mySaveSeq !== activeSaveSeq) return;

          if (err && err.message && err.message.indexOf("찾을 수 없습니다") !== -1) {
            clearSaveWatchdog();
            isSaving = false;
            if (saveBtn && !isViewOnly) saveBtn.disabled = false;
            updateNextBtnState();
            showToast("❌ 에러: " + err.message);
            return;
          }
          // On network failure, save locally on phone and advance to next hole
          fallbackToLocalSave(targetHole, isAuto);
        })
        .saveGroupScores(targetGroup, payload, notesPayload, holesToSync, nearPinHoles, longDriveHoles, dirtyNotesList,
          { device: saveDeviceId, seq: ++saveTicketNo });
    }
