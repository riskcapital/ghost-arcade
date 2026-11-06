import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardLoops, guardPageLoops, LOOP_GUARD_RUNTIME, LOOP_STOPPED_MESSAGE, withLoopGuardRuntime } from './loopGuard';

const lines = (text: string) => text.split('\n').length;

/** Compiles without running, so a guarded snippet that is not JavaScript any more fails here. */
function compiles(code: string): void {
  // eslint-disable-next-line no-new-func
  new Function(code);
}

describe('guardLoops', () => {
  const snippets = [
    'let y = 0;\nwhile (y < height) {\n  line(0, y, width, y);\n}',
    'for (let i = 0; i < 10; i++) total += i;',
    'for (const a of list) { use(a); }',
    'for (const k in obj) if (k) count++;',
    'do { n--; } while (n > 0);',
    'do n--; while (n > 0)\nafter();',
    'while (x);',
    'for (;;) a: b;',
    'outer: for (let i = 0; i < 3; i++) { inner: for (let j = 0; j < 3; j++) { if (j) continue outer; break inner; } }',
    'if (ready) for (let i = 0; i < 3; i++) go(i); else stop();',
    'for (let i = 0; i < 3; i++) while (busy()) for (;;) break;',
    'while(a){}while(b){}',
    'let a = b\nwhile (c) { d() }',
    'switch (mode) { case 1: while (go()) step(); break; default: for (;;) break; }',
    'const f = () => { for (let i = 0; i < 2; i++) {} };\nclass A { m() { while (false) {} } }',
  ];

  it('keeps every snippet valid JavaScript, line for line', () => {
    for (const code of snippets) {
      const guarded = guardLoops(code);
      expect(guarded, code).not.toBe(code);
      expect(lines(guarded), code).toBe(lines(code));
      expect(() => compiles(guarded), guarded).not.toThrow();
    }
  });

  it('checks inside each loop body, on the line the body starts', () => {
    const code = 'let y = 0;\nwhile (y < height) {\n  line(0, y, width, y);\n}';
    const guarded = guardLoops(code).split('\n');
    expect(guarded[1]).toContain('__ghostLoopGuard.c(');
    expect(guarded[1]).toContain('throw new RangeError');
    expect(guarded[2]).toBe('  line(0, y, width, y);');
  });

  it('leaves code without loops, with // noprotect, or that does not parse as it is', () => {
    expect(guardLoops('function setup() { createCanvas(400, 400); }')).toBe('function setup() { createCanvas(400, 400); }');
    expect(guardLoops('// noprotect\nwhile (true) {}')).toBe('// noprotect\nwhile (true) {}');
    expect(guardLoops('while (y < height) { line(0, y')).toBe('while (y < height) { line(0, y');
    // "for" in a string or comment is not a loop.
    expect(guardLoops('const s = "for (;;) {}"; // while (1)')).toBe('const s = "for (;;) {}"; // while (1)');
  });

  it('leaves loops that wait, which hand the page back while they run', () => {
    const asyncLoop = 'async function run() { while (true) { await tick(); } }';
    const generator = 'function* ids() { let i = 0; while (true) yield i++; }';
    const forAwait = 'async function f() { for await (const x of stream) use(x); }';
    for (const code of [asyncLoop, generator, forAwait]) expect(guardLoops(code)).toBe(code);
    // A loop inside a function the waiting loop calls is still its own loop.
    expect(guardLoops('async function f() { while (true) { await g(); [1].forEach(() => { for (;;) {} }); } }')).toContain('__ghostLoopGuard.c(');
  });
});

describe('a guarded loop that never ends', () => {
  const scope = globalThis as unknown as { window?: unknown; __ghostLoopGuard?: unknown };
  let hadWindow: boolean;

  beforeEach(() => {
    hadWindow = 'window' in scope;
    if (!hadWindow) scope.window = globalThis;
    // eslint-disable-next-line no-new-func
    new Function(LOOP_GUARD_RUNTIME)();
  });

  afterEach(() => {
    delete scope.__ghostLoopGuard;
    if (!hadWindow) delete scope.window;
  });

  it('throws after about half a second instead of running forever', () => {
    const code = guardLoops('let y = 0, height = 10;\nwhile (y < height) {\n  Math.sqrt(y);\n}');
    const started = performance.now();
    // eslint-disable-next-line no-new-func
    expect(() => new Function(code)()).toThrow(LOOP_STOPPED_MESSAGE);
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(450);
    expect(took).toBeLessThan(3000);
  });

  it('lets loops that finish run to the end, and stops the next loop at once after one was stopped', () => {
    // eslint-disable-next-line no-new-func
    const sum = new Function(guardLoops('let t = 0; for (let i = 0; i < 100000; i++) t += i; return t;'));
    expect(sum()).toBe(4999950000);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(guardLoops('for (;;) {}'))()).toThrow(RangeError);
    const started = performance.now();
    // eslint-disable-next-line no-new-func
    expect(() => new Function(guardLoops('for (;;) {}'))()).toThrow(RangeError);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('guarding a page', () => {
  const page = [
    '<!DOCTYPE html>',
    '<html><head>',
    '<script src="p5.min.js"></script>',
    '<script type="x-shader/x-fragment">for (;;) {}</script>',
    '</head><body>',
    '<script>',
    'while (go()) {',
    '}',
    '</script>',
    '<script type="module">for (const a of b) {}</script>',
    '</body></html>',
  ].join('\n');

  it('guards inline JavaScript only, keeping every line in place', () => {
    const guarded = guardPageLoops(page);
    const at = guarded.split('\n');
    expect(at[3]).toBe('<script type="x-shader/x-fragment">for (;;) {}</script>');
    expect(at[6]).toContain('__ghostLoopGuard.c(');
    expect(at[9]).toContain('__ghostLoopGuard.c(');
    expect(lines(guarded)).toBe(lines(page));
  });

  it('defines the checks before the first script without adding a line', () => {
    const html = withLoopGuardRuntime(page);
    expect(lines(html)).toBe(lines(page));
    expect(html.indexOf('window.__ghostLoopGuard=')).toBeLessThan(html.indexOf('p5.min.js'));
    const bare = withLoopGuardRuntime('<canvas></canvas>\n<script>x()</script>');
    expect(bare.startsWith('<script>(function(){')).toBe(true);
    expect(lines(bare)).toBe(2);
  });
});
