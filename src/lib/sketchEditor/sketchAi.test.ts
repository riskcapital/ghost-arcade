import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSketchPrompt, extractReplyFile, formatReplyText, inlineParts, numberedCode, readSketchReply, runSketchAi, type SketchAiRequest } from './sketchAi';
import { cleanErrorMessage, explainSketchError } from './sketchErrors';

const sketch = `function setup() {
  createCanvas(400, 400);
}

function draw() {
  circle(10, 10, 10);
}
`;
const page = '<!DOCTYPE html>\n<html>\n<body>\n<script src="sketch.js"></script>\n</body>\n</html>\n';
const request: SketchAiRequest = { files: [{ path: 'sketch.js', text: sketch }, { path: 'index.html', text: page }], path: 'sketch.js' };
const changed = sketch.replace('10, 10, 10', '20, 20, 20');

describe('AI prompts', () => {
  it('numbers the open file\'s lines for explanations and shows the rest for context', () => {
    expect(numberedCode('a\nb')).toBe('1| a\n2| b');
    const { prompt, maxTokens } = buildSketchPrompt('explain', request);
    expect(prompt).toContain('6|   circle(10, 10, 10);');
    expect(prompt).toContain('index.html:\n```html\n<!DOCTYPE html>');
    expect(maxTokens).toBeLessThan(16000);
  });

  it('asks for plain p5.js and leaves Ghost Arcade\'s wrapping out of the code', () => {
    for (const action of ['audio', 'adapt'] as const) {
      const { system, prompt } = buildSketchPrompt(action, request);
      expect(system).toContain('runs in the p5.js Web Editor as well');
      expect(system).toContain('Never add code to size the canvas');
      expect(system).not.toContain('shaderParams');
      expect(prompt).toContain('Return the complete new sketch.js in one ```js code block');
    }
  });

  it('speaks of p5.sound when Ghost Arcade plays the show into it', () => {
    expect(buildSketchPrompt('audio', { ...request, runtime: { soundFromShow: true } }).prompt).toContain('p5.Amplitude or p5.FFT');
    expect(buildSketchPrompt('audio', request).prompt).toContain('window.ghostAudio');
  });
});

describe('reading replies', () => {
  it('takes the file out of fences and chat', () => {
    expect(extractReplyFile(`Here you go:\n\n\`\`\`js\n${changed}\`\`\`\n\nEnjoy!`, 'sketch.js')).toBe(changed.trimEnd());
    expect(extractReplyFile(changed, 'sketch.js')).toBe(changed.trim());
    expect(extractReplyFile('Sorry, I cannot help with that.', 'sketch.js')).toBeNull();
    expect(extractReplyFile(`Sure! ${page} Hope that helps.`, 'index.html')).toBe(page.trim());
  });

  it('turns a new version into a proposal, keeping the final line break', () => {
    expect(readSketchReply('audio', `\`\`\`js\n${changed}\`\`\``, false, 'sketch.js', sketch)).toEqual({ kind: 'code', code: changed, warning: null });
  });

  it('refuses a reply that was cut short, or changes nothing', () => {
    expect(readSketchReply('adapt', changed, true, 'sketch.js', sketch).kind).toBe('error');
    expect(readSketchReply('adapt', sketch, false, 'sketch.js', sketch)).toMatchObject({ kind: 'error', message: expect.stringContaining('same') });
  });

  it('flags a proposal with a syntax problem', () => {
    const broken = sketch.replace('circle(10, 10, 10);', 'circle(10, 10, 10;');
    const result = readSketchReply('adapt', `\`\`\`js\n${broken}\`\`\``, false, 'sketch.js', sketch);
    expect(result.kind === 'code' && result.warning).toContain('line 6');
  });

  it('keeps text replies as text, without markdown headings', () => {
    expect(readSketchReply('explain', '## What it does\nIt draws.', false, 'sketch.js', sketch)).toEqual({ kind: 'text', text: 'What it does\nIt draws.' });
    expect(readSketchReply('ideas', '  ', false, 'sketch.js', sketch).kind).toBe('error');
  });
});

describe('running an action', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('sends the user\'s key and model to the chosen provider and reads the text after any thinking', async () => {
    const fetch = reply({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'It draws a circle.' }], stop_reason: 'end_turn' });
    vi.stubGlobal('fetch', fetch);
    const result = await runSketchAi('explain', request, { provider: 'claude', apiKey: 'key', model: 'test-model' });
    expect(result).toEqual({ kind: 'text', text: 'It draws a circle.' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('key');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', max_tokens: 4000 });
  });

  it('proposes the new file from a code action', async () => {
    vi.stubGlobal('fetch', reply({ content: [{ type: 'text', text: `\`\`\`js\n${changed}\`\`\`` }], stop_reason: 'end_turn' }));
    expect(await runSketchAi('adapt', request, { provider: 'claude', apiKey: 'key' })).toEqual({ kind: 'code', code: changed, warning: null });
  });

  it('turns a reply cut off at the token limit into an error, for either provider', async () => {
    vi.stubGlobal('fetch', reply({ content: [{ type: 'text', text: changed }], stop_reason: 'max_tokens' }));
    expect((await runSketchAi('adapt', request, { provider: 'claude', apiKey: 'key' })).kind).toBe('error');
    vi.stubGlobal('fetch', reply({ candidates: [{ content: { parts: [{ text: changed }] }, finishReason: 'MAX_TOKENS' }] }));
    expect((await runSketchAi('adapt', request, { provider: 'gemini', apiKey: 'key' })).kind).toBe('error');
  });

  it('reports a failed request as an error result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })));
    expect(await runSketchAi('ideas', request, { provider: 'claude', apiKey: 'bad' })).toEqual({ kind: 'error', message: 'invalid x-api-key' });
  });
});

describe('formatting replies', () => {
  it('finds code and line references', () => {
    expect(inlineParts('On line 12, `noise()` is **smooth**.')).toEqual([
      { kind: 'text', text: 'On ' },
      { kind: 'line', text: 'line 12', line: 12 },
      { kind: 'text', text: ', ' },
      { kind: 'code', text: 'noise()' },
      { kind: 'text', text: ' is smooth.' },
    ]);
  });

  it('splits paragraphs and lists', () => {
    const blocks = formatReplyText('It draws circles.\nThey move.\n\n- One: `a`\n- Two\nAfter.');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'list', 'p']);
    expect(blocks[0]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'It draws circles. They move.' }] });
    expect(blocks[1].kind === 'list' && blocks[1].items).toHaveLength(2);
  });
});

describe('sketch errors in plain words', () => {
  it('drops the browser prefix', () => {
    expect(cleanErrorMessage('Uncaught ReferenceError: x is not defined')).toBe('ReferenceError: x is not defined');
  });

  it('explains the usual mistakes', () => {
    expect(explainSketchError('Uncaught ReferenceError: partcles is not defined')).toContain('partcles is used but never created');
    expect(explainSketchError("Uncaught TypeError: Cannot read properties of undefined (reading 'x')")).toContain('.x cannot be read');
    expect(explainSketchError('Uncaught TypeError: p5.AudioIn is not a constructor')).toContain('p5.sound');
    expect(explainSketchError('Uncaught TypeError: Assignment to constant variable.')).toContain('let');
    expect(explainSketchError("Uncaught SyntaxError: Unexpected token '}'")).toContain('missing comma, bracket or quote');
    expect(explainSketchError('Uncaught SyntaxError: Unexpected end of input')).toContain('bracket');
    expect(explainSketchError('Uncaught RangeError: Maximum call stack size exceeded')).toContain('calling itself');
  });

  it('adds nothing when it has nothing useful to say', () => {
    expect(explainSketchError('Something odd happened')).toBeNull();
  });
});
