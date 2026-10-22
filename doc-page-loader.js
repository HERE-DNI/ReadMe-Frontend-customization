// Generic doc sub page loader: <section id="here-doc-mount" data-here-doc-page="get-started.html"> loads that page plus its own relative CSS/JS.
(function () {
  "use strict";

  var BASE = "https://here-dni.github.io/ReadMe-Frontend-customization/";
  var MOUNT_ID = "here-doc-mount";
  var PAGE_ATTR = "data-here-doc-page";
  var STATE_ATTR = "data-here-doc-mounted"; // "pending" | "1"

  // Only same-repo (relative) assets are loaded; absolute ones like HDS already come from ReadMe's global head.
  function isRelative(url) {
    return !!url && !/^([a-z]+:)?\/\//i.test(url) && url.charAt(0) !== "/";
  }

  function ensureStyles(doc) {
    doc.querySelectorAll('head link[rel="stylesheet"][href]').forEach(function (el) {
      var href = el.getAttribute("href");
      if (!isRelative(href)) return;
      var abs = BASE + href;
      var exists = Array.prototype.some.call(document.querySelectorAll("link[data-here-doc-css]"), function (l) {
        return l.href === abs;
      });
      if (exists) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = abs;
      link.setAttribute("data-here-doc-css", "");
      document.head.appendChild(link);
    });
  }

  function loadScripts(srcs) {
    // Page scripts bind to the freshly mounted DOM, so re-run them on every mount.
    document.querySelectorAll("script[data-here-doc-js]").forEach(function (el) { el.remove(); });
    srcs.forEach(function (src) {
      var s = document.createElement("script");
      s.src = BASE + src;
      s.async = false; // keep the page's script order
      s.setAttribute("data-here-doc-js", "");
      document.body.appendChild(s);
    });
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
    var page = target.getAttribute(PAGE_ATTR);
    if (!isRelative(page)) {
      target.setAttribute(STATE_ATTR, "1");
      showError(target, new Error("Missing or invalid " + PAGE_ATTR + " on #" + MOUNT_ID));
      return;
    }
    var url = BASE + page;

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var body = doc.body;

        ensureStyles(doc);

        var srcs = [];
        body.querySelectorAll("script").forEach(function (el) {
          var src = el.getAttribute("src");
          if (isRelative(src)) srcs.push(src);
          el.remove();
        });

        // The page's <body> is the .hgs root (class + HDS theme attrs), so carry those onto the mount.
        if (body.className) body.className.split(/\s+/).forEach(function (c) { if (c) target.classList.add(c); });
        ["data-styles", "data-theme"].forEach(function (name) {
          var v = body.getAttribute(name);
          if (v) target.setAttribute(name, v);
        });

        target.innerHTML = body.innerHTML;
        target.setAttribute("aria-busy", "false");
        target.setAttribute(STATE_ATTR, "1");

        loadScripts(srcs);
      })
      .catch(function (err) {
        console.error("[here-doc-shell] fetch failed:", err);
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

  // Guard against double-loading via the <script src> and the onerror fallback.
  if (window.__hereDocPageLoader) { tryMount(); return; }
  window.__hereDocPageLoader = true;

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
