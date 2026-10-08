import {crossPaintEdge,type PaintConfig,type PaintParticle,type PaintStroke,type PaintSample} from './paint';
import type {Surface} from './model';
const vertex=`attribute vec2 position;attribute vec4 shape;attribute vec3 color;varying vec4 style;varying vec3 tint;void main(){gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0,1);gl_PointSize=shape.x;style=shape;tint=color;}`;
const fragment=`precision mediump float;varying vec4 style;varying vec3 tint;void main(){
 vec2 p=gl_PointCoord*2.-1.;float radius=length(p),alpha;vec3 c=tint;
 if(style.z<.5){alpha=exp(-radius*radius*4.)*(1.-smoothstep(.75,1.,radius));c=mix(tint,vec3(1),exp(-radius*radius*32.));}
 else if(style.z<1.5){float cloud=.85+.15*sin(p.x*9.+style.w)*cos(p.y*8.-style.w);alpha=pow(max(0.,1.-radius),1.5)*cloud*.55;}
 else{float r=length(vec2(p.x*1.4,p.y));alpha=1.-smoothstep(.7,.98,r);float gloss=exp(-dot(p-vec2(-.22,-.28),p-vec2(-.22,-.28))*34.);c=tint*(.65+.35*(1.-p.y))+vec3(gloss*.8);}
 if(alpha<.005)discard;gl_FragColor=vec4(c,alpha*style.y);
}`;
export class PaintRenderer{
 private program:WebGLProgram;private buffer:WebGLBuffer;
 private targets=new Map<string,{texture:WebGLTexture;frame:WebGLFramebuffer}>();
 private particles:PaintParticle[]=[];private counts=new Map<string,number>();
 private lastTime=0;private lastBeat=0;private loopStart=0;private looping=false;private loopBeats=0;
 private showId='';private strokeRefs=new Map<string,PaintStroke>();
 private locations:number[];private maxPoint:number;
 constructor(private gl:WebGLRenderingContext){
  const p=gl.createProgram()!;const shaders:WebGLShader[]=[];
  try{for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Paint shader failed');gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Paint shader link failed');}catch(e){gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}
  this.program=p;this.buffer=gl.createBuffer()!;this.locations=['position','shape','color'].map(n=>gl.getAttribLocation(p,n));this.maxPoint=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
 }
 private emit(stroke:PaintStroke,sample:PaintSample){
  const rgb=[1,3,5].map(i=>parseInt(stroke.color.slice(i,i+2),16)/255);
  this.particles.push({stroke:stroke.id,surface:sample.surface,u:sample.u,v:sample.v,vx:0,vy:stroke.brush==='smoke'?-.025:0,age:0,life:stroke.life,size:stroke.size*(.65+sample.pressure*.7),kind:stroke.brush==='light'?0:stroke.brush==='smoke'?1:2,color:rgb,seed:Math.random()*6.28});
 }
 prepare(id:string,config:PaintConfig|undefined,surfaces:Surface[],time:number,beat:number){
  if(id!==this.showId){this.particles=[];this.counts.clear();this.strokeRefs.clear();this.showId=id;this.looping=false;}
  const dt=Math.max(0,Math.min(.05,time-this.lastTime));this.lastTime=time;
  if(!config?.enabled){this.releaseTargets(new Set());this.lastBeat=beat;return;}
  const ids=new Set(config.strokes.map(s=>s.id)),visible=new Set(surfaces.filter(s=>s.enabled).map(s=>s.id));
  this.particles=this.particles.filter(p=>ids.has(p.stroke)&&visible.has(p.surface));
  for(const key of this.counts.keys())if(!ids.has(key)){this.counts.delete(key);this.strokeRefs.delete(key);}
  if(config.loop&&(!this.looping||this.loopBeats!==config.beats||beat<this.lastBeat||beat-this.lastBeat>2)){this.loopStart=Math.ceil(beat/config.beats)*config.beats;this.lastBeat=beat;}
  const origin=config.strokes[0]?.samples[0]?.beat??0;
  for(const s of config.strokes){
   const n=this.counts.get(s.id)??0;
   for(let i=n;i<s.samples.length;i++)if(visible.has(s.samples[i].surface))this.emit(s,s.samples[i]);
   this.counts.set(s.id,s.samples.length);this.strokeRefs.set(s.id,s);
   if(config.loop&&!config.hold&&beat>=this.loopStart&&beat-this.lastBeat<2&&beat>=this.lastBeat){
    for(const sample of s.samples){const offset=((sample.beat-origin)%config.beats+config.beats)%config.beats;
     const cycle=Math.floor((beat-this.loopStart-offset)/config.beats);
     const at=this.loopStart+cycle*config.beats+offset;
     if(cycle>=0&&at>this.lastBeat&&at<=beat&&visible.has(sample.surface))this.emit(s,sample);
    }
   }
  }
  this.looping=config.loop;this.loopBeats=config.beats;this.lastBeat=beat;
  if(!config.hold){
   this.particles=this.particles.filter(p=>{
    p.age+=dt;if(p.age>p.life)return false;
    if(p.kind===1){p.u+=Math.sin(p.seed+p.age*2)*dt*.018;p.v-=dt*.025;}
    if(p.kind===2){p.vy+=config.gravity*dt*.07;p.vx+=(Math.sin(p.seed+p.age)*.02-p.vx)*dt;p.u+=p.vx*dt;p.v+=p.vy*dt;}
    return crossPaintEdge(p,config.links,surfaces);
   });
  }
  if(this.particles.length>4000)this.particles.splice(0,this.particles.length-4000);
  const active=new Set(this.particles.map(p=>p.surface));this.releaseTargets(active);
  const g=this.gl;g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.disable(g.CULL_FACE);
  for(const sid of active){
   let t=this.targets.get(sid);
   if(!t){const texture=g.createTexture()!,frame=g.createFramebuffer()!;g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,320,320,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,frame);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
    if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE){g.deleteTexture(texture);g.deleteFramebuffer(frame);throw new Error('Paint target unavailable');}t={texture,frame};this.targets.set(sid,t);}
   g.bindFramebuffer(g.FRAMEBUFFER,t.frame);g.viewport(0,0,320,320);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.useProgram(this.program);
   const points=this.particles.filter(p=>p.surface===sid),data=new Float32Array(points.length*9);
   points.forEach((p,i)=>data.set([p.u,p.v,Math.min(this.maxPoint,p.size*640*(p.kind===1?1+p.age*.25:1)),Math.pow(1-p.age/p.life,.6),p.kind,p.seed+p.age,...p.color],i*9));
   g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,data,g.DYNAMIC_DRAW);
   [2,4,3].forEach((n,i)=>{g.enableVertexAttribArray(this.locations[i]);g.vertexAttribPointer(this.locations[i],n,g.FLOAT,false,36,[0,8,24][i]);});
   // Premultiplied result; compositor uses ONE blending for this overlay.
   g.enable(g.BLEND);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE_MINUS_SRC_ALPHA);g.drawArrays(g.POINTS,0,points.length);
   this.locations.forEach(l=>g.disableVertexAttribArray(l));
  }g.disable(g.BLEND);
 }
 texture(id:string){return this.targets.get(id)?.texture;}
 private releaseTargets(active:Set<string>){for(const [id,t] of this.targets)if(!active.has(id)){this.gl.deleteTexture(t.texture);this.gl.deleteFramebuffer(t.frame);this.targets.delete(id);}}
 destroy(){this.releaseTargets(new Set());this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
}
