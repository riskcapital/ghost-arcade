<script lang="ts">
  /** A rule between two kinds of control in one group, with an optional small label. */
  let { label = '' }: { label?: string } = $props();
</script>

{#if label}<div class="ga-divider labelled" role="separator" aria-label={label}><span aria-hidden="true">{label}</span></div>
{:else}<hr class="ga-divider" />{/if}

<style>
  .ga-divider {
    margin: var(--ga-space-3) 0;
    border: 0;
    height: 1px;
    background: var(--ga-section-head-line);
  }
  .labelled {
    display: flex;
    align-items: center;
    gap: var(--ga-space-2);
    height: auto;
    background: none;
    font-size: var(--ga-text-caption);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ga-ink-2);
  }
  .labelled::before,
  .labelled::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--ga-section-head-line);
  }
  .labelled::before {
    flex: 0 0 0;
  }
</style>
