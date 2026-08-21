// ============================================================
// RenderEngine.js — Virtualized PDF Rendering Engine
// Viewport-based rendering with page lifecycle state machine,
// concurrent render queue, and aggressive page unloading.
// ============================================================

class RenderEngine {
  // Page lifecycle states
  static STATE = {
    NOT_LOADED: 'NOT_LOADED',
    QUEUED: 'QUEUED',
    RENDERING: 'RENDERING',
    RENDERED: 'RENDERED',
    UNLOADED: 'UNLOADED'
  };

  /**
   * @param {Object} options
   * @param {Object} options.pdfDocument - PDF.js document instance
   * @param {HTMLElement} options.container - The #mainPreview scroll container
   * @param {DarkModeProcessor} options.darkModeProcessor
   * @param {string} options.theme - Current theme name
   * @param {number} options.scale - Render scale (default 1.0)
   * @param {number} options.scale - Render scale (default 1.0)
   * @param {number} options.rotation - Rotation in degrees (default 0)
   */
  constructor(options) {
    this.pdfDocument = options.pdfDocument;
    this.container = options.container;
    this.darkModeProcessor = options.darkModeProcessor;
    this.currentTheme = options.theme || 'claude';
    this.currentScale = options.scale || 1.0;
    this.currentScale = options.scale || 1.0;
    this.currentRotation = options.rotation || 0;

    this.totalPages = this.pdfDocument.numPages;

    // Page state tracking: pageIndex → { state, canvas, renderTask, pageWrapper, textLayer }
    this.pageStates = new Map();

    // Render queue
    this.renderQueue = [];
    this.activeRenders = 0;
    this.MAX_CONCURRENT_RENDERS = 2;

    // Viewport tracking
    this.visibleRange = { start: 0, end: 0 };
    this.BUFFER_PAGES = 2;    // Render ±2 pages beyond visible
    this.UNLOAD_DISTANCE = 8; // Unload pages >8 away from visible

    // Page dimensions (estimated from first page, updated on render)
    this.basePageWidth = 800;
    this.basePageHeight = 1100;
    this.pageHeights = new Map(); // pageIndex → actual rendered height

    // Scroll handling
    this._scrollRAF = null;
    this._resizeObserver = null;

    // Cancellation token
    this._renderId = 0;

    // Intersection observer for visible pages
    this._intersectionObserver = null;
    this._visiblePages = new Set();

    // Text content cache for search
    this.textCache = new Array(this.totalPages);
  }

  // ---------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------

  async init() {
    // Get base dimensions from first page
    try {
      const firstPage = await this.pdfDocument.getPage(1);
      const vp = firstPage.getViewport({ scale: 1 });
      this.basePageWidth = vp.width;
      this.basePageHeight = vp.height;
    } catch (e) {
      console.warn('Could not get first page dimensions:', e);
    }

    // Clear container and build page placeholders
    this.container.innerHTML = '';
    this._buildPlaceholders();

    // Set up scroll-based viewport tracking
    this._setupScrollHandler();
    this._setupIntersectionObserver();

    // Initial render pass
    this._updateVisibleRange();

    // Start background text extraction for search
    this._extractAllText();
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  setScale(scale) {
    this.currentScale = Math.max(0.25, Math.min(5.0, scale));
    this._refreshAllPages();
  }

  getScale() {
    return this.currentScale;
  }

  setRotation(rotation) {
    this.currentRotation = rotation % 360;
    this._refreshAllPages();
  }

  getRotation() {
    return this.currentRotation;
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    // Update all currently rendered pages with new CSS dark mode
    for (const [pageIndex, state] of this.pageStates.entries()) {
      if (state.state === RenderEngine.STATE.RENDERED && state.pageWrapper) {
        this.darkModeProcessor.applyCSSDarkMode(state.pageWrapper, themeName);
      }
    }
  }

  getTotalPages() {
    return this.totalPages;
  }

  getVisibleRange() {
    return { ...this.visibleRange };
  }

  getPageState(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    return state ? state.state : RenderEngine.STATE.NOT_LOADED;
  }

  /**
   * Scroll to a specific page.
   * @param {number} pageIndex - 0-based page index
   * @param {string} behavior - 'smooth' or 'auto'
   */
  jumpToPage(pageIndex, behavior = 'smooth') {
    if (pageIndex < 0 || pageIndex >= this.totalPages) return;

    const pageContainer = this.container.querySelector(`[data-page-index="${pageIndex}"]`);
    if (pageContainer) {
      // Calculate offset relative to scroll container
      const containerRect = this.container.getBoundingClientRect();
      const pageRect = pageContainer.getBoundingClientRect();
      const scrollTop = this.container.scrollTop + (pageRect.top - containerRect.top);

      this.container.scrollTo({ top: scrollTop, behavior });
    }
  }

  /**
   * Get the currently most-visible page index (center of viewport).
   * @returns {number}
   */
  getCurrentPage() {
    const scrollTop = this.container.scrollTop;
    const viewportCenter = scrollTop + this.container.clientHeight / 2;
    const estimatedHeight = this._getEstimatedPageHeight();

    // Approximate which page is at center
    let currentPage = Math.floor(viewportCenter / (estimatedHeight + 24)); // 24 = margin
    currentPage = Math.max(0, Math.min(this.totalPages - 1, currentPage));

    // Refine by checking actual container positions
    const containers = this.container.querySelectorAll('.page-container');
    let closestPage = currentPage;
    let closestDist = Infinity;

    // Only check nearby pages for performance
    const checkStart = Math.max(0, currentPage - 3);
    const checkEnd = Math.min(containers.length - 1, currentPage + 3);

    for (let i = checkStart; i <= checkEnd; i++) {
      const container = containers[i];
      if (!container) continue;
      const center = container.offsetTop + container.offsetHeight / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = i;
      }
    }

    return closestPage;
  }

  /**
   * Check if a specific page is rendered.
   * @param {number} pageIndex
   * @returns {boolean}
   */
  isPageRendered(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    return state && state.state === RenderEngine.STATE.RENDERED;
  }

  /**
   * Force render a specific page (used by search to ensure target page is visible).
   * @param {number} pageIndex
   * @returns {Promise<void>}
   */
  async ensurePageRendered(pageIndex) {
    if (this.isPageRendered(pageIndex)) return;
    
    const container = this.container.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!container) return;

    await this._renderPage(container, pageIndex);
  }

  /**
   * Get cached text content for search.
   * @returns {string[]} Array of lowercase text per page
   */
  getTextCache() {
    return this.textCache;
  }

  /**
   * Check if text extraction is complete.
   * @returns {boolean}
   */
  isTextReady() {
    return this._textExtractionDone === true;
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this._renderId++;

    // Cancel scroll handler
    if (this._scrollRAF) {
      cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = null;
    }

    // Disconnect observers
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Remove scroll listener
    this.container.removeEventListener('scroll', this._boundScrollHandler);

    // Cancel all render tasks and free memory
    for (const [pageIndex, state] of this.pageStates.entries()) {
      this._cancelRenderTask(state);
      this._freePageMemory(state);
    }
    this.pageStates.clear();
    this.renderQueue = [];
    this.activeRenders = 0;
    this._visiblePages.clear();
    this.textCache = [];
  }

  // ---------------------------------------------------------------
  // Placeholder Building
  // ---------------------------------------------------------------

  _buildPlaceholders() {
    const estimatedHeight = this._getEstimatedPageHeight();
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < this.totalPages; i++) {
      const pageContainer = document.createElement('div');
      pageContainer.className = 'page-container';
      pageContainer.dataset.pageIndex = i;
      pageContainer.style.minHeight = `${estimatedHeight}px`;

      // Loading skeleton
      const skeleton = this._createSkeleton(i + 1);
      pageContainer.appendChild(skeleton);

      fragment.appendChild(pageContainer);

      // Initialize state
      this.pageStates.set(i, {
        state: RenderEngine.STATE.NOT_LOADED,
        canvas: null,
        renderTask: null,
        pageWrapper: null,
        textLayer: null
      });
    }

    this.container.appendChild(fragment);
  }

  _createSkeleton(pageNumber) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-skeleton-wrapper';

    const skeleton = document.createElement('div');
    skeleton.className = 'page-skeleton';
    // Skeleton height matches estimated page height
    const h = this._getEstimatedPageHeight();
    skeleton.style.height = `${h - 40}px`; // minus padding
    skeleton.style.width = '100%';
    skeleton.style.maxWidth = `${Math.round(this.basePageWidth * this.currentScale)}px`;
    skeleton.style.margin = '0 auto';
    skeleton.style.borderRadius = '4px';

    const label = document.createElement('div');
    label.className = 'skeleton-page-label';
    label.textContent = `Page ${pageNumber}`;

    wrapper.appendChild(skeleton);
    wrapper.appendChild(label);
    return wrapper;
  }

  _getEstimatedPageHeight() {
    return Math.round(this.basePageHeight * this.currentScale) + 40; // 40 for padding
  }

  // ---------------------------------------------------------------
  // Scroll & Viewport Tracking
  // ---------------------------------------------------------------

  _setupScrollHandler() {
    this._boundScrollHandler = () => {
      if (this._scrollRAF) return; // Already scheduled
      this._scrollRAF = requestAnimationFrame(() => {
        this._scrollRAF = null;
        this._updateVisibleRange();
      });
    };

    this.container.addEventListener('scroll', this._boundScrollHandler, { passive: true });
  }

  _setupIntersectionObserver() {
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageIndex = parseInt(entry.target.dataset.pageIndex, 10);
          if (entry.isIntersecting) {
            this._visiblePages.add(pageIndex);
          } else {
            this._visiblePages.delete(pageIndex);
          }
        }
      },
      {
        root: this.container,
        // Generous margin for pre-loading
        rootMargin: '200px 0px',
        threshold: 0.01
      }
    );

    // Observe all page containers
    const containers = this.container.querySelectorAll('.page-container');
    containers.forEach(c => this._intersectionObserver.observe(c));
  }

  _updateVisibleRange() {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    if (viewportHeight === 0) return; // Container not visible yet

    const estimatedHeight = this._getEstimatedPageHeight();

    // Calculate visible range from scroll position
    const startPage = Math.max(0, Math.floor(scrollTop / estimatedHeight) - this.BUFFER_PAGES);
    const endPage = Math.min(
      this.totalPages - 1,
      Math.ceil((scrollTop + viewportHeight) / estimatedHeight) + this.BUFFER_PAGES
    );

    const oldStart = this.visibleRange.start;
    const oldEnd = this.visibleRange.end;

    this.visibleRange.start = startPage;
    this.visibleRange.end = endPage;

    // Schedule renders for visible pages
    this._scheduleRenders();

    // Schedule unloads for far-away pages
    this._scheduleUnloads();
  }

  // ---------------------------------------------------------------
  // Render Scheduling
  // ---------------------------------------------------------------

  _scheduleRenders() {
    const { start, end } = this.visibleRange;
    const centerPage = this.getCurrentPage();

    // Collect pages that need rendering, sorted by distance from center
    const pagesToRender = [];
    for (let i = start; i <= end; i++) {
      const state = this.pageStates.get(i);
      if (state && state.state === RenderEngine.STATE.NOT_LOADED) {
        pagesToRender.push({
          pageIndex: i,
          distance: Math.abs(i - centerPage)
        });
      }
    }

    // Sort by distance from center (closest first)
    pagesToRender.sort((a, b) => a.distance - b.distance);

    for (const { pageIndex } of pagesToRender) {
      this._enqueueRender(pageIndex);
    }

    this._processQueue();
  }

  _scheduleUnloads() {
    const { start, end } = this.visibleRange;
    const unloadBefore = start - this.UNLOAD_DISTANCE;
    const unloadAfter = end + this.UNLOAD_DISTANCE;

    for (const [pageIndex, state] of this.pageStates.entries()) {
      if (state.state === RenderEngine.STATE.RENDERED) {
        if (pageIndex < unloadBefore || pageIndex > unloadAfter) {
          this._unloadPage(pageIndex);
        }
      } else if (state.state === RenderEngine.STATE.QUEUED || state.state === RenderEngine.STATE.RENDERING) {
        // Cancel renders for pages that scrolled far away
        if (pageIndex < unloadBefore || pageIndex > unloadAfter) {
          this._cancelAndReset(pageIndex);
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Render Queue
  // ---------------------------------------------------------------

  _enqueueRender(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    if (!state || state.state !== RenderEngine.STATE.NOT_LOADED) return;

    // Prevent duplicates
    if (this.renderQueue.includes(pageIndex)) return;

    state.state = RenderEngine.STATE.QUEUED;
    this.renderQueue.push(pageIndex);
  }

  _processQueue() {
    while (this.activeRenders < this.MAX_CONCURRENT_RENDERS && this.renderQueue.length > 0) {
      const pageIndex = this.renderQueue.shift();
      const state = this.pageStates.get(pageIndex);

      // Skip if state changed (e.g., already cancelled)
      if (!state || state.state !== RenderEngine.STATE.QUEUED) continue;

      // Check if still in render range (may have scrolled away while queued)
      const { start, end } = this.visibleRange;
      if (pageIndex < start - this.UNLOAD_DISTANCE || pageIndex > end + this.UNLOAD_DISTANCE) {
        state.state = RenderEngine.STATE.NOT_LOADED;
        continue;
      }

      this.activeRenders++;
      state.state = RenderEngine.STATE.RENDERING;

      const container = this.container.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!container) {
        this.activeRenders--;
        state.state = RenderEngine.STATE.NOT_LOADED;
        continue;
      }

      this._renderPage(container, pageIndex)
        .catch(err => {
          console.error(`Render error page ${pageIndex + 1}:`, err);
          if (state.state === RenderEngine.STATE.RENDERING) {
            state.state = RenderEngine.STATE.NOT_LOADED;
          }
        })
        .finally(() => {
          this.activeRenders--;
          this._processQueue(); // Process next in queue
        });
    }
  }

  // ---------------------------------------------------------------
  // Page Rendering
  // ---------------------------------------------------------------

  async _renderPage(container, pageIndex) {
    const renderId = this._renderId;
    const state = this.pageStates.get(pageIndex);
    if (!state) return;

    try {
      const page = await this.pdfDocument.getPage(pageIndex + 1);
      state.page = page;

      // Check for cancellation
      if (renderId !== this._renderId || state.state !== RenderEngine.STATE.RENDERING) {
        page.cleanup();
        return;
      }

      const viewport = page.getViewport({
        scale: this.currentScale,
        rotation: this.currentRotation
      });
      const pixelRatio = window.devicePixelRatio || 1;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.className = 'page-canvas';
      
      ctx.scale(pixelRatio, pixelRatio);

      // Render PDF page to canvas
      const renderTask = page.render({
        canvasContext: ctx,
        viewport: viewport
      });

      state.renderTask = renderTask;

      await renderTask.promise;

      // Check for cancellation after render
      if (renderId !== this._renderId || state.state !== RenderEngine.STATE.RENDERING) {
        page.cleanup();
        return;
      }

      state.renderTask = null;

      // Build page wrapper
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'page-wrapper';
      pageWrapper.appendChild(canvas);

      // Apply CSS dark mode
      this.darkModeProcessor.applyCSSDarkMode(pageWrapper, this.currentTheme);

      // Style canvas
      canvas.style.maxWidth = '100%';
      canvas.style.height = 'auto';
      canvas.style.borderRadius = '4px';
      canvas.style.display = 'block';

      // Text layer for copy/paste support
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      pageWrapper.appendChild(textLayer);

      // Replace placeholder content
      container.innerHTML = '';
      container.appendChild(pageWrapper);

      // Update container height to match actual rendered size
      container.style.minHeight = '';

      // Update state
      state.state = RenderEngine.STATE.RENDERED;
      state.canvas = canvas;
      state.pageWrapper = pageWrapper;
      state.textLayer = textLayer;

      // Render text layer (async, non-blocking)
      this._renderTextLayer(page, textLayer, viewport, canvas).catch(err => {
        console.warn(`Text layer error page ${pageIndex + 1}:`, err);
      });

    } catch (error) {
      if (error.name === 'RenderingCancelledException') {
        // Expected when we cancel renders for scrolled-away pages
        return;
      }
      console.error(`Page ${pageIndex + 1} render error:`, error);
      container.innerHTML = '<div class="error-msg">Error loading page</div>';
      state.state = RenderEngine.STATE.NOT_LOADED;
    }
  }

  // ---------------------------------------------------------------
  // Text Layer
  // ---------------------------------------------------------------

  async _renderTextLayer(page, textLayer, viewport, canvas) {
    if (typeof pdfjsLib === 'undefined' || typeof pdfjsLib.renderTextLayer !== 'function') {
      return;
    }

    const textContent = await page.getTextContent();
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;

    const renderTask = pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: [],
      enhanceTextSelection: true
    });

    if (renderTask?.promise) {
      await renderTask.promise;
    }

    // Sync text layer scale with displayed canvas size
    requestAnimationFrame(() => {
      this._syncTextLayerScale(textLayer, canvas);
      // Dispatch event so search highlights can be applied as pages render
      document.dispatchEvent(new CustomEvent('pageTextLayerRendered', {
        detail: { pageIndex: page.pageNumber - 1 }
      }));
    });
  }

  _syncTextLayerScale(textLayer, canvas) {
    if (!textLayer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const logicalWidth = parseFloat(canvas.style.width) || canvas.width;
    const logicalHeight = parseFloat(canvas.style.height) || canvas.height;

    const scaleX = rect.width / logicalWidth;
    const scaleY = rect.height / logicalHeight;

    textLayer.style.transformOrigin = '0 0';
    textLayer.style.transform = `scale(${scaleX}, ${scaleY})`;
  }

  // ---------------------------------------------------------------
  // Text Extraction (for search)
  // ---------------------------------------------------------------

  async _extractAllText() {
    this._textExtractionDone = false;

    for (let i = 0; i < this.totalPages; i++) {
      // Check for destruction
      if (!this.pdfDocument) return;

      try {
        const page = await this.pdfDocument.getPage(i + 1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        this.textCache[i] = text.toLowerCase();
      } catch (err) {
        this.textCache[i] = '';
      }

      // Yield to main thread every 10 pages
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this._textExtractionDone = true;

    // Dispatch event so UI can enable search
    document.dispatchEvent(new CustomEvent('textExtractionComplete'));
  }

  // ---------------------------------------------------------------
  // Page Unloading
  // ---------------------------------------------------------------

  _unloadPage(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    if (!state || state.state !== RenderEngine.STATE.RENDERED) return;

    const container = this.container.querySelector(`[data-page-index="${pageIndex}"]`);

    // Record the actual height before unloading to prevent scroll jumps
    if (container) {
      const actualHeight = container.offsetHeight;
      container.style.minHeight = `${actualHeight}px`;

      // Replace rendered content with skeleton
      container.innerHTML = '';
      const skeleton = this._createSkeleton(pageIndex + 1);
      container.appendChild(skeleton);
    }

    // Free memory
    this._freePageMemory(state);

    state.state = RenderEngine.STATE.NOT_LOADED;
    state.canvas = null;
    state.pageWrapper = null;
    state.textLayer = null;
  }

  _cancelAndReset(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    if (!state) return;

    this._cancelRenderTask(state);

    // Remove from queue
    const queueIdx = this.renderQueue.indexOf(pageIndex);
    if (queueIdx !== -1) {
      this.renderQueue.splice(queueIdx, 1);
    }

    state.state = RenderEngine.STATE.NOT_LOADED;
  }

  _cancelRenderTask(state) {
    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch (e) {
        // Ignore cancellation errors
      }
      state.renderTask = null;
    }
  }

  _freePageMemory(state) {
    // Explicitly clear canvas to free GPU memory
    if (state.canvas) {
      const ctx = state.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
      }
      state.canvas.width = 0;
      state.canvas.height = 0;
      state.canvas = null;
    }

    // Clear text layer
    if (state.textLayer) {
      state.textLayer.innerHTML = '';
      state.textLayer = null;
    }

    // Clear wrapper
    if (state.pageWrapper) {
      state.pageWrapper.innerHTML = '';
      state.pageWrapper = null;
    }

    // Clear render task
    this._cancelRenderTask(state);

    // Free PDF.js internal page memory (fonts, image data)
    if (state.page && typeof state.page.cleanup === 'function') {
      try {
        state.page.cleanup();
      } catch (err) {
        console.warn('Error during page cleanup:', err);
      }
      state.page = null;
    }
  }

  // ---------------------------------------------------------------
  // Refresh (on zoom/rotate/theme change)
  // ---------------------------------------------------------------

  _refreshAllPages() {
    this._renderId++; // Cancel all in-flight renders

    const estimatedHeight = this._getEstimatedPageHeight();

    // Capture current page before refresh
    const currentPage = this.getCurrentPage();

    // Reset all page states
    for (const [pageIndex, state] of this.pageStates.entries()) {
      this._cancelRenderTask(state);
      this._freePageMemory(state);
      state.state = RenderEngine.STATE.NOT_LOADED;
      state.canvas = null;
      state.pageWrapper = null;
      state.textLayer = null;
    }

    this.renderQueue = [];
    this.activeRenders = 0;

    // Update all placeholders
    const containers = this.container.querySelectorAll('.page-container');
    containers.forEach((container, i) => {
      container.style.minHeight = `${estimatedHeight}px`;
      container.innerHTML = '';
      container.appendChild(this._createSkeleton(i + 1));
    });

    // Restore scroll position
    requestAnimationFrame(() => {
      this.jumpToPage(currentPage, 'auto');
      // Trigger re-render after scroll position is set
      setTimeout(() => this._updateVisibleRange(), 50);
    });
  }
}
