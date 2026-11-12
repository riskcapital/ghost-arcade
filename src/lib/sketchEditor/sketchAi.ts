/**
 * Learning mode's AI actions, run with the user's own key for the AI
 * provider chosen in Settings.
 *
 * Two of them answer in words (explain the sketch, ideas to build on it);
 * two propose a new version of the open file (react to audio, adapt for
 * Ghost Arcade), which the editor shows as a diff to accept or reject. The
 * sketch stays plain p5.js that also runs in the p5.js Web Editor: Ghost
 * Arcade's own wrapping is added when it plays, never written into the code.
 * Prompts and the reading of replies live here so they can be tested without
 * a network.
 */
import { completeWithAI, type AIProvider } from '../api/ai-client';
import { firstSyntaxError, languageOf, lineAt, readSketchFile } from './sketchSource';
import type { SketchRuntime } from './sketchTips';

export type SketchAiAction = 'explain' | 'ideas' | 'audio' | 'adapt';

export interface SketchAiActionInfo {
  id: SketchAiAction;
  label: string;
  hint: string;
  /** 'text' answers in words; 'code' proposes a new version of the open file. */
  kind: 'text' | 'code';
}

export const SKETCH_AI_ACTIONS: SketchAiActionInfo[] = [
  { id: 'explain', label: 'Explain this', hint: 'A walk through the code, line by line, in plain words.', kind: 'text' },
  { id: 'ideas', label: 'Ideas to build on it', hint: 'Five directions to take it next, with the p5 functions to try.', kind: 'text' },
  { id: 'audio', label: 'Make it react to audio', hint: 'Proposes changes to the open file that move it with the music, as a diff to review.', kind: 'code' },
  { id: 'adapt', label: 'Adapt it for Ghost Arcade', hint: 'Proposes changes to the open file that suit a show, as a diff to review.', kind: 'code' },
];

export interface SketchAiSettings {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

export interface SketchAiFile {
  path: string;
  text: string;
}

export interface SketchAiRequest {
  files: SketchAiFile[];
  /** The file the user has open; code actions propose a new version of it. */
  path: string;
  runtime?: SketchRuntime;
}

function context(runtime: SketchRuntime): string {
  return `You are helping someone work on a p5.js sketch inside Ghost Arcade, a VJ and projection mapping application. They may be learning to code, so be clear and kind, and never condescending.

The sketch is a set of files, as in the p5.js Web Editor: sketch.js, index.html and so on. It must stay plain p5.js that runs in the p5.js Web Editor as well. Ghost Arcade adds its own wrapping when the sketch plays, so the code never needs any of it:
- It runs the sketch on p5.js 1.11, offline, in a window the size of the output (often 1920x1080). ${runtime.canvas?.mode === 'fit' ? 'This sketch\'s canvas keeps its size and is scaled to fit the output.' : 'The canvas grows to fill the output, so positions written from width and height follow it.'} Never add code to size the canvas for Ghost Arcade.
- Top-level variables the sketch only reads while drawing (numbers, true/false${runtime.colourControls ? ', colors' : ''}) become controls the performer can change live and map to MIDI. Keeping tunable values in well-named top-level variables is how a sketch gets controls.
- Nobody touches the picture at a show: there is no mouse, keyboard or camera, so anything that depends on them stays still.
- ${runtime.soundFromShow
    ? 'p5.sound hears the music of the show: p5.Amplitude, p5.FFT and p5.AudioIn follow it. Use them for audio, exactly as in the p5.js Web Editor.'
    : 'For the music of the show, Ghost Arcade provides window.ghostAudio: level, bass, mid, treble, high, beat, kick and snare from 0 to 1 (all 0 when nothing plays). It is the only Ghost Arcade name a sketch may use.'}
- The layer can be blended with others and given GPU effects (glow, blur, feedback, color), so the sketch should draw the form and leave those treatments to Ghost Arcade.`;
}

/** A file with line numbers, so replies can point at lines. */
export function numberedCode(text: string): string {
  const lines = text.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)}| ${line}`).join('\n');
}

function fence(path: string): string {
  return /\.m?js$/i.test(path) ? 'js' : /\.css$/i.test(path) ? 'css' : 'html';
}

/** The other files, for context: what a reply needs to know about the sketch around the open file. */
function otherFiles(request: SketchAiRequest): string {
  const others = request.files.filter((f) => f.path !== request.path && f.text.length < 20000);
  if (others.length === 0) return '';
  return `\n\nThe sketch's other files, for context:\n${others.map((f) => `\n${f.path}:\n\`\`\`${fence(f.path)}\n${f.text}\n\`\`\``).join('\n')}`;
}

export function buildSketchPrompt(action: SketchAiAction, request: SketchAiRequest): { system: string; prompt: string; maxTokens: number } {
  const runtime = request.runtime ?? {};
  const open = request.files.find((f) => f.path === request.path) ?? { path: request.path, text: '' };
  const system = context(runtime);
  const returnFile = `Return the complete new ${open.path} in one \`\`\`${fence(open.path)} code block and nothing else.`;
  switch (action) {
    case 'explain':
      return {
        system,
        maxTokens: 4000,
        prompt: `Explain this sketch to someone who is learning to code.

Start with one or two sentences on what it draws and how it moves. Then walk through how it works in the order the code runs: what setup() prepares, what draw() does each frame, and the two to four ideas that make it interesting (for example noise(), a loop, a class, transformations). Mention line numbers of ${open.path} as "line 12" so the reader can find them. Finish with one small change to try and what it will do.

Write plain text: short paragraphs, "- " for list items, \`backticks\` around code. No headings. Under 350 words.

${open.path} (line numbers added):
${numberedCode(open.text)}${otherFiles(request)}`,
      };
    case 'ideas':
      return {
        system,
        maxTokens: 3000,
        prompt: `Suggest five ideas for building on this sketch for live visuals at a show. Mix small steps a beginner can do in a few minutes with one or two bigger ones. For each idea write one line starting with "- " that gives a short title, a colon, then one or two sentences on how to do it, naming the p5.js functions to use. Plain text, \`backticks\` around code, no headings, no other text.

${open.path}:
\`\`\`${fence(open.path)}
${open.text}
\`\`\`${otherFiles(request)}`,
      };
    case 'audio':
      return {
        system,
        maxTokens: 16000,
        prompt: `Make this sketch react to music.

- Keep everything it does now: its idea, look, structure, names and comments. Change as little as you can.
- Drive a few things that suit the sketch from the audio: continuous values such as the level or the bass for size, speed or weight (eased so they never flicker), and beats for events.
- ${runtime.soundFromShow ? 'Use p5.Amplitude or p5.FFT, made once in setup().' : 'Read window.ghostAudio while drawing, with a fallback of 0 when it is missing, so the sketch also runs in the p5.js Web Editor.'}
- Put how strongly it reacts in a top-level variable (let react = 1;), so it becomes a control.
- It must still move on its own when nothing plays.
- Add a short comment by each change saying what it does.

${returnFile}

${open.path}:
\`\`\`${fence(open.path)}
${open.text}
\`\`\`${otherFiles(request)}`,
      };
    case 'adapt':
      return {
        system,
        maxTokens: 16000,
        prompt: `Make this sketch ready for a show in Ghost Arcade, keeping it the same sketch in plain p5.js.

- Keep its idea and look, and the author's names and comments.
- Positions and sizes from width and height rather than fixed numbers, so the picture fills any screen. Do not change createCanvas() for Ghost Arcade.
- Replace the mouse and keyboard with motion of its own (noise(), sin(), millis()), since nobody touches a projection.
- Tunable numbers and colors in well-named top-level variables, so they become controls.
- Time motion with deltaTime or millis() rather than frameCount, and keep heavy work (createGraphics, loading, big allocations) out of draw().
- Add a short comment by each change saying why.

${returnFile}

${open.path}:
\`\`\`${fence(open.path)}
${open.text}
\`\`\`${otherFiles(request)}`,
      };
  }
}

export type SketchAiResult =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; warning: string | null }
  | { kind: 'error'; message: string };

/** The file in a reply, without code fences or chat around it. */
export function extractReplyFile(reply: string, path: string): string | null {
  const text = reply.trim();
  const fences = [...text.matchAll(/```[\w-]*[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (fences.length > 0) return fences.sort((a, b) => b.length - a.length)[0].replace(/\s+$/, '');
  if (/\.html?$/i.test(path)) {
    const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
    if (start < 0) return null;
    const close = text.toLowerCase().lastIndexOf('</html>');
    return text.slice(start, close >= 0 ? close + '</html>'.length : undefined);
  }
  // A reply of bare code: it must at least read as JavaScript.
  return languageOf(path) === 'js' && firstSyntaxError(readSketchFile(text, 'js')) === null ? text : null;
}

/** Read a reply into what the editor shows. */
export function readSketchReply(action: SketchAiAction, reply: string, truncated: boolean, path: string, original: string): SketchAiResult {
  const info = SKETCH_AI_ACTIONS.find((a) => a.id === action)!;
  if (info.kind === 'text') {
    const text = reply.replace(/^#+\s*/gm, '').trim();
    if (!text) return { kind: 'error', message: 'The reply was empty. Try again.' };
    return { kind: 'text', text: truncated ? `${text}\n\n(The reply was cut short.)` : text };
  }
  if (truncated) {
    return { kind: 'error', message: `The reply was cut short before ${path} ended, so nothing was changed. Try again, or ask about a smaller part.` };
  }
  const extracted = extractReplyFile(reply, path);
  if (!extracted) return { kind: 'error', message: `The reply did not contain a new ${path}. Try again.` };
  // Replies lose the file's final line break; without it the diff would
  // show the last line as changed.
  const code = original.endsWith('\n') && !extracted.endsWith('\n') ? `${extracted}\n` : extracted;
  if (code.trim() === original.trim()) return { kind: 'error', message: 'The suggestion is the same as the open file.' };
  const language = languageOf(path);
  const syntax = language ? firstSyntaxError(readSketchFile(code, language)) : null;
  return {
    kind: 'code',
    code,
    warning: syntax === null ? null : `The suggested code has a syntax problem near line ${lineAt(code, syntax)}. Check that part before keeping it.`,
  };
}

/** Run an action. Network and key problems come back as an error result, not a throw. */
export async function runSketchAi(action: SketchAiAction, request: SketchAiRequest, settings: SketchAiSettings): Promise<SketchAiResult> {
  const { system, prompt, maxTokens } = buildSketchPrompt(action, request);
  const original = request.files.find((f) => f.path === request.path)?.text ?? '';
  try {
    const reply = await completeWithAI({ ...settings, system, prompt, maxTokens });
    return readSketchReply(action, reply.text, reply.truncated, request.path, original);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Showing a reply ───────────────────────────────────────────────────────

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'line'; text: string; line: number };

export type TextBlock = { kind: 'p'; parts: TextPart[] } | { kind: 'list'; items: TextPart[][] };

/** Split inline text into plain words, `code` and "line 12" references the editor can jump to. */
export function inlineParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /`([^`]+)`|\b([Ll]ines? (\d+)(?:\s*(?:-|–|to|and)\s*\d+)?)/g;
  let at = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > at) parts.push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'code', text: m[1] });
    else parts.push({ kind: 'line', text: m[2], line: Number(m[3]) });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts.map((p) => (p.kind === 'text' ? { ...p, text: p.text.replace(/\*\*([^*]+)\*\*/g, '$1') } : p));
}

/** Paragraphs and "- " lists, ready to render without HTML injection. */
export function formatReplyText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    let list: TextPart[][] | null = null;
    let paragraph: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ kind: 'p', parts: inlineParts(paragraph.join(' ')) });
      paragraph = [];
    };
    for (const line of lines) {
      const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        flushParagraph();
        if (!list) {
          list = [];
          blocks.push({ kind: 'list', items: list });
        }
        list.push(inlineParts(item[1]));
      } else {
        list = null;
        paragraph.push(line);
      }
    }
    flushParagraph();
  }
  return blocks;
}
