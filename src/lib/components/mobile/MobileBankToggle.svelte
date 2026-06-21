<script lang="ts">
  /**
   * MobileBankToggle — A/B deck switcher pill.
   *
   * When the crossfader is OFF, the mobile UI shows a single deck at a
   * time. This pill lets the performer flip between Bank A and Bank B
   * without enabling the crossfader.
   *
   * When the crossfader is ON, this is hidden — both decks are visible
   * side by side with the crossfader between them.
   */

  export let activeBank: 'A' | 'B' = 'A';
  export let onChange: (bank: 'A' | 'B') => void = () => {};
  export let compact: boolean = false;
</script>

<div class="bank-toggle" class:compact>
  <button
    class="bank-btn a"
    class:active={activeBank === 'A'}
    onclick={() => onChange('A')}
  >A</button>
  <button
    class="bank-btn b"
    class:active={activeBank === 'B'}
    onclick={() => onChange('B')}
  >B</button>
</div>

<style>
  .bank-toggle {
    display: inline-flex;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .bank-toggle.compact { padding: 1px; }

  .bank-btn {
    width: 32px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.1s;
  }
  .bank-toggle.compact .bank-btn { width: 26px; height: 22px; font-size: 11px; }

  .bank-btn.a.active {
    background: rgba(79, 195, 247, 0.2);
    color: #4FC3F7;
    box-shadow: 0 0 6px rgba(79, 195, 247, 0.4);
  }
  .bank-btn.b.active {
    background: rgba(206, 147, 216, 0.2);
    color: #CE93D8;
    box-shadow: 0 0 6px rgba(206, 147, 216, 0.4);
  }
  .bank-btn:active:not(.active) {
    transform: scale(0.92);
    background: rgba(255, 255, 255, 0.06);
  }
</style>
