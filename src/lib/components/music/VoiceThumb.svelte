<script lang="ts">
  /**
   * A voice's picture, as the visual browser shows it: the baked thumbnail,
   * else one drawn from its shader, else its initial. Clicking opens the
   * visual browser on it.
   */
  import { engineInstrumentOf, engineThumbName } from '../../music/engineVoices';
  import { voiceShaderByFile } from '../../music/visualScenes';
  import { bakedVoiceThumb, demoVoiceCode } from '../../music/voiceThumbnails';
  import { generateCachedThumbnail } from '../../isf/thumbnail';

  let { file, label, onclick }: { file: string; label: string; onclick: () => void } = $props();

  const name = $derived(voiceShaderByFile(file)?.name ?? file.replace(/^VX-/, '').replace(/\.fs$/, ''));
  let drawn = $state<Record<string, string | null>>({});
  const engine = $derived(engineInstrumentOf(file));
  const src = $derived(file in drawn ? drawn[file] : bakedVoiceThumb(file, engine ? engineThumbName(engine.id) : null));

  /** No baked picture: draw one from the shader (engine voices have only theirs). */
  async function failed() {
    const f = file;
    if (f in drawn) { drawn = { ...drawn, [f]: null }; return; }
    drawn = { ...drawn, [f]: null };
    if (engineInstrumentOf(f)) return;
    try {
      const code = await fetch(`./ISF/${f}`).then((r) => r.text());
      const url = await generateCachedThumbnail(demoVoiceCode(code));
      drawn = { ...drawn, [f]: url || null };
    } catch {
      // The initial stays.
    }
  }
</script>

<button class="thumb" {onclick} aria-label="{label}: {name}. Choose another visual" title="{name}: click to choose another visual">
  {#if src}<img {src} alt="" draggable="false" onerror={failed} />{:else}<span class="initial" aria-hidden="true">{name.slice(0, 1)}</span>{/if}
</button>

<style>
  .thumb {
    flex: 0 0 auto;
    width: 64px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-slot);
    overflow: hidden;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .thumb:hover { border-color: var(--studio-muted); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .initial { font-size: 14px; font-weight: 600; color: var(--studio-muted); }
</style>
