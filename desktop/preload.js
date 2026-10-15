// What the Chat Club site can ask of the desktop app. Only the app's own settings, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatClubDesktop', {
  faceWake: {
    get: () => ipcRenderer.invoke('facewake:get'),
    set: (on) => ipcRenderer.invoke('facewake:set', !!on),
  },
  privacy: {
    get: () => ipcRenderer.invoke('privacy:get'),
    set: (s) => ipcRenderer.invoke('privacy:set', { enabled: !!s.enabled, mode: String(s.mode || ''), switchBack: s.switchBack !== false }),
  },
});
