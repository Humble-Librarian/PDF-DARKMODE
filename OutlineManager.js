// ============================================================
// OutlineManager.js — PDF Outline / Table of Contents Manager
// Extracts the PDF outline (bookmarks) and renders a navigable
// tree in the sidebar. Supports nested expand/collapse, active
// item tracking on scroll, and click-to-navigate.
// ============================================================

class OutlineManager {
  /**
   * @param {HTMLElement} container - The #outlineContainer element
   * @param {Function} onNavigate - Callback invoked with (pageIndex) to jump to a page
   */
  constructor(container, onNavigate) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Function} */
    this.onNavigate = onNavigate;

    /** @type {Array<{element: HTMLElement, pageIndex: number}>} */
    this._items = [];

    /** @type {number} */
    this._activePageIndex = -1;

    /** @type {HTMLElement|null} */
    this._activeElement = null;

    /** @type {boolean} */
    this._initialized = false;
  }

  // =================================================================
  // Initialization
  // =================================================================

  /**
   * Build the outline tree from PDF outline data.
   * @param {Array} outlineData - Result from pdfDocument.getOutline()
   * @param {Object} pdfDocument - The PDF.js document proxy
   * @returns {Promise<boolean>} true if outline exists and was built
   */
  async init(outlineData, pdfDocument) {
    if (!outlineData || outlineData.length === 0) {
      return false;
    }

    // Clear any previous content
    this.container.innerHTML = '';
    this._items = [];
    this._activeElement = null;
    this._activePageIndex = -1;

    // Build the tree
    const rootUl = document.createElement('ul');
    rootUl.className = 'outline-tree';

    await this._buildTreeDOM(outlineData, rootUl, 0, pdfDocument);

    this.container.appendChild(rootUl);

    // Attach delegated click handler
    this.container.addEventListener('click', this._handleClick.bind(this));

    this._initialized = true;
    return this._items.length > 0;
  }

  // =================================================================
  // Tree Building
  // =================================================================

  /**
   * Recursively build the outline tree DOM.
   * @param {Array} items - Outline items (from getOutline or nested .items)
   * @param {HTMLElement} parentEl - Parent <ul> element
   * @param {number} depth - Current nesting depth (0 = root)
   * @param {Object} pdfDocument - PDF.js document proxy
   * @private
   */
  async _buildTreeDOM(items, parentEl, depth, pdfDocument) {
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'outline-node';

      const hasChildren = item.items && item.items.length > 0;

      // Resolve destination to page index
      const pageIndex = await this._resolveDestination(item.dest, pdfDocument);

      // Build the clickable item row
      const itemEl = document.createElement('div');
      itemEl.className = 'outline-item';
      itemEl.dataset.pageIndex = pageIndex;
      if (item.bold) itemEl.style.fontWeight = '600';
      if (item.italic) itemEl.style.fontStyle = 'italic';

      // Toggle arrow (only if has children)
      if (hasChildren) {
        const toggle = document.createElement('span');
        toggle.className = 'outline-toggle expanded';
        toggle.innerHTML = '&#9654;'; // ▶ right-pointing triangle
        toggle.dataset.action = 'toggle';
        itemEl.appendChild(toggle);
      } else {
        // Spacer to keep alignment
        const spacer = document.createElement('span');
        spacer.className = 'outline-toggle-spacer';
        itemEl.appendChild(spacer);
      }

      // Title text
      const titleSpan = document.createElement('span');
      titleSpan.className = 'outline-title';
      titleSpan.textContent = item.title || 'Untitled';
      titleSpan.title = item.title || 'Untitled';
      itemEl.appendChild(titleSpan);

      // Page number (shown on hover via CSS)
      if (pageIndex >= 0) {
        const pageNum = document.createElement('span');
        pageNum.className = 'outline-page-num';
        pageNum.textContent = pageIndex + 1;
        itemEl.appendChild(pageNum);
      }

      li.appendChild(itemEl);

      // Track this item for active state management
      if (pageIndex >= 0) {
        this._items.push({ element: itemEl, pageIndex: pageIndex });
      }

      // Build children recursively
      if (hasChildren) {
        const childUl = document.createElement('ul');
        childUl.className = 'outline-tree outline-children';
        // All levels start expanded (user preference)
        childUl.style.display = '';

        await this._buildTreeDOM(item.items, childUl, depth + 1, pdfDocument);
        li.appendChild(childUl);
      }

      parentEl.appendChild(li);
    }
  }

  // =================================================================
  // Destination Resolution
  // =================================================================

  /**
   * Resolve a PDF outline destination to a 0-based page index.
   * Handles both named destinations (string) and explicit destinations (Array).
   * @param {string|Array|null} dest - The destination from the outline item
   * @param {Object} pdfDocument - PDF.js document proxy
   * @returns {Promise<number>} 0-based page index, or -1 if unresolvable
   * @private
   */
  async _resolveDestination(dest, pdfDocument) {
    try {
      if (!dest) return -1;

      // Named destination (string) → resolve to explicit
      if (typeof dest === 'string') {
        const explicitDest = await pdfDocument.getDestination(dest);
        if (!explicitDest) return -1;
        dest = explicitDest;
      }

      // Explicit destination (Array) → first element is the page ref
      if (Array.isArray(dest) && dest.length > 0) {
        const pageRef = dest[0];
        if (typeof pageRef === 'object' && pageRef !== null) {
          const pageIndex = await pdfDocument.getPageIndex(pageRef);
          return pageIndex; // 0-based
        }
        // Some destinations use a direct page number
        if (typeof pageRef === 'number') {
          return pageRef;
        }
      }
    } catch (err) {
      console.warn('OutlineManager: Could not resolve destination:', err);
    }
    return -1;
  }

  // =================================================================
  // Event Handling
  // =================================================================

  /**
   * Delegated click handler for the outline container.
   * @param {MouseEvent} e
   * @private
   */
  _handleClick(e) {
    const target = e.target;

    // Handle toggle expand/collapse
    if (target.dataset.action === 'toggle' || target.closest('[data-action="toggle"]')) {
      const toggleEl = target.dataset.action === 'toggle' ? target : target.closest('[data-action="toggle"]');
      this._toggleExpand(toggleEl);
      e.stopPropagation();
      return;
    }

    // Handle item click → navigate
    const itemEl = target.closest('.outline-item');
    if (itemEl && itemEl.dataset.pageIndex !== undefined) {
      const pageIndex = parseInt(itemEl.dataset.pageIndex, 10);
      if (pageIndex >= 0 && typeof this.onNavigate === 'function') {
        this.onNavigate(pageIndex);
        this._setActiveElement(itemEl, pageIndex);
      }
    }
  }

  /**
   * Toggle expand/collapse of a subtree.
   * @param {HTMLElement} toggleEl - The toggle arrow element
   * @private
   */
  _toggleExpand(toggleEl) {
    const li = toggleEl.closest('.outline-node');
    if (!li) return;

    const childUl = li.querySelector(':scope > .outline-children');
    if (!childUl) return;

    const isExpanded = toggleEl.classList.contains('expanded');
    if (isExpanded) {
      childUl.style.display = 'none';
      toggleEl.classList.remove('expanded');
    } else {
      childUl.style.display = '';
      toggleEl.classList.add('expanded');
    }
  }

  // =================================================================
  // Active Item Tracking
  // =================================================================

  /**
   * Set the active outline item based on the current scroll page.
   * Called by UIController's scroll sync.
   * @param {number} pageIndex - 0-based current page index
   */
  setActivePage(pageIndex) {
    if (!this._initialized || this._items.length === 0) return;
    if (pageIndex === this._activePageIndex) return;

    this._activePageIndex = pageIndex;

    // Find the last outline item whose pageIndex <= current page
    // (this gives us the "current chapter/section")
    let bestItem = null;
    for (const item of this._items) {
      if (item.pageIndex <= pageIndex) {
        bestItem = item;
      } else {
        break; // Items are in document order, so we can stop early
      }
    }

    if (bestItem) {
      this._setActiveElement(bestItem.element, bestItem.pageIndex);
    }
  }

  /**
   * Visually highlight the active outline item and scroll it into view.
   * @param {HTMLElement} element - The .outline-item element to activate
   * @param {number} pageIndex - The page index (for tracking)
   * @private
   */
  _setActiveElement(element, pageIndex) {
    // Remove previous active
    if (this._activeElement) {
      this._activeElement.classList.remove('active');
    }

    element.classList.add('active');
    this._activeElement = element;
    this._activePageIndex = pageIndex;

    // Scroll the active item into view within the sidebar
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // =================================================================
  // Cleanup
  // =================================================================

  /**
   * Destroy the outline manager and clean up.
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this._items = [];
    this._activeElement = null;
    this._activePageIndex = -1;
    this._initialized = false;
  }
}
