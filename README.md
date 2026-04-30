# Illuminator

**A user-initiated browser extension for discovering IIIF and image resources on the web and intentionally preparing them for scholarly work.**

---

## Philosophy

Illuminator is *resource-first, not manifest-first*. It surfaces explicit IIIF artifacts where they exist, but also discovers images, metadata, and inferred resources that could meaningfully become part of an annotation workflow.

**Core principles:**

| Principle | Meaning |
|-----------|---------|
| No passive surveillance | Pages are scanned only when the user explicitly clicks the extension icon. No background crawling, badges, or persistent DOM injection. |
| Resources before conclusions | Illuminator detects *opportunities*, not just finished IIIF artifacts. Manifests are respected, but never required. |
| User intent over automation | Users choose which resources to save ("stash") and when to act on them. Detection is ephemeral; storage is intentional. |
| Options, not lock-in | Illuminator offers workflows without assuming a single downstream tool. TPEN and RERUM integration is first-class but not exclusive. |

---

## Audience

- Digital humanities scholars
- GLAM (galleries, libraries, archives, museums) professionals
- Developers building IIIF workflows

---

## Quick Start

### Loading as an unpacked extension (development)

1. Clone this repository:
   ```bash
   git clone https://github.com/cubap/illuminator.git
   cd illuminator
   ```

2. Open **Chrome** (or any Chromium browser) and navigate to `chrome://extensions`.

3. Enable **Developer mode** (top-right toggle).

4. Click **Load unpacked** and select the root of this repository.

5. The Illuminator icon will appear in your toolbar.  
   Navigate to any page containing images or IIIF content, then click the icon to scan.

### Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the `manifest.json` file.

---

## What Illuminator detects

| Category | Examples | Confidence |
|----------|----------|-----------|
| **Explicit IIIF** | Manifest links in `<link>` tags, JSON-LD, `data-iiif-manifest` attributes | Explicit |
| **IIIF-Likely Images** | Image API URL patterns, `info.json` references | Explicit / Inferred |
| **Renderable Images** | Large `<img>` elements (≥ 400 px) | Inferred |
| **Metadata-Described** | `og:image`, `twitter:image`, `link[rel=image_src]` | Inferred |

---

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
npm install
```

### Run tests

```bash
npm test
```

---

## Project structure

```
illuminator/
├── manifest.json               # Extension manifest (MV3)
├── package.json
├── icons/                      # Extension icons
├── src/
│   ├── models/
│   │   └── resource.js         # Canonical ResourceRecord model
│   ├── content/
│   │   ├── scanner.js          # ES module scanner (source)
│   │   ├── scanner-bundle.js   # Self-contained scanner (injected at runtime)
│   │   └── highlighter.js      # Ephemeral element highlighting
│   ├── background/
│   │   └── service-worker.js   # Stash persistence, message routing
│   └── popup/
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
├── tests/
│   ├── resource.test.js
│   ├── scanner.test.js
│   └── stash.test.js
├── ARCHITECTURE.md
├── RESOURCE_MODEL.md
└── CONTRIBUTING.md
```

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) – System design and layer boundaries
- [RESOURCE_MODEL.md](./RESOURCE_MODEL.md) – Canonical record definitions
- [CONTRIBUTING.md](./CONTRIBUTING.md) – Scope, expectations, guardrails

---

## License

MIT
