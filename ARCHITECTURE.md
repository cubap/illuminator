# Architecture

Illuminator follows a strict three-layer browser extension architecture in which each layer has a clearly bounded responsibility.

---

## Overview

```
┌──────────────────────────────────────────────────────────┐
│  Extension Popup (src/popup/)                            │
│  • Owns all user interaction                             │
│  • Drives scanning via chrome.scripting.executeScript    │
│  • Renders detection results + stash                     │
│  • Sends highlight messages to content scripts           │
└────────────┬─────────────────────────┬───────────────────┘
             │ chrome.runtime.sendMessage │ chrome.tabs.sendMessage
             ▼                           ▼
┌────────────────────────┐   ┌──────────────────────────────┐
│  Background Worker     │   │  Content Scripts             │
│  (src/background/)     │   │  (src/content/)              │
│  • Manages stash       │   │  • highlighter.js (passive)  │
│  • chrome.storage.local│   │  • scanner-bundle.js (active)│
│  • Routes highlights   │   │    injected on user scan     │
└────────────────────────┘   └──────────────────────────────┘
```

---

## Layer: Content Scripts

### `highlighter.js`

- **Loaded passively** on every page (declared in `manifest.json`).
- Does **nothing** until it receives a `HIGHLIGHT` or `CLEAR_HIGHLIGHT` message from the popup.
- Positions a `position:fixed` overlay over the target element.
- The overlay is:
  - `pointer-events: none` – cannot intercept clicks
  - Removed on `CLEAR_HIGHLIGHT` or popup close
  - Never permanently modifies the DOM

### `scanner-bundle.js`

- **Injected on demand** via `chrome.scripting.executeScript` when the user clicks **Scan Page**.
- A self-contained IIFE (no imports) containing all detection logic.
- Runs synchronously, returns an array of `ResourceRecord` objects as the script result.
- Also stores results in `window.__illuminatorLastScan` for debugging.
- **Never** persists data.

### `scanner.js` (ES module source)

- The authoritative ES module source for the scanner logic.
- Used by unit tests (`tests/scanner.test.js`).
- Not loaded by the extension at runtime (the bundle is used instead).

---

## Layer: Extension Popup (`src/popup/`)

- `popup.html` / `popup.css` / `popup.js`
- Opens when the user clicks the Illuminator toolbar icon.
- **Scan flow:**
  1. User clicks **Scan Page**.
  2. Popup calls `chrome.scripting.executeScript({ files: ['src/content/scanner-bundle.js'] })`.
  3. The bundle runs in the page, returns detected `ResourceRecord[]`.
  4. Popup renders resource cards.
- **Stash flow:**
  - User clicks **Save** on a resource card.
  - Popup sends `ADD_TO_STASH` message to the background worker.
  - Background worker saves to `chrome.storage.local` and returns the updated stash.
- **Highlight flow:**
  - User hovers a resource card.
  - Popup sends `HIGHLIGHT` message directly to the active tab's content script.
  - Content script positions an overlay over the matched element.
  - On `mouseleave`, popup sends `CLEAR_HIGHLIGHT`.

---

## Layer: Background Service Worker (`src/background/service-worker.js`)

- Manages the persistent stash using `chrome.storage.local`.
- Handles messages: `GET_STASH`, `ADD_TO_STASH`, `REMOVE_FROM_STASH`, `UPDATE_STASH_RECORD`, `CLEAR_STASH`.
- Also forwards `HIGHLIGHT` / `CLEAR_HIGHLIGHT` messages to the active tab (fallback path).
- **Never** initiates any page scan or crawling.

---

## Data Flow

```
User clicks "Scan Page"
  → popup.js
    → chrome.scripting.executeScript (scanner-bundle.js)
      → page DOM inspection
      → returns ResourceRecord[]
    → renders detection cards

User clicks "Save"
  → popup.js
    → chrome.runtime.sendMessage(ADD_TO_STASH, record)
      → service-worker.js
        → chrome.storage.local.set(stash)
      → returns updated stash
    → re-renders stash section

User hovers detection card
  → popup.js
    → chrome.tabs.sendMessage(HIGHLIGHT, selector)
      → highlighter.js
        → positions overlay on page element
```

---

## Privacy and Trust

- No data leaves the browser without explicit user action.
- `chrome.storage.local` is used (not `storage.sync`); data never leaves the device by default.
- No external requests are made by the extension itself.
- Detected resources are ephemeral unless the user chooses to stash them.

---

## Extension Permissions

| Permission | Reason |
|-----------|--------|
| `storage` | Persist the user's stash in `chrome.storage.local` |
| `activeTab` | Read the current tab URL; send messages to content scripts |
| `scripting` | Inject `scanner-bundle.js` on user-initiated scan |
