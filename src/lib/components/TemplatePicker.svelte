<script lang="ts">
  // Starter templates — pick one to open a project that is already set up.
  // Opening a template replaces the current project, so ask first when the
  // current one has unsaved changes.
  import { onboarding } from '$lib/stores/onboarding';
  import { STARTER_TEMPLATES, templateCoverUrl, applyStarterTemplate } from '$lib/onboarding/templates';

  export let hasUnsavedChanges = false;
  export let startFresh: (name: string) => void;

  let pending: string | null = null;
  let opening: string | null = null;
  let error = '';

  async function choose(id: string) {
    if (opening) return;
    if (hasUnsavedChanges && pending !== id) {
      pending = id;
      return;
    }
    opening = id;
    error = '';
    try {
      const ok = await applyStarterTemplate(id, startFresh);
      if (ok) onboarding.closeTemplates();
      else error = 'That template could not be opened.';
    } catch (err) {
      error = `That template could not be opened: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      opening = null;
      pending = null;
    }
  }

  function onKey(e: KeyboardEvent) {
    if ($onboarding.templatesOpen && e.key === 'Escape') onboarding.closeTemplates();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if $onboarding.templatesOpen}
  <div class="tp-backdrop" onclick={() => onboarding.closeTemplates()}>
    <div class="tp-panel" role="dialog" aria-labelledby="tp-title" onclick={(e) => e.stopPropagation()}>
      <header class="tp-head modal-header">
        <h2 id="tp-title">Start from a template</h2>
        <button class="tp-close" aria-label="Close templates" onclick={() => onboarding.closeTemplates()}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      </header>
      <div class="tp-body">
      <p class="tp-sub">Each template opens a new project that is ready to play. Swap in your own media whenever you like.</p>
      {#if hasUnsavedChanges}
        <p class="tp-warn">Opening a template replaces the current project. Save first if you want to keep it.</p>
      {/if}
      <div class="tp-grid">
        {#each STARTER_TEMPLATES as template (template.id)}
          <button class="tp-card" class:confirm={pending === template.id} disabled={!!opening}
            onclick={() => choose(template.id)}>
            <img src={templateCoverUrl(template)} alt="" loading="lazy" />
            <span class="tp-name">{template.name}</span>
            <span class="tp-audience">{template.audience}</span>
            <span class="tp-desc">{template.description}</span>
            {#if opening === template.id}
              <span class="tp-state">Opening…</span>
            {:else if pending === template.id}
              <span class="tp-state">Click again to replace the current project</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if error}<p class="tp-error">{error}</p>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .tp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 25000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }
  .tp-backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }

  .tp-panel {
    width: min(920px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
  }
  .tp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-0, #f2ede4);
  }
  .tp-close {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }
  .tp-close:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .tp-close:disabled { opacity: 0.35; cursor: not-allowed; }

  .tp-body {
    padding: 16px;
    overflow-y: auto;
  }
  .tp-sub { margin: 0 0 12px; color: var(--ga-ink-1, #ada9a2); }
  .tp-warn { margin: 0 0 12px; color: #f2c46d; font-size: var(--ga-text-meta); }
  .tp-error { margin: 12px 0 0; color: #ff8a80; font-size: var(--ga-text-meta); }
  .tp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .tp-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    font: inherit;
    padding: 0 0 12px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-tile, 7px);
    overflow: hidden;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.12s;
  }
  .tp-card:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .tp-card.confirm { border-color: #f2c46d; }
  .tp-card:disabled { cursor: progress; opacity: 0.7; }
  .tp-card img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: #000;
    margin-bottom: 8px;
  }
  .tp-name { padding: 0 12px; font-weight: var(--ga-weight-title); font-size: var(--ga-text-title); color: var(--ga-ink-0, #f2ede4); }
  .tp-audience { padding: 0 12px 4px; font-size: var(--ga-text-meta); color: var(--ga-blue-300, #8aa4ff); }
  .tp-desc { padding: 0 12px; font-size: var(--ga-text-meta); line-height: 1.45; color: var(--ga-ink-2, #89857e); }
  .tp-state { padding: 6px 12px 0; font-size: var(--ga-text-meta); color: #f2c46d; }
</style>
