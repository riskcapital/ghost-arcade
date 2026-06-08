import{i as Qe,f as b,a as h,c as Ze}from"./legacy-D7rpjvZo.js";import{o as et,b as tt,c as rt,i as P}from"./index-client-DfzeMwuN.js";import{m as n,gC as j,gD as at,gI as le,gx as ot,gy as nt,g as e,gv as T,gF as r,gw as U,gH as ue,gz as X,gB as k,gJ as fe,gG as Ee}from"./main-4BlCn4xa.js";import{s as it}from"./class-BCUEQX14.js";import{s as J}from"./style-D2PAcYkx.js";var st=b('<span class="fs-line fs-h svelte-om7yc5"></span> <span class="fs-line fs-v svelte-om7yc5"></span>',1),ct=b('<span class="seg seg-h svelte-om7yc5"></span> <span class="seg seg-v svelte-om7yc5"></span>',1),lt=b('<span class="ring svelte-om7yc5"></span>'),ut=b('<span class="dot svelte-om7yc5"></span>'),ft=b("<div><!> <!> <!></div>"),dt=b('<div class="status-overlay svelte-om7yc5"> </div>'),pt=b('<div class="health-badge svelte-om7yc5"> </div>'),vt=b('<pre class="stats-overlay svelte-om7yc5"> </pre>'),mt=b('<canvas class="output-canvas svelte-om7yc5"></canvas> <!> <!> <!> <!>',1);function wt(Ce,Ve){nt(Ve,!1);const K=n(),de=n(),pe=n(),ve=n(),Be=new URLSearchParams(window.location.search);let Q=n(Be.get("stats")==="1"),p=n(),Z=!1,s=n("init"),v=n(""),me=n(0),x=n(0),ee=0,A=n(""),te={},m=n(!1),re=0,ge=n(0),he=n(0),ye=n(""),g=n(0),E=n(0),be=n(0),ae=n(""),oe=n(0),C=n(1),V=n(1),B=n(1),L=n("cover"),xe=n(!1),ne=n(.5),ie=n(.5),w=n("crosshair"),we=n(28),R=n(2),W=n("#ffffff"),z=n(.85),D=null,M=n(null),c=null,S=null,q=null,F=null,Se=null,I=null,se=null;const _e=32,Le=`
struct Uniforms {
  // xy = (cos, sin); zw = (scaleX, scaleY).
  transform: vec4<f32>,
  // x = brightness, y = contrast, z = gamma, w = pad.
  color: vec4<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Two triangles via vertex_index. No vertex buffer needed.
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Triangle strip / list of positions for a fullscreen quad.
  // Indices 0..5 → two triangles covering the viewport.
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );
  var out: VSOut;
  out.clip = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let cosA = uniforms.transform.x;
  let sinA = uniforms.transform.y;
  let scale = uniforms.transform.zw;

  // Map UV into centered [-0.5, 0.5] then rotate then scale then
  // shift back. Scale > 1 means "video is bigger than canvas in this
  // axis" → we sample a sub-rect (fit:cover); scale < 1 means the
  // opposite (fit:contain), which means parts of the destination
  // map outside [0,1] → discard those for letterbox bars.
  var centered = in.uv - vec2<f32>(0.5, 0.5);
  let rotated = vec2<f32>(
    centered.x * cosA - centered.y * sinA,
    centered.x * sinA + centered.y * cosA,
  );
  let scaled = rotated * scale + vec2<f32>(0.5, 0.5);

  if (scaled.x < 0.0 || scaled.x > 1.0 || scaled.y < 0.0 || scaled.y > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  var rgba = textureSampleBaseClampToEdge(uTexture, uSampler, scaled);

  // Brightness: linear scale on RGB.
  rgba.r = rgba.r * uniforms.color.x;
  rgba.g = rgba.g * uniforms.color.x;
  rgba.b = rgba.b * uniforms.color.x;

  // Contrast: pivot around 0.5 grey.
  rgba.r = (rgba.r - 0.5) * uniforms.color.y + 0.5;
  rgba.g = (rgba.g - 0.5) * uniforms.color.y + 0.5;
  rgba.b = (rgba.b - 0.5) * uniforms.color.y + 0.5;

  // Gamma: per-channel pow with safety clamp to avoid pow(neg).
  let invGamma = 1.0 / max(uniforms.color.z, 0.0001);
  rgba.r = pow(max(rgba.r, 0.0), invGamma);
  rgba.g = pow(max(rgba.g, 0.0), invGamma);
  rgba.b = pow(max(rgba.b, 0.0), invGamma);

  rgba.a = 1.0;
  return rgba;
}
`;async function Re(){if(D=navigator.gpu,!D){r(s,"no-webgpu"),r(v,"navigator.gpu unavailable in this Electron build"),console.error("[OutputSharedTexture] "+e(v));return}try{if(r(M,await D.requestAdapter({powerPreference:"high-performance"})),!e(M)){r(s,"no-webgpu"),r(v,"requestAdapter returned null (no compatible GPU)"),console.error("[OutputSharedTexture] "+e(v));return}if(c=await e(M).requestDevice(),c.lost.then(a=>{console.error("[OutputSharedTexture] device lost:",a?.message||a),Z||(r(s,"error"),r(v,`Device lost: ${a?.message||"unknown"}`))}),S=e(p).getContext("webgpu"),!S){r(s,"no-webgpu"),r(v,'getContext("webgpu") returned null');return}q=D.getPreferredCanvasFormat(),S.configure({device:c,format:q,alphaMode:"opaque",colorSpace:"srgb"});const t=c.createShaderModule({code:Le});se=c.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,externalTexture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const o=c.createPipelineLayout({bindGroupLayouts:[se]});F=c.createRenderPipeline({layout:o,vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:q}]},primitive:{topology:"triangle-list"}}),Se=c.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),I=c.createBuffer({size:_e,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),Pe(0,1,1),r(s,"no-port"),console.log("[OutputSharedTexture] WebGPU initialised. Adapter:",e(M).info?.description||"unknown","Preferred format:",q)}catch(t){r(s,"error"),r(v,`WebGPU init failed: ${t?.message||t}`),console.error("[OutputSharedTexture] "+e(v),t)}}function Pe(t,o,a){if(!c||!I)return;const i=new Float32Array(_e/4);i[0]=Math.cos(t),i[1]=Math.sin(t),i[2]=o,i[3]=a,i[4]=e(C),i[5]=e(V),i[6]=e(B),i[7]=0,c.queue.writeBuffer(I,0,i.buffer)}function We(t,o,a,i){if(!a||!i||!t||!o)return{x:1,y:1};const u=t/o,l=a/i;return e(L)==="fill"?{x:1,y:1}:e(L)==="cover"?l>u?{x:u/l,y:1}:{x:1,y:l/u}:l>u?{x:1,y:l/u}:{x:u/l,y:1}}function ze(t){const o=window.devicePixelRatio||1,a=Math.round(window.innerWidth*o),i=Math.round(window.innerHeight*o);(e(p).width!==a||e(p).height!==i)&&(Ee(p,e(p).width=a),Ee(p,e(p).height=i),r(ge,a),r(he,i));const u=t.codedWidth,l=t.codedHeight;r(ye,`${u}x${l}`);const f=We(e(p).width,e(p).height,u,l);Pe(e(oe)*Math.PI/180,f.x,f.y);const y=c.importExternalTexture({source:t}),O=c.createBindGroup({layout:se,entries:[{binding:0,resource:Se},{binding:1,resource:y},{binding:2,resource:{buffer:I}}]}),H=performance.now(),Y=c.createCommandEncoder(),ce=S.getCurrentTexture().createView(),G=Y.beginRenderPass({colorAttachments:[{view:ce,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});G.setPipeline(F),G.setBindGroup(0,O),G.draw(6,1,0,0),G.end(),c.queue.submit([Y.finish()]);const _=(performance.now()-H)*1e3;r(g,e(g)===0?_:e(g)*.9+_*.1)}function De(t){fe(me);const o=t.format||"unknown";r(A,o),te={...te,[o]:(te[o]??0)+1},e(g)>4e3?(re++,re>=5&&!e(m)&&(r(m,!0),console.warn("[OutputSharedTexture] degraded path detected: render-time EMA = "+e(g).toFixed(0)+"μs (format="+o+")"))):e(g)>0&&e(g)<2e3&&(re=0,e(m)&&(r(m,!1),console.log("[OutputSharedTexture] render-time recovered to "+e(g).toFixed(0)+"μs (format="+o+")")));const a=performance.now();if(ee>0){const i=a-ee,u=1e3/Math.max(1,i);r(x,e(x)===0?u:e(x)*.9+u*.1)}ee=a}function qe(t){if(!(!t||typeof t!="object")){if(t.type==="transform"){typeof t.rotation=="number"&&r(oe,t.rotation),typeof t.brightness=="number"&&r(C,t.brightness),typeof t.contrast=="number"&&r(V,t.contrast),typeof t.gamma=="number"&&r(B,t.gamma),(t.fit==="contain"||t.fit==="cover"||t.fit==="fill")&&r(L,t.fit);return}if(t.type==="cursor"){typeof t.x=="number"&&r(ne,t.x),typeof t.y=="number"&&r(ie,t.y),r(xe,!!t.visible);return}if(t.type==="cursorStyle"){(t.style==="crosshair"||t.style==="circle"||t.style==="dot"||t.style==="reticle"||t.style==="fullscreen")&&r(w,t.style),typeof t.sizePx=="number"&&r(we,Math.max(2,Math.min(256,t.sizePx))),typeof t.thicknessPx=="number"&&r(R,Math.max(1,Math.min(20,t.thicknessPx))),typeof t.color=="string"&&r(W,t.color),typeof t.opacity=="number"&&r(z,Math.max(0,Math.min(1,t.opacity)));return}}}function Ie(t){return!!t&&typeof t=="object"&&typeof t.close=="function"&&typeof t.codedWidth=="number"&&typeof t.codedHeight=="number"}function Ne(t){return typeof VideoFrame<"u"&&t instanceof VideoFrame}let N=null,$=null;function $e(t){if($&&$!==t)try{$.close()}catch{}$=t,(e(s)==="no-port"||e(s)==="init")&&r(s,"running"),t.onmessage=o=>{if(Z)return;fe(E);const a=o.data;if(r(ae,a==null?String(a):a?.constructor?.name||typeof a),e(E)<=3&&console.log("[OutputSharedTexture] raw message #"+e(E),"type="+e(ae),"isVideoFrame="+Ne(a),"data=",a),Ie(a))try{De(a),F&&c&&S&&ze(a)}catch(i){console.error("[OutputSharedTexture] presentFrame error:",i)}finally{try{a.close()}catch{}}else fe(be),qe(a)},t.start(),console.log("[OutputSharedTexture] MessagePort attached, awaiting frames. port=",t)}function He(){if(!N||!c||!F||!S)return;const t=N;N=null,$e(t)}function Te(t){if(!t?.data||typeof t.data!="object")return;const o=t.data.type;if(o==="ghostarcade-editor-attach"){c&&F&&S&&Me();return}if(o!=="ghostarcade-output-transport-port")return;const a=t.ports?.[0];a&&(c&&F&&S?$e(a):(console.log("[OutputSharedTexture] port received before WebGPU init — buffering"),N=a))}function Me(){const t=window.opener;if(!t){console.warn("[OutputSharedTexture] window.opener is null — no editor to signal. Was this window opened via window.open() from the editor renderer?");return}try{t.postMessage({type:"ghostarcade-output-ready"},"*"),console.log("[OutputSharedTexture] signalled output-ready to opener")}catch(o){console.error("[OutputSharedTexture] postMessage to opener failed:",o)}}function Fe(t){(t.key==="s"||t.key==="S")&&r(Q,!e(Q))}typeof window<"u"&&window.addEventListener("message",Te),et(async()=>{const t=document.getElementById("splash");t&&(t.classList.add("hidden"),setTimeout(()=>t.remove(),600)),window.addEventListener("keydown",Fe),await Re(),Me(),He()}),tt(()=>{if(Z=!0,window.removeEventListener("keydown",Fe),window.removeEventListener("message",Te),$){try{$.close()}catch{}$=null}try{const t=window.opener;t&&t.postMessage({type:"ghostarcade-output-bye"},"*")}catch{}try{c?.destroy?.()}catch{}}),j(()=>(e(s),e(v)),()=>{r(K,e(s)==="init"?"Initialising WebGPU…":e(s)==="no-webgpu"?`WebGPU required: ${e(v)}`:e(s)==="no-port"?"Waiting for editor link…":e(s)==="error"?`Error: ${e(v)}`:"")}),j(()=>(e(s),e(m),e(x)),()=>{r(de,e(s)!=="running"?"#444":e(m)||e(x)<30?"#ff3d00":e(x)<50?"#ffb300":"rgba(0, 0, 0, 0)")}),j(()=>(e(s),e(m)),()=>{r(pe,e(s)!=="running"||e(m))}),j(()=>(e(s),e(m),e(A)),()=>{r(ve,e(s)!=="running"?"●  no link":e(m)?`●  CPU fallback (${e(A)})`:"")}),at(),Qe();var Ge=mt(),ke=le(Ge);rt(ke,t=>r(p,t),()=>e(p));var Oe=T(ke,2);{var Ye=t=>{var o=Ze(),a=le(o);{var i=l=>{var f=st(),y=le(f),O=T(y,2);U(()=>{J(y,`top: ${e(ie)*100}%; height: ${e(R)??""}px;
                 background: ${e(W)??""}; opacity: ${e(z)??""};`),J(O,`left: ${e(ne)*100}%; width: ${e(R)??""}px;
                 background: ${e(W)??""}; opacity: ${e(z)??""};`)}),h(l,f)},u=l=>{var f=ft(),y=X(f);{var O=d=>{var _=ct();h(d,_)};P(y,d=>{(e(w)==="crosshair"||e(w)==="reticle")&&d(O)})}var H=T(y,2);{var Y=d=>{var _=lt();h(d,_)};P(H,d=>{(e(w)==="circle"||e(w)==="reticle")&&d(Y)})}var ce=T(H,2);{var G=d=>{var _=ut();h(d,_)};P(ce,d=>{e(w)==="dot"&&d(G)})}U(()=>{it(f,1,`output-cursor cursor-${e(w)??""}`,"svelte-om7yc5"),J(f,`
        left: ${e(ne)*100}%;
        top: ${e(ie)*100}%;
        --csz: ${e(we)??""}px;
        --cth: ${e(R)??""}px;
        --ccol: ${e(W)??""};
        --copa: ${e(z)??""};
      `)}),h(l,f)};P(a,l=>{e(w)==="fullscreen"?l(i):l(u,!1)})}h(t,o)};P(Oe,t=>{e(xe)&&t(Ye)})}var Ue=T(Oe,2);{var je=t=>{var o=dt(),a=X(o);U(()=>ue(a,e(K))),h(t,o)};P(Ue,t=>{e(K)&&t(je)})}var Ae=T(Ue,2);{var Xe=t=>{var o=pt(),a=X(o);U(()=>{J(o,`background: ${e(de)??""};`),ue(a,e(ve))}),h(t,o)};P(Ae,t=>{e(pe)&&t(Xe)})}var Je=T(Ae,2);{var Ke=t=>{var o=vt(),a=X(o);U((i,u,l,f,y)=>ue(a,`
mode webgpu-display
status ${e(s)??""}
frames ${e(me)??""}  fps ${i??""}
raw-msgs ${e(E)??""}  non-vf ${e(be)??""}
last-type ${e(ae)??""}
format ${e(A)??""}  cpu-fallback ${e(m)??""}
canvas ${e(ge)??""}x${e(he)??""}  frame ${e(ye)??""}
fit ${e(L)??""}  rotation ${e(oe)??""}°
brightness ${u??""}  contrast ${l??""}  gamma ${f??""}
gpu-submit ${y??""}μs (EMA)
adapter ${e(M),k(()=>e(M)?.info?.description||"unknown")??""}
press S to hide`),[()=>(e(x),k(()=>e(x).toFixed(1))),()=>(e(C),k(()=>e(C).toFixed(2))),()=>(e(V),k(()=>e(V).toFixed(2))),()=>(e(B),k(()=>e(B).toFixed(2))),()=>(e(g),k(()=>e(g).toFixed(1)))]),h(t,o)};P(Je,t=>{e(Q)&&t(Ke)})}h(Ce,Ge),ot()}export{wt as default};
