<script lang="ts">
  /**
   * The rendered stage of a template, behind the live picture in the preview only (never on the
   * output). The picture is laid over it with a screen blend, so it reads as light on the object.
   */
  import { renderStages, cachedStage } from '../../mobile/studio/stageRenderer';

  export let template: string;
  /** Pixel width to render at; the height follows 16:9. */
  export let width = 960;

  let url: string | null | undefined;
  let wanted = '';
  $: void load(template, width);
  async function load(id: string, w: number) {
    const shot = { template: id, width: Math.round(w), height: Math.round((w * 9) / 16), content: false };
    const ask = `${id}:${shot.width}`;
    wanted = ask;
    url = cachedStage(shot);
    if (url) return;
    const [made] = await renderStages([shot]);
    if (wanted === ask) url = made;
  }
</script>

{#if url}<img class="stage-backdrop" src={url} alt="" aria-hidden="true" draggable="false" data-stage-backdrop={template} />{/if}

<style>
  .stage-backdrop {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; display: block;
    pointer-events: none; user-select: none; -webkit-user-select: none;
    animation: stage-in .5s ease-out both;
  }
  @keyframes stage-in { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .stage-backdrop { animation: none; } }
</style>
