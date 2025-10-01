const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const sizes = [16, 48, 128];
const iconDir = path.join(__dirname, '../public/extension/icons');

// Create icons directory if it doesn't exist
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

// Generate icons for each size
sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Draw a simple icon (purple square with rounded corners)
  ctx.fillStyle = '#4f46e5';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Draw "C" letter
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.6}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', size / 2, size / 2);

  // Save the icon
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(iconDir, `icon${size}.png`), buffer);
});

console.log('Icons generated successfully');
