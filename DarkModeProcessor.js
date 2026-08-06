// ============================================================
// DarkModeProcessor.js — Dark Mode Processing Engine
// Two-tier system: CSS (GPU-accelerated) or Pixel (high quality)
// ============================================================

class DarkModeProcessor {
  constructor() {
    // Theme definitions with CSS filter strings for GPU-accelerated mode
    this.themes = {
      classic: {
        name: 'Classic Dark',
        // Pure inversion for true black background
        cssFilter: 'invert(1) hue-rotate(180deg)',
        cssBg: '#000000'
      },
      claude: {
        name: 'Warm Dark',
        cssFilter: 'invert(0.92) hue-rotate(180deg) sepia(0.08)',
        cssBg: '#2a2522'
      },
      midnight: {
        name: 'Blue Dark',
        cssFilter: 'invert(0.9) hue-rotate(200deg)',
        cssBg: '#191e2d'
      },
      forest: {
        name: 'Green Dark',
        cssFilter: 'invert(0.9) hue-rotate(160deg)',
        cssBg: '#19231e'
      },
      sepia: {
        name: 'Sepia',
        cssFilter: 'invert(0.85) sepia(0.4) hue-rotate(10deg)',
        cssBg: '#282119'
      },
      contrast: {
        name: 'High Contrast',
        cssFilter: 'invert(1) contrast(1.3)',
        cssBg: '#000000'
      }
    };
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
}
