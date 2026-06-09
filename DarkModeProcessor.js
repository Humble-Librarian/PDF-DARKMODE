// ============================================================
// DarkModeProcessor.js — Dark Mode Processing Engine
// Two-tier system: CSS (GPU-accelerated) or Pixel (high quality)
// ============================================================

class DarkModeProcessor {
  constructor() {
    // Theme definitions with CSS filter strings for GPU-accelerated mode
    this.themes = {
      classic: {
        r: 0, g: 0, b: 0,
        name: 'Classic Dark',
        // Pure inversion for true black background
        cssFilter: 'invert(1) hue-rotate(180deg)',
        cssBg: '#000000'
      },
      claude: {
        r: 42, g: 37, b: 34,
        name: 'Warm Dark',
        cssFilter: 'invert(0.92) hue-rotate(180deg) sepia(0.08)',
        cssBg: '#2a2522'
      },
      midnight: {
        r: 25, g: 30, b: 45,
        name: 'Blue Dark',
        cssFilter: 'invert(0.9) hue-rotate(200deg)',
        cssBg: '#191e2d'
      },
      forest: {
        r: 25, g: 35, b: 30,
        name: 'Green Dark',
        cssFilter: 'invert(0.9) hue-rotate(160deg)',
        cssBg: '#19231e'
      },
      sepia: {
        r: 40, g: 33, b: 25,
        name: 'Sepia',
        cssFilter: 'invert(0.85) sepia(0.4) hue-rotate(10deg)',
        cssBg: '#282119'
      },
      contrast: {
        r: 0, g: 0, b: 0,
        name: 'High Contrast',
        cssFilter: 'invert(1) contrast(1.3)',
        cssBg: '#000000'
      }
    };

    // Pre-compute grayscale lookup tables for pixel mode (per theme)
    this._lookupTables = {};
    this._buildLookupTables();
  }

  // ---------------------------------------------------------------
  // CSS Dark Mode (GPU-accelerated, default)
  // ---------------------------------------------------------------

  /**
   * Apply CSS-based dark mode to a page wrapper element.
   * This is near-instant because the GPU handles the filter.
   * @param {HTMLElement} pageWrapper - The .page-wrapper element containing the canvas
   * @param {string} themeName - Theme key
   */
  applyCSSDarkMode(pageWrapper, themeName) {
    const theme = this.themes[themeName] || this.themes.claude;
    
    // Set the wrapper background to the theme color
    pageWrapper.style.backgroundColor = theme.cssBg;
    pageWrapper.classList.add('dark-mode-css');

    // Apply filter to the canvas inside
    const canvas = pageWrapper.querySelector('canvas');
    if (canvas) {
      canvas.style.filter = theme.cssFilter;
      canvas.style.mixBlendMode = 'normal';
    }
  }

  /**
   * Remove CSS dark mode from a page wrapper.
   * @param {HTMLElement} pageWrapper
   */
  removeCSSDarkMode(pageWrapper) {
    pageWrapper.style.backgroundColor = '';
    pageWrapper.classList.remove('dark-mode-css');

    const canvas = pageWrapper.querySelector('canvas');
    if (canvas) {
      canvas.style.filter = '';
      canvas.style.mixBlendMode = '';
    }
  }

  /**
   * Update CSS dark mode theme on an already-styled wrapper.
   * @param {HTMLElement} pageWrapper
   * @param {string} themeName
   */
  updateCSSDarkMode(pageWrapper, themeName) {
    if (pageWrapper.classList.contains('dark-mode-css')) {
      this.applyCSSDarkMode(pageWrapper, themeName);
    }
  }

  // ---------------------------------------------------------------
  // Pixel Dark Mode (high quality, optimized)
  // ---------------------------------------------------------------

  /**
   * Apply pixel-based dark mode to a canvas.
   * Optimized with Uint32Array view and pre-computed lookup tables.
   * @param {HTMLCanvasElement} canvas
   * @param {string} themeName
   * @returns {HTMLCanvasElement} The same canvas, modified in place
   */
  applyPixelDarkMode(canvas, themeName) {
    const theme = this.themes[themeName] || this.themes.claude;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const bgR = theme.r;
    const bgG = theme.g;
    const bgB = theme.b;

    // Use lookup table for grayscale pixels (most of a typical PDF)
    const lut = this._lookupTables[themeName] || this._lookupTables.claude;

    const len = data.length;
    for (let j = 0; j < len; j += 4) {
      // Skip fully transparent pixels
      if (data[j + 3] === 0) continue;

      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];

      // Fast grayscale detection: check if R, G, B are within 15 of each other
      const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);

      if (maxC - minC < 38) {
        // Grayscale or near-grayscale — use lookup table
        // Average the channels for the lookup index
        const avg = (r + g + b + 1) / 3 | 0;
        const idx = avg * 3;
        data[j]     = lut[idx];
        data[j + 1] = lut[idx + 1];
        data[j + 2] = lut[idx + 2];
      } else {
        // Colored pixel — invert lightness, preserve hue
        // Simplified and faster HSL conversion
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = maxC / 255;
        const min = minC / 255;
        let h, s, l = (max + min) / 2;

        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        if (max === rn) {
          h = (gn - bn) / d + (gn < bn ? 6 : 0);
        } else if (max === gn) {
          h = (bn - rn) / d + 2;
        } else {
          h = (rn - gn) / d + 4;
        }
        h /= 6;

        // Invert lightness, slightly boost saturation
        l = 1.0 - l;
        s = Math.min(1.0, s * 1.2);

        // HSL to RGB
        let nr, ng, nb;
        if (s === 0) {
          nr = ng = nb = l;
        } else {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          nr = this._hue2rgb(p, q, h + 1 / 3);
          ng = this._hue2rgb(p, q, h);
          nb = this._hue2rgb(p, q, h - 1 / 3);
        }
        data[j]     = (nr * 255 + 0.5) | 0;
        data[j + 1] = (ng * 255 + 0.5) | 0;
        data[j + 2] = (nb * 255 + 0.5) | 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ---------------------------------------------------------------
  // Theme Accessors
  // ---------------------------------------------------------------

  getTheme(name) {
    return this.themes[name] || this.themes.claude;
  }

  getThemeNames() {
    return Object.keys(this.themes);
  }

  getDefaultTheme() {
    return 'claude';
  }

  // ---------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------

  /**
   * Pre-compute lookup tables for grayscale mapping per theme.
   * 256 entries × 3 channels = 768 bytes per theme.
   * This turns per-pixel math into a single array lookup.
   */
  _buildLookupTables() {
    for (const [name, theme] of Object.entries(this.themes)) {
      const lut = new Uint8Array(256 * 3);
      for (let i = 0; i < 256; i++) {
        const factor = 1 - (i / 255); // inverted lightness
        const idx = i * 3;
        // 230 instead of 255 for soft off-white text (reduces eye strain)
        lut[idx]     = (theme.r + (230 - theme.r) * factor + 0.5) | 0;
        lut[idx + 1] = (theme.g + (230 - theme.g) * factor + 0.5) | 0;
        lut[idx + 2] = (theme.b + (230 - theme.b) * factor + 0.5) | 0;
      }
      this._lookupTables[name] = lut;
    }
  }

  _hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
}
