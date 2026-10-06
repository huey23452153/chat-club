// Before a build: bring in the two things the app is made from that live
// elsewhere in the repo — the remote-control helper and the icon.
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.join(__dirname, 'helper'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'control-helper', 'server.js'), path.join(__dirname, 'helper', 'server.js'));
fs.copyFileSync(path.join(__dirname, '..', 'icons', 'icon-512.png'), path.join(__dirname, 'build', 'icon.png'));
// the Microsoft Store package's icons (made by make-store-icons.js)
fs.cpSync(path.join(__dirname, 'appx-assets'), path.join(__dirname, 'build', 'appx'), { recursive: true });
