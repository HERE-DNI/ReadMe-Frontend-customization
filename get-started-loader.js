// Get Started Custom Page loader: injects doc-shell.css, get-started.css, get-started.html and doc-shell.js into #here-gs-mount.
(function () {
  "use strict";

  var BASE = "https://here-dni.github.io/ReadMe-Frontend-customization/";
  var PAGE_URL = BASE + "get-started.html";
  var CSS_URLS = [BASE + "doc-shell.css", BASE + "get-started.css"];
  var JS_URL = BASE + "doc-shell.js";
  var MOUNT_ID = "here-gs-mount";
  var STATE_ATTR = "data-here-gs-mounted"; // "pending" | "1"

  function ensureStyles() {
    CSS_URLS.forEach(function (href, i) {
      var id = "here-gs-css-" + i;
      if (document.getElementById(id)) return;
      var link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  function loadShellScript() {
    // doc-shell.js binds to the .hgs node at run time, so re-run it for every fresh mount.
    var old = document.getElementById("here-gs-js");
    if (old) old.remove();
    var s = document.createElement("script");
    s.id = "here-gs-js";
    s.src = JS_URL;
    document.body.appendChild(s);
  }

  function showError(target, err) {
    target.setAttribute("aria-busy", "false");
    target.innerHTML =
      '<div class="here-glp-shell__error"><strong>Page failed to load</strong>' +
      "Refresh the page. If the problem persists, contact the docs team." +
      (err ? "<br /><br />Error: <code>" + String(err.message || err) + "</code>" : "") +
      "</div>";
  }

  function mount(target) {
    ensureStyles();

    fetch(PAGE_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + PAGE_URL);
        return r.text();
      })
      .then(function (html) {
        var body = new DOMParser().parseFromString(html, "text/html").body;

        // Scripts are loaded explicitly below, with absolute URLs.
        body.querySelectorAll("script").forEach(function (el) { el.remove(); });

        // The page's <body> is the .hgs root (class + HDS theme attrs), so carry those onto the mount.
        target.classList.add("hgs");
        ["data-styles", "data-theme"].forEach(function (name) {
          var v = body.getAttribute(name);
          if (v) target.setAttribute(name, v);
        });

        target.innerHTML = body.innerHTML;
        target.setAttribute("aria-busy", "false");
        target.setAttribute(STATE_ATTR, "1");

        loadShellScript();
      })
      .catch(function (err) {
        console.error("[here-gs-shell] fetch failed:", err);
        target.setAttribute(STATE_ATTR, "1"); // don't retry-loop on failure
        showError(target, err);
      });
  }

  function tryMount() {
    var target = document.getElementById(MOUNT_ID);
    if (!target) return;
    if (target.getAttribute(STATE_ATTR)) return;
    target.setAttribute(STATE_ATTR, "pending");
    mount(target);
  }

  // ReadMe is a client-rendered SPA, so the mount node can appear after the first run.
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

  try {
    new MutationObserver(function () { tryMount(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
