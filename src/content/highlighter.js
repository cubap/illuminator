/**
 * highlighter.js – Content script for ephemeral element highlighting.
 *
 * Loaded passively into every page but does nothing until it receives a
 * message from the Illuminator popup.
 *
 * Rules:
 *  - Highlights are temporary and non-interactive.
 *  - No permanent DOM modification.
 *  - Highlighting failures are silent – they never block user workflows.
 */

/* eslint-env browser */

(function () {
  'use strict';

  const OVERLAY_ID = '__illuminator_highlight_overlay__';
  const STYLE_ID = '__illuminator_highlight_style__';

  // -------------------------------------------------------------------------
  // Style injection (once)
  // -------------------------------------------------------------------------

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        box-sizing: border-box;
        border: 2px solid #e67e22;
        border-radius: 2px;
        background: rgba(230, 126, 34, 0.08);
        transition: opacity 0.15s ease;
        outline: none;
      }
    `;
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Overlay management
  // -------------------------------------------------------------------------

  function getOrCreateOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  /**
   * Highlight the element matching the given selector.
   * @param {string} selector – CSS selector or empty string to clear
   */
  function highlightSelector(selector) {
    try {
      ensureStyles();

      if (!selector) {
        clearHighlight();
        return;
      }

      const target = document.querySelector(selector);
      if (!target) {
        clearHighlight();
        return;
      }

      const rect = target.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        clearHighlight();
        return;
      }

      const overlay = getOrCreateOverlay();
      overlay.style.position = 'fixed';
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.opacity = '1';
      overlay.style.display = 'block';
    } catch (_) {
      // Fail silently – highlighting must never block workflows
    }
  }

  /**
   * Remove the highlight overlay.
   */
  function clearHighlight() {
    try {
      const overlay = document.getElementById(OVERLAY_ID);
      if (overlay) {
        overlay.style.display = 'none';
      }
    } catch (_) {
      // Fail silently
    }
  }

  // -------------------------------------------------------------------------
  // Message handler
  // -------------------------------------------------------------------------

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.source !== 'illuminator') return false;

      switch (message.type) {
        case 'HIGHLIGHT':
          highlightSelector(message.selector || '');
          sendResponse({ ok: true });
          break;

        case 'CLEAR_HIGHLIGHT':
          clearHighlight();
          sendResponse({ ok: true });
          break;

        default:
          break;
      }
      return false;
    });
  }
})();
