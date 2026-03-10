// ChromeScroller — content script
// Injection guard: version string prevents double-setup AND ensures a fresh
// injection after an extension reload always runs (old version ≠ new version).
const _CS_VER = 'v10';
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

  // Find all fixed/sticky header elements that overlap the top of captureRect.
  // position:fixed  → searched document-wide (they can live anywhere in the DOM)
  // position:sticky → searched inside `el` only (must scroll with `el`)
  function findHeaderElements(el, captureRect) {
    const elScroller = (el === document.documentElement || el === document.body)
      ? PAGE_SCROLLER : el;
    const found = new Set();

    document.querySelectorAll('*').forEach(node => {
      if (!isTopOverlayCandidate(node, captureRect)) return;
      if (window.getComputedStyle(node).position !== 'fixed') return;
      const r = node.getBoundingClientRect();
      if (r.top > captureRect.top + 5) return; // must be anchored at very top
      found.add(node);
    });

    el.querySelectorAll('*').forEach(node => {
      if (!isTopOverlayCandidate(node, captureRect)) return;
      const style = window.getComputedStyle(node);
      if (style.position !== 'sticky') return;
      if (getScrollContainer(node.parentElement) !== elScroller) return;
      const topVal = parseFloat(style.top) || 0;
      if (topVal < 0 || topVal > captureRect.height * 0.3) return;
      const r = node.getBoundingClientRect();
      // At scrollTop=0 a true top-sticky sits at captureRect.top+topVal (±10 px).
      // Mid-content section headers are further down — exclude them.
      if (r.top > captureRect.top + topVal + 10) return;
      found.add(node);
    });

    return [...found];
  }

  // Set display:none on every detected header (removes it from layout so it
  // cannot cover content rows in screenshots and scrollHeight shrinks correctly).
  // Returns a save-list for restoreHeaders().
  function hideHeaders(el, captureRect) {
    return findHeaderElements(el, captureRect).map(node => {
      const saved = node.style.display;
      node.style.setProperty('display', 'none', 'important');
      return { node, saved };
    });
  }

  // Undo hideHeaders() — restore each element's original display value.
  function restoreHeaders(savedList) {
    savedList.forEach(({ node, saved }) => {
      if (saved) node.style.display = saved;
      else node.style.removeProperty('display');
    });
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
