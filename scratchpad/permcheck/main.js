const { app, systemPreferences } = require('electron');
const fs = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  fs.appendFileSync('/tmp/permcheck.txt',
    'camera=' + systemPreferences.getMediaAccessStatus('camera') +
    ' screen=' + systemPreferences.getMediaAccessStatus('screen') + '\n');
  app.quit();
});
