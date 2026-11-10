import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * scripts/i18n-extract.mjs collects the interface text the language packs
 * translate. It used to drop every template literal with a `${...}` in it
 * (the `$` filter ran before the placeholders were replaced), app-wide, and
 * never looked at labels kept in tables (`const END_ACTION_LABELS = {...}`)
 * or in variables named for text (`const audioTitle = ...`).
 */
type Extractor = { extractFrom(source: string, file?: string): string[]; templateText(body: string): string };
const script = pathToFileURL(join(process.cwd(), 'scripts', 'i18n-extract.mjs')).href;
const load = () => import(/* @vite-ignore */ script) as Promise<Extractor>;

describe('i18n extractor', () => {
  it('keeps template strings, with their placeholders numbered', async () => {
    const { extractFrom } = await load();
    const ts = [
      "showToast(`Could not load ${name}: ${err}.`);",
      'const x = { title: `Crossfade ${d.toFixed(2)}s. Drag an edge to change its length.` };',
      // Strings and templates inside a placeholder do not end the literal.
      "const y = { hint: `Marker at ${fmt(t)}${cue ? `: fires ${label(cue)}` : ' (no cue)'}. Drag to move.` };",
    ].join('\n');
    expect(extractFrom(ts, 'a.ts').sort()).toEqual([
      'Could not load {0}: {1}.',
      'Crossfade {0}s. Drag an edge to change its length.',
      'Marker at {0}{1}. Drag to move.',
    ]);
  });

  it('reads template attributes in markup', async () => {
    const { extractFrom } = await load();
    const svelte = '<div title={`Crossfade ${w.duration.toFixed(2)}s. Drag an edge to change its length, double-click to remove.`}></div>';
    expect(extractFrom(svelte, 'a.svelte')).toContain('Crossfade {0}s. Drag an edge to change its length, double-click to remove.');
  });

  it('reads label tables and text variables', async () => {
    const { extractFrom } = await load();
    const svelte = `<script lang="ts">
  const END_ACTION_LABELS: Record<ShowEndAction, string> = {
    hold: 'At end: hold last look',
    rewind: 'At end: back to start',
  };
  const BEAT_LOCK_TEXT: Record<string, Record<string, string>> = {
    link: { searching: 'Link searching', locked: 'Link' },
  };
  export const RELEASE_MODE_LABELS = { instant: 'Cut', beat: 'Next beat' };
  const tcMismatchText = $derived(a ? \`\${name} is at \${bpm} BPM, the show's map at \${show} BPM.\` : '');
  const headers = { 'Content-Type': 'application/json', Authorization: \`Bearer \${key}\` };
</script>`;
    const out = extractFrom(svelte, 'a.svelte');
    expect(out).toEqual(expect.arrayContaining([
      'At end: hold last look', 'At end: back to start', 'Link searching', 'Link', 'Cut', 'Next beat',
      "{0} is at {1} BPM, the show's map at {2} BPM.",
    ]));
    expect(out).not.toContain('Authorization');
    expect(out).not.toContain('Bearer {0}');
  });

  it('still leaves code alone', async () => {
    const { extractFrom } = await load();
    const ts = [
      'const a = { label: `${base}/assets/${file}.png` };',
      "const b = { name: 'myId' };",
      'const PATH_LABELS = { icon: `M${x} ${y}h${w}v${h}Z` };',
      "// const old = { title: 'In a comment' };",
      'showToast(`line\\nbreak ${x}`);',
    ].join('\n');
    expect(extractFrom(ts, 'a.ts')).toEqual([]);
  });

  it('numbers placeholders the way the runtime matches them', async () => {
    const { templateText } = await load();
    expect(templateText('A ${x} and ${y ? `z ${w}` : "q"} end')).toBe('A {0} and {1} end');
    expect(templateText('cost \\${5}')).toBe('cost ${5}');
  });

  it('source.json is the list the extractor writes (one-space indent)', () => {
    const raw = readFileSync(join(process.cwd(), 'src', 'lib', 'i18n', 'source.json'), 'utf8');
    const list = JSON.parse(raw) as string[];
    expect(Array.isArray(list)).toBe(true);
    expect(raw).toBe(JSON.stringify(list, null, 1) + '\n');
    expect(list).toContain('Crossfade {0}s. Drag an edge to change its length, double-click to remove.');
    expect(list).toContain('At end: hold last look');
  });
});
