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
   * @param {Function} [options.onScrollSettle] - Callback invoked when scroll position settles (for auto-save)
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

    /** @type {Function|null} */
    this.onScrollSettle = options.onScrollSettle || null;

    /** @type {AnnotationManager|null} */
    this.annotationManager = options.annotationManager || null;

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

    /** @type {boolean} */
    this._initialized = false;

    // ponytail: TTS uses native Web Speech API, no dependencies
    this._ttsActive = false;
    this._focusMode = false;
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
    this._bindAnnotationControls();
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

    // Remove scroll handler
    const mainPreview = this._els.mainPreview;

    // Remove text extraction listener

    // Remove toolbar button listeners (cloneNode trick not needed — we
    // stored references, so we use removeEventListener)

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

    // Stop TTS if active
    if (this._ttsActive) {
      window.speechSynthesis.cancel();
      this._ttsActive = false;
    }
    this._focusMode = false;

    this._els = null;
    this._initialized = false;
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
      mainPreview: document.getElementById('mainPreview'),
      bookmarkBtn: document.getElementById('bookmarkBtn'),
      toggleBookmarksBtn: document.getElementById('toggleBookmarksBtn'),
      bookmarksContainer: document.getElementById('bookmarksContainer'),
      bookmarksList: document.getElementById('bookmarksList'),
      bookmarksEmpty: document.getElementById('bookmarksEmpty'),
      ttsBtn: document.getElementById('ttsBtn'),
      focusModeBtn: document.getElementById('focusModeBtn'),
      readingProgressBar: document.getElementById('readingProgressBar'),
      toolSelectBtn: document.getElementById('toolSelectBtn'),
      toolDrawBtn: document.getElementById('toolDrawBtn'),
      toolHighlightBtn: document.getElementById('toolHighlightBtn'),
      toolTextBtn: document.getElementById('toolTextBtn'),
      toolEraserBtn: document.getElementById('toolEraserBtn'),
      toolColorPicker: document.getElementById('toolColorPicker'),
      exportPdfBtn: document.getElementById('exportPdfBtn')
    };
  }

  /**
   * Wire up annotation toolbar controls and tool state.
   * @private
   */
  _bindAnnotationControls() {
    const els = this._els;
    if (!this.annotationManager) return;

    const tools = [
      { btn: els.toolSelectBtn, name: 'select' },
      { btn: els.toolDrawBtn, name: 'draw' },
      { btn: els.toolHighlightBtn, name: 'highlight' },
      { btn: els.toolTextBtn, name: 'text' },
      { btn: els.toolEraserBtn, name: 'eraser' }
    ];

    tools.forEach(({ btn, name }) => {
      if (btn) {
        btn.addEventListener('click', () => {
          tools.forEach(t => t.btn?.classList.remove('active'));
          btn.classList.add('active');
          this.annotationManager.setTool(name);
        });
      }
    });

    if (els.toolColorPicker) {
      els.toolColorPicker.addEventListener('input', (e) => {
        this.annotationManager.setColor(e.target.value);
      });
    }

    if (els.exportPdfBtn) {
      els.exportPdfBtn.addEventListener('click', () => {
        PDFExportManager.exportViaPrint();
      });
    }
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
      
    }

    // --- Toggle Bookmarks Sidebar ---
    if (els.toggleBookmarksBtn) {
      const handler = () => {
        try {
          const isCurrentlyShowingBookmarks = els.bookmarksContainer && els.bookmarksContainer.style.display !== 'none';
          const isSidebarOpen = els.sidebarPanel && !els.sidebarPanel.classList.contains('collapsed');

          if (isCurrentlyShowingBookmarks && isSidebarOpen) {
            els.sidebarPanel.classList.add('collapsed');
            els.toggleBookmarksBtn.classList.remove('active');
          } else {
            if (els.bookmarksContainer) els.bookmarksContainer.style.display = '';
            if (els.thumbnailContainer) els.thumbnailContainer.style.display = 'none';
            if (els.outlineContainer) els.outlineContainer.style.display = 'none';
            if (els.sidebarPanel) els.sidebarPanel.classList.remove('collapsed');
            els.toggleBookmarksBtn.classList.add('active');
            if (els.toggleThumbnailsBtn) els.toggleThumbnailsBtn.classList.remove('active');
            if (els.toggleOutlineBtn) els.toggleOutlineBtn.classList.remove('active');
          }
        } catch (err) {
          console.error('UIController: Toggle bookmarks failed:', err);
        }
      };
      els.toggleBookmarksBtn.addEventListener('click', handler);
      
    }

    // --- Bookmark Current Page ---
    if (els.bookmarkBtn) {
      const handler = () => {
        this._toggleBookmark();
      };
      els.bookmarkBtn.addEventListener('click', handler);
      
    }

    // --- Text-to-Speech ---
    if (els.ttsBtn) {
      const handler = () => this._toggleTTS();
      els.ttsBtn.addEventListener('click', handler);
      
    }

    // --- Focus Mode ---
    if (els.focusModeBtn) {
      const handler = () => this._toggleFocusMode();
      els.focusModeBtn.addEventListener('click', handler);
      
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

      // --- Bookmark Page: Ctrl/Cmd + D ---
      if (isMod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this._toggleBookmark();
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
          case 't':
          case 'T':
            this._toggleTTS();
            return;

          case 'f':
          case 'F':
            this._toggleFocusMode();
            return;

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

    // --- Search input: execute on Enter, navigate next (or prev with Shift) on Enter ---
    if (els.searchInput) {
      const handler = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = els.searchInput.value.trim();
          if (!query) {
            this._clearSearch();
            return;
          }
          // If query changed, execute new search; otherwise navigate
          if (query !== this._lastSearchQuery) {
            this.executeSearch(query);
          } else {
            this.navigateSearch(e.shiftKey ? -1 : 1);
          }
        }
      };
      els.searchInput.addEventListener('keydown', handler);
    }

    // --- Previous match ---
    if (els.searchPrevBtn) {
      const handler = () => {
        this.navigateSearch(-1);
      };
      els.searchPrevBtn.addEventListener('click', handler);
    }

    // --- Next match ---
    if (els.searchNextBtn) {
      const handler = () => {
        this.navigateSearch(1);
      };
      els.searchNextBtn.addEventListener('click', handler);
    }
  }

  /**
   * Listen for text extraction and page rendering events.
   * @private
   */
  _bindTextExtractionEvent() {
    // When initial text extraction finishes across document
    document.addEventListener('textExtractionComplete', () => {
      if (this._els && this._els.searchInput) {
        this._els.searchInput.disabled = false;
        this._els.searchInput.placeholder = 'Find in document';
        const pendingQuery = this._els.searchInput.value.trim();
        if (pendingQuery) {
          this.executeSearch(pendingQuery);
        }
      }
    });

    // When an individual page text layer completes rendering during scroll
    document.addEventListener('pageTextLayerRendered', (e) => {
      if (this._lastSearchQuery && e.detail && typeof e.detail.pageIndex === 'number') {
        this.highlightPage(e.detail.pageIndex);
      }
    });
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
      let matchCountOnPage = 0;
      while (pos !== -1) {
        this._searchResults.push({
          pageIndex: i,
          matchIndexOnPage: matchCountOnPage
        });
        matchCountOnPage++;
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

    // Wait for page to render and highlight all rendered pages
    this._waitForPageRendered(result.pageIndex, () => {
      this.highlightAllRenderedPages();
    });
  }

  /**
   * Highlight search results across all currently rendered page containers.
   */
  highlightAllRenderedPages() {
    const query = this._lastSearchQuery ? this._lastSearchQuery.trim() : '';
    if (!query) {
      this.clearHighlights();
      return;
    }

    const renderedContainers = document.querySelectorAll('.page-container[data-page-index]');
    renderedContainers.forEach((container) => {
      const pageIndex = parseInt(container.getAttribute('data-page-index'), 10);
      if (!isNaN(pageIndex)) {
        this.highlightPage(pageIndex);
      }
    });
  }

  /**
   * Alias for backward compatibility.
   */
  highlightCurrentSearchResult() {
    this.highlightAllRenderedPages();
  }

  /**
   * Highlight search matches on a specific page using character-offset DOM range mapping.
   * @param {number} pageIndex - 0-based page index
   */
  highlightPage(pageIndex) {
    const container = document.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
    if (!container) return;

    const textLayer = container.querySelector('.text-layer');
    if (!textLayer) return;

    // Clear existing highlights on this text layer first
    this.clearHighlights(textLayer);

    const query = this._lastSearchQuery ? this._lastSearchQuery.trim() : '';
    if (!query) return;

    const lowerQuery = query.toLowerCase();

    // 1. Collect all DOM Text nodes inside textLayer
    const treeWalker = document.createTreeWalker(
      textLayer,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while ((node = treeWalker.nextNode())) {
      if (node.nodeValue) {
        textNodes.push(node);
      }
    }

    if (textNodes.length === 0) return;

    // 2. Build full concatenated page text and character mapping
    let pageFullText = '';
    const nodeMap = [];

    for (const textNode of textNodes) {
      const val = textNode.nodeValue;
      const start = pageFullText.length;
      pageFullText += val;
      const end = pageFullText.length;
      nodeMap.push({ node: textNode, start, end, text: val });
    }

    const lowerFullText = pageFullText.toLowerCase();

    // 3. Find all occurrence ranges in pageFullText
    const matches = [];
    let pos = lowerFullText.indexOf(lowerQuery);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + lowerQuery.length });
      pos = lowerFullText.indexOf(lowerQuery, pos + 1);
    }

    if (matches.length === 0) return;

    // Determine active match for this page
    const currentResult = this._searchResults[this._currentSearchIndex];
    const activeMatchIndexOnPage =
      currentResult && currentResult.pageIndex === pageIndex
        ? currentResult.matchIndexOnPage
        : -1;

    let activeMarkElement = null;

    // 4. Map matches onto DOM text nodes
    for (const mapItem of nodeMap) {
      const { node: textNode, start: nodeStart, end: nodeEnd, text } = mapItem;

      const overlapping = [];
      for (let mIdx = 0; mIdx < matches.length; mIdx++) {
        const m = matches[mIdx];
        if (m.end > nodeStart && m.start < nodeEnd) {
          overlapping.push({
            mIdx,
            isActive: mIdx === activeMatchIndexOnPage,
            sliceStart: Math.max(0, m.start - nodeStart),
            sliceEnd: Math.min(text.length, m.end - nodeStart)
          });
        }
      }

      if (overlapping.length === 0) continue;

      const parent = textNode.parentNode;
      if (!parent) continue;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;

      for (const ov of overlapping) {
        if (ov.sliceStart > lastIdx) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx, ov.sliceStart)));
        }

        const mark = document.createElement('mark');
        mark.className = ov.isActive
          ? 'search-highlight active-search-highlight'
          : 'search-highlight';
        mark.textContent = text.substring(ov.sliceStart, ov.sliceEnd);

        if (ov.isActive) {
          activeMarkElement = mark;
        }

        frag.appendChild(mark);
        lastIdx = ov.sliceEnd;
      }

      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      }

      parent.replaceChild(frag, textNode);
    }

    // Scroll active match into view if on this page
    if (activeMarkElement) {
      activeMarkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Remove all search highlight <mark> elements and restore original text nodes.
   * @param {Element|Document} [target=document] - Element scope to clear
   */
  clearHighlights(target = document) {
    try {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    } catch (e) {
      // Ignore selection errors
    }

    const scope = target || document;
    const marks = scope.querySelectorAll('mark.search-highlight');
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

        // Progress bar
        this._updateProgressBar(currentPage, totalPages);

        // Focus mode: highlight current page
        if (this._focusMode) {
          this._updateFocusPage(currentPage);
        }
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

            // Sync bookmark button state for current page
            const app = window.pdfDarkMode;
            if (app && app.docHash) {
              StorageManager.load(app.docHash).then(saved => {
                this._updateBookmarkButton(latestPage, saved?.bookmarks || []);
              });
            }

            // Notify app for auto-save
            if (typeof this.onScrollSettle === 'function') {
              this.onScrollSettle();
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

  // =================================================================
  // Bookmarks
  // =================================================================

  // ponytail: bookmarks are just page numbers in a sorted array, no labels, no categories
  _toggleBookmark() {
    if (!this.renderEngine) return;
    const page = this.renderEngine.getCurrentPage();
    const app = window.pdfDarkMode;
    if (!app || !app.docHash) return;

    StorageManager.load(app.docHash).then(saved => {
      const state = saved || { page: 0, theme: 'claude', zoom: 1.0, rotation: 0, bookmarks: [] };
      const bookmarks = state.bookmarks || [];
      const idx = bookmarks.indexOf(page);

      if (idx === -1) {
        bookmarks.push(page);
        bookmarks.sort((a, b) => a - b);
      } else {
        bookmarks.splice(idx, 1);
      }

      state.bookmarks = bookmarks;
      StorageManager.save(app.docHash, state);
      this._renderBookmarks(bookmarks);
      this._updateBookmarkButton(page, bookmarks);
    });
  }

  _renderBookmarks(bookmarks) {
    const list = this._els?.bookmarksList;
    const empty = this._els?.bookmarksEmpty;
    if (!list) return;

    list.innerHTML = '';
    if (!bookmarks || bookmarks.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    const currentPage = this.renderEngine ? this.renderEngine.getCurrentPage() : -1;

    for (const page of bookmarks) {
      const item = document.createElement('div');
      item.className = 'bookmark-item' + (page === currentPage ? ' active' : '');

      const label = document.createElement('span');
      label.className = 'bookmark-page';
      label.textContent = `Page ${page + 1}`;

      const del = document.createElement('button');
      del.className = 'bookmark-delete';
      del.textContent = '×';
      del.title = 'Remove bookmark';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const app = window.pdfDarkMode;
        if (!app || !app.docHash) return;
        StorageManager.load(app.docHash).then(saved => {
          if (!saved) return;
          saved.bookmarks = (saved.bookmarks || []).filter(b => b !== page);
          StorageManager.save(app.docHash, saved);
          this._renderBookmarks(saved.bookmarks);
          this._updateBookmarkButton(this.renderEngine.getCurrentPage(), saved.bookmarks);
        });
      });

      item.addEventListener('click', () => {
        this.renderEngine.jumpToPage(page);
      });

      item.appendChild(label);
      item.appendChild(del);
      list.appendChild(item);
    }
  }

  _updateBookmarkButton(currentPage, bookmarks) {
    const btn = this._els?.bookmarkBtn;
    if (!btn) return;
    if (bookmarks && bookmarks.includes(currentPage)) {
      btn.classList.add('bookmarked');
      btn.title = 'Remove bookmark (Ctrl+D)';
    } else {
      btn.classList.remove('bookmarked');
      btn.title = 'Bookmark this page (Ctrl+D)';
    }
  }

  // Load and render bookmarks from storage (called from app.js after init)
  loadBookmarks() {
    const app = window.pdfDarkMode;
    if (!app || !app.docHash) return;
    StorageManager.load(app.docHash).then(saved => {
      const bookmarks = saved?.bookmarks || [];
      this._renderBookmarks(bookmarks);
      if (this.renderEngine) {
        this._updateBookmarkButton(this.renderEngine.getCurrentPage(), bookmarks);
      }
    });
  }

  // =================================================================
  // Text-to-Speech (ponytail: native Web Speech API, zero dependencies)
  // =================================================================

  _toggleTTS() {
    if (this._ttsActive) {
      window.speechSynthesis.cancel();
      this._ttsActive = false;
      if (this._els?.ttsBtn) this._els.ttsBtn.classList.remove('tts-active');
      return;
    }

    if (!this.renderEngine) return;
    const textCache = this.renderEngine.getTextCache();
    const currentPage = this.renderEngine.getCurrentPage();
    if (!textCache || !textCache[currentPage]) return;

    const text = textCache[currentPage];
    if (!text.trim()) return;

    const utterance = new SpeechSynthesisUtterance(text);
    // ponytail: browser default voice, default rate. Add controls when users ask.
    utterance.onend = () => {
      this._ttsActive = false;
      if (this._els?.ttsBtn) this._els.ttsBtn.classList.remove('tts-active');
    };
    utterance.onerror = () => {
      this._ttsActive = false;
      if (this._els?.ttsBtn) this._els.ttsBtn.classList.remove('tts-active');
    };

    this._ttsActive = true;
    if (this._els?.ttsBtn) this._els.ttsBtn.classList.add('tts-active');
    window.speechSynthesis.speak(utterance);
  }

  // =================================================================
  // Focus Mode (ponytail: pure CSS, dims non-active pages)
  // =================================================================

  _toggleFocusMode() {
    this._focusMode = !this._focusMode;
    const mainPreview = this._els?.mainPreview;
    const btn = this._els?.focusModeBtn;

    if (this._focusMode) {
      if (mainPreview) mainPreview.classList.add('focus-mode');
      if (btn) btn.classList.add('focus-active');
      if (this.renderEngine) {
        this._updateFocusPage(this.renderEngine.getCurrentPage());
      }
    } else {
      if (mainPreview) mainPreview.classList.remove('focus-mode');
      if (btn) btn.classList.remove('focus-active');
      // Remove all focus-active from pages
      document.querySelectorAll('.page-container.focus-active').forEach(el => {
        el.classList.remove('focus-active');
      });
    }
  }

  _updateFocusPage(currentPage) {
    document.querySelectorAll('.page-container.focus-active').forEach(el => {
      el.classList.remove('focus-active');
    });
    const active = document.querySelector(`.page-container[data-page-index="${currentPage}"]`);
    if (active) active.classList.add('focus-active');
  }

  // =================================================================
  // Reading Progress Bar (ponytail: one div, CSS width transition)
  // =================================================================

  _updateProgressBar(currentPage, totalPages) {
    const bar = this._els?.readingProgressBar;
    if (!bar || totalPages <= 1) return;
    const pct = ((currentPage + 1) / totalPages) * 100;
    bar.style.width = pct + '%';
  }
}
