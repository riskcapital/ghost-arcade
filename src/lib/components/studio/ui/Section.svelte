<script lang="ts" module>
  /** What a group does. Each has its own icon tint; `deck` (playing clips) is the app's blue. */
  export type SectionTone = 'deck' | 'map' | 'output' | 'audio' | 'fx' | 'neutral';
</script>

<script lang="ts">
  /**
   * One group of controls that belong together: an outlined box with a header (icon, title, an
   * optional "i" note and header actions). Panels are built from these so it is clear which
   * controls go together and what each group is for.
   */
  import type { Snippet } from 'svelte';
  import Icon from '../StudioIcon.svelte';
  import InfoTip from './InfoTip.svelte';

  let {
    title,
    icon = '',
    tone = 'deck',
    subtitle = '',
    info,
    infoLabel = '',
    actions,
    children,
    flush = false,
    plain = false,
    id = '',
    class: className = '',
    ...rest
  }: {
    title: string;
    /** A StudioIcon name. */
    icon?: string;
    tone?: SectionTone;
    /** Short state beside the title ("3 surfaces", "Surface 2"). */
    subtitle?: string;
    /** The how-to note behind the "i" button: a sentence, or richer content. */
    info?: string | Snippet;
    infoLabel?: string;
    /** Buttons at the right of the header. */
    actions?: Snippet;
    children?: Snippet;
    /** No inner padding, for a grid that runs to the edges. */
    flush?: boolean;
    /** No box: just the header and a rule, for a group inside a group. */
    plain?: boolean;
    id?: string;
    class?: string;
    [attr: string]: unknown;
  } = $props();

  const headingId = `ga-section-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section {...rest} id={id || undefined} class={`ga-section ${className}`} class:flush class:plain data-tone={tone} aria-labelledby={headingId}>
  <header class="ga-section-head">
    {#if icon}<span class="chip" aria-hidden="true"><Icon name={icon} size={16} /></span>{/if}
    <h3 id={headingId}><span class="title">{title}</span>{#if subtitle}<small>{subtitle}</small>{/if}</h3>
    {#if info}
      {#if typeof info === 'string'}<InfoTip label={infoLabel || `About ${title}`} {title} text={info} />
      {:else}<InfoTip label={infoLabel || `About ${title}`} {title}>{@render info()}</InfoTip>{/if}
    {/if}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  <div class="ga-section-body">{@render children?.()}</div>
</section>

<style>
  .ga-section {
    --tone: var(--ga-tone-deck);
    --tone-soft: var(--ga-tone-deck-soft);
    min-width: 0;
    margin: 0 0 var(--ga-space-3);
    border: 1px solid var(--ga-section-line);
    border-radius: var(--ga-r-section);
    background: var(--ga-section-bg);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }
  .ga-section[data-tone='map'] { --tone: var(--ga-tone-map); --tone-soft: var(--ga-tone-map-soft); }
  .ga-section[data-tone='output'] { --tone: var(--ga-tone-output); --tone-soft: var(--ga-tone-output-soft); }
  .ga-section[data-tone='audio'] { --tone: var(--ga-tone-audio); --tone-soft: var(--ga-tone-audio-soft); }
  .ga-section[data-tone='fx'] { --tone: var(--ga-tone-fx); --tone-soft: var(--ga-tone-fx-soft); }
  .ga-section[data-tone='neutral'] { --tone: var(--ga-tone-neutral); --tone-soft: var(--ga-tone-neutral-soft); }
  .ga-section-head {
    display: flex;
    align-items: center;
    gap: var(--ga-space-2);
    min-height: 48px;
    padding: 2px var(--ga-space-1) 2px var(--ga-space-3);
    border-bottom: 1px solid var(--ga-section-head-line);
    border-radius: calc(var(--ga-r-section) - 1px) calc(var(--ga-r-section) - 1px) 0 0;
    background: linear-gradient(90deg, var(--tone-soft), transparent 75%);
  }
  .chip {
    --ga-icon-tone: var(--tone);
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--tone-soft);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: var(--ga-space-2);
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--ga-text-label);
    font-weight: 650;
    line-height: 1.25;
    letter-spacing: 0.01em;
    color: var(--ga-ink-0);
  }
  .title {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h3 small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ga-text-caption);
    font-weight: 500;
    color: var(--ga-ink-2);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--ga-space-1);
    flex: none;
    margin-right: var(--ga-space-1);
  }
  .ga-section-body {
    min-width: 0;
    padding: var(--ga-space-3);
  }
  .flush > .ga-section-body {
    padding: var(--ga-space-1);
  }
  .plain {
    margin: var(--ga-space-4) 0 0;
    border: 0;
    border-top: 1px solid var(--ga-section-head-line);
    border-radius: 0;
    background: none;
    box-shadow: none;
  }
  .plain > .ga-section-head {
    min-height: 44px;
    padding: var(--ga-space-2) 0 0;
    border: 0;
    border-radius: 0;
    background: none;
  }
  .plain > .ga-section-head .chip {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }
  .plain > .ga-section-head h3 {
    font-size: var(--ga-text-body);
  }
  .plain > .ga-section-body {
    padding: var(--ga-space-2) 0 0;
  }
</style>
