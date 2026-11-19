import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs release script, no type declarations
import { runChecks } from '../../../scripts/check-ai-models.mjs';
import catalog from './ai-models.json';

/**
 * The pre-release model check (npm run check:ai-models) against stand-in
 * provider responses: no network, no keys.
 */

const deprecationsPage = `
## Gemini 4 models  {% id="gemini-4-models" %}
{% table %}
  * Model
  * Release date
  * Shutdown date
  * Recommended replacement
  ---
${['gemini-4-neon', 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-xenon'].map((id) => `  * \`${id}\`
  * November 1, 2026
  * No shutdown date announced
  * `).join('\n  ---\n')}
{% /table %}
## Gemini 3 models  {% id="gemini-3-models" %}
{% table %}
  * Model
  * Release date
  * Shutdown date
  * Recommended replacement
  ---
${['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-omni-1.2-flash'].map((id) => `  * \`${id}\`
  * July 21, 2026
  * ${id === 'gemini-3.6-flash' ? 'March 1, 2027' : 'No shutdown date announced'}
  * ${id === 'gemini-3.6-flash' ? '`gemini-3.8-flash`' : ''}`).join('\n  ---\n')}
{% /table %}
`;

const lumaModels = 'Video model: `ray-3.2`.';
const lumaMigration = 'This guide is for API customers using any of these retiring models:\n\n- Ray 3\n- Ray 2\n- Ray 2 Flash\n\nIf you received a notice';
const dreamMachine = '| Ray 2 Flash | ray-flash-2 |\n| Ray 2 | ray-2 |';

function claudeModel(id: string, line: string, created: string, extra: Record<string, unknown> = {}) {
  return { type: 'model', id, display_name: id, line, created_at: created, lifecycle: 'active', deprecated_at: null, retires_at: null, ...extra };
}

function provider(overrides: { claude?: unknown[]; gemini?: unknown[] } = {}) {
  const calls: string[] = [];
  const claude = overrides.claude ?? [
    claudeModel('claude-fable-5-2', 'fable', '2026-11-09T00:00:00Z'),
    claudeModel('claude-opus-5-5', 'opus', '2026-09-22T00:00:00Z'),
    claudeModel('claude-sonnet-5-5', 'sonnet', '2026-09-28T00:00:00Z'),
    claudeModel('claude-haiku-5-5', 'haiku', '2026-10-07T00:00:00Z'),
  ];
  const gemini = overrides.gemini ?? [
    ...catalog.gemini.models.map((m) => ({ name: `models/${m.id}`, supportedGenerationMethods: ['generateContent'] })),
    { name: 'models/gemini-omni-1.2-flash', supportedGenerationMethods: [] },
  ];
  const fetch = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.anthropic.com/v1/models?')) return Response.json({ data: claude, has_more: false, last_id: null });
    if (url.startsWith('https://api.anthropic.com/v1/models/')) return Response.json({}, { status: 404 });
    if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) return Response.json({ models: gemini });
    if (url.endsWith('/docs/deprecations.md')) return new Response(deprecationsPage);
    if (url.endsWith('/guides/model/index.md')) return new Response(lumaModels);
    if (url.endsWith('/migration/index.md')) return new Response(lumaMigration);
    if (url.endsWith('/video-generation.md')) return new Response(dreamMachine);
    if (url === 'https://agents.lumalabs.ai/v1/credits') return Response.json({ balance_credits: 10 });
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const keys = { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', LUMA_AGENTS_API_KEY: 'l' };
// The shipped list, but with Gemini 3.6 Flash scheduled for shutdown in the stand-in page.
const shipped = { ...catalog, gemini: { ...catalog.gemini, models: catalog.gemini.models.filter((m) => m.id !== 'gemini-3.6-flash') } };

describe('pre-release AI model check', () => {
  it('passes the shipped list with keys, and warns about newer models and retiring legacy ones', async () => {
    const { fetch, calls } = provider({
      claude: [
        claudeModel('claude-fable-5-2', 'fable', '2026-11-09T00:00:00Z'),
        claudeModel('claude-opus-5-5', 'opus', '2026-09-22T00:00:00Z'),
        claudeModel('claude-opus-6', 'opus', '2027-01-10T00:00:00Z'),
        claudeModel('claude-sonnet-5-5', 'sonnet', '2026-09-28T00:00:00Z'),
        claudeModel('claude-haiku-5-5', 'haiku', '2026-10-07T00:00:00Z'),
      ],
    });
    const result = await runChecks({ catalog: shipped, env: keys, fetch, retryDelayMs: 0 });
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/claude-opus-6 .* is newer than claude-opus-5-5/),
      expect.stringMatching(/gemini-4-xenon is a current text model/),
      expect.stringMatching(/ray-2 \(Ray 2\) is being retired/),
    ]));
    expect(calls.some((u) => u.includes('aistudio.google.com/docs/models.md'))).toBe(false);
  });

  it('fails a model that is deprecated, scheduled to retire, missing or replaced', async () => {
    const { fetch } = provider({
      claude: [
        claudeModel('claude-fable-5-2', 'fable', '2026-11-09T00:00:00Z', { lifecycle: 'deprecated', deprecated_at: '2027-05-01T00:00:00Z', retires_at: '2027-08-01T00:00:00Z' }),
        claudeModel('claude-opus-5-5', 'opus', '2026-09-22T00:00:00Z', { retires_at: '2027-09-22T00:00:00Z' }),
        claudeModel('claude-sonnet-5-5', 'sonnet', '2026-09-28T00:00:00Z'),
      ],
      gemini: [{ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }],
    });
    const { failures } = await runChecks({ catalog, env: keys, fetch, retryDelayMs: 0 });
    expect(failures).toEqual(expect.arrayContaining([
      'Claude: claude-fable-5-2 is deprecated, retiring 2027-08-01',
      'Claude: claude-opus-5-5 is scheduled to retire 2027-09-22',
      'Claude: claude-haiku-5-5 is not available to this account (missing from /v1/models)',
      expect.stringMatching(/gemini-3\.6-flash shuts down March 1, 2027; replacement `gemini-3\.8-flash`/),
      "Gemini: gemini-4-carbon is not in this key's model list",
      "Gemini Omni: gemini-omni-1.2-flash is not in this key's model list",
    ]));
  });

  it('fails legacy Ray 2 under --strict, and says so when a page cannot be read', async () => {
    const { fetch } = provider();
    const strict = await runChecks({ catalog: shipped, env: keys, fetch, strict: true, retryDelayMs: 0 });
    expect(strict.failures).toEqual(expect.arrayContaining([expect.stringMatching(/ray-2 \(Ray 2\) is being retired/)]));

    const offline = async () => { throw new Error('offline'); };
    const down = await runChecks({ catalog, env: {}, fetch: offline, retryDelayMs: 0 });
    expect(down.failures).toEqual([
      'Claude: could not check (offline)',
      'Gemini: could not check (offline)',
      'Luma: could not check (offline)',
    ]);
    expect(down.notes[0]).toMatch(/DOCS MODE/);
  });
});
