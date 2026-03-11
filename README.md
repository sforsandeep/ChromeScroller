# ChromeScroller

A Chrome extension (MV3) that turns your cursor into a precision DOM inspector and screenshot tool — with pixel-perfect full-height scroll-stitch capture.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/chromescroller?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/chromescroller)

---

## Features

- **Camera cursor** — hover over any element to highlight it
- **Scroll-wheel DOM navigation** — scroll up to select parent, scroll down to go deeper
- **Single-element screenshot** — click any non-scrollable element for an instant crop
- **Full scroll-stitch capture** — click a scrollable container to auto-scroll, capture every strip and stitch into one seamless full-height PNG
- **Sticky/fixed header detection** — headers are hidden during capture so they never repeat across strips
- **HiDPI / Retina aware** — uses `devicePixelRatio` for pixel-perfect output
- **Works on SPAs** — survives React/Vue reconciliation via CSS attribute hiding
- **Zero data collection** — 100% local, no servers, no analytics

---

## How it works

1. Click the **ChromeScroller** icon in your toolbar
2. A **camera cursor** appears — hover over any element on the page
3. Use the **scroll wheel** to navigate the DOM tree (up = parent, down = deeper child)
4. **Click** to capture:
   - Yellow highlight → single screenshot of that element
   - Blue highlight → full scroll-stitch capture of the scrollable container
5. The PNG is saved directly to your **Downloads** folder

---

## Installation

### From the Chrome Web Store
Search for **ChromeScroller** or visit the [Chrome Web Store listing](https://chromewebstore.google.com/detail/chromescroller).

### From source (developer mode)
```bash
git clone https://github.com/sforsandeep/ChromeScroller.git
```
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the cloned folder

---

## Project structure

```
ChromeScroller/
├── manifest.json          # MV3 manifest
├── background/
│   └── background.js      # Service worker — captureVisibleTab + downloads
├── content/
│   ├── content.js         # Camera cursor, highlight, scroll nav, stitch engine
│   └── content.css        # Highlight overlay + badge styles
├── popup/
│   ├── popup.html         # Start / Stop UI
│   ├── popup.js           # Injection logic
│   └── popup.css
├── icons/                 # Extension icons (16/32/48/128px)
├── docs/
│   └── privacy.html       # Privacy policy (hosted via GitHub Pages)
└── tools/
    └── generate-icons.py  # Icon generator (requires Pillow)
```

---

## Permissions

| Permission | Why |
|-----------|-----|
| `activeTab` | Inspect the page DOM and capture the visible tab |
| `scripting` | Inject the content script when the user activates the tool |
| `downloads` | Save the screenshot PNG to the user's Downloads folder |
| `tabs` | Call `captureVisibleTab()` from the background service worker |

---

## Privacy

ChromeScroller collects no data. Screenshots are saved locally to your device only. See the full [Privacy Policy](https://sforsandeep.github.io/ChromeScroller/privacy.html).

---

## Contributing

Pull requests are welcome! Please open against the `develop` branch, not `master`.

1. Fork the repo
2. Create your branch from `develop`: `git checkout -b feature/my-feature`
3. Commit your changes
4. Open a PR → `develop`

---

## License

MIT
