import { EDGE_LOOKS } from './edgeLookCatalog';
import { buildLookEffects, lookPalette } from './edgeLooks';
import { edgeTypeDefaults } from './edgeEffectCatalog';
import type { EdgeEffect, LookConfig } from './types';
export const MOBILE_EDGE_STROKES = [
  'none',
  'solid',
  'glow',
  'neon',
  'snake',
  'comet',
  'dashed',
  'dotted',
  'marchingAnts',
  'offset',
  'corners',
  'wireframe',
  'electric',
  'vertexDots',
  'zigzag',
];
export const MOBILE_EDGE_FILLS = [
  'none',
  'solid',
  'gradient',
  'stripes',
  'doubleStripes',
  'halftone',
  'scanLine',
  'hypnotic',
  'iris',
  'clockWipe',
  'mosaic',
  'origami',
  'grid',
];
const number = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const f = (v: unknown, fallback = 0) => number(v, fallback).toFixed(5);
const color = (v: number[] | undefined) => `vec4(${(v || [1, 1, 1, 1]).map((x) => f(x)).join(',')})`;
const vertex = `attribute vec2 position;attribute vec2 uv;varying vec2 v;uniform vec2 center;uniform vec2 transform;void main(){v=uv;vec2 p=center+(position-center)*transform;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}`;
function fragment(e: EdgeEffect) {
  if (!MOBILE_EDGE_STROKES.includes(e.stroke.type) || !MOBILE_EDGE_FILLS.includes(e.fill.type))
    throw new Error('Unsupported mobile edge style');
  const s = e.stroke,
    fill = e.fill,
    speed = f(s.speed, 0.5),
    angle = f((number(fill.angle) * Math.PI) / 180);
  let stroke = 'float ink=0.;',
    body = 'vec4 face=vec4(0.);';
  switch (s.type) {
    case 'solid':
      stroke = 'float ink=1.-smoothstep(w,w+1.,d);';
      break;
    case 'glow':
    case 'neon':
      stroke = `float ink=max(1.-smoothstep(w,w+1.,d),exp(-d/max(1.,${f(s.glowSize, 20)}))*${f(s.glowIntensity, 1)});`;
      break;
    case 'snake':
    case 'comet':
      stroke = `float phase=fract(path*${f(s.snakeCount, 1)}-t*${speed});float trail=1.-smoothstep(0.,${f(s.length ?? s.tailLength, 0.3)},phase);float ink=(1.-smoothstep(w,w+1.,d))*trail;`;
      break;
    case 'dashed':
    case 'dotted':
    case 'marchingAnts':
      stroke = `float dash=${f(s.dash1 ?? number(s.dashLength, 0.04) * 1000, 14)},gap=${f(s.gap1 ?? number(s.gapLength, 0.05) * 1000, 10)};float ink=(1.-smoothstep(w,w+1.,d))*step(mod(path*perimeter-${s.beatLock ? 'beat*24.' : `t*${speed}*50.`},dash+gap),dash);`;
      break;
    case 'offset':
      stroke = `float rings=abs(mod(d,${f(s.spacing, 12)})-${f(number(s.width, 2) / 2)});float ink=(1.-smoothstep(w,w+1.,rings))*step(d,${f(number(s.spacing, 12) * number(s.count, 2))});`;
      break;
    case 'corners':
      stroke = `float ink=(1.-smoothstep(w,w+1.,d))*(1.-step(${f(s.length, 26)},min(min(p.x,size.x-p.x),min(p.y,size.y-p.y))));`;
      stroke = `float ink=(1.-smoothstep(w,w+1.,d))*step(max(min(p.x,size.x-p.x),min(p.y,size.y-p.y)),${f(s.length, 26)});`;
      break;
    case 'wireframe':
      stroke =
        'float diagonal=min(abs(v.x-v.y),abs(v.x+v.y-1.))*min(size.x,size.y);float ink=1.-smoothstep(w,w+1.,min(d,diagonal));';
      break;
    case 'electric':
      stroke = `float jitter=(sin(path*230.+t*32.)+sin(path*617.-t*47.))*${f(number(s.arcIntensity, 1) * 3)};float ink=exp(-abs(d-w-jitter)/max(w,.8));`;
      break;
    case 'vertexDots':
      stroke = `float ink=1.-smoothstep(${f(s.radius, 6)},${f(number(s.radius, 6) + 1)},length(min(p,size-p)));`;
      break;
    case 'zigzag':
      stroke = `float z=abs(fract(path*perimeter/${f(s.wavelength, 28)}-t*${speed})*2.-1.)*${f(s.amplitude, 7)};float ink=1.-smoothstep(w,w+1.,abs(d-z));`;
      break;
  }
  const a = color(fill.color),
    b = color(fill.color2 ?? [0, 0, 0, 0]),
    fs = f(fill.speed, 0.5);
  switch (fill.type) {
    case 'grid':
      body = `float angle=t*${f((number(fill.rotateSpeed, 12) * Math.PI) / 180)};vec2 q=p-size*.5;q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;vec2 cell=abs(mod(q+${f(number(fill.spacing, 22) / 2)},${f(fill.spacing, 22)})-${f(number(fill.spacing, 22) / 2)});vec4 face=${a};face.a*=1.-smoothstep(${f(fill.lineWidth, 1.5)},${f(number(fill.lineWidth, 1.5) + 1)},min(cell.x,cell.y));`;
      break;
    case 'solid':
      body = `vec4 face=${a};face.a*=${f(fill.opacity, 1)};`;
      break;
    case 'gradient':
      body = `vec4 face=mix(${a},${b},.5+.5*sin(atan(v.y-.5,v.x-.5)+t*${fs}*6.283));`;
      break;
    case 'stripes':
    case 'doubleStripes':
      body = `float stripe=step(.5,fract(dot(p,vec2(cos(${angle}),sin(${angle})))/${f(fill.stripeWidth, 14)}-t*${fs}));vec4 face=mix(${b},${a},stripe);`;
      break;
    case 'halftone':
      body = `vec2 cell=p/${f(fill.cell, 16)};float dots=1.-smoothstep(.18,.35,length(fract(cell)-.5));vec4 face=mix(${b},${a},dots*(.55+.45*sin(t*${fs}+v.x*6.)));`;
      break;
    case 'scanLine':
      body = `float scanDistance=abs(v.x-(.5+.5*sin(t*${fs}*6.283)));vec4 face=${a};face.a*=1.-smoothstep(0.,${f(number(fill.lineWidth, 10))}/size.x,scanDistance);`;
      break;
    case 'hypnotic':
      body = `float band=step(.5,fract(length(p-size*.5)/${f(fill.band, 16)}-t*${fs}));vec4 face=mix(${b},${a},band);`;
      break;
    case 'iris':
      body = `vec4 face=${a};face.a*=1.-smoothstep(fract(beat)*.75,fract(beat)*.75+.015,length(v-.5));`;
      break;
    case 'clockWipe':
      body = `float polar=fract(atan(v.y-.5,v.x-.5)/6.283185+.25);vec4 face=${a};face.a*=step(polar,fract(t*${fs}));`;
      break;
    case 'mosaic':
      body = `vec2 cell=floor(p/${f(fill.cell, 20)});float tile=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);vec4 face=mix(${b},${a},step(tile,.5+.5*sin(t*${fs}*6.283)));`;
      break;
    case 'origami':
      body = `vec2 tile=fract(v*6.)-.5;float facet=abs(tile.x)+abs(tile.y);vec4 face=${a};face.rgb*=.25+.75*abs(sin(facet*4.+t*${fs}));`;
      break;
  }
  return `precision highp float;varying vec2 v;uniform vec2 size;uniform float t,beat,gain,widthScale,hue;vec3 shift(vec3 c,float a){vec3 axis=normalize(vec3(1.));return clamp(c*cos(a)+cross(axis,c)*sin(a)+axis*dot(axis,c)*(1.-cos(a)),0.,1.);}void main(){vec2 p=v*size;vec2 edge=min(p,size-p);float d=min(edge.x,edge.y);float perimeter=2.*(size.x+size.y);float path=(edge.y<edge.x?(v.y<.5?p.x:2.*size.x+size.y-p.x):(v.x>.5?size.x+p.y:perimeter-p.y))/perimeter;float w=${f(s.width, 2)}*widthScale;${stroke}${body}vec4 line=${color(s.color)};line.a*=clamp(ink,0.,1.);float alpha=line.a+face.a*(1.-line.a);vec3 rgb=(line.rgb*line.a+face.rgb*face.a*(1.-line.a))/max(alpha,.00001);gl_FragColor=vec4(shift(rgb,hue),clamp(alpha*gain,0.,1.));}`;
}
export class EdgeLookRenderer {
  private cache = new Map<
    string,
    { program: WebGLProgram; effect: EdgeEffect; locations: Record<string, WebGLUniformLocation | null> }[]
  >();
  private buffer: WebGLBuffer;
  constructor(private gl: WebGLRenderingContext) {
    this.buffer = gl.createBuffer()!;
  }
  draw(
    config: LookConfig | undefined,
    verts: Float32Array,
    w: number,
    h: number,
    time: number,
    bpm: number,
    index: number,
    count: number,
    gain = 1,
    audio = 0,
    transportBeat = time * bpm / 60,
  ) {
    if (!config?.enabled || config.amount <= 0 || gain <= 0) return;
    const gl = this.gl,
      key = [config.id, config.palette, config.stroke, config.fill].join(':');
    let passes = this.cache.get(key);
    if (!passes) {
      const look = EDGE_LOOKS.find((l) => l.id === config.id);
      const effects =
        config.id === 'custom'
          ? [
              {
                id: 'custom',
                enabled: true,
                opacity: 1,
                blendMode: 'normal',
                animation: { type: 'none' },
                stroke: {
                  ...edgeTypeDefaults('stroke', config.stroke || 'neon'),
                  color: lookPalette(config.palette).colors[0],
                },
                fill: {
                  ...edgeTypeDefaults('fill', config.fill || 'none'),
                  color: lookPalette(config.palette).colors[1],
                  color2: [0, 0, 0, 0],
                },
              } as EdgeEffect,
            ]
          : look
            ? buildLookEffects(look, config.palette)
            : [];
      passes = effects.map((effect) => {
        const program = gl.createProgram()!;
        for (const [type, source] of [
          [gl.VERTEX_SHADER, vertex],
          [gl.FRAGMENT_SHADER, fragment(effect)],
        ] as [number, string][]) {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const msg = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            gl.deleteProgram(program);
            throw new Error(`Edge Look ${config.id}: ${msg}`);
          }
          gl.attachShader(program, shader);
          gl.deleteShader(shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program) || 'Edge Look failed');
        return {
          program,
          effect,
          locations: Object.fromEntries(
            ['center', 'transform', 'size', 't', 'beat', 'gain', 'widthScale', 'hue'].map((n) => [
              n,
              gl.getUniformLocation(program, n),
            ]),
          ),
        };
      });
      if (this.cache.size >= 24) {
        const first = this.cache.keys().next().value!;
        this.cache.get(first)!.forEach((p) => gl.deleteProgram(p.program));
        this.cache.delete(first);
      }
      this.cache.set(key, passes);
    }
    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    for (let i = 0; i < verts.length; i += 4) {
      minX = Math.min(minX, verts[i]);
      maxX = Math.max(maxX, verts[i]);
      minY = Math.min(minY, verts[i + 1]);
      maxY = Math.max(maxY, verts[i + 1]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    for (const { program, effect: e, locations: L } of passes) {
      const chase =
        e.chaseMode === 'leftToRight'
          ? (minX + maxX) / 2
          : e.chaseMode === 'radial'
            ? Math.hypot((minX + maxX) / 2 - 0.5, (minY + maxY) / 2 - 0.5)
            : index / Math.max(1, count);
      const t = time * config.speed - chase * number(e.chaseSpread),
        beat = transportBeat - index * number(e.react?.chaseBeats),
        phase = ((beat % 1) + 1) % 1;
      const pulse = Math.pow(1 - phase, number(e.react?.decay, 2)),
        amount = number(e.react?.amount);
      let react = 1;
      if (e.react?.mode === 'pulse') react = 1 - amount + amount * pulse;
      if (e.react?.mode === 'boost') react = 1 + amount * Math.max(pulse, audio);
      if (e.react?.mode === 'strobe')
        react = 1 - amount + amount * Math.max(phase < 0.12 ? 1 : 0, e.react.source === 'kick' ? audio : 0);
      if (e.react?.mode === 'step')
        react = 1 - amount + amount * (Math.floor(transportBeat) % Math.max(1, count) === index ? 1 : 0);
      gl.useProgram(program);
      const pos = gl.getAttribLocation(program, 'position'),
        uv = gl.getAttribLocation(program, 'uv');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
      if (uv >= 0) {
        gl.enableVertexAttribArray(uv);
        gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
      }
      gl.uniform2f(L.center, (minX + maxX) / 2, (minY + maxY) / 2);
      gl.uniform2f(L.size, Math.max(1, (maxX - minX) * w), Math.max(1, (maxY - minY) * h));
      gl.uniform1f(L.t, t);
      gl.uniform1f(L.beat, beat);
      gl.uniform1f(L.widthScale, config.width);
      gl.uniform1f(L.hue, Math.floor(beat) * number(e.react?.hueStep) * Math.PI * 2);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        e.blendMode === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      const echoes = e.animation.type === 'concentric' ? Math.min(8, number(e.animation.count, 4)) : 1;
      for (let copy = 0; copy < echoes; copy++) {
        const scale =
          1 -
          copy * number(e.animation.spacing, 0.04) -
          ((t * number(e.animation.speed, 0.8)) % 1) * (echoes > 1 ? 0.06 : 0);
        gl.uniform2f(
          L.transform,
          e.animation.type === 'flipY' ? Math.cos(t * number(e.animation.speed, 0.5) * Math.PI * 2) : scale,
          scale,
        );
        gl.uniform1f(L.gain, config.amount * gain * e.opacity * react * (1 - copy / echoes));
        gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
      }
    }
    gl.disable(gl.BLEND);
  }
  destroy() {
    this.cache.forEach((passes) => passes.forEach((p) => this.gl.deleteProgram(p.program)));
    this.cache.clear();
    this.gl.deleteBuffer(this.buffer);
  }
}
