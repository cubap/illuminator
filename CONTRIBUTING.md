# Contributing to Illuminator

Thank you for your interest in contributing. Please read this document before opening a pull request.

---

## Scope

Illuminator is a **discovery and preparation assistant**, not:

- A full IIIF viewer
- A crawler or scraper
- A manifest authoring environment
- A background data collection tool

Contributions should advance one of these goals:

- Improving resource detection accuracy or coverage
- Improving the popup UI / UX
- Adding support for downstream integrations (TPEN, RERUM, viewers)
- Improving test coverage
- Fixing bugs

If you're unsure whether a change fits, open an issue first.

---

## Design Guardrails

Before submitting a PR, confirm your changes satisfy all of these:

- [ ] **No passive scanning.** The extension does nothing on a page until the user explicitly clicks Scan Page.
- [ ] **No background crawling.** The service worker only responds to user-initiated messages.
- [ ] **No DOM persistence.** Content scripts must not permanently modify page structure.
- [ ] **No automatic network writes.** No data is transmitted to any external service without explicit user action.
- [ ] **User can explain the output.** If a user can't understand why a resource was detected, the detection is too opaque. Add confidence indicators and `detectedVia` metadata.
- [ ] **Highlighting fails silently.** Any error in the highlighting path must be caught and suppressed.

---

## Development Setup

```bash
git clone https://github.com/cubap/illuminator.git
cd illuminator
npm install
npm test
```

---

## Code Style

- Vanilla JavaScript (no framework, no build step required for the extension itself)
- ES modules (`import`/`export`) in source files
- The `scanner-bundle.js` is a plain IIFE (no imports) — it must remain buildless
- Keep detection logic in `src/content/scanner.js` (ES module) and mirror changes to `src/content/scanner-bundle.js`
- JSDoc comments on all exported functions

---

## Adding a New Detector

1. Add the detection function in `src/content/scanner.js`.
2. Mirror the function in `src/content/scanner-bundle.js` (the IIFE bundle).
3. Add the function call inside `scanPage()` in both files.
4. Write tests in `tests/scanner.test.js`.
5. Document the new detection category in `RESOURCE_MODEL.md` if it introduces a new pattern.

---

## Testing

Tests use [Jest](https://jestjs.io/) with `jest-environment-jsdom`.

```bash
npm test
```

- `tests/resource.test.js` – ResourceRecord model
- `tests/scanner.test.js` – Detection logic
- `tests/stash.test.js` – Stash operations

**All tests must pass before opening a PR.**

---

## Commit Messages

Use conventional commit style:

```
feat: detect IIIF manifests from data-* attributes
fix: ignore data URI images in renderable image detector
docs: update RESOURCE_MODEL with context.foundIn field
test: add test for duplicate URL deduplication
```

---

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Changes reflect the design guardrails above
- [ ] `scanner-bundle.js` is in sync with `scanner.js` (if detection logic changed)
- [ ] Documentation updated if new detection categories or resource fields are introduced
- [ ] No new external dependencies without discussion
