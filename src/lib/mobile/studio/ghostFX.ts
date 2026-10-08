import type {TextureInput} from './compositor';
/** Two GPU targets carry flowing history; no readbacks, timers or CPU pixel copies. */
export class GhostFXFeedback {
 private program:WebGLProgram;private buffer:WebGLBuffer;private targets:(TextureInput&{frame:WebGLFramebuffer})[]=[];private index=0;private last=0;
 constructor(private gl:WebGLRenderingContext){
 const compile=(type:number,code:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Drift shader failed');return s;};
 const v=compile(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
 const f=compile(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D source,history;uniform float dt,time,memory,curl,bass,evolution,seed;uniform vec2 aspect,texel;
 void main(){vec2 p=(uv-.5)*aspect;float radius=length(p);float a=dt*(.025+curl*.035)*sin(time*.17+radius*2.);p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
 p*=1.-dt*(.014+bass*.012);p+=dt*.012*curl*vec2(sin(p.y*3.+time*.2),cos(p.x*3.-time*.17));
 p+=dt*.012*evolution*vec2(sin(p.y*7.+time*.31)*cos(p.x*3.),cos(p.x*6.-time*.23)*sin(p.y*4.));
 vec2 at=p/aspect+.5;vec3 old=texture2D(history,clamp(at,0.,1.)).rgb;if(at.x<0.||at.x>1.||at.y<0.||at.y>1.)old=vec3(0.);
 vec3 fresh=texture2D(source,uv).rgb;
 vec3 bloom=(texture2D(source,uv+vec2(texel.x*2.,0)).rgb+texture2D(source,uv-vec2(texel.x*2.,0)).rgb+texture2D(source,uv+vec2(0,texel.y*2.)).rgb+texture2D(source,uv-vec2(0,texel.y*2.)).rgb)*.25;
 fresh+=max(bloom-.55,0.)*.16;float keep=seed*memory*exp(-dt*(1.3+(1.-memory)*5.));
 // Preserve fresh fine structure while advecting light from previous frames.
 vec3 color=mix(fresh,max(fresh*.5,old),keep*.75);gl_FragColor=vec4(clamp(color,0.,1.),1.);}`);
 this.program=gl.createProgram()!;gl.attachShader(this.program,v);gl.attachShader(this.program,f);gl.linkProgram(this.program);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('Drift link failed');this.buffer=gl.createBuffer()!;
 }
 process(source:TextureInput,params:Record<string,number|boolean|number[]>,time:number,advance:boolean,bass:number):TextureInput{
 const g=this.gl;if(this.targets[0]?.width!==source.width||this.targets[0]?.height!==source.height){this.clear();for(let i=0;i<2;i++){const texture=g.createTexture()!,frame=g.createFramebuffer()!;g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,source.width,source.height,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,frame);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Drift target unavailable');g.disable(g.SCISSOR_TEST);g.colorMask(true,true,true,true);g.clearColor(0,0,0,1);g.clear(g.COLOR_BUFFER_BIT);this.targets.push({...source,texture,frame});}}
 if(!advance&&this.last)return this.targets[this.index];
 const next=1-this.index,p=this.program;g.bindFramebuffer(g.FRAMEBUFFER,this.targets[next].frame);g.viewport(0,0,source.width,source.height);g.disable(g.BLEND);g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.colorMask(true,true,true,true);g.useProgram(p);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);const loc=g.getAttribLocation(p,'p');g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,0,0);
 for(const [unit,name,texture] of [[0,'source',source.texture],[1,'history',this.targets[this.index].texture]] as const){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,texture);g.uniform1i(g.getUniformLocation(p,name),unit);}
 const val=(key:string,fallback:number)=>typeof params[key]==='number'?params[key] as number:fallback;
 for(const [name,value] of Object.entries({dt:this.last?Math.min(.1,Math.max(0,time-this.last)):1,time,memory:val('memory',.7),curl:val('curl',.8),bass:bass*val('reactivity',1),evolution:val('evolution',.6),seed:this.last?1:0}))g.uniform1f(g.getUniformLocation(p,name),value);
 g.uniform2f(g.getUniformLocation(p,'texel'),1/source.width,1/source.height);g.uniform2f(g.getUniformLocation(p,'aspect'),source.width/source.height,1);g.drawArrays(g.TRIANGLES,0,6);this.index=next;this.last=time;return this.targets[next];
 }
 private clear(){for(const t of this.targets){this.gl.deleteTexture(t.texture);this.gl.deleteFramebuffer(t.frame);}this.targets=[];this.last=0;this.index=0;}
 destroy(){this.clear();this.gl.deleteProgram(this.program);this.gl.deleteBuffer(this.buffer);}
}
