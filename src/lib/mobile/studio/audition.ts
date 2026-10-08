// Preview of a visual in the clip picker, before it is put on the deck.
//
// The preview is drawn by its own small renderer on its own canvas. It never touches the layers
// or the output, so trying visuals during a show is safe. One renderer is reused while the picker
// is open and its GPU context is released when the picker closes.
import { StandaloneRenderer } from '../standaloneRenderer';
import { findShader } from '../standaloneShaderList';
import { shaderSource } from './engine';

/** Preview size in pixels: small enough to run beside a playing set. */
export const AUDITION_SIZE = { width: 480, height: 270 };

export class ShaderAudition {
  private renderer?: StandaloneRenderer;
  private request = 0;
  private raf = 0;
  private dead = false;
  /** The id being shown, or null while nothing has loaded. */
  current: string | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  /** Shows `id`. Resolves true when it is on screen; a newer call wins over an older one. */
  async show(id: string): Promise<boolean> {
    const request = ++this.request;
    const shader = findShader(id);
    if (!shader) throw new Error('This visual is not available on this device.');
    const source = await shaderSource(id);
    if (this.dead || request !== this.request) return false;
    this.renderer ??= new StandaloneRenderer(this.canvas);
    await this.renderer.loadShaderSource(source, shader.audioNative, shader.audioInject);
    if (this.dead || request !== this.request) return false;
    this.current = id;
    if (!this.raf) this.loop();
    return true;
  }

  private loop = () => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    // Hidden canvases (another picker tab) are not drawn.
    if (this.canvas.clientWidth) this.renderer?.drawFrame(AUDITION_SIZE.width, AUDITION_SIZE.height);
  };

  /** Stops drawing and gives the GPU context back. The object cannot be used afterwards. */
  destroy(): void {
    this.dead = true;
    this.request++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try { this.renderer?.destroy(); } catch { /* the context may already be gone */ }
    this.renderer = undefined;
    // iOS keeps only a few WebGL contexts alive; release this one now instead of at garbage collection.
    try { this.canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* nothing to release */ }
  }
}

/** Search over the picker's visuals: every word must be in the name or the category. */
export function searchVisuals<T extends { name: string; category: string }>(items: T[], category: string, search: string): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((s) => (category === 'all' || s.category === category) && words.every((w) => s.name.toLowerCase().includes(w) || s.category.toLowerCase().includes(w)));
}
