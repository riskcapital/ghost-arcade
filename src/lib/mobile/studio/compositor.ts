import { DeckCrossfade } from './crossfade';
import {PaintRenderer} from './paintRenderer';
import { EdgeLookRenderer } from './looks/renderer';
import { baseLayerGain, layerGain, type Show, type Surface } from './model';
import { tessellate } from './mapping/meshGrid';
import { isShape } from './mapping/surfaceShape';
import { CoverageTextures } from './mapping/coverageTextures';
import { BLEND_CODE, BLEND_GLSL, basicBlendCode, blendCode, surfaceOpacity } from './blendModes';
export { quadPoint } from './mapping/meshGrid';
const VERT = `attribute vec2 position; attribute vec2 uv; varying vec2 texCoord; varying vec2 screenPos; void main(){texCoord=uv;screenPos=position;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
const FRAG = `precision highp float;
varying vec2 texCoord; varying vec2 screenPos; uniform sampler2D source; uniform sampler2D backdrop;
uniform int mode; uniform float gain; uniform float feather; uniform vec2 fit; uniform bool contained; uniform bool grid; uniform vec2 gridSize;
// Where the picture sits in a surface: region centre and size in the source, and its turn.
uniform bool placed; uniform vec4 place; uniform float placeAngle; uniform float placeAspect;
// Free-form outline and masks: how much of each point of the surface shows.
uniform sampler2D coverage; uniform bool covered;
// A test pattern on one surface, for finding it on the wall: 1 card, 2 identify, 3 white.
uniform int pattern; uniform float patternIndex;
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
vec3 patternHue(float h){return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.);}
float patternSeg(vec2 p,vec2 a,vec2 b,float w){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return 1.-smoothstep(w,w+1.5,length(pa-ba*h));}
float patternBit(float m,float k){return mod(floor(m/pow(2.,k)+.001),2.);}
// A seven-segment digit s pixels tall; p from its lower left corner, y up.
float patternDigit(vec2 p,float d,float s,float w){
 float x0=s*.08,x1=s*.42,y0=s*.06,y1=s*.5,y2=s*.94;
 float m=d<.5?63.:d<1.5?6.:d<2.5?91.:d<3.5?79.:d<4.5?102.:d<5.5?109.:d<6.5?125.:d<7.5?7.:d<8.5?127.:111.;
 float v=patternBit(m,0.)*patternSeg(p,vec2(x0,y2),vec2(x1,y2),w);
 v=max(v,patternBit(m,1.)*patternSeg(p,vec2(x1,y2),vec2(x1,y1),w));
 v=max(v,patternBit(m,2.)*patternSeg(p,vec2(x1,y1),vec2(x1,y0),w));
 v=max(v,patternBit(m,3.)*patternSeg(p,vec2(x0,y0),vec2(x1,y0),w));
 v=max(v,patternBit(m,4.)*patternSeg(p,vec2(x0,y1),vec2(x0,y0),w));
 v=max(v,patternBit(m,5.)*patternSeg(p,vec2(x0,y2),vec2(x0,y1),w));
 return max(v,patternBit(m,6.)*patternSeg(p,vec2(x0,y1),vec2(x1,y1),w));
}
// Identify: the surface's own colour, an 8 x 8 grid, a white border and its number, large.
vec3 identifyCard(vec2 uv,vec2 size,float n){
 vec2 px=uv*size;vec3 base=patternHue(fract(n*.618034+.04));
 vec2 cell=size/8.;vec2 q=abs(fract(px/cell+.5)-.5)*cell;
 vec3 col=mix(base*.32,base,(1.-smoothstep(.75,1.75,min(q.x,q.y)))*.85);
 float edge=min(min(px.x,size.x-px.x),min(px.y,size.y-px.y));
 col=mix(col,vec3(1.),1.-smoothstep(3.,5.,edge));
 float label=n+1.,tens=floor(label/10.),ones=label-tens*10.;bool two=tens>.5;
 float h=min(size.y*.55,size.x*(two?.36:.6)),gap=h*.1,wd=h*.5,total=two?wd*2.+gap:wd;
 vec2 up=vec2(px.x,size.y-px.y)-vec2(size.x*.5-total*.5,size.y*.5-h*.5);
 float w=max(1.5,h*.065);
 float ink=patternDigit(up-(two?vec2(wd+gap,0.):vec2(0.)),ones,h,w);
 float halo=patternDigit(up-(two?vec2(wd+gap,0.):vec2(0.)),ones,h,w*2.4);
 if(two){ink=max(ink,patternDigit(up,tens,h,w));halo=max(halo,patternDigit(up,tens,h,w*2.4));}
 return mix(mix(col,vec3(0.),halo*.85),vec3(1.),ink);
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
 if(grid||pattern==1)s=vec4(alignmentCard(texCoord,max(gridSize,vec2(1.))),1.);
 if(pattern==2)s=vec4(identifyCard(texCoord,max(gridSize,vec2(1.)),patternIndex),1.);
 if(pattern==3)s=vec4(1.);
 float edge=min(min(texCoord.x,1.-texCoord.x),min(texCoord.y,1.-texCoord.y));
 float cut=covered?texture2D(coverage,texCoord).r:1.;
 s.a*=gain*(feather>0.?smoothstep(0.,feather,edge):1.)*cut;
 if(mode==-2)s.rgb*=gain*(feather>0.?smoothstep(0.,feather,edge):1.)*cut;
 if(mode<0){gl_FragColor=s;return;}
 // What is beneath this point of the output: a warped surface's own uv is not where it lands.
 vec4 b=texture2D(backdrop,vec2(screenPos.x,1.-screenPos.y)); vec3 blend=blendColor(b.rgb,s.rgb);
 float a=s.a+b.a*(1.-s.a);
 vec3 c=((1.-s.a)*b.rgb*b.a+(1.-b.a)*s.rgb*s.a+b.a*s.a*blend)/max(a,.00001);
 gl_FragColor=vec4(c,a);
}`;

/** Triangles (x, y, u, v per vertex) of a surface's warp; the whole frame without one. */
export function surfaceVertices(surface?: Surface): Float32Array {
  return tessellate(surface);
}
export type TextureInput = { texture: WebGLTexture; width: number; height: number };
export type SurfacePattern = 'card' | 'identify' | 'white';
/** What the mapping editor asks the output to show for a moment: only some surfaces, or test patterns on them. */
export type MappingView = { solo?: string[]; identify?: boolean; patterns?: Record<string, SurfacePattern> };
const PATTERN_CODE: Record<SurfacePattern, number> = { card: 1, identify: 2, white: 3 };
const ALL_BLENDS_FRAG = '#define ALL_BLENDS\n' + FRAG;
const UNIFORMS = ['source', 'backdrop', 'mode', 'gain', 'feather', 'fit', 'contained', 'grid', 'gridSize', 'placed', 'place', 'placeAngle', 'placeAspect', 'coverage', 'covered', 'pattern', 'patternIndex'];
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
  /** One vertex buffer per surface, uploaded only when its geometry changes. */
  private buffers = new Map<string, { verts: Float32Array; buffer: WebGLBuffer; seen: number }>();
  private coverage: CoverageTextures;
  private frameCount = 0;
  /** Set by the engine from the mapping editor; never saved with the set. */
  mappingView: MappingView | null = null;
  private fullFrame = surfaceVertices();
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('This device could not start the video output.');
    this.gl = gl;
    this.crossfade = new DeckCrossfade(gl);
    this.looks = new EdgeLookRenderer(gl);
    this.program = this.link(FRAG);
    this.buffer = gl.createBuffer()!;
    this.coverage = new CoverageTextures(gl);
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
    cut: WebGLTexture | null = null,
    pattern = 0,
    patternIndex = 0,
  ) {
    const g = this.gl,
      linked = this.programFor(mode),
      L = linked.locations;
    g.useProgram(linked.program);
    const verts = surface ? this.surfaceGeometry(surface) : this.fullFrame;
    if (surface) {
      let cached = this.buffers.get(surface.id);
      if (!cached) {
        cached = { verts, buffer: g.createBuffer()!, seen: 0 };
        this.buffers.set(surface.id, cached);
        g.bindBuffer(g.ARRAY_BUFFER, cached.buffer);
        g.bufferData(g.ARRAY_BUFFER, verts, g.STATIC_DRAW);
      } else {
        g.bindBuffer(g.ARRAY_BUFFER, cached.buffer);
        if (cached.verts !== verts) {
          cached.verts = verts;
          g.bufferData(g.ARRAY_BUFFER, verts, g.STATIC_DRAW);
        }
      }
      cached.seen = this.frameCount;
    } else {
      g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
      g.bufferData(g.ARRAY_BUFFER, verts, g.DYNAMIC_DRAW);
    }
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
    // A free-form surface fades along its outline (in its coverage), not along its frame.
    g.uniform1f(L.feather, surface && !isShape(surface) ? surface.feather || 0 : 0);
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, cut ?? this.sources[0]);
    g.uniform1i(L.coverage, 2);
    g.uniform1i(L.covered, cut ? 1 : 0);
    g.activeTexture(g.TEXTURE0);
    g.uniform1i(L.grid, grid ? 1 : 0);
    g.uniform1i(L.pattern, pattern);
    g.uniform1f(L.patternIndex, patternIndex);
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
    // A test pattern fills the whole surface, so it is never placed; masks still cut a placed picture.
    const placement = painted || grid || pattern ? undefined : surface?.placement;
    g.uniform1i(L.placed, placement ? 1 : 0);
    if (placement) {
      g.uniform4f(L.place, placement.x, placement.y, placement.w, placement.h);
      g.uniform1f(L.placeAngle, placement.angle);
      g.uniform1f(L.placeAspect, Math.max(0.05, targetAspect));
    }
    g.drawArrays(g.TRIANGLES, 0, verts.length / 4);
  }
  private surfaceGeometry(surface: Surface): Float32Array {
    let verts = this.geometry.get(surface);
    if (!verts) {
      verts = surfaceVertices(surface);
      this.geometry.set(surface, verts);
    }
    return verts;
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
    this.frameCount++;
    this.coverage.begin();
    if (this.frameCount % 120 === 0)
      for (const [id, b] of this.buffers)
        if (this.frameCount - b.seen > 120) {
          g.deleteBuffer(b.buffer);
          this.buffers.delete(id);
        }
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
      for (const [index, s] of show.surfaces.entries()) {
        if (!s.enabled) continue;
        const view = this.mappingView;
        if (view?.solo?.length && !view.solo.includes(s.id)) continue;
        const pattern = view?.identify ? 'identify' : view?.patterns?.[s.id];
        if (pattern) {
          // A test pattern replaces the picture, its look and paint, at full brightness.
          this.draw(this.sources[0], this.sources[0], -1, 1, s, false, 16 / 9, 'stretch', false, this.coverage.get(s, this.width, this.height), PATTERN_CODE[pattern], index);
          continue;
        }
        // Its own clip (MB-6) when that clip has a render; otherwise the deck source.
        const own = s.clipId !== undefined && !!surfaceInputs?.has(s.clipId);
        const clip = own ? surfaceInputs!.get(s.clipId!) : null;
        const i = s.source;
        const paired = !own && show.dualDeck && i !== 'mix';
        const available = own ? !!clip || s.look?.enabled : paired || i === 'mix' || !!inputs[i] || s.look?.enabled;
        const ink=this.paint?.texture(s.id);
        if (!available && !testGrid && !ink) continue;
        const paintOnly=show.paint?.enabled&&show.paint.isolate&&!this.paintFailed;
        const cut = this.coverage.get(s, this.width, this.height);
        const drawn = (available && !paintOnly) || testGrid;
        const opacity = surfaceOpacity(s);
        // A blend reads what is beneath the surface: a copy of that part of the stage. Its outline
        // and masks still cut it (the cut leaves what is beneath).
        const code = stage && drawn ? blendCode(s.blend) : 0;
        if (code) {
          const bounds = surfaceBounds(this.surfaceGeometry(s), this.width, this.height);
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
          'stretch',
          false,
          cut,
        );
        if (code) {
          g.enable(g.BLEND);
          g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
        }
        const verts = this.surfaceGeometry(s);

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
          this.coverage.field(s),
        );
        if(ink){
          g.enable(g.BLEND);g.blendFuncSeparate(g.ONE,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE_MINUS_SRC_ALPHA);
          this.draw(ink,this.sources[0],-2,outputGain*opacity,s,false,1,'stretch',true,cut);
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
    this.coverage.destroy();
    for (const b of this.buffers.values()) g.deleteBuffer(b.buffer);
    this.buffers.clear();
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
