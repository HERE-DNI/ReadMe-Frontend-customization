/* =============================================================================
   HERE Documentation — shared sub page behaviour
   Figma: "Documentation site 2026"

   Progressive enhancement only. Every page that loads this file stays fully
   readable and navigable if the script never runs.

     1. Scroll spy       keeps the "On this page" side nav in sync
     2. Smooth scrolling anchors land below the sticky navbar
     3. Theme toggle     flips the HDS light/dark theme
     4. Copy buttons     copy a code sample to the clipboard
     5. Media play       generic hook for video/demo embeds
     6. Footer           language switch + cookie preferences

   Section order is read from the side navigation in the DOM, so pages do not
   need to repeat their section list here.
   ========================================================================== */

(function () {
  "use strict";

  // Loaded once from ReadMe global JS and again by the page loaders, so later runs only rescan.
  if (window.__hereDocShell) {
    window.__hereDocShell.scan();
    return;
  }

  var NAVBAR_OFFSET = 88; // 64px sticky navbar + 24px breathing room
  var ROOT_SELECTOR = ".hgs";

  // ReadMe swaps page content without a reload, so the root and its sections are re-read on every route.
  var root = null;
  var entries = [];
  var activeId = null;

  /* -------------------------------------------------------------------------
     Helpers
     ---------------------------------------------------------------------- */

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function toArray(nodeList) {
    return Array.prototype.slice.call(nodeList);
  }

  function closestInRoot(target, selector) {
    if (!root || !target || !target.closest) return null;
    var el = target.closest(selector);
    return el && root.contains(el) ? el : null;
  }

  function pageTop(el) {
    return el.getBoundingClientRect().top + window.scrollY;
  }

  /**
   * The table of contents is one <hds-vertical-navigation-sub-list-item> per
   * section, each wrapping an <a href="#section-id">. That anchor hash is what
   * ties a nav item back to its section, and the DOM order defines the page
   * order used by the scroll spy.
   */
  function getTocEntries() {
    return toArray(
      root.querySelectorAll(".hgs-toc hds-vertical-navigation-sub-list-item")
    )
      .map(function (item) {
        var link = item.querySelector("a[href^='#']");
        var id = link ? link.getAttribute("href").slice(1) : null;
        return {
          item: item,
          link: link,
          id: id,
          section: id ? document.getElementById(id) : null,
        };
      })
      .filter(function (entry) {
        return entry.section;
      });
  }

  /* -------------------------------------------------------------------------
     1 + 2. Side navigation: scroll spy and smooth anchor scrolling
     ---------------------------------------------------------------------- */

  function setActive(id) {
    if (!id || id === activeId) return;
    activeId = id;

    entries.forEach(function (entry) {
      var isActive = entry.id === id;
      // hds-vertical-navigation-sub-list-item exposes a boolean `selected`.
      if (isActive) {
        entry.item.setAttribute("selected", "");
      } else {
        entry.item.removeAttribute("selected");
      }
      if (entry.link) {
        entry.link.setAttribute("aria-current", isActive ? "true" : "false");
      }
    });
  }

  /**
   * Pick the last section whose top edge has passed the navbar. Reading
   * position beats intersection ratios here because the sections have very
   * different heights.
   */
  function syncOnScroll() {
    if (!entries.length) return;

    var probe = window.scrollY + NAVBAR_OFFSET + 8;
    var current = entries[0];

    for (var i = 0; i < entries.length; i += 1) {
      if (pageTop(entries[i].section) <= probe) {
        current = entries[i];
      }
    }

    // At the very bottom of the page, highlight the final section outright.
    var atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2;
    if (atBottom) {
      current = entries[entries.length - 1];
    }

    setActive(current.id);
  }

  var scrollScheduled = false;
  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    window.requestAnimationFrame(function () {
      scrollScheduled = false;
      syncOnScroll();
    });
  }

  // Smooth scroll for in-page anchors that point at a section of the shell.
  function onAnchorClick(event) {
    if (!root) return;
    var link = event.target.closest && event.target.closest("a[href^='#']");
    if (!link) return;

    var id = link.getAttribute("href").slice(1);
    if (!id) return;

    var target = document.getElementById(id);
    if (!target || !root.contains(target)) return;

    event.preventDefault();

    window.scrollTo({
      top: pageTop(target) - NAVBAR_OFFSET,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });

    setActive(id);

    // Keep the URL shareable without triggering a second native jump.
    if (window.history && window.history.pushState) {
      window.history.pushState(null, "", "#" + id);
    }
  }

  // hds-button has no href, so link buttons carry data-hgs-href instead of an inline onclick.
  function onLinkButtonClick(event) {
    var button = closestInRoot(event.target, "[data-hgs-href]");
    if (!button) return;

    var href = button.getAttribute("data-hgs-href");
    if (!href) return;

    if (button.getAttribute("data-hgs-target") === "_blank") {
      window.open(href, "_blank", "noopener");
    } else {
      window.location.assign(href);
    }
  }

  /* -------------------------------------------------------------------------
     3. Theme toggle — swaps the HDS theme applied to the shell root
     ---------------------------------------------------------------------- */

  var THEMES = {
    light: "hds-web-product-light-theme",
    dark: "hds-web-product-dark-theme",
  };
  var STORAGE_KEY = "hgs-theme";

  function applyTheme(mode) {
    root.setAttribute("data-theme", THEMES[mode] || THEMES.light);

    var toggle = root.querySelector("[data-hgs-theme-toggle]");
    if (toggle) {
      var goingDark = mode !== "dark";
      // HDS names the light-mode icon "weather-clear-day" in the weather set.
      toggle.setAttribute(
        "icon",
        goingDark ? "clear-night" : "weather-clear-day"
      );
      toggle.setAttribute("icon-category", "weather");
      toggle.setAttribute(
        "aria-label",
        goingDark ? "Switch to dark mode" : "Switch to light mode"
      );
    }
  }

  function readStoredTheme() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function storeTheme(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {
      /* Private browsing — the toggle still works for this page view. */
    }
  }

  function initTheme() {
    var stored = readStoredTheme();
    var initial =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    applyTheme(initial);
  }

  function onThemeToggleClick(event) {
    if (!closestInRoot(event.target, "[data-hgs-theme-toggle]")) return;
    var next =
      root.getAttribute("data-theme") === THEMES.dark ? "light" : "dark";
    applyTheme(next);
    storeTheme(next);
  }

  /* -------------------------------------------------------------------------
     4. Code sample copy buttons
     `data-hgs-copy` points at the id of the <pre> holding the sample.
     ---------------------------------------------------------------------- */

  async function onCopyClick(event) {
    var button = closestInRoot(event.target, "[data-hgs-copy]");
    if (!button) return;

    var source = document.getElementById(button.getAttribute("data-hgs-copy"));
    if (!source) return;

    var text = source.innerText;
    var copied = false;

    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      // Clipboard API needs a secure context; fall back to a temp textarea.
      try {
        var scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        copied = document.execCommand("copy");
        document.body.removeChild(scratch);
      } catch (fallbackErr) {
        copied = false;
      }
    }

    var original = button.textContent.trim();
    button.textContent = copied ? "Copied" : "Press Ctrl+C";
    window.setTimeout(function () {
      button.textContent = original;
    }, 1600);
  }

  /* -------------------------------------------------------------------------
     5. Media play buttons — placeholder for the real player/demo
     ---------------------------------------------------------------------- */

  function onMediaClick(event) {
    var playButton = closestInRoot(event.target, "[data-hgs-video]");
    if (!playButton) return;

    /**
     * Replace this with the real embed (hds-modal + iframe, or an inline
     * <video>). Dispatching an event keeps that swap to a single place.
     */
    playButton.dispatchEvent(
      new CustomEvent("hgs:video-play", {
        bubbles: true,
        detail: { slug: playButton.getAttribute("data-hgs-video") },
      })
    );
  }

  /* -------------------------------------------------------------------------
     6. Footer — cookie preferences and language switch
     ---------------------------------------------------------------------- */

  function onCookiePrefsClick(event) {
    if (!closestInRoot(event.target, "[data-hgs-cookie-prefs]")) return;
    event.preventDefault();
    try {
      window.utag.gdpr.showConsentPreferences();
    } catch (err) {
      /* Consent manager not loaded on this route. */
    }
  }

  function currentLang() {
    return /\/ja(\/|$|\?)/.test(window.location.href) ? "ja" : "en";
  }

  function initLanguageSwitch() {
    var current = currentLang();
    toArray(root.querySelectorAll(".hgs-footer__lang button[data-lang]")).forEach(
      function (button) {
        var lang = button.getAttribute("data-lang");
        button.setAttribute("aria-pressed", lang === current ? "true" : "false");
      }
    );
  }

  function onLanguageClick(event) {
    var button = closestInRoot(event.target, ".hgs-footer__lang button[data-lang]");
    if (!button) return;

    var lang = button.getAttribute("data-lang");
    if (lang === currentLang()) return;
    window.location.assign(
      lang === "ja" ? "https://docs.here.com/ja" : "https://docs.here.com/"
    );
  }

  /* -------------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function isCurrent(node) {
    if (!node || node !== root || !node.isConnected) return false;
    return !entries.length || entries[0].section.isConnected;
  }

  function scan() {
    var next = document.querySelector(ROOT_SELECTOR);
    if (isCurrent(next)) return;

    root = next;
    entries = [];
    activeId = null;
    if (!root) return;

    entries = getTocEntries();
    initTheme();
    initLanguageSwitch();
    syncOnScroll();
  }

  var scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(function () {
      scanScheduled = false;
      scan();
    });
  }

  window.__hereDocShell = { scan: scan };

  // Listeners are attached once and delegated, so they keep working across SPA routes.
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("click", function (event) {
    onAnchorClick(event);
    onLinkButtonClick(event);
    onThemeToggleClick(event);
    onCopyClick(event);
    onMediaClick(event);
    onCookiePrefsClick(event);
    onLanguageClick(event);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }

  try {
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (err) {
    /* Very old browsers: the shell still binds to the root present at load. */
  }
})();
