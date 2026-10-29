/**
 * The sketch editor's CodeMirror 6 set-up: the code view, learning mode's
 * underlines and hover cards, diagnostics for errors and tips, and the
 * read-only diff view for AI proposals.
 */
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { html as htmlLanguage } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { diff, unifiedMergeView } from '@codemirror/merge';
import { tags as t } from '@lezer/highlight';
import type { SketchNote } from './sketchAnnotations';
import type { SketchLink } from './sketchConcepts';

const palette = {
  background: '#0d0d10',
  gutter: '#0a0a0c',
  text: '#e8e8e8',
  muted: '#6b6b78',
  selection: 'rgba(255, 114, 95, 0.22)',
  accent: '#FF725F',
  link: '#FF9A84',
  line: 'rgba(255, 255, 255, 0.035)',
};

/** The app's interface font, for the explanations that pop up over the code. */
const uiFont = "var(--ga-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)";

const theme = EditorView.theme(
  {
    '&': { height: '100%', color: palette.text, backgroundColor: palette.background, fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace", lineHeight: '1.55' },
    '.cm-content': { caretColor: palette.accent },
    '&.cm-focused .cm-cursor': { borderLeftColor: palette.accent },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: `${palette.selection} !important` },
    '.cm-gutters': { backgroundColor: palette.gutter, color: palette.muted, border: 'none', borderRight: '1px solid rgba(255,255,255,0.05)' },
    '.cm-activeLine': { backgroundColor: palette.line },
    '.cm-activeLineGutter': { backgroundColor: palette.line, color: '#a0a0a0' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255, 114, 95, 0.18)', outline: '1px solid rgba(255, 114, 95, 0.4)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(255, 165, 2, 0.25)' },
    '.cm-panels': { backgroundColor: '#141418', color: palette.text },
    '.cm-tooltip': { backgroundColor: '#16161b', border: '1px solid rgba(255,255,255,0.1)', color: palette.text, borderRadius: '6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(255, 114, 95, 0.25)', color: palette.text },
    '.cm-sketch-concept': { textDecoration: 'underline dotted rgba(255, 255, 255, 0.4)', textUnderlineOffset: '3px', cursor: 'help' },
    '.cm-sketch-focus': { backgroundColor: palette.selection, borderRadius: '2px' },
    '.cm-lintRange-hint': { backgroundImage: 'none', textDecoration: 'underline wavy rgba(160, 160, 160, 0.55)', textUnderlineOffset: '3px' },
    '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline wavy rgba(46, 213, 115, 0.6)', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy rgba(255, 165, 2, 0.75)', textUnderlineOffset: '3px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy rgba(255, 71, 87, 0.9)', textUnderlineOffset: '3px' },
    // Severity shows in the underline and the marker beside the line, not as a stripe down the message.
    '.cm-diagnostic': { padding: '6px 10px', maxWidth: '420px', lineHeight: '1.45', fontFamily: uiFont, fontSize: '12.5px' },
    '.cm-diagnostic-error, .cm-diagnostic-warning, .cm-diagnostic-info, .cm-diagnostic-hint': { borderLeft: 'none' },
    '.cm-diagnosticAction': { backgroundColor: palette.accent, color: '#111', borderRadius: '4px', border: 'none', padding: '2px 8px', marginTop: '6px' },
    '.cm-lint-marker': { content: 'none', width: '6px', height: '6px', borderRadius: '50%', margin: '0.5em auto 0' },
    '.cm-lint-marker-hint': { backgroundColor: 'rgba(160, 160, 160, 0.6)' },
    '.cm-lint-marker-info': { content: 'none', backgroundColor: 'rgba(46, 213, 115, 0.75)' },
    '.cm-lint-marker-warning': { content: 'none', backgroundColor: '#FFA502' },
    '.cm-lint-marker-error': { content: 'none', backgroundColor: '#FF4757' },
    '.cm-sketch-hover': { padding: '8px 12px', maxWidth: '380px', fontFamily: uiFont, fontSize: '12.5px', lineHeight: '1.5' },
    '.cm-sketch-hover strong': { display: 'block', marginBottom: '4px', color: '#fff', fontSize: '13px' },
    '.cm-sketch-hover p': { margin: '0 0 6px', color: '#cfcfd6' },
    '.cm-sketch-hover a': { display: 'block', color: palette.link, textDecoration: 'none', cursor: 'pointer' },
    '.cm-sketch-hover a:hover': { textDecoration: 'underline' },
    '.cm-changedLine': { backgroundColor: 'rgba(46, 213, 115, 0.08) !important' },
    '.cm-changedText': { backgroundColor: 'rgba(46, 213, 115, 0.28) !important' },
    '.cm-deletedChunk': { backgroundColor: 'rgba(255, 71, 87, 0.1) !important' },
    '.cm-deletedChunk .cm-deletedText, .cm-deletedChunk del': { backgroundColor: 'rgba(255, 71, 87, 0.3)', textDecoration: 'none' },
    '.cm-chunkButtons button': { borderRadius: '4px', border: 'none', padding: '1px 8px', marginRight: '4px', cursor: 'pointer', fontSize: '11px' },
    '.cm-chunkButtons button[name=accept]': { backgroundColor: '#2ED573', color: '#0b0b0b' },
    '.cm-chunkButtons button[name=reject]': { backgroundColor: '#FF4757', color: '#fff' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#ff8f7e' },
  { tag: [t.definitionKeyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#ff8f7e' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#e8e8e8' },
  { tag: [t.propertyName], color: '#c3cee3' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#f7b267' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a5e075' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6b7280', fontStyle: 'italic' },
  { tag: [t.tagName], color: '#ff8f7e' },
  { tag: [t.attributeName], color: '#f7b267' },
  { tag: [t.attributeValue], color: '#a5e075' },
  { tag: [t.angleBracket, t.punctuation, t.bracket], color: '#8b8b98' },
  { tag: [t.typeName, t.className], color: '#ffcb6b' },
  { tag: [t.operator], color: '#89ddff' },
  { tag: t.invalid, color: '#FF4757' },
]);

// ─── Learning mode: underlined ideas with hover cards ──────────────────────

const setConceptMarks = StateEffect.define<{ notes: SketchNote[] }>();
const setFocus = StateEffect.define<{ from: number; to: number } | null>();

const conceptMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setConceptMarks)) continue;
      const length = tr.state.doc.length;
      const ranges = effect.value.notes
        .flatMap((note) => note.ranges.map((r) => ({ ...r, id: note.id })))
        .filter((r) => r.from < r.to && r.to <= length)
        .sort((a, b) => a.from - b.from || a.to - b.to);
      next = Decoration.set(ranges.map((r) => Decoration.mark({ class: 'cm-sketch-concept', noteId: r.id }).range(r.from, r.to)));
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const focusMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFocus)) continue;
      const range = effect.value;
      next = range && range.from < range.to && range.to <= tr.state.doc.length
        ? Decoration.set([Decoration.mark({ class: 'cm-sketch-focus' }).range(range.from, range.to)])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SketchEditorCallbacks {
  /** A file's text changed. */
  onChange: (path: string, text: string) => void;
  onSave: () => void;
  /** Notes by id, for hover cards. */
  noteById: (id: string) => SketchNote | undefined;
  openLink: (link: SketchLink) => void;
}

function linkElement(link: SketchLink, open: (link: SketchLink) => void): HTMLElement {
  const a = document.createElement('a');
  a.textContent = link.label;
  a.href = link.url;
  a.addEventListener('click', (event) => {
    event.preventDefault();
    open(link);
  });
  return a;
}

/** A small card about a note, for hovers and diagnostics. */
export function noteCard(note: { title: string; body: string; links: SketchLink[] }, open: (link: SketchLink) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cm-sketch-hover';
  const title = document.createElement('strong');
  title.textContent = note.title;
  const body = document.createElement('p');
  body.textContent = note.body;
  card.append(title, body, ...note.links.slice(0, 3).map((l) => linkElement(l, open)));
  return card;
}

// ─── The editor ────────────────────────────────────────────────────────────

/** Highlighting for a sketch file by its name. */
export function languageFor(path: string): Extension {
  if (/\.m?js$/i.test(path)) return javascript();
  if (/\.css$/i.test(path)) return css();
  if (/\.html?$/i.test(path)) return htmlLanguage();
  return [];
}

export interface SketchCodeEditor {
  view: EditorView;
  /** The file showing. */
  readonly path: string;
  /** Show another file. Each file keeps its own text, selection and undo history. */
  open(path: string): void;
  /** A file's current text. */
  text(path: string): string;
  /** Learning mode's underlines and hover cards on or off. */
  setLearning(on: boolean): void;
  setNotes(notes: SketchNote[]): void;
  setDiagnostics(diagnostics: Diagnostic[]): void;
  /** Select a range, scroll it into view and flash it. */
  reveal(from: number, to: number): void;
  revealLine(line: number): void;
  /** Replace the showing file's text as one undoable step, changing only what differs. */
  replaceAll(next: string): void;
  destroy(): void;
}

export function createSketchCodeEditor(
  parent: HTMLElement,
  files: Array<{ path: string; text: string }>,
  first: string,
  callbacks: SketchEditorCallbacks,
): SketchCodeEditor {
  let learning = false;
  // Hover cards read the flag, so switching learning mode needs no
  // reconfiguring of every file's state.
  const hover = hoverTooltip((view, pos) => {
    if (!learning) return null;
    let found: { from: number; to: number; id: string } | null = null;
    view.state.field(conceptMarks).between(pos, pos, (from, to, value) => {
      if (!found && pos >= from && pos <= to) found = { from, to, id: (value.spec as { noteId: string }).noteId };
    });
    const hit = found as { from: number; to: number; id: string } | null;
    const note = hit ? callbacks.noteById(hit.id) : undefined;
    if (!hit || !note) return null;
    return { pos: hit.from, end: hit.to, above: true, create: () => ({ dom: noteCard(note, callbacks.openLink) }) };
  });

  const stateFor = (path: string, doc: string) => EditorState.create({
    doc,
    extensions: [
      basicSetup,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { callbacks.onSave(); return true; } },
        indentWithTab,
      ]),
      languageFor(path),
      theme,
      syntaxHighlighting(highlight),
      lintGutter(),
      conceptMarks,
      focusMark,
      hover,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.onChange(current, update.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ 'aria-label': `Sketch code: ${path}`, spellcheck: 'false' }),
    ],
  });

  const states = new Map(files.map((f) => [f.path, stateFor(f.path, f.text)]));
  let current = states.has(first) ? first : files[0]?.path ?? '';
  const view = new EditorView({ parent, state: states.get(current) ?? stateFor(current, '') });

  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  const flash = (from: number, to: number) => {
    view.dispatch({ effects: setFocus.of({ from, to }) });
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => view.dispatch({ effects: setFocus.of(null) }), 1600);
  };

  const reveal = (from: number, to: number) => {
    const length = view.state.doc.length;
    const a = Math.max(0, Math.min(from, length));
    const b = Math.max(a, Math.min(to, length));
    view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
    flash(a, b);
    view.focus();
  };

  return {
    view,
    get path() {
      return current;
    },
    open(path) {
      if (path === current || !states.has(path)) return;
      states.set(current, view.state);
      current = path;
      view.setState(states.get(path)!);
    },
    text(path) {
      return path === current ? view.state.doc.toString() : states.get(path)?.doc.toString() ?? '';
    },
    setLearning(on) {
      learning = on;
      if (!on) view.dispatch({ effects: setConceptMarks.of({ notes: [] }) });
    },
    setNotes(notes) {
      view.dispatch({ effects: setConceptMarks.of({ notes }) });
    },
    setDiagnostics(diagnostics) {
      const length = view.state.doc.length;
      view.dispatch(setDiagnostics(view.state, diagnostics.filter((d) => d.from >= 0 && d.to <= length && d.from <= d.to)));
    },
    reveal,
    revealLine(line) {
      const doc = view.state.doc;
      const target = doc.line(Math.max(1, Math.min(line, doc.lines)));
      reveal(target.from, target.to);
    },
    replaceAll(next) {
      const now = view.state.doc.toString();
      if (now === next) return;
      const changes = diff(now, next).map((c) => ({ from: c.fromA, to: c.toA, insert: next.slice(c.fromB, c.toB) }));
      view.dispatch({ changes, userEvent: 'input.replace' });
    },
    destroy() {
      if (focusTimer) clearTimeout(focusTimer);
      view.destroy();
    },
  };
}

/**
 * A view of a proposed file against the current one. Each changed part has
 * accept and reject buttons; what is left when the user is done is the
 * proposal minus the parts they rejected.
 */
export function createProposalView(parent: HTMLElement, path: string, original: string, proposal: string): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: proposal,
      extensions: [
        basicSetup,
        languageFor(path),
        theme,
        syntaxHighlighting(highlight),
        EditorState.readOnly.of(true),
        unifiedMergeView({ original, mergeControls: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 } }),
      ],
    }),
  });
}
