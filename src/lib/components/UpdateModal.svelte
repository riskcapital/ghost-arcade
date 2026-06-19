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
  <div class="update-modal-backdrop" onclick={close}>
    <div class="update-modal" onclick={(e) => e.stopPropagation()}>
      <div class="update-modal-header">
        <div>
          <div class="update-eyebrow">Update available</div>
          <h2>Ghost Arcade v{$updateInfo.latestVersion}</h2>
          <p class="update-version-line">You have v{$updateInfo.currentVersion}</p>
        </div>
        <button class="update-close" onclick={close} aria-label="Close">x</button>
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
        <button class="update-secondary" onclick={close}>Maybe Later</button>
        <button class="update-primary" onclick={openDownloadPage}>Open Download Page</button>
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
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .update-modal {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid rgba(126, 200, 227, 0.18);
    border-radius: 8px;
    width: 100%;
    max-width: 640px;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .update-modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 24px 28px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .update-eyebrow {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #7EC8E3;
    margin-bottom: 4px;
  }

  .update-modal-header h2 {
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 4px;
    color: #fff;
  }

  .update-version-line {
    font-size: 14px;
    color: var(--text-muted, #888);
    margin: 0;
  }

  .update-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .update-close:hover {
    background: rgba(255, 50, 50, 0.25);
    color: #fff;
  }

  .update-modal-body {
    padding: 18px 28px 16px;
    overflow-y: auto;
    flex: 1;
  }

  .update-notes-heading {
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary, #aaa);
    margin: 0 0 14px;
  }

  .update-highlights {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .update-highlights li {
    position: relative;
    padding: 12px 14px 12px 34px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.035);
    color: #d8d8d8;
    font-size: 14px;
    line-height: 1.48;
  }

  .update-highlights li::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 18px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: linear-gradient(135deg, #FF8577, #7EC8E3);
    box-shadow: 0 0 12px rgba(126, 200, 227, 0.45);
  }

  .update-page-copy,
  .update-no-notes {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-muted, #888);
    margin: 14px 0 0;
  }

  .update-no-notes {
    font-style: italic;
    margin-top: 0;
  }

  .update-modal-footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 16px 28px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .update-link {
    appearance: none;
    background: transparent;
    border: none;
    color: #7EC8E3;
    font-size: 14px;
    text-decoration: none;
    margin-right: auto;
    cursor: pointer;
    padding: 0;
  }
  .update-link:hover { text-decoration: underline; }

  .update-secondary {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 15px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .update-secondary:hover {
    border-color: rgba(255, 255, 255, 0.3);
    color: #fff;
  }

  .update-primary {
    padding: 8px 18px;
    background: linear-gradient(90deg, #FF8577, #7EC8E3);
    border: none;
    border-radius: 4px;
    color: #0a0a0a;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .update-primary:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

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
