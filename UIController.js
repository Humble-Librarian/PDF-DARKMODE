// ============================================================
// UIController.js — User Interface Controller
// Handles toolbar bindings, keyboard shortcuts, search,
// floating page indicator, and scroll synchronization.
// ============================================================

class UIController {
  /**
   * @param {Object} options
   * @param {RenderEngine} options.renderEngine - RenderEngine instance for page rendering/navigation
   * @param {Object} options.thumbnailManager - ThumbnailManager instance with setActiveIndex(pageIndex)
   * @param {Object} [options.outlineManager] - OutlineManager instance with setActivePage(pageIndex)
   * @param {DarkModeProcessor} options.darkModeProcessor - DarkModeProcessor instance for theme info
   * @param {Function} options.onThemeChange - Callback invoked with (themeName) when user changes theme
   * @param {Function} options.onBackClick - Callback invoked when the back/close button is clicked
   */
  constructor(options) {
    if (!options || !options.renderEngine) {
      throw new Error('UIController requires a renderEngine option');
    }

    /** @type {RenderEngine} */
    this.renderEngine = options.renderEngine;

    /** @type {Object|null} */
    this.thumbnailManager = options.thumbnailManager || null;

    /** @type {Object|null} */
    this.outlineManager = options.outlineManager || null;

    /** @type {DarkModeProcessor|null} */
    this.darkModeProcessor = options.darkModeProcessor || null;

    /** @type {Function|null} */
    this.onThemeChange = options.onThemeChange || null;

    /** @type {Function|null} */
    this.onBackClick = options.onBackClick || null;

    // ---------------------------------------------------------------
    // DOM element references (resolved lazily in init())
    // ---------------------------------------------------------------

    /** @type {HTMLElement|null} */
    this._els = null;

    // ---------------------------------------------------------------
    // Search state
    // ---------------------------------------------------------------

    /** @type {string} */
    this._lastSearchQuery = '';

    /** @type {Array<{pageIndex: number, textIndex: number}>} */
    this._searchResults = [];

    /** @type {number} */
    this._currentSearchIndex = -1;

    // ---------------------------------------------------------------
    // Scroll / indicator state
    // ---------------------------------------------------------------

    /** @type {number|null} Timer ID for scroll debounce (thumbnail + page input update) */
    this._scrollDebounceTimer = null;

    /** @type {number|null} Timer ID for page indicator fade-out */
    this._indicatorFadeTimer = null;

    /** @type {HTMLElement|null} Dynamically created floating page indicator */
    this._pageIndicator = null;

    // ---------------------------------------------------------------
    // Bound handler references (for clean removal in destroy())
    // ---------------------------------------------------------------

    this._boundHandlers = {};

    /** @type {boolean} */
    this._initialized = false;
  }

  // =================================================================
  // Initialization & Teardown
  // =================================================================

  /**
   * Set up all event listeners, create dynamic elements, and wire
   * toolbar controls to their corresponding actions.
   */
  init() {
    if (this._initialized) {
      console.warn('UIController.init() called more than once');
      return;
    }

    this._resolveElements();
    this._createPageIndicator();
    this._bindToolbarButtons();
    this._bindKeyboardShortcuts();
    this._bindSearchControls();
    this._bindScrollSync();
    this._bindTextExtractionEvent();

    // Set initial UI state
    this._updateZoomDisplay();
    this._updatePageInfo(
      this.renderEngine.getCurrentPage(),
      this.renderEngine.getTotalPages()
    );

    // Disable search until text extraction completes
    if (this._els.searchInput) {
      if (!this.renderEngine.isTextReady()) {
        this._els.searchInput.disabled = true;
        this._els.searchInput.placeholder = 'Extracting text...';
      } else {
        this._els.searchInput.disabled = false;
        this._els.searchInput.placeholder = 'Find in document';
      }
    }

    this._initialized = true;
  }

  /**
   * Remove all event listeners and clean up dynamic elements.
   */
  destroy() {
    if (!this._initialized) return;

    // Remove keyboard handler
    if (this._boundHandlers.keydown) {
      document.removeEventListener('keydown', this._boundHandlers.keydown);
    }

    // Remove scroll handler
    const mainPreview = this._els.mainPreview;
    if (mainPreview && this._boundHandlers.scroll) {
      mainPreview.removeEventListener('scroll', this._boundHandlers.scroll);
    }

    // Remove text extraction listener
    if (this._boundHandlers.textExtractionComplete) {
      document.removeEventListener('textExtractionComplete', this._boundHandlers.textExtractionComplete);
    }

    // Remove toolbar button listeners (cloneNode trick not needed — we
    // stored references, so we use removeEventListener)
    for (const [elementKey, handler] of Object.entries(this._boundHandlers)) {
      if (elementKey.startsWith('click:') && this._els) {
        const elKey = elementKey.slice(6);
        const el = this._els[elKey];
        if (el) {
          el.removeEventListener('click', handler);
        }
      }
      if (elementKey.startsWith('change:') && this._els) {
        const elKey = elementKey.slice(7);
        const el = this._els[elKey];
        if (el) {
          el.removeEventListener('change', handler);
        }
      }
      if (elementKey.startsWith('input:') && this._els) {
        const elKey = elementKey.slice(6);
        const el = this._els[elKey];
        if (el) {
          el.removeEventListener('input', handler);
        }
      }
      if (elementKey.startsWith('keydown:') && this._els) {
        const elKey = elementKey.slice(8);
        const el = this._els[elKey];
        if (el) {
          el.removeEventListener('keydown', handler);
        }
      }
    }

    // Clear timers
    if (this._scrollDebounceTimer) {
      clearTimeout(this._scrollDebounceTimer);
      this._scrollDebounceTimer = null;
    }
    if (this._indicatorFadeTimer) {
      clearTimeout(this._indicatorFadeTimer);
      this._indicatorFadeTimer = null;
    }

    // Remove page indicator
    if (this._pageIndicator && this._pageIndicator.parentNode) {
      this._pageIndicator.parentNode.removeChild(this._pageIndicator);
      this._pageIndicator = null;
    }

    // Clear search state
    this.clearHighlights();
    this._searchResults = [];
    this._currentSearchIndex = -1;
    this._lastSearchQuery = '';

    this._boundHandlers = {};
    this._els = null;
    this._initialized = false;
  }

  // =================================================================
  // Public API
  // =================================================================

  /**
   * Update the page input and page count text display.
   * @param {number} currentPage - 0-based page index
   * @param {number} totalPages - Total number of pages
   */
  updatePageInfo(currentPage, totalPages) {
    this._updatePageInfo(currentPage, totalPages);
  }

  // =================================================================
  // DOM Resolution
  // =================================================================

  /**
   * Resolve all toolbar/UI element references by ID.
   * @private
   */
  _resolveElements() {
    this._els = {
      zoomInBtn: document.getElementById('zoomInBtn'),
      zoomOutBtn: document.getElementById('zoomOutBtn'),
      zoomLevelText: document.getElementById('zoomLevelText'),
      rotateBtn: document.getElementById('rotateBtn'),
      prevPageBtn: document.getElementById('prevPageBtn'),
      nextPageBtn: document.getElementById('nextPageBtn'),
      pageInput: document.getElementById('pageInput'),
      pageCountText: document.getElementById('pageCountText'),
      themeSelector: document.getElementById('themeSelector'),
      backBtn: document.getElementById('backBtn'),
      toggleThumbnailsBtn: document.getElementById('toggleThumbnailsBtn'),
      toggleOutlineBtn: document.getElementById('toggleOutlineBtn'),
      sidebarPanel: document.getElementById('sidebarPanel'),
      thumbnailContainer: document.getElementById('thumbnailContainer'),
      outlineContainer: document.getElementById('outlineContainer'),
      searchInput: document.getElementById('searchInput'),
      searchPrevBtn: document.getElementById('searchPrevBtn'),
      searchNextBtn: document.getElementById('searchNextBtn'),
      searchResultText: document.getElementById('searchResultText'),
      mainPreview: document.getElementById('mainPreview')
    };
  }

  // =================================================================
  // Toolbar Bindings
  // =================================================================

  /**
   * Wire up all toolbar buttons to their actions.
   * @private
   */
  _bindToolbarButtons() {
    const els = this._els;

    // --- Zoom In ---
    if (els.zoomInBtn) {
      const handler = () => {
        try {
          const currentScale = this.renderEngine.getScale();
          const currentPage = this.renderEngine.getCurrentPage();
          this.renderEngine.setScale(currentScale + 0.25);
          this._updateZoomDisplay();
          // Restore scroll to same page after zoom
          requestAnimationFrame(() => {
            this.renderEngine.jumpToPage(currentPage, 'auto');
          });
        } catch (err) {
          console.error('UIController: Zoom in failed:', err);
        }
      };
      els.zoomInBtn.addEventListener('click', handler);
      this._boundHandlers['click:zoomInBtn'] = handler;
    }

    // --- Zoom Out ---
    if (els.zoomOutBtn) {
      const handler = () => {
        try {
          const currentScale = this.renderEngine.getScale();
          const currentPage = this.renderEngine.getCurrentPage();
          this.renderEngine.setScale(currentScale - 0.25);
          this._updateZoomDisplay();
          requestAnimationFrame(() => {
            this.renderEngine.jumpToPage(currentPage, 'auto');
          });
        } catch (err) {
          console.error('UIController: Zoom out failed:', err);
        }
      };
      els.zoomOutBtn.addEventListener('click', handler);
      this._boundHandlers['click:zoomOutBtn'] = handler;
    }

    // --- Rotate ---
    if (els.rotateBtn) {
      const handler = () => {
        try {
          const currentRotation = this.renderEngine.getRotation
            ? this.renderEngine.getRotation()
            : 0;
          this.renderEngine.setRotation(currentRotation + 90);
        } catch (err) {
          console.error('UIController: Rotate failed:', err);
        }
      };
      els.rotateBtn.addEventListener('click', handler);
      this._boundHandlers['click:rotateBtn'] = handler;
    }

    // --- Previous Page ---
    if (els.prevPageBtn) {
      const handler = () => {
        try {
          const current = this.renderEngine.getCurrentPage();
          this.renderEngine.jumpToPage(current - 1);
        } catch (err) {
          console.error('UIController: Previous page failed:', err);
        }
      };
      els.prevPageBtn.addEventListener('click', handler);
      this._boundHandlers['click:prevPageBtn'] = handler;
    }

    // --- Next Page ---
    if (els.nextPageBtn) {
      const handler = () => {
        try {
          const current = this.renderEngine.getCurrentPage();
          this.renderEngine.jumpToPage(current + 1);
        } catch (err) {
          console.error('UIController: Next page failed:', err);
        }
      };
      els.nextPageBtn.addEventListener('click', handler);
      this._boundHandlers['click:nextPageBtn'] = handler;
    }

    // --- Page Input (number) ---
    if (els.pageInput) {
      const handler = () => {
        try {
          const value = parseInt(els.pageInput.value, 10);
          if (!isNaN(value) && value >= 1 && value <= this.renderEngine.getTotalPages()) {
            this.renderEngine.jumpToPage(value - 1);
          }
        } catch (err) {
          console.error('UIController: Page input navigation failed:', err);
        }
      };
      els.pageInput.addEventListener('change', handler);
      this._boundHandlers['change:pageInput'] = handler;
    }

    // --- Theme Selector ---
    if (els.themeSelector) {
      const handler = (e) => {
        try {
          const themeName = e.target.value;
          this.renderEngine.setTheme(themeName);
          if (typeof this.onThemeChange === 'function') {
            this.onThemeChange(themeName);
          }
        } catch (err) {
          console.error('UIController: Theme change failed:', err);
        }
      };
      els.themeSelector.addEventListener('change', handler);
      this._boundHandlers['change:themeSelector'] = handler;
    }

    // --- Back / Close Button ---
    if (els.backBtn) {
      const handler = () => {
        try {
          if (typeof this.onBackClick === 'function') {
            this.onBackClick();
          }
        } catch (err) {
          console.error('UIController: Back click failed:', err);
        }
      };
      els.backBtn.addEventListener('click', handler);
      this._boundHandlers['click:backBtn'] = handler;
    }

    // --- Toggle Thumbnails Sidebar ---
    if (els.toggleThumbnailsBtn) {
      const handler = () => {
        try {
          const isCurrentlyShowingThumbnails = els.thumbnailContainer && els.thumbnailContainer.style.display !== 'none';
          const isSidebarOpen = els.sidebarPanel && !els.sidebarPanel.classList.contains('collapsed');

          if (isCurrentlyShowingThumbnails && isSidebarOpen) {
            // Already showing thumbnails and sidebar is open → collapse sidebar
            els.sidebarPanel.classList.add('collapsed');
            els.toggleThumbnailsBtn.classList.remove('active');
          } else {
            // Switch to thumbnails view and ensure sidebar is open
            if (els.thumbnailContainer) els.thumbnailContainer.style.display = '';
            if (els.outlineContainer) els.outlineContainer.style.display = 'none';
            if (els.sidebarPanel) els.sidebarPanel.classList.remove('collapsed');
            els.toggleThumbnailsBtn.classList.add('active');
            if (els.toggleOutlineBtn) els.toggleOutlineBtn.classList.remove('active');
          }
        } catch (err) {
          console.error('UIController: Toggle thumbnails failed:', err);
        }
      };
      els.toggleThumbnailsBtn.addEventListener('click', handler);
      this._boundHandlers['click:toggleThumbnailsBtn'] = handler;
    }

    // --- Toggle Outline Sidebar ---
    if (els.toggleOutlineBtn) {
      const handler = () => {
        try {
          if (els.toggleOutlineBtn.disabled) return;

          const isCurrentlyShowingOutline = els.outlineContainer && els.outlineContainer.style.display !== 'none';
          const isSidebarOpen = els.sidebarPanel && !els.sidebarPanel.classList.contains('collapsed');

          if (isCurrentlyShowingOutline && isSidebarOpen) {
            // Already showing outline and sidebar is open → collapse sidebar
            els.sidebarPanel.classList.add('collapsed');
            els.toggleOutlineBtn.classList.remove('active');
          } else {
            // Switch to outline view and ensure sidebar is open
            if (els.outlineContainer) els.outlineContainer.style.display = '';
            if (els.thumbnailContainer) els.thumbnailContainer.style.display = 'none';
            if (els.sidebarPanel) els.sidebarPanel.classList.remove('collapsed');
            els.toggleOutlineBtn.classList.add('active');
            if (els.toggleThumbnailsBtn) els.toggleThumbnailsBtn.classList.remove('active');
          }
        } catch (err) {
          console.error('UIController: Toggle outline failed:', err);
        }
      };
      els.toggleOutlineBtn.addEventListener('click', handler);
      this._boundHandlers['click:toggleOutlineBtn'] = handler;
    }
  }

  // =================================================================
  // Keyboard Shortcuts
  // =================================================================

  /**
   * Register global keyboard shortcuts.
   * @private
   */
  _bindKeyboardShortcuts() {
    const handler = (e) => {
      const isMod = e.ctrlKey || e.metaKey;

      // --- Zoom In: Ctrl/Cmd + = or Ctrl/Cmd + + ---
      if (isMod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this._handleZoomIn();
        return;
      }

      // --- Zoom Out: Ctrl/Cmd + - ---
      if (isMod && e.key === '-') {
        e.preventDefault();
        this._handleZoomOut();
        return;
      }

      // --- Reset Zoom: Ctrl/Cmd + 0 ---
      if (isMod && e.key === '0') {
        e.preventDefault();
        this._handleZoomReset();
        return;
      }

      // --- Find: Ctrl/Cmd + F ---
      if (isMod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (this._els.searchInput) {
          this._els.searchInput.focus();
          this._els.searchInput.select();
        }
        return;
      }

      // --- Go to Page: Ctrl/Cmd + G ---
      if (isMod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (this._els.pageInput) {
          this._els.pageInput.focus();
          this._els.pageInput.select();
        }
        return;
      }

      // --- Toggle Outline: Ctrl/Cmd + Shift + O ---
      if (isMod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        if (this._els.toggleOutlineBtn && !this._els.toggleOutlineBtn.disabled) {
          this._els.toggleOutlineBtn.click();
        }
        return;
      }

      // --- Escape: Clear search ---
      if (e.key === 'Escape') {
        if (this._els.searchInput) {
          this._els.searchInput.value = '';
          this._els.searchInput.blur();
        }
        this._clearSearch();
        return;
      }

      // --- Page Navigation (only when no modifier and not focused on an input) ---
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';

      if (!isInputFocused && !isMod) {
        switch (e.key) {
          case 'PageUp':
            e.preventDefault();
            try {
              const current = this.renderEngine.getCurrentPage();
              this.renderEngine.jumpToPage(current - 1);
            } catch (err) {
              console.error('UIController: PageUp navigation failed:', err);
            }
            return;

          case 'PageDown':
            e.preventDefault();
            try {
              const current = this.renderEngine.getCurrentPage();
              this.renderEngine.jumpToPage(current + 1);
            } catch (err) {
              console.error('UIController: PageDown navigation failed:', err);
            }
            return;

          case 'Home':
            e.preventDefault();
            try {
              this.renderEngine.jumpToPage(0);
            } catch (err) {
              console.error('UIController: Home navigation failed:', err);
            }
            return;

          case 'End':
            e.preventDefault();
            try {
              this.renderEngine.jumpToPage(this.renderEngine.getTotalPages() - 1);
            } catch (err) {
              console.error('UIController: End navigation failed:', err);
            }
            return;
        }
      }
    };

    document.addEventListener('keydown', handler);
    this._boundHandlers.keydown = handler;
  }

  // =================================================================
  // Search System
  // =================================================================

  /**
   * Wire up search input and navigation buttons.
   * @private
   */
  _bindSearchControls() {
    const els = this._els;

    // --- Search input: execute on Enter, navigate next on subsequent Enter ---
    if (els.searchInput) {
      const handler = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = els.searchInput.value.trim();
          if (!query) {
            this._clearSearch();
            return;
          }
          // If query changed, execute new search; otherwise navigate to next
          if (query !== this._lastSearchQuery) {
            this.executeSearch(query);
          } else {
            this.navigateSearch(1);
          }
        }
      };
      els.searchInput.addEventListener('keydown', handler);
      this._boundHandlers['keydown:searchInput'] = handler;
    }

    // --- Previous match ---
    if (els.searchPrevBtn) {
      const handler = () => {
        this.navigateSearch(-1);
      };
      els.searchPrevBtn.addEventListener('click', handler);
      this._boundHandlers['click:searchPrevBtn'] = handler;
    }

    // --- Next match ---
    if (els.searchNextBtn) {
      const handler = () => {
        this.navigateSearch(1);
      };
      els.searchNextBtn.addEventListener('click', handler);
      this._boundHandlers['click:searchNextBtn'] = handler;
    }
  }

  /**
   * Listen for the textExtractionComplete event to enable search.
   * @private
   */
  _bindTextExtractionEvent() {
    const handler = () => {
      if (this._els && this._els.searchInput) {
        this._els.searchInput.disabled = false;
        this._els.searchInput.placeholder = 'Find in document';
        // If user typed a query while extraction was running, execute it now
        const pendingQuery = this._els.searchInput.value.trim();
        if (pendingQuery) {
          this.executeSearch(pendingQuery);
        }
      }
    };

    document.addEventListener('textExtractionComplete', handler);
    this._boundHandlers.textExtractionComplete = handler;
  }

  /**
   * Find all occurrences of query across all pages using the
   * RenderEngine's text cache.
   * @param {string} query - The search query string
   */
  executeSearch(query) {
    const resultText = this._els ? this._els.searchResultText : null;

    this._lastSearchQuery = query;
    this._searchResults = [];
    this._currentSearchIndex = -1;

    if (!query) {
      if (resultText) resultText.textContent = '';
      this.clearHighlights();
      return;
    }

    const textCache = this.renderEngine.getTextCache();
    if (!textCache) {
      if (resultText) resultText.textContent = '0 / 0';
      return;
    }

    const lowerQuery = query.toLowerCase();

    for (let i = 0; i < textCache.length; i++) {
      const pageText = textCache[i];
      if (!pageText) continue;

      let pos = pageText.indexOf(lowerQuery);
      while (pos !== -1) {
        this._searchResults.push({ pageIndex: i, textIndex: pos });
        pos = pageText.indexOf(lowerQuery, pos + 1);
      }
    }

    if (this._searchResults.length > 0) {
      this.navigateSearch(1); // Jump to first result
    } else {
      if (resultText) resultText.textContent = '0 / 0';
      this.clearHighlights();
    }
  }

  /**
   * Navigate through search results.
   * @param {number} direction - +1 for next, -1 for previous
   */
  navigateSearch(direction) {
    if (this._searchResults.length === 0) return;

    if (direction === 1) {
      this._currentSearchIndex = (this._currentSearchIndex + 1) % this._searchResults.length;
    } else {
      this._currentSearchIndex =
        (this._currentSearchIndex - 1 + this._searchResults.length) % this._searchResults.length;
    }

    // Update result counter display
    const resultText = this._els ? this._els.searchResultText : null;
    if (resultText) {
      resultText.textContent = `${this._currentSearchIndex + 1} / ${this._searchResults.length}`;
    }

    // Jump to the page containing the current result
    const result = this._searchResults[this._currentSearchIndex];
    try {
      this.renderEngine.jumpToPage(result.pageIndex);
    } catch (err) {
      console.error('UIController: navigateSearch jumpToPage failed:', err);
    }

    // Highlight with a short delay to allow the page to render
    this.highlightCurrentSearchResult();
  }

  /**
   * Highlight all search matches on the current result's page in the
   * rendered text layer. The active match gets an orange background,
   * all others get yellow.
   */
  highlightCurrentSearchResult() {
    if (!this._searchResults || this._searchResults.length === 0) return;

    const result = this._searchResults[this._currentSearchIndex];
    if (!result) return;

    const pageIndex = result.pageIndex;
    const query = this._lastSearchQuery.toLowerCase();

    // Determine which occurrence on this page is the active one
    let localMatchIndex = 0;
    for (let i = 0; i < this._currentSearchIndex; i++) {
      if (this._searchResults[i].pageIndex === pageIndex) {
        localMatchIndex++;
      }
    }

    // Wait for the page to be rendered before highlighting
    this._waitForPageRendered(pageIndex, () => {
      const container = document.querySelector(
        `.page-container[data-page-index="${pageIndex}"]`
      );
      if (!container) return;

      const textLayer = container.querySelector('.text-layer');
      if (!textLayer) return;

      // Clear existing highlights across the entire document
      this.clearHighlights();

      // Walk all text nodes in the text layer
      const treeWalker = document.createTreeWalker(
        textLayer,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const nodesToHighlight = [];
      let node;
      while ((node = treeWalker.nextNode())) {
        if (node.nodeValue.toLowerCase().includes(query)) {
          nodesToHighlight.push(node);
        }
      }

      let currentLocalCounter = 0;
      let activeMark = null;

      for (const textNode of nodesToHighlight) {
        const parent = textNode.parentNode;
        if (!parent) continue;

        const text = textNode.nodeValue;
        const lowerText = text.toLowerCase();
        let matchIndex = lowerText.indexOf(query);

        if (matchIndex === -1) continue;

        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        // Highlight all occurrences within this text node
        while (matchIndex !== -1) {
          // Add text before the match
          if (matchIndex > lastIdx) {
            frag.appendChild(document.createTextNode(text.substring(lastIdx, matchIndex)));
          }

          const mark = document.createElement('mark');
          mark.className = 'search-highlight';

          if (currentLocalCounter === localMatchIndex) {
            // Active match: orange
            mark.style.backgroundColor = '#FF9800';
            mark.style.color = '#fff';
            mark.style.outline = '2px solid #FF9800';
            mark.style.outlineOffset = '1px';
            mark.style.borderRadius = '2px';
            activeMark = mark;
          } else {
            // Other matches: yellow
            mark.style.backgroundColor = 'rgba(255, 255, 0, 0.6)';
            mark.style.color = '#000';
          }

          mark.textContent = text.substring(matchIndex, matchIndex + query.length);
          frag.appendChild(mark);

          currentLocalCounter++;
          lastIdx = matchIndex + query.length;
          matchIndex = lowerText.indexOf(query, lastIdx);
        }

        // Add remaining text after the last match
        if (lastIdx < text.length) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx)));
        }

        parent.replaceChild(frag, textNode);
      }

      // Scroll the active match into view
      if (activeMark) {
        activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  /**
   * Remove all search highlight <mark> elements and restore original text nodes.
   */
  clearHighlights() {
    try {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    } catch (e) {
      // Ignore selection errors
    }

    const marks = document.querySelectorAll('mark.search-highlight');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
  }

  /**
   * Clear current search state and highlights.
   * @private
   */
  _clearSearch() {
    this._lastSearchQuery = '';
    this._searchResults = [];
    this._currentSearchIndex = -1;
    this.clearHighlights();

    if (this._els && this._els.searchResultText) {
      this._els.searchResultText.textContent = '';
    }
  }

  /**
   * Wait for a page to be rendered, then invoke callback.
   * Uses polling with a timeout guard to avoid infinite waits.
   * @param {number} pageIndex - 0-based page index
   * @param {Function} callback - Invoked once the page is rendered
   * @private
   */
  _waitForPageRendered(pageIndex, callback) {
    // If already rendered, invoke immediately
    if (this.renderEngine.isPageRendered(pageIndex)) {
      callback();
      return;
    }

    // Ensure the page gets rendered
    try {
      this.renderEngine.ensurePageRendered(pageIndex);
    } catch (err) {
      console.warn('UIController: ensurePageRendered failed:', err);
    }

    // Poll until rendered or timeout (5 seconds)
    let elapsed = 0;
    const pollInterval = 100;
    const maxWait = 5000;

    const checkInterval = setInterval(() => {
      elapsed += pollInterval;
      if (this.renderEngine.isPageRendered(pageIndex)) {
        clearInterval(checkInterval);
        callback();
      } else if (elapsed >= maxWait) {
        clearInterval(checkInterval);
        console.warn(`UIController: Timed out waiting for page ${pageIndex + 1} to render`);
      }
    }, pollInterval);
  }

  // =================================================================
  // Floating Page Indicator
  // =================================================================

  /**
   * Create the floating page indicator element and inject it into the
   * main preview area.
   * @private
   */
  _createPageIndicator() {
    const mainPreview = this._els.mainPreview;
    if (!mainPreview) return;

    // Look for an existing indicator first (avoid duplicates)
    let indicator = document.getElementById('pageIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pageIndicator';
      indicator.className = 'page-indicator';
      indicator.setAttribute('aria-live', 'polite');
      indicator.setAttribute('aria-atomic', 'true');
      indicator.textContent = 'Page 1 of 1';

      // Insert as a sibling of mainPreview inside .preview-area
      const previewArea = mainPreview.parentElement;
      if (previewArea) {
        previewArea.style.position = 'relative';
        previewArea.appendChild(indicator);
      }
    }

    this._pageIndicator = indicator;
  }

  /**
   * Show the floating page indicator with updated text, then fade it
   * after 1.5 seconds of no further calls.
   * @param {number} currentPage - 0-based page index
   * @param {number} totalPages
   * @private
   */
  _showPageIndicator(currentPage, totalPages) {
    if (!this._pageIndicator) return;

    this._pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    this._pageIndicator.classList.add('visible');

    // Clear any pending fade timer
    if (this._indicatorFadeTimer) {
      clearTimeout(this._indicatorFadeTimer);
    }

    // Fade out after 1.5 seconds of no scroll
    this._indicatorFadeTimer = setTimeout(() => {
      if (this._pageIndicator) {
        this._pageIndicator.classList.remove('visible');
      }
      this._indicatorFadeTimer = null;
    }, 1500);
  }

  // =================================================================
  // Scroll Synchronization
  // =================================================================

  /**
   * Bind the scroll event on mainPreview to sync page input, thumbnail
   * highlight, and the floating page indicator.
   * @private
   */
  _bindScrollSync() {
    const mainPreview = this._els.mainPreview;
    if (!mainPreview) return;

    const handler = () => {
      try {
        const currentPage = this.renderEngine.getCurrentPage();
        const totalPages = this.renderEngine.getTotalPages();

        // Page indicator updates immediately (no debounce)
        this._showPageIndicator(currentPage, totalPages);

        // Debounce thumbnail and page input updates (80ms)
        if (this._scrollDebounceTimer) {
          clearTimeout(this._scrollDebounceTimer);
        }

        this._scrollDebounceTimer = setTimeout(() => {
          this._scrollDebounceTimer = null;

          try {
            const latestPage = this.renderEngine.getCurrentPage();

            // Update page input
            this._updatePageInfo(latestPage, totalPages);

            // Sync active thumbnail
            if (this.thumbnailManager && typeof this.thumbnailManager.setActiveIndex === 'function') {
              this.thumbnailManager.setActiveIndex(latestPage);
            }

            // Sync active outline item
            if (this.outlineManager && typeof this.outlineManager.setActivePage === 'function') {
              this.outlineManager.setActivePage(latestPage);
            }
          } catch (err) {
            console.error('UIController: Debounced scroll sync failed:', err);
          }
        }, 80);
      } catch (err) {
        console.error('UIController: Scroll handler failed:', err);
      }
    };

    mainPreview.addEventListener('scroll', handler, { passive: true });
    this._boundHandlers.scroll = handler;
  }

  // =================================================================
  // Zoom Helpers
  // =================================================================

  /**
   * Handle zoom in from keyboard shortcut.
   * @private
   */
  _handleZoomIn() {
    try {
      const currentScale = this.renderEngine.getScale();
      const currentPage = this.renderEngine.getCurrentPage();
      this.renderEngine.setScale(currentScale + 0.25);
      this._updateZoomDisplay();
      requestAnimationFrame(() => {
        this.renderEngine.jumpToPage(currentPage, 'auto');
      });
    } catch (err) {
      console.error('UIController: Keyboard zoom in failed:', err);
    }
  }

  /**
   * Handle zoom out from keyboard shortcut.
   * @private
   */
  _handleZoomOut() {
    try {
      const currentScale = this.renderEngine.getScale();
      const currentPage = this.renderEngine.getCurrentPage();
      this.renderEngine.setScale(currentScale - 0.25);
      this._updateZoomDisplay();
      requestAnimationFrame(() => {
        this.renderEngine.jumpToPage(currentPage, 'auto');
      });
    } catch (err) {
      console.error('UIController: Keyboard zoom out failed:', err);
    }
  }

  /**
   * Reset zoom to 100%.
   * @private
   */
  _handleZoomReset() {
    try {
      const currentPage = this.renderEngine.getCurrentPage();
      this.renderEngine.setScale(1.0);
      this._updateZoomDisplay();
      requestAnimationFrame(() => {
        this.renderEngine.jumpToPage(currentPage, 'auto');
      });
    } catch (err) {
      console.error('UIController: Zoom reset failed:', err);
    }
  }

  /**
   * Update the zoom level text display.
   * @private
   */
  _updateZoomDisplay() {
    if (this._els && this._els.zoomLevelText) {
      const scale = this.renderEngine.getScale();
      this._els.zoomLevelText.textContent = Math.round(scale * 100) + '%';
    }
  }

  // =================================================================
  // Page Info Helpers
  // =================================================================

  /**
   * Update the page input value and page count text.
   * @param {number} currentPage - 0-based page index
   * @param {number} totalPages
   * @private
   */
  _updatePageInfo(currentPage, totalPages) {
    if (!this._els) return;

    if (this._els.pageInput) {
      const displayPage = currentPage + 1;
      // Only update if value differs to avoid disrupting user typing
      if (parseInt(this._els.pageInput.value, 10) !== displayPage) {
        this._els.pageInput.value = displayPage;
      }
    }

    if (this._els.pageCountText) {
      this._els.pageCountText.textContent = `/ ${totalPages}`;
    }
  }
}
