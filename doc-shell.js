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

  var NAVBAR_OFFSET = 88; // 64px sticky navbar + 24px breathing room

  var root = document.querySelector(".hgs");
  if (!root) return;

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

  /**
   * The table of contents is one <hds-vertical-navigation-sub-list-item> per
   * section, each wrapping an <a href="#section-id">. That anchor hash is what
   * ties a nav item back to its section, and the DOM order defines the page
   * order used by the scroll spy.
   */
  function getTocEntries() {
    return toArray(
      document.querySelectorAll(".hgs-toc hds-vertical-navigation-sub-list-item")
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

  function initSideNav() {
    var entries = getTocEntries();
    if (!entries.length) return;

    var activeId = null;

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
      var probe = window.scrollY + NAVBAR_OFFSET + 8;
      var current = entries[0];

      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].section.offsetTop <= probe) {
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

    var scheduled = false;
    function onScroll() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function () {
        scheduled = false;
        syncOnScroll();
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    syncOnScroll();

    // Smooth scroll for every in-page anchor, including the navbar tab menu.
    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[href^='#']");
      if (!link) return;

      var id = link.getAttribute("href").slice(1);
      if (!id) return;

      var target = document.getElementById(id);
      if (!target) return;

      event.preventDefault();

      window.scrollTo({
        top: target.offsetTop - NAVBAR_OFFSET,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });

      setActive(id);

      // Keep the URL shareable without triggering a second native jump.
      if (window.history && window.history.pushState) {
        window.history.pushState(null, "", "#" + id);
      }
    });
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

    var toggle = document.querySelector("[data-hgs-theme-toggle]");
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

  function initThemeToggle() {
    var stored = readStoredTheme();
    var initial =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    applyTheme(initial);

    var toggle = document.querySelector("[data-hgs-theme-toggle]");
    if (!toggle) return;

    toggle.addEventListener("click", function () {
      var next =
        root.getAttribute("data-theme") === THEMES.dark ? "light" : "dark";
      applyTheme(next);
      storeTheme(next);
    });
  }

  /* -------------------------------------------------------------------------
     4. Code sample copy buttons
     `data-hgs-copy` points at the id of the <pre> holding the sample.
     ---------------------------------------------------------------------- */

  function initCopyButtons() {
    toArray(document.querySelectorAll("[data-hgs-copy]")).forEach(function (button) {
      button.addEventListener("click", async function () {
        var source = document.getElementById(
          button.getAttribute("data-hgs-copy")
        );
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
      });
    });
  }

  /* -------------------------------------------------------------------------
     5. Media play buttons — placeholder for the real player/demo
     ---------------------------------------------------------------------- */

  function initMediaButtons() {
    toArray(document.querySelectorAll("[data-hgs-video]")).forEach(function (
      playButton
    ) {
      playButton.addEventListener("click", function () {
        var slug = playButton.getAttribute("data-hgs-video");

        /**
         * Replace this with the real embed (hds-modal + iframe, or an inline
         * <video>). Dispatching an event keeps that swap to a single place.
         */
        playButton.dispatchEvent(
          new CustomEvent("hgs:video-play", {
            bubbles: true,
            detail: { slug: slug },
          })
        );
      });
    });
  }

  /* -------------------------------------------------------------------------
     6. Footer — cookie preferences and language switch
     ---------------------------------------------------------------------- */

  function initCookiePrefs() {
    var link = document.querySelector("[data-hgs-cookie-prefs]");
    if (!link) return;

    link.addEventListener("click", function (event) {
      event.preventDefault();
      try {
        window.utag.gdpr.showConsentPreferences();
      } catch (err) {
        /* Consent manager not loaded on this route. */
      }
    });
  }

  function initLanguageSwitch() {
    var buttons = document.querySelectorAll(
      ".hgs-footer__lang button[data-lang]"
    );
    if (!buttons.length) return;

    var current = /\/ja(\/|$|\?)/.test(window.location.href) ? "ja" : "en";

    toArray(buttons).forEach(function (button) {
      var lang = button.getAttribute("data-lang");
      button.setAttribute("aria-pressed", lang === current ? "true" : "false");

      button.addEventListener("click", function () {
        if (lang === current) return;
        window.location.assign(
          lang === "ja" ? "https://docs.here.com/ja" : "https://docs.here.com/"
        );
      });
    });
  }

  /* -------------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init() {
    initSideNav();
    initThemeToggle();
    initCopyButtons();
    initMediaButtons();
    initCookiePrefs();
    initLanguageSwitch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
