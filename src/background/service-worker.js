/**
 * service-worker.js – Background service worker for Illuminator.
 *
 * Responsibilities:
 *  - Manage the persistent stash (chrome.storage.local)
 *  - Relay highlight messages to content scripts
 *  - No page scanning, no passive data collection
 */

'use strict';

const STASH_KEY = 'illuminator_stash';

// ---------------------------------------------------------------------------
// Stash helpers
// ---------------------------------------------------------------------------

/**
 * Read the full stash from storage.
 * @returns {Promise<ResourceRecord[]>}
 */
async function readStash() {
  const result = await chrome.storage.local.get(STASH_KEY);
  return result[STASH_KEY] || [];
}

/**
 * Write the full stash to storage.
 * @param {ResourceRecord[]} stash
 * @returns {Promise<void>}
 */
async function writeStash(stash) {
  await chrome.storage.local.set({ [STASH_KEY]: stash });
}

/**
 * Add one record to the stash (no duplicates by id).
 * @param {ResourceRecord} record
 * @returns {Promise<ResourceRecord[]>} Updated stash
 */
async function addToStash(record) {
  const stash = await readStash();
  if (stash.some((r) => r.id === record.id)) return stash;
  const updated = [...stash, record];
  await writeStash(updated);
  return updated;
}

/**
 * Remove a record from the stash by id.
 * @param {string} id
 * @returns {Promise<ResourceRecord[]>} Updated stash
 */
async function removeFromStash(id) {
  const stash = await readStash();
  const updated = stash.filter((r) => r.id !== id);
  await writeStash(updated);
  return updated;
}

/**
 * Update a record's mutable fields (label, resourceUrl, context).
 * @param {string} id
 * @param {object} changes
 * @returns {Promise<ResourceRecord[]>} Updated stash
 */
async function updateInStash(id, changes) {
  const stash = await readStash();
  const updated = stash.map((r) => {
    if (r.id !== id) return r;
    const allowed = ['label', 'resourceUrl', 'context'];
    const patch = Object.fromEntries(
      Object.entries(changes).filter(([k]) => allowed.includes(k))
    );
    return { ...r, ...patch, updatedAt: new Date().toISOString() };
  });
  await writeStash(updated);
  return updated;
}

/**
 * Clear all stash entries.
 * @returns {Promise<void>}
 */
async function clearStash() {
  await writeStash([]);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== 'illuminator') return false;

  const handle = async () => {
    switch (message.type) {
      case 'GET_STASH':
        return await readStash();

      case 'ADD_TO_STASH':
        return await addToStash(message.record);

      case 'REMOVE_FROM_STASH':
        return await removeFromStash(message.id);

      case 'UPDATE_STASH_RECORD':
        return await updateInStash(message.id, message.changes);

      case 'CLEAR_STASH':
        await clearStash();
        return { ok: true };

      case 'HIGHLIGHT': {
        // Forward to the active tab's content script
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
        }
        return { ok: true };
      }

      case 'CLEAR_HIGHLIGHT': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
        }
        return { ok: true };
      }

      default:
        return { error: 'Unknown message type' };
    }
  };

  handle().then(sendResponse).catch((err) => sendResponse({ error: err.message }));
  return true; // Keep message channel open for async response
});
