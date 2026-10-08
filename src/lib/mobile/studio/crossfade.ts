import { TRANSITIONS, applyFaderCurve } from '../../renderer/crossfadeTransitions';
export { TRANSITIONS };
export const CROSSFADE_BLENDS = ['normal','multiply','screen','add','difference','darken','lighten','overlay','exclusion'] as const;
export const CROSSFADE_CURVES = ['linear','constant-power','sharp-cut'] as const;
export type CrossfadeSettings = { transition:string; blend:string; curve:typeof CROSSFADE_CURVES[number] };
export function normalizeCrossfade(value?:Partial<CrossfadeSettings>):CrossfadeSettings {
 return {transition:TRANSITIONS.some(t=>t.name===value?.transition)?value!.transition!:'dissolve',blend:CROSSFADE_BLENDS.includes(value?.blend as any)?value!.blend!:'normal',curve:CROSSFADE_CURVES.includes(value?.curve as any)?value!.curve!:'linear'};
}
/** Shares the desktop shaders; renders into the caller's current target before mapping. */
export class DeckCrossfade {
 private programs=new Map<string,WebGLProgram>();
 private buffer:WebGLBuffer;
 constructor(private gl:WebGLRenderingContext){this.buffer=gl.createBuffer()!;}
 draw(a:WebGLTexture,b:WebGLTexture,value:number,settings:CrossfadeSettings|undefined,time:number,width:number,height:number){
  const g=this.gl,s=normalizeCrossfade(settings);let p=this.programs.get(s.transition);
  if(!p){
   const compile=(type:number,code:string)=>{const shader=g.createShader(type)!;g.shaderSource(shader,code);g.compileShader(shader);if(!g.getShaderParameter(shader,g.COMPILE_STATUS)){const error=g.getShaderInfoLog(shader);g.deleteShader(shader);throw Error(error||'Crossfade shader failed');}return shader;};
   const v=compile(g.VERTEX_SHADER,'attribute vec2 position; varying vec2 vUv; void main(){vUv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}');
   const f=compile(g.FRAGMENT_SHADER,TRANSITIONS.find(t=>t.name===s.transition)!.fragment);
   p=g.createProgram()!;g.attachShader(p,v);g.attachShader(p,f);g.linkProgram(p);g.deleteShader(v);g.deleteShader(f);
   if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p)||'Crossfade link failed');this.programs.set(s.transition,p);
  }
  g.useProgram(p);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);
  const loc=g.getAttribLocation(p,'position');g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,0,0);
  g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,a);g.uniform1i(g.getUniformLocation(p,'tBankA'),0);
  g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,b);g.uniform1i(g.getUniformLocation(p,'tBankB'),1);
  g.uniform1f(g.getUniformLocation(p,'uMix'),applyFaderCurve(value,s.curve));g.uniform1f(g.getUniformLocation(p,'uTime'),time);
  g.uniform2f(g.getUniformLocation(p,'uRes'),width,height);g.uniform1i(g.getUniformLocation(p,'uBlendMode'),CROSSFADE_BLENDS.indexOf(s.blend as any));
  g.drawArrays(g.TRIANGLES,0,6);
 }
 destroy(){for(const p of this.programs.values())this.gl.deleteProgram(p);this.gl.deleteBuffer(this.buffer);}
}
