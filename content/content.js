// ChromeScroller — content script
// Injection guard: version string prevents double-setup AND ensures a fresh
// injection after an extension reload always runs (old version ≠ new version).
const _CS_VER = 'v13';
if (window.__chromescrollerInjected !== _CS_VER) {
  window.__chromescrollerInjected = _CS_VER;

  // ── Camera SVG cursor (32×32, hotspot at centre of lens: 16 16) ──────────
  const CAMERA_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect x="2" y="8" width="28" height="19" rx="3" ry="3"',
    ' fill="#1a1a1a" stroke="#fff" stroke-width="1.5"/>',
    '<rect x="11" y="5" width="10" height="5" rx="2" ry="2"',
    ' fill="#1a1a1a" stroke="#fff" stroke-width="1.5"/>',
    '<circle cx="16" cy="17" r="7" fill="none" stroke="#fff" stroke-width="1.5"/>',
    '<circle cx="16" cy="17" r="5" fill="rgba(100,180,255,0.35)" stroke="#aaddff" stroke-width="1"/>',
    '<circle cx="13.5" cy="14.5" r="1.2" fill="rgba(255,255,255,0.7)"/>',
    '<circle cx="26" cy="10" r="2" fill="#cc3333" stroke="#fff" stroke-width="1"/>',
    '</svg>'
  ].join('');

  const CAMERA_CURSOR = `url("data:image/svg+xml;base64,${btoa(CAMERA_SVG)}") 16 16, crosshair`;

  // ── State ────────────────────────────────────────────────────────────────
  let isActive       = false;
  let currentTarget  = null;
  let mouseX         = 0;
  let mouseY         = 0;
  let highlightEl    = null;
  let cursorStyleEl  = null;
  // true after the user navigates via scroll wheel; prevents mousemove from
  // immediately resetting currentTarget back to the deepest child element.
  let userNavigated  = false;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isScrollable(el) {
    // Require a meaningful visible height so we never treat tiny internal
    // wrapper elements (eg. 5px scroll containers) as full-height targets.
    if (el.clientHeight < 100) return false;
    const style = window.getComputedStyle(el);
    const ov    = style.overflowY;
    return (ov === 'auto' || ov === 'scroll' || ov === 'overlay') &&
           el.scrollHeight > el.clientHeight + 1;
  }

  // ── Activate / Deactivate ────────────────────────────────────────────────
  function activate() {
    if (isActive) return;
    isActive = true;

    // Inject camera cursor via a <style> tag (needed for !important override)
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.id = 'chromescroller-cursor-style';
    cursorStyleEl.textContent = `
      body.chromescroller-active,
      body.chromescroller-active * {
        cursor: ${CAMERA_CURSOR} !important;
      }
    `;
    document.head.appendChild(cursorStyleEl);
    document.body.classList.add('chromescroller-active');

    // Create highlight overlay
    highlightEl = document.createElement('div');
    highlightEl.id = 'chromescroller-highlight';
    document.body.appendChild(highlightEl);

    document.addEventListener('mousemove',    onMouseMove,    true);
    document.addEventListener('wheel',        onWheel,        { capture: true, passive: false });
    document.addEventListener('click',        onClick,        true);
    document.addEventListener('contextmenu',  onContextMenu,  true);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    document.body.classList.remove('chromescroller-active');

    if (cursorStyleEl) { cursorStyleEl.remove(); cursorStyleEl = null; }
    if (highlightEl)   { highlightEl.remove();   highlightEl   = null; }

    const spinner = document.getElementById('chromescroller-spinner');
    if (spinner) spinner.remove();

    document.removeEventListener('mousemove',   onMouseMove,   true);
    document.removeEventListener('wheel',       onWheel,       { capture: true, passive: false });
    document.removeEventListener('click',       onClick,       true);
    document.removeEventListener('contextmenu', onContextMenu, true);

    currentTarget  = null;
    userNavigated  = false;
  }

  // ── Highlight ────────────────────────────────────────────────────────────
  function setHighlight(el) {
    if (!el || !highlightEl) return;
    currentTarget = el;

    const rect = el.getBoundingClientRect();
    highlightEl.style.top    = rect.top    + 'px';
    highlightEl.style.left   = rect.left   + 'px';
    highlightEl.style.width  = rect.width  + 'px';
    highlightEl.style.height = rect.height + 'px';

    highlightEl.className = isScrollable(el) ? 'mode-scrollable' : 'mode-normal';
    highlightEl.style.display = 'block';
  }

  // ── Event handlers ───────────────────────────────────────────────────────
  // IDs of our own injected elements to skip when highlighting
  const OWN_IDS = new Set([
    'chromescroller-highlight',
    'chromescroller-spinner',
    'chromescroller-flash',
    'chromescroller-hide-headers-css',
  ]);

  // Data attribute used to hide headers via a stylesheet rule.
  // React never removes unknown data-* attributes during reconciliation, and a
  // CSS !important rule beats any non-!important inline style React writes back.
  const HIDE_ATTR = 'data-chromescroller-hide';

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // If the user navigated via scroll wheel, keep their selection as long as
    // the cursor stays inside the highlighted element's bounding rect.
    // Only revert to natural hover once they move the cursor outside it.
    if (userNavigated && currentTarget) {
      const rect = currentTarget.getBoundingClientRect();
      if (mouseX >= rect.left && mouseX <= rect.right &&
          mouseY >= rect.top  && mouseY <= rect.bottom) {
        return; // still inside — honour manual selection
      }
      userNavigated = false; // left the element — resume natural hover
    }

    // elementFromPoint passes through pointer-events:none overlay automatically
    const el = document.elementFromPoint(mouseX, mouseY);
    if (el && !OWN_IDS.has(el.id)) {
      setHighlight(el);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentTarget) return;

    if (e.deltaY < 0) {
      // Scroll UP → parent element (stop at <body>)
      const parent = currentTarget.parentElement;
      if (parent && parent !== document.documentElement) {
        userNavigated = true; // user manually went to ancestor — preserve it
        setHighlight(parent);
      }
    } else {
      // Scroll DOWN → deepest element at current cursor position
      const el = document.elementFromPoint(mouseX, mouseY);
      if (el && el !== highlightEl) {
        userNavigated = false; // back to deepest = natural hover state
        setHighlight(el);
      }
    }
  }
  function onContextMenu(e) {
    // Right-click = quick stop shortcut
    e.preventDefault();
    e.stopPropagation();
    deactivate();
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentTarget || !isActive) return;

    userNavigated = false; // reset so next hover starts fresh
    const el = currentTarget;

    // Wake the service worker BEFORE hiding the UI so the SW is guaranteed
    // to be active when CAPTURE_VISIBLE_TAB arrives.  If the SW was dormant
    // this round-trip (≤ 50 ms when awake, ≤ 300 ms when just woken) ensures
    // the subsequent capture messages never hit the "receiving end" race.
    await sendMessage({ action: 'PING' });

    // Hide our UI elements so they NEVER appear in any screenshot
    if (cursorStyleEl) cursorStyleEl.disabled = true;
    if (highlightEl)   highlightEl.style.display = 'none';

    try {
      const scrollable = isScrollable(el);
      // For scrollable: badge is shown between captures (never during captureVisibleTab)
      // For non-scrollable: single instant capture, no badge needed
      const dataUrl = scrollable
        ? await captureScrollableAndStitch(el)
        : await captureVisible(el);

      const filename = buildFilename();
      const resp = await sendMessage({ action: 'DOWNLOAD_IMAGE', dataUrl, filename });
      if (resp && resp.ok) showFlash('Saved!');
      else showFlash('Failed', true);
    } catch (err) {
      console.error('[ChromeScroller] Capture error:', err);
      showFlash('Failed', true);
    } finally {
      hideBadge();
      if (cursorStyleEl) cursorStyleEl.disabled = false;
      if (highlightEl && currentTarget) highlightEl.style.display = 'block';
    }
  }

  // ── Progress badge (small corner widget — never shown during captureVisibleTab) ──
  function showBadge(text) {
    let badge = document.getElementById('chromescroller-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'chromescroller-badge';
      badge.innerHTML = '<div class="badge-ring"></div><span></span>';
      document.body.appendChild(badge);
    }
    badge.querySelector('span').textContent = text;
  }

  function hideBadge() {
    const badge = document.getElementById('chromescroller-badge');
    if (badge) badge.remove();
  }

  function showFlash(text, isError = false) {
    const flash = document.createElement('div');
    flash.id = 'chromescroller-flash';
    flash.textContent = isError ? `ChromeScroller: ${text}` : `ChromeScroller: ${text}`;
    Object.assign(flash.style, {
      position:        'fixed',
      bottom:          '24px',
      right:           '24px',
      zIndex:          '2147483647',
      background:      isError ? '#ef4444' : '#22c55e',
      color:           '#fff',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize:        '13px',
      fontWeight:      '600',
      padding:         '10px 18px',
      borderRadius:    '8px',
      boxShadow:       '0 4px 16px rgba(0,0,0,0.4)',
      pointerEvents:   'none',
      opacity:         '1',
      transition:      'opacity 0.4s ease',
    });
    document.body.appendChild(flash);
    // Fade out after 1.5 s, remove after 2 s
    setTimeout(() => { flash.style.opacity = '0'; }, 1500);
    setTimeout(() => { if (flash.parentNode) flash.remove(); }, 2000);
  }

  // ── Screenshot helpers ───────────────────────────────────────────────────
  async function captureVisible(el) {
    const rect = el.getBoundingClientRect();
    const dpr  = window.devicePixelRatio;
    const resp = await sendMessage({ action: 'CAPTURE_VISIBLE_TAB' });
    if (!resp || !resp.ok) throw new Error(resp?.error || 'captureVisibleTab failed');
    return cropToRect(resp.dataUrl, rect, dpr);
  }

  function cropToRect(dataUrl, rect, dpr) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.round(rect.width  * dpr);
        const h = Math.round(rect.height * dpr);
        if (w === 0 || h === 0) { reject(new Error('Zero-size element')); return; }

        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(
          img,
          Math.round(rect.left * dpr), Math.round(rect.top  * dpr), w, h,
          0, 0, w, h
        );
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load screenshot data'));
      img.src = dataUrl;
    });
  }

  // ── Header detection helpers ─────────────────────────────────────────────
  // The page-level scroll element (document.body on Firefox, <html> on Chrome).
  const PAGE_SCROLLER = document.scrollingElement || document.documentElement;

  // Returns the nearest scrollable ancestor of `node`.
  // html/body → PAGE_SCROLLER so comparisons work on both Chrome and Firefox.
  function getScrollContainer(node) {
    let n = node;
    while (n && n !== document.documentElement && n !== document.body) {
      const ov = window.getComputedStyle(n).overflowY;
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') return n;
      n = n.parentElement;
    }
    return PAGE_SCROLLER;
  }

  // Shared pre-filter: is this node a visible, wide element pinned near the
  // top of the capture area?  Used by both fixed and sticky detection.
  function isTopOverlayCandidate(node, captureRect) {
    if (!node || OWN_IDS.has(node.id)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const pos = style.position;
    if (pos !== 'fixed' && pos !== 'sticky') return false;
    const r = node.getBoundingClientRect();
    if (r.width < 10 || r.height < 2) return false;
    // Must overlap the capture rect vertically
    if (r.bottom <= captureRect.top || r.top >= captureRect.bottom) return false;
    // Must cross the horizontal centre of the capture area (excludes FABs /
    // sidebars / narrow badges that are anchored to one side only)
    const centerX = captureRect.left + captureRect.width / 2;
    if (r.left > centerX || r.right < centerX) return false;
    // Top edge must be in the upper 35 % of the capture height
    if (r.top > captureRect.top + captureRect.height * 0.35) return false;
    return true;
  }

  // Find all fixed/sticky header elements that will overlay the top of the
  // capture area during scrolling.  Search the ENTIRE document so we catch
  // headers that live outside `el` (siblings, ancestors) as well as inside.
  //
  // Two separate rules for position:fixed vs position:sticky —
  //
  //   fixed  → r.top must already be at/near captureRect.top (they never move).
  //
  //   sticky → DON'T require the element to be stuck right now.  At scrollTop=0
  //            the sticky bar sits in its natural layout position (e.g. 90px
  //            below captureRect.top, behind the path-row and files-header).
  //            It only sticks when the user has scrolled past those elements.
  //            We detect it by its CSS `top` value: if it sticks within the top
  //            10% of the capture area (or ≤ 60px absolute), it's a header bar.
  //            isTopOverlayCandidate's 35%-from-top guard still excludes genuine
  //            mid-content section headers that happen to have top:0.
  function findHeaderElements(el, captureRect) {
    const found = new Set();

    document.querySelectorAll('*').forEach(node => {
      if (!isTopOverlayCandidate(node, captureRect)) return;
      const style = window.getComputedStyle(node);
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') return;

      const r = node.getBoundingClientRect();

      if (pos === 'fixed') {
        // Fixed: always at its declared screen position — must be near top.
        if (r.top > captureRect.top + 10) return;
      } else {
        // Sticky: may not be stuck yet (scrollTop could be 0).
        // Accept if EITHER already pinned at the top OR its CSS `top` value is
        // small (meaning it will pin near the top once the user has scrolled).
        const stickyTop = Math.max(0, parseFloat(style.top) || 0);
        const alreadyStuck  = r.top <= captureRect.top + stickyTop + 15;
        const sticksNearTop = stickyTop <= Math.max(60, captureRect.height * 0.1);
        if (!alreadyStuck && !sticksNearTop) return;
      }

      found.add(node);
    });

    return [...found];
  }

  // Hide every detected header by:
  //   1. Injecting a <style> rule  [data-chromescroller-hide] { display:none !important }
  //   2. Setting the data attribute on each node
  //
  // Why not inline style?  React SPA reconciliation fires on scroll events and
  // calls node.style.display = 'flex' (a JS property assignment) which removes
  // any !important flag set via setProperty, overriding our inline hide.
  // A stylesheet rule with !important is NOT overridden by non-!important inline
  // styles, and React never removes unknown data-* attributes, so this approach
  // survives re-renders.
  //
  // Returns { nodes, styleEl } for restoreHeaders().
  function hideHeaders(el, captureRect) {
    const nodes = findHeaderElements(el, captureRect);
    if (nodes.length === 0) return { nodes: [], styleEl: null };

    // Remove any leftover style element from a previous (failed) capture
    const existing = document.getElementById('chromescroller-hide-headers-css');
    if (existing) existing.remove();

    const styleEl = document.createElement('style');
    styleEl.id = 'chromescroller-hide-headers-css';
    styleEl.textContent = `[${HIDE_ATTR}]{display:none!important}`;
    document.head.appendChild(styleEl);

    nodes.forEach(n => n.setAttribute(HIDE_ATTR, ''));
    return { nodes, styleEl };
  }

  // Undo hideHeaders() — remove the attribute and the injected stylesheet.
  function restoreHeaders({ nodes, styleEl }) {
    nodes.forEach(n => n.removeAttribute(HIDE_ATTR));
    if (styleEl && styleEl.parentNode) styleEl.remove();
    // Belt-and-suspenders: also remove by id in case the ref was lost
    const leftover = document.getElementById('chromescroller-hide-headers-css');
    if (leftover) leftover.remove();
  }

  // ── Unified scroll-stitch engine ─────────────────────────────────────────
  // Strategy: hide all fixed/sticky header elements before capturing so they
  // cannot cover content rows in ANY strip.  Because they are removed from the
  // layout (display:none), el.scrollHeight shrinks by their combined height and
  // every strip can simply scroll to `consumed` with startOffset=0.
  // The only offset logic that remains handles the clamped last strip (browser
  // won't scroll past maxScroll → startOffset = consumed − actualScroll).
  async function scrollAndStitch(el, captureRect, viewHeight) {
    const dpr        = window.devicePixelRatio;
    const origScroll = el.scrollTop;

    // Hide headers; re-measure totalH after (sticky removal shrinks scrollHeight).
    const savedHeaders = hideHeaders(el, captureRect);
    const totalH   = el.scrollHeight;
    const maxScroll = Math.max(0, totalH - viewHeight);

    const strips = [];
    let consumed = 0;
    let stripIdx = 0;

    try {
      while (consumed < totalH) {
        const targetScroll = Math.min(consumed, maxScroll);
        el.scrollTop = targetScroll;

        hideBadge();
        await waitForPaint();
        await sleep(60);

        const resp = await sendMessage({ action: 'CAPTURE_VISIBLE_TAB' });
        if (!resp || !resp.ok) throw new Error(resp?.error || 'captureVisibleTab failed');

        // startOffset = 0 normally; > 0 only on the clamped last strip.
        const actualScroll = el.scrollTop;
        const startOffset  = consumed - actualScroll;
        const captureH     = Math.min(viewHeight - startOffset, totalH - consumed);

        if (captureH <= 0) break;

        const strip = await cropToRect(
          resp.dataUrl,
          { left: captureRect.left, top: captureRect.top + startOffset,
            width: captureRect.width, height: captureH },
          dpr
        );
        strips.push({ dataUrl: strip, cssHeight: captureH });
        consumed += captureH;
        stripIdx++;

        if (consumed >= totalH) break;
        showBadge(`Capturing strip ${stripIdx + 1}…`);
      }
    } finally {
      restoreHeaders(savedHeaders);
      el.scrollTop = origScroll;
      hideBadge();
    }

    return stitchStrips(strips, captureRect.width, totalH, dpr);
  }

  // ── Scrollable element capture (thin wrapper) ─────────────────────────────
  async function captureScrollableAndStitch(el) {
    const rect = el.getBoundingClientRect();
    return scrollAndStitch(
      el,
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      el.clientHeight
    );
  }

  // Wait for two rAF ticks so the browser has painted the new scroll position
  function waitForPaint() {
    return new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }

  function stitchStrips(strips, widthCSS, totalHeightCSS, dpr) {
    return new Promise((resolve, reject) => {
      let loaded = 0;
      const imgs = new Array(strips.length);

      strips.forEach((strip, i) => {
        const img  = new Image();
        img.onload = () => {
          imgs[i] = img;
          if (++loaded === strips.length) {
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(widthCSS * dpr);
            canvas.height = Math.round(totalHeightCSS * dpr);
            const ctx = canvas.getContext('2d');
            let yOffset = 0;
            strips.forEach((s, i) => {
              ctx.drawImage(imgs[i], 0, yOffset);
              yOffset += Math.round(s.cssHeight * dpr);
            });
            resolve(canvas.toDataURL('image/png'));
          }
        };
        img.onerror = () => reject(new Error(`Failed to load strip ${i}`));
        img.src = strip.dataUrl;
      });
    });
  }

  // ── Full-page capture ────────────────────────────────────────────────────
  async function captureFullPage() {
    const el = document.scrollingElement || document.documentElement;
    return scrollAndStitch(
      el,
      { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight },
      window.innerHeight
    );
  }

  async function captureFullPageAndDownload() {
    if (cursorStyleEl) cursorStyleEl.disabled = true;
    if (highlightEl)   highlightEl.style.display = 'none';
    try {
      const dataUrl  = await captureFullPage();
      const filename = buildFilename();
      const resp     = await sendMessage({ action: 'DOWNLOAD_IMAGE', dataUrl, filename });
      if (resp && resp.ok) showFlash('Full page saved!');
      else                 showFlash('Failed', true);
    } catch (err) {
      console.error('[ChromeScroller] Full page capture error:', err);
      showFlash('Failed', true);
    } finally {
      hideBadge();
      if (cursorStyleEl) cursorStyleEl.disabled = false;
      if (highlightEl && isActive) highlightEl.style.display = 'block';
    }
  }

  function buildFilename() {
    const title = (document.title || 'screenshot')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .substring(0, 60) || 'screenshot';
    const ts = new Date().toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');  // "2026-03-10T14-30-00"
    return `${title}_${ts}.png`;
  }

  // ── Messaging helper ─────────────────────────────────────────────────────
  // MV3 service workers are terminated after ~30 s of inactivity.  When the
  // SW is dormant two failure modes can occur:
  //
  //   A) lastError = "Could not establish connection / receiving end does not
  //      exist" — SW is mid-wake.  We retry once after 300 ms (by then it's
  //      fully awake and the retry succeeds transparently).
  //
  //   B) The callback is never called at all (rare race condition while the SW
  //      transitions states).  The 8-second timeout resolves the promise with
  //      an error so onClick always reaches the catch/finally block and shows
  //      the "Failed" flash instead of hanging silently.
  function sendMessage(msg, _canRetry = true) {
    return new Promise(resolve => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: 'Service worker did not respond — please try again' });
      }, 8000);

      chrome.runtime.sendMessage(msg, resp => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;

        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || '';
          // Retry once if the SW was still waking up
          if (_canRetry && /receiving end|could not establish/i.test(err)) {
            setTimeout(() => sendMessage(msg, false).then(resolve), 300);
          } else {
            resolve({ ok: false, error: err });
          }
        } else {
          resolve(resp);
        }
      });
    });
  }

  // ── Message listener ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'ACTIVATE':
        activate();
        sendResponse({ ok: true });
        break;
      case 'DEACTIVATE':
        deactivate();
        sendResponse({ ok: true });
        break;
      case 'GET_STATUS':
        sendResponse({ active: isActive });
        break;
      case 'CAPTURE_FULL_PAGE':
        captureFullPageAndDownload().then(() => sendResponse({ ok: true }));
        return true; // keep channel open (async)
    }
    return false;
  });
}
