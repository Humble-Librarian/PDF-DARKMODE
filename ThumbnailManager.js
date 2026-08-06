// ============================================================
// ThumbnailManager.js — Lazy-Loading Thumbnail Sidebar
// Renders low-res PDF page thumbnails on demand using
// IntersectionObserver, with CSS dark mode and active tracking.
// ============================================================

class ThumbnailManager {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - The #thumbnailContainer element
   * @param {HTMLElement} options.sidebarElement - The #sidebarPanel element (scroll root)
   * @param {Object} options.pdfDocument - PDF.js document instance
   * @param {DarkModeProcessor} options.darkModeProcessor - DarkModeProcessor instance
   * @param {string} options.theme - Current theme name
   * @param {Function} options.onThumbnailClick - Callback(pageIndex) when a thumbnail is clicked
   */
  constructor(options) {
    /** @type {HTMLElement} */
    this.container = options.container;

    /** @type {HTMLElement} */
    this.sidebarElement = options.sidebarElement;

    /** @type {Object} */
    this.pdfDocument = options.pdfDocument;

    /** @type {DarkModeProcessor} */
    this.darkModeProcessor = options.darkModeProcessor;

    /** @type {string} */
    this.currentTheme = options.theme || 'claude';

    /** @type {Function|null} */
    this.onThumbnailClick = options.onThumbnailClick || null;

    /** @type {number} */
    this.totalPages = this.pdfDocument.numPages;

    /**
     * Render scale for thumbnails — deliberately low-res to keep
     * memory usage minimal and avoid competing with the main viewport.
     * @type {number}
     */
    this.THUMBNAIL_SCALE = 0.3;

    /**
     * Maximum number of concurrent thumbnail renders.
     * Kept to 1 so the main RenderEngine always wins the GPU.
     * @type {number}
     */
    this.MAX_CONCURRENT = 1;

    // ---- Internal state ----

    /** @type {IntersectionObserver|null} */
    this._observer = null;

    /**
     * Tracks which pages have been fully rendered.
     * pageIndex → true
     * @type {Set<number>}
     */
    this._renderedPages = new Set();

    /**
     * Tracks which pages are currently queued or rendering.
     * Prevents duplicate work.
     * @type {Set<number>}
     */
    this._pendingPages = new Set();

    /** @type {number} */
    this._activeRenders = 0;

    /**
     * FIFO queue of page indices waiting to be rendered.
     * @type {number[]}
     */
    this._renderQueue = [];

    /**
     * Currently highlighted thumbnail index (-1 = none).
     * @type {number}
     */
    this._activeIndex = -1;

    /**
     * Monotonically increasing ID to detect stale renders
     * after destroy() or rapid re-init.
     * @type {number}
     */
    this._generationId = 0;

    /**
     * Bound click handler reference for cleanup.
     * @type {Function|null}
     */
    this._boundClickHandler = null;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Initialize the thumbnail sidebar.
   * Creates placeholder DOM for every page and attaches an
   * IntersectionObserver to lazily render visible thumbnails.
   */
  async init() {
    this._generationId++;

    this.container.innerHTML = '';
    this._renderedPages.clear();
    this._pendingPages.clear();
    this._renderQueue = [];
    this._activeRenders = 0;
    this._activeIndex = -1;

    // Build placeholder DOM
    this._buildPlaceholders();

    // Attach click delegation on the container
    this._boundClickHandler = this._handleClick.bind(this);
    this.container.addEventListener('click', this._boundClickHandler);

    // Set up IntersectionObserver rooted on the sidebar panel
    this._setupObserver();
  }

  /**
   * Highlight the thumbnail for the given page and scroll it into view.
   * @param {number} pageIndex - 0-based page index
   */
  setActiveIndex(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.totalPages) return;
    if (pageIndex === this._activeIndex) return;

    // Remove previous highlight
    if (this._activeIndex >= 0) {
      const prevItem = this.container.querySelector(`#thumbnail-${this._activeIndex}`);
      if (prevItem) {
        const prevFrame = prevItem.querySelector('.thumbnail-frame');
        if (prevFrame) {
          prevFrame.classList.remove('active');
        }
      }
    }

    // Apply new highlight
    this._activeIndex = pageIndex;
    const item = this.container.querySelector(`#thumbnail-${pageIndex}`);
    if (!item) return;

    const frame = item.querySelector('.thumbnail-frame');
    if (frame) {
      frame.classList.add('active');
    }

    // Scroll the sidebar so this thumbnail is visible
    this._scrollToThumbnail(item);
  }

  /**
   * Update the CSS dark mode theme on all already-rendered thumbnails.
   * This only swaps the CSS filter — no re-render needed.
   * @param {string} themeName - Theme key from DarkModeProcessor
   */
  setTheme(themeName) {
    this.currentTheme = themeName;

    for (const pageIndex of this._renderedPages) {
      const item = this.container.querySelector(`#thumbnail-${pageIndex}`);
      if (!item) continue;

      const wrapper = item.querySelector('.thumbnail-wrapper');
      if (wrapper) {
        this.darkModeProcessor.applyCSSDarkMode(wrapper, themeName);
      }
    }
  }

  /**
   * Tear down observers, event listeners, and DOM content.
   * Safe to call multiple times.
   */
  destroy() {
    this._generationId++;

    // Disconnect observer
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }

    // Remove click listener
    if (this._boundClickHandler) {
      this.container.removeEventListener('click', this._boundClickHandler);
      this._boundClickHandler = null;
    }

    // Clear queues
    this._renderQueue = [];
    this._pendingPages.clear();
    this._renderedPages.clear();
    this._activeRenders = 0;
    this._activeIndex = -1;

    // Clear DOM
    this.container.innerHTML = '';
  }

  // ---------------------------------------------------------------
  // Placeholder Construction
  // ---------------------------------------------------------------

  /**
   * Build the full list of thumbnail placeholders.
   * Uses a DocumentFragment for a single reflow.
   * @private
   */
  _buildPlaceholders() {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < this.totalPages; i++) {
      const item = this._createThumbnailItem(i);
      fragment.appendChild(item);
    }

    this.container.appendChild(fragment);
  }

  /**
   * Create the DOM structure for a single thumbnail item
   * with a loading placeholder.
   * @param {number} pageIndex - 0-based page index
   * @returns {HTMLElement}
   * @private
   */
  _createThumbnailItem(pageIndex) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.pageIndex = pageIndex;
    item.id = `thumbnail-${pageIndex}`;

    // Frame (receives the 'active' class for highlighting)
    const frame = document.createElement('div');
    frame.className = 'thumbnail-frame';

    // Placeholder shown until the page is rendered
    const placeholder = document.createElement('div');
    placeholder.className = 'thumbnail-placeholder';
    const dots = document.createElement('span');
    dots.textContent = '...';
    placeholder.appendChild(dots);
    frame.appendChild(placeholder);

    item.appendChild(frame);

    // Page number label (1-based)
    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.textContent = String(pageIndex + 1);
    item.appendChild(label);

    return item;
  }

  // ---------------------------------------------------------------
  // IntersectionObserver Setup
  // ---------------------------------------------------------------

  /**
   * Attach an IntersectionObserver to each thumbnail item.
   * Root is the sidebar panel with a generous 200px pre-load margin.
   * @private
   */
  _setupObserver() {
    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const pageIndex = parseInt(entry.target.dataset.pageIndex, 10);
          if (isNaN(pageIndex)) continue;

          // Already rendered or in-flight — skip
          if (this._renderedPages.has(pageIndex) || this._pendingPages.has(pageIndex)) {
            continue;
          }

          this._enqueueRender(pageIndex);
        }
      },
      {
        root: this.sidebarElement,
        rootMargin: '200px 0px',
        threshold: 0.01
      }
    );

    // Observe every thumbnail item
    const items = this.container.querySelectorAll('.thumbnail-item');
    items.forEach((el) => this._observer.observe(el));
  }

  // ---------------------------------------------------------------
  // Render Queue
  // ---------------------------------------------------------------

  /**
   * Add a page index to the render queue.
   * @param {number} pageIndex
   * @private
   */
  _enqueueRender(pageIndex) {
    if (this._pendingPages.has(pageIndex) || this._renderedPages.has(pageIndex)) return;

    this._pendingPages.add(pageIndex);
    this._renderQueue.push(pageIndex);
    this._processQueue();
  }

  /**
   * Drain the render queue respecting MAX_CONCURRENT.
   * Each render is fire-and-forget; the finally block re-enters
   * _processQueue to pick up the next item.
   * @private
   */
  _processQueue() {
    while (this._activeRenders < this.MAX_CONCURRENT && this._renderQueue.length > 0) {
      const pageIndex = this._renderQueue.shift();

      // Guard: may have been rendered or cancelled in the interim
      if (this._renderedPages.has(pageIndex)) {
        this._pendingPages.delete(pageIndex);
        continue;
      }

      this._activeRenders++;

      this._renderThumbnail(pageIndex)
        .catch((err) => {
          // RenderingCancelledException is expected on destroy / rapid scroll
          if (err && err.name !== 'RenderingCancelledException') {
            console.warn(`ThumbnailManager: render error for page ${pageIndex + 1}:`, err);
          }
        })
        .finally(() => {
          this._activeRenders--;
          this._pendingPages.delete(pageIndex);
          this._processQueue();
        });
    }
  }

  // ---------------------------------------------------------------
  // Thumbnail Rendering
  // ---------------------------------------------------------------

  /**
   * Render a single PDF page at low resolution into its thumbnail slot.
   * @param {number} pageIndex - 0-based page index
   * @returns {Promise<void>}
   * @private
   */
  async _renderThumbnail(pageIndex) {
    const generationId = this._generationId;

    // Fetch the PDF page (1-based)
    const page = await this.pdfDocument.getPage(pageIndex + 1);

    // Stale check after async gap
    if (generationId !== this._generationId) return;

    const viewport = page.getViewport({ scale: this.THUMBNAIL_SCALE });
    const pixelRatio = window.devicePixelRatio || 1;

    // Create the canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Increase internal resolution for high DPI displays
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    
    // Keep CSS dimensions to the scaled viewport size
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    ctx.scale(pixelRatio, pixelRatio);

    // Render PDF content
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport
    });

    await renderTask.promise;

    // Stale check after render
    if (generationId !== this._generationId) return;

    // Yield to main thread so the browser can process input / paint
    await new Promise((r) => setTimeout(r, 0));

    // Stale check after yield
    if (generationId !== this._generationId) return;

    // ---- Build the rendered DOM ----

    const item = this.container.querySelector(`#thumbnail-${pageIndex}`);
    if (!item) return;

    const frame = item.querySelector('.thumbnail-frame');
    if (!frame) return;

    // Wrapper div for CSS dark mode (filter targets the canvas inside)
    const wrapper = document.createElement('div');
    wrapper.className = 'thumbnail-wrapper';
    wrapper.appendChild(canvas);

    // Apply current CSS dark mode theme
    this.darkModeProcessor.applyCSSDarkMode(wrapper, this.currentTheme);

    // Replace the placeholder with the rendered canvas
    frame.innerHTML = '';
    frame.appendChild(wrapper);

    // Mark as rendered
    this._renderedPages.add(pageIndex);

    // Re-apply active highlight if this was the active page
    if (pageIndex === this._activeIndex) {
      frame.classList.add('active');
    }
  }

  // ---------------------------------------------------------------
  // Click Handling (delegated)
  // ---------------------------------------------------------------

  /**
   * Handle clicks anywhere inside the thumbnail container.
   * Delegates to the onThumbnailClick callback if a thumbnail-item
   * (or child) was clicked.
   * @param {MouseEvent} event
   * @private
   */
  _handleClick(event) {
    // Walk up from the click target to find a .thumbnail-item
    const item = event.target.closest('.thumbnail-item');
    if (!item) return;

    const pageIndex = parseInt(item.dataset.pageIndex, 10);
    if (isNaN(pageIndex)) return;

    if (this.onThumbnailClick) {
      this.onThumbnailClick(pageIndex);
    }
  }

  // ---------------------------------------------------------------
  // Scroll Into View
  // ---------------------------------------------------------------

  /**
   * Scroll the sidebar panel so the given thumbnail element
   * is visible, centering it vertically when possible.
   * @param {HTMLElement} thumbnailItem - The .thumbnail-item element
   * @private
   */
  _scrollToThumbnail(thumbnailItem) {
    if (!thumbnailItem || !this.sidebarElement) return;

    // Calculate offset within the scrollable sidebar
    const sidebarRect = this.sidebarElement.getBoundingClientRect();
    const itemRect = thumbnailItem.getBoundingClientRect();

    // Already fully visible — no scroll needed
    if (
      itemRect.top >= sidebarRect.top &&
      itemRect.bottom <= sidebarRect.bottom
    ) {
      return;
    }

    // Scroll so the thumbnail is roughly centered
    const sidebarScrollTop = this.sidebarElement.scrollTop;
    const itemOffsetTop = itemRect.top - sidebarRect.top + sidebarScrollTop;
    const targetScroll = itemOffsetTop - (sidebarRect.height / 2) + (itemRect.height / 2);

    this.sidebarElement.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }
}
