<script lang="ts">
  /** Title bar of the Interactive Studio editor, plus the phone's output strip. */
  import Icon from './StudioIcon.svelte';

  export let engineLabel = 'Mobile';
  export let outputActive = false;
  export let handheld = false;
  export let nativeOutput = false;
  export let fullScreen = false;
  /** Phone only: show which display the scene is going to. */
  export let showOutputStatus = false;
  export let outputLabel = '';

  export let ontimeline: (() => void) | undefined = undefined;
  export let onoutput: () => void;
  export let onfullscreen: () => void;
  export let onclose: () => void;
  export let onoutputsettings: (() => void) | undefined = undefined;

  $: outputButton = outputActive
    ? '■ Stop'
    : handheld
      ? '▶ Use output'
      : nativeOutput
        ? '▶ Launch native layer'
        : '▶ Send to output';
</script>

<header>
  <div>
    <small>GHOST ARCADE / INTERACTIVE</small>
    <h2>Interactive Studio <span class="engine-badge">{engineLabel}</span></h2>
  </div>
  <div class="header-actions">
    {#if ontimeline}<button onclick={ontimeline}>◇ Keyframes</button>{/if}
    <button class:live={outputActive} onclick={onoutput}>{outputButton}</button>
    <button
      class="fullscreen-action"
      onclick={onfullscreen}
      aria-label={fullScreen ? 'Exit full screen studio' : 'Full screen studio'}
    >
      {fullScreen ? '↙ Window' : '⛶ Full screen'}
    </button>
    <button onclick={onclose} aria-label="Return to performance controls">
      {nativeOutput && outputActive ? 'View output' : 'Back'}
    </button>
  </div>
</header>
{#if showOutputStatus}
  <div class="workspace-status">
    <span class:live={outputActive}>
      {outputActive ? 'Interactive → Output' : 'Preview only'}
      <small>{outputLabel || 'Connect a display from Output'}</small>
    </span>
    <button onclick={onoutputsettings} disabled={!onoutputsettings}><Icon name="output" size={16} />Output</button>
  </div>
{/if}
