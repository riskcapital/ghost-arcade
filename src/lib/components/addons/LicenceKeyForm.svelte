<script lang="ts">
  /**
   * Licence key → Activate. When the licence is already on its two
   * computers, lists them so one can be freed for this one.
   */
  import { activateAddonLicence, freeAddonSeat, type AddonActionResult, type AddonSeat } from '../../addons/addonAccess';
  import AddonErrorText from './AddonErrorText.svelte';

  let { onactivated = () => {}, autofocus = false }: { onactivated?: () => void; autofocus?: boolean } = $props();

  let key = $state('');
  let busy = $state(false);
  let failure = $state<Extract<AddonActionResult, { ok: false }> | null>(null);
  let input: HTMLInputElement | undefined = $state();

  $effect(() => { if (autofocus) input?.focus(); });

  async function run(action: () => Promise<AddonActionResult>) {
    busy = true;
    failure = null;
    try {
      const result = await action();
      if (result.ok) {
        key = '';
        onactivated();
      } else failure = result;
    } finally {
      busy = false;
    }
  }

  function activate(e?: Event) {
    e?.preventDefault();
    if (!key.trim() || busy) return;
    void run(() => activateAddonLicence(key));
  }

  function free(seat: AddonSeat) {
    void run(() => freeAddonSeat(key, seat.id));
  }

  function when(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
</script>

<form class="licence-form" onsubmit={activate} data-licence-form>
  <input
    bind:this={input}
    bind:value={key}
    type="text"
    spellcheck="false"
    autocomplete="off"
    placeholder="GA-XXXX-XXXX-XXXX-XXXX"
    aria-label="Licence key"
    translate="no"
    disabled={busy}
    data-licence-key
  />
  <button type="submit" class="primary" disabled={busy || !key.trim()} data-licence-activate>{busy ? 'Activating…' : 'Activate'}</button>
</form>
{#if failure}
  <p class="licence-error" role="alert"><AddonErrorText code={failure.code} maxMachines={failure.maxMachines} /></p>
  {#if failure.code === 'machine_limit' && failure.machines?.length}
    <ul class="licence-seats">
      {#each failure.machines as seat (seat.id)}
        <li>
          <span class="seat-name" translate="no">{seat.hostname || 'Unnamed computer'}</span>
          <span class="seat-when">{when(seat.lastSeenAt ?? seat.activatedAt)}</span>
          <button type="button" onclick={() => free(seat)} disabled={busy} title="Deactivate that computer and activate this one">Move here</button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .licence-form { display: flex; gap: 6px; }
  input {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    padding: 0 8px;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px);
    letter-spacing: 0.04em;
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
  }
  input:focus { outline: none; border-color: var(--ga-selection-line, #5278ff); }
  button {
    height: var(--ga-control-h, 26px);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 4px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary { border-color: var(--ga-selection-line, #5278ff); background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 22%, transparent); }
  button:disabled { opacity: 0.45; cursor: default; }
  .licence-error { margin: 6px 0 0; color: #ff8a80; font-size: var(--ga-text-control, 12px); line-height: 1.4; }
  .licence-seats { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .licence-seats li { display: flex; align-items: center; gap: 8px; font-size: var(--ga-text-control, 12px); }
  .seat-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ga-ink-0, #ddd); }
  .seat-when { color: var(--ga-ink-2, #888); }
</style>
