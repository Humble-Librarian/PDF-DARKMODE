// ============================================================
// RenderEngine.js — Virtualized PDF Rendering Engine
// Windowed sliding viewport with page lifecycle state machine,
// concurrent render queue, and aggressive memory reclamation.
// Solves browser subpixel/coordinate overflow on 1,000+ page PDFs.
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
   * @param {number} options.rotation - Rotation in degrees (default 0)
   */
  constructor(options) {
    this.pdfDocument = options.pdfDocument;
    this.container = options.container;
    this.darkModeProcessor = options.darkModeProcessor;
    this.annotationManager = options.annotationManager || null;
    this.currentTheme = options.theme || 'claude';
    this.currentScale = options.scale || 1.0;
    this.currentRotation = options.rotation || 0;

    this.totalPages = this.pdfDocument.numPages;

    // Page state tracking: pageIndex → { state, canvas, renderTask, pageWrapper, textLayer, page }
    this.pageStates = new Map();

    // Render queue
    this.renderQueue = [];
    this.activeRenders = 0;
    this.MAX_CONCURRENT_RENDERS = 2;

    // Windowed Virtual Viewport
    this.currentPage = 0;
    this.BUFFER_PAGES = 2; // Keep ±2 pages around current page in DOM (at most 5 pages total)
    this.windowRange = { start: -1, end: -1 };

    // Page dimensions (estimated from first page, updated on render)
    this.basePageWidth = 800;
    this.basePageHeight = 1100;

    // Scroll handling
    this._scrollRAF = null;
    this._boundScrollHandler = null;

    // Cancellation token
    this._renderId = 0;

    // Text content cache for search and TTS
    this.textCache = new Array(this.totalPages);
    this.rawTextCache = new Array(this.totalPages);
    this._textExtractionStarted = false;
    this._textExtractionDone = false;
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

    // Initialize state map for all pages
    this.pageStates.clear();
    for (let i = 0; i < this.totalPages; i++) {
      this.pageStates.set(i, {
        state: RenderEngine.STATE.NOT_LOADED,
        canvas: null,
        renderTask: null,
        pageWrapper: null,
        textLayer: null,
        page: null
      });
    }

    // Clear container and mount initial window (e.g. pages 0..2)
    this.container.innerHTML = '';
    this.windowRange = { start: -1, end: -1 };
    this._mountWindow(0);

    // Set up scroll-based viewport tracking
    this._setupScrollHandler();
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
    return { ...this.windowRange };
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
  jumpToPage(pageIndex, behavior = 'auto') {
    if (pageIndex < 0 || pageIndex >= this.totalPages) return;

    this.currentPage = pageIndex;

    const inWindow = pageIndex >= this.windowRange.start && pageIndex <= this.windowRange.end;
    if (!inWindow || this.container.children.length === 0) {
      this._mountWindow(pageIndex);
    }

    const pageContainer = this.container.querySelector(`[data-page-index="${pageIndex}"]`);
    if (pageContainer) {
      const containerRect = this.container.getBoundingClientRect();
      const pageRect = pageContainer.getBoundingClientRect();
      const scrollTop = this.container.scrollTop + (pageRect.top - containerRect.top);

      this.container.scrollTo({ top: scrollTop, behavior });
    }

    this._prioritizePageRender(pageIndex);
  }

  /**
   * Prioritize rendering a specific page, canceling offscreen in-flight renders.
   * @param {number} pageIndex
   * @private
   */
  _prioritizePageRender(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.totalPages) return;
    const state = this.pageStates.get(pageIndex);
    if (!state || state.state === RenderEngine.STATE.RENDERED) return;

    // Cancel in-flight renders for pages that are far from target
    for (const [idx, s] of this.pageStates.entries()) {
      if (Math.abs(idx - pageIndex) > this.BUFFER_PAGES) {
        if (s.state === RenderEngine.STATE.RENDERING) {
          this._cancelRenderTask(s);
          s.state = RenderEngine.STATE.NOT_LOADED;
        } else if (s.state === RenderEngine.STATE.QUEUED) {
          s.state = RenderEngine.STATE.NOT_LOADED;
        }
      }
    }

    // Filter queue to keep only nearby pages
    this.renderQueue = this.renderQueue.filter(
      idx => Math.abs(idx - pageIndex) <= this.BUFFER_PAGES
    );

    // Enqueue target page at the very front
    const qIdx = this.renderQueue.indexOf(pageIndex);
    if (qIdx !== -1) {
      this.renderQueue.splice(qIdx, 1);
    }
    state.state = RenderEngine.STATE.QUEUED;
    this.renderQueue.unshift(pageIndex);

    // Also queue ±1, ±2 buffer pages in window
    for (const offset of [-1, 1, -2, 2]) {
      const bufferIdx = pageIndex + offset;
      if (bufferIdx >= this.windowRange.start && bufferIdx <= this.windowRange.end) {
        const bufState = this.pageStates.get(bufferIdx);
        if (bufState && bufState.state === RenderEngine.STATE.NOT_LOADED && !this.renderQueue.includes(bufferIdx)) {
          bufState.state = RenderEngine.STATE.QUEUED;
          this.renderQueue.push(bufferIdx);
        }
      }
    }

    this._processQueue();
  }

  /**
   * Get the currently most-visible page index (center of viewport).
   * @returns {number}
   */
  getCurrentPage() {
    const containers = this.container.querySelectorAll('.page-container');
    if (containers.length === 0) return this.currentPage;

    const containerRect = this.container.getBoundingClientRect();
    const viewportCenterY = containerRect.top + containerRect.height / 2;

    let closestPage = this.currentPage;
    let minDistance = Infinity;

    for (const container of containers) {
      const rect = container.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(centerY - viewportCenterY);
      if (dist < minDistance) {
        minDistance = dist;
        const idx = parseInt(container.getAttribute('data-page-index'), 10);
        if (!isNaN(idx)) {
          closestPage = idx;
        }
      }
    }

    this.currentPage = closestPage;
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
   * Force render a specific page (used by search / outline / bookmarks).
   * @param {number} pageIndex
   * @returns {Promise<void>}
   */
  async ensurePageRendered(pageIndex) {
    if (this.isPageRendered(pageIndex)) return;

    if (pageIndex < this.windowRange.start || pageIndex > this.windowRange.end) {
      this.jumpToPage(pageIndex, 'auto');
    } else {
      this._prioritizePageRender(pageIndex);
    }

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        this.container.removeEventListener('pageRendered', handler);
        resolve();
      };
      const handler = (e) => {
        if (e.detail && e.detail.pageIndex === pageIndex) {
          done();
        }
      };
      this.container.addEventListener('pageRendered', handler);

      if (this.isPageRendered(pageIndex)) {
        done();
      }
    });
  }

  /**
   * Get cached text content for search (triggers on-demand extraction if not started).
   * @returns {string[]} Array of lowercase text per page
   */
  getTextCache() {
    if (!this._textExtractionStarted && !this._textExtractionDone) {
      this._extractAllText();
    }
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

    if (this._scrollRAF) {
      cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = null;
    }

    if (this._boundScrollHandler) {
      this.container.removeEventListener('scroll', this._boundScrollHandler);
      this._boundScrollHandler = null;
    }

    for (const [pageIndex, state] of this.pageStates.entries()) {
      this._cancelRenderTask(state);
      this._freePageMemory(state);
    }
    this.pageStates.clear();
    this.renderQueue = [];
    this.activeRenders = 0;
    this.textCache = [];
    this._textExtractionStarted = false;
    this._textExtractionDone = false;
  }

  // ---------------------------------------------------------------
  // Window Mount & Sliding
  // ---------------------------------------------------------------

  _createPageContainer(pageIndex) {
    const estimatedHeight = this._getEstimatedPageHeight();
    const div = document.createElement('div');
    div.className = 'page-container';
    div.dataset.pageIndex = String(pageIndex);
    div.style.minHeight = `${estimatedHeight}px`;

    const state = this.pageStates.get(pageIndex);
    if (state && state.state === RenderEngine.STATE.RENDERED && state.pageWrapper) {
      div.appendChild(state.pageWrapper);
      div.style.minHeight = '';
    } else {
      div.appendChild(this._createSkeleton(pageIndex + 1));
    }
    return div;
  }

  _mountWindow(centerPageIndex) {
    const newStart = Math.max(0, centerPageIndex - this.BUFFER_PAGES);
    const newEnd = Math.min(this.totalPages - 1, centerPageIndex + this.BUFFER_PAGES);

    const oldStart = this.windowRange.start;
    const oldEnd = this.windowRange.end;

    // Disjoint or initial mount: completely rebuild container
    if (oldStart === -1 || newStart > oldEnd || newEnd < oldStart || this.container.children.length === 0) {
      // Unload previously rendered pages
      if (oldStart !== -1) {
        for (let i = oldStart; i <= oldEnd; i++) {
          this._unloadPage(i);
        }
      }

      this.container.innerHTML = '';
      for (let i = newStart; i <= newEnd; i++) {
        const container = this._createPageContainer(i);
        this.container.appendChild(container);
      }
      this.windowRange = { start: newStart, end: newEnd };
      this._scheduleRenders();
      return;
    }

    // Incremental sliding window:

    // 1. Pages removed from top
    if (newStart > oldStart) {
      let removedHeight = 0;
      for (let i = oldStart; i < newStart; i++) {
        const el = this.container.querySelector(`[data-page-index="${i}"]`);
        if (el) {
          removedHeight += el.offsetHeight + 24; // 24px bottom margin
          this._unloadPage(i);
          el.remove();
        }
      }
      if (removedHeight > 0) {
        this.container.scrollTop = Math.max(0, this.container.scrollTop - removedHeight);
      }
    }

    // 2. Pages prepended to top
    if (newStart < oldStart) {
      let addedHeight = 0;
      for (let i = oldStart - 1; i >= newStart; i--) {
        const el = this._createPageContainer(i);
        this.container.insertBefore(el, this.container.firstChild);
        addedHeight += el.offsetHeight || (this._getEstimatedPageHeight() + 24);
      }
      if (addedHeight > 0) {
        this.container.scrollTop += addedHeight;
      }
    }

    // 3. Pages removed from bottom
    if (newEnd < oldEnd) {
      for (let i = newEnd + 1; i <= oldEnd; i++) {
        const el = this.container.querySelector(`[data-page-index="${i}"]`);
        if (el) {
          this._unloadPage(i);
          el.remove();
        }
      }
    }

    // 4. Pages appended to bottom
    if (newEnd > oldEnd) {
      for (let i = oldEnd + 1; i <= newEnd; i++) {
        const el = this._createPageContainer(i);
        this.container.appendChild(el);
      }
    }

    this.windowRange = { start: newStart, end: newEnd };
    this._scheduleRenders();
  }

  _createSkeleton(pageNumber) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-skeleton-wrapper';

    const skeleton = document.createElement('div');
    skeleton.className = 'page-skeleton';
    const h = this._getEstimatedPageHeight();
    skeleton.style.height = `${h - 40}px`;
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
    return Math.round(this.basePageHeight * this.currentScale) + 40;
  }

  // ---------------------------------------------------------------
  // Scroll & Viewport Tracking
  // ---------------------------------------------------------------

  _setupScrollHandler() {
    this._boundScrollHandler = () => {
      if (this._scrollRAF) return;
      this._scrollRAF = requestAnimationFrame(() => {
        this._scrollRAF = null;
        this._onScroll();
      });
    };

    this.container.addEventListener('scroll', this._boundScrollHandler, { passive: true });
  }

  _onScroll() {
    const current = this.getCurrentPage();
    const targetStart = Math.max(0, current - this.BUFFER_PAGES);
    const targetEnd = Math.min(this.totalPages - 1, current + this.BUFFER_PAGES);

    if (targetStart !== this.windowRange.start || targetEnd !== this.windowRange.end) {
      this._mountWindow(current);
    } else {
      this._scheduleRenders();
    }
  }

  // ---------------------------------------------------------------
  // Render Scheduling & Queue
  // ---------------------------------------------------------------

  _scheduleRenders() {
    const { start, end } = this.windowRange;
    if (start === -1) return;

    const centerPage = this.currentPage;

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

    pagesToRender.sort((a, b) => a.distance - b.distance);

    for (const { pageIndex } of pagesToRender) {
      this._enqueueRender(pageIndex);
    }

    this._processQueue();
  }

  _enqueueRender(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    if (!state || state.state !== RenderEngine.STATE.NOT_LOADED) return;

    if (this.renderQueue.includes(pageIndex)) return;

    state.state = RenderEngine.STATE.QUEUED;
    this.renderQueue.push(pageIndex);
  }

  _processQueue() {
    while (this.activeRenders < this.MAX_CONCURRENT_RENDERS && this.renderQueue.length > 0) {
      const pageIndex = this.renderQueue.shift();
      const state = this.pageStates.get(pageIndex);

      if (!state || state.state !== RenderEngine.STATE.QUEUED) continue;

      // Check if page is still within active window
      if (pageIndex < this.windowRange.start || pageIndex > this.windowRange.end) {
        state.state = RenderEngine.STATE.NOT_LOADED;
        continue;
      }

      const container = this.container.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!container) {
        state.state = RenderEngine.STATE.NOT_LOADED;
        continue;
      }

      this.activeRenders++;
      state.state = RenderEngine.STATE.RENDERING;

      this._renderPage(container, pageIndex)
        .catch(err => {
          if (err && err.name !== 'RenderingCancelledException') {
            console.error(`Render error page ${pageIndex + 1}:`, err);
          }
          if (state.state === RenderEngine.STATE.RENDERING) {
            state.state = RenderEngine.STATE.NOT_LOADED;
          }
        })
        .finally(() => {
          this.activeRenders--;
          this._processQueue();
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

      // Text layer for copy/paste & search highlighting
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      pageWrapper.appendChild(textLayer);

      // Annotation layer
      if (this.annotationManager) {
        try {
          const svgLayer = this.annotationManager.createPageLayer(pageIndex, viewport);
          if (svgLayer) {
            pageWrapper.appendChild(svgLayer);
          }
        } catch (annotErr) {
          console.warn(`Annotation layer error page ${pageIndex + 1}:`, annotErr);
        }
      }

      // Check if container is still in DOM before replacing
      if (container.parentNode) {
        container.innerHTML = '';
        container.appendChild(pageWrapper);
        container.style.minHeight = '';
      }

      state.state = RenderEngine.STATE.RENDERED;
      state.canvas = canvas;
      state.pageWrapper = pageWrapper;
      state.textLayer = textLayer;

      // Dispatch pageRendered event for listeners
      this.container.dispatchEvent(new CustomEvent('pageRendered', {
        bubbles: true,
        detail: { pageIndex }
      }));

      // Render text layer (async)
      this._renderTextLayer(page, textLayer, viewport, canvas).catch(err => {
        console.warn(`Text layer error page ${pageIndex + 1}:`, err);
      });

    } catch (error) {
      if (error.name === 'RenderingCancelledException') {
        return;
      }
      console.error(`Page ${pageIndex + 1} render error:`, error);
      if (container.parentNode) {
        container.innerHTML = '<div class="error-msg">Error loading page</div>';
      }
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

    requestAnimationFrame(() => {
      this._syncTextLayerScale(textLayer, canvas);
      document.dispatchEvent(new CustomEvent('pageTextLayerRendered', {
        detail: { pageIndex: page.pageNumber - 1 }
      }));
    });
  }

  _syncTextLayerScale(textLayer, canvas) {
    if (!textLayer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const logicalWidth = parseFloat(textLayer.style.width) || parseFloat(canvas.style.width) || canvas.width;
    const logicalHeight = parseFloat(textLayer.style.height) || parseFloat(canvas.style.height) || canvas.height;

    const scaleX = rect.width / logicalWidth;
    const scaleY = rect.height / logicalHeight;

    textLayer.style.transformOrigin = '0 0';
    textLayer.style.transform = `scale(${scaleX}, ${scaleY})`;
  }

  // ---------------------------------------------------------------
  // Text Extraction (for document-wide search)
  // ---------------------------------------------------------------

  async _extractAllText() {
    if (this._textExtractionStarted || this._textExtractionDone) return;
    this._textExtractionStarted = true;
    this._textExtractionDone = false;

    for (let i = 0; i < this.totalPages; i++) {
      if (!this.pdfDocument) return;

      while (this.activeRenders > 0 || this.renderQueue.length > 0) {
        await new Promise(r => setTimeout(r, 80));
        if (!this.pdfDocument) return;
      }

      if (this.rawTextCache && this.rawTextCache[i] !== undefined) {
        continue;
      }

      try {
        const page = await this.pdfDocument.getPage(i + 1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        this.rawTextCache[i] = text;
        this.textCache[i] = text.toLowerCase();
      } catch (err) {
        this.rawTextCache[i] = '';
        this.textCache[i] = '';
      }

      if (i % 5 === 0) {
        await new Promise(r => setTimeout(r, 20));
      }
    }

    this._textExtractionDone = true;
    document.dispatchEvent(new CustomEvent('textExtractionComplete'));
  }

  /**
   * Get raw (case-preserved) text content for a page (for Text-to-Speech).
   * @param {number} pageIndex
   * @returns {Promise<string>}
   */
  async getRawPageText(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.totalPages) return '';
    if (this.rawTextCache && this.rawTextCache[pageIndex] !== undefined) {
      return this.rawTextCache[pageIndex];
    }
    try {
      const page = await this.pdfDocument.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');
      if (!this.rawTextCache) this.rawTextCache = new Array(this.totalPages);
      this.rawTextCache[pageIndex] = text;
      this.textCache[pageIndex] = text.toLowerCase();
      return text;
    } catch (err) {
      console.warn(`Failed to extract text for page ${pageIndex + 1}:`, err);
      return '';
    }
  }

  // ---------------------------------------------------------------
  // Page Unloading & Memory Reclamation
  // ---------------------------------------------------------------

  _unloadPage(pageIndex) {
    const state = this.pageStates.get(pageIndex);
    if (!state) return;

    this._freePageMemory(state);
    state.state = RenderEngine.STATE.NOT_LOADED;
    state.canvas = null;
    state.pageWrapper = null;
    state.textLayer = null;
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
    if (state.canvas) {
      const ctx = state.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
      }
      state.canvas.width = 0;
      state.canvas.height = 0;
      state.canvas = null;
    }

    if (state.textLayer) {
      state.textLayer.innerHTML = '';
      state.textLayer = null;
    }

    if (state.pageWrapper) {
      state.pageWrapper.innerHTML = '';
      state.pageWrapper = null;
    }

    this._cancelRenderTask(state);

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
    this._renderId++;

    const currentPage = this.getCurrentPage();

    for (const [pageIndex, state] of this.pageStates.entries()) {
      this._cancelRenderTask(state);
      this._freePageMemory(state);
      state.state = RenderEngine.STATE.NOT_LOADED;
    }

    this.renderQueue = [];
    this.activeRenders = 0;

    this.container.innerHTML = '';
    this.windowRange = { start: -1, end: -1 };
    this._mountWindow(currentPage);

    requestAnimationFrame(() => {
      this.jumpToPage(currentPage, 'auto');
    });
  }
}
