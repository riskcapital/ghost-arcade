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
      <button class="tp-close" aria-label="Close templates" onclick={() => onboarding.closeTemplates()}>&times;</button>
      <h2 id="tp-title">Start from a template</h2>
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
{/if}

<style>
  .tp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 25000;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }
  .tp-panel {
    position: relative;
    width: min(920px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    box-sizing: border-box;
    background: #14161b;
    border: 1px solid #30343d;
    border-radius: 14px;
    padding: 24px;
    color: var(--text-primary, #e6e6e6);
  }
  .tp-close {
    position: absolute;
    top: 10px;
    right: 12px;
    background: none;
    border: none;
    color: #8a93a3;
    font-size: 24px;
    cursor: pointer;
  }
  h2 { margin: 0 0 6px; font-size: 20px; }
  .tp-sub { margin: 0 0 14px; color: #a9afbb; font-size: 13px; }
  .tp-warn { margin: 0 0 14px; color: #f2c46d; font-size: 12px; }
  .tp-error { margin: 14px 0 0; color: #ff8a80; font-size: 12px; }
  .tp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .tp-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    font: inherit;
    padding: 0 0 12px;
    background: #1b1e25;
    border: 1px solid #2f343e;
    border-radius: 10px;
    overflow: hidden;
    color: inherit;
    cursor: pointer;
  }
  .tp-card:hover:not(:disabled), .tp-card.confirm { border-color: var(--ga-blue-200, #9ec5ff); }
  .tp-card:disabled { cursor: progress; opacity: 0.7; }
  .tp-card img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: #000;
    margin-bottom: 6px;
  }
  .tp-name { padding: 0 12px; font-weight: 700; font-size: 14px; }
  .tp-audience { padding: 0 12px; font-size: 11px; color: var(--ga-blue-200, #9ec5ff); }
  .tp-desc { padding: 0 12px; font-size: 12px; line-height: 1.45; color: #a9afbb; }
  .tp-state { padding: 4px 12px 0; font-size: 11px; color: #f2c46d; }
</style>
