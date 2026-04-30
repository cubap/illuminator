/**
 * popup.js – Illuminator popup UI controller.
 *
 * Owns all user interaction:
 *  - Triggers page scans via chrome.scripting.executeScript
 *  - Renders detection results and stash
 *  - Drives element highlighting via messages to content scripts
 *  - Persists stash via the background service worker
 */

/* globals chrome */
'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {ResourceRecord[]} Currently detected resources (session-only) */
let detectedResources = [];

/** @type {ResourceRecord[]} Saved stash (persisted across sessions) */
let stashedResources = [];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function setStatus(text, variant = '') {
  const bar = $('status-bar');
  bar.innerHTML = text;
  bar.className = `il-status${variant ? ` il-status--${variant}` : ''}`;
}

function updateCount(elementId, count) {
  const el = $(elementId);
  el.textContent = count;
  el.setAttribute('aria-label', `${count} ${count === 1 ? 'resource' : 'resources'}`);
}

// ---------------------------------------------------------------------------
// Resource card rendering
// ---------------------------------------------------------------------------

const TYPE_LABELS = {
  manifest: 'Manifest',
  'iiif-image': 'IIIF Image',
  image: 'Image',
  metadata: 'Metadata',
  unknown: 'Unknown',
};

/**
 * Build a resource card element from a template and a ResourceRecord.
 * @param {ResourceRecord} record
 * @param {boolean} inStash – if true, show Remove instead of Save
 * @returns {HTMLElement}
 */
function buildCard(record, inStash = false) {
  const template = document.getElementById('resource-card-template');
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.il-resource-card');

  card.dataset.id = record.id;
  card.setAttribute('aria-label', record.label || record.resourceUrl || 'Resource');

  // Type badge
  const typeBadge = card.querySelector('.il-type-badge');
  typeBadge.textContent = TYPE_LABELS[record.resourceType] || record.resourceType;
  typeBadge.dataset.type = record.resourceType;

  // Confidence badge
  const confBadge = card.querySelector('.il-confidence-badge');
  confBadge.textContent = record.confidence;
  confBadge.dataset.confidence = record.confidence;

  // Title
  const title = card.querySelector('.il-card-title');
  title.textContent = record.label || record.resourceUrl || '(unlabelled)';
  title.title = record.label || '';

  // URL
  const urlLink = card.querySelector('.il-url-link');
  if (record.resourceUrl) {
    urlLink.href = record.resourceUrl;
    urlLink.textContent = record.resourceUrl;
    urlLink.setAttribute('aria-label', `Open ${record.resourceUrl}`);
  } else {
    urlLink.closest('.il-card-url').style.display = 'none';
  }

  // Detection method
  const via = card.querySelector('.il-via-label');
  via.textContent = `Detected via ${record.detectedVia}`;

  // Buttons
  const stashBtn = card.querySelector('.il-btn--stash');
  const removeBtn = card.querySelector('.il-btn--remove');

  if (inStash) {
    stashBtn.style.display = 'none';
    removeBtn.style.display = '';
    removeBtn.addEventListener('click', () => handleRemoveFromStash(record.id));
  } else {
    const alreadyStashed = stashedResources.some((r) => r.resourceUrl === record.resourceUrl && r.resourceUrl);
    if (alreadyStashed) {
      stashBtn.textContent = 'Saved ✓';
      stashBtn.disabled = true;
    }
    stashBtn.addEventListener('click', () => handleAddToStash(record, stashBtn));
  }

  // View button
  const viewBtn = card.querySelector('.il-btn--view');
  if (record.resourceUrl) {
    viewBtn.addEventListener('click', () => handleView(record));
  } else {
    viewBtn.disabled = true;
    viewBtn.style.opacity = '0.4';
  }

  // Hover → highlight
  if (record.context?.selector) {
    card.addEventListener('mouseenter', () => sendHighlight(record.context.selector));
    card.addEventListener('mouseleave', () => sendClearHighlight());
    card.addEventListener('focus', () => sendHighlight(record.context.selector));
    card.addEventListener('blur', () => sendClearHighlight());
  }

  return card;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDetectedResources() {
  const list = $('resource-list');
  list.innerHTML = '';

  if (detectedResources.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'il-empty-state';
    empty.textContent = 'No resources detected on this page.';
    list.appendChild(empty);
    updateCount('detection-count', 0);
    return;
  }

  updateCount('detection-count', detectedResources.length);
  detectedResources.forEach((record) => {
    list.appendChild(buildCard(record, false));
  });
}

function renderStash() {
  const list = $('stash-list');
  list.innerHTML = '';

  if (stashedResources.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'il-empty-state';
    empty.textContent = 'No saved resources yet.';
    list.appendChild(empty);
    updateCount('stash-count', 0);
    return;
  }

  updateCount('stash-count', stashedResources.length);
  stashedResources.forEach((record) => {
    list.appendChild(buildCard(record, true));
  });
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function handleScan() {
  const scanBtn = $('scan-btn');
  scanBtn.disabled = true;
  scanBtn.classList.add('il-scanning');
  setStatus('Scanning page…', 'scanning');
  detectedResources = [];

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    // Inject the scanner bundle – it runs synchronously and returns results directly
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/scanner-bundle.js'],
    });

    const records = results[0]?.result || [];
    detectedResources = records;
    renderDetectedResources();

    const n = records.length;
    setStatus(
      n === 0
        ? 'Scan complete – no resources detected.'
        : `Scan complete – found <strong>${n}</strong> resource${n === 1 ? '' : 's'}.`,
      'done'
    );
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`, 'error');
    console.error('[Illuminator] Scan error:', err);
  } finally {
    scanBtn.disabled = false;
    scanBtn.classList.remove('il-scanning');
  }
}

// ---------------------------------------------------------------------------
// Stash actions
// ---------------------------------------------------------------------------

async function handleAddToStash(record, btn) {
  try {
    btn.textContent = 'Saving…';
    btn.disabled = true;

    const updated = await sendMessage({ type: 'ADD_TO_STASH', record });
    stashedResources = updated;
    renderStash();

    btn.textContent = 'Saved ✓';
  } catch (err) {
    btn.textContent = 'Error';
    btn.disabled = false;
    console.error('[Illuminator] Stash add error:', err);
  }
}

async function handleRemoveFromStash(id) {
  try {
    const updated = await sendMessage({ type: 'REMOVE_FROM_STASH', id });
    stashedResources = updated;
    renderStash();
    // Re-render detection so "Saved ✓" buttons reset if applicable
    renderDetectedResources();
  } catch (err) {
    console.error('[Illuminator] Stash remove error:', err);
  }
}

async function handleClearStash() {
  if (!stashedResources.length) return;
  if (!confirm('Remove all stashed resources?')) return;
  try {
    await sendMessage({ type: 'CLEAR_STASH' });
    stashedResources = [];
    renderStash();
    renderDetectedResources();
  } catch (err) {
    console.error('[Illuminator] Clear stash error:', err);
  }
}

// ---------------------------------------------------------------------------
// Viewer launch
// ---------------------------------------------------------------------------

function handleView(record) {
  if (!record.resourceUrl) return;
  chrome.tabs.create({ url: record.resourceUrl });
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

async function sendHighlight(selector) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, {
      source: 'illuminator',
      type: 'HIGHLIGHT',
      selector,
    });
  } catch (_) {
    // Fail silently
  }
}

async function sendClearHighlight() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, {
      source: 'illuminator',
      type: 'CLEAR_HIGHLIGHT',
    });
  } catch (_) {
    // Fail silently
  }
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

/**
 * Send a message to the background service worker and await a response.
 * @param {object} msg
 * @returns {Promise<*>}
 */
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ source: 'illuminator', ...msg }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // Load stash
  try {
    stashedResources = await sendMessage({ type: 'GET_STASH' });
    renderStash();
  } catch (err) {
    console.warn('[Illuminator] Could not load stash:', err);
  }

  renderDetectedResources();

  // Wire up buttons
  $('scan-btn').addEventListener('click', handleScan);
  $('clear-stash-btn').addEventListener('click', handleClearStash);
}

document.addEventListener('DOMContentLoaded', init);
