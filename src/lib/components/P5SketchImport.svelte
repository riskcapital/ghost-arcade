<script lang="ts">
  // Import a p5.js sketch: browse a p5.js Web Editor user's public sketches,
  // paste a link to one, or drop the sketch itself (the zip from the editor's
  // File → Download, its folder, or its files). The sketch is kept exactly as
  // written; each is reviewed before it is added: whether it can run, how its
  // canvas meets the output, and a preview of the page as it will play.
  import { isDesktopApp, openExternalUrl } from '$lib/bridge';
  import { captureJSAnimationThumbnail } from '$lib/renderer/js-animation';
  import type { P5CanvasMode } from '$lib/p5sketch/wrapSketch';
  import type { P5Sketch } from '$lib/p5sketch/files';
  import { fetchEditorSketch, listEditorSketches, summaryP5Version, type P5SketchSummary } from '$lib/p5import/editorClient';
  import { parseEditorInput } from '$lib/p5import/editorLinks';
  import { importSketch, type ImportedSketch } from '$lib/p5import/importSketch';
  import { localFilesFromList, looksLikeSketch, sketchFromLocalFiles, takeDroppedFiles, type LocalFile } from '$lib/p5import/localFiles';
  import { sketchFromZip } from '$lib/p5import/zip';

  let {
    onImport,
    onClose,
  }: {
    onImport: (imported: ImportedSketch) => void;
    onClose: () => void;
  } = $props();

  const USERNAME_KEY = 'ga.p5ImportUsername';
  const LIST_LIMIT = 150;
  const MAX_ZIP_BYTES = 200 * 1024 * 1024;

  function storedUsername(): string {
    try { return window.localStorage?.getItem(USERNAME_KEY) ?? ''; } catch { return ''; }
  }

  let query = $state(storedUsername());
  let busy = $state<null | 'list' | 'sketch' | 'zip'>(null);
  let busySketchId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let account = $state.raw<{ username: string; sketches: P5SketchSummary[] } | null>(null);
  let filter = $state('');
  let sketch = $state.raw<P5Sketch | null>(null);
  let imported = $state.raw<ImportedSketch | null>(null);
  let previewUrl = $state<string | null>(null);
  let previewLoading = $state(false);
  let lastAdded = $state<string | null>(null);
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let previewToken = 0;

  const matching = $derived.by(() => {
    if (!account) return [];
    const needle = filter.trim().toLowerCase();
    return needle ? account.sketches.filter((s) => s.name.toLowerCase().includes(needle)) : account.sketches;
  });
  const visible = $derived(matching.slice(0, LIST_LIMIT));
  const blocked = $derived(imported?.wrapped.compatibility.level === 'blocked');
  const controlLabels = $derived(imported?.source.params?.map((p) => p.label ?? p.name) ?? []);
  const fitLabel = $derived(
    imported?.wrapped.canvas.size.kind === 'fixed'
      ? `Keep ${imported.wrapped.canvas.size.width} × ${imported.wrapped.canvas.size.height}, scaled to fit`
      : 'Keep its own size, scaled to fit',
  );

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }

  async function find() {
    const target = parseEditorInput(query);
    if (target.kind === 'invalid') {
      error = target.reason;
      return;
    }
    error = null;
    lastAdded = null;
    try {
      if (target.kind === 'user') {
        busy = 'list';
        account = await listEditorSketches(target.username);
        filter = '';
        try { window.localStorage?.setItem(USERNAME_KEY, account.username); } catch { /* storage unavailable */ }
        if (account.sketches.length === 0) error = `${account.username} has no public sketches.`;
      } else {
        busy = 'sketch';
        review(await fetchEditorSketch(target.username, target.id, 'link'));
      }
    } catch (err) {
      fail(err);
    } finally {
      busy = null;
    }
  }

  async function pick(summary: P5SketchSummary) {
    if (!account || busy) return;
    busy = 'sketch';
    busySketchId = summary.id;
    error = null;
    lastAdded = null;
    try {
      review(await fetchEditorSketch(account.username, summary.id, 'account'));
    } catch (err) {
      fail(err);
    } finally {
      busy = null;
      busySketchId = null;
    }
  }

  async function openZip(file: File) {
    error = null;
    lastAdded = null;
    if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      error = `${file.name} is not a zip. In the p5.js Web Editor, use File → Download.`;
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      error = `${file.name} is larger than a sketch zip should be.`;
      return;
    }
    busy = 'zip';
    try {
      review(await sketchFromZip(file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (err) {
      fail(err);
    } finally {
      busy = null;
    }
  }

  /** A zip, or a folder or loose files that make a sketch. */
  async function openFiles(files: LocalFile[]) {
    const zips = files.filter((f) => /\.zip$/i.test(f.path));
    if (zips.length > 0 && zips.length === files.length) {
      await openZip(zips[0].file);
      return;
    }
    error = null;
    lastAdded = null;
    if (!looksLikeSketch(files.map((f) => f.path))) {
      error = 'Drop the zip from File → Download in the p5.js Web Editor, or the sketch\'s folder or files (at least one .js).';
      return;
    }
    busy = 'zip';
    try {
      review(await sketchFromLocalFiles(files));
    } catch (err) {
      fail(err);
    } finally {
      busy = null;
    }
  }

  function review(next: P5Sketch, mode?: P5CanvasMode) {
    sketch = next;
    imported = importSketch(next, mode ? { canvas: mode } : {});
    void refreshPreview();
  }

  function closeReview() {
    sketch = null;
    imported = null;
    previewUrl = null;
    previewToken++;
  }

  async function refreshPreview() {
    const token = ++previewToken;
    previewUrl = null;
    if (!imported || blocked) {
      previewLoading = false;
      return;
    }
    previewLoading = true;
    // Drawn by the same iframe runtime the layers play it in.
    const picture = await captureJSAnimationThumbnail(imported.source, { width: 480, height: 270, waitMs: 2500 })
      .catch(() => undefined);
    if (token !== previewToken) return;
    previewLoading = false;
    previewUrl = picture ?? null;
  }

  function add() {
    if (!imported || blocked) return;
    onImport(imported);
    lastAdded = imported.name;
    closeReview();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    void takeDroppedFiles(event.dataTransfer).then(openFiles);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
  }

  function onPicked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = localFilesFromList(input.files);
    input.value = '';
    if (files.length > 0) void openFiles(files);
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isV2(summary: P5SketchSummary): boolean {
    const version = summaryP5Version(summary);
    return !!version && Number.parseInt(version, 10) >= 2;
  }

  function megabytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<section class="p5-import" aria-label="Import a p5.js sketch">
  <header class="head">
    <div>
      <p class="eyebrow">p5.js Web Editor</p>
      <h4>Import a sketch</h4>
    </div>
    <button type="button" class="icon-btn" onclick={onClose} aria-label="Close the importer">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>

  {#if sketch && imported}
    <div class="review">
      <button type="button" class="back" onclick={closeReview}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        {account ? 'All sketches' : 'Back'}
      </button>

      <div class="title">
        <h5 translate="no">{imported.name}</h5>
        {#if sketch.author}<span class="by">by {sketch.author}</span>{/if}
      </div>
      {#if sketch.url}
        <button type="button" class="link" onclick={() => openExternalUrl(sketch!.url!)}>
          Open in the p5.js Web Editor
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </button>
      {/if}

      {#if imported.wrapped.compatibility.message}
        <p class="compat" class:blocked role={blocked ? 'alert' : undefined}>{imported.wrapped.compatibility.message}</p>
      {/if}

      {#if !blocked}
        <div class="preview" aria-live="polite">
          {#if previewUrl}
            <img src={previewUrl} alt="How {imported.name} will look" />
          {:else if previewLoading}
            <span class="spinner" aria-label="Drawing a preview"></span>
          {:else}
            <span class="preview-empty">No preview: the sketch drew nothing in its first moments.</span>
          {/if}
        </div>

        <fieldset class="canvas-choice">
          <legend>Canvas</legend>
          <label class:chosen={imported.wrapped.canvas.mode === 'fill'}>
            <input type="radio" name="p5-canvas" checked={imported.wrapped.canvas.mode === 'fill'} onchange={() => review(sketch!, 'fill')} />
            <span>Fill the output</span>
            {#if imported.wrapped.canvas.recommended === 'fill'}<em>Suggested</em>{/if}
          </label>
          <label class:chosen={imported.wrapped.canvas.mode === 'fit'}>
            <input type="radio" name="p5-canvas" checked={imported.wrapped.canvas.mode === 'fit'} onchange={() => review(sketch!, 'fit')} />
            <span>{fitLabel}</span>
            {#if imported.wrapped.canvas.recommended === 'fit'}<em>Suggested</em>{/if}
          </label>
          <p class="hint">{imported.wrapped.canvas.reason}</p>
        </fieldset>

        <dl class="facts">
          <dt>Controls</dt>
          <dd>{controlLabels.length ? controlLabels.join(', ') : 'None found'}</dd>
          <dt>Files</dt>
          <dd>
            {imported.wrapped.carried.files === 0
              ? 'Code only'
              : `${imported.wrapped.carried.files} kept with the sketch (${megabytes(imported.wrapped.carried.bytes)})`}
          </dd>
          {#if imported.wrapped.p5Version}
            <dt>Made with</dt>
            <dd>p5.js {imported.wrapped.p5Version}</dd>
          {/if}
        </dl>

        {#if imported.notes.length}
          <ul class="notes">
            {#each imported.notes as note (note)}
              <li>{note}</li>
            {/each}
          </ul>
        {/if}
      {/if}

      <button type="button" class="primary add" disabled={blocked} onclick={add}>Add to the JS tab</button>
    </div>
  {:else}
    {#if isDesktopApp}
      <form class="lookup" onsubmit={(e) => { e.preventDefault(); void find(); }}>
        <label for="p5-import-query">Username or sketch link</label>
        <div class="lookup-row">
          <input
            id="p5-import-query"
            type="text"
            bind:value={query}
            placeholder="p5, or editor.p5js.org/…/sketches/…"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="submit" class="primary" disabled={busy !== null || !query.trim()}>
            {busy === 'list' || (busy === 'sketch' && !busySketchId) ? 'Finding…' : 'Find'}
          </button>
        </div>
        <p class="hint">Public sketches only. For a private one, use File → Download in the editor and drop the zip below.</p>
      </form>
    {/if}

    <div
      class="drop"
      class:dragging
      role="button"
      tabindex="0"
      aria-label="Choose a sketch zip or its files"
      ondragenter={onDragOver}
      ondragover={onDragOver}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      onclick={() => fileInput?.click()}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
      <span>{busy === 'zip' ? 'Reading the sketch…' : 'Drop a sketch zip, folder or files here, or choose them'}</span>
    </div>
    <input bind:this={fileInput} type="file" multiple accept=".zip,.js,.mjs,.html,.htm,.css,.json,.txt,.csv,.tsv,.xml,.vert,.frag,.glsl,.obj,image/*,audio/*,video/*,font/*" hidden onchange={onPicked} />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if lastAdded}<p class="added" role="status">Added “{lastAdded}” to the JS tab.</p>{/if}

    {#if account && account.sketches.length > 0}
      <div class="list-head">
        <span>
          <strong translate="no">{account.username}</strong> ·
          {#if account.sketches.length === 1}1 public sketch{:else}{account.sketches.length} public sketches{/if}
        </span>
        {#if account.sketches.length > 8}
          <input class="filter" type="search" bind:value={filter} placeholder="Filter" aria-label="Filter sketches by name" />
        {/if}
      </div>
      <ul class="sketches">
        {#each visible as summary (summary.id)}
          <li>
            <button type="button" class="sketch-row" disabled={busy !== null} onclick={() => pick(summary)}>
              <span class="name" translate="no">{summary.name}</span>
              <span class="meta">
                {#if isV2(summary)}<span class="chip">p5 2.x</span>{/if}
                {formatDate(summary.updatedAt)}
              </span>
              {#if busySketchId === summary.id}<span class="spinner small" aria-label="Loading"></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if matching.length > visible.length}
        <p class="hint">Showing {visible.length} of {matching.length}. Filter by name to find the rest.</p>
      {:else if matching.length === 0}
        <p class="hint">No sketch names match “{filter}”.</p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .p5-import {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: var(--ga-ink-1, #c9ccd4);
    font-size: 13px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .eyebrow {
    margin: 0 0 2px;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ga-ink-3, #6b7080);
  }

  h4 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--ga-ink-0, #eef0f4);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    color: var(--ga-ink-2, #9aa0ad);
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.2));
  }

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }

  label,
  legend {
    display: block;
    margin-bottom: 6px;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ga-ink-2, #9aa0ad);
  }

  .lookup-row {
    display: flex;
    gap: 6px;
  }

  input[type='text'],
  input[type='search'] {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-secondary, #111114);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    color: var(--ga-ink-0, #eef0f4);
    font: inherit;
  }

  input[type='text']:focus,
  input[type='search']:focus {
    outline: none;
    border-color: var(--ga-violet, #9b87f5);
  }

  .primary {
    height: 32px;
    padding: 0 14px;
    background: var(--ga-violet-soft, rgba(155, 135, 245, 0.12));
    border: 1px solid var(--ga-violet-line, rgba(155, 135, 245, 0.4));
    border-radius: 6px;
    color: var(--ga-violet, #9b87f5);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  .primary:hover:not(:disabled) {
    background: rgba(155, 135, 245, 0.2);
  }

  .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ga-ink-3, #6b7080);
  }

  .drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 52px;
    padding: 10px;
    border: 1px dashed var(--ga-line-3, rgba(255, 255, 255, 0.2));
    border-radius: 8px;
    color: var(--ga-ink-2, #9aa0ad);
    cursor: pointer;
    text-align: center;
  }

  .drop:hover,
  .drop:focus-visible,
  .drop.dragging {
    border-color: var(--ga-violet, #9b87f5);
    color: var(--ga-ink-0, #eef0f4);
    background: rgba(155, 135, 245, 0.06);
    outline: none;
  }

  .error,
  .added {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    line-height: 1.4;
  }

  .error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.45);
    color: #f87171;
  }

  .added {
    background: rgba(52, 211, 153, 0.1);
    border: 1px solid rgba(52, 211, 153, 0.35);
    color: #6ee7b7;
  }

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--ga-ink-2, #9aa0ad);
  }

  .list-head strong {
    color: var(--ga-ink-0, #eef0f4);
  }

  .list-head .filter {
    flex: 0 1 140px;
    height: 28px;
  }

  .sketches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }

  .sketch-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--ga-ink-1, #c9ccd4);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .sketch-row:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #eef0f4);
  }

  .sketch-row:disabled {
    cursor: wait;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: 11px;
    color: var(--ga-ink-3, #6b7080);
  }

  .chip {
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(251, 191, 36, 0.45);
    color: #fbbf24;
  }

  .review {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .back,
  .link {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    color: var(--ga-ink-2, #9aa0ad);
    font: inherit;
    cursor: pointer;
  }

  .back:hover,
  .link:hover {
    color: var(--ga-ink-0, #eef0f4);
  }

  .link {
    color: var(--ga-violet, #9b87f5);
    font-size: 12px;
  }

  .title {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
  }

  h5 {
    margin: 0;
    font-size: 15px;
    color: var(--ga-ink-0, #eef0f4);
  }

  .by {
    color: var(--ga-ink-2, #9aa0ad);
  }

  .compat {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    line-height: 1.4;
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.35);
    color: #fcd34d;
  }

  .compat.blocked {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.45);
    color: #f87171;
  }

  .preview {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    background: #000;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    overflow: hidden;
  }

  .preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .preview-empty {
    padding: 0 16px;
    font-size: 12px;
    text-align: center;
    color: var(--ga-ink-3, #6b7080);
  }

  .canvas-choice {
    margin: 0;
    padding: 0;
    border: none;
  }

  .canvas-choice label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px;
    padding: 7px 9px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
    color: var(--ga-ink-1, #c9ccd4);
    cursor: pointer;
  }

  .canvas-choice label.chosen {
    border-color: var(--ga-violet-line, rgba(155, 135, 245, 0.5));
    color: var(--ga-ink-0, #eef0f4);
  }

  .canvas-choice input {
    accent-color: var(--ga-violet, #9b87f5);
    margin: 0;
  }

  .canvas-choice span {
    flex: 1;
  }

  .canvas-choice em {
    font-style: normal;
    font-size: 11px;
    color: var(--ga-violet, #9b87f5);
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 0;
  }

  .facts dt {
    color: var(--ga-ink-3, #6b7080);
  }

  .facts dd {
    margin: 0;
    color: var(--ga-ink-1, #c9ccd4);
  }

  .notes {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ga-ink-2, #9aa0ad);
  }

  .add {
    height: 36px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--ga-violet, #9b87f5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 12px;
    height: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
