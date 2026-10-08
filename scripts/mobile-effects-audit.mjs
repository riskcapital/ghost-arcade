import { writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');
  const result = await page.evaluate(async () => {
    const { StandaloneRenderer } = await import('/src/lib/mobile/standaloneRenderer.ts');
    const { MOBILE_EFFECTS } = await import('/src/lib/mobile/standaloneEffects.ts');
    const { EdgeLookRenderer, MOBILE_EDGE_STROKES, MOBILE_EDGE_FILLS } =
      await import('/src/lib/mobile/studio/looks/renderer.ts');
    const { EDGE_LOOKS } = await import('/src/lib/mobile/studio/looks/edgeLookCatalog.ts');
    const { surfaceVertices } = await import('/src/lib/mobile/studio/compositor.ts');
    const canvas = document.createElement('canvas');
    const renderer = new StandaloneRenderer(canvas);
    const failed = [];
    renderer.onEffectError = (message) => failed.push({ id: 'device-fallback', error: message });
    let passed = 0;
    await renderer.loadShaderSource(
      '/*{"INPUTS":[]}*/\nvoid main(){gl_FragColor=vec4(isf_FragNormCoord.xy,.4,1.);}',
      false,
      false,
    );
    for (const e of MOBILE_EFFECTS) {
      try {
        renderer.setEffectChain([{ type: e.type, params: e.defaults, enabled: true }]);
        renderer.drawFrame(128, 72);
        const gl = canvas.getContext('webgl');
        if (gl.getError()) throw Error('GL error');
        passed++;
      } catch (error) {
        failed.push({ id: e.type, error: String(error) });
      }
    }
    const gl = canvas.getContext('webgl'),
      edge = new EdgeLookRenderer(gl);
    let looks = 0;
    const configs = [
      ...EDGE_LOOKS.map((l) => ({ id: l.id, palette: l.palette })),
      ...MOBILE_EDGE_STROKES.map((stroke) => ({ id: 'custom', stroke, fill: 'none' })),
      ...MOBILE_EDGE_FILLS.map((fill) => ({ id: 'custom', stroke: 'none', fill })),
    ];
    for (const c of configs) {
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        edge.draw(
          { palette: 'neon', ...c, enabled: true, amount: 1, speed: 1, width: 1 },
          surfaceVertices(),
          128,
          72,
          0.234,
          120,
          0,
          3,
        );
        if (gl.getError()) throw Error('GL error');
        looks++;
      } catch (error) {
        failed.push({ id: JSON.stringify(c), error: String(error) });
      }
    }
    edge.destroy();
    renderer.destroy();
    return { effects: passed, total: MOBILE_EFFECTS.length, looks, totalLooks: configs.length, failed };
  });
  writeFileSync('/tmp/mobile-new-fx-audit.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.failed.length) throw new Error(JSON.stringify(result.failed));
} finally {
  await browser.close();
}
