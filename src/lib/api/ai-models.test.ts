import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '$lib/bridge';
import {
  CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_LUMA_MODEL, DEFAULT_OMNI_MODEL,
  GEMINI_MODELS, LUMA_MODELS, OMNI_MODELS, restoreAIModelChoices,
} from './ai-models';
import {
  completeWithAI, generateLumaVideo, generateOmniVideo, generateWithAI, lumaModelOptions,
  omniFileId, startLumaGeneration, startOmniVideo, validateAPIKey, validateLumaKey,
} from './ai-client';

vi.mock('$lib/bridge', () => ({ invoke: vi.fn(), isDesktopApp: () => false }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const SHADER = '/*{ "DESCRIPTION": "White" }*/\nvoid main() {\n  gl_FragColor = vec4(1.0);\n}';
const shaderRequest = { apiKey: 'test-key', description: 'A white screen', generationType: 'shader-isf' } as const;
const body = (fetch: ReturnType<typeof vi.fn>, call: number) => JSON.parse(String(fetch.mock.calls[call][1]?.body));
const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([url]) => String(url));

function stubFetch(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('model lists', () => {
  it('offers the current Claude models with Sonnet 5.5 as the default', () => {
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual(['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(CLAUDE_MODELS.map((m) => m.label)).toEqual(['Claude Fable 5.2', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5 (Fast)']);
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5-5');
  });

  it('offers Gemini 4, current Flash and Flash-Lite, and no model Google has scheduled for shutdown', () => {
    const ids = GEMINI_MODELS.map((m) => m.id);
    expect(ids.slice(0, 4)).toEqual(['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-hydrogen']);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-3.5-flash-lite');
    for (const gone of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview']) {
      expect(ids).not.toContain(gone);
    }
    expect(ids).toContain(DEFAULT_GEMINI_MODEL);
  });

  it('labels the video models by what they run on', () => {
    expect(OMNI_MODELS).toEqual([{ id: 'gemini-omni-1.2-flash', label: 'Gemini Omni 1.2 Flash' }]);
    expect(LUMA_MODELS.map((m) => m.label)).toEqual(['Ray 3.2 (Luma Agents)', 'Ray 2 (Dream Machine)', 'Ray 2 Flash (Dream Machine)']);
  });
});

describe('saved model choices', () => {
  it('moves each retired model to its current replacement', () => {
    expect(restoreAIModelChoices({
      claudeModel: 'claude-opus-4-8', geminiModel: 'gemini-2.5-pro', veoModel: 'veo-3.1-generate-preview', lumaModel: 'ray-2',
    })).toEqual({
      claudeModel: 'claude-opus-5-5', geminiModel: 'gemini-3.8-flash', veoModel: DEFAULT_OMNI_MODEL, lumaModel: 'ray-2',
    });
    const claude = (id: string) => restoreAIModelChoices({ claudeModel: id }).claudeModel;
    expect(claude('claude-fable-5')).toBe('claude-fable-5-2');
    expect(claude('claude-sonnet-4-6')).toBe('claude-sonnet-5-5');
    expect(claude('claude-haiku-4-5')).toBe('claude-haiku-5-5');
    expect(claude('claude-3-opus-20240229')).toBe(DEFAULT_CLAUDE_MODEL);
    const gemini = (id: string) => restoreAIModelChoices({ geminiModel: id }).geminiModel;
    expect(gemini('gemini-2.5-flash')).toBe('gemini-3.5-flash-lite');
    expect(gemini('gemini-3.5-flash')).toBe('gemini-3.6-flash');
    expect(gemini('gemini-3.1-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(gemini('gemini-3-flash-preview')).toBe('gemini-3.6-flash');
    expect(gemini('gemini-3.1-pro-preview')).toBe('gemini-3.1-pro-preview');
    expect(gemini('gemini-1.0-pro')).toBe(DEFAULT_GEMINI_MODEL);
    expect(restoreAIModelChoices({ lumaModel: 'ray-1-6' }).lumaModel).toBe(DEFAULT_LUMA_MODEL);
  });

  it('gives a fresh install the defaults', () => {
    expect(restoreAIModelChoices(undefined)).toEqual({
      claudeModel: 'claude-sonnet-5-5', geminiModel: 'gemini-4-hydrogen', veoModel: 'gemini-omni-1.2-flash', lumaModel: 'ray-3.2',
    });
  });

  describe('through the settings store', () => {
    let stored: Map<string, string>;
    beforeEach(() => {
      stored = new Map();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => { stored.set(k, String(v)); },
        removeItem: (k: string) => { stored.delete(k); },
      });
      // The store paints its colour scheme onto the page as it loads.
      const noop = () => {};
      vi.stubGlobal('document', {
        documentElement: { style: { setProperty: noop, removeProperty: noop }, setAttribute: noop, classList: { add: noop, remove: noop, toggle: noop }, dataset: {} },
      });
      vi.resetModules();
    });

    async function loadAI() {
      const { settings } = await import('../stores/settings');
      return get(settings).ai;
    }

    it('starts a fresh install on Sonnet 5.5', async () => {
      const ai = await loadAI();
      expect(ai.claudeModel).toBe('claude-sonnet-5-5');
      expect(ai.geminiModel).toBe('gemini-4-hydrogen');
      expect(ai.veoModel).toBe('gemini-omni-1.2-flash');
      expect(ai.lumaModel).toBe('ray-3.2');
    });

    it('loads saved 2.0 choices as the current models and keeps everything else', async () => {
      stored.set('ghost-arcade_settings', JSON.stringify({
        ai: {
          shaderProvider: 'gemini', claudeModel: 'claude-sonnet-4-6', geminiModel: 'gemini-3.5-flash',
          videoProvider: 'luma', veoModel: 'veo-3.1-fast-generate-preview', lumaModel: 'ray-flash-2',
        },
      }));
      const ai = await loadAI();
      expect(ai).toMatchObject({
        shaderProvider: 'gemini', videoProvider: 'luma',
        claudeModel: 'claude-sonnet-5-5', geminiModel: 'gemini-3.6-flash',
        veoModel: 'gemini-omni-1.2-flash', lumaModel: 'ray-flash-2',
      });
    });
  });
});

describe('Claude', () => {
  it('checks a key by looking the chosen model up, which costs nothing', async () => {
    const fetch = stubFetch(Response.json({ id: 'claude-opus-5-5', type: 'model' }), Response.json({ error: { type: 'not_found_error' } }, { status: 404 }));
    expect(await validateAPIKey('claude', 'test-key', 'claude-opus-5-5')).toBe(true);
    expect(await validateAPIKey('claude', 'test-key')).toBe(false);
    expect(urls(fetch)).toEqual(['https://api.anthropic.com/v1/models/claude-opus-5-5', 'https://api.anthropic.com/v1/models/claude-sonnet-5-5']);
    expect(fetch.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' });
  });

  it('sends a plain Messages request and reads the text after the thinking block', async () => {
    const fetch = stubFetch(Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: SHADER }],
    }));
    const result = await generateWithAI({ ...shaderRequest, provider: 'claude' });
    expect(result).toMatchObject({ success: true, code: SHADER });
    expect(urls(fetch)).toEqual(['https://api.anthropic.com/v1/messages']);
    const sent = body(fetch, 0);
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.messages).toEqual([{ role: 'user', content: expect.stringContaining('A white screen') }]);
    // Current models reject sampling settings and a thinking budget.
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('thinking');
  });

  it('explains a refusal, a missing model, a bad key and a rate limit', async () => {
    stubFetch(
      Response.json({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }),
      Response.json({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-fable-5-2' } }, { status: 404 }),
      Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 }),
      Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }, { status: 429 }),
      Response.json({ type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission' } }, { status: 403 }),
    );
    const run = (model?: string) => generateWithAI({ ...shaderRequest, provider: 'claude', model });
    expect((await run()).error).toMatch(/Claude Sonnet 5\.5 declined/);
    const missing = (await run('claude-fable-5-2')).error;
    expect(missing).toMatch(/Claude Fable 5\.2 is not available to this API key/);
    expect(missing).toMatch(/Choose another model in Settings > AI/);
    expect(missing).toMatch(/Claude says: model: claude-fable-5-2/);
    expect((await run()).error).toMatch(/Claude API key was not accepted/);
    expect((await run()).error).toMatch(/rate limit or quota reached/);
    expect((await run('claude-opus-5-5')).error).toMatch(/not allowed to use Claude Opus 5\.5/);
  });

  it('says when a reply ran out of room before the code finished', async () => {
    stubFetch(Response.json({ content: [{ type: 'text', text: '' }], stop_reason: 'max_tokens' }));
    expect((await generateWithAI({ ...shaderRequest, provider: 'claude' })).error).toMatch(/length limit/);
  });
});

describe('Gemini', () => {
  it('checks a key by looking the chosen model up', async () => {
    const fetch = stubFetch(
      Response.json({ name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent', 'countTokens'] }),
      Response.json({ name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] }),
      Response.json({ error: { code: 'model_not_found', message: 'not found' } }, { status: 404 }),
    );
    expect(await validateAPIKey('gemini', 'test-key')).toBe(true);
    expect(await validateAPIKey('gemini', 'test-key', 'gemini-3.8-live')).toBe(false);
    expect(await validateAPIKey('gemini', 'test-key', 'gemini-2.0-flash')).toBe(false);
    expect(urls(fetch)[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen');
  });

  it('names a thinking level for Gemini 4, sends no temperature and skips thought parts', async () => {
    const fetch = stubFetch(
      Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
        { text: 'Planning the shader.', thought: true },
        { text: SHADER.slice(0, 20) },
        { text: SHADER.slice(20) },
      ] } }] }),
      Response.json({ candidates: [{ content: { parts: [{ text: SHADER }] } }] }),
    );
    expect(await generateWithAI({ ...shaderRequest, provider: 'gemini' })).toMatchObject({ success: true, code: SHADER });
    expect(urls(fetch)[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent');
    expect(body(fetch, 0).generationConfig).toEqual({ maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'high' } });

    await generateWithAI({ ...shaderRequest, provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(body(fetch, 1).generationConfig).toEqual({ maxOutputTokens: 32768 });
  });

  it('explains quota, a retired model and a blocked prompt', async () => {
    stubFetch(
      Response.json({ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }),
      Response.json({ error: { code: 'model_not_found', message: 'models/gemini-3.6-flash is not found' } }, { status: 404 }),
      Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
      Response.json({ error: { code: 'permission_denied', message: 'Billing required' } }, { status: 403 }),
    );
    const run = (model?: string) => completeWithAI({ provider: 'gemini', apiKey: 'test-key', model, system: 's', prompt: 'p' });
    await expect(run()).rejects.toThrow(/Gemini rate limit or quota reached.*Resource has been exhausted/);
    await expect(run('gemini-3.6-flash')).rejects.toThrow(/Gemini 3\.6 Flash is not available to this API key or has been retired/);
    await expect(run()).rejects.toThrow(/Gemini blocked this request \(SAFETY\)/);
    await expect(run('gemini-4-carbon')).rejects.toThrow(/not allowed to use Gemini 4 Carbon\. The account may need billing turned on/);
  });
});

describe('Gemini Omni video', () => {
  const fileUri = 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media';
  const created = (content: unknown[]) => Response.json({ id: 'v1_1', object: 'interaction', status: 'completed', steps: [
    { type: 'user_input' }, { type: 'model_output', content },
  ] });

  it('makes a text-to-video clip: submit, wait for the file, download', async () => {
    const fetch = stubFetch(
      created([{ type: 'video', mime_type: 'video/mp4', uri: fileUri }]),
      Response.json({ name: 'files/abc123', state: 'PROCESSING' }),
      Response.json({ name: 'files/abc123', state: 'ACTIVE' }),
      new Response('mp4', { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    const statuses: string[] = [];
    const result = await generateOmniVideo(
      { apiKey: 'test-key', prompt: 'Neon ribbons', durationSeconds: 6, aspectRatio: '9:16', avoid: 'text' },
      { pollMs: 1, onStatus: (s) => statuses.push(s) },
    );
    expect(result.blob?.type).toBe('video/mp4');
    expect(urls(fetch)).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media',
    ]);
    expect(body(fetch, 0)).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: 'Neon ribbons\nAvoid: text',
      response_format: { type: 'video', aspect_ratio: '9:16', duration: '6s', delivery: 'uri' },
      background: false,
      stream: false,
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(statuses.at(-1)).toBe('Downloading video…');
  });

  it('sends a first and last frame as two images before the prompt, at most 10 seconds', async () => {
    const fetch = stubFetch(created([{ type: 'video', mime_type: 'video/mp4', data: btoa('mp4') }]));
    const first = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const last = new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' });
    const result = await generateOmniVideo({ apiKey: 'test-key', prompt: 'Bridge', durationSeconds: 15, firstFrame: first, lastFrame: last }, { pollMs: 1 });
    expect(await result.blob?.text()).toBe('mp4');
    const sent = body(fetch, 0);
    expect(sent.input).toEqual([
      { type: 'image', mime_type: 'image/png', data: btoa('\x01\x02\x03') },
      { type: 'image', mime_type: 'image/jpeg', data: btoa('\x04\x05\x06') },
      { type: 'text', text: 'Start on the first image and end on the second image. Bridge' },
    ]);
    expect(sent.response_format.duration).toBe('10s');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits on an interaction that is still running', async () => {
    const fetch = stubFetch(
      Response.json({ id: 'v1_9', status: 'in_progress', steps: [] }),
      Response.json({ id: 'v1_9', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: btoa('mp4') }] }] }),
    );
    expect((await generateOmniVideo({ apiKey: 'test-key', prompt: 'Rain' }, { pollMs: 1 })).blob).toBeDefined();
    expect(urls(fetch)[1]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions/v1_9');
  });

  it('never sends the key to a host other than Google, and explains failures', async () => {
    expect(omniFileId('https://example.com/v1beta/files/abc123:download')).toBeUndefined();
    expect(omniFileId(fileUri)).toBe('abc123');
    stubFetch(
      created([{ type: 'video', uri: 'https://example.com/files/abc123' }]),
      Response.json({ error: { code: 'model_not_found', message: 'gemini-omni-1.2-flash not found' } }, { status: 404 }),
      Response.json({ error: { code: 'permission_denied', message: 'Video generation is not available in your country' } }, { status: 403 }),
      created([{ type: 'video', uri: fileUri }]),
      Response.json({ state: 'FAILED', error: { message: 'Processing failed' } }),
    );
    const request = { apiKey: 'test-key', prompt: 'Rain' };
    expect((await startOmniVideo(request)).error).toMatch(/link this app does not recognise/);
    expect((await startOmniVideo(request)).error).toMatch(/Gemini Omni 1\.2 Flash is not available to this API key or has been retired/);
    expect((await startOmniVideo(request)).error).toMatch(/not allowed to use Gemini Omni 1\.2 Flash.*not available in your country/);
    expect((await generateOmniVideo(request, { pollMs: 1 })).error).toBe('Processing failed');
  });

  it('stops when cancelled', async () => {
    stubFetch(created([{ type: 'video', uri: fileUri }]), Response.json({ state: 'PROCESSING' }));
    const job = new AbortController();
    const running = generateOmniVideo({ apiKey: 'test-key', prompt: 'Rain' }, { signal: job.signal, pollMs: 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    job.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses a last frame without a first frame', async () => {
    const fetch = stubFetch();
    expect((await startOmniVideo({ apiKey: 'k', prompt: 'p', lastFrame: new Blob(['x']) })).error).toMatch(/first frame/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Luma video', () => {
  const proxied = (status: number, json: unknown) => ({ status, body: JSON.stringify(json), headers: {} });
  const call = (n: number) => vi.mocked(invoke).mock.calls[n][1] as { method: string; url: string; headers: Record<string, string>; body: string | null };

  it('makes a Ray 3.2 video on the Luma Agents API', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(proxied(201, { id: 'gen-1', type: 'video', state: 'queued', model: 'ray-3.2', output: [] }))
      .mockResolvedValueOnce(proxied(200, { id: 'gen-1', state: 'processing', output: [] }))
      .mockResolvedValueOnce(proxied(200, { id: 'gen-1', state: 'completed', output: [{ type: 'video', url: 'https://cdn.example/out.mp4' }] }));
    const fetch = stubFetch(new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }));

    const result = await generateLumaVideo({ apiKey: 'luma-api-test', prompt: 'Ink', resolution: '360p', duration: '5s', loop: true }, { pollMs: 1 });
    expect(result.blob?.type).toBe('video/mp4');
    expect(call(0)).toMatchObject({ method: 'POST', url: 'https://agents.lumalabs.ai/v1/generations', headers: { Authorization: 'Bearer luma-api-test' } });
    expect(JSON.parse(call(0).body!)).toEqual({
      model: 'ray-3.2', type: 'video', prompt: 'Ink', aspect_ratio: '16:9',
      video: { resolution: '360p', duration: '5s', loop: true },
    });
    expect(call(1).url).toBe('https://agents.lumalabs.ai/v1/generations/gen-1');
    expect(urls(fetch)).toEqual(['https://cdn.example/out.mp4']);
  });

  it('keeps Ray 2 on the Dream Machine API for saved setups', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(proxied(201, { id: 'old-1', state: 'queued' }))
      .mockResolvedValueOnce(proxied(200, { id: 'old-1', state: 'dreaming' }))
      .mockResolvedValueOnce(proxied(200, { id: 'old-1', state: 'completed', assets: { video: 'https://storage.cdn-luma.com/x.mp4' } }));
    stubFetch(new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }));
    const result = await generateLumaVideo({ apiKey: 'luma-test', prompt: 'Ink', model: 'ray-flash-2', duration: '9s', resolution: '4k' }, { pollMs: 1 });
    expect(result.blob).toBeDefined();
    expect(call(0).url).toBe('https://api.lumalabs.ai/dream-machine/v1/generations');
    expect(JSON.parse(call(0).body!)).toEqual({ model: 'ray-flash-2', prompt: 'Ink', aspect_ratio: '16:9', resolution: '4k', duration: '9s', loop: false });
    expect(call(1).url).toBe('https://api.lumalabs.ai/dream-machine/v1/generations/old-1');
  });

  it('only offers what each model takes, and refuses the rest before sending', async () => {
    expect(lumaModelOptions('ray-3.2')).toEqual({
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], resolutions: ['360p', '540p', '720p', '1080p'], durations: ['5s', '10s'], loopDurations: ['5s'],
    });
    expect(lumaModelOptions('ray-2').resolutions).toContain('4k');
    expect((await startLumaGeneration({ apiKey: 'k', prompt: 'p', resolution: '4k' })).error).toMatch(/does not make 4k/);
    expect((await startLumaGeneration({ apiKey: 'k', prompt: 'p', aspectRatio: '9:21' })).error).toMatch(/9:21/);
    expect((await startLumaGeneration({ apiKey: 'k', prompt: 'p', duration: '10s', loop: true })).error).toMatch(/loops must be 5s/);
    expect((await startLumaGeneration({ apiKey: 'k', prompt: 'p', model: 'ray-2', duration: '10s' })).error).toMatch(/does not make 10s/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('says which key Ray 3.2 needs, and explains credit and rate limits', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(proxied(400, { detail: 'Unknown model: ray-3.2' }))
      .mockResolvedValueOnce(proxied(401, { detail: 'Invalid API key' }))
      .mockResolvedValueOnce(proxied(402, { detail: 'Insufficient balance. Please add funds to continue.' }))
      .mockResolvedValueOnce(proxied(429, { detail: 'Too many concurrent jobs' }));
    const start = () => startLumaGeneration({ apiKey: 'k', prompt: 'p' });
    expect((await start()).error).toMatch(/Ray 3\.2 needs a Luma Agents API key.*Unknown model/);
    expect((await start()).error).toMatch(/Ray 3\.2 needs a Luma Agents API key.*Invalid API key/);
    expect((await start()).error).toMatch(/run out of credit/);
    expect((await start()).error).toMatch(/Luma rate limit or quota reached.*Too many concurrent jobs/);
  });

  it('checks a key on the API its model uses', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(proxied(200, { balance_credits: 120 }))
      .mockResolvedValueOnce(proxied(401, { detail: 'Invalid API key' }));
    expect(await validateLumaKey('luma-api-test')).toBe(true);
    expect(await validateLumaKey('luma-test', 'ray-2')).toBe(false);
    expect(call(0)).toMatchObject({ method: 'GET', url: 'https://agents.lumalabs.ai/v1/credits' });
    expect(call(1).url).toBe('https://api.lumalabs.ai/dream-machine/v1/generations?limit=1');
  });
});
