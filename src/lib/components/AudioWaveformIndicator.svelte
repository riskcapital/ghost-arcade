<script lang="ts">
  /**
   * AudioWaveformIndicator — tiny live oscilloscope rendered next to the
   * audio source buttons. Pulls time-domain samples each frame from the
   * shared audio analyzer (via getLastRawAnalysis()) and draws a single
   * polyline. Lives in the AudioInputPicker DOM tree, OUTSIDE the
   * visualizer canvas, so it never appears in output / captureStream /
   * recording.
   *
   * Goes dim when the analyzer has no data (no source active).
   */
  import { onMount, onDestroy } from 'svelte';
  import { getLastRawAnalysis } from '../stores/audio';
  import { audioStore } from '../stores/audio';
  import { t } from '../i18n';

  // Logical pixel size; canvas backing-store gets devicePixelRatio'd.
  const W = 92;
  const H = 28;

  let canvas: HTMLCanvasElement | null = null;
  let raf = 0;
  let mounted = false;

  function draw() {
    if (!mounted || !canvas) return;
    raf = requestAnimationFrame(draw);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width; // backing-store px
    const h = canvas.height;

    // Always clear (transparent over the toolbar)
    ctx.clearRect(0, 0, w, h);

    const analysis = getLastRawAnalysis();
    const data = analysis?.waveformData;
    const live = !!(data && data.length > 0 && $audioStore.inputType !== 'none');

    // Subtle baseline so the slot reads as a control even when silent
    const mid = h * 0.5;
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    const styles = getComputedStyle(document.documentElement);
    const liveColor = styles.getPropertyValue('--ga-coral').trim() || '#ff6f5e';
    const idleColor = styles.getPropertyValue('--ga-ink-3').trim() || '#3a404a';
    ctx.strokeStyle = live ? liveColor : idleColor;
    ctx.beginPath();

    if (live && data) {
      // Downsample/walk the time-domain buffer across the canvas width.
      // AnalyserNode time-domain is typically in [-1, 1].
      const step = data.length / w;
      for (let x = 0; x < w; x++) {
        const idx = Math.min(data.length - 1, Math.floor(x * step));
        const v = data[idx];
        const y = mid - v * (h * 0.45);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    } else {
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
    }
    ctx.stroke();
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }

  onMount(() => {
    mounted = true;
    resize();
    raf = requestAnimationFrame(draw);
  });

  onDestroy(() => {
    mounted = false;
    if (raf) cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} class="awi" title={$t('audioTools.waveform.liveTitle')}></canvas>

<style>
  .awi {
    display: inline-block;
    vertical-align: middle;
    background: var(--ga-slot, #050607);
    /* Visually framed but quiet — sits between the icons without
       grabbing attention. */
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    padding: 0;
    margin: 0 4px;
    pointer-events: none;
  }
</style>
