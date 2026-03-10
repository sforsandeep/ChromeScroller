document.addEventListener('DOMContentLoaded', async () => {
  const btn        = document.getElementById('toggleBtn');
  const statusDot  = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Not available on chrome:// or extension pages
  if (!tab || !tab.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:')) {
    btn.disabled = true;
    statusText.textContent = 'Not available on this page';
    return;
  }

  // Ask content script for current state (may not be injected yet)
  let active = false;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' });
    active = resp?.active ?? false;
  } catch {
    active = false;
  }

  updateUI(active);
  btn.disabled = false;

  btn.addEventListener('click', async () => {
    btn.disabled = true;

    try {
      if (!active) {
        // Inject CSS first, then JS (JS sets up the message listener)
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files:  ['content/content.css']
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files:  ['content/content.js']
        });
        // Short pause so the injected listener is registered before we message
        await new Promise(r => setTimeout(r, 60));
        await chrome.tabs.sendMessage(tab.id, { action: 'ACTIVATE' });
        active = true;
      } else {
        await chrome.tabs.sendMessage(tab.id, { action: 'DEACTIVATE' });
        active = false;
      }
    } catch (err) {
      console.error('[ChromeScroller popup]', err);
    }

    updateUI(active);
    btn.disabled = false;
    window.close(); // Close popup so user can interact with the page
  });

  function updateUI(isActive) {
    if (isActive) {
      btn.textContent       = 'Stop Capture Mode';
      btn.className         = 'btn btn-stop';
      statusDot.className   = 'status-dot active';
      statusText.textContent = 'Active — click any element';
    } else {
      btn.textContent       = 'Start Capture Mode';
      btn.className         = 'btn btn-start';
      statusDot.className   = 'status-dot';
      statusText.textContent = 'Inactive';
    }
  }
});
