import { DeckCrossfade } from './crossfade';
import {PaintRenderer} from './paintRenderer';
import { EdgeLookRenderer } from './looks/renderer';
import { baseLayerGain, layerGain, type Show, type Surface, type Point } from './model';
import { BLEND_CODE, BLEND_GLSL, basicBlendCode, blendCode, surfaceOpacity } from './blendModes';
const VERT = `attribute vec2 position; attribute vec2 uv; varying vec2 texCoord; varying vec2 screenPos; void main(){texCoord=uv;screenPos=position;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
const FRAG = `precision highp float;
varying vec2 texCoord; varying vec2 screenPos; uniform sampler2D source; uniform sampler2D backdrop;
uniform int mode; uniform float gain; uniform float feather; uniform vec2 fit; uniform bool contained; uniform bool grid; uniform vec2 gridSize;
// Where the picture sits in a surface: region centre and size in the source, and its turn.
uniform bool placed; uniform vec4 place; uniform float placeAngle; uniform float placeAspect;
// What a layer or surface makes of its picture over what is beneath (blendModes.ts).
${BLEND_GLSL}
// The alignment card, matching the desktop's empty-layer card: square grid
// from the centre, frame, centre cross and circles, diagonals, corner
// brackets, a grey step row and a colour row. Between the lines it is 0,0,0.
float cardLine(float d,float h){return 1.-smoothstep(h,h+1.,abs(d));}
vec3 alignmentCard(vec2 uv,vec2 size){
 vec2 px=uv*size,c=px-size*.5;float shortSide=min(size.x,size.y),w=clamp(shortSide/540.,1.,3.)*.5,cell=shortSide/12.;
 vec3 blue=vec3(.322,.471,1.),col=vec3(0.);
 vec2 g=abs(fract(c/cell+.5)-.5)*cell,major=abs(fract(c/(cell*3.)+.5)-.5)*cell*3.;
 col=max(col,vec3(.11)*max(cardLine(g.x,w),cardLine(g.y,w)));
 col=max(col,vec3(.26)*max(cardLine(major.x,w),cardLine(major.y,w)));
 float d1=abs(c.x*size.y-c.y*size.x)/length(size),d2=abs(c.x*size.y+c.y*size.x)/length(size);
 col=max(col,vec3(.2)*max(cardLine(d1,w),cardLine(d2,w)));
 float r=length(c);
 col=max(col,vec3(.75)*cardLine(r-shortSide*.5+w+1.,w));
 col=max(col,vec3(.4)*cardLine(r-shortSide*.25,w));
 col=max(col,blue*cardLine(r-cell*.5,w));
 col=max(col,vec3(.5)*max(cardLine(c.x,w),cardLine(c.y,w)));
 col=max(col,vec3(1.)*max(cardLine(c.x,w)*step(abs(c.y),cell*1.5),cardLine(c.y,w)*step(abs(c.x),cell*1.5)));
 vec2 rowHalf=vec2(cell*3.5,cell*.5),top=c+vec2(0.,cell*2.5),bottom=c-vec2(0.,cell*2.5);
 if(abs(top.x)<rowHalf.x&&abs(top.y)<rowHalf.y)col=vec3(clamp(floor((top.x+rowHalf.x)/cell),0.,6.)/6.);
 if(abs(bottom.x)<rowHalf.x&&abs(bottom.y)<rowHalf.y){float i=clamp(floor((bottom.x+rowHalf.x)/cell),0.,6.);
  col=vec3((i<1.5||(i>3.5&&i<5.5))?1.:0.,i<3.5?1.:0.,mod(i,2.)<.5?1.:0.);}
 float edge=min(min(px.x,size.x-px.x),min(px.y,size.y-px.y));
 col=max(col,vec3(1.)*(1.-smoothstep(w*2.+1.,w*2.+2.,edge)));
 vec2 corner=min(px,size-px);float inset=cell*.5,arm=cell*1.5;
 col=max(col,blue*max(cardLine(corner.x-inset,w*1.5)*step(inset,corner.y)*step(corner.y,inset+arm),cardLine(corner.y-inset,w*1.5)*step(inset,corner.x)*step(corner.x,inset+arm)));
 return col;
}
void main(){
 vec2 uv=(texCoord-.5)*fit+.5;
 if(placed){
  // Turn in square units of the surface, then read the placed region of the source.
  vec2 q=(uv-.5)*vec2(placeAspect,1.);float c=cos(placeAngle),n=sin(placeAngle);
  q=vec2(c*q.x+n*q.y,-n*q.x+c*q.y)/vec2(placeAspect,1.);
  uv=place.xy+q*place.zw;
 }
 vec4 s=texture2D(source,vec2(uv.x,1.-uv.y));
 if((contained||placed) && (uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)) s=vec4(0.);
 if(grid)s=vec4(alignmentCard(texCoord,max(gridSize,vec2(1.))),1.);
 float edge=min(min(texCoord.x,1.-texCoord.x),min(texCoord.y,1.-texCoord.y));
 s.a*=gain*(feather>0.?smoothstep(0.,feather,edge):1.);
 if(mode==-2)s.rgb*=gain*(feather>0.?smoothstep(0.,feather,edge):1.);
 if(mode<0){gl_FragColor=s;return;}
 // What is beneath this point of the output: a warped surface's own uv is not where it lands.
 vec4 b=texture2D(backdrop,vec2(screenPos.x,1.-screenPos.y)); vec3 blend=blendColor(b.rgb,s.rgb);
 float a=s.a+b.a*(1.-s.a);
 vec3 c=((1.-s.a)*b.rgb*b.a+(1.-b.a)*s.rgb*s.a+b.a*s.a*blend)/max(a,.00001);
 gl_FragColor=vec4(c,a);
}`;

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
const ALL_BLENDS_FRAG = '#define ALL_BLENDS\n' + FRAG;
const UNIFORMS = ['source', 'backdrop', 'mode', 'gain', 'feather', 'fit', 'contained', 'grid', 'gridSize', 'placed', 'place', 'placeAngle', 'placeAspect'];
type Linked = { program: WebGLProgram; locations: Record<string, WebGLUniformLocation | null>; position: number; uv: number };
/** Where the surfaces draw while one of them blends, and the copy of what is beneath it. */
type Stage = { texture: WebGLTexture; frame: WebGLFramebuffer; under: WebGLTexture; width: number; height: number };
/** The surface's warp in output pixels (bottom-left origin), one pixel wider all round: the only part a blend reads. */
export function surfaceBounds(verts: Float32Array, width: number, height: number): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < verts.length; i += 4) {
    x0 = Math.min(x0, verts[i]); x1 = Math.max(x1, verts[i]);
    y0 = Math.min(y0, verts[i + 1]); y1 = Math.max(y1, verts[i + 1]);
  }
  const left = Math.max(0, Math.floor(x0 * width) - 1), right = Math.min(width, Math.ceil(x1 * width) + 1);
  const bottom = Math.max(0, Math.floor((1 - y1) * height) - 1), top = Math.min(height, Math.ceil((1 - y0) * height) + 1);
  return right > left && top > bottom ? [left, bottom, right - left, top - bottom] : null;
}
export class StudioCompositor {
  private gl: WebGLRenderingContext;
  private crossfade: DeckCrossfade;
  private looks: EdgeLookRenderer;
  private paint?:PaintRenderer;
  private paintFailed=false;
  onPaintError:(message:string)=>void=()=>{};
  /** The five blends of app 1.1, which every set without the newer ones uses. */
  private program: Linked;
  /** Every blend mode. Compiled the first time a set uses one of the newer modes; null when this GPU cannot. */
  private allBlends?: Linked | null;
  private pendingBlends?: ReturnType<StudioCompositor['start']>;
  /** Made the first time a surface blends; kept for the next frame. */
  private stage?: Stage;
  private stageFailedAt = 0;
  onBlendError: (message: string) => void = () => {};
  private buffer: WebGLBuffer;
  private sources: WebGLTexture[] = [];
  private targets: { texture: WebGLTexture; frame: WebGLFramebuffer }[] = [];
  private width = 0;
  private height = 0;
  private geometry = new WeakMap<Surface, Float32Array>();
  private fullFrame = surfaceVertices();
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('This device could not start the video output.');
    this.gl = gl;
    this.crossfade = new DeckCrossfade(gl);
    this.looks = new EdgeLookRenderer(gl);
    this.program = this.link(FRAG);
    this.buffer = gl.createBuffer()!;
    for (let i = 0; i < 8; i++) this.sources.push(this.texture());
    for (let i = 0; i < 2; i++) this.targets.push({ texture: this.texture(), frame: gl.createFramebuffer()! });
  }
  /** Compile and link; with `later`, the status checks wait for `finish` (see prepareBlends). */
  private start(fragment: string) {
    const gl = this.gl;
    const compile = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, VERT),
      f = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    return { program, v, f };
  }
  private finish({ program, v, f }: ReturnType<StudioCompositor['start']>): Linked {
    const gl = this.gl;
    try {
      for (const s of [v, f])
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Output shader failed');
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Could not link the output compositor.');
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(v);
      gl.deleteShader(f);
    }
    const locations: Linked['locations'] = {};
    for (const name of UNIFORMS) locations[name] = gl.getUniformLocation(program, name);
    return { program, locations, position: gl.getAttribLocation(program, 'position'), uv: gl.getAttribLocation(program, 'uv') };
  }
  private link(fragment: string): Linked {
    return this.finish(this.start(fragment));
  }
  /** The shader that can draw `mode`: the small one for the first five, the full one for the rest. */
  private programFor(mode: number): Linked {
    if (basicBlendCode(mode)) return this.program;
    if (this.allBlends === undefined) {
      try {
        this.allBlends = this.finish(this.pendingBlends ?? this.start(ALL_BLENDS_FRAG));
      } catch (error) {
        this.allBlends = null;
        this.onBlendError('This device cannot draw the newer blend modes, so those layers and surfaces show as Normal. ' + (error instanceof Error ? error.message : ''));
      }
      this.pendingBlends = undefined;
    }
    return this.allBlends || this.program;
  }
  /**
   * Start the full blend shader before a newer mode is first used. Where the GPU compiles in the
   * background (KHR_parallel_shader_compile) nothing waits for it; elsewhere it compiles now,
   * so the wait falls when the blend sheet opens, not on the output when a mode is chosen.
   */
  prepareBlends() {
    if (this.allBlends !== undefined || this.pendingBlends) return;
    if (this.gl.getExtension('KHR_parallel_shader_compile')) this.pendingBlends = this.start(ALL_BLENDS_FRAG);
    else this.programFor(BLEND_CODE.overlay);
  }
  /** The stage at the output size, or nothing when this GPU has no room for it at this size (said once). */
  private stageTarget(): Stage | undefined {
    const g = this.gl;
    if (this.stageFailedAt === this.height) return undefined;
    if (!this.stage) this.stage = { texture: this.texture(), frame: g.createFramebuffer()!, under: this.texture(), width: 0, height: 0 };
    const st = this.stage;
    if (st.width !== this.width || st.height !== this.height) {
      for (const t of [st.texture, st.under]) {
        g.bindTexture(g.TEXTURE_2D, t);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, this.width, this.height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      }
      g.bindFramebuffer(g.FRAMEBUFFER, st.frame);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, st.texture, 0);
      if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
        this.stageFailedAt = this.height;
        this.onBlendError('Surface blend modes need more GPU memory than this device has free at this output quality, so surfaces show as Normal. A lower quality may help.');
        return undefined;
      }
      st.width = this.width;
      st.height = this.height;
    }
    return st;
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
      linked = this.programFor(mode),
      L = linked.locations;
    g.useProgram(linked.program);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    let verts = surface ? this.geometry.get(surface) : this.fullFrame;
    if (!verts) {
      verts = surfaceVertices(surface);
      this.geometry.set(surface!, verts);
    }
    g.bufferData(g.ARRAY_BUFFER, verts, g.DYNAMIC_DRAW);
    const pos = linked.position,
      uv = linked.uv;
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
    // The card is laid out in pixels so its squares and circles stay true.
    const span = surface
      ? [Math.max(...surface.points.map((p) => p.x)) - Math.min(...surface.points.map((p) => p.x)),
         Math.max(...surface.points.map((p) => p.y)) - Math.min(...surface.points.map((p) => p.y))]
      : [1, 1];
    g.uniform2f(L.gridSize, Math.max(1, span[0] * this.width), Math.max(1, span[1] * this.height));
    const ratio = targetAspect / sourceAspect;
    if (fit !== 'stretch') {
      if (ratio > 1 === (fit === 'contain')) fx = ratio;
      else fy = 1 / Math.max(0.0001, ratio);
    }
    g.uniform2f(L.fit, fx, fy);
    g.uniform1i(L.contained, fit === 'contain' ? 1 : 0);
    const placement = painted || grid ? undefined : surface?.placement;
    g.uniform1i(L.placed, placement ? 1 : 0);
    if (placement) {
      g.uniform4f(L.place, placement.x, placement.y, placement.w, placement.h);
      g.uniform1f(L.placeAngle, placement.angle);
      g.uniform1f(L.placeAspect, Math.max(0.05, targetAspect));
    }
    g.drawArrays(g.TRIANGLES, 0, verts.length / 4);
  }
  /**
   * `surfaceInputs` holds the clips surfaces play by themselves: a picture, or null while it loads
   * (the surface stays dark). A surface whose clip is not in it shows its deck source.
   */
  render(show: Show, inputs: (TextureInput | null)[], blackout = false, testGrid = false, time = 0, audio = 0, transportBeat = time * show.bpm / 60, postProcess?: (input:TextureInput)=>TextureInput, surfaceInputs?: ReadonlyMap<string, TextureInput | null>) {
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
        blendCode(show.layers[i].blend),
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
    // A surface with a blend other than Normal mixes with what the surfaces before it left, so
    // then the surfaces draw off screen and go to the screen at the end. Sets without one draw
    // straight to the screen, as they always did.
    const stage = mapped && !testGrid && show.surfaces.some((s) => s.enabled && blendCode(s.blend) !== 0) ? this.stageTarget() : undefined;
    g.bindFramebuffer(g.FRAMEBUFFER, stage?.frame ?? null);
    if (stage) g.clear(g.COLOR_BUFFER_BIT);
    if (!mapped) this.draw(mixTexture, this.sources[0], -1, outputGain, undefined, testGrid);
    else
      for (const s of show.surfaces) {
        if (!s.enabled) continue;
        // Its own clip (MB-6) when that clip has a render; otherwise the deck source.
        const own = s.clipId !== undefined && !!surfaceInputs?.has(s.clipId);
        const clip = own ? surfaceInputs!.get(s.clipId!) : null;
        const i = s.source;
        const paired = !own && show.dualDeck && i !== 'mix';
        const available = own ? !!clip || s.look?.enabled : paired || i === 'mix' || !!inputs[i] || s.look?.enabled;
        const ink=this.paint?.texture(s.id);
        if (!available && !testGrid && !ink) continue;
        const paintOnly=show.paint?.enabled&&show.paint.isolate&&!this.paintFailed;
        const drawn = (available && !paintOnly) || testGrid;
        const opacity = surfaceOpacity(s);
        // A blend reads what is beneath the surface: a copy of that part of the stage.
        const code = stage && drawn ? blendCode(s.blend) : 0;
        if (code) {
          const bounds = surfaceBounds(this.geometry.get(s) || surfaceVertices(s), this.width, this.height);
          g.disable(g.BLEND);
          if (bounds) {
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, stage!.under);
            g.copyTexSubImage2D(g.TEXTURE_2D, 0, bounds[0], bounds[1], bounds[0], bounds[1], bounds[2], bounds[3]);
          }
        }
        if(drawn)this.draw(
          own
            ? clip?.texture || this.sources[0]
            : paired
            ? this.targets[(Number(i) % 4) * 2 + (Number(i)%4>=2?2:0) + 1].texture
            : i === 'mix'
              ? mixTexture
              : inputs[i]?.texture || this.sources[i],
          code ? stage!.under : this.sources[0],
          code || -1,
          outputGain * opacity * (own || paired || i === 'mix' ? 1 : layerGain(show, Number(i))),
          s,
          testGrid,
          own ? (clip?.width || 16) / (clip?.height || 9) : paired || i === 'mix' ? 16 / 9 : (inputs[i]?.width || 16) / (inputs[i]?.height || 9),
        );
        if (code) {
          g.enable(g.BLEND);
          g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
        }
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
          outputGain * opacity,
          audio,
          transportBeat,
        );
        if(ink){
          g.enable(g.BLEND);g.blendFuncSeparate(g.ONE,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE_MINUS_SRC_ALPHA);
          this.draw(ink,this.sources[0],-2,outputGain*opacity,s,false,1,'stretch',true);
        }
        g.enable(g.BLEND);
        g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
      }
    if (stage) {
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.disable(g.BLEND);
      this.draw(stage.texture, this.sources[0], -1, 1);
    }
    g.disable(g.BLEND);

  }
  /** `releaseContext` frees the GPU context with the canvas. Keep it when a new engine reuses the canvas. */
  destroy(releaseContext = true) {
    const g = this.gl;
    this.looks.destroy();
    this.crossfade.destroy();
    this.paint?.destroy();
    g.deleteProgram(this.program.program);
    if (this.allBlends) g.deleteProgram(this.allBlends.program);
    if (this.pendingBlends) {
      g.deleteProgram(this.pendingBlends.program);
      g.deleteShader(this.pendingBlends.v);
      g.deleteShader(this.pendingBlends.f);
    }
    if (this.stage) {
      g.deleteTexture(this.stage.texture);
      g.deleteTexture(this.stage.under);
      g.deleteFramebuffer(this.stage.frame);
    }
    g.deleteBuffer(this.buffer);
    for (const t of this.sources) g.deleteTexture(t);
    for (const t of this.targets) {
      g.deleteTexture(t.texture);
      g.deleteFramebuffer(t.frame);
    }
    if (releaseContext) g.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
