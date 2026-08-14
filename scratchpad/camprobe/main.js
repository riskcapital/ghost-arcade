const { app, BrowserWindow, systemPreferences } = require('electron');
const path = require('path'); const fs = require('fs');
const OUT = '/tmp/camprobe.txt';
const say = (...a) => { try { fs.appendFileSync(OUT, a.join(' ') + '\n'); } catch {} };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 180, show: true });
  win.loadURL('data:text/html,<h3 style="font-family:sans-serif">Camera probe</h3>');
  app.focus({ steal: true });
  say('status:', systemPreferences.getMediaAccessStatus('camera'));
  const granted = await systemPreferences.askForMediaAccess('camera');
  say('askForMediaAccess ->', String(granted));
  say('status after:', systemPreferences.getMediaAccessStatus('camera'));
  const a = require(path.join(__dirname, '../../electron/native/build/Release/live_capture_addon.node'));
  const cams = a.listCameras();
  say('startCamera:', String(a.startCamera({ sessionId: 'p5', deviceId: cams[0] ? cams[0].id : '' })));
  let n = 0;
  const t = setInterval(() => {
    say('info:', JSON.stringify(a.receiveTextureInfo({ sessionId: 'p5' })));
    if (++n >= 4) { clearInterval(t); try { a.stop({ sessionId: 'p5' }); } catch {} app.quit(); }
  }, 900);
});
