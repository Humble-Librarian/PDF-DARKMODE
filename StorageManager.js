// ============================================================
// StorageManager.js — Per-Document State Persistence
// Uses chrome.storage.local to remember reading position,
// theme, zoom, and bookmarks for each PDF document.
// ============================================================

class StorageManager {
  // ponytail: Only hash first 4KB for speed. Good enough for PDFs.
  static async hash(pdfData) {
    try {
      const chunk = pdfData.slice(0, 4096);
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        const buffer = await crypto.subtle.digest('SHA-256', chunk);
        return Array.from(new Uint8Array(buffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (e) {
      // Fallback below
    }

    // Fast synchronous hash fallback for non-secure contexts
    const chunk = pdfData.slice(0, 4096);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < chunk.length; i++) {
      h1 = Math.imul(h1 ^ chunk[i], 2654435761);
      h2 = Math.imul(h2 ^ chunk[i], 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  // ponytail: Direct dump with fallback. No crashes.
  static async save(docHash, state) {
    if (!docHash) return;
    const key = `pdf_${docHash}`;
    state.lastOpened = Date.now();
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [key]: state });
        return;
      }
    } catch (e) {
      // Fall through to localStorage
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {}
  }

  static async load(docHash) {
    if (!docHash) return null;
    const key = `pdf_${docHash}`;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(key);
        if (result && result[key]) return result[key];
      }
    } catch (e) {
      // Fall through to localStorage
    }
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  static async delete(docHash) {
    if (!docHash) return;
    const key = `pdf_${docHash}`;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(key);
      }
    } catch (e) {}
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
}
