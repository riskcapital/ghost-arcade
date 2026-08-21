// Research spike: does Electron's OSR shared-texture paint event actually
// deliver a usable Linux dma-buf (nativePixmap) on this machine?
//
// Standalone and throwaway — not wired into the app. Run with:
//   node_modules/.bin/electron scripts/spike-nativepixmap-probe.mjs
import { app, BrowserWindow } from 'electron';

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const ANIMATED_PAGE = `data:text/html,
<canvas id="c" width="256" height="256"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  let t = 0;
  function draw() {
    t += 1;
    ctx.fillStyle = 'hsl(' + (t % 360) + ',80%,50%)';
    ctx.fillRect(0, 0, 256, 256);
    requestAnimationFrame(draw);
  }
  draw();
</script>`;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    webPreferences: {
      offscreen: { useSharedTexture: true },
      webgl: true,
    },
  });
  win.webContents.setFrameRate(30);

  let paintCount = 0;
  const MAX_PAINTS = 5;

  win.webContents.on('paint', (event) => {
    paintCount++;
    if (!event.texture) {
      console.log(`[probe] paint #${paintCount}: no texture on this event`);
      return;
    }
    const info = event.texture.textureInfo || {};
    const handle = info.handle || {};
    console.log(`\n[probe] paint #${paintCount} ==================================`);
    console.log('[probe] codedSize:', info.codedSize);
    console.log('[probe] pixelFormat:', info.pixelFormat);
    console.log('[probe] handle keys:', Object.keys(handle));
    if (handle.nativePixmap) {
      const px = handle.nativePixmap;
      console.log('[probe] nativePixmap.modifier:', px.modifier);
      console.log('[probe] nativePixmap.supportsZeroCopyWebGpuImport:', px.supportsZeroCopyWebGpuImport);
      console.log('[probe] nativePixmap.planes.length:', px.planes?.length);
      (px.planes || []).forEach((p, i) => {
        console.log(`[probe]   plane[${i}] fd=${p.fd} stride=${p.stride} offset=${p.offset} size=${p.size}`);
      });
    } else {
      console.log('[probe] NO nativePixmap present on this handle — Linux dma-buf export unavailable via this API on this machine/config');
    }
    event.texture.release();

    if (paintCount >= MAX_PAINTS) {
      console.log('\n[probe] done, exiting');
      app.quit();
    }
  });

  win.loadURL(ANIMATED_PAGE);
});

app.on('window-all-closed', () => app.quit());
