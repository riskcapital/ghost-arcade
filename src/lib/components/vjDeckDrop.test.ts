import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const panel = readFileSync('src/lib/components/VJModePanel.svelte', 'utf8');
const handler = ts.transpile(panel.slice(panel.indexOf('  function handleCellDrop('), panel.indexOf('  // Click on clip cell to trigger')), { target: ts.ScriptTarget.ES2022 });
const shader = { id: 'StarDrift', name: 'StarDrift', src: 'StarDrift.fs', thumbnail: 'StarDrift.jpg', shaderCode: 'void main() { /* animated */ }', values: { speed: 2 } };
function harness(draggedClip: any = null, tray: any = null) {
  const setClip = vi.fn(), importFiles = vi.fn();
  const context: any = { draggedClip, dragSourceCell: null, dragOverCell: null,
    isLockedPlayingCell: () => false, importDroppedFilesToDeck: importFiles,
    mediaTrayPayloadFromDataTransfer: () => tray,
    createVJClipFromMediaTrayPayload: (payload: any) => ({ ...payload, id: 'new' }),
    vjClipLauncher: { setClip, setSelectedDeck: vi.fn() }, $vjClipLauncher: { crossfaderEnabled: true },
    shaders: [shader], savedShaders: [], $mediaLibrary: [], threejsItems: [], generateUUID: () => 'new' };
  vm.runInNewContext(handler, context);
  return { context, setClip, importFiles };
}
function event(payload = '') {
  return { preventDefault() {}, stopPropagation() {}, dataTransfer: {
    files: [{ name: 'StarDrift.jpg', type: 'image/jpeg' }],
    getData: (type: string) => type === 'application/x-ghost-vj-clip' ? payload : '',
  } };
}
it.each(['A', 'B'])('keeps a dragged catalog shader animated on deck %s despite a thumbnail file', bank => {
  const h = harness({ type: 'shader', id: shader.id });
  h.context.handleCellDrop(event(), 0, 1, bank);
  expect(h.importFiles).not.toHaveBeenCalled();
  expect(h.setClip).toHaveBeenCalledWith(0, 1, expect.objectContaining({ type: 'shader', shaderCode: shader.shaderCode, shaderValues: { speed: 2 } }), bank);
});
it.each(['A', 'B'])('prefers a serialized clip payload over Windows image files on deck %s', bank => {
  const h = harness();
  h.context.handleCellDrop(event(JSON.stringify({ type: 'shader', id: shader.id })), 0, 0, bank);
  expect(h.importFiles).not.toHaveBeenCalled();
  expect(h.setClip).toHaveBeenCalledWith(0, 0, expect.objectContaining({ type: 'shader', shaderCode: shader.shaderCode }), bank);
});
it('preserves the media tray shader payload', () => {
  const h = harness(null, { ...shader, type: 'shader' });
  h.context.handleCellDrop(event(), 0, 0, 'B');
  expect(h.importFiles).not.toHaveBeenCalled();
  expect(h.setClip).toHaveBeenCalledWith(0, 0, expect.objectContaining({ type: 'shader', shaderCode: shader.shaderCode }), 'B');
});
it('still imports a real external image file', () => {
  const h = harness(); const e = event();
  h.context.handleCellDrop(e, 0, 0, 'B');
  expect(h.importFiles).toHaveBeenCalledWith(e.dataTransfer.files, 0, 0, 'B');
  expect(h.setClip).not.toHaveBeenCalled();
});
