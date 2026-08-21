// ============================================================
// AnnotationManager.js — PDF Annotation Engine
// Handles SVG overlay rendering, drawing tools (Ink, Highlight,
// FreeText, Eraser), virtualization state sync, and persistence.
// ============================================================

class AnnotationManager {
  constructor() {
    // Current active tool: 'select' | 'draw' | 'highlight' | 'text' | 'eraser'
    this.activeTool = 'select';
    this.currentColor = '#ff4757'; // Default draw color (Red)
    this.currentHighlightColor = '#fffa65'; // Default highlight color (Yellow)
    this.strokeWidth = 3;

    // Canonical annotation store: pageIndex -> Map<annotationId, annotationObj>
    this.store = new Map();

    // Active drawing state
    this._isDrawing = false;
    this._currentPathObj = null;
    this._currentSvgPath = null;
    this._lastPoint = null;

    // Callbacks
    this.onStateChange = null;

    // Attach document-wide pointer listeners for drawing/erasing
    this._bindPointerEvents();
  }

  // ---------------------------------------------------------------
  // Tool & State Management
  // ---------------------------------------------------------------

  setTool(toolName) {
    this.activeTool = toolName;
    this._updateLayerPointerEvents();
    if (typeof this.onStateChange === 'function') {
      this.onStateChange({ activeTool: this.activeTool, color: this.currentColor });
    }
  }

  setColor(colorHex) {
    if (this.activeTool === 'highlight') {
      this.currentHighlightColor = colorHex;
    } else {
      this.currentColor = colorHex;
    }
  }

  setStrokeWidth(width) {
    this.strokeWidth = width;
  }

  // ---------------------------------------------------------------
  // Data Store & Hydration
  // ---------------------------------------------------------------

  loadAnnotations(annotationsPayload) {
    this.store.clear();
    if (!annotationsPayload || typeof annotationsPayload !== 'object') return;

    Object.keys(annotationsPayload).forEach((pageIdxStr) => {
      const pageIdx = parseInt(pageIdxStr, 10);
      const list = annotationsPayload[pageIdxStr];
      if (Array.isArray(list)) {
        const pageMap = new Map();
        list.forEach((item) => {
          if (item && item.id) {
            pageMap.set(item.id, item);
          }
        });
        this.store.set(pageIdx, pageMap);
      }
    });

    this.renderAllActiveLayers();
  }

  serialize() {
    const payload = {};
    this.store.forEach((pageMap, pageIdx) => {
      if (pageMap.size > 0) {
        payload[pageIdx] = Array.from(pageMap.values());
      }
    });
    return payload;
  }

  getAnnotationsForPage(pageIndex) {
    return this.store.get(pageIndex) || new Map();
  }

  addAnnotation(pageIndex, annotationObj) {
    if (!this.store.has(pageIndex)) {
      this.store.set(pageIndex, new Map());
    }
    this.store.get(pageIndex).set(annotationObj.id, annotationObj);
    this.notifyChange();
  }

  deleteAnnotation(pageIndex, annotationId) {
    const pageMap = this.store.get(pageIndex);
    if (pageMap && pageMap.has(annotationId)) {
      pageMap.delete(annotationId);
      this.notifyChange();
    }
  }

  clearPage(pageIndex) {
    const pageMap = this.store.get(pageIndex);
    if (pageMap) {
      pageMap.clear();
      this.notifyChange();
      this.renderPageLayer(pageIndex);
    }
  }

  notifyChange() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange({ annotations: this.serialize() });
    }
  }

  // ---------------------------------------------------------------
  // SVG Layer Mounting & Lifecycle
  // ---------------------------------------------------------------

  createPageLayer(pageIndex, viewport) {
    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.className = 'annotation-layer';
    svgLayer.dataset.pageIndex = pageIndex;
    
    // Set unscaled PDF point viewBox (1:1 mapping)
    const baseWidth = viewport.width / (viewport.scale || 1.0);
    const baseHeight = viewport.height / (viewport.scale || 1.0);
    svgLayer.setAttribute('viewBox', `0 0 ${baseWidth} ${baseHeight}`);
    svgLayer.dataset.baseWidth = baseWidth;
    svgLayer.dataset.baseHeight = baseHeight;

    this.renderPageLayerInto(pageIndex, svgLayer);
    return svgLayer;
  }

  renderPageLayer(pageIndex) {
    const container = document.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
    if (!container) return;
    const svgLayer = container.querySelector('.annotation-layer');
    if (!svgLayer) return;

    this.renderPageLayerInto(pageIndex, svgLayer);
  }

  renderPageLayerInto(pageIndex, svgLayer) {
    svgLayer.innerHTML = '';
    const pageMap = this.getAnnotationsForPage(pageIndex);

    pageMap.forEach((annot) => {
      const el = this._createSvgElementForAnnotation(annot);
      if (el) {
        svgLayer.appendChild(el);
      }
    });
  }

  renderAllActiveLayers() {
    const layers = document.querySelectorAll('.annotation-layer[data-page-index]');
    layers.forEach((layer) => {
      const pageIndex = parseInt(layer.dataset.pageIndex, 10);
      if (!isNaN(pageIndex)) {
        this.renderPageLayerInto(pageIndex, layer);
      }
    });
  }

  // ---------------------------------------------------------------
  // Pointer Events & Interactions
  // ---------------------------------------------------------------

  _bindPointerEvents() {
    document.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    document.addEventListener('pointermove', (e) => this._onPointerMove(e));
    document.addEventListener('pointerup', (e) => this._onPointerUp(e));
    document.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  _updateLayerPointerEvents() {
    const layers = document.querySelectorAll('.annotation-layer');
    layers.forEach((layer) => {
      if (this.activeTool === 'select') {
        layer.style.pointerEvents = 'none';
      } else {
        layer.style.pointerEvents = 'auto';
      }
    });

    const textLayers = document.querySelectorAll('.text-layer');
    textLayers.forEach((tl) => {
      if (this.activeTool === 'draw' || this.activeTool === 'eraser' || this.activeTool === 'highlight_draw') {
        tl.style.pointerEvents = 'none';
      } else {
        tl.style.pointerEvents = 'auto';
      }
    });
  }

  _getSvgPt(svg, evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      return pt.matrixTransform(ctm.inverse());
    }
    return { x: 0, y: 0 };
  }

  _onPointerDown(e) {
    if (this.activeTool === 'select') return;

    const layer = e.target.closest('.annotation-layer');
    if (!layer) return;

    const pageIndex = parseInt(layer.dataset.pageIndex, 10);
    if (isNaN(pageIndex)) return;

    // Handle Eraser
    if (this.activeTool === 'eraser') {
      const targetAnnot = e.target.closest('[data-annotation-id]');
      if (targetAnnot) {
        const id = targetAnnot.dataset.annotationId;
        this.deleteAnnotation(pageIndex, id);
        targetAnnot.remove();
      }
      return;
    }

    // Handle FreeText Click
    if (this.activeTool === 'text') {
      const pt = this._getSvgPt(layer, e);
      this._promptFreeText(pageIndex, layer, pt.x, pt.y);
      return;
    }

    // Handle Drawing / Highlight Drawing
    if (this.activeTool === 'draw' || this.activeTool === 'highlight') {
      e.preventDefault();
      this._isDrawing = true;

      const pt = this._getSvgPt(layer, e);
      const isHighlight = this.activeTool === 'highlight';
      const color = isHighlight ? this.currentHighlightColor : this.currentColor;
      const width = isHighlight ? 16 : this.strokeWidth;
      const opacity = isHighlight ? 0.4 : 1.0;

      const annotId = 'annot_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      
      this._currentPathObj = {
        id: annotId,
        type: 'ink',
        isHighlight: isHighlight,
        color: color,
        strokeWidth: width,
        opacity: opacity,
        d: `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`,
        pageIndex: pageIndex
      };

      this._lastPoint = pt;

      // Create SVG Element live
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', this._currentPathObj.d);
      pathEl.setAttribute('stroke', color);
      pathEl.setAttribute('stroke-width', width);
      pathEl.setAttribute('stroke-linecap', 'round');
      pathEl.setAttribute('stroke-linejoin', 'round');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('opacity', opacity);
      pathEl.dataset.annotationId = annotId;

      layer.appendChild(pathEl);
      this._currentSvgPath = pathEl;
    }
  }

  _onPointerMove(e) {
    if (!this._isDrawing || !this._currentPathObj || !this._currentSvgPath) return;

    const layer = this._currentSvgPath.closest('.annotation-layer');
    if (!layer) return;

    const pt = this._getSvgPt(layer, e);

    // Euclidean distance squared throttling: (dx^2 + dy^2 > 16) -> >4px movement
    const dx = pt.x - this._lastPoint.x;
    const dy = pt.y - this._lastPoint.y;
    if (dx * dx + dy * dy < 16) return;

    this._currentPathObj.d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    this._currentSvgPath.setAttribute('d', this._currentPathObj.d);
    this._lastPoint = pt;
  }

  _onPointerUp() {
    if (!this._isDrawing) return;

    if (this._currentPathObj && this._currentSvgPath) {
      this.addAnnotation(this._currentPathObj.pageIndex, this._currentPathObj);
    }

    this._isDrawing = false;
    this._currentPathObj = null;
    this._currentSvgPath = null;
    this._lastPoint = null;
  }

  // ---------------------------------------------------------------
  // FreeText Note Input
  // ---------------------------------------------------------------

  _promptFreeText(pageIndex, layer, x, y) {
    const textStr = prompt('Enter annotation text:');
    if (!textStr || !textStr.trim()) return;

    const annotId = 'text_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const annotObj = {
      id: annotId,
      type: 'text',
      text: textStr.trim(),
      x: x,
      y: y,
      color: this.currentColor,
      fontSize: 16,
      pageIndex: pageIndex
    };

    this.addAnnotation(pageIndex, annotObj);
    const el = this._createSvgElementForAnnotation(annotObj);
    if (el) layer.appendChild(el);
  }

  // ---------------------------------------------------------------
  // SVG Shape Generation Helper
  // ---------------------------------------------------------------

  _createSvgElementForAnnotation(annot) {
    if (!annot || !annot.type) return null;

    if (annot.type === 'ink') {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', annot.d);
      path.setAttribute('stroke', annot.color);
      path.setAttribute('stroke-width', annot.strokeWidth || 3);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', annot.opacity !== undefined ? annot.opacity : 1.0);
      path.dataset.annotationId = annot.id;
      return path;
    }

    if (annot.type === 'text') {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', annot.x);
      text.setAttribute('y', annot.y);
      text.setAttribute('fill', annot.color || '#ff4757');
      text.setAttribute('font-size', annot.fontSize || 16);
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('font-weight', '500');
      text.textContent = annot.text;
      text.dataset.annotationId = annot.id;
      return text;
    }

    return null;
  }
}
