<script lang="ts">
  // Media Library, Scans tab: point cloud scans received from a paired phone.
  import { phoneScanLibrary, addPhoneScanAsLayer, type PhoneScan } from '../stores/phoneScans';
  import { showToast } from '../stores/errorToast';

  function megabytes(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  function add(scan: PhoneScan) {
    if (!addPhoneScanAsLayer(scan)) showToast('Could not add a Point Cloud layer for this scan.');
  }
</script>

<div class="scan-list" data-scan-library>
  {#each $phoneScanLibrary as scan (scan.path)}
    <div class="scan-row" data-scan-item={scan.name} ondblclick={() => add(scan)} role="listitem" title="Double-click to add as a Point Cloud layer">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="6" r="1.5"/><circle cx="12" cy="4" r="1.5"/><circle cx="19" cy="7" r="1.5"/><circle cx="7" cy="13" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="10" cy="20" r="1.5"/><circle cx="18" cy="18" r="1.5"/></svg>
      <div class="scan-text">
        <div class="scan-name">{scan.name}</div>
        <div class="scan-meta">{megabytes(scan.bytes)}{scan.points ? ` · ${scan.points.toLocaleString()} points` : ''}</div>
      </div>
      <button class="scan-add" onclick={() => add(scan)}>Add as Point Cloud layer</button>
    </div>
  {/each}
  <p class="scan-hint">Scans sent from the Ghost Arcade phone app are kept here.</p>
</div>

<style>
  .scan-list { display: flex; flex-direction: column; gap: 6px; font-size: var(--ga-text-control); }
  .scan-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 8px;
    color: var(--ga-ink-0, #eee);
    background: var(--ga-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--ga-line-2, #2c2c33);
    border-radius: var(--ga-r-hard, 3px);
  }
  .scan-row svg { flex: none; color: var(--ga-ink-2, #888); }
  .scan-text { flex: 1; min-width: 0; }
  .scan-name { overflow-wrap: anywhere; font-weight: var(--ga-weight-control); }
  .scan-meta, .scan-hint { color: var(--ga-ink-2, #888); font-size: var(--ga-text-meta); }
  .scan-hint { margin: 4px 2px 0; }
  .scan-add {
    flex: none;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-1, #bbb);
    background: var(--ga-card, transparent);
    border: 1px solid var(--ga-line-2, #3a3a42);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .scan-add:hover { color: var(--ga-ink-0, #eee); border-color: var(--ga-line-3, #4a4a52); }
</style>
