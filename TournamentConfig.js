/* ============================================================================
 * [TournamentConfig.js] Backend API Endpoint & Neutral Default Template
 * ----------------------------------------------------------------------------
 * - GAS_BACKEND_URL: Deployed Google Apps Script Web App endpoint.
 * - Tournament-specific title, golf course, notices, and player rosters are
 *   created and stored per-tournament via admin.html.
 * ============================================================================ */

var GAS_BACKEND_URL = "https://script.google.com/macros/s/AKfycbwTbkSVy5HW52Wt5OvM7dvr2ZZdWiq5E7--Sf_ecPAsukT9UZy80FZed0jQ7XoA2kDQ/exec";

var TOURNAMENT_CONFIG = {
  tournamentId: "",
  courseKey: "",
  sheetTitle: "",
  tournamentTitle: "",
  heroTitle: "",
  longDriveHoles: [],
  nearPinHoles: [],
  defaultTeeKey: "white",
  noticeTitle: "📢 경기 진행 안내",
  noticeBodyHtml: "",
  noticeLeadHtml: "",
  noticeItems: [],
  teeBannerTitle: "",
  teeBannerSubHtml: "",
  eventBannerSubHtml: "",
  afterPartyHtml: "",
  copyrightHtml: '© Created by <a href="mailto:aries75@gmail.com" style="color:#444; text-decoration:underline; font-weight:700;">aries75@gmail.com</a>',
  firstTeeTime: "",
  groups: []
};
