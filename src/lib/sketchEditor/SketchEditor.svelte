<script lang="ts">
  /**
   * The p5.js sketch editor: the sketch's own files on the left, as tabs in
   * the order the p5.js Web Editor uses (sketch.js first), and the layer's
   * live picture and learning mode on the right.
   *
   * The editor only ever shows and changes the sketch as written. Ghost
   * Arcade's wrapping (its bundled p5, canvas sizing, controls and audio) is
   * added when the sketch plays, from these files. Edits go to the layer a
   * moment after typing stops (no undo step for each keystroke); Save makes
   * them one undo step in the project and updates the media tray.
   *
   * The editor is modal: while it is open the app behind it does not act on
   * the keyboard, except B, the emergency blackout.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { undo, redo } from '@codemirror/commands';
  import type { EditorView } from '@codemirror/view';
  import type { Diagnostic } from '@codemirror/lint';
  import { project, selectedLayerId } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { shaderLibrary } from '../stores/shaderLibrary';
  import { loadSketches, saveSketch, updateSketch, type StoredSketch } from '../stores/sketchLibrary';
  import { settings } from '../stores/settings';
  import { recordDiscreteAction } from '../stores/historyHooks';
  import { showToast } from '../stores/errorToast';
  import { openExternalUrl } from '../bridge';
  import { disposeJSAnimationContext, getJSAnimationContext, restartJSAnimation, trialRunJSAnimation } from '../renderer/js-animation';
  import { generateUUID, type JSAnimationSource, type MediaSource } from '../types';
  import { annotateSketch, type SketchNote } from './sketchAnnotations';
  import { GETTING_STARTED, type SketchLink } from './sketchConcepts';
  import { canvasSentence, findSketchTips, type SketchRuntime, type SketchTip } from './sketchTips';
  import { firstSyntaxError, languageOf, lineAt, readSketchFile, saveProblem } from './sketchSource';
  import { cleanErrorMessage, explainSketchError, type SketchError } from './sketchErrors';
  import { readSketchRun, type SketchRunStatus } from './sketchRuntime';
  import { dropSketchDraft, keepSketchDraft, readSketchDraft } from './sketchDrafts';
  import { layersPlayingSource } from './sketchLayer';
  import { editorFiles, errorInFiles, fileOrder, isTextFile, sketchWithFiles, sketchWrapping, type EditorFile, type SketchWrapping } from './sketchFiles';
  import { SKETCH_AI_ACTIONS, formatReplyText, runSketchAi, type SketchAiAction, type TextBlock } from './sketchAi';
  import { createProposalView, createSketchCodeEditor, type SketchCodeEditor } from './sketchCodeMirror';
  import {
    BUILT_IN_SKETCH_PREFIX,
    announceSketchSaved,
    closeSketchEditor,
    sourceBelongsToItem,
    type SketchEditorTarget,
    type SketchTrayItem,
  } from './sketchEditorStore';

  const { target }: { target: SketchEditorTarget } = $props();

  const PREVIEW_DELAY_MS = 450;
  const ANALYSE_DELAY_MS = 250;
  const RUN_POLL_MS = 1000;
  const LEARNING_KEY = 'ghost-arcade-sketch-learning';
  const SYNTAX_MESSAGE = 'The code cannot be read from here: look for a missing bracket, comma or quote. The layer keeps showing the previous version until it reads again.';

  // ── What is being edited ────────────────────────────────────────────────
  // A tray item (when opened from the tray) and the layers showing it, or a
  // single layer. A shipped sketch is saved as an edited copy, never over
  // the original.
  let item = $state<SketchTrayItem | null>(null);
  let layerIds = $state<string[]>([]);
  let name = $state('Sketch');
  let unavailable = $state('');
  /** Every file of the sketch; the text of the text files is in `texts`. */
  let files = $state<EditorFile[]>([]);
  let texts = $state<Record<string, string>>({});
  let savedTexts = $state<Record<string, string>>({});
  let active = $state('');
  let pushedKey = $state('');
  /** Where this sketch's unsaved edits are kept (sketchDrafts.ts). */
  let draftId = '';
  /** True when the editor opened on edits kept from a session that ended unsaved. */
  let restoredDraft = false;

  function layerSource(layerId: string): MediaSource | null {
    const layer = get(project).layers.find((l) => l.id === layerId);
    return layer?.source?.jsAnimation ? layer.source : null;
  }

  function resolveTarget(): JSAnimationSource | null {
    const layers = get(project).layers;
    if (target.item) {
      item = target.item;
      name = target.item.name;
      draftId = `item:${target.item.id}`;
      layerIds = layers.filter((l) => l.source?.jsAnimation && sourceBelongsToItem(l.source.id, target.item!.id)).map((l) => l.id);
      return target.item.jsAnimation;
    }
    const layer = layers.find((l) => l.id === target.layerId);
    const source = layer?.source;
    if (!layer || !source?.jsAnimation) {
      unavailable = 'This layer does not hold a p5.js sketch any more.';
      return null;
    }
    name = source.name || layer.name;
    draftId = `source:${source.id}`;
    // Copies of a duplicated layer play this same source and take the edits too.
    layerIds = layersPlayingSource(layers, layer.id);
    return source.jsAnimation;
  }

  const textsKey = (t: Record<string, string>) => JSON.stringify(Object.entries(t).sort());

  /**
   * The sketch as it was opened or last saved. Its page is how the editor
   * recognises the sketch's other copies (on other layers, in VJ clips,
   * compositions, presets and the library), which a save updates as well:
   * for a sketch kept as files the page carries a fingerprint of every file.
   */
  let savedSource: JSAnimationSource | null = null;

  {
    const opened = resolveTarget();
    if (opened) {
      const all = editorFiles(opened);
      const editable = all.filter(isTextFile).sort(fileOrder);
      const initial = Object.fromEntries(editable.map((f) => [f.path, f.text ?? '']));
      savedSource = opened;
      files = all;
      // Edits that were never saved (the app closed, or code the editor ran
      // stopped it) come back; the layer keeps the saved code until they run.
      const draft = readSketchDraft(draftId, initial);
      restoredDraft = draft !== null;
      texts = draft ?? initial;
      savedTexts = { ...initial };
      pushedKey = textsKey(initial);
      active = editable[0]?.path ?? '';
    }
  }

  const tabs = $derived(files.filter(isTextFile).sort(fileOrder).map((f) => f.path));
  const assets = $derived(files.filter((f) => !isTextFile(f)).map((f) => f.path));
  const dirtyFiles = $derived(new Set(Object.keys(texts).filter((p) => texts[p] !== savedTexts[p])));
  const dirty = $derived(dirtyFiles.size > 0);
  const where = $derived.by(() => {
    if (layerIds.length === 0) return 'Media tray · not on a layer';
    const layers = $project.layers.filter((l) => layerIds.includes(l.id));
    const names = layers.map((l) => l.name).filter(Boolean);
    return names.length === 1 ? `Layer: ${names[0]}` : `${names.length} layers`;
  });
  const previewLayerId = $derived(layerIds[0] ?? '');
  const previewLayerVisible = $derived($project.layers.find((l) => l.id === previewLayerId)?.visible !== false);
  const isShipped = $derived((item?.id ?? layerSource(previewLayerId)?.id ?? '').startsWith(BUILT_IN_SKETCH_PREFIX));

  /** The files as they are now, with the editor's text. */
  function currentFiles(from: Record<string, string> = texts): EditorFile[] {
    return files.map((f) => (f.path in from ? { ...f, text: from[f.path] } : f));
  }

  // What Ghost Arcade adds to this sketch when it plays (its canvas sizing
  // and controls), read from the wrapper for the code as it is now.
  let wrapping = $state<SketchWrapping | null>(null);
  let wrappingKey = '';
  const runtime = $derived<SketchRuntime>(wrapping?.runtime ?? {});

  function refreshWrapping() {
    const key = textsKey(texts);
    if (!savedSource?.sketch || key === wrappingKey) return;
    wrappingKey = key;
    wrapping = sketchWrapping(sketchWithFiles(savedSource, currentFiles()));
  }

  // ── The code editor ────────────────────────────────────────────────────
  let codeHost = $state<HTMLDivElement>();
  let editor: SketchCodeEditor | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let analyseTimer: ReturnType<typeof setTimeout> | null = null;

  let learning = $state(readLearningSetting());
  let panel = $state<'notes' | 'tips' | 'ai'>('notes');
  let notes = $state<SketchNote[]>([]);
  let reading = $state<SketchLink[]>([]);
  let tips = $state<SketchTip[]>([]);
  let analysed = { path: '', text: '' };
  let syntax = $state<{ file: string; line: number } | null>(null);

  function readLearningSetting(): boolean {
    try {
      return localStorage.getItem(LEARNING_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  function setLearning(on: boolean) {
    learning = on;
    try {
      localStorage.setItem(LEARNING_KEY, on ? 'on' : 'off');
    } catch {
      /* the choice just isn't remembered */
    }
    editor?.setLearning(on);
    analyse();
  }

  function onCodeChange(path: string, next: string) {
    texts[path] = next;
    saveBlocked = null;
    if (analyseTimer) clearTimeout(analyseTimer);
    analyseTimer = setTimeout(analyse, ANALYSE_DELAY_MS);
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(pushPreview, PREVIEW_DELAY_MS);
  }

  /** The first place in any file the parser could not read. */
  function findSyntaxProblem(): { file: string; line: number } | null {
    for (const path of tabs) {
      const language = languageOf(path);
      if (!language) continue;
      const at = firstSyntaxError(readSketchFile(texts[path] ?? '', language));
      if (at !== null) return { file: path, line: lineAt(texts[path], at) };
    }
    return null;
  }

  function analyse() {
    syntax = findSyntaxProblem();
    if (!syntax) refreshWrapping();
    const text = texts[active] ?? '';
    const language = languageOf(active);
    if (learning && language) {
      const annotations = annotateSketch(text, language);
      notes = annotations.notes;
      reading = annotations.reading;
      tips = findSketchTips(text, { language, files: files.map((f) => f.path), runtime });
    } else {
      notes = [];
      reading = [];
      tips = [];
    }
    editor?.setNotes(notes);
    analysed = { path: active, text };
    refreshDiagnostics();
  }

  function openFile(path: string) {
    if (!editor || path === active) return;
    editor.open(path);
    active = path;
    analyse();
  }

  function reveal(file: string | null, line: number | null) {
    if (file && file !== active && tabs.includes(file)) openFile(file);
    if (line !== null && (!file || file === active)) editor?.revealLine(line);
  }

  const noteById = (id: string) => notes.find((n) => n.id === id);
  const openLink = (link: SketchLink) => void openExternalUrl(link.url);

  // ── Live preview on the layer ──────────────────────────────────────────

  /** Put these files on the layers being edited, outside the undo history (Save makes the step). */
  function writeLayers(next: EditorFile[]) {
    for (const layerId of layerIds) {
      const source = layerSource(layerId);
      if (!source?.jsAnimation) continue;
      const jsAnimation = sketchWithFiles(source.jsAnimation, next);
      if (jsAnimation === source.jsAnimation) continue;
      // The page restarts with the new code in the layer's own iframe, so
      // the layer keeps its texture; a page that is not running yet starts
      // with the new code when the layer is next shown.
      restartJSAnimation(source.id, jsAnimation);
      project.setLayerSource(layerId, { ...source, jsAnimation }, { history: false });
    }
  }

  function pushPreview() {
    previewTimer = null;
    // Half-typed code would stop the sketch; the layer keeps the last
    // version that ran until the code reads again.
    const key = textsKey(texts);
    if (findSyntaxProblem() !== null || key === pushedKey) return;
    // Kept first: if this code takes the app down, the typing is not lost.
    keepSketchDraft(draftId, savedTexts, texts);
    writeLayers(currentFiles());
    pushedKey = key;
    run = { status: 'starting', errors: [] };
    refreshDiagnostics();
  }

  // ── Saving, closing ────────────────────────────────────────────────────
  let savedFlash = $state(false);
  let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmClose = $state(false);

  /** Why the sketch cannot be saved yet, from the last Save; cleared as soon as the code changes. */
  let saveBlocked = $state<{ file: string; line: number | null; message: string } | null>(null);

  /** The first code file that would not run, with the reason. */
  function checkBeforeSave(): { file: string; line: number | null; message: string } | null {
    for (const path of tabs) {
      const language = languageOf(path);
      if (!language) continue;
      const problem = saveProblem(texts[path] ?? '', language);
      if (problem) return { file: path, ...problem };
    }
    return null;
  }

  /** True while Save is test-running the code. */
  let checking = $state(false);

  function blockSave(problem: { file: string; line: number | null; message: string }) {
    saveBlocked = problem;
    if (problem.file) reveal(problem.file, problem.line);
    showToast(`Not saved: ${problem.file ? `${problem.file}${problem.line !== null ? `, line ${problem.line}` : ''}: ` : ''}${problem.message}`, 'error');
  }

  /**
   * Save the sketch. The code is checked first: it must compile, then it is
   * run for a moment out of sight, and anything it throws while starting
   * and drawing stops the save. Returns false (saving nothing) on an error.
   */
  async function save(): Promise<boolean> {
    if (checking) return false;
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    const base = savedSource;
    if (!base || !dirty) {
      flashSaved();
      return true;
    }
    const problem = checkBeforeSave();
    if (problem) {
      blockSave(problem);
      return false;
    }
    const key = textsKey(texts);
    keepSketchDraft(draftId, savedTexts, texts);
    checking = true;
    let errors: Awaited<ReturnType<typeof trialRunJSAnimation>> = [];
    try {
      errors = await trialRunJSAnimation(sketchWithFiles(base, currentFiles()));
    } finally {
      checking = false;
    }
    // Typed on while it ran: check what is there now.
    if (textsKey(texts) !== key) return save();
    if (errors.length > 0) {
      const first = errors[0];
      const plain = explainSketchError(first.message);
      // A page holding its sketch inline ran as one page: name the file the error is in.
      const place = errorInFiles(base, currentFiles(), { file: first.file, line: first.line });
      blockSave({
        file: place.file ?? '',
        line: place.line,
        message: `${cleanErrorMessage(first.message)}${plain ? ` ${plain}` : ''}${first.file ? '' : ' (raised inside p5.js by the code)'}`,
      });
      return false;
    }
    saveBlocked = null;
    // Saving a shipped sketch makes an edited copy in the tray and points
    // every copy at it; later saves update the copy.
    const copy = isShipped ? { itemId: `sketch-${generateUUID()}`, name: `${name} (edited)` } : null;
    const next = currentFiles();
    const previousHtml = base.htmlCode;
    const editing = new Set(layerIds.map((id) => layerSource(id)?.id).filter(Boolean));
    const sameSketch = (id: string, js: JSAnimationSource | undefined) => !!js && (editing.has(id) || js.htmlCode === previousHtml);
    const oldName = name;

    // Everywhere the sketch lives: the layers being edited and every other
    // copy that still holds the sketch as it was opened. Each keeps its own
    // control values; the pages playing them restart with the new code.
    // One undo step puts back the layers, compositions and presets; VJ clips
    // are outside the project's undo history.
    project.replaceSketchSources((source) => {
      if (!sameSketch(source.id, source.jsAnimation)) return null;
      const jsAnimation = sketchWithFiles(source.jsAnimation!, next);
      // The layers being edited already play the new code.
      if (jsAnimation === source.jsAnimation && !copy) return null;
      // An edited copy plays under its own id; the page it replaces goes.
      if (copy) disposeJSAnimationContext(source.id);
      else restartJSAnimation(source.id, jsAnimation);
      return {
        ...source,
        ...(copy ? { id: `${copy.itemId}-${source.id}`, name: source.name === oldName ? copy.name : source.name } : {}),
        jsAnimation,
      };
    }, { history: false });
    vjClipLauncher.replaceClipSketches((clip) => {
      if (!clip.jsAnimation || clip.jsAnimation.htmlCode !== previousHtml) return null;
      const jsAnimation = sketchWithFiles(clip.jsAnimation, next);
      // The clip keeps its iframe; the page in it restarts with the new code.
      restartJSAnimation(clip.id, jsAnimation);
      return {
        ...clip,
        ...(copy && clip.name === oldName ? { name: copy.name } : {}),
        jsAnimation,
      };
    });
    recordDiscreteAction();
    pushedKey = textsKey(texts);

    const jsAnimation = sketchWithFiles(base, next);
    // The saved library keeps pages by their code.
    for (const saved of get(shaderLibrary).shaders) {
      if (saved.code === previousHtml) shaderLibrary.updateShader(saved.id, { code: jsAnimation.htmlCode });
    }
    void keepInSketchLibrary(
      copy ? null : item?.id ?? null,
      previousHtml,
      next,
      copy ? { id: copy.itemId, name: copy.name, jsAnimation, addedAt: Date.now() } : null,
    );
    announceSketchSaved({
      itemId: copy ? null : item?.id ?? null,
      sourceIds: layerIds.map((id) => layerSource(id)?.id ?? '').filter(Boolean),
      previousHtml,
      newItem: copy ? { id: copy.itemId, name: copy.name } : undefined,
      files: next,
      jsAnimation,
    });
    if (copy) {
      name = copy.name;
      item = { id: copy.itemId, name: copy.name, jsAnimation };
    } else if (item) {
      item = { ...item, jsAnimation };
    }
    savedSource = jsAnimation;
    savedTexts = { ...texts };
    dropSketchDraft(draftId);
    flashSaved();
    return true;
  }

  /**
   * Sketches the media tray keeps between sessions hold the saved code too,
   * so the next launch brings back the edit, whether or not the tray is open.
   * An edited copy of a shipped sketch joins them.
   */
  async function keepInSketchLibrary(itemId: string | null, previousHtml: string, next: EditorFile[], copy: StoredSketch | null) {
    if (copy) {
      await saveSketch(copy);
      return;
    }
    for (const stored of await loadSketches()) {
      if (stored.id !== itemId && stored.jsAnimation.htmlCode !== previousHtml) continue;
      await updateSketch(stored.id, { jsAnimation: sketchWithFiles(stored.jsAnimation, next) });
    }
  }

  function flashSaved() {
    savedFlash = true;
    if (savedFlashTimer) clearTimeout(savedFlashTimer);
    savedFlashTimer = setTimeout(() => (savedFlash = false), 1600);
  }

  function requestClose() {
    if (proposal) {
      closeProposal();
      return;
    }
    if (dirty) {
      confirmClose = true;
      return;
    }
    closeSketchEditor();
  }

  function discardAndClose() {
    // The layers go back to the last saved files, outside the undo history:
    // the unsaved edits were never steps of their own.
    writeLayers(currentFiles(savedTexts));
    dropSketchDraft(draftId);
    closeSketchEditor();
  }

  async function saveAndClose() {
    // With an error in the code, stay open on it instead of closing unsaved.
    if (!(await save())) {
      confirmClose = false;
      return;
    }
    closeSketchEditor();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    if (confirmClose) confirmClose = false;
    else requestClose();
  }

  // ── Showing it on a layer when it is on none ───────────────────────────
  const selectedMediaLayer = $derived.by(() => {
    const layer = $project.layers.find((l) => l.id === $selectedLayerId);
    return layer && layer.type === 'media' ? layer : null;
  });

  function showOnSelectedLayer() {
    const layer = selectedMediaLayer;
    if (!layer || !item) return;
    const jsAnimation = sketchWithFiles(item.jsAnimation, currentFiles());
    project.setLayerSource(layer.id, {
      id: `${item.id}-${layer.id}-${Date.now()}`,
      type: jsAnimation.animationType,
      src: 'js-animation',
      name,
      jsAnimation,
    });
    layerIds = [layer.id];
    pushedKey = textsKey(texts);
  }

  // ── The live picture and errors ────────────────────────────────────────
  let previewCanvas = $state<HTMLCanvasElement>();
  let previewShown = $state(false);
  let run = $state<{ status: SketchRunStatus; errors: SketchError[] }>({ status: 'starting', errors: [] });
  let frame = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function previewLoop() {
    frame = requestAnimationFrame(previewLoop);
    if (!previewCanvas) return;
    const shown = drawPreview(previewCanvas);
    if (shown !== previewShown) previewShown = shown;
  }

  /** Copies the picture the layer's page draws into the preview, fitted to it. */
  function drawPreview(target: HTMLCanvasElement): boolean {
    if (!previewLayerVisible) return false;
    const id = layerSource(previewLayerId)?.id;
    const picture = id ? getJSAnimationContext(id)?.canvas : undefined;
    if (!picture || picture.width <= 1 || picture.height <= 1) return false;
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(target.clientWidth * scale));
    const height = Math.max(1, Math.round(target.clientHeight * scale));
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const g = target.getContext('2d');
    if (!g) return false;
    const fit = Math.min(width / picture.width, height / picture.height);
    const w = picture.width * fit;
    const h = picture.height * fit;
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, height);
    try {
      g.drawImage(picture, (width - w) / 2, (height - h) / 2, w, h);
    } catch {
      return false;
    }
    return true;
  }

  function pollRun() {
    const source = layerSource(previewLayerId);
    if (!source) {
      run = { status: 'stopped', errors: [] };
      return;
    }
    const next = readSketchRun(source.id, source.jsAnimation?.htmlCode ?? '');
    const changed = JSON.stringify(next.errors) !== JSON.stringify(run.errors);
    run = next;
    // Re-marking the code closes any open hover card, so only when it changed.
    if (changed) refreshDiagnostics();
  }

  // Errors belong to the files the layer runs. While the editor holds other
  // code (typing, or a syntax problem holding the layer back) they would
  // point at the wrong lines, so they wait.
  const pageErrors = $derived(textsKey(texts) === pushedKey
    ? run.errors.map((e) => {
        const place = savedSource ? errorInFiles(savedSource, currentFiles(), { file: e.file ?? null, line: e.line }) : e;
        return { ...e, ...place, text: cleanErrorMessage(e.message), plain: explainSketchError(e.message) };
      })
    : []);

  const status = $derived.by((): { tone: 'ok' | 'warn' | 'error' | 'idle'; label: string } => {
    if (layerIds.length === 0) return { tone: 'idle', label: 'Not on a layer' };
    if (syntax) return { tone: 'warn', label: `Syntax problem: ${syntax.file}, line ${syntax.line}` };
    if (!previewLayerVisible) return { tone: 'idle', label: 'Layer hidden' };
    if (pageErrors.length > 0) return { tone: 'error', label: `${pageErrors.length} error${pageErrors.length === 1 ? '' : 's'}` };
    if (run.status === 'starting') return { tone: 'idle', label: 'Updating…' };
    if (run.status === 'stopped') return { tone: 'idle', label: 'Not running' };
    return { tone: 'ok', label: 'Live' };
  });

  // Errors, the syntax problem and (in learning mode) tips, marked in the open file.
  function refreshDiagnostics() {
    if (!editor) return;
    const doc = editor.view.state.doc;
    const lineRange = (n: number) => doc.line(Math.max(1, Math.min(n, doc.lines)));
    const diagnostics: Diagnostic[] = [];
    if (syntax && syntax.file === active) {
      const line = lineRange(syntax.line);
      diagnostics.push({ from: line.from, to: line.to, severity: 'error', source: 'syntax', message: SYNTAX_MESSAGE });
    }
    for (const error of pageErrors) {
      if (error.file !== active || error.line === null) continue;
      const line = lineRange(error.line);
      diagnostics.push({ from: line.from, to: line.to, severity: 'error', source: 'sketch', message: error.plain ? `${error.text}\n${error.plain}` : error.text });
    }
    if (learning && analysed.path === active && analysed.text === doc.toString()) {
      for (const tip of tips) {
        for (const range of tip.ranges.slice(0, 12)) {
          diagnostics.push({
            from: range.from,
            to: Math.max(range.from + 1, range.to),
            severity: tip.severity === 'warning' ? 'warning' : tip.severity === 'suggestion' ? 'info' : 'hint',
            source: 'Ghost Arcade tip',
            message: `${tip.title}. ${tip.body}`,
            actions: tip.fixes.map((fix) => ({ name: fix.label, apply: () => applyFix(fix.id) })),
          });
        }
      }
    }
    editor.setDiagnostics(diagnostics);
  }

  function applyFix(fixId: string) {
    if (!editor) return;
    const current = editor.text(active);
    const language = languageOf(active);
    if (!language) return;
    const fresh = analysed.path === active && current === analysed.text
      ? tips
      : findSketchTips(current, { language, files: files.map((f) => f.path), runtime });
    const fix = fresh.flatMap((t) => t.fixes).find((f) => f.id === fixId);
    if (!fix) return;
    editor.view.dispatch({ changes: fix.changes, userEvent: 'input.fix' });
    editor.view.focus();
  }

  function showRange(range: { from: number; to: number } | undefined) {
    if (range) editor?.reveal(range.from, range.to);
  }

  // ── AI actions ─────────────────────────────────────────────────────────
  const aiProvider = $derived($settings.ai.shaderProvider);
  const aiKey = $derived(aiProvider === 'claude' ? $settings.ai.claudeApiKey : $settings.ai.geminiApiKey);
  const aiModel = $derived(aiProvider === 'claude' ? $settings.ai.claudeModel : $settings.ai.geminiModel);
  let aiBusy = $state<SketchAiAction | null>(null);
  let aiAnswer = $state<{ action: SketchAiAction; path: string; blocks: TextBlock[] } | null>(null);
  let aiError = $state('');
  let aiNeedsKey = $state(false);
  let aiRun = 0;

  async function runAi(action: SketchAiAction) {
    aiError = '';
    aiNeedsKey = false;
    if (!aiKey) {
      aiNeedsKey = true;
      return;
    }
    const path = active;
    const request = { files: tabs.map((p) => ({ path: p, text: texts[p] ?? '' })), path, runtime };
    const ticket = ++aiRun;
    aiBusy = action;
    const result = await runSketchAi(action, request, { provider: aiProvider, apiKey: aiKey, model: aiModel });
    if (ticket !== aiRun) return;
    aiBusy = null;
    if (result.kind === 'error') aiError = result.message;
    else if (result.kind === 'text') aiAnswer = { action, path, blocks: formatReplyText(result.text) };
    else openProposal(action, path, texts[path] ?? '', result.code, result.warning);
  }

  function cancelAi() {
    aiRun++;
    aiBusy = null;
  }

  function openAiSettings() {
    window.location.hash = '#ai';
    window.dispatchEvent(new CustomEvent('open-settings'));
  }

  // ── Proposed changes ───────────────────────────────────────────────────
  let proposal = $state<{ action: SketchAiAction; path: string; warning: string | null } | null>(null);
  let proposalHost = $state<HTMLDivElement>();
  let proposalView: EditorView | null = null;

  async function openProposal(action: SketchAiAction, path: string, original: string, proposed: string, warning: string | null) {
    proposal = { action, path, warning };
    await tick();
    proposalView?.destroy();
    if (proposalHost) proposalView = createProposalView(proposalHost, path, original, proposed);
  }

  function keepProposal() {
    if (proposalView && editor && proposal) {
      openFile(proposal.path);
      editor.replaceAll(proposalView.state.doc.toString());
    }
    closeProposal();
  }

  function closeProposal() {
    proposalView?.destroy();
    proposalView = null;
    proposal = null;
    editor?.view.focus();
  }

  const actionLabel = (id: SketchAiAction) => SKETCH_AI_ACTIONS.find((a) => a.id === id)?.label ?? '';

  // ── Lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    if (!codeHost || unavailable) return;
    editor = createSketchCodeEditor(codeHost, tabs.map((path) => ({ path, text: texts[path] ?? '' })), active, {
      onChange: onCodeChange,
      onSave: save,
      noteById,
      openLink,
    });
    editor.setLearning(learning);
    analyse();
    editor.view.focus();
    frame = requestAnimationFrame(previewLoop);
    pollRun();
    pollTimer = setInterval(pollRun, RUN_POLL_MS);
    if (restoredDraft) showToast('Your unsaved edits to this sketch are back. Save to keep them.', 'info');
    const root = document.documentElement;
    root.addEventListener('keydown', keyGate);
    root.addEventListener('keyup', keyGate);
    return () => {
      root.removeEventListener('keydown', keyGate);
      root.removeEventListener('keyup', keyGate);
    };
  });

  /**
   * Keys that reach the page outside the editor's own controls stop here, so
   * Backspace cannot delete the layer being edited and Ctrl+Z cannot roll the
   * project back underneath. B, the blackout, still works while not typing:
   * it is the one shortcut a live show must never lose.
   */
  function keyGate(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.type !== 'keydown' || event.defaultPrevented || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== 'b' && event.key !== 'B')) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toUpperCase() ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    event.preventDefault();
    const blackout = !get(settings).output.blackout;
    settings.update((s) => ({ ...s, output: { ...s.output, blackout } }));
    showToast(blackout ? 'Output blacked out. Press B to bring it back.' : 'Blackout ended.', 'warning');
  }

  onDestroy(() => {
    // Closed with nothing unsaved: no edits to bring back.
    if (!dirty) dropSketchDraft(draftId);
    cancelAnimationFrame(frame);
    if (pollTimer) clearInterval(pollTimer);
    if (previewTimer) clearTimeout(previewTimer);
    if (analyseTimer) clearTimeout(analyseTimer);
    if (savedFlashTimer) clearTimeout(savedFlashTimer);
    proposalView?.destroy();
    editor?.destroy();
  });

  const tipCount = $derived(tips.length);
  const severityLabel = { warning: 'Fix for shows', suggestion: 'Suggestion', info: 'Good to know' } as const;
</script>

<div class="sketch-backdrop" role="presentation" onkeydown={onKeydown}>
  <div class="sketch-editor" role="dialog" aria-modal="true" aria-label="Sketch editor">
    <header class="top">
      <div class="title">
        <span class="kind">p5.js</span>
        <h2>{name}</h2>
        <span class="where">{where}</span>
        <span class="status {status.tone}">{status.label}</span>
      </div>
      {#if confirmClose}
        <div class="actions" role="alert">
          <span class="confirm-text">
            <strong>Save before closing?</strong>
            {layerIds.length ? 'Discarding puts the layer back to the last saved version.' : 'These edits are not saved anywhere yet.'}
          </span>
          <button class="primary" onclick={saveAndClose}>Save and close</button>
          <button class="ghost" onclick={discardAndClose}>Discard edits</button>
          <button class="ghost" onclick={() => (confirmClose = false)}>Keep editing</button>
        </div>
      {:else}
        <div class="actions">
          <button class="ghost" onclick={() => editor && undo(editor.view)} title="Undo (Ctrl+Z)" disabled={!!proposal}>Undo</button>
          <button class="ghost" onclick={() => editor && redo(editor.view)} title="Redo (Ctrl+Shift+Z)" disabled={!!proposal}>Redo</button>
          <label class="learning-toggle" title="Explain the code, show Ghost Arcade tips and AI help">
            <input type="checkbox" checked={learning} onchange={(e) => setLearning((e.target as HTMLInputElement).checked)} />
            <span>Learning mode</span>
          </label>
          <span class="save-state" class:unsaved={dirty} aria-live="polite">{savedFlash ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>
          <button class="primary" onclick={() => save()} disabled={!!proposal || checking} title="Save to the layer and the media tray (Ctrl+S). The code is checked and test-run first.">{checking ? 'Checking…' : 'Save'}</button>
          <button class="ghost" onclick={requestClose} title="Close (Esc)">Close</button>
        </div>
      {/if}
    </header>

    {#if unavailable}
      <div class="unavailable">
        <p>{unavailable}</p>
        <button class="primary" onclick={closeSketchEditor}>Close</button>
      </div>
    {:else}
      <div class="body" class:learning>
        <div class="code-column">
          <div class="files" role="tablist" aria-label="Sketch files">
            {#each tabs as path (path)}
              <button role="tab" class="file" class:active={path === active} aria-selected={path === active} onclick={() => openFile(path)}>
                {path}{#if dirtyFiles.has(path)}<span class="unsaved-dot" title="Unsaved changes">•</span>{/if}
              </button>
            {/each}
            {#if assets.length}
              <span class="assets" title={assets.join(', ')}>+ {assets.length} file{assets.length === 1 ? '' : 's'}</span>
            {/if}
          </div>
          <div class="code" bind:this={codeHost}></div>
          {#if proposal}
            <div class="proposal">
              <div class="proposal-head">
                <div>
                  <strong>{actionLabel(proposal.action)}: proposed changes to {proposal.path}</strong>
                  <span>Accept or reject each change, then keep what is left. Undo takes it back afterwards.</span>
                  {#if proposal.warning}<span class="warning">{proposal.warning}</span>{/if}
                </div>
                <div class="proposal-actions">
                  <button class="primary" onclick={keepProposal}>Keep changes</button>
                  <button class="ghost" onclick={closeProposal}>Discard</button>
                </div>
              </div>
              <div class="proposal-code" bind:this={proposalHost}></div>
            </div>
          {/if}
        </div>

        <aside class="side">
          <div class="preview">
            <canvas bind:this={previewCanvas} class:shown={previewShown && layerIds.length > 0 && previewLayerVisible}></canvas>
            {#if layerIds.length === 0}
              <div class="preview-note">
                <p>This sketch is not on a layer yet, so edits have nowhere to show.</p>
                {#if selectedMediaLayer && item}
                  <button class="primary" onclick={showOnSelectedLayer}>Show it on “{selectedMediaLayer.name}”</button>
                {:else}
                  <p class="dim">Select a media layer to show it there.</p>
                {/if}
              </div>
            {:else if !previewLayerVisible}
              <div class="preview-note"><p>The layer is hidden, so the sketch is not running. Show the layer to see edits live.</p></div>
            {:else if !previewShown}
              <div class="preview-note dim"><p>Waiting for the layer’s picture…</p></div>
            {/if}
          </div>

          {#if saveBlocked || syntax || pageErrors.length > 0}
            <div class="problems" role="status">
              {#if saveBlocked}
                <button class="problem error" onclick={() => saveBlocked && reveal(saveBlocked.file, saveBlocked.line)}>
                  <span class="problem-line">Not saved{saveBlocked.file ? ` · ${saveBlocked.file}${saveBlocked.line !== null ? `, line ${saveBlocked.line}` : ''}` : ''}</span>
                  <span class="problem-text">{saveBlocked.message}</span>
                  <span class="problem-plain">Fix this and save again. The layer keeps playing the last version that worked.</span>
                </button>
              {/if}
              {#if syntax}
                <button class="problem" onclick={() => syntax && reveal(syntax.file, syntax.line)}>
                  <span class="problem-line">{syntax.file}, line {syntax.line}</span>
                  <span class="problem-plain">{SYNTAX_MESSAGE}</span>
                </button>
              {/if}
              {#each pageErrors as error (error.message + error.file + error.line)}
                <button class="problem error" onclick={() => reveal(error.file, error.line)} disabled={error.file === null && error.line === null}>
                  <span class="problem-line">{error.file ? `${error.file}${error.line !== null ? `, line ${error.line}` : ''}` : 'Inside p5.js'}{error.count > 1 ? ` · ×${error.count}` : ''}</span>
                  <span class="problem-text">{error.text}</span>
                  {#if error.plain}<span class="problem-plain">{error.plain}</span>{/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if learning}
            <div class="tabs" role="tablist">
              <button role="tab" aria-selected={panel === 'notes'} class:active={panel === 'notes'} onclick={() => (panel = 'notes')}>Explain</button>
              <button role="tab" aria-selected={panel === 'tips'} class:active={panel === 'tips'} onclick={() => (panel = 'tips')}>
                Tips{#if tipCount > 0}<span class="count">{tipCount}</span>{/if}
              </button>
              <button role="tab" aria-selected={panel === 'ai'} class:active={panel === 'ai'} onclick={() => (panel = 'ai')}>Ask AI</button>
            </div>

            <div class="panel">
              {#if panel === 'notes'}
                {#if notes.length === 0}
                  <p class="dim">{languageOf(active) ? 'Nothing to explain yet: write some p5.js and the ideas it uses appear here.' : `Explanations cover the sketch's code; ${active} has none.`}</p>
                {:else}
                  <p class="intro">What {active} is made of, in the order it appears. Underlined words in the code explain themselves when you point at them.</p>
                  {#if wrapping}
                    <section class="wrapping">
                      <h3>How Ghost Arcade plays it</h3>
                      <ul>
                        {#if wrapping.runtime.canvas}<li>{canvasSentence(wrapping.runtime.canvas)}</li>{/if}
                        {#if wrapping.controls.length}
                          <li>{wrapping.controls.join(', ')} {wrapping.controls.length === 1 ? 'becomes a control' : 'become controls'} on the layer: values set at the top of the sketch, to change while it plays.</li>
                        {/if}
                        {#each wrapping.notes as note (note)}<li>{note}</li>{/each}
                      </ul>
                      <p class="dim small">None of this is written into the code: it stays the sketch you would run in the p5.js editor.</p>
                    </section>
                  {/if}
                  {#each notes as note (note.id)}
                    <details class="note">
                      <summary onclick={() => showRange(note.ranges[0])}>
                        <span class="note-title">{note.title}</span>
                        <span class="note-line">line {note.line}{note.ranges.length > 1 ? ` · ${note.ranges.length}×` : ''}</span>
                      </summary>
                      <p>{note.body}</p>
                      {#if note.links.length}
                        <ul class="links">
                          {#each note.links as link (link.url)}
                            <li><a href={link.url} onclick={(e) => { e.preventDefault(); openLink(link); }}>{link.label}</a></li>
                          {/each}
                        </ul>
                      {/if}
                    </details>
                  {/each}
                  <div class="reading">
                    <span>Keep learning</span>
                    <ul class="links">
                      {#each [...reading, ...GETTING_STARTED] as link (link.url)}
                        <li><a href={link.url} onclick={(e) => { e.preventDefault(); openLink(link); }}>{link.label}</a></li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              {:else if panel === 'tips'}
                {#if tips.length === 0}
                  <p class="dim">No Ghost Arcade tips for {active}: it already suits a show.</p>
                {:else}
                  <p class="intro">What helps {active} at a show. Fixes edit your own code in plain p5.js, so it still runs in the p5.js editor, and Undo takes any of them back. Wavy underlines in the code mark the same places.</p>
                  {#each tips as tip (tip.id)}
                    <article class="tip">
                      <header>
                        <span class="tip-kind {tip.severity}">{severityLabel[tip.severity]}</span>
                        <button class="tip-line" onclick={() => showRange(tip.ranges[0])}>line {tip.line}</button>
                      </header>
                      <h3>{tip.title}</h3>
                      <p>{tip.body}</p>
                      {#if tip.fixes.length}
                        <div class="fixes">
                          {#each tip.fixes as fix (fix.id)}
                            <button class="fix" onclick={() => applyFix(fix.id)}>{fix.label}</button>
                          {/each}
                        </div>
                      {/if}
                      {#if tip.links.length}
                        <ul class="links">
                          {#each tip.links as link (link.url)}
                            <li><a href={link.url} onclick={(e) => { e.preventDefault(); openLink(link); }}>{link.label}</a></li>
                          {/each}
                        </ul>
                      {/if}
                    </article>
                  {/each}
                {/if}
              {:else}
                <div class="ai-actions">
                  {#each SKETCH_AI_ACTIONS as action (action.id)}
                    <button class="ai-action" onclick={() => runAi(action.id)} disabled={aiBusy !== null}>
                      <span class="ai-label">{action.label}{aiBusy === action.id ? '…' : ''}</span>
                      <span class="ai-hint">{action.hint}</span>
                    </button>
                  {/each}
                </div>
                {#if aiBusy}
                  <div class="ai-status"><span class="spinner" aria-hidden="true"></span> Asking the AI… <button class="link" onclick={cancelAi}>Stop waiting</button></div>
                {/if}
                {#if aiNeedsKey || !aiKey}
                  <div class="ai-key" class:emphasis={aiNeedsKey}>
                    <p>Explanations and ideas cover the open file; proposed changes are made to it, as a diff to review. These use your own API key for the AI provider chosen in Settings, the same one the AI generator uses. Add it in Settings → AI. Everything else in learning mode works without one.</p>
                    <button class="ghost" onclick={openAiSettings}>Open Settings → AI</button>
                  </div>
                {/if}
                {#if aiError}<p class="ai-error">{aiError}</p>{/if}
                {#if aiAnswer}
                  <div class="ai-answer">
                    <div class="ai-answer-head">
                      <strong>{actionLabel(aiAnswer.action)} · {aiAnswer.path}</strong>
                      <button class="link" onclick={() => (aiAnswer = null)}>Clear</button>
                    </div>
                    {#each aiAnswer.blocks as block, i (i)}
                      {#if block.kind === 'p'}
                        <p>{#each block.parts as part, j (j)}{#if part.kind === 'code'}<code>{part.text}</code>{:else if part.kind === 'line'}<button class="line-ref" onclick={() => aiAnswer && reveal(aiAnswer.path, part.line)}>{part.text}</button>{:else}{part.text}{/if}{/each}</p>
                      {:else}
                        <ul>
                          {#each block.items as parts, j (j)}
                            <li>{#each parts as part, k (k)}{#if part.kind === 'code'}<code>{part.text}</code>{:else if part.kind === 'line'}<button class="line-ref" onclick={() => aiAnswer && reveal(aiAnswer.path, part.line)}>{part.text}</button>{:else}{part.text}{/if}{/each}</li>
                          {/each}
                        </ul>
                      {/if}
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {:else}
            <p class="dim learning-off">Turn on learning mode for explanations of the code, Ghost Arcade tips and AI help.</p>
          {/if}
        </aside>
      </div>
    {/if}

  </div>
</div>

<style>
  .sketch-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.72);
    display: grid;
    place-items: center;
    padding: 20px;
  }

  .sketch-editor {
    --accent: var(--accent-primary, #ff725f);
    --link: var(--accent-secondary, #ff9a84);
    --rule: rgba(255, 255, 255, 0.07);
    position: relative;
    width: min(1480px, 97vw);
    height: min(920px, 94vh);
    display: flex;
    flex-direction: column;
    background: var(--bg-primary, #0a0a0c);
    color: var(--text-primary, #e8e8e8);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    font-size: 13px;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: #0f0f13;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .title h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kind {
    color: var(--text-muted, #666);
    font-weight: 600;
  }

  .where {
    color: var(--text-secondary, #a0a0a0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    font-size: 12px;
    white-space: nowrap;
    color: var(--text-secondary, #a0a0a0);
  }

  .status.ok { color: var(--success, #2ed573); }
  .status.warn { color: var(--warning, #ffa502); }
  .status.error { color: #ff6b78; }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .primary {
    background: var(--accent-primary, #ff725f);
    color: #140a08;
    border: none;
    border-radius: 5px;
    padding: 6px 14px;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) { background: var(--accent-hover, #ff5f4c); }

  .ghost {
    background: transparent;
    color: var(--text-primary, #e8e8e8);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 5px;
    padding: 5px 11px;
  }

  .ghost:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }

  .link {
    background: none;
    border: none;
    color: var(--link);
    padding: 0;
  }

  .learning-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    color: var(--text-primary, #e8e8e8);
    cursor: pointer;
    user-select: none;
  }

  .confirm-text {
    color: var(--text-secondary, #a0a0a0);
    margin-right: 4px;
  }

  .confirm-text strong { color: var(--text-primary, #e8e8e8); margin-right: 4px; }

  .learning-toggle input { accent-color: var(--accent); margin: 0; }

  .save-state {
    min-width: 104px;
    text-align: right;
    color: #2ed573;
    font-size: 12px;
  }

  .save-state.unsaved { color: var(--warning, #ffa502); }

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
  }

  .body.learning { grid-template-columns: minmax(0, 1fr) 420px; }

  .code-column {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .files {
    display: flex;
    align-items: stretch;
    gap: 1px;
    padding: 0 8px;
    background: #0a0a0c;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    overflow-x: auto;
    flex-shrink: 0;
  }

  .file {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary, #a0a0a0);
    padding: 8px 12px 6px;
    font-size: 12.5px;
    white-space: nowrap;
  }

  .file:hover { color: var(--text-primary, #e8e8e8); }

  .file.active {
    color: var(--text-primary, #e8e8e8);
    border-bottom-color: var(--accent);
  }

  .unsaved-dot {
    color: var(--warning, #ffa502);
    margin-left: 4px;
  }

  .assets {
    align-self: center;
    margin-left: 8px;
    color: var(--text-muted, #666);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .code {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .code :global(.cm-editor) { position: absolute; inset: 0; }
  .code :global(.cm-editor.cm-focused) { outline: none; }

  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.07);
    background: #0d0d11;
  }

  .preview {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #000;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    flex-shrink: 0;
  }

  .preview canvas {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .preview canvas.shown { opacity: 1; }

  .preview-note {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    text-align: center;
    color: var(--text-secondary, #a0a0a0);
  }

  .preview-note p { margin: 0; }

  .problems {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--rule);
    max-height: 32%;
    overflow: auto;
    flex-shrink: 0;
  }

  .problem {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule);
    padding: 8px 14px;
    color: inherit;
  }

  .problem:last-child { border-bottom: none; }
  .problem:hover:not(:disabled) { background: rgba(255, 255, 255, 0.03); }

  .problem .problem-line { color: var(--warning, #ffa502); }
  .problem.error .problem-line { color: #ff6b78; }

  .problem:disabled { opacity: 1; }

  .problem-line {
    font-size: 12px;
    font-weight: 600;
  }

  .problem-text {
    font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    word-break: break-word;
  }

  .problem-plain { color: #d7d7de; line-height: 1.45; }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 10px 0;
    flex-shrink: 0;
  }

  .tabs button {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary, #a0a0a0);
    padding: 7px 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .tabs button.active {
    color: var(--text-primary, #e8e8e8);
    border-bottom-color: var(--accent);
  }

  .count {
    color: var(--text-secondary, #a0a0a0);
    font-size: 12px;
  }

  .panel {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px 14px 16px;
    line-height: 1.5;
  }

  .intro, .dim { color: var(--text-secondary, #a0a0a0); }
  .small { font-size: 12px; }
  .learning-off { padding: 14px; }

  .note {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding: 6px 0;
  }

  .wrapping {
    padding-bottom: 10px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--rule);
  }

  .wrapping h3 {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 600;
  }

  .wrapping p { margin: 0; }

  .wrapping ul {
    margin: 4px 0 6px;
    padding-left: 18px;
    color: #cfcfd6;
  }

  .note summary {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    list-style: none;
    /* The app styles <summary> as a small-caps section label; these are not. */
    text-transform: none;
    letter-spacing: normal;
    font-size: 13px;
    color: var(--text-primary, #e8e8e8);
  }

  .note summary::-webkit-details-marker { display: none; }

  .note summary::before {
    content: '›';
    color: var(--text-muted, #666);
    width: 10px;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .note[open] summary::before { transform: rotate(90deg); }

  .note-title { flex: 1; font-weight: 500; }
  .note-line { color: var(--text-muted, #666); font-size: 11.5px; white-space: nowrap; }
  .note p { margin: 6px 0 4px 18px; color: #cfcfd6; }

  .links {
    list-style: none;
    margin: 4px 0 2px 18px;
    padding: 0;
  }

  .links a {
    color: var(--link);
    text-decoration: none;
    font-size: 12px;
  }

  .links a:hover { text-decoration: underline; }

  .reading {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
  }

  .reading > span { font-weight: 600; }
  .reading .links { margin-left: 0; }

  .tip {
    padding: 10px 0 12px;
    border-bottom: 1px solid var(--rule);
  }

  .tip:last-child { border-bottom: none; }

  .tip header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tip-kind {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #a0a0a0);
  }

  .tip-kind.warning { color: var(--warning, #ffa502); }
  .tip-kind.suggestion { color: var(--success, #2ed573); }

  .tip-line {
    background: none;
    border: none;
    color: var(--link);
    font-size: 12px;
    padding: 0;
  }

  .tip h3 {
    margin: 4px 0;
    font-size: 13.5px;
    font-weight: 600;
  }

  .tip p { margin: 0 0 8px; color: #cfcfd6; }
  .tip .links { margin-left: 0; }

  .fixes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
  }

  .fix {
    background: rgba(255, 114, 95, 0.14);
    border: 1px solid rgba(255, 114, 95, 0.45);
    color: #ffb4a8;
    border-radius: 5px;
    padding: 4px 10px;
  }

  .fix:hover { background: rgba(255, 114, 95, 0.24); }

  .ai-actions {
    display: flex;
    flex-direction: column;
    margin: 0 -14px;
  }

  .ai-action {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule);
    padding: 9px 14px;
    color: inherit;
  }

  .ai-action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.04); }
  .ai-label { font-weight: 600; }
  .ai-hint { color: var(--text-secondary, #a0a0a0); font-size: 12px; }

  .ai-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 0;
    color: var(--text-secondary, #a0a0a0);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .ai-key { margin-top: 14px; }

  .ai-key p { margin: 0 0 8px; color: var(--text-secondary, #a0a0a0); }
  .ai-key.emphasis p { color: var(--text-primary, #e8e8e8); }

  .ai-error {
    margin-top: 12px;
    color: #ff6b78;
  }

  .ai-answer {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
  }

  .ai-answer-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .ai-answer p, .ai-answer li { color: #d7d7de; }
  .ai-answer p { margin: 0 0 9px; }
  .ai-answer ul { padding-left: 18px; }
  .ai-answer li { margin-bottom: 6px; }

  .ai-answer code {
    font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 3px;
    padding: 0 4px;
  }

  .line-ref {
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    text-decoration: underline dotted;
  }

  .proposal {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #0d0d10;
    z-index: 2;
  }

  .proposal-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 14px;
    background: var(--bg-tertiary, #141418);
    border-bottom: 1px solid var(--rule);
  }

  .proposal-head > div:first-child {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .proposal-head span { color: var(--text-secondary, #a0a0a0); }
  .proposal-head .warning { color: #ffa502; }

  .proposal-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .proposal-code {
    flex: 1;
    min-height: 0;
  }

  .proposal-code :global(.cm-editor) { height: 100%; }

  .unavailable {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
</style>
