<script lang="ts">
  import { t } from '../i18n';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Preset = { id: string; name: string; _scope?: string; [key: string]: any };

  export let allPresets: Preset[] = [];
  export let activePresetId: string | null = null;
  export let onSave: (name: string, scope: 'project' | 'global') => void;
  export let onLoad: (preset: Preset) => void;
  export let onDelete: (id: string) => void;
  // Overwrite an existing preset with the current keyboard state. Right-click
  // a preset chip to fire this — saves the user from delete + re-save when
  // iterating on a preset under the same name.
  export let onUpdate: ((preset: Preset) => void) | null = null;
  export let onRename: ((preset: Preset, newName: string) => void) | null = null;

  let showNameInput = false;
  let nameInput = '';
  let saveScope: 'project' | 'global' = 'project';

  // Right-click context menu state — fixed-position menu, viewport-relative.
  let presetCtxMenu: { x: number; y: number; preset: Preset } | null = null;

  function handleSave(name: string) {
    onSave(name, saveScope);
    showNameInput = false;
    nameInput = '';
  }

  function openPresetCtx(e: MouseEvent, preset: Preset) {
    e.preventDefault();
    presetCtxMenu = { x: e.clientX, y: e.clientY, preset };
  }
  function closePresetCtx() { presetCtxMenu = null; }
  function ctxUpdate() {
    if (!presetCtxMenu) return;
    onUpdate?.(presetCtxMenu.preset);
    presetCtxMenu = null;
  }
  function ctxRename() {
    if (!presetCtxMenu) return;
    const newName = prompt($t('shaderAi.presets.renamePrompt'), presetCtxMenu.preset.name);
    if (newName && newName.trim() && onRename) {
      onRename(presetCtxMenu.preset, newName.trim());
    }
    presetCtxMenu = null;
  }
  function ctxDelete() {
    if (!presetCtxMenu) return;
    if (confirm($t('shaderAi.presets.deleteConfirm', { values: { name: presetCtxMenu.preset.name } }))) {
      onDelete(presetCtxMenu.preset.id);
    }
    presetCtxMenu = null;
  }
</script>

<div class="sv-preset-bar">
  <div class="sv-preset-left">
    {#if showNameInput}
      <input class="sv-preset-input" type="text" placeholder={$t('shaderAi.presets.namePlaceholder')}
        aria-label={$t('shaderAi.presets.namePlaceholder')}
        bind:value={nameInput}
        on:keydown={(e) => { if (e.key === 'Enter') handleSave(nameInput); if (e.key === 'Escape') { showNameInput = false; nameInput = ''; } }} />
      <button class="sv-scope-toggle"
        class:global={saveScope === 'global'}
        on:click={() => (saveScope = saveScope === 'project' ? 'global' : 'project')}
        title={saveScope === 'project' ? $t('shaderAi.presets.projectScopeTitle')
          : $t('shaderAi.presets.globalScopeTitle')}
        aria-label={saveScope === 'project'
          ? $t('shaderAi.presets.projectScopeTitle')
          : $t('shaderAi.presets.globalScopeTitle')}>
        {saveScope === 'project' ? '\u{1F4C1}' : '\u{1F310}'}
      </button>
      <button class="sv-preset-save-confirm" on:click={() => handleSave(nameInput)}
        aria-label={$t('shaderAi.presets.confirm')}>{$t('shaderAi.presets.confirm')}</button>
      <button class="sv-preset-save-cancel" on:click={() => { showNameInput = false; nameInput = ''; }}
        aria-label={$t('shaderAi.presets.cancel')}>X</button>
    {:else}
      <button class="sv-preset-save-btn" on:click={() => { showNameInput = true; }}>{$t('shaderAi.presets.save')}</button>
    {/if}
  </div>
  <div class="sv-preset-list">
    {#each allPresets as preset (preset.id)}
      <button class="sv-preset-btn" class:active={activePresetId === preset.id}
        class:global-preset={preset._scope === 'global'}
        on:click={() => onLoad(preset)}
        on:contextmenu={(e) => openPresetCtx(e, preset)}
        title={$t('shaderAi.presets.presetTitle', { values: { name: preset.name } })}
        aria-label={preset.name}
      >
        {#if preset._scope === 'global'}<span class="sv-preset-scope" title={$t('shaderAi.presets.globalPreset')}
            >G</span>{/if}{preset.name}
      </button>
    {/each}
    {#if allPresets.length === 0}
      <span class="sv-preset-hint">{$t('shaderAi.presets.noSaved')}</span>
    {/if}
  </div>
</div>

{#if presetCtxMenu}
  <div class="sv-ctx-backdrop" on:click={closePresetCtx} role="presentation"></div>
  <div class="sv-ctx-menu" style="left:{presetCtxMenu.x}px;top:{presetCtxMenu.y}px">
    {#if onUpdate}
      <button class="sv-ctx-item sv-ctx-primary" on:click={ctxUpdate}>{$t('shaderAi.presets.update')}</button>
    {/if}
    {#if onRename}
      <button class="sv-ctx-item" on:click={ctxRename}>{$t('shaderAi.presets.rename')}</button>
    {/if}
    <div class="sv-ctx-sep"></div>
    <button class="sv-ctx-item sv-ctx-danger" on:click={ctxDelete}>{$t('shaderAi.presets.delete')}</button>
  </div>
{/if}

<style>
  .sv-preset-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .sv-preset-left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .sv-preset-input {
    width: 120px;
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: var(--text-primary, #e8e8e8);
    font-size: 12px;
  }

  .sv-scope-toggle {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-secondary, #aaa);
  }
  .sv-scope-toggle.global {
    border-color: rgba(100, 200, 255, 0.3);
  }

  .sv-preset-save-btn,
  .sv-preset-save-confirm,
  .sv-preset-save-cancel {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: var(--text-primary, #ccc);
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .sv-preset-save-btn:hover,
  .sv-preset-save-confirm:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .sv-preset-list {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    flex: 1;
  }

  .sv-preset-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.1s ease;
  }
  .sv-preset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-primary, #e8e8e8);
  }
  .sv-preset-btn.active {
    background: rgba(100, 200, 255, 0.15);
    border-color: rgba(100, 200, 255, 0.3);
    color: var(--text-primary, #e8e8e8);
  }
  .sv-preset-btn.global-preset {
    border-color: rgba(200, 150, 255, 0.2);
  }

  .sv-preset-scope {
    font-size: 9px;
    margin-right: 3px;
    opacity: 0.6;
  }

  .sv-preset-hint {
    color: #555;
    font-size: 11px;
    font-style: italic;
  }

  /* Right-click context menu — Update / Rename / Delete a saved preset */
  .sv-ctx-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 9999;
  }
  .sv-ctx-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-tertiary, #1a1a1e);
    border: 1px solid #333;
    border-radius: 4px;
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0,0,0, 0.5);
  }
  .sv-ctx-item {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .sv-ctx-item:hover {
    background: rgba(255,255,255, 0.08);
    color: #fff;
  }
  .sv-ctx-primary {
    color: #ff8577;
    font-weight: 700;
  }
  .sv-ctx-primary:hover {
    background: rgba(255, 133, 119, 0.12);
    color: #ffa899;
  }
  .sv-ctx-danger { color: #ff6b6b; }
  .sv-ctx-danger:hover { background: rgba(255,80,80, 0.12); color: #ff4444; }
  .sv-ctx-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }
</style>
