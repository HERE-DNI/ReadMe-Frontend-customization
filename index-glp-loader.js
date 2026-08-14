/**
 * HERE Global Landing Page — TEST-ONLY shell loader
 * ────────────────────────────────────────────────────
 * Scope: only acts when a #here-glp-mount element exists on the page.
 * That element only exists on the one Custom Page used for this test
 * (index-shell.html), so this script is a safe no-op everywhere else.
 *
 * Hosted alongside index.html / index-staging.html on GitHub Pages and
 * referenced via <script src="..."> from the Custom Page body, since
 * ReadMe injects Custom Page HTML through React and does not execute
 * inline <script> tags.
 *
 * Staging trigger: ?stagingGLP=true
 */
(function () {
  "use strict";

  var BASE = "https://here-dni.github.io/ReadMe-Frontend-customization/";
  var PROD_URL = BASE + "index.html";
  var STAGING_URL = BASE + "index-staging.html";
  var PARAM = "stagingGLP";
  var MOUNT_ID = "here-glp-mount";
  var STATE_ATTR = "data-here-glp-mounted"; // "pending" | "1"

  function urlHasStagingParam(url) {
    if (!url) return false;
    try {
      var parsed = new URL(url, window.location.origin);
      var raw = (parsed.search || "") + "&" + (parsed.hash || "").replace(/^#/, "");
      return new RegExp("(?:^|[?&#])" + PARAM + "=true(?:&|$)").test(raw);
    } catch (e) {
      return false;
    }
  }

  function isStaging() {
    // 1. This document's own URL (works when not embedded in an iframe).
    if (urlHasStagingParam(window.location.href)) return true;

    // 2. ReadMe renders custom-page content inside an iframe whose own
    //    location is unrelated to the outer docs.here.com URL (e.g.
    //    "?isFramePreview=true"), so the param the user actually set only
    //    exists on the parent/top document. Check those too, guarded for
    //    cross-origin access (throws if blocked, which is expected).
    try {
      if (window.top && window.top !== window && urlHasStagingParam(window.top.location.href)) {
        return true;
      }
    } catch (e) {}

    try {
      if (window.parent && window.parent !== window && urlHasStagingParam(window.parent.location.href)) {
        return true;
      }
    } catch (e) {}

    // 3. Last resort for browsers that block cross-origin frame access.
    if (urlHasStagingParam(document.referrer)) return true;

    return false;
  }

  function bust(u) {
    return isStaging() ? u + (u.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now() : u;
  }

  function showError(mount, message, err) {
    mount.setAttribute("aria-busy", "false");
    mount.innerHTML =
      '<div class="here-glp-shell__error">' +
      "<strong>Landing page failed to load</strong>" +
      message +
      (err ? "<br /><br />Error: <code>" + String(err.message || err) + "</code>" : "") +
      "</div>";
  }

  function reExecuteScripts(root) {
    // innerHTML does not execute inline <script> tags per spec.
    // Clone each into a fresh element so the browser evaluates them.
    root.querySelectorAll("script").forEach(function (oldEl) {
      var s = document.createElement("script");
      Array.prototype.slice.call(oldEl.attributes).forEach(function (a) {
        s.setAttribute(a.name, a.value);
      });
      s.text = oldEl.textContent;
      oldEl.replaceWith(s);
    });
  }

  function showStagingBadge() {
    if (document.getElementById("here-glp-stagingbadge")) return;
    var b = document.createElement("div");
    b.id = "here-glp-stagingbadge";
    b.textContent = "STAGING PREVIEW";
    b.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:999999;" +
      "padding:8px 12px;border-radius:999px;" +
      "background:#dc2626;color:#fff;" +
      "font:700 12px/1 system-ui,sans-serif;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none;";
    document.body.appendChild(b);
  }

  function mount(target) {
    var url = isStaging() ? STAGING_URL : PROD_URL;

    fetch(bust(url), { cache: isStaging() ? "no-store" : "default" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.text();
      })
      .then(function (html) {
        // Strip document-level wrappers so the fragment can be injected.
        html = html
          .replace(/<!DOCTYPE[^>]*>/gi, "")
          .replace(/<\/?html[^>]*>/gi, "")
          .replace(/<head[\s\S]*?<\/head>/gi, "")
          .replace(/<\/?body[^>]*>/gi, "");

        target.innerHTML = html;
        target.setAttribute("aria-busy", "false");
        target.setAttribute(STATE_ATTR, "1");

        if (isStaging()) showStagingBadge();

        reExecuteScripts(target);
      })
      .catch(function (err) {
        console.error("[here-glp-shell] fetch failed:", err);
        target.setAttribute(STATE_ATTR, "1"); // don't retry-loop on failure
        showError(
          target,
          "Refresh the page. If the problem persists, contact the docs team.",
          err
        );
      });
  }

  function tryMount() {
    var target = document.getElementById(MOUNT_ID);
    if (!target) return; // no-op on any page without the test mount node
    if (target.getAttribute(STATE_ATTR)) return; // already mounting or mounted
    target.setAttribute(STATE_ATTR, "pending");
    mount(target);
  }

  // Initial pass, plus SPA route changes (ReadMe is a client-rendered SPA,
  // so the mount node can appear after this script has already run once
  // if the user navigates to the test page without a full reload).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryMount);
  } else {
    tryMount();
  }

  ["pushState", "replaceState"].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      setTimeout(tryMount, 50);
      return result;
    };
  });
  window.addEventListener("popstate", function () { setTimeout(tryMount, 50); });

  // Fallback observer in case ReadMe swaps DOM without a history event.
  try {
    new MutationObserver(function () { tryMount(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
