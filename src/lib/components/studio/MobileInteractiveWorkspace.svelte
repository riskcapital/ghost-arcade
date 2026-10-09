<script lang="ts">
  /** Full-screen dialog around the Interactive Studio editor on the phone and tablet. */
  import { onDestroy } from 'svelte';
  import InteractiveStudio from './InteractiveStudio.svelte';
  import type { Point } from '../../mobile/studio/interactive';
  export let open = false;
  /** Width ÷ height of the output the scene plays on. Optional: 16:9 when not passed. */
  export let aspect = 16 / 9;
  export let outputLevel = 1,
    outputHeld = false,
    outputBlackout = false;
  export function previewOutput() {
    editor?.previewOutput();
  }
  export let outputLabel = 'No external display connected';
  export let mappingSurfaces: { name: string; points: Point[]; enabled: boolean; mode: string }[] = [];
  export let onpreparecamera: () => Promise<void> = async () => {};
  let editor: InteractiveStudio;
  export function restoreMix() {
    editor?.restoreMix();
  }
  export let onclose: () => void;
  export let onoutput: (canvas: HTMLCanvasElement | null) => void;
  export let onoutputsettings: () => void;
  let dialog: HTMLDialogElement;
  $: if (dialog) {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }
  onDestroy(() => dialog?.close());
</script>

<!-- Keep the authoring/runtime instance mounted when returning to the decks.
     Its loop sleeps while hidden unless this scene is the selected output. -->
<dialog
  bind:this={dialog}
  aria-label="Interactive Studio"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  <div class="studio-fill">
  <InteractiveStudio
    bind:this={editor}
    {onpreparecamera}
    {outputLevel}
    {outputHeld}
    {outputBlackout}
    handheld
    persistDraft
    visible={open}
    {mappingSurfaces}
    {outputLabel}
    {onoutputsettings}
    {onoutput}
    {onclose}
    {aspect}
  />
  </div>
  <slot name="nav" />
</dialog>

<style>
  dialog {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    margin: 0;
    width: 100%;
    height: 100dvh;
    max-width: none;
    max-height: none;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    border: 0;
    background: #10151c;
    color: #edf2f8;
    overflow: hidden;
  }
  /* The editor takes the room; the workspace bar keeps its place underneath. */
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .studio-fill {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  dialog::backdrop {
    background: #03060c;
  }
</style>
