<script lang="ts">
  export let numColumns: number = 8;
  export let isTablet: boolean = false;
  export let onTriggerColumn: (columnIndex: number) => void = () => {};

  let activeColumn: number | null = null;

  function handleTrigger(col: number) {
    activeColumn = col;
    onTriggerColumn(col);
    // Flash effect — reset after animation
    setTimeout(() => { activeColumn = null; }, 300);
  }
</script>

<div class="column-triggers" class:tablet={isTablet}>
  <div class="trigger-label">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5,3 19,12 5,21"/>
    </svg>
  </div>
  <div class="triggers-row">
    {#each Array(numColumns) as _, i}
      <button
        class="col-trigger"
        class:flash={activeColumn === i}
        on:click={() => handleTrigger(i)}
      >
        {i + 1}
      </button>
    {/each}
  </div>
</div>

<style>
  .column-triggers {
    display: flex;
    gap: 2px;
    padding: 4px 4px 4px 4px;
    flex-shrink: 0;
  }

  .trigger-label {
    width: 36px;
    min-width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
  }
  .column-triggers.tablet .trigger-label {
    width: var(--clip-label-width, 44px);
    min-width: var(--clip-label-width, 44px);
  }

  .triggers-row {
    display: flex;
    gap: 2px;
    flex: 1;
  }

  .col-trigger {
    flex: 1;
    height: 32px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.4);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s cubic-bezier(0.25, 0.1, 0.25, 1.4);
    -webkit-tap-highlight-color: transparent;
  }
  .column-triggers.tablet .col-trigger {
    height: var(--column-trigger-height, 30px);
  }

  .col-trigger:active {
    transform: scale(0.88);
    background: var(--accent-primary, #FF6B6B);
    border-color: var(--accent-primary, #FF6B6B);
    color: #fff;
    box-shadow: 0 0 12px var(--accent-primary, #FF6B6B);
  }

  .col-trigger.flash {
    background: var(--accent-primary, #FF6B6B);
    border-color: var(--accent-primary, #FF6B6B);
    color: #fff;
    box-shadow: 0 0 16px var(--accent-primary, #FF6B6B);
    animation: trigger-flash 0.3s ease-out;
  }

  @keyframes trigger-flash {
    0% {
      transform: scale(0.88);
      box-shadow: 0 0 20px var(--accent-primary, #FF6B6B);
    }
    50% {
      transform: scale(1.02);
    }
    100% {
      transform: scale(1);
      box-shadow: none;
    }
  }
</style>
