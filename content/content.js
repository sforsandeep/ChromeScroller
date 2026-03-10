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
  let isActive      = false;
  let currentTarget = null;
  let mouseX        = 0;
  let mouseY        = 0;
  let highlightEl   = null;
  let cursorStyleEl = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isScrollable(el) {
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

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('wheel',     onWheel,     { capture: true, passive: false });
    document.addEventListener('click',     onClick,     true);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    document.body.classList.remove('chromescroller-active');

    if (cursorStyleEl) { cursorStyleEl.remove(); cursorStyleEl = null; }
    if (highlightEl)   { highlightEl.remove();   highlightEl   = null; }

    const spinner = document.getElementById('chromescroller-spinner');
    if (spinner) spinner.remove();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('wheel',     onWheel,     { capture: true, passive: false });
    document.removeEventListener('click',     onClick,     true);

    currentTarget = null;
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
  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // elementFromPoint passes through pointer-events:none overlay automatically
    const el = document.elementFromPoint(mouseX, mouseY);
    if (el && el !== highlightEl) {
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
        setHighlight(parent);
      }
    } else {
      // Scroll DOWN → deepest element at current cursor position
      const el = document.elementFromPoint(mouseX, mouseY);
      if (el && el !== highlightEl) {
        setHighlight(el);
      }
    }
  }
  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentTarget || !isActive) return;

    const el = currentTarget;
    const spinner = showSpinner();

    try {
      const dataUrl = isScrollable(el)
        ? await captureScrollableAndStitch(el)   // commit 6
        : await captureVisible(el);

      const filename = buildFilename();
      await sendMessage({ action: 'DOWNLOAD_IMAGE', dataUrl, filename });
    } catch (err) {
      console.error('[ChromeScroller] Capture error:', err);
    } finally {
      hideSpinner(spinner);
    }
  }

  // ── Spinner (busy state during capture) ──────────────────────────────────
  function showSpinner() {
    // Hide cursor + overlay so they don't appear in the screenshot
    if (cursorStyleEl) cursorStyleEl.disabled = true;
    if (highlightEl)   highlightEl.style.display = 'none';

    const spinner = document.createElement('div');
    spinner.id = 'chromescroller-spinner';
    spinner.innerHTML = `
      <div class="chromescroller-spinner-inner">
        <div class="chromescroller-spinner-ring"></div>
        <span>Capturing...</span>
      </div>
    `;
    document.body.appendChild(spinner);
    return spinner;
  }

  function hideSpinner(spinner) {
    if (spinner && spinner.parentNode) spinner.remove();
    if (cursorStyleEl) cursorStyleEl.disabled = false;
    if (highlightEl && currentTarget) highlightEl.style.display = 'block';
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

  // captureScrollableAndStitch added in commit 6
  async function captureScrollableAndStitch(el) {
    return captureVisible(el); // temporary fallback — replaced in commit 6
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
    }
    return false;
  });
}
