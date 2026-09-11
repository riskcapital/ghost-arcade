// Preload for the offscreen three.js / p5.js source hosts (js-source-host.js).
//
// The page is user-supplied HTML, so it gets exactly two subscriptions and
// nothing else from Electron: parameter changes from the editor's sliders,
// and the live audio analysis.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostHost', {
  onParams: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ghost-js:params', (_event, values) => callback(values));
  },
  onAudio: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ghost-js:audio', (_event, values) => callback(values));
  },
});
