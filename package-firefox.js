const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create a valid zip buffer from a list of files with forward-slash POSIX paths
function createZip(files, baseDir) {
  const localHeaders = [];
  const centralDirHeaders = [];
  let currentOffset = 0;

  for (const relPath of files) {
    // Force POSIX forward slash for zip entry name
    const zipEntryName = relPath.replace(/\\/g, '/');
    const fullPath = path.join(baseDir, relPath);
    const uncompressedData = fs.readFileSync(fullPath);
    const uncompressedSize = uncompressedData.length;
    const crc = zlib.crc32(uncompressedData);
    const compressedData = zlib.deflateRawSync(uncompressedData, { level: 9 });
    const compressedSize = compressedData.length;

    const nameBuffer = Buffer.from(zipEntryName, 'utf8');

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed (2.0)
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(8, 8);          // Compression method (Deflate)
    localHeader.writeUInt16LE(0, 10);         // Last mod time
    localHeader.writeUInt16LE(0, 12);         // Last mod date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);   // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);// File name length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    const fileOffset = currentOffset;
    localHeaders.push(localHeader, compressedData);
    currentOffset += localHeader.length + compressedData.length;

    // Central directory header (46 bytes + name length)
    const cdHeader = Buffer.alloc(46 + nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);   // Central directory signature
    cdHeader.writeUInt16LE(0x0314, 4);       // Version made by (Unix / 2.0)
    cdHeader.writeUInt16LE(20, 6);           // Version needed (2.0)
    cdHeader.writeUInt16LE(0, 8);            // General purpose bit flag
    cdHeader.writeUInt16LE(8, 10);           // Compression method (Deflate)
    cdHeader.writeUInt16LE(0, 12);           // Last mod time
    cdHeader.writeUInt16LE(0, 14);           // Last mod date
    cdHeader.writeUInt32LE(crc, 16);         // CRC-32
    cdHeader.writeUInt32LE(compressedSize, 20);   // Compressed size
    cdHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    cdHeader.writeUInt16LE(nameBuffer.length, 28);// File name length
    cdHeader.writeUInt16LE(0, 30);           // Extra field length
    cdHeader.writeUInt16LE(0, 32);           // File comment length
    cdHeader.writeUInt16LE(0, 34);           // Disk number start
    cdHeader.writeUInt16LE(0, 36);           // Internal file attributes
    cdHeader.writeUInt32LE(0x81a40000, 38);   // External file attributes (regular file, 0644)
    cdHeader.writeUInt32LE(fileOffset, 42);  // Relative offset of local header
    nameBuffer.copy(cdHeader, 46);

    centralDirHeaders.push(cdHeader);
  }

  const cdOffset = currentOffset;
  const cdBuffer = Buffer.concat(centralDirHeaders);
  const cdSize = cdBuffer.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // Number of this disk
  eocd.writeUInt16LE(0, 6);                // Disk where CD starts
  eocd.writeUInt16LE(files.length, 8);     // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10);    // Total number of central directory records
  eocd.writeUInt32LE(cdSize, 12);          // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);        // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);               // Comment length

  return Buffer.concat([...localHeaders, cdBuffer, eocd]);
}

// Recursively find all files in directory
function getFiles(dir, baseDir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath, baseDir));
    } else {
      const rel = path.relative(baseDir, fullPath);
      results.push(rel);
    }
  }
  return results;
}

function build() {
  const baseDir = __dirname;
  
  // 1. Build manifest for Firefox
  const { execSync } = require('child_process');
  execSync('node build.js firefox', { stdio: 'inherit', cwd: baseDir });

  // 2. Collect all files to package
  const rootFiles = [
    'manifest.json',
    'reader.html',
    'app.js',
    'RenderEngine.js',
    'UIController.js',
    'DarkModeProcessor.js',
    'StorageManager.js',
    'AnnotationManager.js',
    'ThumbnailManager.js',
    'OutlineManager.js',
    'styles.css',
    'background.js'
  ];

  const iconFiles = getFiles(path.join(baseDir, 'icons'), baseDir);
  const libFiles = getFiles(path.join(baseDir, 'lib'), baseDir);

  const allFiles = [...rootFiles, ...iconFiles, ...libFiles];
  console.log(`Packaging ${allFiles.length} files with POSIX forward-slash paths...`);

  const zipBuffer = createZip(allFiles, baseDir);
  const outPath = path.join(baseDir, 'pdf-darkmode-firefox-v3.1.3.zip');
  fs.writeFileSync(outPath, zipBuffer);

  console.log(`Successfully created ${outPath} (${zipBuffer.length} bytes)`);

  // 3. Revert manifest back to chrome for local unpacked usage
  execSync('node build.js chrome', { stdio: 'inherit', cwd: baseDir });
}

build();
