<script lang="ts">
  /**
   * An "i" (or "?") button that opens a short note beside it. How-to text lives here instead of in
   * paragraphs under the controls, so a panel shows its controls and one line of state.
   * Closes on a tap anywhere else, Escape, the close button, a scroll or a rotation.
   * VoiceOver reads the button as its label and the note as a dialog of that name.
   */
  import { onDestroy, tick, type Snippet } from 'svelte';
  import Icon from '../StudioIcon.svelte';

  let {
    label,
    title = '',
    text = '',
    glyph = 'info',
    children,
  }: {
    /** What the button is for, read by VoiceOver: "How the clip grid works". */
    label: string;
    /** A heading inside the note. */
    title?: string;
    /** The note, when it is one string. */
    text?: string;
    glyph?: 'info' | 'help';
    children?: Snippet;
  } = $props();

  const id = `ga-tip-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  let button: HTMLButtonElement;
  let note: HTMLDivElement | undefined = $state();
  let place = $state({ left: 12, top: -9999, width: 300, arrow: 150, above: false });

  /** A note opened inside a modal dialog has to stay inside it, or the dialog makes it inert. */
  function portal(node: HTMLElement) {
    const host = button?.closest('dialog[open]') ?? document.body;
    host.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  async function position() {
    if (!button) return;
    const r = button.getBoundingClientRect();
    const width = Math.min(320, innerWidth - 24);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), innerWidth - width - 12);
    place = { ...place, left, width, arrow: Math.min(width - 18, Math.max(18, r.left + r.width / 2 - left)) };
    await tick();
    const h = note?.offsetHeight ?? 120;
    const above = r.bottom + 6 + h > innerHeight - 12 && r.top - 6 - h >= 12;
    const top = above ? r.top - 6 - h : Math.min(r.bottom + 6, innerHeight - h - 12);
    place = { ...place, top: Math.max(12, top), above };
  }
  async function show() {
    open = true;
    await tick();
    await position();
    note?.focus({ preventScroll: true });
    addEventListener('pointerdown', outside, true);
    addEventListener('scroll', scrolled, true);
    addEventListener('resize', dismiss);
  }
  function hide(returnFocus = false) {
    if (!open) return;
    open = false;
    removeEventListener('pointerdown', outside, true);
    removeEventListener('scroll', scrolled, true);
    removeEventListener('resize', dismiss);
    if (returnFocus) button?.focus({ preventScroll: true });
  }
  const dismiss = () => hide();
  function outside(e: PointerEvent) {
    const target = e.target as Node | null;
    if (target && (note?.contains(target) || button?.contains(target))) return;
    hide();
  }
  function scrolled(e: Event) {
    if (note && e.target instanceof Node && note.contains(e.target)) return;
    hide();
  }
  function key(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Only the note closes, not a sheet or dialog it sits in.
    e.preventDefault();
    e.stopPropagation();
    hide(true);
  }
  onDestroy(() => hide());
</script>

<button
  bind:this={button}
  type="button"
  class="ga-info"
  class:open
  aria-label={label}
  aria-expanded={open}
  aria-controls={open ? id : undefined}
  onclick={() => (open ? hide() : void show())}><span class="ring"><Icon name={glyph} size={18} /></span></button>
{#if open}
  <div
    use:portal
    bind:this={note}
    {id}
    class="ga-info-note"
    class:above={place.above}
    role="dialog"
    aria-label={title || label}
    tabindex="-1"
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    style:width={`${place.width}px`}
    style:--arrow={`${place.arrow}px`}
    onkeydown={key}>
    <div class="text">
      {#if title}<strong>{title}</strong>{/if}
      {#if text}<p>{text}</p>{/if}
      {@render children?.()}
    </div>
    <button type="button" class="close" aria-label="Close" onclick={() => hide(true)}><Icon name="close" size={16} /></button>
  </div>
{/if}

<style>
  .ga-info {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    box-shadow: none;
    color: var(--ga-blue-300);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .ring {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--ga-blue-a08);
    transition: background-color 0.15s;
  }
  .ga-info.open .ring,
  .ga-info:active .ring {
    background: var(--ga-blue-a28);
  }
  .ga-info:focus-visible {
    outline: 2px solid var(--ga-focus);
    outline-offset: -2px;
  }
  .ga-info-note {
    position: fixed;
    z-index: 1000;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: start;
    gap: 2px;
    padding: 10px 2px 12px 14px;
    border: 1px solid var(--ga-blue-a45);
    border-radius: 12px;
    background: linear-gradient(180deg, #1a1d2b, #12141d);
    box-shadow: 0 14px 40px #000c, 0 0 0 1px #0008;
    color: var(--ga-ink-0);
    font: 400 13px/1.5 var(--ga-font-ui, system-ui, -apple-system, sans-serif);
    text-align: left;
    -webkit-user-select: text;
    user-select: text;
  }
  .ga-info-note::before {
    content: '';
    position: absolute;
    top: -7px;
    left: calc(var(--arrow) - 6px);
    width: 12px;
    height: 12px;
    transform: rotate(45deg);
    border: 1px solid var(--ga-blue-a45);
    border-right: 0;
    border-bottom: 0;
    background: #1a1d2b;
  }
  .ga-info-note.above::before {
    top: auto;
    bottom: -7px;
    transform: rotate(225deg);
    background: #12141d;
  }
  .ga-info-note:focus {
    outline: none;
  }
  .ga-info-note:focus-visible {
    outline: 2px solid var(--ga-focus);
    outline-offset: 2px;
  }
  .text {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding-top: 4px;
  }
  .text strong {
    font-size: 14px;
    font-weight: 650;
  }
  .text p,
  .text :global(p) {
    margin: 0;
    color: var(--ga-ink-1);
  }
  .text :global(ul),
  .text :global(ol) {
    margin: 0;
    padding-left: 18px;
    color: var(--ga-ink-1);
  }
  .text :global(li + li) {
    margin-top: 4px;
  }
  .text :global(b) {
    color: var(--ga-ink-0);
    font-weight: 600;
  }
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    min-height: 44px;
    margin: -8px 0 0;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    color: var(--ga-ink-1);
    cursor: pointer;
  }
  .close:focus-visible {
    outline: 2px solid var(--ga-focus);
    outline-offset: -4px;
  }
</style>
