<script lang="ts">
  // Tile and long-text controls shared by the layer Text panel and the VJ text clip panel.
  import type { TextContent, TextReader, TextTile } from '../types';
  import { DEFAULT_TEXT_READER, DEFAULT_TEXT_TILE, TEXT_TILE_STYLES, readingTime, wordCount } from '../text/textMotionCatalog';

  export let content: TextContent;
  export let onUpdate: (updates: Partial<TextContent>) => void;

  $: tile = { ...DEFAULT_TEXT_TILE, ...(content.tile ?? {}) } as TextTile;
  $: reader = { ...DEFAULT_TEXT_READER, ...(content.reader ?? {}) } as TextReader;
  $: words = wordCount(content.text);
  $: moving = tile.style === 'scroll' || tile.style === 'steps';
  $: varied = tile.style === 'sizes' || tile.style === 'vertical' || tile.style === 'mix';

  const setTile = (patch: Partial<TextTile>) => onUpdate({ tile: { ...tile, ...patch } });
  const setReader = (patch: Partial<TextReader>) => onUpdate({ reader: { ...reader, ...patch } });
  const num = (event: Event) => Number((event.target as HTMLInputElement).value);

  let fileNote = '';
  async function loadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 12_000_000) { fileNote = 'That file is over 12 MB. Use a plain text file.'; return; }
    try {
      const text = (await file.text()).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
      if (!text.trim()) { fileNote = 'That file has no text in it.'; return; }
      onUpdate({ text, reader: { ...reader, enabled: true } });
      fileNote = `${file.name} loaded.`;
    } catch { fileNote = 'That file could not be read.'; }
  }
</script>

<div class="tm">
  <div class="tm-head">
    <label class="tm-switch"><input type="checkbox" checked={tile.enabled} onchange={(e) => setTile({ enabled: (e.target as HTMLInputElement).checked })} /> Tile the text</label>
  </div>
  {#if tile.enabled}
    <label class="tm-row"><span>Pattern</span>
      <select value={tile.style} onchange={(e) => setTile({ style: (e.target as HTMLSelectElement).value as TextTile['style'] })}>
        {#each TEXT_TILE_STYLES as s}<option value={s.value}>{s.label}</option>{/each}
      </select>
    </label>
    <p class="tm-hint">{TEXT_TILE_STYLES.find(s => s.value === tile.style)?.description ?? ''}</p>
    <label class="tm-row"><span>Columns</span><input type="range" min="1" max="12" step="1" value={tile.columns} oninput={(e) => setTile({ columns: num(e) })} aria-label="Tile columns" /><em>{tile.columns}</em></label>
    <label class="tm-row"><span>Rows</span><input type="range" min="1" max="12" step="1" value={tile.rows} oninput={(e) => setTile({ rows: num(e) })} aria-label="Tile rows" /><em>{tile.rows}</em></label>
    <label class="tm-row"><span>Size</span><input type="range" min="0.3" max="2" step="0.01" value={tile.scale} oninput={(e) => setTile({ scale: num(e) })} aria-label="Text size in each tile" /><em>{Math.round(tile.scale * 100)}%</em></label>
    {#if varied}<label class="tm-row"><span>Variation</span><input type="range" min="0" max="1" step="0.01" value={tile.variation} oninput={(e) => setTile({ variation: num(e) })} aria-label="Tile variation" /><em>{Math.round(tile.variation * 100)}%</em></label>{/if}
    {#if moving}<label class="tm-row"><span>Speed</span><input type="range" min="0" max="2" step="0.01" value={tile.speed} oninput={(e) => setTile({ speed: num(e) })} aria-label="Tile speed" /><em>{tile.speed.toFixed(2)}</em></label>{/if}
  {/if}

  <div class="tm-head tm-gap">
    <label class="tm-switch"><input type="checkbox" checked={reader.enabled} onchange={(e) => setReader({ enabled: (e.target as HTMLInputElement).checked })} /> Read through long text</label>
  </div>
  {#if reader.enabled}
    <label class="tm-row"><span>Show</span>
      <select value={reader.unit} onchange={(e) => setReader({ unit: (e.target as HTMLSelectElement).value as TextReader['unit'] })}>
        <option value="word">One word</option>
        <option value="phrase">A phrase</option>
        <option value="line">A line</option>
        <option value="page">A page</option>
      </select>
    </label>
    {#if reader.unit === 'phrase'}<label class="tm-row"><span>Words</span><input type="range" min="2" max="12" step="1" value={reader.wordsPerPhrase} oninput={(e) => setReader({ wordsPerPhrase: num(e) })} aria-label="Words per phrase" /><em>{reader.wordsPerPhrase}</em></label>{/if}
    <label class="tm-row"><span>Pace</span><input type="range" min="60" max="900" step="10" value={reader.wordsPerMinute} oninput={(e) => setReader({ wordsPerMinute: num(e) })} aria-label="Words per minute" /><em>{reader.wordsPerMinute}</em></label>
    <label class="tm-switch tm-sub"><input type="checkbox" checked={reader.loop} onchange={(e) => setReader({ loop: (e.target as HTMLInputElement).checked })} /> Start again at the end</label>
    <p class="tm-hint">{words.toLocaleString()} words, about {readingTime(content.text, reader.wordsPerMinute)} at this pace. The animation plays for each piece.</p>
  {/if}
  <label class="tm-file">Load a text file<input type="file" accept=".txt,.md,.text,text/plain" onchange={loadFile} /></label>
  {#if fileNote}<p class="tm-hint" role="status">{fileNote}</p>{/if}
</div>

<style>
  .tm { display: flex; flex-direction: column; gap: 6px; }
  .tm-head { display: flex; align-items: center; }
  .tm-gap { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--ga-line, rgba(255,255,255,.08)); }
  .tm-switch { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ga-ink-1, #e8ecf1); cursor: pointer; }
  .tm-sub { color: var(--ga-ink-2, #a9b2bd); }
  .tm-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) 40px; align-items: center; gap: 8px; font-size: 11px; color: var(--ga-ink-2, #a9b2bd); }
  .tm-row select { grid-column: 2 / 4; min-width: 0; }
  .tm-row input[type="range"] { width: 100%; min-width: 0; }
  .tm-row em { font-style: normal; text-align: right; font-variant-numeric: tabular-nums; color: var(--ga-ink-1, #e8ecf1); }
  .tm-hint { margin: 0; font-size: 11px; line-height: 1.35; color: var(--ga-ink-3, #7d8794); }
  .tm-file { position: relative; display: inline-flex; align-self: flex-start; align-items: center; margin-top: 4px; padding: 5px 10px; font-size: 11px; border-radius: 4px; cursor: pointer; color: var(--ga-ink-1, #e8ecf1); background: var(--ga-surface-2, rgba(255,255,255,.06)); border: 1px solid var(--ga-line, rgba(255,255,255,.1)); }
  .tm-file:hover { background: var(--ga-surface-3, rgba(255,255,255,.1)); }
  .tm-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
</style>
