// Draws the Microsoft Store package's icons from the app icon (run once, by
// hand, when the icon changes):  npx electron make-store-icons.js
// They are kept in appx-assets/ and copied into the build by prepare.js.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = { 'StoreLogo.png': [50, 50], 'Square44x44Logo.png': [44, 44], 'Square150x150Logo.png': [150, 150], 'Wide310x150Logo.png': [310, 150] };

app.whenReady().then(async () => {
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-512.png')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const out = path.join(__dirname, 'appx-assets');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    // the icon, as big as fits, in the middle of a see-through tile
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
        const side = Math.min(${w}, ${h});
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(img, (${w} - side) / 2, (${h} - side) / 2, side, side);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('icon did not load'));
      img.src = ${JSON.stringify(icon)};
    })`);
    fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote ' + name);
  }
  app.quit();
});
