import { openExternalUrl } from '../bridge';
import { helpContent } from './topics';
import './contextHelp.css';
import { tooltipsEnabled } from './preferences';

const controls = 'button, input:not([type="hidden"]), select, textarea, summary, a[href], [role="button"], [role="slider"], [role="tab"], [data-help], [title]';

/** One delegated listener set, no per-frame work or subtree observers. */
export function installContextHelp() {
  const card = document.createElement('div');
  card.className = 'ga-context-help';
  card.id = 'ga-context-help';
  card.hidden = true;
  card.setAttribute('popover', 'manual');
  // Interactive help contains a link: it is a non-modal dialog, not an ARIA tooltip.
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Control help');
  const heading = document.createElement('strong');
  const body = document.createElement('p');
  body.id = 'ga-context-help-description';
  const link = document.createElement('a');
  link.textContent = 'Read documentation ↗';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const hint = document.createElement('small');
  hint.textContent = 'F1: focus help · Esc: dismiss';
  card.append(heading, body, link, hint);
  document.body.append(card);
  let owner: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let originalTitle: string | null = null;
  let priorDescription: string | null = null;
  let dragging = false;

  let enabled = true;
  const unsubscribePreference = tooltipsEnabled.subscribe(value => { enabled = value; hide(); });

  function hide() {
    clearTimeout(timer); clearTimeout(hideTimer);
    if (card.matches(':popover-open')) card.hidePopover();
    card.hidden = true;
    if (owner) {
      if (originalTitle !== null && !owner.hasAttribute('title')) owner.setAttribute('title', originalTitle);
      if (priorDescription === null) owner.removeAttribute('aria-describedby');
      else owner.setAttribute('aria-describedby', priorDescription);
    }
    owner = null; originalTitle = null; priorDescription = null;
  }
  function show(target: HTMLElement) {
    if (!enabled || !target.isConnected || dragging || document.hidden) return;
    const input = target as HTMLInputElement;
    const labelText = (label: Element) => {
      const copy = label.cloneNode(true) as Element;
      copy.querySelectorAll('input, select, textarea, button, output').forEach(node => node.remove());
      return copy.textContent?.trim() || '';
    };
    const labels = input.labels ? Array.from(input.labels).map(labelText).join(' ').trim() : '';
    const siblingLabel = target.parentElement?.querySelector(':scope > label, :scope > .label, :scope > .ni-label');
    const nearbyLabel = siblingLabel ? labelText(siblingLabel) : '';
    const ownText = target.matches('select, input, textarea') ? '' : target.textContent?.trim();
    const title = originalTitle || '';
    const label = target.dataset.helpLabel || target.getAttribute('aria-label') || target.dataset.midiLabel || labels || (title.length <= 100 ? title : '') || ownText || nearbyLabel || input.placeholder || '';
    const page = target.closest<HTMLElement>('[data-help-page]')?.dataset.helpPage;
    const explicit = target.dataset.help;
    const data = helpContent(title || label, page, explicit || (title && title !== label ? title : ''));
    if (!explicit && !title && label && data.description === helpContent('', page).description) {
      const action = target.matches('select') ? `Choose ${label.toLowerCase()} from the available options.`
        : input.type === 'checkbox' ? `Turn ${label.toLowerCase()} on or off.`
        : target.matches('input[type="range"], input[type="number"]') ? `Adjust ${label.toLowerCase()}.`
        : target.matches('input, textarea') ? `Enter ${label.toLowerCase()}.`
        : `Use ${label} in ${helpContent('', page).title.toLowerCase()}.`;
      data.description = `${action} ${data.description}`;
    }
    heading.textContent = (label || title || data.title).slice(0, 160);
    body.textContent = data.description;
    link.href = data.href;
    target.setAttribute('aria-describedby', [priorDescription, body.id].filter(Boolean).join(' '));
    card.hidden = false;
    if (!card.matches(':popover-open') && typeof card.showPopover === 'function') card.showPopover();
    card.scrollTop = 0; card.scrollLeft = 0;
    const rect = target.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    card.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - width - 10))}px`;
    card.style.top = `${Math.max(10, rect.bottom + height + 10 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6)}px`;
  }
  function begin(target: HTMLElement, immediate = false) {
    if (owner === target) {
      if (immediate) { clearTimeout(timer); show(target); }
      return;
    }
    hide(); owner = target;
    originalTitle = target.getAttribute('title');
    priorDescription = target.getAttribute('aria-describedby');
    if (originalTitle !== null) target.removeAttribute('title');
    if (immediate) show(target);
    else timer = setTimeout(() => show(target), 650);
  }
  function find(event: Event) {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || card.contains(el) || el.closest('[data-help-disabled]')) return null;
    return el.closest<HTMLElement>(controls);
  }
  function over(event: PointerEvent) {
    if (event.pointerType === 'touch' || event.buttons || dragging) return;
    if (card.contains(event.target as Node)) { clearTimeout(hideTimer); return; }
    const target = find(event);
    if (target) { clearTimeout(hideTimer); begin(target); }
  }
  function leave(event: PointerEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && (card.contains(next) || owner?.contains(next))) return;
    clearTimeout(timer);
    hideTimer = setTimeout(hide, 250);
  }
  function focus(event: FocusEvent) {
    if (card.contains(event.target as Node)) { clearTimeout(hideTimer); return; }
    const target = find(event);
    if (target && !dragging) begin(target);
  }
  function focusOut(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && (card.contains(event.relatedTarget) || owner?.contains(event.relatedTarget))) return;
    hide();
  }
  function down(event: PointerEvent) {
    if (card.contains(event.target as Node)) return;
    dragging = true; hide();
  }
  function up() { dragging = false; }
  function blur() { dragging = false; hide(); }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && owner && !card.hidden) {
      const returnFocus = card.contains(document.activeElement);
      const target = owner;
      hide(); if (returnFocus) { target.focus({ preventScroll: true }); hide(); }
      // Escape in an editor must still cancel its edit (and in a tray close
      // the tray). Consume it only when focus is inside the help itself.
      if (returnFocus) { event.preventDefault(); event.stopPropagation(); }
    } else if (event.key === 'F1' && enabled) {
      const target = owner || (document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(controls) : null);
      if (target && !card.contains(target)) { event.preventDefault(); event.stopPropagation(); begin(target, true); link.focus(); }
    } else if (!card.contains(event.target as Node)) hide();
  }
  function scroll(event: Event) { if (!card.contains(event.target as Node)) hide(); }
  link.addEventListener('click', event => { event.preventDefault(); void openExternalUrl(link.href); hide(); });
  document.addEventListener('pointerover', over);
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', focusOut);
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', hide);
  return () => {
    unsubscribePreference(); hide(); card.remove();
    document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', leave);
    document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focusOut);
    document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true); document.removeEventListener('keydown', key, true);
    document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', hide);
    window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hide);
  };
}
