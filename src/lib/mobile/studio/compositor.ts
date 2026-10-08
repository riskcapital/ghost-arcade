import { DeckCrossfade } from './crossfade';
import {PaintRenderer} from './paintRenderer';
import { EdgeLookRenderer } from './looks/renderer';
import { baseLayerGain, layerGain, type Show, type Surface, type Point } from './model';
const VERT = `attribute vec2 position; attribute vec2 uv; varying vec2 texCoord; void main(){texCoord=uv;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
const FRAG = `precision highp float;
varying vec2 texCoord; uniform sampler2D source; uniform sampler2D backdrop;
uniform int mode; uniform float gain; uniform float feather; uniform vec2 fit; uniform bool contained; uniform bool grid;
void main(){
 vec2 uv=(texCoord-.5)*fit+.5;
 vec4 s=texture2D(source,vec2(uv.x,1.-uv.y));
 if(contained && (uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)) s=vec4(0.);
 if(grid){vec2 p=texCoord*vec2(16.,9.);float line=step(.94,fract(p.x))+step(.94,fract(p.y));s=vec4(mix(vec3(.04,.075,.12),vec3(.2,.55,.9),min(line,1.)),1.);}
 float edge=min(min(texCoord.x,1.-texCoord.x),min(texCoord.y,1.-texCoord.y));
 s.a*=gain*(feather>0.?smoothstep(0.,feather,edge):1.);
 if(mode==-2)s.rgb*=gain*(feather>0.?smoothstep(0.,feather,edge):1.);
 if(mode<0){gl_FragColor=s;return;}
 vec4 b=texture2D(backdrop,vec2(texCoord.x,1.-texCoord.y)); vec3 blend=s.rgb;
 if(mode==6){gl_FragColor=vec4(mix(s.rgb,b.rgb,gain),1.);return;}
 if(mode==5){gl_FragColor=vec4(b.rgb+s.rgb*s.a,1.);return;}
 if(mode==1) blend=min(b.rgb+s.rgb,1.); if(mode==2) blend=1.-(1.-b.rgb)*(1.-s.rgb);
 if(mode==3) blend=b.rgb*s.rgb; if(mode==4) blend=abs(b.rgb-s.rgb);
 float a=s.a+b.a*(1.-s.a);
 vec3 c=((1.-s.a)*b.rgb*b.a+(1.-b.a)*s.rgb*s.a+b.a*s.a*blend)/max(a,.00001);
 gl_FragColor=vec4(c,a);
}`;
const MODES = ['normal', 'add', 'screen', 'multiply', 'difference'];

/** Exact projective quadrilateral interpolation; never clips to the original rectangle. */
export function quadPoint(c: Point[], u: number, v: number): Point {
  const [a, b, d, e] = c;
  const dx1 = b.x - d.x,
    dx2 = e.x - d.x,
    dy1 = b.y - d.y,
    dy2 = e.y - d.y;
  const dx3 = a.x - b.x + d.x - e.x,
    dy3 = a.y - b.y + d.y - e.y,
    det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) > 1e-8 ? (dx3 * dy2 - dx2 * dy3) / det : 0,
    h = Math.abs(det) > 1e-8 ? (dx1 * dy3 - dx3 * dy1) / det : 0;
  const den = g * u + h * v + 1;
  return {
    x: ((b.x - a.x + g * b.x) * u + (e.x - a.x + h * e.x) * v + a.x) / den,
    y: ((b.y - a.y + g * b.y) * u + (e.y - a.y + h * e.y) * v + a.y) / den,
  };
}
export function surfaceVertices(surface?: Surface): Float32Array {
  const points = surface?.points;
  const n = surface?.mode === 'corners' ? 16 : 2;
  const vertex = (x: number, y: number) => {
    const u = x / n,
      v = y / n;
    const p = !points
      ? { x: u, y: v }
      : surface?.mode === 'corners'
        ? quadPoint([points[0], points[2], points[8], points[6]], u, v)
        : points[y * 3 + x];
    return [p.x, p.y, u, v];
  };
  const out: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out.push(
        ...vertex(x, y),
        ...vertex(x + 1, y),
        ...vertex(x + 1, y + 1),
        ...vertex(x, y),
        ...vertex(x + 1, y + 1),
        ...vertex(x, y + 1),
      );
  return new Float32Array(out);
}
export type TextureInput = { texture: WebGLTexture; width: number; height: number };
export class StudioCompositor {
  private gl: WebGLRenderingContext;
  private crossfade: DeckCrossfade;
  private looks: EdgeLookRenderer;
  private paint?:PaintRenderer;
  private paintFailed=false;
  onPaintError:(message:string)=>void=()=>{};
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private sources: WebGLTexture[] = [];
  private targets: { texture: WebGLTexture; frame: WebGLFramebuffer }[] = [];
  private width = 0;
  private height = 0;
  private geometry = new WeakMap<Surface, Float32Array>();
  private fullFrame = surfaceVertices();
  private locations: Record<string, WebGLUniformLocation | null> = {};
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('This device could not start the video output.');
    this.gl = gl;
    this.crossfade = new DeckCrossfade(gl);
    this.looks = new EdgeLookRenderer(gl);
    const compile = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || 'Output shader failed');
      return s;
    };
    this.program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, VERT),
      f = compile(gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(this.program, v);
    gl.attachShader(this.program, f);
    gl.linkProgram(this.program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Could not link the output compositor.');
    this.buffer = gl.createBuffer()!;
    for (const name of ['source', 'backdrop', 'mode', 'gain', 'feather', 'fit', 'contained', 'grid'])
      this.locations[name] = gl.getUniformLocation(this.program, name);
    for (let i = 0; i < 8; i++) this.sources.push(this.texture());
    for (let i = 0; i < 2; i++) this.targets.push({ texture: this.texture(), frame: gl.createFramebuffer()! });
  }
  private texture() {
    const g = this.gl,
      t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
    return t;
  }
  get context() {
    return this.gl;
  }
  beginFrame(height: number) {
    this.resize(height);
  }
  private resize(h: number) {
    const g = this.gl,
      w = Math.round((h * 16) / 9);
    if (h === this.height && w === this.width) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of this.targets) {
      g.bindTexture(g.TEXTURE_2D, t.texture);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, t.frame);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t.texture, 0);
      if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE)
        throw new Error('Output resolution exceeds available GPU memory.');
    }
  }
  private draw(
    texture: WebGLTexture,
    back: WebGLTexture,
    mode: number,
    gain: number,
    surface?: Surface,
    grid = false,
    sourceAspect = 16 / 9,
    fitMode: Surface['fit'] = 'stretch',
    painted=false,
  ) {
    const g = this.gl,
      L = this.locations;
    g.useProgram(this.program);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    let verts = surface ? this.geometry.get(surface) : this.fullFrame;
    if (!verts) {
      verts = surfaceVertices(surface);
      this.geometry.set(surface!, verts);
    }
    g.bufferData(g.ARRAY_BUFFER, verts, g.DYNAMIC_DRAW);
    const pos = g.getAttribLocation(this.program, 'position'),
      uv = g.getAttribLocation(this.program, 'uv');
    g.enableVertexAttribArray(pos);
    g.vertexAttribPointer(pos, 2, g.FLOAT, false, 16, 0);
    g.enableVertexAttribArray(uv);
    g.vertexAttribPointer(uv, 2, g.FLOAT, false, 16, 8);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, texture);
    g.uniform1i(L.source, 0);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, back);
    g.uniform1i(L.backdrop, 1);
    g.uniform1i(L.mode, mode);
    g.uniform1f(L.gain, gain);
    g.uniform1f(L.feather, surface?.feather || 0);
    g.uniform1i(L.grid, grid ? 1 : 0);
    let fx = 1,
      fy = 1;
    const fit = painted ? 'stretch' : surface?.fit || fitMode;
    let targetAspect = 16 / 9;
    if (surface) {
      const p = surface.points;
      targetAspect =
        ((16 / 9) * (Math.max(...p.map((p) => p.x)) - Math.min(...p.map((p) => p.x)))) /
        Math.max(0.0001, Math.max(...p.map((p) => p.y)) - Math.min(...p.map((p) => p.y)));
    }
    const ratio = targetAspect / sourceAspect;
    if (fit !== 'stretch') {
      if (ratio > 1 === (fit === 'contain')) fx = ratio;
      else fy = 1 / Math.max(0.0001, ratio);
    }
    g.uniform2f(L.fit, fx, fy);
    g.uniform1i(L.contained, fit === 'contain' ? 1 : 0);
    g.drawArrays(g.TRIANGLES, 0, verts.length / 4);
  }
  render(show: Show, inputs: (TextureInput | null)[], blackout = false, testGrid = false, time = 0, audio = 0, transportBeat = time * show.bpm / 60, postProcess?: (input:TextureInput)=>TextureInput) {
    const g = this.gl;
    if (show.dualDeck && this.targets.length === 2) {
      for (let i = 0; i < 8; i++) this.targets.push({ texture: this.texture(), frame: g.createFramebuffer()! });
      this.height = 0;
    }
    this.resize(show.quality);
    if(!show.paint?.enabled)this.paintFailed=false;
    try{
      if(show.paint?.enabled&&show.paint.strokes.length&&!this.paint&&!this.paintFailed)this.paint=new PaintRenderer(g);
      this.paint?.prepare(show.id,show.paint,show.surfaces,time,transportBeat);
    }catch(error){
      this.paint?.destroy();this.paint=undefined;this.paintFailed=true;
      this.onPaintError('Paint paused: '+(error instanceof Error?error.message:'GPU resources unavailable')+'. Toggle Paint off and on to retry.');
    }
    const outputGain=show.master;
    const mapped=show.mapping && show.surfaces.length>0;
    g.viewport(0, 0, this.width, this.height);
    g.disable(g.BLEND);
    g.disable(g.CULL_FACE);
    let current = 0;
    g.bindFramebuffer(g.FRAMEBUFFER, this.targets[0].frame);
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    let deckA = 0;
    for (const i of (show.dualDeck ? [3,2,1,0,7,6,5,4] : [3,2,1,0])) {
      if (show.dualDeck && i === 7) {
        deckA = current;
        current = 2;
        g.bindFramebuffer(g.FRAMEBUFFER, this.targets[2].frame);
        g.clearColor(0, 0, 0, 1);
        g.clear(g.COLOR_BUFFER_BIT);
      }
      const gain = show.dualDeck ? baseLayerGain(show,i) : layerGain(show, i);
      if (!inputs[i] || gain <= 0) continue;
      const next = (show.dualDeck && i >= 4 ? 5 : 1) - current;
      g.bindFramebuffer(g.FRAMEBUFFER, this.targets[next].frame);
      this.draw(
        inputs[i]?.texture || this.sources[i],
        this.targets[current].texture,
        MODES.indexOf(show.layers[i].blend),
        gain,
        undefined,
        false,
        inputs[i] ? inputs[i]!.width / inputs[i]!.height : 16 / 9,
        show.layers[i].fit,
      );
      current = next;
      g.disable(g.BLEND);
    }
    if (show.dualDeck) {
      g.bindFramebuffer(g.FRAMEBUFFER, this.targets[4].frame);
      g.disable(g.BLEND);
      this.crossfade.draw(this.targets[deckA].texture, this.targets[current].texture, show.crossfade, show.crossfadeSettings, time, this.width, this.height);
      current = 4;
    }
    // Composition FX belong to the mixed source, before screen geometry/feather.
    // Keep this texture separate from the scratch targets reused for paired rows.
    const mixTexture = postProcess
      ? postProcess({texture:this.targets[current].texture,width:this.width,height:this.height}).texture
      : this.targets[current].texture;
    g.viewport(0,0,this.width,this.height);
    // Mix the matching A/B row before warping. Both endpoints retain the same
    // surface geometry; additive weighted composition avoids a dim midpoint.
    if (mapped && show.dualDeck) {
      for (const row of [0, 1, 2, 3]) {
        if (!show.surfaces.some((s) => s.enabled && s.source !== 'mix' && s.source % 4 === row)) continue;
        const base = row * 2 + (row>=2?2:0);
        for (let deck = 0; deck < 2; deck++) {
          const i = row + deck * 4,
            write = deck === 0 ? base : 5;
          g.bindFramebuffer(g.FRAMEBUFFER, this.targets[write].frame);
          g.clearColor(0, 0, 0, 1);
          g.clear(g.COLOR_BUFFER_BIT);
          const opacity = baseLayerGain(show,i);
          g.enable(g.BLEND);
          g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
          this.draw(
            inputs[i]?.texture || this.sources[i],
            this.sources[0],
            -1,
            inputs[i] ? opacity : 0,
            undefined,
            false,
            inputs[i] ? inputs[i]!.width / inputs[i]!.height : 16 / 9,
            show.layers[i].fit,
          );
        }
        g.disable(g.BLEND);
        g.bindFramebuffer(g.FRAMEBUFFER, this.targets[base + 1].frame);
        this.crossfade.draw(this.targets[base].texture, this.targets[5].texture, show.crossfade, show.crossfadeSettings, time, this.width, this.height);
      }
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    if (blackout) {g.bindFramebuffer(g.FRAMEBUFFER,null);g.clear(g.COLOR_BUFFER_BIT);return;}
    g.enable(g.BLEND);
    g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
    if (!mapped) this.draw(mixTexture, this.sources[0], -1, outputGain, undefined, testGrid);
    else
      for (const s of show.surfaces) {
        if (!s.enabled) continue;
        const i = s.source;
        const paired = show.dualDeck && i !== 'mix';
        const available = paired || i === 'mix' || !!inputs[i] || s.look?.enabled;
        const ink=this.paint?.texture(s.id);
        if (!available && !testGrid && !ink) continue;
        const paintOnly=show.paint?.enabled&&show.paint.isolate&&!this.paintFailed;
        if((available&&!paintOnly)||testGrid)this.draw(
          paired
            ? this.targets[(Number(i) % 4) * 2 + (Number(i)%4>=2?2:0) + 1].texture
            : i === 'mix'
              ? mixTexture
              : inputs[i]?.texture || this.sources[i],
          this.sources[0],
          -1,
          outputGain * (paired || i === 'mix' ? 1 : layerGain(show, Number(i))),
          s,
          testGrid,
          paired || i === 'mix' ? 16 / 9 : (inputs[i]?.width || 16) / (inputs[i]?.height || 9),
        );
        const verts = this.geometry.get(s) || surfaceVertices(s);

        if(!paintOnly)this.looks.draw(
          s.look,
          verts,
          this.width,
          this.height,
          time,
          show.bpm,
          show.surfaces.indexOf(s),
          show.surfaces.length,
          outputGain,
          audio,
          transportBeat,
        );
        if(ink){
          g.enable(g.BLEND);g.blendFuncSeparate(g.ONE,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE_MINUS_SRC_ALPHA);
          this.draw(ink,this.sources[0],-2,outputGain,s,false,1,'stretch',true);
        }
        g.enable(g.BLEND);
        g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
      }
    g.disable(g.BLEND);

  }
  /** `releaseContext` frees the GPU context with the canvas. Keep it when a new engine reuses the canvas. */
  destroy(releaseContext = true) {
    const g = this.gl;
    this.looks.destroy();
    this.crossfade.destroy();
    this.paint?.destroy();
    g.deleteProgram(this.program);
    g.deleteBuffer(this.buffer);
    for (const t of this.sources) g.deleteTexture(t);
    for (const t of this.targets) {
      g.deleteTexture(t.texture);
      g.deleteFramebuffer(t.frame);
    }
    if (releaseContext) g.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
