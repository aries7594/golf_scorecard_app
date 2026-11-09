    function buildHalfTableHtml(startHole, endHole, sumLabel) {
      var pars = getCourseOfficialPars();
      var players = (currentGroupData && currentGroupData.players) ? currentGroupData.players : [];

      var html = '<table class="sc-table"><thead><tr><th class="sc-col-name">홀</th>';
      for (var h = startHole; h <= endHole; h++) {
        html += '<th>' + h + '</th>';
      }
      html += '<th class="sc-col-sum">' + sumLabel + '</th></tr></thead><tbody>';

      // Par row
      var parSum = 0;
      html += '<tr class="sc-par-row"><td class="sc-col-name">Par</td>';
      for (var h2 = startHole; h2 <= endHole; h2++) {
        var pVal = Number(pars[h2 - 1]) || 4;
        parSum += pVal;
        html += '<td>' + pVal + '</td>';
      }
      html += '<td class="sc-col-sum">' + parSum + '</td></tr>';

      // Player score rows
      players.forEach(function (p) {
        var diffSum = 0;
        var strokeSum = 0;
        var filledCount = 0;
        var totalHoles = endHole - startHole + 1;

        html += '<tr><td class="sc-col-name">' + p.name + '</td>';
        for (var h3 = startHole; h3 <= endHole; h3++) {
          var sc = p.scores[h3 - 1];
          var hasVal = (sc !== "" && sc !== null && sc !== undefined && String(sc).trim() !== "" && !isNaN(Number(sc)));
          if (hasVal) {
            var num = Number(sc);
            var hPar = Number(pars[h3 - 1]) || 4;
            diffSum += num;
            strokeSum += (hPar + num);
            filledCount++;
            var cls = num < 0 ? 'sc-val-birdie' : (num === 0 ? 'sc-val-par' : '');
            html += '<td class="' + cls + '">' + num + '</td>';
          } else {
            html += '<td style="color:#adb5bd;">.</td>';
          }
        }

        var diffText = diffSum > 0 ? ('+' + diffSum) : String(diffSum);
        var sumCellText = '-';
        if (filledCount === totalHoles) {
          sumCellText = diffText + ' (' + strokeSum + '타)';
        } else if (filledCount > 0) {
          sumCellText = diffText + ' (진행중)';
        }
        html += '<td class="sc-col-sum">' + sumCellText + '</td></tr>';
      });

      html += '</tbody></table>';
      return html;
    }

    function renderScorecardModalBody() {
      if (!currentGroupData) return;
      document.getElementById("scorecardModalTitle").innerText = "📋 " + currentGroupData.groupName + " 전체 스코어카드";
      var bodyHtml =
        '<div class="sc-section-label">[전반 OUT (1H ~ 9H)]</div>' +
        buildHalfTableHtml(1, 9, "전반(OUT)") +
        '<div class="sc-section-label">[후반 IN (10H ~ 18H)]</div>' +
        buildHalfTableHtml(10, 18, "후반(IN)");
      document.getElementById("scorecardModalBody").innerHTML = bodyHtml;
    }

    function openScorecardModal() {
      if (!currentGroupData) return;
      renderScorecardModalBody();
      document.getElementById("scorecardModal").style.display = "flex";
      silentRefreshGroupData(true);
    }

    function closeScorecardModal() {
      document.getElementById("scorecardModal").style.display = "none";
    }

    function isUserActivelyEditing() {
      if (isDirty || isSaving || isSyncingOffline || hasPendingLocalSave || (pendingLocalHoles && pendingLocalHoles.length > 0)) {
        return true;
      }
      var activeEl = document.activeElement;
      if (activeEl && activeEl.id === "holeNote") {
        return true;
      }
      var ekModal = document.getElementById("eventKeypadModal");
      if (ekModal && ekModal.style.display === "flex") {
        return true;
      }
      return false;
    }

    function hasGroupDataChanged(oldData, newData) {
      if (!oldData || !newData || !oldData.players || !newData.players) return false;
      if (oldData.players.length !== newData.players.length) return true;
      for (var p = 0; p < oldData.players.length; p++) {
        var oScores = oldData.players[p].scores || [];
        var nScores = newData.players[p].scores || [];
        for (var h = 0; h < 18; h++) {
          var ov = (oScores[h] === "" || oScores[h] === null || oScores[h] === undefined) ? "" : String(oScores[h]);
          var nv = (nScores[h] === "" || nScores[h] === null || nScores[h] === undefined) ? "" : String(nScores[h]);
          if (ov !== nv) return true;
        }
      }
      var oNotes = oldData.notes || [];
      var nNotes = newData.notes || [];
      for (var nh = 0; nh < 18; nh++) {
        var on = (oNotes[nh] === null || oNotes[nh] === undefined) ? "" : String(oNotes[nh]).trim();
        var nn = (nNotes[nh] === null || nNotes[nh] === undefined) ? "" : String(nNotes[nh]).trim();
        if (on !== nn) return true;
      }
      return false;
    }

    var pendingRefreshTimer = null;
    var hasQueuedRefreshAfterInFlight = false;
    var lastLocalFallbackAt = 0;

    // Safe background refresh (silently updates scores & live feed only when user is not actively editing)
    function silentRefreshGroupData(forceNow) {
      if (!currentGroupData || !currentGroupData.groupName) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (!isViewOnly && hasPendingLocalSave && pendingLocalHoles && pendingLocalHoles.length > 0) {
        if (!isDirty && !isSaving && (Date.now() - lastLocalFallbackAt > 6000)) {
          syncPendingOfflineHoles();
        }
        return;
      }
      if (isUserActivelyEditing()) return;
      if (isRefreshingGroup) {
        hasQueuedRefreshAfterInFlight = true;
        return;
      }

      var now = Date.now();
      var minCooldownMs = forceNow ? 800 : 2500;
      var elapsed = now - lastGroupSyncAt;
      if (elapsed < minCooldownMs) {
        var remainMs = Math.max(200, minCooldownMs - elapsed + 50);
        if (!pendingRefreshTimer) {
          pendingRefreshTimer = setTimeout(function () {
            pendingRefreshTimer = null;
            silentRefreshGroupData(forceNow);
          }, remainMs);
        }
        return;
      }

      if (pendingRefreshTimer) {
        clearTimeout(pendingRefreshTimer);
        pendingRefreshTimer = null;
      }
      hasQueuedRefreshAfterInFlight = false;
      var targetGroup = currentGroupData.groupName;
      isRefreshingGroup = true;
      lastGroupSyncAt = now;

      google.script.run
        .withSuccessHandler(function (freshData) {
          isRefreshingGroup = false;
          if (hasQueuedRefreshAfterInFlight) {
            hasQueuedRefreshAfterInFlight = false;
            silentRefreshGroupData(false);
          }
          if (!freshData) return;
          if (Array.isArray(freshData.birdieFeed)) {
            latestBirdieFeedCache = freshData.birdieFeed;
          }
          if (!currentGroupData || currentGroupData.groupName !== targetGroup) return;
          // Never overwrite UI state if user started editing or offline pending data appeared while request was in flight
          if (isUserActivelyEditing()) return;
          if (Array.isArray(freshData.birdieFeed)) {
            processBirdieFeed(freshData.birdieFeed);
          }

          if (!freshData.players) freshData.players = [];
          freshData.pars = getCourseOfficialPars();
          if (!freshData.notes || freshData.notes.length !== 18) {
            freshData.notes = new Array(18).fill("");
          }

          // Re-render DOM only when group scores/notes actually changed to prevent dropped button taps
          if (!hasGroupDataChanged(currentGroupData, freshData)) return;

          currentGroupData = freshData;
          updateServerBaseline(freshData);
          dirtyScoreCells = {};
          dirtyNoteHoles = {};
          isSaved = isHoleHasAnyInput(currentHole);
          savedHoleSnapshot = getHoleSnapshot(currentHole);
          renderHole(currentHole, true);

          var scModal = document.getElementById("scorecardModal");
          if (scModal && scModal.style.display === "flex") {
            renderScorecardModalBody();
          }
        })
        .withFailureHandler(function () {
          // Silently ignore background polling errors without showing error toasts
          isRefreshingGroup = false;
          hasQueuedRefreshAfterInFlight = false;
        })
        .getGroupData(targetGroup);
    }

    // ===== Shared Real-Time Birdie(-1) / Eagle(-2) Broadcast Banner (chronological box + auto-dismiss) =====
    var inMemorySeenBirdieMap = {};

    function loadSeenBirdieMap() {
      var combined = {};
      Object.keys(inMemorySeenBirdieMap).forEach(function (k) {
        combined[k] = inMemorySeenBirdieMap[k];
      });
      try {
        var raw = localStorage.getItem(SEEN_BIRDIES_STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            Object.keys(parsed).forEach(function (k) {
              var v = Number(parsed[k]) || 0;
              if (!combined[k] || v > Number(combined[k])) {
                combined[k] = v;
              }
            });
          }
        }
      } catch (e) { }
      inMemorySeenBirdieMap = combined;
      return combined;
    }

    function saveSeenBirdieMap(mapObj) {
      inMemorySeenBirdieMap = {};
      if (mapObj && typeof mapObj === "object") {
        Object.keys(mapObj).forEach(function (k) {
          inMemorySeenBirdieMap[k] = mapObj[k];
        });
      }
      try {
        localStorage.setItem(SEEN_BIRDIES_STORAGE_KEY, JSON.stringify(inMemorySeenBirdieMap));
      } catch (e) { }
    }

    function escapeHtmlText(str) {
      return String(str === null || str === undefined ? "" : str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatBirdieTime(ts) {
      if (!ts) return "";
      var d = new Date(Number(ts));
      if (isNaN(d.getTime())) return "";
      var hh = d.getHours();
      var mm = d.getMinutes();
      return (hh < 10 ? "0" + hh : String(hh)) + ":" + (mm < 10 ? "0" + mm : String(mm));
    }

    function hideBirdieBroadcastBanner() {
      if (birdieBannerTimer) {
        clearTimeout(birdieBannerTimer);
        birdieBannerTimer = null;
      }
      activeBirdieBannerItems = [];
      var banner = document.getElementById("birdieBroadcastBanner");
      if (banner) {
        banner.style.display = "none";
      }
    }

    var latestBirdieFeedCache = [];

    function buildBirdieItemHtml(item) {
      var isParMission = (item.type === "PAR_MISSION" || item.player === "__ALL_PAR__");
      var isParStreak = !isParMission && (item.type === "PAR_STREAK");
      var isEagle = !isParMission && !isParStreak && (Number(item.score) === -2 || item.type === "EAGLE");
      var timeStr = item.timeStr ? String(item.timeStr) : formatBirdieTime(item.ts);

      if (isParMission) {
        var pNamesSub = item.playersText ? (' <span style="font-size:11.5px; color:#dee2e6; font-weight:700;">(' + escapeHtmlText(item.playersText) + ')</span>') : '';
        return (
          '<div class="bb-item is-par-mission">' +
          '<div class="bb-item-main">' +
          '<span class="bb-badge par-mission">🤝 홀파미션</span>' +
          '<div class="bb-text">' +
          '<span class="bb-group">[' + escapeHtmlText(item.group) + ']</span>' +
          '<span class="bb-hole">' + Number(item.hole) + '번홀 전원 파 세이브!</span> 홀파미션 성공! 👏' +
          pNamesSub +
          '</div>' +
          '</div>' +
          (timeStr ? ('<span class="bb-time">' + timeStr + '</span>') : '') +
          '</div>'
        );
      } else if (isParStreak) {
        var streakNum = Number(item.score) || 3;
        var streakBadgeText = "⛳ 3연속파";
        var streakMsgText = "3연속파를 달성하셨습니다.";
        if (streakNum === 4) {
          var audiSvg =
            '<svg class="bb-badge-svg" width="38" height="15" viewBox="0 0 56 22" xmlns="http://www.w3.org/2000/svg">' +
            '<defs>' +
            '<linearGradient id="audiMetal" x1="0%" y1="0%" x2="0%" y2="100%">' +
            '<stop offset="0%" stop-color="#9ca3af"/>' +
            '<stop offset="30%" stop-color="#ffffff"/>' +
            '<stop offset="55%" stop-color="#4b5563"/>' +
            '<stop offset="80%" stop-color="#e5e7eb"/>' +
            '<stop offset="100%" stop-color="#1f2937"/>' +
            '</linearGradient>' +
            '</defs>' +
            '<rect x="0" y="0" width="56" height="22" rx="4" fill="#f3f4f6"/>' +
            '<g fill="none" stroke="#1f2937" stroke-width="2.7">' +
            '<circle cx="12.5" cy="11" r="7.2"/>' +
            '<circle cx="22.8" cy="11" r="7.2"/>' +
            '<circle cx="33.2" cy="11" r="7.2"/>' +
            '<circle cx="43.5" cy="11" r="7.2"/>' +
            '</g>' +
            '<g fill="none" stroke="url(#audiMetal)" stroke-width="1.9">' +
            '<circle cx="12.5" cy="11" r="7.2"/>' +
            '<circle cx="22.8" cy="11" r="7.2"/>' +
            '<circle cx="33.2" cy="11" r="7.2"/>' +
            '<circle cx="43.5" cy="11" r="7.2"/>' +
            '</g>' +
            '</svg>';
          streakBadgeText = audiSvg + "<span>아우디</span>";
          streakMsgText = "아우디(4연속파)를 달성하셨습니다.";
        } else if (streakNum >= 5) {
          var olympicSvg =
            '<svg class="bb-badge-svg" width="36" height="17" viewBox="0 0 50 24" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="0" y="0" width="50" height="24" rx="4" fill="#f8f9fa"/>' +
            '<g fill="none" stroke-width="2.2" stroke-linecap="round">' +
            '<circle cx="11.5" cy="9.2" r="6.2" stroke="#0081C8"/>' +
            '<circle cx="25" cy="9.2" r="6.2" stroke="#000000"/>' +
            '<circle cx="38.5" cy="9.2" r="6.2" stroke="#EE334E"/>' +
            '<circle cx="18.25" cy="15.2" r="6.2" stroke="#FCB131"/>' +
            '<circle cx="31.75" cy="15.2" r="6.2" stroke="#00A651"/>' +
            '</g>' +
            '</svg>';
          streakBadgeText = olympicSvg + "<span>올림픽</span>";
          streakMsgText = "올림픽(5연속파)를 달성하셨습니다.";
        }
        return (
          '<div class="bb-item is-par-streak">' +
          '<div class="bb-item-main">' +
          '<span class="bb-badge par-streak">' + streakBadgeText + '</span>' +
          '<div class="bb-text">' +
          '<span class="bb-group">[' + escapeHtmlText(item.group) + ']</span>' +
          escapeHtmlText(item.player) + '님 (' + Number(item.hole) + 'H) ' +
          '<span class="bb-hole">' + streakMsgText + '</span> 🎉' +
          '</div>' +
          '</div>' +
          (timeStr ? ('<span class="bb-time">' + timeStr + '</span>') : '') +
          '</div>'
        );
      } else {
        var badgeHtml = isEagle
          ? '<span class="bb-badge eagle">🦅 이글 (-2)</span>'
          : '<span class="bb-badge birdie">🐦 버디 (-1)</span>';
        var typeLabel = isEagle ? "이글" : "버디";
        return (
          '<div class="bb-item' + (isEagle ? ' is-eagle' : '') + '">' +
          '<div class="bb-item-main">' +
          badgeHtml +
          '<div class="bb-text">' +
          '<span class="bb-group">[' + escapeHtmlText(item.group) + ']</span>' +
          escapeHtmlText(item.player) + '님 ' +
          '<span class="bb-hole">' + Number(item.hole) + '번홀 ' + typeLabel + '</span> 축하합니다! 🎉' +
          '</div>' +
          '</div>' +
          (timeStr ? ('<span class="bb-time">' + timeStr + '</span>') : '') +
          '</div>'
        );
      }
    }

    function renderHallOfFameModalBody(feed, isLoading) {
      var bodyEl = document.getElementById("hallOfFameModalBody");
      if (!bodyEl) return;

      if (!Array.isArray(feed) || feed.length === 0) {
        if (isLoading) {
          bodyEl.innerHTML = '<div class="hof-empty-msg">⏳ 오늘의 기록을 불러오는 중입니다...</div>';
        } else {
          bodyEl.innerHTML = '<div class="hof-empty-msg">⛳ 아직 등록된 공지 기록이 없습니다.<br>오늘 첫 기록의 주인공이 되어보세요!</div>';
        }
        return;
      }

      var html = "";
      feed.forEach(function (item) {
        if (item) {
          html += buildBirdieItemHtml(item);
        }
      });
      bodyEl.innerHTML = html;
    }

    function openHallOfFameModal() {
      var modal = document.getElementById("hallOfFameModal");
      if (!modal) return;
      modal.style.display = "flex";

      renderHallOfFameModalBody(latestBirdieFeedCache, (!latestBirdieFeedCache || latestBirdieFeedCache.length === 0));

      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      google.script.run
        .withSuccessHandler(function (feed) {
          if (Array.isArray(feed)) {
            latestBirdieFeedCache = feed;
            // Mark items viewed inside Hall of Fame as seen so they don't pop up again as banners
            var seenMap = loadSeenBirdieMap();
            var seenChanged = false;
            feed.forEach(function (item) {
              if (item && item.id) {
                var itemTs = (Number(item.ts) > 100000) ? Number(item.ts) : Date.now();
                if (!seenMap[item.id] || Number(seenMap[item.id]) < itemTs) {
                  seenMap[item.id] = itemTs;
                  seenChanged = true;
                }
              }
            });
            if (seenChanged) saveSeenBirdieMap(seenMap);
          }
          renderHallOfFameModalBody(latestBirdieFeedCache, false);
        })
        .withFailureHandler(function () {
          renderHallOfFameModalBody(latestBirdieFeedCache, false);
        })
        .getHallOfFameFeed();
    }

    function closeHallOfFameModal() {
      var modal = document.getElementById("hallOfFameModal");
      if (modal) modal.style.display = "none";
    }

    function showBirdieBroadcastBanner(newItems) {
      if (!newItems || newItems.length === 0) return;
      var banner = document.getElementById("birdieBroadcastBanner");
      var listEl = document.getElementById("birdieBroadcastList");
      var titleEl = document.getElementById("birdieBroadcastTitle");
      if (!banner || !listEl) return;

      // Merge newly arriving Birdie/Eagle items chronologically if banner is already visible
      var mergedMap = {};
      activeBirdieBannerItems.forEach(function (item) {
        if (item && item.id) mergedMap[item.id] = item;
      });
      newItems.forEach(function (item) {
        if (item && item.id) mergedMap[item.id] = item;
      });

      var mergedList = [];
      Object.keys(mergedMap).forEach(function (k) {
        mergedList.push(mergedMap[k]);
      });
      mergedList.sort(function (a, b) {
        return (Number(a.ts) || 0) - (Number(b.ts) || 0);
      });
      if (mergedList.length > 5) {
        mergedList = mergedList.slice(mergedList.length - 5);
      }
      activeBirdieBannerItems = mergedList;

      if (titleEl) {
        titleEl.innerText = activeBirdieBannerItems.length > 1
          ? ("🎉 실시간 경기 속보 (" + activeBirdieBannerItems.length + "건)")
          : "🎉 실시간 경기 속보!";
      }

      var html = "";
      activeBirdieBannerItems.forEach(function (item) {
        html += buildBirdieItemHtml(item);
      });

      listEl.innerHTML = html;
      banner.style.display = "block";

      if (birdieBannerTimer) {
        clearTimeout(birdieBannerTimer);
      }
      // Display for 6s on 1 item, +2s per additional item (8s for 2, 10s for 3, 12s for 4...)
      var bannerDurationMs = 6000 + Math.max(0, activeBirdieBannerItems.length - 1) * 2000;
      birdieBannerTimer = setTimeout(function () {
        hideBirdieBroadcastBanner();
      }, bannerDurationMs);
    }

    function processBirdieFeed(feed) {
      if (!Array.isArray(feed)) return;
      latestBirdieFeedCache = feed;

      var seenMap = loadSeenBirdieMap();
      var activeIdMap = {};
      feed.forEach(function (item) {
        if (item && item.id) {
          activeIdMap[item.id] = true;
        }
      });

      // Clean up canceled Birdies/Eagles or reset sheet items from local seen map
      var seenChanged = false;
      Object.keys(seenMap).forEach(function (id) {
        if (!activeIdMap[id]) {
          delete seenMap[id];
          seenChanged = true;
        }
      });

      // Extract unseen or newly updated (ts bumped) events sorted chronologically (ascending)
      var unseenItems = [];
      feed.forEach(function (item) {
        if (!item || !item.id) return;
        var prevSeenTs = Number(seenMap[item.id]) || 0;
        var itemTs = Number(item.ts) || Date.now();
        if (!prevSeenTs || itemTs > prevSeenTs) {
          unseenItems.push(item);
          seenMap[item.id] = itemTs;
          seenChanged = true;
        }
      });

      if (seenChanged) {
        saveSeenBirdieMap(seenMap);
      }

      if (unseenItems.length > 0) {
        unseenItems.sort(function (a, b) {
          return (Number(a.ts) || 0) - (Number(b.ts) || 0);
        });
        showBirdieBroadcastBanner(unseenItems);
      }
    }

