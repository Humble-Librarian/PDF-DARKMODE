// PDF Dark Mode Reader — Browser Extension
// 100% local processing, no server uploads

class PDFDarkMode {
  constructor() {
    this.originalPdfData = null;
    this.originalFileName = '';
    this.currentRenderId = 0;
    this.pdfDocument = null;
    this.currentTheme = 'claude';
    this.totalPages = 0;
    this.renderedPages = new Set();
    this.renderedThumbnails = new Set();
    this.pageObservers = new Map();
    this.renderQueue = [];
    this.isRendering = false;
    this.activeThumbnailIndex = null;
    this.currentScale = 1.5;
    this.currentRotation = 0;

    // Theme configs: background RGB values for dark mode
    this.themes = {
      classic:  { r: 0,  g: 0,  b: 0,  name: 'Classic' },
      claude:   { r: 42, g: 37, b: 34, name: 'Warm' },
      midnight: { r: 25, g: 30, b: 45, name: 'Blue' },
      forest:   { r: 25, g: 35, b: 30, name: 'Green' }
    };

    this.init();
  }

  init() {
    // Check if we were passed a URL to convert directly
    const urlParams = new URLSearchParams(window.location.search);
    const pdfUrl = urlParams.get('url');
    const pdfTitle = urlParams.get('title');

    if (pdfUrl) {
      this.originalFileName = pdfTitle ? pdfTitle.replace(/\.pdf$/i, '') : 'Document';
      this.fetchAndRenderPDF(pdfUrl);
    }
    // PDF.js worker — must use chrome.runtime.getURL in extension context
    if (typeof pdfjsLib !== 'undefined') {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      }
    }

    // File input
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    // Drop zone
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput?.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
          this.handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Theme selector
    const themeSelector = document.getElementById('themeSelector');
    if (themeSelector) {
      themeSelector.value = this.currentTheme;
      themeSelector.addEventListener('change', async () => {
        this.currentTheme = themeSelector.value;
        if (this.originalPdfData) {
          await this.renderPDF(this.originalPdfData);
        }
      });
    }

    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goBack());
    }

    // Sidebar toggle (for narrow popups)
    const toggleThumbnailsBtn = document.getElementById('toggleThumbnailsBtn');
    const sidebarPanel = document.getElementById('sidebarPanel');
    if (toggleThumbnailsBtn && sidebarPanel) {
      toggleThumbnailsBtn.addEventListener('click', () => {
        sidebarPanel.classList.toggle('collapsed');
        toggleThumbnailsBtn.classList.toggle('active');
      });
    }

    // Zoom Controls
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.handleZoom(0.25));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.handleZoom(-0.25));

    // Rotate Control
    const rotateBtn = document.getElementById('rotateBtn');
    if (rotateBtn) rotateBtn.addEventListener('click', () => this.handleRotate());

    // Pagination Controls
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInput = document.getElementById('pageInput');
    
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => this.jumpToPage(this.activeThumbnailIndex - 1));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => this.jumpToPage(this.activeThumbnailIndex + 1));
    if (pageInput) {
      pageInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) this.jumpToPage(val - 1);
      });
    }

    // Search Controls
    this.searchResults = [];
    this.currentSearchIndex = -1;
    this.lastSearchQuery = '';

    const searchInput = document.getElementById('searchInput');
    const searchPrevBtn = document.getElementById('searchPrevBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');
    
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (searchInput.value !== this.lastSearchQuery) {
            this.executeSearch(searchInput.value);
          } else {
            this.navigateSearch(1);
          }
        }
      });
      searchInput.addEventListener('input', () => {
        if (searchInput.value === '') this.executeSearch('');
      });
    }
    if (searchPrevBtn) searchPrevBtn.addEventListener('click', () => this.navigateSearch(-1));
    if (searchNextBtn) searchNextBtn.addEventListener('click', () => this.navigateSearch(1));
  }

  handleFileSelect(event) {
    if (event.target.files.length > 0) {
      this.handleFile(event.target.files[0]);
    }
  }

  handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a valid PDF file.');
      return;
    }

    this.originalFileName = file.name.replace(/\.pdf$/i, '');
    const fileReader = new FileReader();

    fileReader.onload = async () => {
      const fileData = new Uint8Array(fileReader.result);
      this.originalPdfData = fileData;
      this.toggleUI(true);
      await this.renderPDF(fileData);
    };

    fileReader.readAsArrayBuffer(file);
  }

  toggleUI(showPreview) {
    const uploadSection = document.getElementById('uploadSection');
    const previewSection = document.getElementById('previewSection');
    const fileNameDisplay = document.getElementById('fileNameDisplay');

    if (showPreview) {
      uploadSection?.classList.add('hidden');
      previewSection?.classList.remove('hidden');
      if (fileNameDisplay) {
        fileNameDisplay.textContent = this.originalFileName + '.pdf';
      }
    } else {
      uploadSection?.classList.remove('hidden');
      previewSection?.classList.add('hidden');
    }
  }

  goBack() {
    // Reset state
    this.originalPdfData = null;
    this.originalFileName = '';
    this.pdfDocument = null;
    this.totalPages = 0;
    this.renderedPages.clear();
    this.renderedThumbnails.clear();
    this.renderQueue = [];
    this.isRendering = false;
    this.currentRenderId++;

    // Clear observers
    this.pageObservers.forEach(obs => obs.disconnect());
    this.pageObservers.clear();

    // Clear containers
    const tc = document.getElementById('thumbnailContainer');
    const mp = document.getElementById('mainPreview');
    if (tc) tc.innerHTML = '';
    if (mp) {
      mp.innerHTML = `
        <div class="placeholder-msg">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" opacity="0.3"><rect x="3" y="2" width="18" height="20" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h10M7 10h10M7 13h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <p>Preview will appear here</p>
        </div>`;
    }

    // Reset file input
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) fileInput.value = '';

    // If there's a URL parameter, strip it so the back button doesn't trigger a reload loop
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    this.toggleUI(false);
  }

  handleZoom(delta) {
    this.currentScale = Math.max(0.5, Math.min(3.0, this.currentScale + delta));
    const zoomText = document.getElementById('zoomLevelText');
    if (zoomText) zoomText.textContent = `${Math.round(this.currentScale * 100)}%`;
    
    // Save current active page to restore scroll position
    const activePage = this.activeThumbnailIndex || 0;
    
    this.refreshRender();
    
    // Restore scroll position to the page we were on
    setTimeout(() => {
      this.jumpToPage(activePage);
    }, 10);
  }

  handleRotate() {
    this.currentRotation = (this.currentRotation + 90) % 360;
    this.refreshRender();
  }

  jumpToPage(index) {
    if (index < 0 || index >= this.totalPages) return;
    const mainPreview = document.getElementById('mainPreview');
    const pageEl = mainPreview?.querySelector(`[data-page-index="${index}"]`);
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      const parentRect = mainPreview.getBoundingClientRect();
      const isVisible = rect.top < parentRect.bottom && rect.bottom > parentRect.top;
      
      if (!isVisible) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  refreshRender() {
    if (!this.pdfDocument) return;
    this.currentRenderId++; // cancel ongoing renders
    this.renderedPages.clear();
    this.renderQueue = [];
    
    // Calculate new height based on scale
    const newMinHeight = Math.round((this.basePageHeight || 1100) * this.currentScale);

    // Clear all page containers to force re-render via IntersectionObserver
    const pageContainers = document.querySelectorAll('.page-container');
    pageContainers.forEach(container => {
      const pageIndex = parseInt(container.dataset.pageIndex, 10);
      container.style.minHeight = `${newMinHeight}px`;
      container.innerHTML = '';
      container.appendChild(this.createLoadingElement(pageIndex + 1));
      
      // Re-observe
      const observer = this.pageObservers.get(pageIndex);
      if (observer) {
        observer.unobserve(container);
        observer.observe(container);
      }
    });
  }

  async fetchAndRenderPDF(url) {
    this.toggleUI(true);
    const progressText = document.getElementById('progressText');
    if (progressText) progressText.textContent = 'Downloading PDF from page...';

    try {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error('Network response was not ok');

      const arrayBuffer = await response.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      this.originalPdfData = fileData;
      
      await this.renderPDF(fileData);
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Could not download this PDF automatically (it might be blocked or require login). Please download the PDF to your computer and upload it here manually.');
      this.goBack();
    }
  }

  async renderPDF(pdfData) {
    const renderId = ++this.currentRenderId;
    const theme = this.themes[this.currentTheme];

    try {
      this.pdfDocument = await pdfjsLib.getDocument({ data: pdfData }).promise;
      this.totalPages = this.pdfDocument.numPages;
      this.renderedPages.clear();
      this.renderQueue = [];
      this.pageObservers = new Map();

      // Estimate base dimensions from page 1 to prevent scroll jumping
      this.basePageWidth = 800;
      this.basePageHeight = 1100;
      try {
        const firstPage = await this.pdfDocument.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        this.basePageWidth = vp.width;
        this.basePageHeight = vp.height;
      } catch(e) {
        console.warn('Could not get first page for sizing', e);
      }

      const initialMinHeight = Math.round(this.basePageHeight * this.currentScale);

      const mainPreview = document.getElementById('mainPreview');
      const thumbnailContainer = document.getElementById('thumbnailContainer');
      const progressText = document.getElementById('progressText');
      const pageCountText = document.getElementById('pageCountText');

      if (thumbnailContainer) thumbnailContainer.innerHTML = '';
      if (mainPreview) mainPreview.innerHTML = '';
      if (pageCountText) pageCountText.textContent = `/ ${this.totalPages}`;

      // Clear old observers
      this.pageObservers.forEach(obs => obs.disconnect());
      this.pageObservers.clear();

      this.renderedPages.clear();
      this.renderedThumbnails.clear();
      this.renderQueue = [];

      if (progressText) {
        progressText.textContent = 'Loading...';
      }

      // Create page placeholders
      for (let i = 0; i < this.totalPages; i++) {
        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageIndex = i;
        pageContainer.style.minHeight = `${initialMinHeight}px`;

        const loading = this.createLoadingElement(i + 1);
        pageContainer.appendChild(loading);
        mainPreview.appendChild(pageContainer);

        this.observePage(pageContainer, i);
      }

      // Create thumbnail placeholders
      for (let i = 0; i < this.totalPages; i++) {
        this.addThumbnailPlaceholder(i);
      }

      // Render first batch of thumbnails (up to 50)
      const batchSize = Math.min(50, this.totalPages);
      for (let i = 0; i < batchSize; i++) {
        if (renderId !== this.currentRenderId) return;

        if (progressText) {
          const pct = Math.round((i + 1) / this.totalPages * 100);
          progressText.textContent = `Thumbnails ${i + 1}/${this.totalPages} (${pct}%)`;
        }

        const page = await this.pdfDocument.getPage(i + 1);
        const canvas = await this.convertPageToDarkMode(page, theme, 0.4);

        if (renderId !== this.currentRenderId) return;

        this.replaceThumbnailPlaceholder(i, canvas);
        this.renderedThumbnails.add(i);
      }

      // Remaining thumbnails in background
      if (this.totalPages > batchSize) {
        if (progressText) {
          progressText.textContent = `${this.totalPages} pages — loading thumbnails...`;
        }
        this.renderRemainingThumbnails(batchSize, renderId, progressText);
      } else {
        if (progressText) {
          progressText.textContent = `${this.totalPages} page${this.totalPages > 1 ? 's' : ''}`;
        }
      }

      this.setupScrollSync();
      this.extractAllText(); // Start background extraction for search

    } catch (error) {
      console.error('PDF rendering error:', error);
      alert('Error processing PDF. Please try another file.');
    }
  }

  async extractAllText() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.disabled = true;
      searchInput.placeholder = 'Extracting text...';
    }

    this.textCache = new Array(this.totalPages);
    for (let i = 0; i < this.totalPages; i++) {
      try {
        const page = await this.pdfDocument.getPage(i + 1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        this.textCache[i] = text.toLowerCase();
      } catch (err) {
        this.textCache[i] = '';
      }
    }

    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = 'Find in document';
      if (searchInput.value) {
        this.executeSearch(searchInput.value);
      }
    }
  }

  executeSearch(query) {
    const resultText = document.getElementById('searchResultText');
    this.lastSearchQuery = query;
    this.searchResults = [];
    this.currentSearchIndex = -1;

    if (!query || !this.textCache) {
      if (resultText) resultText.textContent = '';
      this.clearHighlights();
      return;
    }

    query = query.toLowerCase();

    for (let i = 0; i < this.textCache.length; i++) {
      const text = this.textCache[i];
      if (!text) continue;
      
      let pos = text.indexOf(query);
      while (pos !== -1) {
        this.searchResults.push({ pageIndex: i, textIndex: pos });
        pos = text.indexOf(query, pos + 1);
      }
    }

    if (this.searchResults.length > 0) {
      this.navigateSearch(1); // Jump to first
    } else {
      if (resultText) resultText.textContent = '0 / 0';
      this.clearHighlights();
    }
  }

  navigateSearch(direction) {
    if (this.searchResults.length === 0) return;

    if (direction === 1) {
      this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
    } else {
      this.currentSearchIndex = (this.currentSearchIndex - 1 + this.searchResults.length) % this.searchResults.length;
    }

    const resultText = document.getElementById('searchResultText');
    if (resultText) {
      resultText.textContent = `${this.currentSearchIndex + 1} / ${this.searchResults.length}`;
    }

    const result = this.searchResults[this.currentSearchIndex];
    this.jumpToPage(result.pageIndex);
    this.highlightCurrentSearchResult();
  }

  clearHighlights() {
    try {
      window.getSelection().removeAllRanges();
    } catch(e) {}
    
    document.querySelectorAll('mark.search-highlight').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
  }

  highlightCurrentSearchResult() {
    if (!this.searchResults || this.searchResults.length === 0) return;
    const result = this.searchResults[this.currentSearchIndex];
    const pageIndex = result.pageIndex;
    const query = this.lastSearchQuery.toLowerCase();
    
    // Calculate which occurrence on this page is the active one
    let localMatchIndex = 0;
    for (let i = 0; i < this.currentSearchIndex; i++) {
      if (this.searchResults[i].pageIndex === pageIndex) {
        localMatchIndex++;
      }
    }
    
    const checkRendered = setInterval(() => {
      if (this.renderedPages.has(pageIndex)) {
        clearInterval(checkRendered);
        const container = document.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
        if (container) {
          const textLayer = container.querySelector('.text-layer');
          if (textLayer) {
            // Remove old highlights across the whole document
            this.clearHighlights();

            // Add new highlights
            const treeWalker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null, false);
            const nodesToHighlight = [];
            let node;
            while ((node = treeWalker.nextNode())) {
              if (node.nodeValue.toLowerCase().includes(query)) {
                nodesToHighlight.push(node);
              }
            }
            
            let currentLocalCounter = 0;
            let activeMark = null;

            nodesToHighlight.forEach(n => {
              const parent = n.parentNode;
              const text = n.nodeValue;
              const lowerText = text.toLowerCase();
              let matchIndex = lowerText.indexOf(query);
              
              if (matchIndex !== -1) {
                const frag = document.createDocumentFragment();
                let lastIdx = 0;
                
                // Highlight all occurrences in this text node
                while (matchIndex !== -1) {
                  if (matchIndex > lastIdx) {
                    frag.appendChild(document.createTextNode(text.substring(lastIdx, matchIndex)));
                  }
                  
                  const mark = document.createElement('mark');
                  mark.className = 'search-highlight';
                  
                  if (currentLocalCounter === localMatchIndex) {
                    mark.style.backgroundColor = '#FF9800'; // Orange for active
                    mark.style.color = '#fff';
                    mark.style.outline = '2px solid #FF9800';
                    mark.style.outlineOffset = '1px';
                    mark.style.borderRadius = '2px';
                    activeMark = mark;
                  } else {
                    mark.style.backgroundColor = 'rgba(255, 255, 0, 0.6)'; // Yellow for others
                    mark.style.color = '#000';
                  }
                  
                  mark.textContent = text.substring(matchIndex, matchIndex + query.length);
                  frag.appendChild(mark);
                  
                  currentLocalCounter++;
                  lastIdx = matchIndex + query.length;
                  matchIndex = lowerText.indexOf(query, lastIdx);
                }
                
                if (lastIdx < text.length) {
                  frag.appendChild(document.createTextNode(text.substring(lastIdx)));
                }
                
                parent.replaceChild(frag, n);
              }
            });

            if (activeMark) {
               activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
               container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }
      }
    }, 100);
    
    setTimeout(() => clearInterval(checkRendered), 5000);
  }

  async renderRemainingThumbnails(startIndex, renderId, progressText) {
    const theme = this.themes[this.currentTheme];
    const batchSize = 50;

    for (let start = startIndex; start < this.totalPages; start += batchSize) {
      const end = Math.min(start + batchSize, this.totalPages);

      for (let i = start; i < end && i < this.totalPages; i++) {
        if (renderId !== this.currentRenderId) return;
        if (this.renderedThumbnails.has(i)) continue;

        try {
          const page = await this.pdfDocument.getPage(i + 1);
          const canvas = await this.convertPageToDarkMode(page, theme, 0.4);

          if (renderId !== this.currentRenderId) return;

          this.replaceThumbnailPlaceholder(i, canvas);
          this.renderedThumbnails.add(i);

          if (progressText && i % 10 === 0) {
            const pct = Math.round((i + 1) / this.totalPages * 100);
            progressText.textContent = `Thumbnails ${i + 1}/${this.totalPages} (${pct}%)`;
          }
        } catch (err) {
          console.error(`Thumbnail ${i + 1} error:`, err);
        }

        if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (renderId !== this.currentRenderId) return;
    }

    if (progressText) {
      progressText.textContent = `${this.totalPages} page${this.totalPages > 1 ? 's' : ''}`;
    }
  }

  // --- Lazy loading via IntersectionObserver ---
  observePage(pageContainer, pageIndex) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.renderedPages.has(pageIndex)) {
            this.addToRenderQueue(pageContainer, pageIndex);
            observer.unobserve(pageContainer);
          }
        }
      },
      {
        root: document.getElementById('mainPreview'),
        rootMargin: '300px',
        threshold: 0.01
      }
    );

    observer.observe(pageContainer);
    this.pageObservers.set(pageIndex, observer);
  }

  addToRenderQueue(pageContainer, pageIndex) {
    if (this.renderedPages.has(pageIndex)) return;
    if (!this.renderQueue.find(item => item.pageIndex === pageIndex)) {
      this.renderQueue.push({ pageContainer, pageIndex });
      this.renderQueue.sort((a, b) => a.pageIndex - b.pageIndex);
    }
    this.processRenderQueue();
  }

  async processRenderQueue() {
    if (this.isRendering || this.renderQueue.length === 0) return;
    this.isRendering = true;

    while (this.renderQueue.length > 0) {
      const { pageContainer, pageIndex } = this.renderQueue.shift();
      if (!this.renderedPages.has(pageIndex)) {
        await this.renderPageContent(pageContainer, pageIndex);
      }
    }

    this.isRendering = false;
  }

  async renderPageContent(pageContainer, pageIndex) {
    if (this.renderedPages.has(pageIndex)) return;

    try {
      const page = await this.pdfDocument.getPage(pageIndex + 1);
      const theme = this.themes[this.currentTheme];
      const scale = this.currentScale;
      const rotation = this.currentRotation;
      
      const largeCanvas = await this.convertPageToDarkMode(page, theme, scale, rotation);

      pageContainer.innerHTML = '';
      largeCanvas.style.maxWidth = '100%';
      largeCanvas.style.height = 'auto';
      largeCanvas.style.borderRadius = '4px';
      largeCanvas.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'page-wrapper';
      pageWrapper.appendChild(largeCanvas);

      // Text layer for copy support
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      pageWrapper.appendChild(textLayer);

      pageContainer.appendChild(pageWrapper);
      await this.renderTextLayer(page, textLayer, scale, rotation, largeCanvas);

      this.renderedPages.add(pageIndex);
    } catch (error) {
      console.error(`Page ${pageIndex + 1} error:`, error);
      pageContainer.innerHTML = '<div class="error-msg">Error loading page</div>';
    }
  }

  // --- Scroll sync: highlight active thumbnail ---
  setupScrollSync() {
    const mainPreview = document.getElementById('mainPreview');
    if (!mainPreview) return;

    let scrollTimeout;
    mainPreview.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.updateActiveThumbnail();
      }, 80);
    });
  }

  updateActiveThumbnail() {
    const mainPreview = document.getElementById('mainPreview');
    if (!mainPreview) return;

    const scrollTop = mainPreview.scrollTop;
    const viewportHeight = mainPreview.clientHeight;
    const centerY = scrollTop + viewportHeight / 2;

    const pageContainers = mainPreview.querySelectorAll('.page-container');
    let currentPageIndex = 0;
    let minDistance = Infinity;

    pageContainers.forEach((container, index) => {
      const containerCenter = container.offsetTop + container.offsetHeight / 2;
      const distance = Math.abs(containerCenter - centerY);
      if (distance < minDistance) {
        minDistance = distance;
        currentPageIndex = index;
      }
    });

    let activeThumbnail = null;
    document.querySelectorAll('#thumbnailContainer .thumbnail-item').forEach((el, index) => {
      const frame = el.querySelector('.thumbnail-frame');
      if (!frame) return;
      if (index === currentPageIndex) {
        frame.classList.add('active');
        activeThumbnail = el;
      } else {
        frame.classList.remove('active');
      }
    });

    // Update Toolbar Page Nav
    const pageInput = document.getElementById('pageInput');
    const pageCountText = document.getElementById('pageCountText');
    if (pageInput && parseInt(pageInput.value, 10) !== currentPageIndex + 1) {
      pageInput.value = currentPageIndex + 1;
    }
    if (pageCountText) {
      pageCountText.textContent = `/ ${this.totalPages}`;
    }

    if (this.activeThumbnailIndex !== currentPageIndex) {
      this.activeThumbnailIndex = currentPageIndex;
      this.scrollThumbnailIntoView(activeThumbnail);
    }
  }

  scrollThumbnailIntoView(thumbnailEl) {
    if (!thumbnailEl) return;
    const container = document.getElementById('thumbnailContainer');
    if (!container) return;

    const sidebar = document.getElementById('thumbnailSidebar');
    if (!sidebar) return;

    const margin = 24;
    const containerTop = sidebar.scrollTop;
    const containerBottom = containerTop + sidebar.clientHeight;
    const thumbnailTop = thumbnailEl.offsetTop;
    const thumbnailBottom = thumbnailTop + thumbnailEl.offsetHeight;

    if (thumbnailTop < containerTop + margin) {
      sidebar.scrollTo({ top: Math.max(thumbnailTop - margin, 0), behavior: 'auto' });
    } else if (thumbnailBottom > containerBottom - margin) {
      sidebar.scrollTo({ top: Math.max(thumbnailBottom - sidebar.clientHeight + margin, 0), behavior: 'auto' });
    }
  }

  // --- Core: convert a PDF page to dark mode ---
  async convertPageToDarkMode(page, theme, scale = 1.5, rotation = 0) {
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    // Apply dark mode color inversion
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const bgR = theme.r;
    const bgG = theme.g;
    const bgB = theme.b;

    for (let j = 0; j < data.length; j += 4) {
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      
      const r_norm = r / 255;
      const g_norm = g / 255;
      const b_norm = b / 255;
      
      const max = Math.max(r_norm, g_norm, b_norm);
      const min = Math.min(r_norm, g_norm, b_norm);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r_norm: h = (g_norm - b_norm) / d + (g_norm < b_norm ? 6 : 0); break;
          case g_norm: h = (b_norm - r_norm) / d + 2; break;
          case b_norm: h = (r_norm - g_norm) / d + 4; break;
        }
        h /= 6;
      }

      // If it's a grayscale pixel (low saturation), map directly to theme background
      if (s < 0.1) {
        const factor = 1 - l; // inverted lightness
        // 230 instead of 255 to make text a soft off-white, reducing eye strain
        data[j]     = bgR + (230 - bgR) * factor; 
        data[j + 1] = bgG + (230 - bgG) * factor;
        data[j + 2] = bgB + (230 - bgB) * factor;
      } else {
        // Colored pixel: Invert lightness but preserve hue
        l = 1.0 - l;
        // Slightly boost saturation to make colors pop on dark backgrounds
        s = Math.min(1.0, s * 1.2);
        
        let newR, newG, newB;
        if (s === 0) {
          newR = newG = newB = l;
        } else {
          const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
          };
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          newR = hue2rgb(p, q, h + 1/3);
          newG = hue2rgb(p, q, h);
          newB = hue2rgb(p, q, h - 1/3);
        }
        data[j] = Math.round(newR * 255);
        data[j+1] = Math.round(newG * 255);
        data[j+2] = Math.round(newB * 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // --- Text layer rendering (for copy/paste) ---
  async renderTextLayer(page, textLayer, scale, rotation, canvas) {
    if (typeof pdfjsLib === 'undefined' || typeof pdfjsLib.renderTextLayer !== 'function') {
      return;
    }

    const viewport = page.getViewport({ scale, rotation });
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
      this.syncTextLayerScale(textLayer, canvas);
    });
  }

  syncTextLayerScale(textLayer, canvas) {
    if (!textLayer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    textLayer.style.transformOrigin = '0 0';
    textLayer.style.transform = `scale(${scaleX}, ${scaleY})`;
  }

  // --- Thumbnail helpers ---
  addThumbnailPlaceholder(pageIndex) {
    const container = document.getElementById('thumbnailContainer');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.pageIndex = pageIndex;
    item.id = `thumbnail-${pageIndex}`;

    const frame = document.createElement('div');
    frame.className = 'thumbnail-frame';

    const placeholder = document.createElement('div');
    placeholder.className = 'thumbnail-placeholder';
    const span = document.createElement('span');
    span.textContent = '...';
    placeholder.appendChild(span);

    frame.appendChild(placeholder);

    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.textContent = pageIndex + 1;

    item.appendChild(frame);
    item.appendChild(label);

    // Click to scroll
    item.addEventListener('click', () => {
      const mainPreview = document.getElementById('mainPreview');
      const pageEl = mainPreview?.querySelector(`[data-page-index="${pageIndex}"]`);
      if (pageEl) {
        mainPreview.scrollTo({ top: pageEl.offsetTop, behavior: 'smooth' });
      }
    });

    container.appendChild(item);
  }

  replaceThumbnailPlaceholder(pageIndex, canvas) {
    const item = document.getElementById(`thumbnail-${pageIndex}`);
    if (!item) return;

    const frame = item.querySelector('.thumbnail-frame');
    if (!frame) return;

    const placeholder = frame.querySelector('.thumbnail-placeholder');
    if (placeholder) placeholder.remove();

    canvas.style.width = '100%';
    canvas.style.display = 'block';
    frame.appendChild(canvas);
  }

  createLoadingElement(pageNumber) {
    const wrapper = document.createElement('div');
    wrapper.className = 'loading-spinner';

    const spinner = document.createElement('div');
    spinner.className = 'spinner-icon';

    const text = document.createElement('p');
    text.className = 'loading-text';
    text.textContent = `Loading page ${pageNumber}...`;

    wrapper.appendChild(spinner);
    wrapper.appendChild(text);
    return wrapper;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new PDFDarkMode();
});
