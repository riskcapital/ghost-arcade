import { describe, expect, it } from 'vitest';
import { saveProblem } from './sketchSource';

describe('checking a sketch before it is saved', () => {
  it('lets good code through', () => {
    expect(saveProblem('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  background(220);\n}\n', 'js')).toBeNull();
  });

  it('stops a missing bracket, says where and what the engine reports', () => {
    const problem = saveProblem('function setup() {\n  createCanvas(400, 400);\n\nfunction draw() {\n  background(220);\n}\n', 'js');
    expect(problem).not.toBeNull();
    expect(problem!.message).toMatch(/Unexpected end of input|missing|expected/i);
  });

  it('stops a typo in an expression', () => {
    const problem = saveProblem('function draw() {\n  ellipse(10, 10,, 5);\n}\n', 'js');
    expect(problem?.line).toBe(2);
    expect(problem?.message).toBeTruthy();
  });

  it('does not stop a module sketch for using import', () => {
    expect(saveProblem("import { thing } from './thing.js';\nfunction setup() {}\n", 'js')).toBeNull();
  });

  it('checks the scripts inside a page', () => {
    expect(saveProblem('<html><body><script>function setup( {</script></body></html>', 'html')).not.toBeNull();
    expect(saveProblem('<html><body><script>function setup() {}</script></body></html>', 'html')).toBeNull();
  });
});
