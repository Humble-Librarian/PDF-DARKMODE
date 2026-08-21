// ============================================================
// PDFExportManager.js — Two-Tier Export Manager
// Tier 1: Instant print-to-pdf via window.print() + @media print
// Tier 2: Vector SVG canvas flattening export
// ============================================================

class PDFExportManager {
  /**
   * Export the current document using window.print() formatted with clean un-inverted styles.
   */
  static exportViaPrint() {
    window.print();
  }
}
