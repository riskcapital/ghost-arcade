/**
 * Quick test: verify Spout addon loads and can send/receive inside Electron.
 * Run: npx electron electron/test-spout.js
 */
import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

app.whenReady().then(() => {
  const addonPath = path.resolve(__dirname, 'native', 'build', 'Release', 'spout_addon.node');
  console.log('[Test] Loading addon from:', addonPath);

  try {
    const addon = require(addonPath);
    console.log('[Test] Addon loaded:', Object.keys(addon));

    const senders = addon.listSenders();
    console.log('[Test] Active Spout senders:', JSON.stringify(senders));

    const output = new addon.SpoutOutput();
    console.log('[Test] SpoutOutput initialized:', output.isInitialized());
    output.setSenderName('ghostArcade');

    // Send green frames for 5 seconds so other apps can detect us
    const w = 256, h = 256;
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0; pixels[i + 1] = 255; pixels[i + 2] = 0; pixels[i + 3] = 255;
    }

    let frameCount = 0;
    const interval = setInterval(() => {
      const ok = output.sendImage(pixels, w, h);
      frameCount++;
      if (frameCount % 60 === 0) {
        console.log(`[Test] Sent ${frameCount} frames, last result: ${ok}`);
        console.log('[Test] Current senders:', JSON.stringify(addon.listSenders()));
      }
    }, 16);

    setTimeout(() => {
      clearInterval(interval);
      console.log(`[Test] Done. Total frames sent: ${frameCount}`);
      output.release();
      app.quit();
    }, 5000);
  } catch (err) {
    console.error('[Test] ERROR:', err.message);
    console.error(err.stack);
    app.quit();
  }
});
