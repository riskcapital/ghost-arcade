<script lang="ts">
  /**
   * The live looper: six loop tracks. Tracks shows them as rows across the
   * bars with the record bar above and the quick editor below.
   */
  import { onDestroy, onMount } from 'svelte';
  import { ensureMusicRuntime } from '../../music/musicRuntime';
  import { onLoopNotice, publish } from '../../music/loopStation';
  import { showToast } from '../../stores/errorToast';
  import LoopRecordBar from './LoopRecordBar.svelte';
  import LoopTrackRows from './LoopTrackRows.svelte';

  onMount(() => {
    ensureMusicRuntime();
    publish();
    onLoopNotice((message) => showToast(message === 'Too short' ? 'Too short: a loop needs at least a beat.' : message === 'Nothing was played' ? 'Nothing was played, so no loop was made.' : 'No empty loop track for it. Clear a track first.', 'info'));
  });
  onDestroy(() => onLoopNotice(null));
</script>

<div class="station">
  <div class="top"><LoopRecordBar /></div>
  <LoopTrackRows />
</div>

<style>
  .station { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .top { padding: 6px 10px; border-bottom: 1px solid var(--studio-edge); background: var(--studio-panel); overflow-x: auto; }
</style>
