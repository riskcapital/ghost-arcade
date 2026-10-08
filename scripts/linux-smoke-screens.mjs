// Steps c and d of scripts/linux-smoke.mjs: a Screen on the display, and
// projector calibration on it. See linux-smoke-steps.mjs for the conventions.
import fs from 'node:fs';
import path from 'node:path';
import { el, sleep } from './linux-smoke-cdp.mjs';
import { encodePng, meanBox, meanDifference, srgbToLinear, stats } from './linux-smoke-image.mjs';
import { rootScreenshot, windowChildren, windowInfo, windowTree, xKey } from './linux-smoke-x11.mjs';
import {
  addLayer, chooseField, coreSnapshot, dropFile, layerNames, openTab, round, rpc, setCheckbox, setLayerVisible,
  setNumberField, typeAheadSelect,
} from './linux-smoke-steps.mjs';

const screenRows = (c) => c.eval("JSON.stringify([...document.querySelectorAll('.screen-row .row-name')].map(e=>e.textContent.trim()))").then(JSON.parse);
const selectScreen = async (c, name) => {
  await c.clickElement(`[...document.querySelectorAll('.screen-row .row-name')].find(e=>e.textContent.trim()===${JSON.stringify(name)})`);
  await sleep(350);
};
const openIds = (c) => rpc(c, 'output_list_slice_windows');
const sliceState = async (c, id) => ((await rpc(c, 'native_renderer_get_slice_output_state'))?.slices || []).find((s) => s.id === id) || null;

/** Screens tab > + Add Screen > Send to: Physical display > the first display. Returns the Screen's name. */
export async function addDisplayScreen(c) {
  await openTab(c, 'Screens');
  const before = await screenRows(c);
  await c.clickElement(el.button('+ Add Screen'));
  await c.waitFor(`document.querySelectorAll('.screen-row').length>${before.length}`, 5000, 'new Screen row');
  const name = (await screenRows(c)).find((n) => !before.includes(n)) || (await screenRows(c)).at(-1);
  await selectScreen(c, name);
  const target = await chooseField(c, 'Send to', 'Phy');
  if (!/Physical/.test(String(target))) throw new Error(`Send to stayed on "${target}"`);
  const displays = await rpc(c, 'get_displays');
  const label = String(displays[0]?.label || `Display ${displays[0]?.id}`);
  const chosen = await chooseField(c, 'Display', label.slice(0, 4));
  if (!chosen || /pick/.test(chosen)) throw new Error(`no display chosen (options start with "${label}", got "${chosen}")`);
  return { name, display: displays[0], chosen };
}

/** Open on display, and wait until the core renders that Screen. Returns its id. */
export async function openScreen(c, name, known = []) {
  await openTab(c, 'Screens');
  await selectScreen(c, name);
  await c.clickElement(el.buttonStarting('Open on display'));
  const deadline = Date.now() + 45000;
  let id = null;
  while (Date.now() < deadline && !id) {
    id = (await openIds(c)).find((entry) => !known.includes(entry)) || null;
    if (!id) await sleep(500);
  }
  if (!id) throw new Error(`"${name}" did not open: ${await c.eval("document.querySelector('.screen-panel')?.innerText.match(/(unavailable|Could not|error)[^\\n]*/i)?.[0] || ''")}`);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = await sliceState(c, id);
    if (state && Number(state.frame) > 0) return id;
    await sleep(500);
  }
  throw new Error(`Screen ${id} opened but the core never rendered a frame for it`);
}

export async function closeScreen(c, name) {
  await openTab(c, 'Screens');
  await selectScreen(c, name);
  if (await c.exists(el.buttonStarting('Close on display'))) await c.clickElement(el.buttonStarting('Close on display'));
  await sleep(800);
}

// ── c ──────────────────────────────────────────────────────────────────────
export const stepScreen = {
  id: 'c', title: 'A Screen opens on the display and the core presents it',
  async run(t) {
    const { c } = t;
    const screen = await addDisplayScreen(c);
    t.number('display', `${screen.chosen}`);
    const id = await openScreen(c, screen.name);
    t.shared.screenA = { name: screen.name, id, display: screen.display };
    t.check('Screen window is open', (await openIds(c)).includes(id), id);
    const first = await sliceState(c, id);
    await sleep(2500);
    const second = await sliceState(c, id);
    t.number('sliceSize', `${second?.width}x${second?.height}`);
    t.number('sliceFrames', `${first?.frame} -> ${second?.frame} in 2.5 s`);
    t.check('core keeps rendering the Screen (frame counter advances)', Number(second?.frame) > Number(first?.frame), `${first?.frame} -> ${second?.frame}`);
    const slice = await coreSnapshot(c, `slice:${id}`);
    const sliceStats = stats(slice.image);
    t.number('screenSnapshot', `meanLuma=${sliceStats.meanLuma} nonBlack=${sliceStats.nonBlackFraction} colours=${sliceStats.distinctColours}`);
    t.check('the Screen\'s own picture is not black', sliceStats.nonBlackFraction > 0.02, JSON.stringify(sliceStats));
    const page = await t.connectTo((target) => String(target.url).includes('mode=slice-display'), 20000).catch(() => null);
    t.check('Screen window loaded its page', !!page, page ? page.url.slice(0, 120) : 'no slice-display target');
    page?.close();
    if (t.isLinux) {
      t.check('core presents the Screen itself (X11 child window)', second?.presented === true, JSON.stringify(second));
      const line = t.appLogText().split('\n').reverse().find((entry) => entry.includes('[SliceNative]') && entry.includes(id) && entry.includes('X11 window'));
      const xid = line?.match(/X11 window (0x[0-9a-f]+)/)?.[1];
      t.check('main process handed the Screen window to the core', !!xid, line || 'no [SliceNative] line in the app log');
      if (xid) {
        const parent = windowInfo(xid);
        const children = windowChildren(xid) || [];
        const root = t.shared.root = rootScreenshot(path.join(t.outDir, 'c-x11-root.png'));
        t.number('x11ScreenWindow', `${xid} ${parent?.width}x${parent?.height}+${parent?.x}+${parent?.y} children=${children.map((child) => `${child.name || 'unnamed'} ${child.width}x${child.height}`).join(',')}`);
        t.check('Screen window covers the display', !!parent && !!root && parent.width === root.width && parent.height === root.height, `${parent?.width}x${parent?.height} on a ${root?.width}x${root?.height} display`);
        t.check('core\'s child window fills the Screen window', children.some((child) => child.width === parent?.width && child.height === parent?.height), JSON.stringify(children));
        if (root) {
          const onScreen = stats(root);
          const difference = meanDifference(root, slice.image);
          t.number('x11Screenshot', `meanLuma=${onScreen.meanLuma} nonBlack=${onScreen.nonBlackFraction}; mean difference to the core snapshot ${difference}/255`);
          t.check('X11 screenshot of the display shows the picture', onScreen.nonBlackFraction > 0.02, JSON.stringify(onScreen));
          // The layer is animated and the two captures are a moment apart.
          t.check('the display shows what the core rendered for the Screen', difference < 30, `${difference}/255`);
        }
      }
      fs.writeFileSync(path.join(t.outDir, 'c-x11-window-tree.txt'), windowTree());
      // The Screen covers the only display, and the app says Esc closes it.
      const root = t.shared.root;
      xKey('Escape', Math.round((root?.width || 1920) / 2), Math.round((root?.height || 1080) / 2));
      let closed = false;
      for (let i = 0; i < 16 && !closed; i++) { await sleep(500); closed = !(await openIds(c)).includes(id); }
      t.check('Esc in the Screen window closes it', closed, closed ? '' : 'still open 8 s after a real Escape key press over the Screen');
      if (!closed) await closeScreen(c, screen.name);
      const reopened = await openScreen(c, screen.name);
      t.shared.screenA.id = reopened;
      const again = await sliceState(c, reopened);
      t.check('the Screen reopens and presents again', again?.presented === true && Number(again?.frame) > 0, JSON.stringify(again));
    } else {
      t.skip('X11 window, screenshot and Esc checks are Linux-only');
    }
    await t.shot('c-editor');
  },
};

// ── calibration maths, independent of the app's solver ─────────────────────
/** Unit square -> quad (Heckbert). Corners TL, TR, BR, BL. */
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}
const apply3 = (m, x, y) => { const z = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]; };

/** A picture that says where each pixel came from: R = x, G = y, B = full. */
function writeCoordinateImage(file, width = 1920, height = 1080) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = Math.round((x / (width - 1)) * 255); rgba[o + 1] = Math.round((y / (height - 1)) * 255); rgba[o + 2] = 255; rgba[o + 3] = 255;
    }
  }
  fs.writeFileSync(file, encodePng(width, height, rgba));
  return file;
}

/** Worst channel error between a Screen snapshot and what `inverse` predicts on a grid. */
function compareToPrediction(image, inverse) {
  let worst = 0, inside = 0, outside = 0;
  const failures = [];
  const points = [];
  for (let iy = 1; iy <= 7; iy++) for (let ix = 1; ix <= 9; ix++) points.push([ix / 10, iy / 8]);
  // The display corners a pulled-in quad leaves empty must be black.
  if (inverse) points.push([0.97, 0.03], [0.95, 0.02], [0.99, 0.05], [0.02, 0.975], [0.01, 0.99]);
  {
    for (const [u, v] of points) {
      const [sx, sy] = inverse ? apply3(inverse, u, v) : [u, v];
      // Skip the quad's edge, where one output pixel straddles picture and black.
      const margin = Math.min(sx, sy, 1 - sx, 1 - sy);
      if (Math.abs(margin) < 0.02) continue;
      const got = meanBox(image, u * image.width - 0.5, v * image.height - 0.5, 1);
      const want = margin > 0 ? [sx * 255, sy * 255, 255] : [0, 0, 0];
      if (margin > 0) inside++; else outside++;
      const error = Math.max(...got.map((value, channel) => Math.abs(value - want[channel])));
      if (error > worst) worst = error;
      if (error > 8) failures.push(`(${u},${v}) got ${got.map((n) => Math.round(n))} want ${want.map((n) => Math.round(n))}`);
    }
  }
  return { worst: round(worst, 1), inside, outside, failures };
}

// ── d ──────────────────────────────────────────────────────────────────────
export const stepCalibration = {
  id: 'd', title: 'Projector calibration: corner homography and paired overlap blend',
  async run(t) {
    const { c } = t;
    const a = t.shared.screenA;
    if (!a) throw new Error('step c did not leave a Screen open');
    // Known content: hide what is there, add one full-frame coordinate image.
    for (const name of await layerNames(c)) await setLayerVisible(c, name, false);
    const image = writeCoordinateImage(path.join(t.outDir, 'd-coordinates.png'));
    await addLayer(c, 'Media Layer');
    await c.waitFor("!!document.querySelector('.media-drop-zone')", 8000, 'media drop zone');
    await dropFile(c, "document.querySelector('.media-drop-zone')", image);
    let base = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      base = await coreSnapshot(c, `slice:${a.id}`);
      if (compareToPrediction(base.image, null).worst <= 8) break;
      await sleep(1500);
    }
    const identity = compareToPrediction(base.image, null);
    t.number('uncalibrated', `worst channel error ${identity.worst}/255 over ${identity.inside} samples`);
    t.check('uncalibrated Screen shows the image 1:1 (also proves red and blue are not swapped)', identity.worst <= 8, identity.failures.slice(0, 3).join('; '));

    await openTab(c, 'Screens');
    await selectScreen(c, a.name);
    const geometry = "[...document.querySelectorAll('.calibration label')].find(l=>l.textContent.trim().startsWith('Correct output geometry'))?.querySelector('input')";
    t.check('"Correct output geometry" ticks', await setCheckbox(c, geometry, true));
    const corners = [{ x: 0, y: 0 }, { x: 0.9, y: 0.1 }, { x: 1, y: 1 }, { x: 0.05, y: 0.95 }];
    await setNumberField(c, 'Top right x percent', '90');
    await setNumberField(c, 'Top right y percent', '10');
    await setNumberField(c, 'Bottom left x percent', '5');
    await setNumberField(c, 'Bottom left y percent', '95');
    const typed = await c.eval("JSON.stringify(['Top right x percent','Top right y percent','Bottom left x percent','Bottom left y percent'].map(l=>document.querySelector(`[aria-label=\"${l}\"]`)?.value))");
    t.number('cornersTyped', typed);
    const inverse = invert3(squareToQuad(corners));
    let warped = null, prediction = null;
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      warped = await coreSnapshot(c, `slice:${a.id}`);
      prediction = compareToPrediction(warped.image, inverse);
      if (prediction.worst <= 8) break;
      await sleep(1200);
    }
    const moved = meanDifference(base.image, warped.image);
    t.number('homography', `worst channel error ${prediction.worst}/255 over ${prediction.inside} inside + ${prediction.outside} outside samples; picture changed by ${moved}/255`);
    t.check('moving corners changes the Screen\'s output', moved > 2, `${moved}/255 mean change`);
    t.check('output matches the homography of the typed corners', prediction.worst <= 8 && prediction.inside >= 30 && prediction.outside >= 3, prediction.failures.slice(0, 3).join('; '));
    if (t.isLinux) {
      const root = rootScreenshot(path.join(t.outDir, 'd-x11-calibrated.png'));
      const onDisplay = root ? compareToPrediction(root, inverse) : null;
      t.number('x11Homography', onDisplay ? `worst channel error ${onDisplay.worst}/255 on the X11 display` : 'no screenshot');
      t.check('the display itself shows the calibrated picture', !!onDisplay && onDisplay.worst <= 10, onDisplay?.failures.slice(0, 3).join('; ') || '');
    }
    await c.clickElement(el.buttonStarting('Reset projector corners'));
    await setCheckbox(c, geometry, false);

    // Paired overlap: two Screens, an angled band, fade weights that must add up.
    const second = await addDisplayScreen(c);
    const idB = await openScreen(c, second.name, [a.id]);
    await selectScreen(c, a.name);
    const overlap = "[...document.querySelectorAll('.calibration label')].find(l=>l.textContent.trim().startsWith('Angled two-projector overlap'))?.querySelector('input')";
    await setCheckbox(c, overlap, true);
    const band = { startTop: 0.46, startBottom: 0.40, endTop: 0.54, endBottom: 0.60 };
    await setNumberField(c, 'Left boundary · top percent', '46');
    await setNumberField(c, 'Left boundary · bottom percent', '40');
    await setNumberField(c, 'Right boundary · top percent', '54');
    await setNumberField(c, 'Right boundary · bottom percent', '60');
    const partner = "[...document.querySelectorAll('.calibration label')].find(l=>l.textContent.trim().startsWith('Other projector'))?.querySelector('select')";
    const picked = await typeAheadSelect(c, partner, null, second.name.slice(0, 3));
    t.check('partner Screen chosen', picked === second.name, `"${picked}"`);
    await c.clickElement(el.buttonStarting('Pair blend'));
    await sleep(1500);
    const cropLeft = Math.max(band.endTop, band.endBottom), cropRightStart = Math.min(band.startTop, band.startBottom);
    let worst = 0, outsideWorst = 0, samples = 0, left = null, right = null;
    const settle = Date.now() + 45000;
    while (Date.now() < settle) {
      left = await coreSnapshot(c, `slice:${a.id}`);
      right = await coreSnapshot(c, `slice:${idB}`);
      worst = 0; outsideWorst = 0; samples = 0;
      for (const y of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const start = band.startTop + (band.startBottom - band.startTop) * y, end = band.endTop + (band.endBottom - band.endTop) * y;
        for (const k of [0.15, 0.35, 0.5, 0.65, 0.85]) {
          const x = start + (end - start) * k;
          const l = meanBox(left.image, (x / cropLeft) * left.image.width - 0.5, y * left.image.height, 1)[2];
          const r = meanBox(right.image, ((x - cropRightStart) / (1 - cropRightStart)) * right.image.width - 0.5, y * right.image.height, 1)[2];
          worst = Math.max(worst, Math.abs(srgbToLinear(l) + srgbToLinear(r) - 1));
          samples++;
        }
        const lo = meanBox(left.image, ((start - 0.05) / cropLeft) * left.image.width, y * left.image.height, 1)[2];
        const ro = meanBox(right.image, ((end + 0.05 - cropRightStart) / (1 - cropRightStart)) * right.image.width, y * right.image.height, 1)[2];
        outsideWorst = Math.max(outsideWorst, 255 - lo, 255 - ro);
      }
      if (worst <= 0.04 && outsideWorst <= 6) break;
      await sleep(1200);
    }
    t.number('overlapBlend', `worst |left + right - 1| in linear light ${round(worst, 4)} over ${samples} samples; full level outside the band within ${round(outsideWorst, 1)}/255`);
    t.check('paired overlap fades add up to 1 in linear light', worst <= 0.04, `${round(worst, 4)}`);
    t.check('each Screen is at full level outside the band', outsideWorst <= 6, `${round(outsideWorst, 1)}/255`);
    await t.shot('d-editor');
    await closeScreen(c, second.name);
    await closeScreen(c, a.name);
    t.check('both Screens close', (await openIds(c)).length === 0, JSON.stringify(await openIds(c)));
  },
};
