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
}
