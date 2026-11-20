<script lang="ts">
  // The phone app's front door: the welcome screen, then the studio on the chosen path.
  // Mock-up stage: native-mobile-main only mounts this when the preview flag is set, so the
  // app still opens straight into the studio by default.
  import { onMount } from 'svelte';
  import NativeStudioApp from './NativeStudioApp.svelte';
  import PhoneWelcome from './PhoneWelcome.svelte';
  import { setLaunchPath, type LaunchPath } from '../../mobile/studio/launchIntent';
  import { frameStats } from '../../mobile/studio/frameStats';

  /** Measuring build only: 'welcome' times the welcome screen and the studio after it; 'baseline' the studio alone. */
  export let bench: '' | 'welcome' | 'baseline' = '';

  let chosen = bench === 'baseline';

  function choose(path: LaunchPath) {
    setLaunchPath(path);
    chosen = true;
    if (bench) void report('studio-after-welcome', 3000, 0);
  }

  async function report(phase: string, ms: number, skip: number) {
    const stats = await frameStats(ms, skip);
    const field = document.querySelector('canvas.beam-field');
    console.log('[ga-bench] ' + JSON.stringify({ phase, ...stats, fieldCanvasInDom: !!field }));
  }

  onMount(() => {
    if (bench === 'baseline') void report('studio-alone', 3000, 0);
    if (bench === 'welcome') {
      // Leave the field 2 s to compile and settle, time 6 s of it, then take the VJ path.
      void report('welcome', 6000, 2000).then(() => {
        (document.querySelector('[data-choice="vj"]') as HTMLButtonElement | null)?.click();
      });
    }
  });
</script>

{#if chosen}<NativeStudioApp />{:else}<PhoneWelcome onchoose={choose} />{/if}
