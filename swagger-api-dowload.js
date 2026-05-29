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
  const isInReference = () => location.pathname.includes('/reference/');
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
  // Used only when data-raycast-oas is absent. Scores each listed spec by how
  // many tokens from the project root path appear in its filename, then picks
  // the best match without fetching any spec content.
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
      // Primary: <header data-raycast-oas="..."> is ReadMe's authoritative signal
      // for exactly which spec this page was built from.
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

      // Fallback: data-raycast-oas absent — name-match against /openapi index.
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

      // Last-resort fallback if browser blocks the Blob download.
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

    // attributes:true catches SPA updates to data-raycast-oas
    // attribute mutation, not childList
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