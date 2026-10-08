import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');
  const result = await page.evaluate(async () => {
    const { StudioCompositor } = await import('/src/lib/mobile/studio/compositor.ts');
    const { defaultShow, newSurface, gridPoints } = await import('/src/lib/mobile/studio/model.ts');
    const canvas = document.createElement('canvas'),
      compositor = new StudioCompositor(canvas),
      gl = compositor.context,
      show = defaultShow();
    show.mapping = true;
    show.dualDeck = true;
    show.quality = 540;
    show.layers.forEach((l) => {
      l.enabled = true;
      l.opacity = 1;
      l.clipId = 'test';
    });
    show.surfaces = [{ ...newSurface(0), source: 0, points: gridPoints(0, 0, 1, 1) }];
    const input = (color) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(color));
      return { texture, width: 16, height: 9 };
    };
    const inputs = [
      input([255, 0, 0, 255]),
      input([0, 255, 0, 255]),
      null,null,
      input([0, 0, 255, 255]),
      input([255, 255, 0, 255]),
    ];
    const pixel = () => {
      const p = new Uint8Array(4);
      gl.readPixels(480, 270, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return [...p];
    };
    let pixels = [];
    for (const x of [0, 0.5, 1]) {
      show.crossfade = x;
      compositor.render(show, inputs);
      pixels.push(pixel());
    }
    show.surfaces[0].source = 1;
    show.crossfade = 1;
    compositor.render(show, inputs);
    pixels.push(pixel());
    show.dualDeck = false;
    show.surfaces[0].source = 0;
    compositor.render(show, inputs);
    pixels.push(pixel());
    compositor.render(show, inputs, true);
    pixels.push(pixel());
    show.mapping = false;
    show.dualDeck = true;
    show.layers[1].enabled = false;
    show.layers[3].enabled = false;
    show.crossfade = 0.5;
    compositor.render(show, inputs);
    pixels.push(pixel());
    show.mapping=true;show.surfaces=[];compositor.render(show,inputs);pixels.push(pixel());
    const error = gl.getError();
    compositor.destroy();
    return { pixels, error };
  });
  console.log(result);
  assert.equal(result.error, 0);
  const expected = [
    [255, 0, 0],
    [180, 0, 180],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 0],
    [0, 0, 0],
    [180, 0, 180],
    [180, 0, 180],
  ];
  result.pixels.forEach((p, i) => p.slice(0, 3).forEach((c, j) => assert.ok(Math.abs(c - expected[i][j]) < 3)));
  console.log('PASS screen follows paired A/B rows, midpoint brightness, single-deck routing and blackout');
} finally {
  await browser.close();
}
