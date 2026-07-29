// =============================================================================
// HERE DOCS — ReadMe.io Custom UI Bundle
// =============================================================================
//
// PURPOSE
//   This file customizes the HERE developer documentation site, which is hosted
//   on ReadMe.io. It layers HERE's HDS/DHS design system onto ReadMe's native
//   DOM, styling, navigation, and React/SPA runtime.
//
// =============================================================================
// SECTION INDEX
// =============================================================================
//
//   1. Shared SPA Nav Bus             ~line   26   Core nav-change detection & dispatch
//   2. HERE → ReadMe HDS Adapter      ~line  193   HDS widget conversion (callouts, accordions, etc.)
//   3. HERE Mega Menu Injector        ~line  647   Product navigation mega menu
//   4. Image Alt → Caption Bar        ~line 1534   Adds caption bars below doc images
//   5. Footer Language Picker         ~line 1765   Clones ReadMe lang picker into HERE footer
//   6. Render Images in API Responses ~line 2003   Intercepts fetch to preview image API responses
//   7. Ask AI — Custom Button Icon    ~line 2179   Replaces ReadMe's Ask AI button SVG
//   8. Ask AI — Flyout Reskin         ~line 2212   Full visual reskin of Ask AI flyout panel
//   9. Ask AI — Active Chat Header Title ~line 2728  Renames "Assistant" header in active chat
//  10. Ask AI — Active Chat Header Chip  ~line 2808  Injects chip icon in active chat header
//  11. Swagger / OAS Download Button  ~line 3579   Adds "Download Spec" button on Reference pages
//  12. Contact us Button (site-wide)  end-of-file  Adds Contact us pill next to Ask AI on every page
//
// ─────────────────────────────────────────────────────────────────────────────
// 1. SHARED SPA NAV BUS
//    Detects ReadMe SPA route changes via three complementary strategies and
//    dispatches to all registered listeners. All other modules subscribe via
//    window.__here_nav_bus_v1.onNav(fn).
//
//    HIGH RISK to modify — this is the heartbeat of SPA-nav support site-wide.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var TAG = "__here_nav_bus_v1";
  if (window[TAG]) return;

  var _listeners = [];
  var _contentObserver = null;
  var pending = false;
  var lastNavKey = "";

  window[TAG] = {
    onNav: function (fn) {
      _listeners.push(fn);
    },
    _attachContentObserver: function (fn) {
      _attachContentObserver(fn);
    },
  };

  function getNavKey() {
    var path = location.pathname + location.search + location.hash;

    var markdownRoots = document.querySelectorAll(".rm-Markdown");
    var rootCount = markdownRoots.length;

    var firstRoot = markdownRoots[0];
    var firstRootHtml = firstRoot
      ? (firstRoot.getAttribute("id") || "") +
        "::" +
        (firstRoot.className || "") +
        "::" +
        firstRoot.childElementCount
      : "no-root";

    return path + "||" + rootCount + "||" + firstRootHtml;
  }

  function dispatch() {
    var nextKey = getNavKey();

    if (nextKey === lastNavKey) return;
    lastNavKey = nextKey;

    for (var i = 0; i < _listeners.length; i++) {
      try {
        _listeners[i]();
      } catch (e) {}
    }
  }

  function scheduleDispatch() {
    if (pending) return;
    pending = true;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        pending = false;
        dispatch();
      });
    });
  }

  function isLoadingClass(cls) {
    return /\brm-\w+_loading\b/.test(cls);
  }

  // Strategy 1: body loading-class transitions
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type !== "attributes" || m.attributeName !== "class") continue;

      var el = m.target;
      if (
        m.oldValue &&
        isLoadingClass(m.oldValue) &&
        !isLoadingClass(el.className)
      ) {
        scheduleDispatch();
        return;
      }
    }
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    attributeOldValue: true,
  });

  // Strategy 2: new .rm-Markdown root mounted
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      for (var a = 0; a < m.addedNodes.length; a++) {
        var an = m.addedNodes[a];
        if (an.nodeType !== 1) continue;

        if (
          (an.classList && an.classList.contains("rm-Markdown")) ||
          (an.querySelector && an.querySelector(".rm-Markdown"))
        ) {
          scheduleDispatch();
          return;
        }
      }
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Strategy 3: scoped watcher inside .rm-Markdown
  function _attachContentObserver(getMarkdownRoots) {
    if (_contentObserver) _contentObserver.disconnect();

    _contentObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (!m.addedNodes || !m.addedNodes.length) continue;

        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (!node || node.nodeType !== 1) continue;

          var isOwnHdsNode =
            (node.matches &&
              node.matches(
                "hds-banner, hds-accordion, hds-accordion-item, .here-img-caption-bar"
              )) ||
            (node.querySelector &&
              node.querySelector(
                "hds-banner, hds-accordion, hds-accordion-item, .here-img-caption-bar"
              ));

          if (isOwnHdsNode) continue;

          scheduleDispatch();
          return;
        }
      }
    });

    var roots = getMarkdownRoots();
    for (var i = 0; i < roots.length; i++) {
      _contentObserver.observe(roots[i], {
        childList: true,
        subtree: true,
      });
    }
  }

  // Prime the nav key once on load so same-page mutations do not look like nav.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      lastNavKey = getNavKey();
    });
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// 2. HERE → README HDS ADAPTER v15
//    Converts ReadMe-rendered callouts (blockquote.callout) and accordions
//    (details.Accordion) into HDS web components (hds-banner, hds-accordion).
//    Also stamps .rm-Markdown with data-theme / data-styles for HDS scoping.
//
//    HIGH RISK — depends on custom element availability timing, HDS stylesheet
//    loading, and SPA nav sequencing. Retry/reveal logic is intentional.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var TAG = "__here_hds_adapter_v15";
  if (window[TAG]) return;
  window[TAG] = true;

  var DEFAULT_THEME_LIGHT = "hds-web-product-light-theme";
  var DEFAULT_THEME_DARK = "hds-web-product-dark-theme";
  var PROCESSED_ATTR = "data-here-hds-done";

  // Retry budget for waiting on callouts/accordions to appear post-nav.
  var BOOT_MAX_RETRIES = 20;
  var BOOT_INTERVAL = 150;
  var _retries = 0;
  var _retryTimer = null;

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function isCustomPageRoute() {
    return window.location.pathname.indexOf("/page/") !== -1;
  }

  // Full teardown of HDS-injected markup so re-processing starts clean.
  function cleanupProcessedWidgets() {
    qsa("blockquote.callout[" + PROCESSED_ATTR + "]").forEach(function (el) {
      qsa("hds-banner", el).forEach(function (n) {
        n.remove();
      });
      el.removeAttribute(PROCESSED_ATTR);
    });

    qsa("details.Accordion[" + PROCESSED_ATTR + "]").forEach(function (el) {
      qsa("hds-accordion", el).forEach(function (n) {
        n.remove();
      });
      el.removeAttribute(PROCESSED_ATTR);
    });

    qsa(
      ".CardsGrid a.Card[data-hds-card], .CardsGrid a.Card_card[data-hds-card]",
    ).forEach(function (el) {
      el.removeAttribute("data-hds-card");
    });

    qsa(".rdmd-table table[data-hds-table]").forEach(function (el) {
      el.removeAttribute("data-hds-table");
    });

    qsa(".TabGroup[data-hds-tabs]").forEach(function (el) {
      el.removeAttribute("data-hds-tabs");
    });

    qsa(".CodeTabs[data-hds-codetabs]").forEach(function (el) {
      el.removeAttribute("data-hds-codetabs");
    });
  }

  // Hide .rm-Markdown briefly on load so HDS widgets don't flash in
  // un-converted form. Revealed after boot or after 800 ms safety timeout.
  (function hideUntilReady() {
    var styleId = "here-hds-boot-hide";
    if (document.getElementById(styleId)) return;

    var s = document.createElement("style");
    s.id = styleId;
    s.textContent = ".rm-Markdown { opacity: 0; }";
    (document.head || document.documentElement).appendChild(s);

    function reveal() {
      var el = document.getElementById(styleId);
      if (el) el.remove();
    }

    var safetyTimer = setTimeout(reveal, 800);

    window.__here_hds_reveal = function () {
      clearTimeout(safetyTimer);
      reveal();
    };
  })();

  // ── Theme detection ──────────────────────────────────────────────────────

  function getReadMeColorMode() {
    var mode = (
      document.documentElement.getAttribute("data-color-mode") || ""
    ).toLowerCase();
    if (mode === "light" || mode === "dark") return mode;

    // In iframe/editor context ReadMe may store mode on the parent document.
    try {
      mode = (
        window.top.document.documentElement.getAttribute("data-color-mode") ||
        ""
      ).toLowerCase();
      if (mode === "light" || mode === "dark") return mode;
    } catch (e) {}

    return "system";
  }

  function prefersDark() {
    try {
      return !!(
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch (e) {
      return false;
    }
  }

  function getHdsThemeKey() {
    // Allow per-project theme overrides via globals set before this script.
    var light =
      window.top.HERE_HDS_THEME_LIGHT ||
      window.HERE_HDS_THEME_LIGHT ||
      DEFAULT_THEME_LIGHT;
    var dark =
      window.top.HERE_HDS_THEME_DARK ||
      window.HERE_HDS_THEME_DARK ||
      DEFAULT_THEME_DARK;
    var mode = getReadMeColorMode();

    if (mode === "dark") return dark;
    if (mode === "light") return light;
    return prefersDark() ? dark : light;
  }

  // ── Element creation helpers ─────────────────────────────────────────────

  // When running inside an iframe, custom elements must be created in the top
  // document's context so HDS web components register correctly.
  function createEl(tag) {
    try {
      var el = window.top.document.createElement(tag);
      document.adoptNode(el);
      return el;
    } catch (e) {
      return document.createElement(tag);
    }
  }

  function whenDefined(tagName, cb) {
    try {
      var ce = window.top.customElements || customElements;
      if (ce.get(tagName)) {
        cb();
        return;
      }
      ce.whenDefined(tagName)
        .then(cb)
        .catch(function () {});
    } catch (e) {
      try {
        if (customElements.get(tagName)) {
          cb();
          return;
        }
        customElements
          .whenDefined(tagName)
          .then(cb)
          .catch(function () {});
      } catch (e2) {}
    }
  }

  // ── Styles & scoping ─────────────────────────────────────────────────────

  function ensureStyles() {
    if (document.getElementById("here-hds-inner-styles")) return;

    var s = document.createElement("style");
    s.id = "here-hds-inner-styles";
    s.textContent = [
      "blockquote.callout[data-here-hds-done] > *:not(hds-banner) { display: none !important; }",
      "details.Accordion[data-here-hds-done] > *:not(hds-accordion) { display: none !important; }",
      "blockquote.callout[data-here-hds-done] { border: none !important; padding: 0 !important; margin: 0 !important; background: none !important; }",
      "details.Accordion[data-here-hds-done] { border: none !important; background: none !important; }",
      ".rm-Markdown h1 a::before, .rm-Markdown h2 a::before, .rm-Markdown h3 a::before, .rm-Markdown h4 a::before, .rm-Markdown h5 a::before, .rm-Markdown h6 a::before { font-family: 'Font Awesome 6 Pro' !important; }",
    ].join("\n");

    (document.head || document.documentElement).appendChild(s);
  }

function stampMarkdownScopes() {
  var theme = getHdsThemeKey();
  var isCustomPage = isCustomPageRoute();

  var targets = qsa(
    ".rm-Markdown, .rm-Header-bottom, .rm-SearchModal, #AppSearch",
  );

  targets.forEach(function (el) {
    el.setAttribute("data-theme", theme);

    if (isCustomPage) {
      el.removeAttribute("data-styles");
    } else {
      el.setAttribute("data-styles", "hds");
    }
  });
}

  // Stamp as early as possible so first paint is correct.
  (function earlyStamp() {
    stampMarkdownScopes();
  })();

  // ── Widget converters ────────────────────────────────────────────────────

  function bannerState(el) {
    if (el.classList.contains("callout_success")) return "positive";
    if (
      el.classList.contains("callout_warn") ||
      el.classList.contains("callout_warning")
    )
      return "warning";
    if (
      el.classList.contains("callout_error") ||
      el.classList.contains("callout_danger")
    )
      return "error";
    return "informative";
  }

  // Partial reset — only callouts & accordions; used before re-processing on nav.
  function resetProcessed() {
    qsa("blockquote.callout[" + PROCESSED_ATTR + "]").forEach(function (el) {
      qsa("hds-banner", el).forEach(function (n) {
        n.remove();
      });
      el.removeAttribute(PROCESSED_ATTR);
    });

    qsa("details.Accordion[" + PROCESSED_ATTR + "]").forEach(function (el) {
      qsa("hds-accordion", el).forEach(function (n) {
        n.remove();
      });
      el.removeAttribute(PROCESSED_ATTR);
    });
  }

  function convertOneCallout(el) {
    if (el.hasAttribute(PROCESSED_ATTR)) return;
    if (!el.classList.contains("callout")) return;

    var state = bannerState(el);

    var children = Array.prototype.slice.call(el.children).filter(function (c) {
      return !c.classList.contains("callout-icon");
    });

    // A lone paragraph is the callout's whole body, not a title — and a
    // "title" paragraph that contains any markup (links, bold, code, images,
    // etc.) can't safely collapse to .textContent without losing it, so only
    // a plain-text-only first paragraph in a multi-paragraph callout counts.
    var firstIsTitle =
      children.length > 1 &&
      children[0].tagName === "P" &&
      !children[0].querySelector("*");
    var title = firstIsTitle ? (children[0].textContent || "").trim() : "";
    var bodyKids = firstIsTitle ? children.slice(1) : children;

    var banner = createEl("hds-banner");
    banner.setAttribute("state", state);
    banner.setAttribute("icon", "");

    var container = createEl("div");

    if (title) {
      var strong = createEl("strong");
      strong.textContent = title;
      container.appendChild(strong);
      if (bodyKids.length) container.appendChild(createEl("br"));
    }

    var INLINE_TAGS = { P: true, SPAN: true, A: true };

    bodyKids.forEach(function (kid, idx) {
      container.appendChild(kid.cloneNode(true));
      if (idx < bodyKids.length - 1) {
        var nextKid = bodyKids[idx + 1];
        if (INLINE_TAGS[kid.tagName] && INLINE_TAGS[nextKid.tagName]) {
          container.appendChild(createEl("br"));
        }
      }
    });

    // Fallback: extract raw text if no structured children found.
    if (!title && bodyKids.length === 0) {
      var clone = el.cloneNode(true);
      qsa(".callout-icon", clone).forEach(function (n) {
        n.remove();
      });
      container.textContent = (clone.textContent || "").trim();
    }

    banner.appendChild(container);
    el.setAttribute(PROCESSED_ATTR, "1");
    el.appendChild(banner);
  }

  function convertOneAccordion(d) {
    if (d.hasAttribute(PROCESSED_ATTR)) return;
    if (!d.classList.contains("Accordion")) return;

    var summary = d.querySelector("summary");
    var title = summary
      ? (summary.textContent || "").replace(/\s+/g, " ").trim()
      : "Details";
    var content = d.querySelector(".Accordion-content");
    var html = content ? content.innerHTML : "";

    var acc = createEl("hds-accordion");
    acc.setAttribute("expand-mode", "many");
    acc.setAttribute("arrow-position", "end");

    var item = createEl("hds-accordion-item");
    item.setAttribute("headline", title);

    var wrapper = createEl("div");
    wrapper.innerHTML = html;
    item.appendChild(wrapper);
    acc.appendChild(item);

    d.setAttribute(PROCESSED_ATTR, "1");
    d.appendChild(acc);
  }

  function stampWidgets() {
    qsa(".CardsGrid a.Card, .CardsGrid a.Card_card").forEach(function (el) {
      el.setAttribute("data-hds-card", "");
    });
    qsa(".rdmd-table table").forEach(function (t) {
      t.setAttribute("data-hds-table", "");
    });
    qsa(".TabGroup").forEach(function (g) {
      g.setAttribute("data-hds-tabs", "");
    });
    qsa(".CodeTabs").forEach(function (ct) {
      ct.setAttribute("data-hds-codetabs", "");
    });
  }

  function attachContentObserver() {
    window.__here_nav_bus_v1._attachContentObserver(function () {
      return qsa(".rm-Markdown");
    });
  }

  // ── Boot sequence ────────────────────────────────────────────────────────

  function processAll() {
    stampMarkdownScopes();
    attachContentObserver();

    if (isCustomPageRoute()) {
      // Custom pages don't get HDS widget conversion — just cleanup & reveal.
      cleanupProcessedWidgets();
      if (window.__here_hds_reveal) {
        window.__here_hds_reveal();
        window.__here_hds_reveal = null;
      }
      return;
    }

    ensureStyles();
    qsa("blockquote.callout").forEach(convertOneCallout);
    qsa("details.Accordion").forEach(convertOneAccordion);
    stampWidgets();
  }

  function isPageReady() {
    if (!qsa(".rm-Markdown").length) return false;
    if (isCustomPageRoute()) return true;

    return (
      !document.querySelector(
        "blockquote.callout:not([" + PROCESSED_ATTR + "])",
      ) &&
      !document.querySelector("details.Accordion:not([" + PROCESSED_ATTR + "])")
    );
  }

  function cancelRetry() {
    if (_retryTimer !== null) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    _retries = 0;
  }

  function bootWithRetry() {
    processAll();

    if (!isPageReady() && _retries < BOOT_MAX_RETRIES) {
      _retries++;
      _retryTimer = setTimeout(bootWithRetry, BOOT_INTERVAL);
    } else {
      _retryTimer = null;
      if (window.__here_hds_reveal) {
        window.__here_hds_reveal();
        window.__here_hds_reveal = null;
      }
    }
  }

  // Re-run on every SPA navigation.
  window.__here_nav_bus_v1.onNav(function () {
    cancelRetry();
    resetProcessed();
    bootWithRetry();
  });

  // Re-stamp theme when ReadMe's color mode attribute changes (e.g. user toggles).
  // Toggling light/dark makes ReadMe re-render the syntax-highlighted code
  // blocks (new cm-s-* theme, new DOM node for .CodeTabs), which drops the
  // data-hds-codetabs attribute our CSS depends on for layout. Re-stamp
  // widgets here too, not just the markdown scope, so it doesn't require a
  // full reload to look right again. The re-render can land a tick after the
  // attribute flip, so retry once via rAF as a safety net.
  try {
    function restampAfterThemeChange() {
      stampMarkdownScopes();
      if (!isCustomPageRoute()) stampWidgets();
    }

    new MutationObserver(function () {
      restampAfterThemeChange();
      requestAnimationFrame(function () {
        requestAnimationFrame(restampAfterThemeChange);
      });
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-mode"],
    });
  } catch (e) {}

  // Trigger boot when HDS custom elements become available (may be async).
  whenDefined("hds-banner", function () {
    cancelRetry();
    bootWithRetry();
  });

  whenDefined("hds-accordion", function () {
    whenDefined("hds-accordion-item", function () {
      cancelRetry();
      bootWithRetry();
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(bootWithRetry);
      });
    });
  } else {
    requestAnimationFrame(function () {
      requestAnimationFrame(bootWithRetry);
    });
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 3. HERE MEGA MENU INJECTOR v2
//    Replaces ReadMe's native project-picker dropdown in the site header with
//    a HERE product navigation mega menu. Supports EN and JA locales.
//    Re-injects on SPA nav so the menu survives route changes.
//
//    TOC / ANCHOR SAFETY: Click handlers on mega menu items call closeMenu()
//    only. They do NOT call preventDefault(), stopPropagation(), or rewrite
//    hrefs, so native browser anchor navigation is unaffected. Hash-only links
//    inside the page (TOC links) are NOT intercepted by this module.
//
//    HOW TO EDIT / ADD JP ITEMS
//    - Edit the COLUMNS array below.
//    - text.ja = the visible Japanese menu label
//    - href.ja = the Japanese destination URL
//    - showInJa: true = show in the Japanese mega menu
//    - showInJa: false = hide from the Japanese mega menu
//    - showInEn: false = hide from the English mega menu
//    - label.ja = the Japanese column heading
// ─────────────────────────────────────────────────────────────────────────────

// Hide ReadMe's native dropdown immediately to prevent flash before injection.
(function () {
  var STYLE_ID = "here-mm-boot-hide";
  if (document.getElementById(STYLE_ID)) return;

  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    "nav[aria-label='Primary navigation'] [data-testid='dropdown-container']:not(.rm-VersionDropdown) { visibility: hidden !important; }",
    ".Header-subnavnVH8URdkgvEl [data-testid='dropdown-container']:not(.rm-VersionDropdown) { visibility: hidden !important; }",
    "#here-mm-wrapper { visibility: visible !important; }",
  ].join("\n");

  (document.head || document.documentElement).appendChild(s);
})();

(function () {
  var TAG = "__here_megamenu_v2";
  if (window[TAG]) return;
  window[TAG] = true;

  var DEFAULT_LOCALE = "en";
  var INJECTED_ATTR = "data-here-mm-done";

  var _metaObsStarted = false;
  var _globalEventsBound = false;
  var _btn = null;
  var _panel = null;
  var _tryInjectObs = null;

  // ── Locale detection ─────────────────────────────────────────────────────

  function detectLocaleFromPath(pathname) {
    pathname = pathname || window.location.pathname || "";
    var match = pathname.match(/\/([a-z]{2})(?:\/|$)/i);
    if (!match) return DEFAULT_LOCALE;

    var locale = (match[1] || "").toLowerCase();
    if (["ja"].indexOf(locale) > -1) return locale;
    return DEFAULT_LOCALE;
  }

  function getCurrentLocale() {
    return detectLocaleFromPath(window.location.pathname);
  }

  function resolveLocalizedValue(value, locale) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object")
      return value[locale] || value[DEFAULT_LOCALE] || "";
    return "";
  }

  function normalizeHref(href) {
    return href || "#";
  }

  function shouldShowItemInLocale(item, locale) {
    if (locale === "ja") return !!item.showInJa;
    if (locale === "en") return item.showInEn !== false;
    return true;
  }

  function getVisibleColumnsForLocale(locale) {
    var visibleColumns = [];

    COLUMNS.forEach(function (col) {
      var visibleItems = col.items.filter(function (item) {
        return shouldShowItemInLocale(item, locale);
      });

      if (visibleItems.length) {
        visibleColumns.push({
          label: col.label,
          items: visibleItems,
        });
      }
    });

    return visibleColumns;
  }

  // ── Menu data ────────────────────────────────────────────────────────────

  var COLUMNS = [
    {
      label: { en: "Dynamic map content", ja: "ダイナミックマップ" },
      items: [
        {
          text: { en: "HERE Destination Weather", ja: "HERE Destination Weather" },
          href: {
            en: "/here-destination-weather",
            ja: "/here-destination-weather/ja/v1.0/docs/here-destination-weather",
          },
          showInJa: false,
        },
        {
          text: { en: "Map Attributes API", ja: "HERE Map Attributes" },
          href: {
            en: "/map-attributes-api",
            ja: "/map-attributes/ja/v1.0/docs/intro-map-attributes",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE Traffic API", ja: "HERE Traffic API" },
          href: {
            en: "/here-traffic-api",
            ja: "/traffic-api/ja/v1.0/docs/introduction-to-here-traffic-api-v7",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE Real-Time Traffic", ja: "HERE Real-Time Traffic" },
          href: {
            en: "/here-real-time-traffic",
            ja: "/here-real-time-traffic/ja/v1.0/docs/here-real-time-traffic",
          },
          showInJa: false,
        },
        {
          text: {
            en: "HERE Traffic Analytics Speed Data",
            ja: "HERE Traffic Analytics Speed Data",
          },
          href: {
            en: "/here-traffic-analytics",
            ja: "/here-traffic-analytics/ja/v1.0/docs/here-traffic-analytics",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE EV products", ja: "HERE EV products" },
          href: {
            en: "/here-ev-products",
            ja: "/here-ev-products/ja/v1.0/docs/here-ev-products",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE Fuel Prices", ja: "HERE Fuel Prices" },
          href: {
            en: "/here-fuel-prices",
            ja: "/here-fuel-prices/ja/v1.0/docs/here-fuel-prices",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE Parking", ja: "HERE Parking" },
          href: {
            en: "/here-parking",
            ja: "/here-parking/ja/v1.0/docs/here-parking",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE Safety Cameras", ja: "HERE Safety Cameras" },
          href: {
            en: "/here-safety-cameras",
            ja: "/here-safety-cameras/ja/v1.0/docs/here-safety-cameras",
          },
          showInJa: false,
        },
      ],
    },
    {
      label: { en: "Map data", ja: "地図とデータ" },
      items: [
        {
          text: {
            en: "Introduction to Mapping Concepts",
            ja: "HERE Traffic Vector Tile API",
          },
          href: {
            en: "/introduction-to-mapping-c",
            ja: "/traffic-api/ja/v1.0/docs/readme-developer-s-guide",
          },
          showInJa: true,
        },
        {
          text: { en: "GIS Data Suite", ja: "GIS Data Suite" },
          href: {
            en: "/gis-data-suite",
            ja: "/gis-data-suite/ja/v1.0/docs/gis-data-suite",
          },
          showInJa: false,
        },
        {
          text: { en: "Indoor Map", ja: "HERE Indoor Map" },
          href: {
            en: "/indoor-map-skpy",
            ja: "/indoor-map/ja/v1.0/docs/indoor-map-readme",
          },
          showInJa: true,
        },
        {
          text: { en: "Map Content", ja: "Map Content" },
          href: {
            en: "/map-content",
            ja: "/map-content/ja/v1.0/docs/map-content",
          },
          showInJa: false,
        },
        {
          text: { en: "Mapmaking", ja: "Mapmaking" },
          href: { en: "/mapmaking", ja: "/mapmaking/ja/v1.0/docs/mapmaking" },
          showInJa: false,
        },
        {
          text: { en: "Data API", ja: "Data API" },
          href: {
            en: "/data-api-fmrg",
            ja: "/data-api-fmrg/ja/v1.0/docs/data-api",
          },
          showInJa: false,
        },
        {
          text: { en: "Platform MOM", ja: "Platform MOM" },
          href: {
            en: "/platform-mom",
            ja: "/platform-mom/ja/v1.0/docs/platform-mom",
          },
          showInJa: false,
        },
        {
          text: { en: "Optimized Client Map", ja: "Optimized Client Map" },
          href: {
            en: "/optimized-client-map",
            ja: "/optimized-client-map/ja/v1.0/docs/optimized-client-map",
          },
          showInJa: false,
        },
        {
          text: { en: "HD Live Map", ja: "HD Live Map" },
          href: {
            en: "/hd-live-map",
            ja: "/hd-live-map/ja/v1.0/docs/hd-live-map",
          },
          showInJa: false,
        },
        {
          text: { en: "Map Feedback API", ja: "Map Feedback API" },
          href: {
            en: "/map-feedback-api",
            ja: "/map-feedback-api/ja/v1.0/docs/map-feedback-api",
          },
          showInJa: false,
        },
        {
          text: { en: "Maps XML", ja: "Maps XML" },
          href: { en: "/maps-xml", ja: "/maps-xml/ja/v1.0/docs/maps-xml" },
          showInJa: false,
        },
        {
          text: { en: "Embedded Editor", ja: "Embedded Editor" },
          href: {
            en: "/embedded-editor",
            ja: "/embedded-editor/ja/v1.0/docs/embedded-editor",
          },
          showInJa: false,
        },
        {
          text: { en: "Phonetic Training Data", ja: "Phonetic Training Data" },
          href: {
            en: "/phonetic-training-data",
            ja: "/phonetic-training-data/ja/v1.0/docs/phonetic-training-data",
          },
          showInJa: false,
        },
      ],
    },
    {
      label: { en: "Location services", ja: "ロケーションサービス" },
      items: [
        {
          text: { en: "HERE Geocoding & Search", ja: "HERE Geocoding & Search" },
          href: {
            en: "/geocoding-search",
            ja: "/geocoding-and-search/ja/v1.0/docs/introduction-to-here-geocoding-search-api-v7",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE Routing", ja: "HERE Routing" },
          href: {
            en: "/here-routing",
            ja: "/routing/ja/v1.0/docs",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE Map Rendering", ja: "HERE Map Rendering" },
          href: {
            en: "/here-map-rendering",
            ja: "/map-rendering/ja/v1.0/docs",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE Positioning", ja: "HERE Positioning" },
          href: {
            en: "/positioning",
            ja: "/positioning/ja/v1.0/docs",
          },
          showInJa: false,
        },
        
        // Erik-requested additional JP items
        {
          text: { en: "HERE Geofencing API", ja: "HERE Geofencing API" },
          href: {
            en: "/here-routing",
            ja: "/routing/ja/v1.0/docs/intro-geofencing",
          },
          showInJa: false,
          showInEn: false,
        },
        {
          text: { en: "HERE Matrix Routing API", ja: "HERE Matrix Routing API" },
          href: {
            en: "/here-routing",
            ja: "/routing/ja/v1.0/docs/intro-matrix-routing",
          },
          showInJa: false,
          showInEn: false,
        },
        {
          text: { en: "HERE Tracking API", ja: "HERE Tracking API" },
          href: {
            en: "/tracking-api",
            ja: "/tracking/ja/v1.0/docs/",
          },
          showInJa: true,
          showInEn: false,
        },
        {
          text: { en: "HERE Waypoints Sequence", ja: "HERE Waypoints Sequence" },
          href: {
            en: "/here-routing",
            ja: "/routing/ja/v1.0/docs/intro-waypoints-sequence",
          },
          showInJa: false,
          showInEn: false,
        },

        {
          text: { en: "HERE Tour Planning", ja: "HERE Tour Planning" },
          href: {
            en: "/here-tour-planning",
            ja: "/here-tour-planning/ja/v1.0/docs",
          },
          showInJa: true,
        },
        {
          text: { en: "HERE WeGo Pro", ja: "HERE WeGo Pro" },
          href: {
            en: "/wego-pro",
            ja: "/here-wego/ja/v1.0/docs/here-wego",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE Transit", ja: "HERE Transit" },
          href: {
            en: "/here-transit",
            ja: "/here-transit/ja/v1.0/docs/here-transit",
          },
          showInJa: false,
        },
        {
          text: { en: "Tracking API", ja: "Tracking API" },
          href: {
            en: "/tracking-api",
            ja: "/tracking-api/ja/v1.0/docs/readme",
          },
          showInJa: false,
        },
        {
          text: { en: "what3words", ja: "what3words" },
          href: {
            en: "/what3words-diqg",
            ja: "/what3words-diqg/ja/v1.0/docs/what3words",
          },
          showInJa: false,
        },
        {
          text: { en: "Coverage", ja: "Coverage" },
          href: {
            en: "/coverage-kpky",
            ja: "/coverage-kpky/ja/v1.0/docs/coverage",
          },
          showInJa: false,
        },
      ],
    },
    {
      label: { en: "Development enablers", ja: "開発支援" },
      items: [
        {
          text: { en: "HERE Location Reasoning", ja: "HERE Location Reasoning" },
          href: { en: "/location-reasoning", ja: "/location-reasoning" },
          showInJa: false,
        },
        {
          text: { en: "HERE SDK", ja: "HERE SDK" },
          href: { en: "/here-sdk", ja: "/here-sdk/ja/v1.0/docs" },
          showInJa: true,
        },
        {
          text: {
            en: "Maps API for JavaScript",
            ja: "Maps API for JavaScript",
          },
          href: {
            en: "/maps-api-for-js",
            ja: "/maps-api-for-js/ja/v1.0/docs",
          },
          showInJa: true,
        },
        {
          text: { en: "Anonymizer", ja: "Anonymizer" },
          href: {
            en: "/anonymizer",
            ja: "/anonymizer/ja/v1.0/docs/anonymizer",
          },
          showInJa: false,
        },
        {
          text: { en: "HERE Style Editor", ja: "HERE Style Editor" },
          href: {
            en: "/here-style-editor",
            ja: "/here-style-editor/ja/v1.0/docs/here-style-editor",
          },
          showInJa: false,
        },
        {
          text: { en: "SceneXtract", ja: "SceneXtract" },
          href: {
            en: "/scenextract",
            ja: "/scenextract/ja/v1.0/docs/scenextract",
          },
          showInJa: false,
        },
      ],
    },
    {
      label: { en: "Platform tools", ja: "プラットフォーム管理" },
      items: [
        {
          text: {
            en: "Identity and access management",
            ja: "アイデンティティとアクセス管理",
          },
          href: {
            en: "/identity-and-access-management",
            ja: "/identity-and-access-management/ja/v1.0/docs/readme",
          },
          showInJa: true,
        },
        {
          text: { en: "Cost management", ja: "コスト管理" },
          href: {
            en: "/usage-api",
            ja: "/usage/ja/v1.0/docs/cost-management-dev-guide-readme",
          },
          showInJa: true,
        },
        {
          text: { en: "Data SDK", ja: "Data SDK" },
          href: {
            en: "/data-sdk",
            ja: "/data-sdk/ja/v1.0/docs/data-sdk",
          },
          showInJa: false,
        },
        {
          text: { en: "Workspace", ja: "Workspace" },
          href: {
            en: "/workspace-lvmk",
            ja: "/workspace-lvmk/ja/v1.0/docs/workspace",
          },
          showInJa: false,
        },
      ],
    },
    {
      label: { en: "Policies", ja: "プラットフォーム ポリシー" },
      items: [
        {
          text: { en: "Policies", ja: "製品ライフサイクルポリシー" },
          href: {
            en: "/policies",
            ja: "/policies/ja/v1.0/docs/product-lifecycle-policy",
          },
          showInJa: true,
        },
        {
          text: {
            en: "Local maps regulatory approval",
            ja: "サービスレベル契約",
          },
          href: {
            en: "/local-maps-regulatory-approval",
            ja: "/policies/ja/v1.0/docs/here-service-level-agreement",
          },
          showInJa: true,
        },
        {
          text: { en: "System Status API", ja: "System Status API" },
          href: {
            en: "/system-status-api",
            ja: "/system-status-api/ja/v1.0/docs/system-status-api",
          },
          showInJa: false,
        },
      ],
    },
  ];

  // ── Trigger label (shows current project name) ───────────────────────────

  function getProjectNameFromMeta(doc) {
    try {
      var m = doc.querySelector('meta[property="og:site_name"]');
      if (!m) return "";
      return (m.getAttribute("content") || "").replace(/\s+/g, " ").trim();
    } catch (e) {
      return "";
    }
  }

  function setTriggerLabel(text) {
    if (!_btn) return;
    var labelEl = _btn.querySelector(".here-mm-label");
    if (labelEl && text && labelEl.textContent !== text) {
      labelEl.textContent = text;
    }
  }

  function updateTriggerFromMeta(doc) {
    var name = getProjectNameFromMeta(doc);
    if (name) setTriggerLabel(name);
  }

  // Watch for ReadMe SPA meta updates to keep the trigger label in sync.
  function startMetaObserver(doc) {
    if (_metaObsStarted) return;
    _metaObsStarted = true;

    try {
      var head = doc.head || doc.documentElement;
      if (!head) return;

      var last = getProjectNameFromMeta(doc);
      if (last) setTriggerLabel(last);

      new MutationObserver(function () {
        var next = getProjectNameFromMeta(doc);
        if (next && next !== last) {
          last = next;
          setTriggerLabel(next);
        }
      }).observe(head, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch (e) {}
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  function injectStyles(doc) {
    if (doc.getElementById("here-megamenu-styles")) return;

    if (!doc.getElementById("here-hds-styles")) {
      var hds = doc.createElement("link");
      hds.id = "here-hds-styles";
      hds.rel = "stylesheet";
      hds.href = "https://platform.here.com/hds/hds-styles.css";
      (doc.head || doc.documentElement).appendChild(hds);
    }

    var s = doc.createElement("style");
    s.id = "here-megamenu-styles";
    s.textContent = [
      "button.here-mm-trigger { display:inline-flex !important; align-items:center !important; gap:6px !important; padding:0 !important; background:none !important; border:none !important; box-shadow:none !important; cursor:pointer !important; font-family:'FiraGO-Regular','Fira Sans',sans-serif !important; font-size:14px !important; font-style:normal !important; line-height:20px !important; color:#2C596A !important; white-space:nowrap !important; }",
      "[data-color-mode='dark'] button.here-mm-trigger { color:#e0edf0 !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] button.here-mm-trigger { color:#e0edf0 !important; } }",
      "button.here-mm-trigger .here-mm-chevron { display:inline-block !important; width:5px !important; height:5px !important; border-right:1.5px solid #092732 !important; border-bottom:1.5px solid #092732 !important; transform:rotate(45deg) !important; transition:transform 0.2s ease !important; position:relative !important; top:-1px !important; flex-shrink:0 !important; }",
      "[data-color-mode='dark'] button.here-mm-trigger .here-mm-chevron { border-right-color:#e0edf0 !important; border-bottom-color:#e0edf0 !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] button.here-mm-trigger .here-mm-chevron { border-right-color:#e0edf0 !important; border-bottom-color:#e0edf0 !important; } }",
      "button.here-mm-trigger.here-mm-open .here-mm-chevron { transform:rotate(-135deg) !important; top:2px !important; }",
      "div#here-mm-panel { display:none !important; position:fixed !important; min-width:0 !important; max-width:90vw !important; overflow-x:auto !important; background:#ffffff !important; border-width:0 1px 1px 1px !important; border-style:solid !important; border-color:rgba(0,129,177,0.25) !important; border-radius:0 0 4px 4px !important; padding:8px 16px 16px !important; z-index:99999 !important; box-shadow:0 4px 12px rgba(0,0,0,0.08) !important; }",
      "[data-color-mode='dark'] div#here-mm-panel { background:#1a2b30 !important; border-color:rgba(0,129,177,0.35) !important; box-shadow:0 4px 12px rgba(0,0,0,0.32) !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] div#here-mm-panel { background:#1a2b30 !important; border-color:rgba(0,129,177,0.35) !important; box-shadow:0 4px 12px rgba(0,0,0,0.32) !important; } }",
      "div#here-mm-panel.here-mm-open { display:flex !important; }",
      "div#here-mm-panel * { font-family:'FiraGO-Regular','Fira Sans',sans-serif !important; font-style:normal !important; }",
      "div#here-mm-panel .here-mm-content { display:flex !important; flex-direction:row !important; flex-wrap:wrap !important; gap:0 32px !important; }",
      "div#here-mm-panel .here-mm-col { display:flex !important; flex-direction:column !important; min-width:0 !important; max-width:160px !important; }",
      "div#here-mm-panel .here-mm-col-label { font-weight:400 !important; font-family:'FiraGO-Regular','FiraGO','Fira Sans',sans-serif !important; font-size:14px !important; line-height:20px !important; letter-spacing:-0.4px !important; color:#2C596A !important; padding:8px 0 4px 12px !important; white-space:nowrap !important; }",
      "[data-color-mode='dark'] div#here-mm-panel .here-mm-col-label { color:#7ab8cc !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] div#here-mm-panel .here-mm-col-label { color:#7ab8cc !important; } }",
      "div#here-mm-panel a.here-mm-item { display:flex !important; align-items:center !important; padding:4px 12px !important; min-height:32px !important; height:auto !important; font-size:14px !important; line-height:20px !important; letter-spacing:-0.004em !important; color:#092732 !important; white-space:normal !important; word-break:break-word !important; text-decoration:none !important; border-radius:2px !important; background:none !important; }",
      "[data-color-mode='dark'] div#here-mm-panel a.here-mm-item { color:#e0edf0 !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] div#here-mm-panel a.here-mm-item { color:#e0edf0 !important; } }",
      "div#here-mm-panel a.here-mm-item:hover { background:rgba(0,129,177,0.08) !important; color:#0081B1 !important; }",
      "[data-color-mode='dark'] div#here-mm-panel a.here-mm-item:hover { background:rgba(0,129,177,0.18) !important; color:#4dc8f0 !important; }",
      "@media (prefers-color-scheme:dark) { [data-color-mode='system'] div#here-mm-panel a.here-mm-item:hover { background:rgba(0,129,177,0.18) !important; color:#4dc8f0 !important; } }",

      // JP-only spacing rules
      "#here-mm-panel[data-here-locale='ja'] { width:min(1480px, calc(100vw - 48px)) !important; max-width:min(1480px, calc(100vw - 48px)) !important; }",
      "#here-mm-panel[data-here-locale='ja'] .here-mm-content { gap:0 20px !important; align-items:flex-start !important; align-content:flex-start !important; }",
      "#here-mm-panel[data-here-locale='ja'] .here-mm-col { min-width:200px !important; max-width:200px !important; align-self:flex-start !important; }",
      "#here-mm-panel[data-here-locale='ja'] .here-mm-col-label { white-space:normal !important; overflow-wrap:anywhere !important; word-break:break-word !important; padding:8px 0 8px 12px !important; }",
      "#here-mm-panel[data-here-locale='ja'] a.here-mm-item { align-items:flex-start !important; overflow-wrap:anywhere !important; word-break:break-word !important; }",
    ].join("\n");

    (doc.head || doc.documentElement).appendChild(s);
  }

  // ── DOM build ────────────────────────────────────────────────────────────

  function buildMenu(doc) {
    var locale = getCurrentLocale();
    var visibleColumns = getVisibleColumnsForLocale(locale);

    var wrap = doc.createElement("div");
    wrap.id = "here-mm-wrapper";
    wrap.style.cssText =
      "display:inline-flex;align-items:center;position:relative;";
    wrap.setAttribute("data-here-locale", locale);

    var btn = doc.createElement("button");
    btn.className = "here-mm-trigger";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("type", "button");
    btn.innerHTML =
      '<span class="here-mm-label">Introduction to Mapping Concepts</span><span class="here-mm-chevron" aria-hidden="true"></span>';
    wrap.appendChild(btn);

    var panel = doc.createElement("div");
    panel.id = "here-mm-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("data-here-locale", locale);
    panel.setAttribute(
      "aria-label",
      locale === "ja" ? "製品ナビゲーション" : "Product navigation"
    );

    var content = doc.createElement("div");
    content.className = "here-mm-content";

    visibleColumns.forEach(function (col) {
      var colEl = doc.createElement("div");
      colEl.className = "here-mm-col";

      var label = doc.createElement("div");
      label.className = "here-mm-col-label";
      label.textContent = resolveLocalizedValue(col.label, locale);
      colEl.appendChild(label);

      col.items.forEach(function (item) {
        var a = doc.createElement("a");

        a.className = "here-mm-item";
        a.textContent = resolveLocalizedValue(item.text, locale);
        a.href = normalizeHref(resolveLocalizedValue(item.href, locale));

        // Close the menu when a product link is clicked.
        // IMPORTANT: Do NOT call preventDefault() or stopPropagation() here —
        // these are full-page navigation links, not hash/anchor links.
        a.addEventListener("click", function () {
          closeMenu();
        });

        colEl.appendChild(a);
      });

      content.appendChild(colEl);
    });

    panel.appendChild(content);
    doc.body.appendChild(panel);

    return { wrap: wrap, btn: btn, panel: panel };
  }

  // ── Panel positioning ────────────────────────────────────────────────────

  function positionPanel(btn, panel) {
    if (!btn || !panel) return;

    var nav = btn.closest(
      ".rm-Header-bottom, .Header-bottom2eLKOFXMEmh5, nav, header"
    );
    var r = (nav || btn).getBoundingClientRect();
    var vpW = window.innerWidth;
    var maxW = Math.min(panel.scrollWidth || 900, vpW * 0.9);
    var left = Math.min(
      btn.getBoundingClientRect().left,
      vpW - maxW - vpW * 0.05
    );
    left = Math.max(left, vpW * 0.05);

    panel.style.top = r.bottom + "px";
    panel.style.left = Math.round(left) + "px";
    panel.style.right = "auto";
    panel.style.maxWidth = Math.round(maxW) + "px";
  }

  // ── Open / close ─────────────────────────────────────────────────────────

  function openMenu() {
    if (!_btn || !_panel) return;
    _panel.classList.add("here-mm-open");
    _btn.classList.add("here-mm-open");
    _btn.setAttribute("aria-expanded", "true");
    positionPanel(_btn, _panel);
  }

  function closeMenu() {
    if (!_btn || !_panel) return;
    _panel.classList.remove("here-mm-open");
    _btn.classList.remove("here-mm-open");
    _btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (!_panel) return;
    _panel.classList.contains("here-mm-open") ? closeMenu() : openMenu();
  }

  // ── Global event bindings ────────────────────────────────────────────────

  function bindGlobalEvents(doc) {
    if (_globalEventsBound) return;
    _globalEventsBound = true;

    // Close on outside click. This listener does NOT intercept TOC anchor clicks
    // because it only acts when the click is outside both the button and panel.
    doc.addEventListener("click", function (e) {
      if (!_btn || !_panel) return;

      var anchor = e.target.closest("a");
      if (anchor && (anchor.getAttribute("href") || "").charAt(0) === "#")
        return;

      if (!_btn.contains(e.target) && !_panel.contains(e.target)) {
        closeMenu();
      }
    });

    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    window.addEventListener("resize", function () {
      if (_panel && _panel.classList.contains("here-mm-open")) {
        positionPanel(_btn, _panel);
      }
    });
  }

  // ── Injection ────────────────────────────────────────────────────────────

  function inject(doc) {
    var subnav = doc.querySelector(
      "nav[aria-label='Primary navigation'], .Header-subnavnVH8URdkgvEl"
    );
    if (!subnav) return false;

    var rmContainer = subnav.querySelector("[data-testid='dropdown-container']");
    if (!rmContainer) return false;

    var existingWrap = subnav.querySelector("#here-mm-wrapper");
    var existingPanel = doc.getElementById("here-mm-panel");
    var locale = getCurrentLocale();

    // If our markup is already in the subnav, re-wire and re-hide the native
    // container without requiring the ProjectPicker to be present — it may
    // render differently on pages like changelog.
    if (existingWrap && existingPanel) {
      var existingLocale =
        existingPanel.getAttribute("data-here-locale") ||
        existingWrap.getAttribute("data-here-locale") ||
        DEFAULT_LOCALE;

      if (existingLocale === locale) {
        injectStyles(doc);
        bindGlobalEvents(doc);

        _btn = existingWrap.querySelector(".here-mm-trigger");
        _panel = existingPanel;

        updateTriggerFromMeta(doc);
        startMetaObserver(doc);

        rmContainer.style.display = "none";
        rmContainer.setAttribute(INJECTED_ATTR, "1");
        return true;
      }
    }

    // For a fresh inject, wait until ReadMe's project picker is actually present
    // so we know this is the right container and not a different dropdown.
    if (
      !rmContainer.querySelector(".rm-ProjectPicker, [class*='ProjectPicker']")
    ) {
      return false;
    }

    injectStyles(doc);
    bindGlobalEvents(doc);

    // Stale markup from a previous inject — remove before rebuilding.
    if (existingWrap && existingWrap.parentNode)
      existingWrap.parentNode.removeChild(existingWrap);
    if (existingPanel && existingPanel.parentNode)
      existingPanel.parentNode.removeChild(existingPanel);
    rmContainer.removeAttribute(INJECTED_ATTR);

    var built = buildMenu(doc);
    _btn = built.btn;
    _panel = built.panel;

    updateTriggerFromMeta(doc);
    startMetaObserver(doc);

    rmContainer.style.display = "none";
    rmContainer.setAttribute(INJECTED_ATTR, "1");
    rmContainer.parentNode.insertBefore(built.wrap, rmContainer);

    _btn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu();
    });

    return true;
  }

  // Attempt inject; if the header isn't ready yet, watch for it via observer.
  // Uses a time-based cutoff instead of a mutation count so pages with lots of
  // DOM activity (e.g. changelog) don't exhaust the budget before the header
  // finishes rendering.
  function tryInject() {
    var doc = document;
    if (inject(doc)) return;

    if (_tryInjectObs) {
      _tryInjectObs.disconnect();
      _tryInjectObs = null;
    }

    var deadline = Date.now() + 10000;
    var obs = new MutationObserver(function () {
      if (inject(doc) || Date.now() > deadline) {
        obs.disconnect();
        if (_tryInjectObs === obs) _tryInjectObs = null;
      }
    });
    _tryInjectObs = obs;

    try {
      obs.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      if (_tryInjectObs === obs) _tryInjectObs = null;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInject);
  } else {
    tryInject();
  }

  window.__here_nav_bus_v1.onNav(function () {
    tryInject();
  });
})();


// ─────────────────────────────────────────────────────────────────────────────
// 4. IMAGE ALT → CAPTION BAR v2
//    Adds a styled caption bar below doc images that have meaningful alt text.
//    Re-runs on every SPA nav. Uses a scoped MutationObserver on .rm-Markdown
//    rather than a global observer to avoid unnecessary overhead.
//
//    LOW RISK — purely additive; does not modify existing DOM elements.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var TAG = "__here_img_alt_caption_v2";
  if (window[TAG]) return;
  window[TAG] = true;

  var CAPTION_ATTR = "data-here-img-caption";
  var STYLE_ID = "here-img-caption-style";

  var contentObs = null;
  var rafPending = false;

  // Short burst retry for post-nav images not yet in DOM.
  var _retryTimer = null;
  var _retryCount = 0;
  var RETRY_MAX = 20;
  var RETRY_MS = 150;

  function cancelRetry() {
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    _retryCount = 0;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      ".here-img-caption-bar {",
      "  display: block;",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  text-align: left;",
      "  background: rgba(0,0,0,0.04);",
      "  border: 1px solid rgba(0,0,0,0.06);",
      "  border-top: 0;",
      "  padding: 10px 12px;",
      "  font-style: italic;",
      "  font-size: 13px;",
      "  line-height: 18px;",
      "  color: rgba(0,0,0,0.72);",
      "  border-radius: 0 0 6px 6px;",
      "  margin-bottom: 16px;",
      "}",
      "html[data-color-mode='dark'] .here-img-caption-bar {",
      "  background: rgba(255,255,255,0.06);",
      "  border-color: rgba(255,255,255,0.10);",
      "  color: rgba(255,255,255,0.78);",
      "}",
    ].join("\n");

    (document.head || document.documentElement).appendChild(s);
  }

  function removeAllCaptions() {
    var bars = document.querySelectorAll(".here-img-caption-bar");
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].parentNode) bars[i].parentNode.removeChild(bars[i]);
    }
    // Clear processed markers so images are re-evaluated on the next pass.
    var marked = document.querySelectorAll("img[" + CAPTION_ATTR + "]");
    for (var j = 0; j < marked.length; j++) {
      marked[j].removeAttribute(CAPTION_ATTR);
    }
  }

  function isMeaningfulAlt(alt) {
    if (!alt) return false;
    var a = alt.replace(/\s+/g, " ").trim();
    if (!a) return false;
    // Skip generic placeholder alt text that adds no value as a caption.
    if (a.toLowerCase() === "image" || a.toLowerCase() === "screenshot")
      return false;
    return true;
  }

  // Find the lightbox wrapper if present; fall back to the img element itself.
  function closestImageWrapper(img) {
    var el = img;
    while (el && el !== document.body) {
      if (
        el.classList &&
        el.classList.contains("img") &&
        el.classList.contains("lightbox")
      ) {
        return el;
      }
      if (el.classList && el.classList.contains("rm-Markdown")) break;
      el = el.parentElement;
    }
    return img;
  }

  function addCaptionForImage(img) {
    if (!img || img.nodeType !== 1) return;
    if (!img.closest || !img.closest(".rm-Markdown")) return;
    if (
      img.classList &&
      (img.classList.contains("emoji") || img.classList.contains("icon"))
    )
      return;
    if (img.getAttribute(CAPTION_ATTR) === "1") return;

    var alt = (img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    if (!isMeaningfulAlt(alt)) return;

    var target = closestImageWrapper(img);
    if (!target || !target.parentNode) return;

    var cap = document.createElement("span");
    cap.className = "here-img-caption-bar";
    cap.textContent = alt;

    var after = target.nextSibling;
    if (after) {
      target.parentNode.insertBefore(cap, after);
    } else {
      target.parentNode.appendChild(cap);
    }

    img.setAttribute(CAPTION_ATTR, "1");
  }

  function processAll() {
    ensureStyles();
    removeAllCaptions();

    var imgs = document.querySelectorAll(".rm-Markdown img");
    for (var i = 0; i < imgs.length; i++) {
      addCaptionForImage(imgs[i]);
    }
    return imgs.length;
  }

  function scheduleRetry() {
    if (_retryCount >= RETRY_MAX) return;
    _retryCount++;
    _retryTimer = setTimeout(function () {
      var found = processAll();
      observeMarkdownContainers();
      if (found === 0 && _retryCount < RETRY_MAX) {
        scheduleRetry();
      } else {
        cancelRetry();
      }
    }, RETRY_MS);
  }

  // Scoped observer on .rm-Markdown containers; reconnected after each nav.
  function observeMarkdownContainers() {
    if (contentObs) {
      contentObs.disconnect();
      contentObs = null;
    }

    var containers = document.querySelectorAll(".rm-Markdown");
    if (!containers.length) return;

    contentObs = new MutationObserver(function (mutations) {
      var relevant = false;

      for (var i = 0; i < mutations.length; i++) {
        if (
          mutations[i].addedNodes.length ||
          mutations[i].removedNodes.length
        ) {
          relevant = true;
          break;
        }
      }

      if (!relevant) return;

      removeAllCaptions();

      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            rafPending = false;
            processAll();
            observeMarkdownContainers();
          });
        });
      }
    });

    containers.forEach(function (c) {
      contentObs.observe(c, { childList: true, subtree: true });
    });
  }

  window.__here_nav_bus_v1.onNav(function () {
    cancelRetry();
    processAll();
    observeMarkdownContainers();
    scheduleRetry();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          processAll();
          observeMarkdownContainers();
          scheduleRetry();
        });
      });
    });
  } else {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        processAll();
        observeMarkdownContainers();
        scheduleRetry();
      });
    });
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 5. FOOTER LANGUAGE PICKER
//    Clones ReadMe's native language picker (tippy-powered) into the HERE
//    footer slots on interior pages only. Restores the custom homepage footer
//    EN/JA pills on root / GLP pages.
//
//    IMPORTANT
//    - Uses both EN and JA footer i18n blocks, so /ja interior pages work.
//    - Restores original footer pills on homepage / GLP routes.
//    - Re-runs on SPA nav via the HERE nav bus.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var TAG = "__here_footer_lang_picker_v3";
  if (window[TAG]) return;
  window[TAG] = true;

  var blockedPaths = ["/", "/ja", "/ja/"];
  var footerInterval = null;
  var ORIGINAL_SLOTS = {};

  var GLOBE_SVG =
    '<svg class="here-footer-lang-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<g clip-path="url(#here-footer-lang-clip)">' +
    '<path d="M8.78006 1.37969C8.26192 1.31745 7.73819 1.31745 7.22006 1.37969C5.59973 1.57242 4.10635 2.35272 3.02281 3.57279C1.93927 4.79285 1.34082 6.36794 1.34082 7.99969C1.34082 9.63144 1.93927 11.2065 3.02281 12.4266C4.10635 13.6467 5.59973 14.427 7.22006 14.6197C7.73374 14.6819 8.25304 14.6819 8.76672 14.6197C10.3871 14.427 11.8804 13.6467 12.964 12.4266C14.0475 11.2065 14.646 9.63144 14.646 7.99969C14.646 6.36794 14.0475 4.79285 12.964 3.57279C11.8804 2.35272 10.3871 1.57242 8.76672 1.37969H8.78006ZM12.6134 5.33302H10.8401C10.5536 4.51583 10.1944 3.726 9.76672 2.97302C10.9685 3.3919 11.9791 4.22973 12.6134 5.33302ZM10.0001 7.99969C9.9958 8.44866 9.94214 8.89579 9.84006 9.33302H6.16006C6.05798 8.89579 6.00432 8.44866 6.00006 7.99969C6.00432 7.55072 6.05798 7.10358 6.16006 6.66635H9.84006C9.94214 7.10358 9.9958 7.55072 10.0001 7.99969ZM8.00006 2.66635C8.55913 3.50686 9.03473 4.4 9.42006 5.33302H6.58006C6.96539 4.4 7.44098 3.50686 8.00006 2.66635ZM6.23339 2.97302C5.80573 3.726 5.44652 4.51583 5.16006 5.33302H3.38672C4.02106 4.22973 5.03165 3.3919 6.23339 2.97302ZM2.84006 6.66635H4.80006C4.62228 7.54635 4.62228 8.45302 4.80006 9.33302H2.84006C2.60888 8.45916 2.60888 7.54021 2.84006 6.66635ZM3.38672 10.6664H5.16006C5.44652 11.4835 5.80573 12.2734 6.23339 13.0264C5.03165 12.6075 4.02106 11.7696 3.38672 10.6664ZM8.00006 13.333C7.44098 12.4925 6.96539 11.5994 6.58006 10.6664H9.42006C9.03473 11.5994 8.55913 12.4925 8.00006 13.333ZM9.76672 13.0264C10.1944 12.2734 10.5536 11.4835 10.8401 10.6664H12.6134C11.9791 11.7696 10.9685 12.6075 9.76672 13.0264ZM11.2001 9.33302C11.3778 8.45302 11.3778 7.54635 11.2001 6.66635H13.1601C13.3912 7.54021 13.3912 8.45916 13.1601 9.33302H11.2001Z" fill="currentColor"/>' +
    "</g>" +
    '<defs><clipPath id="here-footer-lang-clip"><rect width="16" height="16" fill="white"/></clipPath></defs>' +
    "</svg>";

  var CHEVRON_SVG =
    '<svg class="here-footer-lang-chevron" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M6 4.58L10.59 0L12 1.41L6 7.41L0 1.41L1.41 0L6 4.58Z" fill="currentColor"/>' +
    "</svg>";

  var LABEL_EN = "Select language";
  var LABEL_JA = "言語を選択";

  function getPath() {
    return window.location.pathname || "";
  }

  function isGlpPage() {
    return !!document.querySelector(".here-glp");
  }

  function shouldUseNativeFooterPicker() {
    var path = getPath();
    if (blockedPaths.indexOf(path) > -1) return false;
    if (isGlpPage()) return false;
    return true;
  }

  function ensureStyles() {
    if (document.getElementById("here-footer-lang-styles")) return;

    var s = document.createElement("style");
    s.id = "here-footer-lang-styles";
    s.textContent = [
      ".here-footer-lang-wrapper { display: inline-flex; align-items: center; }",
      ".here-footer-lang-btn {",
      "  display: inline-flex; align-items: center; gap: 6px;",
      "  padding: 0; background: none; border: none; box-shadow: none;",
      "  cursor: pointer; font-family: 'FiraGO-Regular','Fira Sans',sans-serif;",
      "  font-size: 14px; line-height: 20px; color: #092732;",
      "  white-space: nowrap; min-width: 222px; text-align: left;",
      "}",
      ".here-footer-lang-icon { flex-shrink: 0; color: inherit; }",
      ".here-footer-lang-label { color: inherit; display: inline-block; }",
      ".here-footer-lang-chevron {",
      "  flex-shrink: 0; color: #2C596A; margin-left: auto;",
      "  transform: translateX(-30px);",
      "}",
      "[data-color-mode='dark'] .here-footer-lang-btn { color: #e0edf0; }",
      "[data-color-mode='dark'] .here-footer-lang-chevron { color: #e0edf0; }",
      "@media (prefers-color-scheme: dark) {",
      "  [data-color-mode='system'] .here-footer-lang-btn { color: #e0edf0; }",
      "  [data-color-mode='system'] .here-footer-lang-chevron { color: #e0edf0; }",
      "}",
      ".here-footer-lang-btn:hover { opacity: 0.75; }",
    ].join("\n");

    (document.head || document.documentElement).appendChild(s);
  }

  function getLabelForLang(lang) {
    return lang === "ja" ? LABEL_JA : LABEL_EN;
  }

  function getTippySource() {
    var langPicker = document.querySelector(".LangPicker17mF-TSKPUmJ");
    if (!langPicker) return null;

    var originalBtn = langPicker.querySelector("button");
    if (!originalBtn || !originalBtn._tippy) return null;

    return originalBtn;
  }

  function snapshotOriginalSlots() {
    document
      .querySelectorAll(".here-footer__i18n[data-lang]")
      .forEach(function (block) {
        var lang = block.getAttribute("data-lang");
        if (!lang || ORIGINAL_SLOTS[lang]) return;

        var slot = block.querySelector(".here-footer__lang");
        if (!slot) return;

        ORIGINAL_SLOTS[lang] = slot.outerHTML;
      });
  }

  function htmlToNode(html) {
    var temp = document.createElement("div");
    temp.innerHTML = html;
    return temp.firstElementChild;
  }

  function restoreOriginalSlots() {
    Object.keys(ORIGINAL_SLOTS).forEach(function (lang) {
      var block = document.querySelector(
        '.here-footer__i18n[data-lang="' + lang + '"]',
      );
      if (!block) return;

      var wrapper = block.querySelector(".here-footer-lang-wrapper");
      var slot = block.querySelector(".here-footer__lang");

      if (slot) return;
      if (!wrapper) return;

      var originalNode = htmlToNode(ORIGINAL_SLOTS[lang]);
      if (!originalNode) return;

      wrapper.replaceWith(originalNode);
    });
  }

  function buildWrapper(lang) {
    var labelText = getLabelForLang(lang);

    var wrapper = document.createElement("span");
    wrapper.className = "here-footer-lang-wrapper";

    var btn = document.createElement("button");
    btn.className = "here-footer-lang-btn";
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", labelText);
    btn.innerHTML =
      GLOBE_SVG +
      '<span class="here-footer-lang-label">' +
      labelText +
      "</span>" +
      CHEVRON_SVG;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();

      var sourceBtn = getTippySource();
      if (!sourceBtn || !sourceBtn._tippy) return;

      sourceBtn._tippy.setProps({
        getReferenceClientRect: function () {
          return btn.getBoundingClientRect();
        },
      });
      sourceBtn._tippy.show();
    });

    wrapper.appendChild(btn);
    return wrapper;
  }

  function injectNativePickers() {
    var sourceBtn = getTippySource();
    if (!sourceBtn || !sourceBtn._tippy) return false;

    ensureStyles();

    document
      .querySelectorAll(".here-footer__i18n[data-lang]")
      .forEach(function (block) {
        var lang = block.getAttribute("data-lang");
        if (!lang) return;

        if (block.querySelector(".here-footer-lang-wrapper")) return;

        var slot = block.querySelector(".here-footer__lang");
        if (!slot) return;

        if (!ORIGINAL_SLOTS[lang]) {
          ORIGINAL_SLOTS[lang] = slot.outerHTML;
        }

        slot.replaceWith(buildWrapper(lang));
      });

    return true;
  }

  function initFooterLangPicker() {
    snapshotOriginalSlots();

    if (!shouldUseNativeFooterPicker()) {
      restoreOriginalSlots();
      return true;
    }

    return injectNativePickers();
  }

  function stopPolling() {
    if (footerInterval) {
      clearInterval(footerInterval);
      footerInterval = null;
    }
  }

  function startPolling() {
    stopPolling();

    footerInterval = setInterval(function () {
      if (initFooterLangPicker()) stopPolling();
    }, 300);

    if (initFooterLangPicker()) stopPolling();
  }

  startPolling();

  try {
    if (window.__here_nav_bus_v1 && window.__here_nav_bus_v1.onNav) {
      window.__here_nav_bus_v1.onNav(function () {
        startPolling();
      });
    }
  } catch (e) {}
})();

// ─────────────────────────────────────────────────────────────────────────────
// 6. RENDER IMAGES IN API RESPONSES
//    Patches window.fetch to intercept responses from the ReadMe Try-It proxy
//    (try.readme.io). When the response Content-Type is an image, renders a
//    preview directly in the response panel instead of showing binary garbage.
//
//    The console.log statements are intentional — useful for debugging API
//    explorer issues in the live environment.
//
//    MEDIUM RISK — patches window.fetch; exercise caution if ReadMe changes
//    the proxy URL or the response panel DOM structure.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var TAG = "__rm_tryit_image_overlay_live_v2";
  if (window[TAG]) return;
  window[TAG] = true;

  console.log("[image-preview] hook loaded:", location.href);

  var origFetch = window.fetch;

  function injectIntoResponsePanel(blob, meta) {
    var panel = document.querySelector(
      ".APIResponse3FBSi0-qfTQs pre.CodeSnippet .react-codemirror2, " +
        "[class*='APIResponse'] pre.CodeSnippet .react-codemirror2",
    );

    if (!panel) {
      console.warn(
        "[image-preview] response panel not found, falling back to popup",
      );
      showPopup(blob, meta);
      return;
    }

    // Revoke any previous object URL to avoid memory leaks.
    var prev = panel.querySelector("img[data-rm-preview]");
    if (prev && prev.dataset && prev.dataset.objUrl) {
      URL.revokeObjectURL(prev.dataset.objUrl);
    }

    var objUrl = URL.createObjectURL(blob);

    panel.innerHTML = "";
    panel.style.cssText =
      "overflow:auto;max-height:calc(100vh - 200px);background:#fff;";

    var wrap = document.createElement("div");
    wrap.style.cssText =
      "padding:16px;display:flex;flex-direction:column;gap:10px;";

    var metaDiv = document.createElement("div");
    metaDiv.style.cssText =
      "font:11px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial;" +
      "color:rgba(0,0,0,.5);word-break:break-all;";
    metaDiv.innerHTML =
      "<strong>Content-Type:</strong> " +
      meta.ct +
      " &nbsp;|&nbsp; " +
      "<strong>Status:</strong> " +
      meta.status;

    var img = document.createElement("img");
    img.src = objUrl;
    img.alt = "Image response";
    img.dataset.rmPreview = "1";
    img.dataset.objUrl = objUrl;
    img.style.cssText =
      "max-width:100%;height:auto;border-radius:8px;" +
      "border:1px solid rgba(0,0,0,.1);display:block;";

    var dl = document.createElement("a");
    dl.href = objUrl;
    dl.download = "response." + (meta.ct.split("/")[1] || "png");
    dl.textContent = "⬇ Download image";
    dl.style.cssText =
      "font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial;" +
      "color:#0070f3;text-decoration:none;";

    wrap.appendChild(metaDiv);
    wrap.appendChild(dl);
    wrap.appendChild(img);
    panel.appendChild(wrap);

    console.log("[image-preview] injected into response panel");
  }

  function showPopup(blob, meta) {
    var objUrl = URL.createObjectURL(blob);

    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;" +
      "display:flex;align-items:center;justify-content:center;padding:24px;";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });

    var modal = document.createElement("div");
    modal.style.cssText =
      "width:min(980px,calc(100vw - 48px));max-height:calc(100vh - 48px);" +
      "overflow:auto;background:#fff;border-radius:16px;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.35);padding:14px;";

    var header = document.createElement("div");
    header.style.cssText =
      "display:flex;gap:10px;align-items:flex-start;justify-content:space-between;margin-bottom:10px;";

    var info = document.createElement("div");
    info.style.cssText =
      "font:12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial;color:rgba(0,0,0,.7);word-break:break-all;";
    info.innerHTML =
      "<div><strong>Image preview</strong></div>" +
      "<div><strong>Status:</strong> " +
      meta.status +
      "</div>" +
      "<div><strong>Content-Type:</strong> " +
      meta.ct +
      "</div>";

    var closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText =
      "padding:7px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.15);" +
      "background:#fff;cursor:pointer;font:13px/1.2 system-ui;";
    closeBtn.onclick = function () {
      overlay.remove();
    };

    header.appendChild(info);
    header.appendChild(closeBtn);

    var img = document.createElement("img");
    img.src = objUrl;
    img.style.cssText =
      "max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(0,0,0,.08);";

    modal.appendChild(header);
    modal.appendChild(img);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  window.fetch = async function () {
    var args = arguments;
    var req = args[0];
    var url = (typeof req === "string" ? req : req && req.url) || "";
    var res = await origFetch.apply(window, args);

    try {
      // Only intercept ReadMe's Try-It proxy — ignore all other fetch calls.
      if (!url.startsWith("https://try.readme.io/https://")) return res;

      var ct = (res.headers.get("content-type") || "").toLowerCase();
      console.log("[image-preview] try proxy response:", res.status, ct, url);

      if (res.ok && ct.startsWith("image/") && res.body) {
        var clone = res.clone();
        setTimeout(function () {
          clone.blob().then(function (blob) {
            injectIntoResponsePanel(blob, {
              url: url,
              ct: ct,
              status: res.status,
            });
          });
        }, 120);
      }
    } catch (e) {
      console.warn("[image-preview] error:", e);
    }

    return res;
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// 7. ASK AI — CUSTOM BUTTON ICON
//    Replaces the default SVG inside ReadMe's Ask AI trigger button with the
//    HERE chip icon. Uses a persistent MutationObserver so the icon survives
//    ReadMe re-rendering the button after SPA navigation.
//
//    LOW RISK — additive; hides the original SVG rather than removing it.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var iconMarkup =
    '<svg class="custom-ask-ai-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M14 9H13V7H14C14.2652 7 14.5196 6.89464 14.7071 6.70711C14.8946 6.51957 15 6.26522 15 6C15 5.73478 14.8946 5.48043 14.7071 5.29289C14.5196 5.10536 14.2652 5 14 5H13V3H11V2C11 1.73478 10.8946 1.48043 10.7071 1.29289C10.5196 1.10536 10.2652 1 10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289C9.10536 1.48043 9 1.73478 9 2V3H7V2C7 1.73478 6.89464 1.48043 6.70711 1.29289C6.51957 1.10536 6.26522 1 6 1C5.73478 1 5.48043 1.10536 5.29289 1.29289C5.10536 1.48043 5 1.73478 5 2V3H3V5H2C1.73478 5 1.48043 5.10536 1.29289 5.29289C1.10536 5.48043 1 5.73478 1 6C1 6.26522 1.10536 6.51957 1.29289 6.70711C1.48043 6.89464 1.73478 7 2 7H3V9H2C1.73478 9 1.48043 9.10536 1.29289 9.29289C1.10536 9.48043 1 9.73478 1 10C1 10.2652 1.10536 10.5196 1.29289 10.7071C1.48043 10.8946 1.73478 11 2 11H3V13H5V14C5 14.2652 5.10536 14.5196 5.29289 14.7071C5.48043 14.8946 5.73478 15 6 15C6.26522 15 6.51957 14.8946 6.70711 14.7071C6.89464 14.5196 7 14.2652 7 14V13H9V14C9 14.2652 9.10536 14.5196 9.29289 14.7071C9.48043 14.8946 10.2652 15 10 15C10.2652 15 10.5196 14.8946 10.7071 14.7071C10.8946 14.5196 11 14.2652 11 14V13H13V11H14C14.2652 11 14.5196 10.8946 14.7071 10.7071C14.8946 10.5196 15 10.2652 15 10C15 9.73478 14.8946 9.48043 14.7071 9.29289C14.5196 9.10536 14.2652 9 14 9ZM11 11H5V5H11V11ZM9 9H7V7H9V9Z" fill="#1EF3E4"/>' +
    "</svg>";

  function injectIcon() {
    document.querySelectorAll(".rm-AskAi-button").forEach(function (button) {
      if (button.querySelector(".custom-ask-ai-icon")) return;

      var oldSvg = button.querySelector("svg");
      if (oldSvg) oldSvg.style.display = "none";

      button.insertAdjacentHTML("afterbegin", iconMarkup);
    });
  }

  new MutationObserver(injectIcon).observe(document.body, {
    childList: true,
    subtree: true,
  });

  injectIcon();
})();

// ─────────────────────────────────────────────────────────────────────────────
// 8. ASK AI — FLYOUT RESKIN v12
//    Full visual reskin of the ReadMe Ask AI flyout panel to match HERE's
//    HDS/DHS design language: typography, colors, chip icon, send button, etc.
//    Applies to both light and dark color modes.
//
//    IMPORTANT
//    - All styling is now tightly scoped to Ask AI flyout roots stamped with
//      [data-here-askai-root] so unrelated ReadMe UI (including loaders) is
//      not affected.
//    - DOM replacements are limited to nodes inside those stamped roots only.
//
//    MEDIUM RISK — still depends on ReadMe's internal Ask AI DOM structure,
//    but is much safer than previous global selectors.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  "use strict";

  var TAG = "__here_askai_reskin_v12";
  if (window[TAG]) return;
  window[TAG] = true;

  var ROOT_ATTR = "data-here-askai-root";
  var DONE_ATTR = "data-here-askai-bound";
  var REPLACED_ATTR = "data-here-askai-replaced";

  var T = {
    darkTeal: "#092732",
    midTeal: "#2C596A",
    borderTeal: "#3F7183",
    accentCyan: "#1EF3E4",
    white: "#FFFFFF",
    font: "'FiraGO-Regular','FiraGO','Fira GO','Fira Sans','NotoSansJP','Noto Sans JP',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    fontBold:
      "'FiraGO-Bold','FiraGO','Fira GO','Fira Sans','NotoSansJP-Bold','Noto Sans JP',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  };

  var CHIP_SVG =
    '<svg class="here-askai-chip-icon" width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M14 9H13V7H14C14.2652 7 14.5196 6.89464 14.7071 6.70711C14.8946 6.51957 15 6.26522 15 6C15 5.73478 14.8946 5.48043 14.7071 5.29289C14.5196 5.10536 14.2652 5 14 5H13V3H11V2C11 1.73478 10.8946 1.48043 10.7071 1.29289C10.5196 1.10536 10.2652 1 10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289C9.10536 1.48043 9 1.73478 9 2V3H7V2C7 1.73478 6.89464 1.48043 6.70711 1.29289C6.51957 1.10536 6.26522 1 6 1C5.73478 1 5.48043 1.10536 5.29289 1.29289C5.10536 1.48043 5 1.73478 5 2V3H3V5H2C1.73478 5 1.48043 5.10536 1.29289 5.29289C1.10536 5.48043 1 5.73478 1 6C1 6.26522 1.10536 6.51957 1.29289 6.70711C1.48043 6.89464 1.73478 7 2 7H3V9H2C1.73478 9 1.48043 9.10536 1.29289 9.29289C1.10536 9.48043 1 9.73478 1 10C1 10.2652 1.10536 10.5196 1.29289 10.7071C1.48043 10.8946 1.73478 11 2 11H3V13H5V14C5 14.2652 5.10536 14.5196 5.29289 14.7071C5.48043 14.8946 5.73478 15 6 15C6.26522 15 6.51957 14.8946 6.70711 14.7071C6.89464 14.5196 7 14.2652 7 14V13H9V14C9 14.2652 9.10536 14.5196 9.29289 14.7071C9.48043 14.8946 9.73478 15 10 15C10.2652 15 10.5196 14.8946 10.7071 14.7071C10.8946 14.5196 11 14.2652 11 14V13H13V11H14C14.2652 11 14.5196 10.8946 14.7071 10.7071C14.8946 10.5196 15 10.2652 15 10C15 9.73478 14.8946 9.48043 14.7071 9.29289C14.5196 9.10536 14.2652 9 14 9ZM11 11H5V5H11V11ZM9 9H7V7H9V9Z" fill="#092732"/></svg>';

  var SEND_SVG =
    '<svg class="here-askai-send-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.56963 10L1.31963 7.35C1.183 7.24587 1.0755 7.1083 1.00749 6.95055C0.939477 6.7928 0.913252 6.62019 0.93134 6.44936C0.949428 6.27853 1.01122 6.11523 1.11076 5.97522C1.21029 5.83521 1.34422 5.72321 1.49963 5.65L13.5696 1L4.56963 10ZM14.9996 2.42L5.99963 11.42L9.10963 14.71C9.22758 14.8277 9.37305 14.914 9.53284 14.9612C9.69263 15.0083 9.86167 15.0148 10.0246 14.98C10.1875 14.9453 10.3392 14.8703 10.4658 14.762C10.5924 14.6538 10.69 14.5156 10.7496 14.36L14.9996 2.42ZM2.99963 11V13C2.99963 13.2652 3.10499 13.5196 3.29252 13.7071C3.48006 13.8946 3.73441 14 3.99963 14H5.99963L2.99963 11Z" fill="#1EF3E4"/></svg>';

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function detectLocale() {
    var match = (window.location.pathname || '').match(/\/([a-z]{2})(?:\/|$)/i);
    if (match && match[1].toLowerCase() === 'ja') return 'ja';
    return 'en';
  }

  function closestAskAiRoot(el) {
    return el && el.closest ? el.closest("[" + ROOT_ATTR + "]") : null;
  }

  function stampRoots() {
    var lang = detectLocale();
    qsa(".rm-AskAi-empty, .EmptyChatOptions2sW9u7BPOSdJ").forEach(
      function (root) {
        root.setAttribute(ROOT_ATTR, "1");
        root.setAttribute("data-lang", lang);
      },
    );
  }

  function injectStyles() {
    if (document.getElementById("rm-askai-reskin-v12")) return;

    var css = `
      [${ROOT_ATTR}] {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        font-family: ${T.font} !important;
      }

      [${ROOT_ATTR}] .ChatInput1gosVX-YB6Kq,
      [${ROOT_ATTR}] .rm-AskAi-input,
      [${ROOT_ATTR}] .EmptyChatOptions-inputWrapper1QdyF__AmKN8,
      [${ROOT_ATTR}] .ChatInput-container3MZOOAd9XbeT,
      [${ROOT_ATTR}] .ChatInput-container_empty2m20fqYvipb2 {
        background: transparent !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        outline: none !important;
        padding: 0 !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-container1GBN5AsaTkak {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 0 !important;
        width: 100% !important;
      }

      [${ROOT_ATTR}] .here-askai-chip-circle {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 48px !important;
        height: 48px !important;
        min-width: 48px !important;
        min-height: 48px !important;
        background: #FFFFFF !important;
        border: 1px solid rgba(0, 129, 177, 0.25) !important;
        border-radius: 50% !important;
        margin-bottom: 16px !important;
        box-sizing: border-box !important;
        flex-shrink: 0 !important;
      }

      [${ROOT_ATTR}] .here-askai-chip-circle .here-askai-chip-icon {
        display: block !important;
        width: 20px !important;
        height: 20px !important;
        flex-shrink: 0 !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 48px !important;
        height: 48px !important;
        min-width: 48px !important;
        min-height: 48px !important;
        background: #FFFFFF !important;
        border: 1px solid rgba(0, 129, 177, 0.25) !important;
        border-radius: 50% !important;
        margin-bottom: 16px !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ > *:not(.here-askai-chip-icon) {
        display: none !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ .here-askai-chip-icon {
        width: 16px !important;
        height: 16px !important;
        display: block !important;
        flex-shrink: 0 !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-header2zyKlLHvmD9r {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        width: 100% !important;
        margin-bottom: 4px !important;
        background: transparent !important;
        border: none !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-titleL8D4DWQvtl5H {
        font-size: 0 !important;
        margin: 0 0 8px 0 !important;
        border: none !important;
        background: transparent !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-titleL8D4DWQvtl5H::before {
        content: 'Get answers with AI' !important;
        font-size: 24px !important;
        font-weight: 700 !important;
        line-height: 28px !important;
        font-family: ${T.fontBold} !important;
        color: ${T.darkTeal} !important;
        display: block !important;
        text-align: center !important;
      }

      [${ROOT_ATTR}][data-lang="ja"] .EmptyChatOptions-titleL8D4DWQvtl5H::before {
        content: 'AIで答えを得る' !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-subtitle280IfSzee1D7 {
        font-size: 0 !important;
        margin: 0 0 20px 0 !important;
        max-width: 348px !important;
        border: none !important;
        background: transparent !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-subtitle280IfSzee1D7::before {
        content: 'Use AI to guide your solutions and explore HERE APIs, SDKs and documentation.' !important;
        font-size: 16px !important;
        line-height: 24px !important;
        letter-spacing: -0.2px !important;
        font-family: ${T.font} !important;
        color: ${T.midTeal} !important;
        display: block !important;
        text-align: center !important;
      }

      [${ROOT_ATTR}][data-lang="ja"] .EmptyChatOptions-subtitle280IfSzee1D7::before {
        content: 'AIを使ってHERE API、SDK、ドキュメントのソリューションを見つけましょう。' !important;
      }

      [${ROOT_ATTR}] .EmptyChatOptions-inputWrapper1QdyF__AmKN8 {
        width: 100% !important;
        max-width: 416px !important;
      }

      [${ROOT_ATTR}] .ChatInput1gosVX-YB6Kq {
        width: 100% !important;
      }

      [${ROOT_ATTR}] .ChatInput-formNLLC1VXSTzia {
        display: flex !important;
        flex-direction: row !important;
        align-items: flex-start !important;
        gap: 16px !important;
        width: 100% !important;
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
      }

      [${ROOT_ATTR}] .ChatInput-container3MZOOAd9XbeT {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 8px !important;
        flex: 1 1 auto !important;
        min-width: 0 !important;
      }

      [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR {
        font-family: ${T.font} !important;
        font-size: 14px !important;
        line-height: 20px !important;
        letter-spacing: -0.4px !important;
        color: ${T.borderTeal} !important;
        background: ${T.white} !important;
        border: 1px solid ${T.borderTeal} !important;
        border-radius: 4px !important;
        padding: 8px !important;
        width: 100% !important;
        height: 76px !important;
        min-height: 76px !important;
        box-sizing: border-box !important;
        outline: none !important;
        resize: none !important;
        display: block !important;
        box-shadow: none !important;
      }

      [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR:focus {
        border-color: ${T.darkTeal} !important;
        box-shadow: 0 0 0 2px rgba(9,39,50,0.1) !important;
      }

      [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR::placeholder {
        color: ${T.borderTeal} !important;
        opacity: 0.75 !important;
      }

      [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR::-webkit-resizer {
        display: none !important;
      }

      [${ROOT_ATTR}] .ChatInput-container3MZOOAd9XbeT::after {
        content: 'Answers are AI generated and may not be complete. Be sure to check for accuracy.' !important;
        display: block !important;
        font-family: ${T.font} !important;
        font-size: 12px !important;
        line-height: 16px !important;
        letter-spacing: -0.2px !important;
        color: ${T.borderTeal} !important;
        width: 100% !important;
      }

      [${ROOT_ATTR}][data-lang="ja"] .ChatInput-container3MZOOAd9XbeT::after {
        content: '回答はAIによって生成されたものであり、完全でない場合があります。正確性をご確認ください。' !important;
      }

      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j,
      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button,
      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary,
      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary_outline {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 40px !important;
        height: 40px !important;
        min-width: 40px !important;
        min-height: 40px !important;
        padding: 0 !important;
        background: ${T.darkTeal} !important;
        border: none !important;
        outline: none !important;
        border-radius: 50% !important;
        box-shadow: none !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
        align-self: flex-start !important;
        position: static !important;
        transition: background 0.18s ease !important;
      }

      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:hover:not(:disabled) {
        background: ${T.borderTeal} !important;
      }

      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:disabled {
        opacity: 0.55 !important;
        cursor: default !important;
      }

      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j .IconWrapper,
      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j svg:not(.here-askai-send-icon) {
        display: none !important;
      }

      [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j .here-askai-send-icon {
        display: block !important;
        width: 16px !important;
        height: 16px !important;
      }

      /* Dark mode */
      [data-color-mode="dark"] [${ROOT_ATTR}] .here-askai-chip-circle,
      [data-color-mode="dark"] [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ {
        background: #ffffff !important;
        border-color: rgba(255,255,255,0.18) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .here-askai-chip-circle .here-askai-chip-icon path,
      [data-color-mode="dark"] [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ .here-askai-chip-icon path {
        fill: #092732 !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .EmptyChatOptions-titleL8D4DWQvtl5H::before {
        color: rgba(232,237,240,0.92) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .EmptyChatOptions-subtitle280IfSzee1D7::before {
        color: rgba(232,237,240,0.72) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR {
        color: rgba(232,237,240,0.92) !important;
        background: rgba(255,255,255,0.06) !important;
        border-color: rgba(255,255,255,0.18) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR::placeholder {
        color: rgba(232,237,240,0.55) !important;
        opacity: 1 !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR:focus {
        border-color: rgba(72,218,208,0.9) !important;
        box-shadow: 0 0 0 2px rgba(72,218,208,0.14) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-container3MZOOAd9XbeT::after {
        color: rgba(232,237,240,0.58) !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j,
      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button,
      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary,
      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary_outline {
        background: #10323b !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:hover:not(:disabled) {
        background: #17414b !important;
      }

      [data-color-mode="dark"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:disabled {
        opacity: 0.45 !important;
      }

      /* System / auto dark mode */
      @media (prefers-color-scheme: dark) {
        [data-color-mode="system"] [${ROOT_ATTR}] .here-askai-chip-circle,
        [data-color-mode="system"] [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ {
          background: #ffffff !important;
          border-color: rgba(255,255,255,0.18) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .here-askai-chip-circle .here-askai-chip-icon path,
        [data-color-mode="system"] [${ROOT_ATTR}] .EmptyChatOptions-logo5bYNILYohem_ .here-askai-chip-icon path {
          fill: #092732 !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .EmptyChatOptions-titleL8D4DWQvtl5H::before {
          color: rgba(232,237,240,0.92) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .EmptyChatOptions-subtitle280IfSzee1D7::before {
          color: rgba(232,237,240,0.72) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR {
          color: rgba(232,237,240,0.92) !important;
          background: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.18) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR::placeholder {
          color: rgba(232,237,240,0.55) !important;
          opacity: 1 !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-textarea1adL3GkCQoYR:focus {
          border-color: rgba(72,218,208,0.9) !important;
          box-shadow: 0 0 0 2px rgba(72,218,208,0.14) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-container3MZOOAd9XbeT::after {
          color: rgba(232,237,240,0.58) !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j,
        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button,
        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary,
        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j.Button_secondary_outline {
          background: #10323b !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:hover:not(:disabled) {
          background: #17414b !important;
        }

        [data-color-mode="system"] [${ROOT_ATTR}] .ChatInput-button2URvzH34ra-j:disabled {
          opacity: 0.45 !important;
        }
      }
    `;

    var el = document.createElement("style");
    el.id = "rm-askai-reskin-v12";
    el.textContent = css;
    document.head.appendChild(el);
  }

  function moveSendButton(root) {
    qsa(".ChatInput-formNLLC1VXSTzia", root).forEach(function (form) {
      if (form.getAttribute(DONE_ATTR) === "1") return;

      var btn = form.querySelector(".ChatInput-button2URvzH34ra-j");
      if (btn && btn.parentElement !== form) {
        form.appendChild(btn);
      }

      form.setAttribute(DONE_ATTR, "1");
    });
  }

  function replaceLogo(root) {
    qsa(
      ".EmptyChatOptions-logo5bYNILYohem_:not([" + REPLACED_ATTR + "])",
      root,
    ).forEach(function (logo) {
      if (!closestAskAiRoot(logo)) return;

      var div = document.createElement("div");
      div.className = "here-askai-chip-circle";
      div.setAttribute(REPLACED_ATTR, "1");
      div.innerHTML = CHIP_SVG;

      logo.replaceWith(div);
    });
  }

  function injectSendIcon(root) {
    qsa(".ChatInput-button2URvzH34ra-j", root).forEach(function (btn) {
      if (!closestAskAiRoot(btn)) return;
      if (btn.querySelector(".here-askai-send-icon")) return;
      btn.insertAdjacentHTML("beforeend", SEND_SVG);
    });
  }

  function processRoot(root) {
    if (!root) return;
    root.setAttribute(ROOT_ATTR, "1");
    moveSendButton(root);
    replaceLogo(root);
    injectSendIcon(root);
  }

  function processAll() {
    stampRoots();
    qsa("[" + ROOT_ATTR + "]").forEach(processRoot);
  }

  function init() {
    injectStyles();
    processAll();

    new MutationObserver(function () {
      processAll();
    }).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 9. ASK AI — ACTIVE CHAT HEADER TITLE ONLY
//    Only runs when the Ask AI panel is in the active conversation state
//    (the state that has the real chat header with "Assistant").
//    Does NOT touch the empty/welcome state.
//    Does NOT replace any SVG.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  "use strict";

  var TAG = "__here_askai_active_header_title_only_v1";
  if (window[TAG]) return;
  window[TAG] = true;

  var HEADER_TITLES = { en: "Ask AI", ja: "AIに聞く" };

  function detectLocale() {
    var match = (window.location.pathname || '').match(/\/([a-z]{2})(?:\/|$)/i);
    if (match && match[1].toLowerCase() === 'ja') return 'ja';
    return 'en';
  }

  function setActiveHeaderTitle(root) {
    if (!root) return;

    var title = root.querySelector(".ChatInterface-headerTitleqnGqTmt9EuvI");
    if (!title) return;

    var expected = HEADER_TITLES[detectLocale()] || HEADER_TITLES.en;
    if (title.textContent !== expected) {
      title.textContent = expected;
    }
  }

  function processAll() {
    document.querySelectorAll(".rm-AskAi-chat").forEach(function (chat) {
      // Only run on the active/non-empty state:
      // it has the real header AND a messages area.
      var activeHeader = chat.querySelector(
        ".ChatInterface-headerunFkVAVMK-l-",
      );
      var messagesArea = chat.querySelector(
        ".ChatInterface-messagesAreaTsAFuFmLXi0L",
      );

      if (!activeHeader || !messagesArea) return;

      setActiveHeaderTitle(activeHeader);
    });
  }

  var scheduled = false;
  function scheduleProcess() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      processAll();
    });
  }

  function init() {
    processAll();

    new MutationObserver(function () {
      scheduleProcess();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 10. ASK AI — ACTIVE CHAT HEADER CHIP ICON
//     Only runs in the active conversation state.
//     Hides the default sparkle icon and inserts the chip icon before the
//     existing title without replacing header nodes.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  "use strict";

  var TAG = "__here_askai_active_header_chip_v1";
  if (window[TAG]) return;
  window[TAG] = true;

  var CHIP_SVG =
    '<svg class="here-askai-active-header-chip" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M14 9H13V7H14C14.2652 7 14.5196 6.89464 14.7071 6.70711C14.8946 6.51957 15 6.26522 15 6C15 5.73478 14.8946 5.48043 14.7071 5.29289C14.5196 5.10536 14.2652 5 14 5H13V3H11V2C11 1.73478 10.8946 1.48043 10.7071 1.29289C10.5196 1.10536 10.2652 1 10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289C9.10536 1.48043 9 1.73478 9 2V3H7V2C7 1.73478 6.89464 1.48043 6.70711 1.29289C6.51957 1.10536 6.26522 1 6 1C5.73478 1 5.48043 1.10536 5.29289 1.29289C5.10536 1.48043 5 1.73478 5 2V3H3V5H2C1.73478 5 1.48043 5.10536 1.29289 5.29289C1.10536 5.48043 1 5.73478 1 6C1 6.26522 1.10536 6.51957 1.29289 6.70711C1.48043 6.89464 1.73478 7 2 7H3V9H2C1.73478 9 1.48043 9.10536 1.29289 9.29289C1.10536 9.48043 1 9.73478 1 10C1 10.2652 1.10536 10.5196 1.29289 10.7071C1.48043 10.8946 1.73478 11 2 11H3V13H5V14C5 14.2652 5.10536 14.5196 5.29289 14.7071C5.48043 14.8946 5.73478 15 6 15C6.26522 15 6.51957 14.8946 6.70711 14.7071C6.89464 14.5196 7 14.2652 7 14V13H9V14C9 14.2652 9.10536 14.5196 9.29289 14.7071C9.48043 14.8946 9.73478 15 10 15C10.2652 15 10.5196 14.8946 10.7071 14.7071C10.8946 14.5196 11 14.2652 11 14V13H13V11H14C14.2652 11 14.5196 10.8946 14.7071 10.7071C14.8946 10.5196 15 10.2652 15 10C15 9.73478 14.8946 9.48043 14.7071 9.29289C14.5196 9.10536 14.2652 9 14 9ZM11 11H5V5H11V11ZM9 9H7V7H9V9Z" fill="#1EF3E4"/>' +
    "</svg>";

  function injectStyles() {
    if (document.getElementById("rm-askai-active-header-chip-v1")) return;

    var style = document.createElement("style");
    style.id = "rm-askai-active-header-chip-v1";
    style.textContent = `
      .rm-AskAi-chat .here-askai-active-header-chip {
        display: inline-block !important;
        width: 16px !important;
        height: 16px !important;
        min-width: 16px !important;
        min-height: 16px !important;
        flex-shrink: 0 !important;
        vertical-align: middle !important;
      }

      .rm-AskAi-chat .here-askai-active-header-chip-wrap {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin-right: 8px !important;
        flex-shrink: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function processActiveHeader(header) {
    if (!header) return;

    var title = header.querySelector(".ChatInterface-headerTitleqnGqTmt9EuvI");
    var sparkle = header.querySelector(".ChatInterface-headerIcon1jHhVaQobI0F");

    if (!title || !sparkle) return;

    if (!header.querySelector(".here-askai-active-header-chip-wrap")) {
      var wrap = document.createElement("span");
      wrap.className = "here-askai-active-header-chip-wrap";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = CHIP_SVG;

      title.parentNode.insertBefore(wrap, title);
    }

    sparkle.style.display = "none";
  }

  function processAll() {
    document.querySelectorAll(".rm-AskAi-chat").forEach(function (chat) {
      var activeHeader = chat.querySelector(
        ".ChatInterface-headerunFkVAVMK-l-",
      );
      var messagesArea = chat.querySelector(
        ".ChatInterface-messagesAreaTsAFuFmLXi0L",
      );

      if (!activeHeader || !messagesArea) return;

      processActiveHeader(activeHeader);
    });
  }

  var scheduled = false;
  function scheduleProcess() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      processAll();
    });
  }

  function init() {
    injectStyles();
    processAll();

    new MutationObserver(function () {
      scheduleProcess();
    }).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =============================================================================
   TEALIUM — COMPLETE RESTORE
   Includes:
   1) GDP modal suppression (targeted)
   2) Tealium SPA pageviews + click tracking + consent gating
      - Works with utag_cfg_ovrd.noview=true
      - Uses ReadMe pageLoad if available, else falls back to HERE nav bus
      - Dedupe by URL (prevents multi-fire per nav)
      - Keeps window.nkT populated (pName/sLang/sCountry)
   3) (Optional) Consent overlay de-dupe (DISABLED by default!)
      - Your earlier “appears then disappears” EU issue is likely this
      - Only enable once you add safe exclusions for Tealium’s consent UI
============================================================================= */

/* -----------------------------------------------------------------------------
   1) Tealium GDP modal suppression (targeted, SPA-safe)
----------------------------------------------------------------------------- */
//

/* -----------------------------------------------------------------------------
   2) Tealium analytics + consent gating (SPA-safe, deduped, nkT filled)
----------------------------------------------------------------------------- */
(function () {
  var TAG = "__here_tealium_spa_v2";
  if (window[TAG]) return;
  window[TAG] = true;

  // Ensure nkT exists (your Header HTML sets it, but be defensive)
  if (typeof window.nkT !== "object" || !window.nkT) {
    window.nkT = { pName: "", sCountry: "", sLang: "" };
  }

  // -----------------------------
  // Consent helpers (same logic you used before)
  // -----------------------------
  function getCookie(name) {
    var parts = ("; " + document.cookie).split("; " + name + "=");
    if (parts.length < 2) return null;
    return decodeURIComponent(parts.pop().split(";").shift());
  }

  function hasTealiumAnalyticsConsent() {
    // Dev override (for testing)
    try {
      if (localStorage.getItem("tealiumForceConsent") === "true") return true;
    } catch (e) {}

    var cm = getCookie("CONSENTMGR");
    if (cm && (cm.indexOf("consent:true") !== -1 || cm.indexOf("c1:1") !== -1))
      return true;

    var fo = getCookie("foCONSENTMGR");
    if (fo && fo.indexOf("consent:true") !== -1) return true;

    return false;
  }

  // -----------------------------
  // Tealium presence
  // -----------------------------
  function hasUtag() {
    return !!(window.utag && typeof window.utag.view === "function");
  }

  // -----------------------------
  // Language + country helpers
  // -----------------------------
  function getLang() {
    return (document.documentElement.lang || "en").toLowerCase();
  }

  function getCountry(lang) {
    return lang === "ja" ? "JP" : "Global";
  }

  // -----------------------------
  // pName derivation (state-aware)
  // -----------------------------
  function normalizeSegment(str) {
    if (!str) return "";
    return str.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  }

  function normalizeTitle(title) {
    if (!title) return "";
    return title.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function pathToPNameFromPath(pathname) {
    if (!pathname || pathname === "/") return "Home";
    var trimmed = pathname.replace(/^\/+|\/+$/g, "");
    if (!trimmed) return "Home";

    var parts = trimmed.split("/").map(normalizeSegment);
    parts.unshift("Home");
    return parts.join(":");
  }

  function getEffectivePathFromState(state) {
    if (!state) return null;

    if (state.meta && state.meta.pathname) return state.meta.pathname;

    if (state.meta && state.meta.canonicalUrl) {
      try {
        return new URL(state.meta.canonicalUrl).pathname;
      } catch (e) {}
    }

    if (state.pathname) return state.pathname;
    if (state.path) return state.path;

    if (state.params && state.params.slug) {
      var slug = state.params.slug;
      var baseParts = window.location.pathname.split("/");
      if (baseParts.length > 1) {
        baseParts[baseParts.length - 1] = slug;
        return baseParts.join("/");
      }
    }

    return null;
  }

  var basePNamePrefix = null;
  function getBasePNamePrefix() {
    if (basePNamePrefix) return basePNamePrefix;

    var full = pathToPNameFromPath(window.location.pathname);
    var parts = full.split(":");
    if (parts.length > 1) parts.pop();
    basePNamePrefix = parts.join(":");

    return basePNamePrefix;
  }

  function derivePName(state) {
    var pathFromState = getEffectivePathFromState(state);
    if (pathFromState) return pathToPNameFromPath(pathFromState);

    // Fallback for preview-ish contexts where pathname isn't reliable
    var base = getBasePNamePrefix();
    var title = normalizeTitle(document.title || "");
    if (!title) return base || "Home";
    return (base ? base + ":" : "") + title;
  }

  function buildBaseData(state) {
    var lang = getLang();
    return {
      pName: derivePName(state || {}),
      sLang: lang,
      sCountry: getCountry(lang),
    };
  }

  // -----------------------------
  // Dedup (URL-based for pageviews)
  // -----------------------------
  var lastPageUrlKey = null;
  var lastClickKey = null;

  function currentUrlKey() {
    return (location.pathname || "") + (location.search || "");
  }

  function syncNkT(data) {
    if (typeof window.nkT === "object" && window.nkT) {
      window.nkT.pName = data.pName;
      window.nkT.sLang = data.sLang;
      window.nkT.sCountry = data.sCountry;
    }
  }

  function sendTealiumView(kind, extra, state) {
    if (!hasUtag()) return;
    if (!hasTealiumAnalyticsConsent()) return;

    var base = buildBaseData(state || {});
    var data = {};
    for (var k in base)
      if (Object.prototype.hasOwnProperty.call(base, k)) data[k] = base[k];
    if (extra)
      for (var k2 in extra)
        if (Object.prototype.hasOwnProperty.call(extra, k2))
          data[k2] = extra[k2];
    if (kind) data.type = kind;

    syncNkT(data);

    // Click dedupe: pName + actionTrack
    if (kind === "click") {
      var ckey = "click:" + data.pName + ":" + (data.actionTrack || "");
      if (ckey === lastClickKey) return;
      lastClickKey = ckey;
    }

    // Debug log (remove later if you want)
    console.log("[Tealium] utag.view payload:", data);
    window.utag.view(data);
  }

  // -----------------------------
  // Click tracking (links/buttons)
  // -----------------------------
  function normalizeLabel(str) {
    if (!str) return "";
    return str
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  function handleClick(e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.tagName === "A" || el.tagName === "BUTTON") break;
      el = el.parentNode;
    }
    if (!el || el === document) return;

    var explicit = el.getAttribute("data-analytics-label");
    var text = explicit || (el.innerText || el.textContent || "").trim();
    var label = normalizeLabel(text);
    if (!label) return;

    sendTealiumView(
      "click",
      {
        actionTrack: label,
        linkEvent: label,
      },
      window.__here_last_page_state || {},
    );
  }

  document.addEventListener("click", handleClick, true);

  // -----------------------------
  // Page tracking (ONE pageview per nav)
  // -----------------------------
  var havePageLoadHook = false;

  function trackPage(state) {
    var urlKey = currentUrlKey();
    if (urlKey === lastPageUrlKey) return;
    lastPageUrlKey = urlKey;

    window.__here_last_page_state = state || {};
    sendTealiumView("page", null, window.__here_last_page_state);
  }

  // A) Prefer ReadMe pageLoad (best router state)
  try {
    if (typeof window.$ !== "undefined" && window.$.fn && window.$.fn.on) {
      havePageLoadHook = true;
      window
        .$(window)
        .off("pageLoad.hereTealium")
        .on("pageLoad.hereTealium", function (e, state) {
          trackPage(state || {});
        });
    }
  } catch (e) {}

  // B) Fallback to your nav bus only if pageLoad isn't available
  try {
    if (
      !havePageLoadHook &&
      window.__here_nav_bus_v1 &&
      window.__here_nav_bus_v1.onNav
    ) {
      window.__here_nav_bus_v1.onNav(function () {
        trackPage({});
      });
    }
  } catch (e) {}

  // Initial pageview (noview:true means Tealium won't auto-fire)
  // URL dedupe ensures we won't double-fire if pageLoad also runs.
  trackPage({});

  // Consent watcher: when user grants consent, send first pageview
  (function setupConsentWatcher() {
    // If you’re forcing consent for dev, don’t watch
    try {
      if (localStorage.getItem("tealiumForceConsent") === "true") return;
    } catch (e) {}

    var lastConsent = hasTealiumAnalyticsConsent();
    var intervalId = setInterval(function () {
      var nowHasConsent = hasTealiumAnalyticsConsent();
      if (!lastConsent && nowHasConsent) {
        // Allow a pageview after accept, even if URL didn't change
        lastPageUrlKey = null;
        trackPage(window.__here_last_page_state || {});
        clearInterval(intervalId);
      }
      lastConsent = nowHasConsent;
    }, 1000);
  })();
})();

/* -----------------------------------------------------------------------------
   3) Consent prompt de-dupe (OPTIONAL)
   IMPORTANT: Disabled by default because it can break EU consent banners.
   If you really want it back, set:
     window.__hereEnableConsentDedupe = true;
----------------------------------------------------------------------------- */
(function () {
  if (!window.__hereEnableConsentDedupe) return;

  if (window.__here_consent_dedupe_v1) return;
  window.__here_consent_dedupe_v1 = true;

  var DEBUG = !!window.__rmDebugConsentDedupe;

  function log() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, arguments);
    } catch (e) {}
  }

  function getZIndex(el) {
    try {
      var z = window.getComputedStyle(el).zIndex;
      var zi = parseInt(z, 10);
      return isNaN(zi) ? 0 : zi;
    } catch (e) {
      return 0;
    }
  }

  function isFixedOrSticky(el) {
    try {
      var pos = window.getComputedStyle(el).position;
      return pos === "fixed" || pos === "sticky";
    } catch (e) {
      return false;
    }
  }

  function normalizeText(s) {
    return (s || "")
      .replace(/\s+/g, " ")
      .replace(/[^\S\r\n]+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 500);
  }

  function getButtonLabelSignature(el) {
    var nodes = el.querySelectorAll('button, [role="button"], a');
    var labels = [];
    var max = Math.min(nodes.length, 25);

    for (var i = 0; i < max; i++) {
      var t = normalizeText(nodes[i].textContent || "");
      if (!t) continue;
      if (
        /(accept|agree|allow|reject|decline|manage|preferences|settings|cookie|consent|opt)/i.test(
          t,
        )
      ) {
        labels.push(t.slice(0, 80));
      }
    }

    labels.sort();
    var uniq = [];
    for (var j = 0; j < labels.length; j++) {
      if (j === 0 || labels[j] !== labels[j - 1]) uniq.push(labels[j]);
    }
    return uniq.join("|").slice(0, 300);
  }

  function looksConsentishByName(el) {
    var id = (el.id || "").toLowerCase();
    var cls = (el.className || "").toString().toLowerCase();

    return (
      id.indexOf("consent") !== -1 ||
      cls.indexOf("consent") !== -1 ||
      id.indexOf("cookie") !== -1 ||
      cls.indexOf("cookie") !== -1 ||
      id.indexOf("teconsent") !== -1 ||
      cls.indexOf("teconsent") !== -1 ||
      id.indexOf("truste") !== -1 ||
      cls.indexOf("truste") !== -1 ||
      id.indexOf("trustarc") !== -1 ||
      cls.indexOf("trustarc") !== -1 ||
      id.indexOf("onetrust") !== -1 ||
      cls.indexOf("onetrust") !== -1
    );
  }

  function hasConsentCTAs(el) {
    var sig = getButtonLabelSignature(el);
    if (!sig) return false;
    return /(accept|agree|allow|reject|decline|manage|preferences|settings)/i.test(
      sig,
    );
  }

  function isProbablyConsentOverlay(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!isFixedOrSticky(el)) return false;

    // SAFETY EXCLUSIONS (don’t touch common Tealium / ConsentMgr roots)
    var id = (el.id || "").toLowerCase();
    if (
      id.indexOf("tealium") !== -1 ||
      id.indexOf("consentmgr") !== -1 ||
      id.indexOf("truste") !== -1
    ) {
      return false;
    }

    if (!looksConsentishByName(el) && !hasConsentCTAs(el)) return false;

    try {
      var r = el.getBoundingClientRect();
      if (!r || r.width < 200 || r.height < 60) return false;
    } catch (e) {
      return false;
    }

    var text = normalizeText(el.textContent || "");
    var ctas = getButtonLabelSignature(el);

    if (
      !/(cookie|consent|privacy|preferences|tracking)/i.test(text) &&
      !/(cookie|consent|privacy|preferences|tracking)/i.test(ctas)
    )
      return false;

    return true;
  }

  function fingerprint(el) {
    var t = normalizeText(el.textContent || "");
    var ctas = getButtonLabelSignature(el);
    t = t.replace(/\b\d{2,}\b/g, "");
    return (t + "||" + ctas).slice(0, 800);
  }

  function compareDomOrder(a, b) {
    if (a === b) return 0;
    var pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function pickWinner(list) {
    var best = list[0];
    for (var i = 1; i < list.length; i++) {
      var cur = list[i];

      var bz = getZIndex(best);
      var cz = getZIndex(cur);
      if (cz > bz) {
        best = cur;
        continue;
      }
      if (cz < bz) continue;

      var br = best.getBoundingClientRect();
      var cr = cur.getBoundingClientRect();
      var bArea = br.width * br.height || 0;
      var cArea = cr.width * cr.height || 0;

      if (cArea > bArea) {
        best = cur;
        continue;
      }
      if (cArea < bArea) continue;

      if (compareDomOrder(cur, best) > 0) best = cur;
    }
    return best;
  }

  function removeNode(el) {
    try {
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
      el.style.display = "none";
    } catch (e) {}
    try {
      if (el.parentNode) el.parentNode.removeChild(el);
    } catch (e2) {}
  }

  function dedupeNow() {
    var selector =
      '[id*="consent" i], [class*="consent" i], ' +
      '[id*="cookie" i], [class*="cookie" i], ' +
      '[id*="teconsent" i], [class*="teconsent" i], ' +
      '[id*="truste" i], [class*="truste" i], ' +
      '[id*="trustarc" i], [class*="trustarc" i], ' +
      '[id*="onetrust" i], [class*="onetrust" i]';

    var nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      return;
    }

    var overlays = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isProbablyConsentOverlay(nodes[i])) overlays.push(nodes[i]);
    }
    if (overlays.length < 2) return;

    var groups = {};
    for (var j = 0; j < overlays.length; j++) {
      var fp = fingerprint(overlays[j]);
      if (!fp) continue;
      if (!groups[fp]) groups[fp] = [];
      groups[fp].push(overlays[j]);
    }

    for (var key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      var list = groups[key];
      if (!list || list.length < 2) continue;

      var winner = pickWinner(list);
      for (var k = 0; k < list.length; k++) {
        if (list[k] === winner) continue;
        log("[ConsentDedupe] Removing duplicate:", list[k]);
        removeNode(list[k]);
      }
    }
  }

  var scheduled = false;
  function scheduleDedupe() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      dedupeNow();
      setTimeout(dedupeNow, 150);
      setTimeout(dedupeNow, 600);
    });
  }

  scheduleDedupe();
  window.addEventListener("load", scheduleDedupe);

  try {
    if (window.__here_nav_bus_v1 && window.__here_nav_bus_v1.onNav) {
      window.__here_nav_bus_v1.onNav(scheduleDedupe);
    }
  } catch (e) {}

  try {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          scheduleDedupe();
          break;
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();


// Fix "&amp;" showing up in Search modal project names
(function () {
  var MODAL_ID = 'AppSearch';
  var pending = false;

  function decodeHtmlOnce(str) {
    var ta = document.createElement('textarea');
    ta.innerHTML = str;
    return ta.value;
  }

  function decodeUntilStable(str) {
    var prev = str;
    for (var i = 0; i < 5; i++) {
      var next = decodeHtmlOnce(prev);
      if (next === prev) break;
      prev = next;
    }
    return prev;
  }

  function fixTextNodesIn(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      if (!raw || raw.indexOf('&') === -1) continue;
      var fixed = decodeUntilStable(raw);
      if (fixed !== raw) node.nodeValue = fixed;
    }
  }

  function scheduleScan() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var modal = document.getElementById(MODAL_ID);
      if (modal) fixTextNodesIn(modal);
    });
  }

  var observer = new MutationObserver(function (mutations) {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var target = m.target;
      // Only act on mutations inside the modal
      if (modal.contains(target) || modal === target) {
        scheduleScan();
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true   // catches React patching text nodes in place
  });

  // Initial scan
  scheduleScan();

  window.__rmFixSearchAmp = {
    scan: function () {
      var modal = document.getElementById(MODAL_ID);
      if (modal) fixTextNodesIn(modal);
    }
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// 11. SWAGGER / OAS DOWNLOAD BUTTON
//     Adds a "Download API spec" button below the page title on Reference
//     pages. Resolves the spec URL via data-raycast-oas or /openapi index
//     fallback. Uses a forced Blob download to ensure the file saves locally.
// ─────────────────────────────────────────────────────────────────────────────
// ---------------- Custom Download Spec File Button ----------------
(function () {
  /* ===== CONFIG ===== */
  const DEBUG = /\boasdebug=1\b/i.test(location.search);
  const FALLBACK_DELAY_MS = 5000;
  const log = (...a) => DEBUG && console.log('[oas-link]', ...a);

  /* ===== GUARD ===== */
  if (window.__OAS_DL_INIT__) return;
  window.__OAS_DL_INIT__ = true;

  /* ===== STATE ===== */
  const CACHE = new Map();
  let currentAbort = null;
  let runTimer     = null;
  let lastCtxKey   = null;
  let loadSeq      = 0;
  let activeCtxKey = null;
  let activeLoadId = null;
  const fbTimers   = new Map();

  /* ===== STYLES ===== */
  function ensureStyles() {
    if (document.getElementById('oas-link-style')) return;

    const s = document.createElement('style');
    s.id = 'oas-link-style';
    s.textContent = `
      #oas-slot {
        margin-top: 10px;
      }

      @keyframes oasSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .oas-inline {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #4b5563;
      }

      .oas-spin {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid #cbd5e1;
        border-top-color: #3f7cfe;
        animation: oasSpin 0.8s linear infinite;
      }

      .oas-link-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;

        margin: 5px auto !important;

        background: #3f7cfeff !important;
        color: #ffffff !important;

        text-decoration: none !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        cursor: pointer !important;

        padding: 7px 13px !important;
        font-size: 13px !important;
        line-height: 1.2 !important;
        font-weight: 600 !important;

        border-radius: 999px !important;
        box-shadow: 0 2px 8px rgba(17, 24, 39, 0.14) !important;

        transition:
          background-color 160ms ease,
          box-shadow 160ms ease,
          transform 160ms ease !important;
      }

      .oas-link-btn:hover {
        background: #1f2937 !important;
        box-shadow: 0 4px 12px rgba(17, 24, 39, 0.18) !important;
        transform: translateY(-1px) !important;
      }

      .oas-link-btn:active {
        transform: translateY(0) !important;
        box-shadow: 0 2px 6px rgba(17, 24, 39, 0.14) !important;
      }

      .oas-link-btn:focus-visible {
        outline: 2px solid rgba(0, 55, 255, 0.35) !important;
        outline-offset: 2px !important;
      }

      .oas-link-btn[aria-busy="true"] {
        opacity: 0.8 !important;
        pointer-events: none !important;
      }

      #content-head.oas-loading [data-error-message="true"] {
        display: none !important;
      }
    `;

    document.head.appendChild(s);
  }

  /* ===== DOM HELPERS ===== */
  const getHead = () => document.querySelector('#content-head');
  const getH1 = () => document.querySelector('#content-head h1');

  const getHeaderRoot = () =>
    document.querySelector('header[data-raycast-oas]') ||
    getHead()?.closest('header') ||
    document.querySelector('header');

  function getSlot() {
    ensureStyles();

    const head = getHead();
    if (!head) return null;

    let slot = head.querySelector('#oas-slot');

    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'oas-slot';

      const h1 = getH1();

      if (h1) h1.insertAdjacentElement('afterend', slot);
      else head.appendChild(slot);
    }

    return slot;
  }

  function removeSlot() {
    getHead()?.querySelector('#oas-slot')?.remove();
    setHeadState(null);
  }

  function setHeadState(state) {
    getHead()?.classList.toggle('oas-loading', state === 'loading');
  }

  function cleanFilename(filename, url) {
    const fallback = (url || '').split('/').pop()?.split('?')[0] || 'openapi-spec.yml';
    return (filename || fallback).replace(/[^\w.\- ()]/g, '_');
  }

  /* ===== RENDER ===== */
  function renderLoading(loadId) {
    const slot = getSlot();
    if (!slot) return;

    if (slot.querySelector('[data-oas-loading]')?.getAttribute('data-oas-loading') === String(loadId)) return;
    if (slot.querySelector('[data-oas-link],[data-oas-msg]')) return;

    setHeadState('loading');

    slot.innerHTML = `
      <div class="oas-inline" data-oas-loading="${loadId}" aria-live="polite">
        <span class="oas-spin" aria-hidden="true"></span>
        <span>Resolving API spec…</span>
      </div>
    `;
  }

  function renderButton(result) {
    const slot = getSlot();
    if (!slot) return;

    setHeadState('ready');

    const url = result.downloadUrl || result.url;
    const filename = cleanFilename(result.filename, url);

    slot.innerHTML = '';

    const btn = document.createElement('a');
    btn.className = 'oas-link-btn';
    btn.setAttribute('data-oas-link', 'true');
    btn.setAttribute('data-download-url', url);
    btn.setAttribute('data-download-filename', filename);
    btn.href = url;
    btn.download = filename;
    btn.rel = 'noopener';
    btn.textContent = 'Download API spec';

    slot.appendChild(btn);
  }

  function renderFallback() {
    const slot = getSlot();
    if (!slot) return;

    setHeadState('fallback');

    slot.innerHTML = `
      <div class="oas-inline" data-oas-msg="true">
        <span>Having trouble finding the proper spec? <a href="${projectRoot()}/openapi">View all API specs</a>.</span>
      </div>
    `;
  }

  function scheduleFallback(loadId) {
    cancelFallback(loadId);

    fbTimers.set(loadId, setTimeout(() => {
      const slot = getSlot();
      const cur = slot?.querySelector('[data-oas-loading]')?.getAttribute('data-oas-loading');

      if (cur === String(loadId) && !slot.querySelector('[data-oas-link]')) {
        renderFallback();
      }
    }, FALLBACK_DELAY_MS));
  }

  function cancelFallback(loadId) {
    clearTimeout(fbTimers.get(loadId));
    fbTimers.delete(loadId);
  }

  /* ===== CONTEXT ===== */
  const isInReference = () =>
    location.pathname.includes('/reference/') ||
    !!document.querySelector('#reference-sidebar');
  const projectRoot = () => location.pathname.replace(/\/reference.*/, '');
  const currentSlug = () => (location.pathname.match(/\/reference\/([^/?#]+)/) || [])[1] || null;

  function readmeVersion() {
    const v = document.querySelector('meta[name="readme-version"]')?.content || '';
    if (!v || v === 'default') return null;
    return v.startsWith('v') ? v.slice(1) : v;
  }

  function isRealEndpoint() {
    const header = getHeaderRoot();
    if (!header) return false;

    const method = header.querySelector('[data-testid="http-method"]')?.textContent?.trim().toLowerCase() || '';
    const methodOk = /^(get|post|put|patch|delete|head|options)$/.test(method);
    const hasUrl = !!header.querySelector('[data-testid="serverurl"], [data-testid="request-url"]');

    return !!(methodOk && (hasUrl || header.hasAttribute('data-raycast-oas')));
  }

  /* ===== NETWORK / DOWNLOAD ===== */
  async function headOk(url, signal) {
    try {
      const r = await fetch(url, {
        method: 'HEAD',
        credentials: 'include',
        signal
      });

      return r.ok;
    } catch {
      return false;
    }
  }

  const absoluteUrl = (u) => {
    try {
      return new URL(u, location.origin).href;
    } catch {
      return null;
    }
  };

  async function forceFileDownload(url, filename) {
    const res = await fetch(url, {
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanFilename(filename, url);
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  /* ===== FALLBACK: name-match against /openapi index ===== */
  async function findFromOpenapiIndex(signal) {
    try {
      const res = await fetch(`${projectRoot()}/openapi`, {
        credentials: 'include',
        signal
      });

      if (!res.ok) return null;

      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

      const links = [...doc.querySelectorAll('a[href$=".json"], a[href$=".yml"], a[href$=".yaml"]')]
        .map(a => a.getAttribute('href'))
        .filter(Boolean);

      const tokens = projectRoot()
        .replace(/^\//, '')
        .split(/[-/]+/)
        .filter(t => t.length > 3);

      const best = links
        .map(href => ({
          href,
          score: tokens.reduce((s, t) => s + (href.toLowerCase().includes(t) ? 1 : 0), 0)
        }))
        .sort((a, b) => b.score - a.score)[0];

      if (!best || best.score === 0) return null;

      const filename = best.href.split('/').pop();
      const url = absoluteUrl(`${projectRoot()}/openapi/${filename}`);

      return url ? { url, downloadUrl: url, filename } : null;
    } catch (e) {
      log('/openapi fallback miss:', e.message);
      return null;
    }
  }

  /* ===== WAIT FOR DOM ===== */
  async function waitForHead(timeoutMs = 3000) {
    if (getHead()) return true;

    return new Promise((resolve) => {
      const obs = new MutationObserver(() => {
        if (getHead()) {
          obs.disconnect();
          resolve(true);
        }
      });

      obs.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        obs.disconnect();
        resolve(!!getHead());
      }, timeoutMs);
    });
  }

  /* ===== RUN ===== */
  async function run() {
    if (!isInReference()) {
      moHead.disconnect();
      moSide.disconnect();
      moHdr.disconnect();
      return;
    }

    if (!getHead()) {
      if (!(await waitForHead(3000))) {
        scheduleRun('no-head-yet');
        return;
      }

      if (!getHead()) {
        scheduleRun('no-head-postwait');
        return;
      }
    }

    bindObservers();

    if (!isRealEndpoint()) {
      removeSlot();
      scheduleRun('await-endpoint-hydration');
      return;
    }

    const start = performance.now();

    while (!getH1() && performance.now() - start < 800) {
      await new Promise(r => requestAnimationFrame(r));
    }

    const ver = readmeVersion() || 'default';
    const slug = currentSlug() || '';
    const raycastKey = getHeaderRoot()?.getAttribute('data-raycast-oas') || '';
    const ctxKey = `${ver}::${slug}::${raycastKey}`;
    const slot = getSlot();

    if (activeCtxKey === ctxKey && currentAbort && !currentAbort.signal.aborted) {
      log('dedupe: in-flight');
      return;
    }

    if (ctxKey === lastCtxKey && slot?.querySelector('[data-oas-link],[data-oas-msg]')) {
      log('skip: already rendered');
      return;
    }

    lastCtxKey = ctxKey;

    if (CACHE.has(ctxKey)) {
      renderButton(CACHE.get(ctxKey));
      return;
    }

    const myLoadId = ++loadSeq;
    activeCtxKey = ctxKey;
    activeLoadId = myLoadId;

    renderLoading(myLoadId);
    scheduleFallback(myLoadId);

    if (currentAbort) currentAbort.abort();

    currentAbort = new AbortController();
    const { signal } = currentAbort;

    try {
      if (raycastKey) {
        const filename = raycastKey.split('/').pop();
        const openapiUrl = `${projectRoot()}/openapi/${filename}`;
        const url = (await headOk(openapiUrl, signal)) ? openapiUrl : absoluteUrl(raycastKey);

        if (myLoadId !== activeLoadId) return;

        if (url) {
          const r = {
            url,
            downloadUrl: url,
            filename
          };

          cancelFallback(myLoadId);
          CACHE.set(ctxKey, r);
          renderButton(r);
        }

        return;
      }

      const result = await findFromOpenapiIndex(signal);

      if (myLoadId !== activeLoadId) return;

      if (result) {
        cancelFallback(myLoadId);
        CACHE.set(ctxKey, result);
        renderButton(result);
      }
    } catch (e) {
      log('run error:', e);
    } finally {
      if (activeLoadId === myLoadId) {
        activeCtxKey = null;
        activeLoadId = null;
      }
    }
  }

  /* ===== DOWNLOAD CLICK HANDLER ===== */
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('.oas-link-btn[data-oas-link]');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const url = btn.getAttribute('data-download-url') || btn.href;
    const filename = btn.getAttribute('data-download-filename');

    const originalText = btn.textContent;

    try {
      btn.textContent = 'Downloading…';
      btn.setAttribute('aria-busy', 'true');

      await forceFileDownload(url, filename);
    } catch (err) {
      console.warn('[oas-link] forced download failed, opening file instead:', err);
      window.open(url, '_blank', 'noopener');
    } finally {
      btn.textContent = originalText;
      btn.removeAttribute('aria-busy');
    }
  }, true);

  /* ===== LIFECYCLE ===== */
  function scheduleRun(why) {
    log('scheduleRun:', why);
    clearTimeout(runTimer);
    runTimer = setTimeout(run, 120);
  }

  const moHead = new MutationObserver((ms) => {
    if (ms.every(m => !m.target?.closest?.('#oas-slot'))) {
      scheduleRun('mut:head');
    }
  });

  const moSide = new MutationObserver(() => {
    scheduleRun('mut:sidebar');
  });

  const moHdr = new MutationObserver((ms) => {
    if (ms.every(m => !m.target?.closest?.('#oas-slot'))) {
      scheduleRun('mut:header');
    }
  });

  function bindObservers() {
    moHead.disconnect();
    moSide.disconnect();
    moHdr.disconnect();

    const head = getHead();

    if (head) {
      moHead.observe(head, {
        childList: true,
        subtree: true
      });
    }

    const side = document.querySelector('#reference-sidebar');

    if (side) {
      moSide.observe(side, {
        childList: true,
        subtree: true
      });
    }

    const hdr = getHeaderRoot();

    if (hdr) {
      moHdr.observe(hdr, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-raycast-oas']
      });
    }
  }

  const onPageLoad = () => scheduleRun('pageLoad');

  if (window.jQuery && jQuery(window).on) {
    jQuery(window).on('pageLoad', onPageLoad);
  }

  window.addEventListener('pageLoad', onPageLoad);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    onPageLoad();
  } else {
    document.addEventListener('DOMContentLoaded', onPageLoad);
  }

  bindObservers();
})();



// ─────────────────────────────────────────────────────────────────────────────
// 12. CONTACT US BUTTON (site-wide)
//     Adds a "Contact us" HDS secondary pill in ReadMe's header, immediately
//     to the RIGHT of Ask AI. Runs on every doc page (not just the landing
//     page). Language-aware: opens the JP contact URL under /ja routes.
//
//     Mirrors the same-name script that lives inside index.html for the
//     landing page. Kept in staging first so it can be tested with
//     ?staging-js=true before promoting to global.js.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  "use strict";

  var TAG = "__here_contact_us_navbar_v1";
  if (window[TAG]) return;
  window[TAG] = true;

  var LINK_ID = "here-contact-us-btn";
  var URLS = {
    en: "https://www.here.com/contact?intref=dev_docum",
    ja: "https://www.here.com/jp/contact"
  };
  var LABELS = { en: "Contact us", ja: "お問い合わせ" };

  function currentLang() {
    return /\/ja(\/|$|\?)/.test(window.location.href) ? "ja" : "en";
  }

  function currentTheme() {
    // Landing page: .here-glp[data-theme] is authoritative
    var glp = document.querySelector(".here-glp");
    if (glp && glp.getAttribute("data-theme")) {
      return glp.getAttribute("data-theme");
    }
    // Interior doc pages: derive from ReadMe's data-color-mode
    var mode = (document.documentElement.getAttribute("data-color-mode") || "").toLowerCase();
    var isDark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    return isDark
      ? "hds-web-product-dark-theme"
      : "hds-web-product-light-theme";
  }

  function syncTheme() {
    var btn = document.getElementById(LINK_ID);
    if (btn) btn.setAttribute("data-theme", currentTheme());
  }

  function injectStyles() {
    if (document.getElementById("here-contact-us-navbar-styles")) return;
    var s = document.createElement("style");
    s.id = "here-contact-us-navbar-styles";
    // High-specificity selector (#id + class + attr) so we always beat
    // HDS's default hds-button.hds-button--variant-secondary rule regardless
    // of load order. Applies at the html-level so it works on landing
    // page (nested inside .here-glp on some layouts) and doc pages alike.
    s.textContent =
      "html hds-button#here-contact-us-btn.here-contact-us[variant='secondary'] {" +
      "  display: inline-flex !important;" +
      "  align-self: center !important;" +
      "  vertical-align: middle !important;" +
      "  background: transparent !important;" +
      "  background-color: transparent !important;" +
      "  border: 0 !important;" +
      "  box-shadow: none !important;" +
      "  text-decoration: none !important;" +
      "}";
    document.head.appendChild(s);
  }

  function inject() {
    // Find Ask AI in the header and land right after it.
    var askAi = document.querySelector(
      ".rm-AskAi-button, .rm-AskAi, .Header-askai1MTDknILiJku"
    );
    if (!askAi) return;

    var askAiSlot =
      askAi.closest(".Header-askai1MTDknILiJku") ||
      askAi.closest(".rm-AskAi") ||
      askAi;
    var headerRight = askAiSlot.parentNode;
    if (!headerRight) return;

    var existing = document.getElementById(LINK_ID);
    if (existing && existing.parentNode === headerRight) {
      syncTheme();
      return;
    }
    if (existing) existing.remove();

    var lang = currentLang();
    var url = URLS[lang] || URLS.en;

    var btn = document.createElement("hds-button");
    btn.id = LINK_ID;
    btn.className = "here-contact-us";
    btn.setAttribute("data-styles", "hds");
    btn.setAttribute("data-theme", currentTheme());
    btn.setAttribute("variant", "secondary");
    btn.setAttribute("size", "small");
    btn.textContent = LABELS[lang] || LABELS.en;
    btn.addEventListener("click", function () {
      window.open(url, "_blank", "noopener");
    });

    // Sit immediately to the RIGHT of Ask AI in DOM order.
    var afterAskAi = askAiSlot.nextSibling;
    if (afterAskAi) headerRight.insertBefore(btn, afterAskAi);
    else headerRight.appendChild(btn);
  }

  function run() {
    injectStyles();
    inject();
  }

  // On landing page (first paint) the Ask AI button often isn't in the
  // DOM yet when this script first executes. Poll briefly, and also
  // observe body mutations so we catch a late mount — either wins,
  // whichever fires first.
  function startInitial() {
    run();
    if (document.getElementById(LINK_ID)) return; // already placed
    var attempts = 0;
    var poll = setInterval(function () {
      run();
      attempts++;
      if (document.getElementById(LINK_ID) || attempts > 40) {
        clearInterval(poll);
      }
    }, 250); // ~10 seconds worst-case

    // Also observe body: as soon as Ask AI shows up anywhere, try again.
    var mo = new MutationObserver(function () {
      if (document.querySelector(".rm-AskAi-button, .rm-AskAi, .Header-askai1MTDknILiJku")) {
        run();
        if (document.getElementById(LINK_ID)) {
          mo.disconnect();
          clearInterval(poll);
        }
      }
    });
    try {
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startInitial);
  } else {
    startInitial();
  }

  // Follow ReadMe SPA nav — re-inject when route changes.
  if (window.__here_nav_bus_v1 && window.__here_nav_bus_v1.onNav) {
    window.__here_nav_bus_v1.onNav(run);
  }

  // Follow dark mode: watch .here-glp[data-theme] on landing page,
  // <html data-color-mode> on interior doc pages, and OS-level
  // prefers-color-scheme changes when mode is "system".
  try {
    var glp = document.querySelector(".here-glp");
    if (glp) {
      new MutationObserver(syncTheme).observe(glp, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
    }
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-mode"]
    });
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", syncTheme);
    }
  } catch (e) {}
})();
