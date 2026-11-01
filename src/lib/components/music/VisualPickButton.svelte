<script lang="ts">
  /** Shows the visual chosen (or a prompt) and opens the visual browser to change it. */
  import { voiceShaderByFile } from '../../music/visualScenes';
  import { visualPicker } from '../../music/studioUi';

  let {
    file,
    onpick,
    none = false,
    placeholder = 'Choose a visual…',
    title = 'Visuals',
    label = 'Visual',
  }: { file: string | null; onpick: (file: string | null) => void; none?: boolean; placeholder?: string; title?: string; label?: string } = $props();

  const shader = $derived(file ? voiceShaderByFile(file) : null);
</script>

<button
  class="vpick"
  class:empty={!shader}
  onclick={() => visualPicker.set({ current: file, none, title, pick: onpick })}
  aria-label="{label}: {shader?.name ?? placeholder}"
  title={shader?.blurb ?? placeholder}
>
  <span class="txt">{shader?.name ?? placeholder}</span>
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
</button>

<style>
  .vpick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
  }
  .vpick.empty { color: var(--studio-muted); }
  .vpick:hover { border-color: var(--studio-muted); }
  .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  svg { flex: 0 0 auto; width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
</style>
