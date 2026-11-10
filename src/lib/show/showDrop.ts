/**
 * The dropEffect the show tray answers a drag with.
 *
 * The browser refuses a drop whose dropEffect the drag source did not allow,
 * so it has to follow `effectAllowed`. The media tray drags with 'move' in
 * mapping mode while preset cards and files allow a copy; answering 'copy'
 * to everything made every media-tray drop onto the show bounce.
 */
export function showDropEffect(effectAllowed: string | null | undefined): 'copy' | 'move' | 'link' | 'none' {
  const allowed = String(effectAllowed ?? 'uninitialized');
  if (allowed === 'none') return 'none';
  if (allowed === 'all' || allowed === 'uninitialized' || allowed.toLowerCase().includes('copy')) return 'copy';
  if (allowed.toLowerCase().includes('move')) return 'move';
  if (allowed.toLowerCase().includes('link')) return 'link';
  return 'copy';
}
