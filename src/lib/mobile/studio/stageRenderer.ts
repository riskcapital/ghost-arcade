// Renders a template's stage (stageScenes.ts): ray-marched boxes with soft shadows, ambient
// occlusion and a floor reflection, lit by one key light and any lamps in the scene. Used for the
// template gallery's thumbnails (with each surface's visual projected onto its face) and for the
// preview backdrop behind a template's surfaces. Pictures are made once, in a short-lived GPU
// context of their own, and handed back as JPEG data URLs; nothing here runs per frame.

import { quadPoint } from './compositor';
import { shaderThumbnail } from './model';
import {
  cameraBasis,
  STAGE_MATERIALS,
  surfaceWorldCorners,
  projectPoint,
  findTemplate,
  type MappingTemplate,
} from './stageScenes';

const MAX_BOXES = 12;

const VERT = `attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;

const FRAG = `precision highp float;
#define MAXB ${MAX_BOXES}
uniform vec2 uRes;
uniform vec3 uEye,uFw,uRt,uUp,uTarget;
uniform float uFocal;
uniform vec4 uBoxP[MAXB];
uniform vec4 uBoxH[MAXB];
uniform vec2 uBoxM[MAXB];
uniform int uCount;
uniform float uWallZ,uNight;
uniform vec3 uKeyPos,uKeyCol,uLampPos,uLampCol;
uniform float uScreen;

float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}

vec3 toLocal(vec3 p,vec4 at,float roll){
 vec3 q=p-at.xyz;float c=cos(at.w),s=sin(at.w);
 q=vec3(q.x*c-q.z*s,q.y,q.x*s+q.z*c);
 float rc=cos(roll),rs=sin(roll);
 return vec3(q.x*rc+q.y*rs,-q.x*rs+q.y*rc,q.z);
}
float sdBox(vec3 p,vec3 b,float r){vec3 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}

// x: distance, y: material (10 floor, 11 back wall)
vec2 map(vec3 p){
 vec2 res=vec2(p.y,10.);
 if(uNight<.5){float w=p.z-uWallZ;if(w<res.x)res=vec2(w,11.);}
 for(int i=0;i<MAXB;i++){
  if(i>=uCount)break;
  // Cheap bound first: a box further away than the nearest thing so far cannot win.
  if(length(p-uBoxP[i].xyz)-length(uBoxH[i].xyz)>res.x)continue;
  vec3 q=toLocal(p,uBoxP[i],uBoxM[i].y);
  float d=sdBox(q,uBoxH[i].xyz,uBoxH[i].w);
  if(d<res.x)res=vec2(d,uBoxM[i].x);
 }
 return res;
}
vec3 normalAt(vec3 p){vec2 e=vec2(.0015,-.0015);
 return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x);}
vec2 march(vec3 ro,vec3 rd,float far){
 float t=.01;
 for(int i=0;i<90;i++){vec2 h=map(ro+rd*t);if(h.x<.0006*t)return vec2(t,h.y);t+=h.x*.9;if(t>far)break;}
 return vec2(-1.);
}
float shadow(vec3 ro,vec3 rd,float far){
 float r=1.,t=.02;
 for(int i=0;i<28;i++){float h=map(ro+rd*t).x;r=min(r,10.*h/t);t+=clamp(h,.02,.3);if(r<.002||t>far)break;}
 return clamp(r,0.,1.);
}
float occlusion(vec3 p,vec3 n){
 float o=0.,w=1.;
 for(int i=1;i<5;i++){float d=.045*float(i);o+=(d-map(p+n*d).x)*w;w*=.6;}
 return clamp(1.-2.4*o,0.,1.);
}
vec3 albedo(float m,vec3 p,vec3 n){
 if(m<.5)return vec3(.80,.79,.76)*uScreen*(.96+.04*noise(p.xy*40.));
 if(m<1.5)return vec3(.075,.07,.065);
 if(m<2.5)return vec3(.012,.014,.018);
 if(m<3.5)return vec3(.022)*(.8+.4*noise(p.xy*180.));
 if(m<4.5){float board=smoothstep(.0,.025,fract(p.y/.17))*.25+.75;return vec3(.20,.21,.22)*board*(.9+.2*fbm(p.xz*3.+p.y));}
 if(m<5.5)return vec3(.045,.04,.04)*(.7+.6*noise(vec2(p.x*9.,p.y*30.)));
 if(m<6.5)return vec3(1.);
 if(m<7.5)return vec3(.84,.83,.80)*uScreen;
 if(m<8.5)return vec3(.32,.33,.35);
 if(m<10.5){
  if(uNight>.5)return mix(vec3(.018,.024,.016),vec3(.04,.04,.038),smoothstep(.45,.6,fbm(p.xz*.6)));
  return vec3(.055,.052,.05)*(.75+.5*fbm(p.xz*1.4));
 }
 return vec3(.13,.125,.12)*(.82+.36*fbm(p.xy*2.2));
}
float roughness(float m){return m<.5?.9:m<1.5?.6:m<2.5?.08:m<3.5?.95:m<8.5?(m>7.5?.35:.85):m<10.5?(uNight>.5?.95:.28):.9;}
vec3 sky(vec3 rd){
 if(uNight<.5)return vec3(.004,.004,.005);
 float h=clamp(rd.y,0.,1.);
 vec3 c=mix(vec3(.05,.045,.06),vec3(.004,.008,.022),pow(h,.45));
 vec2 sp=rd.xz/(rd.y+.15)*90.;float star=step(.9975,hash(floor(sp)))*smoothstep(.05,.3,h);
 return c+vec3(star)*.6;
}
vec3 light(vec3 p,vec3 n,vec3 v,float m,vec3 base,vec3 lp,vec3 lc,bool spot,bool shadows){
 vec3 l=lp-p;float d=length(l);l/=d;
 float nl=max(dot(n,l),0.);if(nl<=0.)return vec3(0.);
 float fall=1./(1.+.09*d*d);
 if(spot){vec3 axis=normalize(uTarget-lp);fall*=smoothstep(.80,.95,dot(-l,axis))*.85+.15;}
 float sh=shadows?shadow(p+n*.004,l,d):1.;
 vec3 h=normalize(l+v);float r=roughness(m);
 float spec=pow(max(dot(n,h),0.),mix(220.,8.,r))*(1.-r)*1.4;
 return lc*fall*sh*(base*nl+spec*nl);
}
vec3 shade(vec3 ro,vec3 rd,vec2 hit,bool detail){
 vec3 p=ro+rd*hit.x,n=normalAt(p),v=-rd,base=albedo(hit.y,p,n);
 if(hit.y>5.5&&hit.y<6.5)return vec3(3.2,2.1,1.1);
 float ao=detail?occlusion(p,n):1.;
 vec3 skyCol=uNight>.5?vec3(.03,.045,.09):vec3(.03,.032,.04);
 vec3 groundCol=uNight>.5?vec3(.01,.012,.01):vec3(.018,.016,.015);
 vec3 col=base*mix(groundCol,skyCol,n.y*.5+.5)*ao*1.6;
 col+=light(p,n,v,hit.y,base,uKeyPos,uKeyCol,true,detail);
 if(dot(uLampCol,uLampCol)>0.)col+=light(p,n,v,hit.y,base,uLampPos+vec3(0.,0.,.18),uLampCol,false,false)*ao;
 return col;
}
void main(){
 vec2 ndc=(gl_FragCoord.xy/uRes)*2.-1.;
 vec3 rd=normalize(uFw*uFocal+uRt*ndc.x*(uRes.x/uRes.y)+uUp*ndc.y);
 vec3 ro=uEye;
 vec2 hit=march(ro,rd,40.);
 vec3 col;
 if(hit.x<0.)col=sky(rd);
 else{
  col=shade(ro,rd,hit,true);
  vec3 p=ro+rd*hit.x;
  // A polished floor shows a soft reflection of what stands on it.
  if(hit.y>9.5&&hit.y<10.5&&uNight<.5){
   vec3 n=vec3(0.,1.,0.),r=reflect(rd,n);
   vec3 r2=normalize(r+vec3(fbm(p.xz*8.)-.5,0.,fbm(p.zx*8.)-.5)*.03);
   vec2 h2=march(p+n*.01,r2,8.);
   float fres=.04+.5*pow(1.-max(dot(n,-rd),0.),5.);
   if(h2.x>0.)col+=shade(p+n*.01,r2,h2,false)*fres*exp(-h2.x*.9)*.9;
  }
  float fog=1.-exp(-hit.x*(uNight>.5?.018:.035));
  col=mix(col,uNight>.5?vec3(.012,.015,.03):vec3(.006,.006,.008),fog);
 }
 vec2 uv=gl_FragCoord.xy/uRes;
 col*=1.-.55*pow(length((uv-.5)*vec2(1.05,1.25)),2.4);
 col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
 col=pow(clamp(col,0.,1.),vec3(1./2.2));
 col+=(hash(gl_FragCoord.xy)-.5)/255.;
 gl_FragColor=vec4(col,1.);
}`;

// Projected light: the visual added onto its face, the way a projector lights a matte surface.
const QUAD_VERT = `attribute vec2 position;attribute vec2 uv;uniform float depth;varying vec2 v;void main(){v=uv;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,depth,1.);}`;
const QUAD_FRAG = `precision mediump float;varying vec2 v;uniform sampler2D image;uniform float gain;
void main(){vec3 c=texture2D(image,v).rgb;float edge=min(min(v.x,1.-v.x),min(v.y,1.-v.y));gl_FragColor=vec4(c*gain*smoothstep(0.,.012,edge),1.);}`;

export type StageShot = { template: string; width: number; height: number; content: boolean };

const cache = new Map<string, string>();
const key = (shot: StageShot) => `${shot.template}:${shot.width}x${shot.height}:${shot.content ? 1 : 0}`;

/** A picture made earlier in this session, without touching the GPU. */
export const cachedStage = (shot: StageShot) => cache.get(key(shot));

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Mesh of one projected quad in output coordinates (x, y) with its picture coordinates (u, v). */
function quadMesh(corners: { x: number; y: number }[], cells = 12): Float32Array {
  const out: number[] = [];
  const at = (i: number, j: number) => {
    const u = i / cells,
      v = j / cells,
      p = quadPoint(corners, u, v);
    return [p.x, p.y, u, v];
  };
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) out.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
  return new Float32Array(out);
}

/**
 * Renders the shots in one short-lived GPU context and returns a JPEG data URL for each (null if
 * the device could not render it). Shots already made this session come from the cache.
 */
export async function renderStages(shots: StageShot[]): Promise<(string | null)[]> {
  const missing = shots.filter((shot) => !cache.has(key(shot)) && findTemplate(shot.template));
  if (missing.length) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: true, preserveDrawingBuffer: true });
    if (gl) {
      try {
        await renderInto(gl, canvas, missing);
      } catch {
        /* a device without room for one more context simply gets no pictures */
      } finally {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  }
  return shots.map((shot) => cache.get(key(shot)) ?? null);
}

async function renderInto(gl: WebGLRenderingContext, canvas: HTMLCanvasElement, shots: StageShot[]) {
  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Stage shader failed');
    return shader;
  };
  const program = (vert: string, frag: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Stage program failed');
    return p;
  };
  const stage = program(VERT, FRAG);
  const quad = program(QUAD_VERT, QUAD_FRAG);
  const full = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const mesh = gl.createBuffer()!;
  const texture = gl.createTexture()!;
  const thumbnails = new Map<string, HTMLImageElement | null>();
  for (const shot of shots) {
    const template = findTemplate(shot.template)!;
    canvas.width = shot.width;
    canvas.height = shot.height;
    gl.viewport(0, 0, shot.width, shot.height);
    gl.disable(gl.BLEND);
    gl.useProgram(stage);
    setStageUniforms(gl, stage, template, shot.width, shot.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, full);
    const position = gl.getAttribLocation(stage, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    // In bands, so no single draw runs long enough to trouble an older phone's GPU watchdog.
    gl.enable(gl.SCISSOR_TEST);
    const bands = 4;
    for (let band = 0; band < bands; band++) {
      const y0 = Math.floor((band * shot.height) / bands),
        y1 = Math.floor(((band + 1) * shot.height) / bands);
      gl.scissor(0, y0, shot.width, y1 - y0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disableVertexAttribArray(position);
    if (shot.content) {
      gl.useProgram(quad);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      // Later surfaces sit on top in the output, so only the topmost picture lights each pixel:
      // draw from the top down and let depth keep the first one.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const qPosition = gl.getAttribLocation(quad, 'position'),
        qUv = gl.getAttribLocation(quad, 'uv');
      gl.uniform1i(gl.getUniformLocation(quad, 'image'), 0);
      gl.uniform1f(gl.getUniformLocation(quad, 'gain'), template.scene.env === 'night' ? 0.82 : 0.78);
      const basis = cameraBasis(template.scene);
      for (let i = template.surfaces.length - 1; i >= 0; i--) {
        const url = shaderThumbnail(template.surfaces[i].shader);
        if (!url) continue;
        if (!thumbnails.has(url)) thumbnails.set(url, await loadImage(url));
        const image = thumbnails.get(url);
        if (!image) continue;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
        const corners = surfaceWorldCorners(template, i).map((p) => projectPoint(template.scene, p, basis));
        const vertices = quadMesh([corners[0], corners[1], corners[2], corners[3]]);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(qPosition);
        gl.vertexAttribPointer(qPosition, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(qUv);
        gl.vertexAttribPointer(qUv, 2, gl.FLOAT, false, 16, 8);
        gl.uniform1f(gl.getUniformLocation(quad, 'depth'), 0.9 - (template.surfaces.length - 1 - i) * 0.05);
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.disableVertexAttribArray(qPosition);
      gl.disableVertexAttribArray(qUv);
      gl.disable(gl.BLEND);
    }
    if (!gl.isContextLost()) cache.set(key(shot), canvas.toDataURL('image/jpeg', 0.86));
  }
}

function setStageUniforms(gl: WebGLRenderingContext, program: WebGLProgram, template: MappingTemplate, width: number, height: number) {
  const u = (name: string) => gl.getUniformLocation(program, name);
  const { scene } = template;
  const basis = cameraBasis(scene);
  gl.uniform2f(u('uRes'), width, height);
  gl.uniform3fv(u('uEye'), basis.eye);
  gl.uniform3fv(u('uFw'), basis.forward);
  gl.uniform3fv(u('uRt'), basis.right);
  gl.uniform3fv(u('uUp'), basis.up);
  gl.uniform3fv(u('uTarget'), scene.target);
  gl.uniform1f(u('uFocal'), basis.focal);
  const boxes = scene.boxes.slice(0, MAX_BOXES);
  const p = new Float32Array(MAX_BOXES * 4),
    h = new Float32Array(MAX_BOXES * 4),
    m = new Float32Array(MAX_BOXES * 2);
  boxes.forEach((box, i) => {
    p.set([...box.at, box.yaw ?? 0], i * 4);
    h.set([...box.half, box.round ?? 0], i * 4);
    m.set([STAGE_MATERIALS[box.material], box.roll ?? 0], i * 2);
  });
  gl.uniform4fv(u('uBoxP'), p);
  gl.uniform4fv(u('uBoxH'), h);
  gl.uniform2fv(u('uBoxM'), m);
  gl.uniform1i(u('uCount'), boxes.length);
  gl.uniform1f(u('uWallZ'), scene.wallZ ?? -50);
  gl.uniform1f(u('uNight'), scene.env === 'night' ? 1 : 0);
  gl.uniform3fv(u('uKeyPos'), scene.key.at);
  gl.uniform3fv(u('uKeyCol'), scene.key.color);
  const lamp = boxes.find((box) => box.material === 'lamp');
  gl.uniform3fv(u('uLampPos'), lamp?.at ?? [0, 0, 0]);
  gl.uniform3fv(u('uLampCol'), lamp ? [1.6, 1.0, 0.45] : [0, 0, 0]);
  // Surfaces a projector paints are drawn as they look with the projector on and the room dark:
  // dim enough that the picture on them reads as light.
  gl.uniform1f(u('uScreen'), 0.3);
}
