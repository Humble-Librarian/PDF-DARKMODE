// ============================================================
// AnnotationManager.js — PDF Annotation Engine
// Handles SVG overlay rendering, drawing tools (Ink, Rect Highlight,
// Inline FreeText Box, Eraser), virtualization sync, and persistence.
// ============================================================

class AnnotationManager {
  constructor() {
    // Current active tool: 'select' | 'draw' | 'highlight' | 'text' | 'eraser'
    this.activeTool = 'select';
    this.currentColor = '#ff4757'; // Default pen color (Red)
    this.currentHighlightColor = '#fffa65'; // Default highlight color (Yellow)
    this.strokeWidth = 3;

    // Canonical annotation store: pageIndex -> Map<annotationId, annotationObj>
    this.store = new Map();

    // Active drawing/stretching state
    this._isDrawing = false;
    this._isHighlightingBox = false;
    this._startPt = null;
    this._currentPathObj = null;
    this._currentSvgElement = null;
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
    if (!viewport) return null;
    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.setAttribute('class', 'annotation-layer');
    svgLayer.dataset.pageIndex = pageIndex;
    
    // Set unscaled PDF point viewBox (1:1 mapping)
    const scale = (viewport.scale && viewport.scale > 0) ? viewport.scale : 1.0;
    const baseWidth = (viewport.width || 600) / scale;
    const baseHeight = (viewport.height || 800) / scale;
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
      if (this.activeTool === 'draw' || this.activeTool === 'eraser' || this.activeTool === 'highlight' || this.activeTool === 'text') {
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

    const layer = e.target.closest ? e.target.closest('.annotation-layer') : null;
    if (!layer) return;

    const pageIndex = parseInt(layer.dataset.pageIndex, 10);
    if (isNaN(pageIndex)) return;

    // Handle Eraser
    if (this.activeTool === 'eraser') {
      const targetAnnot = e.target.closest ? e.target.closest('[data-annotation-id]') : null;
      if (targetAnnot) {
        const id = targetAnnot.dataset.annotationId;
        this.deleteAnnotation(pageIndex, id);
        targetAnnot.remove();
      }
      return;
    }

    // Handle Inline Text Box Creation (Direct typing on page)
    if (this.activeTool === 'text') {
      const pt = this._getSvgPt(layer, e);
      this._createInlineTextbox(pageIndex, layer, pt.x, pt.y);
      return;
    }

    // Handle Rectangular Box Highlight Tool
    if (this.activeTool === 'highlight') {
      e.preventDefault();
      this._isHighlightingBox = true;

      const pt = this._getSvgPt(layer, e);
      this._startPt = pt;

      const annotId = 'rect_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      this._currentPathObj = {
        id: annotId,
        type: 'rect_highlight',
        x: pt.x,
        y: pt.y,
        width: 1,
        height: 1,
        color: this.currentHighlightColor,
        opacity: 0.4,
        pageIndex: pageIndex
      };

      const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectEl.setAttribute('x', pt.x);
      rectEl.setAttribute('y', pt.y);
      rectEl.setAttribute('width', 1);
      rectEl.setAttribute('height', 1);
      rectEl.setAttribute('fill', this.currentHighlightColor);
      rectEl.setAttribute('opacity', 0.4);
      rectEl.setAttribute('rx', 3);
      rectEl.setAttribute('ry', 3);
      rectEl.dataset.annotationId = annotId;

      layer.appendChild(rectEl);
      this._currentSvgElement = rectEl;
      return;
    }

    // Handle Pen / Draw Tool
    if (this.activeTool === 'draw') {
      e.preventDefault();
      this._isDrawing = true;

      const pt = this._getSvgPt(layer, e);
      const color = this.currentColor;
      const width = this.strokeWidth;

      const annotId = 'ink_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      
      this._currentPathObj = {
        id: annotId,
        type: 'ink',
        color: color,
        strokeWidth: width,
        opacity: 1.0,
        d: `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`,
        pageIndex: pageIndex
      };

      this._lastPoint = pt;

      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', this._currentPathObj.d);
      pathEl.setAttribute('stroke', color);
      pathEl.setAttribute('stroke-width', width);
      pathEl.setAttribute('stroke-linecap', 'round');
      pathEl.setAttribute('stroke-linejoin', 'round');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('opacity', 1.0);
      pathEl.dataset.annotationId = annotId;

      layer.appendChild(pathEl);
      this._currentSvgElement = pathEl;
    }
  }

  _onPointerMove(e) {
    if (this._isHighlightingBox && this._currentPathObj && this._currentSvgElement && this._startPt) {
      const layer = this._currentSvgElement.closest ? this._currentSvgElement.closest('.annotation-layer') : null;
      if (!layer) return;

      const pt = this._getSvgPt(layer, e);
      if (!pt) return;

      const x = Math.min(this._startPt.x, pt.x);
      const y = Math.min(this._startPt.y, pt.y);
      const w = Math.max(2, Math.abs(pt.x - this._startPt.x));
      const h = Math.max(2, Math.abs(pt.y - this._startPt.y));

      this._currentPathObj.x = x;
      this._currentPathObj.y = y;
      this._currentPathObj.width = w;
      this._currentPathObj.height = h;

      this._currentSvgElement.setAttribute('x', x);
      this._currentSvgElement.setAttribute('y', y);
      this._currentSvgElement.setAttribute('width', w);
      this._currentSvgElement.setAttribute('height', h);
      return;
    }

    if (this._isDrawing && this._currentPathObj && this._currentSvgElement && this._lastPoint) {
      const layer = this._currentSvgElement.closest ? this._currentSvgElement.closest('.annotation-layer') : null;
      if (!layer) return;

      const pt = this._getSvgPt(layer, e);
      if (!pt) return;

      const dx = pt.x - (this._lastPoint.x || 0);
      const dy = pt.y - (this._lastPoint.y || 0);
      if (dx * dx + dy * dy < 16) return;

      this._currentPathObj.d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      this._currentSvgElement.setAttribute('d', this._currentPathObj.d);
      this._lastPoint = pt;
    }
  }

  _onPointerUp() {
    if (this._isHighlightingBox) {
      if (this._currentPathObj && this._currentSvgElement) {
        if (this._currentPathObj.width < 5 && this._currentPathObj.height < 5) {
          // If clicked without dragging, set a default highlight box
          this._currentPathObj.width = 120;
          this._currentPathObj.height = 24;
          this._currentSvgElement.setAttribute('width', 120);
          this._currentSvgElement.setAttribute('height', 24);
        }
        this.addAnnotation(this._currentPathObj.pageIndex, this._currentPathObj);
      }
      this._isHighlightingBox = false;
      this._currentPathObj = null;
      this._currentSvgElement = null;
      this._startPt = null;
      return;
    }

    if (this._isDrawing) {
      if (this._currentPathObj && this._currentSvgElement) {
        this.addAnnotation(this._currentPathObj.pageIndex, this._currentPathObj);
      }

      this._isDrawing = false;
      this._currentPathObj = null;
      this._currentSvgElement = null;
      this._lastPoint = null;
    }
  }

  // ---------------------------------------------------------------
  // Interactive Inline Textbox (Direct typing on page)
  // ---------------------------------------------------------------

  _createInlineTextbox(pageIndex, layer, x, y) {
    const pageWrapper = layer.closest('.page-wrapper');
    if (!pageWrapper) return;

    // Check if there is already an open editor
    const existing = pageWrapper.querySelector('.inline-annotation-editor');
    if (existing) existing.remove();

    const editor = document.createElement('div');
    editor.className = 'inline-annotation-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('placeholder', 'Type text note...');

    // Convert SVG unscaled coordinates to pageWrapper percentage
    const baseWidth = parseFloat(layer.dataset.baseWidth) || 600;
    const baseHeight = parseFloat(layer.dataset.baseHeight) || 800;

    const leftPercent = (x / baseWidth) * 100;
    const topPercent = (y / baseHeight) * 100;

    editor.style.position = 'absolute';
    editor.style.left = `${leftPercent}%`;
    editor.style.top = `${topPercent}%`;
    editor.style.color = this.currentColor || '#ff4757';
    editor.style.background = 'rgba(0, 0, 0, 0.75)';
    editor.style.border = '1px solid ' + (this.currentColor || '#ff4757');
    editor.style.borderRadius = '4px';
    editor.style.padding = '4px 8px';
    editor.style.fontSize = '14px';
    editor.style.minWidth = '100px';
    editor.style.outline = 'none';
    editor.style.zIndex = '100';

    pageWrapper.appendChild(editor);
    setTimeout(() => editor.focus(), 10);

    let isCommitted = false;

    const commitText = () => {
      if (isCommitted) return;
      isCommitted = true;

      const val = editor.innerText ? editor.innerText.trim() : '';
      if (val) {
        const annotId = 'text_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const annotObj = {
          id: annotId,
          type: 'text',
          text: val,
          x: x,
          y: y + 16,
          color: this.currentColor || '#ff4757',
          fontSize: 16,
          pageIndex: pageIndex
        };
        this.addAnnotation(pageIndex, annotObj);
        const el = this._createSvgElementForAnnotation(annotObj);
        if (el) layer.appendChild(el);
      }
      if (editor.parentNode) {
        editor.remove();
      }
    };

    editor.addEventListener('blur', () => commitText());
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        isCommitted = true;
        if (editor.parentNode) editor.remove();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        commitText();
      }
    });
  }

  // ---------------------------------------------------------------
  // SVG Shape Generation Helper
  // ---------------------------------------------------------------

  _createSvgElementForAnnotation(annot) {
    if (!annot || !annot.type) return null;

    if (annot.type === 'rect_highlight') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', annot.x);
      rect.setAttribute('y', annot.y);
      rect.setAttribute('width', annot.width || 120);
      rect.setAttribute('height', annot.height || 24);
      rect.setAttribute('fill', annot.color || '#fffa65');
      rect.setAttribute('opacity', annot.opacity || 0.4);
      rect.setAttribute('rx', 3);
      rect.setAttribute('ry', 3);
      rect.dataset.annotationId = annot.id;
      return rect;
    }

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
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.dataset.annotationId = annot.id;

      const approxWidth = Math.max(60, (annot.text || '').length * 9);
      
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', annot.x - 4);
      bg.setAttribute('y', annot.y - 18);
      bg.setAttribute('width', approxWidth);
      bg.setAttribute('height', 24);
      bg.setAttribute('fill', 'rgba(0, 0, 0, 0.7)');
      bg.setAttribute('rx', 4);
      bg.setAttribute('ry', 4);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', annot.x);
      text.setAttribute('y', annot.y);
      text.setAttribute('fill', annot.color || '#ff4757');
      text.setAttribute('font-size', annot.fontSize || 16);
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('font-weight', '500');
      text.textContent = annot.text;

      g.appendChild(bg);
      g.appendChild(text);
      return g;
    }

    return null;
  }
}
