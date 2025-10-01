const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Ensure the dist directory exists
const distDir = path.join(__dirname, '../public/dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Create a write stream for the zip file
const output = fs.createWriteStream(path.join(distDir, 'cursor-session-helper.zip'));
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

// Listen for archive events
output.on('close', () => {
  console.log(`Extension packaged successfully (${archive.pointer()} bytes)`);
});

archive.on('error', (err) => {
  throw err;
});

// Pipe archive data to the output file
archive.pipe(output);

// Add the extension files to the archive
const extensionDir = path.join(__dirname, '../public/extension');
archive.directory(extensionDir, false);

// Finalize the archive
archive.finalize();
