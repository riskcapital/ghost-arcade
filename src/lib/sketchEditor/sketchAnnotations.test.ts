import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotateSketch, noteAt } from './sketchAnnotations';
import { readSketch } from './sketchSource';

const page = (script: string) => `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.0/p5.min.js"></script>
</head>
<body>
<script>
${script}
</script>
</body>
</html>`;

const ids = (html: string) => annotateSketch(html).notes.map((n) => n.id);

describe('readSketch', () => {
  it('reads inline scripts and skips library tags, import maps and data', () => {
    const html = `<head><script src="p5.js"></script><script type="importmap">{"imports":{}}</script>
<script type="application/json">{"a":1}</script></head><body><script>let a = 1;</script><script type="module">let b = 2;</script></body>`;
    const scripts = readSketch(html).scripts;
    expect(scripts.map((s) => s.code)).toEqual(['let a = 1;', 'let b = 2;']);
    expect(html.slice(scripts[0].from, scripts[0].to)).toBe('let a = 1;');
  });
});

describe('annotateSketch', () => {
  it('explains the parts of a simple sketch in the order they appear', () => {
    const html = page(`function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background(0, 20);
  const r = map(noise(frameCount * 0.01), 0, 1, 10, 200);
  circle(width / 2, height / 2, r);
}`);
    expect(ids(html)).toEqual(['setup', 'createCanvas', 'windowSize', 'draw', 'background', 'map', 'noise', 'frameCount', 'shapes', 'widthHeight']);
  });

  it('places each note on its first line and lists every place it appears', () => {
    const html = page(`function draw() {
  let a = noise(1);
  let b = noise(2);
}`);
    const note = annotateSketch(html).notes.find((n) => n.id === 'noise')!;
    expect(note.ranges).toHaveLength(2);
    expect(note.line).toBe(html.split('\n').findIndex((l) => l.includes('noise(1)')) + 1);
    for (const range of note.ranges) expect(html.slice(range.from, range.to)).toBe('noise');
    expect(note.links.some((l) => l.url === 'https://p5js.org/reference/p5/noise/')).toBe(true);
    expect(note.links.some((l) => l.url.includes('thecodingtrain.com'))).toBe(true);
    expect(note.links.some((l) => l.url.includes('natureofcode.com'))).toBe(true);
  });

  it('names the shapes it found in one note', () => {
    const note = annotateSketch(page('function draw() { line(0, 0, 9, 9); circle(1, 2, 3); line(1, 1, 2, 2); }')).notes.find((n) => n.id === 'shapes')!;
    expect(note.title).toBe('Shapes: line(), circle()');
    expect(note.ranges).toHaveLength(3);
  });

  it('tells loops, nested loops, for...of and classes apart', () => {
    const html = page(`class Walker { step() {} }
const walkers = [];
function draw() {
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) rect(x, y, 1, 1);
  }
  for (const w of walkers) w.step();
  while (walkers.length > 100) walkers.shift();
}`);
    expect(ids(html)).toEqual(expect.arrayContaining(['class', 'for', 'nestedFor', 'forOf', 'while']));
    const nested = annotateSketch(html).notes.find((n) => n.id === 'nestedFor')!;
    expect(nested.ranges).toHaveLength(1);
  });

  it('does not mistake words in strings and comments for code', () => {
    expect(ids(page(`// noise() and random() are explained elsewhere
const label = 'map(lerp)';
function setup() {}`))).toEqual(['setup']);
  });

  it('separates p5 calls from JavaScript of the same name', () => {
    const html = page(`const items = [];
function draw() {
  items.push(Math.random());
  push();
  translate(1, 2);
  pop();
}`);
    const notes = annotateSketch(html).notes;
    expect(notes.find((n) => n.id === 'arrays')?.names).toEqual(['.push()']);
    expect(notes.find((n) => n.id === 'random')?.names).toEqual(['Math.random']);
    expect(notes.find((n) => n.id === 'pushPop')?.names).toEqual(['push', 'pop']);
  });

  it('understands instance mode', () => {
    const html = page(`const sketch = (p) => {
  p.setup = () => { p.createCanvas(400, 400); };
  p.draw = () => { p.background(0); p.ellipse(p.width / 2, 200, p.noise(p.frameCount) * 50); };
};
new p5(sketch);`);
    expect(ids(html)).toEqual(expect.arrayContaining(['setup', 'draw', 'createCanvas', 'background', 'shapes', 'widthHeight', 'noise', 'frameCount', 'instanceMode']));
  });

  it('recognises the Ghost Arcade bridge and p5.sound', () => {
    const html = page(`window.shaderParams = { speed: 1 };
window.shaderParamDefs = [{ name: 'speed', type: 'number', min: 0, max: 2, default: 1 }];
let mic;
function setup() { mic = new p5.AudioIn(); }
function draw() { const a = window.ghostAudio || {}; }`);
    expect(ids(html)).toEqual(['ghostParams', 'ghostParamDefs', 'setup', 'p5sound', 'draw', 'ghostAudio']);
  });

  it('suggests further reading from what the sketch is made of', () => {
    const html = page(`class Particle { constructor() { this.pos = createVector(0, 0); } }
const particles = [];
function draw() { particles.push(new Particle()); }`);
    const urls = annotateSketch(html).reading.map((l) => l.url);
    expect(urls).toContain('https://natureofcode.com/forces/');
    expect(urls).toContain('https://natureofcode.com/particles/');
  });

  it('reads a sketch.js on its own, with offsets in that file', () => {
    const code = 'function setup() {\n  createCanvas(400, 400);\n}\n\nfunction draw() {\n  circle(noise(frameCount) * width, 200, 20);\n}\n';
    const notes = annotateSketch(code, 'js').notes;
    expect(notes.map((n) => n.id)).toEqual(['setup', 'createCanvas', 'draw', 'shapes', 'noise', 'frameCount', 'widthHeight']);
    const noise = notes.find((n) => n.id === 'noise')!;
    expect(code.slice(noise.ranges[0].from, noise.ranges[0].to)).toBe('noise');
    expect(noise.line).toBe(6);
  });

  it('finds the note under the cursor', () => {
    const html = page('function draw() { let n = noise(1); }');
    const notes = annotateSketch(html).notes;
    expect(noteAt(notes, html.indexOf('noise') + 2)?.id).toBe('noise');
    expect(noteAt(notes, html.indexOf('let n'))).toBeNull();
  });

  it('annotates every shipped p5 sketch', () => {
    const dir = resolve(__dirname, '../../../public/threejs');
    for (const name of ['flock', 'contour-lines', 'kinetic-type', 'growing-tree']) {
      const html = readFileSync(resolve(dir, name, 'index.html'), 'utf8');
      const found = ids(html);
      expect(found, name).toEqual(expect.arrayContaining(['setup', 'draw', 'createCanvas', 'ghostParams', 'ghostParamDefs']));
      expect(found.length, name).toBeGreaterThan(8);
    }
  });
});
