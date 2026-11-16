// Preload for the offscreen three.js / p5.js source hosts (js-source-host.js).
//
// The page is user-supplied HTML, so it gets these and nothing else from
// Electron: parameter changes from the editor's sliders, the live audio
// analysis, and in a render the render's clock steps (and its answer when a
// step is drawn).
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
  onStep: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ghost-js:step', (_event, step) => callback(step));
  },
  stepped: (n) => {
    if (Number.isSafeInteger(n)) ipcRenderer.send('ghost-js:stepped', n);
  },
});
