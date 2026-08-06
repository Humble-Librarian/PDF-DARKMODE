const fs = require('fs');

const target = process.argv[2];
if (!target || (target !== 'chrome' && target !== 'firefox')) {
  console.error('Please specify target browser: node build.js [chrome|firefox]');
  process.exit(1);
}

// Read base manifest
const baseRaw = fs.readFileSync('manifest.base.json', 'utf8');
const manifest = JSON.parse(baseRaw);

if (target === 'chrome') {
  // Chrome only supports service_worker in Manifest V3
  manifest.background = {
    "service_worker": "background.js"
  };
} else if (target === 'firefox') {
  // Firefox MV3 requires BOTH service_worker AND scripts as fallback
  manifest.background = {
    "service_worker": "background.js",
    "scripts": ["background.js"]
  };
  
  // Firefox requires an ID
  manifest.browser_specific_settings = {
    "gecko": {
      "id": "pdf-dark-mode@humble-librarian.com",
      "strict_min_version": "142.0",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  };
}

// Write the resulting manifest.json
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Successfully built manifest.json for ${target}`);
