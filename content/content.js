// ChromeScroller — content script
// Injection guard: prevents double-setup if script is injected more than once
if (!window.__chromescrollerInjected) {
  window.__chromescrollerInjected = true;

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
  ]);

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
  // Returns the nearest scrollable ancestor of `node` (the element whose
  // scrollTop drives `node`'s position).  html/body → document.documentElement.
  function getScrollContainer(node) {
    let n = node;
    while (n && n !== document.documentElement && n !== document.body) {
      const ov = window.getComputedStyle(n).overflowY;
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') return n;
      n = n.parentElement;
    }
    return document.documentElement;
  }

  // Detect position:FIXED elements (page-level navbars/toolbars) that overlap
  // the top of the capture area.  Measured once; fixed elements never move.
  function detectFixedHeaderHeight(captureRect) {
    let maxBottom = captureRect.top;
    document.querySelectorAll('*').forEach(node => {
      if (OWN_IDS.has(node.id)) return;
      if (window.getComputedStyle(node).position !== 'fixed') return;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.top > captureRect.top + 5) return;
      if (r.bottom <= captureRect.top) return;
      if (r.left > captureRect.left + 30) return;
      if (r.right < captureRect.left + captureRect.width * 0.33) return;
      maxBottom = Math.max(maxBottom, r.bottom);
    });
    return Math.max(0, maxBottom - captureRect.top);
  }

  // Detect position:STICKY elements inside `el` whose scroll container IS `el`
  // and that pin at/near the top of `el`'s viewport (top ≤ 30% of view height).
  //
  // Why this works (unlike the old Phase-C approach):
  //   We measure stickyH ONCE at scrollTop=0 and use it for ALL strips.
  //   For strips n≥1, targetScroll = consumed − headerH > 0, so the sticky
  //   element stays pinned for every strip — we never back-scroll below its
  //   stick threshold.  The sticky bar appears only in strip 0 (naturally);
  //   strips 1+ crop it out, exposing the content rows beneath it.
  function detectStickyHeaderHeight(el, captureRect) {
    let maxPinnedBottom = captureRect.top;
    el.querySelectorAll('*').forEach(node => {
      if (OWN_IDS.has(node.id)) return;
      const style = window.getComputedStyle(node);
      if (style.position !== 'sticky') return;
      // Only sticky elements whose scroll container is `el`
      if (getScrollContainer(node.parentElement) !== el) return;
      const topVal = parseFloat(style.top);
      if (isNaN(topVal) || topVal < 0 || topVal > captureRect.height * 0.3) return;
      const r = node.getBoundingClientRect();
      if (r.width < 10 || r.height < 2) return;
      // Must span at least 1/4 of the capture width (exclude narrow sticky pills)
      if ((r.right - r.left) < captureRect.width * 0.25) return;
      // Must be visible within the capture rect
      if (r.bottom <= captureRect.top || r.top >= captureRect.bottom) return;
      // When pinned, bottom = captureRect.top + topVal + element height
      maxPinnedBottom = Math.max(maxPinnedBottom, captureRect.top + topVal + r.height);
    });
    return Math.max(0, maxPinnedBottom - captureRect.top);
  }

  // ── Unified scroll-stitch engine ─────────────────────────────────────────
  // Coordinate model (all CSS px):
  //   el.scrollTop = S  →  content at S..S+viewHeight is visible
  //   viewport y = captureRect.top + dy  ↔  content at S + dy
  //
  // Strip 0 (scrollTop = 0):
  //   Captures 0..viewHeight naturally — the header bar appears once here.
  //
  // Strips n ≥ 1 (scrollTop = consumed − headerH):
  //   The header (fixed or sticky-pinned) sits at captureRect.top..captureRect.top+headerH.
  //   Below it we see content starting at consumed → crop from captureRect.top+headerH.
  //
  // Clamped last strip:
  //   startOffset = consumed − actualScroll handles browser scroll-clamping.
  async function scrollAndStitch(el, captureRect, totalHeight, viewHeight) {
    const dpr        = window.devicePixelRatio;
    const origScroll = el.scrollTop;
    const maxScroll  = Math.max(0, totalHeight - viewHeight);

    // Measure combined header height once (fixed + sticky-pinned).
    const headerH = (() => {
      if (maxScroll <= 0) return 0;
      const fixedH  = detectFixedHeaderHeight(captureRect);
      const stickyH = detectStickyHeaderHeight(el, captureRect);
      const fh = Math.max(fixedH, stickyH);
      // Sanity: if > 80 % of the view, detection almost certainly misfired.
      return fh >= viewHeight * 0.8 ? 0 : fh;
    })();

    const strips = [];
    let consumed = 0;
    let stripIdx = 0;

    while (consumed < totalHeight) {
      // Strip 0: scroll to top (header appears naturally once).
      // Strip n: targetScroll = consumed − headerH  (always > 0 for n≥1,
      //          so sticky elements stay pinned — they never un-stick).
      const targetScroll = stripIdx === 0 ? 0 : Math.min(consumed - headerH, maxScroll);
      el.scrollTop = targetScroll;

      // Badge MUST be hidden before every captureVisibleTab call.
      hideBadge();
      await waitForPaint();
      await sleep(60);

      const resp = await sendMessage({ action: 'CAPTURE_VISIBLE_TAB' });
      if (!resp || !resp.ok) throw new Error(resp?.error || 'captureVisibleTab failed');

      // startOffset: how many px from captureRect.top to skip.
      //   Normal:  = headerH  (consumed − (consumed − headerH) = headerH)
      //   Clamped: = consumed − maxScroll  (browser hit the bottom)
      const actualScroll = el.scrollTop;
      const startOffset  = consumed - actualScroll;
      const captureH     = Math.min(viewHeight - startOffset, totalHeight - consumed);

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

      if (consumed >= totalHeight) break;

      showBadge(`Capturing strip ${stripIdx + 1}…`);
    }

    el.scrollTop = origScroll;
    hideBadge();

    return stitchStrips(strips, captureRect.width, totalHeight, dpr);
  }

  // ── Scrollable element capture (thin wrapper) ─────────────────────────────
  async function captureScrollableAndStitch(el) {
    const rect = el.getBoundingClientRect();
    return scrollAndStitch(
      el,
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      el.scrollHeight,
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
    const el = document.documentElement;
    return scrollAndStitch(
      el,
      { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight },
      el.scrollHeight,
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
  function sendMessage(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
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
