/**
 * scanner-bundle.js – Self-contained page scanner injected via chrome.scripting.executeScript.
 *
 * This file intentionally duplicates logic from src/content/scanner.js and
 * src/models/resource.js to avoid a build step. It is the authoritative
 * runtime version executed in the page context.
 *
 * Returns an array of ResourceRecord objects and stores them in
 * window.__illuminatorLastScan for reference.
 */
/* eslint-env browser */
(function () {
  'use strict';

  // ── ResourceRecord helpers ──────────────────────────────────────────────

  const ResourceType = {
    MANIFEST: 'manifest',
    IIIF_IMAGE: 'iiif-image',
    IMAGE: 'image',
    METADATA: 'metadata',
    UNKNOWN: 'unknown',
  };

  const Confidence = {
    EXPLICIT: 'explicit',
    INFERRED: 'inferred',
    SPECULATIVE: 'speculative',
  };

  const DetectedVia = {
    TEXT_SCAN: 'text-scan',
    DOM: 'dom',
    METADATA: 'metadata',
    INFERENCE: 'inference',
  };

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  }

  function createResourceRecord(fields) {
    var now = new Date().toISOString();
    return {
      id: generateId(),
      resourceType: fields.resourceType,
      resourceUrl: fields.resourceUrl || null,
      sourcePage: fields.sourcePage,
      label: fields.label || '',
      confidence: fields.confidence,
      detectedVia: fields.detectedVia,
      context: fields.context || {},
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── URL helpers ─────────────────────────────────────────────────────────

  function getSourcePage() {
    return (typeof location !== 'undefined' && location.href) ? location.href : '';
  }

  function resolveUrl(url) {
    if (!url) return '';
    try { return new URL(url, location.href).href; } catch (_) { return url; }
  }

  function labelFromUrl(url) {
    if (!url) return '';
    try {
      var u = new URL(url);
      var parts = u.pathname.split('/').filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || u.hostname);
    } catch (_) { return url; }
  }

  function isIiifContext(ctxStr) {
    return ctxStr.split(/\s+/).some(function (token) {
      try {
        var u = new URL(token);
        return u.hostname === 'iiif.io' && u.pathname.startsWith('/api/');
      } catch (_) {
        return false;
      }
    });
  }

  function buildSelector(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase();
    var cls = Array.from(el.classList).slice(0, 2).join('.');
    return cls ? tag + '.' + cls : tag;
  }

  function extractLabel(label) {
    if (!label) return '';
    if (typeof label === 'string') return label;
    if (Array.isArray(label)) return extractLabel(label[0]);
    if (typeof label === 'object') {
      var first = Object.values(label)[0];
      return extractLabel(first);
    }
    return String(label);
  }

  // ── Patterns ────────────────────────────────────────────────────────────

  var IIIF_IMAGE_API_RE = /\/(?:full|square|pct:\d+,\d+,\d+,\d+|\d+,\d+,\d+,\d+)\/(?:full|max|\d+,|,\d+|\d+,\d+|pct:\d+)\/[0-9]+\/(?:default|native|color|gray|bitonal)\.(?:jpg|jpeg|tif|tiff|png|gif|jp2|pdf|webp)/i;
  var IIIF_INFO_JSON_RE = /\/info\.json(?:[?#].*)?$/i;
  var IIIF_VIEWER_RE = /(?:universalviewer|mirador|openseadragon|tify|leaflet-iiif)/i;
  var MIN_IMAGE_DIMENSION = 400;

  // ── Detectors ───────────────────────────────────────────────────────────

  function detectLinkedManifests() {
    var hits = [];

    document.querySelectorAll('link[rel]').forEach(function (el) {
      var rel = (el.rel || '').toLowerCase();
      var type = (el.type || '').toLowerCase();
      var href = el.getAttribute('href') || '';
      if (!href) return;

      var isManifestType = type.includes('ld+json') || type.includes('manifest');
      var isManifestRel = ['related', 'alternate', 'describedby'].includes(rel);
      var looksLikeManifest = href.includes('manifest') || href.includes('iiif');

      if ((isManifestType && isManifestRel) || looksLikeManifest) {
        var url = resolveUrl(href);
        hits.push({
          resourceType: ResourceType.MANIFEST,
          resourceUrl: url,
          label: el.title || labelFromUrl(url),
          confidence: isManifestType ? Confidence.EXPLICIT : Confidence.INFERRED,
          detectedVia: DetectedVia.METADATA,
          context: { selector: 'link', rel: rel, type: type },
        });
      }
    });

    document.querySelectorAll('[data-iiif-manifest]').forEach(function (el) {
      var href = el.getAttribute('data-iiif-manifest');
      if (!href) return;
      var url = resolveUrl(href);
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

  function detectJsonLd() {
    var hits = [];

    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
      var data;
      try { data = JSON.parse(script.textContent); } catch (_) { return; }

      var items = Array.isArray(data) ? data : [data];
      items.forEach(function (item) {
        var ctx = item['@context'] || '';
        var type = item['@type'] || '';
        var ctxStr = Array.isArray(ctx) ? ctx.join(' ') : String(ctx);

        if (isIiifContext(ctxStr) || type === 'sc:Manifest' || type === 'Manifest') {
          var url = item.id || item['@id'] || null;
          hits.push({
            resourceType: ResourceType.MANIFEST,
            resourceUrl: url ? resolveUrl(url) : null,
            label: extractLabel(item.label) || labelFromUrl(url),
            confidence: Confidence.EXPLICIT,
            detectedVia: DetectedVia.METADATA,
            context: { '@type': type, '@context': ctxStr.slice(0, 200) },
          });
        }

        if (type === 'ImageObject' || type === 'schema:ImageObject') {
          var imgUrl = item.contentUrl || item.url || null;
          if (imgUrl) {
            hits.push({
              resourceType: ResourceType.IMAGE,
              resourceUrl: resolveUrl(imgUrl),
              label: item.name || item.description || labelFromUrl(imgUrl),
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

  function detectViewerIframes() {
    var hits = [];

    document.querySelectorAll('iframe[src]').forEach(function (iframe) {
      var src = iframe.getAttribute('src') || '';
      if (!src) return;
      var resolvedSrc = resolveUrl(src);

      if (IIIF_VIEWER_RE.test(src)) {
        var manifestUrl = null;
        try {
          var u = new URL(resolvedSrc);
          var mp = u.searchParams.get('manifest') || u.searchParams.get('manifestId');
          if (mp) manifestUrl = decodeURIComponent(mp);
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

  function detectIiifImageApiUrls() {
    var hits = [];
    var seen = new Set();

    function check(rawUrl, context) {
      if (!rawUrl) return;
      var url = resolveUrl(rawUrl);
      if (seen.has(url)) return;

      if (IIIF_IMAGE_API_RE.test(url)) {
        seen.add(url);
        var baseUrl = url.replace(IIIF_IMAGE_API_RE, '');
        hits.push({
          resourceType: ResourceType.IIIF_IMAGE,
          resourceUrl: url,
          label: labelFromUrl(url),
          confidence: Confidence.EXPLICIT,
          detectedVia: DetectedVia.DOM,
          context: Object.assign({}, context, { iiifServiceBase: baseUrl }),
        });
      } else if (IIIF_INFO_JSON_RE.test(url)) {
        seen.add(url);
        hits.push({
          resourceType: ResourceType.IIIF_IMAGE,
          resourceUrl: url,
          label: labelFromUrl(url),
          confidence: Confidence.EXPLICIT,
          detectedVia: DetectedVia.DOM,
          context: context,
        });
      }
    }

    document.querySelectorAll('img[src]').forEach(function (img) {
      check(img.getAttribute('src'), {
        selector: buildSelector(img),
        alt: img.alt || '',
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    });

    document.querySelectorAll('[data-src],[data-image-src],[data-tile-source]').forEach(function (el) {
      var attr = el.getAttribute('data-src') || el.getAttribute('data-image-src') || el.getAttribute('data-tile-source');
      check(attr, { selector: el.tagName.toLowerCase(), attribute: 'data-*' });
    });

    return hits;
  }

  function detectInfoJsonInText() {
    var hits = [];
    var seen = new Set();

    document.querySelectorAll('script:not([src]):not([type="application/ld+json"])').forEach(function (script) {
      var matches = script.textContent.matchAll(/"(https?:\/\/[^"]+\/info\.json)"/g);
      for (var m of matches) {
        var url = m[1];
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

  function detectRenderableImages() {
    var hits = [];
    var seen = new Set();

    document.querySelectorAll('img[src]').forEach(function (img) {
      var src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      var url = resolveUrl(src);
      if (seen.has(url)) return;

      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;

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

  function detectMetaTags() {
    var hits = [];

    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) {
      var url = resolveUrl(ogImage.getAttribute('content') || '');
      if (url) hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: url,
        label: 'Open Graph image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'meta[property="og:image"]' },
      });
    }

    var twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage) {
      var twitterUrl = resolveUrl(twitterImage.getAttribute('content') || '');
      if (twitterUrl) hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: twitterUrl,
        label: 'Twitter Card image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'meta[name="twitter:image"]' },
      });
    }

    document.querySelectorAll('link[rel="image_src"]').forEach(function (link) {
      var linkUrl = resolveUrl(link.getAttribute('href') || '');
      if (linkUrl) hits.push({
        resourceType: ResourceType.METADATA,
        resourceUrl: linkUrl,
        label: 'Linked image',
        confidence: Confidence.INFERRED,
        detectedVia: DetectedVia.METADATA,
        context: { selector: 'link[rel="image_src"]' },
      });
    });

    return hits;
  }

  // ── De-duplication ──────────────────────────────────────────────────────

  var CONFIDENCE_RANK = { explicit: 2, inferred: 1, speculative: 0 };

  function deduplicateHits(hits) {
    var byUrl = new Map();
    hits.forEach(function (hit) {
      var key = hit.resourceUrl || (hit.resourceType + '::' + JSON.stringify(hit.context));
      var existing = byUrl.get(key);
      if (!existing || (CONFIDENCE_RANK[hit.confidence] || 0) > (CONFIDENCE_RANK[existing.confidence] || 0)) {
        byUrl.set(key, hit);
      }
    });
    return Array.from(byUrl.values());
  }

  // ── Main scan ───────────────────────────────────────────────────────────

  function scanPage() {
    var sourcePage = getSourcePage();

    var rawHits = [].concat(
      detectLinkedManifests(),
      detectJsonLd(),
      detectViewerIframes(),
      detectIiifImageApiUrls(),
      detectInfoJsonInText(),
      detectRenderableImages(),
      detectMetaTags()
    );

    var unique = deduplicateHits(rawHits);
    return unique.map(function (hit) {
      return createResourceRecord(Object.assign({ sourcePage: sourcePage }, hit));
    });
  }

  // Run scan and expose results
  var results = scanPage();
  window.__illuminatorLastScan = results;
  return results;
})();
