import { describe, expect, it } from 'vitest';
import {
  drawsRelativeToCanvas,
  findCanvasCall,
  findControls,
  sketchFeatures,
  startupRanges,
  tokenize,
  topLevelValues,
} from './jsScan';

const values = (code: string) => topLevelValues(tokenize(code)).map((v) => [v.name, v.value]);
const controls = (code: string) => findControls(tokenize(code)).map((c) => c.name);

describe('tokenize', () => {
  it('keeps braces inside strings, comments, templates and regular expressions out of the nesting', () => {
    const tokens = tokenize(`const a = "{"; // }
/* { */ const b = \`\${ {x: 1}.x } }\`; const r = /[}{]"'/g; let c = 1;`);
    const c = tokens.find((t) => t.value === 'c')!;
    expect(c.depth).toBe(0);
    expect(tokens.filter((t) => t.kind === 'regex').map((t) => t.value)).toEqual([`/[}{]"'/g`]);
  });

  it('tells division from a regular expression', () => {
    const tokens = tokenize('let half = width / 2 / scale; let re = /ab+c/i;');
    expect(tokens.filter((t) => t.kind === 'regex').map((t) => t.value)).toEqual(['/ab+c/i']);
  });

  it('counts lines across comments and template literals', () => {
    const tokens = tokenize('/*\n\n*/ a\n`x\ny` b');
    expect(tokens.find((t) => t.value === 'a')!.line).toBe(3);
    expect(tokens.find((t) => t.value === 'b')!.line).toBe(5);
  });
});

describe('topLevelValues', () => {
  it('reads plain numbers and switches declared at the top level', () => {
    expect(values('let a = 1, b = -2.5; const c = true\nvar d = 0x10; let e = 1e3;')).toEqual([
      ['a', 1], ['b', -2.5], ['c', true], ['d', 16], ['e', 1000],
    ]);
  });

  it('skips expressions, values inside blocks and loop counters', () => {
    expect(values('let a = 1 + 2; let b = random(3); let c = 4\n* 2; function f() { let d = 5; }\nfor (let i = 0; i < 3; i++) {}')).toEqual([]);
  });

  it('ends a declaration at a line break', () => {
    expect(values('let speed = 2\nfunction draw() {}')).toEqual([['speed', 2]]);
  });
});

describe('startupRanges', () => {
  it('follows setup into the functions it calls and the classes it builds, not their methods', () => {
    const code = `function setup() { init(); flock = new Boid(); }
function init() { grid = new Array(cols); }
class Boid { constructor() { this.r = size; } update() { this.v = maxSpeed; } }
function draw() { flock.update(); }`;
    const tokens = tokenize(code);
    const ranges = startupRanges(tokens);
    const covered = (name: string) => tokens.some((t, k) => t.value === name && ranges.some(([a, b]) => k >= a && k <= b));
    expect(covered('cols')).toBe(true);
    expect(covered('size')).toBe(true);
    expect(covered('maxSpeed')).toBe(false);
  });
});

describe('findControls', () => {
  it('offers values the sketch reads while it plays', () => {
    expect(controls('let speed = 2; let wobble = false;\nfunction draw() { x += speed; if (wobble) y++; }')).toEqual(['speed', 'wobble']);
  });

  it('skips values the sketch changes itself', () => {
    expect(controls('let x = 0; let y = 1; let z = 2;\nfunction draw() { x += 1; y++; --z; }')).toEqual([]);
  });

  it('skips values used while the sketch starts', () => {
    expect(controls(`let cols = 10; let maxSpeed = 4;
function setup() { grid = make(); }
function make() { return new Array(cols); }
class Boid { update() { this.v.limit(maxSpeed); } }`)).toEqual(['maxSpeed']);
  });

  it('skips named choices that the sketch compares', () => {
    expect(controls(`const Y_AXIS = 1; const X_AXIS = 2; let mode = 0; let gap = 4;
function draw() { if (axis === Y_AXIS) line(0, gap, 1, 1); switch (pick) { case X_AXIS: break; } if (mode != 1) {} }`)).toEqual(['gap']);
  });

  it('skips p5 names, negative numbers, unused values and property lookalikes', () => {
    expect(controls(`let width = 400; let drift = -1; let unused = 3; let r = 5;
function draw() { width; drift; obj.unused; ball = { r: 1 }; }`)).toEqual([]);
  });

  it('stops at eight', () => {
    const code = Array.from({ length: 12 }, (_, i) => `let v${i} = ${i};`).join('\n')
      + `\nfunction draw() { ${Array.from({ length: 12 }, (_, i) => `v${i};`).join(' ')} }`;
    expect(controls(code)).toHaveLength(8);
  });
});

describe('findCanvasCall', () => {
  const size = (code: string) => findCanvasCall(tokenize(code)).size;

  it('reads literal sizes, top-level constants and the window size', () => {
    expect(size('function setup() { createCanvas(400, 300, WEBGL); }')).toEqual({ kind: 'fixed', width: 400, height: 300 });
    expect(size('const S = 600;\nfunction setup() { createCanvas(S, S); }')).toEqual({ kind: 'fixed', width: 600, height: 600 });
    expect(size('function setup() { createCanvas(windowWidth, windowHeight); }')).toEqual({ kind: 'window' });
    expect(size('function setup() { let s = min(windowWidth, windowHeight); createCanvas(s, s); }')).toEqual({ kind: 'computed' });
    expect(size('function draw() {}')).toEqual({ kind: 'none' });
  });

  it('reads instance-mode sketches too', () => {
    expect(size('new p5((p) => { p.setup = () => { p.createCanvas(500, 500); }; });')).toEqual({ kind: 'fixed', width: 500, height: 500 });
  });

  it('tells a sketch drawn from width and height from one drawn at fixed positions', () => {
    const relative = tokenize('function setup() { createCanvas(400, 400); }\nfunction draw() { circle(width / 2, height / 2, width / 4); }');
    const fixed = tokenize('function setup() { createCanvas(400, 400); }\nfunction draw() { circle(200, 200, width / 4); }');
    const byName = tokenize('const W = 400;\nfunction setup() { createCanvas(W, W); }\nfunction draw() { circle(W / 3, height / 2, 10); }');
    expect(drawsRelativeToCanvas(relative, findCanvasCall(relative))).toBe(true);
    expect(drawsRelativeToCanvas(fixed, findCanvasCall(fixed))).toBe(false);
    expect(drawsRelativeToCanvas(byName, findCanvasCall(byName))).toBe(false);
  });

  it('does not take a colour for a position', () => {
    const coloured = tokenize('function setup() { createCanvas(400, 400); }\nfunction draw() { fill(255, 100, 200); stroke(color(200)); rect(0, 0, width / 2, height / 2); }');
    const placed = tokenize('function setup() { createCanvas(400, 400); }\nfunction draw() { fill(255); rect(0, 0, 200, height / 2); }');
    expect(drawsRelativeToCanvas(coloured, findCanvasCall(coloured))).toBe(true);
    expect(drawsRelativeToCanvas(placed, findCanvasCall(placed))).toBe(false);
  });
});

describe('sketchFeatures', () => {
  it('notices sound, pixels, input, cameras and p5.js 2 features', () => {
    const features = sketchFeatures(`let mic, song;
async function setup() { song = await loadSound('a.mp3'); mic = new p5.AudioIn(); createCapture(VIDEO); }
function draw() { loadPixels(); splineVertex(mouseX, 0); }
function keyPressed() {}`);
    expect(features).toMatchObject({
      usesSound: true,
      usesMicrophone: true,
      usesCamera: true,
      usesPixelArray: true,
      usesInput: true,
      setsPixelDensity: false,
    });
    expect(features.v2Features).toEqual(['await loadSound()', 'splineVertex']);
  });

  it('finds nothing in a plain sketch', () => {
    expect(sketchFeatures('function setup() { createCanvas(400, 400); }\nfunction draw() { background(0); }')).toEqual({
      usesPixelArray: false,
      setsPixelDensity: false,
      usesInput: false,
      usesCamera: false,
      usesMicrophone: false,
      usesSound: false,
      importsLocalModules: false,
      v2Features: [],
    });
  });

  it("notices modules that import the sketch's own files", () => {
    expect(sketchFeatures("import { Boid } from './boid.js';").importsLocalModules).toBe(true);
    expect(sketchFeatures("import * as THREE from 'three';").importsLocalModules).toBe(false);
  });
});
