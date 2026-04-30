/**
 * scanner.js – Content-script module for detecting IIIF and image resources on a page.
 *
 * Executed only when the user explicitly invokes a scan via the Illuminator popup.
 * Never persists data. Returns an array of raw detection hits for the popup to process.
 *
 * Detection categories:
 *   1. Explicit IIIF Resources   – manifests, embedded viewers, structured metadata
 *   2. IIIF-Likely Images        – Image API URL patterns, info.json links
 *   3. Renderable Images         – High-res <img> elements on the page
 *   4. Metadata-Described        – <meta>/<link> image refs, JSON-LD ImageObject
 */

/* eslint-env browser */

import { createResourceRecord, ResourceType, Confidence, DetectedVia } from '../models/resource.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** IIIF Image API path segment pattern: /{region}/{size}/{rotation}/{quality}.{format} */
const IIIF_IMAGE_API_RE = /\/(?:full|square|pct:\d+(?:,\d+)*(?:,\d+)*(?:,\d+)*|\d+,\d*,\d*,\d*)\/(?:full|max|\d+,|,\d+|\d+,\d+|pct:\d+)\/[0-9]+\/(?:default|native|color|gray|bitonal)\.(?:jpg|jpeg|tif|tiff|png|gif|jp2|pdf|webp)/i;

/** Matches a bare IIIF base URI ending in an identifier (heuristic). */
const IIIF_INFO_JSON_RE = /\/info\.json(?:[?#].*)?$/i;

/** Common IIIF viewer iframe src patterns */
const IIIF_VIEWER_RE = /(?:universalviewer|mirador|openseadragon|tify|leaflet-iiif)/i;

/**
 * Return the active page URL, falling back to empty string if unavailable.
 * @returns {string}
 */
function getSourcePage() {
  return (typeof location !== 'undefined' && location.href) ? location.href : '';
}

/**
 * Try to resolve a potentially relative URL against the current page.
 * @param {string} url
 * @returns {string}
 */
function resolveUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, location.href).href;
  } catch (_) {
    return url;
  }
}

/**
 * Derive a short human-readable label from a URL.
 * @param {string} url
 * @returns {string}
 */
function labelFromUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || u.hostname);
  } catch (_) {
    return url;
  }
}

// ---------------------------------------------------------------------------
// 1. Explicit IIIF Resources
// ---------------------------------------------------------------------------

/**
 * Detect IIIF Presentation API manifests linked from <link> elements or data attributes.
 * @returns {object[]}
 */
function detectLinkedManifests() {
  const hits = [];

  // <link rel="related" type="application/ld+json" href="...">
  // <link rel="alternate" type="application/ld+json" href="...">
  document.querySelectorAll('link[rel]').forEach((el) => {
    const rel = (el.rel || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const href = el.getAttribute('href') || '';
    if (!href) return;

    const isManifestType = type.includes('ld+json') || type.includes('manifest');
    const isManifestRel = ['related', 'alternate', 'describedby'].includes(rel);
    const looksLikeManifest = href.includes('manifest') || href.includes('iiif');

    if ((isManifestType && isManifestRel) || looksLikeManifest) {
      const url = resolveUrl(href);
      hits.push({
        resourceType: ResourceType.MANIFEST,
        resourceUrl: url,
        label: el.title || labelFromUrl(url),
        confidence: isManifestType ? Confidence.EXPLICIT : Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'link', rel, type },
      });
    }
  });

  // data-iiif-manifest attributes anywhere on the page
  document.querySelectorAll('[data-iiif-manifest]').forEach((el) => {
    const href = el.getAttribute('data-iiif-manifest');
    if (!href) return;
    const url = resolveUrl(href);
    hits.push({
      resourceType: ResourceType.MANIFEST,
      resourceUrl: url,
      label: el.title || el.getAttribute('aria-label') || labelFromUrl(url),
      confidence: Confidence.EXPLICIT,
      detectedVia: DetectedVia.DOM,
      context: { selector: el.tagName.toLowerCase(), attribute: 'data-iiif-manifest' },
    });
  });

  return hits;
}

/**
 * Detect IIIF manifest URLs and ImageObject descriptions in inline JSON-LD.
 * @returns {object[]}
 */
function detectJsonLd() {
  const hits = [];

  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch (_) {
      return;
    }

    const items = Array.isArray(data) ? data : [data];
    items.forEach((item) => {
      const ctx = item['@context'] || '';
      const type = item['@type'] || '';
      const ctxStr = Array.isArray(ctx) ? ctx.join(' ') : String(ctx);

      // IIIF Presentation v2 / v3
      if (
        ctxStr.includes('//iiif.io/') ||
        type === 'sc:Manifest' ||
        type === 'Manifest'
      ) {
        const url = item.id || item['@id'] || null;
        hits.push({
          resourceType: ResourceType.MANIFEST,
          resourceUrl: url ? resolveUrl(url) : null,
          label: extractLabel(item.label) || labelFromUrl(url),
          confidence: Confidence.EXPLICIT,
          detectedVia: DetectedVia.METADATA,
          context: { '@type': type, '@context': ctxStr.slice(0, 200) },
        });
      }

      // Schema.org ImageObject
      if (type === 'ImageObject' || type === 'schema:ImageObject') {
        const url = item.contentUrl || item.url || null;
        if (url) {
          hits.push({
            resourceType: ResourceType.IMAGE,
            resourceUrl: resolveUrl(url),
            label: item.name || item.description || labelFromUrl(url),
            confidence: Confidence.INFERRED,
            detectedVia: DetectedVia.METADATA,
            context: { '@type': type, width: item.width, height: item.height },
          });
        }
      }
    });
  });

  return hits;
}

/**
 * Detect IIIF viewer iframes (UniversalViewer, Mirador, etc.).
 * @returns {object[]}
 */
function detectViewerIframes() {
  const hits = [];

  document.querySelectorAll('iframe[src]').forEach((iframe) => {
    const src = iframe.getAttribute('src') || '';
    if (!src) return;

    const resolvedSrc = resolveUrl(src);

    if (IIIF_VIEWER_RE.test(src)) {
      // Try to extract a manifest param from the URL
      let manifestUrl = null;
      try {
        const u = new URL(resolvedSrc);
        manifestUrl =
          u.searchParams.get('manifest') ||
          u.searchParams.get('manifestId') ||
          u.hash.match(/manifest=([^&]+)/)?.[1] ||
          null;
        if (manifestUrl) manifestUrl = decodeURIComponent(manifestUrl);
      } catch (_) {}

      hits.push({
        resourceType: ResourceType.MANIFEST,
        resourceUrl: manifestUrl || resolvedSrc,
        label: iframe.title || 'IIIF Viewer',
        confidence: manifestUrl ? Confidence.EXPLICIT : Confidence.INFERRED,
        detectedVia: DetectedVia.DOM,
        context: {
          selector: 'iframe',
          viewerSrc: resolvedSrc,
          width: iframe.width,
          height: iframe.height,
        },
      });
    }
  });

  return hits;
}

// ---------------------------------------------------------------------------
// 2. IIIF-Likely Images
// ---------------------------------------------------------------------------

/**
 * Detect images whose src matches the IIIF Image API path pattern.
 * @returns {object[]}
 */
function detectIiifImageApiUrls() {
  const hits = [];
  const seen = new Set();

  const check = (rawUrl, context) => {
    if (!rawUrl) return;
    const url = resolveUrl(rawUrl);
    if (seen.has(url)) return;

    if (IIIF_IMAGE_API_RE.test(url)) {
      seen.add(url);
      // Derive the base (service) URL by stripping the Image API suffix
      const baseUrl = url.replace(IIIF_IMAGE_API_RE, '');
      hits.push({
        resourceType: ResourceType.IIIF_IMAGE,
        resourceUrl: url,
        label: labelFromUrl(url),
        confidence: Confidence.EXPLICIT,
        detectedVia: DetectedVia.DOM,
        context: { ...context, iiifServiceBase: baseUrl },
      });
    } else if (IIIF_INFO_JSON_RE.test(url)) {
      seen.add(url);
      hits.push({
        resourceType: ResourceType.IIIF_IMAGE,
        resourceUrl: url,
        label: labelFromUrl(url),
        confidence: Confidence.EXPLICIT,
        detectedVia: DetectedVia.DOM,
        context,
      });
    }
  };

  document.querySelectorAll('img[src]').forEach((img) => {
    check(img.getAttribute('src'), {
      selector: buildSelector(img),
      alt: img.alt || '',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    });
  });

  // OpenSeadragon and similar viewers store source in data attributes
  document.querySelectorAll('[data-src],[data-image-src],[data-tile-source]').forEach((el) => {
    const attr = el.getAttribute('data-src') || el.getAttribute('data-image-src') || el.getAttribute('data-tile-source');
    check(attr, { selector: el.tagName.toLowerCase(), attribute: 'data-*' });
  });

  return hits;
}

/**
 * Scan all text nodes and attribute values for info.json references.
 * @returns {object[]}
 */
function detectInfoJsonInText() {
  const hits = [];
  const seen = new Set();

  // Script tags may contain viewer config with IIIF URLs
  document.querySelectorAll('script:not([src]):not([type="application/ld+json"])').forEach((script) => {
    const matches = script.textContent.matchAll(/"(https?:\/\/[^"]+\/info\.json)"/g);
    for (const [, url] of matches) {
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({
        resourceType: ResourceType.IIIF_IMAGE,
        resourceUrl: url,
        label: labelFromUrl(url),
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.TEXT_SCAN,
        context: { foundIn: 'script-text' },
      });
    }
  });

  return hits;
}

// ---------------------------------------------------------------------------
// 3. Renderable Images
// ---------------------------------------------------------------------------

/** Minimum dimension (px) for an image to be considered "high-resolution". */
const MIN_IMAGE_DIMENSION = 400;

/**
 * Detect large <img> elements currently rendered on the page.
 * @returns {object[]}
 */
function detectRenderableImages() {
  const hits = [];
  const seen = new Set();

  document.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;

    // Skip inline data URIs
    if (src.startsWith('data:')) return;

    const url = resolveUrl(src);
    if (seen.has(url)) return;

    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;

    if (w >= MIN_IMAGE_DIMENSION || h >= MIN_IMAGE_DIMENSION) {
      seen.add(url);
      hits.push({
        resourceType: ResourceType.IMAGE,
        resourceUrl: url,
        label: img.alt || img.title || labelFromUrl(url),
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.DOM,
        context: {
          selector: buildSelector(img),
          alt: img.alt || '',
          width: w,
          height: h,
        },
      });
    }
  });

  return hits;
}

// ---------------------------------------------------------------------------
// 4. Metadata-Described Resources
// ---------------------------------------------------------------------------

/**
 * Detect Open Graph / Twitter Card / Dublin Core image metadata.
 * @returns {object[]}
 */
function detectMetaTags() {
  const hits = [];

  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const url = resolveUrl(ogImage.getAttribute('content') || '');
    if (url) {
      hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: url,
        label: 'Open Graph image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'meta[property="og:image"]' },
      });
    }
  }

  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage) {
    const url = resolveUrl(twitterImage.getAttribute('content') || '');
    if (url) {
      hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: url,
        label: 'Twitter Card image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'meta[name="twitter:image"]' },
      });
    }
  }

  // <link rel="image_src">
  document.querySelectorAll('link[rel="image_src"]').forEach((link) => {
    const url = resolveUrl(link.getAttribute('href') || '');
    if (url) {
      hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: url,
        label: 'Linked image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'link[rel="image_src"]' },
      });
    }
  });

  return hits;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract a plain string label from a IIIF Presentation API label value
 * (which may be a string, array, or language map).
 * @param {*} label
 * @returns {string}
 */
function extractLabel(label) {
  if (!label) return '';
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return extractLabel(label[0]);
  // IIIF v3 language map: { "en": ["Title"] }
  if (typeof label === 'object') {
    const first = Object.values(label)[0];
    return extractLabel(first);
  }
  return String(label);
}

/**
 * Build a CSS-like selector string to locate an element for highlighting.
 * @param {Element} el
 * @returns {string}
 */
function buildSelector(el) {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList).slice(0, 2).join('.');
  return cls ? `${tag}.${cls}` : tag;
}

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

/**
 * Remove duplicate hits sharing the same resourceUrl.
 * Keeps the hit with the highest confidence.
 * @param {object[]} hits
 * @returns {object[]}
 */
function deduplicateHits(hits) {
  const CONFIDENCE_RANK = {
    [Confidence.EXPLICIT]: 2,
    [Confidence.INFERRED]: 1,
    [Confidence.SPECULATIVE]: 0,
  };
  const byUrl = new Map();

  hits.forEach((hit) => {
    const key = hit.resourceUrl || `${hit.resourceType}::${JSON.stringify(hit.context)}`;
    const existing = byUrl.get(key);
    if (!existing || CONFIDENCE_RANK[hit.confidence] > CONFIDENCE_RANK[existing.confidence]) {
      byUrl.set(key, hit);
    }
  });

  return Array.from(byUrl.values());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the current page for IIIF and image resources.
 * Called by the popup via chrome.scripting.executeScript.
 *
 * @returns {ResourceRecord[]} Detected resource records
 */
export function scanPage() {
  const sourcePage = getSourcePage();

  const rawHits = [
    ...detectLinkedManifests(),
    ...detectJsonLd(),
    ...detectViewerIframes(),
    ...detectIiifImageApiUrls(),
    ...detectInfoJsonInText(),
    ...detectRenderableImages(),
    ...detectMetaTags(),
  ];

  const uniqueHits = deduplicateHits(rawHits);

  return uniqueHits.map((hit) =>
    createResourceRecord({ sourcePage, ...hit })
  );
}

// When executed as a plain script (not as an ES module) in the page context,
// expose scanPage on a well-known global so the popup can retrieve results
// via chrome.scripting.executeScript's return value.
if (typeof module === 'undefined' && typeof window !== 'undefined') {
  window.__illuminatorScan = scanPage;
}
