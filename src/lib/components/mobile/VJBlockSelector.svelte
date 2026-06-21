<script lang="ts">
  export let blocks: any[] = [];
  export let activeBlockId: string = '';
  export let onSetBlock: (blockId: string) => void = () => {};
</script>

<div class="block-selector">
  <div class="block-tabs" role="tablist">
    {#each blocks as block}
      <button
        class="block-tab"
        class:active={block.id === activeBlockId}
        role="tab"
        aria-selected={block.id === activeBlockId}
        on:click={() => onSetBlock(block.id)}
      >
        {block.name}
      </button>
    {/each}
  </div>
</div>

<style>
  .block-selector {
    padding: 4px 8px;
    overflow: hidden;
  }

  .block-tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 2px 0;
  }
  .block-tabs::-webkit-scrollbar {
    display: none;
  }

  .block-tab {
    padding: 7px 16px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }

  .block-tab:active {
    transform: scale(0.95);
  }

  .block-tab.active {
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--accent-primary, #FF6B6B) 18%, transparent),
      color-mix(in srgb, var(--accent-primary, #FF6B6B) 8%, transparent)
    );
    border-color: var(--accent-primary, #FF6B6B);
    color: var(--accent-primary, #FF6B6B);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-primary, #FF6B6B) 25%, transparent);
    text-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary, #FF6B6B) 40%, transparent);
  }
</style>
