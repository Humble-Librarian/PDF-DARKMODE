// ============================================================
// StorageManager.js — Per-Document State Persistence
// Uses chrome.storage.local to remember reading position,
// theme, zoom, and bookmarks for each PDF document.
// ============================================================

class StorageManager {
  // ponytail: Only hash first 4KB for speed. Good enough for PDFs.
  static async hash(pdfData) {
    const chunk = pdfData.slice(0, 4096);
    const buffer = await crypto.subtle.digest('SHA-256', chunk);
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ponytail: Direct dump. No schema migrations.
  static async save(docHash, state) {
    const key = `pdf_${docHash}`;
    state.lastOpened = Date.now();
    await chrome.storage.local.set({ [key]: state });
  }

  static async load(docHash) {
    const key = `pdf_${docHash}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  }

  static async delete(docHash) {
    await chrome.storage.local.remove(`pdf_${docHash}`);
  }
}
