import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isP5Page } from '../renderer/jsAnimationPage';
import { findSketchTips, type SketchTip, type SketchTipOptions } from './sketchTips';
import { applyChanges, firstSyntaxError, readSketchFile } from './sketchSource';

const js = { language: 'js' } as const;
const tipsOf = (code: string, options: SketchTipOptions = js) => findSketchTips(code, { ...js, ...options });
const tipOf = (code: string, kind: SketchTip['kind'], options?: SketchTipOptions) => tipsOf(code, options).find((t) => t.kind === kind);

function applyFix(code: string, kind: SketchTip['kind'], fixId?: string, options?: SketchTipOptions): string {
  const tips = tipsOf(code, options).filter((t) => t.kind === kind);
  expect(tips.length, `a ${kind} tip`).toBeGreaterThan(0);
  const fix = fixId ? tips.flatMap((t) => t.fixes).find((f) => f.id === fixId) : tips[0].fixes[0];
  expect(fix, `fix ${fixId ?? 'first'} of ${kind}`).toBeDefined();
  const out = applyChanges(code, fix!.changes);
  expect(firstSyntaxError(readSketchFile(out, 'js')), out).toBeNull();
  return out;
}

describe('canvas size tip', () => {
  const sketch = `function setup() {
  createCanvas(400, 300);
}

function draw() {
  background(0);
  circle(200, 150, 50);
  rect(0, 0, 400, 20);
}
`;

  const filling = { canvas: { mode: 'fill' as const } };

  it('fills the window in plain p5 while the sketch plays at the size it asks for', () => {
    const t = tipOf(sketch, 'canvas')!;
    expect(t.severity).toBe('warning');
    expect(t.fixes.map((f) => f.label)).toEqual(['Fill the window', 'Fill the window and use width and height for 3 positions']);
    const out = applyFix(sketch, 'canvas', 'canvas-fill');
    expect(out).toContain('createCanvas(windowWidth, windowHeight);');
    expect(out).toContain('function windowResized() {\n  resizeCanvas(windowWidth, windowHeight);\n}');
    expect(out).toContain('circle(200, 150, 50)');
    const both = applyFix(sketch, 'canvas', 'canvas-fill-positions');
    expect(both).toContain('circle(width / 2, height / 2, 50)');
    expect(both).toContain('rect(0, 0, width, 20)');
  });

  it('says Ghost Arcade sizes the canvas when it does, and offers width and height for positions', () => {
    const t = tipOf(sketch, 'canvas', { runtime: filling })!;
    expect(t.body).toContain("The sketch's canvas grows to fill the output. Ghost Arcade does this when it plays");
    expect(t.fixes.map((f) => f.label)).toEqual(['Use width and height for 3 positions']);
    const out = applyFix(sketch, 'canvas', 'canvas-positions', { runtime: filling });
    expect(out).toContain('createCanvas(400, 300);');
    expect(out).toContain('circle(width / 2, height / 2, 50)');
  });

  it('follows how the canvas will be played', () => {
    const t = tipOf(sketch, 'canvas', { runtime: { canvas: { mode: 'fit', reason: 'It draws at fixed positions.' } } })!;
    expect(t.body).toContain('The sketch draws at fixed positions. Ghost Arcade does this when it plays');
    expect(t.severity).toBe('info');
  });

  it('is only a note when Ghost Arcade sizes it and nothing in the code needs to change', () => {
    const t = tipOf('function setup() { createCanvas(640, 480); }\nfunction draw() { circle(width / 2, height / 2, 9); }', 'canvas', { runtime: filling })!;
    expect(t.severity).toBe('info');
    expect(t.fixes).toHaveLength(0);
    expect(tipOf('function setup() { createCanvas(windowWidth, windowHeight); }', 'canvas')).toBeUndefined();
  });
});

describe('mouse tip', () => {
  const sketch = `function setup() { createCanvas(400, 400); }
function draw() {
  line(pmouseX, pmouseY, mouseX, mouseY);
  if (mouseIsPressed) background(0);
  const r = mouseX ** 2;
}
`;

  it('lets the sketch move on its own with plain p5', () => {
    const out = applyFix(sketch, 'mouse', 'mouse-wander');
    expect(out).toContain('line(noise((millis() - deltaTime) / 4000) * width, noise(100 + (millis() - deltaTime) / 4000) * height, noise(millis() / 4000) * width, noise(100 + millis() / 4000) * height)');
    expect(out).toContain('if (millis() % 2000 < 150)');
    expect(out).toContain('const r = (noise(millis() / 4000) * width) ** 2;');
    expect(out).not.toMatch(/\bmouse|ghost|control\(/i);
  });

  it('explains mouse functions that never run, without a fix', () => {
    const t = tipOf('function draw() {}\nfunction mousePressed() { background(255); }', 'mouse')!;
    expect(t.fixes).toHaveLength(0);
    expect(t.body).toContain('mousePressed() is never called');
  });
});

describe('sound tip', () => {
  const sketch = `let mic;
function setup() { mic = new p5.AudioIn(); mic.start(); }
function draw() { circle(200, 200, mic.getLevel() * 400); }
`;

  it('says the microphone is missing, without rewriting the code', () => {
    const t = tipOf(sketch, 'sound')!;
    expect(t.severity).toBe('warning');
    expect(t.fixes).toHaveLength(0);
  });

  it('says so when Ghost Arcade plays the show into p5.sound', () => {
    const t = tipOf(sketch, 'sound', { runtime: { soundFromShow: true } })!;
    expect(t.severity).toBe('info');
    expect(t.body).toContain('no change to the code');
  });
});

describe('files tip', () => {
  const sketch = `let img, font, data;
function preload() {
  img = loadImage('assets/cat.png');
  font = loadFont('./Inter.ttf');
  data = loadJSON('https://example.com/data.json');
}
function setup() { createCapture(VIDEO); }
`;

  it('only names files the sketch does not have', () => {
    const t = tipOf(sketch, 'files', { files: ['sketch.js', 'assets/cat.png'] })!;
    expect(t.title).toBe('"./Inter.ttf" is not in the sketch');
    expect(tipsOf(sketch, { files: ['sketch.js', 'assets/cat.png', 'Inter.ttf'] }).filter((x) => x.id === 'files')).toHaveLength(0);
  });

  it('points a camera at Ghost Arcade\'s own camera layers', () => {
    expect(tipsOf(sketch, { files: ['assets/cat.png', 'Inter.ttf'] }).find((t) => t.id === 'camera')?.body).toContain('camera and capture layers');
  });
});

describe('colour tip', () => {
  const sketch = `let t = 0;

// Draw a ring.
function draw() {
  background(0);
  fill(255, 0, 100);
  circle(10, 10, 10);
  fill(255, 0, 100, 50);
  stroke('#00ff88');
  fill(200);
}
`;

  it('groups uses of one colour and skips greys', () => {
    const tips = tipsOf(sketch).filter((t) => t.kind === 'colour');
    expect(tips.map((t) => t.title)).toEqual(['Name the colour #ff0064', 'Name the colour #00ff88']);
    expect(tips.map((t) => t.fixes[0].label)).toEqual(['Name it pinkColor', 'Name it tealColor']);
    expect(tips[0].ranges).toHaveLength(2);
  });

  it('names it at the top, keeping each use\'s transparency', () => {
    const out = applyFix(sketch, 'colour');
    expect(out).toContain('let t = 0;\n\nlet pinkColor = [255, 0, 100];\n\n// Draw a ring.\nfunction draw() {');
    expect(out).toContain('  fill(pinkColor);\n');
    expect(out).toContain('  fill(...pinkColor, 50);\n');
  });

  it('keeps a hex colour as hex', () => {
    const out = applyFix(sketch, 'colour', 'colour-#00ff88');
    expect(out).toContain("let tealColor = '#00ff88';");
    expect(out).toContain('stroke(tealColor);');
  });

  it('mentions the colour control only when Ghost Arcade makes one', () => {
    expect(tipOf(sketch, 'colour')!.body).not.toContain('colour control');
    expect(tipOf(sketch, 'colour', { runtime: { colourControls: true } })!.body).toContain('colour control');
  });
});

describe('performance tips', () => {
  it('flags work that should happen once, and removes processor blur', () => {
    const sketch = `function draw() {
  const pg = createGraphics(100, 100);
  drawingContext.shadowBlur = 20;
  drawingContext.shadowColor = 'white';
  circle(10, 10, 10);
  filter(BLUR, 3);
  loadPixels();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[x + y * width] = 0;
  updatePixels();
}
`;
    expect(tipsOf(sketch).filter((t) => t.kind === 'performance').map((t) => t.id)).toEqual(['perf-create-graphics', 'perf-blur', 'perf-pixels', 'perf-pixel-loops']);
    const out = applyFix(sketch, 'performance', 'perf-blur-remove');
    expect(out).not.toMatch(/shadowBlur|shadowColor|filter\(/);
    expect(out).toContain('  circle(10, 10, 10);\n  loadPixels();');
  });
});

describe('timing tip', () => {
  it('times motion by the clock', () => {
    const out = applyFix('function draw() { rotate(frameCount * 0.01); if (frameCount % 60 === 0) background(0); }', 'timing');
    expect(out).toContain('rotate((millis() / (1000 / 60)) * 0.01)');
    expect(out).toContain('frameCount % 60');
  });

  it('leaves sketches that keep frame counts to the author', () => {
    expect(tipOf('let start = 0;\nfunction draw() { start = frameCount; rotate((frameCount - start) * 0.01 + frameCount * 0.1); }', 'timing')!.fixes).toHaveLength(0);
  });
});

describe('audio tip', () => {
  it('suggests p5.sound when Ghost Arcade plays the show into it', () => {
    expect(tipOf('function draw() { circle(1, 1, 1); }', 'audio', { runtime: { soundFromShow: true } })?.body).toContain('new p5.Amplitude()');
    expect(tipOf('function draw() { circle(1, 1, 1); }', 'audio')?.body).toContain('window.ghostAudio');
  });

  it('stays quiet when the sketch already listens', () => {
    expect(tipOf('let amp = new p5.Amplitude();\nfunction draw() { circle(1, 1, amp.getLevel()); }', 'audio')).toBeUndefined();
    expect(tipOf('function draw() { circle(1, 1, (window.ghostAudio || {}).bass); }', 'audio')).toBeUndefined();
  });
});

describe('fixes change only the user\'s own code', () => {
  const sketch = `const speed = 2;
let t = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(20);
  fill(255, 0, 100);
  t += speed * frameCount / 1000;
  circle(200, 200, 40 + sin(t) * 20);
  circle(mouseX, mouseY, 20);
  drawingContext.shadowBlur = 10;
}
`;

  it('never brings Ghost Arcade code into the sketch', () => {
    const tips = tipsOf(sketch);
    expect(tips.map((t) => t.kind)).toEqual(expect.arrayContaining(['canvas', 'mouse', 'colour', 'performance', 'timing']));
    for (const fix of tips.flatMap((t) => t.fixes)) {
      const out = applyChanges(sketch, fix.changes);
      expect(firstSyntaxError(readSketchFile(out, 'js')), fix.id).toBeNull();
      expect(out, fix.id).not.toMatch(/ghost|shaderParams|control\(/i);
    }
  });
});

describe('shipped sketches', () => {
  const dir = resolve(__dirname, '../../../public/threejs');
  const sketches = readdirSync(dir)
    .map((name) => ({ name, html: readFileSync(resolve(dir, name, 'index.html'), 'utf8') }))
    .filter((s) => isP5Page(s.html));

  it('every fix leaves a page that still reads', () => {
    expect(sketches.length).toBeGreaterThan(5);
    for (const { name, html } of sketches) {
      for (const fix of findSketchTips(html).flatMap((t) => t.fixes)) {
        expect(firstSyntaxError(readSketchFile(applyChanges(html, fix.changes), 'html')), `${name}: ${fix.id}`).toBeNull();
      }
    }
  });

  it('does not ask shipped sketches to fix what they already do right', () => {
    for (const { name, html } of sketches) {
      const kinds = findSketchTips(html).map((t) => t.kind);
      expect(kinds, name).not.toContain('canvas');
      expect(kinds, name).not.toContain('mouse');
      expect(kinds, name).not.toContain('audio');
    }
  });
});
