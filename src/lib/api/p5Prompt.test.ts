import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPTS } from './ai-client';
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';

// The example page in the p5 instructions is what the model copies, so it
// must itself produce the controls the app expects.
function examplePage(): string {
  const prompt = SYSTEM_PROMPTS.p5js;
  const start = prompt.indexOf('<!DOCTYPE html>');
  const end = prompt.indexOf('</html>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end + '</html>'.length);
}

describe('p5 generation instructions', () => {
  it('has an example page whose controls the app can read', () => {
    const page = jsAnimationFromHtml(examplePage());
    expect(page.animationType).toBe('p5js');
    expect(page.params?.map((p) => [p.name, p.type])).toEqual([
      ['speed', 'number'],
      ['density', 'number'],
      ['hue', 'number'],
      ['transparent', 'boolean'],
    ]);
    expect(page.paramValues).toEqual({ speed: 1, density: 0.5, hue: 0.6, transparent: false });
  });

  it('asks for the see-through background tag', () => {
    expect(examplePage()).toContain('<meta name="ghost-arcade-background" content="transparent">');
  });

  it('example script compiles', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(examplePage())?.[1] ?? '';
    expect(script.length).toBeGreaterThan(100);
    expect(() => new Function(script)).not.toThrow();
  });
});
