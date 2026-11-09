/* ============================================================================
 * [CourseData.js] Golf Course Catalog Registry & On-Demand Dynamic Course Loader
 * ----------------------------------------------------------------------------
 * - COURSE_MANIFEST (courses/manifest.js) holds lightweight search metadata.
 * - ensureCourseLoaded(courseKey, callback) dynamically loads only the single
 *   active tournament course file (courses/<courseKey>.js, ~30KB) on demand.
 * ============================================================================ */
var COURSE_CATALOG = window.COURSE_CATALOG || {};
window.COURSE_CATALOG = COURSE_CATALOG;

var COURSE_MANIFEST = window.COURSE_MANIFEST || [];
window.COURSE_MANIFEST = COURSE_MANIFEST;

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

function ensureCourseLoaded(courseKey, callback) {
  var done = (typeof callback === "function") ? callback : function () { };
  var key = normalizeCourseKey(courseKey);
  if (!key) {
    done(null);
    return;
  }
  if (COURSE_CATALOG[key] && Array.isArray(COURSE_CATALOG[key].holes) && COURSE_CATALOG[key].holes.length === 18) {
    done(COURSE_CATALOG[key]);
    return;
  }
  if (__COURSE_LOAD_QUEUE[key]) {
    __COURSE_LOAD_QUEUE[key].push(done);
    return;
  }
  __COURSE_LOAD_QUEUE[key] = [done];
  var entry = getCourseManifestEntry(key);
  var srcPath = (entry && entry.file) ? entry.file : ("courses/" + encodeURIComponent(key) + ".js");
  var scriptEl = document.createElement("script");
  scriptEl.src = srcPath;
  scriptEl.async = true;
  scriptEl.onload = function () {
    var waiters = __COURSE_LOAD_QUEUE[key] || [];
    delete __COURSE_LOAD_QUEUE[key];
    var loadedObj = COURSE_CATALOG[key] || null;
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](loadedObj); } catch (e) { }
    }
  };
  scriptEl.onerror = function () {
    var waiters = __COURSE_LOAD_QUEUE[key] || [];
    delete __COURSE_LOAD_QUEUE[key];
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](null); } catch (e) { }
    }
  };
  (document.head || document.documentElement).appendChild(scriptEl);
}

window.normalizeCourseKey = normalizeCourseKey;
window.getCourseManifestEntry = getCourseManifestEntry;
window.ensureCourseLoaded = ensureCourseLoaded;
