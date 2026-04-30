/**
 * tests/scanner.test.js – Unit tests for page scanning / resource detection.
 *
 * We test the detection helpers by setting up minimal jsdom HTML and running
 * the scanner module (ES module version) against it.
 */

import { scanPage } from '../src/content/scanner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setDocumentBody(html) {
  document.body.innerHTML = html;
}

function setHead(html) {
  document.head.innerHTML = html;
}

// jsdom doesn't fully implement location; provide a fake
Object.defineProperty(window, 'location', {
  value: { href: 'https://example.com/page' },
  writable: true,
});

// ---------------------------------------------------------------------------
// IIIF manifest detection via <link>
// ---------------------------------------------------------------------------

describe('detectLinkedManifests', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('detects a manifest link with type application/ld+json', () => {
    setHead('<link rel="related" type="application/ld+json" href="https://example.com/manifest.json" />');
    const results = scanPage();
    const manifests = results.filter((r) => r.resourceType === 'manifest');
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].resourceUrl).toBe('https://example.com/manifest.json');
    expect(manifests[0].confidence).toBe('explicit');
    expect(manifests[0].detectedVia).toBe('metadata');
  });

  test('detects a link whose href contains "manifest"', () => {
    setHead('<link rel="alternate" href="https://example.com/iiif/manifest" />');
    const results = scanPage();
    const manifests = results.filter((r) => r.resourceType === 'manifest');
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].resourceUrl).toBe('https://example.com/iiif/manifest');
  });

  test('detects data-iiif-manifest attribute', () => {
    setDocumentBody('<div data-iiif-manifest="https://example.com/iiif/manifest.json">Viewer</div>');
    const results = scanPage();
    const manifests = results.filter(
      (r) => r.resourceType === 'manifest' && r.resourceUrl === 'https://example.com/iiif/manifest.json'
    );
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].confidence).toBe('explicit');
    expect(manifests[0].detectedVia).toBe('dom');
  });
});

// ---------------------------------------------------------------------------
// JSON-LD detection
// ---------------------------------------------------------------------------

describe('detectJsonLd', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('detects a IIIF v2 manifest in JSON-LD', () => {
    const ld = JSON.stringify({
      '@context': 'http://iiif.io/api/presentation/2/context.json',
      '@type': 'sc:Manifest',
      '@id': 'https://example.com/iiif/manifest.json',
      label: 'Test Manuscript',
    });
    setHead(`<script type="application/ld+json">${ld}</script>`);
    const results = scanPage();
    const manifests = results.filter((r) => r.resourceType === 'manifest');
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].confidence).toBe('explicit');
    expect(manifests[0].label).toBe('Test Manuscript');
  });

  test('detects a IIIF v3 manifest in JSON-LD', () => {
    const ld = JSON.stringify({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      type: 'Manifest',
      id: 'https://example.com/iiif/v3/manifest.json',
      label: { en: ['My Codex'] },
    });
    setHead(`<script type="application/ld+json">${ld}</script>`);
    const results = scanPage();
    const manifests = results.filter((r) => r.resourceType === 'manifest');
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].label).toBe('My Codex');
  });

  test('detects schema:ImageObject in JSON-LD', () => {
    const ld = JSON.stringify({
      '@type': 'ImageObject',
      contentUrl: 'https://example.com/image.jpg',
      name: 'Photo of item',
    });
    setHead(`<script type="application/ld+json">${ld}</script>`);
    const results = scanPage();
    const images = results.filter((r) => r.resourceType === 'image');
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0].resourceUrl).toBe('https://example.com/image.jpg');
    expect(images[0].label).toBe('Photo of item');
  });

  test('ignores invalid JSON-LD gracefully', () => {
    setHead('<script type="application/ld+json">{ invalid json }</script>');
    expect(() => scanPage()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// IIIF Image API URL detection
// ---------------------------------------------------------------------------

describe('detectIiifImageApiUrls', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('detects info.json link in img src', () => {
    // info.json at end of src
    setDocumentBody('<img src="https://iiif.example.com/images/photo/info.json" />');
    const results = scanPage();
    const iiifImages = results.filter((r) => r.resourceType === 'iiif-image');
    expect(iiifImages.length).toBeGreaterThanOrEqual(1);
    expect(iiifImages[0].confidence).toBe('explicit');
  });

  test('detects IIIF Image API URL pattern in img src', () => {
    setDocumentBody(
      '<img src="https://iiif.example.com/images/photo/full/max/0/default.jpg" width="800" height="600" />'
    );
    const results = scanPage();
    const iiifImages = results.filter((r) => r.resourceType === 'iiif-image');
    expect(iiifImages.length).toBeGreaterThanOrEqual(1);
  });

  test('detects info.json URL found in inline script text', () => {
    setDocumentBody(
      '<script>var tile = "https://iiif.example.com/images/ms/info.json";</script>'
    );
    const results = scanPage();
    const iiifImages = results.filter(
      (r) => r.resourceType === 'iiif-image' && r.detectedVia === 'text-scan'
    );
    expect(iiifImages.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Renderable image detection
// ---------------------------------------------------------------------------

describe('detectRenderableImages', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('detects a large img element', () => {
    setDocumentBody('<img src="https://example.com/large.jpg" width="800" height="600" alt="Large image" />');
    const img = document.querySelector('img');
    // jsdom doesn't render, so set naturalWidth/Height via mock
    Object.defineProperty(img, 'naturalWidth', { value: 800, writable: false });
    Object.defineProperty(img, 'naturalHeight', { value: 600, writable: false });

    const results = scanPage();
    // The img has both width attr = 800 so it qualifies even without natural dims
    const images = results.filter(
      (r) => r.resourceType === 'image' && r.resourceUrl === 'https://example.com/large.jpg'
    );
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0].label).toBe('Large image');
    expect(images[0].detectedVia).toBe('dom');
  });

  test('ignores small images', () => {
    setDocumentBody('<img src="https://example.com/icon.png" width="16" height="16" />');
    const results = scanPage();
    const small = results.filter(
      (r) => r.resourceUrl === 'https://example.com/icon.png'
    );
    expect(small.length).toBe(0);
  });

  test('ignores data URI images', () => {
    setDocumentBody('<img src="data:image/gif;base64,R0lGOD" width="800" />');
    const results = scanPage();
    const dataImages = results.filter(
      (r) => r.resourceUrl && r.resourceUrl.startsWith('data:')
    );
    expect(dataImages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Meta tag detection
// ---------------------------------------------------------------------------

describe('detectMetaTags', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('detects og:image meta tag', () => {
    setHead('<meta property="og:image" content="https://example.com/og-image.jpg" />');
    const results = scanPage();
    const meta = results.filter((r) => r.resourceType === 'metadata');
    expect(meta.length).toBeGreaterThanOrEqual(1);
    expect(meta[0].resourceUrl).toBe('https://example.com/og-image.jpg');
    expect(meta[0].label).toBe('Open Graph image');
  });

  test('detects twitter:image meta tag', () => {
    setHead('<meta name="twitter:image" content="https://example.com/twitter-img.jpg" />');
    const results = scanPage();
    const meta = results.filter(
      (r) => r.resourceType === 'metadata' && r.label === 'Twitter Card image'
    );
    expect(meta.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

describe('deduplication', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('does not return duplicate URLs', () => {
    // Same manifest URL appearing in two places
    setHead(`
      <link rel="alternate" href="https://example.com/iiif/manifest" />
      <script type="application/ld+json">
        {"@context":"http://iiif.io/api/presentation/2/context.json","@type":"sc:Manifest","@id":"https://example.com/iiif/manifest"}
      </script>
    `);
    const results = scanPage();
    const urls = results.map((r) => r.resourceUrl);
    const unique = new Set(urls.filter(Boolean));
    expect(urls.filter(Boolean).length).toBe(unique.size);
  });
});

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

describe('record shape', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('every returned record has required fields', () => {
    setHead('<meta property="og:image" content="https://example.com/img.jpg" />');
    const results = scanPage();
    results.forEach((r) => {
      expect(r.id).toBeTruthy();
      expect(r.resourceType).toBeTruthy();
      expect(r.sourcePage).toBeTruthy();
      expect(r.confidence).toBeTruthy();
      expect(r.detectedVia).toBeTruthy();
      expect(r.createdAt).toBeTruthy();
      expect(r.updatedAt).toBeTruthy();
    });
  });

  test('sourcePage is the current location', () => {
    setHead('<meta property="og:image" content="https://example.com/img.jpg" />');
    const results = scanPage();
    results.forEach((r) => {
      expect(r.sourcePage).toBe('https://example.com/page');
    });
  });
});
