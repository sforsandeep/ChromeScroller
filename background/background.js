// ChromeScroller — background service worker
// Handles captureVisibleTab (content scripts cannot call this) and downloads.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'CAPTURE_VISIBLE_TAB':
      captureVisibleTab(sender.tab, sendResponse);
      return true; // keep channel open for async response

    case 'DOWNLOAD_IMAGE':
      downloadImage(msg.dataUrl, msg.filename, sendResponse);
      return true;

    case 'PING':
      // Content script pings before capture to ensure the service worker is
      // awake.  Receiving this message keeps the SW alive for the capture cycle.
      sendResponse({ ok: true });
      return false;
  }
});

async function captureVisibleTab(tab, sendResponse) {
  try {
    if (!tab) {
      sendResponse({ ok: false, error: 'No sender tab' });
      return;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: 'png' }
    );
    sendResponse({ ok: true, dataUrl });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function downloadImage(dataUrl, filename, sendResponse) {
  try {
    const downloadId = await chrome.downloads.download({
      url:      dataUrl,
      filename: filename,
      saveAs:   false
    });
    sendResponse({ ok: true, downloadId });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
