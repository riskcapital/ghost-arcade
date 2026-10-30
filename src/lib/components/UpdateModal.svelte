<script lang="ts">
  /**
   * UpdateModal — shown when a newer release is available.
   *
   * The app no longer downloads installers internally. Signed installers,
   * notarized DMGs, platform notes, and fallback links all live on the public
   * download page, which is the most reliable handoff from inside Electron.
  */

  import { openExternalUrl } from '../bridge';
  import { CHANGELOG_PAGE_URL, DOWNLOAD_PAGE_URL } from '../releaseNotes';
  import { updateInfo } from '../stores/updateChecker';

  export let open = false;
  export let onClose: () => void = () => {};

  function openDownloadPage() {
    openExternalUrl($updateInfo.downloadPageUrl || DOWNLOAD_PAGE_URL);
  }

  function openChangelog() {
    openExternalUrl($updateInfo.changelogUrl || CHANGELOG_PAGE_URL);
  }

  function close() {
    onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div data-help-page="troubleshooting" class="update-modal-backdrop" onclick={close}>
    <div class="update-modal" onclick={(e) => e.stopPropagation()}>
      <div class="update-modal-header modal-header">
        <div>
          <div class="update-eyebrow">Update available</div>
          <h2>Ghost Arcade Pro {$updateInfo.latestVersion}</h2>
          <p class="update-version-line">You have v{$updateInfo.currentVersion}</p>
        </div>
        <button class="update-close" onclick={close} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      </div>

      <div class="update-modal-body">
        <h3 class="update-notes-heading">{$updateInfo.releaseTitle || "What's new"}</h3>

        {#if $updateInfo.releaseHighlights?.length}
          <ul class="update-highlights">
            {#each $updateInfo.releaseHighlights as item}
              <li>{item}</li>
            {/each}
          </ul>
        {:else if $updateInfo.releaseNotes}
          <p class="update-no-notes">{$updateInfo.releaseNotes}</p>
        {:else}
          <p class="update-no-notes">Open the download page for the latest signed installers and release notes.</p>
        {/if}

        <p class="update-page-copy">
          The download page always points at the current signed installers and notarized macOS builds.
        </p>
      </div>

      <div class="update-modal-footer">
        <button class="update-link" onclick={openChangelog}>Full changelog</button>
        <button class="update-secondary secondary-btn" onclick={close}>Maybe later</button>
        <button class="update-primary primary-btn" onclick={openDownloadPage}>Open download page</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .update-modal-backdrop {
    position: fixed;
    inset: 0;
    /* Above SettingsPanel (z-index 200000) so "Check for updates" can
       surface the modal from inside settings. */
    z-index: 200001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .update-modal-backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }

  .update-modal {
    width: 100%;
    max-width: 600px;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
  }

  .update-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .update-eyebrow {
    margin-bottom: 2px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }

  .update-modal-header h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-0, #f2ede4);
  }

  .update-version-line {
    margin: 2px 0 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }

  .update-close {
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
  .update-close:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .update-close:disabled { opacity: 0.35; cursor: not-allowed; }

  .update-modal-body {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  .update-notes-heading {
    margin: 0 0 8px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }

  .update-highlights {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .update-highlights li {
    position: relative;
    padding: 10px 12px 10px 28px;
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
    color: var(--ga-ink-0, #f2ede4);
    line-height: 1.5;
  }

  .update-highlights li::before {
    content: '';
    position: absolute;
    left: 12px;
    top: 17px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ga-selection-line, #5278ff);
  }

  .update-page-copy,
  .update-no-notes {
    margin: 12px 0 0;
    font-size: var(--ga-text-meta);
    line-height: 1.5;
    color: var(--ga-ink-2, #89857e);
  }

  .update-no-notes {
    margin-top: 0;
    font-size: var(--ga-text-body);
    color: var(--ga-ink-1, #ada9a2);
  }

  .update-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .update-link {
    margin-right: auto;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--ga-ink-2, #89857e);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .update-link:hover { color: var(--ga-ink-0, #f2ede4); text-decoration: underline; }

  .update-secondary,
  .update-primary {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--ga-bar-control-h);
    padding: 0 14px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, filter 0.12s;
  }
  .update-secondary {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .update-secondary:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .update-primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .update-primary:hover:not(:disabled) { filter: brightness(1.06); }
  .update-secondary:disabled,
  .update-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 620px) {
    .update-modal-footer {
      align-items: stretch;
      flex-direction: column;
    }

    .update-link {
      margin-right: 0;
      align-self: flex-start;
      margin-bottom: 6px;
    }

    .update-secondary,
    .update-primary {
      width: 100%;
    }
  }
</style>
