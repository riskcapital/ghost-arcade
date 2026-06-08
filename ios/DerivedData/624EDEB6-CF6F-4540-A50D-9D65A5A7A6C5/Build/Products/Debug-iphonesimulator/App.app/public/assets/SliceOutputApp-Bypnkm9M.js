import{i as qe,f as A,a as U}from"./legacy-D7rpjvZo.js";import{o as Ye,b as Xe,i as ae,c as Ze}from"./index-client-DfzeMwuN.js";import{gC as Se,gD as je,gx as Ke,gy as Je,g as a,m as $,gv as H,gz as N,gE as Qe,gF as V,gG as Be,gw as et,gH as tt}from"./main-4BlCn4xa.js";import{s as at,a as rt}from"./props-GyONoXFP.js";import{i as nt,s as Me,d as it,a as ot,t as lt,g as ct,b as st,C as ut}from"./Canvas-DcP9Iios.js";import{i as dt}from"./layers-BFOZSqIE.js";import{s as ft,i as Ge,e as pt,m as mt}from"./modulationBroadcast-DDTQeuhI.js";import"./index-jeXJYamp.js";import"./class-BCUEQX14.js";import"./parser-B2YdyCJi.js";import"./renderer-Cr78INoi.js";import"./audio-BnbxmTFR.js";import"./audioBroadcast-DIBo2sVk.js";import"./webgpuCapability-CUMUfS60.js";import"./customEffects-Detx1fUt.js";var gt=A('<div class="slice-waiting svelte-1sz2zv1">Waiting for slice <code class="svelte-1sz2zv1"> </code> from editor…</div>'),vt=A('<div class="esc-hint svelte-1sz2zv1">Press <kbd class="svelte-1sz2zv1">Esc</kbd> to close</div>'),ht=A('<div class="hidden-canvas svelte-1sz2zv1"><!></div>'),wt=A('<div class="slice-output svelte-1sz2zv1"><!> <!> <!> <canvas class="slice-present svelte-1sz2zv1"></canvas></div>');function zt(Fe,Le){Je(Le,!1);const g=()=>rt(ft,"$settings",Ce),[Ce,We]=at(),n=$(),re=$(),w=new URLSearchParams(window.location.search).get("sliceId")||"";let s=$(null),i=null,D=0,y=null;const v=!!window.opener&&!!w;let u=null,x=null,p="waiting for editor link…",C=0,F=null,S=!1,q=0,W=0,k=0,d=null,G=null,_=null,Y=null,X=null,I=null,L=null,T=null,l=null,b=!1,ne=!1;const ke=`
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;

struct SliceUniform {
  crop: vec4<f32>,
  color: vec4<f32>,
  blendW: vec4<f32>,
  blendG: vec4<f32>,
  black: vec4<f32>,
};
@group(0) @binding(2) var<uniform> uSlice: SliceUniform;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
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

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3<f32>(2.4)), step(vec3<f32>(0.04045), c));
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  return mix(c * 12.92, 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, step(vec3<f32>(0.0031308), c));
}

fn blendCurve(xIn: f32, pIn: f32) -> f32 {
  let x = clamp(xIn, 0.0, 1.0);
  let p = max(pIn, 0.01);
  if (x < 0.5) {
    return 0.5 * pow(2.0 * x, p);
  }
  return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
}

fn edgeFactor(distance: f32, width: f32, gamma: f32) -> f32 {
  if (width <= 0.0) {
    return 1.0;
  }
  return blendCurve(distance / width, gamma);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var uv = in.uv;
  let rotation = uSlice.color.w;
  if (rotation > 0.5 && rotation < 1.5) {
    uv = vec2<f32>(uv.y, 1.0 - uv.x);
  } else if (rotation > 1.5 && rotation < 2.5) {
    uv = vec2<f32>(1.0 - uv.x, 1.0 - uv.y);
  } else if (rotation > 2.5) {
    uv = vec2<f32>(1.0 - uv.y, uv.x);
  }

  let crop = uSlice.crop;
  let srcUv = crop.xy + uv * crop.zw;
  let src = textureSampleBaseClampToEdge(uTexture, uSampler, clamp(srcUv, vec2<f32>(0.0), vec2<f32>(1.0)));
  var col = srgbToLinear(src.rgb);

  col = col * max(uSlice.color.x, 0.0);
  col = (col - 0.5) * max(uSlice.color.y, 0.0) + 0.5;
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / max(uSlice.color.z, 0.01)));

  let edgeUv = in.uv;
  let aL = edgeFactor(edgeUv.x, uSlice.blendW.x, uSlice.blendG.x);
  let aR = edgeFactor(1.0 - edgeUv.x, uSlice.blendW.y, uSlice.blendG.y);
  let aT = edgeFactor(edgeUv.y, uSlice.blendW.z, uSlice.blendG.z);
  let aB = edgeFactor(1.0 - edgeUv.y, uSlice.blendW.w, uSlice.blendG.w);
  let alpha = aL * aR * aT * aB;

  let liftMix = mix(alpha, smoothstep(0.0, 1.0, alpha), clamp(uSlice.black.w, 0.0, 1.0));
  col = col + max(uSlice.black.rgb, vec3<f32>(0.0)) * liftMix;
  col = col * alpha;

  return vec4<f32>(linearToSrgb(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`;function _e(e){return!!e&&typeof e=="object"&&typeof e.close=="function"&&typeof e.codedWidth=="number"&&typeof e.codedHeight=="number"}function Ie(e){return typeof VideoFrame<"u"&&e instanceof VideoFrame}function P(e,t=0){const r=Number(e?.displayWidth??e?.codedWidth??e?.videoWidth??e?.naturalWidth??e?.width??t);return Number.isFinite(r)&&r>0?r:t}function z(e,t=0){const r=Number(e?.displayHeight??e?.codedHeight??e?.videoHeight??e?.naturalHeight??e?.height??t);return Number.isFinite(r)&&r>0?r:t}function Z(){if(u){try{u.close()}catch{}u=null}}function j(){if(F){try{F.close()}catch{}F=null}}function ie(e){const t=typeof createImageBitmap=="function"?createImageBitmap:null;if(!t){S=!1,Z(),u=e,p="createImageBitmap unavailable; using VideoFrame draw";return}const r=++q,o=P(e,W||1920),f=z(e,k||1080);p="converting VideoFrame to ImageBitmap",t(e).then(c=>{if(r!==q){try{c.close()}catch{}return}j(),F=c,W=o,k=f,p="bitmap fallback active"}).catch(c=>{r===q&&(p=`bitmap fallback failed: ${c?.message??c}`)}).finally(()=>{try{e.close()}catch{}})}function Te(e){if(W=P(e,g().output?.masterCanvasWidth||1920),k=z(e,g().output?.masterCanvasHeight||1080),C++,S){ie(e);return}Z(),j(),u=e,p="frame received"}function oe(e,t){S||console.warn("[SliceOutput] drawImage(VideoFrame) failed; switching to ImageBitmap fallback:",e),S=!0,p=`drawImage fallback: ${e}`,u===t&&(u=null),ie(t)}function Pe(){return S?F:u}function B(e,t=0){const r=Number(e);return Number.isFinite(r)?Math.max(0,Math.min(1,r)):t}function le(e,t=1,r=.001,o=1){const f=Number(e);return Number.isFinite(f)?Math.max(r,Math.min(o,f)):t}function ze(e){return e===90?1:e===180?2:e===270?3:0}function Re(){return{id:w||"slice-display-full-frame",name:"Full Frame",enabled:!0,targetType:"display",displayId:null,spoutName:"ghostArcade-FullFrame",cropX:0,cropY:0,cropW:1,cropH:1,rotation:0,edgeBlendLeft:0,edgeBlendRight:0,edgeBlendTop:0,edgeBlendBottom:0,edgeBlendGamma:2.2,blackLevelR:0,blackLevelG:0,blackLevelB:0,blackLevelFeather:.5,brightness:1,gamma:1,contrast:1,warpMode:"rect",effects:[],stageEffectId:null,outputWarp:{enabled:!1,mode:"corners"}}}function ce(){!G||!d||!_||G.configure({device:d,format:_,alphaMode:"opaque",colorSpace:"srgb"})}async function Ee(){if(!v||!a(s)||b)return b;if(ne)return!1;try{if(!navigator.gpu)throw new Error("navigator.gpu unavailable");const e=await pt();if(d=e.device,_=e.presentFormat,G=a(s).getContext("webgpu"),!G)throw new Error('getContext("webgpu") returned null');ce();const t=d.createShaderModule({code:ke});I=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,externalTexture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const r=d.createPipelineLayout({bindGroupLayouts:[I]});return Y=d.createRenderPipeline({layout:r,vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:_}]},primitive:{topology:"triangle-list"}}),X=d.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),T=new ArrayBuffer(80),l=new Float32Array(T),L=d.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),b=!0,p="webgpu slice renderer ready",console.log("[SliceOutput] WebGPU zero-copy slice renderer ready"),!0}catch(e){return ne=!0,b=!1,p=`webgpu unavailable: ${e?.message??e}`,console.warn("[SliceOutput] WebGPU slice renderer unavailable; falling back to Canvas2D:",e?.message??e),!1}}function Oe(e){if(!d||!L||!T||!l)return;const t=B(e.cropX,0),r=B(e.cropY,0),o=Math.min(le(e.cropW,1),1-t),f=Math.min(le(e.cropH,1),1-r),c=e.edgeBlendGamma??2.2;l[0]=t,l[1]=r,l[2]=Math.max(.001,o),l[3]=Math.max(.001,f),l[4]=Math.max(0,e.brightness??1),l[5]=Math.max(0,e.contrast??1),l[6]=Math.max(.01,e.gamma??1),l[7]=ze(e.rotation),l[8]=B(e.edgeBlendLeft??0),l[9]=B(e.edgeBlendRight??0),l[10]=B(e.edgeBlendTop??0),l[11]=B(e.edgeBlendBottom??0),l[12]=Math.max(.01,e.edgeBlendLeftGamma??c),l[13]=Math.max(.01,e.edgeBlendRightGamma??c),l[14]=Math.max(.01,e.edgeBlendTopGamma??c),l[15]=Math.max(.01,e.edgeBlendBottomGamma??c),l[16]=Math.max(0,e.blackLevelR??0),l[17]=Math.max(0,e.blackLevelG??0),l[18]=Math.max(0,e.blackLevelB??0),l[19]=B(e.blackLevelFeather??.5,.5),d.queue.writeBuffer(L,0,T)}function Ue(e,t){if(!b||!d||!Y||!G||!I||!X||!L||!a(s))return!1;try{Oe(t);const r=d.importExternalTexture({source:e}),o=d.createBindGroup({layout:I,entries:[{binding:0,resource:X},{binding:1,resource:r},{binding:2,resource:{buffer:L}}]}),f=d.createCommandEncoder(),c=G.getCurrentTexture().createView(),m=f.beginRenderPass({colorAttachments:[{view:c,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});return m.setPipeline(Y),m.setBindGroup(0,o),m.draw(6,1,0,0),m.end(),d.queue.submit([f.finish()]),p="webgpu frame presented",!0}catch(r){return p=`webgpu present failed: ${r?.message??r}`,console.warn("[SliceOutput] WebGPU zero-copy present failed:",r?.message??r),!1}}function $e(e){if(x&&x!==e)try{x.close()}catch{}x=e,e.onmessage=t=>{const r=t.data;_e(r)&&(Te(r),C<=3&&console.log(`[SliceOutput] frame ${C} received ${r.codedWidth}x${r.codedHeight} ts=${r.timestamp} instanceof=${Ie(r)}`))},e.start(),p="port attached",console.log("[SliceOutput] MessagePort attached")}function se(e){if(!e?.data||typeof e.data!="object")return;const t=e.data.type;if(t==="ghostarcade-editor-attach"){ue();return}if(t!=="ghostarcade-output-transport-port")return;const r=e.ports?.[0];r&&$e(r)}function ue(){const e=window.opener;if(!e){p="no window.opener — open via Open on display";return}try{e.postMessage({type:"ghostarcade-output-ready"},"*")}catch(t){p=`opener.postMessage failed: ${t?.message??t}`}}typeof window<"u"&&v&&window.addEventListener("message",se);let de=$(!0),fe=0;function pe(){if(D=requestAnimationFrame(pe),fe++,!a(s))return;const e=a(s).width,t=a(s).height;if(e<=0||t<=0)return;if(v&&b){if(!u)return;Ue(u,a(n)??Re());return}if(!i){fe%60===0&&console.warn("[SliceOutput] presentOneFrame skipped — presentCtx=",!!i,"presentCanvas=",!!a(s),"webgpu=",b);return}const r=v?Pe():null;if(v){if(!r){i.fillStyle="#000",i.fillRect(0,0,e,t);return}}else if(!y&&(y=document.querySelector(".main-canvas"),!y)){i.fillStyle="#000",i.fillRect(0,0,e,t);return}if(!a(n)){if(v&&r){try{i.drawImage(r,0,0,e,t)}catch(h){const te=h?.message??String(h);u&&r===u&&!S&&oe(te,u)}return}i.fillStyle="#000",i.fillRect(0,0,e,t),i.fillStyle="#fa5",i.font="24px monospace",i.textBaseline="top",i.fillText(`NO SLICE CONFIG sliceId=${w}`,20,20),i.fillText(`frames=${C} slices=${g().output?.slices?.length??0}`,20,56);return}let o,f,c;if(v&&r)o=r,f=P(o,W||g().output?.masterCanvasWidth||1920),c=z(o,k||g().output?.masterCanvasHeight||1080);else if(f=g().output?.masterCanvasWidth??y.width,c=g().output?.masterCanvasHeight??y.height,o=y,mt(g().output?.masterWarp)){ot(()=>g().output?.masterWarp,()=>({w:f,h:c})),lt(y);const h=ct();h&&h.width>0&&(o=h)}else Me();const m=Math.round(P(o,f)),M=Math.round(z(o,c)),be=Math.round(a(n).cropX*m),ye=Math.round(a(n).cropY*M),K=Math.round(a(n).cropW*m),J=Math.round(a(n).cropH*M);if(![m,M,be,ye,K,J].every(Number.isFinite)||m<=0||M<=0||K<=0||J<=0){i.fillStyle="#000",i.fillRect(0,0,e,t),i.fillStyle="#fa5",i.font="18px monospace",i.textBaseline="top",i.fillText(`INVALID SLICE CROP sliceId=${w}`,20,20),i.fillText(`src=${m}x${M} crop=${a(n).cropX},${a(n).cropY} ${a(n).cropW}x${a(n).cropH}`,20,48);return}const R=Math.max(0,Math.min(m-1,be)),E=Math.max(0,Math.min(M-1,ye)),Q=Math.max(1,Math.min(m-R,K)),ee=Math.max(1,Math.min(M-E,J));i.clearRect(0,0,e,t);let O=!1,xe="";try{if(a(n).rotation===0)i.drawImage(o,R,E,Q,ee,0,0,e,t);else{i.save();try{i.translate(e/2,t/2),i.rotate(a(n).rotation*Math.PI/180),a(n).rotation===90||a(n).rotation===270?i.drawImage(o,R,E,Q,ee,-t/2,-e/2,t,e):i.drawImage(o,R,E,Q,ee,-e/2,-t/2,e,t)}finally{i.restore()}}O=!0}catch(h){O=!1,xe=h?.message??String(h),u&&o===u&&!S&&oe(xe,u)}if(O&&(a(n).brightness!==1||a(n).contrast!==1||a(n).gamma!==1)){const h=Math.pow(.5,a(n).gamma)/.5,te=`brightness(${a(n).brightness}) contrast(${a(n).contrast}) brightness(${h.toFixed(3)})`;i.save(),i.filter=te,i.globalCompositeOperation="source-over",i.drawImage(a(s),0,0),i.filter="none",i.restore()}const De=a(n).edgeBlendLeft>0||a(n).edgeBlendRight>0||a(n).edgeBlendTop>0||a(n).edgeBlendBottom>0;O&&De&&st(i,e,t,{edgeBlendLeft:a(n).edgeBlendLeft,edgeBlendRight:a(n).edgeBlendRight,edgeBlendTop:a(n).edgeBlendTop,edgeBlendBottom:a(n).edgeBlendBottom,edgeBlendGamma:((a(n).edgeBlendLeftGamma??a(n).edgeBlendGamma)+(a(n).edgeBlendRightGamma??a(n).edgeBlendGamma)+(a(n).edgeBlendTopGamma??a(n).edgeBlendGamma)+(a(n).edgeBlendBottomGamma??a(n).edgeBlendGamma))/4})}function me(){if(!a(s))return;const e=Math.max(1,Math.min(2,window.devicePixelRatio||1)),t=Math.round(window.innerWidth*e),r=Math.round(window.innerHeight*e);(a(s).width!==t||a(s).height!==r)&&(Be(s,a(s).width=t),Be(s,a(s).height=r),b&&ce())}Ye(()=>{console.log("[SliceOutput] slice window mounted, sliceId=",w);const e=document.getElementById("splash");e&&(e.classList.add("hidden"),setTimeout(()=>e.remove(),600)),dt().catch(c=>console.warn("[SliceOutput] License init:",c)),nt("receiver"),(async()=>(await Qe(),a(s)&&(me(),v&&await Ee()?i=null:i=a(s).getContext("2d"))))();const t=()=>me();window.addEventListener("resize",t);const r=()=>{Ge("output_toggle_fullscreen").catch(()=>{})};window.addEventListener("dblclick",r);const o=c=>{c.key==="Escape"&&(c.preventDefault(),Ge("output_close_slice_window",{sliceId:w}).catch(()=>{window.close()}))};window.addEventListener("keydown",o),D=requestAnimationFrame(pe),v&&ue();const f=setTimeout(()=>{V(de,!1)},5e3);return()=>{window.removeEventListener("resize",t),window.removeEventListener("dblclick",r),window.removeEventListener("keydown",o),clearTimeout(f)}}),Xe(()=>{if(cancelAnimationFrame(D),Me(),it(),v){if(window.removeEventListener("message",se),x){try{x.close()}catch{}x=null}Z(),j();try{window.opener?.postMessage({type:"ghostarcade-output-bye"},"*")}catch{}}}),Se(()=>g(),()=>{V(n,g().output.slices.find(e=>e.id===w)||null)}),Se(()=>a(n),()=>{V(re,!a(n))}),je(),qe();var ge=wt(),ve=N(ge);{var He=e=>{var t=gt(),r=H(N(t)),o=N(r);et(()=>tt(o,w)),U(e,t)};ae(ve,e=>{a(re)&&e(He)})}var he=H(ve,2);{var Ne=e=>{var t=vt();U(e,t)};ae(he,e=>{a(de)&&e(Ne)})}var we=H(he,2);{var Ve=e=>{var t=ht(),r=N(t);ut(r,{}),U(e,t)};ae(we,e=>{v||e(Ve)})}var Ae=H(we,2);Ze(Ae,e=>V(s,e),()=>a(s)),U(Fe,ge),Ke(),We()}export{zt as default};
