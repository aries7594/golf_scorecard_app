/* ============================================================================
 * [CourseData.js] Golf Course Catalog Registry & Resilient On-Demand Loader
 * ----------------------------------------------------------------------------
 * - COURSE_MANIFEST (courses/manifest.js) holds lightweight search & Par metadata.
 * - ensureCourseLoaded(courseKey, callback) restores cached course geometry from
 *   localStorage in 0ms on warm boot, or fetches courses/<courseKey>.js on-demand
 *   with automatic retry for flaky golf-course cellular reception.
 * ============================================================================ */
var COURSE_CATALOG = window.COURSE_CATALOG || {};
window.COURSE_CATALOG = COURSE_CATALOG;

var COURSE_MANIFEST = window.COURSE_MANIFEST || [];
window.COURSE_MANIFEST = COURSE_MANIFEST;

var COURSE_LS_PREFIX = "golf_course_v1_";
var COURSE_LS_RECENT_KEY = "golf_course_recent_keys_v1";
var __COURSE_LOAD_QUEUE = {};

function normalizeCourseKey(rawKey) {
  var k = String(rawKey || "").trim();
  if (k === "poppyhills") return "poppy_hills";
  return k;
}

function getCourseManifestEntry(courseKey) {
  var k = normalizeCourseKey(courseKey);
  var list = window.COURSE_MANIFEST || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].key === k) return list[i];
  }
  return null;
}

function isFullCourseLoaded(courseKey) {
  var k = normalizeCourseKey(courseKey);
  var c = k ? COURSE_CATALOG[k] : null;
  return Boolean(c && Array.isArray(c.holes) && c.holes.length === 18 && c.holes[0] && Array.isArray(c.holes[0].path) && c.holes[0].path.length === 3);
}

function restoreCourseFromLocalCache(courseKey) {
  var k = normalizeCourseKey(courseKey);
  if (!k) return null;
  if (isFullCourseLoaded(k)) return COURSE_CATALOG[k];
  try {
    var raw = localStorage.getItem(COURSE_LS_PREFIX + k);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.holes) && parsed.holes.length === 18 && parsed.holes[0] && Array.isArray(parsed.holes[0].path)) {
      COURSE_CATALOG[k] = parsed;
      return parsed;
    }
  } catch (e) { }
  return null;
}

function persistCourseToLocalCache(courseKey, courseObj) {
  var k = normalizeCourseKey(courseKey);
  if (!k || !courseObj || !Array.isArray(courseObj.holes)) return;
  try {
    var recentRaw = localStorage.getItem(COURSE_LS_RECENT_KEY);
    var recent = recentRaw ? JSON.parse(recentRaw) : [];
    if (!Array.isArray(recent)) recent = [];
    recent = recent.filter(function (rk) { return rk !== k; });
    recent.push(k);
    while (recent.length > 4) {
      var evict = recent.shift();
      if (evict) localStorage.removeItem(COURSE_LS_PREFIX + evict);
    }
    localStorage.setItem(COURSE_LS_PREFIX + k, JSON.stringify(courseObj));
    localStorage.setItem(COURSE_LS_RECENT_KEY, JSON.stringify(recent));
  } catch (e) { }
}

function ensureCourseLoaded(courseKey, callback) {
  var done = (typeof callback === "function") ? callback : function () { };
  var key = normalizeCourseKey(courseKey);
  if (!key) {
    done(null);
    return;
  }
  var cached = restoreCourseFromLocalCache(key);
  if (cached) {
    done(cached);
    return;
  }
  if (__COURSE_LOAD_QUEUE[key]) {
    __COURSE_LOAD_QUEUE[key].push(done);
    return;
  }
  __COURSE_LOAD_QUEUE[key] = [done];

  var entry = getCourseManifestEntry(key);
  var baseSrc = (entry && entry.file) ? entry.file : ("courses/" + encodeURIComponent(key) + ".js");

  function finishAll(loadedObj) {
    var waiters = __COURSE_LOAD_QUEUE[key] || [];
    delete __COURSE_LOAD_QUEUE[key];
    if (loadedObj) persistCourseToLocalCache(key, loadedObj);
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](loadedObj); } catch (e) { }
    }
  }

  function attemptLoad(attemptNum) {
    var sep = baseSrc.indexOf("?") === -1 ? "?" : "&";
    var srcUrl = baseSrc + sep + "v=20261109f" + (attemptNum > 0 ? ("&retry=" + attemptNum + "_" + Date.now()) : "");
    var scriptEl = document.createElement("script");
    scriptEl.src = srcUrl;
    scriptEl.async = true;
    scriptEl.onload = function () {
      if (isFullCourseLoaded(key)) {
        finishAll(COURSE_CATALOG[key]);
      } else if (attemptNum < 2) {
        setTimeout(function () { attemptLoad(attemptNum + 1); }, 700 * (attemptNum + 1));
      } else {
        finishAll(null);
      }
    };
    scriptEl.onerror = function () {
      if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
      if (attemptNum < 2) {
        setTimeout(function () { attemptLoad(attemptNum + 1); }, 700 * (attemptNum + 1));
      } else {
        finishAll(null);
      }
    };
    (document.head || document.documentElement).appendChild(scriptEl);
  }

  attemptLoad(0);
}

window.normalizeCourseKey = normalizeCourseKey;
window.getCourseManifestEntry = getCourseManifestEntry;
window.isFullCourseLoaded = isFullCourseLoaded;
window.restoreCourseFromLocalCache = restoreCourseFromLocalCache;
window.ensureCourseLoaded = ensureCourseLoaded;
