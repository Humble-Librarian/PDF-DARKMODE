// ============================================================
// app.js — PDF Dark Mode Reader (Orchestrator)
// Thin coordinator that wires together the modular subsystems:
//   DarkModeProcessor, RenderEngine, ThumbnailManager, UIController
// ============================================================

class PDFDarkMode {
  constructor() {
    // Core state
    this.originalPdfData = null;
    this.originalFileName = '';
    this.pdfDocument = null;
    this.currentTheme = 'claude';
    this.currentScale = 1.0;
    this.currentRotation = 0;

    // Subsystems (initialized when a PDF is loaded)
    this.darkModeProcessor = new DarkModeProcessor();
    this.renderEngine = null;
    this.thumbnailManager = null;
    this.outlineManager = null;
    this.uiController = null;

    this.init();
  }

  // ---------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------

  init() {
    // Configure PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      }
    }

    // Check if we were passed a URL to convert directly
    const urlParams = new URLSearchParams(window.location.search);
    const pdfUrl = urlParams.get('url');
    const pdfTitle = urlParams.get('title');

    if (pdfUrl) {
      this.originalFileName = pdfTitle ? pdfTitle.replace(/\.pdf$/i, '') : 'Document';
      this.fetchAndRenderPDF(pdfUrl);
      return; // Skip file input setup until after fetch
    }

    this._setupFileInput();
  }

  _setupFileInput() {
    // File input
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this._handleFileSelect(e));
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
          this._handleFile(e.dataTransfer.files[0]);
        }
      });
    }
  }

  // ---------------------------------------------------------------
  // File Handling
  // ---------------------------------------------------------------

  _handleFileSelect(event) {
    if (event.target.files.length > 0) {
      this._handleFile(event.target.files[0]);
    }
  }

  _handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a valid PDF file.');
      return;
    }

    this.originalFileName = file.name.replace(/\.pdf$/i, '');
    const fileReader = new FileReader();

    fileReader.onload = async () => {
      const fileData = new Uint8Array(fileReader.result);
      this.originalPdfData = fileData;
      this._showPreview();
      await this._loadPDF(fileData);
    };

    fileReader.readAsArrayBuffer(file);
  }

  async fetchAndRenderPDF(url) {
    this._showPreview();
    const progressText = document.getElementById('progressText');
    if (progressText) progressText.textContent = 'Downloading PDF...';

    try {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error('Network response was not ok');

      const arrayBuffer = await response.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      this.originalPdfData = fileData;

      if (progressText) progressText.textContent = '';
      await this._loadPDF(fileData);
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Could not download this PDF automatically (it might be blocked or require login). Please download the PDF to your computer and upload it here manually.');
      this._goBack();
    }
  }

  // ---------------------------------------------------------------
  // PDF Loading & Subsystem Setup
  // ---------------------------------------------------------------

  async _loadPDF(pdfData) {
    const progressText = document.getElementById('progressText');

    try {
      // Destroy previous subsystems if any
      this._destroySubsystems();

      if (progressText) progressText.textContent = 'Loading PDF...';

      // Load PDF document
      this.pdfDocument = await pdfjsLib.getDocument({ data: pdfData }).promise;

      if (progressText) progressText.textContent = '';

      // Set up file input for future uploads (in case we came from URL)
      this._setupFileInput();

      // Initialize subsystems
      await this._initSubsystems();

    } catch (error) {
      console.error('PDF loading error:', error);
      if (progressText) progressText.textContent = '';
      alert('Error processing PDF. Please try another file.');
    }
  }

  async _initSubsystems() {
    const mainPreview = document.getElementById('mainPreview');
    const thumbnailContainer = document.getElementById('thumbnailContainer');
    const sidebarPanel = document.getElementById('sidebarPanel') || document.getElementById('thumbnailSidebar');

    if (!mainPreview || !thumbnailContainer) {
      console.error('Required DOM elements not found');
      return;
    }

    // 1. Initialize Render Engine
    this.renderEngine = new RenderEngine({
      pdfDocument: this.pdfDocument,
      container: mainPreview,
      darkModeProcessor: this.darkModeProcessor,
      theme: this.currentTheme,
      scale: this.currentScale,
      rotation: this.currentRotation,
      onVisibleRangeChanged: (start, end) => {
        // Could be used for analytics or debugging
      },
      onPageRendered: (pageIndex) => {
        // Could trigger thumbnail update
      }
    });

    await this.renderEngine.init();

    // 2. Initialize Thumbnail Manager
    this.thumbnailManager = new ThumbnailManager({
      container: thumbnailContainer,
      sidebarElement: sidebarPanel,
      pdfDocument: this.pdfDocument,
      darkModeProcessor: this.darkModeProcessor,
      theme: this.currentTheme,
      onThumbnailClick: (pageIndex) => {
        this.renderEngine.jumpToPage(pageIndex);
      }
    });

    await this.thumbnailManager.init();

    // 3. Initialize Outline Manager (if PDF has bookmarks)
    const outlineContainer = document.getElementById('outlineContainer');
    const toggleOutlineBtn = document.getElementById('toggleOutlineBtn');
    if (outlineContainer) {
      try {
        const outline = await this.pdfDocument.getOutline();
        if (outline && outline.length > 0) {
          this.outlineManager = new OutlineManager(
            outlineContainer,
            (pageIndex) => this.renderEngine.jumpToPage(pageIndex)
          );
          const hasOutline = await this.outlineManager.init(outline, this.pdfDocument);
          if (hasOutline && toggleOutlineBtn) {
            toggleOutlineBtn.disabled = false;
            toggleOutlineBtn.title = 'Document Outline (Ctrl+Shift+O)';
          }
        } else {
          if (toggleOutlineBtn) {
            toggleOutlineBtn.disabled = true;
            toggleOutlineBtn.title = 'No outline available';
          }
        }
      } catch (err) {
        console.warn('Could not load PDF outline:', err);
        if (toggleOutlineBtn) {
          toggleOutlineBtn.disabled = true;
          toggleOutlineBtn.title = 'No outline available';
        }
      }
    }

    // 4. Initialize UI Controller
    this.uiController = new UIController({
      renderEngine: this.renderEngine,
      thumbnailManager: this.thumbnailManager,
      outlineManager: this.outlineManager,
      darkModeProcessor: this.darkModeProcessor,
      onThemeChange: (themeName) => this._handleThemeChange(themeName),
      onBackClick: () => this._goBack()
    });

    this.uiController.init();

    // Update initial UI state
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    if (fileNameDisplay) {
      fileNameDisplay.textContent = this.originalFileName + '.pdf';
    }

    const zoomText = document.getElementById('zoomLevelText');
    if (zoomText) {
      zoomText.textContent = `${Math.round(this.currentScale * 100)}%`;
    }

    const pageCountText = document.getElementById('pageCountText');
    if (pageCountText) {
      pageCountText.textContent = `/ ${this.renderEngine.getTotalPages()}`;
    }
  }

  // ---------------------------------------------------------------
  // Theme Management
  // ---------------------------------------------------------------

  _handleThemeChange(themeName) {
    this.currentTheme = themeName;

    // Update all subsystems (CSS-based, no re-render needed!)
    if (this.renderEngine) {
      this.renderEngine.setTheme(themeName);
    }
    if (this.thumbnailManager) {
      this.thumbnailManager.setTheme(themeName);
    }
  }

  // ---------------------------------------------------------------
  // UI State Management
  // ---------------------------------------------------------------

  _showPreview() {
    const uploadSection = document.getElementById('uploadSection');
    const previewSection = document.getElementById('previewSection');
    const fileNameDisplay = document.getElementById('fileNameDisplay');

    uploadSection?.classList.add('hidden');
    previewSection?.classList.remove('hidden');

    if (fileNameDisplay) {
      fileNameDisplay.textContent = this.originalFileName + '.pdf';
    }
  }

  _goBack() {
    // Destroy all subsystems
    this._destroySubsystems();

    // Reset state
    this.originalPdfData = null;
    this.originalFileName = '';
    this.pdfDocument = null;

    // Clear containers
    const tc = document.getElementById('thumbnailContainer');
    const mp = document.getElementById('mainPreview');
    const oc = document.getElementById('outlineContainer');
    if (tc) tc.innerHTML = '';
    if (mp) {
      mp.innerHTML = '';
    }
    if (oc) {
      oc.innerHTML = '';
      oc.style.display = 'none';
    }

    // Reset sidebar state (restore thumbnails view, disable outline)
    const toggleOutlineBtn = document.getElementById('toggleOutlineBtn');
    const toggleThumbnailsBtn = document.getElementById('toggleThumbnailsBtn');
    if (toggleOutlineBtn) {
      toggleOutlineBtn.disabled = true;
      toggleOutlineBtn.title = 'Document Outline';
      toggleOutlineBtn.classList.remove('active');
    }
    if (toggleThumbnailsBtn) {
      toggleThumbnailsBtn.classList.add('active');
    }
    if (tc) tc.style.display = '';

    // Reset file input
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) fileInput.value = '';

    // Clear progress
    const progressText = document.getElementById('progressText');
    if (progressText) progressText.textContent = '';

    // If there's a URL parameter, strip it to prevent reload loop
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Show upload section
    const uploadSection = document.getElementById('uploadSection');
    const previewSection = document.getElementById('previewSection');
    uploadSection?.classList.remove('hidden');
    previewSection?.classList.add('hidden');
  }

  _destroySubsystems() {
    if (this.uiController) {
      this.uiController.destroy();
      this.uiController = null;
    }
    if (this.outlineManager) {
      this.outlineManager.destroy();
      this.outlineManager = null;
    }
    if (this.thumbnailManager) {
      this.thumbnailManager.destroy();
      this.thumbnailManager = null;
    }
    if (this.renderEngine) {
      this.renderEngine.destroy();
      this.renderEngine = null;
    }
  }
}

// ---------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  window.pdfDarkMode = new PDFDarkMode();
});
