import type {ISFInput} from '../../isf/parser';
import type {TextureInput} from './compositor';
export type LiveKind='rear'|'front'|'depth';
export type LiveFrame={type:number;sequence:number;width:number;height:number;flags:number;intrinsics:Float32Array;planes:Uint8Array};
export function parseLiveFrame(buffer:ArrayBuffer):LiveFrame{
 if(buffer.byteLength<48)throw new Error('Incomplete native camera frame.');
 const v=new DataView(buffer),type=v.getUint32(4,true),width=v.getUint32(12,true),height=v.getUint32(16,true);
 if(v.getUint32(0,true)!==0x47414331||type>1||!width||!height||width>2048||height>2048||buffer.byteLength!==48+width*height*(type===1?2:1.5))throw new Error('Invalid native camera frame.');
 return{type,sequence:v.getUint32(8,true),width,height,flags:v.getUint32(20,true),intrinsics:new Float32Array([24,28,32,36].map(o=>v.getFloat32(o,true))),planes:new Uint8Array(buffer,48)};
}
type Cap={getPlatform?:()=>string;nativePromise?:(p:string,m:string,a:unknown)=>Promise<unknown>};
const cap=()=> (window as unknown as {Capacitor?:Cap}).Capacitor;
export const hasNativeLive=()=>cap()?.getPlatform?.()==='ios';
const configure=(sources:LiveKind[])=>{const c=cap();if(!c?.nativePromise)throw new Error('Native camera bridge unavailable.');return c.nativePromise('StudioCapture','liveConfigure',{sources});};
type Feed={kind:LiveKind;users:number;closed:boolean;lastFrameAt?:number;frame?:LiveFrame;error?:Error;timer?:ReturnType<typeof setTimeout>;abort?:AbortController};
const feeds=new Map<LiveKind,Feed>();let serial:Promise<unknown>=Promise.resolve();
function transaction<T>(f:()=>Promise<T>):Promise<T>{const next=serial.then(f,f);serial=next.catch(()=>{});return next;}
function stop(feed:Feed){feed.closed=true;clearTimeout(feed.timer);feed.abort?.abort();}
async function poll(feed:Feed){
 if(feed.closed)return;
 if(!document.hidden){try{feed.abort=new AbortController();const timeout=setTimeout(()=>feed.abort?.abort(),3000);let r:Response;try{r=await fetch(`ghostcapture://live/${feed.kind}`,{cache:'no-store',signal:feed.abort.signal});}finally{clearTimeout(timeout);}
  if(r.status!==204){if(!r.ok)throw new Error(await r.text()||'Native camera interrupted. Relaunch this clip.');feed.frame=parseLiveFrame(await r.arrayBuffer());feed.lastFrameAt=performance.now();feed.error=undefined;}else if(feed.lastFrameAt&&performance.now()-feed.lastFrameAt>3000){feed.error=new Error('Camera interrupted. Stop and relaunch this clip.');}
 }catch(e){if(!feed.closed)feed.error=e instanceof Error?e:new Error('Native camera connection failed.');}}
 if(!feed.closed)feed.timer=setTimeout(()=>void poll(feed),feed.kind==='depth'?66:41);
}
export async function acquireNativeFeed(kind:LiveKind){
 const feed=await transaction(async()=>{
  const existing=feeds.get(kind);if(existing){existing.users++;return existing;}
  const kinds=[...feeds.keys(),kind];if(kinds.includes('depth')&&kinds.includes('front'))throw new Error('Stop the depth clip before launching the front camera. LiDAR owns the rear capture session.');
  await configure(kinds);const f:Feed={kind,users:1,closed:false};feeds.set(kind,f);void poll(f);return f;
 });
 let released=false;
 const release=()=>{if(released)return;released=true;void transaction(async()=>{if(feeds.get(kind)!==feed)return;if(--feed.users===0){stop(feed);feeds.delete(kind);await configure([...feeds.keys()]);}}).catch(console.error);};
 try{const deadline=performance.now()+12000;while(!feed.frame&&!feed.error&&!feed.closed&&performance.now()<deadline)await new Promise(r=>setTimeout(r,30));if(feed.error)throw feed.error;if(!feed.frame||feed.closed)throw new Error('The camera did not deliver a frame. Stop and relaunch the clip.');return{feed,release};}catch(e){release();throw e;}
}
// Only the replacing slot may relinquish its incompatible source.
export function canReplaceNativeFeed(old:LiveKind,next:LiveKind){
 const incompatible=(old==='front'&&next==='depth')||(old==='depth'&&next==='front');
 if(!incompatible)return false;
 if((feeds.get(old)?.users??0)>1)throw new Error('Stop the other '+old+' camera clips before switching to '+next+'.');
 return true;
}
export const stopNativeFeeds=()=>transaction(async()=>{for(const f of feeds.values())stop(f);feeds.clear();if(hasNativeLive())await configure([]);});
export const depthInputs:ISFInput[]=[
 {NAME:'depthLook',LABEL:'Depth look',TYPE:'long',DEFAULT:1,VALUES:[0,1,2,3],LABELS:['Depth','Neon','Contours','Point cloud']},
 {NAME:'depthFreeze',LABEL:'Freeze depth · keep orbiting',TYPE:'bool',DEFAULT:false},
 {NAME:'depthNear',LABEL:'Near cut · meters',TYPE:'float',DEFAULT:.2,MIN:.1,MAX:3},
 {NAME:'depthFar',LABEL:'Far cut · meters',TYPE:'float',DEFAULT:5,MIN:.3,MAX:10},
 {NAME:'depthColor',LABEL:'Color shift',TYPE:'float',DEFAULT:0,MIN:0,MAX:1},
 {NAME:'depthDissolve',LABEL:'Dissolve',TYPE:'float',DEFAULT:0,MIN:0,MAX:1},
 {NAME:'depthYaw',LABEL:'Orbit',TYPE:'float',DEFAULT:0,MIN:-1.5,MAX:1.5},
 {NAME:'depthPitch',LABEL:'Tilt',TYPE:'float',DEFAULT:0,MIN:-1,MAX:1},
 {NAME:'depthZoom',LABEL:'Zoom',TYPE:'float',DEFAULT:1,MIN:.3,MAX:3},
 {NAME:'depthSize',LABEL:'Point size',TYPE:'float',DEFAULT:3,MIN:1,MAX:10},
];
const vertex=`attribute vec2 a;varying vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0,1);}`;
const readDepth=`float meters(vec2 p){vec4 d=texture2D(t0,p);return (d.r*255.+d.a*65280.)*.001;}`;
const color=`vec3 palette(float z){return .5+.5*cos(6.28318*(vec3(0.,.33,.67)+z*.25+shift));}`;
const fragment=`precision highp float;varying vec2 uv;uniform sampler2D t0,t1;uniform float mode,shift,nearCut,farCut,dissolve,mirror,flags;${readDepth}${color}
void main(){vec2 p=vec2(mirror>.5?1.-uv.x:uv.x,1.-uv.y);if(mode<-.5){if(flags>3.5)p=vec2(1.-uv.y,mirror>.5?uv.x:1.-uv.x);float y=texture2D(t0,p).r;vec4 cc=texture2D(t1,p);vec2 c=vec2(cc.r,cc.a)-vec2(128./255.);if(mod(floor(flags/2.),2.)>.5){y=(y-16./255.)*255./219.;c*=255./224.;}bool hd=mod(flags,2.)>.5;gl_FragColor=vec4(y+dot(c,vec2(0,hd?1.5748:1.402)),y+dot(c,hd?vec2(-.1873,-.4681):vec2(-.344136,-.714136)),y+dot(c,vec2(hd?1.8556:1.772,0)),1);return;}
// ARKit depth stays in sensor landscape coordinates; present it clockwise for the portrait instrument.
p=flags>7.5?vec2(uv.x,1.-uv.y):vec2(1.-uv.y,1.-uv.x);float z=meters(p);if(z<nearCut||z>farCut)discard;float hash=fract(sin(dot(floor(p*vec2(512,384)),vec2(12.9898,78.233)))*43758.5453);if(hash<dissolve)discard;vec3 c=mode<.5?vec3(1.-(z-nearCut)/(farCut-nearCut)):palette(z);if(mode>1.5)c*=smoothstep(.1,.24,abs(fract(z*8.)-.5));gl_FragColor=vec4(c,1);}`;
const pointVertex=`precision highp float;attribute vec2 a;uniform sampler2D t0;uniform vec4 intrinsics;uniform float yaw,pitch,zoom,size,nearCut,farCut,flags;varying float zDepth;varying vec2 sampleUV;${readDepth}
void main(){float z=meters(a);zDepth=z;sampleUV=a;vec3 p=vec3((a.x-intrinsics.z)*z/intrinsics.x,-(a.y-intrinsics.w)*z/intrinsics.y,z);if(flags<7.5)p.xy=vec2(p.y,-p.x);float pivot=(nearCut+farCut)*.5;p.z-=pivot;p.xz=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw))*p.xz;p.yz=mat2(cos(pitch),-sin(pitch),sin(pitch),cos(pitch))*p.yz;p.z+=pivot;float w=max(.01,p.z);vec2 clip=vec2(p.x*2.*intrinsics.y,p.y*2.*intrinsics.x)*zoom+vec2(1.-2.*intrinsics.w,1.-2.*intrinsics.z)*w;if(flags>7.5)clip=vec2(p.x*2.*intrinsics.x,p.y*2.*intrinsics.y)*zoom+vec2(2.*intrinsics.z-1.,1.-2.*intrinsics.w)*w;gl_Position=vec4(clip,w*.98-.02,w);gl_PointSize=size;if(z<nearCut||z>farCut||p.z<.05)gl_Position=vec4(2,2,2,1);}`;
const pointFragment=`precision highp float;varying float zDepth;varying vec2 sampleUV;uniform float shift,dissolve;${color}void main(){if(length(gl_PointCoord-.5)>.5||fract(sin(dot(sampleUV,vec2(12.9898,78.233)))*43758.5453)<dissolve)discard;gl_FragColor=vec4(palette(zDepth),1);}`;
export class NativeLiveSource{
 private programs:WebGLProgram[]=[];private textures:WebGLTexture[]=[];private buffer:WebGLBuffer;private points:WebGLBuffer;private fbo:WebGLFramebuffer;private depth:WebGLRenderbuffer;
 private sequence=-1;private frame?:LiveFrame;private pointCount=0;private released=false;private w=640;private h=480;private failureReported=false;
 constructor(private gl:WebGLRenderingContext,readonly kind:LiveKind,private capture:Awaited<ReturnType<typeof acquireNativeFeed>>,private onError:(s:string)=>void){
  this.buffer=gl.createBuffer()!;this.points=gl.createBuffer()!;this.fbo=gl.createFramebuffer()!;this.depth=gl.createRenderbuffer()!;
  try{this.programs.push(this.program(vertex,fragment));this.programs.push(this.program(pointVertex,pointFragment));
   for(let i=0;i<3;i++){const t=gl.createTexture()!;this.textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);this.resize(640,480);
  }catch(e){this.destroy();throw e;}
 }
 private program(v:string,f:string){const g=this.gl,p=g.createProgram()!;const shaders:WebGLShader[]=[];try{for(const [type,code] of [[g.VERTEX_SHADER,v],[g.FRAGMENT_SHADER,f]] as const){const s=g.createShader(type)!;shaders.push(s);g.shaderSource(s,code);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s)||'Native source shader failed.');g.attachShader(p,s);}g.bindAttribLocation(p,0,'a');g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p)||'Native source link failed.');return p;}catch(e){g.deleteProgram(p);throw e;}finally{shaders.forEach(s=>g.deleteShader(s));}}
 private resize(w:number,h:number){const g=this.gl;this.w=w;this.h=h;g.bindTexture(g.TEXTURE_2D,this.textures[2]);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,this.fbo);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.textures[2],0);g.bindRenderbuffer(g.RENDERBUFFER,this.depth);g.renderbufferStorage(g.RENDERBUFFER,g.DEPTH_COMPONENT16,w,h);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.DEPTH_ATTACHMENT,g.RENDERBUFFER,this.depth);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Native camera framebuffer unavailable.');}
 draw(params:Record<string,number|boolean|number[]>){
  const g=this.gl,feed=this.capture.feed;if(feed.error||feed.closed){g.bindFramebuffer(g.FRAMEBUFFER,this.fbo);g.disable(g.SCISSOR_TEST);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);if(feed.error&&!this.failureReported){this.failureReported=true;this.onError(feed.error.message);}return;}this.failureReported=false;if(!feed.frame)return;
  if(feed.frame.sequence!==this.sequence && !(this.frame&&params.depthFreeze===true&&this.kind==='depth')){this.frame=feed.frame;this.sequence=this.frame.sequence;const f=this.frame;g.pixelStorei(g.UNPACK_ALIGNMENT,1);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,0);
   g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.textures[0]);g.texImage2D(g.TEXTURE_2D,0,f.type===1?g.LUMINANCE_ALPHA:g.LUMINANCE,f.width,f.height,0,f.type===1?g.LUMINANCE_ALPHA:g.LUMINANCE,g.UNSIGNED_BYTE,f.type===1?f.planes:f.planes.subarray(0,f.width*f.height));
   if(f.type===0){g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.textures[1]);g.texImage2D(g.TEXTURE_2D,0,g.LUMINANCE_ALPHA,f.width/2,f.height/2,0,g.LUMINANCE_ALPHA,g.UNSIGNED_BYTE,f.planes.subarray(f.width*f.height));}
   const rotated=(f.type===1&&!(f.flags&8))||(f.flags&4)!==0;const scale=640/Math.max(f.width,f.height),w=Math.round(scale*(rotated?f.height:f.width)),h=Math.round(scale*(rotated?f.width:f.height));if(this.w!==w||this.h!==h)this.resize(w,h);
   if(f.type===1&&this.pointCount!==f.width*f.height){this.pointCount=f.width*f.height;const points=new Float32Array(this.pointCount*2);for(let i=0;i<this.pointCount;i++){points[i*2]=(i%f.width+.5)/f.width;points[i*2+1]=(Math.floor(i/f.width)+.5)/f.height;}g.bindBuffer(g.ARRAY_BUFFER,this.points);g.bufferData(g.ARRAY_BUFFER,points,g.STATIC_DRAW);}
  }
  const f=this.frame!;const val=(key:string,d:number)=>typeof params[key]==='number'?params[key] as number:d;
  const look=f.type===0?-1:val('depthLook',1),isPoints=look>2.5,p=this.programs[isPoints?1:0];g.bindFramebuffer(g.FRAMEBUFFER,this.fbo);g.viewport(0,0,this.w,this.h);g.disable(g.BLEND);g.disable(g.SCISSOR_TEST);g.depthMask(true);g.clearColor(0,0,0,0);g.clearDepth(1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);isPoints?g.enable(g.DEPTH_TEST):g.disable(g.DEPTH_TEST);g.useProgram(p);
  for(let i=0;i<2;i++){g.activeTexture(g.TEXTURE0+i);g.bindTexture(g.TEXTURE_2D,this.textures[i]);g.uniform1i(g.getUniformLocation(p,`t${i}`),i);}
  const near=val('depthNear',.2),far=Math.max(near+.01,val('depthFar',5));
  for(const [name,value] of Object.entries({mode:look,nearCut:near,farCut:far,shift:val('depthColor',0),dissolve:val('depthDissolve',0),yaw:val('depthYaw',0),pitch:val('depthPitch',0),zoom:val('depthZoom',1),size:val('depthSize',3),flags:f.flags,mirror:this.kind==='front'?1:0}))g.uniform1f(g.getUniformLocation(p,name),value);
  g.uniform4fv(g.getUniformLocation(p,'intrinsics'),f.intrinsics);g.bindBuffer(g.ARRAY_BUFFER,isPoints?this.points:this.buffer);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,0,0);g.drawArrays(isPoints?g.POINTS:g.TRIANGLES,0,isPoints?this.pointCount:6);g.disable(g.DEPTH_TEST);g.pixelStorei(g.UNPACK_ALIGNMENT,4);
 }
 get textureOutput():TextureInput{return {texture:this.textures[2],width:this.w,height:this.h};}
 destroy(){if(this.released)return;this.released=true;this.capture.release();const g=this.gl;this.programs.forEach(p=>g.deleteProgram(p));this.textures.forEach(t=>g.deleteTexture(t));g.deleteBuffer(this.buffer);g.deleteBuffer(this.points);g.deleteFramebuffer(this.fbo);g.deleteRenderbuffer(this.depth);}
}
