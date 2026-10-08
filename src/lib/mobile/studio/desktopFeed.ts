import {acquireNativeFeed,NativeLiveSource,hasNativeLive,type LiveKind} from './nativeLive';
import {acquireCamera} from './camera';
export type DesktopFeedKind='rear'|'front'|'dual'|'depth'|'contours'|'points';
export const desktopFeedKinds:DesktopFeedKind[]=['rear','front','dual','depth','contours','points'];
/** A clean canvas video source. Transport is deliberately separate from camera ownership. */
export class DesktopFeedPreview {
 private sources:NativeLiveSource[]=[];private video?:HTMLVideoElement;private releaseCamera?:()=>void;
 private gl?:WebGLRenderingContext;private program?:WebGLProgram;private buffer?:WebGLBuffer;
 private raf=0;private closed=false;private stream?:MediaStream;
 near=.2;far=5;color=0;
 constructor(readonly canvas:HTMLCanvasElement,readonly kind:DesktopFeedKind,private onError:(s:string)=>void){}
 async start(){
  try{
   if(hasNativeLive()){
    const g=this.canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true});if(!g)throw new Error('GPU camera preview unavailable.');this.gl=g;
    const p=g.createProgram()!;this.program=p;
    for(const [type,code] of [[g.VERTEX_SHADER,'attribute vec2 a;varying vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0,1);}'],[g.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=vec4(texture2D(t,uv).rgb,1);}']] as const){const s=g.createShader(type)!;g.shaderSource(s,code);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS)){g.deleteShader(s);throw new Error('Camera preview shader failed.');}g.attachShader(p,s);g.deleteShader(s);}
    g.bindAttribLocation(p,0,'a');g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error('Camera preview link failed.');
    this.buffer=g.createBuffer()!;g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);
    const kinds:LiveKind[]=this.kind==='dual'?['rear','front']:[['depth','contours','points'].includes(this.kind)?'depth':this.kind as LiveKind];
    for(const kind of kinds){const lease=await acquireNativeFeed(kind);if(this.closed){lease.release();return;}this.sources.push(new NativeLiveSource(g,kind,lease,this.onError));}
   }else{
    if(this.kind!=='rear'&&this.kind!=='front')throw new Error('This source requires the installed iOS app and compatible camera hardware.');
    const lease=await acquireCamera(this.kind==='front'?'user':'environment');if(this.closed){lease.release();return;}this.releaseCamera=lease.release;
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=lease.stream;this.video=video;await video.play();
   }
   if(!this.closed)this.draw();
  }catch(e){this.destroy();throw e;}
 }
 private draw=()=>{
  if(this.closed)return;
  if(this.gl){const g=this.gl;
   this.sources.forEach(s=>s.draw({depthLook:this.kind==='points'?3:this.kind==='contours'?2:0,depthNear:this.near,depthFar:Math.max(this.near+.05,this.far),depthColor:this.color}));
   const t=this.sources[0]?.textureOutput;if(t){const w=t.width*this.sources.length,h=t.height;if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    g.bindFramebuffer(g.FRAMEBUFFER,null);g.disable(g.DEPTH_TEST);g.disable(g.BLEND);g.disable(g.SCISSOR_TEST);g.clearColor(0,0,0,1);g.clear(g.COLOR_BUFFER_BIT);g.useProgram(this.program!);g.bindBuffer(g.ARRAY_BUFFER,this.buffer!);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,0,0);g.uniform1i(g.getUniformLocation(this.program!,'t'),0);
    this.sources.forEach((s,i)=>{const tex=s.textureOutput,area=w/this.sources.length,scale=Math.min(area/tex.width,h/tex.height),tw=tex.width*scale,th=tex.height*scale;g.viewport(i*area+(area-tw)/2,(h-th)/2,tw,th);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,tex.texture);g.drawArrays(g.TRIANGLES,0,6);});
   }
  }else if(this.video?.videoWidth){const v=this.video;if(this.canvas.width!==v.videoWidth||this.canvas.height!==v.videoHeight){this.canvas.width=v.videoWidth;this.canvas.height=v.videoHeight;}const c=this.canvas.getContext('2d')!;c.save();if(this.kind==='front'){c.translate(this.canvas.width,0);c.scale(-1,1);}c.drawImage(v,0,0);c.restore();}
  this.raf=requestAnimationFrame(this.draw);
 };
 /** Future WebRTC sender can add this track. Never connects or transmits by itself. */
 createVideoStream(){if(this.closed)throw new Error('Start a feed first.');if(typeof this.canvas.captureStream!=='function')throw new Error('Canvas video streaming is unavailable on this device.');return this.stream??=this.canvas.captureStream(24);}
 descriptor(){return{schema:'ghost-mobile-feed',version:1,kind:this.kind,content:'visual-rgba',metricDepth:false,mirrored:this.kind==='front'||this.kind==='dual',layout:this.kind==='dual'?'rear-left-front-right':'single',width:this.canvas.width,height:this.canvas.height,nearMeters:this.near,farMeters:this.far};}
 destroy(){this.closed=true;cancelAnimationFrame(this.raf);this.stream?.getTracks().forEach(t=>t.stop());this.sources.forEach(s=>s.destroy());this.sources=[];this.releaseCamera?.();this.releaseCamera=undefined;if(this.video){this.video.pause();this.video.srcObject=null;}if(this.gl){if(this.program)this.gl.deleteProgram(this.program);if(this.buffer)this.gl.deleteBuffer(this.buffer);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}}
}
