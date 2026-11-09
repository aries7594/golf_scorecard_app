    var hmState = {
      open: false,
      hole: 1,
      teeKey: ACTIVE_COURSE.defaultTeeKey || "white", // Default selected tee key
      tab: "map", // "map" | "green"
      gpsWatchId: null,
      gpsActive: false,
      gpsSearching: false,
      outsideCourseNotified: false,
      gpsLat: null,
      gpsLon: null,
      gpsFixAt: 0, // Timestamp of last received GPS fix (used to discard stale positions)
      playerLat: null,
      playerLon: null,
      targetLat: null,
      targetLon: null,
      shotMeasuring: false,
      shotMeasureHole: null,
      lastShotYds: null,
      shotStartLat: null,
      shotStartLon: null,
      shotStartGpsLat: null,
      shotStartGpsLon: null,
      pinNormU: 0, // green pin offset in rotated meters
      pinNormV: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
      isDragging: false,
      isPinching: false,
      pinchStartDist: 0,
      pinchStartZoom: 1,
      pinchAnchorBX: 0,
      pinchAnchorBY: 0,
      preTouchSnapshot: null,
      tileCache: {},
      mapTransform: null,
      greenTransform: null
    };

    var CONTOUR_PALETTE = [
      [25, 86, 218],   // 0: Deep Blue (Lowest)
      [22, 128, 224],  // 1: Blue
      [18, 166, 214],  // 2: Cyan-Blue
      [28, 196, 172],  // 3: Turquoise
      [42, 212, 112],  // 4: Emerald Green
      [112, 216, 62],  // 5: Lime Green
      [182, 214, 48],  // 6: Yellow-Green
      [230, 194, 42],  // 7: Golden Yellow
      [242, 158, 38],  // 8: Amber
      [244, 124, 34],  // 9: Orange
      [240, 88, 32],   // 10: Deep Orange
      [232, 58, 36],   // 11: Red-Orange
      [216, 38, 42]    // 12: Deep Red (Highest)
    ];

    function calcYards(lat1, lon1, lat2, lon2) {
      var R = 6371000;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round((R * c) * 1.0936133);
    }

    function latLonToLocalMeters(lat, lon, refLat, refLon) {
      var east = (lon - refLon) * 111320 * Math.cos(refLat * Math.PI / 180);
      var north = (lat - refLat) * 110540;
      return { x: east, y: north };
    }

    function localMetersToLatLon(east, north, refLat, refLon) {
      var lat = refLat + (north / 110540);
      var lon = refLon + (east / (111320 * Math.cos(refLat * Math.PI / 180)));
      return { lat: lat, lon: lon };
    }

    function getHoleCourseObj(holeNum) {
      var idx = (Number(holeNum) || 1) - 1;
      if (idx < 0 || idx >= COURSE_DATA.length) idx = 0;
      return COURSE_DATA[idx];
    }

    function getCourseOfficialPars() {
      return COURSE_DATA.map(function (d) { return d.par; });
    }

    function getHoleTeeConfig(teeKey) {
      var key = teeKey || hmState.teeKey || "white";
      for (var i = 0; i < COURSE_TEE_LIST.length; i++) {
        if (COURSE_TEE_LIST[i].key === key) return COURSE_TEE_LIST[i];
      }
      return COURSE_TEE_LIST[0];
    }

    function isCourseMapGeometryReady() {
      return Boolean(
        Array.isArray(COURSE_DATA) &&
        COURSE_DATA.length === 18 &&
        COURSE_DATA[0] &&
        Array.isArray(COURSE_DATA[0].path) &&
        COURSE_DATA[0].path.length === 3
      );
    }

    function getHoleTeeYardage(holeNum, teeKey) {
      var cfg = getHoleTeeConfig(teeKey);
      if (!cfg || !Array.isArray(cfg.yds) || cfg.yds.length === 0) return 0;
      var idx = (Number(holeNum) || 1) - 1;
      if (idx < 0 || idx >= cfg.yds.length) idx = 0;
      return cfg.yds[idx];
    }

    function getHoleTeeLatLon(hObj, teeKey) {
      var backTee = hObj.path[0];
      var dogleg = hObj.path[1];
      var grn = hObj.path[2];
      var d1 = calcYards(backTee[0], backTee[1], dogleg[0], dogleg[1]);
      var d2 = calcYards(dogleg[0], dogleg[1], grn[0], grn[1]);
      var fullYds = d1 + d2;
      var teeYds = getHoleTeeYardage(hObj.hole, teeKey);
      var forwardYds = Math.max(0, fullYds - teeYds);
      var t = Math.min(0.68, forwardYds / Math.max(1, d1));
      return [
        backTee[0] + (dogleg[0] - backTee[0]) * t,
        backTee[1] + (dogleg[1] - backTee[1]) * t
      ];
    }

    function cycleHoleMapTee() {
      var curIdx = 0;
      for (var i = 0; i < COURSE_TEE_LIST.length; i++) {
        if (COURSE_TEE_LIST[i].key === hmState.teeKey) {
          curIdx = i;
          break;
        }
      }
      var nextCfg = COURSE_TEE_LIST[(curIdx + 1) % COURSE_TEE_LIST.length];
      hmState.teeKey = nextCfg.key;

      var hObj = getHoleCourseObj(hmState.hole);
      var usingLiveOnCourseGps = false;
      if (hmState.gpsActive && hmState.gpsLat !== null && hmState.gpsLon !== null) {
        var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
        if (distToCourse <= 2500) {
          usingLiveOnCourseGps = true;
        }
      }
      if (!usingLiveOnCourseGps) {
        var teePt = getHoleTeeLatLon(hObj, hmState.teeKey);
        hmState.playerLat = teePt[0];
        hmState.playerLon = teePt[1];
      }
      syncHoleMapUI();
    }

    function getCurrentShotDistanceYds() {
      if (!hmState.shotMeasuring) return 0;
      var mapDist = 0;
      if (hmState.shotStartLat !== null && hmState.shotStartLon !== null && hmState.playerLat !== null && hmState.playerLon !== null) {
        mapDist = calcYards(hmState.shotStartLat, hmState.shotStartLon, hmState.playerLat, hmState.playerLon);
      }
      var gpsDist = 0;
      if (hmState.gpsActive && hmState.shotStartGpsLat !== null && hmState.shotStartGpsLon !== null && hmState.gpsLat !== null && hmState.gpsLon !== null) {
        gpsDist = calcYards(hmState.shotStartGpsLat, hmState.shotStartGpsLon, hmState.gpsLat, hmState.gpsLon);
      }
      return Math.max(mapDist, gpsDist);
    }

    function toggleShotMeasure() {
      var hObj = getHoleCourseObj(hmState.hole);
      if (!hmState.shotMeasuring) {
        hmState.shotMeasuring = true;
        hmState.shotMeasureHole = hObj.hole;
        hmState.lastShotYds = null;
        hmState.shotStartLat = hmState.playerLat;
        hmState.shotStartLon = hmState.playerLon;
        hmState.shotStartGpsLat = hmState.gpsLat;
        hmState.shotStartGpsLon = hmState.gpsLon;
        if (!hmState.gpsActive && hmState.gpsWatchId === null) {
          startHoleMapGps(true);
        }
        showToast("🚀 비거리 측정을 시작합니다!\n이동하거나 파란 마커(🔵)를 움직이면 실시간 거리가 표시됩니다.", 4000);
        syncHoleMapUI();
      } else {
        var finalYds = getCurrentShotDistanceYds();
        hmState.shotMeasuring = false;
        hmState.shotMeasureHole = hObj.hole;
        hmState.lastShotYds = finalYds;
        hmState.shotStartLat = null;
        hmState.shotStartLon = null;
        hmState.shotStartGpsLat = null;
        hmState.shotStartGpsLon = null;

        var usingLiveOnCourseGps = false;
        if (hmState.gpsActive && hmState.gpsLat !== null && hmState.gpsLon !== null) {
          var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
          if (distToCourse <= 2500) {
            usingLiveOnCourseGps = true;
          }
        }
        if (usingLiveOnCourseGps) {
          hmState.playerLat = hmState.gpsLat;
          hmState.playerLon = hmState.gpsLon;
        } else {
          var teePt = getHoleTeeLatLon(hObj, hmState.teeKey);
          hmState.playerLat = teePt[0];
          hmState.playerLon = teePt[1];
        }
        syncHoleMapUI();
      }
    }

    // Compute Front / Center / Back green coordinates along the approach line
    function getGreenFrontCenterBack(hObj) {
      var gCenter = hObj.path[2];
      var approachFrom = hObj.path[1] || hObj.path[0];
      var apVec = latLonToLocalMeters(gCenter[0], gCenter[1], approachFrom[0], approachFrom[1]);
      var apLen = Math.sqrt(apVec.x * apVec.x + apVec.y * apVec.y) || 1;
      var ux = apVec.x / apLen;
      var uy = apVec.y / apLen;

      var minProj = 999999, maxProj = -999999;
      var frontPt = gCenter, backPt = gCenter;
      hObj.green.forEach(function (pt) {
        var m = latLonToLocalMeters(pt[0], pt[1], gCenter[0], gCenter[1]);
        var proj = m.x * ux + m.y * uy;
        if (proj < minProj) { minProj = proj; frontPt = pt; }
        if (proj > maxProj) { maxProj = proj; backPt = pt; }
      });
      return {
        front: frontPt,
        center: gCenter,
        back: backPt,
        ux: ux,
        uy: uy
      };
    }

    function initHoleMapPositions(holeNum) {
      var hObj = getHoleCourseObj(holeNum);
      var teePt = getHoleTeeLatLon(hObj, hmState.teeKey);
      var keepShotState = (hmState.shotMeasureHole === hObj.hole);
      hmState.hole = hObj.hole;
      hmState.playerLat = teePt[0];
      hmState.playerLon = teePt[1];
      hmState.targetLat = hObj.path[1][0];
      hmState.targetLon = hObj.path[1][1];
      if (!keepShotState) {
        hmState.shotMeasuring = false;
        hmState.shotMeasureHole = null;
        hmState.lastShotYds = null;
        hmState.shotStartLat = null;
        hmState.shotStartLon = null;
        hmState.shotStartGpsLat = null;
        hmState.shotStartGpsLon = null;
      }
      hmState.pinNormU = 0;
      hmState.pinNormV = 0;
      hmState.zoom = 1;
      hmState.panX = 0;
      hmState.panY = 0;

      if (hmState.gpsLat !== null && hmState.gpsLon !== null) {
        var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
        if (distToCourse <= 2500) {
          hmState.playerLat = hmState.gpsLat;
          hmState.playerLon = hmState.gpsLon;
        }
      }
    }

    function clampHoleMapPan(zoom, panX, panY, W, H) {
      var maxX = (W * Math.max(0.45, zoom - 0.3)) * 0.65 + 60;
      var maxY = (H * Math.max(0.45, zoom - 0.3)) * 0.65 + 80;
      return {
        x: Math.max(-maxX, Math.min(maxX, panX)),
        y: Math.max(-maxY, Math.min(maxY, panY))
      };
    }

    // ===== Real-Time Weather Cache & Integrated USGS 1m LiDAR (75-pt Fairway + 25-pt Green) Ballistics Engine =====
    // - Per-course weather cache is populated on demand from Open-Meteo using Hole 1 green coordinates.
    // - Before live weather arrives (loaded=false), only elevation slope adjustment is applied.
    var hmWeatherCache = {};

    function getActiveCourseWeatherKey() {
      if (typeof ACTIVE_COURSE !== "undefined" && ACTIVE_COURSE && ACTIVE_COURSE.key) {
        return ACTIVE_COURSE.key;
      }
      if (typeof SELECTED_COURSE_KEY !== "undefined" && SELECTED_COURSE_KEY) {
        return SELECTED_COURSE_KEY;
      }
      return "default";
    }

    function getActiveCourseWeather() {
      var key = getActiveCourseWeatherKey();
      if (!hmWeatherCache[key]) {
        hmWeatherCache[key] = { loaded: false, fetching: false, fetchedAt: 0, tempF: 70, humidity: 50, pressureHpa: 1010.0, windMph: 0, windFromDeg: 290 };
      }
      return hmWeatherCache[key];
    }

    function fetchCourseLiveWeather(forceRefresh) {
      var entry = getActiveCourseWeather();
      var now = Date.now();
      if (!forceRefresh && entry.loaded && (now - entry.fetchedAt) < 10 * 60 * 1000) {
        return;
      }
      if (entry.fetching) return;
      entry.fetching = true;

      // Extract Hole 1 green coordinates for active course (skip fetch if missing)
      var h1 = getHoleCourseObj(1);
      if (!h1 || !h1.path || !h1.path[2]) {
        entry.fetching = false;
        return;
      }
      var lat = Number(h1.path[2][0]).toFixed(4);
      var lon = Number(h1.path[2][1]).toFixed(4);
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
        "&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph";

      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          entry.fetching = false;
          if (data && data.current) {
            var c = data.current;
            if (typeof c.temperature_2m === "number") entry.tempF = c.temperature_2m;
            if (typeof c.relative_humidity_2m === "number") entry.humidity = c.relative_humidity_2m;
            if (typeof c.surface_pressure === "number") entry.pressureHpa = c.surface_pressure;
            if (typeof c.wind_speed_10m === "number") entry.windMph = c.wind_speed_10m;
            if (typeof c.wind_direction_10m === "number") entry.windFromDeg = c.wind_direction_10m;
            entry.loaded = true;
            entry.fetchedAt = Date.now();
            if (hmState.open) {
              syncHoleMapUI();
            }
          }
        })
        .catch(function () {
          entry.fetching = false;
        });
    }

    function getHoleRotationInfo(hObj) {
      var tee = hObj.path[0];
      var dogleg = hObj.path[1];
      var grn = hObj.path[2];
      var midLat = (tee[0] + dogleg[0] + grn[0]) / 3;
      var midLon = (tee[1] + dogleg[1] + grn[1]) / 3;
      var teeM = latLonToLocalMeters(tee[0], tee[1], midLat, midLon);
      var grnM = latLonToLocalMeters(grn[0], grn[1], midLat, midLon);
      var rotAngle = Math.atan2(grnM.x - teeM.x, grnM.y - teeM.y);
      var cosA = Math.cos(rotAngle);
      var sinA = Math.sin(rotAngle);

      function toRot(lat, lon) {
        var m = latLonToLocalMeters(lat, lon, midLat, midLon);
        return {
          u: m.x * cosA - m.y * sinA,
          v: m.x * sinA + m.y * cosA
        };
      }

      var rTee = toRot(tee[0], tee[1]);
      var rDog = toRot(dogleg[0], dogleg[1]);
      var rGrn = toRot(grn[0], grn[1]);
      var vMin = Math.min(rTee.v, rGrn.v) - 25.0;
      var vMax = Math.max(rTee.v, rGrn.v) + 20.0;

      var gMinLat = 999, gMaxLat = -999, gMinLon = 999, gMaxLon = -999;
      if (hObj.green && hObj.green.length) {
        for (var i = 0; i < hObj.green.length; i++) {
          var gp = hObj.green[i];
          if (gp[0] < gMinLat) gMinLat = gp[0];
          if (gp[0] > gMaxLat) gMaxLat = gp[0];
          if (gp[1] < gMinLon) gMinLon = gp[1];
          if (gp[1] > gMaxLon) gMaxLon = gp[1];
        }
      }

      return {
        midLat: midLat,
        midLon: midLon,
        rotAngle: rotAngle,
        holeBearingDeg: (rotAngle * 180 / Math.PI + 360) % 360,
        toRot: toRot,
        vMin: vMin,
        vMax: vMax,
        uDogleg: rDog.u,
        gMinLat: gMinLat,
        gMaxLat: gMaxLat,
        gMinLon: gMinLon,
        gMaxLon: gMaxLon
      };
    }

    // 2D Bicubic continuous surface interpolation over the 15x5 (75-point) fairway USGS 1m LiDAR grid
    function evalFairwayElevation75(sigma, tau, fwElev) {
      var gx = Math.max(0, Math.min(4, sigma * 4));
      var gy = Math.max(0, Math.min(14, tau * 14));
      var ix = Math.min(3, Math.floor(gx));
      var iy = Math.min(13, Math.floor(gy));
      var tx = gx - ix;
      var ty = gy - iy;

      function sampleFw(r, c) {
        var rr = Math.max(0, Math.min(14, r));
        var cc = Math.max(0, Math.min(4, c));
        return fwElev[rr * 5 + cc];
      }

      var colVals = [];
      for (var dr = -1; dr <= 2; dr++) {
        var r = iy + dr;
        colVals.push(cubicHermite(
          sampleFw(r, ix - 1),
          sampleFw(r, ix),
          sampleFw(r, ix + 1),
          sampleFw(r, ix + 2),
          tx
        ));
      }
      return cubicHermite(colVals[0], colVals[1], colVals[2], colVals[3], ty);
    }

    // Return USGS 1m LiDAR elevation (m) for any (lat, lon) on the hole (combines 25-pt green + 75-pt fairway)
    function getCourseTerrainElevation(hObj, lat, lon) {
      if (!hObj) return 0;
      var info = getHoleRotationInfo(hObj);

      // 1) Inside green/fringe bounds: prioritize high-resolution 5x5 green LiDAR grid (elev25)
      var padLat = 0.000035;
      var padLon = 0.000045;
      if (hObj.elev25 && hObj.elev25.length === 25 &&
        lat >= info.gMinLat - padLat && lat <= info.gMaxLat + padLat &&
        lon >= info.gMinLon - padLon && lon <= info.gMaxLon + padLon) {
        var latSpan = Math.max(1e-7, info.gMaxLat - info.gMinLat);
        var lonSpan = Math.max(1e-7, info.gMaxLon - info.gMinLon);
        var latFrac = Math.max(0, Math.min(1, (lat - info.gMinLat) / latSpan));
        var lonFrac = Math.max(0, Math.min(1, (lon - info.gMinLon) / lonSpan));
        return evalGreenElevation25(lonFrac, latFrac, hObj.elev25);
      }

      // 2) Tee, fairway, rough, and bunkers: interpolate over 15x5 (75-pt) fairway LiDAR grid (fwElev)
      if (hObj.fwElev && hObj.fwElev.length === 75) {
        var rm = info.toRot(lat, lon);
        var vSpan = Math.max(10, info.vMax - info.vMin);
        var tau = Math.max(0, Math.min(1, (rm.v - info.vMin) / vSpan));
        var uCenter = 2 * (1 - tau) * tau * info.uDogleg;
        var sigma = Math.max(0, Math.min(1, (rm.u - uCenter + 45.0) / 90.0));
        return evalFairwayElevation75(sigma, tau, hObj.fwElev);
      }

      // 3) Fallback: green center elevation (returns 0 for both ends if hole lacks LiDAR data -> 0 slope adj)
      if (hObj.elev25 && hObj.elev25.length === 25) {
        return hObj.elev25[12];
      }
      return 0;
    }

    // Compute Plays-Like adjusted yardage combining elevation slope, live wind, temperature, pressure, and humidity
    function calcPlaysLikeShot(hObj, fromLat, fromLon, toLat, toLon, baseYdsOverride) {
      var straightYds = (typeof baseYdsOverride === "number")
        ? baseYdsOverride
        : calcYards(fromLat, fromLon, toLat, toLon);

      var elevFromM = getCourseTerrainElevation(hObj, fromLat, fromLon);
      var elevToM = getCourseTerrainElevation(hObj, toLat, toLon);
      var elevDiffM = elevToM - elevFromM;
      var elevDiffYds = elevDiffM * 1.09361;

      // 1) Slope ballistics adjustment: 1.08x elevation delta reflecting 45-50 deg iron/wedge descent angle
      var slopeScale = (straightYds < 18) ? (straightYds / 18) : 1.0;
      var slopeDeltaYds = elevDiffYds * 1.08 * slopeScale;

      // 2) Live wind + air density (temperature, barometric pressure, humidity) ballistics adjustment
      var windDeltaYds = 0;
      var envDeltaYds = 0;
      var headwindMph = 0;
      var crosswindMph = 0;
      var wx = getActiveCourseWeather();

      var shotVec = latLonToLocalMeters(toLat, toLon, fromLat, fromLon);
      var shotBearingRad = Math.atan2(shotVec.x, shotVec.y); // 0 = North, PI/2 = East

      if (wx && wx.loaded) {
        var windFromRad = (wx.windFromDeg * Math.PI) / 180;
        // Positive (+): headwind from target; Negative (-): tailwind from behind
        headwindMph = wx.windMph * Math.cos(windFromRad - shotBearingRad);
        // Positive (+): right-to-left crosswind; Negative (-): left-to-right crosswind
        crosswindMph = wx.windMph * Math.sin(windFromRad - shotBearingRad);

        var windPct = 0;
        if (headwindMph >= 0) {
          // Headwind increases spin/apex, causing asymmetric distance loss (~1.05%/mph + strong-wind factor)
          windPct = headwindMph * (0.0102 + 0.00018 * Math.min(25, headwindMph));
        } else {
          // Tailwind reduces spin/apex, yielding roughly half the magnitude as gain (-0.55%/mph)
          windPct = headwindMph * 0.0055;
        }
        // Strong crosswind increases air-drag vector, causing slight carry loss
        if (Math.abs(crosswindMph) > 6) {
          windPct += (Math.abs(crosswindMph) - 6) * 0.0012;
        }
        var flightScale = Math.min(1.0, Math.max(0.2, straightYds / 60));
        // Cap air-ballistics reference carry at single-shot max carry (250y) even on 300-550y Par 4/5 holes
        var effectiveCarryYds = Math.min(250, straightYds);
        windDeltaYds = effectiveCarryYds * windPct * flightScale;

        // 3) Air density adjustment from temperature (ref 70F), station pressure (ref 1013.25hPa), and humidity (ref 50%)
        var tempDelta = (70 - wx.tempF) * 0.00133 * effectiveCarryYds;
        var pressureDelta = -((1013.25 - wx.pressureHpa) / 10) * 0.0032 * effectiveCarryYds;
        var humidDelta = -((wx.humidity - 50) / 50) * 0.0025 * effectiveCarryYds;
        envDeltaYds = (tempDelta + pressureDelta + humidDelta) * flightScale;
      }

      var totalDeltaYds = slopeDeltaYds + windDeltaYds + envDeltaYds;
      var playsLikeYds = Math.max(1, Math.round(straightYds + totalDeltaYds));

      return {
        straightYds: straightYds,
        playsLikeYds: playsLikeYds,
        elevFromM: elevFromM,
        elevToM: elevToM,
        elevDiffM: elevDiffM,
        slopeDeltaYds: slopeDeltaYds,
        windDeltaYds: windDeltaYds,
        envDeltaYds: envDeltaYds,
        headwindMph: headwindMph,
        crosswindMph: crosswindMph,
        weatherLoaded: !!(wx && wx.loaded)
      };
    }

    function getRelativeWindLabelAndArrow(hObj) {
      var wx = getActiveCourseWeather();
      var info = getHoleRotationInfo(hObj);
      if (!wx || !wx.loaded) {
        return {
          loaded: false,
          arrowDeg: 0,
          arrowChar: "",
          speedMph: 0,
          speedText: "기상수신중",
          relText: "풍향 대기"
        };
      }
      // Direction wind is blowing toward (0=N, 90=E, 180=S, 270=W)
      var windToDeg = (wx.windFromDeg + 180) % 360;
      // Screen-relative wind arrow angle after subtracting hole rotation (tee at bottom -> green at top = 0 deg)
      var arrowDeg = (windToDeg - info.holeBearingDeg + 360) % 360;
      var speedMph = Math.round(wx.windMph);

      var arrowChar = "─";
      if (arrowDeg >= 337.5 || arrowDeg < 22.5) arrowChar = "↑";
      else if (arrowDeg >= 22.5 && arrowDeg < 67.5) arrowChar = "↗";
      else if (arrowDeg >= 67.5 && arrowDeg < 112.5) arrowChar = "→";
      else if (arrowDeg >= 112.5 && arrowDeg < 157.5) arrowChar = "↘";
      else if (arrowDeg >= 157.5 && arrowDeg < 202.5) arrowChar = "↓";
      else if (arrowDeg >= 202.5 && arrowDeg < 247.5) arrowChar = "↙";
      else if (arrowDeg >= 247.5 && arrowDeg < 292.5) arrowChar = "←";
      else arrowChar = "↖";

      var relText = "미풍";
      if (wx.windMph >= 1.5) {
        if (arrowChar === "↑") relText = "뒷바람 ↑";
        else if (arrowChar === "↗") relText = "뒤·좌→우 ↗";
        else if (arrowChar === "→") relText = "좌→우 →";
        else if (arrowChar === "↘") relText = "맞·좌→우 ↘";
        else if (arrowChar === "↓") relText = "맞바람 ↓";
        else if (arrowChar === "↙") relText = "맞·우→좌 ↙";
        else if (arrowChar === "←") relText = "우→좌 ←";
        else relText = "뒤·우→좌 ↖";
      }

      return {
        loaded: true,
        arrowDeg: arrowDeg,
        arrowChar: arrowChar,
        speedMph: speedMph,
        speedText: speedMph + " mph",
        relText: relText
      };
    }

    function formatSignedYds(val) {
      var r = Math.round(val);
      if (r > 0) return "+" + r + "y";
      if (r < 0) return r + "y";
      return "0y";
    }

    function formatSignedMeters(val) {
      var r = Math.round(val * 10) / 10;
      if (r > 0) return "+" + r.toFixed(1) + "m";
      if (r < 0) return r.toFixed(1) + "m";
      return "0.0m";
    }

    function updateHoleMapWindAndPlaysLikeUI(hObj, fcb, pLat, pLon, fStraight, cStraight, bStraight) {
      var plCenter = calcPlaysLikeShot(hObj, pLat, pLon, fcb.center[0], fcb.center[1], cStraight);
      hmState.lastPlaysLikeCenter = plCenter;
      var windInfo = getRelativeWindLabelAndArrow(hObj);

      var mainEl = document.getElementById("hmPlaysLikeMain");
      var subEl = document.getElementById("hmPlaysLikeSub");
      if (mainEl) {
        mainEl.innerText = plCenter.playsLikeYds + "y";
      }
      if (subEl) {
        var slopeSign = (plCenter.elevDiffM > 0.3) ? "▲" : (plCenter.elevDiffM < -0.3 ? "▼" : "─");
        var slopeStr = slopeSign + Math.abs(plCenter.elevDiffM).toFixed(1) + "m";
        if (windInfo.loaded) {
          subEl.innerText = "(" + slopeStr + ", " + windInfo.arrowChar + windInfo.speedMph + "mph)";
        } else {
          subEl.innerText = "(" + slopeStr + ")";
        }
      }

      var windBtn = document.getElementById("hmWindFloatBtn");
      if (windBtn) {
        windBtn.style.display = (hmState.tab === "map") ? "flex" : "none";
      }
      var arrowGroup = document.getElementById("hmWindArrowGroup");
      if (arrowGroup) {
        arrowGroup.setAttribute("transform", "rotate(" + windInfo.arrowDeg.toFixed(1) + " 18 18)");
      }
      var spdEl = document.getElementById("hmWindSpeedLbl");
      if (spdEl) spdEl.innerText = windInfo.speedText;
      var relEl = document.getElementById("hmWindRelLbl");
      if (relEl) relEl.innerText = windInfo.relText;
    }

    var plDetailTimer = null;

    // Plays-like adjustment breakdown popup: one line per factor + close button, auto-closes after 15s
    function showPlaysLikeDetailToast() {
      var hObj = getHoleCourseObj(hmState.hole);
      var pl = hmState.lastPlaysLikeCenter;
      if (!pl) {
        var fcb = getGreenFrontCenterBack(hObj);
        pl = calcPlaysLikeShot(hObj, hmState.playerLat, hmState.playerLon, fcb.center[0], fcb.center[1]);
      }
      var wx = getActiveCourseWeather();
      var windInfo = getRelativeWindLabelAndArrow(hObj);
      var slopeDir = (pl.elevDiffM > 0.2) ? "오르막" : (pl.elevDiffM < -0.2 ? "내리막" : "평지");
      var title = "📐 HOLE " + hObj.hole + " 지형·날씨 보정 상세";
      var lines = [
        "직선 " + pl.straightYds + "y → 보정 " + pl.playsLikeYds + "y",
        "• 지형 고저차: " + formatSignedMeters(pl.elevDiffM) + " " + slopeDir + " (" + formatSignedYds(pl.slopeDeltaYds) + ")"
      ];
      if (wx && wx.loaded) {
        lines.push("• 실시간 바람: " + Math.round(wx.windMph) + "mph " + windInfo.relText + " (" + formatSignedYds(pl.windDeltaYds) + ")");
        lines.push("• 기온·습도·기압: " + Math.round(wx.tempF) + "°F · " + Math.round(wx.humidity) + "% · " + Math.round(wx.pressureHpa) + "hPa (" + formatSignedYds(pl.envDeltaYds) + ")");
      } else {
        lines.push("• 실시간 기상 데이터를 수신 중입니다...");
        fetchCourseLiveWeather(true);
      }
      var pop = document.getElementById("plDetailPop");
      if (!pop) {
        showToast(title + "\n" + lines.join("\n"), 5500);
        return;
      }
      document.getElementById("plDetailTitle").textContent = title;
      document.getElementById("plDetailBody").innerHTML = lines.map(function (t, i) {
        return '<div class="' + (i === 0 ? 'pl-detail-sum' : 'pl-detail-line') + '">' + escapeHtmlText(t) + '</div>';
      }).join("");
      pop.style.display = "block";
      if (plDetailTimer) clearTimeout(plDetailTimer);
      plDetailTimer = setTimeout(closePlaysLikeDetail, 15000);
    }

    function closePlaysLikeDetail() {
      if (plDetailTimer) {
        clearTimeout(plDetailTimer);
        plDetailTimer = null;
      }
      var pop = document.getElementById("plDetailPop");
      if (pop) pop.style.display = "none";
    }

    function openHoleMapModal(defaultTab) {
      if (!isCourseMapGeometryReady()) {
        if (SELECTED_COURSE_KEY && typeof ensureCourseLoaded === "function") {
          showToast("⏳ 코스 지도 데이터를 불러오는 중입니다...", 2500);
          ensureCourseLoaded(SELECTED_COURSE_KEY, function (loadedCourse) {
            if (loadedCourse) {
              rebuildActiveCourseVars(T_CFG, ACTIVE_TOURNAMENT_SCOPE);
              applyCourseConfigUI();
              openHoleMapModal(defaultTab);
            } else {
              showToast("📡 통신 음영지역이라 코스 지도를 불러오지 못했습니다.\n신호가 잡히는 곳에서 다시 눌러주세요.", 4500);
            }
          });
        } else {
          showToast("📡 코스 지도 데이터를 불러올 수 없습니다.", 3500);
        }
        return;
      }
      hmState.open = true;
      hmState.tab = defaultTab || "map";
      var targetHole = currentHole || 1;
      dropStaleGpsFix(); // Discard stale GPS position (>20s old) left over from before GPS was paused
      if (hmState.hole === targetHole && hmState.playerLat !== null && hmState.targetLat !== null) {
        hmState.zoom = 1;
        hmState.panX = 0;
        hmState.panY = 0;
        if (hmState.gpsLat !== null && hmState.gpsLon !== null) {
          var hObjSame = getHoleCourseObj(targetHole);
          var distSame = calcYards(hmState.gpsLat, hmState.gpsLon, hObjSame.path[2][0], hObjSame.path[2][1]);
          if (distSame <= 2500) {
            hmState.playerLat = hmState.gpsLat;
            hmState.playerLon = hmState.gpsLon;
          }
        }
      } else {
        initHoleMapPositions(targetHole);
      }
      document.getElementById("holeMapModal").style.display = "flex";
      maybeShowInAppGuide();
      maybeShowApproxGuide();
      bindHoleMapCanvasEvents();
      fetchCourseLiveWeather(false);
      if (!hmState.gpsActive && hmState.gpsWatchId === null) {
        startHoleMapGps(true);
      } else if (hmState.gpsActive && hmState.gpsLat !== null && hmState.gpsLon !== null) {
        var hObj = getHoleCourseObj(hmState.hole);
        var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
        if (distToCourse > 2500 && !hmState.outsideCourseNotified) {
          hmState.outsideCourseNotified = true;
          showToast("📍 현재 골프장 외부에 계셔서 티박스 기준으로 표시합니다.", 5000);
        }
      }
      syncHoleMapUI();
    }

    function pauseHoleMapGpsForBattery() {
      cancelGpsWarmup(); // Cancel warmup timer when turning GPS off so delayed callbacks cannot inject stale coordinates
      if (hmState.gpsWatchId !== null && typeof hmState.gpsWatchId === "number" && navigator.geolocation) {
        navigator.geolocation.clearWatch(hmState.gpsWatchId);
      }
      hmState.gpsWatchId = null;
      hmState.gpsSearching = false;
      hmState.gpsActive = false;
      hmState.lastRenderedGpsLat = null;
      hmState.lastRenderedGpsLon = null;
    }

    function closeHoleMapModal() {
      hmState.open = false;
      closePlaysLikeDetail();
      document.getElementById("holeMapModal").style.display = "none";
      // Auto-pause high-accuracy GPS when closing course map (unless shot-distance tracking is active) to save battery
      if (!hmState.shotMeasuring) {
        pauseHoleMapGpsForBattery();
      }
      silentRefreshGroupData(false);
    }

    // Stop shot-distance tracking & pause GPS when saving and advancing to the next hole
    //    (keep active if course map is open or if saving an earlier hole behind the tracked hole)
    function stopShotMeasureOnSave(savedHole) {
      if (hmState.open || !hmState.shotMeasuring || savedHole < hmState.shotMeasureHole) return;
      hmState.shotMeasuring = false;
      hmState.shotMeasureHole = null;
      hmState.lastShotYds = null;
      hmState.shotStartLat = null;
      hmState.shotStartLon = null;
      hmState.shotStartGpsLat = null;
      hmState.shotStartGpsLon = null;
      pauseHoleMapGpsForBattery();
    }

    function stepHoleMapHole(delta) {
      closePlaysLikeDetail();
      var nextH = hmState.hole + delta;
      if (nextH < 1) nextH = 18;
      if (nextH > 18) nextH = 1;
      initHoleMapPositions(nextH);
      syncHoleMapUI();
    }

    function switchHoleMapTab(tabName) {
      hmState.tab = tabName;
      hmState.zoom = 1;
      hmState.panX = 0;
      hmState.panY = 0;
      syncHoleMapUI();
    }

    function toggleHoleMapGreenTab() {
      switchHoleMapTab(hmState.tab === "green" ? "map" : "green");
    }

    function openGpsPermissionModal() {
      var m = document.getElementById("gpsPermissionModal");
      if (!m) return;
      var ua = navigator.userAgent || "";
      var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var isChromeIOS = /CriOS/i.test(ua);
      var safariEl = document.getElementById("gpsPermSafari");
      var chromeEl = document.getElementById("gpsPermChrome");
      var androidEl = document.getElementById("gpsPermAndroid");
      if (!isIOS) {
        if (safariEl) safariEl.style.display = "none";
        if (chromeEl) chromeEl.style.display = "none";
        if (androidEl) androidEl.style.display = "block";
        document.getElementById("gpsPermTitle").textContent = "📍 안드로이드 GPS 권한 켜는 법";
        document.getElementById("gpsPermSub").textContent = "위치 권한이 꺼져 있어 GPS 거리를 표시할 수 없습니다.";
      } else {
        if (safariEl) safariEl.style.display = isChromeIOS ? "none" : "block";
        if (chromeEl) chromeEl.style.display = isChromeIOS ? "block" : "none";
        if (androidEl) androidEl.style.display = "none";
        document.getElementById("gpsPermTitle").textContent = isChromeIOS ? "📍 크롬 GPS 권한 켜는 법" : "📍 아이폰 GPS 권한 켜는 법";
        document.getElementById("gpsPermSub").textContent = isChromeIOS
          ? "크롬에 위치 권한이 꺼져 있어 GPS 거리를 표시할 수 없습니다."
          : "위치 권한이 꺼져 있어 GPS 거리를 표시할 수 없습니다.";
      }
      m.style.display = "flex";
    }

    function closeGpsPermissionModal() {
      var m = document.getElementById("gpsPermissionModal");
      if (m) m.style.display = "none";
    }

    function retryGpsFromPermissionModal() {
      closeGpsPermissionModal();
      startHoleMapGps(false);
    }

    // ===== In-App Browser Guide (Band, Instagram, Line, etc.) — iOS only, excludes Safari/Chrome/Standalone PWA =====
    var inAppNameCache = null;
    var inAppGuideShown = false;

    function detectInAppBrowserName() {
      if (inAppNameCache !== null) return inAppNameCache;
      var ua = navigator.userAgent || "";
      var name = "";
      if (/iPhone|iPad|iPod/i.test(ua) && window.navigator.standalone !== true && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) {
        if (/KAKAOTALK/i.test(ua)) name = "카카오톡";
        else if (/BAND\//i.test(ua)) name = "밴드";
        else if (/Instagram/i.test(ua)) name = "인스타그램";
        else if (/FBAN|FBAV|FB_IAB/i.test(ua)) name = "페이스북";
        else if (/Line\//i.test(ua)) name = "라인";
        else if (/NAVER/i.test(ua)) name = "네이버";
        else if (/DaumApps/i.test(ua)) name = "다음";
        else if (!/Safari\//i.test(ua)) name = "다른";
      }
      inAppNameCache = name;
      return name;
    }

    // When opening course map in an in-app browser: skip guide if GPS succeeds within 10s (no-op on Safari/Chrome)
    function maybeShowInAppGuide() {
      if (inAppGuideShown || !detectInAppBrowserName()) return;
      setTimeout(function () {
        if (inAppGuideShown || !hmState.open || hmState.gpsActive) return;
        openInAppGuideModal();
      }, 10000);
    }

    function openInAppGuideModal() {
      var m = document.getElementById("inAppGuideModal");
      if (!m) return;
      inAppGuideShown = true;
      document.getElementById("inAppName").textContent = detectInAppBrowserName() || "다른";
      m.style.display = "flex";
    }

    function closeInAppGuideModal() {
      var m = document.getElementById("inAppGuideModal");
      if (m) m.style.display = "none";
    }

    function copyAppLinkForSafari() {
      var url = window.location.href;
      var btn = document.getElementById("inAppCopyBtn");
      function done() {
        btn.textContent = "✅ 복사됨! Safari 주소창에 붙여넣기 하세요";
        btn.style.background = "#0ca678";
      }
      function fail() {
        document.getElementById("inAppUrlText").textContent = url;
        document.getElementById("inAppUrlBox").style.display = "block";
      }
      function legacyCopy() {
        try {
          var ta = document.createElement("textarea");
          ta.value = url;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.top = "-1000px";
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, url.length);
          var ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return ok;
        } catch (e) {
          return false;
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () {
          if (legacyCopy()) done();
          else fail();
        });
      } else if (legacyCopy()) {
        done();
      } else {
        fail();
      }
    }

    // ===== 'Precise Location Off' (Approximate Location) Detector — zero behavior change until triggered =====
    // Triggered only within ~10km of the course when GPS accuracy stays >1km for 20+ seconds
    // -> Fall back to tee-box position + show guide once; auto-recover immediately if accuracy <=1km arrives
    // Since approximate location updates infrequently, schedule a single 20s check timer
    var gpsApprox = { since: null, mode: false, notified: false, timer: null, lastAcc: 0 };

    function checkApproxLocation(lat, lon, accM) { // true = ignore this GPS fix
      if (typeof accM !== "number" || !isFinite(accM) || accM <= 1000) {
        resetApproxStreak();
        gpsApprox.mode = false;
        return false;
      }
      var hObjA = getHoleCourseObj(hmState.hole);
      if (calcYards(lat, lon, hObjA.path[2][0], hObjA.path[2][1]) > 11000) { // Skip check when >10km away from the golf course (e.g. testing from home)
        resetApproxStreak();
        return false;
      }
      gpsApprox.lastAcc = accM;
      if (gpsApprox.since === null) {
        gpsApprox.since = Date.now();
        gpsApprox.timer = setTimeout(function () {
          gpsApprox.timer = null;
          if (gpsApprox.since !== null) enterApproxMode();
        }, 20000);
      }
      if (Date.now() - gpsApprox.since >= 20000) enterApproxMode();
      return gpsApprox.mode; // Returns false during first 20s -> behaves identically to normal GPS
    }

    function resetApproxStreak() {
      gpsApprox.since = null;
      if (gpsApprox.timer) {
        clearTimeout(gpsApprox.timer);
        gpsApprox.timer = null;
      }
    }

    function enterApproxMode() {
      if (!gpsApprox.mode) {
        gpsApprox.mode = true;
        hmState.gpsLat = null;
        hmState.gpsLon = null;
        hmState.lastRenderedGpsLat = null;
        hmState.lastRenderedGpsLon = null;
        var teePt = getHoleTeeLatLon(getHoleCourseObj(hmState.hole), hmState.teeKey);
        hmState.playerLat = teePt[0];
        hmState.playerLon = teePt[1];
        if (hmState.open) syncHoleMapUI();
      }
      maybeShowApproxGuide();
    }

    // Show modal only while course map is open (if triggered while closed, show next time map opens)
    function maybeShowApproxGuide() {
      if (gpsApprox.mode && !gpsApprox.notified && hmState.open) {
        gpsApprox.notified = true;
        openGpsApproxModal(gpsApprox.lastAcc);
      }
    }

    function openGpsApproxModal(accM) {
      var m = document.getElementById("gpsApproxModal");
      if (!m) return;
      var ua = navigator.userAgent || "";
      var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var steps;
      if (isIOS && /CriOS/i.test(ua)) {
        steps = '<div>1️⃣ <b>Settings ⚙️ (설정)</b> ➔ 맨 아래 <b>Apps (앱)</b> ➔ <b>Chrome</b></div>' +
          '<div>2️⃣ <b>Location (위치)</b> ➔ <b>Precise Location (정확한 위치)</b> <b>켜기</b></div>';
      } else if (isIOS) {
        steps = '<div>1️⃣ <b>Settings ⚙️ (설정)</b> ➔ <b>Privacy &amp; Security (개인정보 보호 및 보안)</b></div>' +
          '<div>2️⃣ <b>Location Services (위치 서비스)</b> ➔ <b>Safari Websites (Safari 웹 사이트)</b></div>' +
          '<div>3️⃣ <b>Precise Location (정확한 위치)</b> <b>켜기</b></div>';
      } else {
        steps = '<div>1️⃣ <b>설정</b> ➔ <b>위치</b> ➔ <b>앱 위치 권한</b></div>' +
          '<div>2️⃣ 사용 중인 브라우저(<b>Chrome</b> 등) ➔ <b>정확한 위치 사용</b> <b>켜기</b></div>';
      }
      document.getElementById("gpsApproxAcc").textContent = (accM / 1000).toFixed(1) + "km";
      document.getElementById("gpsApproxHead").textContent = isIOS ? "켜는 법 (아이폰)" : "켜는 법 (안드로이드)";
      document.getElementById("gpsApproxSteps").innerHTML = steps;
      m.style.display = "flex";
    }

    function closeGpsApproxModal() {
      var m = document.getElementById("gpsApproxModal");
      if (m) m.style.display = "none";
    }

    function retryGpsFromApproxModal() {
      closeGpsApproxModal();
      resetApproxStreak();
      gpsApprox.notified = false; // Reset flag so guide can re-notify after another 20s if still approximate
      pauseHoleMapGpsForBattery();
      startHoleMapGps(false);
    }

    // ===== Discard Stale Position: drop last GPS fix (>20s old) from while GPS was off =====
    // - Reset blue player marker to current tee if it was sitting on stale GPS (keep manually dragged position)
    // - Checked when opening course map and when resuming GPS (including screen wake)
    function dropStaleGpsFix() {
      if (hmState.gpsWatchId !== null && hmState.gpsActive) return; // Keep as-is while GPS is actively streaming fixes
      if (hmState.gpsLat === null || hmState.gpsLon === null) return;
      if (Date.now() - (hmState.gpsFixAt || 0) <= 20000) return; // Reuse recent fix if <=20s old
      var markerOnGps = hmState.playerLat !== null && hmState.playerLon !== null &&
        calcYards(hmState.playerLat, hmState.playerLon, hmState.gpsLat, hmState.gpsLon) <= 3;
      hmState.gpsLat = null;
      hmState.gpsLon = null;
      hmState.lastRenderedGpsLat = null;
      hmState.lastRenderedGpsLon = null;
      if (markerOnGps) {
        var teePt = getHoleTeeLatLon(getHoleCourseObj(hmState.hole), hmState.teeKey);
        hmState.playerLat = teePt[0];
        hmState.playerLon = teePt[1];
      }
    }

    // ===== Post-Wake GPS Warmup Filter: wait up to 8s for an accurate fix (<=50m accuracy) =====
    // - Accept immediately as soon as a <=50m fix arrives
    // - If no <=50m fix arrives within 8s, use the best fix received so far (never wait forever)
    var gpsWarmup = { until: 0, best: null, timer: null };

    function startGpsWarmup() {
      cancelGpsWarmup();
      gpsWarmup.until = Date.now() + 8000;
      gpsWarmup.timer = setTimeout(function () {
        var b = gpsWarmup.best;
        gpsWarmup.timer = null;
        gpsWarmup.until = 0;
        gpsWarmup.best = null;
        if (b && hmState.gpsWatchId !== null) { // Apply only if GPS is still enabled (never inject after GPS was turned off)
          applyIncomingGpsPosition(b.lat, b.lon, b.acc);
        }
      }, 8000);
    }

    function cancelGpsWarmup() {
      if (!gpsWarmup) return;
      if (gpsWarmup.timer) {
        clearTimeout(gpsWarmup.timer);
        gpsWarmup.timer = null;
      }
      gpsWarmup.until = 0;
      gpsWarmup.best = null;
    }

    function holdRoughFixDuringWarmup(lat, lon, accM) { // true = skip rendering this coarse warmup fix for now
      if (!gpsWarmup.until) return false;
      if (typeof accM === "number" && isFinite(accM) && accM > 50 && Date.now() < gpsWarmup.until) {
        if (!gpsWarmup.best || accM < gpsWarmup.best.acc) gpsWarmup.best = { lat: lat, lon: lon, acc: accM };
        return true;
      }
      cancelGpsWarmup(); // Good fix (<=50m) arrived or 8s elapsed -> end warmup
      return false;
    }

    function applyIncomingGpsPosition(lat, lon, accM) {
      if (!isFinite(lat) || !isFinite(lon)) return;
      closeGpsPermissionModal();
      if (checkApproxLocation(lat, lon, accM)) return; // Ignore GPS coordinates while in Approximate Location mode
      if (holdRoughFixDuringWarmup(lat, lon, accM)) return; // Filter out coarse initial fixes right after GPS wake (up to 8s)
      var wasActive = hmState.gpsActive;
      var baseLat = (hmState.lastRenderedGpsLat !== undefined && hmState.lastRenderedGpsLat !== null) ? hmState.lastRenderedGpsLat : null;
      var baseLon = (hmState.lastRenderedGpsLon !== undefined && hmState.lastRenderedGpsLon !== null) ? hmState.lastRenderedGpsLon : null;
      hmState.gpsSearching = false;
      hmState.gpsActive = true;
      hmState.gpsLat = lat;
      hmState.gpsLon = lon;
      hmState.gpsFixAt = Date.now();
      if (hmState.shotMeasuring && hmState.shotStartGpsLat === null) {
        hmState.shotStartGpsLat = hmState.gpsLat;
        hmState.shotStartGpsLon = hmState.gpsLon;
      }
      var movedYds = (wasActive && baseLat !== null && baseLon !== null)
        ? calcYards(baseLat, baseLon, lat, lon)
        : 999;
      // Skip canvas re-render on sub-1-yard GPS jitter relative to last rendered position
      if (wasActive && movedYds < 1) {
        return;
      }
      hmState.lastRenderedGpsLat = lat;
      hmState.lastRenderedGpsLon = lon;
      var hObj = getHoleCourseObj(hmState.hole);
      var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
      if (distToCourse <= 2500) {
        hmState.playerLat = hmState.gpsLat;
        hmState.playerLon = hmState.gpsLon;
      } else if (!hmState.outsideCourseNotified && hmState.open) {
        hmState.outsideCourseNotified = true;
        showToast("📍 현재 골프장 외부에 계셔서 티박스 기준으로 표시합니다.", 5000);
      }
      if (hmState.open) syncHoleMapUI();
    }

    function handleIncomingGpsPermissionDenied() {
      cancelGpsWarmup();
      hmState.gpsSearching = false;
      hmState.gpsActive = false;
      if (hmState.gpsWatchId !== null && typeof hmState.gpsWatchId === "number" && navigator.geolocation) {
        navigator.geolocation.clearWatch(hmState.gpsWatchId);
      }
      hmState.gpsWatchId = null;
      if (hmState.open) {
        var ua = navigator.userAgent || "";
        var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        if (isIOS && detectInAppBrowserName()) {
          openInAppGuideModal(); // In-app browser on iOS: show 'Open in Safari' guide instead of Safari settings guide
        } else {
          openGpsPermissionModal();
        }
        syncHoleMapUI();
      }
    }

    function startHoleMapGps(isAuto) {
      if (!navigator.geolocation) {
        if (!isAuto) showToast("⚠️ 이 브라우저에서는 GPS 기능을 지원하지 않습니다.");
        return;
      }
      if (hmState.gpsActive && hmState.gpsWatchId !== null) {
        if (hmState.gpsLat !== null && hmState.gpsLon !== null) {
          var hObjNow = getHoleCourseObj(hmState.hole);
          var distNow = calcYards(hmState.gpsLat, hmState.gpsLon, hObjNow.path[2][0], hObjNow.path[2][1]);
          if (distNow <= 2500) {
            hmState.playerLat = hmState.gpsLat;
            hmState.playerLon = hmState.gpsLon;
          }
        }
        if (hmState.open) syncHoleMapUI();
        return;
      }

      hmState.gpsSearching = true;
      if (!isAuto) {
        showToast("📡 현재 GPS 위치를 확인하는 중...");
      }
      if (hmState.gpsWatchId === null) {
        dropStaleGpsFix(); // Drop stale GPS fix (>20s old) before starting watch (including after screen wake)
        startGpsWarmup(); // Wait up to 8s after GPS start for a clean fix (<=50m accuracy)
      }
      if (hmState.open) syncHoleMapUI();

      if (hmState.gpsWatchId === null) {
        hmState.gpsWatchId = navigator.geolocation.watchPosition(
          function (pos) {
            applyIncomingGpsPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          },
          function (err) {
            // On temporary GPS signal delay/timeout (codes 2, 3) rather than explicit permission denial (code 1),
            // keep watchPosition alive so GPS recovers automatically after waking screen or leaving tree cover
            if (err && err.code !== 1) {
              return;
            }
            if (hmState.gpsWatchId !== null) {
              navigator.geolocation.clearWatch(hmState.gpsWatchId);
              hmState.gpsWatchId = null;
            }
            if (!hmState.gpsActive) {
              handleIncomingGpsPermissionDenied();
            }
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    }

    function toggleHoleMapGps() {
      if (!navigator.geolocation) {
        showToast("⚠️ 이 브라우저에서는 GPS 기능을 지원하지 않습니다.");
        return;
      }
      if (hmState.gpsActive) {
        if (hmState.gpsLat !== null && hmState.gpsLon !== null) {
          var hObj = getHoleCourseObj(hmState.hole);
          var distToCourse = calcYards(hmState.gpsLat, hmState.gpsLon, hObj.path[2][0], hObj.path[2][1]);
          if (distToCourse <= 2500) {
            hmState.playerLat = hmState.gpsLat;
            hmState.playerLon = hmState.gpsLon;
          }
        }
        showToast("🟢 GPS가 정상 작동 중입니다.");
        syncHoleMapUI();
        return;
      }
      if (hmState.gpsSearching) {
        showToast("📡 현재 GPS 신호를 수신하고 있습니다...");
        return;
      }

      startHoleMapGps(false);
    }

    function syncHoleMapUI() {
      var hObj = getHoleCourseObj(hmState.hole);
      var evTag = "";
      if (longDriveHoles.indexOf(hObj.hole) !== -1) evTag = " · 🚀롱기";
      else if (nearPinHoles.indexOf(hObj.hole) !== -1) evTag = " · 🎯니어";
      document.getElementById("hmModalTitle").innerText =
        "HOLE " + hObj.hole + " (Par " + hObj.par + " · Hdcp " + hObj.hdcp + evTag + ")";

      document.getElementById("hmSubBarGreen").style.display = (hmState.tab === "green") ? "flex" : "none";
      var gFloatBtn = document.getElementById("hmGreenFloatBtn");
      var gFloatLbl = document.getElementById("hmGreenFloatLbl");
      if (gFloatBtn && gFloatLbl) {
        if (hmState.tab === "green") {
          gFloatBtn.className = "hm-green-float-btn active-green";
          gFloatLbl.innerHTML = "◀ 홀맵<br>보기";
        } else {
          gFloatBtn.className = "hm-green-float-btn";
          gFloatLbl.innerHTML = "그린<br>경사";
        }
      }
      renderMiniGreenPreview(hObj);

      var teeRow = document.getElementById("hmTeeRow");
      if (teeRow) teeRow.style.display = (hmState.tab === "map") ? "flex" : "none";
      var teeCfg = getHoleTeeConfig(hmState.teeKey);
      var teeBtn = document.getElementById("hmTeeBtn");
      if (teeBtn) {
        teeBtn.innerText = teeCfg.btnText;
        teeBtn.style.borderColor = teeCfg.borderColor;
      }
      var totalYdsEl = document.getElementById("hmTotalYds");
      if (totalYdsEl) {
        totalYdsEl.innerText = "전장: " + getHoleTeeYardage(hObj.hole, hmState.teeKey) + " yds";
      }

      var shotBox = document.getElementById("hmShotBox");
      if (shotBox) shotBox.style.display = (hmState.tab === "map") ? "flex" : "none";
      var shotLiveEl = document.getElementById("hmShotLiveVal");
      var shotBtn = document.getElementById("hmShotBtn");
      if (shotLiveEl && shotBtn) {
        if (hmState.shotMeasuring) {
          shotLiveEl.style.display = "inline-block";
          shotLiveEl.innerHTML = "<span style=\"font-size:13px; color:#69db7c; font-weight:800;\">🚀 측정중</span> " + getCurrentShotDistanceYds() + " yds";
          shotBtn.className = "hm-shot-btn measuring";
          shotBtn.innerText = "⏹ 측정 종료";
        } else {
          if (hmState.lastShotYds !== null) {
            shotLiveEl.style.display = "inline-block";
            shotLiveEl.innerHTML = "<span style=\"font-size:13px; color:#f8f9fa; font-weight:800;\">🎯 측정 결과</span> " + hmState.lastShotYds + " yds";
          } else {
            shotLiveEl.style.display = "none";
          }
          shotBtn.className = "hm-shot-btn";
          shotBtn.innerText = "🚀 비거리 측정";
        }
      }

      var fcb = getGreenFrontCenterBack(hObj);
      var pLat = hmState.playerLat;
      var pLon = hmState.playerLon;
      var teePt = getHoleTeeLatLon(hObj, hmState.teeKey);
      var isAtTee = (Math.abs(pLat - teePt[0]) < 1e-6 && Math.abs(pLon - teePt[1]) < 1e-6);
      var fStraight, cStraight, bStraight;
      if (isAtTee) {
        var teeYds = getHoleTeeYardage(hObj.hole, hmState.teeKey);
        var frontGap = Math.max(4, calcYards(fcb.front[0], fcb.front[1], fcb.center[0], fcb.center[1]));
        var backGap = Math.max(4, calcYards(fcb.center[0], fcb.center[1], fcb.back[0], fcb.back[1]));
        fStraight = teeYds - frontGap;
        cStraight = teeYds;
        bStraight = teeYds + backGap;
      } else {
        fStraight = calcYards(pLat, pLon, fcb.front[0], fcb.front[1]);
        cStraight = calcYards(pLat, pLon, fcb.center[0], fcb.center[1]);
        bStraight = calcYards(pLat, pLon, fcb.back[0], fcb.back[1]);
      }
      document.getElementById("hmYdFront").innerText = fStraight + "y";
      document.getElementById("hmYdCenter").innerText = cStraight + "y";
      document.getElementById("hmYdBack").innerText = bStraight + "y";

      updateHoleMapWindAndPlaysLikeUI(hObj, fcb, pLat, pLon, fStraight, cStraight, bStraight);

      var gpsBtn = document.getElementById("hmGpsBtn");
      if (hmState.gpsActive) {
        gpsBtn.className = "hm-gps-btn gps-live";
        gpsBtn.innerText = "🟢 GPS 켜짐";
      } else if (hmState.gpsSearching) {
        gpsBtn.className = "hm-gps-btn";
        gpsBtn.innerText = "📡 GPS 수신중..";
      } else {
        gpsBtn.className = "hm-gps-btn gps-off";
        gpsBtn.innerText = "🔴 GPS 꺼짐 (켜기)";
      }
      var ydGroup = document.querySelector("#holeMapModal .hm-yd-group");
      if (ydGroup) ydGroup.classList.toggle("hm-yd-waiting", !!hmState.gpsSearching && !hmState.gpsActive);

      renderHoleMapCanvas();
    }

    function renderHoleMapCanvas() {
      var canvas = document.getElementById("holeMapCanvas");
      if (!canvas) return;
      var rect = canvas.parentElement.getBoundingClientRect();
      var cssW = Math.max(280, Math.round(rect.width || 340));
      var cssH = Math.max(300, Math.round(rect.height || 400));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      // Green slope view is static per hole/size: skip redundant redraws on incoming GPS ticks
      var greenKey = hmState.hole + "|" + canvas.width + "x" + canvas.height;
      if (hmState.tab === "green" && hmState.greenDrawnKey === greenKey) return;
      hmState.greenDrawnKey = (hmState.tab === "green") ? greenKey : null;
      var ctx = canvas.getContext("2d");
      ctx.save();
      ctx.scale(dpr, dpr);

      var hObj = getHoleCourseObj(hmState.hole);
      if (hmState.tab === "green") {
        drawGreenContourView(ctx, cssW, cssH, hObj);
      } else {
        drawHoleLayoutView(ctx, cssW, cssH, hObj);
      }
      ctx.restore();
    }

    // ===== Tab 1: 18Birdies-Style Satellite Hole Layout & Pinch Zoom =====
    function drawHoleLayoutView(ctx, W, H, hObj) {
      ctx.fillStyle = "#16241c";
      ctx.fillRect(0, 0, W, H);

      var tee = hObj.path[0];
      var activeTee = getHoleTeeLatLon(hObj, hmState.teeKey);
      var dogleg = hObj.path[1];
      var grn = hObj.path[2];
      var midLat = (tee[0] + dogleg[0] + grn[0]) / 3;
      var midLon = (tee[1] + dogleg[1] + grn[1]) / 3;

      var teeM = latLonToLocalMeters(tee[0], tee[1], midLat, midLon);
      var grnM = latLonToLocalMeters(grn[0], grn[1], midLat, midLon);
      // Compute rotation angle so Tee is at bottom and Green is at top
      var dx = grnM.x - teeM.x;
      var dy = grnM.y - teeM.y;
      var rotAngle = Math.atan2(dx, dy);
      var cosA = Math.cos(rotAngle);
      var sinA = Math.sin(rotAngle);

      function toRotMeters(lat, lon) {
        var m = latLonToLocalMeters(lat, lon, midLat, midLon);
        return {
          u: m.x * cosA - m.y * sinA,
          v: m.x * sinA + m.y * cosA
        };
      }

      function fromRotMeters(u, v) {
        var east = u * cosA + v * sinA;
        var north = -u * sinA + v * cosA;
        return localMetersToLatLon(east, north, midLat, midLon);
      }

      var ptsToFit = [tee, dogleg, grn].concat(hObj.green);
      var minU = 99999, maxU = -99999, minV = 99999, maxV = -99999;
      ptsToFit.forEach(function (pt) {
        var rm = toRotMeters(pt[0], pt[1]);
        if (rm.u < minU) minU = rm.u;
        if (rm.u > maxU) maxU = rm.u;
        if (rm.v < minV) minV = rm.v;
        if (rm.v > maxV) maxV = rm.v;
      });

      // Frame hole layout generously across viewport extending behind translucent top HUD
      var spanU = Math.max(55, (maxU - minU) + 34);
      var spanV = Math.max(95, (maxV - minV) + 38);
      var baseScale = Math.min((W - 20) / spanU, (H - 52) / spanV);

      var zoom = hmState.zoom || 1;
      var panX = hmState.panX || 0;
      var panY = hmState.panY || 0;
      var scale = baseScale * zoom;
      var originX = W / 2 + panX;
      var originY = H / 2 + panY;

      var centerU = (minU + maxU) / 2;
      var centerV = (minV + maxV) / 2 + (14 / baseScale);

      function uvToScreen(u, v) {
        return {
          x: originX + (u - centerU) * scale,
          y: originY - (v - centerV) * scale
        };
      }

      function latLonToScreen(lat, lon) {
        var rm = toRotMeters(lat, lon);
        return uvToScreen(rm.u, rm.v);
      }

      function screenToLatLon(sx, sy) {
        var u = centerU + (sx - originX) / scale;
        var v = centerV - (sy - originY) / scale;
        return fromRotMeters(u, v);
      }

      var plScr = latLonToScreen(hmState.playerLat, hmState.playerLon);
      var tgScr = latLonToScreen(hmState.targetLat, hmState.targetLon);

      hmState.mapTransform = {
        screenToLatLon: screenToLatLon,
        latLonToScreen: latLonToScreen,
        targetScr: tgScr,
        playerScr: plScr
      };

      // 1) Render high-resolution Esri World Imagery satellite background tiles (z17 + z18)
      drawRotatedSatelliteTiles(ctx, W, H, midLat, midLon, rotAngle, scale, centerU, centerV, originX, originY, hObj, screenToLatLon);

      // 2) Translucent fairway corridor guide line
      var p0 = latLonToScreen(activeTee[0], activeTee[1]);
      var p1 = latLonToScreen(dogleg[0], dogleg[1]);
      var p2 = latLonToScreen(grn[0], grn[1]);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.strokeStyle = "rgba(46, 204, 113, 0.20)";
      ctx.lineWidth = Math.max(22, 32 * scale);
      ctx.stroke();

      // 3) Green polygon highlight
      ctx.beginPath();
      hObj.green.forEach(function (pt, idx) {
        var sp = latLonToScreen(pt[0], pt[1]);
        if (idx === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(32, 201, 151, 0.52)";
      ctx.fill();
      ctx.strokeStyle = "#63e6be";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 4) Measurement line: Player (blue) -> Target Crosshair -> Green Center
      var grScr = p2;

      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(plScr.x, plScr.y);
      ctx.lineTo(tgScr.x, tgScr.y);
      ctx.stroke();

      ctx.strokeStyle = "#ffd43b";
      ctx.beginPath();
      ctx.moveTo(tgScr.x, tgScr.y);
      ctx.lineTo(grScr.x, grScr.y);
      ctx.stroke();
      ctx.restore();

      // Draw shot-tracking trajectory line from start point (green) to current position (blue)
      if (hmState.shotMeasuring && hmState.shotStartLat !== null && hmState.shotStartLon !== null) {
        var stScr = latLonToScreen(hmState.shotStartLat, hmState.shotStartLon);
        ctx.save();
        ctx.strokeStyle = "#69db7c";
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(stScr.x, stScr.y);
        ctx.lineTo(plScr.x, plScr.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#40c057";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(stScr.x, stScr.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Green flagstick icon
      ctx.save();
      ctx.fillStyle = "#fa5252";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(grScr.x, grScr.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Player position marker (Tee / GPS)
      ctx.save();
      ctx.fillStyle = "#339af0";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(plScr.x, plScr.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Draggable 18Birdies-style white target crosshair circle
      ctx.save();
      ctx.fillStyle = (hmState.dragMode === "target")
        ? "rgba(255, 212, 59, 0.28)"
        : "rgba(255, 255, 255, 0.15)";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(tgScr.x, tgScr.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tgScr.x - 22, tgScr.y);
      ctx.lineTo(tgScr.x - 8, tgScr.y);
      ctx.moveTo(tgScr.x + 8, tgScr.y);
      ctx.lineTo(tgScr.x + 22, tgScr.y);
      ctx.moveTo(tgScr.x, tgScr.y - 22);
      ctx.lineTo(tgScr.x, tgScr.y - 8);
      ctx.moveTo(tgScr.x, tgScr.y + 8);
      ctx.lineTo(tgScr.x, tgScr.y + 22);
      ctx.stroke();
      ctx.fillStyle = "#ffd43b";
      ctx.beginPath();
      ctx.arc(tgScr.x, tgScr.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Render dual segment distance badges (straight yardage + 75-pt LiDAR & wind Plays-Like yardage)
      var ydToTarget = calcYards(hmState.playerLat, hmState.playerLon, hmState.targetLat, hmState.targetLon);
      var ydTargetToGreen = calcYards(hmState.targetLat, hmState.targetLon, grn[0], grn[1]);
      var plToTarget = calcPlaysLikeShot(hObj, hmState.playerLat, hmState.playerLon, hmState.targetLat, hmState.targetLon, ydToTarget);
      var plTargetToGreen = calcPlaysLikeShot(hObj, hmState.targetLat, hmState.targetLon, grn[0], grn[1], ydTargetToGreen);

      var pill1Text = ydToTarget + "y";
      if (plToTarget.playsLikeYds !== ydToTarget) {
        pill1Text += " · 📐" + plToTarget.playsLikeYds + "y";
      }
      var pill2Text = ydTargetToGreen + "y";
      if (plTargetToGreen.playsLikeYds !== ydTargetToGreen) {
        pill2Text += " · 📐" + plTargetToGreen.playsLikeYds + "y";
      }

      drawYardagePill(ctx, W, (plScr.x + tgScr.x) / 2 + 34, (plScr.y + tgScr.y) / 2, pill1Text, "#ffffff", "#1b1d20");
      drawYardagePill(ctx, W, (tgScr.x + grScr.x) / 2 + 34, (tgScr.y + grScr.y) / 2, pill2Text, "#ffd43b", "#1b1d20");
    }

    function drawYardagePill(ctx, W, x, y, text, fg, bg) {
      ctx.save();
      ctx.font = "900 11.5px sans-serif";
      var tw = ctx.measureText(text).width;
      var pw = tw + 14;
      var ph = 22;
      var halfW = pw / 2 + 6;
      var rx = Math.max(halfW, Math.min(W - halfW, x)) - pw / 2;
      var ry = y - ph / 2;
      ctx.fillStyle = "rgba(20, 22, 25, 0.90)";
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, ry, pw, ph, 11) : ctx.rect(rx, ry, pw, ph);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, rx + pw / 2, ry + ph / 2 + 0.5);
      ctx.restore();
    }

    function drawTileLayerAtZoom(ctx, z, midLat, midLon, scale, minEastM, maxEastM, minNorthM, maxNorthM) {
      var n = Math.pow(2, z);
      var latRad = midLat * Math.PI / 180;
      var centerTileX = (midLon + 180) / 360 * n;
      var centerTileY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
      var metersPerPixel = (156543.03392 * Math.cos(latRad)) / n;
      var tileSpanMeters = 256 * metersPerPixel;

      var minTX = Math.floor(centerTileX + minEastM / tileSpanMeters);
      var maxTX = Math.floor(centerTileX + maxEastM / tileSpanMeters);
      var minTY = Math.floor(centerTileY - maxNorthM / tileSpanMeters);
      var maxTY = Math.floor(centerTileY - minNorthM / tileSpanMeters);

      if (maxTX - minTX > 6) {
        var midTX = Math.round((minTX + maxTX) / 2);
        minTX = midTX - 3;
        maxTX = midTX + 3;
      }
      if (maxTY - minTY > 6) {
        var midTY = Math.round((minTY + maxTY) / 2);
        minTY = midTY - 3;
        maxTY = midTY + 3;
      }

      for (var tx = minTX; tx <= maxTX; tx++) {
        for (var ty = minTY; ty <= maxTY; ty++) {
          var key = z + "/" + ty + "/" + tx;
          var img = hmState.tileCache[key];
          if (!img) {
            img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = (function () {
              return function () {
                if (hmState.open && hmState.tab === "map") renderHoleMapCanvas();
              };
            })();
            img.src = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + key;
            hmState.tileCache[key] = img;
          }
          if (img.complete && img.naturalWidth > 0) {
            var offsetEastM = (tx - centerTileX) * tileSpanMeters;
            var offsetNorthM = (centerTileY - ty) * tileSpanMeters;
            var sx = offsetEastM * scale;
            var sy = -offsetNorthM * scale;
            var sw = tileSpanMeters * scale + 0.8;
            ctx.drawImage(img, sx, sy, sw, sw);
          }
        }
      }
    }

    function drawRotatedSatelliteTiles(ctx, W, H, midLat, midLon, rotAngle, scale, centerU, centerV, originX, originY, hObj, screenToLatLon) {
      var minEastM = 99999, maxEastM = -99999, minNorthM = 99999, maxNorthM = -99999;
      hObj.path.concat(hObj.green).forEach(function (pt) {
        var m = latLonToLocalMeters(pt[0], pt[1], midLat, midLon);
        if (m.x < minEastM) minEastM = m.x;
        if (m.x > maxEastM) maxEastM = m.x;
        if (m.y < minNorthM) minNorthM = m.y;
        if (m.y > maxNorthM) maxNorthM = m.y;
      });

      if (screenToLatLon) {
        [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (c) {
          var ll = screenToLatLon(c[0], c[1]);
          var m = latLonToLocalMeters(ll.lat, ll.lon, midLat, midLon);
          if (m.x < minEastM) minEastM = m.x;
          if (m.x > maxEastM) maxEastM = m.x;
          if (m.y < minNorthM) minNorthM = m.y;
          if (m.y > maxNorthM) maxNorthM = m.y;
        });
      }

      ctx.save();
      ctx.translate(originX - centerU * scale, originY + centerV * scale);
      ctx.rotate(-rotAngle);

      // Composite gap-free z17 base tiles with sharp z18 detail tiles around the hole corridor
      drawTileLayerAtZoom(ctx, 17, midLat, midLon, scale, minEastM - 180, maxEastM + 180, minNorthM - 180, maxNorthM + 180);
      drawTileLayerAtZoom(ctx, 18, midLat, midLon, scale, minEastM - 80, maxEastM + 80, minNorthM - 80, maxNorthM + 80);

      ctx.restore();
    }

    // ===== Tab 2: 18Birdies-Style High-Precision Green Slope Heatmap & Break Arrows (USGS 1m LiDAR 5x5 + 2D Bicubic) =====
    function cubicHermite(p0, p1, p2, p3, t) {
      var a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
      var b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
      var c = -0.5 * p0 + 0.5 * p2;
      var d = p1;
      return ((a * t + b) * t + c) * t + d;
    }

    // 2D Bicubic (Catmull-Rom) surface interpolation over 5x5 LiDAR grid (5 rows S->N, 5 cols W->E)
    function evalGreenElevation25(lonFrac, latFrac, elev25) {
      var gx = Math.max(0, Math.min(4, lonFrac * 4));
      var gy = Math.max(0, Math.min(4, latFrac * 4));
      var ix = Math.min(3, Math.floor(gx));
      var iy = Math.min(3, Math.floor(gy));
      var tx = gx - ix;
      var ty = gy - iy;

      function sampleGrid(r, c) {
        var rr = Math.max(0, Math.min(4, r));
        var cc = Math.max(0, Math.min(4, c));
        return elev25[rr * 5 + cc];
      }

      var colVals = [];
      for (var m = -1; m <= 2; m++) {
        var r = iy + m;
        var v0 = sampleGrid(r, ix - 1);
        var v1 = sampleGrid(r, ix);
        var v2 = sampleGrid(r, ix + 1);
        var v3 = sampleGrid(r, ix + 2);
        colVals.push(cubicHermite(v0, v1, v2, v3, tx));
      }
      return cubicHermite(colVals[0], colVals[1], colVals[2], colVals[3], ty);
    }

    // Smooth angular OSM green polygon corners into natural curves via Chaikin corner-cutting spline
    function smoothPolygonChaikin(pts, iterations) {
      var curr = pts.slice();
      for (var it = 0; it < (iterations || 3); it++) {
        var next = [];
        var n = curr.length;
        for (var i = 0; i < n; i++) {
          var p0 = curr[i];
          var p1 = curr[(i + 1) % n];
          next.push({
            x: 0.75 * p0.x + 0.25 * p1.x,
            y: 0.75 * p0.y + 0.25 * p1.y
          });
          next.push({
            x: 0.25 * p0.x + 0.75 * p1.x,
            y: 0.25 * p0.y + 0.75 * p1.y
          });
        }
        curr = next;
      }
      return curr;
    }

    function buildGreenContourLayer(ctx, W, H, hObj, opts) {
      var fcb = getGreenFrontCenterBack(hObj);
      var gCenter = fcb.center;
      var apAngle = Math.atan2(fcb.ux, fcb.uy);
      var cosA = Math.cos(apAngle);
      var sinA = Math.sin(apAngle);

      var minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
      hObj.green.forEach(function (pt) {
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
        if (pt[1] < minLon) minLon = pt[1];
        if (pt[1] > maxLon) maxLon = pt[1];
      });
      var latSpan = Math.max(0.00005, maxLat - minLat);
      var lonSpan = Math.max(0.00005, maxLon - minLon);

      function toGreenUV(lat, lon) {
        var m = latLonToLocalMeters(lat, lon, gCenter[0], gCenter[1]);
        return {
          u: m.x * cosA - m.y * sinA,
          v: m.x * sinA + m.y * cosA
        };
      }
      function uvToLatLon(u, v) {
        var eastM = u * cosA + v * sinA;
        var northM = -u * sinA + v * cosA;
        return localMetersToLatLon(eastM, northM, gCenter[0], gCenter[1]);
      }
      function evalUVZ(u, v) {
        var ll = uvToLatLon(u, v);
        var lonFrac = (ll.lon - minLon) / lonSpan;
        var latFrac = (ll.lat - minLat) / latSpan;
        return evalGreenElevation25(lonFrac, latFrac, hObj.elev25);
      }

      var polyUV = [];
      var minU = 999, maxU = -999, minV = 999, maxV = -999;
      var frontUV = null, backUV = null;
      hObj.green.forEach(function (pt) {
        var uv = toGreenUV(pt[0], pt[1]);
        polyUV.push(uv);
        if (uv.u < minU) minU = uv.u;
        if (uv.u > maxU) maxU = uv.u;
        if (uv.v < minV) { minV = uv.v; frontUV = uv; }
        if (uv.v > maxV) { maxV = uv.v; backUV = uv; }
      });

      var minSpanM = opts.minSpanM || 8;
      var widthM = Math.max(minSpanM, maxU - minU);
      var depthM = Math.max(minSpanM, maxV - minV);
      var baseScale = Math.min((W - opts.padW) / widthM, (H - opts.padH) / depthM);
      var zoom = opts.zoom || 1;
      var scale = baseScale * zoom;
      var originX = W / 2 + (opts.panX || 0);
      var originY = H / 2 + (opts.panY || 0);
      var midU = (minU + maxU) / 2;
      var midV = (minV + maxV) / 2 + ((opts.vOffsetPx || 0) / baseScale);

      function uvToScr(u, v) {
        return {
          x: originX + (u - midU) * scale,
          y: originY - (v - midV) * scale
        };
      }
      function scrToUV(sx, sy) {
        return {
          u: midU + (sx - originX) / scale,
          v: midV - (sy - originY) / scale
        };
      }

      var rawPolyScr = polyUV.map(function (uv) { return uvToScr(uv.u, uv.v); });
      var polyScr = smoothPolygonChaikin(rawPolyScr, opts.chaikinIter || 2);

      var polyUVxy = polyUV.map(function (p) { return { x: p.u, y: p.v }; });
      var zMin = 99999, zMax = -99999;
      var steps = opts.zSampleSteps || 14;
      for (var sv = minV; sv <= maxV; sv += depthM / steps) {
        for (var su = minU; su <= maxU; su += widthM / steps) {
          if (!isPointInPolygon(su, sv, polyUVxy)) continue;
          var z0 = evalUVZ(su, sv);
          if (z0 < zMin) zMin = z0;
          if (z0 > zMax) zMax = z0;
        }
      }
      var zRange = Math.max(0.04, zMax - zMin);

      var offCanvas = document.createElement("canvas");
      offCanvas.width = W;
      offCanvas.height = H;
      var offCtx = offCanvas.getContext("2d");
      var imgData = offCtx.createImageData(W, H);
      var data = imgData.data;
      var numBands = CONTOUR_PALETTE.length;

      for (var py = 0; py < H; py++) {
        for (var px = 0; px < W; px++) {
          var uv = scrToUV(px, py);
          var zVal = evalUVZ(uv.u, uv.v);
          var norm = (zVal - zMin) / zRange;
          if (norm < 0) norm = 0;
          if (norm > 0.999) norm = 0.999;
          var bandIdx = Math.floor(norm * numBands);
          var rgb = CONTOUR_PALETTE[bandIdx];
          var pIdx = (py * W + px) * 4;
          data[pIdx] = rgb[0];
          data[pIdx + 1] = rgb[1];
          data[pIdx + 2] = rgb[2];
          data[pIdx + 3] = 255;
        }
      }
      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.beginPath();
      polyScr.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(offCanvas, 0, 0, W, H);

      return {
        polyUV: polyUV,
        polyScr: polyScr,
        frontUV: frontUV,
        backUV: backUV,
        widthYds: Math.round(widthM * 1.0936),
        depthYds: Math.round(depthM * 1.0936),
        originX: originX,
        originY: originY,
        uvToScr: uvToScr,
        scrToUV: scrToUV,
        evalUVZ: evalUVZ
      };
    }

    function renderMiniGreenPreview(hObj) {
      if (!hObj || hmState.miniGreenRenderedHole === hObj.hole) return;
      var miniCanvas = document.getElementById("hmMiniGreenCanvas");
      if (!miniCanvas) return;
      hmState.miniGreenRenderedHole = hObj.hole;

      var W = miniCanvas.width || 88;
      var H = miniCanvas.height || 96;
      var ctx = miniCanvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);

      var gLayer = buildGreenContourLayer(ctx, W, H, hObj, {
        minSpanM: 8, padW: 10, padH: 10, zoom: 1, panX: 0, panY: 0, vOffsetPx: 0, chaikinIter: 2, zSampleSteps: 14
      });

      // Diagonal dot pattern for mini heatmap button icon
      ctx.fillStyle = "rgba(8, 9, 10, 0.75)";
      var stepX = 9.5, stepY = 8.5;
      var gAng = -0.46;
      var cG = Math.cos(gAng), sG = Math.sin(gAng);
      for (var gj = -7; gj <= 7; gj++) {
        for (var gi = -7; gi <= 7; gi++) {
          var lx = gi * stepX + ((gj % 2 !== 0) ? stepX * 0.3 : 0);
          var ly = gj * stepY;
          var gx = gLayer.originX + lx * cG - ly * sG;
          var gy = gLayer.originY + lx * sG + ly * cG;
          if (!isPointInGreenWithMargin(gx, gy, gLayer.polyScr, 2)) continue;
          ctx.beginPath();
          ctx.arc(gx, gy, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    function drawGreenContourView(ctx, W, H, hObj) {
      ctx.fillStyle = "#222426";
      ctx.fillRect(0, 0, W, H);

      var zoom = hmState.zoom || 1;
      var gLayer = buildGreenContourLayer(ctx, W, H, hObj, {
        minSpanM: 10, padW: 44, padH: 76, zoom: zoom, panX: hmState.panX || 0, panY: hmState.panY || 0, vOffsetPx: 14, chaikinIter: 3, zSampleSteps: 22
      });
      var polyUV = gLayer.polyUV;
      var polyScr = gLayer.polyScr;
      var frontUV = gLayer.frontUV;
      var backUV = gLayer.backUV;
      var widthYds = gLayer.widthYds;
      var depthYds = gLayer.depthYds;
      var originX = gLayer.originX;
      var originY = gLayer.originY;
      var uvToScr = gLayer.uvToScr;
      var scrToUV = gLayer.scrToUV;
      var evalUVZ = gLayer.evalUVZ;

      var pinScr = uvToScr(hmState.pinNormU, hmState.pinNormV);
      hmState.greenTransform = {
        scrToUV: scrToUV,
        uvToScr: uvToScr,
        polyUV: polyUV,
        pinScr: pinScr
      };

      // Rotated grid layout + crisp downhill break arrows (18Birdies style)
      var gridStepX = 42;
      var gridStepY = 38;
      var gridAngle = -0.46; // ~ -26 deg diagonal grid alignment
      var cosG = Math.cos(gridAngle), sinG = Math.sin(gridAngle);
      var rangeSteps = Math.ceil(7 * zoom);

      for (var gj = -rangeSteps; gj <= rangeSteps; gj++) {
        for (var gi = -rangeSteps; gi <= rangeSteps; gi++) {
          var lx = gi * gridStepX + ((gj % 2 !== 0) ? gridStepX * 0.28 : 0);
          var ly = gj * gridStepY;
          var gx = originX + lx * cosG - ly * sinG;
          var gy = originY + lx * sinG + ly * cosG;
          if (gx < -20 || gx > W + 20 || gy < -20 || gy > H + 20) continue;
          if (!isPointInGreenWithMargin(gx, gy, polyScr, 4.5)) continue;
          var sl = getLocalScreenSlope(gx, gy, scrToUV, evalUVZ);
          drawSlopeArrow(ctx, gx, gy, sl.angle);
        }
      }
      ctx.restore();

      // Bold black outline around green perimeter
      ctx.save();
      ctx.beginPath();
      polyScr.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = "#08090a";
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.restore();

      // Render Back / Front depth reference dots
      if (backUV) {
        var bScr = uvToScr(backUV.u, backUV.v);
        drawGreenEdgeLabel(ctx, bScr.x + 12, Math.max(42, bScr.y + 10), "Back");
      }
      if (frontUV) {
        var fScr = uvToScr(frontUV.u, frontUV.v);
        drawGreenEdgeLabel(ctx, fScr.x + 18, Math.min(H - 16, fScr.y - 18), "Front");
      }

      // Render center (or tapped) target pin marker
      ctx.save();
      ctx.fillStyle = "rgba(255, 224, 198, 0.52)";
      ctx.beginPath();
      ctx.arc(pinScr.x, pinScr.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pinScr.x, pinScr.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Update bottom green depth/width & pin local slope readout
      var pinSlope = getLocalScreenSlope(pinScr.x, pinScr.y, scrToUV, evalUVZ);
      var dirText = angleToKoreanBreak(pinSlope.angle);
      var infoEl = document.getElementById("hmGreenInfoText");
      if (infoEl) {
        infoEl.innerText = "그린 크기: 세로 " + depthYds + "y × 가로 " + widthYds + "y  |  핀 주변 흐름: " + dirText;
      }
    }

    function getLocalScreenSlope(sx, sy, scrToUV, evalUVZ) {
      var eps = 5;
      var uvL = scrToUV(sx - eps, sy);
      var uvR = scrToUV(sx + eps, sy);
      var uvU = scrToUV(sx, sy - eps);
      var uvD = scrToUV(sx, sy + eps);

      var zL = evalUVZ(uvL.u, uvL.v);
      var zR = evalUVZ(uvR.u, uvR.v);
      var zU = evalUVZ(uvU.u, uvU.v);
      var zD = evalUVZ(uvD.u, uvD.v);

      // Downhill gradient vector (from higher to lower elevation)
      var dxDown = zL - zR;
      var dyDown = zU - zD;
      return {
        angle: Math.atan2(dyDown, dxDown),
        mag: Math.sqrt(dxDown * dxDown + dyDown * dyDown)
      };
    }

    function angleToKoreanBreak(rad) {
      var deg = (rad * 180 / Math.PI + 360) % 360;
      if (deg >= 337.5 || deg < 22.5) return "오른쪽 내리막 (→)";
      if (deg < 67.5) return "우측 앞 방향 내리막 (↘)";
      if (deg < 112.5) return "뒤에서 앞 내리막 (↓)";
      if (deg < 157.5) return "좌측 앞 방향 내리막 (↙)";
      if (deg < 202.5) return "왼쪽 내리막 (←)";
      if (deg < 247.5) return "좌측 뒤 방향 내리막 (↖)";
      if (deg < 292.5) return "앞에서 뒤 내리막 (↑)";
      return "우측 뒤 방향 내리막 (↗)";
    }

    function drawSlopeArrow(ctx, cx, cy, angle) {
      var len = 24;
      var headLen = 9.2;
      var x1 = cx - Math.cos(angle) * (len * 0.45);
      var y1 = cy - Math.sin(angle) * (len * 0.45);
      var x2 = cx + Math.cos(angle) * (len * 0.55);
      var y2 = cy + Math.sin(angle) * (len * 0.55);

      ctx.save();
      ctx.strokeStyle = "#08090a";
      ctx.fillStyle = "#08090a";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2 + 0.01);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2 + Math.cos(angle) * 2, y2 + Math.sin(angle) * 2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - 0.52), y2 - headLen * Math.sin(angle - 0.52));
      ctx.lineTo(x2 - headLen * Math.cos(angle + 0.52), y2 - headLen * Math.sin(angle + 0.52));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawGreenEdgeLabel(ctx, x, y, label) {
      ctx.save();
      ctx.font = "800 14px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(x - 20, y - 4.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label, x - 12, y);
      ctx.restore();
    }

    function isPointInPolygon(x, y, poly) {
      var inside = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i].x, yi = poly[i].y;
        var xj = poly[j].x, yj = poly[j].y;
        var intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.00001) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function isPointInGreenWithMargin(x, y, poly, margin) {
      if (!isPointInPolygon(x, y, poly)) return false;
      if (!margin) return true;
      return isPointInPolygon(x - margin, y, poly) &&
        isPointInPolygon(x + margin, y, poly) &&
        isPointInPolygon(x, y - margin, poly) &&
        isPointInPolygon(x, y + margin, poly);
    }

    var hmCanvasEventsBound = false;
    function bindHoleMapCanvasEvents() {
      if (hmCanvasEventsBound) return;
      var canvas = document.getElementById("holeMapCanvas");
      if (!canvas) return;
      hmCanvasEventsBound = true;

      // Single-finger touch start: drag target if inside white crosshair circle, otherwise pan map
      function startSinglePointer(clientX, clientY) {
        var rect = canvas.getBoundingClientRect();
        var sx = clientX - rect.left;
        var sy = clientY - rect.top;

        // Green slope tab is fixed: disable panning and pin dragging
        if (hmState.tab === "green") {
          hmState.dragMode = null;
          return;
        }

        if (hmState.tab === "map" && hmState.mapTransform) {
          var tgScr = hmState.mapTransform.targetScr;
          var plScr = hmState.mapTransform.playerScr;
          var dTarget = tgScr ? Math.hypot(sx - tgScr.x, sy - tgScr.y) : 999;
          var dPlayer = plScr ? Math.hypot(sx - plScr.x, sy - plScr.y) : 999;

          if (dTarget <= 34) {
            hmState.dragMode = "target";
            hmState.dragOffsetX = tgScr.x - sx;
            hmState.dragOffsetY = tgScr.y - sy;
            renderHoleMapCanvas();
            return;
          }
          if (dPlayer <= 28) {
            hmState.dragMode = "player";
            hmState.dragOffsetX = plScr.x - sx;
            hmState.dragOffsetY = plScr.y - sy;
            return;
          }
        }

        // Single-finger drag outside crosshair marker pans the map
        hmState.dragMode = "pan";
        hmState.panStartSX = sx;
        hmState.panStartSY = sy;
        hmState.panStartOriginX = hmState.panX || 0;
        hmState.panStartOriginY = hmState.panY || 0;
      }

      function moveSinglePointer(clientX, clientY) {
        var rect = canvas.getBoundingClientRect();
        var sx = clientX - rect.left;
        var sy = clientY - rect.top;
        var W = rect.width || 340;
        var H = rect.height || 400;

        if (hmState.dragMode === "pan") {
          var rawPanX = hmState.panStartOriginX + (sx - hmState.panStartSX);
          var rawPanY = hmState.panStartOriginY + (sy - hmState.panStartSY);
          var clamped = clampHoleMapPan(hmState.zoom || 1, rawPanX, rawPanY, W, H);
          hmState.panX = clamped.x;
          hmState.panY = clamped.y;
          renderHoleMapCanvas();
          return;
        }

        if (hmState.tab === "map" && hmState.mapTransform) {
          var adjX = sx + (hmState.dragOffsetX || 0);
          var adjY = sy + (hmState.dragOffsetY || 0);
          var ll = hmState.mapTransform.screenToLatLon(adjX, adjY);
          if (hmState.dragMode === "player") {
            hmState.playerLat = ll.lat;
            hmState.playerLon = ll.lon;
          } else if (hmState.dragMode === "target") {
            hmState.targetLat = ll.lat;
            hmState.targetLon = ll.lon;
          }
          syncHoleMapUI();
        }
      }

      // Touch handler: two-finger pinch-zoom vs single-finger target drag / map pan
      canvas.addEventListener("touchstart", function (e) {
        if (e.touches.length >= 2) {
          e.preventDefault();
          if (hmState.tab === "green") return; // Disable zoom on fixed Green Slope tab
          if (hmState.preTouchSnapshot) {
            hmState.playerLat = hmState.preTouchSnapshot.playerLat;
            hmState.playerLon = hmState.preTouchSnapshot.playerLon;
            hmState.targetLat = hmState.preTouchSnapshot.targetLat;
            hmState.targetLon = hmState.preTouchSnapshot.targetLon;
            hmState.pinNormU = hmState.preTouchSnapshot.pinNormU;
            hmState.pinNormV = hmState.preTouchSnapshot.pinNormV;
            hmState.panX = hmState.preTouchSnapshot.panX;
            hmState.panY = hmState.preTouchSnapshot.panY;
            hmState.preTouchSnapshot = null;
          }
          hmState.isPinching = true;
          hmState.isDragging = false;
          hmState.dragMode = null;

          var rect = canvas.getBoundingClientRect();
          var W = rect.width || 340;
          var H = rect.height || 400;
          var t0 = e.touches[0], t1 = e.touches[1];
          var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
          var midX = (t0.clientX + t1.clientX) / 2 - rect.left;
          var midY = (t0.clientY + t1.clientY) / 2 - rect.top;

          hmState.pinchStartDist = dist;
          hmState.pinchStartZoom = hmState.zoom || 1;
          hmState.pinchAnchorBX = W / 2 + (midX - W / 2 - (hmState.panX || 0)) / hmState.pinchStartZoom;
          hmState.pinchAnchorBY = H / 2 + (midY - H / 2 - (hmState.panY || 0)) / hmState.pinchStartZoom;
          syncHoleMapUI();
          return;
        }

        if (e.touches.length === 1 && !hmState.isPinching) {
          e.preventDefault();
          hmState.preTouchSnapshot = {
            playerLat: hmState.playerLat,
            playerLon: hmState.playerLon,
            targetLat: hmState.targetLat,
            targetLon: hmState.targetLon,
            pinNormU: hmState.pinNormU,
            pinNormV: hmState.pinNormV,
            panX: hmState.panX,
            panY: hmState.panY
          };
          hmState.isDragging = true;
          startSinglePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      canvas.addEventListener("touchmove", function (e) {
        if (hmState.isPinching && e.touches.length >= 2) {
          e.preventDefault();
          var rect = canvas.getBoundingClientRect();
          var W = rect.width || 340;
          var H = rect.height || 400;
          var t0 = e.touches[0], t1 = e.touches[1];
          var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
          var midX = (t0.clientX + t1.clientX) / 2 - rect.left;
          var midY = (t0.clientY + t1.clientY) / 2 - rect.top;

          var newZoom = Math.max(1, Math.min(5, hmState.pinchStartZoom * (dist / hmState.pinchStartDist)));
          var rawPanX = midX - W / 2 - (hmState.pinchAnchorBX - W / 2) * newZoom;
          var rawPanY = midY - H / 2 - (hmState.pinchAnchorBY - H / 2) * newZoom;
          var clamped = clampHoleMapPan(newZoom, rawPanX, rawPanY, W, H);

          hmState.zoom = newZoom;
          hmState.panX = clamped.x;
          hmState.panY = clamped.y;
          renderHoleMapCanvas();
          return;
        }

        if (hmState.isDragging && !hmState.isPinching && e.touches.length === 1) {
          e.preventDefault();
          moveSinglePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      canvas.addEventListener("touchend", function (e) {
        if (e.touches.length === 0) {
          var wasTarget = (hmState.dragMode === "target");
          hmState.isPinching = false;
          hmState.isDragging = false;
          hmState.dragMode = null;
          hmState.preTouchSnapshot = null;
          if (wasTarget) renderHoleMapCanvas();
        }
      });

      canvas.addEventListener("touchcancel", function () {
        hmState.isPinching = false;
        hmState.isDragging = false;
        hmState.dragMode = null;
        hmState.preTouchSnapshot = null;
      });

      // Desktop mouse drag & trackpad/wheel zoom support
      canvas.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        hmState.isDragging = true;
        startSinglePointer(e.clientX, e.clientY);
      });
      canvas.addEventListener("mousemove", function (e) {
        if (!hmState.isDragging) return;
        moveSinglePointer(e.clientX, e.clientY);
      });
      window.addEventListener("mouseup", function () {
        var wasTarget = (hmState.dragMode === "target");
        hmState.isDragging = false;
        hmState.dragMode = null;
        if (wasTarget) renderHoleMapCanvas();
      });

      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        if (hmState.tab === "green") return; // Disable zoom on fixed Green Slope tab
        var rect = canvas.getBoundingClientRect();
        var W = rect.width || 340;
        var H = rect.height || 400;
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;

        var oldZoom = hmState.zoom || 1;
        var factor = e.deltaY < 0 ? 1.15 : 0.87;
        var newZoom = Math.max(1, Math.min(5, oldZoom * factor));
        var anchorBX = W / 2 + (mx - W / 2 - (hmState.panX || 0)) / oldZoom;
        var anchorBY = H / 2 + (my - H / 2 - (hmState.panY || 0)) / oldZoom;
        var rawPanX = mx - W / 2 - (anchorBX - W / 2) * newZoom;
        var rawPanY = my - H / 2 - (anchorBY - H / 2) * newZoom;
        var clamped = clampHoleMapPan(newZoom, rawPanX, rawPanY, W, H);

        hmState.zoom = newZoom;
        hmState.panX = clamped.x;
        hmState.panY = clamped.y;
        renderHoleMapCanvas();
      }, { passive: false });
    }

