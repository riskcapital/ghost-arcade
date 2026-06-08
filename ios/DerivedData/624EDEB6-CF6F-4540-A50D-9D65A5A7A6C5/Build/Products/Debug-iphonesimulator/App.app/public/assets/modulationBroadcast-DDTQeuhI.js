const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./layers-BFOZSqIE.js","./main-4BlCn4xa.js","./index-jeXJYamp.js","./audio-BnbxmTFR.js","./workspace-B5Ik-X_L.js"])))=>i.map(i=>d[i]);
import{w as Le,g as H,d as $t}from"./index-jeXJYamp.js";import{a as Qe}from"./audio-BnbxmTFR.js";import{S as ue,O as Zt,A as q,P as oe,M as ne,W as nt,C as O,aD as st,R as xe,J as Jt,D as Ct,F as Qt,V as P,B as L,hj as wo,af as ot,G as Ro,bH as ko,aA as Bt,cb as He,dk as Ut,cg as Mo,g6 as Do,gm as Ao,_ as Pt}from"./main-4BlCn4xa.js";import{g as Tt,r as Bo}from"./customEffects-Detx1fUt.js";import{p as Uo}from"./parser-B2YdyCJi.js";let fe=null,Ce=null,Ve="bgra8unorm",Ae=null,We=!1;async function Po(){return fe&&!We?{device:fe,adapter:Ce,presentFormat:Ve}:Ae||(Ae=(async()=>{if(typeof navigator>"u"||!("gpu"in navigator))throw new Error("WebGPU not available in this environment");const u=navigator.gpu;if(Ce=await u.requestAdapter({powerPreference:"high-performance"}),!Ce)throw new Error("GPUAdapter request returned null");return fe=await Ce.requestDevice(),Ve=u.getPreferredCanvasFormat(),We=!1,fe.lost.then(i=>{console.warn("[webgpuShared] device lost:",i?.message||i),We=!0,fe=null,Ce=null,Ae=null}),console.log("[webgpuShared] device created"),{device:fe,adapter:Ce,presentFormat:Ve}})(),Ae)}function an(){return fe}function rn(){return Ve}function ln(){return!!fe&&!We}const Fo=256,Go=25,Ie="rgba16float",at="rgba16float",it="r32float",zo={injectStrength:1,velocityFromGradient:1,viscosity:0,dyeDecay:.4,velocityDecay:.6,vorticity:1.5,outputBoost:1.6,timeScale:1},Lo=`
struct Globals {
  grid:        vec2<f32>,    // grid resolution (W, H)
  dt:          f32,
  time:        f32,
  inject:      f32,           // dye injection strength
  vel_grad:    f32,           // source-gradient → velocity strength
  visc:        f32,
  vort:        f32,
  dye_decay:   f32,           // per-step decay multiplier (precomputed JS-side)
  vel_decay:   f32,
  pad0:        f32,
  pad1:        f32,
};

@group(0) @binding(0) var<uniform>             u: Globals;
@group(0) @binding(1) var src_tex:             texture_2d<f32>;
@group(0) @binding(2) var src_samp:            sampler;
@group(0) @binding(3) var vel_in:              texture_2d<f32>;
@group(0) @binding(4) var vel_out:             texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var dye_in:              texture_2d<f32>;
@group(0) @binding(6) var dye_out:             texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var div_tex:             texture_2d<f32>;
@group(0) @binding(8) var div_out:             texture_storage_2d<r32float, write>;
@group(0) @binding(9) var p_in:                texture_2d<f32>;
@group(0) @binding(10) var p_out:              texture_storage_2d<r32float, write>;

fn lum(c: vec3<f32>) -> f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Bilinear sample of a vec2 velocity from vel_in at pixel center uv.
// Manually written so we don't need a sampler bound to a texture_2d
// (storage textures + sampled textures need different binding types).
fn sampleVel(uv: vec2<f32>) -> vec2<f32> {
  let dim = vec2<f32>(textureDimensions(vel_in, 0));
  let p = uv * dim - 0.5;
  let p0 = vec2<i32>(floor(p));
  let p1 = p0 + vec2<i32>(1, 0);
  let p2 = p0 + vec2<i32>(0, 1);
  let p3 = p0 + vec2<i32>(1, 1);
  let f = p - vec2<f32>(p0);
  let imax = vec2<i32>(dim) - vec2<i32>(1);
  let v0 = textureLoad(vel_in, clamp(p0, vec2<i32>(0), imax), 0).xy;
  let v1 = textureLoad(vel_in, clamp(p1, vec2<i32>(0), imax), 0).xy;
  let v2 = textureLoad(vel_in, clamp(p2, vec2<i32>(0), imax), 0).xy;
  let v3 = textureLoad(vel_in, clamp(p3, vec2<i32>(0), imax), 0).xy;
  return mix(mix(v0, v1, f.x), mix(v2, v3, f.x), f.y);
}

fn sampleDye(uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(textureDimensions(dye_in, 0));
  let p = uv * dim - 0.5;
  let p0 = vec2<i32>(floor(p));
  let p1 = p0 + vec2<i32>(1, 0);
  let p2 = p0 + vec2<i32>(0, 1);
  let p3 = p0 + vec2<i32>(1, 1);
  let f = p - vec2<f32>(p0);
  let imax = vec2<i32>(dim) - vec2<i32>(1);
  let v0 = textureLoad(dye_in, clamp(p0, vec2<i32>(0), imax), 0);
  let v1 = textureLoad(dye_in, clamp(p1, vec2<i32>(0), imax), 0);
  let v2 = textureLoad(dye_in, clamp(p2, vec2<i32>(0), imax), 0);
  let v3 = textureLoad(dye_in, clamp(p3, vec2<i32>(0), imax), 0);
  return mix(mix(v0, v1, f.x), mix(v2, v3, f.x), f.y);
}

// ── 1. Inject from source ──
// Read existing velocity + dye, add source contribution. The source
// is sampled via the bound sampler (it can be any resolution,
// upsampled to grid size). Velocity contribution comes from the
// luminance GRADIENT direction: bright regions push outward.
@compute @workgroup_size(8, 8)
fn cs_inject(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);

  let s_center = textureSampleLevel(src_tex, src_samp, uv, 0.0);
  let l_center = lum(s_center.rgb);

  // Luminance gradient as a 2D vector (central differences).
  let px = 1.0 / vec2<f32>(dim);
  let l_l = lum(textureSampleLevel(src_tex, src_samp, uv - vec2(px.x, 0.0), 0.0).rgb);
  let l_r = lum(textureSampleLevel(src_tex, src_samp, uv + vec2(px.x, 0.0), 0.0).rgb);
  let l_d = lum(textureSampleLevel(src_tex, src_samp, uv - vec2(0.0, px.y), 0.0).rgb);
  let l_u = lum(textureSampleLevel(src_tex, src_samp, uv + vec2(0.0, px.y), 0.0).rgb);
  let grad = vec2(l_r - l_l, l_u - l_d);

  // Existing fields
  let v_old = textureLoad(vel_in, p, 0).xy;
  let d_old = textureLoad(dye_in, p, 0);

  // Add velocity from gradient. Sign chosen so bright regions push
  // outward (gradient points uphill, we add it).
  let v_new = v_old + grad * u.vel_grad * u.dt * 60.0;

  // Add dye. Use the source color directly, scaled by injection
  // strength and luminance (so dark regions don't dump black dye).
  let inject_amount = clamp(l_center * u.inject * u.dt * 60.0, 0.0, 2.0);
  let d_new = d_old + s_center * inject_amount;

  textureStore(vel_out, p, vec4(v_new, 0.0, 0.0));
  textureStore(dye_out, p, d_new);
}

// ── 2. Advect velocity by itself ──
// Backward-advection: for each cell, look up where the fluid came
// FROM (one timestep ago) and copy that value to here. This is
// unconditionally stable — cornerstone of the Stable Fluids method.
@compute @workgroup_size(8, 8)
fn cs_advect_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);

  let v = textureLoad(vel_in, p, 0).xy;
  let back_uv = uv - v * u.dt;
  let v_advected = sampleVel(clamp(back_uv, vec2(0.0), vec2(1.0)));
  // Apply velocity decay (precomputed multiplier).
  textureStore(vel_out, p, vec4(v_advected * u.vel_decay, 0.0, 0.0));
}

// ── 3. Compute divergence ──
@compute @workgroup_size(8, 8)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(div_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let v_l = textureLoad(vel_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).xy;
  let v_r = textureLoad(vel_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).xy;
  let v_d = textureLoad(vel_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).xy;
  let v_u = textureLoad(vel_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).xy;
  let d = 0.5 * ((v_r.x - v_l.x) + (v_u.y - v_d.y));
  textureStore(div_out, p, vec4(d, 0.0, 0.0, 0.0));
}

// ── 4. Pressure (Jacobi iteration) ──
// Solves grad²P = div(V). One pass = one Jacobi sweep; we run N
// passes from JS to converge.
@compute @workgroup_size(8, 8)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(p_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let p_l = textureLoad(p_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).x;
  let p_r = textureLoad(p_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).x;
  let p_d = textureLoad(p_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).x;
  let p_u = textureLoad(p_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).x;
  let div = textureLoad(div_tex, p, 0).x;
  // Standard 4-point Poisson Jacobi update
  let p_new = (p_l + p_r + p_d + p_u - div) * 0.25;
  textureStore(p_out, p, vec4(p_new, 0.0, 0.0, 0.0));
}

// ── 5. Subtract pressure gradient (project to divergence-free) ──
@compute @workgroup_size(8, 8)
fn cs_subtract_grad(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let p_l = textureLoad(p_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).x;
  let p_r = textureLoad(p_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).x;
  let p_d = textureLoad(p_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).x;
  let p_u = textureLoad(p_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).x;
  let v = textureLoad(vel_in, p, 0).xy;
  let v_proj = v - 0.5 * vec2(p_r - p_l, p_u - p_d);
  textureStore(vel_out, p, vec4(v_proj, 0.0, 0.0));
}

// ── 6. Advect dye by velocity ──
@compute @workgroup_size(8, 8)
fn cs_advect_dye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(dye_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);
  let v = textureLoad(vel_in, p, 0).xy;
  let back_uv = uv - v * u.dt;
  let d = sampleDye(clamp(back_uv, vec2(0.0), vec2(1.0)));
  // Apply dye decay.
  textureStore(dye_out, p, d * u.dye_decay);
}
`,Ft=`
struct V { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_full(@builtin(vertex_index) vid: u32) -> V {
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: V;
  out.clip = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2(x, y);
  return out;
}
struct OutU { boost: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var dye:  texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: OutU;
@fragment fn fs_out(in: V) -> @location(0) vec4<f32> {
  let c = textureSample(dye, samp, in.uv);
  let boosted = c * u.boost;
  // Premultiplied alpha — alpha follows brightness so the layer
  // composites naturally over the underlying canvas.
  let a = clamp(max(max(boosted.r, boosted.g), boosted.b), 0.0, 1.0);
  return vec4(boosted.rgb, a);
}
`;class wt{device;grid;params={...zo};elapsed=0;velA;velB;dyeA;dyeB;divTex;prsA;prsB;velFlip=!1;dyeFlip=!1;prsFlip=!1;sampler;globalsBuffer;outputUniformBuffer;sourceTextureView=null;bglInject;bglAdvectVel;bglDivergence;bglJacobi;bglSubtractGrad;bglAdvectDye;pipelineInject;pipelineAdvectVel;pipelineDivergence;pipelineJacobi;pipelineSubtractGrad;pipelineAdvectDye;outputBGL;outputPipeline;bgInject=[];bgAdvectVel=[];bgDivergence=[];bgJacobi=[];bgSubtractGrad=[];bgAdvectDye=[];bgOutput=null;outputViewCacheKey="";static create(i,l=Fo){return new wt(i,l)}constructor(i,l){this.device=i,this.grid=Math.max(64,Math.min(1024,Math.floor(l)));const o=GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING,r={size:[this.grid,this.grid,1],format:Ie,usage:o},a={size:[this.grid,this.grid,1],format:at,usage:o},e={size:[this.grid,this.grid,1],format:it,usage:o};this.velA=i.createTexture(r),this.velB=i.createTexture(r),this.dyeA=i.createTexture(a),this.dyeB=i.createTexture(a),this.divTex=i.createTexture(e),this.prsA=i.createTexture(e),this.prsB=i.createTexture(e),this.sampler=i.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.globalsBuffer=i.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.outputUniformBuffer=i.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const t={binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},s=(d,m="float")=>({binding:d,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:m}}),n=(d,m)=>({binding:d,visibility:GPUShaderStage.COMPUTE,storageTexture:{format:m,access:"write-only"}}),c={binding:2,visibility:GPUShaderStage.COMPUTE,sampler:{}};this.bglInject=i.createBindGroupLayout({entries:[t,s(1,"float"),c,s(3,"float"),n(4,Ie),s(5,"float"),n(6,at)]}),this.bglAdvectVel=i.createBindGroupLayout({entries:[t,s(3,"float"),n(4,Ie)]}),this.bglDivergence=i.createBindGroupLayout({entries:[t,s(3,"float"),n(8,it)]}),this.bglJacobi=i.createBindGroupLayout({entries:[t,s(7,"unfilterable-float"),s(9,"unfilterable-float"),n(10,it)]}),this.bglSubtractGrad=i.createBindGroupLayout({entries:[t,s(3,"float"),n(4,Ie),s(9,"unfilterable-float")]}),this.bglAdvectDye=i.createBindGroupLayout({entries:[t,s(3,"float"),s(5,"float"),n(6,at)]});const f=i.createShaderModule({code:Lo}),v=(d,m)=>i.createComputePipeline({layout:i.createPipelineLayout({bindGroupLayouts:[m]}),compute:{module:f,entryPoint:d}});this.pipelineInject=v("cs_inject",this.bglInject),this.pipelineAdvectVel=v("cs_advect_vel",this.bglAdvectVel),this.pipelineDivergence=v("cs_divergence",this.bglDivergence),this.pipelineJacobi=v("cs_jacobi",this.bglJacobi),this.pipelineSubtractGrad=v("cs_subtract_grad",this.bglSubtractGrad),this.pipelineAdvectDye=v("cs_advect_dye",this.bglAdvectDye),i.createShaderModule({code:Ft}),this.outputBGL=i.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),console.log("[WebGPUFluidSim] initialised, grid:",this.grid)}ensureOutputPipeline(i){if(this.outputPipeline&&this._outputFormat===i)return;const l=this.device.createShaderModule({code:Ft});this.outputPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.outputBGL]}),vertex:{module:l,entryPoint:"vs_full"},fragment:{module:l,entryPoint:"fs_out",targets:[{format:i,blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this._outputFormat=i}_outputFormat=null;setSourceTexture(i){this.sourceTextureView!==i&&(this.sourceTextureView=i,this.bgInject=[])}setParams(i){this.params={...this.params,...i}}reset(i){this.elapsed=0,this.velFlip=!1,this.dyeFlip=!1,this.prsFlip=!1,this.bgInject=[],this.bgAdvectVel=[],this.bgDivergence=[],this.bgJacobi=[],this.bgSubtractGrad=[],this.bgAdvectDye=[]}step(i,l){if(!this.sourceTextureView)return;const o=Math.min(.1,l*this.params.timeScale);this.elapsed+=o;const r=new ArrayBuffer(48),a=new Float32Array(r);a[0]=this.grid,a[1]=this.grid,a[2]=o,a[3]=this.elapsed,a[4]=this.params.injectStrength,a[5]=this.params.velocityFromGradient,a[6]=this.params.viscosity,a[7]=this.params.vorticity,a[8]=Math.exp(-this.params.dyeDecay*o),a[9]=Math.exp(-this.params.velocityDecay*o),this.device.queue.writeBuffer(this.globalsBuffer,0,r);const e=Math.ceil(this.grid/8),t=this.device,s={binding:0,resource:{buffer:this.globalsBuffer}},n=()=>this.velFlip?this.velB:this.velA,c=()=>this.velFlip?this.velA:this.velB,f=()=>this.dyeFlip?this.dyeB:this.dyeA,v=()=>this.dyeFlip?this.dyeA:this.dyeB,d=()=>this.prsFlip?this.prsB:this.prsA,m=()=>this.prsFlip?this.prsA:this.prsB;{const h=t.createBindGroup({layout:this.bglInject,entries:[s,{binding:1,resource:this.sourceTextureView},{binding:2,resource:this.sampler},{binding:3,resource:n().createView()},{binding:4,resource:c().createView()},{binding:5,resource:f().createView()},{binding:6,resource:v().createView()}]}),p=i.beginComputePass();p.setPipeline(this.pipelineInject),p.setBindGroup(0,h),p.dispatchWorkgroups(e,e),p.end(),this.velFlip=!this.velFlip,this.dyeFlip=!this.dyeFlip}{const h=t.createBindGroup({layout:this.bglAdvectVel,entries:[s,{binding:3,resource:n().createView()},{binding:4,resource:c().createView()}]}),p=i.beginComputePass();p.setPipeline(this.pipelineAdvectVel),p.setBindGroup(0,h),p.dispatchWorkgroups(e,e),p.end(),this.velFlip=!this.velFlip}{const h=t.createBindGroup({layout:this.bglDivergence,entries:[s,{binding:3,resource:n().createView()},{binding:8,resource:this.divTex.createView()}]}),p=i.beginComputePass();p.setPipeline(this.pipelineDivergence),p.setBindGroup(0,h),p.dispatchWorkgroups(e,e),p.end()}for(let h=0;h<Go;h++){const p=t.createBindGroup({layout:this.bglJacobi,entries:[s,{binding:7,resource:this.divTex.createView()},{binding:9,resource:d().createView()},{binding:10,resource:m().createView()}]}),g=i.beginComputePass();g.setPipeline(this.pipelineJacobi),g.setBindGroup(0,p),g.dispatchWorkgroups(e,e),g.end(),this.prsFlip=!this.prsFlip}{const h=t.createBindGroup({layout:this.bglSubtractGrad,entries:[s,{binding:3,resource:n().createView()},{binding:4,resource:c().createView()},{binding:9,resource:d().createView()}]}),p=i.beginComputePass();p.setPipeline(this.pipelineSubtractGrad),p.setBindGroup(0,h),p.dispatchWorkgroups(e,e),p.end(),this.velFlip=!this.velFlip}{const h=t.createBindGroup({layout:this.bglAdvectDye,entries:[s,{binding:3,resource:n().createView()},{binding:5,resource:f().createView()},{binding:6,resource:v().createView()}]}),p=i.beginComputePass();p.setPipeline(this.pipelineAdvectDye),p.setBindGroup(0,h),p.dispatchWorkgroups(e,e),p.end(),this.dyeFlip=!this.dyeFlip}}encodeOutputToView(i,l,o){this.ensureOutputPipeline(o);const r=new Float32Array(4);r[0]=this.params.outputBoost,this.device.queue.writeBuffer(this.outputUniformBuffer,0,r.buffer);const a=this.dyeFlip?this.dyeB:this.dyeA,e=`${a===this.dyeA?"A":"B"}`;(!this.bgOutput||this.outputViewCacheKey!==e)&&(this.bgOutput=this.device.createBindGroup({layout:this.outputBGL,entries:[{binding:0,resource:a.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.outputUniformBuffer}}]}),this.outputViewCacheKey=e);const t=i.beginRenderPass({colorAttachments:[{view:l,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});t.setPipeline(this.outputPipeline),t.setBindGroup(0,this.bgOutput),t.draw(3),t.end()}dispose(){try{this.velA?.destroy?.(),this.velB?.destroy?.()}catch{}try{this.dyeA?.destroy?.(),this.dyeB?.destroy?.()}catch{}try{this.divTex?.destroy?.()}catch{}try{this.prsA?.destroy?.(),this.prsB?.destroy?.()}catch{}try{this.globalsBuffer?.destroy?.()}catch{}try{this.outputUniformBuffer?.destroy?.()}catch{}}}const eo=typeof window<"u"&&!!window.__ELECTRON__,to=eo,oo=typeof window<"u"&&window.electronAPI?.platform==="darwin";typeof window<"u"&&(!window.electronAPI||window.electronAPI?.platform);function Ho(){return oo?"Syphon":"Spout"}const Io=typeof window<"u"&&!!window.__SPOUT_OSR_MODE__,Eo=typeof window<"u"&&!!window.__OUTPUT_WINDOW_MODE__;async function ct(u,i){if(window.__ELECTRON__&&window.electronAPI)return window.electronAPI.invoke(u,i);throw new Error(`invoke('${u}') called but Electron runtime not available`)}const un=Object.freeze(Object.defineProperty({__proto__:null,getTextureShareLabel:Ho,invoke:ct,isDesktopApp:to,isElectron:eo,isMac:oo,isOsrMode:Io,isOutputMode:Eo},Symbol.toStringTag,{value:"Module"})),je="enc:v1:",Gt="ill-key-material";function Oo(){try{const i=localStorage.getItem(Gt);if(i)return Uint8Array.from(atob(i),l=>l.charCodeAt(0))}catch{}const u=crypto.getRandomValues(new Uint8Array(32));try{localStorage.setItem(Gt,btoa(String.fromCharCode(...u)))}catch{}return u}let Ee=null;async function ao(){if(Ee)return Ee;const u=Oo(),i=new Uint8Array(u.byteLength);return i.set(u),Ee=await crypto.subtle.importKey("raw",i,{name:"AES-GCM"},!1,["encrypt","decrypt"]),Ee}async function rt(u){if(!u)return u;try{const i=await ao(),l=crypto.getRandomValues(new Uint8Array(12)),o=new TextEncoder().encode(u),r=await crypto.subtle.encrypt({name:"AES-GCM",iv:l},i,o),a=new Uint8Array(l.length+new Uint8Array(r).length);return a.set(l),a.set(new Uint8Array(r),l.length),je+btoa(String.fromCharCode(...a))}catch{return u}}async function lt(u){if(!u||!u.startsWith(je))return u;try{const i=await ao(),l=Uint8Array.from(atob(u.slice(je.length)),e=>e.charCodeAt(0)),o=l.slice(0,12),r=l.slice(12),a=await crypto.subtle.decrypt({name:"AES-GCM",iv:o},i,r);return new TextDecoder().decode(a)}catch{return""}}function Re(u){return u.startsWith(je)}const Rt={id:"midnight-coral",name:"Midnight Coral",description:"Dark theme with red/coral accents",colors:{bgPrimary:"#0a0a0c",bgSecondary:"rgba(18, 18, 22, 0.95)",bgTertiary:"#141418",bgOverlay:"rgba(0, 0, 0, 0.85)",accentPrimary:"#FF6B6B",accentSecondary:"#FF8585",accentHover:"#FF5252",textPrimary:"#e8e8e8",textSecondary:"#a0a0a0",textMuted:"#666666",borderPrimary:"rgba(255, 107, 107, 0.15)",borderSecondary:"rgba(255, 255, 255, 0.06)",danger:"#FF4757",success:"#2ED573",warning:"#FFA502"}},io={id:"purple-green",name:"Purple Green",description:"Classic purple and neon green",colors:{bgPrimary:"#0a0a0c",bgSecondary:"rgba(18, 18, 22, 0.95)",bgTertiary:"#12121a",bgOverlay:"rgba(0, 0, 0, 0.7)",accentPrimary:"#BB86FC",accentSecondary:"#39FF14",accentHover:"#CF6EFF",textPrimary:"#e0e0e0",textSecondary:"#888888",textMuted:"#555555",borderPrimary:"rgba(187, 134, 252, 0.2)",borderSecondary:"rgba(255, 255, 255, 0.06)",danger:"#FF6B6B",success:"#39FF14",warning:"#FF8800"}},ro={id:"cyberpunk",name:"Cyberpunk",description:"Ultra neon with cyan and magenta",colors:{bgPrimary:"#050510",bgSecondary:"rgba(10, 10, 30, 0.95)",bgTertiary:"#0a0a1a",bgOverlay:"rgba(5, 5, 20, 0.9)",accentPrimary:"#00FFFF",accentSecondary:"#FF00FF",accentHover:"#00CCCC",textPrimary:"#00FF9F",textSecondary:"#00CCCC",textMuted:"#0088AA",borderPrimary:"rgba(0, 255, 255, 0.3)",borderSecondary:"rgba(255, 0, 255, 0.15)",danger:"#FF0066",success:"#00FF9F",warning:"#FFFF00"}},lo=[Rt,io,ro];function Fe(u){return lo.find(i=>i.id===u)||Rt}function Ge(u){const i=document.documentElement,l=u.colors;i.style.setProperty("--bg-primary",l.bgPrimary),i.style.setProperty("--bg-secondary",l.bgSecondary),i.style.setProperty("--bg-tertiary",l.bgTertiary),i.style.setProperty("--bg-overlay",l.bgOverlay),i.style.setProperty("--accent-primary",l.accentPrimary),i.style.setProperty("--accent-secondary",l.accentSecondary),i.style.setProperty("--accent-hover",l.accentHover),i.style.setProperty("--text-primary",l.textPrimary),i.style.setProperty("--text-secondary",l.textSecondary),i.style.setProperty("--text-muted",l.textMuted),i.style.setProperty("--border-primary",l.borderPrimary),i.style.setProperty("--border-secondary",l.borderSecondary),i.style.setProperty("--danger",l.danger),i.style.setProperty("--success",l.success),i.style.setProperty("--warning",l.warning)}const _o=[{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"Claude Sonnet 4.6"},{id:"claude-haiku-4-5",label:"Claude Haiku 4.5 (Fast)"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5 (Legacy)"}],Vo=[{id:"gemini-3.1-pro-preview",label:"Gemini 3.1 Pro"},{id:"gemini-2.5-flash",label:"Gemini 2.5 Flash"},{id:"gemini-2.5-pro",label:"Gemini 2.5 Pro"},{id:"gemini-2.5-flash-lite",label:"Gemini 2.5 Flash Lite (Fast)"}],Wo=[{id:"veo-2.0-generate-001",label:"Veo 2.0"}],qo=[{id:"ray-2",label:"Ray 2 (Quality)"},{id:"ray-flash-2",label:"Ray Flash 2 (Fast)"}],Yo={full:1,high:.75,medium:.5,low:.25};function Xo(u,i,l,o=0,r=1){return{id:u,name:i,enabled:!0,cropX:o,cropY:0,cropW:r,cropH:1,targetType:"sender",displayId:null,spoutName:`ghostArcade-${l}`,edgeBlendLeft:0,edgeBlendRight:0,edgeBlendTop:0,edgeBlendBottom:0,edgeBlendGamma:2.2,blackLevelR:0,blackLevelG:0,blackLevelB:0,blackLevelFeather:.5,brightness:1,gamma:1,contrast:1,rotation:0,warpMode:"rect",effects:[],stageEffectId:null,outputWarp:{enabled:!1,mode:"corners"}}}function Ko(){return{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomLeft:{x:0,y:1},bottomRight:{x:1,y:1}}}function No(u=5,i=5){const l=[];for(let o=0;o<u;o++){const r=[];for(let a=0;a<i;a++)r.push({x:a/(i-1),y:o/(u-1)});l.push(r)}return{rows:u,cols:i,points:l}}function jo(u){return{topLeft:{x:u.cropX,y:u.cropY},topRight:{x:u.cropX+u.cropW,y:u.cropY},bottomLeft:{x:u.cropX,y:u.cropY+u.cropH},bottomRight:{x:u.cropX+u.cropW,y:u.cropY+u.cropH}}}function $o(u,i=5,l=5){const o=[];for(let r=0;r<i;r++){const a=[];for(let e=0;e<l;e++)a.push({x:u.cropX+u.cropW*e/(l-1),y:u.cropY+u.cropH*r/(i-1)});o.push(a)}return{rows:i,cols:l,points:o}}function Zo(u){if(!u?.enabled)return!1;const i=1e-4,l=u.corners;if(!!l&&(Math.abs(l.topLeft.x-0)>i||Math.abs(l.topLeft.y-0)>i||Math.abs(l.topRight.x-1)>i||Math.abs(l.topRight.y-0)>i||Math.abs(l.bottomLeft.x-0)>i||Math.abs(l.bottomLeft.y-1)>i||Math.abs(l.bottomRight.x-1)>i||Math.abs(l.bottomRight.y-1)>i))return!0;const r=u.meshGrid;if(r&&r.rows>=2&&r.cols>=2)for(let a=0;a<r.rows;a++)for(let e=0;e<r.cols;e++){const t=r.points[a]?.[e];if(t&&(Math.abs(t.x-e/(r.cols-1))>1e-4||Math.abs(t.y-a/(r.rows-1))>1e-4))return!0}return!1}function Jo(u){return{id:u.id,name:u.name??"Slice",enabled:u.enabled??!0,cropX:u.cropX??0,cropY:u.cropY??0,cropW:u.cropW??1,cropH:u.cropH??1,targetType:u.targetType??"sender",displayId:u.displayId??null,outputType:u.outputType,spoutName:u.spoutName??`ghostArcade-${u.name??"Slice"}`,edgeBlendLeft:u.edgeBlendLeft??0,edgeBlendRight:u.edgeBlendRight??0,edgeBlendTop:u.edgeBlendTop??0,edgeBlendBottom:u.edgeBlendBottom??0,edgeBlendGamma:u.edgeBlendGamma??2.2,edgeBlendLeftGamma:u.edgeBlendLeftGamma,edgeBlendRightGamma:u.edgeBlendRightGamma,edgeBlendTopGamma:u.edgeBlendTopGamma,edgeBlendBottomGamma:u.edgeBlendBottomGamma,blackLevelR:u.blackLevelR??0,blackLevelG:u.blackLevelG??0,blackLevelB:u.blackLevelB??0,blackLevelFeather:u.blackLevelFeather??.5,brightness:u.brightness??1,gamma:u.gamma??1,contrast:u.contrast??1,rotation:u.rotation??0,warpMode:u.warpMode??"rect",corners:u.corners,meshGrid:u.meshGrid,effects:u.effects??[],stageEffectId:u.stageEffectId??null,outputWarp:u.outputWarp??{enabled:!1,mode:"corners"}}}const Qo=[{id:"crosshair",label:"Center Crosshair"},{id:"grid",label:"Simple Grid"},{id:"outline",label:"Blue Outline"},{id:"testpattern",label:"Test Pattern"},{id:"none",label:"Blank (No Shader)"}];function uo(){return[{id:"webm-vp9",label:"WebM (VP9) - Best Quality",mimeType:"video/webm;codecs=vp9"},{id:"webm-vp8",label:"WebM (VP8) - Good Compatibility",mimeType:"video/webm;codecs=vp8"},{id:"mp4-h264",label:"MP4 (H.264) - Universal Playback",mimeType:"video/mp4;codecs=avc1.424028"}].map(i=>({...i,supported:typeof MediaRecorder<"u"&&MediaRecorder.isTypeSupported(i.mimeType)}))}function ea(u){return{"webm-vp9":"video/webm;codecs=vp9","webm-vp8":"video/webm;codecs=vp8","mp4-h264":"video/mp4;codecs=avc1.424028"}[u]||"video/webm"}function ft(){const u=uo().filter(l=>l.supported);return{recording:{format:u.find(l=>l.id==="webm-vp9")?.id||u.find(l=>l.id==="webm-vp8")?.id||"webm-vp8",videoBitrate:5e6,autoDownload:!0,saveDirectoryHandle:null,saveDirectoryName:"Downloads (default)",includeAudio:!0,audioBitrate:128e3},output:{spoutEnabled:!1,spoutName:"ghostArcade",spoutResolution:"match",customWidth:1920,customHeight:1080,outputWindowOpen:!1,blackout:!1,testPattern:"none",edgeBlendLeft:0,edgeBlendRight:0,edgeBlendTop:0,edgeBlendBottom:0,edgeBlendGamma:2.2,brightness:1,gamma:1,contrast:1,slices:[],masterCanvasWidth:1920,masterCanvasHeight:1080,outputRotation:0,outputCropX:0,outputCropY:0,outputCropWidth:1,outputCropHeight:1,outputShowCursor:!1,outputCursorStyle:"crosshair",outputCursorSize:28,outputCursorThickness:2,outputCursorColor:"#ffffff",outputCursorOpacity:.85,domeEnabled:!1,domeMode:"angular",domeFOV:180,domeRotation:0,domeTilt:0,domeOffsetX:0,domeOffsetY:0,domeCurvature:1,domeTruncation:1,masterWarp:{enabled:!1,mode:"corners"}},ui:{colorScheme:"midnight-coral",fluidQuality:"live",shaderQuality:"full",gridSettings:{enabled:!1,columns:12,rows:12,snapToGrid:!1,snapToLayers:!0},vjLayoutReversed:!1,warpDragGranularity:"1px",safeMode:!1},ai:{shaderProvider:"claude",claudeApiKey:"",claudeModel:"claude-sonnet-4-6",geminiApiKey:"",geminiModel:"gemini-2.5-flash",videoProvider:"veo",lumaApiKey:"",lumaModel:"ray-2",veoModel:"veo-2.0-generate-001",replicateApiKey:""},defaultLayerShader:"grid",newLayerPlacement:"top",experimental:{webgpuPilot:!1,outputWebRTC:!1,outputZeroCopy:!0,editorWebGPU:!0,allowMidChainGpuEffects:!0},performance:{previewMaxDim:0,previewFrameRate:60,outputFrameRate:60,outputMaxBitrate:8e7,outputDegradationPreference:"maintain-resolution",outputCodecPreference:"auto",editorMaxFps:0,useWebGL2LightPainting:!0}}}const me="ghost-arcade_settings",zt="ill_app_version",ut="0.3.8";function ta(){try{const u=localStorage.getItem(zt);if(u===ut)return{versionChanged:!1};console.log("[migration] app version changed",u,"→",ut,"— clearing stale caches");try{localStorage.removeItem("sv_session_cache")}catch{}try{sessionStorage.removeItem("sv_session_cache")}catch{}try{localStorage.removeItem("sv_isf_shader_cache")}catch{}try{localStorage.removeItem("sv_keyboard_state")}catch{}try{localStorage.removeItem("vj_clip_launcher_state")}catch{}try{localStorage.removeItem("vj_runtime_state")}catch{}try{const i=localStorage.getItem(me);if(i){const l=JSON.parse(i);l.output&&(l.output.blackout=!1,l.output.testPattern="none"),(l.defaultLayerShader==="crosshair"||l.defaultLayerShader==null)&&(l.defaultLayerShader="grid"),l.experimental&&l.experimental.allowMidChainGpuEffects===!1&&(l.experimental.allowMidChainGpuEffects=!0),localStorage.setItem(me,JSON.stringify(l))}}catch{}return localStorage.setItem(zt,ut),{versionChanged:!0}}catch(u){return console.warn("[migration] failed:",u),{versionChanged:!1}}}ta();function Lt(){try{const i=localStorage.getItem(me);if(i){const l=JSON.parse(i),o=ft(),r=localStorage.getItem("ai_claude_key")||"",a=localStorage.getItem("ai_gemini_key")||"",e=localStorage.getItem("ai_provider")||"",t={...o,...l,recording:{...o.recording,...l.recording,saveDirectoryHandle:null,saveDirectoryName:l.recording?.saveDirectoryName||"Downloads (default)"},output:{...o.output,...l.output,slices:[],masterCanvasWidth:o.output.masterCanvasWidth,masterCanvasHeight:o.output.masterCanvasHeight,masterWarp:{enabled:!1,mode:"corners"}},ui:{...o.ui,...l.ui,gridSettings:{...o.ui.gridSettings,...l.ui?.gridSettings||{}}},ai:{...o.ai,...l.ai||{},claudeApiKey:l.ai?.claudeApiKey||r||"",geminiApiKey:l.ai?.geminiApiKey||a||"",shaderProvider:l.ai?.shaderProvider||e||o.ai.shaderProvider},experimental:{...o.experimental,...l.experimental||{}},performance:{...o.performance,...l.performance||{}}};r&&localStorage.removeItem("ai_claude_key"),a&&localStorage.removeItem("ai_gemini_key"),e&&localStorage.removeItem("ai_provider");const s=["none","grid","crosshair","color-bars","white","gradient","checkerboard"];(typeof t.output?.testPattern!="string"||!s.includes(t.output.testPattern))&&(t.output.testPattern="none"),typeof t.output?.blackout!="boolean"&&(t.output.blackout=!1);const n=Fe(t.ui.colorScheme);return Ge(n),t}}catch(i){console.error("Failed to load settings — stashing corrupt copy as backup:",i);try{const l=localStorage.getItem(me);if(l){const o=new Date().toISOString().replace(/[:.]/g,"-");localStorage.setItem(`${me}.corrupt.${o}`,l),localStorage.setItem(`${me}.lastCorruption`,o)}}catch{}}const u=ft();return Ge(Fe(u.ui.colorScheme)),u}function B(u){try{const i={...u,recording:{...u.recording,saveDirectoryHandle:null}};oa(i.ai).then(l=>{i.ai=l,localStorage.setItem(me,JSON.stringify(i))}).catch(()=>{localStorage.setItem(me,JSON.stringify(i))})}catch(i){console.warn("Failed to save settings:",i)}}async function oa(u){const i={...u};return i.claudeApiKey&&!Re(i.claudeApiKey)&&(i.claudeApiKey=await rt(i.claudeApiKey)),i.geminiApiKey&&!Re(i.geminiApiKey)&&(i.geminiApiKey=await rt(i.geminiApiKey)),i.lumaApiKey&&!Re(i.lumaApiKey)&&(i.lumaApiKey=await rt(i.lumaApiKey)),i}async function aa(u){const i={...u};return i.claudeApiKey&&Re(i.claudeApiKey)&&(i.claudeApiKey=await lt(i.claudeApiKey)),i.geminiApiKey&&Re(i.geminiApiKey)&&(i.geminiApiKey=await lt(i.geminiApiKey)),i.lumaApiKey&&Re(i.lumaApiKey)&&(i.lumaApiKey=await lt(i.lumaApiKey)),i}function ia(){const{subscribe:u,set:i,update:l}=Le(Lt()),o=Lt();return(o.ai.claudeApiKey||o.ai.geminiApiKey||o.ai.lumaApiKey)&&aa(o.ai).then(r=>{l(a=>({...a,ai:{...a.ai,...r}}))}).catch(()=>{}),{subscribe:u,setRecordingFormat(r){l(a=>{const e={...a,recording:{...a.recording,format:r}};return B(e),e})},setVideoBitrate(r){l(a=>{const e={...a,recording:{...a.recording,videoBitrate:r}};return B(e),e})},setAutoDownload(r){l(a=>{const e={...a,recording:{...a.recording,autoDownload:r}};return B(e),e})},async pickSaveDirectory(){try{if(to){const a=await ct("pick_directory");if(!a)return!1;const e=a.path,t=a.name,s={name:t,_path:e,async getFileHandle(n,c){const f=e+"/"+n;return{async createWritable(){const v=[];return{async write(d){d instanceof Blob?v.push(d):d instanceof ArrayBuffer?v.push(new Blob([d])):v.push(new Blob([d]))},async close(){const m=await new Blob(v).arrayBuffer(),h=btoa(String.fromCharCode(...new Uint8Array(m)));await ct("save_file_binary",{path:f,base64Data:h})}}}}}};return l(n=>{const c={...n,recording:{...n.recording,saveDirectoryHandle:s,saveDirectoryName:t,_saveDirectoryPath:e}};return B(c),c}),!0}if(!("showDirectoryPicker"in window))return alert("Your browser does not support folder selection. Recordings will be saved to Downloads."),!1;const r=await window.showDirectoryPicker({mode:"readwrite",startIn:"documents"});return l(a=>{const e={...a,recording:{...a.recording,saveDirectoryHandle:r,saveDirectoryName:r.name}};return B(e),e}),!0}catch(r){return r.name!=="AbortError"&&console.error("Failed to pick directory:",r),!1}},setSpoutEnabled(r){l(a=>{const e={...a,output:{...a.output,spoutEnabled:r}};return B(e),e})},setSpoutName(r){l(a=>{const e={...a,output:{...a.output,spoutName:r}};return B(e),e})},setSpoutResolution(r){l(a=>{const e={...a,output:{...a.output,spoutResolution:r}};return B(e),e})},setOutputWindowOpen(r){l(a=>({...a,output:{...a.output,outputWindowOpen:r}}))},clearSaveDirectory(){l(r=>{const a={...r,recording:{...r.recording,saveDirectoryHandle:null,saveDirectoryName:"Downloads (default)"}};return B(a),a})},setColorScheme(r){const a=Fe(r);Ge(a),l(e=>{const t={...e,ui:{...e.ui,colorScheme:r}};return B(t),t})},setFluidQuality(r){l(a=>{const e={...a,ui:{...a.ui,fluidQuality:r}};return B(e),e})},setShaderQuality(r){l(a=>{const e={...a,ui:{...a.ui,shaderQuality:r}};return B(e),e})},toggleGrid(){l(r=>{const a=r.ui.gridSettings||{enabled:!1,columns:12,rows:12,snapToGrid:!1,snapToLayers:!0},e={...r,ui:{...r.ui,gridSettings:{...a,enabled:!a.enabled}}};return B(e),e})},toggleSnap(){l(r=>{const a=r.ui.gridSettings||{enabled:!1,columns:12,rows:12,snapToGrid:!1,snapToLayers:!0},e={...r,ui:{...r.ui,gridSettings:{...a,snapToGrid:!a.snapToGrid}}};return B(e),e})},setGridDimensions(r,a){l(e=>{const t=e.ui.gridSettings||{enabled:!1,columns:12,rows:12,snapToGrid:!1,snapToLayers:!0},s={...e,ui:{...e.ui,gridSettings:{...t,columns:r,rows:a}}};return B(s),s})},setShaderProvider(r){l(a=>{const e={...a,ai:{...a.ai,shaderProvider:r}};return B(e),e})},setVideoProvider(r){l(a=>{const e={...a,ai:{...a.ai,videoProvider:r}};return B(e),e})},setClaudeApiKey(r){l(a=>{const e={...a,ai:{...a.ai,claudeApiKey:r}};return B(e),e})},setClaudeModel(r){l(a=>{const e={...a,ai:{...a.ai,claudeModel:r}};return B(e),e})},setGeminiApiKey(r){l(a=>{const e={...a,ai:{...a.ai,geminiApiKey:r}};return B(e),e})},setGeminiModel(r){l(a=>{const e={...a,ai:{...a.ai,geminiModel:r}};return B(e),e})},setLumaApiKey(r){l(a=>{const e={...a,ai:{...a.ai,lumaApiKey:r}};return B(e),e})},setLumaModel(r){l(a=>{const e={...a,ai:{...a.ai,lumaModel:r}};return B(e),e})},setVeoModel(r){l(a=>{const e={...a,ai:{...a.ai,veoModel:r}};return B(e),e})},setReplicateApiKey(r){l(a=>{const e={...a,ai:{...a.ai,replicateApiKey:r}};return B(e),e})},setMasterWarp(r){l(a=>{const e=a.output.masterWarp??{enabled:!1,mode:"corners"},t={...a,output:{...a.output,masterWarp:{...e,...r}}};return B(t),t})},setDomeEnabled(r){l(a=>{const e={...a,output:{...a.output,domeEnabled:r}};return B(e),e})},setDomeMode(r){l(a=>{const e={...a,output:{...a.output,domeMode:r}};return B(e),e})},updateDomeSetting(r,a){l(e=>{const t={...e,output:{...e.output,[r]:a}};return B(t),t})},setDefaultLayerShader(r){l(a=>{const e={...a,defaultLayerShader:r};return B(e),e})},setNewLayerPlacement(r){l(a=>{const e={...a,newLayerPlacement:r};return B(e),e})},reset(){const r=ft();Ge(Fe(r.ui.colorScheme)),i(r),B(r)},update(r){l(a=>{const e=r(a);return B(e),e})},get(){return H({subscribe:u})}}}const no=ia(),ra=Le(!1),nn=Object.freeze(Object.defineProperty({__proto__:null,CLAUDE_MODELS:_o,COLOR_SCHEMES:lo,DEFAULT_LAYER_SHADERS:Qo,GEMINI_MODELS:Vo,LUMA_MODELS:qo,SCHEME_CYBERPUNK:ro,SCHEME_MIDNIGHT_CORAL:Rt,SCHEME_PURPLE_GREEN:io,SHADER_QUALITY_MULTIPLIERS:Yo,VEO_MODELS:Wo,applyColorScheme:Ge,cornersFromRect:jo,createDefaultSlice:Xo,getColorScheme:Fe,getMimeType:ea,getSupportedFormats:uo,identityOutputCorners:Ko,identityOutputMesh:No,masterWarpIsActive:Zo,meshFromRect:$o,migrateOutputSlice:Jo,outputFrozen:ra,settings:no},Symbol.toStringTag,{value:"Module"}));class la{instances=new Map;snapshotScene=new ue;snapshotCamera=new Zt(-1,1,1,-1,0,1);snapshotMaterial;snapshotMesh;snapshotRenderTarget=null;snapshotPixels=null;webgpuAttempted=!1;webgpuAvailable=!1;device=null;presentFormat=null;constructor(){this.snapshotMaterial=new q({uniforms:{uTexture:{value:null}},vertexShader:`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,fragmentShader:`
        precision highp float;
        uniform sampler2D uTexture;
        varying vec2 vUv;
        void main() {
          // Y-flip: WebGL render targets store bottom-up; we want
          // top-down so WebGPU sees the image upright.
          gl_FragColor = texture2D(uTexture, vec2(vUv.x, 1.0 - vUv.y));
        }
      `,depthTest:!1,depthWrite:!1});const i=new oe(2,2);this.snapshotMesh=new ne(i,this.snapshotMaterial),this.snapshotScene.add(this.snapshotMesh),this.tryInitWebGPU()}async tryInitWebGPU(){if(!this.webgpuAttempted){this.webgpuAttempted=!0;try{const{device:i,presentFormat:l}=await Po();this.device=i,this.presentFormat=l,this.webgpuAvailable=!0,console.log("[gpuEffectRunner] WebGPU ready (format",l,")")}catch(i){this.webgpuAvailable=!1,console.warn("[gpuEffectRunner] WebGPU init failed — GPU effects will pass through unchanged:",i?.message||i)}}}runGpuEffect(i,l,o,r,a,e,t){try{if(!H(no)?.experimental?.allowMidChainGpuEffects)return i}catch{}if(!this.webgpuAvailable||!this.device)return i;const s=`${o}::${l.id}`;let n=this.instances.get(s);if(!n){try{n=this.createInstance(l.type,s,e,t)}catch(v){return console.warn("[gpuEffectRunner] failed to create",l.type,"instance:",v?.message||v),i}this.instances.set(s,n)}if((n.configuredW!==e||n.configuredH!==t)&&this.resizeInstanceOutput(n,e,t),!this.snapshotInputToBuffer(i,a,e,t))return i;try{this.device.queue.writeTexture({texture:n.inputTexture},this.snapshotPixels,{bytesPerRow:e*4,rowsPerImage:t},{width:e,height:t,depthOrArrayLayers:1})}catch(v){return console.warn("[gpuEffectRunner] writeTexture failed:",v?.message||v),i}const f=this.device.createCommandEncoder();try{this.encodeEffect(n,n.inputTextureView,f,l,r)}catch(v){return console.warn("[gpuEffectRunner] encode failed for",l.type,":",v?.message||v),i}return this.device.queue.submit([f.finish()]),n.outputTexture.needsUpdate=!0,n.outputTexture}snapshotInputToBuffer(i,l,o,r){if(!this.snapshotRenderTarget||this.snapshotRenderTarget.width!==o||this.snapshotRenderTarget.height!==r){try{this.snapshotRenderTarget?.dispose()}catch{}this.snapshotRenderTarget=new nt(o,r,{format:xe,type:st,minFilter:O,magFilter:O,depthBuffer:!1,stencilBuffer:!1})}(!this.snapshotPixels||this.snapshotPixels.length!==o*r*4)&&(this.snapshotPixels=new Uint8Array(o*r*4));const a=l.getRenderTarget(),e=l.autoClear,t=new Jt;l.getClearColor(t);const s=l.getClearAlpha();l.autoClear=!1,l.setClearColor(0,0);try{this.snapshotMaterial.uniforms.uTexture.value=i,this.snapshotMaterial.uniformsNeedUpdate=!0,this.snapshotMesh.material=this.snapshotMaterial,l.setRenderTarget(this.snapshotRenderTarget),l.clear(),l.render(this.snapshotScene,this.snapshotCamera),l.readRenderTargetPixels(this.snapshotRenderTarget,0,0,o,r,this.snapshotPixels)}catch(n){return console.warn("[gpuEffectRunner] snapshot failed:",n?.message||n),l.autoClear=e,l.setClearColor(t,s),l.setRenderTarget(a),!1}return l.autoClear=e,l.setClearColor(t,s),l.setRenderTarget(a),!0}createInstance(i,l,o,r){const a=document.createElement("canvas");a.width=o,a.height=r;const e=a.getContext("webgpu");if(!e)throw new Error("webgpu context unavailable on output canvas");e.configure({device:this.device,format:this.presentFormat,alphaMode:"premultiplied"});const t=new Ct(a);t.minFilter=O,t.magFilter=O,t.generateMipmaps=!1,t.colorSpace=Qt,t.flipY=!0;const s=this.device.createTexture({size:[o,r,1],format:"rgba8unorm",usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),n=s.createView();let c;if(i==="gpuFluidSim")c=wt.create(this.device,256);else throw new Error(`unknown gpu effect type: ${i}`);return{type:i,impl:c,inputTexture:s,inputTextureView:n,outputCanvas:a,outputContext:e,outputFormat:this.presentFormat,outputTexture:t,configuredW:o,configuredH:r}}resizeInstanceOutput(i,l,o){i.outputCanvas.width=l,i.outputCanvas.height=o,i.outputContext.configure({device:this.device,format:this.presentFormat,alphaMode:"premultiplied"}),i.outputTexture.needsUpdate=!0;try{i.inputTexture?.destroy?.()}catch{}i.inputTexture=this.device.createTexture({size:[l,o,1],format:"rgba8unorm",usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),i.inputTextureView=i.inputTexture.createView(),i.impl?.setSourceTexture&&i.impl.setSourceTexture(i.inputTextureView),i.configuredW=l,i.configuredH=o}encodeEffect(i,l,o,r,a){if(i.type==="gpuFluidSim"){const e=i.impl,t=r.params||{},s={injectStrength:t.injectStrength??1.5,velocityFromGradient:t.velocityFromGradient??1.4,viscosity:t.viscosity??0,dyeDecay:t.dyeDecay??2.4,velocityDecay:t.velocityDecay??2.3,vorticity:t.vorticity??1,outputBoost:t.outputBoost??.7,timeScale:t.timeScale??1.6};e.setParams(s),e.setSourceTexture(l),e.step(o,a);const n=i.outputContext.getCurrentTexture().createView();e.encodeOutputToView(o,n,i.outputFormat)}}reapStale(i){for(const[l,o]of this.instances)if(!i.has(l)){try{o.impl?.dispose?.()}catch{}try{o.outputTexture.dispose()}catch{}try{o.inputTexture?.destroy?.()}catch{}this.instances.delete(l)}}isReady(){return this.webgpuAvailable}dispose(){for(const i of this.instances.values()){try{i.impl?.dispose?.()}catch{}try{i.outputTexture.dispose()}catch{}try{i.inputTexture?.destroy?.()}catch{}}this.instances.clear();try{this.snapshotMesh.geometry.dispose()}catch{}try{this.snapshotMaterial.dispose()}catch{}try{this.snapshotRenderTarget?.dispose()}catch{}this.snapshotPixels=null}}function ua(u){return u.startsWith("gpu")}function na(){return{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomLeft:{x:0,y:1},bottomRight:{x:1,y:1}}}function sa(u=3,i=3){const l=[];for(let o=0;o<u;o++){const r=[];for(let a=0;a<i;a++)r.push({x:a/(i-1),y:o/(u-1)});l.push(r)}return{rows:u,cols:i,points:l}}function sn(u=[]){return{type:"freehand",points:u.length>0?u:[{x:.3,y:.5},{x:.5,y:.3},{x:.7,y:.5}],smoothing:.5}}function cn(u=[]){return{type:"pointClick",points:u.length>0?u:[{x:.2,y:.5},{x:.5,y:.2},{x:.8,y:.5}],closed:!1,cornerStyle:"sharp"}}function ca(){return{type:"glow",color:[0,1,.5,1],width:3,glowSize:15,glowIntensity:1,pulseSpeed:0}}function fa(){return{enabled:!1,drawProgress:1,drawSpeed:1,trailLength:0,loopMode:"loop",reverse:!1,easing:"linear"}}function fn(u){return{id:kt(),name:u.type==="freehand"?"Freehand Line":"Point-Click Line",shape:u,stroke:ca(),drawAnimation:fa(),visible:!0,locked:!1,zIndex:0,position:{x:0,y:0},rotation:0,scale:{x:1,y:1},warpCorners:na(),warpEnabled:!1,meshWarp:sa(3,3),meshWarpEnabled:!1,blendMode:"add",opacity:1}}function va(){return{elements:[],backgroundColor:[0,0,0,0],selectedElementId:null,globalDrawSpeed:1,staggerMode:"simultaneous",staggerDelay:200,waveWindowSize:3,bloom:0,afterglow:0,sharedShaderMode:!1,sharedShaderSourceId:""}}function kt(){return typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,u=>{const i=Math.random()*16|0;return(u==="x"?i:i&3|8).toString(16)})}function da(){return{shaderId:"planet",params:{}}}function ma(){return{sourceType:"image",sourceUrl:null,mode:"depth-shift",knobs:[.6,0,0,0],particleCount:25e4,baseSize:.005,opacity:1,anchorJitter:.6,fovDeg:50,cameraZ:2.2,cameraYaw:0,cameraPitch:0,panX:0,panY:0,lightEnabled:!1,lightX:1,lightY:1,lightZ:1.5,lightIntensity:1.5,lightAmbient:.25,lightHeightStrength:1.5,noiseAmpXY:0,noiseAmpZ:0,noiseFreq:4,noiseSpeed:.5,flythroughTopology:"strokes",flythroughDepthSource:"luminance",flythroughFlySpeed:.8,flythroughTunnelDepth:2,flythroughSlabCount:4,flythroughFlowStrength:.4,flythroughFlowScale:2,flythroughAnchorPull:1.2,flythroughStrokeLength:.08,flythroughStrokeWidth:.006,flythroughDepthStrength:.5,flythroughAudioReactive:!1}}function vn(){return{type:"glow",color:[255,160,40],secondaryColor:null,size:20,opacity:1,glow:2,softness:.6,jitter:0,taper:!0,pressureSensitive:!1,smoothing:.5,speed:1,gpuParticleCount:800,gpuSpiralRadius:.025,gpuSpiralSpeed:1.2,gpuSpiralPitch:8,gpuParticleDrift:.05,gpuSpiralShowCore:!1,gpuWaterGravity:1,gpuSmokeRise:.5,gpuGlassTube:!1,gpuGlassTubeRadiusScale:1.25,gpuGlassTubeColor:[220,230,255],taperStart:1,taperEnd:1,taperCurve:1}}function pa(){return{strokes:[],backgroundColor:[0,0,0,1],drawMode:"freehand",loopMode:"forward",animationSpeed:1,trailLength:.3,drawSpeed:1,staggerStrokes:!0,staggerDelay:200,pingPongHold:0,sequenceMode:"recorded",randomSequenceSeed:1337,bloom:1.5,motionBlur:.2,afterglow:.4,colorShift:0,echo:0,echoOffset:.03,echoDecay:.3,snake:0,snakeSpeed:1,multiColorGlow:!1,pulse:0,pulseSpeed:1,strobe:0,wave:0,waveFreq:3,waveSpeed:1,windSway:0,windSpeed:1,windScale:2,windAnchor:.7,flowPulse:0,flowSpeed:1,flowWidth:.12,sparkle:0,flicker:0,breathe:0,breatheSpeed:1,selectedStrokeId:null,isPlaying:!1,isRecording:!1,playbackPosition:0}}function ha(){return{brush:"drip",particleCount:8e4,spawnRate:350,spawnSpread:.4,gravity:.7,viscosity:.92,lifespanSec:5,glow:1.8,hueCycleSpeed:.04,baseColor:[1,.3,.82],size:.014,audioReactivity:.7,emissionZ:0}}function ga(){return{text:"HELLO WORLD",fontFamily:"Arial",fontSize:120,fontWeight:700,fontStyle:"normal",color:"#ffffff",strokeColor:"#000000",strokeWidth:0,alignment:"center",letterSpacing:0,lineHeight:1.2,backgroundColor:"transparent",shadowColor:"rgba(0,0,0,0)",shadowBlur:0,shadowOffsetX:0,shadowOffsetY:0,animation:{type:"none",speed:1,loop:!0,direction:"forward",staggerDelay:.05,intensity:1},enable3D:!1,extrudeDepth:20,extrudeColor:"#444444",rotateX:15,rotateY:-25,rotateZ:0,lightAngle:135,lightIntensity:.6,bevelSize:0}}function $e(){return{dataType:"pointcloud",filePath:"",pointCount:0,pointDensity:1,activePointCount:0,textureEnabled:!1,texturePath:"",textureBlend:.5,textureType:"image",textureProjection:"spherical",textureScale:1,textureOffsetX:0,textureOffsetY:0,renderMode:"points",pointSize:3,pointSizeAttenuation:!0,sizeAttenuation:!0,depthTest:!0,opacity:1,useOriginalColors:!0,colorA:[255,255,255],colorB:[100,200,255],colorMix:0,hueShift:0,cameraOrbitEnabled:!0,autoRotate:!1,autoRotateSpeed:1,cameraDistance:50,cameraFov:60,cameraOrbitX:0,cameraOrbitY:0,cameraRoll:0,cameraPanX:0,cameraPanY:0,cameraLookAt:{x:0,y:0,z:0},scaleUniform:1,rotationX:0,rotationY:0,rotationZ:0,positionX:0,positionY:0,positionZ:0,animationType:"none",animationSpeed:1,animationProgress:0,animationLoop:!0,animationPingPong:!1,animationIntensity:1,explodeForce:1,implodeForce:1,voxelGridSize:16,peelAxis:"y",peelDirection:1,swarmCohesion:.5,swarmSeparation:.5,swarmAlignment:.5,slicePlane:{enabled:!1,axis:"y",position:0,thickness:.1,animated:!1,speed:1,mode:"reveal"},physics:{gravity:0,damping:.95,bounce:.5,turbulence:0,attractorStrength:0,attractorPosition:{x:0,y:0,z:0}},displacementType:"none",displacementAmount:.5,noiseScale:2,noiseSpeed:1,noiseOctaves:3,waveFrequency:2,waveAmplitude:.3,glitchIntensity:.5,glitchFrequency:2,windDirection:{x:1,y:0,z:0},windStrength:.5,audioEnabled:!1,audioSensitivity:1,audioBand:"all",audioDisplacement:.5,audioScale:.3,audioColor:.5,physicsEnabled:!1,gravity:0,friction:.05,bounciness:.5,displacementIntensity:.5,displacementSpeed:1,displacementScale:2,colorEffectType:"none",colorEffect:"none",colorEffectIntensity:1,colorEffectSpeed:1,tintColor:"#ffffff",tintStrength:0,heatmapMin:0,heatmapMax:1,hologramSpeed:2,hologramDensity:20,opacityEffectType:"none",opacityEffect:"none",opacityEffectIntensity:1,dofFocalDistance:.5,dofFocusDistance:50,dofBlurAmount:.5,fogDensity:.3,fogColor:"#323250",pulseSpeed:1,proximityRadius:.3,dissolveProgress:0,creativeEffectType:"none",creativeEffect:"none",creativeEffectIntensity:1,trailLength:10,trailFade:.9,trailDecay:.9,feedbackAmount:.3,kaleidoscopeSegments:6,constellationDistance:.1,constellationMaxDistance:.1,constellationOpacity:.5,echoCount:3,echoDelay:.1,mouseInfluence:0,mouseRadius:.2,mouseStrength:.5,mouseMode:"attract",mouseInteraction:"none",bloom:0,bloomThreshold:.5,chromatic:0,vignette:0}}function Ze(){return{modelData:null,modelFormat:"glb",modelName:"",vertexCount:0,faceCount:0,materialType:"standard",materialColor:[200,200,200],materialRoughness:.5,materialMetalness:0,materialOpacity:1,materialEmissive:[0,0,0],materialEmissiveIntensity:0,hologramScanSpeed:2,hologramScanCount:20,hologramGlitchIntensity:.3,hologramRimColor:[0,200,255],lavaFlowSpeed:1,lavaCrackIntensity:.5,lavaGlowColor:[255,100,0],iceRefraction:1.3,iceFrostIntensity:.5,glassIOR:1.5,glassThickness:.5,chromeReflectivity:1,dissolveAmount:0,dissolveEdgeColor:[255,100,0],dissolveEdgeWidth:.05,toonLevels:4,toonEdgeThickness:2,fresnelPower:2,fresnelColor:[100,200,255],diffuseTexture:{type:"none",path:"",blend:1,uvScale:1,uvOffsetX:0,uvOffsetY:0,uvRotation:0},normalTexture:{type:"none",path:"",blend:1,uvScale:1,uvOffsetX:0,uvOffsetY:0,uvRotation:0},emissiveTexture:{type:"none",path:"",blend:1,uvScale:1,uvOffsetX:0,uvOffsetY:0,uvRotation:0},wireframeMode:"none",wireframeColor:[100,200,255],wireframeOpacity:1,wireframeThickness:1,wireframeAnimSpeed:1,vertexDecoration:"none",vertexDecorationSize:.05,vertexDecorationColor:[255,255,255],deformationType:"none",deformationIntensity:.5,deformationSpeed:1,deformationScale:2,deformationAxis:"all",deformationSpread:1,animationType:"none",animationSpeed:1,animationIntensity:1,animationLoop:!0,animationProgress:0,echo:{enabled:!1,type:"none",count:5,spacing:.5,fadeRate:.2,scaleVariation:0,rotationVariation:0,colorVariation:0,phaseOffset:.1,speed:1},renderStyle:"solid",scaleUniform:1,rotationX:0,rotationY:0,rotationZ:0,positionX:0,positionY:0,positionZ:0,camera:{autoRotate:!1,rotateSpeed:1,distance:5,fov:50,orbitX:0,orbitY:20,roll:0,panX:0,panY:0},lightingPreset:"studio",ambientIntensity:.4,directionalIntensity:1,lightColor:[255,255,255],audio:{enabled:!1,scaleResponse:.3,rotationResponse:0,deformResponse:.5,colorResponse:.3,emissiveResponse:.5,audioBand:"all"},bloom:0,bloomThreshold:.5,chromatic:0,vignette:0,beatScale:0,beatRotate:0,beatExplode:0,beatColorFlash:0}}function xa(){return{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomLeft:{x:0,y:0},bottomRight:{x:1,y:0}}}function dn(u,i){const l=[];for(let o=0;o<u;o++){const r=[];for(let a=0;a<i;a++)r.push({x:a/(i-1),y:1-o/(u-1)});l.push(r)}return{rows:u,cols:i,points:l}}function ba(){return{svgSource:"",panX:0,panY:0,contentScale:1,fillMode:"liquid",gradientAngle:90,gradientSpread:.3,shimmerSpeed:5,shimmerScale:.1,shimmerIntensity:.8,pulseSpeed:3,pulseRingScale:10,pulseRingSpeed:5,noiseScale:.02,noiseSpeed:.5,noiseContrast:.5,particleFillDensity:200,particleFillSize:3,particleFillSpeed:1,colorMode:"perShape",monochromeHue:0,perShapeColors:!0,colorCycleEnabled:!0,colorCycleSpeed:.3,colorCycleSaturation:.8,colorCycleLightness:.55,outlineThickness:3,liquidEnabled:!0,liquidSpeed:.4,liquidWaveAmp:.08,particlesEnabled:!0,particleSpeed:80,particleSize:2.5,energyEnabled:!0,energySpeed:150,energySize:1,connectionsEnabled:!0,connectionPulseSpeed:2,connectionThickness:2,glowEnabled:!0,glowPulseSpeed:2,glowSize:1,glowIntensity:.8,ripplesEnabled:!0,rippleSpeed:1,rippleSize:1,rippleOpacity:.5,lightningEnabled:!0,lightningFrequency:1.5,lightningThickness:3,lightningBranches:3,lightningDuration:.12,edgeFlowEnabled:!0,edgeFlowSpeed:1.5,edgeFlowThickness:2,innerGlowEnabled:!0,innerGlowIntensity:.5,nebulaEnabled:!0,nebulaIntensity:.3,nebulaSpeed:.2,heartbeatEnabled:!0,heartbeatSpeed:1,heartbeatIntensity:.3,plasmaEnabled:!0,plasmaIntensity:.8,plasmaSpeed:2,plasmaThickness:3,plasmaOpacity:.6,particleLinksEnabled:!0,particleLinkDistance:80,particleLinkOpacity:.5,particleLinkThickness:2,particleLinkMaxLinks:800,particleLinkSpeed:5,echoEnabled:!0,echoLayers:4,echoSpacing:8,echoThickness:2,echoOpacity:.3,arcBridgesEnabled:!0,arcBridgeHeight:15,arcBridgeThickness:3,arcBridgeOpacity:.4,bloomStrength:1.8,bloomThreshold:.15,chromatic:.002,vignette:.3}}function pe(u,i,l="media"){return{id:u,name:i,type:l,visible:!0,locked:!1,opacity:1,blendMode:l==="lines"||l==="svg"||l==="lightpainting"||l==="adv-lightpaint"||l==="splat"||l==="model3d"?"add":"normal",source:null,linesContent:l==="lines"?va():null,svgContent:l==="svg"?ba():null,colorContent:l==="color"?{hue:0,saturation:100,lightness:50,alpha:1}:null,lightPaintingContent:l==="lightpainting"?pa():null,advLightPaintingContent:l==="adv-lightpaint"?ha():null,textContent:l==="text"?ga():null,splatContent:l==="splat"?$e():null,model3dContent:l==="model3d"?Ze():null,pixelFXContent:l==="pixel-fx"?ma():null,gpuLayerContent:l==="gpu"?da():null,position:{x:0,y:0},scale:{x:1,y:1},rotation:0,flipH:!1,flipV:!1,warpMode:"corners",corners:xa(),meshGrid:null,mask:null,cropRegion:null,layerShape:l==="media"?Sa("rectangle"):null,effects:[],edgeEffects:null,...l==="screen"?{vjLayerIndex:0}:{}}}function mn(u,i){return{...pe(u,i,"group"),groupConfig:{shaderMode:"individual",overrideStyles:!1,shaderSource:null},groupCollapsed:!1}}function pn(u,i){return pe(u,i,"lines")}function hn(u,i){return pe(u,i,"svg")}function gn(u,i){return pe(u,i,"color")}function xn(u,i){return pe(u,i,"lightpainting")}function bn(u,i){return pe(u,i,"adv-lightpaint")}function yn(u,i){return pe(u,i,"text")}function Sn(u,i){return pe(u,i,"splat")}function Oe(u){return{id:u,compositionId:null,opacity:1,blendMode:"normal",isActive:!1}}function ya(){return{clips:[],loop:!0,totalDuration:0,isPlaying:!1,currentTime:0}}function Cn(){return{enabled:!1,compositions:[],decks:[Oe("deck-a"),Oe("deck-b"),Oe("deck-c"),Oe("deck-d")],timeline:ya(),activeCompositionId:null,masterOpacity:1}}function Tn(u){return{id:kt(),name:u,width:1920,height:1080,layers:[],selectedLayerId:null,vjMode:null,mediaFolders:[],stagePresets:[],svKeyboardPresets:[],wledControllers:[]}}function wn(){return{x:0,y:0,width:1,height:1}}function Sa(u="rectangle"){const i={feather:0,rotation:0};switch(u){case"circle":return{type:u,enabled:!0,params:{...i,radiusX:1,radiusY:1},controlPoints:[{x:.2,y:.8},{x:.8,y:.8},{x:.2,y:.2},{x:.8,y:.2},{x:.5,y:.5}]};case"ellipse":return{type:u,enabled:!0,params:{...i,radiusX:1,radiusY:.7}};case"triangle":return{type:u,enabled:!0,params:{...i,triangleType:"equilateral"},controlPoints:[{x:.5,y:.88},{x:.14,y:.14},{x:.86,y:.14}]};case"polygon":return{type:u,enabled:!0,params:{...i,sides:6}};case"star":return{type:u,enabled:!0,params:{...i,sides:5,innerRadius:.4}};case"line":return{type:u,enabled:!0,params:{...i,lineWidth:.05,linePoints:[{x:.2,y:.5},{x:.8,y:.5}],lineCap:"round"}};case"polyline":return{type:u,enabled:!0,params:{...i,lineWidth:.03,linePoints:[{x:.1,y:.5},{x:.3,y:.2},{x:.5,y:.8},{x:.7,y:.3},{x:.9,y:.6}],lineCap:"round"}};case"custom":return{type:"custom",enabled:!0,params:{...i,customPoints:[],customClosed:!1}};default:return{type:"rectangle",enabled:!0,params:i}}}function Rn(){return{id:kt(),enabled:!0,fill:{type:"none"},stroke:{type:"glow",color:[0,1,.5,1],width:3,glowSize:15,glowIntensity:1,pulseSpeed:1},animation:{type:"none"},blendMode:"add",opacity:1}}function Ca(u){const i=[],l=(u.params.rotation??0)*Math.PI/180,o=u.params.scale??1,r=(a,e)=>{const t=a*Math.cos(l)-e*Math.sin(l),s=a*Math.sin(l)+e*Math.cos(l);return{x:t+.5,y:s+.5}};switch(u.type){case"rectangle":{const a=.5*o,e=.5*o;i.push(r(-a,e)),i.push(r(a,e)),i.push(r(a,-e)),i.push(r(-a,-e));break}case"circle":{const a=(u.params.radiusX??.5)*.5*o,e=64;for(let t=0;t<e;t++){const s=t/e*Math.PI*2+l;i.push({x:.5+a*Math.cos(s),y:.5+a*Math.sin(s)})}break}case"ellipse":{const a=(u.params.radiusX??.5)*.5*o,e=(u.params.radiusY??.35)*.5*o,t=64;for(let s=0;s<t;s++){const n=s/t*Math.PI*2,c=a*Math.cos(n),f=e*Math.sin(n);i.push(r(c,f))}break}case"triangle":{if(u.controlPoints&&u.controlPoints.length===3)i.push(...u.controlPoints);else{const a=.4*o;for(let e=0;e<3;e++){const t=e/3*Math.PI*2-Math.PI/2+l;i.push({x:.5+a*Math.cos(t),y:.5+a*Math.sin(t)})}}break}case"polygon":{const a=u.params.sides??6,e=.4*o;for(let t=0;t<a;t++){const s=t/a*Math.PI*2-Math.PI/2+l;i.push({x:.5+e*Math.cos(s),y:.5+e*Math.sin(s)})}break}case"star":{const a=u.params.sides??5,e=.4*o,t=e*(u.params.innerRadius??.4);for(let s=0;s<a*2;s++){const n=s/(a*2)*Math.PI*2-Math.PI/2+l,c=s%2===0?e:t;i.push({x:.5+c*Math.cos(n),y:.5+c*Math.sin(n)})}break}case"custom":return{...u};default:{i.push({x:.1,y:.9},{x:.9,y:.9},{x:.9,y:.1},{x:.1,y:.1});break}}return{type:"custom",enabled:u.enabled,params:{feather:u.params.feather,rotation:0,customPoints:i,customClosed:!0}}}function Ta(u){if(u.type==="custom"){const o=u.params.customPoints;if(!o||o.length<3)return[];const r=[],a=10;for(let e=0;e<o.length;e++){const t=o[e],s=(e+1)%o.length,n=o[s],c=t.cpOut||n.cpIn;if(r.push({x:t.x,y:t.y}),c){const f=t.cpOut??t,v=n.cpIn??n;for(let d=1;d<a;d++){const m=d/a,h=1-m,p=h*h,g=m*m;r.push({x:p*h*t.x+3*p*m*f.x+3*h*g*v.x+g*m*n.x,y:p*h*t.y+3*p*m*f.y+3*h*g*v.y+g*m*n.y})}}}return r}let l=Ca(u).params.customPoints??[];if(u.type==="circle"&&u.controlPoints?.length===5){const[o,r,a,e,t]=u.controlPoints;l=l.map(s=>{const n=o.x+(r.x-o.x)*s.x,c=o.y+(r.y-o.y)*s.x,f=a.x+(e.x-a.x)*s.x,v=a.y+(e.y-a.y)*s.x;return{x:f+(n-f)*s.y,y:v+(c-v)*s.y}})}return l}function Ht(){return{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomLeft:{x:0,y:1},bottomRight:{x:1,y:1}}}function It(u=3,i=3){const l=[];for(let o=0;o<u;o++){const r=[];for(let a=0;a<i;a++)r.push({x:a/(i-1),y:o/(u-1)});l.push(r)}return{rows:u,cols:i,points:l}}const wa=`
  varying vec2 vUv;

  // Corner positions in normalized space (0-1)
  uniform vec2 uTopLeft;
  uniform vec2 uTopRight;
  uniform vec2 uBottomLeft;
  uniform vec2 uBottomRight;

  // When true, use geometry position directly (for mesh warp mode)
  // When false, compute position from corner uniforms (for corner warp mode)
  uniform bool uUseMeshPosition;

  void main() {
    vUv = uv;

    vec2 clipPos;

    if (uUseMeshPosition) {
      // Mesh warp mode: geometry positions have been pre-computed by CPU
      // Position is already in clip space (-1 to 1)
      clipPos = position.xy;
    } else {
      // Corner warp mode: bilinear interpolation of corner positions
      vec2 top = mix(uTopLeft, uTopRight, uv.x);
      vec2 bottom = mix(uBottomLeft, uBottomRight, uv.x);
      vec2 pos = mix(bottom, top, uv.y);

      // Convert from 0-1 to -1 to 1 (clip space)
      clipPos = pos * 2.0 - 1.0;
    }

    gl_Position = vec4(clipPos, 0.0, 1.0);
  }
`,Ra=`
  uniform sampler2D uTexture;
  uniform float uOpacity;
  // Luminance-keyed background opacity. Default 1.0 = bg fully opaque
  // (no keying). Lower values fade the alpha proportionally to the
  // pixel's brightness, so dark areas become transparent while
  // bright content stays solid. Used by GPU shader layers (set per-
  // layer via gpuLayerContent.bgOpacity) to "key out" their dark
  // background so the layer below shows through. All other layer
  // types leave it at 1.0.
  uniform float uBgOpacity;
  uniform vec4 uCropRegion; // x, y, width, height (0-1 normalized)
  uniform bool uCropEnabled;
  uniform int uLayerShapeType; // 0=rectangle, 1=circle, 2=triangle
  uniform float uLayerShapeFeather;
  uniform float uLayerShapeRotation;
  uniform float uLayerShapeScale;
  uniform int uLayerShapeHasControlPoints;
  uniform int uLayerShapeControlPointCount;
  uniform vec2 uLayerShapeControlPoints[5];
  uniform bool uFlipH;
  uniform bool uFlipV;
  uniform int uContentFit;      // 0=stretch, 1=fill (cover), 2=crop (contain)
  uniform float uSourceAspect;  // source width / height
  uniform float uLayerAspect;   // layer quad width / height
  // Custom shape polygon (evaluated in UV space so it warps with geometry)
  uniform int uCustomShapeEnabled;
  uniform int uCustomShapePointCount;
  uniform vec2 uCustomShapePoints[256];
  uniform int uCustomShapeFit;      // 0=mask (clip only), 1=warp (stretch to bbox), 2=fill (aspect-fit to bbox)
  uniform vec4 uCustomShapeBBox;    // vec4(minX, minY, maxX, maxY) of the polygon
  uniform int uCustomShapeInvert;   // 0=normal (show inside shape), 1=invert (show outside / cutout)
  varying vec2 vUv;

  vec2 rotate2D(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  bool pointInTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = c - a;
    vec2 v1 = b - a;
    vec2 v2 = p - a;
    float dot00 = dot(v0, v0);
    float dot01 = dot(v0, v1);
    float dot02 = dot(v0, v2);
    float dot11 = dot(v1, v1);
    float dot12 = dot(v1, v2);
    float invDenom = 1.0 / (dot00 * dot11 - dot01 * dot01);
    float u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    float v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0.0) && (v >= 0.0) && (u + v <= 1.0);
  }

  float sdTriangleFromPoints(vec2 p, vec2 a, vec2 b, vec2 c) {
    float d = min(min(distToSegment(p, a, b), distToSegment(p, b, c)), distToSegment(p, c, a));
    return pointInTriangle(p, a, b, c) ? -d : d;
  }

  vec3 barycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = b - a;
    vec2 v1 = c - a;
    vec2 v2 = p - a;
    float d00 = dot(v0, v0);
    float d01 = dot(v0, v1);
    float d11 = dot(v1, v1);
    float d20 = dot(v2, v0);
    float d21 = dot(v2, v1);
    float denom = d00 * d11 - d01 * d01;
    float v = (d11 * d20 - d01 * d21) / denom;
    float w = (d00 * d21 - d01 * d20) / denom;
    float u = 1.0 - v - w;
    return vec3(u, v, w);
  }

  // Inverse bilinear interpolation for editable circle control points.
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);
    for (int i = 0; i < 6; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);
      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.00001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );
      uv += delta;
    }
    return uv;
  }

  // Custom shape: ray-casting point-in-polygon test (tessellated bezier)
  float customPointInPolygon(vec2 p) {
    if (uCustomShapePointCount < 3) return 0.0;
    int crossings = 0;
    for (int i = 0; i < 256; i++) {
      if (i >= uCustomShapePointCount) break;
      int j = i + 1;
      if (j >= uCustomShapePointCount) j = 0;
      vec2 p1 = uCustomShapePoints[i];
      vec2 p2 = uCustomShapePoints[j];
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }
    return mod(float(crossings), 2.0);
  }

  // Custom shape: minimum distance to polygon edge (tessellated bezier)
  float customDistToEdge(vec2 p) {
    if (uCustomShapePointCount < 3) return 1.0;
    float minDist = 1000.0;
    for (int i = 0; i < 256; i++) {
      if (i >= uCustomShapePointCount) break;
      int j = i + 1;
      if (j >= uCustomShapePointCount) j = 0;
      vec2 a = uCustomShapePoints[i];
      vec2 b = uCustomShapePoints[j];
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      float dist = length(p - (a + t * ab));
      minDist = min(minDist, dist);
    }
    return minDist;
  }

  void main() {
    vec2 layerUv = vUv;
    if (uFlipH) layerUv.x = 1.0 - layerUv.x;
    if (uFlipV) layerUv.y = 1.0 - layerUv.y;
    vec2 sampledUv = layerUv;

    // Content fit mode: adjust UVs to maintain source aspect ratio
    if (uContentFit > 0 && uSourceAspect > 0.0 && uLayerAspect > 0.0) {
      float ratio = uSourceAspect / uLayerAspect;
      if (uContentFit == 1) {
        // Fill (cover): scale to fill, crop overflow
        if (ratio > 1.0) {
          // Source wider than layer - crop sides
          sampledUv.x = (sampledUv.x - 0.5) / ratio + 0.5;
        } else {
          // Source taller than layer - crop top/bottom
          sampledUv.y = (sampledUv.y - 0.5) * ratio + 0.5;
        }
      } else if (uContentFit == 2) {
        // Crop (contain): fit inside, letterbox
        if (ratio > 1.0) {
          // Source wider - fit width, letterbox top/bottom
          sampledUv.y = (sampledUv.y - 0.5) * ratio + 0.5;
        } else {
          // Source taller - fit height, pillarbox sides
          sampledUv.x = (sampledUv.x - 0.5) / ratio + 0.5;
        }
      }
    }

    // Shape-specific UV warping for editable control points.
    if (uLayerShapeType == 1 && uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 5) {
      vec2 tl = uLayerShapeControlPoints[0];
      vec2 tr = uLayerShapeControlPoints[1];
      vec2 bl = uLayerShapeControlPoints[2];
      vec2 br = uLayerShapeControlPoints[3];
      vec2 center = uLayerShapeControlPoints[4];
      sampledUv = inverseWarp(layerUv, tl, tr, bl, br);
      vec2 centerOffset = center - vec2(0.5);
      float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(layerUv - vec2(0.5)));
      sampledUv -= centerOffset * centerWeight * 0.6;
    } else if (uLayerShapeType == 2 && uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 3) {
      vec2 a = uLayerShapeControlPoints[0];
      vec2 b = uLayerShapeControlPoints[1];
      vec2 c = uLayerShapeControlPoints[2];
      vec3 bc = barycentric(layerUv, a, b, c);
      if (bc.x >= 0.0 && bc.y >= 0.0 && bc.z >= 0.0) {
        vec2 d0 = vec2(0.5, 0.88);
        vec2 d1 = vec2(0.14, 0.14);
        vec2 d2 = vec2(0.86, 0.14);
        sampledUv = d0 * bc.x + d1 * bc.y + d2 * bc.z;
      }
    }

    if (uCropEnabled) {
      sampledUv = uCropRegion.xy + sampledUv * uCropRegion.zw;
    }

    // Custom shape UV remapping: stretch/fill texture to polygon bounding box.
    // Skipped entirely when invert is ON — in cutout/negative-space mode the
    // visible region is OUTSIDE the polygon (often most of the layer quad),
    // and bbox-relative UVs would extrapolate way past 0..1 and produce ugly
    // stretched/repeated artifacts. With inversion the texture should fill
    // the whole layer naturally and the polygon just punches a hole through it.
    if (uCustomShapeEnabled == 1 && uCustomShapeFit > 0 && uCustomShapePointCount >= 3 && uCustomShapeInvert == 0) {
      vec2 bbMin = uCustomShapeBBox.xy;
      vec2 bbSize = uCustomShapeBBox.zw - uCustomShapeBBox.xy;
      if (bbSize.x > 0.001 && bbSize.y > 0.001) {
        if (uCustomShapeFit == 1) {
          // Warp: stretch texture to fill the polygon's bounding box
          sampledUv = (layerUv - bbMin) / bbSize;
        } else if (uCustomShapeFit == 2) {
          // Fill: maintain source aspect ratio, use bbox top/bottom as height guide
          float bboxAspect = bbSize.x / bbSize.y;
          float sourceAspect = uSourceAspect > 0.0 ? uSourceAspect : 1.0;
          // Normalize within bbox first
          vec2 bboxUv = (layerUv - bbMin) / bbSize;
          float ratio = sourceAspect / bboxAspect;
          if (ratio > 1.0) {
            // Source wider than bbox - crop sides, fit height
            bboxUv.x = (bboxUv.x - 0.5) / ratio + 0.5;
          } else {
            // Source taller than bbox - crop top/bottom, fit width
            bboxUv.y = (bboxUv.y - 0.5) * ratio + 0.5;
          }
          sampledUv = bboxUv;
        }
      }
    }

    // For contain mode (crop), show transparent black for out-of-bounds UVs (letterbox/pillarbox)
    float contentMask = 1.0;
    if (uContentFit == 2) {
      if (sampledUv.x < 0.0 || sampledUv.x > 1.0 || sampledUv.y < 0.0 || sampledUv.y > 1.0) {
        contentMask = 0.0;
      }
    }

    // Allow content to extend beyond bounds — use edge texels for overflow
    // instead of hard clamping (enables stretching outside rectangle)
    vec4 texColor = texture2D(uTexture, sampledUv);

    float mask = 1.0;
    float feather = max(uLayerShapeFeather, 0.0);
    float safeScale = max(uLayerShapeScale, 0.0001);

    if (uLayerShapeType == 1) {
      if (uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 5) {
        vec2 tl = uLayerShapeControlPoints[0];
        vec2 tr = uLayerShapeControlPoints[1];
        vec2 bl = uLayerShapeControlPoints[2];
        vec2 br = uLayerShapeControlPoints[3];
        vec2 center = uLayerShapeControlPoints[4];
        vec2 circleUv = inverseWarp(layerUv, tl, tr, bl, br);
        vec2 centerOffset = center - vec2(0.5);
        float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(layerUv - vec2(0.5)));
        circleUv -= centerOffset * centerWeight * 0.6;
        float dist = length(circleUv - vec2(0.5)) - 0.5;
        // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
      } else {
        vec2 p = (layerUv - 0.5) / safeScale;
        p = rotate2D(p, -uLayerShapeRotation);
        float dist = length(p) - 0.5;
        // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
      }
    } else if (uLayerShapeType == 2) {
      float dist = 1.0;
      if (uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 3) {
        vec2 a = uLayerShapeControlPoints[0];
        vec2 b = uLayerShapeControlPoints[1];
        vec2 c = uLayerShapeControlPoints[2];
        dist = sdTriangleFromPoints(layerUv, a, b, c);
      } else {
        vec2 p = rotate2D((layerUv - 0.5) / safeScale, -uLayerShapeRotation) + 0.5;
        vec2 a = vec2(0.5, 0.88);
        vec2 b = vec2(0.14, 0.14);
        vec2 c = vec2(0.86, 0.14);
        dist = sdTriangleFromPoints(p, a, b, c);
      }
      // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }

    // Custom shape polygon mask (evaluated in UV space so it warps with geometry).
    // Feather is one-sided: only fades the INSIDE edge. Outside the polygon is
    // always fully transparent — no outward bleed.
    // When uCustomShapeInvert==1, we flip the mask so the polygon punches a hole
    // (cutout / negative space) and the area OUTSIDE the polygon shows the layer.
    if (uCustomShapeEnabled == 1 && uCustomShapePointCount >= 3) {
      float inside = customPointInPolygon(layerUv);
      float customMask;
      if (feather > 0.001 && inside > 0.5) {
        float dist = customDistToEdge(layerUv);
        customMask = smoothstep(0.0, feather, dist);
      } else {
        customMask = inside;
      }
      if (uCustomShapeInvert == 1) {
        customMask = 1.0 - customMask;
      }
      mask *= customMask;
    }

    // BG keying: mix(luma, 1.0, uBgOpacity). When uBgOpacity=1 the
    // key is a no-op; at 0 the alpha collapses to the pixel's value
    // channel so black is transparent and bright stays opaque. The
    // mix gives the user a continuous fade between the two.
    float bgLuma = max(max(texColor.r, texColor.g), texColor.b);
    float bgKey = mix(bgLuma, 1.0, uBgOpacity);
    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity * mask * contentMask * bgKey);
  }
`,Et={normal:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, layer.rgb, a), max(base.a, a));
    }
  `,multiply:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb * layer.rgb;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,screen:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - (1.0 - base.rgb) * (1.0 - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,difference:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = abs(base.rgb - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,add:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb + layer.rgb, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,subtract:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = max(base.rgb - layer.rgb, 0.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,overlay:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 overlay(vec3 base, vec3 blend) {
      return vec3(
        base.r < 0.5 ? 2.0 * base.r * blend.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
        base.g < 0.5 ? 2.0 * base.g * blend.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
        base.b < 0.5 ? 2.0 * base.b * blend.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b)
      );
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = overlay(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,darken:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,lighten:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = max(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,exclusion:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb + layer.rgb - (2.0 * base.rgb * layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,hardlight:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 lo = 2.0 * base.rgb * layer.rgb;
      vec3 hi = 1.0 - (2.0 * (1.0 - base.rgb) * (1.0 - layer.rgb));
      vec3 blended = mix(lo, hi, step(vec3(0.5), layer.rgb));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,softlight:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = ((1.0 - 2.0 * layer.rgb) * base.rgb * base.rgb) + (2.0 * layer.rgb * base.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,"color-dodge":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb / max(vec3(1.0) - layer.rgb, vec3(0.001));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,"color-burn":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - ((1.0 - base.rgb) / max(layer.rgb, vec3(0.001)));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,hue:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(lh.x, bh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,saturation:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(bh.x, lh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,color:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(lh.x, lh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,luminosity:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(bh.x, bh.y, lh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,divide:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb / max(layer.rgb, vec3(0.001));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,average:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = (base.rgb + layer.rgb) * 0.5;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,negation:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - abs(1.0 - base.rgb - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,phoenix:`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb, layer.rgb) - max(base.rgb, layer.rgb) + 1.0;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,"linear-light":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = clamp(base.rgb + (2.0 * layer.rgb) - 1.0, 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,"hard-mix":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 linearLight = clamp(base.rgb + (2.0 * layer.rgb) - 1.0, 0.0, 1.0);
      vec3 blended = step(vec3(0.5), linearLight);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,"vivid-light":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 burn = 1.0 - ((1.0 - base.rgb) / max(2.0 * layer.rgb, vec3(0.001)));
      vec3 dodge = base.rgb / max(2.0 * (1.0 - layer.rgb), vec3(0.001));
      vec3 blended = clamp(mix(burn, dodge, step(vec3(0.5), layer.rgb)), 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,"pin-light":`
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 low = min(base.rgb, 2.0 * layer.rgb);
      vec3 high = max(base.rgb, (2.0 * layer.rgb) - 1.0);
      vec3 blended = clamp(mix(low, high, step(vec3(0.5), layer.rgb)), 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `},Be=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,ka=`
  uniform sampler2D uTexture;
  uniform vec4 uOutputCrop;
  uniform int uOutputRotation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uGamma;
  varying vec2 vUv;

  vec2 rotateUv(vec2 uv) {
    if (uOutputRotation == 1) {
      return vec2(uv.y, 1.0 - uv.x);
    }
    if (uOutputRotation == 2) {
      return vec2(1.0 - uv.x, 1.0 - uv.y);
    }
    if (uOutputRotation == 3) {
      return vec2(1.0 - uv.y, uv.x);
    }
    return uv;
  }

  void main() {
    vec2 uv = rotateUv(vUv);
    uv = uOutputCrop.xy + uv * uOutputCrop.zw;

    vec4 color = texture2D(uTexture, clamp(uv, 0.0, 1.0));
    vec3 corrected = color.rgb * uBrightness;
    corrected = (corrected - 0.5) * uContrast + 0.5;
    corrected = pow(max(corrected, vec3(0.0)), vec3(max(uGamma, 0.001)));
    gl_FragColor = vec4(clamp(corrected, 0.0, 1.0), 1.0);
  }
`,ge=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,Ma=`
  uniform sampler2D uTexture;
  uniform float uSize;        // 0-1, how far vignette extends from center
  uniform float uSoftness;    // 0-1, edge softness
  uniform float uRoundness;   // 0-1, circular vs rectangular (legacy mix factor)
  // Hero-rewrite params
  uniform float uShape;       // 0=round, 1=oval, 2=square, 3=superellipse
  uniform float uAspect;      // 0.3-3.0 — oval/superellipse aspect ratio (X/Y)
  uniform float uCenterX;     // 0-1 — vignette center X (0.5 = frame center)
  uniform float uCenterY;     // 0-1 — vignette center Y
  uniform float uColorR;      // 0-1 tint R (used when uTintAmount > 0)
  uniform float uColorG;      // 0-1 tint G
  uniform float uColorB;      // 0-1 tint B
  uniform float uTintAmount;  // 0-1 — 0 = transparent fade (legacy), 1 = solid color fade
  uniform float uBreathing;   // 0-1 — animated size oscillation amplitude
  uniform float uBreathSpeed; // 0-2 — breathing speed (cycles per second / 2π)
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Animated breathing — size pulses around uSize. Smooth sine wave;
    // uBreathing=0 gives identical behavior to the legacy shader.
    float breath = sin(uTime * uBreathSpeed * 6.28318) * 0.5 + 0.5;
    float effectiveSize = uSize - uBreathing * 0.15 * (breath - 0.5);

    // Centered coordinates with user-movable center.
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 pos = vUv - center;

    // Compute distance based on shape selector.
    int shape = int(uShape + 0.5);
    float dist = 1.0;
    if (shape == 0) {
      // Round (legacy): mix between rectangular and circular via uRoundness.
      float rectDist = max(abs(pos.x), abs(pos.y)) * 2.0;
      float circDist = length(pos) * 2.0;
      dist = mix(rectDist, circDist, uRoundness);
    } else if (shape == 1) {
      // Oval — circular but stretched by uAspect on the X axis.
      float a = max(uAspect, 0.0001);
      dist = length(vec2(pos.x / a, pos.y)) * 2.0;
    } else if (shape == 2) {
      // Square — strict L∞ (max-axis) distance, ignores uAspect/uRoundness.
      dist = max(abs(pos.x), abs(pos.y)) * 2.0;
    } else {
      // Superellipse (squircle) — Lp norm with p=4 gives that rounded-rect
      // look you see in product photography. Stretched by uAspect.
      float a = max(uAspect, 0.0001);
      vec2 q = vec2(pos.x / a, pos.y) * 2.0;
      dist = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);
    }

    // Smooth falloff across the edge band.
    float vignette = 1.0 - smoothstep(effectiveSize - uSoftness * 0.5, effectiveSize + uSoftness * 0.5, dist);

    // Tint mode: when uTintAmount=0 we fade alpha (legacy behavior).
    // When uTintAmount=1 we KEEP alpha and blend the image toward the
    // tint color in the vignette region — perfect for "stage spotlight"
    // (black surround) or "warm portrait" (orange-brown surround).
    vec3 tint = vec3(uColorR, uColorG, uColorB);
    vec3 finalRgb = mix(texColor.rgb, tint, (1.0 - vignette) * uTintAmount);
    float finalA = texColor.a * mix(vignette, 1.0, uTintAmount);

    gl_FragColor = vec4(finalRgb, finalA);
  }
`,Da=`
  uniform sampler2D uTexture;
  uniform float uTop;          // 0-1 feather amount from top
  uniform float uBottom;       // 0-1 feather amount from bottom
  uniform float uLeft;         // 0-1 feather amount from left
  uniform float uRight;        // 0-1 feather amount from right
  uniform float uSoftness;     // 0-1 overall softness modifier
  // Hero-rewrite params
  uniform float uGamma;        // 0.2-3.0 — falloff curve (1.0 = linear, <1 = sharper, >1 = softer)
  uniform float uMattePreview; // 0=normal, 1=matte preview (alpha as red overlay)
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float alpha = 1.0;

    if (uTop > 0.0)    alpha *= smoothstep(1.0, 1.0 - uTop, vUv.y);
    if (uBottom > 0.0) alpha *= smoothstep(0.0, uBottom, vUv.y);
    if (uLeft > 0.0)   alpha *= smoothstep(0.0, uLeft, vUv.x);
    if (uRight > 0.0)  alpha *= smoothstep(1.0, 1.0 - uRight, vUv.x);

    // Apply overall softness modifier (legacy behavior).
    alpha = pow(alpha, 1.0 / max(uSoftness + 0.5, 0.1));

    // Gamma-aware falloff. Projector edge-blending is GAMMA-space, not
    // linear. uGamma=2.2 produces the curve real projectors blend with
    // — falls off slowly in the bright zone then quickly at the edge.
    // uGamma=1 = current behavior; <1 sharpens for hard masks.
    alpha = pow(alpha, max(uGamma, 0.0001));

    // Matte preview: bypass the image and render alpha as a translucent
    // red overlay so the user can SEE the feather shape they're
    // dialling in. Same trick After Effects uses for shape masks.
    if (uMattePreview > 0.5) {
      vec3 matteR = vec3(1.0, 0.0, 0.0);
      vec3 inv = vec3(1.0) - matteR;
      // Show the feather as red opacity, opaque-black elsewhere.
      gl_FragColor = vec4(mix(vec3(0.0), matteR, 1.0 - alpha), 1.0);
      return;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
  }
`,Aa=`
  uniform sampler2D uTexture;
  uniform float uPalette;       // 0-11 named palettes (Rainbow, Sunset, Ocean, Neon, Fire,
                                //   Forest, Ice, Psychedelic, Vaporwave, Club, Pastel, Mono)
  uniform float uOffset;        // 0-1 manual offset through palette
  uniform float uSpeed;         // 0-2 auto-cycle speed (0 = off)
  uniform float uContrast;      // 0.5-2 luminance contrast
  uniform float uMix;           // 0-1 blend with original
  uniform float uBands;         // 0 = smooth gradient, 1-32 = posterized into N bands
  uniform float uAudioReact;    // 0-1 how much audio modulates the cycling (0 = ignore audio)
  uniform float uHueShift;      // 0-1 fixed rotation through palette (separate from auto-cycle)
  uniform float uAudio;         // 0-1 live audio rms (set by renderer per frame)
  uniform float uTime;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // Cosine palette function: a + b * cos(2π * (c * t + d))
  vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // 12 named palettes — coefficients for the cosine-palette formula.
  // Indices here MUST match the dropdown labels in effectUX.ts.
  vec3 getPaletteColor(float t, int palette) {
    vec3 a, b, c, d;

    if (palette == 0) {
      // 0 — Rainbow (classic full-spectrum cycle)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.33, 0.67);
    }
    else if (palette == 1) {
      // 1 — Sunset (warm oranges, magentas, deep purples)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.2);
    }
    else if (palette == 2) {
      // 2 — Ocean (teals and deep blues)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.3, 0.2, 0.2);
    }
    else if (palette == 3) {
      // 3 — Neon (vibrant pinks, cyans)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 0.5);
      d = vec3(0.8, 0.9, 0.3);
    }
    else if (palette == 4) {
      // 4 — Fire (reds → oranges → yellows)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 0.7, 0.4);
      d = vec3(0.0, 0.15, 0.2);
    }
    else if (palette == 5) {
      // 5 — Forest (greens with earthy browns)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.0);
    }
    else if (palette == 6) {
      // 6 — Ice (whites, blues, cyan highlights)
      a = vec3(0.8, 0.8, 0.9);
      b = vec3(0.2, 0.4, 0.2);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.25, 0.25);
    }
    else if (palette == 7) {
      // 7 — Psychedelic (rapid hue swings)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(2.0, 1.0, 0.0);
      d = vec3(0.5, 0.2, 0.25);
    }
    else if (palette == 8) {
      // 8 — Vaporwave (hot pink → purple → teal — 80s synth aesthetic)
      a = vec3(0.6, 0.4, 0.7);
      b = vec3(0.4, 0.4, 0.4);
      c = vec3(1.0, 1.0, 0.5);
      d = vec3(0.0, 0.15, 0.50);
    }
    else if (palette == 9) {
      // 9 — Club (saturated cyan/magenta/yellow stage-light cycle)
      a = vec3(0.55, 0.45, 0.55);
      b = vec3(0.55, 0.5, 0.5);
      c = vec3(1.5, 1.5, 1.0);
      d = vec3(0.0, 0.5, 0.85);
    }
    else if (palette == 10) {
      // 10 — Pastel (soft pinks, mint, baby blue)
      a = vec3(0.85, 0.8, 0.85);
      b = vec3(0.15, 0.18, 0.15);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.33, 0.67);
    }
    else {
      // 11 — Mono Glow (single-hue luminance ramp, hue picked by uHueShift)
      // Use uHueShift as a hue offset on a simple HSV-style cycle. We
      // approximate this with a cosine palette whose d-vector is shifted.
      float h = mod(uHueShift, 1.0);
      a = vec3(0.5);
      b = vec3(0.5);
      c = vec3(1.0);
      d = vec3(h, h + 0.33, h + 0.67);
    }

    return cosinePalette(t, a, b, c, d);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 color = texColor.rgb;

    // Calculate luminance
    float lum = dot(color, vec3(0.299, 0.587, 0.114));

    // Apply contrast to luminance
    lum = (lum - 0.5) * uContrast + 0.5;
    lum = clamp(lum, 0.0, 1.0);

    // Posterize: snap luminance to discrete bands BEFORE palette lookup.
    if (uBands >= 0.5) {
      float steps = floor(uBands + 0.5);
      lum = floor(lum * steps) / max(steps - 1.0, 1.0);
      lum = clamp(lum, 0.0, 1.0);
    }

    // Audio reactivity: live audio RMS modulates the cycling offset.
    float audioPunch = clamp(uAudio, 0.0, 1.5) * uAudioReact;

    // Total palette parameter: luminance + manual offset + auto-cycle
    // + hue shift + audio punch.
    float t = lum + uOffset + uTime * uSpeed + uHueShift + audioPunch;

    // Get palette color
    int paletteIndex = int(uPalette);
    vec3 paletteColor = getPaletteColor(t, paletteIndex);

    // Mix with original based on mix parameter
    vec3 finalColor = mix(color, paletteColor, uMix);

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`,Ba=`
  uniform sampler2D uTexture;
  uniform float uMode;        // 0=RGB,1=luma-only,2=hue,3=strobe,4=threshold-above
  uniform float uAmount;      // 0-1 invert strength (partial invert at <1)
  uniform float uThreshold;   // 0-1 — used in threshold mode (invert pixels brighter than this)
  uniform float uStrobeRate;  // 0-10 — strobe Hz when uMode=3
  uniform float uTime;
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    int mode = int(uMode + 0.5);

    vec3 inverted = src;

    if (mode == 0) {
      // RGB invert (legacy at amount=1)
      inverted = 1.0 - src;
    } else if (mode == 1) {
      // Luma-only — invert brightness, keep hue/saturation. Useful for
      // "x-ray" look where colors stay but light/dark flip.
      vec3 hsv = rgb2hsv(src);
      hsv.z = 1.0 - hsv.z;
      inverted = hsv2rgb(hsv);
    } else if (mode == 2) {
      // Hue invert — rotate hue 180° (complement colors). Keeps
      // brightness/saturation; red→cyan, green→magenta, blue→yellow.
      vec3 hsv = rgb2hsv(src);
      hsv.x = fract(hsv.x + 0.5);
      inverted = hsv2rgb(hsv);
    } else if (mode == 3) {
      // Strobe invert — alternates between original and inverted at
      // uStrobeRate Hz. Phase = floor(time * rate) % 2.
      float phase = mod(floor(uTime * max(uStrobeRate, 0.01)), 2.0);
      inverted = mix(src, 1.0 - src, phase);
    } else {
      // Threshold-above — invert pixels brighter than uThreshold,
      // leave shadows untouched. Great for crushing highlights.
      float lum = dot(src, vec3(0.299, 0.587, 0.114));
      float invertMask = smoothstep(uThreshold - 0.02, uThreshold + 0.02, lum);
      inverted = mix(src, 1.0 - src, invertMask);
    }

    // Partial-invert: blend toward the inverted result by uAmount.
    vec3 finalColor = mix(src, inverted, uAmount);

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`,Ua=`
  uniform sampler2D uTexture;
  uniform float uType;        // 0=bayer, 1=blueNoise, 2=halftone, 3=atkinson, 4=floydSteinberg
  uniform float uIntensity;   // 0-1
  uniform float uScale;       // 1-16
  uniform float uColorDepth;  // 1-8 bits
  uniform float uPalette;     // 0=free, 1=mono, 2=CGA-4, 3=EGA-8, 4=GameBoy, 5=Amber-CRT
  uniform float uPixelLock;   // 0=continuous, 1=snap to integer pixel grid (no aliasing on resize)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Snap to nearest fixed palette color. uses simple Euclidean distance.
  vec3 snapPalette(vec3 c, int pal) {
    if (pal == 1) {
      // 1-bit mono — snap to black or white by luma.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return lum > 0.5 ? vec3(1.0) : vec3(0.0);
    }
    if (pal == 2) {
      // CGA mode 4 palette 1 — black, cyan, magenta, white.
      vec3 P[4]; P[0]=vec3(0.0); P[1]=vec3(0.0,1.0,1.0); P[2]=vec3(1.0,0.0,1.0); P[3]=vec3(1.0);
      vec3 best = P[0]; float bd = 1e9;
      for (int i = 0; i < 4; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }
      return best;
    }
    if (pal == 3) {
      // EGA 8-color (high-intensity).
      vec3 P[8];
      P[0]=vec3(0.0); P[1]=vec3(0.0,0.0,0.67); P[2]=vec3(0.0,0.67,0.0); P[3]=vec3(0.0,0.67,0.67);
      P[4]=vec3(0.67,0.0,0.0); P[5]=vec3(0.67,0.0,0.67); P[6]=vec3(0.67,0.33,0.0); P[7]=vec3(0.67);
      vec3 best = P[0]; float bd = 1e9;
      for (int i = 0; i < 8; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }
      return best;
    }
    if (pal == 4) {
      // Game Boy 4-shade green.
      vec3 P[4];
      P[0]=vec3(0.06,0.22,0.06); P[1]=vec3(0.19,0.38,0.19); P[2]=vec3(0.55,0.67,0.06); P[3]=vec3(0.61,0.74,0.06);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      int idx = int(clamp(floor(lum * 4.0), 0.0, 3.0));
      return P[idx];
    }
    if (pal == 5) {
      // Amber CRT — black, dim amber, mid amber, bright amber.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(0.0), vec3(1.0, 0.65, 0.0), smoothstep(0.0, 1.0, lum));
    }
    return c; // pal == 0 free
  }

  // High-quality Bayer 8x8 matrix with proper thresholds
  float bayer8(vec2 pos) {
    vec2 p = mod(pos, 8.0);
    float x = p.x;
    float y = p.y;

    // Recursive Bayer matrix calculation (much cleaner than lookup)
    float threshold = 0.0;
    float divisor = 64.0;

    // 8x8 Bayer using bit manipulation logic
    for (int i = 0; i < 3; i++) {
      float mx = mod(x, 2.0);
      float my = mod(y, 2.0);
      threshold += (mx + my * 2.0) * divisor / 4.0;
      divisor /= 4.0;
      x = floor(x / 2.0);
      y = floor(y / 2.0);
    }

    return threshold / 64.0;
  }

  // Blue noise approximation using layered randomness
  float blueNoise(vec2 pos) {
    float n = 0.0;
    float scale = 1.0;

    for (int i = 0; i < 4; i++) {
      vec2 p = pos * scale;
      float r = fract(sin(dot(floor(p), vec2(12.9898, 78.233) + float(i) * 100.0)) * 43758.5453);
      n += r / scale;
      scale *= 2.0;
    }

    return fract(n * 0.25 + uTime * 0.01);
  }

  // Premium halftone with angle and smooth dots
  float halftone(vec2 pos, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    mat2 rot = mat2(c, -s, s, c);
    vec2 p = rot * pos;

    vec2 nearest = floor(p) + 0.5;
    float dist = length(p - nearest);

    // Smooth dot with antialiasing
    return smoothstep(0.5, 0.3, dist);
  }

  // Atkinson-style dithering pattern (used by old Mac)
  float atkinsonPattern(vec2 pos) {
    vec2 p = mod(pos, 4.0);
    float pattern = 0.0;

    // Classic Atkinson-style sparse pattern
    if ((p.x < 2.0 && p.y < 2.0) || (p.x >= 2.0 && p.y >= 2.0)) {
      pattern = mod(p.x + p.y, 2.0);
    } else {
      pattern = 1.0 - mod(p.x + p.y, 2.0);
    }

    return pattern * 0.5 + bayer8(pos) * 0.5;
  }

  // Floyd-Steinberg style error propagation simulation
  float floydSteinberg(vec2 pos, vec3 color) {
    // Simulated error diffusion using neighbor sampling
    float lum = dot(color, vec3(0.299, 0.587, 0.114));

    // Sample neighbors to simulate error propagation
    vec2 offset1 = vec2(1.0, 0.0) / uResolution * uScale;
    vec2 offset2 = vec2(-1.0, 1.0) / uResolution * uScale;
    vec2 offset3 = vec2(0.0, 1.0) / uResolution * uScale;
    vec2 offset4 = vec2(1.0, 1.0) / uResolution * uScale;

    float n1 = dot(texture2D(uTexture, vUv + offset1).rgb, vec3(0.299, 0.587, 0.114));
    float n2 = dot(texture2D(uTexture, vUv + offset2).rgb, vec3(0.299, 0.587, 0.114));
    float n3 = dot(texture2D(uTexture, vUv + offset3).rgb, vec3(0.299, 0.587, 0.114));
    float n4 = dot(texture2D(uTexture, vUv + offset4).rgb, vec3(0.299, 0.587, 0.114));

    // Weighted average simulating error propagation
    float errorSim = (lum * 16.0 + n1 * 7.0 + n2 * 3.0 + n3 * 5.0 + n4 * 1.0) / 32.0;

    return fract(errorSim * 8.0 + bayer8(pos) * 0.5);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 color = texColor.rgb;

    // Calculate scaled pixel position. With pixel-lock, snap to integer
    // pixel coords so the pattern doesn't shimmer when the canvas resizes.
    vec2 pixelPos = vUv * uResolution / max(uScale, 0.5);
    if (uPixelLock > 0.5) pixelPos = floor(pixelPos);

    // Get threshold based on dither type - use float comparisons for WebGL compat
    float threshold = 0.0;

    if (uType < 0.5) {
      // Classic Bayer ordered dithering
      threshold = bayer8(pixelPos);
    } else if (uType < 1.5) {
      // Blue noise dithering (film-like grain)
      threshold = blueNoise(pixelPos);
    } else if (uType < 2.5) {
      // Halftone printing style
      float lumR = color.r;
      float lumG = color.g;
      float lumB = color.b;

      // CMYK-style halftone angles
      float hR = halftone(pixelPos, 0.261799);  // 15 degrees
      float hG = halftone(pixelPos, 1.309);     // 75 degrees
      float hB = halftone(pixelPos, 0.0);       // 0 degrees

      vec3 halftoneColor = vec3(
        step(1.0 - lumR, hR),
        step(1.0 - lumG, hG),
        step(1.0 - lumB, hB)
      );

      gl_FragColor = vec4(mix(color, halftoneColor, uIntensity), texColor.a);
      return;
    } else if (uType < 3.5) {
      // Atkinson dithering (classic Mac style)
      threshold = atkinsonPattern(pixelPos);
    } else {
      // Floyd-Steinberg simulation
      threshold = floydSteinberg(pixelPos, color);
    }

    // Apply threshold with intensity control
    threshold = (threshold - 0.5) * uIntensity;

    // Quantize to color depth, then optionally snap to a fixed palette.
    float levels = pow(2.0, uColorDepth);
    vec3 dithered = color + vec3(threshold) / levels;
    dithered = floor(dithered * levels + 0.5) / levels;
    int pal = int(uPalette + 0.5);
    if (pal > 0) dithered = snapPalette(dithered, pal);

    gl_FragColor = vec4(clamp(dithered, 0.0, 1.0), texColor.a);
  }
`,Pa=`
  uniform sampler2D uTexture;
  uniform float uTracking;
  uniform float uNoise;
  uniform float uDistortion;
  uniform float uColorBleed;
  uniform float uScanlines;
  uniform float uHeadSwitch;
  uniform float uTapeWobble;
  uniform float uDropout;
  uniform float uChromaDelay;
  uniform float uTrackingJump;
  uniform float uSaturation;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float hash11(float seed) { return fract(sin(seed * 12.9898) * 43758.5453123); }
  float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vUv;

    // Tracking jump (vertical roll w/ snap).
    float jumpTrigger = step(0.985, hash11(floor(uTime * 1.3))) * uTrackingJump;
    float jumpAmount = uTrackingJump * 0.08 * (sin(uTime * 0.7) * 0.5 + 0.5);
    uv.y = fract(uv.y + jumpAmount + jumpTrigger * 0.4);

    // Tape wobble (capstan jitter).
    float wobble = sin(uv.y * 4.0 + uTime * 1.5) * 0.6
                 + sin(uv.y * 11.0 + uTime * 0.7) * 0.4;
    uv.x += wobble * uTapeWobble * 0.012;

    // Tracking distortion (legacy).
    float trackingOffset = sin(uv.y * 10.0 + uTime * 3.0) * uTracking * 0.02;
    trackingOffset += step(0.99, random(vec2(uTime * 0.1, uv.y))) * uTracking * 0.1;
    uv.x += trackingOffset;

    // Wave distortion (legacy).
    uv.x += sin(uv.y * 50.0 + uTime * 10.0) * uDistortion * 0.003;
    uv.y += sin(uv.x * 30.0 + uTime * 8.0) * uDistortion * 0.002;

    // Head-switch tear band at bottom of frame.
    float headBand = smoothstep(0.06, 0.0, uv.y);
    float headTear = (random(vec2(floor(uv.y * 200.0), floor(uTime * 30.0))) - 0.5)
                   * headBand * uHeadSwitch * 0.06;
    uv.x += headTear;

    // Sample with chroma bleed + delay.
    float bleedAmount = uColorBleed * 0.005;
    float chromaLag = uChromaDelay * 0.012;
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + bleedAmount + chromaLag, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - bleedAmount - chromaLag, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    // Dropout bands.
    float dropoutSeed = floor(uv.y * uResolution.y * 0.5) + floor(uTime * 4.0);
    float dropoutHit = step(1.0 - uDropout * 0.04, hash11(dropoutSeed));
    if (dropoutHit > 0.5) {
      float dropoutKind = hash11(dropoutSeed + 7.3);
      if (dropoutKind > 0.5) color.rgb = mix(color.rgb, vec3(1.0), 0.85);
      else                    color.rgb = mix(color.rgb, vec3(0.0), 0.85);
    }

    // Luma noise.
    float n = noise(uv * uResolution * 0.5 + uTime * 100.0);
    color.rgb += (n - 0.5) * uNoise * 0.3;

    // Scanlines.
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    color.rgb *= 1.0 - uScanlines * 0.3 * scanline;

    // Saturation pull-back.
    vec3 luminance = vec3(0.299, 0.587, 0.114);
    float lum = dot(color.rgb, luminance);
    float satMix = clamp(1.0 - uSaturation, 0.0, 1.0);
    color.rgb = mix(color.rgb, vec3(lum), satMix * 0.6 + uTracking * 0.2);

    gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
  }
`,Fa=`
  uniform sampler2D uTexture;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uBlockSize;
  uniform float uRGBSplit;
  uniform float uJitter;
  uniform float uTriggerMode;
  uniform float uBlockHold;
  uniform float uVerticalSlice;
  uniform float uFreezeBurst;
  uniform float uTearChance;
  uniform float uAudio;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float random(float seed) { return fract(sin(seed * 12.9898) * 43758.5453); }
  float random2(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    float t = uTime * max(uSpeed, 0.01);

    float glitchTrigger = 0.0;
    int mode = int(uTriggerMode + 0.5);
    if (mode == 1) {
      glitchTrigger = clamp(uAudio * 1.6, 0.0, 1.0) * uIntensity;
    } else if (mode == 2) {
      float beatPhase = floor(uTime * 8.0);
      float beatHit = step(0.4, uAudio) * step(0.7, random(beatPhase));
      glitchTrigger = beatHit * uIntensity;
    } else {
      glitchTrigger = step(0.95, random(floor(t * 10.0))) * uIntensity;
    }

    float blockHeight = max(uBlockSize * 0.1, 0.01);
    float block = floor(uv.y / blockHeight);
    float blockTime = floor(t * mix(20.0, 1.0, uBlockHold));
    float blockRandom = random(block + blockTime);
    if (blockRandom > 1.0 - uIntensity * 0.3 && glitchTrigger > 0.0) {
      uv.x += (random(block + t) - 0.5) * uIntensity * 0.2;
    }

    float colSeed = floor(uv.x * uResolution.x / 12.0);
    float colHit = step(1.0 - uVerticalSlice * 0.2, random(colSeed + floor(t * 7.0)));
    if (colHit > 0.5 && glitchTrigger > 0.0) {
      uv.y += (random(colSeed + 13.7) - 0.5) * uVerticalSlice * 0.18;
      uv.y = fract(uv.y);
    }

    float lineJitter = (random2(vec2(floor(uv.y * uResolution.y), floor(t * 20.0))) - 0.5);
    uv.x += lineJitter * uJitter * 0.01 * glitchTrigger;

    float rgbAmount = uRGBSplit * 0.02 * (1.0 + glitchTrigger * 3.0);
    float tearBand = step(1.0 - uTearChance * 0.3, random(floor(uv.y * 50.0) + floor(t * 6.0)));
    if (tearBand > 0.5 && glitchTrigger > 0.0) rgbAmount *= 6.0;
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + rgbAmount, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - rgbAmount, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    float freezeHit = step(1.0 - uFreezeBurst * 0.25, random(floor(t * 3.0))) * glitchTrigger;
    if (freezeHit > 0.5) {
      vec2 punchUv = vec2(fract(vUv.x + 0.37 + 0.13 * random(block)),
                          fract(vUv.y + 0.21 + 0.17 * random(block + 4.0)));
      vec4 punch = texture2D(uTexture, punchUv);
      color.rgb = mix(color.rgb, punch.rgb, 0.7);
    }

    if (random(floor(t * 15.0) + block) > 0.98 && glitchTrigger > 0.0) {
      color.rgb = 1.0 - color.rgb;
    }

    gl_FragColor = color;
  }
`,Ga=`
  uniform sampler2D uTexture;
  uniform float uAmount;     // 0-50 pixels
  uniform float uAngle;      // 0-360 degrees (for directional mode)
  uniform float uMode;       // 0=directional, 1=radial, 2=prism, 3=luma-dep, 4=edge-only
  uniform float uCenterX;    // 0-1 — center for radial/prism
  uniform float uCenterY;
  uniform float uPrismSpread;// 0-2 — extra hue spread in prism mode
  uniform vec2 uResolution;
  varying vec2 vUv;

  float lumaRGB(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    int mode = int(uMode + 0.5);
    vec4 base = texture2D(uTexture, vUv);

    // Per-pixel shift direction & magnitude.
    vec2 dir = vec2(0.0);
    float amt = uAmount;

    if (mode == 0) {
      // Directional (legacy).
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
    } else if (mode == 1 || mode == 2) {
      // Radial / prism — direction = away from center, magnitude scales
      // with distance from center (lens-fringe behavior).
      vec2 center = vec2(uCenterX, uCenterY);
      vec2 d = vUv - center;
      float dist = length(d);
      dir = (dist > 1e-5) ? d / dist : vec2(1.0, 0.0);
      amt *= dist * 2.0;
    } else if (mode == 3) {
      // Luma-dependent — only shift on bright pixels (mimics lens flare).
      float lum = lumaRGB(base.rgb);
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
      amt *= smoothstep(0.4, 0.95, lum);
    } else {
      // Edge-only — shift only where image gradients are high.
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
      vec2 t = 2.0 / uResolution;
      float gx = lumaRGB(texture2D(uTexture, vUv + vec2(t.x, 0.0)).rgb)
               - lumaRGB(texture2D(uTexture, vUv - vec2(t.x, 0.0)).rgb);
      float gy = lumaRGB(texture2D(uTexture, vUv + vec2(0.0, t.y)).rgb)
               - lumaRGB(texture2D(uTexture, vUv - vec2(0.0, t.y)).rgb);
      float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
      amt *= edge;
    }

    vec2 shift = dir * amt / uResolution;

    vec4 color;
    if (mode == 2) {
      // Prism: spread R/G/B across a wider arc, shifted toward rainbow
      // dispersion. uPrismSpread bumps the per-channel offset asymmetry.
      float k = 1.0 + uPrismSpread;
      color.r = texture2D(uTexture, vUv + shift * (1.0 + 0.4 * k)).r;
      color.g = texture2D(uTexture, vUv + shift * 0.0).g;
      color.b = texture2D(uTexture, vUv - shift * (1.0 + 0.4 * k)).b;
    } else {
      color.r = texture2D(uTexture, vUv + shift).r;
      color.g = texture2D(uTexture, vUv).g;
      color.b = texture2D(uTexture, vUv - shift).b;
    }
    color.a = base.a;

    gl_FragColor = color;
  }
`,za=`
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-1 scanline darkening strength
  uniform float uCount;       // 50-500 scanline count
  uniform float uSpeed;       // 0-2 scanline scroll speed
  uniform float uPhosphor;    // 0-1 RGB sub-pixel mask intensity
  uniform float uRollingBar;  // 0-1 brightness bar that rolls down the screen
  uniform float uCurvature;   // 0-1 barrel distortion (CRT bulge)
  uniform float uInterlace;   // 0-1 interlace flicker (alternating odd/even rows)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // CRT barrel curvature — push UVs outward proportional to distance²
    // from center. Sample is clamped so we don't read off-texture.
    if (uCurvature > 0.001) {
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);
      uv = centered * (1.0 + r2 * uCurvature * 0.4) + 0.5;
      // Black mask outside the curved tube.
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uTexture, vUv).a);
        return;
      }
    }

    vec4 texColor = texture2D(uTexture, uv);

    // Scanline darkening (legacy).
    float scanlinePos = uv.y * uCount + uTime * uSpeed * 50.0;
    float scanline = sin(scanlinePos * 3.14159) * 0.5 + 0.5;
    float darkness = 1.0 - uIntensity * scanline * 0.5;

    vec3 col = texColor.rgb * darkness;

    // Phosphor RGB sub-pixel mask — divides each row of pixels into RGB
    // triads, brightening each color channel only on its sub-cell.
    if (uPhosphor > 0.001) {
      float subpixel = mod(floor(uv.x * uResolution.x), 3.0);
      vec3 mask = vec3(
        subpixel < 0.5 ? 1.0 : 0.4,
        (subpixel >= 0.5 && subpixel < 1.5) ? 1.0 : 0.4,
        subpixel >= 1.5 ? 1.0 : 0.4
      );
      col *= mix(vec3(1.0), mask, uPhosphor);
    }

    // Rolling brightness bar — slow horizontal band that scrolls down.
    if (uRollingBar > 0.001) {
      float barPos = fract(uv.y - uTime * 0.15);
      float bar = smoothstep(0.0, 0.05, barPos) * smoothstep(0.15, 0.10, barPos);
      col *= 1.0 + bar * uRollingBar * 0.4;
    }

    // Interlace flicker — alternate-row brightness flicker at refresh rate.
    if (uInterlace > 0.001) {
      float row = floor(uv.y * uResolution.y);
      float frame = floor(uTime * 30.0);
      float flicker = mod(row + frame, 2.0);
      col *= mix(1.0, mix(0.85, 1.15, flicker), uInterlace);
    }

    gl_FragColor = vec4(col, texColor.a);
  }
`,La=`
  uniform sampler2D uTexture;
  uniform float uSize;        // 1-64 pixel size
  uniform float uMode;        // 0=nearest, 1=luma mosaic, 2=hex, 3=circle/LED
  uniform float uGridLines;   // 0-1 dark grout lines between pixels (LED panel look)
  uniform float uAnimSpeed;   // 0-2 size pulse speed (0 = static)
  uniform float uAnimAmount;  // 0-1 size pulse amplitude
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);

    // Animated size — sin oscillation around uSize.
    float sz = uSize;
    if (uAnimSpeed > 0.001) {
      float w = sin(uTime * uAnimSpeed * 3.14159) * 0.5 + 0.5;
      sz = uSize * mix(1.0 - uAnimAmount * 0.5, 1.0 + uAnimAmount * 1.0, w);
    }
    sz = max(sz, 1.0);

    vec2 pixelSize = sz / uResolution;
    vec2 cellId = floor(vUv / pixelSize);
    vec2 cellUv = (cellId + 0.5) * pixelSize;
    vec2 cellLocal = (vUv - cellId * pixelSize) / pixelSize; // 0..1 inside cell

    vec4 sample0 = texture2D(uTexture, cellUv);

    if (mode == 1) {
      // Luma mosaic — each cell is rendered as a flat luma-step value
      // (3 steps per channel) so the image becomes a chunky comic look.
      vec3 q = floor(sample0.rgb * 4.0) / 3.0;
      gl_FragColor = vec4(q, sample0.a);
      return;
    }

    if (mode == 2) {
      // Hex — only pixels inside a hexagonal cell pass through;
      // approximate by clamping to a hex distance.
      vec2 d = cellLocal - 0.5;
      float hex = max(abs(d.x), max(abs(d.y), abs(d.x) * 0.5 + abs(d.y) * 0.866));
      if (hex > 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, sample0.a * 0.4);
        return;
      }
    }

    if (mode == 3) {
      // Circle / LED — pixels are circles with brightness = sampled luma.
      vec2 d = cellLocal - 0.5;
      float dist = length(d);
      float disc = smoothstep(0.5, 0.45, dist);
      gl_FragColor = vec4(sample0.rgb * disc, sample0.a);
      return;
    }

    // Grid lines (LED grout). Darken the cell edge.
    if (uGridLines > 0.001) {
      vec2 edge = abs(cellLocal - 0.5);
      float onEdge = step(0.46, max(edge.x, edge.y));
      sample0.rgb *= mix(1.0, 0.0, onEdge * uGridLines);
    }

    gl_FragColor = sample0;
  }
`,Ha=`
  uniform sampler2D uTexture;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uComplexity;
  uniform float uPalette;
  uniform float uMode;
  uniform float uBlendMode;
  uniform float uMix;
  uniform float uWarpAmount;
  uniform float uAudioReact;
  uniform float uAudio;
  uniform float uTime;
  varying vec2 vUv;

  vec3 rainbowPalette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
  vec3 firePalette(float t) { return vec3(smoothstep(0.0, 0.5, t), smoothstep(0.3, 0.7, t) * 0.7, smoothstep(0.7, 1.0, t) * 0.3); }
  vec3 oceanPalette(float t) { return vec3(smoothstep(0.5, 1.0, t) * 0.3, smoothstep(0.2, 0.8, t) * 0.6 + 0.2, 0.4 + 0.6 * t); }
  vec3 neonPalette(float t) {
    float r = sin(t * 6.28318) * 0.5 + 0.5;
    float g = sin(t * 6.28318 + 2.094) * 0.5 + 0.5;
    float b = sin(t * 6.28318 + 4.188) * 0.5 + 0.5;
    return pow(vec3(r, g, b), vec3(0.5));
  }
  vec3 matrixPalette(float t) { return vec3(0.0, t * 0.8 + 0.2, t * 0.3); }
  vec3 lavaPalette(float t) { return vec3(smoothstep(0.0, 0.4, t) * 1.0, smoothstep(0.3, 0.85, t) * 0.6, smoothstep(0.85, 1.0, t) * 0.4); }
  vec3 icePalette(float t) { return vec3(0.4 * t + smoothstep(0.7, 1.0, t) * 0.6, 0.2 + 0.6 * t, 0.5 + 0.5 * t); }
  vec3 stormPalette(float t) {
    vec3 dark = vec3(0.08, 0.08, 0.12);
    vec3 mid  = vec3(0.45, 0.35, 0.55);
    vec3 hi   = vec3(0.95, 0.95, 1.00);
    return mix(mix(dark, mid, smoothstep(0.0, 0.6, t)), hi, smoothstep(0.7, 1.0, t));
  }

  float plasmaField(vec2 p, float t, float complexity) {
    float plasma = 0.0;
    plasma += sin(p.x * 10.0 + t);
    plasma += sin(p.y * 10.0 + t * 1.1);
    plasma += sin((p.x + p.y) * 10.0 + t * 0.5);
    plasma += sin(sqrt(p.x * p.x + p.y * p.y) * 10.0 + t * 0.7);
    if (complexity > 1.0) plasma += sin(p.x * 5.0 + sin(p.y * 3.0 + t) * 2.0);
    if (complexity > 2.0) plasma += sin(p.y * 7.0 + sin(p.x * 5.0 + t * 1.3) * 2.0);
    if (complexity > 3.0) plasma += sin(length(p - vec2(0.5 * uScale)) * 8.0 - t * 2.0);
    if (complexity > 4.0) plasma += sin(atan(p.y - 0.5 * uScale, p.x - 0.5 * uScale) * 5.0 + t);
    return plasma / (4.0 + max(complexity - 1.0, 0.0)) * 0.5 + 0.5;
  }

  vec3 paletteLookup(int paletteType, float t) {
    if (paletteType == 0) return rainbowPalette(t);
    if (paletteType == 1) return firePalette(t);
    if (paletteType == 2) return oceanPalette(t);
    if (paletteType == 3) return neonPalette(t);
    if (paletteType == 4) return matrixPalette(t);
    if (paletteType == 5) return lavaPalette(t);
    if (paletteType == 6) return icePalette(t);
    return stormPalette(t);
  }

  vec3 applyBlend(vec3 base, vec3 plasmaCol, int mode) {
    if (mode == 0) return base * plasmaCol;
    if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - plasmaCol);
    if (mode == 2) return min(base + plasmaCol, vec3(1.0));
    if (mode == 3) {
      vec3 lo = 2.0 * base * plasmaCol;
      vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - plasmaCol);
      return mix(lo, hi, step(0.5, base));
    }
    return plasmaCol;
  }

  void main() {
    float audioPunch = clamp(uAudio, 0.0, 1.5) * uAudioReact;
    float effectiveScale = uScale * (1.0 + audioPunch * 0.6);
    float t = uTime * uSpeed;
    vec2 p = vUv * effectiveScale;
    int mode = int(uMode + 0.5);

    vec2 sampleUv = vUv;
    if (mode == 1 || mode == 2) {
      vec2 warpField = vec2(
        plasmaField(p * 0.5 + vec2(0.0, 1.7), t * 0.7, max(uComplexity, 2.0)),
        plasmaField(p * 0.5 + vec2(3.1, 0.0), t * 0.9, max(uComplexity, 2.0))
      ) - 0.5;
      sampleUv += warpField * uWarpAmount * 0.18;
    }
    vec4 texColor = texture2D(uTexture, sampleUv);

    if (mode == 1) {
      vec3 finalRgb = mix(texture2D(uTexture, vUv).rgb, texColor.rgb, uMix);
      gl_FragColor = vec4(finalRgb, texColor.a);
      return;
    }

    float plasma = plasmaField(p, t, uComplexity);
    int paletteType = int(uPalette);
    vec3 plasmaColor = paletteLookup(paletteType, plasma);
    int blendMode = int(uBlendMode + 0.5);
    vec3 blended = applyBlend(texColor.rgb, plasmaColor, blendMode);
    vec3 finalColor = mix(texColor.rgb, blended, uMix);
    gl_FragColor = vec4(finalColor, texColor.a);
  }
`,Ia=`
  uniform sampler2D uTexture;
  uniform float uLevels;        // 2-32 color levels per channel
  uniform float uDitherAmount;  // 0-1 — Bayer 4×4 ordered dither strength
  uniform float uAnimSpeed;     // 0-2 — animated level stepping speed (0 = static)
  uniform float uPaletteLock;   // 0=free RGB, 1=comic, 2=thermal, 3=retro 4-color
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Bayer 4×4 dither matrix in [0..1] range (after /16).
  float bayer4(vec2 pos) {
    int x = int(mod(pos.x, 4.0));
    int y = int(mod(pos.y, 4.0));
    int idx = x + y * 4;
    // Unrolled Bayer 4x4 (standard ordering scaled by 1/16).
    float m =
      idx == 0  ?  0.0 :
      idx == 1  ?  8.0 :
      idx == 2  ?  2.0 :
      idx == 3  ? 10.0 :
      idx == 4  ? 12.0 :
      idx == 5  ?  4.0 :
      idx == 6  ? 14.0 :
      idx == 7  ?  6.0 :
      idx == 8  ?  3.0 :
      idx == 9  ? 11.0 :
      idx == 10 ?  1.0 :
      idx == 11 ?  9.0 :
      idx == 12 ? 15.0 :
      idx == 13 ?  7.0 :
      idx == 14 ? 13.0 : 5.0;
    return (m + 0.5) / 16.0 - 0.5;
  }

  // Snap an RGB color to the nearest entry in a fixed palette.
  vec3 snapToPalette(vec3 c, int palette) {
    if (palette == 1) {
      // Comic: 6 bold flat colors — black, red, yellow, green, blue, white.
      vec3 palC[6];
      palC[0] = vec3(0.05, 0.05, 0.05);
      palC[1] = vec3(0.85, 0.10, 0.15);
      palC[2] = vec3(0.95, 0.85, 0.10);
      palC[3] = vec3(0.20, 0.65, 0.30);
      palC[4] = vec3(0.10, 0.30, 0.85);
      palC[5] = vec3(0.96, 0.96, 0.96);
      vec3 best = palC[0];
      float bestD = 1e9;
      for (int i = 0; i < 6; i++) {
        float d = dot(c - palC[i], c - palC[i]);
        if (d < bestD) { bestD = d; best = palC[i]; }
      }
      return best;
    } else if (palette == 2) {
      // Thermal: 5-stop heatmap — black, blue, magenta, orange, white.
      vec3 palT[5];
      palT[0] = vec3(0.0, 0.0, 0.05);
      palT[1] = vec3(0.05, 0.10, 0.55);
      palT[2] = vec3(0.65, 0.15, 0.55);
      palT[3] = vec3(0.95, 0.45, 0.10);
      palT[4] = vec3(0.98, 0.96, 0.85);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float idx = clamp(lum * 4.0, 0.0, 4.0);
      int i0 = int(floor(idx));
      int i1 = min(i0 + 1, 4);
      return mix(palT[i0], palT[i1], fract(idx));
    } else {
      // Retro 4-color (Game Boy / classic LCD): dark green, mid green, light green, cream.
      vec3 palR[4];
      palR[0] = vec3(0.10, 0.20, 0.10);
      palR[1] = vec3(0.30, 0.45, 0.25);
      palR[2] = vec3(0.55, 0.70, 0.40);
      palR[3] = vec3(0.85, 0.92, 0.70);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float idx = clamp(lum * 3.0, 0.0, 3.0);
      int i0 = int(floor(idx));
      int i1 = min(i0 + 1, 3);
      return mix(palR[i0], palR[i1], fract(idx));
    }
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Animated stepping — levels oscillates between half and full
    // when uAnimSpeed > 0. Creates a pulsing posterize.
    float animLevels = uLevels;
    if (uAnimSpeed > 0.001) {
      float t = sin(uTime * uAnimSpeed * 3.14159) * 0.5 + 0.5;
      animLevels = mix(2.0, uLevels, t);
    }
    float levels = max(2.0, floor(animLevels));

    // Apply Bayer dither BEFORE quantization to break up banding.
    vec3 src = texColor.rgb;
    if (uDitherAmount > 0.001) {
      vec2 pxPos = vUv * uResolution;
      float d = bayer4(pxPos);
      src = clamp(src + d * uDitherAmount / levels, 0.0, 1.0);
    }

    vec3 posterized;
    int paletteMode = int(uPaletteLock + 0.5);
    if (paletteMode == 0) {
      // Free RGB quantization (legacy behavior).
      posterized = floor(src * levels) / (levels - 1.0);
    } else {
      // Snap to a fixed palette — uLevels controls smoothness of the
      // luma→palette interpolation indirectly through the dither.
      posterized = snapToPalette(src, paletteMode);
    }

    gl_FragColor = vec4(posterized, texColor.a);
  }
`,Ea=`
  uniform sampler2D uTexture;
  uniform float uThreshold;   // 0-1 edge threshold
  uniform float uThickness;   // 0.5-3 line thickness
  uniform float uMode;        // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen, 4=color-edge
  uniform float uInvert;      // 0=normal, 1=inverted
  uniform float uEdgeR;       // 0-1 edge tint R (when uTintEdges > 0)
  uniform float uEdgeG;
  uniform float uEdgeB;
  uniform float uTintEdges;   // 0-1 — 0=white edges (legacy), 1=full tint color
  uniform float uGlow;        // 0-1 — bloom-style glow around edges
  uniform float uEdgeOnly;    // 0=show image+edges, 1=transparent fill (edges-only alpha)
  uniform vec2 uResolution;
  varying vec2 vUv;

  float edgeLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = uThickness / uResolution;

    // Sample 3x3 neighborhood
    float tl = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, texel.y)).rgb);
    float tc = edgeLum(texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb);
    float tr = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, texel.y)).rgb);
    float ml = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, 0.0)).rgb);
    float mc = edgeLum(texture2D(uTexture, vUv).rgb);
    float mr = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb);
    float bl = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, -texel.y)).rgb);
    float bc = edgeLum(texture2D(uTexture, vUv + vec2(0.0, -texel.y)).rgb);
    float br = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, -texel.y)).rgb);

    float edge = 0.0;

    // Use float comparisons for WebGL compatibility
    if (uMode < 0.5) {
      // Sobel operator
      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
      float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
      edge = sqrt(gx*gx + gy*gy);
    } else if (uMode < 1.5) {
      // Laplacian operator
      edge = abs(-4.0*mc + tc + ml + mr + bc);
    } else if (uMode < 2.5) {
      // Prewitt operator
      float gx = -tl - ml - bl + tr + mr + br;
      float gy = -tl - tc - tr + bl + bc + br;
      edge = sqrt(gx*gx + gy*gy);
    } else {
      // Frei-Chen operator (more isotropic)
      float sq2 = 1.41421;
      float gx = -tl - sq2*ml - bl + tr + sq2*mr + br;
      float gy = -tl - sq2*tc - tr + bl + sq2*bc + br;
      edge = sqrt(gx*gx + gy*gy) / (2.0 + sq2);
    }

    // Color-edge mode (uMode=4) — compute Sobel per channel and combine.
    if (uMode > 3.5) {
      vec3 cTL = texture2D(uTexture, vUv + vec2(-texel.x, texel.y)).rgb;
      vec3 cTR = texture2D(uTexture, vUv + vec2(texel.x, texel.y)).rgb;
      vec3 cBL = texture2D(uTexture, vUv + vec2(-texel.x, -texel.y)).rgb;
      vec3 cBR = texture2D(uTexture, vUv + vec2(texel.x, -texel.y)).rgb;
      vec3 cML = texture2D(uTexture, vUv + vec2(-texel.x, 0.0)).rgb;
      vec3 cMR = texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 cTC = texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb;
      vec3 cBC = texture2D(uTexture, vUv + vec2(0.0, -texel.y)).rgb;
      vec3 gxV = -cTL - 2.0*cML - cBL + cTR + 2.0*cMR + cBR;
      vec3 gyV = -cTL - 2.0*cTC - cTR + cBL + 2.0*cBC + cBR;
      vec3 edgeRGB = sqrt(gxV*gxV + gyV*gyV);
      // Per-channel threshold + invert.
      edgeRGB = smoothstep(vec3(uThreshold * 0.3), vec3(uThreshold * 0.8 + 0.02), edgeRGB);
      if (uInvert > 0.5) edgeRGB = 1.0 - edgeRGB;
      vec4 texColor = texture2D(uTexture, vUv);
      vec3 finalCol = edgeRGB;
      float a = uEdgeOnly > 0.5 ? max(max(edgeRGB.r, edgeRGB.g), edgeRGB.b) : texColor.a;
      gl_FragColor = vec4(finalCol, a);
      return;
    }

    edge = smoothstep(uThreshold * 0.3, uThreshold * 0.8 + 0.02, edge);
    if (uInvert > 0.5) edge = 1.0 - edge;

    // Tint edges from white to user color. uTintEdges=0 keeps legacy
    // monochrome white edges; =1 fully replaces with the tint color.
    vec3 tint = mix(vec3(1.0), vec3(uEdgeR, uEdgeG, uEdgeB), uTintEdges);
    vec3 edgeColor = tint * edge;

    // Glow — sample a wider neighborhood and add a bloom around edges.
    if (uGlow > 0.001) {
      float glowSum = 0.0;
      for (int gi = -2; gi <= 2; gi++) {
        for (int gj = -2; gj <= 2; gj++) {
          vec2 off = vec2(float(gi), float(gj)) / uResolution * (2.0 + uGlow * 4.0);
          float l = edgeLum(texture2D(uTexture, vUv + off).rgb);
          glowSum += l;
        }
      }
      glowSum = (glowSum / 25.0) * uGlow * 0.6;
      edgeColor += tint * glowSum;
    }

    vec4 texColor = texture2D(uTexture, vUv);
    if (uEdgeOnly > 0.5) {
      // Transparent body, edges only — alpha proportional to edge strength.
      gl_FragColor = vec4(edgeColor, edge);
    } else {
      gl_FragColor = vec4(edgeColor, texColor.a);
    }
  }
`,Oa=`
  uniform sampler2D uTexture;
  uniform float uThickness;   // 1-10 outline thickness
  uniform vec3 uColor;        // Outline color
  uniform float uOnly;        // 0=overlay, 1=outline only
  uniform float uGlow;        // 0-1 glow amount
  uniform float uPosition;    // 0=outer, 1=inner, 2=both (centered on edge)
  uniform float uCrawl;       // 0-1 — animated marching-ants crawl speed
  uniform float uGlowFalloff; // 0.5-3 — falloff power (lower=tighter, higher=softer)
  uniform float uAlphaAware;  // 0-1 — use source alpha as the boundary instead of luma
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float outlineLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec2 texel = uThickness / uResolution;
    // Boundary metric: luma by default, alpha when alpha-aware.
    float centerVal = mix(outlineLum(texColor.rgb), texColor.a, uAlphaAware);

    float edge = 0.0;
    float insideSum = 0.0;
    float outsideSum = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        if (i == 0 && j == 0) continue;
        vec2 off = vec2(float(i), float(j)) * texel;
        vec4 nb4 = texture2D(uTexture, vUv + off);
        float nb = mix(outlineLum(nb4.rgb), nb4.a, uAlphaAware);
        edge += abs(nb - centerVal);
        // Inner = current pixel is brighter than neighbor, outer = darker.
        if (nb < centerVal) insideSum += (centerVal - nb);
        else                outsideSum += (nb - centerVal);
      }
    }
    edge = edge / 8.0;
    edge = smoothstep(0.05, 0.15, edge);

    // Inner / outer / both selection.
    int posMode = int(uPosition + 0.5);
    if (posMode == 0)      edge = edge * smoothstep(0.0, 0.1, outsideSum / 8.0); // outer
    else if (posMode == 1) edge = edge * smoothstep(0.0, 0.1, insideSum / 8.0);  // inner
    // posMode == 2 keeps both (no extra mask).

    // Animated crawling outline — modulate edge intensity with a moving
    // sine pattern along the gradient direction (marching ants style).
    if (uCrawl > 0.001) {
      float crawl = sin((vUv.x + vUv.y) * 80.0 - uTime * uCrawl * 6.0);
      edge *= 0.5 + 0.5 * crawl;
    }

    // Glow with adjustable falloff power.
    if (uGlow > 0.0) {
      float glowEdge = 0.0;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 off = vec2(float(i), float(j)) * texel * 2.0;
          vec4 nb4 = texture2D(uTexture, vUv + off);
          float nb = mix(outlineLum(nb4.rgb), nb4.a, uAlphaAware);
          glowEdge += abs(nb - centerVal);
        }
      }
      glowEdge = glowEdge / 24.0;
      glowEdge = pow(smoothstep(0.02, 0.1, glowEdge), uGlowFalloff);
      edge = max(edge, glowEdge * uGlow * 0.7);
    }

    vec3 outColor = uColor * edge;
    vec3 finalColor;
    if (uOnly > 0.5) finalColor = outColor;
    else             finalColor = texColor.rgb + outColor;

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`,_a=`
  uniform sampler2D uTexture;
  uniform float uStrength;        // 0-2 emboss strength
  uniform float uAngle;           // 0-360 light direction
  uniform float uHeight;          // 0-1 surface height exaggeration
  uniform float uHighlightR;      // 0-1 highlight tint
  uniform float uHighlightG;
  uniform float uHighlightB;
  uniform float uShadowR;         // 0-1 shadow tint
  uniform float uShadowG;
  uniform float uShadowB;
  uniform float uNormalMode;      // 0=emboss (relit), 1=normal-map preview
  uniform float uMetallicness;    // 0-1 boosts highlight reflectivity
  uniform vec2 uResolution;
  varying vec2 vUv;

  float embossLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float angle = uAngle * 3.14159265 / 180.0;
    vec2 dir = vec2(cos(angle), sin(angle));

    // Build a surface normal from luma gradients in 4 directions.
    float lL = embossLum(texture2D(uTexture, vUv - vec2(texel.x, 0.0)).rgb);
    float lR = embossLum(texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb);
    float lD = embossLum(texture2D(uTexture, vUv - vec2(0.0, texel.y)).rgb);
    float lU = embossLum(texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb);
    float dx = (lR - lL) * (1.0 + uHeight * 4.0);
    float dy = (lU - lD) * (1.0 + uHeight * 4.0);
    vec3 normal = normalize(vec3(-dx, -dy, 1.0));

    // Normal-map preview — encode normal as RGB.
    if (uNormalMode > 0.5) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, texture2D(uTexture, vUv).a);
      return;
    }

    // Light direction in 3D from uAngle (azimuth) and a fixed elevation.
    vec3 light = normalize(vec3(dir.x, dir.y, 0.5));
    float diff = max(dot(normal, light), 0.0);
    float spec = pow(diff, mix(8.0, 64.0, uMetallicness)) * uMetallicness;

    // Emboss intensity from gradient along light direction.
    float along = (lR - lL) * dir.x + (lU - lD) * dir.y;
    float emboss = clamp(along * uStrength + 0.5, 0.0, 1.0);

    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hi = vec3(uHighlightR, uHighlightG, uHighlightB);
    vec3 lo = vec3(uShadowR, uShadowG, uShadowB);
    vec3 lit = mix(lo, hi, emboss);

    // Blend the lit surface with the source color so detail isn't lost.
    vec3 finalCol = texColor.rgb * 0.5 + lit + vec3(spec);

    gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), texColor.a);
  }
`,Va=`
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-2 contrast / temperature curve sharpness
  uniform float uPalette;     // 0=classic, 1=ironbow, 2=arctic, 3=predator, 4=medical
  uniform float uShimmer;     // 0-1 — heat-haze shimmer on hot pixels
  uniform float uSensorNoise; // 0-1 — animated rolling sensor banding noise
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float thHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 classicThermal(float t) {
    // Blue (cold) -> Cyan -> Green -> Yellow -> Red -> White (hot)
    vec3 color;
    if (t < 0.2) {
      color = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 1.0), t * 5.0);
    } else if (t < 0.4) {
      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.2) * 5.0);
    } else if (t < 0.6) {
      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.4) * 5.0);
    } else if (t < 0.8) {
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.6) * 5.0);
    } else {
      color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.8) * 5.0);
    }
    return color;
  }

  vec3 ironbowPalette(float t) {
    // Black -> Purple -> Blue -> Cyan -> Green -> Yellow -> Orange -> Red -> White
    vec3 color;
    if (t < 0.14) {
      color = mix(vec3(0.0), vec3(0.3, 0.0, 0.5), t * 7.14);
    } else if (t < 0.28) {
      color = mix(vec3(0.3, 0.0, 0.5), vec3(0.0, 0.0, 1.0), (t - 0.14) * 7.14);
    } else if (t < 0.42) {
      color = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), (t - 0.28) * 7.14);
    } else if (t < 0.57) {
      color = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.42) * 6.67);
    } else if (t < 0.71) {
      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.57) * 7.14);
    } else if (t < 0.85) {
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.71) * 7.14);
    } else {
      color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.85) * 6.67);
    }
    return color;
  }

  vec3 arcticPalette(float t) {
    // White (cold) -> Cyan -> Blue -> Purple -> Magenta (hot)
    vec3 color;
    if (t < 0.25) {
      color = mix(vec3(1.0, 1.0, 1.0), vec3(0.5, 1.0, 1.0), t * 4.0);
    } else if (t < 0.5) {
      color = mix(vec3(0.5, 1.0, 1.0), vec3(0.0, 0.5, 1.0), (t - 0.25) * 4.0);
    } else if (t < 0.75) {
      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.5, 0.0, 1.0), (t - 0.5) * 4.0);
    } else {
      color = mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.0, 0.5), (t - 0.75) * 4.0);
    }
    return color;
  }

  // Predator palette — high-contrast green/yellow/red threat-detection look.
  vec3 predatorPalette(float t) {
    if (t < 0.3)      return mix(vec3(0.0, 0.05, 0.0), vec3(0.0, 0.6, 0.1), t / 0.3);
    else if (t < 0.6) return mix(vec3(0.0, 0.6, 0.1), vec3(0.95, 0.85, 0.0), (t - 0.3) / 0.3);
    else if (t < 0.85)return mix(vec3(0.95, 0.85, 0.0), vec3(0.95, 0.25, 0.05), (t - 0.6) / 0.25);
    else              return mix(vec3(0.95, 0.25, 0.05), vec3(1.0, 0.0, 0.6), (t - 0.85) / 0.15);
  }
  // Medical palette — clean black-to-white IR for diagnostic look.
  vec3 medicalPalette(float t) {
    return vec3(t);
  }

  void main() {
    vec2 uv = vUv;

    // Heat shimmer — hot pixels (sampled separately) drive a tiny UV
    // wobble so the image distorts where it's hot.
    if (uShimmer > 0.001) {
      vec3 sample0 = texture2D(uTexture, uv).rgb;
      float lum0 = dot(sample0, vec3(0.299, 0.587, 0.114));
      float wobble = sin(uv.y * 60.0 + uTime * 4.0) * 0.5 + sin(uv.x * 35.0 + uTime * 3.0) * 0.5;
      uv.x += wobble * uShimmer * lum0 * 0.006;
      uv.y += wobble * uShimmer * lum0 * 0.003;
    }

    vec4 texColor = texture2D(uTexture, uv);

    float temp = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    temp = pow(temp, 1.0 / max(uIntensity, 0.05));

    // Sensor noise — banded horizontal rolling noise like a cheap IR sensor.
    if (uSensorNoise > 0.001) {
      float band = thHash(vec2(floor(vUv.y * uResolution.y * 0.5), floor(uTime * 8.0)));
      temp += (band - 0.5) * uSensorNoise * 0.18;
      temp = clamp(temp, 0.0, 1.0);
    }

    vec3 thermalColor;
    int paletteType = int(uPalette);
    if (paletteType == 0)      thermalColor = classicThermal(temp);
    else if (paletteType == 1) thermalColor = ironbowPalette(temp);
    else if (paletteType == 2) thermalColor = arcticPalette(temp);
    else if (paletteType == 3) thermalColor = predatorPalette(temp);
    else                       thermalColor = medicalPalette(temp);

    gl_FragColor = vec4(thermalColor, texColor.a);
  }
`,Wa=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2 brightness boost
  uniform float uNoise;         // 0-1 grain amount
  uniform float uVignette;      // 0-1 circular vignette intensity
  // Hero-rewrite params
  uniform float uPhosphor;      // 0=green, 1=amber, 2=white phosphor
  uniform float uBloom;         // 0-2 phosphor bloom strength
  uniform float uScopeMask;     // 0=off, 1=circle (legacy), 2=scope crosshairs
  uniform float uRollingNoise;  // 0-1 horizontal rolling noise band amplitude
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float nvRandom(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  vec3 phosphorTint(float lum, int phosphor) {
    if (phosphor == 0) return vec3(lum * 0.2, lum, lum * 0.2);   // green
    if (phosphor == 1) return vec3(lum, lum * 0.65, lum * 0.15); // amber (1980s NVGs)
    return vec3(lum);                                             // white phosphor (modern)
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    lum = pow(lum, 0.8) * uIntensity;

    int phos = int(uPhosphor + 0.5);
    vec3 nvColor = phosphorTint(lum, phos);

    // Scanlines (always on at low intensity).
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    nvColor *= 0.95 + scanline * 0.05;

    // Rolling noise — horizontal bands that scroll downward over time.
    if (uRollingNoise > 0.001) {
      float bandY = floor((vUv.y + uTime * 0.15) * 80.0);
      float bandRand = nvRandom(vec2(bandY, floor(uTime * 4.0)));
      nvColor += vec3(bandRand - 0.5) * uRollingNoise * 0.4 * vec3(0.0, 1.0, 0.0);
    }

    // Sensor grain.
    float n = nvRandom(vUv * uResolution + uTime * 1000.0);
    nvColor += (n - 0.5) * uNoise * 0.2;

    // Phosphor bloom — ring sample around the pixel, weighted by tint.
    if (uBloom > 0.001) {
      float glowSum = 0.0;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 offset = vec2(float(i), float(j)) / uResolution * (3.0 + uBloom * 2.0);
          float s = dot(texture2D(uTexture, vUv + offset).rgb, vec3(0.299, 0.587, 0.114));
          glowSum += s;
        }
      }
      glowSum /= 25.0;
      vec3 bloomTint = phosphorTint(glowSum * 0.5, phos);
      nvColor += bloomTint * uBloom;
    }

    // Scope mask.
    int scope = int(uScopeMask + 0.5);
    if (scope >= 1) {
      vec2 center = vec2(0.5);
      float dist = length(vUv - center);
      float vig = 1.0 - smoothstep(0.3, 0.7, dist * (1.0 + uVignette));
      float scopeEdge = smoothstep(0.48, 0.5, dist);
      vig *= 1.0 - scopeEdge;
      nvColor *= vig;
      // Crosshairs overlay for mode 2.
      if (scope == 2) {
        float cx = abs(vUv.x - 0.5);
        float cy = abs(vUv.y - 0.5);
        float cross = step(cx, 0.001) + step(cy, 0.001);
        // Tick marks every 0.05.
        float tick = step(mod(vUv.y, 0.05), 0.002) * step(cx, 0.012)
                   + step(mod(vUv.x, 0.05), 0.002) * step(cy, 0.012);
        nvColor = mix(nvColor, phosphorTint(0.85, phos), min(cross + tick, 1.0));
      }
    }

    gl_FragColor = vec4(clamp(nvColor, 0.0, 1.0), texColor.a);
  }
`,qa=`
  uniform sampler2D uTexture;
  uniform vec2 uPoints[256];
  uniform int uPointCount;      // Actual number of points
  uniform float uFeather;       // Edge feather amount (0-1)
  uniform float uInvert;        // 0=normal, 1=inverted (show outside)
  varying vec2 vUv;

  // Check if point is inside polygon using ray casting algorithm
  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;

    int crossings = 0;

    for (int i = 0; i < 256; i++) {
      if (i >= uPointCount) break;

      int j = i + 1;
      if (j >= uPointCount) j = 0;

      vec2 p1 = uPoints[i];
      vec2 p2 = uPoints[j];

      // Ray casting: count horizontal ray intersections
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }

    return mod(float(crossings), 2.0);
  }

  // Calculate distance to polygon edge for feathering
  float distToPolygonEdge(vec2 p) {
    if (uPointCount < 3) return 1.0;

    float minDist = 1000.0;

    for (int i = 0; i < 256; i++) {
      if (i >= uPointCount) break;

      int j = i + 1;
      if (j >= uPointCount) j = 0;

      vec2 a = uPoints[i];
      vec2 b = uPoints[j];

      // Distance to line segment
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      vec2 closest = a + t * ab;
      float dist = length(p - closest);

      minDist = min(minDist, dist);
    }

    return minDist;
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    if (uPointCount < 3) {
      // No valid polygon, show full texture (or hide if inverted)
      float alpha = uInvert > 0.5 ? 0.0 : 1.0;
      gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
      return;
    }

    float inside = pointInPolygon(vUv);

    // Apply feathering — one-sided: only fades the INSIDE edge.
    // Outside the polygon stays hard-transparent so the feather doesn't
    // bleed/halo into surrounding pixels.
    float alpha;
    if (uFeather > 0.001 && inside > 0.5) {
      float dist = distToPolygonEdge(vUv);
      alpha = smoothstep(0.0, uFeather, dist);
    } else {
      alpha = inside;
    }

    // Apply invert
    if (uInvert > 0.5) {
      alpha = 1.0 - alpha;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
  }
`,Ya=`
  uniform vec2 uPoints[256];
  uniform int uPointCount;
  uniform float uFeather;
  varying vec2 vUv;

  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;
    int crossings = 0;
    for (int i = 0; i < 256; i++) {
      if (i >= uPointCount) break;
      int j = i + 1;
      if (j >= uPointCount) j = 0;
      vec2 p1 = uPoints[i];
      vec2 p2 = uPoints[j];
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }
    return mod(float(crossings), 2.0);
  }

  float distToPolygonEdge(vec2 p) {
    if (uPointCount < 3) return 1.0;
    float minDist = 1000.0;
    for (int i = 0; i < 256; i++) {
      if (i >= uPointCount) break;
      int j = i + 1;
      if (j >= uPointCount) j = 0;
      vec2 a = uPoints[i];
      vec2 b = uPoints[j];
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      vec2 closest = a + t * ab;
      minDist = min(minDist, length(p - closest));
    }
    return minDist;
  }

  void main() {
    float inside = pointInPolygon(vUv);
    float alpha;
    if (uFeather > 0.001 && inside > 0.5) {
      float dist = distToPolygonEdge(vUv);
      alpha = smoothstep(0.0, uFeather, dist);
    } else {
      alpha = inside;
    }
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
  }
`,Xa=`
  uniform sampler2D uSource;
  uniform sampler2D uMask;
  uniform float uInvert;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uSource, vUv);
    float maskA = texture2D(uMask, vUv).a;
    float a = uInvert > 0.5 ? (1.0 - maskA) : maskA;
    gl_FragColor = vec4(src.rgb, src.a * a);
  }
`,Ka=`
  uniform sampler2D uTexture;
  uniform int uShapeType;       // 0=rect, 1=circle, 2=ellipse, 3=triangle, 4=polygon, 5=star, 6=line
  uniform float uRadiusX;       // For circle/ellipse
  uniform float uRadiusY;       // For ellipse
  uniform int uSides;           // For polygon/star
  uniform float uInnerRadius;   // For star
  uniform float uRotation;      // Rotation in radians
  uniform float uFeather;       // Edge feather amount
  uniform float uScale;         // Zoom/scale (1.0 = default)
  uniform float uLineWidth;     // For line shape
  uniform vec2 uLineStart;      // Line start point
  uniform vec2 uLineEnd;        // Line end point
  uniform int uHasControlPoints;
  uniform int uControlPointCount;
  uniform vec2 uControlPoints[5];
  uniform int uInvert;
  varying vec2 vUv;

  #define PI 3.14159265359

  // Rotate a point around center
  vec2 rotate(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  // Distance to circle
  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  // Distance to ellipse (approximate)
  float sdEllipse(vec2 p, vec2 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
  }

  // Distance to line segment
  float sdLine(vec2 p, vec2 a, vec2 b, float width) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - width;
  }

  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  bool pointInTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = c - a;
    vec2 v1 = b - a;
    vec2 v2 = p - a;
    float dot00 = dot(v0, v0);
    float dot01 = dot(v0, v1);
    float dot02 = dot(v0, v2);
    float dot11 = dot(v1, v1);
    float dot12 = dot(v1, v2);
    float invDenom = 1.0 / (dot00 * dot11 - dot01 * dot01);
    float u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    float v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0.0) && (v >= 0.0) && (u + v <= 1.0);
  }

  float sdTriangleFromPoints(vec2 p, vec2 a, vec2 b, vec2 c) {
    float d = min(min(distToSegment(p, a, b), distToSegment(p, b, c)), distToSegment(p, c, a));
    return pointInTriangle(p, a, b, c) ? -d : d;
  }

  vec3 barycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = b - a;
    vec2 v1 = c - a;
    vec2 v2 = p - a;
    float d00 = dot(v0, v0);
    float d01 = dot(v0, v1);
    float d11 = dot(v1, v1);
    float d20 = dot(v2, v0);
    float d21 = dot(v2, v1);
    float denom = d00 * d11 - d01 * d01;
    float v = (d11 * d20 - d01 * d21) / denom;
    float w = (d00 * d21 - d01 * d20) / denom;
    float u = 1.0 - v - w;
    return vec3(u, v, w);
  }

  // Inverse bilinear interpolation - find source UV from a warped quad
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);
    for (int i = 0; i < 6; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);
      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.00001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );
      uv += delta;
    }
    return uv;
  }

  // Distance to regular polygon
  float sdPolygon(vec2 p, float r, int n) {
    float an = PI / float(n);
    float he = r * tan(an);
    float a = atan(p.y, p.x);
    float bn = mod(a, 2.0 * an) - an;
    vec2 q = length(p) * vec2(cos(bn), abs(sin(bn)));
    return q.x - r;
  }

  // Distance to star shape
  float sdStar(vec2 p, float r, float innerR, int n) {
    float an = PI / float(n);
    float en = PI / float(n * 2);
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.y, p.x), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));

    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
  }

  void main() {
    vec2 sampleUv = vUv;

    // Transform UV to centered coordinates (-0.5 to 0.5)
    vec2 p = vUv - 0.5;

    // Apply scale (zoom) - dividing makes shape larger (zoom in)
    p = p / uScale;

    // Apply rotation
    p = rotate(p, -uRotation);

    // Shape-specific source UV warping for editable control points
    if (uShapeType == 1 && uHasControlPoints == 1 && uControlPointCount >= 5) {
      vec2 tl = uControlPoints[0];
      vec2 tr = uControlPoints[1];
      vec2 bl = uControlPoints[2];
      vec2 br = uControlPoints[3];
      vec2 center = uControlPoints[4];

      sampleUv = inverseWarp(vUv, tl, tr, bl, br);
      vec2 centerOffset = center - vec2(0.5);
      float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(vUv - vec2(0.5)));
      sampleUv -= centerOffset * centerWeight * 0.6;
    } else if (uShapeType == 3 && uHasControlPoints == 1 && uControlPointCount >= 3) {
      vec2 a = uControlPoints[0];
      vec2 b = uControlPoints[1];
      vec2 c = uControlPoints[2];
      vec3 bc = barycentric(vUv, a, b, c);
      if (bc.x >= 0.0 && bc.y >= 0.0 && bc.z >= 0.0) {
        vec2 d0 = vec2(0.5, 0.9);
        vec2 d1 = vec2(0.1, 0.1);
        vec2 d2 = vec2(0.9, 0.1);
        sampleUv = d0 * bc.x + d1 * bc.y + d2 * bc.z;
      }
    }

    sampleUv = clamp(sampleUv, 0.0, 1.0);
    vec4 texColor = texture2D(uTexture, sampleUv);

    float dist = 0.0;
    float mask = 1.0;

    if (uShapeType == 0) {
      // Rectangle - no masking (default)
      mask = 1.0;
    }
    else if (uShapeType == 1) {
      // Circle
      dist = sdCircle(p, uRadiusX * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 2) {
      // Ellipse
      dist = sdEllipse(p, vec2(uRadiusX, uRadiusY) * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 3) {
      // Triangle (equilateral)
      if (uHasControlPoints == 1 && uControlPointCount >= 3) {
        vec2 a = uControlPoints[0];
        vec2 b = uControlPoints[1];
        vec2 c = uControlPoints[2];
        dist = sdTriangleFromPoints(vUv, a, b, c);
      } else {
        dist = sdPolygon(p, 0.4, 3);
      }
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 4) {
      // Regular polygon
      dist = sdPolygon(p, 0.4, uSides);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 5) {
      // Star
      dist = sdStar(p, 0.4, uInnerRadius * 0.4, uSides);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 6) {
      // Line
      vec2 a = uLineStart - 0.5;
      vec2 b = uLineEnd - 0.5;
      dist = sdLine(p, a, b, uLineWidth * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }

    if (uInvert == 1) {
      mask = 1.0 - mask;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * mask);
  }
`,Na=`
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform float uIntensity;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uRadius;
  uniform float uAnamorphic;
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 thresholdKnee(vec3 col, float threshold, float knee) {
    float br = max(max(col.r, col.g), col.b);
    float kneeAmt = max(knee, 0.0001);
    float soft = clamp(br - threshold + kneeAmt, 0.0, 2.0 * kneeAmt);
    soft = soft * soft / (4.0 * kneeAmt + 0.00001);
    float contribution = max(soft, br - threshold) / max(br, 0.00001);
    return col * contribution;
  }

  vec3 ringSample(sampler2D tex, vec2 uv, vec2 px, float radius) {
    vec3 acc = vec3(0.0);
    float aniso = clamp(uAnamorphic, 0.0, 1.0);
    vec2 r = px * radius * vec2(1.0, 1.0 - aniso * 0.92);
    acc += texture2D(tex, uv + r * vec2( 1.0,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2(-1.0,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.7,  0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2(-0.7,  0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.7, -0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2(-0.7, -0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0,  1.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0, -1.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 1.7,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2(-1.7,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0,  1.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0, -1.7)).rgb;
    acc += texture2D(tex, uv).rgb;
    return acc / 13.0;
  }

  void main() {
    vec4 baseColor = texture2D(uTexture, vUv);
    vec2 px = 1.0 / uResolution;
    float baseR = uRadius * 9.0 + 1.5;
    vec3 ring1 = ringSample(uTexture, vUv, px, baseR * 1.0);
    vec3 ring2 = ringSample(uTexture, vUv, px, baseR * 2.2);
    vec3 ring3 = ringSample(uTexture, vUv, px, baseR * 4.5);
    vec3 blurred = ring1 * 0.55 + ring2 * 0.3 + ring3 * 0.15;
    vec3 bloom = thresholdKnee(blurred, uThreshold, uKnee);
    bloom *= uIntensity;
    bloom *= vec3(uTintR, uTintG, uTintB);
    vec3 composited = 1.0 - (1.0 - baseColor.rgb) * (1.0 - bloom);
    vec3 finalColor = mix(baseColor.rgb, composited, uAmount);
    gl_FragColor = vec4(finalColor, baseColor.a);
  }
`,ja=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uAmount;
  uniform float uZoom;
  uniform float uRotation;
  uniform float uDecay;
  uniform float uHueShift;
  uniform float uMaskCenter;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uHasFeedback < 0.5) { gl_FragColor = src; return; }

    vec2 centered = vUv - 0.5;
    float c = cos(uRotation);
    float s = sin(uRotation);
    centered = mat2(c, -s, s, c) * centered;
    centered /= max(uZoom, 0.001);
    vec2 fbUv = centered + 0.5;
    vec3 fb = texture2D(uFeedback, fbUv).rgb;

    float keepFactor = clamp(1.0 - uDecay, 0.0, 1.0);
    fb *= keepFactor;

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(fb);
      hsv.x = fract(hsv.x + uHueShift * 0.1);
      fb = hsv2rgb(hsv);
    }

    float maskFactor = 1.0;
    if (uMaskCenter > 0.001) {
      float distFromCenter = length(vUv - 0.5);
      maskFactor = 1.0 - smoothstep(0.3, 0.7, distFromCenter * uMaskCenter);
    }
    vec3 fbBlended = fb * maskFactor;
    vec3 composited = 1.0 - (1.0 - src.rgb) * (1.0 - fbBlended);
    vec3 finalColor = mix(src.rgb, composited, uAmount);
    gl_FragColor = vec4(finalColor, max(src.a, fbBlended.r * uAmount));
  }
`,$a=`
  uniform sampler2D uTexture;
  uniform float uExposure;          // -2 to +2 stops (multiplied into the linear gain)
  uniform float uRollOff;           // 0-1 highlight shoulder softness (0 = hard clip, 1 = very soft)
  uniform float uHighlightProtect;  // 0-1 — reduce exposure gain on already-bright pixels
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Photographic exposure: each stop = 2× linear gain.
    float gain = pow(2.0, uExposure);

    // Highlight protect — reduce gain locally on bright pixels. Per-pixel
    // luminance feeds a smoothstep so dark/mid pixels get full gain and
    // bright pixels get less. uHighlightProtect=1 means highlights are
    // mostly preserved; =0 means uniform gain across the image.
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float protect = 1.0 - uHighlightProtect * smoothstep(0.5, 1.0, lum);
    vec3 lifted = src * gain * protect;

    // Highlight roll-off — soft-knee compress the top end so values
    // above 1 fold back toward 1 instead of clipping. uRollOff=0 leaves
    // the legacy hard clip; uRollOff=1 gives a very soft shoulder.
    if (uRollOff > 0.001) {
      float k = mix(8.0, 1.0, uRollOff); // higher k = sharper knee
      // Reinhard-style: x / (1 + x/k) — smooth asymptote toward 1.
      lifted = lifted / (1.0 + max(lifted - 0.0, 0.0) / k);
    }

    gl_FragColor = vec4(clamp(lifted, 0.0, 1.0), texColor.a);
  }
`,Za=`
  uniform sampler2D uTexture;
  uniform float uShadows;     // 0.2-3.0 gamma for shadow region
  uniform float uMids;        // 0.2-3.0 gamma for midtones
  uniform float uHighlights;  // 0.2-3.0 gamma for highlights
  uniform float uMix;         // 0-1 wet/dry
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    // Three smoothstep weights centered on 0.15 / 0.5 / 0.85.
    float wS = 1.0 - smoothstep(0.0, 0.5, lum);
    float wH = smoothstep(0.5, 1.0, lum);
    float wM = 1.0 - wS - wH;
    // Blend the three gamma curves additively by weight.
    vec3 gS = pow(src, vec3(max(uShadows, 0.0001)));
    vec3 gM = pow(src, vec3(max(uMids, 0.0001)));
    vec3 gH = pow(src, vec3(max(uHighlights, 0.0001)));
    vec3 graded = gS * wS + gM * wM + gH * wH;
    gl_FragColor = vec4(mix(src, graded, uMix), texColor.a);
  }
`,Ja=`
  uniform sampler2D uTexture;
  uniform float uVibrance;        // -1..+1 — positive boosts muted colors, negative desaturates
  uniform float uSkinProtect;     // 0-1 — reduce vibrance push on skin-tone hues
  uniform float uHighlightProtect;// 0-1 — reduce vibrance push on bright pixels
  uniform float uCeiling;         // 0-1 — clamp final saturation (1 = no clamp)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hsv = rgb2hsv(texColor.rgb);

    // Skin tone protect — peak around hue ~0.05 (orange-pink ~30°),
    // gaussian falloff. Reduces the vibrance push by skinProtect there.
    float skinDist = abs(hsv.x - 0.05);
    if (skinDist > 0.5) skinDist = 1.0 - skinDist; // hue is circular
    float skinMask = exp(-(skinDist * skinDist) / 0.01); // ~σ=0.1
    float skinScale = 1.0 - uSkinProtect * skinMask;

    // Highlight protect — reduce push on already bright pixels.
    float hlScale = 1.0 - uHighlightProtect * smoothstep(0.6, 1.0, hsv.z);

    // Vibrance boost — non-linear so muted colors lift more than already
    // saturated ones (the classic Lightroom Vibrance behavior).
    float boost = uVibrance * (1.0 - hsv.y) * skinScale * hlScale;
    hsv.y = clamp(hsv.y + boost, 0.0, uCeiling);

    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);
  }
`,Qa=`
  uniform sampler2D uTexture;
  uniform float uTemperature;   // -1..+1 — cool (blue) to warm (orange)
  uniform float uTint;          // -1..+1 — green to magenta
  uniform float uShadowTemp;    // -1..+1 — split-tone shadows (used when uSplitTone > 0)
  uniform float uHighlightTemp; // -1..+1 — split-tone highlights
  uniform float uSplitTone;     // 0-1 — blend factor between simple temp and split-tone
  uniform float uAutoCycle;     // 0-1 — auto temperature oscillation amplitude
  uniform float uTime;
  varying vec2 vUv;

  vec3 tempShift(float t) {
    // Approximate kelvin shift: warm = +R/-B, cool = -R/+B, slight G compensation.
    return vec3(t * 0.30, t * 0.05, -t * 0.30);
  }
  vec3 tintShift(float t) {
    // Green = +G/-RB, magenta = -G/+RB.
    return vec3(-t * 0.10, t * 0.18, -t * 0.10);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Auto-cycle adds a slow sine-wave temperature offset.
    float autoT = sin(uTime * 0.4) * uAutoCycle * 0.5;

    // Single-temp path (uSplitTone=0).
    vec3 simple = src + tempShift(uTemperature + autoT) + tintShift(uTint);

    // Split-tone path: per-pixel temperature based on luminance.
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float perPixT = mix(uShadowTemp, uHighlightTemp, smoothstep(0.0, 1.0, lum));
    vec3 split = src + tempShift(perPixT + autoT) + tintShift(uTint);

    vec3 result = mix(simple, split, uSplitTone);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);
  }
`,ei=`
  uniform sampler2D uTexture;
  uniform float uShadowR;     uniform float uShadowG;     uniform float uShadowB;     // -1..+1 each
  uniform float uMidR;        uniform float uMidG;        uniform float uMidB;
  uniform float uHighR;       uniform float uHighG;       uniform float uHighB;
  uniform float uPreserveLuma;// 0-1 keep luma stable while shifting hue
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));

    // Three smoothstep weights matching Gamma hero's three-zone setup.
    float wS = 1.0 - smoothstep(0.0, 0.5, lum);
    float wH = smoothstep(0.5, 1.0, lum);
    float wM = 1.0 - wS - wH;

    vec3 shift = vec3(uShadowR, uShadowG, uShadowB) * wS * 0.3
               + vec3(uMidR,    uMidG,    uMidB)    * wM * 0.3
               + vec3(uHighR,   uHighG,   uHighB)   * wH * 0.3;

    vec3 graded = src + shift;

    if (uPreserveLuma > 0.001) {
      float newLum = dot(graded, vec3(0.299, 0.587, 0.114));
      graded += (lum - newLum) * uPreserveLuma;
    }

    gl_FragColor = vec4(clamp(mix(src, graded, uMix), 0.0, 1.0), texColor.a);
  }
`,ti=`
  uniform sampler2D uTexture;
  uniform float uContrast;    // 0-1 — S-curve strength (0 = linear, 1 = strong S)
  uniform float uToe;         // 0-1 — lift the dark end (anti-crush)
  uniform float uShoulder;    // 0-1 — soften the bright end (anti-blow-out)
  uniform float uBlackCrush;  // 0-1 — crush pixels below threshold to true black
  uniform float uMix;
  varying vec2 vUv;

  // Hermite-style S curve centered at 0.5.
  float sCurve(float x, float strength) {
    float t = smoothstep(0.0, 1.0, x);
    return mix(x, t * t * (3.0 - 2.0 * t), strength);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Pre-process: black crush — anything below threshold goes to 0.
    vec3 crushed = src;
    if (uBlackCrush > 0.001) {
      float th = uBlackCrush * 0.15;
      crushed = max(crushed - vec3(th), vec3(0.0)) / max(1.0 - th, 0.001);
    }

    // Apply S-curve per channel for contrast.
    vec3 sShaped;
    sShaped.r = sCurve(crushed.r, uContrast);
    sShaped.g = sCurve(crushed.g, uContrast);
    sShaped.b = sCurve(crushed.b, uContrast);

    // Toe lift — raise the dark pixels back up.
    vec3 toed = mix(sShaped, sShaped + (1.0 - sShaped) * 0.0, 0.0); // placeholder identity
    // Toe = subtle gamma lift on shadows only.
    if (uToe > 0.001) {
      float toeAmt = uToe * 0.5;
      sShaped = pow(sShaped, vec3(1.0 - toeAmt));
    }

    // Shoulder — soft compress highlights.
    if (uShoulder > 0.001) {
      vec3 sho = 1.0 - exp(-sShaped * (1.0 + uShoulder * 2.0));
      sShaped = mix(sShaped, sho, uShoulder);
    }

    gl_FragColor = vec4(mix(src, sShaped, uMix), texColor.a);
  }
`,oi=`
  uniform sampler2D uTexture;
  uniform float uLiftR;   uniform float uLiftG;   uniform float uLiftB;   // -0.5..+0.5
  uniform float uGammaR;  uniform float uGammaG;  uniform float uGammaB;  // 0.5..1.5 (1 = neutral)
  uniform float uGainR;   uniform float uGainG;   uniform float uGainB;   // 0.5..2.0
  uniform float uLumaOnly;// 0-1 — bypass color shifts, apply intensity only
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    vec3 lift  = vec3(uLiftR,  uLiftG,  uLiftB);
    vec3 gamma = vec3(uGammaR, uGammaG, uGammaB);
    vec3 gain  = vec3(uGainR,  uGainG,  uGainB);

    if (uLumaOnly > 0.5) {
      // Average the channels for luma-only operation.
      float l = (lift.r + lift.g + lift.b) / 3.0;
      float g = (gamma.r + gamma.g + gamma.b) / 3.0;
      float gn = (gain.r + gain.g + gain.b) / 3.0;
      lift = vec3(l); gamma = vec3(g); gain = vec3(gn);
    }

    // Standard ASC-CDL-ish formula: out = pow((src - 0) * gain + lift * (1 - src), 1/gamma)
    // Simplified for our knob ranges — lift adds in shadows (multiplied by
    // 1-src so it doesn't blow out highlights), gain multiplies, gamma is
    // the inverse exponent.
    vec3 lifted = src + lift * (vec3(1.0) - src) * 0.5;
    vec3 gained = lifted * gain;
    vec3 graded = pow(max(gained, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.05)));

    gl_FragColor = vec4(clamp(mix(src, graded, uMix), 0.0, 1.0), texColor.a);
  }
`,ai=`
  uniform sampler2D uTexture;
  uniform float uCurve;       // 0=ACES, 1=Reinhard, 2=Hable, 3=Bleach Bypass, 4=Print Film, 5=Soft Clip
  uniform float uExposure;    // 0.25-4.0 — pre-tonemap gain
  uniform float uContrast;    // 0-1 — post-tonemap S-curve
  uniform float uMix;
  varying vec2 vUv;

  // ACES Narkowicz approximation.
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 reinhard(vec3 x) { return x / (1.0 + x); }
  vec3 hable(vec3 x) {
    float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30, W = 11.2;
    vec3 n = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
    float wn = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;
    return n / wn;
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb * uExposure;
    int mode = int(uCurve + 0.5);
    vec3 mapped;

    if (mode == 0)      mapped = aces(src);
    else if (mode == 1) mapped = reinhard(src);
    else if (mode == 2) mapped = hable(src);
    else if (mode == 3) {
      // Bleach Bypass — desaturated / high-contrast film look.
      vec3 lum = vec3(dot(src, vec3(0.299, 0.587, 0.114)));
      mapped = clamp(mix(src, lum * 1.4, 0.5), 0.0, 1.0);
      mapped = aces(mapped);
    }
    else if (mode == 4) {
      // Print Film — soft toe, gentle shoulder, slightly cooled.
      mapped = aces(src * vec3(0.95, 0.97, 1.05));
      mapped = pow(mapped, vec3(1.0 / 1.1));
    }
    else {
      // Soft Clip — Reinhard with a sharper knee.
      mapped = src / (1.0 + src * 0.5);
    }

    // Optional post S-curve for extra punch.
    if (uContrast > 0.001) {
      vec3 t = smoothstep(0.0, 1.0, mapped);
      mapped = mix(mapped, t * t * (3.0 - 2.0 * t), uContrast);
    }

    gl_FragColor = vec4(mix(texColor.rgb, mapped, uMix), texColor.a);
  }
`,ii=`
  uniform sampler2D uTexture;
  uniform float uTargetHue;    // 0-1 — hue to target (0=red, 0.33=green, 0.67=blue)
  uniform float uHueRange;     // 0-1 — width of the hue band (0.05 = narrow, 0.3 = wide)
  uniform float uFeather;      // 0-1 — soft falloff at the edge of the band
  uniform float uMode;         // 0=isolate (desat outside), 1=replace (hue shift target)
  uniform float uReplaceHue;   // 0-1 — destination hue for replace mode
  uniform float uSatBoost;     // 0-1 — saturation boost on targeted pixels (for color pop)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hsv = rgb2hsv(texColor.rgb);

    // Hue distance with circular wrap.
    float d = abs(hsv.x - uTargetHue);
    d = min(d, 1.0 - d);

    // Smooth falloff: 1.0 inside the band, 0.0 outside, soft at edges.
    float band = 1.0 - smoothstep(uHueRange, uHueRange + uFeather, d);

    int mode = int(uMode + 0.5);
    if (mode == 0) {
      // Isolate — desaturate everything OUTSIDE the band.
      hsv.y *= mix(0.0, 1.0, band);
      // Optional sat boost on pixels INSIDE the band.
      hsv.y = clamp(hsv.y + band * uSatBoost * 0.5, 0.0, 1.0);
    } else {
      // Replace — shift hue toward uReplaceHue for pixels INSIDE the band.
      float hueDelta = uReplaceHue - uTargetHue;
      // Take the shortest way around the hue circle.
      if (hueDelta > 0.5) hueDelta -= 1.0;
      if (hueDelta < -0.5) hueDelta += 1.0;
      hsv.x = fract(hsv.x + hueDelta * band);
      hsv.y = clamp(hsv.y + band * uSatBoost * 0.5, 0.0, 1.0);
    }

    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);
  }
`,ri=`
  uniform sampler2D uTexture;
  uniform float uDotSize;     // 1-32 dot grid size
  uniform float uDotShape;    // 0=round, 1=square, 2=horizontal line, 3=vertical line
  uniform float uAngleC;      // 0-180° dot angle (cyan)
  uniform float uAngleM;      // magenta
  uniform float uAngleY;      // yellow
  uniform float uAngleK;      // black
  uniform float uMode;        // 0=greyscale halftone, 1=CMYK separation, 2=spot color
  uniform float uDriftSpeed;  // 0-2 animated grid drift speed
  uniform vec3 uSpotColor;    // for mode=2
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Single-channel halftone — returns 0..1 dot density at this position.
  float halftoneDot(vec2 pos, float angleDeg, float channelVal, float shape) {
    float a = radians(angleDeg);
    float c = cos(a);
    float s = sin(a);
    vec2 p = mat2(c, -s, s, c) * pos;
    p += vec2(uTime * uDriftSpeed * 0.5, uTime * uDriftSpeed * 0.3);
    vec2 cell = fract(p) - 0.5;
    int sh = int(shape + 0.5);
    float d;
    if (sh == 0) {
      // Round dot — radius proportional to channel value.
      d = length(cell) - mix(0.49, 0.0, channelVal);
    } else if (sh == 1) {
      // Square dot.
      d = max(abs(cell.x), abs(cell.y)) - mix(0.49, 0.0, channelVal);
    } else if (sh == 2) {
      // Horizontal line — line thickness is channel value.
      d = abs(cell.y) - mix(0.49, 0.0, channelVal) * 0.5;
    } else {
      // Vertical line.
      d = abs(cell.x) - mix(0.49, 0.0, channelVal) * 0.5;
    }
    return smoothstep(0.02, -0.02, d);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    int mode = int(uMode + 0.5);
    vec2 pos = vUv * uResolution / max(uDotSize, 1.0);

    if (mode == 1) {
      // CMYK separation: convert to CMY, then use K as min of CMY.
      vec3 c = 1.0 - texColor.rgb; // approximate CMY
      float k = min(c.r, min(c.g, c.b));
      vec3 cmy = (c - k) / max(1.0 - k, 0.001);
      float dotC = halftoneDot(pos, uAngleC, cmy.r, uDotShape);
      float dotM = halftoneDot(pos, uAngleM, cmy.g, uDotShape);
      float dotY = halftoneDot(pos, uAngleY, cmy.b, uDotShape);
      float dotK = halftoneDot(pos, uAngleK, k, uDotShape);
      // Convert back to RGB by subtracting CMYK from white.
      vec3 col = vec3(1.0)
               - vec3(dotC, 0.0, 0.0) * vec3(0.0, 1.0, 1.0)
               - vec3(0.0, dotM, 0.0) * vec3(1.0, 0.0, 1.0)
               - vec3(0.0, 0.0, dotY) * vec3(1.0, 1.0, 0.0)
               - vec3(dotK);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), texColor.a);
      return;
    }

    if (mode == 2) {
      // Spot color — single dot stamp at uSpotColor over white.
      float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
      float dotV = halftoneDot(pos, uAngleK, 1.0 - lum, uDotShape);
      gl_FragColor = vec4(mix(vec3(1.0), uSpotColor, dotV), texColor.a);
      return;
    }

    // Greyscale halftone — single dot density from luma.
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    float dotV = halftoneDot(pos, uAngleK, 1.0 - lum, uDotShape);
    gl_FragColor = vec4(vec3(1.0 - dotV), texColor.a);
  }
`,li=`
  uniform sampler2D uTexture;
  uniform float uSteps;         // 2-8 quantization steps per channel
  uniform float uOutline;       // 0-1 outline strength
  uniform float uOutlineColor;  // 0=black, 1=color from source
  uniform float uShadowBand;    // 0-1 darken shadow band intensity
  uniform float uRampSoftness;  // 0-1 smooth ramp (0=hard cel, 1=soft)
  uniform float uColorPop;      // 0-1 saturation boost
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 quantize(vec3 c, float steps, float soft) {
    vec3 hard = floor(c * steps) / max(steps - 1.0, 1.0);
    if (soft < 0.001) return hard;
    // Soft ramp: blend between hard and continuous via smoothstep on each
    // channel toward the next step.
    vec3 frac = fract(c * steps);
    vec3 smoothBlend = smoothstep(0.4, 0.6, frac);
    return mix(hard, hard + smoothBlend / max(steps - 1.0, 1.0), soft);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Color pop pre-process — bumps saturation slightly.
    if (uColorPop > 0.001) {
      float lum = dot(src, vec3(0.299, 0.587, 0.114));
      src = mix(vec3(lum), src, 1.0 + uColorPop * 0.6);
    }

    vec3 quant = quantize(clamp(src, 0.0, 1.0), uSteps, uRampSoftness);

    // Shadow band — darken the lowest quantization step further.
    if (uShadowBand > 0.001) {
      float lum = dot(quant, vec3(0.299, 0.587, 0.114));
      float shadow = smoothstep(0.35, 0.0, lum);
      quant *= 1.0 - shadow * uShadowBand * 0.5;
    }

    // Built-in outline — Sobel-ish luma gradient.
    if (uOutline > 0.001) {
      vec2 t = 1.5 / uResolution;
      float lL = dot(texture2D(uTexture, vUv - vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float lR = dot(texture2D(uTexture, vUv + vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float lD = dot(texture2D(uTexture, vUv - vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));
      float lU = dot(texture2D(uTexture, vUv + vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));
      float edge = clamp(length(vec2(lR - lL, lU - lD)) * 6.0, 0.0, 1.0);
      vec3 lineCol = mix(vec3(0.0), src * 0.4, uOutlineColor);
      quant = mix(quant, lineCol, edge * uOutline);
    }

    gl_FragColor = vec4(quant, texColor.a);
  }
`,ui=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 pixel radius of each quadrant
  uniform float uEdgeSharpness; // 0-1 extra contrast on the chosen quadrant
  uniform float uColorPunch;    // 0-1 saturation boost on output
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 t = 1.0 / uResolution;
    float r = max(uRadius, 1.0);

    // 4-quadrant Kuwahara (cheap variant; 9-quadrant is too costly per
    // pixel for live preview). Sample mean + variance in each of TL/TR/BL/BR
    // quadrants, then pick the one with the lowest variance.
    vec3 means[4];
    float vars[4];
    for (int q = 0; q < 4; q++) {
      vec2 dir = vec2((q == 0 || q == 2) ? -1.0 : 1.0,
                       (q < 2) ? 1.0 : -1.0);
      vec3 sum = vec3(0.0);
      vec3 sumSq = vec3(0.0);
      float n = 0.0;
      // Sample a 3x3 stencil scaled by radius in the quadrant direction.
      for (int i = 0; i <= 2; i++) {
        for (int j = 0; j <= 2; j++) {
          vec2 off = (vec2(float(i), float(j))) * dir * r * t;
          vec3 c = texture2D(uTexture, vUv + off).rgb;
          sum += c;
          sumSq += c * c;
          n += 1.0;
        }
      }
      vec3 m = sum / n;
      vec3 v = sumSq / n - m * m;
      means[q] = m;
      vars[q] = v.r + v.g + v.b;
    }

    // Pick lowest-variance quadrant.
    int bestQ = 0;
    float bestV = vars[0];
    if (vars[1] < bestV) { bestV = vars[1]; bestQ = 1; }
    if (vars[2] < bestV) { bestV = vars[2]; bestQ = 2; }
    if (vars[3] < bestV) { bestV = vars[3]; bestQ = 3; }
    vec3 result = means[bestQ];

    // Edge sharpness — push toward the chosen mean by overshooting.
    if (uEdgeSharpness > 0.001) {
      vec3 center = texture2D(uTexture, vUv).rgb;
      result = mix(result, result + (result - center) * 0.5, uEdgeSharpness);
    }

    // Color punch — saturation boost on output.
    if (uColorPunch > 0.001) {
      float lum = dot(result, vec3(0.299, 0.587, 0.114));
      result = mix(vec3(lum), result, 1.0 + uColorPunch);
    }

    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);
  }
`,ni=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 brush radius
  uniform float uIntensity;     // 4-32 quantization bins
  uniform float uBrushLength;   // 0-2 directional brush length
  uniform float uBristle;       // 0-1 bristle striations
  uniform float uColorPunch;    // 0-1 saturation pop
  uniform float uHighlight;     // 0-1 wet specular pop on bright bins
  uniform float uMode;          // 0=bin pick, 1=variance pick (kuwahara-style)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    int radius = int(clamp(uRadius, 1.0, 8.0));
    float bins = max(2.0, uIntensity);
    int binCount = 24;

    float intensityCount[24];
    vec3  averageColor[24];
    for (int i = 0; i < 24; i++) { intensityCount[i] = 0.0; averageColor[i] = vec3(0.0); }

    // Brush direction = local gradient (sobel on luma)
    float gx = 0.0; float gy = 0.0;
    {
      float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0, -1.0)).rgb);
      float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0, -1.0)).rgb);
      float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0, -1.0)).rgb);
      float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  0.0)).rgb);
      float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  0.0)).rgb);
      float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  1.0)).rgb);
      float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0,  1.0)).rgb);
      float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  1.0)).rgb);
      gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
      gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    }
    float gradMag = length(vec2(gx, gy));
    vec2 brushDir = (gradMag > 0.001) ? vec2(-gy, gx) / gradMag : vec2(1.0, 0.0);

    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        vec2 sampleUv = vUv + vec2(float(x), float(y)) * texel * (1.0 + uBrushLength * abs(dot(normalize(vec2(float(x), float(y)) + 1e-6), brushDir)));
        vec3 c = texture2D(uTexture, sampleUv).rgb;
        // Bristle striation: subtly modulate sample weight along brush dir
        float bristleMod = 1.0;
        if (uBristle > 0.001) {
          float along = dot(vec2(float(x), float(y)), brushDir);
          bristleMod = mix(1.0, 0.5 + 0.5 * sin(along * 3.14159 * 2.0), uBristle);
        }
        int bin = int(luma(c) * (bins - 1.0));
        bin = int(clamp(float(bin), 0.0, float(binCount - 1)));
        intensityCount[bin] += bristleMod;
        averageColor[bin] += c * bristleMod;
      }
    }

    int maxIdx = 0;
    float maxCount = 0.0;
    for (int i = 0; i < 24; i++) {
      if (intensityCount[i] > maxCount) { maxCount = intensityCount[i]; maxIdx = i; }
    }
    vec3 result = averageColor[maxIdx] / max(maxCount, 1.0);

    if (uColorPunch > 0.001) {
      float lum = luma(result);
      result = mix(vec3(lum), result, 1.0 + uColorPunch * 0.6);
    }
    if (uHighlight > 0.001) {
      float lum = luma(result);
      float spec = smoothstep(0.7, 0.95, lum) * uHighlight;
      result += vec3(spec);
    }

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,si=`
  uniform sampler2D uTexture;
  uniform float uBleed;         // 0-1 pigment bleed radius
  uniform float uEdgeDarken;    // 0-1 sobel-driven edge darkening
  uniform float uPaperTexture;  // 0-1 paper noise strength
  uniform float uPaperScale;    // 1-32 paper noise scale
  uniform float uWetness;       // 0-1 colour saturation boost (wet pigment)
  uniform float uGranulation;   // 0-1 pigment granulation noise
  uniform float uPaperHue;      // 0=cream, 1=cool grey, 2=tea-stain
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 paperColor(float kind) {
    if (kind < 0.5) return vec3(0.96, 0.93, 0.86); // cream
    if (kind < 1.5) return vec3(0.88, 0.90, 0.93); // cool grey
    return vec3(0.82, 0.72, 0.55); // tea
  }

  void main() {
    vec2 texel = 1.0 / uResolution;

    // ── Pigment bleed: 9-tap blur with radius scaled by uBleed ──
    float r = uBleed * 6.0 + 1.0;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * r;
        float w = exp(-dot(off, off) * 100.0);
        sum += texture2D(uTexture, vUv + off).rgb * w;
        weight += w;
      }
    }
    vec3 bled = sum / weight;

    // ── Edge darken (sobel on luma) ──
    float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0, -1.0)).rgb);
    float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0, -1.0)).rgb);
    float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0, -1.0)).rgb);
    float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  0.0)).rgb);
    float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  0.0)).rgb);
    float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  1.0)).rgb);
    float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0,  1.0)).rgb);
    float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  1.0)).rgb);
    float gxL = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gyL = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = clamp(length(vec2(gxL, gyL)), 0.0, 1.0);
    bled = mix(bled, bled * (1.0 - edge), uEdgeDarken);

    // ── Wetness (saturation boost) ──
    if (uWetness > 0.001) {
      float lum = luma(bled);
      bled = mix(vec3(lum), bled, 1.0 + uWetness * 0.5);
    }

    // ── Pigment granulation ──
    if (uGranulation > 0.001) {
      float gran = vnoise(vUv * uResolution * 0.6 + uTime * 0.05) - 0.5;
      bled += vec3(gran) * uGranulation * 0.15;
    }

    // ── Paper texture composite ──
    float paperN = vnoise(vUv * uPaperScale * 16.0) * 0.5 + vnoise(vUv * uPaperScale * 32.0) * 0.5;
    vec3 paper = paperColor(uPaperHue) * (0.85 + paperN * 0.3);
    vec3 result = bled * mix(vec3(1.0), paper, uPaperTexture);

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,ci=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 0-30 px
  uniform float uMode;          // 0=box, 1=gaussian, 2=motion, 3=bilateral
  uniform float uAngle;         // 0-360 degrees (motion blur direction)
  uniform float uQuality;       // 0=low (9-tap), 1=mid (17-tap), 2=high (25-tap)
  uniform float uEdgeProtect;   // 0-1 bilateral edge preservation
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    vec3 srcRgb = src.rgb;
    float srcL = luma(srcRgb);
    if (uRadius < 0.01) {
      gl_FragColor = src;
      return;
    }

    int mode = int(uMode + 0.5);
    int taps = (uQuality < 0.5) ? 4 : (uQuality < 1.5) ? 8 : 12;
    float r = uRadius;
    vec2 texel = 1.0 / uResolution;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float ang = radians(uAngle);
    vec2 motionDir = vec2(cos(ang), sin(ang));

    for (int s = -12; s <= 12; s++) {
      if (abs(s) > taps) continue;
      float fs = float(s);
      vec2 off;
      float w = 1.0;

      if (mode == 0) {
        // Box blur — 1D pair (do twice)
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        w = 1.0;
      } else if (mode == 1) {
        // Gaussian (separated horizontal-only here, ok for screen-space)
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        float sigma = float(taps) * 0.5;
        w = exp(-(fs * fs) / (2.0 * sigma * sigma));
      } else if (mode == 2) {
        // Motion blur — directional
        off = motionDir * fs * texel * (r / float(taps));
        w = 1.0;
      } else {
        // Bilateral
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        vec3 sCol = texture2D(uTexture, vUv + off).rgb;
        float dL = luma(sCol) - srcL;
        float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));
        float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - uEdgeProtect) * 0.5, 2.0)));
        w = spatial * range;
      }
      acc += texture2D(uTexture, vUv + off).rgb * w;
      wsum += w;
    }

    // Second pass for box/gaussian/bilateral (vertical), so output is roughly 2D
    if (mode != 2) {
      for (int s = -12; s <= 12; s++) {
        if (abs(s) > taps) continue;
        if (s == 0) continue;
        float fs = float(s);
        vec2 off = vec2(0.0, fs) * texel * (r / float(taps));
        float w = 1.0;
        if (mode == 1) {
          float sigma = float(taps) * 0.5;
          w = exp(-(fs * fs) / (2.0 * sigma * sigma));
        } else if (mode == 3) {
          vec3 sCol = texture2D(uTexture, vUv + off).rgb;
          float dL = luma(sCol) - srcL;
          float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));
          float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - uEdgeProtect) * 0.5, 2.0)));
          w = spatial * range;
        }
        acc += texture2D(uTexture, vUv + off).rgb * w;
        wsum += w;
      }
    }

    vec3 blurred = acc / max(wsum, 0.0001);
    vec3 result = mix(srcRgb, blurred, uMix);
    gl_FragColor = vec4(result, src.a);
  }
`,fi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-3 sharpen strength
  uniform float uMode;          // 0=laplacian, 1=unsharp mask
  uniform float uRadius;        // 1-8 unsharp radius
  uniform float uEdgeProtect;   // 0-1 limit sharpening on flat areas
  uniform float uClarity;       // 0-1 mid-tone contrast pop
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec4 center = texture2D(uTexture, vUv);
    vec3 result = center.rgb;

    int mode = int(uMode + 0.5);

    if (mode == 0) {
      // Laplacian sharpen
      vec4 left   = texture2D(uTexture, vUv - vec2(texel.x, 0.0));
      vec4 right  = texture2D(uTexture, vUv + vec2(texel.x, 0.0));
      vec4 top    = texture2D(uTexture, vUv + vec2(0.0, texel.y));
      vec4 bottom = texture2D(uTexture, vUv - vec2(0.0, texel.y));
      vec3 avg = (left.rgb + right.rgb + top.rgb + bottom.rgb) * 0.25;
      vec3 highFreq = center.rgb - avg;
      // Edge protect: fade sharpen on flat regions
      float edgeAmp = 1.0;
      if (uEdgeProtect > 0.001) {
        float edgeMag = length(highFreq);
        edgeAmp = smoothstep(0.0, uEdgeProtect * 0.2, edgeMag);
      }
      result = center.rgb + highFreq * uAmount * edgeAmp;
    } else {
      // Unsharp mask: blur, subtract from original, add scaled back
      float r = max(1.0, uRadius);
      vec3 blurAcc = vec3(0.0);
      float wsum = 0.0;
      for (int y = -4; y <= 4; y++) {
        for (int x = -4; x <= 4; x++) {
          if (abs(x) + abs(y) > 4) continue;
          vec2 off = vec2(float(x), float(y)) * texel * (r * 0.5);
          float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
          blurAcc += texture2D(uTexture, vUv + off).rgb * w;
          wsum += w;
        }
      }
      vec3 blurred = blurAcc / wsum;
      vec3 mask = center.rgb - blurred;
      float edgeAmp = 1.0;
      if (uEdgeProtect > 0.001) {
        float edgeMag = length(mask);
        edgeAmp = smoothstep(0.0, uEdgeProtect * 0.2, edgeMag);
      }
      result = center.rgb + mask * uAmount * edgeAmp;
    }

    // Clarity: mid-tone contrast pop
    if (uClarity > 0.001) {
      float lum = luma(result);
      float midMask = 4.0 * lum * (1.0 - lum); // peaks at lum=0.5
      vec3 popped = mix(vec3(0.5), result, 1.0 + uClarity * 0.6);
      result = mix(result, popped, midMask * uClarity);
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), center.a);
  }
`,vi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 normalized blur length
  uniform float uAngle;         // 0-360 degrees
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1 weight falloff toward edges
  uniform float uCenterBias;    // 0-1 keep center sharper
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 texel = 1.0 / uResolution;
    float maxOffset = uAmount * 0.3; // 30% of screen max

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = -32; i <= 32; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      vec2 off = dir * t * maxOffset;
      // Falloff weight (1 at center, drops toward edges)
      float w = mix(1.0, 1.0 - abs(t), uFalloff);
      // Center bias: weight center heavier
      w *= mix(1.0, exp(-t * t * 8.0), uCenterBias);
      acc += texture2D(uTexture, vUv + off).rgb * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix), src.a);
  }
`,di=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 normalized blur length
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1 weight falloff
  uniform float uChromatic;     // 0-1 RGB split during zoom
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 dir = vUv - center;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i <= 32; i++) {
      if (i > samples) break;
      float t = float(i) / float(samples);
      vec2 sUv;
      vec3 c;
      if (uChromatic > 0.001) {
        // Channel-shift along zoom direction
        float rT = t * (1.0 + uChromatic * 0.05);
        float gT = t;
        float bT = t * (1.0 - uChromatic * 0.05);
        float rR = texture2D(uTexture, vUv - dir * uAmount * rT).r;
        float gG = texture2D(uTexture, vUv - dir * uAmount * gT).g;
        float bB = texture2D(uTexture, vUv - dir * uAmount * bT).b;
        c = vec3(rR, gG, bB);
      } else {
        sUv = vUv - dir * uAmount * t;
        c = texture2D(uTexture, sUv).rgb;
      }
      float w = mix(1.0, 1.0 - t, uFalloff);
      acc += c * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix), src.a);
  }
`,mi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 spin angle (radians scale)
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1
  uniform float uRadiusInner;   // 0-1 unblurred inner radius
  uniform float uRadiusOuter;   // 0-1 fully blurred outer radius
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    float dist = length(d);

    // Mask: 0 inside inner radius, 1 outside outer radius
    float mask = smoothstep(uRadiusInner, uRadiusOuter, dist);
    if (mask < 0.001) { gl_FragColor = src; return; }

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float maxAngle = uAmount * 1.2; // ~70° max spin
    for (int i = -32; i <= 32; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      float a = t * maxAngle * mask;
      float ca = cos(a), sa = sin(a);
      vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = center + rd;
      float w = mix(1.0, 1.0 - abs(t), uFalloff);
      acc += texture2D(uTexture, sUv).rgb * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix * mask), src.a);
  }
`,pi=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=radial, 3=linear gradient
  uniform float uFocusY;        // 0-1 focus center
  uniform float uFocusX;        // 0-1 (used by radial)
  uniform float uFocusBand;     // 0-1 sharp band width
  uniform float uFalloff;       // 0-1 transition softness
  uniform float uMaxBlur;       // 0-1 max blur amount
  uniform float uAngle;         // 0-360 (linear gradient direction)
  uniform float uSaturation;    // 0-2 saturation in defocused area (miniature look)
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 sampleBlur(vec2 uv, float r) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 texel = 1.0 / uResolution;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * r;
        float w = exp(-(float(x*x + y*y)) / 8.0);
        acc += texture2D(uTexture, uv + off).rgb * w;
        wsum += w;
      }
    }
    return acc / wsum;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float blurMask = 0.0;
    float band = max(0.001, uFocusBand);
    float falloff = max(0.001, uFalloff);

    if (mode == 0) {
      // Horizontal band
      float d = abs(vUv.y - uFocusY);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);
    } else if (mode == 1) {
      // Vertical band
      float d = abs(vUv.x - uFocusX);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);
    } else if (mode == 2) {
      // Radial spotlight focus
      vec2 d = vUv - vec2(uFocusX, uFocusY);
      float dist = length(d);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, dist);
    } else {
      // Linear gradient
      float ang = radians(uAngle);
      vec2 dir = vec2(cos(ang), sin(ang));
      float t = dot(vUv - vec2(uFocusX, uFocusY), dir);
      blurMask = smoothstep(-band * 0.5, band * 0.5 + falloff, abs(t));
    }

    vec4 src = texture2D(uTexture, vUv);
    float blurR = blurMask * uMaxBlur * 14.0;
    vec3 blurred = (blurR > 0.1) ? sampleBlur(vUv, blurR) : src.rgb;

    // Saturation tweak in defocused area (miniature/tilt-shift look)
    if (abs(uSaturation - 1.0) > 0.001) {
      float lum = luma(blurred);
      blurred = mix(vec3(lum), blurred, uSaturation);
    }

    vec3 result = mix(src.rgb, blurred, blurMask);
    gl_FragColor = vec4(result, src.a);
  }
`,hi=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 0-30 disc radius
  uniform float uSamples;       // 12-48
  uniform float uBrightWeight;  // 0-2 boost on highlights (creates bokeh balls)
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uChromaFringe;  // 0-1 RGB radial offset
  uniform float uShape;         // 0=disc, 1=hexagon, 2=octagon
  uniform float uRotation;      // 0-360 aperture rotation
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Aperture mask: returns 1 if (sx, sy) is inside the aperture shape
  float apertureMask(vec2 p, int shape) {
    float r = length(p);
    if (r > 1.0) return 0.0;
    if (shape == 0) return 1.0; // disc
    float ang = atan(p.y, p.x);
    int sides = (shape == 1) ? 6 : 8;
    float n = float(sides);
    float halfAng = 3.14159 / n;
    float folded = mod(ang + halfAng, 2.0 * halfAng) - halfAng;
    float polyR = cos(halfAng) / cos(folded);
    return r <= polyR ? 1.0 : 0.0;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 48.0));
    int shape = int(uShape + 0.5);
    float rot = radians(uRotation);
    float ca = cos(rot), sa = sin(rot);
    vec2 texel = 1.0 / uResolution;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;

    // Sample on golden-angle spiral inside aperture mask
    for (int i = 0; i < 48; i++) {
      if (i >= samples) break;
      float fi = float(i);
      float t = fi / float(samples);
      // Golden-angle spiral
      float angle = fi * 2.39996;
      float radius = sqrt(t);
      vec2 disc = vec2(cos(angle), sin(angle)) * radius;
      // Rotate to user-set aperture rotation
      vec2 rotDisc = vec2(disc.x * ca - disc.y * sa, disc.x * sa + disc.y * ca);
      float mask = apertureMask(rotDisc, shape);
      if (mask < 0.5) continue;

      vec2 off;
      vec3 c;
      if (uChromaFringe > 0.001) {
        // Per-channel offset for fringing
        vec2 dir = normalize(rotDisc + 1e-6);
        float rOff = uRadius * (1.0 + uChromaFringe * 0.05);
        float bOff = uRadius * (1.0 - uChromaFringe * 0.05);
        off = rotDisc * uRadius * texel;
        float r = texture2D(uTexture, vUv + dir * rOff * texel + (off - dir * uRadius * texel)).r;
        float g = texture2D(uTexture, vUv + off).g;
        float b = texture2D(uTexture, vUv + dir * bOff * texel + (off - dir * uRadius * texel)).b;
        c = vec3(r, g, b);
      } else {
        off = rotDisc * uRadius * texel;
        c = texture2D(uTexture, vUv + off).rgb;
      }

      // Bright-weight: boost highlights so they form crisp bokeh balls
      float w = 1.0;
      if (uBrightWeight > 0.001) {
        float l = luma(c);
        float hi = smoothstep(uThreshold, uThreshold + 0.2, l);
        w = mix(1.0, 1.0 + uBrightWeight * 6.0, hi);
      }
      acc += c * w;
      wsum += w;
    }

    vec3 result = (wsum > 0.0) ? acc / wsum : src.rgb;
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,gi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 strength
  uniform float uMode;          // 0=linear, 1=radial, 2=lens (cubic), 3=prism
  uniform float uAngle;         // 0-360 (linear)
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uEdgeFalloff;   // 0-1 weight by distance from center
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    float dist = length(d);

    vec2 dirR, dirB;
    float strength = uAmount * 0.05;

    if (mode == 0) {
      // Linear (directional)
      float ang = radians(uAngle);
      vec2 dir = vec2(cos(ang), sin(ang));
      dirR =  dir * strength;
      dirB = -dir * strength;
    } else if (mode == 1) {
      // Radial outward
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * strength;
      dirB = -nd * strength;
    } else if (mode == 2) {
      // Lens (cubic falloff — like real glass)
      float k = strength * (dist * dist * 4.0);
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * k;
      dirB = -nd * k;
    } else {
      // Prism rainbow spread
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * strength * 1.5;
      dirB = -nd * strength * 1.5;
    }

    // Edge falloff weight (only push at the edges)
    float weight = mix(1.0, dist * 2.0, uEdgeFalloff);

    vec2 offR = dirR * weight;
    vec2 offB = dirB * weight;
    float r = texture2D(uTexture, vUv + offR).r;
    float g = texture2D(uTexture, vUv).g;
    float b = texture2D(uTexture, vUv + offB).b;
    vec3 result = vec3(r, g, b);

    // Prism mode adds extra mid-spectrum tints
    if (mode == 3) {
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      float yE = texture2D(uTexture, vUv + nd * strength * 0.7 * weight).r * 0.5
               + texture2D(uTexture, vUv + nd * strength * 0.7 * weight).g * 0.5;
      result.r = mix(result.r, max(result.r, yE), 0.3);
      result.g = mix(result.g, yE, 0.2);
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,xi=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uDecay;         // 0.85-1.0 sample decay
  uniform float uExposure;      // 0.1-1 exposure scale
  uniform float uDensity;       // 0-1 sample density
  uniform float uThreshold;     // 0-1 brightness gate
  uniform float uCenterX;       // 0-1 sun position
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 16-128
  uniform float uTintR;         // 0-1
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 128.0));
    vec2 sun = vec2(uCenterX, uCenterY);
    vec2 deltaUv = (vUv - sun) * (uDensity / float(samples));
    vec2 cur = vUv;
    float illum = 1.0;
    vec3 acc = vec3(0.0);

    for (int i = 0; i < 128; i++) {
      if (i >= samples) break;
      cur -= deltaUv;
      vec3 s = texture2D(uTexture, cur).rgb;
      // Threshold gate — only bright pixels emit rays
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(s));
      acc += s * gate * illum;
      illum *= uDecay;
    }
    acc *= uExposure * uIntensity;
    acc *= vec3(uTintR, uTintG, uTintB);

    vec3 result = src.rgb + acc * uMix;
    gl_FragColor = vec4(result, src.a);
  }
`,bi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-2 bleed strength
  uniform float uRadius;        // 0-30 bleed radius
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uTintR;         // 0-1 bleed colour
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uMode;          // 0=screen, 1=add, 2=soft light
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    vec2 texel = 1.0 / uResolution;
    vec3 bleed = vec3(0.0);
    float wsum = 0.0;
    float r = max(1.0, uRadius);

    for (int y = -5; y <= 5; y++) {
      for (int x = -5; x <= 5; x++) {
        if (abs(x) + abs(y) > 7) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.5;
        vec3 sampleCol = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.2, luma(sampleCol));
        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
        bleed += sampleCol * gate * w;
        wsum += w;
      }
    }
    bleed = (wsum > 0.0) ? bleed / wsum : vec3(0.0);
    bleed *= vec3(uTintR, uTintG, uTintB) * uAmount;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      // Screen
      result = 1.0 - (1.0 - src.rgb) * (1.0 - bleed);
    } else if (mode == 1) {
      // Add
      result = src.rgb + bleed;
    } else {
      // Soft light
      vec3 a = 2.0 * src.rgb * bleed + src.rgb * src.rgb * (1.0 - 2.0 * bleed);
      vec3 b = sqrt(src.rgb) * (2.0 * bleed - 1.0) + 2.0 * src.rgb * (1.0 - bleed);
      result = mix(a, b, step(0.5, bleed));
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,yi=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uLength;        // 0-1 streak length (% of screen)
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uTintR;         // 0-1 streak colour (typically blue)
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uAngle;         // 0-180 streak angle (default horizontal)
  uniform float uSamples;       // 16-64
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 64.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 texel = 1.0 / uResolution;

    vec3 streak = vec3(0.0);
    float wsum = 0.0;
    for (int i = -64; i <= 64; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      vec2 off = dir * t * uLength;
      vec3 sCol = texture2D(uTexture, vUv + off).rgb;
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sCol));
      float w = exp(-abs(t) * 2.0);
      streak += sCol * gate * w;
      wsum += w;
    }
    streak = (wsum > 0.0) ? streak / wsum : vec3(0.0);
    streak *= vec3(uTintR, uTintG, uTintB) * uIntensity;

    // Screen blend
    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - streak);
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,Si=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 dirt overlay strength
  uniform float uScale;         // 1-32 noise pattern scale
  uniform float uThreshold;     // 0-1 dirt visibility threshold (only show on bright areas)
  uniform float uTintWarmth;    // 0-1 warm/cool dust colour
  uniform float uScratches;     // 0-1 vertical scratch overlay
  uniform float uSpots;         // 0-1 dust spot density
  uniform float uMode;          // 0=screen, 1=add, 2=multiply (debris)
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-1 dirt drift
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    vec2 driftUv = vUv + vec2(uTime * uAnimSpeed * 0.01, uTime * uAnimSpeed * 0.005);

    // Dust spot field (low-frequency noise)
    float spots = 0.0;
    if (uSpots > 0.001) {
      float n1 = vnoise(driftUv * uScale * 4.0);
      float n2 = vnoise(driftUv * uScale * 8.0 + vec2(13.7, 9.1));
      float n3 = vnoise(driftUv * uScale * 12.0 + vec2(45.2, 71.3));
      spots = (n1 * n2 * n3) * 4.0;
      spots = smoothstep(0.3, 0.6, spots) * uSpots;
    }

    // Vertical scratches
    float scratches = 0.0;
    if (uScratches > 0.001) {
      float xn = hash21(vec2(floor(driftUv.x * uResolution.x * 0.05), 0.0));
      scratches = step(0.97, xn) * uScratches * 0.7;
    }

    float dirt = clamp(spots + scratches, 0.0, 1.0);
    float bright = smoothstep(uThreshold, uThreshold + 0.2, luma(src.rgb));
    dirt *= bright * uAmount;

    vec3 dustColor = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.65), uTintWarmth);
    vec3 dirtRgb = dustColor * dirt;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      result = 1.0 - (1.0 - src.rgb) * (1.0 - dirtRgb);
    } else if (mode == 1) {
      result = src.rgb + dirtRgb;
    } else {
      result = src.rgb * (1.0 - dirt * 0.5);
    }
    gl_FragColor = vec4(result, src.a);
  }
`,Ci=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 diffusion strength
  uniform float uRadius;        // 1-30 glow radius
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uShadowLift;    // 0-1 lift shadows
  uniform float uHighlightBloom;// 0-1 bloom on highlights
  uniform float uHaze;          // 0-1 overall haze (lower contrast)
  uniform float uHazeWarmth;    // 0-1 warm haze tint
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    // Highlight-only blur for bloom
    vec2 texel = 1.0 / uResolution;
    vec3 bloom = vec3(0.0);
    float wsum = 0.0;
    float r = max(1.0, uRadius);
    for (int y = -5; y <= 5; y++) {
      for (int x = -5; x <= 5; x++) {
        if (abs(x) + abs(y) > 7) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
        vec3 sCol = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.2, luma(sCol));
        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
        bloom += sCol * gate * w;
        wsum += w;
      }
    }
    bloom = (wsum > 0.0) ? bloom / wsum : vec3(0.0);
    bloom *= uHighlightBloom * 1.5;

    // Shadow lift (raises blacks)
    vec3 lifted = src.rgb + (1.0 - src.rgb) * uShadowLift * 0.15;

    // Haze: lower contrast + optional warm tint
    vec3 hazeColor = mix(vec3(0.7, 0.75, 0.8), vec3(0.95, 0.85, 0.7), uHazeWarmth);
    vec3 hazed = mix(lifted, hazeColor, uHaze * 0.3);

    // Combine: hazed base + screen-blended bloom
    vec3 result = 1.0 - (1.0 - hazed) * (1.0 - bloom);
    result = mix(src.rgb, result, uMix * uAmount);

    gl_FragColor = vec4(result, src.a);
  }
`,Ti=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 grain strength
  uniform float uSize;          // 0.5-4 grain size (px)
  uniform float uShadowGrain;   // 0-1 grain in shadows
  uniform float uMidGrain;      // 0-1 grain in midtones
  uniform float uHighGrain;     // 0-1 grain in highlights
  uniform float uMono;          // 0-1 monochrome grain (vs RGB)
  uniform float uStock;         // 0=fine, 1=35mm, 2=16mm, 3=Super8
  uniform float uColorJitter;   // 0-1 chroma noise
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-1 anim speed (1 = per-frame)
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int stock = int(uStock + 0.5);
    float grainScale = (stock == 0) ? 1.5 : (stock == 1) ? 1.0 : (stock == 2) ? 0.6 : 0.35;
    grainScale *= uSize;
    vec2 gPos = vUv * uResolution / max(0.5, grainScale);
    float t = floor(uTime * uAnimSpeed * 24.0) / 24.0;

    float n = hash13(vec3(gPos, t));
    vec3 noiseRgb;
    if (uMono > 0.5) {
      noiseRgb = vec3(n - 0.5);
    } else {
      float r = hash13(vec3(gPos, t + 0.1));
      float g = hash13(vec3(gPos, t + 0.3));
      float b = hash13(vec3(gPos, t + 0.7));
      noiseRgb = vec3(r - 0.5, g - 0.5, b - 0.5);
    }

    // Tonal response — different grain in shadows / mids / highs
    float l = luma(src.rgb);
    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);
    float midMask = (1.0 - abs(l - 0.5) * 2.0);
    float highMask = smoothstep(0.6, 1.0, l);
    float zoneAmp = shadowMask * uShadowGrain + midMask * uMidGrain + highMask * uHighGrain;

    float chromaJit = 0.0;
    if (uColorJitter > 0.001) {
      chromaJit = (hash13(vec3(gPos, t + 0.5)) - 0.5) * uColorJitter;
    }

    vec3 grain = noiseRgb * uAmount * zoneAmp + vec3(chromaJit, -chromaJit, chromaJit * 0.5) * 0.2;
    vec3 result = src.rgb + grain;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,wi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 displacement strength
  uniform float uScale;         // 1-32 noise scale
  uniform float uSpeed;         // 0-3 animation speed
  uniform float uDirectionY;    // -1..1 vertical bias (rising heat)
  uniform float uTurbulence;    // 0-1 fbm turbulence
  uniform float uMode;          // 0=heat shimmer, 1=underwater, 2=glass distort
  uniform float uFocusY;        // 0-1 vertical position where haze peaks
  uniform float uFocusBand;     // 0-1 band width
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }

  void main() {
    if (uAmount < 0.001) { gl_FragColor = texture2D(uTexture, vUv); return; }

    int mode = int(uMode + 0.5);
    vec2 p = vUv * uScale + vec2(0.0, -uTime * uSpeed * 0.5);
    p.y += uDirectionY * uTime * uSpeed * 0.3;

    float nx, ny;
    if (uTurbulence > 0.001) {
      nx = fbm(p) - 0.5;
      ny = fbm(p + vec2(123.4, 56.7)) - 0.5;
    } else {
      nx = vnoise(p) - 0.5;
      ny = vnoise(p + vec2(123.4, 56.7)) - 0.5;
    }

    float strength = uAmount * 0.05;
    if (mode == 0) {
      // Heat shimmer — mostly horizontal, falls off above focusY
      ny *= 0.4;
      float bandMask = exp(-pow((vUv.y - uFocusY) / max(0.05, uFocusBand), 2.0));
      strength *= bandMask;
    } else if (mode == 1) {
      // Underwater — both directions, sinusoidal modulation
      float wave = sin(uTime * uSpeed + vUv.y * 8.0) * 0.5;
      nx *= (1.0 + wave * 0.5);
      ny *= (1.0 + wave * 0.5);
    } else {
      // Glass distort — strong, both directions
      strength *= 1.5;
    }

    vec2 off = vec2(nx, ny) * strength;
    vec4 src = texture2D(uTexture, vUv + off);
    gl_FragColor = src;
  }
`,Ri=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uType;          // 0=white, 1=blue, 2=value, 3=fbm, 4=cellular
  uniform float uMode;          // 0=overlay, 1=add, 2=multiply, 3=screen, 4=replace
  uniform float uScale;         // 0.5-32 noise scale
  uniform float uMono;          // 0=RGB noise, 1=mono
  uniform float uShadowAmt;     // 0-1
  uniform float uMidAmt;        // 0-1
  uniform float uHighAmt;       // 0-1
  uniform float uAnimSpeed;     // 0=static, 0-2=anim
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        float d = dot(r, r);
        minD = min(minD, d);
      }
    }
    return sqrt(minD);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 sampleNoise(vec2 p, float t) {
    int type = int(uType + 0.5);
    if (uMono > 0.5) {
      float n;
      if (type == 0) n = hash13(vec3(p, t)) - 0.5;
      else if (type == 1) {
        // Blue-style: triangular distribution from two whites
        float a = hash13(vec3(p, t));
        float b = hash13(vec3(p + 1.0, t + 0.5));
        n = (a + b) * 0.5 - 0.5;
      }
      else if (type == 2) n = vnoise(p) - 0.5;
      else if (type == 3) n = fbm(p) - 0.5;
      else n = cellular(p) - 0.5;
      return vec3(n);
    } else {
      vec3 c;
      if (type == 0) c = vec3(hash13(vec3(p, t)), hash13(vec3(p, t + 0.31)), hash13(vec3(p, t + 0.71))) - 0.5;
      else if (type == 1) {
        c = vec3(
          (hash13(vec3(p, t)) + hash13(vec3(p + 1.0, t + 0.5))) * 0.5 - 0.5,
          (hash13(vec3(p + 7.0, t + 0.31)) + hash13(vec3(p + 8.0, t + 0.81))) * 0.5 - 0.5,
          (hash13(vec3(p + 17.0, t + 0.71)) + hash13(vec3(p + 18.0, t + 0.91))) * 0.5 - 0.5
        );
      }
      else if (type == 2) c = vec3(vnoise(p), vnoise(p + 13.7), vnoise(p + 71.3)) - 0.5;
      else if (type == 3) c = vec3(fbm(p), fbm(p + 13.7), fbm(p + 71.3)) - 0.5;
      else c = vec3(cellular(p), cellular(p + 13.7), cellular(p + 71.3)) - 0.5;
      return c;
    }
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    float t = (uAnimSpeed > 0.001) ? floor(uTime * uAnimSpeed * 24.0) / 24.0 : 0.0;
    vec2 p = vUv * uResolution / max(0.5, 64.0 / uScale);
    vec3 noise = sampleNoise(p, t);

    // Tonal weighting
    float l = luma(src.rgb);
    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);
    float midMask = (1.0 - abs(l - 0.5) * 2.0);
    float highMask = smoothstep(0.6, 1.0, l);
    float zoneAmp = shadowMask * uShadowAmt + midMask * uMidAmt + highMask * uHighAmt;
    noise *= uAmount * zoneAmp;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      // Overlay: noise around 0.5, blend lightly
      result = src.rgb + noise;
    } else if (mode == 1) {
      result = src.rgb + abs(noise) * sign(noise);
    } else if (mode == 2) {
      result = src.rgb * (1.0 + noise);
    } else if (mode == 3) {
      vec3 n01 = noise + 0.5;
      result = 1.0 - (1.0 - src.rgb) * (1.0 - n01 * uAmount);
    } else {
      result = noise + 0.5;
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,ki=`
  uniform sampler2D uTexture;
  uniform float uScanlines;     // 0-1 scanline strength
  uniform float uScanCount;     // 100-1200 scanline count
  uniform float uMask;          // 0-1 phosphor mask strength
  uniform float uMaskType;      // 0=Trinitron stripe, 1=Aperture grille, 2=Shadow mask
  uniform float uCurvature;     // 0-1 barrel curvature
  uniform float uVignette;      // 0-1 corner darken
  uniform float uGlow;          // 0-1 phosphor glow bleed
  uniform float uRollingBar;    // 0-1 vertical roll
  uniform float uChromatic;     // 0-1 lens fringing
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 curveUv(vec2 uv, float k) {
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);
    uv = uv + uv * offset * offset * k;
    return uv * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = uCurvature > 0.001 ? curveUv(vUv, uCurvature) : vUv;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Chromatic aberration on RGB channels
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 cd = (uv - 0.5) * uChromatic * 0.01;
      col.r = texture2D(uTexture, uv + cd).r;
      col.g = texture2D(uTexture, uv).g;
      col.b = texture2D(uTexture, uv - cd).b;
    } else {
      col = texture2D(uTexture, uv).rgb;
    }

    // Phosphor mask
    if (uMask > 0.001) {
      int mtype = int(uMaskType + 0.5);
      vec2 px = uv * uResolution;
      vec3 maskCol = vec3(1.0);
      if (mtype == 0) {
        // Trinitron vertical stripes (3-pixel R/G/B repeat)
        float stripe = mod(px.x, 3.0);
        if (stripe < 1.0) maskCol = vec3(1.4, 0.6, 0.6);
        else if (stripe < 2.0) maskCol = vec3(0.6, 1.4, 0.6);
        else maskCol = vec3(0.6, 0.6, 1.4);
      } else if (mtype == 1) {
        // Aperture grille (vertical stripes + horizontal damping wires)
        float stripe = mod(px.x, 3.0);
        if (stripe < 1.0) maskCol = vec3(1.5, 0.5, 0.5);
        else if (stripe < 2.0) maskCol = vec3(0.5, 1.5, 0.5);
        else maskCol = vec3(0.5, 0.5, 1.5);
        float wire = step(0.95, mod(px.y * 0.005, 1.0));
        maskCol *= 1.0 - wire * 0.3;
      } else {
        // Shadow mask (RGB triads on diamond)
        float u3 = mod(px.x, 6.0);
        float v3 = mod(px.y, 2.0);
        if (v3 < 1.0) {
          if (u3 < 2.0) maskCol = vec3(1.5, 0.5, 0.5);
          else if (u3 < 4.0) maskCol = vec3(0.5, 1.5, 0.5);
          else maskCol = vec3(0.5, 0.5, 1.5);
        } else {
          if (u3 < 1.0 || u3 >= 5.0) maskCol = vec3(0.5, 0.5, 1.5);
          else if (u3 < 3.0) maskCol = vec3(1.5, 0.5, 0.5);
          else maskCol = vec3(0.5, 1.5, 0.5);
        }
      }
      col = mix(col, col * maskCol, uMask);
    }

    // Scanlines
    if (uScanlines > 0.001) {
      float sl = sin(uv.y * uScanCount * 3.14159) * 0.5 + 0.5;
      col *= mix(1.0, sl, uScanlines);
    }

    // Glow (sample surrounding pixels weighted)
    if (uGlow > 0.001) {
      vec2 texel = 1.0 / uResolution;
      vec3 g = texture2D(uTexture, uv + vec2( texel.x,  0.0)).rgb
             + texture2D(uTexture, uv + vec2(-texel.x,  0.0)).rgb
             + texture2D(uTexture, uv + vec2( 0.0,  texel.y)).rgb
             + texture2D(uTexture, uv + vec2( 0.0, -texel.y)).rgb;
      col += g * uGlow * 0.05;
    }

    // Rolling sync bar
    if (uRollingBar > 0.001) {
      float bar = sin(uv.y * 6.0 - uTime * 1.5);
      bar = smoothstep(0.7, 1.0, bar);
      col += bar * uRollingBar * 0.15;
    }

    // Vignette
    if (uVignette > 0.001) {
      vec2 vc = uv - 0.5;
      float v = 1.0 - dot(vc, vc) * uVignette * 1.4;
      col *= clamp(v, 0.0, 1.0);
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`,Mi=`
  uniform sampler2D uTexture;
  uniform float uSegments;      // 2-32
  uniform float uAngle;         // 0-360 rotation
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uZoom;          // 0.25-4
  uniform float uMode;          // 0=mirror, 1=tile (no flip), 2=spiral
  uniform float uSpiralAmount;  // 0-2 spiral twist (used in mode 2)
  uniform float uAnimSpeed;     // 0-2 auto-rotate
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    // Aspect correct
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float theta = atan(d.y, d.x);
    float baseAngle = radians(uAngle) + uTime * uAnimSpeed * 0.3;
    theta -= baseAngle;

    int mode = int(uMode + 0.5);
    float seg = max(2.0, uSegments);
    float wedge = 6.28318 / seg;

    if (mode == 0) {
      // Mirror — fold within wedge
      theta = mod(theta, wedge);
      theta = abs(theta - wedge * 0.5);
    } else if (mode == 1) {
      // Tile — modulo without flip
      theta = mod(theta, wedge);
    } else {
      // Spiral — fold + radial twist
      theta = mod(theta, wedge);
      theta = abs(theta - wedge * 0.5);
      theta += r * uSpiralAmount * 2.0;
    }

    float zoom = max(0.05, uZoom);
    vec2 mappedD = vec2(cos(theta), sin(theta)) * r / zoom;
    mappedD.x *= uResolution.y / uResolution.x;
    vec2 mappedUv = mappedD + center;
    mappedUv = clamp(mappedUv, vec2(0.0), vec2(1.0));

    vec4 src = texture2D(uTexture, vUv);
    vec4 mapped = texture2D(uTexture, mappedUv);
    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, uMix), src.a);
  }
`,Di=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=quad, 3=diagonal
  uniform float uPosition;      // 0-1 mirror axis position
  uniform float uOffset;        // 0-1 source offset
  uniform float uFlipSide;      // 0=mirror right/bottom, 1=mirror left/top
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    int mode = int(uMode + 0.5);

    if (mode == 0) {
      // Horizontal axis (mirror along Y)
      float pos = uPosition;
      bool aboveAxis = (uv.x > pos) != (uFlipSide > 0.5);
      if (aboveAxis) {
        uv.x = pos * 2.0 - uv.x + (uOffset - 0.5) * 0.4;
      }
    } else if (mode == 1) {
      // Vertical axis (mirror along X)
      float pos = uPosition;
      bool aboveAxis = (uv.y > pos) != (uFlipSide > 0.5);
      if (aboveAxis) {
        uv.y = pos * 2.0 - uv.y + (uOffset - 0.5) * 0.4;
      }
    } else if (mode == 2) {
      // Quad mirror
      uv = abs(uv - 0.5) + 0.5;
      uv = abs(uv - vec2(uPosition, uPosition));
      uv = mix(uv, vUv, 0.0);
    } else {
      // Diagonal
      vec2 c = vec2(uPosition);
      vec2 d = uv - c;
      // Reflect across diagonal y=x going through center
      vec2 refl = c + vec2(d.y, d.x);
      uv = (uFlipSide > 0.5) ? refl : (uv.x + uv.y < 2.0 * uPosition ? uv : refl);
    }

    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec4 mirrored = texture2D(uTexture, uv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, mirrored.rgb, uMix), src.a);
  }
`,Ai=`
  uniform sampler2D uTexture;
  uniform float uAmplitude;     // 0-50 px
  uniform float uFrequency;     // 0.1-30
  uniform float uSpeed;         // 0-3
  uniform float uType;          // 0=horizontal, 1=vertical, 2=radial, 3=swirl
  uniform float uWaveform;      // 0=sin, 1=triangle, 2=saw, 3=square
  uniform float uPhase;         // 0-360 phase offset
  uniform float uSecondaryAmt;  // 0-1 second harmonic
  uniform float uChromaSplit;   // 0-1 RGB phase shift
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float waveform(float x, int kind) {
    if (kind == 0) return sin(x);
    if (kind == 1) return abs(mod(x / 3.14159, 2.0) - 1.0) * 2.0 - 1.0;
    if (kind == 2) return mod(x / 3.14159, 2.0) - 1.0;
    return sign(sin(x));
  }

  vec2 waveOffset(vec2 uv, float phaseShift) {
    int type = int(uType + 0.5);
    int wf = int(uWaveform + 0.5);
    float t = uTime * uSpeed + radians(uPhase) + phaseShift;
    float amp = uAmplitude / uResolution.y;
    float freq = uFrequency;
    vec2 off = vec2(0.0);

    if (type == 0) {
      // Horizontal — wave shifts X based on Y
      off.x = waveform(uv.y * freq + t, wf) * amp;
      if (uSecondaryAmt > 0.001) off.x += waveform(uv.y * freq * 2.5 + t * 1.7, wf) * amp * uSecondaryAmt * 0.5;
    } else if (type == 1) {
      off.y = waveform(uv.x * freq + t, wf) * amp;
      if (uSecondaryAmt > 0.001) off.y += waveform(uv.x * freq * 2.5 + t * 1.7, wf) * amp * uSecondaryAmt * 0.5;
    } else if (type == 2) {
      // Radial — push out/in based on distance
      vec2 d = uv - 0.5;
      float r = length(d);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      off = dir * waveform(r * freq * 8.0 + t, wf) * amp;
    } else {
      // Swirl
      vec2 d = uv - 0.5;
      float r = length(d);
      float a = atan(d.y, d.x);
      float w = waveform(r * freq + t, wf) * amp * 4.0;
      a += w;
      off = vec2(cos(a), sin(a)) * r + 0.5 - uv;
    }
    return off;
  }

  void main() {
    vec2 baseOff = waveOffset(vUv, 0.0);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 offR = waveOffset(vUv, 0.5 * uChromaSplit);
      vec2 offB = waveOffset(vUv, -0.5 * uChromaSplit);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Bi=`
  uniform sampler2D uTexture;
  uniform float uStrength;      // -1..1 (negative = pincushion)
  uniform float uRadius;        // 0.1-1
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uZoom;          // 0.5-2
  uniform float uMode;          // 0=spherize, 1=barrel, 2=pincushion
  uniform float uChromaEdge;    // 0-1 edge fringing
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 fisheyeMap(vec2 uv, float strength, float radius, float zoom) {
    vec2 d = uv - vec2(uCenterX, uCenterY);
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float radNorm = clamp(r / radius, 0.0, 1.0);
    int mode = int(uMode + 0.5);
    float distort;
    if (mode == 0) {
      // Spherize (smooth)
      distort = sin(radNorm * 1.5707963 * sign(strength)) * abs(strength);
    } else if (mode == 1) {
      // Barrel (cubic)
      distort = radNorm * radNorm * abs(strength) * sign(strength);
    } else {
      // Pincushion (always pulls in)
      distort = -radNorm * radNorm * abs(strength);
    }
    float scale = 1.0 + distort;
    d /= max(0.0001, scale);
    d /= zoom;
    d.x *= uResolution.y / uResolution.x;
    return d + vec2(uCenterX, uCenterY);
  }

  void main() {
    vec2 uvBase = fisheyeMap(vUv, uStrength, uRadius, uZoom);
    vec3 col;
    if (uChromaEdge > 0.001) {
      vec2 d = vUv - vec2(uCenterX, uCenterY);
      float r = length(d);
      float edgeAmp = smoothstep(uRadius * 0.4, uRadius, r) * uChromaEdge * 0.04;
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      vec2 uvR = fisheyeMap(vUv + dir * edgeAmp, uStrength, uRadius, uZoom);
      vec2 uvB = fisheyeMap(vUv - dir * edgeAmp, uStrength, uRadius, uZoom);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uvBase, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(uvBase, vec2(0.0), vec2(1.0))).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Ui=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // -1..1
  uniform float uMode;          // 0=barrel, 1=pincushion, 2=mustache, 3=anamorphic
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uCubic;         // -0.5..0.5 cubic term (mustache uses both)
  uniform float uAnamorphicX;   // 0.5-2 horizontal stretch
  uniform float uEdgeFade;      // 0-1 fade at edges (transparent border)
  uniform float uChromaFringe;  // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 lensMap(vec2 uv, float k1, float k2) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r2 = dot(d, d);
    float factor = 1.0 + k1 * r2 + k2 * r2 * r2;
    d *= factor;
    d.x *= uResolution.y / uResolution.x;
    return d + c;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float k1, k2;
    if (mode == 0) { k1 = uAmount; k2 = 0.0; }
    else if (mode == 1) { k1 = -uAmount; k2 = 0.0; }
    else if (mode == 2) { k1 = uAmount; k2 = uCubic; }
    else { k1 = 0.0; k2 = 0.0; }

    vec2 uv;
    if (mode == 3) {
      // Anamorphic stretch — no radial, just X scale
      vec2 c = vec2(uCenterX, uCenterY);
      vec2 d = vUv - c;
      d.x /= max(0.1, uAnamorphicX);
      uv = d + c;
    } else {
      uv = lensMap(vUv, k1, k2);
    }

    vec3 col;
    if (uChromaFringe > 0.001) {
      vec2 uvR = lensMap(vUv, k1 * (1.0 + uChromaFringe * 0.05), k2);
      vec2 uvB = lensMap(vUv, k1 * (1.0 - uChromaFringe * 0.05), k2);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uv, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    }

    // Edge fade — transparent border for OOB samples
    float oob = step(uv.x, 0.0) + step(1.0, uv.x) + step(uv.y, 0.0) + step(1.0, uv.y);
    oob = min(oob, 1.0);
    float aFade = mix(1.0, 0.0, oob * uEdgeFade);

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a * aFade);
  }
`,Pi=`
  uniform sampler2D uTexture;
  uniform float uKeyR;          // 0-1 key colour (default green)
  uniform float uKeyG;
  uniform float uKeyB;
  uniform float uTolerance;     // 0-1 hue band width
  uniform float uSoftness;      // 0-1 edge feather
  uniform float uSpillSuppress; // 0-1 reduce key colour on subject
  uniform float uMatte;         // 0=show matte (1-bit), 0=keyed result
  uniform float uMode;          // 0=hue distance, 1=YCbCr, 2=RGB distance
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 rgb2ycbcr(vec3 c) {
    float y  =  0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    float cb = -0.169 * c.r - 0.331 * c.g + 0.5   * c.b;
    float cr =  0.5   * c.r - 0.419 * c.g - 0.081 * c.b;
    return vec3(y, cb, cr);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 key = vec3(uKeyR, uKeyG, uKeyB);
    int mode = int(uMode + 0.5);

    float dist;
    if (mode == 0) {
      // Hue distance
      vec3 hsvSrc = rgb2hsv(src);
      vec3 hsvKey = rgb2hsv(key);
      float hd = abs(hsvSrc.x - hsvKey.x);
      hd = min(hd, 1.0 - hd);
      dist = hd * 2.0 + (1.0 - hsvSrc.y) * 0.3;
    } else if (mode == 1) {
      // YCbCr (chroma plane)
      vec3 yc = rgb2ycbcr(src);
      vec3 yk = rgb2ycbcr(key);
      dist = length(yc.yz - yk.yz) * 2.0;
    } else {
      // RGB distance
      dist = length(src - key);
    }

    float matte = smoothstep(uTolerance, uTolerance + uSoftness + 0.001, dist);

    // Spill suppression
    vec3 result = src;
    if (uSpillSuppress > 0.001) {
      float keyMax = max(max(key.r, key.g), key.b);
      // Reduce dominant key channel
      if (key.g >= max(key.r, key.b)) {
        result.g = min(result.g, mix(result.g, (result.r + result.b) * 0.5, uSpillSuppress * (1.0 - matte)));
      } else if (key.r >= max(key.g, key.b)) {
        result.r = min(result.r, mix(result.r, (result.g + result.b) * 0.5, uSpillSuppress * (1.0 - matte)));
      } else {
        result.b = min(result.b, mix(result.b, (result.r + result.g) * 0.5, uSpillSuppress * (1.0 - matte)));
      }
    }

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      gl_FragColor = vec4(result, matte);
    }
  }
`,Fi=`
  uniform sampler2D uTexture;
  uniform float uLowCut;        // 0-1 fade-in start
  uniform float uHighCut;       // 0-1 fade-in end
  uniform float uInvert;        // 0=keep bright, 1=keep dark
  uniform float uGamma;         // 0.2-3 matte gamma
  uniform float uMatte;         // 0=normal, 1=show matte
  uniform float uPremultiply;   // 0=straight alpha, 1=premultiplied
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    float matte = smoothstep(uLowCut, max(uLowCut + 0.001, uHighCut), l);
    if (uInvert > 0.5) matte = 1.0 - matte;
    matte = pow(clamp(matte, 0.0, 1.0), max(0.001, uGamma));

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      vec3 result = (uPremultiply > 0.5) ? src * matte : src;
      gl_FragColor = vec4(result, matte);
    }
  }
`,Gi=`
  uniform sampler2D uTexture;
  uniform float uRefR;          // 0-1 reference colour
  uniform float uRefG;
  uniform float uRefB;
  uniform float uTolerance;     // 0-1
  uniform float uSoftness;      // 0-1
  uniform float uInvert;        // 0=key matches, 1=key non-matches
  uniform float uMatte;         // 0=normal, 1=show matte
  uniform float uMode;          // 0=Euclidean, 1=Manhattan, 2=Max channel
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 ref = vec3(uRefR, uRefG, uRefB);
    vec3 diff = abs(src - ref);

    int mode = int(uMode + 0.5);
    float d;
    if (mode == 0) d = length(diff);
    else if (mode == 1) d = (diff.r + diff.g + diff.b);
    else d = max(max(diff.r, diff.g), diff.b);

    float matte = smoothstep(uTolerance, uTolerance + uSoftness + 0.001, d);
    if (uInvert > 0.5) matte = 1.0 - matte;

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      gl_FragColor = vec4(src, matte);
    }
  }
`,zi=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 pixel radius
  uniform float uShape;         // 0=cross, 1=square, 2=circle
  uniform float uChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float channelVal(vec4 c, int ch) {
    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if (ch == 1) return c.r;
    if (ch == 2) return c.g;
    if (ch == 3) return c.b;
    return c.a;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int radius = int(clamp(uRadius, 1.0, 8.0));
    int shape = int(uShape + 0.5);
    int ch = int(uChannel + 0.5);
    vec2 texel = 1.0 / uResolution;

    vec4 minPx = vec4(1.0);
    float minVal = 1.0;
    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        if (shape == 0 && abs(x) + abs(y) > radius) continue;
        if (shape == 2 && (x*x + y*y) > radius * radius) continue;
        vec4 sCol = texture2D(uTexture, vUv + vec2(float(x), float(y)) * texel);
        float v = channelVal(sCol, ch);
        if (v < minVal) { minVal = v; minPx = sCol; }
      }
    }

    gl_FragColor = vec4(mix(src.rgb, minPx.rgb, uMix), mix(src.a, minPx.a, uMix));
  }
`,Li=`
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8
  uniform float uShape;         // 0=cross, 1=square, 2=circle
  uniform float uChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float channelVal(vec4 c, int ch) {
    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if (ch == 1) return c.r;
    if (ch == 2) return c.g;
    if (ch == 3) return c.b;
    return c.a;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int radius = int(clamp(uRadius, 1.0, 8.0));
    int shape = int(uShape + 0.5);
    int ch = int(uChannel + 0.5);
    vec2 texel = 1.0 / uResolution;

    vec4 maxPx = vec4(0.0);
    float maxVal = 0.0;
    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        if (shape == 0 && abs(x) + abs(y) > radius) continue;
        if (shape == 2 && (x*x + y*y) > radius * radius) continue;
        vec4 sCol = texture2D(uTexture, vUv + vec2(float(x), float(y)) * texel);
        float v = channelVal(sCol, ch);
        if (v > maxVal) { maxVal = v; maxPx = sCol; }
      }
    }

    gl_FragColor = vec4(mix(src.rgb, maxPx.rgb, uMix), mix(src.a, maxPx.a, uMix));
  }
`,Hi=`
  uniform sampler2D uTexture;
  uniform float uAngle;         // radians of full twirl at center
  uniform float uRadius;        // 0.05-1 area of effect
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uFalloff;       // 0.5-4 power curve
  uniform float uAnimSpeed;     // 0-2 auto-rotation
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float maxR = max(0.001, uRadius);
    float falloff = pow(clamp(1.0 - r / maxR, 0.0, 1.0), max(0.5, uFalloff));
    float a = uAngle * falloff + uTime * uAnimSpeed;
    float ca = cos(a), sa = sin(a);
    vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    rd.x *= uResolution.y / uResolution.x;
    vec2 sUv = clamp(center + rd, vec2(0.0), vec2(1.0));
    vec4 warped = texture2D(uTexture, sUv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, warped.rgb, uMix), src.a);
  }
`,Ii=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // -1..1 negative=pinch, positive=bulge
  uniform float uRadius;        // 0.1-1
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uFalloff;       // 0.5-4
  uniform float uChromatic;     // 0-1 RGB split
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 warp(vec2 uv, float amt) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float maxR = max(0.001, uRadius);
    float t = clamp(r / maxR, 0.0, 1.0);
    float fade = pow(1.0 - t, max(0.5, uFalloff));
    float k = 1.0 + amt * fade;
    if (k < 0.001) k = 0.001;
    d /= k;
    d.x *= uResolution.y / uResolution.x;
    return c + d;
  }

  void main() {
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 uvR = warp(vUv, uAmount * (1.0 + uChromatic * 0.05));
      vec2 uvG = warp(vUv, uAmount);
      vec2 uvB = warp(vUv, uAmount * (1.0 - uChromatic * 0.05));
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uvG, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(warp(vUv, uAmount), vec2(0.0), vec2(1.0))).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, col, uMix), src.a);
  }
`,Ei=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-3
  uniform float uMode;          // 0=fbm, 1=cellular, 2=sine grid, 3=ripple
  uniform float uTurbulence;    // 0-1
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        minD = min(minD, dot(r, r));
      }
    }
    return sqrt(minD);
  }

  vec2 dispOffset(vec2 uv, float t) {
    int mode = int(uMode + 0.5);
    vec2 p = uv * uScale + vec2(t, t * 0.7);
    float nx, ny;
    if (mode == 0) {
      nx = (uTurbulence > 0.5 ? fbm(p) : vnoise(p)) - 0.5;
      ny = (uTurbulence > 0.5 ? fbm(p + 71.3) : vnoise(p + 71.3)) - 0.5;
    } else if (mode == 1) {
      nx = cellular(p) - 0.5;
      ny = cellular(p + 71.3) - 0.5;
    } else if (mode == 2) {
      nx = sin(uv.y * uScale * 6.283 + t * 2.0);
      ny = sin(uv.x * uScale * 6.283 + t * 2.0);
    } else {
      vec2 d = uv - 0.5;
      float r = length(d);
      float ripple = sin(r * uScale * 6.283 - t * 3.0);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      nx = dir.x * ripple;
      ny = dir.y * ripple;
    }
    return vec2(nx, ny) * uAmount * 0.05;
  }

  void main() {
    float t = uTime * uSpeed;
    vec2 baseOff = dispOffset(vUv, t);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = dispOffset(vUv, t + 0.3 * uChromatic);
      vec2 offB = dispOffset(vUv, t - 0.3 * uChromatic);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Oi=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=cart→polar, 1=polar→cart, 2=log polar
  uniform float uRotation;      // 0-360
  uniform float uZoom;          // 0.25-4
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 sUv;

    if (mode == 0) {
      // Cart → polar (input becomes radial pattern)
      vec2 d = vUv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = length(d) * 2.0;
      float a = atan(d.y, d.x) / 6.28318 + 0.5;
      a = fract(a + uRotation / 360.0);
      sUv = vec2(a, r * uZoom);
    } else if (mode == 1) {
      // Polar → cart (rectangular UV becomes radial)
      float a = (vUv.x - 0.5 + uRotation / 360.0) * 6.28318;
      float r = vUv.y * uZoom;
      vec2 d = vec2(cos(a), sin(a)) * r * 0.5;
      d.x *= uResolution.y / uResolution.x;
      sUv = c + d;
    } else {
      // Log polar
      vec2 d = vUv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = log(length(d) * 2.0 + 1.0);
      float a = atan(d.y, d.x) / 6.28318 + 0.5;
      a = fract(a + uRotation / 360.0);
      sUv = vec2(a, r * uZoom);
    }

    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec4 mapped = texture2D(uTexture, sUv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, uMix), src.a);
  }
`,_i=`
  uniform sampler2D uTexture;
  uniform float uBlockSize;     // 4-32
  uniform float uQuality;       // 0-1 (low=more artifacts)
  uniform float uChromaSubsample; // 0-1
  uniform float uBlockNoise;    // 0-1 random per-block jitter
  uniform float uMode;          // 0=DCT-style block, 1=hard 8x8, 2=color banding
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec3 rgb2ycbcr(vec3 c) {
    return vec3(
       0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
      -0.169 * c.r - 0.331 * c.g + 0.5   * c.b + 0.5,
       0.5   * c.r - 0.419 * c.g - 0.081 * c.b + 0.5
    );
  }
  vec3 ycbcr2rgb(vec3 c) {
    float y = c.x; float cb = c.y - 0.5; float cr = c.z - 0.5;
    return vec3(y + 1.402 * cr, y - 0.344 * cb - 0.714 * cr, y + 1.772 * cb);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uMix < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    float bs = max(2.0, uBlockSize);
    vec2 px = vUv * uResolution;

    // Find block center
    vec2 blockId = floor(px / bs);
    vec2 blockCenter = (blockId + 0.5) * bs / uResolution;

    // Sample block average (proxy for low-frequency component)
    vec3 avg = vec3(0.0);
    int s = 0;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        vec2 sp = (blockId * bs + vec2(float(x), float(y)) * bs * 0.25) / uResolution;
        avg += texture2D(uTexture, sp).rgb;
        s++;
      }
    }
    avg /= float(s);

    vec3 result;
    if (mode == 0 || mode == 1) {
      // Quantize per block
      float qStep = mix(0.01, 0.2, 1.0 - uQuality);
      vec3 quant = floor(src.rgb / qStep) * qStep;
      // Mix block average with quantized
      float blockBias = (mode == 1) ? 0.65 : 0.45;
      result = mix(quant, avg, blockBias * (1.0 - uQuality));

      // Block-noise jitter
      if (uBlockNoise > 0.001) {
        float bn = (hash21(blockId) - 0.5) * uBlockNoise * 0.15;
        result += vec3(bn);
      }
    } else {
      // Color banding (luma-preserving bit reduction in chroma)
      vec3 ycc = rgb2ycbcr(src.rgb);
      float yStep = mix(0.005, 0.05, 1.0 - uQuality);
      ycc.x = floor(ycc.x / yStep) * yStep;
      float cStep = mix(0.02, 0.2, 1.0 - uQuality);
      ycc.yz = floor(ycc.yz / cStep) * cStep;
      result = ycbcr2rgb(ycc);
    }

    // Chroma subsample
    if (uChromaSubsample > 0.001) {
      vec3 subYcc = rgb2ycbcr(avg);
      vec3 hereYcc = rgb2ycbcr(result);
      hereYcc.yz = mix(hereYcc.yz, subYcc.yz, uChromaSubsample);
      result = ycbcr2rgb(hereYcc);
    }

    gl_FragColor = vec4(mix(src.rgb, clamp(result, 0.0, 1.0), uMix), src.a);
  }
`,Vi=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=DIT exposure, 1=zone heat, 2=Resolve, 3=histogram
  uniform float uMix;           // 0-1
  uniform float uShowOriginal;  // 0-1 fade overlay vs replace
  uniform float uMidpoint;      // 0-1 reference midtone (0.5 default)
  uniform float uRange;         // 0.05-0.5 zone width
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 ditExposure(float l) {
    if (l < 0.04) return vec3(0.5, 0, 0.7);  // Purple — clip black
    if (l < 0.18) return vec3(0, 0, 0.9);    // Blue — shadows
    if (l < 0.42) return vec3(0, 0.8, 0.6);  // Teal — low-mid
    if (l < 0.55) return vec3(0.4, 0.8, 0);  // Green — midtone (safe)
    if (l < 0.7)  return vec3(1, 1, 0);      // Yellow — high-mid
    if (l < 0.92) return vec3(1, 0.5, 0);    // Orange — highlights
    return vec3(1, 0, 0);                    // Red — clip white
  }

  vec3 zoneHeat(float l) {
    // Adams zone system 0-X mapped to 7-color gradient
    float n = l;
    return mix(
      mix(vec3(0,0,0.5), vec3(0,0.7,1), smoothstep(0.0, 0.4, n)),
      mix(vec3(0,1,0), vec3(1,1,0), smoothstep(0.4, 0.7, n)),
      smoothstep(0.4, 0.55, n)
    ) + smoothstep(0.85, 1.0, n) * vec3(1, 0.2, 0);
  }

  vec3 resolveStyle(float l) {
    // Two-color highlight/shadow warning (blue = underexposed, red = overexposed)
    if (l < 0.05) return vec3(0, 0, 1);
    if (l > 0.95) return vec3(1, 0, 0);
    return vec3(l); // grayscale otherwise
  }

  vec3 histogramStripes(float l) {
    // Map exposure to rainbow stripes for histogram-style preview
    float h = l;
    return vec3(
      sin(h * 9.42) * 0.5 + 0.5,
      sin(h * 9.42 + 2.094) * 0.5 + 0.5,
      sin(h * 9.42 + 4.189) * 0.5 + 0.5
    );
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    int mode = int(uMode + 0.5);
    vec3 fc;
    if (mode == 0) fc = ditExposure(l);
    else if (mode == 1) fc = zoneHeat(l);
    else if (mode == 2) fc = resolveStyle(l);
    else fc = histogramStripes(l);

    // Highlight zones around midpoint
    if (uRange > 0.001) {
      float zoneMask = smoothstep(uRange, 0.0, abs(l - uMidpoint));
      fc = mix(fc, vec3(0, 1, 0), zoneMask * 0.4); // green tint on safe zone
    }

    vec3 result = mix(src.rgb, fc, uShowOriginal);
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,Wi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 shadow lift
  uniform float uThreshold;     // 0-1 shadow zone
  uniform float uSoftness;      // 0-1 transition softness
  uniform float uColorRecovery; // 0-1 boost saturation in shadows
  uniform float uHighlightProtect; // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    // Shadow weight: 1 at black, 0 above threshold (with softness)
    float w = 1.0 - smoothstep(uThreshold, uThreshold + uSoftness + 0.001, l);

    // Lift formula: pull shadows toward midtone using a power curve
    float liftPow = mix(1.0, 0.45, uAmount);
    vec3 lifted = pow(max(src.rgb, 0.0001), vec3(liftPow));

    // Highlight protect — fade lift back near 1.0
    float highW = smoothstep(0.7, 1.0, l);
    float effW = w * (1.0 - highW * uHighlightProtect);
    vec3 result = mix(src.rgb, lifted, effW);

    // Optional color recovery (boost saturation in lifted shadows)
    if (uColorRecovery > 0.001) {
      float rl = luma(result);
      vec3 boosted = mix(vec3(rl), result, 1.0 + uColorRecovery * 0.6);
      result = mix(result, boosted, effW);
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`,qi=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 rolloff strength
  uniform float uThreshold;     // 0-1 where rolloff begins
  uniform float uSoftness;      // 0-1
  uniform float uPreserveHue;   // 0-1 preserve hue while rolling off
  uniform float uMaxValue;      // 0.7-1.5 ceiling for compressed highlights
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 hueAwareRolloff(vec3 src, float threshold, float maxV, float amount) {
    float l = luma(src);
    // Rolloff curve: hyperbolic compress
    float over = max(0.0, l - threshold);
    float compressed = threshold + over / (1.0 + over * (4.0 * amount));
    compressed = min(compressed, maxV);
    float scale = (l > 0.001) ? compressed / l : 1.0;
    return src * scale;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    float w = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness * 0.5 + 0.001, l);

    vec3 rolledHue = hueAwareRolloff(src.rgb, uThreshold, uMaxValue, uAmount);
    vec3 rolledRgb = vec3(
      min(src.r, mix(src.r, uThreshold + (src.r - uThreshold) / (1.0 + (src.r - uThreshold) * 4.0 * uAmount), w)),
      min(src.g, mix(src.g, uThreshold + (src.g - uThreshold) / (1.0 + (src.g - uThreshold) * 4.0 * uAmount), w)),
      min(src.b, mix(src.b, uThreshold + (src.b - uThreshold) / (1.0 + (src.b - uThreshold) * 4.0 * uAmount), w))
    );
    vec3 result = mix(rolledRgb, rolledHue, uPreserveHue);

    gl_FragColor = vec4(mix(src.rgb, result, uMix * w), src.a);
  }
`,Yi=`
  uniform sampler2D uTexture;
  uniform float uCellSize;      // 4-32 px
  uniform float uContrast;      // 0-2
  uniform float uColorMix;      // 0-1 keep colour
  uniform float uMode;          // 0=density, 1=stipple, 2=block, 3=line
  uniform float uInvert;        // 0/1
  uniform float uTintR;         // 0-1
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Approximate ASCII density via geometric primitives
  float charShape(vec2 cellUv, float density, int mode) {
    vec2 cu = cellUv - 0.5;
    float r = length(cu);
    if (mode == 0) {
      // Density: ramp through circle/dot/cross/dense
      if (density < 0.1) return 0.0; // .
      if (density < 0.25) return smoothstep(0.45, 0.35, r); // ·
      if (density < 0.45) return smoothstep(0.35, 0.25, r); // o
      if (density < 0.65) return max(smoothstep(0.05, 0.0, abs(cu.x)), smoothstep(0.05, 0.0, abs(cu.y))); // +
      if (density < 0.85) return smoothstep(0.45, 0.0, abs(cu.x) + abs(cu.y) - 0.4); // #
      return 1.0; // @
    } else if (mode == 1) {
      // Stipple: random dots scaled by density
      float h = hash21(floor(cellUv * 8.0));
      return step(1.0 - density, h);
    } else if (mode == 2) {
      // Solid block proportional to density
      return step(1.0 - density, 1.0);
    } else {
      // Line/diagonal hatching
      float ang = density * 3.14;
      float v = abs(sin((cu.x * cos(ang) + cu.y * sin(ang)) * 12.0));
      return step(1.0 - density, v);
    }
  }

  void main() {
    vec2 cell = floor(vUv * uResolution / uCellSize);
    vec2 cellOrigin = cell * uCellSize / uResolution;
    vec2 cellSize = vec2(uCellSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize;

    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    float l = luma(sampleCol);
    if (uInvert > 0.5) l = 1.0 - l;
    l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);

    float v = charShape(cellUv, l, int(uMode + 0.5));

    vec3 inkColor = mix(vec3(uTintR, uTintG, uTintB), sampleCol, uColorMix);
    vec3 result = vec3(v) * inkColor;
    gl_FragColor = vec4(result, 1.0);
  }
`,Xi=`
  uniform sampler2D uTexture;
  uniform float uInkStrength;   // 0-2
  uniform float uInkThreshold;  // 0-1
  uniform float uPosterize;     // 2-12 levels
  uniform float uHalftoneShadow;// 0-1
  uniform float uHalftoneSize;  // 2-16
  uniform float uColorMix;      // 0-1
  uniform float uInkR;
  uniform float uInkG;
  uniform float uInkB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec3 src = texture2D(uTexture, vUv).rgb;

    // Sobel edges on luma
    float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1, -1)).rgb);
    float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0, -1)).rgb);
    float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1, -1)).rgb);
    float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1,  0)).rgb);
    float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1,  0)).rgb);
    float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1,  1)).rgb);
    float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0,  1)).rgb);
    float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1,  1)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = clamp(length(vec2(gx, gy)) * uInkStrength, 0.0, 1.0);
    float ink = step(uInkThreshold, edge);

    // Posterize
    float steps = max(2.0, uPosterize);
    vec3 quant = floor(src * steps + 0.5) / steps;
    vec3 colored = mix(quant, src, uColorMix);

    // Halftone shadow overlay
    if (uHalftoneShadow > 0.001) {
      float l = luma(quant);
      vec2 px = vUv * uResolution / uHalftoneSize;
      vec2 cell = fract(px) - 0.5;
      float dot = smoothstep(0.45, 0.4, length(cell)) * (1.0 - l);
      colored *= 1.0 - dot * uHalftoneShadow;
    }

    vec3 result = mix(colored, vec3(uInkR, uInkG, uInkB), ink);
    gl_FragColor = vec4(result, 1.0);
  }
`,Ki=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1
  uniform float uFrequency;     // 1-200 line frequency
  uniform float uSpeed;         // 0-3
  uniform float uWaveform;      // 0=sin, 1=noise, 2=sawtooth
  uniform float uChromaSplit;   // 0-1
  uniform float uChunkiness;    // 0-1 hold for N rows
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash11(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    if (uIntensity < 0.001) { gl_FragColor = texture2D(uTexture, vUv); return; }

    int wf = int(uWaveform + 0.5);
    float yLine = vUv.y;
    if (uChunkiness > 0.001) {
      float chunk = mix(1.0, 32.0, uChunkiness);
      yLine = floor(vUv.y * uResolution.y / chunk) * chunk / uResolution.y;
    }
    float t = uTime * uSpeed;
    float drift;
    if (wf == 0) drift = sin(yLine * uFrequency + t);
    else if (wf == 1) drift = (hash11(floor(yLine * uFrequency) + floor(t * 8.0)) - 0.5) * 2.0;
    else drift = mod(yLine * uFrequency + t, 1.0) * 2.0 - 1.0;
    drift *= uIntensity * 0.05;

    vec3 col;
    if (uChromaSplit > 0.001) {
      float r = texture2D(uTexture, vec2(vUv.x + drift * (1.0 + uChromaSplit * 0.3), vUv.y)).r;
      float g = texture2D(uTexture, vec2(vUv.x + drift, vUv.y)).g;
      float b = texture2D(uTexture, vec2(vUv.x + drift * (1.0 - uChromaSplit * 0.3), vUv.y)).b;
      col = vec3(r, g, b);
    } else {
      col = texture2D(uTexture, vec2(vUv.x + drift, vUv.y)).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Ni=`
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uLength;        // 0-1 stripe length
  uniform float uColor;         // 0=white, 1=mono, 2=glitch hue
  uniform float uSpeed;         // 0-3
  uniform float uNoiseAmp;      // 0-1
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    float t = floor(uTime * uSpeed * 8.0) / 8.0;
    float yBucket = floor(vUv.y * 80.0);
    float trigger = hash21(vec2(yBucket, t));
    float lenH = hash21(vec2(yBucket + 13.0, t));
    float startX = hash21(vec2(yBucket + 27.0, t));
    float length = uLength * mix(0.05, 0.5, lenH);

    float inStripe = step(1.0 - uDensity * 0.4, trigger)
                   * step(startX, vUv.x)
                   * step(vUv.x, startX + length);

    if (inStripe < 0.5) { gl_FragColor = src; return; }

    int colorMode = int(uColor + 0.5);
    float n = hash21(vec2(vUv.x * uResolution.x, t * 100.0));
    vec3 stripe;
    if (colorMode == 0) stripe = vec3(n);
    else if (colorMode == 1) stripe = vec3(n * 0.6 + 0.2);
    else {
      float hue = hash21(vec2(yBucket, t * 13.0));
      stripe = mix(vec3(1, 0, 0.4), vec3(0, 1, 0.6), hue);
      stripe = mix(stripe, vec3(0.4, 0.4, 1), n);
    }
    stripe = mix(stripe, src.rgb, 1.0 - uNoiseAmp);

    gl_FragColor = vec4(mix(src.rgb, stripe, uMix * inStripe), src.a);
  }
`,ji=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-3
  uniform float uRefraction;    // 0-1 distort source
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=overlay, 1=add, 2=screen
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  // Caustic via Voronoi ridge
  float caustic(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float minD1 = 9.0; float minD2 = 9.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(
          fract(sin(dot(i + g, vec2(127.1, 311.7))) * 43758.5453),
          fract(sin(dot(i + g, vec2(269.5, 183.3))) * 43758.5453)
        );
        o = 0.5 + 0.5 * sin(t + 6.28 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < minD1) { minD2 = minD1; minD1 = d; }
        else if (d < minD2) minD2 = d;
      }
    }
    return sqrt(minD2) - sqrt(minD1);
  }

  void main() {
    vec2 p = vUv * uScale;
    float t = uTime * uSpeed;
    float c1 = caustic(p, t);
    float c2 = caustic(p + 17.3, t * 1.3 + 1.7);
    float c = pow(min(c1, c2), 1.5) * uIntensity;

    vec2 sUv = vUv;
    if (uRefraction > 0.001) {
      sUv += vec2(c1 - c2, c2 - c1) * uRefraction * 0.04;
    }
    vec3 src = texture2D(uTexture, sUv).rgb;

    vec3 caustColor = vec3(uTintR, uTintG, uTintB) * c;
    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src + caustColor;
    else if (mode == 1) result = src + caustColor * 1.5;
    else result = 1.0 - (1.0 - src) * (1.0 - caustColor);

    gl_FragColor = vec4(result, texture2D(uTexture, vUv).a);
  }
`,$i=`
  uniform sampler2D uTexture;
  uniform float uTriggerTime;   // time when wave was triggered
  uniform float uSpeed;         // 0.1-3 expansion speed
  uniform float uAmplitude;     // 0-0.2 distortion strength
  uniform float uRingWidth;     // 0.01-0.5
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=looping continuous, 1=one-shot
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 shockOffset(vec2 uv, float waveTime) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float ringR = waveTime * uSpeed;
    float band = smoothstep(uRingWidth * 0.5, 0.0, abs(r - ringR));
    vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
    dir.x *= uResolution.y / uResolution.x;
    return dir * band * uAmplitude;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float waveTime;
    if (mode == 0) {
      // Looping
      waveTime = mod(uTime, 2.0 / max(0.1, uSpeed));
    } else {
      // One-shot
      waveTime = max(0.0, uTime - uTriggerTime);
    }

    vec2 baseOff = shockOffset(vUv, waveTime);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = shockOffset(vUv, waveTime + 0.05 * uChromatic);
      vec2 offB = shockOffset(vUv, waveTime - 0.05 * uChromatic);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Zi=`
  uniform sampler2D uTexture;
  uniform float uZoom;          // 1.05-3 per-iteration zoom
  uniform float uRotation;      // 0-360 per-iteration rotation
  uniform float uIterations;    // 1-12
  uniform float uOffsetX;       // 0-1
  uniform float uOffsetY;       // 0-1
  uniform float uFrameSize;     // 0-0.5 mask region as fraction of screen
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 c = vec2(uOffsetX, uOffsetY);
    int iters = int(clamp(uIterations, 1.0, 12.0));
    vec2 uv = vUv;
    float ang = radians(uRotation);

    // Iteratively zoom toward c by uZoom each time, until uv falls in frame mask
    for (int i = 0; i < 12; i++) {
      if (i >= iters) break;
      vec2 d = uv - c;
      float r = length(d - 0.5 + c);
      // If outside frame band, zoom in further
      if (r > uFrameSize) {
        d *= uZoom;
        // Rotate
        float ca = cos(ang), sa = sin(ang);
        d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        uv = c + d;
      }
    }
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec4 src = texture2D(uTexture, vUv);
    vec4 droste = texture2D(uTexture, uv);
    gl_FragColor = vec4(mix(src.rgb, droste.rgb, uMix), src.a);
  }
`,Ji=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1 displacement amount
  uniform float uMode;          // 0=horizontal slits, 1=vertical, 2=radial, 3=stretch
  uniform float uPattern;       // 0=linear sweep, 1=sine, 2=noise
  uniform float uSpeed;         // 0-3
  uniform float uChromaSplit;   // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash11(float n) { return fract(sin(n) * 43758.5453); }

  vec2 slitOffset(vec2 uv, float phaseShift) {
    int mode = int(uMode + 0.5);
    int pattern = int(uPattern + 0.5);
    float coord = (mode == 1) ? uv.x : uv.y;
    float t = uTime * uSpeed + phaseShift;
    float p;
    if (pattern == 0) p = coord + t * 0.3;
    else if (pattern == 1) p = sin(coord * 8.0 + t * 2.0);
    else p = (hash11(floor(coord * 50.0) + floor(t * 8.0)) - 0.5) * 2.0;
    vec2 off = vec2(0.0);
    if (mode == 0) off.x = p * uIntensity * 0.3;
    else if (mode == 1) off.y = p * uIntensity * 0.3;
    else if (mode == 2) {
      vec2 d = uv - 0.5;
      float r = length(d);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      off = dir * p * uIntensity * 0.3;
    } else {
      // Stretch: each row sampled at different progressive UV
      off.x = (uv.y - 0.5) * uIntensity * 0.5;
      off.y = sin(t + uv.x * 6.28) * uIntensity * 0.1;
    }
    return off;
  }

  void main() {
    vec2 baseOff = slitOffset(vUv, 0.0);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 offR = slitOffset(vUv, 0.3 * uChromaSplit);
      vec2 offB = slitOffset(vUv, -0.3 * uChromaSplit);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,Qi=`
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-2
  uniform float uHeightFalloff; // -1..1 (positive=sky fog, negative=ground fog)
  uniform float uDepthSim;      // 0-1 (use luma as fake depth)
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uTurbulence;    // 0-1
  uniform float uMode;          // 0=add, 1=mix, 2=subtract
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    vec2 p = vUv * uScale + vec2(uTime * uSpeed * 0.1, -uTime * uSpeed * 0.05);
    float fog = uTurbulence > 0.5 ? fbm(p) : vnoise(p);
    fog *= uDensity;

    // Height falloff
    float heightW = mix(1.0 - vUv.y, vUv.y, (uHeightFalloff + 1.0) * 0.5);
    fog *= heightW;

    // Depth-aware: brighter pixels = farther in fog (sim depth from luma)
    if (uDepthSim > 0.001) {
      float fakeDepth = 1.0 - luma(src.rgb);
      fog *= mix(1.0, fakeDepth, uDepthSim);
    }

    fog = clamp(fog, 0.0, 1.0);
    vec3 fogColor = vec3(uColorR, uColorG, uColorB);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src.rgb + fogColor * fog;
    else if (mode == 1) result = mix(src.rgb, fogColor, fog);
    else result = src.rgb - fogColor * fog * 0.5;

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,er=`
  uniform sampler2D uTexture;
  uniform float uType;          // 0=rain, 1=snow, 2=mist, 3=embers
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uAngle;         // -45..45 degrees wind
  uniform float uSize;          // 0.5-3 particle size
  uniform float uFogAmount;     // 0-1 fog wash
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    int type = int(uType + 0.5);

    vec2 wind = vec2(sin(radians(uAngle)), -cos(radians(uAngle))); // base downward
    if (type == 2) wind *= 0.3; // mist drifts
    if (type == 3) wind *= -0.6; // embers rise

    float t = uTime * uSpeed;
    float scale = (type == 1) ? 80.0 : (type == 2) ? 30.0 : (type == 3) ? 90.0 : 120.0;
    scale *= 1.0 / max(0.5, uSize);

    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;
    vec2 cellId = floor(p);
    float lifeTime = hash21(cellId) * 10.0;
    float phase = mod(t * 0.5 + lifeTime, 1.0);

    // Particle position within cell, drifted by wind
    vec2 cellUv = fract(p) - 0.5;
    cellUv -= wind * phase * 1.5;
    cellUv = vec2(cellUv.x, fract(cellUv.y + 0.5) - 0.5);

    float d = length(cellUv);
    float particle = 0.0;

    if (type == 0) {
      // Rain — vertical streak
      float streak = smoothstep(0.05, 0.0, abs(cellUv.x)) * smoothstep(0.5, 0.0, abs(cellUv.y));
      particle = streak;
    } else if (type == 1) {
      // Snow — soft circle
      particle = smoothstep(0.15, 0.0, d);
    } else if (type == 2) {
      // Mist — large soft puff
      particle = smoothstep(0.3, 0.0, d) * 0.5;
    } else {
      // Embers — bright dot with glow
      particle = smoothstep(0.05, 0.0, d) + smoothstep(0.2, 0.05, d) * 0.3;
    }

    // Spawn probability gated by density
    float spawn = step(1.0 - uDensity, hash21(cellId + 17.0));
    particle *= spawn;

    vec3 partColor = vec3(uColorR, uColorG, uColorB);
    vec3 result = src.rgb + partColor * particle;

    // Fog wash
    if (uFogAmount > 0.001) {
      result = mix(result, partColor * 0.5, uFogAmount * 0.4);
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,tr=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=stars, 1=bokeh, 2=sparkles, 3=fireflies, 4=dust
  uniform float uDensity;       // 0-1
  uniform float uSize;          // 0.5-4
  uniform float uSpeed;         // 0-3
  uniform float uTwinkle;       // 0-1
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBlend;         // 0=add, 1=screen
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    float scale = (mode == 0) ? 60.0 : (mode == 1) ? 25.0 : (mode == 2) ? 80.0 : (mode == 3) ? 35.0 : 100.0;
    scale *= 1.0 / max(0.5, uSize);
    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;
    vec2 cellId = floor(p);
    vec2 cellUv = fract(p) - 0.5;

    float spawn = step(1.0 - uDensity, hash21(cellId));
    if (spawn < 0.5) { gl_FragColor = src; return; }

    // Drift
    float t = uTime * uSpeed;
    vec2 drift = vec2(
      hash21(cellId + 7.3) - 0.5,
      hash21(cellId + 13.7) - 0.5
    ) * t * 0.05;
    cellUv -= drift;

    float d = length(cellUv);
    float particle = 0.0;
    if (mode == 0) {
      // Stars — small bright dot + cross flare
      particle = smoothstep(0.05, 0.0, d);
      particle += smoothstep(0.02, 0.0, abs(cellUv.x)) * smoothstep(0.3, 0.0, abs(cellUv.y)) * 0.5;
      particle += smoothstep(0.02, 0.0, abs(cellUv.y)) * smoothstep(0.3, 0.0, abs(cellUv.x)) * 0.5;
    } else if (mode == 1) {
      // Bokeh — soft disc
      particle = smoothstep(0.4, 0.1, d) * 0.6 + smoothstep(0.45, 0.4, d) * 0.4;
    } else if (mode == 2) {
      // Sparkles — bright pinpoint
      particle = smoothstep(0.04, 0.0, d) * 1.5;
    } else if (mode == 3) {
      // Fireflies — flickering soft glow
      particle = smoothstep(0.15, 0.0, d) * 0.8;
    } else {
      // Dust — many tiny specks
      particle = smoothstep(0.025, 0.0, d) * 0.6;
    }

    // Twinkle
    if (uTwinkle > 0.001) {
      float blink = sin(t * 4.0 + hash21(cellId) * 6.28) * 0.5 + 0.5;
      particle *= mix(1.0, blink, uTwinkle);
    }

    vec3 partColor = vec3(uColorR, uColorG, uColorB);
    int blendMode = int(uBlend + 0.5);
    vec3 result;
    if (blendMode == 0) {
      result = src.rgb + partColor * particle;
    } else {
      result = 1.0 - (1.0 - src.rgb) * (1.0 - partColor * particle);
    }
    gl_FragColor = vec4(result, src.a);
  }
`,or=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uThreshold;     // 0-1
  uniform float uLength;        // 0-1
  uniform float uPoints;        // 4-12 star points
  uniform float uRotation;      // 0-360
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int points = int(clamp(uPoints, 2.0, 12.0)) * 2;
    float maxLen = uLength * 0.15;
    vec2 texel = 1.0 / uResolution;

    vec3 burst = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      if (i >= points) break;
      float ang = radians(uRotation) + float(i) * 6.28318 / float(points);
      vec2 dir = vec2(cos(ang), sin(ang));
      // March along ray
      for (int s = 1; s <= 12; s++) {
        float t = float(s) / 12.0;
        vec2 sp = vUv + dir * maxLen * t;
        vec3 sc = texture2D(uTexture, sp).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sc));
        burst += sc * gate * (1.0 - t) * (1.0 - t);
      }
    }
    burst /= float(points);
    burst *= uIntensity * vec3(uColorR, uColorG, uColorB);

    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - burst);
    gl_FragColor = vec4(result, src.a);
  }
`,ar=`
  uniform sampler2D uTexture;
  uniform float uStrength;      // 0-3
  uniform float uAngle;         // 0-360
  uniform float uHeight;        // 0-4
  uniform float uDetail;        // 0-2 sample radius
  uniform float uSpecular;      // 0-1
  uniform float uColorPreserve; // 0-1
  uniform float uAmbient;       // 0-1 base brightness
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float d = max(1.0, uDetail);

    // Build height field from high-pass filter
    vec3 c = texture2D(uTexture, vUv).rgb;
    vec3 ll = texture2D(uTexture, vUv + texel * vec2(-d, 0)).rgb;
    vec3 rr = texture2D(uTexture, vUv + texel * vec2( d, 0)).rgb;
    vec3 tt = texture2D(uTexture, vUv + texel * vec2( 0, d)).rgb;
    vec3 bb = texture2D(uTexture, vUv + texel * vec2( 0,-d)).rgb;

    float h0 = luma(c);
    float gx = (luma(rr) - luma(ll)) * uHeight;
    float gy = (luma(tt) - luma(bb)) * uHeight;

    // Surface normal
    vec3 N = normalize(vec3(-gx, -gy, 1.0));
    float ang = radians(uAngle);
    vec3 L = normalize(vec3(cos(ang), sin(ang), 0.7));
    float diff = max(0.0, dot(N, L));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(N, H)), 32.0) * uSpecular;

    float lit = uAmbient + diff * uStrength + spec;
    vec3 surfaceColor = mix(vec3(h0), c, uColorPreserve);
    vec3 result = surfaceColor * lit;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,ir=`
  uniform sampler2D uTexture;
  uniform float uDotSize;       // 4-32
  uniform float uDotShape;      // 0=circle, 1=square, 2=hex
  uniform float uGap;           // 0-1 gap between dots
  uniform float uPosterize;     // 1-8 quantize per channel
  uniform float uGlow;          // 0-1
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 cell = floor(vUv * uResolution / uDotSize);
    vec2 cellOrigin = cell * uDotSize / uResolution;
    vec2 cellSize = vec2(uDotSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;

    int shape = int(uDotShape + 0.5);
    float dotR = mix(0.45, 0.5 - uGap * 0.5, 0.5);
    float mask;
    if (shape == 0) {
      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(cellUv));
    } else if (shape == 1) {
      vec2 ad = abs(cellUv);
      mask = smoothstep(dotR + 0.02, dotR - 0.02, max(ad.x, ad.y));
    } else {
      // Hex
      vec2 ad = abs(cellUv);
      float hex = max(ad.x * 0.866 + ad.y * 0.5, ad.y);
      mask = smoothstep(dotR + 0.02, dotR - 0.02, hex);
    }

    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    if (uPosterize > 1.001) {
      float steps = max(1.0, uPosterize);
      sampleCol = floor(sampleCol * steps + 0.5) / steps;
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(bg, sampleCol, mask);

    // Glow halo
    if (uGlow > 0.001) {
      float halo = smoothstep(0.7, 0.45, length(cellUv));
      result += sampleCol * halo * uGlow * 0.4;
    }
    gl_FragColor = vec4(result, 1.0);
  }
`,rr=`
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uCellSize;      // 6-32
  uniform float uTrailLength;   // 0-1
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBgMix;         // 0-1 keep underlying frame
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Fake glyph: bit pattern within sub-grid
  float glyph(vec2 cellUv, float seed) {
    vec2 g = floor(cellUv * 5.0);
    float bit = hash21(g + seed * 13.0);
    return step(0.55, bit);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;

    vec2 px = vUv * uResolution / uCellSize;
    vec2 col = floor(px);
    vec2 cellUv = fract(px);
    // Column-specific speed and seed
    float colSeed = hash21(vec2(col.x, 0.0));
    float fallSpeed = (0.5 + colSeed * 1.5) * uSpeed;
    float trailHead = mod(uTime * fallSpeed - colSeed * 50.0, uResolution.y / uCellSize + 30.0);
    float dist = trailHead - col.y;

    float trailLen = max(2.0, uTrailLength * 30.0);
    float intensity = 0.0;
    if (dist > 0.0 && dist < trailLen) {
      intensity = (1.0 - dist / trailLen);
      intensity *= step(1.0 - uDensity, hash21(col + floor(uTime * fallSpeed * 0.05)));
    }
    if (dist >= 0.0 && dist < 1.0) intensity = 1.5; // bright head

    // Glyph mask (changes over time for rain feel)
    float glyphSeed = hash21(col + floor(uTime * fallSpeed * 0.5 + col.y * 0.1));
    float gMask = glyph(cellUv, glyphSeed);

    vec3 rainColor = vec3(uColorR, uColorG, uColorB) * intensity * gMask;
    vec3 result = mix(rainColor, src + rainColor, uBgMix);
    gl_FragColor = vec4(result, 1.0);
  }
`,lr=`
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uCellSize;      // 6-32
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBgMix;         // 0-1
  uniform float uContrast;      // 0-2 source pixel modulates char visibility
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Crude '0' / '1' mask
  float charZero(vec2 uv) {
    vec2 c = uv - 0.5;
    float r = length(c * vec2(1.0, 0.7));
    return smoothstep(0.42, 0.38, r) - smoothstep(0.30, 0.26, r);
  }
  float charOne(vec2 uv) {
    vec2 c = uv - 0.5;
    float bar = step(abs(c.x + 0.05), 0.05) * step(abs(c.y), 0.4);
    float foot = step(abs(c.y + 0.4), 0.05) * step(abs(c.x), 0.2);
    return max(bar, foot);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 px = vUv * uResolution / uCellSize;
    vec2 col = floor(px);
    vec2 cellUv = fract(px);
    float t = uTime * uSpeed;
    // Each column scrolls up at its own speed
    float colSeed = hash21(vec2(col.x, 0.0));
    float yOff = floor(t + colSeed * 50.0);
    float charSeed = hash21(vec2(col.x, col.y + yOff));
    float bit = step(0.5, charSeed);

    float charMask = bit > 0.5 ? charOne(cellUv) : charZero(cellUv);
    float spawn = step(1.0 - uDensity, hash21(col + yOff * 0.137));
    charMask *= spawn;
    // Tie character brightness to underlying source luma
    float srcL = luma(texture2D(uTexture, (col + 0.5) * uCellSize / uResolution).rgb);
    charMask *= mix(1.0, srcL, uContrast * 0.5);

    vec3 charColor = vec3(uColorR, uColorG, uColorB) * charMask;
    vec3 result = mix(charColor, src + charColor, uBgMix);
    gl_FragColor = vec4(result, 1.0);
  }
`,ur=`
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uAngle;         // 0-180
  uniform float uLineWidth;     // 0.5-4
  uniform float uContrast;      // 0-2
  uniform float uPaperR;
  uniform float uPaperG;
  uniform float uPaperB;
  uniform float uInkR;
  uniform float uInkG;
  uniform float uInkB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  float hatchLine(vec2 uv, float ang, float spacing, float width) {
    float c = cos(ang); float s = sin(ang);
    float v = uv.x * c + uv.y * s;
    return smoothstep(width, width * 0.5, abs(fract(v / spacing) - 0.5));
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);

    vec2 px = vUv * uResolution;
    float spacing = 8.0 / uDensity;
    float w = 0.5 / spacing * max(0.5, uLineWidth);
    float baseAng = radians(uAngle);

    // Build cross-hatching
    float h = 0.0;
    if (l < 0.85) h = max(h, hatchLine(px, baseAng,            spacing,       w));
    if (l < 0.65) h = max(h, hatchLine(px, baseAng + 1.5708,   spacing * 0.9, w));
    if (l < 0.45) h = max(h, hatchLine(px, baseAng + 0.7854,   spacing * 0.8, w));
    if (l < 0.25) h = max(h, hatchLine(px, baseAng + 2.3562,   spacing * 0.7, w));

    vec3 paper = vec3(uPaperR, uPaperG, uPaperB);
    vec3 ink = vec3(uInkR, uInkG, uInkB);
    vec3 result = mix(paper, ink, h);
    gl_FragColor = vec4(result, 1.0);
  }
`,nr=`
  uniform sampler2D uTexture;
  uniform float uTileSize;      // 8-64
  uniform float uMode;          // 0=square, 1=voronoi, 2=hex, 3=brick
  uniform float uGrout;         // 0-1
  uniform float uColorJitter;   // 0-1
  uniform float uGroutR;
  uniform float uGroutG;
  uniform float uGroutB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 px = vUv * uResolution / uTileSize;
    vec2 cell;
    vec2 cellUv;
    if (mode == 0) {
      cell = floor(px);
      cellUv = fract(px) - 0.5;
    } else if (mode == 1) {
      vec2 i = floor(px);
      vec2 f = fract(px);
      vec2 best = vec2(0.0);
      float minD = 9.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { minD = d; best = i + g; cellUv = r; }
        }
      }
      cell = best;
    } else if (mode == 2) {
      // Hex
      vec2 q = vec2(px.x * 1.1547, px.y);
      q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cell = vec2(i.x - floor(i.y / 2.0), i.y);
      cellUv = fract(q) - 0.5;
    } else {
      // Brick
      vec2 q = px;
      float row = floor(q.y);
      q.x += mod(row, 2.0) * 0.5;
      cell = vec2(floor(q.x), row);
      cellUv = fract(q) - 0.5;
    }

    vec2 cellCenter = (cell + 0.5) * uTileSize / uResolution;
    vec3 tileCol = texture2D(uTexture, cellCenter).rgb;

    // Grout band
    float dist = (mode == 1) ? sqrt(length(cellUv)) : max(abs(cellUv.x), abs(cellUv.y));
    float grout = step(0.5 - uGrout * 0.5, dist);

    // Color jitter
    if (uColorJitter > 0.001) {
      vec3 j = vec3(hash21(cell), hash21(cell + 7.3), hash21(cell + 13.7)) - 0.5;
      tileCol += j * uColorJitter * 0.4;
    }
    vec3 groutCol = vec3(uGroutR, uGroutG, uGroutB);
    vec3 result = mix(tileCol, groutCol, grout);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,sr=`
  uniform sampler2D uTexture;
  uniform float uSpeed;         // 0-3
  uniform float uTwist;         // 0-3
  uniform float uTunnelDepth;   // 0.5-3
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uMode;          // 0=cylinder, 1=funnel, 2=square
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 tunnelMap(vec2 uv, float zOffset) {
    int mode = int(uMode + 0.5);
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float a = atan(d.y, d.x);
    a += uTwist * (uTime * uSpeed * 0.5);
    float depthScale = (mode == 1) ? r * uTunnelDepth : uTunnelDepth;
    float z = (uTime * uSpeed + zOffset) / max(0.05, r * depthScale);
    if (mode == 2) {
      // Square cross-section
      vec2 sq = abs(d);
      float side = max(sq.x, sq.y);
      r = side;
      z = (uTime * uSpeed + zOffset) / max(0.05, r);
    }
    vec2 sUv = vec2(a / 6.28318 + 0.5, fract(z));
    return sUv;
  }

  void main() {
    vec2 baseUv = tunnelMap(vUv, 0.0);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 uvR = tunnelMap(vUv, 0.05 * uChromatic);
      vec2 uvB = tunnelMap(vUv, -0.05 * uChromatic);
      col.r = texture2D(uTexture, uvR).r;
      col.g = texture2D(uTexture, baseUv).g;
      col.b = texture2D(uTexture, uvB).b;
    } else {
      col = texture2D(uTexture, baseUv).rgb;
    }
    // Darken at far end
    vec2 c = vec2(uCenterX, uCenterY);
    float r = length(vUv - c);
    float fade = smoothstep(0.0, 0.7, r);
    col *= fade;
    gl_FragColor = vec4(col, 1.0);
  }
`,cr=`
  uniform sampler2D uTexture;
  uniform float uIterations;    // 1-12
  uniform float uShrink;        // 0.5-0.95 per-iter shrink
  uniform float uRotation;      // 0-360 per-iter
  uniform float uTintFade;      // 0-1
  uniform float uHueShift;      // 0-1 per-iter
  uniform float uMode;          // 0=center, 1=offset
  uniform float uOffsetX;
  uniform float uOffsetY;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    int iters = int(clamp(uIterations, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec2 c = (mode == 1) ? vec2(uOffsetX, uOffsetY) : vec2(0.5);
    vec3 acc = vec3(0.0);
    float weight = 0.0;
    float ang = radians(uRotation);
    float ca = cos(ang), sa = sin(ang);
    float scale = 1.0;
    float hueOff = 0.0;
    float tint = 1.0;

    for (int i = 0; i < 12; i++) {
      if (i >= iters) break;
      vec2 d = (vUv - c) / scale;
      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = c + d;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      acc += sCol * tint;
      weight += tint;
      scale *= uShrink;
      hueOff += uHueShift;
      tint *= 1.0 - uTintFade * 0.5;
    }
    vec3 result = acc / max(weight, 0.0001);
    gl_FragColor = vec4(result, 1.0);
  }
`,fr=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 0.5-16
  uniform float uOctaves;       // 2-6
  uniform float uSpeed;         // 0-3
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=fbm, 1=ridged, 2=hybrid
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p, int oct) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      v += vnoise(p) * amp; p *= 2.0; amp *= 0.5;
    }
    return v;
  }
  float ridged(vec2 p, int oct) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      v += (1.0 - abs(vnoise(p) - 0.5) * 2.0) * amp; p *= 2.0; amp *= 0.5;
    }
    return v;
  }

  vec2 warpOffset(vec2 uv, float t, float chromaShift) {
    int oct = int(clamp(uOctaves, 1.0, 6.0));
    int mode = int(uMode + 0.5);
    vec2 p = uv * uScale + t + chromaShift;
    float nx, ny;
    if (mode == 0) {
      nx = fbm(p, oct) - 0.5;
      ny = fbm(p + 31.7, oct) - 0.5;
    } else if (mode == 1) {
      nx = ridged(p, oct) - 0.5;
      ny = ridged(p + 31.7, oct) - 0.5;
    } else {
      nx = (fbm(p, oct) + ridged(p, oct)) * 0.5 - 0.5;
      ny = (fbm(p + 31.7, oct) + ridged(p + 31.7, oct)) * 0.5 - 0.5;
    }
    return vec2(nx, ny) * uAmount * 0.1;
  }

  void main() {
    float t = uTime * uSpeed * 0.2;
    vec2 baseOff = warpOffset(vUv, t, 0.0);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = warpOffset(vUv, t, uChromatic * 0.5);
      vec2 offB = warpOffset(vUv, t, -uChromatic * 0.5);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`,vr=`
  uniform sampler2D uTexture;
  uniform float uScale;         // 1-16
  uniform float uRefraction;    // 0-1 displacement
  uniform float uSparkle;       // 0-1
  uniform float uEdgeGlow;      // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=voronoi, 1=hex
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 p = vUv * uScale;
    vec2 cellCenter; float minD = 9.0; float secondD = 9.0;

    if (mode == 0) {
      vec2 i = floor(p), f = fract(p);
      vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          // Slight time wobble
          o = 0.5 + 0.45 * sin(uTime * 0.4 + 6.28 * o);
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { secondD = minD; minD = d; best = i + g; }
          else if (d < secondD) secondD = d;
        }
      }
      cellCenter = (best + 0.5) / uScale;
    } else {
      // Hex
      vec2 q = vec2(p.x * 1.1547, p.y); q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cellCenter = (vec2(i.x - floor(i.y / 2.0), i.y) + 0.5) / vec2(uScale * 1.1547, uScale);
      vec2 f = fract(q) - 0.5;
      minD = dot(f, f);
      secondD = minD + 0.3;
    }

    // Refraction: displace toward cell center
    vec2 dir = vUv - cellCenter;
    vec2 sUv = vUv - dir * uRefraction;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 col = texture2D(uTexture, sUv).rgb;

    // Edge glow (where two cells meet)
    float edge = smoothstep(0.04, 0.0, sqrt(secondD) - sqrt(minD));
    col += vec3(uTintR, uTintG, uTintB) * edge * uEdgeGlow;

    // Sparkle: bright dot at random cell centers
    if (uSparkle > 0.001) {
      float dCenter = length(vUv - cellCenter);
      float spark = step(1.0 - uSparkle * 0.3, hash21(floor(cellCenter * 100.0)));
      col += vec3(1.0) * smoothstep(0.04, 0.0, dCenter) * spark * uSparkle;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`,dr=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 1-16
  uniform float uSpeed;         // 0-3
  uniform float uTurbulence;    // 0-1
  uniform float uMode;          // 0=swirl, 1=push, 2=oil
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  vec2 curl(vec2 p) {
    float e = 0.05;
    float n1 = vnoise(p + vec2(0, e));
    float n2 = vnoise(p - vec2(0, e));
    float n3 = vnoise(p + vec2(e, 0));
    float n4 = vnoise(p - vec2(e, 0));
    return vec2(n1 - n2, -(n3 - n4));
  }

  void main() {
    vec2 p = vUv * uScale + uTime * uSpeed * 0.1;
    vec2 c = curl(p);
    if (uTurbulence > 0.001) c += curl(p * 2.0 + 13.7) * uTurbulence * 0.5;

    int mode = int(uMode + 0.5);
    vec2 off;
    if (mode == 0) off = c * uAmount * 0.1;
    else if (mode == 1) {
      vec2 d = vUv - 0.5;
      off = (c + normalize(d + 1e-6) * 0.3) * uAmount * 0.08;
    } else {
      // Oil — strong, clamped to range
      off = clamp(c, vec2(-0.5), vec2(0.5)) * uAmount * 0.15;
    }

    vec4 col = texture2D(uTexture, vUv + off);
    gl_FragColor = col;
  }
`,mr=`
  uniform sampler2D uTexture;
  uniform float uPullStrength;  // 0-1
  uniform float uRotation;      // 0-3 rotation per radius
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uTwist;         // 0-3
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-2
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 wormholeMap(vec2 uv, float chromaShift) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float ang = atan(d.y, d.x);
    // Twist proportional to inverse radius
    ang += uTwist / max(0.05, r) + uTime * uAnimSpeed * 0.3 + chromaShift;
    // Pull toward center
    r *= mix(1.0, 0.5 + 0.5 * (r * r), uPullStrength);
    d = vec2(cos(ang), sin(ang)) * r;
    d.x *= uResolution.y / uResolution.x;
    return c + d;
  }

  void main() {
    vec3 col;
    vec2 baseUv = wormholeMap(vUv, 0.0);
    if (uChromatic > 0.001) {
      vec2 uvR = wormholeMap(vUv, uChromatic * 0.1);
      vec2 uvB = wormholeMap(vUv, -uChromatic * 0.1);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(baseUv, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(baseUv, vec2(0.0), vec2(1.0))).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`,pr=`
  uniform sampler2D uTexture;
  uniform float uTiles;         // 1-16
  uniform float uMode;          // 0=mirror, 1=rotate, 2=tile, 3=quilt
  uniform float uRotation;      // 0-360
  uniform float uOffsetX;       // 0-1 per-row offset
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 t = vUv * uTiles;
    vec2 cell = floor(t);
    vec2 cellUv = fract(t);

    if (mode == 0) {
      // Mirror — flip alternating
      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;
      if (mod(cell.y, 2.0) > 0.5) cellUv.y = 1.0 - cellUv.y;
    } else if (mode == 1) {
      // Rotate — alternate cells rotated
      float rot = mod(cell.x + cell.y, 2.0) * radians(uRotation);
      vec2 d = cellUv - 0.5;
      float c = cos(rot), s = sin(rot);
      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;
    } else if (mode == 2) {
      // Tile — straight repeat with row offset
      cellUv.x += mod(cell.y, 2.0) * uOffsetX;
      cellUv = fract(cellUv);
    } else {
      // Quilt — mix of mirror + rotate
      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;
      float rot = mod(cell.y, 2.0) * radians(uRotation);
      vec2 d = cellUv - 0.5;
      float c = cos(rot), s = sin(rot);
      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;
    }
    cellUv = clamp(cellUv, vec2(0.0), vec2(1.0));
    vec4 src = texture2D(uTexture, vUv);
    vec4 tiled = texture2D(uTexture, cellUv);
    gl_FragColor = vec4(mix(src.rgb, tiled.rgb, uMix), src.a);
  }
`,hr=`
  uniform sampler2D uTexture;
  uniform float uLength;        // 0-1
  uniform float uAngle;         // 0-360
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1
  uniform float uChromaSplit;   // 0-1
  uniform float uMode;          // 0=fade, 1=copy
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uLength < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 4.0, 32.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 step = dir * uLength * 0.3;

    vec3 acc = src.rgb;
    float wsum = 1.0;
    for (int i = 1; i <= 32; i++) {
      if (i > samples) break;
      float t = float(i) / float(samples);
      vec2 sUv = vUv + step * t;
      vec3 sCol;
      if (uChromaSplit > 0.001) {
        sCol.r = texture2D(uTexture, sUv + dir * t * uChromaSplit * 0.02).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - dir * t * uChromaSplit * 0.02).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      float w = (uMode > 0.5) ? 1.0 : pow(1.0 - t, max(0.5, uFalloff * 4.0));
      acc += sCol * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, src.a);
  }
`,gr=`
  uniform sampler2D uTexture;
  uniform float uCount;         // 1-12
  uniform float uOffsetX;       // -0.5..0.5 per-step
  uniform float uOffsetY;       // -0.5..0.5
  uniform float uDecay;         // 0.5-0.95 per-step
  uniform float uHueShift;      // 0-1
  uniform float uMode;          // 0=add, 1=screen, 2=replace
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    int count = int(clamp(uCount, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec3 acc = texture2D(uTexture, vUv).rgb;
    vec2 off = vec2(uOffsetX, uOffsetY);
    float opacity = uDecay;
    float hueOff = uHueShift;

    for (int i = 1; i < 12; i++) {
      if (i >= count) break;
      vec2 sUv = vUv - off * float(i);
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      sCol *= opacity;
      if (mode == 0) acc += sCol;
      else if (mode == 1) acc = 1.0 - (1.0 - acc) * (1.0 - sCol);
      else acc = mix(acc, sCol, opacity);
      opacity *= uDecay;
      hueOff += uHueShift;
    }
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  }
`,xr=`
  uniform sampler2D uTexture;
  uniform float uOpacity;       // 0-1
  uniform float uOffsetX;       // -0.3..0.3
  uniform float uOffsetY;       // -0.3..0.3
  uniform float uMirror;        // 0/1 (mirror the ghost)
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uBlend;         // 0=screen, 1=add, 2=multiply
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 ghostUv = vUv - vec2(uOffsetX, uOffsetY);
    if (uMirror > 0.5) ghostUv.x = 1.0 - ghostUv.x;
    ghostUv = clamp(ghostUv, vec2(0.0), vec2(1.0));
    vec3 ghost = texture2D(uTexture, ghostUv).rgb * vec3(uTintR, uTintG, uTintB) * uOpacity;

    int mode = int(uBlend + 0.5);
    vec3 result;
    if (mode == 0) result = 1.0 - (1.0 - src) * (1.0 - ghost);
    else if (mode == 1) result = src + ghost;
    else result = src * (1.0 + ghost);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,br=`
  uniform sampler2D uTexture;
  uniform float uRate;          // 0.5-30 Hz
  uniform float uDuty;           // 0-1 fraction of cycle bright
  uniform float uIntensity;     // 0-2
  uniform float uMode;          // 0=on/off, 1=invert flash, 2=tint flash
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float phase = mod(uTime * uRate, 1.0);
    float gate = step(phase, uDuty);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      result = mix(src, src + vec3(uIntensity * gate), gate);
    } else if (mode == 1) {
      result = mix(src, 1.0 - src, gate * uIntensity);
    } else {
      vec3 tint = vec3(uTintR, uTintG, uTintB);
      result = mix(src, src * tint + tint * 0.4, gate * uIntensity);
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,yr=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uThreshold;     // 0-1 luma gate
  uniform float uTrailLength;   // 0-1
  uniform float uFlowAngle;     // 0-360 dominant flow direction
  uniform float uFlowScale;     // 1-16 noise warp scale
  uniform float uChromaShift;   // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    if (uIntensity < 0.001) { gl_FragColor = vec4(src, 1.0); return; }

    // Build flow direction at this pixel (perturbed by noise)
    float baseAng = radians(uFlowAngle);
    float perturb = (vnoise(vUv * uFlowScale + uTime * 0.3) - 0.5) * 1.6;
    float ang = baseAng + perturb;
    vec2 dir = vec2(cos(ang), sin(ang));

    // March backward along flow accumulating bright pixels
    vec3 acc = src;
    float wsum = 1.0;
    float maxLen = uTrailLength * 0.4;
    for (int i = 1; i <= 24; i++) {
      float t = float(i) / 24.0;
      vec2 sUv = vUv - dir * maxLen * t;
      vec3 sCol;
      if (uChromaShift > 0.001) {
        sCol.r = texture2D(uTexture, sUv + dir * t * uChromaShift * 0.02).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - dir * t * uChromaShift * 0.02).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sCol));
      float w = (1.0 - t) * gate;
      acc += sCol * vec3(uTintR, uTintG, uTintB) * w * uIntensity;
      wsum += w;
    }
    vec3 result = acc / wsum;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Sr=`
  uniform sampler2D uTexture;
  uniform float uDepth;         // 1-12
  uniform float uZoom;          // 0.85-1.15 per-step zoom factor
  uniform float uRotation;      // 0-360 per-step
  uniform float uOpacity;       // 0-1 per-step decay
  uniform float uHueShift;      // 0-1 per-step
  uniform float uOffsetX;
  uniform float uOffsetY;
  uniform float uMode;          // 0=recursive zoom, 1=mirror echo, 2=spiral
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int depth = int(clamp(uDepth, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec3 acc = src;
    float opacity = uOpacity;
    float hueOff = uHueShift;
    vec2 offset = vec2(uOffsetX, uOffsetY);
    float ang = radians(uRotation);
    float ca = cos(ang), sa = sin(ang);
    float scale = uZoom;

    for (int i = 1; i < 12; i++) {
      if (i >= depth) break;
      vec2 c = vec2(0.5);
      vec2 d = (vUv - c) * pow(scale, float(i));
      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = c + d - offset * float(i);
      if (mode == 1) sUv = vec2(1.0 - sUv.x, sUv.y);
      else if (mode == 2) {
        // Spiral: add radial twist
        vec2 dr = sUv - 0.5;
        float r = length(dr);
        float a2 = atan(dr.y, dr.x) + r * float(i) * 0.5;
        sUv = 0.5 + vec2(cos(a2), sin(a2)) * r;
      }
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      acc = mix(acc, sCol, opacity);
      opacity *= uOpacity;
      hueOff += uHueShift;
    }
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  }
`,Cr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uIntensity;     // 0-1
  uniform float uMotionScale;   // 0-2 displacement magnitude
  uniform float uPersistence;   // 0-1 how much old frame survives
  uniform float uChromaSplit;   // 0-1
  uniform float uBlockSize;     // 4-32 motion-block size
  uniform float uFreeze;        // 0-1 freeze + repeat motion (no new I-frames)
  uniform float uMode;          // 0=normal, 1=glitch, 2=smooth
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec2 estimateFlow(vec2 uv) {
    if (uHasFeedback < 0.5) return vec2(0.0);
    vec2 cell = floor(uv * uResolution / uBlockSize);
    vec2 cellOrigin = (cell + 0.5) * uBlockSize / uResolution;
    vec2 texel = 1.0 / uResolution;

    vec3 cur = texture2D(uTexture, cellOrigin).rgb;
    float bestErr = 1e9;
    vec2 bestOff = vec2(0.0);
    // Search 5x5 block grid for best match in feedback frame
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * uBlockSize * 0.5;
        vec3 prev = texture2D(uFeedback, cellOrigin + off).rgb;
        float err = dot(cur - prev, cur - prev);
        if (err < bestErr) { bestErr = err; bestOff = off; }
      }
    }
    return bestOff;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uHasFeedback < 0.5 || uIntensity < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    vec2 flow = estimateFlow(vUv) * uMotionScale * (mode == 1 ? 2.0 : 1.0);

    // Sample previous frame at flow-shifted UV
    vec3 prevSampled;
    if (uChromaSplit > 0.001) {
      prevSampled.r = texture2D(uFeedback, vUv + flow * (1.0 + uChromaSplit * 0.4)).r;
      prevSampled.g = texture2D(uFeedback, vUv + flow).g;
      prevSampled.b = texture2D(uFeedback, vUv + flow * (1.0 - uChromaSplit * 0.4)).b;
    } else {
      prevSampled = texture2D(uFeedback, vUv + flow).rgb;
    }

    // Mix: persistence blends old frame; freeze suppresses new frame
    vec3 newFrame = mix(src.rgb, vec3(luma(src.rgb)), uFreeze * 0.4);
    if (uFreeze > 0.001) newFrame = mix(newFrame, prevSampled, uFreeze);

    vec3 result;
    if (mode == 2) {
      // Smooth: time-blend
      result = mix(newFrame, prevSampled, uPersistence);
    } else {
      // Normal/glitch: hard mosh
      result = mix(newFrame, prevSampled, uPersistence * uIntensity);
    }

    gl_FragColor = vec4(result, src.a);
  }
`,Tr=`
  uniform sampler2D uTexture;
  uniform float uFlowScale;     // 0.5-16 noise scale
  uniform float uTrailLength;   // 0-1
  uniform float uSamples;       // 8-64 march steps
  uniform float uSpeed;         // 0-3 anim speed
  uniform float uChromaSplit;   // 0-1
  uniform float uContrast;      // 0-2
  uniform float uMode;          // 0=advect, 1=streak, 2=tendril
  uniform float uColorCycle;    // 0-1 hue rotation along trail
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  vec2 curl(vec2 p, float t) {
    float e = 0.04;
    float n1 = vnoise(p + vec2(0, e) + t);
    float n2 = vnoise(p - vec2(0, e) + t);
    float n3 = vnoise(p + vec2(e, 0) + t);
    float n4 = vnoise(p - vec2(e, 0) + t);
    return vec2(n1 - n2, -(n3 - n4)) * 4.0;
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    int mode = int(uMode + 0.5);
    int samples = int(clamp(uSamples, 4.0, 64.0));
    float t = uTime * uSpeed;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 pos = vUv;
    float stepLen = uTrailLength * 0.4 / float(samples);

    for (int i = 0; i < 64; i++) {
      if (i >= samples) break;
      float fi = float(i) / float(samples);
      vec2 v = curl(pos * uFlowScale, t * 0.1);
      if (mode == 1) v *= (1.0 + sin(fi * 6.28) * 0.5);
      else if (mode == 2) v *= (1.0 + cos(t + fi * 3.14) * 0.7);
      pos -= v * stepLen;
      vec3 sCol;
      if (uChromaSplit > 0.001) {
        sCol.r = texture2D(uTexture, pos + v * uChromaSplit * 0.01).r;
        sCol.g = texture2D(uTexture, pos).g;
        sCol.b = texture2D(uTexture, pos - v * uChromaSplit * 0.01).b;
      } else {
        sCol = texture2D(uTexture, pos).rgb;
      }
      // Optional hue cycle
      if (uColorCycle > 0.001) {
        float hueOff = fi * uColorCycle;
        sCol = mix(sCol, hsv2rgb(vec3(fract(hueOff), 1.0, max(max(sCol.r, sCol.g), sCol.b))), uColorCycle * 0.4);
      }
      float w = 1.0 - fi;
      acc += sCol * w;
      wsum += w;
    }
    vec3 result = acc / max(wsum, 0.0001);
    result = (result - 0.5) * uContrast + 0.5;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`,wr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uFeedRate;      // 0-0.1 (typical 0.055)
  uniform float uKillRate;      // 0-0.1 (typical 0.062)
  uniform float uDiffusionA;    // 0.5-1.5
  uniform float uDiffusionB;    // 0.2-1
  uniform float uPatternScale;  // 0.5-4 size of grid in pattern
  uniform float uLumaMask;      // 0-1 how much source luma drives feed
  uniform float uMode;          // 0=spots, 1=stripes, 2=mitosis, 3=coral
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uMix;
  uniform float uReseed;        // 0-1 sprinkle chemical B at high-luma pixels
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution * uPatternScale;

    vec2 ab;
    if (uHasFeedback < 0.5) {
      // Initial seed: small dot at center
      float d = length(vUv - 0.5);
      ab = vec2(1.0, smoothstep(0.05, 0.0, d));
    } else {
      vec2 prev = texture2D(uFeedback, vUv).rg;
      // 5-tap Laplacian
      vec2 lap = vec2(0.0);
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0,  0.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0,  0.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 0.0, -1.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 0.0,  1.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0, -1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0, -1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0,  1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0,  1.0)).rg * 0.05;
      lap -= prev;

      // Gray-Scott
      int mode = int(uMode + 0.5);
      float feed = uFeedRate;
      float kill = uKillRate;
      if (mode == 1) { feed = 0.039; kill = 0.058; } // stripes
      else if (mode == 2) { feed = 0.0367; kill = 0.0649; } // mitosis
      else if (mode == 3) { feed = 0.0545; kill = 0.062; } // coral

      // Luma modulates feed rate (image content drives growth)
      float srcL = luma(src);
      feed = mix(feed, feed * (0.6 + srcL * 1.0), uLumaMask);

      float a = prev.r, b = prev.g;
      float reaction = a * b * b;
      float dt = 1.0;
      float newA = a + (uDiffusionA * lap.r - reaction + feed * (1.0 - a)) * dt;
      float newB = b + (uDiffusionB * lap.g + reaction - (kill + feed) * b) * dt;
      ab = vec2(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0));

      // Reseed B from bright source pixels
      if (uReseed > 0.001 && srcL > 0.7) {
        ab.g = max(ab.g, srcL * uReseed);
      }
    }

    // Visualise: B channel as colour overlay
    vec3 patColor = vec3(uColorR, uColorG, uColorB) * ab.g;
    vec3 disp = mix(src, src + patColor, uMix);
    // Encode chemical state in r,g; visible color in b
    gl_FragColor = vec4(ab, luma(disp), 1.0);
  }
`,Rr=`
  uniform sampler2D uTexture;
  uniform float uEdgeThreshold; // 0-1
  uniform float uTubeWidth;     // 0.5-4
  uniform float uGlow;          // 0-2 glow intensity
  uniform float uGlowRadius;    // 1-12 px
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uChase;         // 0-1 marching-light along tube
  uniform float uChaseSpeed;    // 0-3
  uniform float uFlicker;       // 0-1 random tube flicker
  uniform float uBg;            // 0=black, 1=keep source, 2=darkened source
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float edgeStrength(vec2 uv, vec2 texel) {
    float l00 = luma(texture2D(uTexture, uv + texel * vec2(-1, -1)).rgb);
    float l10 = luma(texture2D(uTexture, uv + texel * vec2( 0, -1)).rgb);
    float l20 = luma(texture2D(uTexture, uv + texel * vec2( 1, -1)).rgb);
    float l01 = luma(texture2D(uTexture, uv + texel * vec2(-1,  0)).rgb);
    float l21 = luma(texture2D(uTexture, uv + texel * vec2( 1,  0)).rgb);
    float l02 = luma(texture2D(uTexture, uv + texel * vec2(-1,  1)).rgb);
    float l12 = luma(texture2D(uTexture, uv + texel * vec2( 0,  1)).rgb);
    float l22 = luma(texture2D(uTexture, uv + texel * vec2( 1,  1)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    return length(vec2(gx, gy));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec3 src = texture2D(uTexture, vUv).rgb;
    float e = edgeStrength(vUv, texel);
    float tube = smoothstep(uEdgeThreshold, uEdgeThreshold + 0.05 * uTubeWidth, e);

    // Glow halo (sample edges in neighbourhood)
    float halo = 0.0;
    if (uGlow > 0.001) {
      float r = uGlowRadius;
      for (int y = -3; y <= 3; y++) {
        for (int x = -3; x <= 3; x++) {
          vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
          float ee = edgeStrength(vUv + off, texel);
          float w = exp(-(float(x*x + y*y)) / (2.0 * 4.0));
          halo += smoothstep(uEdgeThreshold, uEdgeThreshold + 0.1, ee) * w;
        }
      }
      halo *= uGlow / 16.0;
    }

    // Marching chase
    if (uChase > 0.001 && tube > 0.5) {
      float chase = sin(vUv.x * 60.0 + uTime * uChaseSpeed * 4.0) * 0.5 + 0.5;
      tube *= mix(0.5, 1.0 + chase * 0.6, uChase);
    }

    // Flicker
    if (uFlicker > 0.001) {
      float f = step(0.92, hash21(vec2(floor(uTime * 12.0))));
      tube *= 1.0 - f * uFlicker * 0.4;
    }

    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 neon = tint * (tube * 1.8 + halo);

    int bg = int(uBg + 0.5);
    vec3 baseColor;
    if (bg == 0) baseColor = vec3(0.0);
    else if (bg == 1) baseColor = src;
    else baseColor = src * 0.25;

    vec3 result = 1.0 - (1.0 - baseColor) * (1.0 - neon);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,kr=`
  uniform sampler2D uTexture;
  uniform float uDepthStrength; // 0-1
  uniform float uPushIn;        // 0-1 base zoom into depth
  uniform float uLayers;        // 1-8 depth layer count
  uniform float uChromatic;     // 0-1 RGB depth split
  uniform float uDepthBoost;    // 0-2 luma → depth response
  uniform float uMode;          // 0=push, 1=pan, 2=swing
  uniform float uPanX;          // -1..1
  uniform float uPanY;          // -1..1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec2 parallaxMap(vec2 uv, float depth, float layer) {
    int mode = int(uMode + 0.5);
    vec2 d = uv - 0.5;
    float scale = 1.0 + (depth - 0.5) * uDepthStrength * 0.5 + uPushIn * 0.3 * (1.0 + layer * 0.1);
    vec2 sUv;
    if (mode == 0) {
      sUv = 0.5 + d / scale;
    } else if (mode == 1) {
      sUv = uv + vec2(uPanX, uPanY) * (depth - 0.5) * uDepthStrength * 0.2 * (1.0 + layer * 0.2);
    } else {
      float sw = sin(uTime * 0.5 + layer * 0.3) * 0.5;
      sUv = uv + vec2(sw, sw * 0.4) * (depth - 0.5) * uDepthStrength * 0.15;
    }
    return clamp(sUv, vec2(0.0), vec2(1.0));
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float baseDepth = pow(luma(src), max(0.1, uDepthBoost));
    int layers = int(clamp(uLayers, 1.0, 8.0));

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= layers) break;
      float layer = float(i) / max(1.0, float(layers - 1));
      float sliceDepth = mix(0.2, 0.95, layer);
      // Estimate per-layer offset
      vec2 sUv = parallaxMap(vUv, sliceDepth, layer);
      vec3 sCol;
      if (uChromatic > 0.001) {
        vec2 cd = (sUv - 0.5) * uChromatic * 0.04 * (1.0 - layer);
        sCol.r = texture2D(uTexture, sUv + cd).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - cd).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      // Weight by closeness of source pixel depth to slice depth
      float pixDepth = pow(luma(sCol), max(0.1, uDepthBoost));
      float w = exp(-pow((pixDepth - sliceDepth) * 4.0, 2.0));
      acc += sCol * w;
      wsum += w;
    }
    vec3 result = (wsum > 0.0001) ? acc / wsum : src;
    gl_FragColor = vec4(result, 1.0);
  }
`,Mr=`
  uniform sampler2D uTexture;
  uniform float uDissolve;      // 0-1 0=image, 1=fully scattered
  uniform float uDotSize;       // 1-12 px
  uniform float uScatterRadius; // 0-1 max scatter distance (% of screen)
  uniform float uAttract;       // 0-1 swirl-toward-center
  uniform float uTurbulence;    // 0-1 random per-dot direction
  uniform float uMode;          // 0=square dots, 1=circle, 2=cross
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uHueShift;      // 0-1 cycle hue along dissolve
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    // Raw source for dissolve = 0 fallback
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;

    vec2 cell = floor(vUv * uResolution / uDotSize);
    vec2 cellOrigin = cell * uDotSize / uResolution;
    vec2 cellSize = vec2(uDotSize) / uResolution;

    // Each dot's home position is the cell origin + 0.5 of cell
    vec2 home = cellOrigin + cellSize * 0.5;

    // Sample source colour at the home position
    vec3 sampleCol = texture2D(uTexture, home).rgb;

    // Compute dot's drifted position based on dissolve amount
    vec2 dir = normalize(vec2(hash21(cell) - 0.5, hash21(cell + 13.7) - 0.5) + 1e-6);
    if (uAttract > 0.001) {
      vec2 toCenter = (vec2(0.5) - home);
      dir = mix(dir, normalize(toCenter + 1e-6), uAttract);
    }
    if (uTurbulence > 0.001) {
      float wob = sin(uTime + hash21(cell + 71.3) * 6.28) * uTurbulence;
      dir += vec2(wob * 0.3, wob * 0.4);
      dir = normalize(dir);
    }

    vec2 dotPos = home + dir * uDissolve * uScatterRadius;

    // Determine mask of dot at this UV. Dot radius = 0.71 covers full cell at
    // dissolve=0 (length(toDot) max is 0.707 at corner). Shrinks with dissolve
    // so scattered state shows BG between dots.
    vec2 toDot = (vUv - dotPos) / cellSize;
    int mode = int(uMode + 0.5);
    float dotR = mix(0.72, 0.42, uDissolve); // shrinks as dissolve grows
    float mask = 0.0;
    if (mode == 0) {
      // Square: cover full cell at dissolve=0
      vec2 ad = abs(toDot);
      mask = step(max(ad.x, ad.y), max(0.5, dotR));
    } else if (mode == 1) {
      // Circle: smooth falloff
      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(toDot));
    } else {
      // Cross
      mask = max(
        step(abs(toDot.x), dotR * 0.2) * step(abs(toDot.y), dotR),
        step(abs(toDot.y), dotR * 0.2) * step(abs(toDot.x), dotR)
      );
    }

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(sampleCol);
      hsv.x = fract(hsv.x + uDissolve * uHueShift);
      sampleCol = hsv2rgb(hsv);
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 dotResult = mix(bg, sampleCol, mask);
    // Crossfade with raw source so dissolve = 0 looks unchanged
    vec3 result = mix(srcRaw, dotResult, smoothstep(0.0, 0.05, uDissolve));
    gl_FragColor = vec4(result, 1.0);
  }
`,Dr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uGravity;       // 0-2 fall distance per frame
  uniform float uTurbulence;    // 0-1 random per-grain jitter
  uniform float uThreshold;     // 0-1 luma gate (bright pixels become sand)
  uniform float uPersistence;   // 0-1 how long sand stays before fading
  uniform float uMode;          // 0=fall, 1=rise, 2=swirl
  uniform float uReplenish;     // 0-1 how much new sand spawns each frame
  uniform float uChromaSplit;   // 0-1
  uniform float uGrainSize;     // 1-6 sand grain pixel size
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);

    // Snap to grain grid so sand looks pixelated/granular (not smooth)
    vec2 grain = floor(vUv * uResolution / max(1.0, uGrainSize));
    vec2 grainPos = grain * uGrainSize / uResolution;
    vec2 grainCenter = grainPos + vec2(uGrainSize) / uResolution * 0.5;
    float grainSeed = hash21(grain);

    // Direction of motion (texture-space y down)
    vec2 dir;
    if (mode == 0) dir = vec2(0.0, -1.0);                 // fall (sample above)
    else if (mode == 1) dir = vec2(0.0, 1.0);             // rise
    else dir = vec2(sin(uTime * 0.4 + grainCenter.y * 6.28), 0.6); // swirl

    if (uTurbulence > 0.001) {
      vec2 jit = vec2(hash21(grain + uTime * 0.05), hash21(grain * 1.3 + uTime * 0.05 + 7.3)) - 0.5;
      dir += jit * uTurbulence;
    }

    // Sample feedback at the cell this grain "fell from"
    float fallStep = uGravity * uGrainSize / uResolution.y;
    vec2 fbUv = grainCenter - dir * fallStep;
    vec3 fallen = vec3(0.0);
    float fallenAlpha = 0.0;
    if (uHasFeedback > 0.5) {
      vec3 prev;
      if (uChromaSplit > 0.001) {
        prev.r = texture2D(uFeedback, fbUv + dir * uChromaSplit * 0.003).r;
        prev.g = texture2D(uFeedback, fbUv).g;
        prev.b = texture2D(uFeedback, fbUv - dir * uChromaSplit * 0.003).b;
      } else {
        prev = texture2D(uFeedback, fbUv).rgb;
      }
      fallen = prev * uPersistence;
      // Snap to discrete particle: only kept if luma above gate
      fallenAlpha = step(0.05, luma(prev)) * uPersistence;
    }

    // Spawn new sand: only at bright source pixels, sparsely (granular)
    vec3 sampleCol = texture2D(uTexture, grainCenter).rgb;
    float lumaNow = luma(sampleCol);
    float sparkle = step(1.0 - uReplenish, grainSeed); // discrete spawn mask
    float spawnW = smoothstep(uThreshold, uThreshold + 0.05, lumaNow) * sparkle;
    vec3 newSand = sampleCol * spawnW;

    // Combine: take the brighter of the two (sand "wins" over old or new)
    vec3 sand = max(fallen, newSand);
    float sandAlpha = max(fallenAlpha, spawnW);

    // Composite: sand REPLACES source where present (granular look), source visible elsewhere.
    // Darken source slightly under sand for contrast.
    vec3 srcDimmed = src * (1.0 - sandAlpha * 0.4);
    vec3 disp = mix(srcDimmed, sand, sandAlpha);
    gl_FragColor = vec4(clamp(disp, 0.0, 1.0), 1.0);
  }
`,Ar=`
  uniform sampler2D uTexture;
  uniform float uBlobs;         // 1-8
  uniform float uBlobSize;      // 0.05-0.4
  uniform float uRefraction;    // 0-1
  uniform float uChromatic;     // 0-1
  uniform float uSpecular;      // 0-1
  uniform float uCausticAmount; // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Compute summed signed-distance to N moving blobs
  float blobField(vec2 uv, out vec2 grad) {
    int n = int(clamp(uBlobs, 1.0, 8.0));
    float sum = 0.0;
    grad = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      float fi = float(i);
      vec2 c = vec2(
        0.5 + 0.35 * sin(uTime * uSpeed * 0.3 + fi * 1.7),
        0.5 + 0.35 * cos(uTime * uSpeed * 0.4 + fi * 2.3)
      );
      vec2 d = uv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = length(d);
      float w = exp(-r * r / (uBlobSize * uBlobSize));
      sum += w;
      grad -= d * w / (uBlobSize * uBlobSize) * 2.0;
    }
    return sum;
  }

  void main() {
    vec2 grad;
    float field = blobField(vUv, grad);
    float blob = smoothstep(0.7, 1.3, field);

    // Refract: bend rays inversely proportional to gradient
    vec2 refractDir = -grad * uRefraction * 0.04;
    vec3 col;
    if (uChromatic > 0.001) {
      col.r = texture2D(uTexture, vUv + refractDir * (1.0 + uChromatic * 0.5)).r;
      col.g = texture2D(uTexture, vUv + refractDir).g;
      col.b = texture2D(uTexture, vUv + refractDir * (1.0 - uChromatic * 0.5)).b;
    } else {
      col = texture2D(uTexture, vUv + refractDir).rgb;
    }
    col *= mix(vec3(1.0), vec3(uTintR, uTintG, uTintB), blob * 0.5);

    // Specular highlight on top of blob (top-left bias)
    if (uSpecular > 0.001) {
      vec3 N = normalize(vec3(grad, 1.0));
      vec3 L = normalize(vec3(-0.4, -0.6, 0.6));
      float spec = pow(max(0.0, dot(N, L)), 32.0);
      col += vec3(spec) * uSpecular * blob * 1.5;
    }

    // Caustics outside blob
    if (uCausticAmount > 0.001) {
      float caust = (1.0 - blob) * (sin(field * 30.0 + uTime) * 0.5 + 0.5);
      col += vec3(uCausticAmount) * vec3(uTintR, uTintG, uTintB) * caust * 0.4;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`,Br=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1
  uniform float uScanFreq;      // 50-500
  uniform float uScanSpeed;     // 0-3
  uniform float uGridSpacing;   // 4-32
  uniform float uRGBFlicker;    // 0-1
  uniform float uBrokenBands;   // 0-1 random horizontal dropouts
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uOpacityFlicker;// 0-1
  uniform float uEdgeGlow;      // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 col = src;

    // RGB channel flicker (each channel jitters independently)
    if (uRGBFlicker > 0.001) {
      float t = floor(uTime * 30.0);
      float r = (hash21(vec2(t, 0)) - 0.5) * uRGBFlicker * 0.04;
      float g = (hash21(vec2(t, 1)) - 0.5) * uRGBFlicker * 0.04;
      float b = (hash21(vec2(t, 2)) - 0.5) * uRGBFlicker * 0.04;
      col.r = texture2D(uTexture, vUv + vec2(r, 0)).r;
      col.g = texture2D(uTexture, vUv + vec2(g, 0)).g;
      col.b = texture2D(uTexture, vUv + vec2(b, 0)).b;
    }

    // Scanline + descending scan beam
    float scan = sin(vUv.y * uScanFreq * 3.14159 - uTime * uScanSpeed * 4.0);
    scan = mix(1.0, scan * 0.4 + 0.6, uIntensity);
    col *= scan;

    // Bright moving scan beam
    float beam = smoothstep(0.04, 0.0, abs(vUv.y - mod(uTime * uScanSpeed * 0.3, 1.0)));
    col += beam * tint * uIntensity * 1.5;

    // Grid overlay
    if (uGridSpacing > 0.5) {
      vec2 g = mod(vUv * uResolution, uGridSpacing);
      float gridLine = step(uGridSpacing - 1.0, max(g.x, g.y));
      col += gridLine * tint * 0.2 * uIntensity;
    }

    // Broken bands (horizontal dropouts)
    if (uBrokenBands > 0.001) {
      float bandY = floor(vUv.y * 60.0 + uTime * 2.0);
      float dropout = step(0.94, hash21(vec2(bandY, floor(uTime * 4.0))));
      col *= 1.0 - dropout * uBrokenBands * 0.6;
    }

    // Holographic tint
    col = mix(col, col * tint + tint * 0.15, uIntensity * 0.5);

    // Edge glow
    if (uEdgeGlow > 0.001) {
      vec2 texel = 1.0 / uResolution;
      float l = luma(src);
      float lN = luma(texture2D(uTexture, vUv + texel * vec2(0.0, 1.0)).rgb);
      float lE = luma(texture2D(uTexture, vUv + texel * vec2(1.0, 0.0)).rgb);
      float edge = abs(l - lN) + abs(l - lE);
      col += tint * edge * uEdgeGlow * 2.0;
    }

    // Overall opacity flicker
    if (uOpacityFlicker > 0.001) {
      float opf = 1.0 - (sin(uTime * 8.0) * 0.5 + 0.5) * uOpacityFlicker * 0.3;
      col *= opf;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`,Ur=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=diagonal, 3=radial
  uniform float uSpeed;         // 0-3
  uniform float uBeamWidth;     // 0.005-0.1
  uniform float uGlow;          // 0-2
  uniform float uSparks;        // 0-1
  uniform float uEraseAmount;   // 0-1 (use feedback for erased trail)
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uReveal;        // 0=erase pre-beam, 1=reveal post-beam
  uniform float uPersistence;   // 0-1 trail decay
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    float pos = mod(uTime * uSpeed * 0.3, 1.4) - 0.2; // beam pos 0..1 with sweep over edges

    // Distance from beam line
    float d;
    if (mode == 0) d = abs(vUv.y - pos);
    else if (mode == 1) d = abs(vUv.x - pos);
    else if (mode == 2) d = abs((vUv.x + vUv.y) * 0.5 - pos);
    else {
      // Radial: pos = ring radius
      vec2 rd = vUv - 0.5;
      d = abs(length(rd) - pos * 0.7);
    }

    float beam = smoothstep(uBeamWidth * 1.5, 0.0, d);
    float halo = exp(-d * d / (uBeamWidth * uBeamWidth * 8.0)) * uGlow;

    // Side relative to beam
    float side;
    if (mode == 0) side = step(vUv.y, pos);
    else if (mode == 1) side = step(vUv.x, pos);
    else if (mode == 2) side = step((vUv.x + vUv.y) * 0.5, pos);
    else side = step(length(vUv - 0.5), pos * 0.7);

    // Erase / reveal mask: 1 = show source, 0 = show feedback (trail)
    float mask = (uReveal > 0.5) ? side : (1.0 - side);

    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 prev = (uHasFeedback > 0.5) ? texture2D(uFeedback, vUv).rgb : vec3(0.0);
    vec3 base = mix(prev * uPersistence, src, mask);

    // Erase amount controls how much we wipe through to feedback
    base = mix(src, base, uEraseAmount);

    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 result = base + tint * (beam + halo);

    // Sparks at beam edge
    if (uSparks > 0.001 && beam > 0.001) {
      float sp = step(0.97, hash21(floor(vUv * 300.0) + floor(uTime * 30.0)));
      result += sp * tint * 2.0 * uSparks;
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Pr=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uRadius;        // 4-32 px
  uniform float uEdgeAmount;    // 0-1 edge contribution
  uniform float uLumaAmount;    // 0-1 bright pixel contribution
  uniform float uAudio;
  uniform float uAudioReact;    // 0-2 audio scales aura
  uniform float uHueShift;      // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=add, 1=screen, 2=replace
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Compute aura from neighborhood: blur weighted by source brightness + edges
    vec3 aura = vec3(0.0);
    float wsum = 0.0;
    float r = uRadius * (1.0 + uAudio * uAudioReact * 0.6);
    for (int y = -4; y <= 4; y++) {
      for (int x = -4; x <= 4; x++) {
        if (abs(x) + abs(y) > 6) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        // Edge component (delta from center)
        vec3 d = abs(s - src);
        float edgeW = (d.r + d.g + d.b) * uEdgeAmount;
        float lumaW = luma(s) * uLumaAmount;
        float w = exp(-(float(x*x + y*y)) / 8.0) * (edgeW + lumaW);
        aura += s * w;
        wsum += w;
      }
    }
    aura = (wsum > 0.0001) ? aura / wsum : vec3(0.0);
    aura *= uIntensity * (1.0 + uAudio * uAudioReact);

    // Optional hue cycle
    if (uHueShift > 0.001) {
      float l = luma(aura);
      vec3 hsvAura = hsv2rgb(vec3(fract(uTime * 0.1 + uHueShift), 1.0, l));
      aura = mix(aura, hsvAura, uHueShift);
    }
    aura *= vec3(uTintR, uTintG, uTintB);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src + aura;
    else if (mode == 1) result = 1.0 - (1.0 - src) * (1.0 - aura);
    else result = mix(src, aura, clamp(uIntensity * 0.5, 0.0, 1.0));

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Fr=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 0=intact, 1=fully gone
  uniform float uScale;         // 0.5-16 noise scale
  uniform float uSpeed;         // 0-3
  uniform float uDirection;     // 0-360 wind direction
  uniform float uEdgeFade;      // 0-1 fade at dissolve edge
  uniform float uSmokeColorR;
  uniform float uSmokeColorG;
  uniform float uSmokeColorB;
  uniform float uMode;          // 0=top-down, 1=center-out, 2=fbm-driven
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);
    float ang = radians(uDirection);
    vec2 windDir = vec2(cos(ang), sin(ang));

    // Base threshold field (where dissolve has reached)
    float threshold;
    if (mode == 0) threshold = vUv.y; // top-down
    else if (mode == 1) threshold = 1.0 - length(vUv - 0.5) * 1.4; // center-out
    else threshold = fbm(vUv * 2.0); // fbm-driven random

    // Animated smoke noise pattern
    vec2 p = vUv * uScale + windDir * uTime * uSpeed * 0.2;
    float smoke = fbm(p);
    smoke = smoke * 0.6 + fbm(p * 2.5 + uTime * uSpeed * 0.15) * 0.4;

    // Threshold + amount drives dissolve
    float dissolveEdge = uAmount + smoke * 0.5 - 0.5;
    float dissolveMask = smoothstep(threshold - uEdgeFade * 0.2, threshold + uEdgeFade * 0.2, dissolveEdge);

    // Smoke color in dissolve area (tint by smoke pattern)
    vec3 smokeColor = vec3(uSmokeColorR, uSmokeColorG, uSmokeColorB) * (0.6 + smoke * 0.4);
    vec3 result = mix(src, smokeColor, dissolveMask);
    // Apply alpha mask: high dissolve = transparent (or smoke-tinted)
    float alpha = 1.0 - dissolveMask * 0.6;

    gl_FragColor = vec4(result, alpha);
  }
`,Gr=`
  uniform sampler2D uTexture;
  uniform float uAmplitude;     // 0-1
  uniform float uFrequency;     // 1-30
  uniform float uSpeed;         // 0-3
  uniform float uThreadDensity; // 1-200 thread weave count
  uniform float uThreadDepth;   // 0-1 thread shadow depth
  uniform float uShimmer;       // 0-2 silk shimmer intensity
  uniform float uMode;          // 0=horizontal weave, 1=plaid, 2=satin
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    // Wave the UV
    float t = uTime * uSpeed;
    vec2 wave;
    wave.x = sin(vUv.y * uFrequency + t) * uAmplitude * 0.04;
    wave.y = cos(vUv.x * uFrequency * 0.8 + t * 0.7) * uAmplitude * 0.03;
    vec2 sUv = vUv + wave;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 col = texture2D(uTexture, sUv).rgb;

    // Thread weave overlay
    int mode = int(uMode + 0.5);
    vec2 px = sUv * uResolution;
    float thread;
    if (mode == 0) {
      // Horizontal weave
      thread = sin(px.y * uThreadDensity * 0.1) * 0.5 + 0.5;
    } else if (mode == 1) {
      // Plaid (both axes)
      thread = (sin(px.x * uThreadDensity * 0.07) + sin(px.y * uThreadDensity * 0.07)) * 0.25 + 0.5;
    } else {
      // Satin (45-degree weave)
      thread = sin((px.x + px.y) * uThreadDensity * 0.06) * 0.5 + 0.5;
    }
    col *= mix(1.0, thread, uThreadDepth * 0.4);

    // Shimmer (silk highlights)
    if (uShimmer > 0.001) {
      float specular = pow(max(0.0, sin(px.x * 0.1 + px.y * 0.05 + t * 1.5)), 8.0);
      col += vec3(specular) * uShimmer * 0.3;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`,zr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uTileSize;      // 8-128
  uniform float uShuffleAmount; // 0-1
  uniform float uRotateAmount;  // 0-1
  uniform float uDelayAmount;   // 0-1 (only with feedback)
  uniform float uChromaSplit;   // 0-1
  uniform float uTriggerRate;   // 0-3 reshuffle frequency
  uniform float uMode;          // 0=quilt, 1=swap, 2=mosh
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 cell = floor(vUv * uResolution / uTileSize);
    vec2 cellOrigin = cell * uTileSize / uResolution;
    vec2 cellSize = vec2(uTileSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize;

    // Per-cell randomness, refreshed at trigger rate
    float t = floor(uTime * uTriggerRate * 2.0);
    float h = hash21(cell + t);
    float h2 = hash21(cell + t + 13.7);

    // Shuffle: replace this tile with one elsewhere
    vec2 srcCell = cell;
    if (h < uShuffleAmount) {
      srcCell.x = floor(hash21(cell + t + 7.3) * uResolution.x / uTileSize);
      srcCell.y = floor(hash21(cell + t + 17.5) * uResolution.y / uTileSize);
    }

    // Rotate: per-cell quad rotation
    vec2 sUv = cellUv;
    if (h2 < uRotateAmount) {
      int rot = int(hash21(cell + t + 27.3) * 4.0);
      if (rot == 1) sUv = vec2(sUv.y, 1.0 - sUv.x);
      else if (rot == 2) sUv = vec2(1.0 - sUv.x, 1.0 - sUv.y);
      else if (rot == 3) sUv = vec2(1.0 - sUv.y, sUv.x);
    }
    vec2 finalUv = (srcCell * uTileSize + sUv * uTileSize) / uResolution;
    finalUv = clamp(finalUv, vec2(0.0), vec2(1.0));

    int mode = int(uMode + 0.5);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 cd = vec2(uChromaSplit * 0.005, 0.0);
      col.r = texture2D(uTexture, finalUv + cd).r;
      col.g = texture2D(uTexture, finalUv).g;
      col.b = texture2D(uTexture, finalUv - cd).b;
    } else {
      col = texture2D(uTexture, finalUv).rgb;
    }

    // Delay: blend with feedback
    if (uDelayAmount > 0.001 && uHasFeedback > 0.5) {
      float useFb = step(0.5, hash21(cell + 71.3));
      vec3 prev = texture2D(uFeedback, finalUv).rgb;
      col = mix(col, prev, useFb * uDelayAmount);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`,Lr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uCellSize;      // 1-8 px
  uniform float uBirthThreshold;// 0-1 luma threshold for new cell
  uniform float uSurvivalLow;   // 0-8 neighbor count low end
  uniform float uSurvivalHigh;  // 0-8 high end
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uMode;          // 0=Conway, 1=Brian's Brain, 2=Burn
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = vec2(uCellSize) / uResolution;

    float alive = 0.0;
    if (uHasFeedback > 0.5) {
      // Sample 8 neighbors
      float n = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          if (x == 0 && y == 0) continue;
          n += texture2D(uFeedback, vUv + texel * vec2(float(x), float(y))).r;
        }
      }
      float self = texture2D(uFeedback, vUv).r;
      int mode = int(uMode + 0.5);
      if (mode == 0) {
        // Conway: birth on 3, survive on 2-3
        if (self > 0.5 && n >= uSurvivalLow && n <= uSurvivalHigh) alive = 1.0;
        else if (self < 0.5 && n >= 2.5 && n <= 3.5) alive = 1.0;
      } else if (mode == 1) {
        // Brian's Brain: alive→dying→dead, only birth on 2
        if (self < 0.4 && n >= 1.5 && n <= 2.5) alive = 1.0;
        else if (self > 0.5) alive = 0.5; // dying
      } else {
        // Burn: cells expand into bright neighbors, decay
        if (self > 0.5) alive = self * 0.92;
        else if (n > 0.5 && luma(src) > uBirthThreshold) alive = 1.0;
      }
    } else {
      // First frame: seed from luma
      alive = step(uBirthThreshold, luma(src));
    }

    // Inject birth from current source brightness
    if (luma(src) > uBirthThreshold + 0.2) alive = max(alive, 1.0);

    vec3 cellColor = vec3(uColorR, uColorG, uColorB) * alive;
    vec3 disp = mix(src, src + cellColor, uMix);
    // Encode alive in r-channel for next frame, color in display
    gl_FragColor = vec4(alive, alive * 0.5, alive * 0.25, luma(disp));
  }
`,Hr=`
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=vertical, 1=horizontal, 2=both, 3=4-fold
  uniform float uInkAmount;     // 0-1 contrast/threshold for ink
  uniform float uFluidEdges;    // 0-1 animated noise on mirror seam
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uMixOriginal;   // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 sUv = vUv;
    // Animated edge wobble at fold seam
    float wobble = uFluidEdges * (vnoise(vUv * 8.0 + uTime * 0.5) - 0.5) * 0.04;

    if (mode == 0 || mode == 2 || mode == 3) {
      // Vertical fold (mirror left↔right)
      if (sUv.x > 0.5 + wobble) sUv.x = 1.0 - sUv.x;
    }
    if (mode == 1 || mode == 2 || mode == 3) {
      if (sUv.y > 0.5 + wobble) sUv.y = 1.0 - sUv.y;
    }
    if (mode == 3) {
      // 4-fold: also diagonal mirror
      if (sUv.x > sUv.y) {
        float tmp = sUv.x; sUv.x = sUv.y; sUv.y = tmp;
      }
    }
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 mirrored = texture2D(uTexture, sUv).rgb;
    float ink = smoothstep(uInkAmount, 1.0, luma(mirrored));
    vec3 inkColor = mix(vec3(uBgR, uBgG, uBgB), vec3(uTintR, uTintG, uTintB), ink);

    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 result = mix(inkColor, src, uMixOriginal);
    gl_FragColor = vec4(result, 1.0);
  }
`,Ir=`
  uniform sampler2D uTexture;
  uniform float uTunnelDepth;   // 0.5-3
  uniform float uPrismSpread;   // 0-2 chromatic per-slice
  uniform float uRotation;      // 0-3
  uniform float uSpeed;         // 0-3
  uniform float uSlices;        // 4-32 number of recursive slices
  uniform float uFade;          // 0-1 darken with depth
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 d = vUv - 0.5;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float a = atan(d.y, d.x);
    int slices = int(clamp(uSlices, 4.0, 32.0));
    float t = uTime * uSpeed;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 32; i++) {
      if (i >= slices) break;
      float fi = float(i) / float(slices);
      // Tunnel UV: depth shrinks r
      float depth = exp(-fi * uTunnelDepth);
      vec2 td = d / depth;
      td.x *= uResolution.y / uResolution.x;
      float ang = a + uRotation * fi + t * 0.3;
      vec2 rotD = vec2(cos(ang), sin(ang)) * length(td);
      rotD.x *= uResolution.y / uResolution.x;
      vec2 sUv = 0.5 + rotD;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));

      // Per-slice prism shift: hue offset
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      vec3 prismTint = hsv2rgb(vec3(fract(fi * uPrismSpread + t * 0.1), 1.0, 1.0));
      vec3 c = mix(sCol, sCol * prismTint, uPrismSpread * 0.5);
      float w = 1.0 - fi * uFade;
      acc += c * w;
      wsum += w;
    }
    vec3 result = acc / max(wsum, 0.0001);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Er=`
  uniform sampler2D uTexture;
  uniform float uVoxelSize;     // 8-32 px
  uniform float uDepthPulse;    // 0-1 pulses depth
  uniform float uDepthSpeed;    // 0-3
  uniform float uPosterize;     // 1-8 colour quantization
  uniform float uGlow;          // 0-1
  uniform float uPerspective;   // 0-1 fake 3D push
  uniform float uMode;          // 0=square, 1=round, 2=hex
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    // Voxel grid with depth pulse animation
    vec2 cell = floor(vUv * uResolution / uVoxelSize);
    vec2 cellOrigin = cell * uVoxelSize / uResolution;
    vec2 cellSize = vec2(uVoxelSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;

    // Sample center colour, posterize
    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    float steps = max(1.0, uPosterize);
    sampleCol = floor(sampleCol * steps + 0.5) / steps;

    // Depth pulse: brightness sized
    float depth = luma(sampleCol);
    if (uDepthPulse > 0.001) {
      depth += sin(uTime * uDepthSpeed * 2.0 + depth * 8.0) * uDepthPulse * 0.2;
    }

    // Voxel size scales with depth (perspective)
    float scale = mix(0.45, 0.45 - uPerspective * 0.3 * (1.0 - depth), 1.0);
    float r = length(cellUv);
    int mode = int(uMode + 0.5);
    float voxel;
    if (mode == 0) {
      vec2 ad = abs(cellUv);
      voxel = step(max(ad.x, ad.y), scale);
    } else if (mode == 1) {
      voxel = smoothstep(scale + 0.05, scale - 0.05, r);
    } else {
      // Hex
      vec2 ad = abs(cellUv);
      voxel = step(max(ad.x * 0.866 + ad.y * 0.5, ad.y), scale);
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(bg, sampleCol, voxel);

    // Glow halo
    if (uGlow > 0.001) {
      float halo = smoothstep(scale * 1.6, scale, r);
      result += sampleCol * halo * uGlow * 0.4;
    }
    gl_FragColor = vec4(result, 1.0);
  }
`,Or=`
  uniform sampler2D uTexture;
  uniform float uTearAmount;    // 0-1 progress
  uniform float uTearAngle;     // 0-360
  uniform float uTearJitter;    // 0-1 ragged-edge noise
  uniform float uShiftBelow;    // 0-1 offset of underneath layer
  uniform float uOffsetX;       // -0.3..0.3
  uniform float uOffsetY;       // -0.3..0.3
  uniform float uTearGlow;      // 0-1 highlight along rip
  uniform float uMode;          // 0=line, 1=arc, 2=rectangle
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    int mode = int(uMode + 0.5);
    float ang = radians(uTearAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 norm = vec2(-dir.y, dir.x);

    // Distance from tear path
    vec2 d = vUv - 0.5;
    float distToLine = dot(d, norm);
    float jit = uTearJitter * (vnoise(vUv * 30.0) - 0.5) * 0.05;
    float teared;
    if (mode == 0) {
      teared = step(uTearAmount * 1.0 - 0.5, distToLine + jit);
    } else if (mode == 1) {
      // Arc tear
      float r = length(d);
      teared = step(uTearAmount * 0.7, r + jit);
    } else {
      // Rectangle (corner tear)
      vec2 ad = abs(d);
      teared = step(uTearAmount * 0.5, max(ad.x, ad.y) + jit);
    }

    // Below layer = offset & faded source
    vec2 belowUv = vUv + vec2(uOffsetX, uOffsetY) * uShiftBelow;
    belowUv = clamp(belowUv, vec2(0.0), vec2(1.0));
    vec3 above = texture2D(uTexture, vUv).rgb;
    vec3 below = texture2D(uTexture, belowUv).rgb * 0.7;

    vec3 result = mix(above, below, 1.0 - teared);

    // Glow along tear edge
    if (uTearGlow > 0.001) {
      float edge = smoothstep(0.04, 0.0, abs(distToLine - (uTearAmount - 0.5)));
      result += vec3(1.0, 0.95, 0.7) * edge * uTearGlow;
    }

    gl_FragColor = vec4(result, 1.0);
  }
`,_r=`
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 peel progress
  uniform float uScale;         // 1-16 noise scale
  uniform float uLumaBias;      // 0-1 (peel darks vs lights)
  uniform float uCurl;          // 0-1 curl shading
  uniform float uShadow;        // 0-1 dark crack edge
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uMode;          // 0=fbm, 1=cellular, 2=cracks
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        minD = min(minD, dot(r, r));
      }
    }
    return sqrt(minD);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 p = vUv * uScale;
    int mode = int(uMode + 0.5);
    float field;
    if (mode == 0) field = fbm(p + uTime * 0.05);
    else if (mode == 1) field = cellular(p);
    else {
      // Cracks: combine noises into thin lines
      float n1 = fbm(p);
      float n2 = fbm(p + 13.7);
      field = abs(n1 - n2) * 4.0;
    }
    float l = luma(src);
    float lumaWeight = mix(l, 1.0 - l, uLumaBias);
    float peel = step(field, uAmount * lumaWeight + 0.1);

    // Curl shading: gradient of field acts as fake highlight
    float lift = smoothstep(uAmount - 0.05, uAmount + 0.05, field) * uCurl;
    vec3 above = src * (1.0 - lift * 0.4);

    // Shadow at peel boundary
    float shadowEdge = smoothstep(0.05, 0.0, abs(field - uAmount));
    above *= 1.0 - shadowEdge * uShadow * 0.6;

    vec3 below = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(above, below, peel);
    gl_FragColor = vec4(result, 1.0);
  }
`,Vr=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uBloomThreshold;// 0-1
  uniform float uBloomRadius;   // 1-30
  uniform float uShockSpeed;    // 0.1-3
  uniform float uShockAmplitude;// 0-0.2
  uniform float uChromaSplit;   // 0-1
  uniform float uStrobeAmount;  // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uAudio;
  uniform float uAudioGate;     // 0-1 minimum audio to trigger
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float audio = max(0.0, uAudio - uAudioGate) * (1.0 / max(0.01, 1.0 - uAudioGate));
    float kick = audio * uIntensity;

    // Shockwave displacement (driven by audio)
    vec2 d = vUv - 0.5;
    float dist = length(d);
    float ringR = mod(uTime * uShockSpeed * 0.5, 1.4) - 0.2;
    float band = smoothstep(0.06, 0.0, abs(dist - ringR));
    vec2 dir = normalize(d + 1e-6);
    vec2 shockOff = dir * band * uShockAmplitude * (0.4 + kick);

    // Chroma split (kick-driven)
    vec3 col;
    float cs = uChromaSplit * (0.4 + kick * 0.8);
    if (cs > 0.001) {
      col.r = texture2D(uTexture, vUv + dir * cs * 0.025 + shockOff).r;
      col.g = texture2D(uTexture, vUv + shockOff).g;
      col.b = texture2D(uTexture, vUv - dir * cs * 0.025 + shockOff).b;
    } else {
      col = texture2D(uTexture, vUv + shockOff).rgb;
    }

    // Bloom (highlight blur)
    vec2 texel = 1.0 / uResolution;
    vec3 bloom = vec3(0.0);
    float wsum = 0.0;
    float br = uBloomRadius * (0.5 + kick * 1.5);
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        if (abs(x) + abs(y) > 4) continue;
        vec2 off = vec2(float(x), float(y)) * texel * br * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uBloomThreshold, uBloomThreshold + 0.15, luma(s));
        float w = exp(-(float(x*x + y*y)) / 8.0);
        bloom += s * gate * w;
        wsum += w;
      }
    }
    bloom = (wsum > 0.001) ? bloom / wsum : vec3(0.0);
    bloom *= vec3(uTintR, uTintG, uTintB) * (1.0 + kick * 2.0);

    // Strobe pulse
    float strobe = 1.0 + uStrobeAmount * kick * 1.2;
    col *= strobe;

    vec3 result = 1.0 - (1.0 - col) * (1.0 - bloom);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Wr=`
  uniform sampler2D uTexture;
  uniform float uTracking;      // 0-1 vertical sync drift
  uniform float uHeadSwitch;    // 0-1 head switching noise band
  uniform float uChromaBleed;   // 0-1
  uniform float uDropouts;      // 0-1
  uniform float uTapeNoise;     // 0-1
  uniform float uScanlines;     // 0-1
  uniform float uColorBleed;    // 0-1
  uniform float uSaturation;    // 0-1.5
  uniform float uTrackingJump;  // 0-1
  uniform float uMode;          // 0=clean, 1=worn, 2=destroyed
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 uv = vUv;
    int mode = int(uMode + 0.5);
    float modeBoost = (mode == 1) ? 1.3 : (mode == 2) ? 1.8 : 1.0;

    // Vertical tracking drift
    float trackJit = sin(uv.y * 30.0 + uTime * 2.0) * 0.005 * uTracking * modeBoost;
    uv.x += trackJit;

    // Tracking jump: occasional offset
    if (uTrackingJump > 0.001) {
      float jump = step(0.97, hash21(vec2(floor(uTime * 4.0), 0.0))) * uTrackingJump;
      if (uv.y < 0.4) uv.x += jump * 0.05;
    }

    // Head switch noise band at bottom
    float headBand = smoothstep(0.05, 0.0, uv.y) * uHeadSwitch * modeBoost;
    if (headBand > 0.01) {
      uv.x += (hash21(vec2(uv.y * 100.0, floor(uTime * 8.0))) - 0.5) * 0.04;
    }

    // Sample with chroma bleed
    vec3 col;
    float cb = uChromaBleed * modeBoost * 0.04;
    col.r = texture2D(uTexture, uv + vec2(cb, 0.0)).r;
    col.g = texture2D(uTexture, uv).g;
    col.b = texture2D(uTexture, uv - vec2(cb, 0.0)).b;

    // Color bleed (horizontal smear)
    if (uColorBleed > 0.001) {
      float bleed = uColorBleed * modeBoost;
      col.r = mix(col.r, texture2D(uTexture, uv + vec2(0.02 * bleed, 0)).r, 0.4);
    }

    // Saturation
    float l = luma(col);
    col = mix(vec3(l), col, uSaturation);

    // Tape noise (added grain)
    if (uTapeNoise > 0.001) {
      float n = (hash21(vUv * uResolution + uTime * 60.0) - 0.5) * uTapeNoise * modeBoost * 0.4;
      col += vec3(n);
    }

    // Scanlines
    if (uScanlines > 0.001) {
      float sl = sin(uv.y * 800.0) * 0.5 + 0.5;
      col *= mix(1.0, sl * 0.6 + 0.4, uScanlines * modeBoost);
    }

    // Dropouts: random horizontal bright stripes
    if (uDropouts > 0.001) {
      float yB = floor(uv.y * 60.0);
      float drop = step(0.93, hash21(vec2(yB, floor(uTime * 6.0))));
      col += vec3(drop * uDropouts * modeBoost * 0.6);
    }

    // Head band overlay (washes color)
    col += vec3(headBand * 0.5);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`,qr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uMix;           // 0-1 fresh-vs-feedback
  uniform float uZoom;          // 0.85-1.15
  uniform float uRotation;      // -0.2..0.2 radians per frame
  uniform float uDecay;         // 0-1
  uniform float uHueShift;      // 0-1 per frame
  uniform float uMaskCenter;    // 0-1 vignette around center
  uniform float uChromaSplit;   // 0-1
  uniform float uOffsetX;       // -0.1..0.1 per frame translate
  uniform float uOffsetY;       // -0.1..0.1
  uniform float uMode;          // 0=normal, 1=invert blend, 2=multiply
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    if (uHasFeedback < 0.5) { gl_FragColor = vec4(src, 1.0); return; }

    // Sample feedback at zoomed/rotated/translated UV
    vec2 d = (vUv - 0.5) * uZoom;
    float ca = cos(uRotation), sa = sin(uRotation);
    d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    vec2 fbUv = 0.5 + d - vec2(uOffsetX, uOffsetY);

    vec3 fb;
    if (uChromaSplit > 0.001) {
      fb.r = texture2D(uFeedback, fbUv + vec2(uChromaSplit * 0.005, 0)).r;
      fb.g = texture2D(uFeedback, fbUv).g;
      fb.b = texture2D(uFeedback, fbUv - vec2(uChromaSplit * 0.005, 0)).b;
    } else {
      fb = texture2D(uFeedback, fbUv).rgb;
    }
    fb *= 1.0 - uDecay;

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(fb);
      hsv.x = fract(hsv.x + uHueShift);
      fb = hsv2rgb(hsv);
    }

    // Center mask: only feedback in center, fade edges
    if (uMaskCenter > 0.001) {
      float mask = 1.0 - smoothstep(0.2, 0.8, length(vUv - 0.5));
      fb *= mix(1.0, mask, uMaskCenter);
    }

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = mix(src, src + fb, uMix);
    else if (mode == 1) result = mix(src, 1.0 - (1.0 - src) * (1.0 - fb), uMix);
    else result = mix(src, src * (1.0 + fb), uMix);

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Yr=`
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uGridDensity;   // 4-32
  uniform float uPerspective;   // 0-1 fake 3D depth
  uniform float uSpeed;         // 0-3
  uniform float uIntersectionGlow; // 0-1
  uniform float uLineWidth;     // 0.5-4
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uAudio;
  uniform float uAudioReact;    // 0-2
  uniform float uMode;          // 0=floor grid, 1=ceiling, 2=tunnel
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);

    // Perspective transform
    vec2 uv = vUv;
    if (mode == 0) {
      // Floor: bottom is closer, top is further
      float persp = mix(1.0, 0.2, uv.y * uPerspective);
      uv.x = (uv.x - 0.5) / persp + 0.5;
      uv.y = mix(uv.y, pow(uv.y, 2.0), uPerspective);
    } else if (mode == 1) {
      // Ceiling: inverted floor
      float persp = mix(1.0, 0.2, (1.0 - uv.y) * uPerspective);
      uv.x = (uv.x - 0.5) / persp + 0.5;
      uv.y = mix(uv.y, 1.0 - pow(1.0 - uv.y, 2.0), uPerspective);
    } else {
      // Tunnel: radial perspective
      vec2 d = uv - 0.5;
      float r = length(d);
      uv = 0.5 + d / max(0.01, r * uPerspective + (1.0 - uPerspective));
    }

    // Animated grid lines
    float t = uTime * uSpeed;
    float audioBoost = 1.0 + uAudio * uAudioReact;
    vec2 grid = abs(fract(uv * uGridDensity * audioBoost - vec2(0.0, t * 0.3)) - 0.5);
    float lineX = smoothstep(uLineWidth * 0.02, 0.0, grid.x);
    float lineY = smoothstep(uLineWidth * 0.02, 0.0, grid.y);
    float gridLine = max(lineX, lineY);

    // Intersection brightness
    float intersect = lineX * lineY * uIntersectionGlow * (1.0 + audioBoost);

    vec3 grid3 = vec3(uTintR, uTintG, uTintB) * (gridLine + intersect * 2.0) * uIntensity;
    vec3 result = 1.0 - (1.0 - src) * (1.0 - grid3);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Xr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uShards;        // 4-32
  uniform float uShardSize;     // 0.05-0.5
  uniform float uRotation;      // 0-360 max per-shard rotation
  uniform float uDelayAmount;   // 0-1 (uses feedback)
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=voronoi, 1=hex, 2=triangular
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 cellId; vec2 cellCenter; vec2 cellUv;

    if (mode == 0) {
      // Voronoi shards
      vec2 p = vUv * uShards;
      vec2 i = floor(p), f = fract(p);
      float minD = 9.0;
      vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { minD = d; best = i + g; cellUv = r; }
        }
      }
      cellId = best;
      cellCenter = (best + 0.5) / uShards;
    } else if (mode == 1) {
      // Hex
      vec2 q = vec2(vUv.x * 1.1547, vUv.y) * uShards;
      q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cellId = vec2(i.x - floor(i.y / 2.0), i.y);
      cellCenter = (cellId + 0.5) / uShards;
      cellUv = fract(q) - 0.5;
    } else {
      // Triangular
      vec2 p = vUv * uShards;
      vec2 i = floor(p);
      cellId = i;
      cellCenter = (i + 0.5) / uShards;
      cellUv = fract(p) - 0.5;
    }

    // Per-shard rotation + delay
    float ang = (hash21(cellId) - 0.5) * radians(uRotation);
    ang += uTime * 0.1 * (hash21(cellId + 7.3) - 0.5);
    float ca = cos(ang), sa = sin(ang);
    vec2 sUv = cellCenter + vec2(cellUv.x * ca - cellUv.y * sa, cellUv.x * sa + cellUv.y * ca) * uShardSize;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));

    vec3 col;
    if (uChromatic > 0.001) {
      vec2 cd = vec2(uChromatic * 0.005, 0.0);
      col.r = texture2D(uTexture, sUv + cd).r;
      col.g = texture2D(uTexture, sUv).g;
      col.b = texture2D(uTexture, sUv - cd).b;
    } else {
      col = texture2D(uTexture, sUv).rgb;
    }

    // Delay with feedback (random per-shard mix)
    if (uDelayAmount > 0.001 && uHasFeedback > 0.5) {
      float useFb = step(0.5, hash21(cellId + 71.3));
      vec3 prev = texture2D(uFeedback, sUv).rgb;
      col = mix(col, prev, useFb * uDelayAmount);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`,Kr=`
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uExposure;      // 0-1 how much new frame contributes
  uniform float uDecay;         // 0-1 how fast old fades
  uniform float uHueShiftPerFrame; // 0-0.05
  uniform float uIntensity;     // 0-2
  uniform float uMode;          // 0=add, 1=max, 2=screen
  uniform float uClamp;         // 0-1 (limit accumulation)
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 prev = (uHasFeedback > 0.5) ? texture2D(uFeedback, vUv).rgb : vec3(0.0);
    prev *= 1.0 - uDecay;

    // Hue shift per frame
    if (uHueShiftPerFrame > 0.001 && uHasFeedback > 0.5) {
      vec3 hsv = rgb2hsv(prev);
      hsv.x = fract(hsv.x + uHueShiftPerFrame);
      prev = hsv2rgb(hsv);
    }

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = prev + src * uExposure;
    else if (mode == 1) result = max(prev, src * uExposure);
    else result = 1.0 - (1.0 - prev) * (1.0 - src * uExposure);

    if (uClamp > 0.001) result = clamp(result, vec3(0.0), vec3(uClamp + 1.0 - uClamp));
    result *= uIntensity;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Nr=`
  uniform sampler2D uTexture;
  uniform float uPalette;       // 0=ironbow, 1=jet, 2=viridis, 3=inferno
  uniform float uContourCount;  // 1-12 isolines
  uniform float uContourWidth;  // 0.001-0.02
  uniform float uContourGlow;   // 0-1
  uniform float uIntensity;     // 0-2
  uniform float uTrackBlobs;    // 0-1 highlight bright clusters
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 paletteCol(float t) {
    int p = int(uPalette + 0.5);
    if (p == 0) {
      // Ironbow
      vec3 c = mix(vec3(0, 0, 0.3), vec3(0.5, 0, 0.5), smoothstep(0.0, 0.25, t));
      c = mix(c, vec3(1, 0.3, 0), smoothstep(0.25, 0.55, t));
      c = mix(c, vec3(1, 1, 0.2), smoothstep(0.55, 0.85, t));
      c = mix(c, vec3(1, 1, 1), smoothstep(0.85, 1.0, t));
      return c;
    } else if (p == 1) {
      // Jet
      return vec3(
        smoothstep(0.35, 0.65, t) - smoothstep(0.85, 1.0, t),
        smoothstep(0.0, 0.35, t) - smoothstep(0.65, 1.0, t),
        smoothstep(0.0, 0.15, t) - smoothstep(0.5, 0.7, t)
      );
    } else if (p == 2) {
      // Viridis
      return vec3(0.27 + 0.5 * t, 0.005 + 0.9 * t, 0.33 + 0.5 * (1.0 - t));
    } else {
      // Inferno
      vec3 c = mix(vec3(0, 0, 0), vec3(0.4, 0, 0.4), smoothstep(0.0, 0.3, t));
      c = mix(c, vec3(0.95, 0.4, 0.1), smoothstep(0.3, 0.65, t));
      c = mix(c, vec3(1, 1, 0.6), smoothstep(0.65, 1.0, t));
      return c;
    }
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    vec3 thermal = paletteCol(l) * uIntensity;

    // Contour isolines
    float cw = max(0.001, uContourWidth);
    float bands = max(1.0, uContourCount);
    float bandPos = fract(l * bands);
    float contour = smoothstep(cw, 0.0, abs(bandPos - 0.5)) * uContourGlow;
    thermal += vec3(1.0) * contour;

    // Track blobs: highlight luma clusters
    if (uTrackBlobs > 0.001) {
      vec2 texel = 1.0 / uResolution;
      float lN = luma(texture2D(uTexture, vUv + texel * vec2(0, 4)).rgb);
      float lS = luma(texture2D(uTexture, vUv + texel * vec2(0, -4)).rgb);
      float lE = luma(texture2D(uTexture, vUv + texel * vec2(4, 0)).rgb);
      float lW = luma(texture2D(uTexture, vUv + texel * vec2(-4, 0)).rgb);
      float gradMag = abs(l - lN) + abs(l - lS) + abs(l - lE) + abs(l - lW);
      thermal += vec3(0.2, 1.0, 0.8) * smoothstep(0.6, 1.0, l) * uTrackBlobs * (1.0 - gradMag);
    }

    vec3 result = mix(src, thermal, uMix);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,jr=`
  uniform sampler2D uTexture;
  uniform float uBloomAmount;   // 0-2
  uniform float uBloomRadius;   // 1-30
  uniform float uHalation;      // 0-1
  uniform float uChromaticBlur; // 0-1
  uniform float uPastelRolloff; // 0-1 desaturate highlights toward pastel
  uniform float uShadowLift;    // 0-0.5
  uniform float uSoftness;      // 0-1 overall softness
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Chromatic blur per channel
    vec3 cbCol = src;
    if (uChromaticBlur > 0.001) {
      float cb = uChromaticBlur * 6.0;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          vec2 off = vec2(float(x), float(y)) * texel * cb;
          float w = exp(-(float(x*x + y*y)) / 4.0);
          acc.r += texture2D(uTexture, vUv + off * 1.05).r * w;
          acc.g += texture2D(uTexture, vUv + off).g * w;
          acc.b += texture2D(uTexture, vUv + off * 0.95).b * w;
          wsum += w;
        }
      }
      cbCol = acc / wsum;
    }

    // Bloom on highlights
    vec3 bloom = vec3(0.0);
    float wsum2 = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        if (abs(x) + abs(y) > 4) continue;
        vec2 off = vec2(float(x), float(y)) * texel * uBloomRadius * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(0.55, 0.85, luma(s));
        float w = exp(-(float(x*x + y*y)) / 8.0);
        bloom += s * gate * w;
        wsum2 += w;
      }
    }
    bloom = (wsum2 > 0.001) ? bloom / wsum2 : vec3(0.0);
    bloom *= uBloomAmount;

    // Halation (warm bleed around highlights)
    vec3 halo = bloom * vec3(1.0, 0.6, 0.4) * uHalation;

    // Pastel rolloff: desaturate highlights toward white
    float l = luma(cbCol);
    if (uPastelRolloff > 0.001) {
      vec3 pastel = mix(cbCol, vec3(1.0), smoothstep(0.7, 1.0, l) * uPastelRolloff);
      cbCol = pastel;
    }

    // Shadow lift
    cbCol += vec3(uShadowLift) * (1.0 - smoothstep(0.0, 0.4, l));

    // Combine
    vec3 result = cbCol + bloom + halo;
    result *= vec3(uTintR, uTintG, uTintB);
    // Overall softness via slight blur mix
    result = mix(result, mix(result, src, 0.5), uSoftness * 0.3);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,$r=`
  uniform sampler2D uTexture;
  uniform float uContourCount;  // 4-32
  uniform float uContourWidth;  // 0.001-0.05
  uniform float uDisplacement;  // 0-1
  uniform float uChromaticEdge; // 0-1
  uniform float uColorR;        // contour line color
  uniform float uColorG;
  uniform float uColorB;
  uniform float uShadowRidges;  // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Estimate gradient of luma
    float l = luma(src);
    float lE = luma(texture2D(uTexture, vUv + texel * vec2(1, 0)).rgb);
    float lN = luma(texture2D(uTexture, vUv + texel * vec2(0, 1)).rgb);
    vec2 grad = vec2(lE - l, lN - l);

    // Contour bands
    float bands = max(1.0, uContourCount);
    float bandPos = fract(l * bands);
    float ridge = smoothstep(uContourWidth * 5.0, 0.0, abs(bandPos - 0.5));

    // Displacement: shift sample along gradient by ridge
    vec2 disp = grad * ridge * uDisplacement * 0.3;
    vec3 col;
    if (uChromaticEdge > 0.001) {
      col.r = texture2D(uTexture, vUv + disp * (1.0 + uChromaticEdge * 0.5)).r;
      col.g = texture2D(uTexture, vUv + disp).g;
      col.b = texture2D(uTexture, vUv + disp * (1.0 - uChromaticEdge * 0.5)).b;
    } else {
      col = texture2D(uTexture, vUv + disp).rgb;
    }

    // Contour line overlay
    vec3 contour = vec3(uColorR, uColorG, uColorB) * ridge;

    // Shadow ridges (darker on one side of contour)
    if (uShadowRidges > 0.001) {
      float side = step(0.5, bandPos);
      col *= 1.0 - side * ridge * uShadowRidges * 0.5;
    }

    vec3 result = mix(src, col + contour, uMix);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Zr=`
  uniform sampler2D uTexture;
  uniform float uBPM;           // 30-240
  uniform float uSteps;         // 4-16 step count per bar
  uniform float uPattern;       // bit-encoded pattern (0..(2^16-1))
  uniform float uMode;          // 0=on/off, 1=invert, 2=tint, 3=zoom
  uniform float uIntensity;     // 0-2
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uSwing;         // 0-0.5 (offbeat shift)
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int steps = int(clamp(uSteps, 1.0, 16.0));
    float beatLen = 60.0 / max(1.0, uBPM);
    float stepLen = beatLen / float(steps) * 4.0; // 16 steps = 1 bar @4/4
    float t = uTime;
    float stepF = mod(t / stepLen, float(steps));
    int stepIdx = int(stepF);
    // Apply swing on odd steps
    float frac = fract(stepF);
    if (stepIdx % 2 == 1) frac = clamp(frac - uSwing, 0.0, 1.0);

    // Decode pattern bit (uPattern is treated as bitmask)
    float patternF = uPattern;
    float bitVal = mod(floor(patternF / pow(2.0, float(stepIdx))), 2.0);
    float gate = (bitVal > 0.5 && frac < 0.5) ? 1.0 : 0.0;

    int mode = int(uMode + 0.5);
    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 result = src;
    if (mode == 0) {
      result = mix(src, src + tint * uIntensity, gate);
    } else if (mode == 1) {
      result = mix(src, 1.0 - src, gate * uIntensity);
    } else if (mode == 2) {
      result = mix(src, src * tint + tint * 0.4, gate * uIntensity);
    } else {
      // Zoom-on-beat
      vec2 d = vUv - 0.5;
      float zoom = 1.0 + gate * uIntensity * 0.1;
      vec2 sUv = 0.5 + d / zoom;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      result = texture2D(uTexture, sUv).rgb;
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`,Jr=`
  uniform sampler2D uTexture;
  uniform float uAmount;  // -1 to 1, brightness adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    texColor.rgb += uAmount;
    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);
  }
`,Qr=`
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0.5 to 2.0, contrast adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    texColor.rgb = (texColor.rgb - 0.5) * uAmount + 0.5;
    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);
  }
`,el=`
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0 to 2, saturation adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Convert RGB to HSL for saturation adjustment
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 adjusted = mix(vec3(lum), texColor.rgb, uAmount);

    gl_FragColor = vec4(adjusted, texColor.a);
  }
`,tl=`
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0 to 1, hue rotation (0-360 degrees)
  varying vec2 vUv;

  vec3 rotateHue(vec3 color, float hueShift) {
    const vec3 k = vec3(0.57735, 0.57735, 0.57735);
    float cosAngle = cos(hueShift);
    return color * cosAngle + cross(k, color) * sin(hueShift) + k * dot(k, color) * (1.0 - cosAngle);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Rotate hue (uAmount is 0-1, convert to 0-2π)
    float hueRotation = uAmount * 6.28318530718;
    vec3 adjusted = rotateHue(texColor.rgb, hueRotation);

    gl_FragColor = vec4(clamp(adjusted, 0.0, 1.0), texColor.a);
  }
`,ol=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Pseudo-random hash
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Value noise
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Fractal Brownian Motion
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  // Directional blur helper
  vec4 sampleDir(vec2 uv, vec2 dir, float radius) {
    vec4 acc = vec4(0.0);
    float w = 0.0;
    for (int i = -8; i <= 8; i++) {
      float t = float(i) / 8.0;
      float ww = 1.0 - abs(t);
      acc += texture2D(uTexture, clamp(uv + dir * t * radius, 0.0, 1.0)) * ww;
      w += ww;
    }
    return acc / max(w, 0.0001);
  }

  // HSV conversion
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;
    int mode = int(uMode + 0.5);

    // ── Mode 0: Filmic Tonemap (ACES) ──
    if (mode == 0) {
      float intensity = uAmount;
      float shoulder = 0.5 + uAmount2 * 2.0;
      float toe = uAmount3 * 0.5;
      float whitePoint = 0.5 + uThreshold * 1.5;
      vec3 x = src.rgb * (1.0 + intensity);
      // ACES-like curve: (x * (a*x + b)) / (x * (c*x + d) + e)
      float a = shoulder;
      float b = toe;
      float cCoeff = shoulder - 0.3;
      float d = 0.2;
      float e = 0.02;
      vec3 mapped = (x * (a * x + vec3(b))) / (x * (cCoeff * x + vec3(d)) + vec3(e));
      mapped /= (vec3(whitePoint) * (a * whitePoint + b)) / (whitePoint * (cCoeff * whitePoint + d) + e);
      outColor.rgb = mix(src.rgb, clamp(mapped, 0.0, 1.0), intensity);
    }
    // ── Mode 1: Selective Color (hue targeting) ──
    else if (mode == 1) {
      vec3 hsv = rgb2hsv(src.rgb);
      float targetHue = uColor.r;
      float hueWidth = max(0.01, uAmount2 * 0.3);
      float dist = min(abs(hsv.x - targetHue), min(abs(hsv.x - targetHue + 1.0), abs(hsv.x - targetHue - 1.0)));
      float mask = 1.0 - smoothstep(0.0, hueWidth, dist);
      mask *= uAmount;
      float hueShift = (uColor.g - 0.5) * 0.5;
      float satShift = (uAmount3 - 0.5) * 2.0;
      float lumShift = (uColor.b - 0.5) * 0.5;
      hsv.x = fract(hsv.x + hueShift * mask);
      hsv.y = clamp(hsv.y + satShift * mask, 0.0, 1.0);
      hsv.z = clamp(hsv.z + lumShift * mask, 0.0, 1.0);
      outColor.rgb = hsv2rgb(hsv);
    }
    // ── Mode 2: False Color (IRE exposure zebra) ──
    else if (mode == 2) {
      float l = luma(src.rgb);
      float intensity = uAmount;
      float bands = 3.0 + uAmount2 * 12.0;
      // Map luminance to false color rainbow
      vec3 fc;
      float t = l * bands;
      fc.r = 0.5 + 0.5 * sin(t * 2.1 + 0.0);
      fc.g = 0.5 + 0.5 * sin(t * 2.1 + 2.094);
      fc.b = 0.5 + 0.5 * sin(t * 2.1 + 4.188);
      // Overexposure warning: flash red above threshold
      if (l > uThreshold) {
        fc = vec3(1.0, 0.0, 0.0) * (0.5 + 0.5 * sin(uTime * 8.0));
      }
      outColor.rgb = mix(src.rgb, fc, intensity);
    }
    // ── Mode 3: Shadow Recovery ──
    else if (mode == 3) {
      float l = luma(src.rgb);
      float lift = uAmount * 0.5;
      float range = uAmount2;
      float protect = uThreshold;
      // Only affect shadows, leave highlights alone
      float shadowMask = 1.0 - smoothstep(0.0, max(0.01, range), l);
      float highlightProtect = smoothstep(protect, 1.0, l);
      float recovery = lift * shadowMask * (1.0 - highlightProtect);
      outColor.rgb = src.rgb + vec3(recovery);
    }
    // ── Mode 4: Highlight Roll-off ──
    else if (mode == 4) {
      float rolloff = uAmount;
      float knee = max(0.01, uAmount2 * 0.5);
      float thresh = uThreshold;
      vec3 c = src.rgb;
      // Soft-clip highlights with smooth knee
      for (int i = 0; i < 3; i++) {
        float v = c[i];
        if (v > thresh) {
          float excess = v - thresh;
          c[i] = thresh + excess / (1.0 + excess * rolloff / knee);
        }
      }
      outColor.rgb = c;
    }
    // ── Mode 5: Halation (warm highlight bleed) ──
    else if (mode == 5) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.15, l);
      // Blur bright areas
      vec4 blur = sampleDir(uv, vec2(px.x, 0.0), mix(10.0, 60.0, uAmount2) * px.x)
        + sampleDir(uv, vec2(0.0, px.y), mix(10.0, 60.0, uAmount2) * px.y);
      blur *= 0.5;
      // Tint with warm color
      vec3 halGlow = blur.rgb * gate * uColor * 2.0;
      outColor.rgb = src.rgb + halGlow * uAmount;
    }
    // ── Mode 6: Anamorphic Streak ──
    else if (mode == 6) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.15, l);
      // Horizontal-only blur for streaks
      vec4 streak = sampleDir(uv, vec2(px.x, 0.0), mix(20.0, 120.0, uAmount) * px.x);
      vec3 streakTint = streak.rgb * gate * uColor * 2.0;
      outColor.rgb = src.rgb + streakTint * uAmount2;
    }
    // ── Mode 7: Lens Dirt (procedural) ──
    else if (mode == 7) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.2, l);
      // Procedural dirt pattern using noise
      float scale = 2.0 + uAmount2 * 8.0;
      float complexity = 2.0 + uAmount3 * 4.0;
      float dirt = 0.0;
      for (int i = 0; i < 4; i++) {
        float s = scale * (1.0 + float(i) * 0.7);
        dirt += vnoise(uv * s + float(i) * 13.7) * (1.0 / (1.0 + float(i)));
      }
      dirt = smoothstep(0.3, 0.8, dirt);
      // Glow where bright and dirty
      vec3 glow = src.rgb * gate * dirt * 2.0;
      outColor.rgb = src.rgb + glow * uAmount;
    }
    // ── Mode 8: Defocus Bokeh (hexagonal) ──
    else if (mode == 8) {
      float radius = uAmount * 15.0;
      float shape = uAmount2;
      float highlightBoost = uThreshold;
      float ringWidth = uAmount3;
      vec4 acc = vec4(0.0);
      float w = 0.0;
      // Sample in hexagonal pattern
      for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
          vec2 off = vec2(float(i), float(j) + float(i) * 0.5 * shape);
          float r = length(off);
          if (r > 4.5) continue;
          // Ring-shaped weight for bokeh look
          float ringW = mix(1.0, smoothstep(2.0, 4.0, r), ringWidth);
          vec4 s = texture2D(uTexture, uv + off * px * radius);
          // Boost bright samples for highlight bokeh
          float lum = luma(s.rgb);
          float boost = 1.0 + smoothstep(0.5, 1.0, lum) * highlightBoost * 3.0;
          acc += s * ringW * boost;
          w += ringW * boost;
        }
      }
      outColor = acc / max(w, 0.001);
    }
    // ── Mode 9: Diffusion / Pro-Mist ──
    else if (mode == 9) {
      float l = luma(src.rgb);
      // Soft glow from highlights
      vec4 blur = sampleDir(uv, vec2(px.x, px.y), mix(15.0, 80.0, uAmount2) * max(px.x, px.y))
        + sampleDir(uv, vec2(px.x, -px.y), mix(15.0, 80.0, uAmount2) * max(px.x, px.y));
      blur *= 0.5;
      float gate = smoothstep(uThreshold, uThreshold + 0.3, l);
      // Warm shift
      vec3 warmBlur = blur.rgb * (1.0 + vec3(uAmount3 * 0.2, uAmount3 * 0.1, -uAmount3 * 0.1));
      outColor.rgb = src.rgb + warmBlur * gate * uAmount;
      // Slight desaturation for dreamy feel
      float outL = luma(outColor.rgb);
      outColor.rgb = mix(outColor.rgb, vec3(outL), uAmount * 0.15);
    }
    // ── Mode 10: ASCII Art ──
    else if (mode == 10) {
      float cellSize = mix(4.0, 24.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      // Sample at cell center
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      // Simulate character density with patterns
      vec2 local = fract(uv * uResolution / cellSize);
      // Character-like patterns based on luminance
      float charMask;
      if (l > 0.9) { charMask = 1.0; } // '@' or '#' - full block
      else if (l > 0.7) { charMask = step(0.2, local.x) * step(local.x, 0.8) * step(0.2, local.y) * step(local.y, 0.8) > 0.0 ? 1.0 : 0.0; }
      else if (l > 0.5) { charMask = step(0.3, local.x) * step(local.x, 0.7) > 0.0 ? 1.0 : (step(0.3, local.y) * step(local.y, 0.7) > 0.0 ? 1.0 : 0.0); } // '+' cross
      else if (l > 0.3) { charMask = step(0.4, local.x) * step(local.x, 0.6) > 0.0 ? 1.0 : 0.0; } // '|' or ':'
      else if (l > 0.15) { charMask = (step(0.4, local.x) * step(local.x, 0.6) * step(0.6, local.y) > 0.0) ? 1.0 : 0.0; } // '.'
      else { charMask = 0.0; } // space
      vec3 asciiColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
      outColor.rgb = asciiColor;
    }
    // ── Mode 11: Comic Ink (edges + halftone) ──
    else if (mode == 11) {
      float inkThickness = 1.0 + uAmount * 3.0;
      float halftoneSize = 3.0 + uAmount2 * 12.0;
      float con = 0.5 + uAmount3;
      float edgeThresh = uThreshold;
      // Edge detection (Sobel)
      float tl = luma(texture2D(uTexture, uv + vec2(-px.x, px.y) * inkThickness).rgb);
      float t  = luma(texture2D(uTexture, uv + vec2(0.0, px.y) * inkThickness).rgb);
      float tr = luma(texture2D(uTexture, uv + vec2(px.x, px.y) * inkThickness).rgb);
      float l  = luma(texture2D(uTexture, uv + vec2(-px.x, 0.0) * inkThickness).rgb);
      float r  = luma(texture2D(uTexture, uv + vec2(px.x, 0.0) * inkThickness).rgb);
      float bl = luma(texture2D(uTexture, uv + vec2(-px.x, -px.y) * inkThickness).rgb);
      float b  = luma(texture2D(uTexture, uv + vec2(0.0, -px.y) * inkThickness).rgb);
      float br = luma(texture2D(uTexture, uv + vec2(px.x, -px.y) * inkThickness).rgb);
      float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
      float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
      float edge = sqrt(gx*gx + gy*gy);
      float ink = smoothstep(edgeThresh, edgeThresh + 0.15, edge);
      // Halftone dots
      vec2 grid = floor(uv * uResolution / halftoneSize);
      vec2 guv = (grid + 0.5) * halftoneSize / uResolution;
      float cellL = luma(texture2D(uTexture, guv).rgb);
      cellL = clamp((cellL - 0.5) * con + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / halftoneSize) - 0.5;
      float dot = 1.0 - step(cellL * 0.5, length(local));
      // Combine: white bg, halftone shading, ink lines on top
      outColor.rgb = vec3(mix(dot, 0.0, ink));
    }
    // ── Mode 12: Datamosh Lite (pixel sort by luminance bands) ──
    else if (mode == 12) {
      float intensity = uAmount;
      float bandWidth = 5.0 + uAmount2 * 30.0;
      float colorShift = uAmount3;
      // Sort-like horizontal offset based on luminance bands
      float l = luma(src.rgb);
      float band = floor(l * bandWidth) / bandWidth;
      float sortOffset = (band - 0.5) * intensity * 0.15;
      // Add time-based jitter
      float jitter = hash(vec2(floor(uv.y * uResolution.y * 0.5), floor(uTime * 3.0))) * 0.02 * intensity;
      vec2 sampleUv = uv + vec2(sortOffset + jitter, 0.0);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
      // Color channel separation
      if (colorShift > 0.01) {
        outColor.r = texture2D(uTexture, clamp(sampleUv + vec2(colorShift * 0.01, 0.0), 0.0, 1.0)).r;
        outColor.b = texture2D(uTexture, clamp(sampleUv - vec2(colorShift * 0.01, 0.0), 0.0, 1.0)).b;
      }
    }
    // ── Mode 13: Scanline Drift ──
    else if (mode == 13) {
      float drift = uAmount * 0.1;
      float bandH = 5.0 + uAmount2 * 50.0;
      float speed = uAmount3 * 3.0;
      // Horizontal bands that drift over time
      float row = floor(uv.y * bandH);
      float bandPhase = hash(vec2(row, 0.0)) * TAU;
      float offset = sin(uTime * speed + bandPhase) * drift;
      // Some bands drift more than others
      float bandIntensity = hash(vec2(row, 1.0));
      offset *= bandIntensity;
      vec2 sampleUv = vec2(uv.x + offset, uv.y);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
      // Slight brightness variation per band
      outColor.rgb *= 0.9 + bandIntensity * 0.2;
    }
    // ── Mode 14: Tape Dropout ──
    else if (mode == 14) {
      float dropoutRate = uAmount;
      float bandHeight = 2.0 + uAmount2 * 15.0;
      float noiseAmt = uAmount3;
      float row = floor(uv.y * uResolution.y / bandHeight);
      float dropHash = hash(vec2(row, floor(uTime * 6.0)));
      // Random dropout bands
      if (dropHash < dropoutRate * 0.3) {
        // White noise band
        float n = hash(uv * uResolution + uTime);
        outColor.rgb = vec3(n) * noiseAmt;
        // Offset horizontally
        float hOff = (hash(vec2(row, uTime)) - 0.5) * 0.1;
        vec4 shifted = texture2D(uTexture, clamp(vec2(uv.x + hOff, uv.y), 0.0, 1.0));
        outColor.rgb = mix(outColor.rgb, shifted.rgb, 0.3);
      }
    }
    // ── Mode 15: Polar Transform ──
    else if (mode == 15) {
      float amount = uAmount;
      vec2 center = uCenter;
      float rotation = uAmount2 * TAU;
      vec2 d = uv - center;
      float r = length(d);
      float theta = atan(d.y, d.x) + rotation;
      // Map polar to rectangular or vice versa
      vec2 polarUv = vec2(theta / TAU + 0.5, r * 2.0);
      vec2 finalUv = mix(uv, polarUv, amount);
      outColor = texture2D(uTexture, clamp(fract(finalUv), 0.0, 1.0));
    }
    // ── Mode 16: Ripple Caustics ──
    else if (mode == 16) {
      float dist = uAmount * 0.03;
      float scale = 3.0 + uAmount2 * 15.0;
      float speed = uAmount3 * 2.0;
      // Multiple overlapping sine waves for caustic pattern
      float caustic = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float phase = uTime * speed * (0.8 + fi * 0.3);
        vec2 dir = vec2(cos(fi * 2.094), sin(fi * 2.094));
        caustic += sin(dot(uv * scale, dir) + phase) * 0.33;
      }
      // Use caustic pattern to distort UV
      vec2 offset = vec2(
        sin(caustic * PI) * dist,
        cos(caustic * PI * 1.3) * dist
      );
      outColor = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0));
      // Add subtle caustic lighting
      float brightness = 1.0 + caustic * 0.15 * uAmount;
      outColor.rgb *= brightness;
    }
    // ── Mode 17: Shockwave ──
    else if (mode == 17) {
      float ringWidth = 0.02 + uAmount * 0.15;
      float distortion = uAmount2 * 0.15;
      float speed = uAmount3 * 2.0;
      vec2 center = uCenter;
      vec2 d = uv - center;
      float r = length(d);
      // Expanding ring
      float ringPos = fract(uTime * speed * 0.3);
      float ring = smoothstep(ringPos - ringWidth, ringPos, r) *
                   (1.0 - smoothstep(ringPos, ringPos + ringWidth, r));
      // Distort along radius
      vec2 offset = normalize(d + vec2(0.0001)) * ring * distortion;
      outColor = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0));
    }
    // ── Mode 18: Droste Recursive (log-polar spiral) ──
    else if (mode == 18) {
      vec2 center = uCenter;
      float zoom = 1.0 + uAmount * 4.0;
      float spiral = uAmount2 * 2.0;
      float branches = 1.0 + uAmount3 * 3.0;
      vec2 d = uv - center;
      float r = length(d);
      float theta = atan(d.y, d.x);
      // Log-polar transform
      float logR = log(max(r, 0.001)) / log(zoom);
      // Add spiral
      logR += theta * spiral / TAU;
      // Repeat
      vec2 drosteUv = center + vec2(
        cos(theta * branches) * exp(fract(logR) * log(zoom)),
        sin(theta * branches) * exp(fract(logR) * log(zoom))
      );
      outColor = texture2D(uTexture, clamp(fract(drosteUv), 0.0, 1.0));
    }
    // ── Mode 19: Slit-Scan ──
    else if (mode == 19) {
      float slitWidth = uAmount;
      float scanSpeed = uAmount2 * 2.0;
      float direction = uAmount3; // 0=horizontal, 1=vertical
      // Each row/column samples from a different time offset
      float pos = mix(uv.y, uv.x, direction);
      float timeOffset = pos * slitWidth * 3.0;
      // Simulate temporal offset by spatial offset
      float xOff = sin(pos * 20.0 + uTime * scanSpeed) * slitWidth * 0.1;
      float yOff = cos(pos * 15.0 + uTime * scanSpeed * 0.7) * slitWidth * 0.1;
      vec2 sampleUv = uv + vec2(xOff, yOff);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
    }
    // ── Mode 20: Volumetric Fog ──
    else if (mode == 20) {
      float density = uAmount;
      float scale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3;
      vec3 fogColor = uColor;
      // Layered noise for volumetric look
      float fog = 0.0;
      fog += fbm(uv * scale + vec2(uTime * speed * 0.3, uTime * speed * 0.2)) * 0.6;
      fog += fbm(uv * scale * 2.0 + vec2(-uTime * speed * 0.2, uTime * speed * 0.15)) * 0.3;
      fog += fbm(uv * scale * 4.0 + vec2(uTime * speed * 0.1)) * 0.1;
      // Fade stronger at bottom
      fog *= (1.0 - uv.y * 0.5);
      fog = smoothstep(0.2, 0.8, fog) * density;
      outColor.rgb = mix(src.rgb, fogColor, fog);
    }
    // ── Mode 21: Rain/Snow Overlay ──
    else if (mode == 21) {
      float density = uAmount * 200.0;
      float speed = uAmount2 * 5.0;
      float size = 0.002 + uAmount3 * 0.008;
      float windAngle = uAngle;
      vec2 windDir = vec2(sin(windAngle), -cos(windAngle));
      // Multiple layers of particles for depth
      float particles = 0.0;
      for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float layerScale = 1.0 + fl * 0.5;
        float layerSpeed = speed * (0.7 + fl * 0.3);
        vec2 cellUv = uv * vec2(density * layerScale * 0.3, density * layerScale);
        cellUv += windDir * uTime * layerSpeed;
        vec2 cellId = floor(cellUv);
        vec2 cellLocal = fract(cellUv) - 0.5;
        // Random offset per cell
        vec2 offset = vec2(hash(cellId) - 0.5, hash(cellId + 100.0) - 0.5) * 0.4;
        float d = length(cellLocal - offset);
        float particle = smoothstep(size * layerScale, 0.0, d);
        // Fade with depth
        particles += particle * (1.0 - fl * 0.25);
      }
      particles = clamp(particles, 0.0, 1.0);
      outColor.rgb = src.rgb + vec3(particles);
    }
    // ── Mode 22: 3D Particle Dissolve ──
    else if (mode == 22) {
      float scatter = uAmount;         // 0=solid image, 1=fully scattered
      float pSize = 0.3 + uAmount2 * 1.5; // particle size multiplier
      float speed = uAmount3 * 2.0;
      float bright = 0.5 + uThreshold;
      // Grid resolution — each cell becomes one "particle"
      float gridRes = mix(30.0, 100.0, 1.0 - uAmount2 * 0.5);
      vec2 cellCount = vec2(gridRes, gridRes * uResolution.y / uResolution.x);
      vec2 cellSize = 1.0 / cellCount;
      // Find which grid cell this pixel belongs to
      vec2 cellId = floor(uv * cellCount);
      vec2 cellLocal = fract(uv * cellCount) - 0.5; // -0.5 to 0.5 within cell
      // Per-particle random values
      float rnd1 = hash(cellId);
      float rnd2 = hash(cellId + 137.0);
      float rnd3 = hash(cellId + 271.0);
      float rnd4 = hash(cellId + 419.0);
      // Source color at cell center
      vec2 cellCenter = (cellId + 0.5) * cellSize;
      vec4 cellColor = texture2D(uTexture, cellCenter);
      float cellLuma = luma(cellColor.rgb);
      // 3D displacement — particles fly out based on scatter amount
      float phase = rnd1 * TAU + uTime * speed * (0.5 + rnd2 * 0.5);
      float scatterAmt = scatter * (0.5 + rnd3 * 0.5);
      vec2 displacement = vec2(
        sin(phase) * scatterAmt * 0.3,
        cos(phase * 0.7 + rnd2 * TAU) * scatterAmt * 0.3
      );
      // Z depth — particles move toward/away from camera
      float zDepth = sin(phase * 0.5 + rnd4 * TAU) * scatter;
      float zScale = 1.0 / (1.0 + abs(zDepth) * 2.0); // perspective size
      // Displaced cell center for this particle
      vec2 particleCenter = cellCenter + displacement;
      // Distance from this pixel to the displaced particle center
      vec2 toParticle = uv - particleCenter;
      // Apply perspective scaling to distance check
      float particleRadius = cellSize.x * pSize * zScale * 0.5;
      float dist = length(toParticle / vec2(1.0, uResolution.x / uResolution.y));
      // Soft circular particle with glow
      float core = smoothstep(particleRadius, particleRadius * 0.3, dist);
      float glow = smoothstep(particleRadius * 2.5, particleRadius * 0.5, dist) * 0.3;
      float particle = core + glow;
      // 3D lighting — key light from top-right + fill from left
      vec3 normal = vec3(toParticle / max(particleRadius, 0.001), sqrt(max(0.0, 1.0 - dot(cellLocal, cellLocal) * 4.0)));
      normal = normalize(normal);
      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diffuse = max(dot(normal, lightDir), 0.0);
      float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);
      float fillLight = max(dot(normal, normalize(vec3(-0.5, 0.3, 0.8))), 0.0) * 0.3;
      // Depth-based fade (farther particles are dimmer)
      float depthFade = 1.0 - abs(zDepth) * 0.5;
      // Combine
      vec3 lit = cellColor.rgb * (diffuse * 0.7 + fillLight + 0.3) + vec3(specular * 0.5);
      lit *= bright * depthFade;
      // Also check a few neighboring particles to fill gaps
      vec3 finalColor = vec3(0.0);
      float totalWeight = 0.0;
      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 nId = cellId + vec2(float(ox), float(oy));
          if (nId.x < 0.0 || nId.y < 0.0 || nId.x >= cellCount.x || nId.y >= cellCount.y) continue;
          vec2 nCenter = (nId + 0.5) * cellSize;
          float nr1 = hash(nId);
          float nr2 = hash(nId + 137.0);
          float nr3 = hash(nId + 271.0);
          float nr4 = hash(nId + 419.0);
          float nPhase = nr1 * TAU + uTime * speed * (0.5 + nr2 * 0.5);
          float nScatter = scatter * (0.5 + nr3 * 0.5);
          vec2 nDisp = vec2(sin(nPhase) * nScatter * 0.3, cos(nPhase * 0.7 + nr2 * TAU) * nScatter * 0.3);
          float nz = sin(nPhase * 0.5 + nr4 * TAU) * scatter;
          float nzScale = 1.0 / (1.0 + abs(nz) * 2.0);
          vec2 nPos = nCenter + nDisp;
          float nRadius = cellSize.x * pSize * nzScale * 0.5;
          float nDist = length((uv - nPos) / vec2(1.0, uResolution.x / uResolution.y));
          float nCore = smoothstep(nRadius, nRadius * 0.2, nDist);
          float nGlow = smoothstep(nRadius * 2.0, nRadius * 0.5, nDist) * 0.2;
          float nParticle = nCore + nGlow;
          if (nParticle > 0.01) {
            vec4 nColor = texture2D(uTexture, nCenter);
            float nDepthFade = 1.0 - abs(nz) * 0.5;
            float nDiffuse = 0.7 + 0.3 * (1.0 - nDist / nRadius);
            vec3 nLit = nColor.rgb * nDiffuse * bright * nDepthFade;
            // Z-sort: particles closer to camera draw on top
            float zWeight = 1.0 + nz;
            finalColor += nLit * nParticle * zWeight;
            totalWeight += nParticle * zWeight;
          }
        }
      }
      if (totalWeight > 0.01) {
        finalColor /= totalWeight;
        float alpha = clamp(totalWeight, 0.0, 1.0);
        outColor.rgb = mix(src.rgb * (1.0 - scatter * 0.7), finalColor, alpha);
      } else {
        outColor.rgb = src.rgb * (1.0 - scatter * 0.7);
      }
    }
    // ── Mode 23: Glint / Starburst ──
    else if (mode == 23) {
      float intensity = uAmount;
      float spikeLen = uAmount2 * 0.05;
      float thresh = uThreshold;
      float rotation = uAngle;
      float l = luma(src.rgb);
      float gate = smoothstep(thresh, thresh + 0.1, l);
      if (gate > 0.01) {
        // 6 directional spikes
        vec3 spikes = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float angle = float(i) * PI / 3.0 + rotation;
          vec2 dir = vec2(cos(angle), sin(angle)) * px;
          // Sample along spike direction
          vec3 spike = vec3(0.0);
          for (int j = 1; j <= 8; j++) {
            float t = float(j) / 8.0;
            float w = 1.0 - t;
            spike += texture2D(uTexture, clamp(uv + dir * t * spikeLen * uResolution.x, 0.0, 1.0)).rgb * w;
          }
          spike /= 4.0;
          spikes += spike;
        }
        spikes /= 6.0;
        outColor.rgb = src.rgb + spikes * gate * intensity;
      }
    }
    // ── Mode 24: Emboss Relight ──
    else if (mode == 24) {
      float strength = uAmount * 2.0;
      float angle = uAngle;
      vec3 lightColor = uColor;
      vec2 dir = vec2(cos(angle), sin(angle)) * px;
      float s1 = luma(texture2D(uTexture, uv - dir * 2.0).rgb);
      float s2 = luma(texture2D(uTexture, uv + dir * 2.0).rgb);
      float emboss = (s2 - s1) * strength;
      vec3 lit = src.rgb + emboss * lightColor;
      outColor.rgb = clamp(lit, 0.0, 1.0);
    }
    // ── Mode 25: Dot Matrix (hexagonal stagger + shape morph + per-cell rotation) ──
    else if (mode == 25) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float spacing = 0.3 + uAmount2 * 0.5;
      float colorMix = uAmount3;

      // Hexagonal stagger: offset every other row by half a cell
      vec2 pxCoord = uv * uResolution / cellSize;
      float row = floor(pxCoord.y);
      float stagger = mod(row, 2.0) * 0.5;
      vec2 cell = floor(vec2(pxCoord.x + stagger, pxCoord.y));
      vec2 cellUv = (cell + 0.5 - vec2(stagger, 0.0)) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, clamp(cellUv, 0.0, 1.0));
      float l = luma(cellColor.rgb);
      vec2 local = fract(vec2(pxCoord.x + stagger, pxCoord.y)) - 0.5;

      // Per-cell rotation driven by hue
      float hAngle = atan(cellColor.g - cellColor.b, cellColor.r - 0.5) * 0.3;
      float ca = cos(hAngle), sa = sin(hAngle);
      local = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca);

      // Shape morph: circle → rounded-square based on brightness
      float morph = smoothstep(0.3, 0.8, l);
      float circDist = length(local);
      float sqDist = max(abs(local.x), abs(local.y));
      float dist = mix(circDist, sqDist, morph);
      float dotRadius = l * spacing;
      float dot = 1.0 - smoothstep(dotRadius - 0.04, dotRadius + 0.04, dist);

      // Edge glow: subtle luminance halo
      float glow = exp(-max(0.0, dist - dotRadius) * 18.0) * l * 0.25;
      vec3 dotColor = mix(vec3(dot + glow), cellColor.rgb * (dot + glow), colorMix);
      outColor.rgb = dotColor;
    }
    // ── Mode 26: Matrix Rain (multi-stream cascade + procedural glyphs + color-reactive) ──
    else if (mode == 26) {
      float density = mix(6.0, 24.0, uAmount);
      float speed = 0.5 + uAmount2 * 3.0;
      float glow = uAmount3;
      float fadeDepth = uThreshold;

      vec2 cell = floor(uv * vec2(density, density * 2.0));
      float colId = hash(vec2(cell.x, 0.0));

      // Multi-stream: 3 overlapping cascades per column at different speeds
      float totalAlpha = 0.0;
      vec3 totalColor = vec3(0.0);
      for (int s = 0; s < 3; s++) {
        float streamOff = float(s) * 0.33;
        float fallSpeed = (0.3 + colId * 0.7 + streamOff * 0.4) * speed;
        float yOff = fract(colId * 137.0 + streamOff * 53.0 + uTime * fallSpeed * 0.1);
        float charY = fract(cell.y / (density * 2.0) + yOff);
        float brightness = pow(1.0 - charY, mix(2.0, 6.0, fadeDepth));

        // Procedural 5-segment glyph per cell (unique per stream)
        vec2 local = fract(uv * vec2(density, density * 2.0));
        float charSeed = hash(cell + floor(uTime * fallSpeed) + float(s) * 7.0);
        float cx = (local.x - 0.15) / 0.7;
        float cy = (local.y - 0.1) / 0.8;
        float inBounds = step(0.0, cx) * step(cx, 1.0) * step(0.0, cy) * step(cy, 1.0);

        // 5 horizontal segments (like a 7-segment display minus 2 verticals)
        float seg = 0.0;
        float segW = 0.12;
        if (fract(charSeed * 3.0) > 0.4) seg += step(abs(cy - 0.0) , segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 5.0) > 0.35) seg += step(abs(cy - 0.25), segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 7.0) > 0.3) seg += step(abs(cy - 0.5) , segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 11.0) > 0.35) seg += step(abs(cy - 0.75), segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 13.0) > 0.4) seg += step(abs(cy - 1.0) , segW) * step(0.15, cx) * step(cx, 0.85);
        // Verticals
        if (fract(charSeed * 17.0) > 0.5) seg += step(abs(cx - 0.15), 0.08) * step(0.0, cy) * step(cy, 0.5);
        if (fract(charSeed * 19.0) > 0.5) seg += step(abs(cx - 0.85), 0.08) * step(0.5, cy) * step(cy, 1.0);

        float combined = clamp(seg, 0.0, 1.0) * inBounds;

        float streamAlpha = combined * brightness * (1.0 - streamOff * 0.5);
        totalAlpha += streamAlpha;
        totalColor += streamAlpha * vec3(0.08 + streamOff * 0.1, 0.85 - streamOff * 0.2, 0.25 + streamOff * 0.15);
      }
      totalAlpha = clamp(totalAlpha, 0.0, 1.0);
      totalColor = totalAlpha > 0.001 ? totalColor / max(totalAlpha, 0.001) : vec3(0.0);

      // Source image color tints the rain
      vec4 srcCell = texture2D(uTexture, (cell + 0.5) / vec2(density, density * 2.0));
      float srcLuma = luma(srcCell.rgb);
      totalColor += totalColor * glow * totalAlpha;
      outColor.rgb = mix(src.rgb * 0.08, totalColor * (0.6 + srcLuma * 0.4), 0.4 + totalAlpha * 0.6);
    }
    // ── Mode 27: Binary Code (8-bit columns + wave animation + phosphor glow) ──
    else if (mode == 27) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;

      // Each cell is part of an 8-bit column (byte display)
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);

      // Map luminance to 8-bit value (0-255), display as column of 8 bits
      int byteVal = int(l * 255.0);
      int bitRow = int(mod(cell.y, 8.0));
      // Wave animation: bits shift through columns over time
      float wavePhase = sin(cell.x * 0.3 + uTime * 1.5) * 2.0;
      bitRow = int(mod(float(bitRow) + wavePhase, 8.0));
      int bitVal = int(mod(floor(float(byteVal) / pow(2.0, float(bitRow))), 2.0));
      float isOne = float(bitVal);

      // Draw '1': filled rounded rect with notch
      float rx = smoothstep(0.0, 0.12, local.x) * smoothstep(1.0, 0.88, local.x);
      float ry = smoothstep(0.0, 0.12, local.y) * smoothstep(1.0, 0.88, local.y);
      float one = rx * ry * 0.9;
      // Notch in top-right corner to distinguish from 0
      one *= 1.0 - step(0.7, local.x) * step(0.7, local.y) * 0.7;

      // Draw '0': hollow rounded rect (border only)
      float border = rx * ry;
      float inner = smoothstep(0.15, 0.25, local.x) * smoothstep(0.85, 0.75, local.x)
                   * smoothstep(0.15, 0.25, local.y) * smoothstep(0.85, 0.75, local.y);
      float zero = border * (1.0 - inner * 0.85);

      float charMask = mix(zero * 0.3, one, isOne);

      // Phosphor glow: brighter bits bleed into neighbors
      float glowR = exp(-length(local - 0.5) * 4.0) * isOne * l * 0.2;
      charMask += glowR;
      charMask *= 0.3 + l * 0.7;

      // Tint: ones are warm, zeros are cool
      vec3 tint = mix(vec3(0.4, 0.6, 1.0), vec3(1.0, 0.85, 0.5), isOne);
      vec3 binColor = mix(tint * charMask, cellColor.rgb * charMask, colorMix);
      outColor.rgb = binColor;
    }
    // ── Mode 28: Crosshatch (gradient-aligned strokes + variable width + ink pooling) ──
    else if (mode == 28) {
      float lineDensity = mix(20.0, 120.0, uAmount);
      float lineThick = 0.02 + uAmount2 * 0.08;
      float angleSpread = 0.5 + uAmount3;
      float darkThresh = uThreshold;

      // Compute local image gradient to align strokes with edges
      float lC = luma(src.rgb);
      float lR = luma(texture2D(uTexture, uv + vec2(1.0 / uResolution.x, 0.0)).rgb);
      float lU = luma(texture2D(uTexture, uv + vec2(0.0, 1.0 / uResolution.y)).rgb);
      float gx = lR - lC;
      float gy = lU - lC;
      float gradMag = length(vec2(gx, gy));
      float gradAngle = atan(gy, gx);

      // 4 hatch layers: 2 aligned with gradient, 2 perpendicular
      vec2 p = uv * lineDensity;
      float a1 = gradAngle + 0.0;
      float a2 = gradAngle + 1.5708;
      float a3 = angleSpread * 0.78;
      float a4 = -angleSpread * 0.78;

      // Variable line width: thicker in darker areas
      float thickScale = 1.0 + (1.0 - lC) * 0.8;
      float lt = lineThick * thickScale;

      float h1 = abs(fract(p.x * cos(a1) + p.y * sin(a1)) - 0.5);
      float h2 = abs(fract(p.x * cos(a2) + p.y * sin(a2)) - 0.5);
      float h3 = abs(fract(p.x * cos(a3) + p.y * sin(a3) + 0.3) - 0.5);
      float h4 = abs(fract(p.x * cos(a4) + p.y * sin(a4) + 0.6) - 0.5);

      float line1 = 1.0 - smoothstep(0.0, lt, h1);
      float line2 = 1.0 - smoothstep(0.0, lt * 0.9, h2);
      float line3 = 1.0 - smoothstep(0.0, lt * 0.7, h3);
      float line4 = 1.0 - smoothstep(0.0, lt * 0.5, h4);

      // Accumulate hatch: gradient-aligned strokes appear first
      float hatch = 0.0;
      hatch += line1 * step(lC, darkThresh) * (0.7 + gradMag * 3.0);
      hatch += line2 * step(lC, darkThresh * 0.65);
      hatch += line3 * step(lC, darkThresh * 0.35);
      hatch += line4 * step(lC, darkThresh * 0.15);

      // Ink pooling: darken intersections of crossing lines
      float pooling = line1 * line2 * 0.15 + line3 * line4 * 0.1;
      hatch += pooling * step(lC, darkThresh * 0.5);

      hatch = clamp(hatch, 0.0, 1.0);

      // Paper tone: slight warm tint instead of pure white
      vec3 paper = vec3(0.98, 0.96, 0.92);
      vec3 ink = vec3(0.08, 0.06, 0.12);
      outColor.rgb = mix(paper, ink, hatch);
    }
    // ── Mode 29: Block Mosaic (directional fill + Bayer dither + edge-aware borders) ──
    else if (mode == 29) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);

      // Directional fill: fill direction based on local gradient
      vec4 neighborR = texture2D(uTexture, cellUv + vec2(cellSize / uResolution.x, 0.0));
      vec4 neighborU = texture2D(uTexture, cellUv + vec2(0.0, cellSize / uResolution.y));
      float gradX = luma(neighborR.rgb) - l;
      float gradY = luma(neighborU.rgb) - l;
      float gradDir = atan(gradY, gradX);
      // Rotate local coords by gradient direction to vary fill orientation
      float rc = cos(gradDir), rs = sin(gradDir);
      vec2 rl = vec2(local.x * rc - local.y * rs, local.x * rs + local.y * rc);
      float fillAxis = rl.x * 0.5 + 0.5; // 0-1 along gradient

      // Smooth multi-level fill with Bayer-like ordered dither
      int bx = int(mod(local.x * 4.0, 4.0));
      int by = int(mod(local.y * 4.0, 4.0));
      // 4x4 Bayer matrix thresholds (normalized 0-1)
      float bayerThresholds[16];
      bayerThresholds[0] = 0.0/16.0;  bayerThresholds[1] = 8.0/16.0;
      bayerThresholds[2] = 2.0/16.0;  bayerThresholds[3] = 10.0/16.0;
      bayerThresholds[4] = 12.0/16.0; bayerThresholds[5] = 4.0/16.0;
      bayerThresholds[6] = 14.0/16.0; bayerThresholds[7] = 6.0/16.0;
      bayerThresholds[8] = 3.0/16.0;  bayerThresholds[9] = 11.0/16.0;
      bayerThresholds[10] = 1.0/16.0; bayerThresholds[11] = 9.0/16.0;
      bayerThresholds[12] = 15.0/16.0;bayerThresholds[13] = 7.0/16.0;
      bayerThresholds[14] = 13.0/16.0;bayerThresholds[15] = 5.0/16.0;
      float bayer = bayerThresholds[by * 4 + bx];

      float blockFill = step(bayer, l);

      // Edge-aware borders: draw thin gap between cells at high-contrast edges
      float edgeX = abs(luma(neighborR.rgb) - l);
      float edgeY = abs(luma(neighborU.rgb) - l);
      float borderX = smoothstep(0.95, 1.0, local.x) * smoothstep(0.08, 0.15, edgeX);
      float borderY = smoothstep(0.95, 1.0, local.y) * smoothstep(0.08, 0.15, edgeY);
      float border = max(borderX, borderY);
      blockFill *= 1.0 - border * 0.7;

      vec3 blockColor = mix(vec3(blockFill), cellColor.rgb * blockFill, colorMix);
      outColor.rgb = blockColor;
    }
    // ── Mode 30: Number Grid ──
    else if (mode == 30) {
      float cellSize = mix(6.0, 24.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);
      // Map luminance 0-1 to digit 0-9, each digit is a procedural pattern
      int digit = int(l * 9.99);
      float charMask = 0.0;
      float cx = local.x;
      float cy = 1.0 - local.y; // flip y for natural reading
      // Simplified 3x5 grid digit rendering
      float gx = floor(cx * 3.0);
      float gy = floor(cy * 5.0);
      float gi = gy * 3.0 + gx;
      // Segment lookup per digit (each digit encoded as filled cells in a 3x5 grid)
      if (digit == 0) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 1) { charMask = (gi==1.0||gi==4.0||gi==7.0||gi==10.0||gi==13.0) ? 1.0 : 0.0; }
      else if (digit == 2) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 3) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 4) { charMask = (gi==0.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 5) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 6) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 7) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==8.0||gi==11.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 8) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; } // 9
      // Padding: only show if within inner cell area
      float inCell = step(0.1, cx) * step(cx, 0.9) * step(0.05, cy) * step(cy, 0.95);
      charMask *= inCell;
      vec3 numColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
      outColor.rgb = numColor;
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`,so={datamoshLite:12},al=`
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash1(float n) { return fract(sin(n) * 43758.5453); }

  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i); float b = hash(i + vec2(1,0));
    float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p); p = rot * p * 2.0; a *= 0.5;
    }
    return v;
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p2 = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p2.xyw, c.r), vec4(c.r, p2.yzx), step(p2.x, c.r));
    float d2 = q.x - min(q.w, q.y); float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d2 + e)), d2 / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p2 = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p2 - K.xxx, 0.0, 1.0), c.y);
  }

  mat2 rot2d(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;
    int mode = int(uMode + 0.5);

    // ── Mode 0: Explode 3D ──
    if (mode == 0) {
      float scatter = uAmount;
      float shapeId = floor(uAmount2 * 5.99);
      float spinSpeed = uAmount3 * 2.0;
      float bright = 0.5 + uThreshold;
      float camAngle = uAngle + uTime * spinSpeed;

      float gridRes = mix(25.0, 70.0, 1.0 - uAmount2 * 0.3);
      vec2 cellCount = vec2(gridRes, gridRes * uResolution.y / uResolution.x);
      vec2 cellSize = 1.0 / cellCount;

      vec3 finalColor = vec3(0.0);
      float totalWeight = 0.0;

      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 cellId = floor(uv * cellCount) + vec2(float(ox), float(oy));
          if (cellId.x < 0.0 || cellId.y < 0.0 || cellId.x >= cellCount.x || cellId.y >= cellCount.y) continue;

          vec2 cellCenter = (cellId + 0.5) * cellSize;
          vec4 cellColor = texture2D(uTexture, cellCenter);

          float rnd1 = hash(cellId);
          float rnd2 = hash(cellId + 137.0);
          float rnd3 = hash(cellId + 271.0);

          // Map cell position to 3D point on shape surface
          float theta = cellCenter.x * TAU;
          float phi = cellCenter.y * PI;
          vec3 shapePos;
          if (shapeId < 1.0) { // Sphere
            shapePos = vec3(sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta));
          } else if (shapeId < 2.0) { // Cube
            float face = floor(rnd1 * 6.0);
            vec3 p = vec3(cellCenter.x * 2.0 - 1.0, cellCenter.y * 2.0 - 1.0, 1.0);
            if (face < 1.0) shapePos = p;
            else if (face < 2.0) shapePos = vec3(-p.z, p.y, p.x);
            else if (face < 3.0) shapePos = vec3(p.z, p.y, -p.x);
            else if (face < 4.0) shapePos = vec3(p.x, p.z, -p.y);
            else if (face < 5.0) shapePos = vec3(p.x, -p.z, p.y);
            else shapePos = vec3(p.x, p.y, -p.z);
            shapePos = normalize(shapePos);
          } else if (shapeId < 3.0) { // Pyramid
            float h = cellCenter.y;
            float r = (1.0 - h) * 0.8;
            float a = cellCenter.x * TAU;
            float sides = floor(a / (TAU/4.0)) * (TAU/4.0) + TAU/8.0;
            shapePos = vec3(cos(sides)*r, h*2.0-1.0, sin(sides)*r);
          } else if (shapeId < 4.0) { // Torus
            float R = 0.7, r2 = 0.3;
            shapePos = vec3((R + r2*cos(phi))*cos(theta), r2*sin(phi), (R + r2*cos(phi))*sin(theta));
          } else if (shapeId < 5.0) { // Cylinder
            float r2 = 0.6;
            shapePos = vec3(r2*cos(theta), cellCenter.y*2.0-1.0, r2*sin(theta));
          } else { // Helix
            float t = cellCenter.y * 4.0 * PI;
            float r2 = 0.5;
            shapePos = vec3(r2*cos(t + theta), cellCenter.y*2.0-1.0, r2*sin(t + theta));
          }

          // Rotate shape
          float ca = cos(camAngle), sa = sin(camAngle);
          shapePos = vec3(shapePos.x*ca - shapePos.z*sa, shapePos.y, shapePos.x*sa + shapePos.z*ca);

          // Scatter away from shape
          vec3 scatterDir = normalize(shapePos + vec3(rnd1-0.5, rnd2-0.5, rnd3-0.5)*0.5);
          vec3 pos3d = shapePos + scatterDir * scatter * (0.5 + rnd1) * 1.5;

          // Project to 2D
          float z = pos3d.z + 3.0;
          vec2 proj = pos3d.xy / z * 0.5 + 0.5;
          float pSize = cellSize.x * (1.0 + uAmount2) / max(z * 0.4, 0.1);

          vec2 diff = (uv - proj) / vec2(1.0, uResolution.x / uResolution.y);
          float dist = length(diff);
          float particle = smoothstep(pSize, pSize * 0.2, dist);

          if (particle > 0.01) {
            // Lighting
            vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
            float diffuse = max(dot(normalize(shapePos), lightDir), 0.0) * 0.7 + 0.3;
            vec3 lit = cellColor.rgb * diffuse * bright * uColor;
            float depthFade = 1.0 / (1.0 + max(z - 2.0, 0.0) * 0.3);
            finalColor += lit * particle * depthFade;
            totalWeight += particle * depthFade;
          }
        }
      }
      if (totalWeight > 0.01) {
        finalColor /= totalWeight;
        outColor.rgb = mix(src.rgb * (1.0 - scatter * 0.5), finalColor, clamp(totalWeight, 0.0, 1.0));
      } else {
        outColor.rgb = src.rgb * (1.0 - scatter * 0.5);
      }
    }

    // ── Mode 1: Terrain 3D (with full X/Y/Z camera rotation) ──
    else if (mode == 1) {
      float heightScale = uAmount * 0.4;
      float camHeight = 0.15 + uAmount2 * 0.5;
      float speed = uAmount3 * 0.5;
      float fogDensity = uThreshold * 3.0;
      float camYaw = uAngle;                    // Y rotation (horizontal)
      float camPitch = uCenter.x * PI * 0.5;    // X rotation: 0=horizon, 1=straight down
      float camRoll = uCenter.y * TAU;           // Z rotation: 0-1 maps to full 360
      vec3 fogColor = uColor;

      vec2 forward = vec2(cos(camYaw), sin(camYaw));
      vec2 camPos2D = forward * uTime * speed;

      vec3 color = vec3(0.0);
      float maxDist = 3.0;

      // Raycast through each pixel column
      vec2 screenPos = uv * 2.0 - 1.0;
      screenPos.x *= uResolution.x / uResolution.y;

      vec3 ro = vec3(camPos2D.x, camHeight, camPos2D.y);

      // Build ray direction with full rotation
      vec3 rd = normalize(vec3(screenPos.x, screenPos.y * 0.5, 1.5));

      // Roll (Z rotation) - applied first in view space
      float crl = cos(camRoll), srl = sin(camRoll);
      rd = vec3(crl * rd.x - srl * rd.y, srl * rd.x + crl * rd.y, rd.z);

      // Pitch (X rotation) - tilt camera down toward terrain
      float cp = cos(-camPitch), sp = sin(-camPitch);
      rd = vec3(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);

      // Yaw (Y rotation) - horizontal rotation
      rd.xz = mat2(cos(camYaw), -sin(camYaw), sin(camYaw), cos(camYaw)) * rd.xz;

      float t = 0.01;
      bool hit = false;
      vec3 hitPos;
      for (int i = 0; i < 48; i++) {
        hitPos = ro + rd * t;
        vec2 sampleUV = fract(hitPos.xz * 0.3);
        float h = luma(texture2D(uTexture, sampleUV).rgb) * heightScale;
        if (hitPos.y < h) { hit = true; break; }
        t += max(0.01, (hitPos.y - h) * 0.5);
        if (t > maxDist) break;
      }

      if (hit) {
        vec2 sUV = fract(hitPos.xz * 0.3);
        vec3 texColor = texture2D(uTexture, sUV).rgb;
        // Normal via central differences
        float eps = 0.005;
        float hL = luma(texture2D(uTexture, fract((hitPos.xz + vec2(-eps,0.0))*0.3)).rgb) * heightScale;
        float hR = luma(texture2D(uTexture, fract((hitPos.xz + vec2(eps,0.0))*0.3)).rgb) * heightScale;
        float hD = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,-eps))*0.3)).rgb) * heightScale;
        float hU = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,eps))*0.3)).rgb) * heightScale;
        vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
        vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
        float diff = max(dot(normal, lightDir), 0.0) * 0.8 + 0.2;
        color = texColor * diff;
        // Fog
        float fogFactor = 1.0 - exp(-t * fogDensity);
        color = mix(color, fogColor, fogFactor);
      } else {
        color = fogColor;
      }
      outColor.rgb = color;
    }

    // ── Mode 2: Sphere Projection ──
    else if (mode == 2) {
      float blend = uAmount;
      float roughness = uAmount2;
      float spinSpd = uAmount3 * 2.0;
      float rimGlow = uThreshold;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      float r = length(centered);
      float sphereR = 0.45;

      if (r < sphereR) {
        // Ray-sphere: compute normal
        float z = sqrt(sphereR * sphereR - r * r);
        vec3 normal = normalize(vec3(centered, z));

        // Rotate for spinning
        float angle = uTime * spinSpd;
        float ca = cos(angle), sa = sin(angle);
        vec3 rotN = vec3(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);

        // Equirectangular UV mapping
        vec2 sphereUV = vec2(atan(rotN.z, rotN.x) / TAU + 0.5, asin(clamp(rotN.y, -1.0, 1.0)) / PI + 0.5);
        vec3 texColor = texture2D(uTexture, sphereUV).rgb;

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0,0,1)), 0.0), mix(4.0, 64.0, roughness));

        // Fresnel rim
        float fresnel = pow(1.0 - abs(normal.z), 3.0) * rimGlow;

        vec3 lit = texColor * (diff * 0.7 + 0.3) * uColor + vec3(spec * 0.3) + vec3(fresnel) * uColor;
        outColor.rgb = mix(src.rgb, lit, blend);
      } else {
        // Soft edge fade
        float edgeFade = smoothstep(sphereR + 0.02, sphereR, r);
        outColor.rgb = mix(src.rgb, src.rgb * 0.3, edgeFade * blend * 0.5);
      }
    }

    // ── Mode 3: Cube Projection ──
    else if (mode == 3) {
      float cubeSize = 0.3 + uAmount * 0.5;
      float edgeGlow = uAmount2;
      float spinSpd = uAmount3 * 1.5;
      float manualRot = uAngle;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      vec3 ro = vec3(0.0, 0.0, -2.5);
      vec3 rd = normalize(vec3(centered, 1.0));

      float angle = uTime * spinSpd + manualRot;
      float tilt = 0.4;
      // Y rotation
      rd.xz = rot2d(angle) * rd.xz;
      ro.xz = rot2d(angle) * ro.xz;
      // X tilt
      rd.yz = rot2d(tilt) * rd.yz;
      ro.yz = rot2d(tilt) * ro.yz;

      // Ray-AABB intersection
      vec3 boxMin = vec3(-cubeSize);
      vec3 boxMax = vec3(cubeSize);
      vec3 invRd = 1.0 / rd;
      vec3 t1 = (boxMin - ro) * invRd;
      vec3 t2 = (boxMax - ro) * invRd;
      vec3 tMin = min(t1, t2);
      vec3 tMax = max(t1, t2);
      float tNear = max(max(tMin.x, tMin.y), tMin.z);
      float tFar = min(min(tMax.x, tMax.y), tMax.z);

      if (tNear < tFar && tFar > 0.0) {
        float t = tNear > 0.0 ? tNear : tFar;
        vec3 hitPos = ro + rd * t;
        vec3 absHit = abs(hitPos);

        // Determine face and UV
        vec2 faceUV;
        vec3 normal;
        if (absHit.x > absHit.y - 0.001 && absHit.x > absHit.z - 0.001) {
          faceUV = hitPos.yz / cubeSize * 0.5 + 0.5;
          normal = vec3(sign(hitPos.x), 0.0, 0.0);
        } else if (absHit.y > absHit.z - 0.001) {
          faceUV = hitPos.xz / cubeSize * 0.5 + 0.5;
          normal = vec3(0.0, sign(hitPos.y), 0.0);
        } else {
          faceUV = hitPos.xy / cubeSize * 0.5 + 0.5;
          normal = vec3(0.0, 0.0, sign(hitPos.z));
        }

        vec3 texColor = texture2D(uTexture, clamp(faceUV, 0.0, 1.0)).rgb;
        vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
        float diff = max(dot(normal, lightDir), 0.0) * 0.7 + 0.3;
        vec3 lit = texColor * diff * uColor;

        // Edge glow
        vec2 edgeDist = 1.0 - abs(faceUV * 2.0 - 1.0);
        float edgeMin = min(edgeDist.x, edgeDist.y);
        float edge = smoothstep(0.02, 0.08, edgeMin);
        lit += vec3(1.0 - edge) * edgeGlow * uColor;

        outColor.rgb = lit;
      } else {
        outColor.rgb = src.rgb * 0.15;
      }
    }

    // ── Mode 4: Tunnel Flight ──
    else if (mode == 4) {
      float tunnelWidth = 0.3 + uAmount * 0.7;
      float shapeMorph = uAmount2;
      float flightSpeed = uAmount3 * 2.0;
      float fogDepth = uThreshold * 2.0;
      float twist = uAngle;
      vec3 fogTint = uColor;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      // Apply twist
      centered = rot2d(twist * centered.y) * centered;

      float r = length(centered);
      float circR = r;
      float hexR = r / (cos(mod(atan(centered.y, centered.x) + PI/6.0, PI/3.0) - PI/6.0));
      float sqR = max(abs(centered.x), abs(centered.y));
      float shapeR = mix(circR, mix(hexR, sqR, clamp(shapeMorph * 2.0 - 1.0, 0.0, 1.0)), clamp(shapeMorph * 2.0, 0.0, 1.0));

      float ang = atan(centered.y, centered.x) / TAU + 0.5;
      float depth = tunnelWidth / max(shapeR, 0.001) + uTime * flightSpeed;

      vec2 tunnelUV = vec2(ang, fract(depth * 0.2));
      vec3 texColor = texture2D(uTexture, tunnelUV).rgb;

      float fog = 1.0 - exp(-shapeR * fogDepth);
      texColor = mix(texColor, fogTint, fog);

      float shade = 1.0 / (1.0 + shapeR * 3.0);
      outColor.rgb = texColor * shade;
    }

    // ── Mode 5: Infinite Mirror ──
    else if (mode == 5) {
      float depth = 4.0 + uAmount * 8.0;
      float zoom = 0.7 + uAmount2 * 0.5;
      float twistAmt = uAmount3 * 0.3;
      float fadeRate = 0.3 + uThreshold * 0.5;
      vec3 tintShift = uColor;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalFade = 0.0;
      int iDepth = int(depth);

      for (int i = 0; i < 12; i++) {
        if (i >= iDepth) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        vec3 sample3 = texture2D(uTexture, p).rgb;
        // Per-bounce hue shift
        vec3 hsv = rgb2hsv(sample3);
        hsv.x = fract(hsv.x + fi * 0.08 * (tintShift.r - 0.5 + tintShift.b - 0.5));
        sample3 = hsv2rgb(hsv);

        accum += sample3 * fade;
        totalFade += fade;

        // Transform for next bounce
        p = (p - 0.5) * zoom + 0.5;
        p = abs(mod(p * 2.0, 2.0) - 1.0);
        p = (p - 0.5) * rot2d(twistAmt) + vec2(0.5);
      }
      outColor.rgb = accum / max(totalFade, 0.001);
    }

    // ── Mode 6: Fractal Warp ──
    else if (mode == 6) {
      float blend = uAmount;
      float fractalType = uAmount2;
      float zoomSpeed = uAmount3 * 0.5;
      float maxIter = 16.0 + uThreshold * 48.0;
      vec2 seed = (uCenter - 0.5) * 4.0;
      vec3 borderTint = uColor;

      // Animated zoom
      float zoomLevel = 1.0 + uTime * zoomSpeed;
      vec2 c, z;

      vec2 pos = (uv - 0.5) * 3.0 / zoomLevel;

      if (fractalType < 0.5) {
        // Mandelbrot
        c = pos + vec2(-0.5, 0.0);
        z = vec2(0.0);
      } else {
        // Julia
        c = seed;
        z = pos;
      }

      float iter = 0.0;
      for (int i = 0; i < 64; i++) {
        if (float(i) >= maxIter) break;
        if (dot(z, z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter += 1.0;
      }

      // Smooth coloring
      if (dot(z, z) > 4.0) {
        iter = iter - log2(log2(dot(z, z))) + 4.0;
      }

      float normalizedIter = iter / maxIter;
      vec2 fractalUV = fract(vec2(normalizedIter * 3.0, normalizedIter * 2.0 + 0.3));
      vec3 fracColor = texture2D(uTexture, fractalUV).rgb;

      // Tint border regions
      float border = smoothstep(0.0, 0.1, normalizedIter) * smoothstep(1.0, 0.9, normalizedIter);
      fracColor = mix(fracColor * borderTint, fracColor, border);

      outColor.rgb = mix(src.rgb, fracColor, blend);
    }

    // ── Mode 7: Crystal Refract ──
    else if (mode == 7) {
      float crystalSize = 0.2 + uAmount * 0.6;
      float ior = 1.1 + uAmount2 * 0.8;
      float dispersion = uAmount3 * 0.15;
      float fresnelStr = uThreshold;
      float rotation = uAngle + uTime * 0.3;
      vec3 facetTint = uColor;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      vec3 ro = vec3(0.0, 0.0, -2.0);
      vec3 rd = normalize(vec3(centered, 1.2));

      // Rotate
      rd.xz = rot2d(rotation) * rd.xz;
      ro.xz = rot2d(rotation) * ro.xz;
      rd.yz = rot2d(0.3) * rd.yz;
      ro.yz = rot2d(0.3) * ro.yz;

      // Octahedron SDF raymarching
      float t = 0.0;
      bool hit = false;
      vec3 hitPos;
      for (int i = 0; i < 32; i++) {
        hitPos = ro + rd * t;
        float d = (abs(hitPos.x) + abs(hitPos.y) + abs(hitPos.z)) - crystalSize;
        if (d < 0.001) { hit = true; break; }
        t += d;
        if (t > 5.0) break;
      }

      if (hit) {
        vec3 n = normalize(sign(hitPos));
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0) * fresnelStr;

        // Chromatic refraction
        vec3 refR = refract(rd, n, 1.0 / (ior - dispersion));
        vec3 refG = refract(rd, n, 1.0 / ior);
        vec3 refB = refract(rd, n, 1.0 / (ior + dispersion));

        vec2 uvR = uv + refR.xy * 0.2;
        vec2 uvG = uv + refG.xy * 0.2;
        vec2 uvB = uv + refB.xy * 0.2;

        float rChan = texture2D(uTexture, clamp(uvR, 0.0, 1.0)).r;
        float gChan = texture2D(uTexture, clamp(uvG, 0.0, 1.0)).g;
        float bChan = texture2D(uTexture, clamp(uvB, 0.0, 1.0)).b;

        vec3 refracted = vec3(rChan, gChan, bChan) * facetTint;
        vec3 reflected = texture2D(uTexture, reflect(rd, n).xy * 0.3 + 0.5).rgb;

        outColor.rgb = mix(refracted, reflected, fresnel);
      }
      // else keep src
    }

    // ── Mode 8: Feedback Zoom ──
    else if (mode == 8) {
      float zoomRate = 0.9 + uAmount * 0.15;
      float fbMix = uAmount2;
      float rotPerIter = (uAmount3 - 0.5) * 0.3;
      float hueCycle = uThreshold * 0.15;
      vec2 center = uCenter;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float weight = pow(fbMix, fi);
        if (weight < 0.01) break;

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        // Hue shift per iteration
        vec3 hsv = rgb2hsv(s);
        hsv.x = fract(hsv.x + fi * hueCycle);
        s = hsv2rgb(hsv);

        accum += s * weight;
        totalWeight += weight;

        // Transform for next iteration
        p = (p - center) * zoomRate + center;
        p = (p - center) * rot2d(rotPerIter) + center;
      }
      outColor.rgb = accum / max(totalWeight, 0.001);
    }

    // ── Mode 9: Fluid Distort ──
    else if (mode == 9) {
      float magnitude = uAmount * 0.08;
      float scale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3 * 2.0;
      float vorticity = uThreshold;
      float bias = uAngle;

      vec2 p = uv;
      vec2 biasDir = vec2(cos(bias), sin(bias)) * 0.01;

      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec2 noisePos = p * scale + uTime * speed * 0.3 + fi * 1.3;

        // Flow field from FBM gradient
        float n0 = fbm(noisePos);
        float nx = fbm(noisePos + vec2(0.01, 0.0));
        float ny = fbm(noisePos + vec2(0.0, 0.01));
        vec2 grad = vec2(nx - n0, ny - n0) / 0.01;

        // Mix curl (rotational) and gradient (divergent) based on vorticity
        vec2 curl = vec2(-grad.y, grad.x);
        vec2 flow = mix(grad, curl, vorticity) + biasDir;

        p += flow * magnitude;
      }
      outColor.rgb = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
    }

    // ── Mode 10: Wormhole ──
    else if (mode == 10) {
      float mass = uAmount * 0.4;
      float ringRadius = 0.05 + uAmount2 * 0.3;
      float diskSpin = uAmount3 * 3.0;
      float glowStr = uThreshold;
      vec2 center = uCenter;
      vec3 diskColor = uColor;

      vec2 centered = uv - center;
      centered.x *= uResolution.x / uResolution.y;
      float dist = length(centered);
      float angle = atan(centered.y, centered.x);

      // Gravitational lensing
      float deflection = mass / max(dist, 0.01);
      vec2 lensedUV = uv + normalize(centered) * deflection * (uResolution.y / uResolution.x);

      vec3 color = texture2D(uTexture, clamp(lensedUV, 0.0, 1.0)).rgb;

      // Einstein ring
      float ringDist = abs(dist - ringRadius);
      float ring = exp(-ringDist * ringDist * 500.0) * glowStr;
      color += diskColor * ring;

      // Accretion disk
      float diskWidth = ringRadius * 0.8;
      float diskDist = abs(centered.y * cos(0.3) + centered.x * sin(0.3));
      if (dist > ringRadius * 0.5 && dist < ringRadius * 2.5 && diskDist < diskWidth * 0.3) {
        float diskAngle = angle + uTime * diskSpin;
        float diskPattern = sin(diskAngle * 8.0 + dist * 30.0) * 0.5 + 0.5;
        float diskAlpha = smoothstep(ringRadius * 2.5, ringRadius, dist) * smoothstep(ringRadius * 0.5, ringRadius, dist);
        color += diskColor * diskPattern * diskAlpha * glowStr * 0.5;
      }

      // Event horizon darkening
      float horizon = smoothstep(ringRadius * 0.3, ringRadius * 0.1, dist);
      color *= 1.0 - horizon;

      outColor.rgb = color;
    }

    // ── Mode 11: Geometric Tile ──
    else if (mode == 11) {
      float tileCount = 3.0 + uAmount * 15.0;
      float flipRange = uAmount2 * PI;
      float speed = uAmount3 * 2.0;
      float gapSize = uThreshold * 0.1;

      vec2 tileId = floor(uv * tileCount);
      vec2 tileUV = fract(uv * tileCount);

      // Gap between tiles
      vec2 border = step(vec2(gapSize), tileUV) * step(vec2(gapSize), 1.0 - tileUV);
      float inTile = border.x * border.y;

      if (inTile > 0.5) {
        // Per-tile random phase
        float rnd = hash(tileId);
        float flipAngle = sin(uTime * speed + rnd * TAU) * flipRange;

        // Center tile UV
        vec2 centered = tileUV - 0.5;

        // Apply 3D rotation (flip around Y axis)
        float cosA = cos(flipAngle);
        float perspX = centered.x * cosA;
        float perspScale = 1.0 / (1.0 + abs(centered.x * sin(flipAngle)) * 0.5);

        vec2 rotatedUV = vec2(perspX, centered.y) * perspScale + 0.5;

        // Map back to source UV
        vec2 srcUV = (tileId + clamp(rotatedUV, 0.01, 0.99)) / tileCount;
        vec3 tileColor = texture2D(uTexture, srcUV).rgb;

        // Per-tile lighting based on flip angle
        float lighting = 0.6 + 0.4 * cosA;
        outColor.rgb = tileColor * lighting;
      } else {
        outColor.rgb = vec3(0.02);
      }
    }

    // ── Mode 12: Motion Trails ──
    else if (mode == 12) {
      float trailLen = uAmount;
      float lumaGate = uAmount2;
      float fadeCurve = uAmount3;
      float intensity = uThreshold;
      float dir = uAngle;
      vec3 trailTint = uColor;

      vec2 trailDir = vec2(cos(dir), sin(dir));
      int steps = 4 + int(trailLen * 28.0);
      float stepSize = trailLen * 0.02;

      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 32; i++) {
        if (i > steps) break;
        float fi = float(i);
        vec2 sampleUV = uv - trailDir * fi * stepSize;
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

        vec3 s = texture2D(uTexture, sampleUV).rgb;
        float l = luma(s);

        if (l > lumaGate) {
          float weight = mix(1.0 - fi / float(steps), pow(0.85, fi), fadeCurve);
          accum += s * trailTint * weight * intensity;
          totalWeight += weight * intensity;
        }
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 13: Echo Repeat ──
    else if (mode == 13) {
      float echoCount = 2.0 + uAmount * 10.0;
      float spacing = uAmount2 * 0.15;
      float scalePer = 0.8 + uAmount3 * 0.2;
      float fadeRate = 0.3 + uThreshold * 0.5;
      float dir = uAngle;
      vec3 echoTint = uColor;

      vec2 echoDir = vec2(cos(dir), sin(dir));
      int count = int(echoCount);

      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 12; i++) {
        if (i >= count) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        // Offset and scale
        vec2 offset = echoDir * spacing * fi;
        float scl = pow(scalePer, fi);
        vec2 echoUV = (uv - 0.5 - offset) / scl + 0.5;

        if (echoUV.x >= 0.0 && echoUV.x <= 1.0 && echoUV.y >= 0.0 && echoUV.y <= 1.0) {
          vec3 s = texture2D(uTexture, echoUV).rgb;
          // Color shift per echo
          vec3 hsv = rgb2hsv(s);
          hsv.x = fract(hsv.x + fi * 0.05 * (echoTint.r - echoTint.b));
          s = hsv2rgb(hsv);

          accum += s * fade;
          totalWeight += fade;
        }
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 14: Ghost Double ──
    else if (mode == 14) {
      float separation = uAmount * 0.15;
      float ghostCount = 2.0 + uAmount2 * 4.0;
      float chromaShift = uAmount3 * 0.03;
      float opacity = uThreshold;
      float spreadAngle = uAngle;

      int count = int(ghostCount);
      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 6; i++) {
        if (i >= count) break;
        float fi = float(i);
        float angle = spreadAngle + fi * TAU / ghostCount;
        vec2 offset = vec2(cos(angle), sin(angle)) * separation * fi;
        float fade = opacity / fi;

        // Chromatic offset per ghost
        float rOff = chromaShift * fi;
        float rCh = texture2D(uTexture, clamp(uv + offset + vec2(rOff, 0.0), 0.0, 1.0)).r;
        float gCh = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0)).g;
        float bCh = texture2D(uTexture, clamp(uv + offset - vec2(rOff, 0.0), 0.0, 1.0)).b;

        accum += vec3(rCh, gCh, bCh) * fade;
        totalWeight += fade;
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 15: Strobe Flash ──
    else if (mode == 15) {
      float rate = 1.0 + uAmount * 19.0;
      float dutyCycle = uAmount2;
      float mode2 = uAmount3;
      float intensity = uThreshold;
      vec3 flashColor = uColor;

      float phase = fract(uTime * rate);
      float on = step(phase, dutyCycle);

      vec3 flashResult;
      if (mode2 < 0.25) {
        flashResult = vec3(1.0); // White flash
      } else if (mode2 < 0.5) {
        flashResult = vec3(0.0); // Black flash
      } else if (mode2 < 0.75) {
        flashResult = 1.0 - src.rgb; // Invert flash
      } else {
        flashResult = flashColor; // Color flash
      }

      outColor.rgb = mix(src.rgb, flashResult, on * intensity);
    }

    // ── Mode 16: Light Paint ──
    else if (mode == 16) {
      float trailLen = uAmount;
      float flowScale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3 * 2.0;
      float lumaGate = uThreshold;
      vec3 paintTint = uColor;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;
      int steps = 4 + int(trailLen * 12.0);

      for (int i = 0; i < 16; i++) {
        if (i >= steps) break;
        float fi = float(i);

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        float l = luma(s);

        if (l > lumaGate) {
          float weight = 1.0 - fi / float(steps);
          accum += s * paintTint * weight;
          totalWeight += weight;
        }

        // Advect along flow field
        vec2 noisePos = p * flowScale + uTime * speed * 0.3;
        float n0 = fbm(noisePos);
        float nx = fbm(noisePos + vec2(0.01, 0.0));
        float ny = fbm(noisePos + vec2(0.0, 0.01));
        vec2 flow = vec2(-(ny - n0), nx - n0) / 0.01;
        p += normalize(flow + 0.001) * 0.01;
      }

      if (totalWeight > 0.01) {
        vec3 painted = accum / totalWeight;
        outColor.rgb = max(src.rgb, painted * 0.8);
      }
    }

    // ── Mode 17: Recursive Echo ──
    else if (mode == 17) {
      float echoDepth = 4.0 + uAmount * 12.0;
      float offsetAmt = uAmount2 * 0.08;
      float scalePer = 0.85 + uAmount3 * 0.15;
      float fadeRate = 0.3 + uThreshold * 0.5;
      float dir = uAngle;
      vec3 colorShift = uColor;

      vec2 echoDir = vec2(cos(dir), sin(dir));
      int depth = int(echoDepth);

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < 16; i++) {
        if (i >= depth) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        // Per-echo hue shift
        vec3 hsv = rgb2hsv(s);
        hsv.x = fract(hsv.x + fi * 0.06 * (colorShift.r - 0.5 + colorShift.b - 0.5));
        hsv.y = min(1.0, hsv.y * (1.0 + fi * 0.05 * (colorShift.g - 0.5)));
        s = hsv2rgb(hsv);

        accum += s * fade;
        totalWeight += fade;

        // Translate and scale for next echo
        p = (p - 0.5) * scalePer + 0.5;
        p += echoDir * offsetAmt;
      }
      outColor.rgb = accum / max(totalWeight, 0.001);
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`,il={geometricTile:11},rl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float cellSize = mix(6.0, 24.0, uAmount);
    float contrast = 0.5 + uAmount2 * 1.5;
    float colorMix = uAmount3;

    vec2 cell = floor(uv * uResolution / cellSize);
    vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
    vec4 cellColor = texture2D(uTexture, cellUv);
    float l = luma(cellColor.rgb);
    l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);

    vec2 local = fract(uv * uResolution / cellSize);

    // Map luminance to digit 0-9
    int digit = int(l * 9.99);
    float charMask = 0.0;
    float cx = local.x;
    float cy = 1.0 - local.y;

    // 3x5 grid cell index (use int to avoid float comparison issues)
    int gx = int(floor(cx * 3.0));
    int gy = int(floor(cy * 5.0));
    int gi = gy * 3 + gx;

    // Segment lookup per digit (3x5 grid encoding)
    if (digit == 0) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 1) {
      charMask = (gi==1||gi==4||gi==7||gi==10||gi==13) ? 1.0 : 0.0;
    } else if (digit == 2) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==6||gi==7||gi==8||gi==9||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 3) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 4) {
      charMask = (gi==0||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==11||gi==14) ? 1.0 : 0.0;
    } else if (digit == 5) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 6) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==6||gi==7||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 7) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==8||gi==11||gi==14) ? 1.0 : 0.0;
    } else if (digit == 8) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    }

    // Padding: only show within inner cell area
    float inCell = step(0.1, cx) * step(cx, 0.9) * step(0.05, cy) * step(cy, 0.95);
    charMask *= inCell;

    vec3 numColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
    gl_FragColor = vec4(clamp(numColor, 0.0, 1.0), src.a);
  }
`,ll=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float scatter = uAmount;
    float shapeId = floor(uAmount2 * 5.99);
    float spinSpeed = uAmount3 * 2.0;
    float bright = 0.5 + uThreshold;
    float camAngle = uAngle + uTime * spinSpeed;

    float gridRes = mix(25.0, 70.0, 1.0 - uAmount2 * 0.3);
    vec2 cellCount = vec2(gridRes, gridRes * uResolution.y / uResolution.x);
    vec2 cellSize = 1.0 / cellCount;

    vec3 finalColor = vec3(0.0);
    float totalWeight = 0.0;

    // Expanded search radius for 3D projection
    for (int ox = -3; ox <= 3; ox++) {
      for (int oy = -3; oy <= 3; oy++) {
        vec2 cellId = floor(uv * cellCount) + vec2(float(ox), float(oy));
        if (cellId.x < 0.0 || cellId.y < 0.0 || cellId.x >= cellCount.x || cellId.y >= cellCount.y) continue;

        vec2 cellCenter = (cellId + 0.5) * cellSize;
        vec4 cellColor = texture2D(uTexture, cellCenter);

        float rnd1 = hash(cellId);
        float rnd2 = hash(cellId + 137.0);
        float rnd3 = hash(cellId + 271.0);

        float theta = cellCenter.x * TAU;
        float phi = cellCenter.y * PI;
        vec3 shapePos;

        if (shapeId < 1.0) {
          shapePos = vec3(sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta));
        } else if (shapeId < 2.0) {
          float face = floor(rnd1 * 6.0);
          vec3 p = vec3(cellCenter.x * 2.0 - 1.0, cellCenter.y * 2.0 - 1.0, 1.0);
          if (face < 1.0) shapePos = p;
          else if (face < 2.0) shapePos = vec3(-p.z, p.y, p.x);
          else if (face < 3.0) shapePos = vec3(p.z, p.y, -p.x);
          else if (face < 4.0) shapePos = vec3(p.x, p.z, -p.y);
          else if (face < 5.0) shapePos = vec3(p.x, -p.z, p.y);
          else shapePos = vec3(p.x, p.y, -p.z);
          shapePos = normalize(shapePos);
        } else if (shapeId < 3.0) {
          float h = cellCenter.y;
          float r = (1.0 - h) * 0.8;
          float a = cellCenter.x * TAU;
          float sides = floor(a / (TAU/4.0)) * (TAU/4.0) + TAU/8.0;
          shapePos = vec3(cos(sides)*r, h*2.0-1.0, sin(sides)*r);
        } else if (shapeId < 4.0) {
          float R = 0.7, r2 = 0.3;
          shapePos = vec3((R + r2*cos(phi))*cos(theta), r2*sin(phi), (R + r2*cos(phi))*sin(theta));
        } else if (shapeId < 5.0) {
          float r2 = 0.6;
          shapePos = vec3(r2*cos(theta), cellCenter.y*2.0-1.0, r2*sin(theta));
        } else {
          float t = cellCenter.y * 4.0 * PI;
          float r2 = 0.5;
          shapePos = vec3(r2*cos(t + theta), cellCenter.y*2.0-1.0, r2*sin(t + theta));
        }

        // Rotate shape
        float ca = cos(camAngle), sa = sin(camAngle);
        shapePos = vec3(shapePos.x*ca - shapePos.z*sa, shapePos.y, shapePos.x*sa + shapePos.z*ca);

        // Scatter
        vec3 scatterDir = normalize(shapePos + vec3(rnd1-0.5, rnd2-0.5, rnd3-0.5)*0.5);
        vec3 pos3d = shapePos + scatterDir * scatter * (0.5 + rnd1) * 1.5;

        // Project to 2D
        float z = pos3d.z + 3.0;
        vec2 proj = pos3d.xy / z * 0.5 + 0.5;
        float pSize = cellSize.x * (1.0 + uAmount2) / max(z * 0.4, 0.1);

        vec2 diff = (uv - proj) / vec2(1.0, uResolution.x / uResolution.y);
        float dist = length(diff);
        float particle = smoothstep(pSize, pSize * 0.2, dist);

        if (particle > 0.01) {
          vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
          float diffuse = max(dot(normalize(shapePos), lightDir), 0.0) * 0.7 + 0.3;
          vec3 lit = cellColor.rgb * diffuse * bright * uColor;
          float depthFade = 1.0 / (1.0 + max(z - 2.0, 0.0) * 0.3);
          finalColor += lit * particle * depthFade;
          totalWeight += particle * depthFade;
        }
      }
    }

    if (totalWeight > 0.01) {
      finalColor /= totalWeight;
      gl_FragColor = vec4(mix(src.rgb * (1.0 - scatter * 0.5), finalColor, clamp(totalWeight, 0.0, 1.0)), src.a);
    } else {
      gl_FragColor = vec4(src.rgb * (1.0 - scatter * 0.5), src.a);
    }
  }
`,ul=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;          // 0=opaque sky, 1=fade horizon to transparent, 2=blend with source
  uniform float uAmount;        // height scale
  uniform float uAmount2;       // camera height
  uniform float uAmount3;       // speed
  uniform float uThreshold;     // fog density
  uniform float uAngle;         // yaw
  uniform vec2 uCenter;         // pitch/roll
  uniform vec3 uColor;          // fog colour
  uniform float uHorizonFade;   // 0-1 fade terrain alpha at horizon
  uniform float uSourceMix;     // 0-1 blend with original source layer
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float heightScale = uAmount * 0.8;
    float camHeight = 0.08 + uAmount2 * 0.35;
    float speed = uAmount3 * 0.5;
    float fogDensity = uThreshold * 3.0;
    float camYaw = uAngle;
    float camPitch = (uCenter.x - 0.5) * PI * 0.5;
    float camRoll = uCenter.y * TAU;
    vec3 fogColor = uColor;

    vec2 forward = vec2(cos(camYaw), sin(camYaw));
    vec2 camPos2D = forward * uTime * speed;

    vec3 color = vec3(0.0);
    float maxDist = 8.0;

    vec2 screenPos = uv * 2.0 - 1.0;
    screenPos.x *= uResolution.x / uResolution.y;

    vec3 ro = vec3(camPos2D.x, camHeight, camPos2D.y);
    vec3 rd = normalize(vec3(screenPos.x, screenPos.y * 0.5 - 0.3, 1.5));

    float crl = cos(camRoll), srl = sin(camRoll);
    rd = vec3(crl * rd.x - srl * rd.y, srl * rd.x + crl * rd.y, rd.z);
    float cp = cos(camPitch), sp = sin(camPitch);
    rd = vec3(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);
    rd.xz = mat2(cos(camYaw), -sin(camYaw), sin(camYaw), cos(camYaw)) * rd.xz;

    float t = 0.01;
    bool hit = false;
    vec3 hitPos;
    for (int i = 0; i < 80; i++) {
      hitPos = ro + rd * t;
      vec2 sampleUV = fract(hitPos.xz * 0.3);
      float h = luma(texture2D(uTexture, sampleUV).rgb) * heightScale;
      if (hitPos.y < h) { hit = true; break; }
      t += max(0.005, (hitPos.y - h) * 0.4);
      if (t > maxDist) break;
    }

    // Horizon fade: alpha drops as ray points up (toward sky) or distance grows
    float horizonW = smoothstep(0.0, 0.4, rd.y); // 0 below horizon, 1 well above
    float distFade = clamp(t / maxDist, 0.0, 1.0);
    float terrainAlpha = 1.0;
    int mode = int(uMode + 0.5);

    if (hit) {
      vec2 sUV = fract(hitPos.xz * 0.3);
      vec3 texColor = texture2D(uTexture, sUV).rgb;
      float eps = 0.005;
      float hL = luma(texture2D(uTexture, fract((hitPos.xz + vec2(-eps,0.0))*0.3)).rgb) * heightScale;
      float hR = luma(texture2D(uTexture, fract((hitPos.xz + vec2(eps,0.0))*0.3)).rgb) * heightScale;
      float hD = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,-eps))*0.3)).rgb) * heightScale;
      float hU = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,eps))*0.3)).rgb) * heightScale;
      vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
      vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
      float diff = max(dot(normal, lightDir), 0.0) * 0.8 + 0.2;
      color = texColor * diff;
      float fogFactor = 1.0 - exp(-t * fogDensity * 0.5);
      color = mix(color, fogColor, fogFactor);
      // Distance-based alpha fade
      terrainAlpha = mix(1.0, 1.0 - distFade, uHorizonFade * 0.85);
    } else {
      // Sky / miss
      float skyGrad = max(rd.y, 0.0);
      color = mix(fogColor, fogColor * 1.3, skyGrad);
      // Mode 0: opaque sky. Mode 1+: alpha falls off above horizon for transparent reveal.
      if (mode != 0) terrainAlpha = mix(1.0, 1.0 - horizonW, uHorizonFade);
    }

    // Mode 2: also blend final result with the underlying source colour
    vec4 srcLayer = src;
    if (mode == 2 && uSourceMix > 0.001) {
      color = mix(color, srcLayer.rgb, uSourceMix * (mode == 2 ? 1.0 : 0.0));
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), terrainAlpha * src.a);
  }
`,nl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uShape;         // 0=sphere, 1=cube, 2=pyramid
  uniform float uHeight;        // 0-1 extrusion amount
  uniform float uRotateX;
  uniform float uRotateY;
  uniform float uAutoRotate;
  uniform float uCamDistance;
  uniform float uSpecular;
  uniform float uAmbient;
  uniform float uFogDistance;
  uniform vec3 uFogColor;
  uniform float uHorizonFade;
  uniform float uSourceMix;
  uniform float uTileScale;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  mat3 rotX(float a) { float s = sin(a), c = cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
  mat3 rotY(float a) { float s = sin(a), c = cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }

  // SDF for an axis-aligned box.
  float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
  }

  // SDF for a 4-sided pyramid (apex up). h = height. baseHalf = base half-width.
  float sdPyramid(vec3 p, float h, float baseHalf) {
    p.y += baseHalf * 0.4;
    p.xz = abs(p.xz);
    float m2 = h * h + baseHalf * baseHalf;
    vec3 q = vec3(p.z, h * p.y - baseHalf * p.x, h * p.x + baseHalf * p.y);
    float s = max(-q.x, 0.0);
    float t = clamp((q.y - baseHalf * p.z) / (m2 + baseHalf * baseHalf), 0.0, 1.0);
    float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
    float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
    float d2 = min(q.y, -q.x * m2 - q.y * baseHalf) > 0.0 ? 0.0 : min(a, b);
    return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
  }

  // Map a point in surface space to a UV coordinate based on shape.
  vec2 surfaceUV(vec3 p, int shape) {
    if (shape == 0) {
      // Sphere — equirectangular
      vec3 d = normalize(p + 1e-6);
      return vec2(atan(d.z, d.x) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    } else if (shape == 1) {
      // Cube — pick face from largest |axis|, project remaining two
      vec3 ap = abs(p);
      vec2 uv;
      if (ap.x > ap.y && ap.x > ap.z) {
        uv = vec2(p.z * sign(p.x), p.y) * 0.5 + 0.5;
      } else if (ap.y > ap.z) {
        uv = vec2(p.x, p.z * sign(p.y)) * 0.5 + 0.5;
      } else {
        uv = vec2(p.x * sign(p.z), p.y) * 0.5 + 0.5;
      }
      return clamp(uv, 0.0, 1.0);
    } else {
      // Pyramid — wrap U around base, V vertical
      vec3 d = normalize(p + 1e-6);
      return vec2(atan(d.z, d.x) / TAU + 0.5, p.y * 0.5 + 0.5);
    }
  }

  // Sample heightfield from source luma at given surface point.
  float heightAt(vec3 p, int shape) {
    vec2 uv = fract(surfaceUV(p, shape) * uTileScale);
    return luma(texture2D(uTexture, uv).rgb);
  }

  // Bumped SDF — base shape minus luma height along outward direction.
  float bumpedSDF(vec3 p) {
    int shape = int(uShape + 0.5);
    float baseR = 0.85;
    float h = heightAt(p, shape) * uHeight * 0.5;
    float baseSDF;
    if (shape == 0) {
      baseSDF = length(p) - baseR;
    } else if (shape == 1) {
      baseSDF = sdBox(p, vec3(baseR));
    } else {
      baseSDF = sdPyramid(p, baseR * 1.2, baseR);
    }
    return baseSDF - h;
  }

  // 4-tap normal estimation
  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.0025, -0.0025);
    return normalize(
      e.xyy * bumpedSDF(p + e.xyy) +
      e.yyx * bumpedSDF(p + e.yyx) +
      e.yxy * bumpedSDF(p + e.yxy) +
      e.xxx * bumpedSDF(p + e.xxx)
    );
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 screenPos = vUv * 2.0 - 1.0;
    screenPos.x *= uResolution.x / uResolution.y;

    float dist = max(1.5, uCamDistance);
    vec3 ro = vec3(0.0, 0.0, dist);
    vec3 rd = normalize(vec3(screenPos, -1.5));

    float angY = uRotateY * TAU + uTime * uAutoRotate * 0.4;
    float angX = (uRotateX - 0.5) * PI;
    mat3 rotMat = rotY(angY) * rotX(angX);
    ro = rotMat * ro;
    rd = rotMat * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 p = ro + rd * t;
      float d = bumpedSDF(p);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 8.0) break;
    }

    if (!hit) {
      float alpha = 1.0 - uHorizonFade;
      vec3 col = mix(uFogColor, srcRaw, uSourceMix);
      gl_FragColor = vec4(col, alpha);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    int shape = int(uShape + 0.5);
    vec2 sUV = fract(surfaceUV(hitPos, shape) * uTileScale);
    vec3 texCol = texture2D(uTexture, sUV).rgb;

    // Lighting
    vec3 lightDir = normalize(rotMat * vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, N), -rd), 0.0), 32.0) * uSpecular;
    vec3 lit = texCol * (uAmbient + diff * 0.85) + vec3(spec);

    // Distance fog
    float fogFactor = 1.0 - exp(-t * uFogDistance * 0.3);
    lit = mix(lit, uFogColor, fogFactor);

    // Fresnel-like silhouette fade for clean transparent BG
    float fres = 1.0 - max(dot(N, -rd), 0.0);
    float silAlpha = 1.0 - smoothstep(0.7, 1.0, fres) * uHorizonFade;

    vec3 disp = mix(lit, srcRaw, uSourceMix);
    gl_FragColor = vec4(clamp(disp, 0.0, 1.0), silAlpha);
  }
`,sl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;

    float blend = uAmount;
    float roughness = uAmount2;
    float spinSpd = uAmount3 * 2.0;
    float rimGlow = uThreshold;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(centered);
    float sphereR = 0.45;

    if (r < sphereR) {
      float z = sqrt(sphereR * sphereR - r * r);
      vec3 normal = normalize(vec3(centered, z));

      float angle = uTime * spinSpd;
      float ca = cos(angle), sa = sin(angle);
      vec3 rotN = vec3(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);

      vec2 sphereUV = vec2(atan(rotN.z, rotN.x) / TAU + 0.5, asin(clamp(rotN.y, -1.0, 1.0)) / PI + 0.5);
      vec3 texColor = texture2D(uTexture, sphereUV).rgb;

      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diff = max(dot(normal, lightDir), 0.0);
      float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0,0,1)), 0.0), mix(4.0, 64.0, roughness));
      float fresnel = pow(1.0 - abs(normal.z), 3.0) * rimGlow;

      vec3 lit = texColor * (diff * 0.7 + 0.3) * uColor + vec3(spec * 0.3) + vec3(fresnel) * uColor;
      outColor.rgb = mix(src.rgb, lit, blend);
    } else {
      float edgeFade = smoothstep(sphereR + 0.02, sphereR, r);
      outColor.rgb = mix(src.rgb, src.rgb * 0.3, edgeFade * blend * 0.5);
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`,cl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  mat2 rot2d(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;

    float cubeSize = 0.3 + uAmount * 0.5;
    float edgeGlow = uAmount2;
    float spinSpd = uAmount3 * 1.5;
    float manualRot = uAngle;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    vec3 ro = vec3(0.0, 0.0, -2.5);
    vec3 rd = normalize(vec3(centered, 1.0));

    float angle = uTime * spinSpd + manualRot;
    float tilt = 0.4;

    rd.xz = rot2d(angle) * rd.xz;
    ro.xz = rot2d(angle) * ro.xz;
    rd.yz = rot2d(tilt) * rd.yz;
    ro.yz = rot2d(tilt) * ro.yz;

    // Ray-AABB intersection
    vec3 boxMin = vec3(-cubeSize);
    vec3 boxMax = vec3(cubeSize);
    vec3 invRd = 1.0 / rd;
    vec3 t1 = (boxMin - ro) * invRd;
    vec3 t2 = (boxMax - ro) * invRd;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);

    if (tNear < tFar && tFar > 0.0) {
      float t = tNear > 0.0 ? tNear : tFar;
      vec3 hitPos = ro + rd * t;
      vec3 absHit = abs(hitPos);

      vec2 faceUV;
      vec3 normal;
      if (absHit.x > absHit.y - 0.001 && absHit.x > absHit.z - 0.001) {
        faceUV = hitPos.yz / cubeSize * 0.5 + 0.5;
        normal = vec3(sign(hitPos.x), 0.0, 0.0);
      } else if (absHit.y > absHit.z - 0.001) {
        faceUV = hitPos.xz / cubeSize * 0.5 + 0.5;
        normal = vec3(0.0, sign(hitPos.y), 0.0);
      } else {
        faceUV = hitPos.xy / cubeSize * 0.5 + 0.5;
        normal = vec3(0.0, 0.0, sign(hitPos.z));
      }

      vec3 texColor = texture2D(uTexture, clamp(faceUV, 0.0, 1.0)).rgb;
      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diff = max(dot(normal, lightDir), 0.0) * 0.7 + 0.3;
      vec3 lit = texColor * diff * uColor;

      vec2 edgeDist = 1.0 - abs(faceUV * 2.0 - 1.0);
      float edgeMin = min(edgeDist.x, edgeDist.y);
      float edge = smoothstep(0.02, 0.08, edgeMin);
      lit += vec3(1.0 - edge) * edgeGlow * uColor;

      outColor.rgb = lit;
    } else {
      outColor.rgb = src.rgb * 0.15;
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`,fl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float radius = 0.2 + uAmount2 * 0.8;
    float spinSpeed = uAmount3 * 2.0;
    float perspective = 0.5 + uThreshold * 2.0;

    // Center UV
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Cylinder rotation angle
    float angle = uTime * spinSpeed;

    // Ray from camera
    vec3 ro = vec3(0.0, 0.0, -2.0 - perspective);
    vec3 rd = normalize(vec3(p, 2.0));

    // Cylinder along Y axis at origin
    // Ray-cylinder intersection: (ro.x + t*rd.x)^2 + (ro.z + t*rd.z)^2 = r^2
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
    float c = ro.x * ro.x + ro.z * ro.z - radius * radius;
    float disc = b * b - 4.0 * a * c;

    vec3 col = src.rgb * 0.1;

    if (disc > 0.0) {
      float t = (-b - sqrt(disc)) / (2.0 * a);
      if (t > 0.0) {
        vec3 hit = ro + t * rd;

        // Check if within cylinder height
        if (abs(hit.y) < 1.0) {
          // Map to texture UV
          float theta = atan(hit.x, hit.z) + angle;
          float texU = fract(theta / TAU);
          float texV = hit.y * 0.5 + 0.5;

          vec3 texCol = texture2D(uTexture, vec2(texU, texV)).rgb;

          // Lighting
          vec3 normal = normalize(vec3(hit.x, 0.0, hit.z));
          vec3 lightDir = normalize(vec3(0.5, 0.7, -1.0));
          float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

          // Specular
          vec3 viewDir = normalize(-rd);
          vec3 halfDir = normalize(lightDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;

          col = texCol * diff + vec3(spec);
        }
      }
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,vl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float sdTorus(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.xz) - R, p.y);
    return length(q) - r;
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tubeRadius = 0.3 + uAmount2 * 0.7;
    float flySpeed = uAmount3 * 1.5;
    float twist = uThreshold * 4.0;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float majorR = 1.5;
    float t = uTime * flySpeed;

    // Camera position on the ring path
    float camAngle = t;
    vec3 camPos = vec3(cos(camAngle) * majorR, 0.0, sin(camAngle) * majorR);

    // Camera forward tangent to ring
    vec3 camFwd = normalize(vec3(-sin(camAngle), 0.0, cos(camAngle)));
    vec3 camUp = vec3(0.0, 1.0, 0.0);
    vec3 camRight = normalize(cross(camFwd, camUp));
    camUp = cross(camRight, camFwd);

    // Apply twist
    float tw = t * twist;
    vec3 tRight = camRight * cos(tw) + camUp * sin(tw);
    vec3 tUp = -camRight * sin(tw) + camUp * cos(tw);

    vec3 rd = normalize(camFwd + p.x * tRight * 0.8 + p.y * tUp * 0.8);

    // Move camera slightly inside the tube
    camPos += camFwd * 0.01;

    // Raymarch the inner surface of the torus
    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    bool hit = false;

    for (int i = 0; i < 60; i++) {
      vec3 pos = camPos + rd * totalDist;
      float d = -sdTorus(pos, majorR, tubeRadius);
      if (d < 0.002) {
        hit = true;
        break;
      }
      if (totalDist > 10.0) break;
      totalDist += max(d, 0.005);
    }

    if (hit) {
      vec3 hitPos = camPos + rd * totalDist;

      // Map hit to texture coordinates
      float ringAngle = atan(hitPos.z, hitPos.x);
      vec2 localP = vec2(length(hitPos.xz) - majorR, hitPos.y);
      float tubeAngle = atan(localP.y, localP.x);

      vec2 texUV = vec2(
        fract(ringAngle / TAU + 0.5),
        fract(tubeAngle / TAU + 0.5)
      );

      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Simple depth fog
      float fog = exp(-totalDist * 0.3);
      col = texCol * fog;

      // Subtle ambient
      col += vec3(0.02, 0.01, 0.03);
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,dl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float facets = 4.0 + uAmount2 * 16.0;
    float rotSpeed = uAmount3 * 2.0;
    float sparkle = uThreshold;

    // Centered coords with aspect ratio
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * rotSpeed;

    // Diamond shape using analytical geometry (no raymarching)
    // Rotate the 2D point to spin the diamond
    float ca = cos(t), sa = sin(t);
    vec2 rp = vec2(p.x * ca - p.y * sa * 0.3, p.x * sa * 0.3 + p.y * ca);

    // Diamond silhouette: top and bottom cones
    float ax = abs(rp.x);
    float topHalf = step(rp.y, 0.0);   // 1.0 if in top half (y<0 = bottom of diamond)
    float botHalf = 1.0 - topHalf;

    // Diamond outline: narrower at top, wider at equator, pointed at bottom
    float topWidth = 0.6;   // half-width at crown
    float equatorY = -0.15; // equator position
    float crownY = -0.55;   // top of diamond
    float pointY = 0.75;    // bottom point

    // Compute diamond boundary
    float diamondDist = 1.0;
    // Above equator (crown facets)
    float tCrown = clamp((rp.y - equatorY) / (crownY - equatorY), 0.0, 1.0);
    float crownWidth = mix(topWidth, topWidth * 0.7, tCrown);
    // Below equator (pavilion - tapers to point)
    float tPav = clamp((rp.y - equatorY) / (pointY - equatorY), 0.0, 1.0);
    float pavWidth = mix(topWidth, 0.0, tPav);

    float halfWidth = mix(pavWidth, crownWidth, step(rp.y, equatorY));
    float inDiamond = step(ax, halfWidth) * step(crownY, rp.y) * step(rp.y, pointY);

    // Faceted normal based on quantized angle
    float angle = atan(rp.y - equatorY, rp.x);
    float qAngle = floor(angle * facets / TAU + 0.5) * TAU / facets;
    vec2 facetN2 = vec2(cos(qAngle), sin(qAngle));
    vec3 facetNormal = normalize(vec3(facetN2.x, facetN2.y, 0.6));

    // Texture sampling through refraction (always compute, use outside branches)
    vec3 refDir = vec3(facetN2 * 0.4, 1.0);
    vec2 texUV = uv + refDir.xy * 0.15;
    vec3 texCol = texture2D(uTexture, clamp(texUV, 0.0, 1.0)).rgb;

    // Also sample with different offsets for RGB dispersion
    vec3 texR = texture2D(uTexture, clamp(uv + refDir.xy * 0.20, 0.0, 1.0)).rgb;
    vec3 texB = texture2D(uTexture, clamp(uv + refDir.xy * 0.10, 0.0, 1.0)).rgb;
    vec3 dispersed = vec3(texR.r, texCol.g, texB.b);

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, -0.8, 1.0));
    float diff = max(dot(facetNormal, lightDir), 0.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfV = normalize(lightDir + viewDir);
    float spec = pow(max(dot(facetNormal, halfV), 0.0), 80.0);

    // Fresnel
    float fresnel = pow(1.0 - max(dot(viewDir, facetNormal), 0.0), 3.0);

    // Rainbow caustics
    float causticAngle = angle + t * 0.5;
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (causticAngle / TAU + vec3(0.0, 0.33, 0.67)));

    // Compose diamond
    vec3 gemCol = dispersed * (diff * 0.6 + 0.4);
    gemCol += rainbow * fresnel * 0.4;
    gemCol += vec3(spec) * sparkle * 3.0;
    gemCol += rainbow * spec * sparkle * 0.5;

    // Edge highlight
    float edgeDist = abs(ax - halfWidth * 0.97);
    float edge = smoothstep(0.02, 0.0, edgeDist) * inDiamond;
    gemCol += vec3(0.8, 0.85, 1.0) * edge * 0.5;

    // Mix with background
    vec3 col = mix(src.rgb * 0.15, gemCol, inDiamond);
    col = mix(src.rgb, col, blend);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,ml=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float force = uAmount * 2.0;
    float shardSize = mix(4.0, 20.0, uAmount2);
    float speed = 0.5 + uAmount3 * 2.0;
    float gravity = uThreshold * 0.5;

    // Oscillating explosion factor (0 = assembled, 1 = exploded)
    float phase = sin(uTime * speed) * 0.5 + 0.5;
    float explode = phase * force;

    // Voronoi-based shard pattern
    vec2 cellSize = vec2(shardSize) / uResolution;
    vec2 cellId = floor(uv / cellSize);
    vec2 cellUv = fract(uv / cellSize);

    // Find closest Voronoi center for shard identity
    float minDist = 10.0;
    vec2 closestId = cellId;
    vec2 closestCenter = vec2(0.5);

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = cellId + vec2(float(x), float(y));
        vec2 point = hash2(neighbor);
        vec2 diff = neighbor + point - uv / cellSize;
        float d = dot(diff, diff);
        if (d < minDist) {
          minDist = d;
          closestId = neighbor;
          closestCenter = neighbor + point;
        }
      }
    }

    // Shard properties based on ID
    vec2 shardHash = hash2(closestId);
    float shardAngle = shardHash.x * TAU;
    float shardDelay = shardHash.y * 0.5;

    // Offset for this shard
    float localExplode = max(explode - shardDelay, 0.0);
    vec2 dir = normalize(closestCenter * cellSize - vec2(0.5));
    vec2 offset = dir * localExplode * 0.3;
    offset.y -= gravity * localExplode * localExplode; // gravity pull

    // Rotation per shard
    float rot = localExplode * shardAngle * 2.0;
    vec2 center = closestCenter * cellSize;
    vec2 rotUv = uv - center;
    float cs = cos(rot), sn = sin(rot);
    rotUv = vec2(rotUv.x * cs - rotUv.y * sn, rotUv.x * sn + rotUv.y * cs);
    rotUv += center;

    vec2 sampleUv = rotUv - offset;

    // Edge detection for shard borders
    float edge = smoothstep(0.01, 0.03, sqrt(minDist));

    // Depth shading based on explode
    float depth = 1.0 - localExplode * 0.3;

    vec3 col = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0)).rgb;
    col *= depth;
    col *= edge; // Darken edges

    // Shard edge highlight
    float edgeHighlight = 1.0 - smoothstep(0.02, 0.06, sqrt(minDist));
    col += edgeHighlight * vec3(0.3) * localExplode;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,pl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float stripW = 0.1 + uAmount2 * 0.5;
    float rotSpeed = uAmount3 * 1.5;
    float twistAmt = 1.0 + uThreshold * 4.0;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * rotSpeed;

    // Camera setup
    vec3 ro = vec3(0.0, 1.2, -3.0);
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right + p.y * up);

    // Brute-force closest point on Mobius strip
    float minDist = 100.0;
    float bestU = 0.0;
    float bestV = 0.0;

    for (int i = 0; i < 64; i++) {
      float u = float(i) / 64.0 * TAU;
      for (int j = 0; j < 8; j++) {
        float v = float(j) / 7.0 * 2.0 - 1.0;

        float halfTwist = u * twistAmt * 0.5;
        float R = 1.2;
        vec3 mp = vec3(
          (R + v * stripW * cos(halfTwist)) * cos(u + t),
          v * stripW * sin(halfTwist),
          (R + v * stripW * cos(halfTwist)) * sin(u + t)
        );

        // Project onto ray and check distance
        vec3 diff = mp - ro;
        float along = dot(diff, rd);
        if (along > 0.0) {
          vec3 closest = ro + rd * along;
          float d = length(mp - closest);
          if (d < minDist) {
            minDist = d;
            bestU = u;
            bestV = v;
          }
        }
      }
    }

    vec3 col = src.rgb * 0.08;

    if (minDist < 0.08) {
      vec2 texUV = vec2(fract(bestU / TAU), bestV * 0.5 + 0.5);
      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Shading based on proximity
      float shade = smoothstep(0.08, 0.01, minDist);

      // Simple lighting approximation
      float light = 0.5 + 0.5 * sin(bestU * 2.0 + t);
      texCol *= (0.6 + 0.4 * light);

      col = texCol * shade;
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,hl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float depthScale = 0.3 + uAmount * 1.5;
    float gridRes = floor(mix(6.0, 32.0, uAmount2));
    float rotAngle = uTime * uAmount3 * 0.8;
    float gap = uThreshold * 0.3;

    // Isometric-style projection: tilt the grid
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Apply rotation
    float ca = cos(rotAngle), sa = sin(rotAngle);
    vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

    // Isometric tilt: compress Y to simulate looking down at an angle
    float tiltAngle = 0.65; // ~37 degrees
    vec2 isoP = vec2(rp.x, rp.y / tiltAngle);

    // Map to grid coordinates
    vec2 gridUV = isoP * 0.5 + 0.5;

    // Quantize to voxel grid
    vec2 voxelID = floor(gridUV * gridRes);
    vec2 cellUV = fract(gridUV * gridRes); // position within cell 0..1

    // Texture coordinate for this voxel
    vec2 texCoord = (voxelID + 0.5) / gridRes;

    // Sample texture (always, outside any branches)
    vec3 texCol = texture2D(uTexture, clamp(texCoord, 0.0, 1.0)).rgb;
    float height = luma(texCol) * depthScale;

    // Check if we're inside the grid
    vec3 col = vec3(0.02, 0.02, 0.04);

    float inGrid = step(0.0, gridUV.x) * step(gridUV.x, 1.0) * step(0.0, gridUV.y) * step(gridUV.y, 1.0);

    // Gap between voxels
    float halfGap = gap * 0.5;
    float inCell = step(halfGap, cellUV.x) * step(cellUV.x, 1.0 - halfGap) *
                   step(halfGap, cellUV.y) * step(cellUV.y, 1.0 - halfGap);

    // Simulate 3D block: the cell's vertical offset shifts it up
    // The "side" of the block is visible when neighboring cells are shorter
    // We fake the 3D look by using height to shift the cell and color the faces

    // Top face color (lit from above-left)
    vec3 topCol = texCol * 1.1;

    // Side faces: check neighbors for depth
    vec2 leftTexCoord = (voxelID + vec2(-0.5, 0.5)) / gridRes;
    vec2 frontTexCoord = (voxelID + vec2(0.5, 1.5)) / gridRes;
    vec3 leftTex = texture2D(uTexture, clamp(leftTexCoord, 0.0, 1.0)).rgb;
    vec3 frontTex = texture2D(uTexture, clamp(frontTexCoord, 0.0, 1.0)).rgb;
    float leftH = luma(leftTex) * depthScale;
    float frontH = luma(frontTex) * depthScale;

    // Height difference creates visible side faces
    float sideExposureX = max(height - leftH, 0.0);
    float sideExposureY = max(height - frontH, 0.0);

    // Isometric pixel offset based on height
    float pixelH = height * 0.15;

    // Determine which face we're seeing
    // The "top" of the voxel block
    float topFace = inCell;

    // Right-side face (visible when left neighbor is shorter)
    float rightSide = step(0.0, sideExposureX) * step(cellUV.x, halfGap * 3.0) * (1.0 - step(halfGap, cellUV.x));
    // Front face (visible when front neighbor is shorter)
    float frontSide = step(0.0, sideExposureY) * step(1.0 - halfGap * 3.0, cellUV.y) * step(cellUV.y, 1.0);

    // Light direction simulation
    vec3 rightCol = texCol * 0.6;  // darker side
    vec3 frontCol = texCol * 0.4;  // darkest side

    // Compose the voxel
    vec3 voxelCol = topCol * topFace + rightCol * rightSide + frontCol * frontSide;

    // Apply height as vertical UV offset for parallax effect
    vec2 shiftedUV = uv + vec2(0.0, pixelH);
    vec3 shiftedSrc = texture2D(uTexture, clamp(shiftedUV, 0.0, 1.0)).rgb;

    // Final: blend voxelized look with height-shifted source
    float showVoxel = inGrid * max(topFace, max(rightSide, frontSide));
    col = mix(vec3(0.02), voxelCol, showVoxel);

    // Add subtle ambient occlusion at gaps
    float ao = smoothstep(0.0, halfGap * 2.0, min(cellUV.x, min(cellUV.y, min(1.0 - cellUV.x, 1.0 - cellUV.y))));
    col *= mix(0.7, 1.0, ao);

    // Add height-based shadow
    col *= 0.6 + height * 0.6;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,gl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float waveHeight(vec2 p, float t, float amp, float freq) {
    float h = 0.0;
    h += sin(p.x * freq + t * 1.3) * 0.5;
    h += sin(p.y * freq * 0.7 + t * 0.9) * 0.3;
    h += sin((p.x + p.y) * freq * 0.5 + t * 1.7) * 0.2;
    h += sin((p.x - p.y) * freq * 0.8 + t * 2.1) * 0.15;
    h += sin(p.x * freq * 2.0 + p.y * freq * 1.5 + t * 2.5) * 0.1;
    return h * amp;
  }

  vec3 waveNormal(vec2 p, float t, float amp, float freq) {
    float eps = 0.01;
    float hL = waveHeight(p - vec2(eps, 0.0), t, amp, freq);
    float hR = waveHeight(p + vec2(eps, 0.0), t, amp, freq);
    float hD = waveHeight(p - vec2(0.0, eps), t, amp, freq);
    float hU = waveHeight(p + vec2(0.0, eps), t, amp, freq);
    return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float amp = 0.05 + uAmount * 0.3;
    float freq = 2.0 + uAmount2 * 10.0;
    float speed = 0.5 + uAmount3 * 3.0;
    float specular = uThreshold;

    float t = uTime * speed;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Camera looking down at the wave surface
    vec3 ro = vec3(0.0, 2.0, -1.5);
    vec3 rd = normalize(vec3(p.x, -1.2, p.y + 0.5));

    // Intersect with approximate plane y = 0
    float tPlane = -ro.y / rd.y;
    vec3 col = vec3(0.01, 0.02, 0.05);

    if (tPlane > 0.0) {
      vec3 hitPos = ro + rd * tPlane;
      vec2 surfaceUv = hitPos.xz;

      // Wave displacement
      float h = waveHeight(surfaceUv, t, amp, freq);
      vec3 normal = waveNormal(surfaceUv, t, amp, freq);

      // Refracted texture lookup
      vec3 refr = refract(rd, normal, 0.75);
      vec2 texUV = surfaceUv * 0.3 + 0.5 + refr.xz * 0.1;
      texUV = fract(texUV);

      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Lighting
      vec3 lightDir = normalize(vec3(0.3, 1.0, -0.5));
      float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

      // Specular
      vec3 viewDir = normalize(-rd);
      vec3 reflDir = reflect(-lightDir, normal);
      float spec = pow(max(dot(viewDir, reflDir), 0.0), 32.0) * specular;

      // Fresnel
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0) * 0.3;

      col = texCol * diff + vec3(0.4, 0.6, 0.9) * fresnel + vec3(spec);

      // Depth fog
      float fog = exp(-tPlane * 0.15);
      col *= fog;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,xl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // Signed distance to a triangle prism cross-section (2D)
  float sdTriangle(vec2 p, float r) {
    float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float separation = uAmount * 0.15;
    float prismAngle = uAmount2 * PI;
    float rotation = uAmount3 * TAU;
    float tintIntensity = uThreshold;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime;

    // Rotate space
    p = rot2(rotation + t * 0.3) * p;

    // Prism shape
    float prismSize = 0.4 + prismAngle * 0.3;
    float dist = sdTriangle(p, prismSize);

    // Amount of refraction based on distance to prism
    float inPrism = smoothstep(0.02, -0.02, dist);

    // Each color channel gets a different refraction angle
    float baseAngle = atan(p.y, p.x);
    float baseDist = length(p);

    // Chromatic separation offsets
    vec2 redOffset = vec2(cos(baseAngle - separation), sin(baseAngle - separation)) * separation * baseDist;
    vec2 greenOffset = vec2(0.0);
    vec2 blueOffset = vec2(cos(baseAngle + separation), sin(baseAngle + separation)) * separation * baseDist;

    // Scale up separation when inside prism
    redOffset *= (1.0 + inPrism * 4.0);
    blueOffset *= (1.0 + inPrism * 4.0);

    // Sample each channel with offset
    float r = texture2D(uTexture, uv + redOffset).r;
    float g = texture2D(uTexture, uv + greenOffset).g;
    float b = texture2D(uTexture, uv + blueOffset).b;

    vec3 col = vec3(r, g, b);

    // Glass tint from prism
    vec3 tint = mix(vec3(1.0), uColor, tintIntensity * inPrism);
    col *= tint;

    // Edge highlight (caustic-like on prism edges)
    float edgeGlow = smoothstep(0.05, 0.0, abs(dist)) * 0.6;
    // Rainbow on edge
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (baseAngle / TAU + vec3(0.0, 0.33, 0.67)));
    col += rainbow * edgeGlow * separation * 5.0;

    // Subtle prism surface reflection
    float highlight = pow(max(1.0 - abs(dist) * 5.0, 0.0), 8.0) * 0.2;
    col += vec3(highlight);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,bl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float foldDepth = 0.1 + uAmount * 0.9;
    float foldCount = 2.0 + floor(uAmount2 * 10.0);
    float speed = 0.5 + uAmount3 * 2.0;
    float creaseSharpen = 2.0 + uThreshold * 20.0;

    float t = uTime * speed;

    // Animated fold intensity
    float foldAnim = (sin(t) * 0.5 + 0.5) * foldDepth;

    // Horizontal folds
    float hFold = uv.y * foldCount;
    float hFoldId = floor(hFold);
    float hFoldFrac = fract(hFold);

    // Vertical folds
    float vFold = uv.x * foldCount;
    float vFoldId = floor(vFold);
    float vFoldFrac = fract(vFold);

    // Triangle fold: fold direction alternates
    float hDir = mod(hFoldId, 2.0) * 2.0 - 1.0;
    float vDir = mod(vFoldId, 2.0) * 2.0 - 1.0;

    // Fold angle — creates a V shape within each strip
    float hAngle = (hFoldFrac - 0.5) * 2.0 * hDir;
    float vAngle = (vFoldFrac - 0.5) * 2.0 * vDir;

    // Combined fold normal (simplified 3D fold)
    float foldNormalZ = cos(hAngle * foldAnim * PI * 0.5) * cos(vAngle * foldAnim * PI * 0.5);
    float foldNormalX = sin(vAngle * foldAnim * PI * 0.5) * 0.5;
    float foldNormalY = sin(hAngle * foldAnim * PI * 0.5) * 0.5;
    vec3 normal = normalize(vec3(foldNormalX, foldNormalY, foldNormalZ));

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
    float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

    // Specular for paper sheen
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 16.0) * 0.3;

    // UV displacement from fold
    vec2 dispUv = uv;
    dispUv.x += foldNormalX * foldAnim * 0.02;
    dispUv.y += foldNormalY * foldAnim * 0.02;

    vec3 texCol = texture2D(uTexture, clamp(dispUv, 0.0, 1.0)).rgb;

    // Crease darkening
    float hCrease = pow(abs(hFoldFrac - 0.5) * 2.0, creaseSharpen);
    float vCrease = pow(abs(vFoldFrac - 0.5) * 2.0, creaseSharpen);
    float crease = min(hCrease, vCrease);
    float creaseDark = mix(0.6, 1.0, crease);

    // Shadow on folded parts
    float shadow = mix(1.0, foldNormalZ, foldAnim);

    vec3 col = texCol * diff * creaseDark * shadow + vec3(spec) * foldAnim;

    // Paper edge highlight at creases
    float edgeDist = min(abs(hFoldFrac - 0.5), abs(vFoldFrac - 0.5));
    float edgeLine = smoothstep(0.02, 0.0, edgeDist) * foldAnim * 0.4;
    col += vec3(edgeLine);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,yl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float roomSize = 0.5 + uAmount2 * 2.0;
    float camSpeed = uAmount3 * 0.5;
    float reflFade = 0.3 + uThreshold * 0.65;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime;

    // Camera inside the box, gently moving
    vec3 ro = vec3(
      sin(t * camSpeed * 0.7) * roomSize * 0.3,
      sin(t * camSpeed * 0.5) * roomSize * 0.2,
      cos(t * camSpeed * 0.6) * roomSize * 0.3
    );

    // Look direction slowly rotating
    float lookAngle = t * camSpeed * 0.4;
    vec3 lookDir = vec3(cos(lookAngle), sin(t * camSpeed * 0.2) * 0.3, sin(lookAngle));
    vec3 fwd = normalize(lookDir);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right * 0.8 + p.y * up * 0.8);

    // Box bounds
    vec3 boxMin = vec3(-roomSize);
    vec3 boxMax = vec3(roomSize);

    vec3 col = vec3(0.0);
    float energy = 1.0;

    vec3 rayPos = ro;
    vec3 rayDir = rd;

    // Bounce reflections
    for (int bounce = 0; bounce < 8; bounce++) {
      // Ray-box intersection (from inside)
      vec3 tMin = (boxMin - rayPos) / rayDir;
      vec3 tMax = (boxMax - rayPos) / rayDir;
      vec3 t1 = min(tMin, tMax);
      vec3 t2 = max(tMin, tMax);

      float tFar = min(min(t2.x, t2.y), t2.z);

      // We want the first positive intersection
      float hitT = tFar;
      if (hitT < 0.001) hitT = 0.001;

      // Find which face we hit
      vec3 hitPos = rayPos + rayDir * hitT;
      vec3 absHit = abs(hitPos);
      vec3 normal;
      vec2 faceUV;

      if (absHit.x >= absHit.y - 0.001 && absHit.x >= absHit.z - 0.001) {
        normal = vec3(-sign(rayDir.x), 0.0, 0.0);
        faceUV = hitPos.yz / roomSize * 0.5 + 0.5;
      } else if (absHit.y >= absHit.z - 0.001) {
        normal = vec3(0.0, -sign(rayDir.y), 0.0);
        faceUV = hitPos.xz / roomSize * 0.5 + 0.5;
      } else {
        normal = vec3(0.0, 0.0, -sign(rayDir.z));
        faceUV = hitPos.xy / roomSize * 0.5 + 0.5;
      }

      // Sample texture on this wall
      vec3 texCol = texture2D(uTexture, clamp(faceUV, 0.0, 1.0)).rgb;

      // Add contribution
      col += texCol * energy * 0.35;

      // Fade energy per bounce
      energy *= reflFade;
      if (energy < 0.01) break;

      // Reflect
      rayPos = hitPos + normal * 0.01;
      rayDir = reflect(rayDir, normal);
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,Sl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718
  #define SQRT3 1.7320508

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tileSize = mix(4.0, 20.0, uAmount2);
    float popSpeed = uAmount3 * 3.0;
    float gapSize = uThreshold * 0.15;

    // Hex grid math
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 p = uv * aspect * tileSize;

    // Two candidate hex centers (offset rows)
    vec2 a = mod(p, vec2(1.0, SQRT3)) - vec2(0.5, SQRT3 * 0.5);
    vec2 b = mod(p - vec2(0.5, SQRT3 * 0.5), vec2(1.0, SQRT3)) - vec2(0.5, SQRT3 * 0.5);

    // Pick the closer hex center
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 hexId = floor(p - gv + 0.5);

    // Distance to hex edge (approximate with max of 3 axis distances)
    float dx = abs(gv.x);
    float dy = abs(gv.y);
    float hexDist = max(dx, (dx * 0.5 + dy * SQRT3 * 0.5));
    float hexEdge = 0.5 - gapSize;
    float inHex = smoothstep(hexEdge + 0.01, hexEdge - 0.01, hexDist);

    // Per-hex animation
    float rnd = hash21(hexId);
    float phase = rnd * TAU;
    float pop = sin(uTime * popSpeed + phase) * 0.5 + 0.5;

    // Hex-local UV for texture sampling
    vec2 hexUV = (hexId / tileSize) / aspect;
    vec2 localOffset = gv / tileSize / aspect;

    // Slight rotation per hex
    float rotA = sin(uTime * popSpeed * 0.5 + phase) * 0.3 * uAmount3;
    float cr = cos(rotA), sr = sin(rotA);
    vec2 rotOffset = vec2(localOffset.x * cr - localOffset.y * sr,
                          localOffset.x * sr + localOffset.y * cr);

    vec2 texCoord = clamp(hexUV + rotOffset, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Lighting: raised hexes are brighter
    float lighting = 0.6 + pop * 0.5;

    // Edge highlight
    float edgeGlow = smoothstep(hexEdge, hexEdge - 0.06, hexDist) -
                     smoothstep(hexEdge - 0.06, hexEdge - 0.12, hexDist);

    vec3 col = texCol * lighting * inHex;
    col += vec3(0.4, 0.5, 0.7) * edgeGlow * 0.3 * pop;

    // Dark background in gaps
    col = mix(vec3(0.01), col, inHex);

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,Cl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float arms = floor(3.0 + uAmount2 * 9.0);
    float spinSpeed = uAmount3 * 2.0;
    float gap = uThreshold * 0.08;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(centered);
    float a = atan(centered.y, centered.x);

    // Logarithmic spiral: angle depends on log of radius
    float spiralTwist = 3.0;
    float spiralA = a + log(max(r, 0.001)) * spiralTwist - uTime * spinSpeed;

    // Divide into sectors
    float sectorAngle = TAU / arms;
    float sectorId = floor(spiralA / sectorAngle);
    float sectorFrac = fract(spiralA / sectorAngle);

    // Radial rings
    float ringCount = 6.0 + uAmount2 * 10.0;
    float ringId = floor(r * ringCount);
    float ringFrac = fract(r * ringCount);

    // Combined tile ID
    float tileId = sectorId * 100.0 + ringId;
    float rnd = hash11(tileId);

    // Gaps
    float sectorGap = smoothstep(0.0, gap, sectorFrac) * smoothstep(1.0, 1.0 - gap, sectorFrac);
    float ringGap = smoothstep(0.0, gap * 2.0, ringFrac) * smoothstep(1.0, 1.0 - gap * 2.0, ringFrac);
    float inTile = sectorGap * ringGap;

    // Per-tile animation
    float tilePhase = rnd * TAU;
    float tileFlip = sin(uTime * spinSpeed * 1.5 + tilePhase);

    // Map tile center back to source UV
    float centerA = (sectorId + 0.5) * sectorAngle - log(max(r, 0.001)) * spiralTwist + uTime * spinSpeed;
    float centerR = (ringId + 0.5) / ringCount;
    vec2 tileCenterUV = vec2(cos(centerA), sin(centerA)) * centerR;
    tileCenterUV.x /= uResolution.x / uResolution.y;
    vec2 texCoord = clamp(tileCenterUV + 0.5, 0.0, 1.0);

    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Perspective flip effect
    float lighting = 0.5 + 0.5 * abs(cos(tileFlip * PI * 0.5));

    vec3 col = texCol * lighting * inTile;
    col = mix(vec3(0.015), col, inTile);

    // Radial fade at center and edges
    float radialFade = smoothstep(0.0, 0.05, r) * smoothstep(1.2, 0.8, r);
    col *= radialFade;

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,Tl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tileCount = floor(mix(3.0, 14.0, uAmount2));
    float slideSpeed = uAmount3 * 2.0;
    float overlap = 0.2 + uThreshold * 0.4;

    // Grid with row offsets (brick pattern)
    vec2 scaled = uv * tileCount;
    float row = floor(scaled.y);
    float rowOffset = mod(row, 2.0) * 0.5;
    scaled.x += rowOffset;

    vec2 tileId = floor(scaled);
    vec2 tileFrac = fract(scaled);

    // Per-tile random values
    float rnd = hash21(tileId);
    float rnd2 = hash21(tileId + 100.0);

    // Animated shingle lift
    float liftPhase = rnd * TAU + uTime * slideSpeed;
    float lift = sin(liftPhase) * 0.5 + 0.5;

    // Parallax offset
    float parallaxAmount = lift * overlap * 0.3;
    vec2 parallaxOffset = vec2(
      (rnd2 - 0.5) * parallaxAmount,
      -parallaxAmount * 0.5
    );

    // Tile source UV
    vec2 tileUV = (tileId - vec2(rowOffset, 0.0) + tileFrac) / tileCount;
    vec2 texCoord = clamp(tileUV + parallaxOffset, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Shadows
    float shadowFromAbove = smoothstep(overlap, 0.0, tileFrac.y) * 0.4;
    float shadowFromSide = smoothstep(overlap * 0.5, 0.0, tileFrac.x) * 0.2;

    // Lighting based on lift
    float lighting = 0.5 + lift * 0.5;

    // Edge bevel
    float edgeX = min(tileFrac.x, 1.0 - tileFrac.x);
    float edgeY = min(tileFrac.y, 1.0 - tileFrac.y);
    float bevel = smoothstep(0.0, 0.08, min(edgeX, edgeY));
    float edgeHighlight = (1.0 - bevel) * lift * 0.3;

    vec3 col = texCol * lighting;
    col *= (1.0 - shadowFromAbove - shadowFromSide);
    col += vec3(edgeHighlight);
    col *= bevel * 0.3 + 0.7;

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,wl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float cellCount = mix(4.0, 24.0, uAmount2);
    float driftSpeed = uAmount3 * 1.5;
    float gap = uThreshold * 0.06;

    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 p = uv * aspect * cellCount;

    // Find nearest Voronoi cell
    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 nearestId = vec2(0.0);
    vec2 nearestPoint = vec2(0.0);

    // Check 3x3 neighborhood
    vec2 ip = floor(p);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = ip + vec2(float(x), float(y));
        vec2 rnd = hash22(neighbor);

        // Animate cell centers
        vec2 cellPoint = neighbor + 0.5 + 0.35 * sin(uTime * driftSpeed + rnd * TAU);

        float d = length(p - cellPoint);
        if (d < minDist) {
          secondDist = minDist;
          minDist = d;
          nearestId = neighbor;
          nearestPoint = cellPoint;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
    }

    // Edge detection
    float edgeDist = secondDist - minDist;
    float edge = smoothstep(gap, gap + 0.04, edgeDist);

    // Map cell center to texture UV
    vec2 cellUV = nearestPoint / cellCount / aspect;

    // Per-cell rotation
    vec2 cellRnd = hash22(nearestId);
    float cellAngle = sin(uTime * driftSpeed * 0.7 + cellRnd.x * TAU) * 0.2;
    float cca = cos(cellAngle), csa = sin(cellAngle);

    // Local offset with rotation
    vec2 localP = (p - nearestPoint) / cellCount / aspect;
    vec2 rotLocal = vec2(localP.x * cca - localP.y * csa,
                         localP.x * csa + localP.y * cca);

    vec2 texCoord = clamp(cellUV + rotLocal, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Depth lighting
    float depth = cellRnd.y;
    float lighting = 0.6 + depth * 0.4;
    float shadowSide = (nearestPoint.x - p.x) * 0.2;
    lighting += shadowSide;

    vec3 col = texCol * lighting * edge;

    // Edge highlight
    float edgeHighlight = smoothstep(gap + 0.06, gap + 0.01, edgeDist) * edge;
    col += vec3(0.3, 0.35, 0.5) * edgeHighlight * 0.4;

    col = mix(vec3(0.01), col, edge);

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`,ie=`
  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  mat3 rotX(float a) {
    float s = sin(a), c = cos(a);
    return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
  }
  mat3 rotY(float a) {
    float s = sin(a), c = cos(a);
    return mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
  }
  mat3 rotZ(float a) {
    float s = sin(a), c = cos(a);
    return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
  }

  // Map a unit-vector normal to spherical UV (equirectangular).
  vec2 sphereUV(vec3 n) {
    return vec2(atan(n.z, n.x) / TAU + 0.5,
                asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5);
  }

  float fresnel(vec3 n, vec3 rd, float power) {
    return pow(1.0 - max(dot(n, -rd), 0.0), power);
  }

  // Ray-sphere intersection. Returns t (negative if miss).
  float intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
  }

  // Ray-axis-aligned-box intersection. Sets outNormal to face normal.
  float intersectBox(vec3 ro, vec3 rd, vec3 r, out vec3 outNormal) {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * r;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return -1.0;
    outNormal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return tN;
  }

  // Ray-cylinder (infinite, axis-aligned along Y). Returns nearest positive t.
  float intersectCylinderY(vec3 ro, vec3 rd, float r, out vec3 outNormal) {
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = ro.x * rd.x + ro.z * rd.z;
    float c = ro.x * ro.x + ro.z * ro.z - r * r;
    float h = b * b - a * c;
    if (h < 0.0) return -1.0;
    float t = (-b - sqrt(h)) / a;
    vec3 hit = ro + rd * t;
    outNormal = normalize(vec3(hit.x, 0.0, hit.z));
    return t;
  }

  // Ray-torus intersection (analytic via quartic - approximated with raymarch).
  // Returns t when ray is within eps of the torus surface; -1 if miss.
  float intersectTorus(vec3 ro, vec3 rd, float majorR, float minorR, out vec3 outNormal) {
    float t = 0.0;
    float maxT = 8.0;
    for (int i = 0; i < 64; i++) {
      vec3 p = ro + rd * t;
      vec2 q = vec2(length(p.xz) - majorR, p.y);
      float d = length(q) - minorR;
      if (d < 0.001) {
        // Approximate normal
        vec2 cq = vec2(length(p.xz) - majorR, p.y);
        vec3 n = vec3(p.x, 0.0, p.z) / max(0.001, length(p.xz));
        outNormal = normalize(vec3(n.x * cq.x, cq.y, n.z * cq.x));
        return t;
      }
      t += max(d, 0.005);
      if (t > maxT) return -1.0;
    }
    return -1.0;
  }

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
`,Rl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4 base sphere radius
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uLatCount;      // 4-64
  uniform float uLonCount;      // 4-64
  uniform float uDiagCount;     // 0-32
  uniform float uSlope;         // -2..2
  uniform float uWidth;         // 0.005-0.05
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uFlow;          // 0-3
  uniform float uIntensity;     // 0-2
  uniform float uGlow;          // 0-2
  uniform vec3 uGlowColor;
  uniform float uHorizonFade;   // 0-1
  uniform float uTileScale;     // 0.5-4
  uniform float uAudioBass;
  uniform float uAudioHigh;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  // Bumped sphere SDF — surface = baseR + luma(equirectUV(dir)) * heightScale
  float bumpedSphereSDF(vec3 p) {
    vec3 d = normalize(p + 1e-6);
    vec2 uv = sphereUV(d);
    uv = fract(uv * uTileScale);
    float h = luma(texture2D(uTexture, uv).rgb) * uHeight * 0.4;
    return length(p) - (uRadius + h);
  }

  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.003, -0.003);
    return normalize(
      e.xyy * bumpedSphereSDF(p + e.xyy) +
      e.yyx * bumpedSphereSDF(p + e.yyx) +
      e.yxy * bumpedSphereSDF(p + e.yxy) +
      e.xxx * bumpedSphereSDF(p + e.xxx)
    );
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.8));

    // Auto-spin + tilt
    mat3 rot = rotY(uTime * uSpin) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 pp = ro + rd * t;
      float d = bumpedSphereSDF(pp);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 6.0) break;
    }

    if (!hit) {
      float a = 1.0 - uHorizonFade;
      gl_FragColor = vec4(uGlowColor * 0.05, a);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    vec3 dir = normalize(hitPos);
    vec2 suv = sphereUV(dir);
    vec2 sUVtile = fract(suv * uTileScale);

    // Audio modulates string density slightly (high freqs tighten lattice)
    float lat = 1.0 - smoothstep(uWidth, uWidth * 2.0,
      abs(fract(suv.y * uLatCount * (1.0 + uAudioHigh * 0.2)) - 0.5));
    float lon = 1.0 - smoothstep(uWidth, uWidth * 2.0,
      abs(fract(suv.x * uLonCount * (1.0 + uAudioHigh * 0.2)) - 0.5));
    float diag = (uDiagCount > 0.5)
      ? 1.0 - smoothstep(uWidth, uWidth * 2.0,
          abs(fract((suv.x + suv.y * uSlope + uTime * uFlow) * uDiagCount) - 0.5))
      : 0.0;
    float strings = max(max(lat, lon), diag);

    vec3 tex = texture2D(uTexture, sUVtile).rgb;
    float rim = fresnel(N, rd, 2.2);
    vec3 col = tex * strings * uIntensity
             + uGlowColor * (rim + strings * strings) * uGlow
             + uGlowColor * uAudioBass * 0.4;

    float alpha = max(strings * 0.95, rim * uHorizonFade) + uHorizonFade * 0.05;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`,kl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uMeridians;     // 4-32
  uniform float uParallels;     // 4-32
  uniform float uWidth;         // 0.005-0.04
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform float uHaloGlow;      // 0-2
  uniform vec3 uColor;
  uniform float uHorizonFade;
  uniform float uFillSource;    // 0-1 fill faces with source vs solid color
  uniform float uTileScale;     // 0.5-4
  uniform float uAudioBass;
  uniform float uAudioHigh;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  // Bumped sphere SDF
  float bumpedSphereSDF(vec3 p) {
    vec3 d = normalize(p + 1e-6);
    vec2 uv = sphereUV(d);
    uv = fract(uv * uTileScale);
    float h = luma(texture2D(uTexture, uv).rgb) * uHeight * 0.4;
    return length(p) - (uRadius + h);
  }

  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.003, -0.003);
    return normalize(
      e.xyy * bumpedSphereSDF(p + e.xyy) +
      e.yyx * bumpedSphereSDF(p + e.yyx) +
      e.yxy * bumpedSphereSDF(p + e.yxy) +
      e.xxx * bumpedSphereSDF(p + e.xxx)
    );
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.7));

    mat3 rot = rotY(uTime * uSpin) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 pp = ro + rd * t;
      float d = bumpedSphereSDF(pp);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 6.0) break;
    }

    if (!hit) {
      gl_FragColor = vec4(uColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    vec3 dir = normalize(hitPos);
    vec2 suv = sphereUV(dir);

    // Wireframe lines — drawn on the deformed surface (still using sphere UV)
    float merid = 1.0 - smoothstep(uWidth, uWidth * 1.8,
      abs(fract(suv.x * uMeridians) - 0.5));
    float parll = 1.0 - smoothstep(uWidth, uWidth * 1.8,
      abs(fract(suv.y * uParallels) - 0.5));
    float wire = max(merid, parll);

    // Source fill (sampled at tiled UV)
    vec3 tex = texture2D(uTexture, fract(suv * uTileScale)).rgb;
    vec3 fill = mix(uColor * 0.15, tex * 0.5, uFillSource);

    // Lighting from real normal so bumps actually shade
    vec3 lightDir = normalize(rot * vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    fill *= 0.4 + diff * 0.7;

    // Halo
    float rim = fresnel(N, rd, 2.5);
    vec3 col = mix(fill, uColor, wire * uIntensity)
             + uColor * rim * uHaloGlow
             + uColor * uAudioBass * 0.3;

    float alpha = max(wire, max(rim * uHorizonFade, uFillSource * 0.5));
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`,Ml=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uGridSize;      // 2-8
  uniform float uCubeSize;      // 0.1-0.45
  uniform float uSpacing;       // 0.4-1.2
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uSpin;          // 0-3
  uniform float uTilt;          // 0-1
  uniform float uCamDistance;   // 2-6
  uniform float uSpecular;      // 0-1
  uniform float uAmbient;       // 0-1
  uniform float uHorizonFade;
  uniform vec3 uBgColor;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, uCamDistance);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX((uTilt - 0.5) * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    int grid = int(clamp(uGridSize, 1.0, 8.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    vec3 bestCenter = vec3(0.0);
    float bestLuma = 0.0;
    float spc = uSpacing;
    float halfGrid = float(grid - 1) * 0.5 * spc;

    // Sample cubes uniformly: at each grid cell, sample source colour,
    // displace cube outward by luma * uHeight, then ray-test.
    for (int i = 0; i < 8; i++) {
      if (i >= grid) break;
      for (int j = 0; j < 8; j++) {
        if (j >= grid) break;
        for (int k = 0; k < 8; k++) {
          if (k >= grid) break;
          vec3 cellCenter = vec3(float(i) * spc - halfGrid,
                                 float(j) * spc - halfGrid,
                                 float(k) * spc - halfGrid);
          // Sample source at cell's projected XY
          vec2 sUv = vec2(float(i) / float(grid - 1), float(j) / float(grid - 1));
          vec3 c = texture2D(uTexture, sUv).rgb;
          float l = luma(c);
          // Displace outward from origin proportional to luma
          vec3 dir = normalize(cellCenter + 1e-4);
          vec3 cubePos = cellCenter + dir * l * uHeight * 0.8;
          // Ray-cube test
          vec3 boxRO = ro - cubePos;
          vec3 N;
          float ti = intersectBox(boxRO, rd, vec3(uCubeSize), N);
          if (ti > 0.0 && ti < bestT) {
            bestT = ti;
            bestN = N;
            bestCenter = cubePos;
            bestLuma = l;
          }
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uBgColor, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 localPos = hit - bestCenter;
    // Map face to source UV
    vec2 faceUv;
    vec3 an = abs(bestN);
    if (an.x > 0.5) faceUv = (localPos.zy / uCubeSize) * 0.5 + 0.5;
    else if (an.y > 0.5) faceUv = (localPos.xz / uCubeSize) * 0.5 + 0.5;
    else faceUv = (localPos.xy / uCubeSize) * 0.5 + 0.5;
    vec3 faceCol = texture2D(uTexture, faceUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(bestN, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, bestN), -rd), 0.0), 32.0) * uSpecular;
    vec3 col = faceCol * (uAmbient + diff * 0.85) + vec3(spec);
    col += uBgColor * uAudioBass * 0.2;

    // Distance fade
    float fade = 1.0 - clamp((bestT - uCamDistance + 2.0) / 4.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Dl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMajorR;        // 0.5-1.2
  uniform float uRibbonW;       // 0.1-0.5
  uniform float uTwists;        // 0.5-4
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uLineDensity;   // 4-32 lattice line count
  uniform float uLineWidth;     // 0.005-0.04
  uniform float uIntensity;     // 0-2
  uniform vec3 uLineColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  // Möbius point: R = major radius, w = ribbon half-width
  // u in [0, 2π) along loop, v in [-1, 1] across ribbon
  vec3 mobiusPoint(float u, float v, float R, float w, float twists) {
    float halfTwist = u * twists * 0.5;
    float r = R + v * w * cos(halfTwist);
    return vec3(r * cos(u), v * w * sin(halfTwist), r * sin(u));
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    // Test against an enclosing torus (approximation) — pick coarse points
    // along the ribbon and ray-test as small box hulls. Lower-cost approach.
    float bestT = 1e9;
    vec2 bestSurfUV = vec2(0.0);
    vec3 bestN = vec3(0.0, 1.0, 0.0);

    int loopSteps = 24;
    for (int i = 0; i < 24; i++) {
      float u0 = float(i) / float(loopSteps) * TAU;
      // Test a few v slices per loop point
      for (int j = -1; j <= 1; j++) {
        float v0 = float(j);
        vec3 pt = mobiusPoint(u0, v0, uMajorR, uRibbonW, uTwists);
        vec3 N;
        float ti = intersectBox(ro - pt, rd, vec3(uRibbonW * 0.55), N);
        if (ti > 0.0 && ti < bestT) {
          bestT = ti;
          bestSurfUV = vec2(u0 / TAU, v0 * 0.5 + 0.5);
          bestN = N;
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uLineColor * 0.05, 1.0 - uHorizonFade);
      return;
    }

    vec3 tex = texture2D(uTexture, bestSurfUV).rgb;
    // Lattice lines along U + V
    float linU = 1.0 - smoothstep(uLineWidth, uLineWidth * 1.8,
      abs(fract(bestSurfUV.x * uLineDensity) - 0.5));
    float linV = 1.0 - smoothstep(uLineWidth, uLineWidth * 1.8,
      abs(fract(bestSurfUV.y * uLineDensity * 0.3) - 0.5));
    float lat = max(linU, linV);

    vec3 col = tex * uIntensity + uLineColor * lat + uLineColor * uAudioBass * 0.3;
    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Al=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uShardCount;    // 6-32
  uniform float uShardSize;     // 0.1-0.6
  uniform float uSpread;        // 0.5-2 area shards float in
  uniform float uChromaEdge;    // 0-1
  uniform float uRefraction;    // 0-1
  uniform float uSpin;          // -3..3
  uniform float uIntensity;     // 0-2
  uniform vec3 uTint;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.2);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uShardCount, 4.0, 32.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    vec3 bestPos = vec3(0.0);
    float bestSeed = 0.0;

    for (int i = 0; i < 32; i++) {
      if (i >= n) break;
      float fi = float(i);
      // Random shard position + orientation
      float sx = (hash13(vec3(fi, 0.0, 0.0)) - 0.5) * 2.0 * uSpread;
      float sy = (hash13(vec3(fi, 1.0, 0.0)) - 0.5) * 2.0 * uSpread;
      float sz = (hash13(vec3(fi, 2.0, 0.0)) - 0.5) * 2.0 * uSpread;
      vec3 center = vec3(sx, sy, sz);
      // Drift
      center.y += sin(uTime * 0.3 + fi * 2.7) * 0.1;
      center.x += cos(uTime * 0.4 + fi * 1.7) * 0.1;

      // Rotate ray into shard local frame
      mat3 sRot = rotY(fi * 1.7 + uTime * 0.1) * rotX(fi * 0.7);
      vec3 lro = sRot * (ro - center);
      vec3 lrd = sRot * rd;

      float bs = uShardSize * (0.6 + hash13(vec3(fi, 5.0, 0.0)));
      vec3 N;
      float ti = intersectBox(lro, lrd, vec3(bs, bs * 0.4, bs), N);
      if (ti > 0.0 && ti < bestT) {
        bestT = ti;
        bestN = transpose(sRot) * N; // back to world
        bestPos = ro + rd * ti;
        bestSeed = fi;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTint * 0.04, 1.0 - uHorizonFade);
      return;
    }

    // Refraction sample: project hit position to source UV
    vec2 sUv = vec2(bestPos.x, bestPos.y) * 0.3 + 0.5;
    vec2 refractDir = bestN.xy * uRefraction * 0.06;
    vec3 col;
    if (uChromaEdge > 0.001) {
      col.r = texture2D(uTexture, sUv + refractDir + bestN.xy * uChromaEdge * 0.02).r;
      col.g = texture2D(uTexture, sUv + refractDir).g;
      col.b = texture2D(uTexture, sUv + refractDir - bestN.xy * uChromaEdge * 0.02).b;
    } else {
      col = texture2D(uTexture, clamp(sUv + refractDir, vec2(0.0), vec2(1.0))).rgb;
    }
    col *= uTint;

    // Specular edge
    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float spec = pow(max(dot(reflect(-lightDir, bestN), -rd), 0.0), 16.0);
    col += vec3(spec) * 0.6;
    col *= uIntensity;
    col += uTint * uAudioBass * 0.25;

    float fade = 1.0 - clamp((bestT - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Bl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uTubeCount;     // 3-12
  uniform float uTubeRadius;    // 0.05-0.3
  uniform float uSpread;        // 0.4-2
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uTwist;         // 0-3 spiral twist of tubes
  uniform float uIntensity;     // 0-2
  uniform vec3 uRimColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uTubeCount, 1.0, 12.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    float bestSeed = 0.0;
    vec3 bestHit = vec3(0.0);

    float bassBoost = 1.0 + uAudioBass * 0.4;
    for (int i = 0; i < 12; i++) {
      if (i >= n) break;
      float fi = float(i);
      float ang = fi / float(n) * TAU;
      vec3 offset = vec3(cos(ang), 0.0, sin(ang)) * uSpread;
      // Twist the tube position
      mat3 twistRot = rotZ(uTwist * sin(uTime * 0.2 + fi));
      offset = twistRot * offset;

      vec3 N;
      float ti = intersectCylinderY(ro - offset, rd, uTubeRadius * bassBoost, N);
      if (ti > 0.0 && ti < bestT) {
        // Validate that hit y is within range (clip to ±1)
        vec3 hit = ro + rd * ti;
        if (abs(hit.y - offset.y) > 1.5) continue;
        bestT = ti;
        bestN = N;
        bestSeed = fi;
        bestHit = hit;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uRimColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    // Map hit on tube to barrel UV
    float ang = atan(bestN.z, bestN.x) / TAU + 0.5;
    float yU = bestHit.y * 0.5 + 0.5;
    vec2 sUv = vec2(ang, yU);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    float rim = fresnel(bestN, rd, 1.6);
    vec3 col = tex * uIntensity + uRimColor * rim * 0.7 + uRimColor * uAudioBass * 0.2;
    float fade = 1.0 - clamp((bestT - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Ul=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4
  uniform float uFacetCount;    // 6-32 facet density per axis
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uChaseSpeed;    // 0-3
  uniform float uChaseHueWidth; // 0-1
  uniform float uSparkle;       // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uHighlightColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.7));

    float r = uRadius * (1.0 + uAudioBeatPulse * 0.06);
    float t = intersectSphere(ro, rd, r);
    if (t < 0.0) {
      gl_FragColor = vec4(uHighlightColor * 0.04, 1.0 - uHorizonFade);
      return;
    }
    vec3 pos = ro + rd * t;
    vec3 n = normalize(pos);
    n = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5) * n;
    vec2 suv = sphereUV(n);

    // Quantize UV to facets (mirror tiles)
    vec2 facetSize = vec2(1.0 / uFacetCount, 1.0 / (uFacetCount * 0.5));
    vec2 facetIdx = floor(suv / facetSize);
    vec2 facetCenter = (facetIdx + 0.5) * facetSize;
    vec3 tex = texture2D(uTexture, facetCenter).rgb;

    // Per-facet edge lines (gaps between mirrors)
    vec2 inFacet = fract(suv / facetSize);
    float edge = smoothstep(0.92, 1.0, max(inFacet.x, inFacet.y))
               + smoothstep(0.92, 1.0, max(1.0 - inFacet.x, 1.0 - inFacet.y));
    edge = clamp(edge, 0.0, 1.0);

    // Chase lights: animated hue cycling per facet
    float chase = sin(uTime * uChaseSpeed + facetIdx.x * 1.7 + facetIdx.y * 2.3) * 0.5 + 0.5;
    vec3 chaseTint = hsv2rgb(vec3(fract(uTime * 0.05 + chase * uChaseHueWidth), 0.8, 1.0));
    vec3 col = mix(tex, tex * chaseTint, chase * 0.5);

    // Sparkle: random bright facets
    float sparkle = step(1.0 - uSparkle * 0.3, hash13(vec3(facetIdx, floor(uTime * 4.0))));
    col += uHighlightColor * sparkle * 1.5 * (1.0 + uAudioBass * 1.5);
    col += uHighlightColor * edge * 0.5;
    col *= uIntensity;

    float rim = fresnel(n, rd, 2.5);
    col += uHighlightColor * rim * 0.4;

    float alpha = clamp(1.0 - rim * uHorizonFade * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Pl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRatioX;        // 1-7
  uniform float uRatioY;        // 1-7
  uniform float uRatioZ;        // 1-7
  uniform float uPhaseX;        // 0-1
  uniform float uPhaseY;        // 0-1
  uniform float uTubeRadius;    // 0.04-0.2
  uniform float uScale;         // 0.5-1.5
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uTubeColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  // Lissajous curve point in 3D
  vec3 lissajous(float t, float scale) {
    return vec3(
      sin(uRatioX * t + uPhaseX * TAU),
      sin(uRatioY * t + uPhaseY * TAU),
      sin(uRatioZ * t)
    ) * scale;
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // Walk the curve in N steps; at each, ray-test a sphere tube segment.
    float bestT = 1e9;
    vec3 bestPt = vec3(0.0);
    float bestU = 0.0;
    int steps = 64;
    float r = uTubeRadius * (1.0 + uAudioBeatPulse * 0.1);
    for (int i = 0; i < 64; i++) {
      float ti = float(i) / float(steps - 1) * TAU;
      vec3 pt = lissajous(ti, uScale);
      // Ray-sphere test on each curve point
      float t = intersectSphere(ro - pt, rd, r);
      if (t > 0.0 && t < bestT) {
        bestT = t;
        bestPt = pt;
        bestU = ti / TAU;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTubeColor * 0.05, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 N = normalize(hit - bestPt);

    // Map sample position along curve + tube angle to source UV
    float ang = atan(N.z, N.x) / TAU + 0.5;
    vec2 sUv = vec2(bestU, ang);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    vec3 col = (tex * uIntensity + uTubeColor * 0.3) * (0.4 + diff * 0.7);
    col += uTubeColor * uAudioBass * 0.4;

    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Fl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uHelices;       // 1-6
  uniform float uHelixRadius;   // 0.2-1
  uniform float uTurns;         // 1-6
  uniform float uHeight;        // 1-3
  uniform float uTubeRadius;    // 0.02-0.15
  uniform float uRiseSpeed;     // 0-3
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uTint;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  vec3 helixPoint(float helixIdx, float t, float radius, float turns, float height) {
    float ang = t * turns * TAU + helixIdx * (TAU / max(1.0, uHelices));
    return vec3(cos(ang) * radius, (t - 0.5) * height, sin(ang) * radius);
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uHelices, 1.0, 6.0));
    int steps = 48;
    float bestT = 1e9;
    float bestU = 0.0;
    vec3 bestPt = vec3(0.0);
    float bestHelix = 0.0;
    float r = uTubeRadius * (1.0 + uAudioBeatPulse * 0.15);

    for (int h = 0; h < 6; h++) {
      if (h >= n) break;
      for (int i = 0; i < 48; i++) {
        float ti = float(i) / float(steps - 1);
        // Animated rise: shift t by time
        ti = fract(ti + uTime * uRiseSpeed * 0.05);
        vec3 pt = helixPoint(float(h), ti, uHelixRadius, uTurns, uHeight);
        float t = intersectSphere(ro - pt, rd, r);
        if (t > 0.0 && t < bestT) {
          bestT = t;
          bestU = ti;
          bestPt = pt;
          bestHelix = float(h);
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTint * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 N = normalize(hit - bestPt);
    vec2 sUv = vec2(bestU, bestHelix / max(1.0, uHelices));
    vec3 tex = texture2D(uTexture, sUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    vec3 col = tex * uIntensity * (0.5 + diff * 0.7) + uTint * uAudioBass * 0.3;

    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,Gl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMajorR;        // 0.5-1.4
  uniform float uMinorR;        // 0.05-0.4
  uniform float uStarCount;     // 4-32
  uniform float uStarSize;      // 0.005-0.04
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uTintIntensity; // 0-2
  uniform vec3 uTorusColor;
  uniform vec3 uStarColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${ie}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    vec3 N;
    float r = uMinorR * (1.0 + uAudioBeatPulse * 0.1);
    float t = intersectTorus(ro, rd, uMajorR, r, N);
    if (t < 0.0) {
      // Stars only — render constellation in space, not bound to torus surface
      // Simplified: skip background since we have stars below
      gl_FragColor = vec4(uTorusColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * t;
    // Map torus to UV
    float u = atan(hit.z, hit.x) / TAU + 0.5;
    float v = atan(hit.y, length(hit.xz) - uMajorR) / TAU + 0.5;
    vec2 sUv = vec2(u, v);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    float rim = fresnel(N, rd, 2.5);
    vec3 col = tex * uTintIntensity + uTorusColor * rim * 0.5;

    // Star points: positioned at evenly spaced angles around the torus
    int stars = int(clamp(uStarCount, 4.0, 32.0));
    float bassPulse = 1.0 + uAudioBass * 0.8;
    for (int i = 0; i < 32; i++) {
      if (i >= stars) break;
      float fi = float(i);
      float starAng = fi / float(stars) * TAU + uTime * 0.05;
      vec3 starPos = vec3(cos(starAng) * uMajorR, 0.0, sin(starAng) * uMajorR);
      float dStar = distance(hit, starPos);
      float starMask = smoothstep(uStarSize * bassPulse, 0.0, dStar);
      col += uStarColor * starMask * 1.5;
    }
    col += uTorusColor * uAudioBass * 0.3;

    float fade = 1.0 - clamp((t - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`,zl=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Cell size in pixels: range from 4 to 32 pixels
    float cellPixels = mix(4.0, 32.0, uAmount);
    // Dot radius ratio within subcell: 0.1 to 0.45
    float dotRadius = mix(0.1, 0.45, uAmount2);
    // Color mix: 0 = monochrome, 1 = full source color
    float colorMix = uAmount3;

    vec2 fragCoord = vUv * uResolution;

    // Braille cell is 2 columns x 4 rows of dots
    float cellW = cellPixels;
    float cellH = cellPixels * 2.0; // 4 rows vs 2 cols -> taller cell

    // Which cell are we in
    vec2 cellIndex = floor(fragCoord / vec2(cellW, cellH));
    // Position within cell, normalized 0..1
    vec2 cellPos = fract(fragCoord / vec2(cellW, cellH));

    // Subcell: 2 cols, 4 rows
    vec2 subIndex = floor(cellPos * vec2(2.0, 4.0));
    vec2 subPos = fract(cellPos * vec2(2.0, 4.0));

    // Sample source at center of each subcell
    vec2 subCenterUV = (cellIndex * vec2(cellW, cellH) + (subIndex + 0.5) * vec2(cellW / 2.0, cellH / 4.0)) / uResolution;
    subCenterUV = clamp(subCenterUV, 0.0, 1.0);
    vec4 subSample = texture2D(uTexture, subCenterUV);
    float subLuma = luma(subSample.rgb);

    // Sample source at cell center for overall color
    vec2 cellCenterUV = (cellIndex + 0.5) * vec2(cellW, cellH) / uResolution;
    cellCenterUV = clamp(cellCenterUV, 0.0, 1.0);
    vec4 cellSample = texture2D(uTexture, cellCenterUV);

    // Dot active if luminance exceeds threshold
    float active = step(uThreshold, subLuma);

    // Distance from subcell center
    vec2 d = subPos - 0.5;
    float dist = length(d);

    // Anti-aliased dot
    float pixelSize = 1.0 / (cellW * 0.5); // approximate pixel size in subcell space
    float dot = 1.0 - smoothstep(dotRadius - pixelSize, dotRadius + pixelSize, dist);
    dot *= active;

    // Background color (dark)
    vec3 bgColor = vec3(0.02);
    // Dot color: blend between white and source color
    vec3 dotColor = mix(vec3(1.0), cellSample.rgb, colorMix);
    // Modulate dot brightness by luminance
    dotColor *= mix(0.5, 1.0, subLuma);

    vec3 finalColor = mix(bgColor, dotColor, dot);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Ll=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Grid density: 6 to 60 cells across
    float gridCount = mix(6.0, 60.0, uAmount);
    // Trace thickness in cell-space: 0.02 to 0.2
    float traceThick = mix(0.02, 0.2, uAmount2);
    // Glow intensity
    float glowInt = mix(0.0, 2.0, uAmount3);

    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    float srcLuma = luma(src.rgb);

    vec2 cellSize = vec2(1.0) / gridCount;
    vec2 cellIndex = floor(uv / cellSize);
    vec2 cellPos = fract(uv / cellSize);

    // Hash for this cell determines trace directions
    float h = hash(cellIndex);
    float h2 = hash(cellIndex + 73.0);
    float h3 = hash(cellIndex + 137.0);

    // Sample source at cell center
    vec2 cellCenterUV = (cellIndex + 0.5) * cellSize;
    vec4 cellSrc = texture2D(uTexture, cellCenterUV);
    float cellLuma = luma(cellSrc.rgb);

    // Trace presence based on luminance
    float tracePresence = smoothstep(uThreshold - 0.1, uThreshold + 0.1, cellLuma);

    // Draw traces: horizontal and vertical lines through cell
    float traceMask = 0.0;

    // Horizontal trace
    if (h > 0.3) {
        float dy = abs(cellPos.y - 0.5);
        traceMask = max(traceMask, 1.0 - smoothstep(traceThick * 0.5 - 0.005, traceThick * 0.5 + 0.005, dy));
    }
    // Vertical trace
    if (h2 > 0.3) {
        float dx = abs(cellPos.x - 0.5);
        traceMask = max(traceMask, 1.0 - smoothstep(traceThick * 0.5 - 0.005, traceThick * 0.5 + 0.005, dx));
    }

    // Node/pad at center
    float centerDist = length(cellPos - 0.5);
    float padRadius = traceThick * 1.2;
    float pad = 1.0 - smoothstep(padRadius - 0.01, padRadius + 0.01, centerDist);
    traceMask = max(traceMask, pad);

    // Corner connections: L-shaped turns
    if (h3 > 0.5) {
        float corner1 = abs(cellPos.x - 0.5) + abs(cellPos.y - 0.5);
        // Not a true L-bend, but suggests connectivity with a diagonal reject
    }

    traceMask *= tracePresence;

    // Glow effect: soft distance from traces
    float glowDist = 0.0;
    if (h > 0.3) {
        float dy = abs(cellPos.y - 0.5);
        glowDist = max(glowDist, exp(-dy * 8.0));
    }
    if (h2 > 0.3) {
        float dx = abs(cellPos.x - 0.5);
        glowDist = max(glowDist, exp(-dx * 8.0));
    }
    glowDist *= tracePresence;

    // PCB background color (dark green)
    vec3 pcbBg = vec3(0.0, 0.05, 0.02);
    // Trace color from source
    vec3 traceColor = mix(vec3(0.7, 0.85, 0.3), cellSrc.rgb, 0.5);
    // Glow color
    vec3 glowColor = traceColor * glowInt * 0.3;

    vec3 finalColor = pcbBg;
    finalColor += glowColor * glowDist;
    finalColor = mix(finalColor, traceColor, traceMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Hl=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 hashVec2(vec2 p) {
    return vec2(hash(p), hash(p + vec2(37.0, 91.0)));
}

void main() {
    // Cell count: 5 to 50 across
    float cellCount = mix(5.0, 50.0, uAmount);
    // Lead thickness: 0.01 to 0.15 in cell-space
    float leadThick = mix(0.01, 0.15, uAmount2);
    // Saturation boost: 0 to 1.5
    float satBoost = mix(0.0, 1.5, uAmount3);

    vec2 uv = vUv;
    vec2 scaledUV = uv * cellCount;
    vec2 cellBase = floor(scaledUV);

    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 closestCell = vec2(0.0);

    // Search 3x3 neighborhood
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = cellBase + vec2(float(x), float(y));
            vec2 point = neighbor + hashVec2(neighbor);
            float d = length(scaledUV - point);
            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestCell = neighbor;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    // Edge distance (difference between closest and second closest)
    float edge = secondDist - minDist;

    // Sample source at closest cell center
    vec2 cellCenter = (closestCell + hashVec2(closestCell)) / cellCount;
    cellCenter = clamp(cellCenter, 0.0, 1.0);
    vec4 src = texture2D(uTexture, cellCenter);

    // Boost saturation
    float l = luma(src.rgb);
    vec3 saturated = mix(vec3(l), src.rgb, 1.0 + satBoost);
    saturated = max(saturated, 0.0);

    // Slight brightness boost for stained glass glow
    saturated *= 1.1;

    // Lead border
    float leadMask = 1.0 - smoothstep(leadThick - 0.02, leadThick + 0.02, edge);
    vec3 leadColor = vec3(0.02);

    vec3 finalColor = mix(saturated, leadColor, leadMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Il=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Thread density: 10 to 80 threads across
    float threadCount = mix(10.0, 80.0, uAmount);
    // Thread width ratio within cell: 0.3 to 0.95
    float threadWidth = mix(0.3, 0.95, uAmount2);
    // Shadow depth: 0 to 0.6
    float shadowDepth = mix(0.0, 0.6, uAmount3);

    vec2 uv = vUv;
    vec2 scaled = uv * threadCount;
    vec2 cellIndex = floor(scaled);
    vec2 cellPos = fract(scaled);

    // Determine weave pattern: checkerboard for over/under
    float checker = mod(cellIndex.x + cellIndex.y, 2.0);

    // Thread masks
    float halfWidth = threadWidth * 0.5;

    // Warp thread (vertical): centered horizontally in cell
    float warpDist = abs(cellPos.x - 0.5);
    float warpMask = 1.0 - smoothstep(halfWidth - 0.02, halfWidth + 0.02, warpDist);

    // Weft thread (horizontal): centered vertically in cell
    float weftDist = abs(cellPos.y - 0.5);
    float weftMask = 1.0 - smoothstep(halfWidth - 0.02, halfWidth + 0.02, weftDist);

    // Sample source colors for each thread direction
    vec2 warpUV = vec2((cellIndex.x + 0.5) / threadCount, uv.y);
    vec2 weftUV = vec2(uv.x, (cellIndex.y + 0.5) / threadCount);
    warpUV = clamp(warpUV, 0.0, 1.0);
    weftUV = clamp(weftUV, 0.0, 1.0);

    vec3 warpColor = texture2D(uTexture, warpUV).rgb;
    vec3 weftColor = texture2D(uTexture, weftUV).rgb;

    // Thread shading: rounded cross-section
    float warpShade = 1.0 - warpDist * warpDist * 4.0;
    float weftShade = 1.0 - weftDist * weftDist * 4.0;
    warpShade = clamp(warpShade, 0.3, 1.0);
    weftShade = clamp(weftShade, 0.3, 1.0);

    warpColor *= warpShade;
    weftColor *= weftShade;

    // Over/under logic
    // checker == 0: warp is on top; checker == 1: weft is on top
    vec3 bgColor = vec3(0.03); // dark gap between threads
    vec3 result = bgColor;

    // Shadow on the thread that goes under
    float shadow = 1.0 - shadowDepth;

    if (checker < 0.5) {
        // Warp on top: draw weft first (underneath), then warp
        if (weftMask > 0.0) {
            result = mix(result, weftColor * shadow, weftMask);
        }
        if (warpMask > 0.0) {
            result = mix(result, warpColor, warpMask);
        }
    } else {
        // Weft on top: draw warp first (underneath), then weft
        if (warpMask > 0.0) {
            result = mix(result, warpColor * shadow, warpMask);
        }
        if (weftMask > 0.0) {
            result = mix(result, weftColor, weftMask);
        }
    }

    gl_FragColor = vec4(result, 1.0);
}
`,El=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Tile size: 5 to 60 tiles across
    float tileCount = mix(5.0, 60.0, uAmount);
    // Grout width: 0.01 to 0.15 in tile-space
    float groutWidth = mix(0.01, 0.15, uAmount2);
    // Rotation randomness: 0 to 0.5 radians
    float rotRand = mix(0.0, 0.5, uAmount3);

    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    vec2 scaled = uv * vec2(tileCount * aspect, tileCount);

    // Offset every other row for brick-like pattern
    vec2 cellIndex = floor(scaled);
    float rowOffset = mod(cellIndex.y, 2.0) * 0.5;
    scaled.x += rowOffset;
    cellIndex = floor(scaled);
    vec2 cellPos = fract(scaled);

    // Random rotation per tile
    float angle = (hash(cellIndex) - 0.5) * 2.0 * rotRand;
    float ca = cos(angle);
    float sa = sin(angle);
    vec2 rotatedPos = vec2(
        ca * (cellPos.x - 0.5) - sa * (cellPos.y - 0.5) + 0.5,
        sa * (cellPos.x - 0.5) + ca * (cellPos.y - 0.5) + 0.5
    );

    // Random size variation per tile
    float sizeVar = 0.85 + 0.15 * hash(cellIndex + 41.0);

    // Tile shape: rounded rectangle with slight variation
    vec2 tileDist = abs(rotatedPos - 0.5) / (0.5 * sizeVar);
    // Superellipse-ish distance for more interesting tile shape
    float roundness = 0.08;
    float tileEdge = max(tileDist.x, tileDist.y);
    // Smooth rounded corners
    float cornerDist = length(max(tileDist - vec2(1.0 - roundness), 0.0));
    float tileMask = tileEdge + cornerDist * 0.5;

    // Grout: border region
    float groutHalf = groutWidth * 0.5;
    float groutMask = smoothstep(1.0 - groutHalf - 0.02, 1.0 - groutHalf, tileMask);

    // Sample source at tile center
    vec2 tileCenterScaled = cellIndex + 0.5;
    tileCenterScaled.x -= rowOffset;
    vec2 tileCenterUV = tileCenterScaled / vec2(tileCount * aspect, tileCount);
    tileCenterUV = clamp(tileCenterUV, 0.0, 1.0);
    vec4 src = texture2D(uTexture, tileCenterUV);

    // Slight color variation per tile
    float colorVar = 0.9 + 0.1 * hash(cellIndex + 200.0);
    vec3 tileColor = src.rgb * colorVar;

    // Subtle shading: darken edges of tile
    float edgeShade = 1.0 - tileMask * 0.15;
    tileColor *= edgeShade;

    // Grout color
    vec3 groutColor = vec3(0.12, 0.11, 0.10);

    vec3 finalColor = mix(tileColor, groutColor, groutMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Ol=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sampleLuma(vec2 uv) {
    return luma(texture2D(uTexture, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    // Edge sensitivity: 0.5 to 5.0
    float sensitivity = mix(0.5, 5.0, uAmount);
    // Glow spread: 1 to 8 pixels
    float glowSpread = mix(1.0, 8.0, uAmount2);
    // Glow intensity: 0.5 to 3.0
    float glowIntensity = mix(0.5, 3.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sobel edge detection
    float tl = sampleLuma(uv + vec2(-texel.x, -texel.y));
    float tc = sampleLuma(uv + vec2(0.0,     -texel.y));
    float tr = sampleLuma(uv + vec2( texel.x, -texel.y));
    float ml = sampleLuma(uv + vec2(-texel.x,  0.0));
    float mr = sampleLuma(uv + vec2( texel.x,  0.0));
    float bl = sampleLuma(uv + vec2(-texel.x,  texel.y));
    float bc = sampleLuma(uv + vec2(0.0,      texel.y));
    float br = sampleLuma(uv + vec2( texel.x,  texel.y));

    float sobelX = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float sobelY = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    float edge = length(vec2(sobelX, sobelY)) * sensitivity;
    edge = clamp(edge, 0.0, 1.0);

    // Multi-sample glow: blur the edge for bloom effect
    float glow = 0.0;
    float totalWeight = 0.0;
    for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
            vec2 offset = vec2(float(i), float(j)) * texel * glowSpread;
            vec2 sampleUV = uv + offset;

            // Compute edge at this offset
            float stl = sampleLuma(sampleUV + vec2(-texel.x, -texel.y));
            float stc = sampleLuma(sampleUV + vec2(0.0,     -texel.y));
            float str2 = sampleLuma(sampleUV + vec2( texel.x, -texel.y));
            float sml = sampleLuma(sampleUV + vec2(-texel.x,  0.0));
            float smr = sampleLuma(sampleUV + vec2( texel.x,  0.0));
            float sbl = sampleLuma(sampleUV + vec2(-texel.x,  texel.y));
            float sbc = sampleLuma(sampleUV + vec2(0.0,      texel.y));
            float sbr = sampleLuma(sampleUV + vec2( texel.x,  texel.y));

            float sx = -stl - 2.0*sml - sbl + str2 + 2.0*smr + sbr;
            float sy = -stl - 2.0*stc - str2 + sbl + 2.0*sbc + sbr;
            float se = length(vec2(sx, sy)) * sensitivity;
            se = clamp(se, 0.0, 1.0);

            float w = exp(-float(i*i + j*j) / (glowSpread * glowSpread * 0.5));
            glow += se * w;
            totalWeight += w;
        }
    }
    glow /= totalWeight;

    // Neon color: use uColor as base tint
    vec3 neonBase = length(uColor) > 0.01 ? uColor : vec3(0.2, 0.6, 1.0);
    // Slight hue shift for outer glow
    vec3 neonOuter = neonBase * vec3(1.2, 0.8, 1.0);

    // Dark background
    vec3 bgColor = vec3(0.01);

    // Compose: sharp edge + soft glow
    vec3 finalColor = bgColor;
    finalColor += neonOuter * glow * glowIntensity * 0.5;
    finalColor += neonBase * edge * glowIntensity;

    // White core on strong edges
    float core = smoothstep(0.6, 0.9, edge);
    finalColor += vec3(1.0) * core * 0.5;

    gl_FragColor = vec4(finalColor, 1.0);
}
`,_l=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Sort distance: 0 to 60 pixels
    float sortDist = mix(0.0, 60.0, uAmount);
    // Luminance threshold for which pixels get sorted
    float sortThresh = mix(0.0, 1.0, uAmount2);
    // Chromatic separation: 0 to 5 pixels
    float chromSep = mix(0.0, 5.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sample current pixel
    vec4 src = texture2D(uTexture, uv);
    float srcLuma = luma(src.rgb);

    // Determine if this pixel should participate in sorting
    float sortActive = step(sortThresh, srcLuma);

    // Vertical pixel sorting simulation:
    // Look upward for brighter pixels that would "sort" down to this position
    vec3 sortedR = src.rgb;
    vec3 sortedG = src.rgb;
    vec3 sortedB = src.rgb;

    float maxSteps = min(sortDist, 60.0);
    int steps = int(maxSteps);

    // Find the brightest pixel above that exceeds threshold
    float bestLuma = srcLuma;
    vec3 bestColor = src.rgb;

    for (int i = 1; i <= 60; i++) {
        if (float(i) > maxSteps) break;

        float fi = float(i);
        vec2 upUV = uv - vec2(0.0, fi * texel.y);
        if (upUV.y < 0.0) break;

        vec4 upSample = texture2D(uTexture, upUV);
        float upLuma = luma(upSample.rgb);

        // Only sort bright pixels
        if (upLuma > sortThresh && upLuma > bestLuma) {
            bestLuma = upLuma;
            bestColor = upSample.rgb;
        }
    }

    // Blend sorted result based on activity
    float sortStrength = sortActive * smoothstep(sortThresh, sortThresh + 0.1, srcLuma);
    vec3 sorted = mix(src.rgb, bestColor, sortStrength * 0.6);

    // Chromatic separation on sorted pixels
    float chromOffset = chromSep * texel.y * sortStrength;
    float rChannel = texture2D(uTexture, uv - vec2(0.0, chromOffset)).r;
    float gChannel = sorted.g;
    float bChannel = texture2D(uTexture, uv + vec2(0.0, chromOffset)).b;

    // Vertical streak effect: elongate bright areas
    float streak = 0.0;
    for (int i = 1; i <= 60; i++) {
        if (float(i) > maxSteps * 0.5) break;
        vec2 aboveUV = uv - vec2(0.0, float(i) * texel.y);
        if (aboveUV.y < 0.0) break;
        float aboveLuma = luma(texture2D(uTexture, aboveUV).rgb);
        if (aboveLuma > sortThresh) {
            float falloff = 1.0 - float(i) / (maxSteps * 0.5);
            streak = max(streak, aboveLuma * falloff * 0.3);
        }
    }

    vec3 finalColor = vec3(rChannel, gChannel, bChannel);
    finalColor += vec3(streak) * sortStrength;

    // Mix with original based on how much sorting is active
    finalColor = mix(src.rgb, finalColor, sortActive * 0.8 + 0.2);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Vl=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sampleLuma(vec2 uv) {
    return luma(texture2D(uTexture, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    // Detail level: blur radius 0 to 4 pixels
    float detail = mix(0.0, 4.0, 1.0 - uAmount);
    // Groove spacing: 2 to 12 pixels
    float grooveSpacing = mix(2.0, 12.0, uAmount2);
    // Ink intensity: 0.3 to 1.0
    float inkIntensity = mix(0.3, 1.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;
    vec2 fragCoord = uv * uResolution;

    // Pre-blur for detail control
    vec3 blurred = vec3(0.0);
    float blurTotal = 0.0;
    int blurRadius = int(detail);
    for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
            if (abs(i) > blurRadius || abs(j) > blurRadius) continue;
            float w = exp(-float(i*i + j*j) / max(detail * detail * 0.5, 0.1));
            blurred += texture2D(uTexture, uv + vec2(float(i), float(j)) * texel).rgb * w;
            blurTotal += w;
        }
    }
    blurred /= blurTotal;
    float l = luma(blurred);

    // Edge detection for groove direction
    float gx = sampleLuma(uv + vec2(texel.x, 0.0)) - sampleLuma(uv - vec2(texel.x, 0.0));
    float gy = sampleLuma(uv + vec2(0.0, texel.y)) - sampleLuma(uv - vec2(0.0, texel.y));
    float edgeMag = length(vec2(gx, gy));
    float edgeAngle = atan(gy, gx);

    // Groove pattern: lines that follow contour direction
    // Perpendicular to gradient = along the contour
    float contourAngle = edgeAngle + 1.5708; // + PI/2
    vec2 contourDir = vec2(cos(contourAngle), sin(contourAngle));

    // Project fragment position onto contour perpendicular direction
    vec2 grooveDir = vec2(cos(edgeAngle), sin(edgeAngle));
    float groovePhase = dot(fragCoord, grooveDir) / grooveSpacing;
    float grooveLine = abs(fract(groovePhase) - 0.5) * 2.0;

    // In dark areas, more grooves (more ink carved away reveals paper)
    // Actually in linocut: dark = ink, light = carved away (paper)
    // Grooves create texture in mid-tones
    float grooveMask = smoothstep(0.3, 0.5, grooveLine);

    // High contrast conversion
    float paperThresh = uThreshold;
    float inkMask = smoothstep(paperThresh + 0.1, paperThresh - 0.1, l);

    // In mid-tone areas, use groove pattern
    float midMask = 1.0 - abs(l - 0.5) * 2.0;
    midMask = clamp(midMask, 0.0, 1.0);

    // Combine: dark areas solid ink, mid areas grooved, light areas paper
    float finalInk = inkMask;
    // Add groove texture in mid-tones
    finalInk = mix(finalInk, finalInk * grooveMask, midMask * 0.5);

    // Edge enhancement
    float edgeBoost = smoothstep(0.02, 0.15, edgeMag);
    finalInk = max(finalInk, edgeBoost * 0.7);

    // Paper color (warm off-white)
    vec3 paperColor = vec3(0.92, 0.89, 0.82);
    // Ink color (near black)
    vec3 inkColor = vec3(0.05, 0.04, 0.06) * inkIntensity;

    // Add subtle paper texture
    float paperNoise = hash(fragCoord * 0.5) * 0.04;
    paperColor += paperNoise;

    vec3 finalColor = mix(paperColor, inkColor, finalInk);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Wl=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Contour density: 4 to 40 contour levels
    float contourLevels = mix(4.0, 40.0, uAmount);
    // Line thickness: 0.5 to 3.0 pixels
    float lineThick = mix(0.5, 3.0, uAmount2);
    // Color fill amount: 0 = monochrome, 1 = full source color
    float colorFill = uAmount3;

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sample and slightly blur for smoother contours
    vec3 blurred = vec3(0.0);
    float total = 0.0;
    for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
            float w = exp(-float(i*i + j*j) * 0.5);
            blurred += texture2D(uTexture, uv + vec2(float(i), float(j)) * texel).rgb * w;
            total += w;
        }
    }
    blurred /= total;

    float elevation = luma(blurred);
    vec4 src = texture2D(uTexture, uv);

    // Quantize elevation to contour levels
    float quantized = floor(elevation * contourLevels) / contourLevels;
    float nextLevel = (floor(elevation * contourLevels) + 1.0) / contourLevels;

    // Gradient magnitude (slope) for adaptive line thickness
    float ex = luma(texture2D(uTexture, uv + vec2(texel.x, 0.0)).rgb);
    float wx = luma(texture2D(uTexture, uv - vec2(texel.x, 0.0)).rgb);
    float ey = luma(texture2D(uTexture, uv + vec2(0.0, texel.y)).rgb);
    float wy = luma(texture2D(uTexture, uv - vec2(0.0, texel.y)).rgb);
    float slope = length(vec2(ex - wx, ey - wy)) * 0.5 / texel.x;

    // Contour line: where elevation crosses a contour level
    float levelFract = fract(elevation * contourLevels);
    // Distance to nearest contour boundary (0 or 1 in fract space)
    float distToContour = min(levelFract, 1.0 - levelFract);

    // Convert to pixel-space distance (approximate)
    float slopePixels = max(slope, 0.001); // avoid division by zero
    float pixelDist = distToContour / (slopePixels * texel.x) * (1.0 / contourLevels);

    // Line mask with anti-aliasing; thinner on steep slopes
    float adaptiveThick = lineThick / max(slopePixels * 0.01, 0.5);
    adaptiveThick = clamp(adaptiveThick, 0.5, lineThick * 2.0);
    float lineMask = 1.0 - smoothstep(adaptiveThick * 0.5 - 0.5, adaptiveThick * 0.5 + 0.5, pixelDist);

    // Major contour lines (every 5th level) are thicker
    float majorLevel = floor(elevation * contourLevels / 5.0) * 5.0 / contourLevels;
    float majorFract = fract(elevation * contourLevels / 5.0);
    float majorDist = min(majorFract, 1.0 - majorFract);
    float majorPixelDist = majorDist / (slopePixels * texel.x) * (5.0 / contourLevels);
    float majorMask = 1.0 - smoothstep(adaptiveThick - 0.5, adaptiveThick + 0.5, majorPixelDist);
    lineMask = max(lineMask, majorMask);

    // Background: subtle elevation coloring
    // Topo map style: greens at low, yellows mid, browns high
    vec3 topoLow = vec3(0.75, 0.88, 0.70);  // green
    vec3 topoMid = vec3(0.92, 0.88, 0.65);  // yellow
    vec3 topoHigh = vec3(0.78, 0.65, 0.50); // brown

    vec3 topoColor;
    if (elevation < 0.5) {
        topoColor = mix(topoLow, topoMid, elevation * 2.0);
    } else {
        topoColor = mix(topoMid, topoHigh, (elevation - 0.5) * 2.0);
    }

    // Mix topo coloring with source color based on colorFill
    vec3 fillColor = mix(topoColor, src.rgb * 0.8 + topoColor * 0.2, colorFill);

    // Line color: use uColor if provided, else dark brown
    vec3 lineColor = length(uColor) > 0.01 ? uColor : vec3(0.25, 0.18, 0.12);

    vec3 finalColor = mix(fillColor, lineColor, lineMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`,ql=`
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Rounded rectangle SDF
float roundedRect(vec2 p, vec2 halfSize, float radius) {
    vec2 d = abs(p) - halfSize + radius;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
    // LED size: 4 to 40 pixels per LED
    float ledPixels = mix(4.0, 40.0, uAmount);
    // Roundness: 0.0 (square) to 0.45 (very round)
    float roundness = mix(0.0, 0.45, uAmount2);
    // Bloom amount: 0 to 1
    float bloomAmt = uAmount3;

    vec2 fragCoord = vUv * uResolution;

    // LED grid
    vec2 ledIndex = floor(fragCoord / ledPixels);
    vec2 ledPos = fract(fragCoord / ledPixels); // 0..1 within LED cell

    // Sample source at LED center
    vec2 ledCenterUV = (ledIndex + 0.5) * ledPixels / uResolution;
    ledCenterUV = clamp(ledCenterUV, 0.0, 1.0);
    vec4 src = texture2D(uTexture, ledCenterUV);

    // LED outer shape (with gap)
    float gap = 0.08; // gap between LEDs
    vec2 ledHalfSize = vec2(0.5 - gap);
    float ledDist = roundedRect(ledPos - 0.5, ledHalfSize, roundness);
    float ledMask = 1.0 - smoothstep(-0.01, 0.01, ledDist);

    // RGB sub-pixel layout (3 vertical stripes within the LED)
    float subPixelWidth = (1.0 - gap * 2.0) / 3.0;
    float subGap = 0.01;

    // Position within the LED active area
    float localX = ledPos.x - gap;
    float ledWidth = 1.0 - gap * 2.0;

    float rStripe = 0.0;
    float gStripe = 0.0;
    float bStripe = 0.0;

    if (localX > 0.0 && localX < ledWidth) {
        float normalized = localX / ledWidth;
        // R sub-pixel: 0 to 0.333
        rStripe = smoothstep(0.0, subGap, normalized) * (1.0 - smoothstep(0.333 - subGap, 0.333, normalized));
        // G sub-pixel: 0.333 to 0.666
        gStripe = smoothstep(0.333, 0.333 + subGap, normalized) * (1.0 - smoothstep(0.666 - subGap, 0.666, normalized));
        // B sub-pixel: 0.666 to 1.0
        bStripe = smoothstep(0.666, 0.666 + subGap, normalized) * (1.0 - smoothstep(1.0 - subGap, 1.0, normalized));
    }

    // Each sub-pixel shows its respective channel boosted
    vec3 subPixelColor;
    subPixelColor.r = src.r * rStripe * 1.3;
    subPixelColor.g = src.g * gStripe * 1.3;
    subPixelColor.b = src.b * bStripe * 1.3;

    // Also add some base mixed color to avoid pure black between sub-pixels
    vec3 baseLedColor = src.rgb * 0.3;

    vec3 ledColor = (subPixelColor + baseLedColor) * ledMask;

    // Bloom/glow: soft glow around bright LEDs
    float brightness = luma(src.rgb);
    float glowDist = length(ledPos - 0.5);
    float glow = exp(-glowDist * glowDist * 8.0) * brightness * bloomAmt * 0.5;
    vec3 glowColor = src.rgb * glow;

    // Background (very dark, between LEDs)
    vec3 bgColor = vec3(0.01);

    vec3 finalColor = bgColor + ledColor + glowColor;

    // Clamp to prevent overblown highlights
    finalColor = min(finalColor, vec3(1.2));

    gl_FragColor = vec4(finalColor, 1.0);
}
`,Mt=`
  #define PI 3.14159265359

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  vec3 getTrackColor(int idx, vec3 srcColor) {
    if (idx == 0) return vec3(0.0, 1.0, 0.4);
    if (idx == 1) return vec3(0.0, 0.9, 1.0);
    if (idx == 2) return vec3(1.0, 0.0, 0.8);
    if (idx == 3) return vec3(1.0, 0.75, 0.0);
    if (idx == 4) return vec3(1.0, 0.15, 0.15);
    if (idx == 5) return vec3(0.2, 0.4, 1.0);
    if (idx == 6) return vec3(1.0, 1.0, 1.0);
    return srcColor;
  }

  // Simple 7-segment digit
  float seg(vec2 p, vec2 a, vec2 b, float w) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return smoothstep(w, w * 0.3, length(pa - ba * h));
  }

  float digit(vec2 p, int d, float s) {
    float w = s * 0.1;
    float h = s * 0.5;
    float hw = s * 0.22;
    float top = seg(p, vec2(-hw, h), vec2(hw, h), w);
    float tr  = seg(p, vec2(hw, h), vec2(hw, 0.0), w);
    float br  = seg(p, vec2(hw, 0.0), vec2(hw, -h), w);
    float bot = seg(p, vec2(-hw, -h), vec2(hw, -h), w);
    float bl  = seg(p, vec2(-hw, -h), vec2(-hw, 0.0), w);
    float tl  = seg(p, vec2(-hw, 0.0), vec2(-hw, h), w);
    float mid = seg(p, vec2(-hw, 0.0), vec2(hw, 0.0), w);
    if (d==0) return max(max(max(top,tr),max(br,bot)),max(bl,tl));
    if (d==1) return max(tr,br);
    if (d==2) return max(max(max(top,tr),mid),max(bot,bl));
    if (d==3) return max(max(max(top,tr),max(br,bot)),mid);
    if (d==4) return max(max(tl,mid),max(tr,br));
    if (d==5) return max(max(max(top,tl),mid),max(br,bot));
    if (d==6) return max(max(max(top,tl),max(mid,bl)),max(br,bot));
    if (d==7) return max(top,max(tr,br));
    if (d==8) return max(max(max(top,tr),max(br,bot)),max(max(bl,tl),mid));
    if (d==9) return max(max(max(top,tl),max(tr,mid)),max(br,bot));
    return 0.0;
  }

  float drawNum3(vec2 p, int num, float s) {
    int d2 = num / 100;
    int d1 = (num - d2 * 100) / 10;
    int d0 = num - d2 * 100 - d1 * 10;
    float sp = s * 0.6;
    float v = 0.0;
    if (d2 > 0) v = max(v, digit(p + vec2(sp, 0.0), d2, s));
    v = max(v, digit(p, d1, s));
    v = max(v, digit(p - vec2(sp, 0.0), d0, s));
    return v;
  }

  // Check brightness at a grid cell center — 5-tap cross pattern
  float cellBright(vec2 cellIdx, float gridRes, sampler2D tex) {
    vec2 uv = (cellIdx + 0.5) / gridRes;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float halfCell = 0.5 / gridRes;
    float peak = luma(texture2D(tex, uv).rgb);
    peak = max(peak, luma(texture2D(tex, uv + vec2( halfCell,  0.0)).rgb));
    peak = max(peak, luma(texture2D(tex, uv + vec2(-halfCell,  0.0)).rgb));
    peak = max(peak, luma(texture2D(tex, uv + vec2( 0.0,  halfCell)).rgb));
    peak = max(peak, luma(texture2D(tex, uv + vec2( 0.0, -halfCell)).rgb));
    return peak;
  }

  // HSL to RGB conversion for spectrum color mode
  vec3 hsl2rgb(float h, float s, float l) {
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c * 0.5;
    vec3 rgb;
    if (h < 1.0/6.0)      rgb = vec3(c, x, 0.0);
    else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
    else                   rgb = vec3(c, 0.0, x);
    return rgb + m;
  }

  // Is this cell brighter than all 4 cardinal neighbors? (local peak)
  bool isPeak(vec2 cellIdx, float gridRes, float threshold, sampler2D tex) {
    float b = cellBright(cellIdx, gridRes, tex);
    if (b < threshold) return false;
    float n1 = cellBright(cellIdx + vec2(1.0, 0.0), gridRes, tex);
    float n2 = cellBright(cellIdx + vec2(-1.0, 0.0), gridRes, tex);
    float n3 = cellBright(cellIdx + vec2(0.0, 1.0), gridRes, tex);
    float n4 = cellBright(cellIdx + vec2(0.0, -1.0), gridRes, tex);
    return (b >= n1 && b >= n2 && b >= n3 && b >= n4);
  }
`,Yl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uThreshold;
  uniform float uShape;
  uniform float uColor;
  uniform float uThickness;
  uniform float uMinSize;
  uniform float uMaxBlobs;
  uniform float uShowCoords;
  uniform float uShowBBox;
  uniform float uShowCenter;
  uniform float uTrailLength;
  uniform float uGridSize;
  uniform float uMix;
  uniform float uColorMode;
  uniform vec3 uFixedColor;
  uniform float uMarkerSize;
  uniform float uBlendMode;
  varying vec2 vUv;

  ${Mt}

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    vec3 original = src.rgb;
    float aspect = uResolution.x / uResolution.y;
    float gridRes = max(4.0, uGridSize);
    int shapeIdx = int(uShape);
    int colorIdx = int(uColor);
    float pixW = uThickness / uResolution.x;

    // Aggressive threshold curve for point-cloud compatibility.  Point clouds
    // render as sparse bright particles on a black background, so even tiny
    // luminance values should count.  We use a cube-root mapping scaled to
    float effThreshold = uThreshold;

    // Cell size in UV space — blob radius scales with grid cell size so that
    // changing gridSize smoothly rescales the detection from coarse to fine.
    float cellSize = 1.0 / gridRes;

    vec3 overlay = vec3(0.0);

    // Only check nearby cells (7x7 neighborhood around current pixel)
    vec2 myCell = floor(vUv * gridRes);

    for (int dy = -3; dy <= 3; dy++) {
      for (int dx = -3; dx <= 3; dx++) {
        vec2 cIdx = myCell + vec2(float(dx), float(dy));
        if (cIdx.x < 0.0 || cIdx.y < 0.0 || cIdx.x >= gridRes || cIdx.y >= gridRes) continue;

        float brightness = cellBright(cIdx, gridRes, uTexture);
        if (brightness < effThreshold) continue;
        if (!isPeak(cIdx, gridRes, effThreshold, uTexture)) continue;

        vec2 center = (cIdx + 0.5) / gridRes;

        // Blob radius scales with cell size so the grid parameter works
        // smoothly: coarse grid = big markers, fine grid = small markers.
        // Brightness still modulates the size within each cell.
        float blobR = cellSize * mix(0.25, 0.7, brightness) * (0.6 + uThickness * 0.2) * uMarkerSize;
        if (blobR < uMinSize * cellSize) continue;

        // Pulse
        float pulse = 1.0 + 0.1 * sin(uTime * 3.0 + cIdx.x * 3.7 + cIdx.y * 5.3);
        float r = blobR * pulse;

        // Color mode: 0=auto (getTrackColor), 1=fixed (user color), 2=spectrum (rainbow)
        int cm = int(uColorMode);
        vec3 tColor;
        if (cm == 1) {
          tColor = uFixedColor;
        } else if (cm == 2) {
          // Spectrum: map brightness to full rainbow hue
          tColor = hsl2rgb(brightness, 1.0, 0.5);
        } else {
          tColor = getTrackColor(colorIdx, texture2D(uTexture, center).rgb);
        }
        // Boost dim blobs aggressively — point clouds often have very low
        // overall brightness, so we use an inverse-brightness boost: the
        // dimmer the source pixel, the brighter the marker overlay becomes.
        float boostFactor = mix(1.8, 0.9, brightness); // dim→1.8x, bright→0.9x
        tColor *= boostFactor;

        // Aspect-corrected distance
        vec2 diff = vUv - center;
        diff.x *= aspect;
        float dist = length(diff);

        // ── Shape marker (outline) ──
        float markerAlpha = 0.0;

        if (shapeIdx == 0) {
          // Circle outline
          markerAlpha = smoothstep(pixW, 0.0, abs(dist - r));
        }
        else if (shapeIdx == 1) {
          // Square outline
          vec2 ad = abs(diff);
          float boxDist = max(ad.x - r, ad.y - r);
          markerAlpha = smoothstep(pixW, 0.0, abs(boxDist));
        }
        else if (shapeIdx == 2) {
          // Triangle outline (equilateral, pointing up)
          vec2 p = diff;
          float k = 1.732; // sqrt(3)
          float e1 = p.y + r * 0.5;
          float e2 = -0.5 * p.y + k * 0.5 * p.x - r * 0.5;
          float e3 = -0.5 * p.y - k * 0.5 * p.x - r * 0.5;
          float d1 = abs(e1) / 1.0;
          float d2 = abs(e2) / 1.0;
          float d3 = abs(e3) / 1.0;
          float minE = min(min(d1, d2), d3);
          float triOutline = smoothstep(pixW * 1.5, 0.0, minE) * step(dist, r * 2.0);
          markerAlpha = triOutline;
        }
        else if (shapeIdx == 3) {
          // Diamond outline
          float diamondDist = abs(diff.x) + abs(diff.y) - r;
          markerAlpha = smoothstep(pixW, 0.0, abs(diamondDist));
        }
        else {
          // Crosshair
          float armH = smoothstep(pixW * 1.2, 0.0, abs(diff.y)) * step(dist, r * 1.3);
          float armV = smoothstep(pixW * 1.2, 0.0, abs(diff.x)) * step(dist, r * 1.3);
          float ring = smoothstep(pixW, 0.0, abs(dist - r * 0.7));
          markerAlpha = max(max(armH, armV), ring);
        }

        overlay += tColor * markerAlpha;

        // ── Center dot ──
        if (uShowCenter > 0.5) {
          float cd = smoothstep(pixW * 3.0, 0.0, dist);
          overlay += tColor * cd * 0.9;
        }

        // ── Bounding box ──
        if (uShowBBox > 0.5) {
          float bboxR = r * 1.6;
          vec2 bMin = center - vec2(bboxR / aspect, bboxR);
          vec2 bMax = center + vec2(bboxR / aspect, bboxR);
          float inX = step(bMin.x, vUv.x) * step(vUv.x, bMax.x);
          float inY = step(bMin.y, vUv.y) * step(vUv.y, bMax.y);
          float bL = smoothstep(pixW * 0.6, 0.0, abs(vUv.x - bMin.x)) * inY;
          float bR = smoothstep(pixW * 0.6, 0.0, abs(vUv.x - bMax.x)) * inY;
          float bT = smoothstep(pixW * 0.6, 0.0, abs(vUv.y - bMax.y)) * inX;
          float bB = smoothstep(pixW * 0.6, 0.0, abs(vUv.y - bMin.y)) * inX;
          float box = min(max(max(bL, bR), max(bT, bB)), 1.0);
          overlay += tColor * box * 0.5;
        }

        // ── Coordinate numbers ──
        if (uShowCoords > 0.5) {
          float fs = 0.006;
          vec2 textPos = center + vec2(r * 2.0 / aspect, r * 0.5);
          vec2 tp = (vUv - textPos);
          tp.x *= aspect;
          int fakeX = int(mod(cIdx.x * 47.0 + uTime * 12.0, 999.0));
          int fakeY = int(mod(cIdx.y * 31.0 + uTime * 8.0, 999.0));
          float xn = drawNum3(tp, fakeX, fs);
          float yn = drawNum3(tp - vec2(0.0, -fs * 1.8), fakeY, fs);
          overlay += tColor * max(xn, yn) * 0.85;
        }

        // ── Connector lines to neighboring blobs ──
        if (uTrailLength > 0.01) {
          // Line thickness scales with uThickness param — 2x to 8x a single pixel
          float lineW = pixW * mix(2.0, 8.0, (uThickness - 0.5) / 4.5);
          float maxDist = uTrailLength * 0.5;
          for (int cy = -2; cy <= 2; cy++) {
            for (int cx = -2; cx <= 2; cx++) {
              if (cx == 0 && cy == 0) continue;
              // Only check one direction to avoid double-drawing
              if (cy < 0 || (cy == 0 && cx < 0)) continue;
              vec2 oCell = cIdx + vec2(float(cx), float(cy));
              if (oCell.x < 0.0 || oCell.y < 0.0 || oCell.x >= gridRes || oCell.y >= gridRes) continue;
              float oB = cellBright(oCell, gridRes, uTexture);
              if (oB < effThreshold) continue;
              if (!isPeak(oCell, gridRes, effThreshold, uTexture)) continue;

              vec2 oCenter = (oCell + 0.5) / gridRes;
              vec2 ab = oCenter - center;
              float abLen = length(ab * vec2(aspect, 1.0));
              if (abLen > maxDist || abLen < 0.001) continue;

              // Line segment distance
              vec2 pa = vUv - center;
              float t = clamp(dot(pa, ab) / dot(ab, ab), 0.0, 1.0);
              vec2 closest = center + ab * t;
              float ld = length((vUv - closest) * vec2(aspect, 1.0));
              float fade = 1.0 - abLen / maxDist;
              // Dashed
              float dash = step(0.4, fract(t * 8.0 + uTime * 2.0));
              float line = smoothstep(lineW, 0.0, ld) * fade * dash * 0.7;
              overlay += tColor * line;
            }
          }
        }
      }
    }

    // Blend modes: 0=Add, 1=Screen, 2=Multiply, 3=Overlay, 4=Replace
    vec3 blended;
    if (uBlendMode < 0.5) {
      blended = original + overlay; // Add
    } else if (uBlendMode < 1.5) {
      blended = 1.0 - (1.0 - original) * (1.0 - overlay); // Screen
    } else if (uBlendMode < 2.5) {
      blended = original * (1.0 + overlay * 2.0); // Multiply (boosted)
    } else if (uBlendMode < 3.5) {
      // Overlay: dark areas multiply, bright areas screen
      vec3 lo = 2.0 * original * overlay;
      vec3 hi = 1.0 - 2.0 * (1.0 - original) * (1.0 - overlay);
      blended = mix(lo, hi, step(0.5, original));
    } else {
      blended = overlay; // Replace
    }
    vec3 finalColor = mix(original, blended, uMix);
    // Force alpha=1 when overlay is present so overlays show outside transparent areas (3D models, point clouds)
    float overlayPresence = step(0.001, length(overlay));
    float finalAlpha = max(src.a, overlayPresence * uMix);
    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`,Xl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uThreshold;
  uniform float uShape;
  uniform float uColor;
  uniform float uThickness;
  uniform float uMinSize;
  uniform float uMaxBlobs;
  uniform float uShowCoords;
  uniform float uShowBBox;
  uniform float uShowCenter;
  uniform float uTrailLength;
  uniform float uGridSize;
  uniform float uMix;
  varying vec2 vUv;

  ${Mt}

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    vec3 original = src.rgb;
    vec2 texel = 1.0 / uResolution;

    // Sobel edge detection
    float tl = luma(texture2D(uTexture, vUv + vec2(-texel.x, texel.y)).rgb);
    float t  = luma(texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb);
    float tr = luma(texture2D(uTexture, vUv + vec2(texel.x, texel.y)).rgb);
    float l  = luma(texture2D(uTexture, vUv + vec2(-texel.x, 0.0)).rgb);
    float c  = luma(src.rgb);
    float r  = luma(texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb);
    float bl = luma(texture2D(uTexture, vUv + vec2(-texel.x, -texel.y)).rgb);
    float b  = luma(texture2D(uTexture, vUv + vec2(0.0, -texel.y)).rgb);
    float br = luma(texture2D(uTexture, vUv + vec2(texel.x, -texel.y)).rgb);

    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
    float edge = sqrt(gx*gx + gy*gy);

    float contourThick = uThickness * 0.3;
    int levels = int(max(1.0, uMinSize * 20.0));
    float contour = 0.0;
    int style = int(uShape);

    for (int i = 1; i <= 20; i++) {
      if (i > levels) break;
      float levelVal = float(i) / float(levels + 1);
      float dist = abs(c - levelVal);
      float lw = contourThick * texel.x * 0.5;
      if (style == 0) {
        contour = max(contour, smoothstep(lw, 0.0, dist));
      } else if (style == 1) {
        contour = max(contour, step(dist, lw));
      } else {
        float dashPhase = fract(vUv.x * uResolution.x * 0.05 + uTime * 2.0);
        contour = max(contour, smoothstep(lw, 0.0, dist) * step(0.4, dashPhase));
      }
    }

    float edgeLine = smoothstep(uThreshold * 0.5, uThreshold, edge);
    contour = max(contour * 0.8, edgeLine * 0.6);

    int colorIdx = int(uColor);
    vec3 tColor = getTrackColor(colorIdx, src.rgb);
    float glow = uTrailLength;
    vec3 contourColor = tColor * (1.0 + glow * 2.0 * contour);
    float scan = sin(vUv.y * uResolution.y * 0.5 + uTime * 5.0) * 0.5 + 0.5;
    contourColor *= 0.9 + 0.1 * scan;

    float coordOverlay = 0.0;
    if (uShowCoords > 0.5) {
      vec2 gridCell = floor(vUv * 20.0);
      vec2 cellUv = fract(vUv * 20.0);
      float cellLuma = luma(texture2D(uTexture, (gridCell + 0.5) / 20.0).rgb);
      int lumaVal = int(cellLuma * 99.0);
      coordOverlay = drawNum3((cellUv - 0.5) * 0.5, lumaVal, 0.04) * 0.6;
    }

    vec3 ov = contourColor * contour + tColor * coordOverlay;
    vec3 finalColor = mix(original, original + ov, uMix);
    float overlayPresence = step(0.001, contour + coordOverlay);
    float finalAlpha = max(src.a, overlayPresence * uMix);
    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`,Kl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uThreshold;
  uniform float uShape;
  uniform float uColor;
  uniform float uThickness;
  uniform float uMinSize;
  uniform float uMaxBlobs;
  uniform float uShowCoords;
  uniform float uShowBBox;
  uniform float uShowCenter;
  uniform float uTrailLength;
  uniform float uGridSize;
  uniform float uMix;
  varying vec2 vUv;

  ${Mt}

  vec3 inferno(float t) {
    vec3 c0=vec3(0,0,.04), c1=vec3(.35,0,.5), c2=vec3(.85,.2,.15), c3=vec3(1,.85,.1), c4=vec3(1,1,.85);
    if(t<.25) return mix(c0,c1,t*4.);
    if(t<.5)  return mix(c1,c2,(t-.25)*4.);
    if(t<.75) return mix(c2,c3,(t-.5)*4.);
    return mix(c3,c4,(t-.75)*4.);
  }
  vec3 viridis(float t) {
    vec3 c0=vec3(.27,0,.33), c1=vec3(.28,.47,.64), c2=vec3(.13,.72,.55), c3=vec3(.99,.91,.14);
    if(t<.33) return mix(c0,c1,t*3.);
    if(t<.66) return mix(c1,c2,(t-.33)*3.);
    return mix(c2,c3,(t-.66)*3.);
  }
  vec3 heatColor(float t, int pal) {
    t = clamp(t,0.,1.);
    if(pal==0) return inferno(t);
    if(pal==1) return viridis(t);
    if(pal==2) return mix(mix(vec3(.05,0,.53),vec3(.8,.12,.56),t), mix(vec3(.8,.12,.56),vec3(.94,.98,.13),t), t);
    return mix(mix(vec3(0,0,.02),vec3(.7,.1,.45),t), mix(vec3(.7,.1,.45),vec3(1,1,.75),t), t);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    vec3 original = src.rgb;
    float gridRes = max(4.0, uGridSize);
    int paletteIdx = int(uColor);

    vec2 cellIdx = floor(vUv * gridRes);
    vec2 cellCenter = (cellIdx + 0.5) / gridRes;
    float cellB = luma(texture2D(uTexture, cellCenter).rgb);
    float intensity = smoothstep(uThreshold * 0.5, uThreshold + 0.3, cellB);

    int style = int(uShape);
    vec3 heat;
    if(style==0) heat = heatColor(intensity, paletteIdx);
    else if(style==1) heat = heatColor(floor(intensity*8.)/8., paletteIdx);
    else { heat = heatColor(intensity, paletteIdx); heat += hash21(vUv*uResolution+uTime)*0.05; }
    heat *= intensity;

    float gridOv = 0.0;
    if(uShowBBox > 0.5) {
      vec2 cu = fract(vUv * gridRes);
      float lw = uThickness * 0.002;
      gridOv = min(step(cu.x,lw)+step(1.-lw,cu.x)+step(cu.y,lw)+step(1.-lw,cu.y), 1.0) * 0.3;
    }

    float numOv = 0.0;
    if(uShowCoords > 0.5) {
      vec2 cu = fract(vUv * gridRes);
      numOv = drawNum3((cu-vec2(.5,.3))*2., int(cellB*99.), 0.06) * 0.7;
    }

    float peakOv = 0.0;
    if(uShowCenter > 0.5 && intensity > 0.8) {
      vec2 cu = fract(vUv * gridRes) - 0.5;
      peakOv = smoothstep(.003,0., abs(length(cu)-.15));
      peakOv += smoothstep(.003,0., abs(cu.x)) * step(abs(cu.y),.2);
      peakOv += smoothstep(.003,0., abs(cu.y)) * step(abs(cu.x),.2);
      peakOv *= 0.8;
    }

    vec3 tc = heatColor(1.0, paletteIdx);
    vec3 ov = heat + tc * (gridOv + numOv + peakOv);
    vec3 finalColor = mix(original, ov, uMix);
    float overlayPresence = step(0.001, length(ov));
    float finalAlpha = max(src.a, overlayPresence * uMix);
    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`,Nl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 uv = vUv;
    float intensity = uAmount2;
    float t = uTime * uSpeed;

    vec4 color = vec4(0.0);

    if (mode == 0) {
      float linePos = uAmount;
      float dist = uv.x - linePos;
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = vec2(strength * fi * sin(t * 0.3 + fi), 0.0);
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else if (mode == 1) {
      float linePos = uAmount;
      float dist = uv.y - linePos;
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = vec2(0.0, strength * fi * sin(t * 0.3 + fi));
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else if (mode == 2) {
      vec2 center = vec2(uAmount, 0.5);
      vec2 dir = uv - center;
      float dist = length(dir);
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = normalize(dir + vec2(0.001)) * strength * fi;
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else {
      vec2 center = vec2(0.5);
      vec2 d = uv - center;
      float angle = atan(d.y, d.x);
      float dist = length(d);
      float strength = intensity * 0.3;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0 - 0.5;
        float a = angle + fi * strength;
        vec2 p = center + vec2(cos(a), sin(a)) * dist;
        color += texture2D(uTexture, clamp(p, 0.0, 1.0));
      }
      color /= 16.0;
    }

    gl_FragColor = color;
  }
`,jl=`
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    float t = uTime * uSpeed;
    float spread = uAmount2;
    int echoes = int(uAmount * 8.0 + 2.0);
    if (echoes > 10) echoes = 10;

    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 10; i++) {
      if (i >= echoes) break;
      float fi = float(i) / float(echoes - 1);
      float weight = 1.0 - fi * 0.7;
      vec2 offset = vec2(0.0);

      if (mode == 0) {
        offset = vec2(spread * (fi - 0.5) * sin(t * 0.5), spread * 0.1 * sin(t + fi * 3.0));
      } else if (mode == 1) {
        float angle = fi * 6.28 * 0.5 + t * 0.3;
        offset = vec2(cos(angle), sin(angle)) * spread * fi * 0.3;
      } else if (mode == 2) {
        vec2 centered = vUv - 0.5;
        offset = centered * fi * spread * 0.5;
      } else {
        float angle = fi * 6.28 + t * 0.5;
        float radius = fi * spread * 0.2;
        offset = vec2(cos(angle) * radius, sin(angle) * radius);
      }

      color += texture2D(uTexture, clamp(vUv + offset, 0.0, 1.0)) * weight;
      totalWeight += weight;
    }

    gl_FragColor = color / totalWeight;
  }
`,co={gpuFluidSim:"",vignette:Ma,edgeFeather:Da,colorama:Aa,plasma:Ha,invert:Ba,dither:Ua,posterize:Ia,edgeDetect:Ea,outline:Oa,emboss:_a,vhs:Pa,glitch:Fa,rgbShift:Ga,scanlines:za,pixelate:La,blur:ci,sharpen:fi,noise:Ri,kaleidoscope:Mi,mirror:Di,wave:Ai,fisheye:Bi,thermal:Va,nightVision:Wa,brightness:Jr,contrast:Qr,saturation:el,hue:tl,curves:ti,liftGammaGain:oi,exposure:$a,gamma:Za,temperatureTint:Qa,vibrance:Ja,colorBalance:ei,filmGrain:Ti,bloom:Na,chromaticAberration:gi,lensDistortion:Ui,tiltShift:pi,godRays:xi,heatHaze:wi,directionalBlur:vi,zoomBlur:di,radialBlur:mi,halftone:ri,toon:li,kuwahara:ui,oilPaint:ni,watercolor:si,crt:ki,compressionArtifacts:_i,chromaKey:Pi,lumaKey:Fi,differenceKey:Gi,erode:zi,dilate:Li,displacement:Ei,twirl:Hi,pinchBulge:Ii,filmicTonemap:ai,selectiveColor:ii,falseColor:Vi,shadowRecovery:Wi,highlightRolloff:qi,halation:bi,anamorphicStreak:yi,lensDirt:Si,defocusBokeh:hi,diffusionPromist:Ci,ascii:Yi,comicInk:Xi,datamoshLite:ol,scanlineDrift:Ki,tapeDropout:Ni,polarTransform:Oi,rippleCaustics:ji,shockwave:$i,drosteRecursive:Zi,slitScan:Ji,volumetricFogOverlay:Qi,rainFogSnowOverlay:er,particleOverlayFx:tr,glintStarburst:or,embossRelight:ar,dotMatrix:ir,matrixRain:rr,binaryCode:lr,crosshatch:ur,blockMosaic:nr,numberGrid:rl,braillePattern:zl,circuitBoard:Ll,stainedGlass:Hl,wovenFabric:Il,mosaicTile:El,neonOutline:Ol,pixelSort:_l,linocut:Vl,topoMap:Wl,ledWall:ql,explode3D:ll,terrain3D:ul,wrappedTerrain:nl,stringOrb:Rl,sphereWireframe:kl,voxelCubeCluster:Ml,mobiusLattice:Dl,crystalShardField:Al,tubeLattice:Bl,discoMirrorBall:Ul,lissajousKnot:Pl,helixParticleStream:Fl,donutConstellation:Gl,sphereProject:sl,cubeProject:cl,cylinderWrap:fl,torusTunnel:vl,diamondGem:dl,shatter3D:ml,mobiusStrip:pl,voxelDisplace:hl,waveSurface:gl,prismSplit:xl,origamiFold:bl,mirrorRoom:yl,hexGrid:Sl,spiralTile:Cl,shingleStack:Tl,voronoiShatter:wl,tunnelFlight:sr,infiniteMirror:cr,fractalWarp:fr,crystalRefract:vr,feedbackZoom:ja,fluidDistort:dr,wormhole:mr,geometricTile:pr,geometricTilePro:al,motionTrails:hr,echoRepeat:gr,ghostDouble:xr,strobeFlash:br,lightPaint:yr,recursiveEcho:Sr,blobTrack:Yl,blobContour:Xl,blobHeatmap:Kl,timeSmear:Nl,chronophoto:jl,opticalFlowDatamosh:Cr,flowFieldTrails:Tr,reactionDiffusion:wr,neonTubeTrace:Rr,depthParallax:kr,pointCloudDissolve:Mr,pixelSand:Dr,liquidGlass:Ar,hologramScan:Br,laserSlice:Ur,auraField:Pr,smokeDisintegrate:Fr,shimmerCloth:Gr,glitchQuilt:zr,cellularAutomataBurn:Lr,rorschachMirror:Hr,spectralPrismTunnel:Ir,ledVolume:Er,posterTear:Or,paintPeel:_r,audioShockBloom:Vr,vhsFullDeck:Wr,analogFeedbackRack:qr,clubLaserGrid:Yr,mirrorShards:Xr,ghostExposure:Kr,thermalContour:Nr,dreamDiffusion:jr,topoWarp:$r,strobeSequencer:Zr};Bo(Object.keys(co));function $l(u){return Array.isArray(u)&&u.length>=3?new L(Number(u[0])||0,Number(u[1])||0,Number(u[2])||0):new L(1,1,1)}function Zl(u){const i={uTexture:{value:null},uResolution:{value:new P(1920,1080)},uTime:{value:0}};for(const[l,o]of Object.entries(u.defaults))Array.isArray(o)?i[l]={value:$l(o)}:i[l]={value:o};return new q({vertexShader:ge,fragmentShader:u.shader,uniforms:i,transparent:!0,depthTest:!1,depthWrite:!1})}function Jl(u){const i=Tt(u);if(i)return Zl(i);const l=co[u],o={uTexture:{value:null},uResolution:{value:new P(1920,1080)},uTime:{value:0}};switch(u){case"vignette":o.uSize={value:.8},o.uSoftness={value:.4},o.uRoundness={value:.5},o.uShape={value:0},o.uAspect={value:1},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uColorR={value:0},o.uColorG={value:0},o.uColorB={value:0},o.uTintAmount={value:0},o.uBreathing={value:0},o.uBreathSpeed={value:.5};break;case"edgeFeather":o.uTop={value:0},o.uBottom={value:0},o.uLeft={value:0},o.uRight={value:0},o.uSoftness={value:.5},o.uGamma={value:1},o.uMattePreview={value:0};break;case"colorama":o.uPalette={value:0},o.uOffset={value:0},o.uSpeed={value:.2},o.uContrast={value:1},o.uMix={value:1},o.uBands={value:0},o.uAudioReact={value:0},o.uHueShift={value:0},o.uAudio={value:0};break;case"dither":o.uType={value:0},o.uIntensity={value:1},o.uScale={value:1},o.uColorDepth={value:2},o.uPalette={value:0},o.uPixelLock={value:0};break;case"vhs":o.uTracking={value:.5},o.uNoise={value:.3},o.uDistortion={value:.3},o.uColorBleed={value:.5},o.uScanlines={value:.3},o.uHeadSwitch={value:0},o.uTapeWobble={value:0},o.uDropout={value:0},o.uChromaDelay={value:0},o.uTrackingJump={value:0},o.uSaturation={value:1};break;case"glitch":o.uIntensity={value:.5},o.uSpeed={value:1},o.uBlockSize={value:.3},o.uRGBSplit={value:.5},o.uJitter={value:.3},o.uTriggerMode={value:0},o.uBlockHold={value:.3},o.uVerticalSlice={value:0},o.uFreezeBurst={value:0},o.uTearChance={value:0},o.uAudio={value:0};break;case"rgbShift":o.uAmount={value:5},o.uAngle={value:0},o.uMode={value:0},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uPrismSpread={value:0};break;case"scanlines":o.uIntensity={value:.5},o.uCount={value:200},o.uSpeed={value:0},o.uPhosphor={value:0},o.uRollingBar={value:0},o.uCurvature={value:0},o.uInterlace={value:0};break;case"pixelate":o.uSize={value:8},o.uMode={value:0},o.uGridLines={value:0},o.uAnimSpeed={value:0},o.uAnimAmount={value:0};break;case"blur":o.uRadius={value:5},o.uMode={value:1},o.uAngle={value:0},o.uQuality={value:1},o.uEdgeProtect={value:.3},o.uMix={value:1};break;case"sharpen":o.uAmount={value:.5},o.uMode={value:0},o.uRadius={value:2},o.uEdgeProtect={value:.2},o.uClarity={value:0};break;case"directionalBlur":o.uAmount={value:.25},o.uAngle={value:0},o.uSamples={value:16},o.uFalloff={value:.3},o.uCenterBias={value:0},o.uMix={value:1};break;case"zoomBlur":o.uAmount={value:.25},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uSamples={value:16},o.uFalloff={value:.3},o.uChromatic={value:0},o.uMix={value:1};break;case"radialBlur":o.uAmount={value:.25},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uSamples={value:16},o.uFalloff={value:.3},o.uRadiusInner={value:0},o.uRadiusOuter={value:.7},o.uMix={value:1};break;case"oilPaint":o.uRadius={value:4},o.uIntensity={value:12},o.uBrushLength={value:.6},o.uBristle={value:.4},o.uColorPunch={value:.3},o.uHighlight={value:.2},o.uMode={value:0};break;case"watercolor":o.uBleed={value:.5},o.uEdgeDarken={value:.5},o.uPaperTexture={value:.4},o.uPaperScale={value:8},o.uWetness={value:.3},o.uGranulation={value:.2},o.uPaperHue={value:0};break;case"noise":o.uAmount={value:.2},o.uType={value:0},o.uMode={value:0},o.uScale={value:1},o.uMono={value:0},o.uShadowAmt={value:1},o.uMidAmt={value:1},o.uHighAmt={value:1},o.uAnimSpeed={value:1};break;case"kaleidoscope":o.uSegments={value:6},o.uAngle={value:0},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uZoom={value:1},o.uMode={value:0},o.uSpiralAmount={value:0},o.uAnimSpeed={value:0},o.uMix={value:1};break;case"mirror":o.uMode={value:0},o.uPosition={value:.5},o.uOffset={value:.5},o.uFlipSide={value:0},o.uMix={value:1};break;case"plasma":o.uSpeed={value:1},o.uScale={value:5},o.uComplexity={value:3},o.uPalette={value:0},o.uMode={value:0},o.uBlendMode={value:0},o.uMix={value:1},o.uWarpAmount={value:.4},o.uAudioReact={value:0},o.uAudio={value:0};break;case"posterize":o.uLevels={value:8},o.uDitherAmount={value:0},o.uAnimSpeed={value:0},o.uPaletteLock={value:0};break;case"edgeDetect":o.uThreshold={value:.1},o.uThickness={value:1},o.uMode={value:0},o.uInvert={value:0},o.uEdgeR={value:0},o.uEdgeG={value:1},o.uEdgeB={value:1},o.uTintEdges={value:0},o.uGlow={value:0},o.uEdgeOnly={value:0};break;case"outline":o.uThickness={value:2},o.uColor={value:new L(1,1,1)},o.uOnly={value:0},o.uGlow={value:0},o.uPosition={value:2},o.uCrawl={value:0},o.uGlowFalloff={value:1.5},o.uAlphaAware={value:0};break;case"emboss":o.uStrength={value:1},o.uAngle={value:135},o.uHeight={value:.5},o.uHighlightR={value:1},o.uHighlightG={value:1},o.uHighlightB={value:1},o.uShadowR={value:0},o.uShadowG={value:0},o.uShadowB={value:0},o.uNormalMode={value:0},o.uMetallicness={value:0};break;case"wave":o.uAmplitude={value:10},o.uFrequency={value:5},o.uSpeed={value:1},o.uType={value:0},o.uWaveform={value:0},o.uPhase={value:0},o.uSecondaryAmt={value:0},o.uChromaSplit={value:0};break;case"fisheye":o.uStrength={value:.5},o.uRadius={value:1},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uZoom={value:1},o.uMode={value:0},o.uChromaEdge={value:0};break;case"crt":o.uScanlines={value:.5},o.uScanCount={value:480},o.uMask={value:.5},o.uMaskType={value:0},o.uCurvature={value:.3},o.uVignette={value:.4},o.uGlow={value:.5},o.uRollingBar={value:0},o.uChromatic={value:.3};break;case"lensDistortion":o.uAmount={value:.4},o.uMode={value:0},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uCubic={value:0},o.uAnamorphicX={value:1.3},o.uEdgeFade={value:1},o.uChromaFringe={value:0};break;case"chromaKey":o.uKeyR={value:0},o.uKeyG={value:1},o.uKeyB={value:0},o.uTolerance={value:.25},o.uSoftness={value:.15},o.uSpillSuppress={value:.6},o.uMatte={value:0},o.uMode={value:1};break;case"lumaKey":o.uLowCut={value:.4},o.uHighCut={value:.6},o.uInvert={value:0},o.uGamma={value:1},o.uMatte={value:0},o.uPremultiply={value:0};break;case"differenceKey":o.uRefR={value:0},o.uRefG={value:0},o.uRefB={value:0},o.uTolerance={value:.3},o.uSoftness={value:.15},o.uInvert={value:0},o.uMatte={value:0},o.uMode={value:0};break;case"thermal":o.uIntensity={value:1},o.uPalette={value:0},o.uShimmer={value:0},o.uSensorNoise={value:0};break;case"nightVision":o.uIntensity={value:1.5},o.uNoise={value:.3},o.uVignette={value:.5},o.uPhosphor={value:0},o.uBloom={value:.6},o.uScopeMask={value:1},o.uRollingNoise={value:0};break;case"brightness":case"contrast":case"saturation":o.uAmount={value:0};break;case"hue":o.uAmount={value:0};break;case"exposure":o.uExposure={value:0},o.uRollOff={value:0},o.uHighlightProtect={value:0};break;case"gamma":o.uShadows={value:1},o.uMids={value:1},o.uHighlights={value:1},o.uMix={value:1};break;case"vibrance":o.uVibrance={value:.3},o.uSkinProtect={value:.5},o.uHighlightProtect={value:.3},o.uCeiling={value:1};break;case"temperatureTint":o.uTemperature={value:0},o.uTint={value:0},o.uShadowTemp={value:0},o.uHighlightTemp={value:0},o.uSplitTone={value:0},o.uAutoCycle={value:0};break;case"colorBalance":o.uShadowR={value:0},o.uShadowG={value:0},o.uShadowB={value:0},o.uMidR={value:0},o.uMidG={value:0},o.uMidB={value:0},o.uHighR={value:0},o.uHighG={value:0},o.uHighB={value:0},o.uPreserveLuma={value:1},o.uMix={value:1};break;case"curves":o.uContrast={value:.4},o.uToe={value:0},o.uShoulder={value:0},o.uBlackCrush={value:0},o.uMix={value:1};break;case"liftGammaGain":o.uLiftR={value:0},o.uLiftG={value:0},o.uLiftB={value:0},o.uGammaR={value:1},o.uGammaG={value:1},o.uGammaB={value:1},o.uGainR={value:1},o.uGainG={value:1},o.uGainB={value:1},o.uLumaOnly={value:0},o.uMix={value:1};break;case"filmicTonemap":o.uCurve={value:0},o.uExposure={value:1},o.uContrast={value:0},o.uMix={value:1};break;case"selectiveColor":o.uTargetHue={value:0},o.uHueRange={value:.1},o.uFeather={value:.1},o.uMode={value:0},o.uReplaceHue={value:.33},o.uSatBoost={value:0};break;case"halftone":o.uDotSize={value:6},o.uDotShape={value:0},o.uAngleC={value:15},o.uAngleM={value:75},o.uAngleY={value:0},o.uAngleK={value:45},o.uMode={value:0},o.uDriftSpeed={value:0},o.uSpotColor={value:new L(0,0,0)};break;case"toon":o.uSteps={value:4},o.uOutline={value:.6},o.uOutlineColor={value:0},o.uShadowBand={value:.3},o.uRampSoftness={value:0},o.uColorPop={value:.3};break;case"kuwahara":o.uRadius={value:3},o.uEdgeSharpness={value:.3},o.uColorPunch={value:.2};break;case"tiltShift":o.uMode={value:0},o.uFocusY={value:.5},o.uFocusX={value:.5},o.uFocusBand={value:.2},o.uFalloff={value:.3},o.uMaxBlur={value:.5},o.uAngle={value:0},o.uSaturation={value:1.2};break;case"defocusBokeh":o.uRadius={value:12},o.uSamples={value:24},o.uBrightWeight={value:.8},o.uThreshold={value:.7},o.uChromaFringe={value:0},o.uShape={value:0},o.uRotation={value:0},o.uMix={value:1};break;case"chromaticAberration":o.uAmount={value:.4},o.uMode={value:1},o.uAngle={value:0},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uEdgeFalloff={value:.5},o.uMix={value:1};break;case"godRays":o.uIntensity={value:.7},o.uDecay={value:.95},o.uExposure={value:.4},o.uDensity={value:.95},o.uThreshold={value:.7},o.uCenterX={value:.5},o.uCenterY={value:.2},o.uSamples={value:64},o.uTintR={value:1},o.uTintG={value:.95},o.uTintB={value:.85},o.uMix={value:1};break;case"halation":o.uAmount={value:.6},o.uRadius={value:12},o.uThreshold={value:.65},o.uTintR={value:.9},o.uTintG={value:.45},o.uTintB={value:.2},o.uMode={value:0},o.uMix={value:1};break;case"anamorphicStreak":o.uIntensity={value:.6},o.uLength={value:.5},o.uThreshold={value:.7},o.uTintR={value:.6},o.uTintG={value:.75},o.uTintB={value:1},o.uAngle={value:0},o.uSamples={value:32},o.uMix={value:1};break;case"lensDirt":o.uAmount={value:.5},o.uScale={value:8},o.uThreshold={value:.6},o.uTintWarmth={value:.4},o.uScratches={value:.2},o.uSpots={value:.6},o.uMode={value:0},o.uAnimSpeed={value:0};break;case"diffusionPromist":o.uAmount={value:.5},o.uRadius={value:12},o.uThreshold={value:.6},o.uShadowLift={value:.3},o.uHighlightBloom={value:.5},o.uHaze={value:.3},o.uHazeWarmth={value:.5},o.uMix={value:1};break;case"filmGrain":o.uAmount={value:.3},o.uSize={value:1},o.uShadowGrain={value:.7},o.uMidGrain={value:1},o.uHighGrain={value:.5},o.uMono={value:0},o.uStock={value:1},o.uColorJitter={value:0},o.uAnimSpeed={value:1};break;case"heatHaze":o.uAmount={value:.4},o.uScale={value:8},o.uSpeed={value:1},o.uDirectionY={value:.5},o.uTurbulence={value:.5},o.uMode={value:0},o.uFocusY={value:.5},o.uFocusBand={value:.4};break;case"compressionArtifacts":o.uBlockSize={value:8},o.uQuality={value:.4},o.uChromaSubsample={value:.6},o.uBlockNoise={value:.2},o.uMode={value:0},o.uMix={value:1};break;case"erode":o.uRadius={value:2},o.uShape={value:1},o.uChannel={value:0},o.uMix={value:1};break;case"dilate":o.uRadius={value:2},o.uShape={value:1},o.uChannel={value:0},o.uMix={value:1};break;case"displacement":o.uAmount={value:.4},o.uScale={value:6},o.uSpeed={value:1},o.uMode={value:0},o.uTurbulence={value:.5},o.uChromatic={value:0};break;case"twirl":o.uAngle={value:1.5},o.uRadius={value:.5},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uFalloff={value:1.5},o.uAnimSpeed={value:0},o.uMix={value:1};break;case"pinchBulge":o.uAmount={value:.4},o.uRadius={value:.5},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uFalloff={value:1.5},o.uChromatic={value:0},o.uMix={value:1};break;case"polarTransform":o.uMode={value:0},o.uRotation={value:0},o.uZoom={value:1},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uMix={value:1};break;case"falseColor":o.uMode={value:0},o.uMix={value:1},o.uShowOriginal={value:1},o.uMidpoint={value:.5},o.uRange={value:0};break;case"shadowRecovery":o.uAmount={value:.5},o.uThreshold={value:.4},o.uSoftness={value:.3},o.uColorRecovery={value:.3},o.uHighlightProtect={value:.6},o.uMix={value:1};break;case"highlightRolloff":o.uAmount={value:.5},o.uThreshold={value:.7},o.uSoftness={value:.2},o.uPreserveHue={value:.5},o.uMaxValue={value:1},o.uMix={value:1};break;case"bloom":o.uAmount={value:.6},o.uIntensity={value:1},o.uThreshold={value:.6},o.uKnee={value:.4},o.uRadius={value:.5},o.uAnamorphic={value:0},o.uTintR={value:1},o.uTintG={value:1},o.uTintB={value:1};break;case"ascii":o.uCellSize={value:12},o.uContrast={value:1.2},o.uColorMix={value:.3},o.uMode={value:0},o.uInvert={value:0},o.uTintR={value:0},o.uTintG={value:1},o.uTintB={value:.4};break;case"comicInk":o.uInkStrength={value:1.2},o.uInkThreshold={value:.3},o.uPosterize={value:5},o.uHalftoneShadow={value:.4},o.uHalftoneSize={value:6},o.uColorMix={value:.3},o.uInkR={value:0},o.uInkG={value:0},o.uInkB={value:0};break;case"datamoshLite":o.uMode={value:so.datamoshLite},o.uAmount={value:.5},o.uAmount2={value:.3},o.uAmount3={value:.4},o.uThreshold={value:.5},o.uAngle={value:0},o.uCenter={value:new P(.5,.5)},o.uColor={value:new L(.5,.5,.5)};break;case"scanlineDrift":o.uIntensity={value:.5},o.uFrequency={value:80},o.uSpeed={value:1},o.uWaveform={value:0},o.uChromaSplit={value:.3},o.uChunkiness={value:0};break;case"tapeDropout":o.uDensity={value:.4},o.uLength={value:.5},o.uColor={value:0},o.uSpeed={value:1},o.uNoiseAmp={value:.7},o.uMix={value:1};break;case"rippleCaustics":o.uIntensity={value:.6},o.uScale={value:8},o.uSpeed={value:.6},o.uRefraction={value:.4},o.uTintR={value:.6},o.uTintG={value:.85},o.uTintB={value:1},o.uMode={value:0};break;case"shockwave":o.uTriggerTime={value:0},o.uSpeed={value:.6},o.uAmplitude={value:.06},o.uRingWidth={value:.15},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uChromatic={value:.3},o.uMode={value:0};break;case"drosteRecursive":o.uZoom={value:1.5},o.uRotation={value:5},o.uIterations={value:6},o.uOffsetX={value:.5},o.uOffsetY={value:.5},o.uFrameSize={value:.4},o.uMix={value:1};break;case"slitScan":o.uIntensity={value:.5},o.uMode={value:0},o.uPattern={value:0},o.uSpeed={value:1},o.uChromaSplit={value:0};break;case"volumetricFogOverlay":o.uDensity={value:.5},o.uScale={value:6},o.uSpeed={value:.5},o.uHeightFalloff={value:-.3},o.uDepthSim={value:.5},o.uColorR={value:.85},o.uColorG={value:.9},o.uColorB={value:.95},o.uTurbulence={value:1},o.uMode={value:1};break;case"rainFogSnowOverlay":o.uType={value:0},o.uDensity={value:.5},o.uSpeed={value:1},o.uAngle={value:10},o.uSize={value:1},o.uFogAmount={value:.2},o.uColorR={value:.85},o.uColorG={value:.9},o.uColorB={value:1};break;case"particleOverlayFx":o.uMode={value:0},o.uDensity={value:.4},o.uSize={value:1},o.uSpeed={value:1},o.uTwinkle={value:.5},o.uColorR={value:1},o.uColorG={value:1},o.uColorB={value:.9},o.uBlend={value:0};break;case"glintStarburst":o.uIntensity={value:.7},o.uThreshold={value:.75},o.uLength={value:.4},o.uPoints={value:4},o.uRotation={value:0},o.uColorR={value:1},o.uColorG={value:.95},o.uColorB={value:.85};break;case"embossRelight":o.uStrength={value:1},o.uAngle={value:135},o.uHeight={value:1},o.uDetail={value:1},o.uSpecular={value:.3},o.uColorPreserve={value:.5},o.uAmbient={value:.3};break;case"dotMatrix":o.uDotSize={value:12},o.uDotShape={value:0},o.uGap={value:.2},o.uPosterize={value:4},o.uGlow={value:.4},o.uBgR={value:0},o.uBgG={value:0},o.uBgB={value:0};break;case"matrixRain":o.uDensity={value:.6},o.uSpeed={value:1},o.uCellSize={value:14},o.uTrailLength={value:.5},o.uColorR={value:0},o.uColorG={value:1},o.uColorB={value:.4},o.uBgMix={value:.5};break;case"binaryCode":o.uDensity={value:.7},o.uSpeed={value:.5},o.uCellSize={value:12},o.uColorR={value:0},o.uColorG={value:1},o.uColorB={value:.3},o.uBgMix={value:.5},o.uContrast={value:1};break;case"crosshatch":o.uDensity={value:1},o.uAngle={value:30},o.uLineWidth={value:1},o.uContrast={value:1},o.uPaperR={value:.95},o.uPaperG={value:.93},o.uPaperB={value:.88},o.uInkR={value:.1},o.uInkG={value:.1},o.uInkB={value:.1};break;case"blockMosaic":o.uTileSize={value:24},o.uMode={value:0},o.uGrout={value:.15},o.uColorJitter={value:.1},o.uGroutR={value:.1},o.uGroutG={value:.1},o.uGroutB={value:.1};break;case"terrain3D":o.uMode={value:1},o.uAmount={value:.5},o.uAmount2={value:.5},o.uAmount3={value:.5},o.uThreshold={value:.4},o.uAngle={value:0},o.uCenter={value:new P(.5,.5)},o.uColor={value:new L(.05,.07,.12)},o.uHorizonFade={value:.7},o.uSourceMix={value:0};break;case"wrappedTerrain":o.uShape={value:0},o.uHeight={value:.4},o.uRotateX={value:.5},o.uRotateY={value:.5},o.uAutoRotate={value:.4},o.uCamDistance={value:2.5},o.uSpecular={value:.4},o.uAmbient={value:.3},o.uFogDistance={value:.2},o.uFogColor={value:new L(.05,.07,.12)},o.uHorizonFade={value:.6},o.uSourceMix={value:0},o.uTileScale={value:1};break;case"stringOrb":o.uRadius={value:.85},o.uHeight={value:.4},o.uLatCount={value:16},o.uLonCount={value:24},o.uDiagCount={value:8},o.uSlope={value:1.5},o.uWidth={value:.012},o.uSpin={value:.4},o.uTilt={value:.15},o.uFlow={value:.5},o.uIntensity={value:1},o.uGlow={value:.7},o.uGlowColor={value:new L(.4,.85,1)},o.uHorizonFade={value:.7},o.uTileScale={value:1},o.uAudioBass={value:0},o.uAudioHigh={value:0},o.uAudioBeatPulse={value:0};break;case"sphereWireframe":o.uRadius={value:.85},o.uHeight={value:.4},o.uMeridians={value:16},o.uParallels={value:12},o.uWidth={value:.012},o.uSpin={value:.4},o.uTilt={value:.2},o.uIntensity={value:1.2},o.uHaloGlow={value:.7},o.uColor={value:new L(.5,.9,1)},o.uHorizonFade={value:.7},o.uFillSource={value:.4},o.uTileScale={value:1},o.uAudioBass={value:0},o.uAudioHigh={value:0},o.uAudioBeatPulse={value:0};break;case"voxelCubeCluster":o.uGridSize={value:4},o.uCubeSize={value:.22},o.uSpacing={value:.7},o.uHeight={value:.5},o.uSpin={value:.5},o.uTilt={value:.5},o.uCamDistance={value:4},o.uSpecular={value:.4},o.uAmbient={value:.3},o.uHorizonFade={value:.6},o.uBgColor={value:new L(.04,.05,.08)},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"mobiusLattice":o.uMajorR={value:.85},o.uRibbonW={value:.3},o.uTwists={value:1},o.uSpin={value:.5},o.uTilt={value:.25},o.uLineDensity={value:16},o.uLineWidth={value:.015},o.uIntensity={value:1},o.uLineColor={value:new L(1,.85,.4)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"crystalShardField":o.uShardCount={value:16},o.uShardSize={value:.28},o.uSpread={value:1.2},o.uChromaEdge={value:.4},o.uRefraction={value:.5},o.uSpin={value:.4},o.uIntensity={value:1},o.uTint={value:new L(.85,.95,1)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"tubeLattice":o.uTubeCount={value:6},o.uTubeRadius={value:.15},o.uSpread={value:.9},o.uSpin={value:.4},o.uTilt={value:.3},o.uTwist={value:.5},o.uIntensity={value:1},o.uRimColor={value:new L(0,.95,1)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"discoMirrorBall":o.uRadius={value:1},o.uFacetCount={value:16},o.uSpin={value:.6},o.uTilt={value:.2},o.uChaseSpeed={value:1.2},o.uChaseHueWidth={value:.3},o.uSparkle={value:.5},o.uIntensity={value:1.2},o.uHighlightColor={value:new L(1,1,.85)},o.uHorizonFade={value:.5},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"lissajousKnot":o.uRatioX={value:3},o.uRatioY={value:4},o.uRatioZ={value:5},o.uPhaseX={value:.25},o.uPhaseY={value:0},o.uTubeRadius={value:.08},o.uScale={value:1},o.uSpin={value:.4},o.uTilt={value:.25},o.uIntensity={value:1},o.uTubeColor={value:new L(1,.5,.85)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"helixParticleStream":o.uHelices={value:2},o.uHelixRadius={value:.5},o.uTurns={value:3},o.uHeight={value:2},o.uTubeRadius={value:.06},o.uRiseSpeed={value:1},o.uSpin={value:.3},o.uTilt={value:.2},o.uIntensity={value:1},o.uTint={value:new L(.4,1,.7)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"donutConstellation":o.uMajorR={value:1},o.uMinorR={value:.18},o.uStarCount={value:12},o.uStarSize={value:.025},o.uSpin={value:.4},o.uTilt={value:.4},o.uTintIntensity={value:1},o.uTorusColor={value:new L(.8,.4,1)},o.uStarColor={value:new L(1,1,.85)},o.uHorizonFade={value:.6},o.uAudioBass={value:0},o.uAudioBeatPulse={value:0};break;case"numberGrid":case"explode3D":case"sphereProject":case"cubeProject":case"cylinderWrap":case"torusTunnel":case"diamondGem":case"shatter3D":case"mobiusStrip":case"voxelDisplace":case"waveSurface":case"prismSplit":case"origamiFold":case"mirrorRoom":case"hexGrid":case"spiralTile":case"shingleStack":case"voronoiShatter":case"braillePattern":case"circuitBoard":case"stainedGlass":case"wovenFabric":case"mosaicTile":case"neonOutline":case"pixelSort":case"linocut":case"topoMap":case"ledWall":o.uMode={value:0},o.uAmount={value:.5},o.uAmount2={value:.5},o.uAmount3={value:.5},o.uThreshold={value:.5},o.uAngle={value:0},o.uCenter={value:new P(.5,.5)},o.uColor={value:new L(.5,.5,.5)};break;case"feedbackZoom":o.uTexture={value:null},o.uFeedback={value:null},o.uHasFeedback={value:0},o.uAmount={value:.85},o.uZoom={value:1.04},o.uRotation={value:.02},o.uDecay={value:.04},o.uHueShift={value:0},o.uMaskCenter={value:0};break;case"tunnelFlight":o.uSpeed={value:1},o.uTwist={value:.5},o.uTunnelDepth={value:1.5},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uMode={value:0},o.uChromatic={value:.2};break;case"infiniteMirror":o.uIterations={value:5},o.uShrink={value:.8},o.uRotation={value:5},o.uTintFade={value:.4},o.uHueShift={value:.05},o.uMode={value:0},o.uOffsetX={value:.5},o.uOffsetY={value:.5};break;case"fractalWarp":o.uAmount={value:.5},o.uScale={value:4},o.uOctaves={value:4},o.uSpeed={value:.7},o.uChromatic={value:.2},o.uMode={value:0};break;case"crystalRefract":o.uScale={value:6},o.uRefraction={value:.4},o.uSparkle={value:.4},o.uEdgeGlow={value:.5},o.uTintR={value:.85},o.uTintG={value:.95},o.uTintB={value:1},o.uMode={value:0};break;case"fluidDistort":o.uAmount={value:.5},o.uScale={value:4},o.uSpeed={value:.8},o.uTurbulence={value:.5},o.uMode={value:0};break;case"wormhole":o.uPullStrength={value:.5},o.uRotation={value:1},o.uCenterX={value:.5},o.uCenterY={value:.5},o.uTwist={value:.5},o.uChromatic={value:.3},o.uAnimSpeed={value:.5};break;case"geometricTile":o.uTiles={value:4},o.uMode={value:0},o.uRotation={value:90},o.uOffsetX={value:0},o.uMix={value:1};break;case"geometricTilePro":o.uMode={value:il.geometricTile},o.uTime={value:0},o.uAmount={value:.4},o.uAmount2={value:.5},o.uAmount3={value:.3},o.uThreshold={value:.1},o.uAngle={value:0},o.uCenter={value:new P(.5,.5)},o.uColor={value:new L(.5,.5,.5)};break;case"motionTrails":o.uLength={value:.4},o.uAngle={value:0},o.uSamples={value:16},o.uFalloff={value:.5},o.uChromaSplit={value:.2},o.uMode={value:0};break;case"echoRepeat":o.uCount={value:5},o.uOffsetX={value:.05},o.uOffsetY={value:.05},o.uDecay={value:.7},o.uHueShift={value:.02},o.uMode={value:0};break;case"ghostDouble":o.uOpacity={value:.5},o.uOffsetX={value:.05},o.uOffsetY={value:0},o.uMirror={value:0},o.uTintR={value:1},o.uTintG={value:1},o.uTintB={value:1},o.uBlend={value:0};break;case"strobeFlash":o.uRate={value:4},o.uDuty={value:.5},o.uIntensity={value:1},o.uMode={value:0},o.uTintR={value:1},o.uTintG={value:1},o.uTintB={value:1};break;case"lightPaint":o.uIntensity={value:.7},o.uThreshold={value:.5},o.uTrailLength={value:.4},o.uFlowAngle={value:0},o.uFlowScale={value:6},o.uChromaShift={value:.3},o.uTintR={value:1},o.uTintG={value:.8},o.uTintB={value:.3};break;case"recursiveEcho":o.uDepth={value:5},o.uZoom={value:.95},o.uRotation={value:5},o.uOpacity={value:.6},o.uHueShift={value:.05},o.uOffsetX={value:.02},o.uOffsetY={value:.02},o.uMode={value:0};break;case"invert":o.uMode={value:0},o.uAmount={value:1},o.uThreshold={value:.5},o.uStrobeRate={value:4};break;case"blobTrack":case"blobContour":case"blobHeatmap":o.uThreshold={value:.3},o.uShape={value:0},o.uColor={value:0},o.uThickness={value:2},o.uMinSize={value:.02},o.uMaxBlobs={value:32},o.uShowCoords={value:1},o.uShowBBox={value:1},o.uShowCenter={value:1},o.uTrailLength={value:.3},o.uGridSize={value:16},o.uMix={value:.8},o.uColorMode={value:0},o.uFixedColor={value:new L(0,1,.4)},o.uMarkerSize={value:1},o.uBlendMode={value:0};break;case"timeSmear":case"chronophoto":o.uMode={value:0},o.uAmount={value:.5},o.uAmount2={value:.5},o.uAmount3={value:.7},o.uSpeed={value:1};break;case"opticalFlowDatamosh":o.uIntensity={value:.7},o.uMotionScale={value:1},o.uPersistence={value:.7},o.uChromaSplit={value:.3},o.uBlockSize={value:12},o.uFreeze={value:0},o.uMode={value:0},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"flowFieldTrails":o.uFlowScale={value:4},o.uTrailLength={value:.4},o.uSamples={value:24},o.uSpeed={value:.8},o.uChromaSplit={value:.3},o.uContrast={value:1},o.uMode={value:0},o.uColorCycle={value:0};break;case"reactionDiffusion":o.uFeedRate={value:.055},o.uKillRate={value:.062},o.uDiffusionA={value:1},o.uDiffusionB={value:.5},o.uPatternScale={value:1},o.uLumaMask={value:.5},o.uMode={value:0},o.uColorR={value:.4},o.uColorG={value:.85},o.uColorB={value:1},o.uMix={value:.6},o.uReseed={value:.3},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"neonTubeTrace":o.uEdgeThreshold={value:.15},o.uTubeWidth={value:1.5},o.uGlow={value:1},o.uGlowRadius={value:6},o.uTintR={value:1},o.uTintG={value:.2},o.uTintB={value:.7},o.uChase={value:0},o.uChaseSpeed={value:1},o.uFlicker={value:0},o.uBg={value:2};break;case"depthParallax":o.uDepthStrength={value:.5},o.uPushIn={value:.3},o.uLayers={value:4},o.uChromatic={value:.3},o.uDepthBoost={value:1},o.uMode={value:0},o.uPanX={value:0},o.uPanY={value:0};break;case"pointCloudDissolve":o.uDissolve={value:0},o.uDotSize={value:4},o.uScatterRadius={value:.4},o.uAttract={value:0},o.uTurbulence={value:.3},o.uMode={value:1},o.uBgR={value:0},o.uBgG={value:0},o.uBgB={value:0},o.uHueShift={value:0};break;case"pixelSand":o.uGravity={value:1},o.uTurbulence={value:.3},o.uThreshold={value:.6},o.uPersistence={value:.92},o.uMode={value:0},o.uReplenish={value:.6},o.uChromaSplit={value:0},o.uGrainSize={value:3},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"liquidGlass":o.uBlobs={value:3},o.uBlobSize={value:.18},o.uRefraction={value:.5},o.uChromatic={value:.4},o.uSpecular={value:.5},o.uCausticAmount={value:.3},o.uSpeed={value:.5},o.uTintR={value:.85},o.uTintG={value:.95},o.uTintB={value:1};break;case"hologramScan":o.uIntensity={value:.7},o.uScanFreq={value:200},o.uScanSpeed={value:1},o.uGridSpacing={value:12},o.uRGBFlicker={value:.4},o.uBrokenBands={value:.3},o.uTintR={value:.4},o.uTintG={value:.95},o.uTintB={value:1},o.uOpacityFlicker={value:.3},o.uEdgeGlow={value:.6};break;case"laserSlice":o.uMode={value:0},o.uSpeed={value:1},o.uBeamWidth={value:.02},o.uGlow={value:1.2},o.uSparks={value:.4},o.uEraseAmount={value:.5},o.uTintR={value:1},o.uTintG={value:.1},o.uTintB={value:.1},o.uReveal={value:1},o.uPersistence={value:.92},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"auraField":o.uIntensity={value:1},o.uRadius={value:12},o.uEdgeAmount={value:.6},o.uLumaAmount={value:.4},o.uAudioReact={value:.5},o.uHueShift={value:0},o.uTintR={value:.6},o.uTintG={value:.85},o.uTintB={value:1},o.uMode={value:1};break;case"smokeDisintegrate":o.uAmount={value:.4},o.uScale={value:4},o.uSpeed={value:1},o.uDirection={value:90},o.uEdgeFade={value:.5},o.uSmokeColorR={value:.85},o.uSmokeColorG={value:.85},o.uSmokeColorB={value:.9},o.uMode={value:0};break;case"shimmerCloth":o.uAmplitude={value:.3},o.uFrequency={value:8},o.uSpeed={value:.7},o.uThreadDensity={value:60},o.uThreadDepth={value:.5},o.uShimmer={value:.5},o.uMode={value:0};break;case"glitchQuilt":o.uTileSize={value:32},o.uShuffleAmount={value:.4},o.uRotateAmount={value:.3},o.uDelayAmount={value:.3},o.uChromaSplit={value:.3},o.uTriggerRate={value:1},o.uMode={value:0},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"cellularAutomataBurn":o.uCellSize={value:2},o.uBirthThreshold={value:.5},o.uSurvivalLow={value:1.5},o.uSurvivalHigh={value:3.5},o.uColorR={value:1},o.uColorG={value:.5},o.uColorB={value:.1},o.uMode={value:0},o.uMix={value:.7},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"rorschachMirror":o.uMode={value:0},o.uInkAmount={value:.4},o.uFluidEdges={value:.3},o.uTintR={value:.05},o.uTintG={value:.05},o.uTintB={value:.05},o.uBgR={value:.95},o.uBgG={value:.95},o.uBgB={value:.92},o.uMixOriginal={value:0};break;case"spectralPrismTunnel":o.uTunnelDepth={value:1.5},o.uPrismSpread={value:1},o.uRotation={value:1},o.uSpeed={value:1},o.uSlices={value:12},o.uFade={value:.5};break;case"ledVolume":o.uVoxelSize={value:16},o.uDepthPulse={value:.4},o.uDepthSpeed={value:1},o.uPosterize={value:4},o.uGlow={value:.5},o.uPerspective={value:.4},o.uMode={value:1},o.uBgR={value:0},o.uBgG={value:0},o.uBgB={value:0};break;case"posterTear":o.uTearAmount={value:.3},o.uTearAngle={value:35},o.uTearJitter={value:.5},o.uShiftBelow={value:.5},o.uOffsetX={value:.05},o.uOffsetY={value:.02},o.uTearGlow={value:.3},o.uMode={value:0};break;case"paintPeel":o.uAmount={value:.3},o.uScale={value:4},o.uLumaBias={value:.5},o.uCurl={value:.5},o.uShadow={value:.5},o.uBgR={value:.15},o.uBgG={value:.13},o.uBgB={value:.1},o.uMode={value:0};break;case"audioShockBloom":o.uIntensity={value:1},o.uBloomThreshold={value:.6},o.uBloomRadius={value:12},o.uShockSpeed={value:.8},o.uShockAmplitude={value:.05},o.uChromaSplit={value:.4},o.uStrobeAmount={value:.4},o.uTintR={value:1},o.uTintG={value:.95},o.uTintB={value:.85},o.uAudioGate={value:.3};break;case"vhsFullDeck":o.uTracking={value:.5},o.uHeadSwitch={value:.4},o.uChromaBleed={value:.5},o.uDropouts={value:.3},o.uTapeNoise={value:.4},o.uScanlines={value:.4},o.uColorBleed={value:.3},o.uSaturation={value:.85},o.uTrackingJump={value:.1},o.uMode={value:1};break;case"analogFeedbackRack":o.uMix={value:.7},o.uZoom={value:1.02},o.uRotation={value:.005},o.uDecay={value:.04},o.uHueShift={value:.01},o.uMaskCenter={value:0},o.uChromaSplit={value:.2},o.uOffsetX={value:0},o.uOffsetY={value:0},o.uMode={value:0},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"clubLaserGrid":o.uIntensity={value:1},o.uGridDensity={value:12},o.uPerspective={value:.7},o.uSpeed={value:1},o.uIntersectionGlow={value:.7},o.uLineWidth={value:1.5},o.uTintR={value:.2},o.uTintG={value:1},o.uTintB={value:.5},o.uAudioReact={value:.7},o.uMode={value:0};break;case"mirrorShards":o.uShards={value:8},o.uShardSize={value:.2},o.uRotation={value:60},o.uDelayAmount={value:.3},o.uChromatic={value:.3},o.uMode={value:0},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"ghostExposure":o.uExposure={value:.3},o.uDecay={value:.04},o.uHueShiftPerFrame={value:.005},o.uIntensity={value:1},o.uMode={value:0},o.uClamp={value:.85},o.uFeedback={value:null},o.uHasFeedback={value:0};break;case"thermalContour":o.uPalette={value:0},o.uContourCount={value:8},o.uContourWidth={value:.005},o.uContourGlow={value:.5},o.uIntensity={value:1},o.uTrackBlobs={value:.4},o.uMix={value:.85};break;case"dreamDiffusion":o.uBloomAmount={value:1.2},o.uBloomRadius={value:14},o.uHalation={value:.5},o.uChromaticBlur={value:.4},o.uPastelRolloff={value:.6},o.uShadowLift={value:.15},o.uSoftness={value:.4},o.uTintR={value:1.05},o.uTintG={value:1},o.uTintB={value:.95};break;case"topoWarp":o.uContourCount={value:12},o.uContourWidth={value:.008},o.uDisplacement={value:.5},o.uChromaticEdge={value:.3},o.uColorR={value:0},o.uColorG={value:.85},o.uColorB={value:1},o.uShadowRidges={value:.5},o.uMix={value:.85};break;case"strobeSequencer":o.uBPM={value:120},o.uSteps={value:16},o.uPattern={value:21845},o.uMode={value:0},o.uIntensity={value:1},o.uTintR={value:1},o.uTintG={value:1},o.uTintB={value:1},o.uSwing={value:0};break}return new q({vertexShader:ge,fragmentShader:l,uniforms:o,transparent:!0,depthTest:!1,depthWrite:!1})}function Ql(u,i,l,o,r,a=0){const e=u.uniforms,t=i.params;e.uResolution&&e.uResolution.value.set(l,o),e.uTime&&(e.uTime.value=r),e.uAudio&&(e.uAudio.value=Math.max(0,Math.min(1.5,a)));const s=Tt(i.type);if(s){for(const n of s.params){const c=n.param,f=e[c];if(!f)continue;const v=t[c];v!==void 0&&(n.type==="color"?Array.isArray(v)&&v.length>=3&&f.value instanceof L&&f.value.set(Number(v[0])||0,Number(v[1])||0,Number(v[2])||0):typeof v=="number"&&(f.value=v))}return}switch(i.type){case"vignette":e.uSize&&t.vignetteSize!==void 0&&(e.uSize.value=t.vignetteSize),e.uSoftness&&t.vignetteSoftness!==void 0&&(e.uSoftness.value=t.vignetteSoftness),e.uRoundness&&t.vignetteRoundness!==void 0&&(e.uRoundness.value=t.vignetteRoundness),e.uShape&&t.vignetteShape!==void 0&&(e.uShape.value=t.vignetteShape),e.uAspect&&t.vignetteAspect!==void 0&&(e.uAspect.value=t.vignetteAspect),e.uCenterX&&t.vignetteCenterX!==void 0&&(e.uCenterX.value=t.vignetteCenterX),e.uCenterY&&t.vignetteCenterY!==void 0&&(e.uCenterY.value=t.vignetteCenterY),e.uColorR&&t.vignetteColorR!==void 0&&(e.uColorR.value=t.vignetteColorR),e.uColorG&&t.vignetteColorG!==void 0&&(e.uColorG.value=t.vignetteColorG),e.uColorB&&t.vignetteColorB!==void 0&&(e.uColorB.value=t.vignetteColorB),e.uTintAmount&&t.vignetteTintAmount!==void 0&&(e.uTintAmount.value=t.vignetteTintAmount),e.uBreathing&&t.vignetteBreathing!==void 0&&(e.uBreathing.value=t.vignetteBreathing),e.uBreathSpeed&&t.vignetteBreathSpeed!==void 0&&(e.uBreathSpeed.value=t.vignetteBreathSpeed);break;case"edgeFeather":e.uTop&&t.featherTop!==void 0&&(e.uTop.value=t.featherTop),e.uBottom&&t.featherBottom!==void 0&&(e.uBottom.value=t.featherBottom),e.uLeft&&t.featherLeft!==void 0&&(e.uLeft.value=t.featherLeft),e.uRight&&t.featherRight!==void 0&&(e.uRight.value=t.featherRight),e.uSoftness&&t.featherSoftness!==void 0&&(e.uSoftness.value=t.featherSoftness),e.uGamma&&t.featherGamma!==void 0&&(e.uGamma.value=t.featherGamma),e.uMattePreview&&t.featherMattePreview!==void 0&&(e.uMattePreview.value=t.featherMattePreview);break;case"colorama":e.uPalette&&t.coloramaPalette!==void 0&&(e.uPalette.value=t.coloramaPalette),e.uOffset&&t.coloramaOffset!==void 0&&(e.uOffset.value=t.coloramaOffset),e.uSpeed&&t.coloramaSpeed!==void 0&&(e.uSpeed.value=t.coloramaSpeed),e.uContrast&&t.coloramaContrast!==void 0&&(e.uContrast.value=t.coloramaContrast),e.uMix&&t.coloramaMix!==void 0&&(e.uMix.value=t.coloramaMix),e.uBands&&t.coloramaBands!==void 0&&(e.uBands.value=t.coloramaBands),e.uAudioReact&&t.coloramaAudioReact!==void 0&&(e.uAudioReact.value=t.coloramaAudioReact),e.uHueShift&&t.coloramaHueShift!==void 0&&(e.uHueShift.value=t.coloramaHueShift);break;case"dither":e.uType&&t.ditherType!==void 0&&(e.uType.value=t.ditherType),e.uIntensity&&t.ditherIntensity!==void 0&&(e.uIntensity.value=t.ditherIntensity),e.uScale&&t.ditherScale!==void 0&&(e.uScale.value=t.ditherScale),e.uColorDepth&&t.ditherColorDepth!==void 0&&(e.uColorDepth.value=t.ditherColorDepth),e.uPalette&&t.ditherPalette!==void 0&&(e.uPalette.value=t.ditherPalette),e.uPixelLock&&t.ditherPixelLock!==void 0&&(e.uPixelLock.value=t.ditherPixelLock);break;case"vhs":e.uTracking&&t.vhsTracking!==void 0&&(e.uTracking.value=t.vhsTracking),e.uNoise&&t.vhsNoise!==void 0&&(e.uNoise.value=t.vhsNoise),e.uDistortion&&t.vhsDistortion!==void 0&&(e.uDistortion.value=t.vhsDistortion),e.uColorBleed&&t.vhsColorBleed!==void 0&&(e.uColorBleed.value=t.vhsColorBleed),e.uScanlines&&t.vhsScanlines!==void 0&&(e.uScanlines.value=t.vhsScanlines),e.uHeadSwitch&&t.vhsHeadSwitch!==void 0&&(e.uHeadSwitch.value=t.vhsHeadSwitch),e.uTapeWobble&&t.vhsTapeWobble!==void 0&&(e.uTapeWobble.value=t.vhsTapeWobble),e.uDropout&&t.vhsDropout!==void 0&&(e.uDropout.value=t.vhsDropout),e.uChromaDelay&&t.vhsChromaDelay!==void 0&&(e.uChromaDelay.value=t.vhsChromaDelay),e.uTrackingJump&&t.vhsTrackingJump!==void 0&&(e.uTrackingJump.value=t.vhsTrackingJump),e.uSaturation&&t.vhsSaturation!==void 0&&(e.uSaturation.value=t.vhsSaturation);break;case"glitch":e.uIntensity&&t.glitchIntensity!==void 0&&(e.uIntensity.value=t.glitchIntensity),e.uSpeed&&t.glitchSpeed!==void 0&&(e.uSpeed.value=t.glitchSpeed),e.uBlockSize&&t.glitchBlockSize!==void 0&&(e.uBlockSize.value=t.glitchBlockSize),e.uRGBSplit&&t.glitchRGBSplit!==void 0&&(e.uRGBSplit.value=t.glitchRGBSplit),e.uJitter&&t.glitchJitter!==void 0&&(e.uJitter.value=t.glitchJitter),e.uTriggerMode&&t.glitchTriggerMode!==void 0&&(e.uTriggerMode.value=t.glitchTriggerMode),e.uBlockHold&&t.glitchBlockHold!==void 0&&(e.uBlockHold.value=t.glitchBlockHold),e.uVerticalSlice&&t.glitchVerticalSlice!==void 0&&(e.uVerticalSlice.value=t.glitchVerticalSlice),e.uFreezeBurst&&t.glitchFreezeBurst!==void 0&&(e.uFreezeBurst.value=t.glitchFreezeBurst),e.uTearChance&&t.glitchTearChance!==void 0&&(e.uTearChance.value=t.glitchTearChance);break;case"rgbShift":e.uAmount&&t.rgbShiftAmount!==void 0&&(e.uAmount.value=t.rgbShiftAmount),e.uAngle&&t.rgbShiftAngle!==void 0&&(e.uAngle.value=t.rgbShiftAngle),e.uMode&&t.rgbShiftMode!==void 0&&(e.uMode.value=t.rgbShiftMode),e.uCenterX&&t.rgbShiftCenterX!==void 0&&(e.uCenterX.value=t.rgbShiftCenterX),e.uCenterY&&t.rgbShiftCenterY!==void 0&&(e.uCenterY.value=t.rgbShiftCenterY),e.uPrismSpread&&t.rgbShiftPrismSpread!==void 0&&(e.uPrismSpread.value=t.rgbShiftPrismSpread);break;case"scanlines":e.uIntensity&&t.scanlinesIntensity!==void 0&&(e.uIntensity.value=t.scanlinesIntensity),e.uCount&&t.scanlinesCount!==void 0&&(e.uCount.value=t.scanlinesCount),e.uSpeed&&t.scanlinesSpeed!==void 0&&(e.uSpeed.value=t.scanlinesSpeed),e.uPhosphor&&t.scanlinesPhosphor!==void 0&&(e.uPhosphor.value=t.scanlinesPhosphor),e.uRollingBar&&t.scanlinesRollingBar!==void 0&&(e.uRollingBar.value=t.scanlinesRollingBar),e.uCurvature&&t.scanlinesCurvature!==void 0&&(e.uCurvature.value=t.scanlinesCurvature),e.uInterlace&&t.scanlinesInterlace!==void 0&&(e.uInterlace.value=t.scanlinesInterlace);break;case"pixelate":e.uSize&&t.pixelateSize!==void 0&&(e.uSize.value=t.pixelateSize),e.uMode&&t.pixelateMode!==void 0&&(e.uMode.value=t.pixelateMode),e.uGridLines&&t.pixelateGrid!==void 0&&(e.uGridLines.value=t.pixelateGrid),e.uAnimSpeed&&t.pixelateAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.pixelateAnimSpeed),e.uAnimAmount&&t.pixelateAnimAmount!==void 0&&(e.uAnimAmount.value=t.pixelateAnimAmount);break;case"blur":e.uRadius&&t.blurRadius!==void 0&&(e.uRadius.value=t.blurRadius),e.uMode&&t.blurMode!==void 0&&(e.uMode.value=t.blurMode),e.uAngle&&t.blurAngle!==void 0&&(e.uAngle.value=t.blurAngle),e.uQuality&&t.blurQuality!==void 0&&(e.uQuality.value=t.blurQuality),e.uEdgeProtect&&t.blurEdgeProtect!==void 0&&(e.uEdgeProtect.value=t.blurEdgeProtect),e.uMix&&t.blurMix!==void 0&&(e.uMix.value=t.blurMix);break;case"sharpen":e.uAmount&&t.sharpenAmount!==void 0&&(e.uAmount.value=t.sharpenAmount),e.uMode&&t.sharpenMode!==void 0&&(e.uMode.value=t.sharpenMode),e.uRadius&&t.sharpenRadius!==void 0&&(e.uRadius.value=t.sharpenRadius),e.uEdgeProtect&&t.sharpenEdgeProtect!==void 0&&(e.uEdgeProtect.value=t.sharpenEdgeProtect),e.uClarity&&t.sharpenClarity!==void 0&&(e.uClarity.value=t.sharpenClarity);break;case"directionalBlur":e.uAmount&&t.dirBlurAmount!==void 0&&(e.uAmount.value=t.dirBlurAmount),e.uAngle&&t.dirBlurAngle!==void 0&&(e.uAngle.value=t.dirBlurAngle),e.uSamples&&t.dirBlurSamples!==void 0&&(e.uSamples.value=t.dirBlurSamples),e.uFalloff&&t.dirBlurFalloff!==void 0&&(e.uFalloff.value=t.dirBlurFalloff),e.uCenterBias&&t.dirBlurCenterBias!==void 0&&(e.uCenterBias.value=t.dirBlurCenterBias),e.uMix&&t.dirBlurMix!==void 0&&(e.uMix.value=t.dirBlurMix);break;case"zoomBlur":e.uAmount&&t.zoomBlurAmount!==void 0&&(e.uAmount.value=t.zoomBlurAmount),e.uCenterX&&t.zoomBlurCenterX!==void 0&&(e.uCenterX.value=t.zoomBlurCenterX),e.uCenterY&&t.zoomBlurCenterY!==void 0&&(e.uCenterY.value=t.zoomBlurCenterY),e.uSamples&&t.zoomBlurSamples!==void 0&&(e.uSamples.value=t.zoomBlurSamples),e.uFalloff&&t.zoomBlurFalloff!==void 0&&(e.uFalloff.value=t.zoomBlurFalloff),e.uChromatic&&t.zoomBlurChromatic!==void 0&&(e.uChromatic.value=t.zoomBlurChromatic),e.uMix&&t.zoomBlurMix!==void 0&&(e.uMix.value=t.zoomBlurMix);break;case"radialBlur":e.uAmount&&t.radialBlurAmount!==void 0&&(e.uAmount.value=t.radialBlurAmount),e.uCenterX&&t.radialBlurCenterX!==void 0&&(e.uCenterX.value=t.radialBlurCenterX),e.uCenterY&&t.radialBlurCenterY!==void 0&&(e.uCenterY.value=t.radialBlurCenterY),e.uSamples&&t.radialBlurSamples!==void 0&&(e.uSamples.value=t.radialBlurSamples),e.uFalloff&&t.radialBlurFalloff!==void 0&&(e.uFalloff.value=t.radialBlurFalloff),e.uRadiusInner&&t.radialBlurRadiusInner!==void 0&&(e.uRadiusInner.value=t.radialBlurRadiusInner),e.uRadiusOuter&&t.radialBlurRadiusOuter!==void 0&&(e.uRadiusOuter.value=t.radialBlurRadiusOuter),e.uMix&&t.radialBlurMix!==void 0&&(e.uMix.value=t.radialBlurMix);break;case"oilPaint":e.uRadius&&t.oilPaintRadius!==void 0&&(e.uRadius.value=t.oilPaintRadius),e.uIntensity&&t.oilPaintIntensity!==void 0&&(e.uIntensity.value=t.oilPaintIntensity),e.uBrushLength&&t.oilPaintBrushLength!==void 0&&(e.uBrushLength.value=t.oilPaintBrushLength),e.uBristle&&t.oilPaintBristle!==void 0&&(e.uBristle.value=t.oilPaintBristle),e.uColorPunch&&t.oilPaintColorPunch!==void 0&&(e.uColorPunch.value=t.oilPaintColorPunch),e.uHighlight&&t.oilPaintHighlight!==void 0&&(e.uHighlight.value=t.oilPaintHighlight),e.uMode&&t.oilPaintMode!==void 0&&(e.uMode.value=t.oilPaintMode);break;case"watercolor":e.uBleed&&t.watercolorBleed!==void 0&&(e.uBleed.value=t.watercolorBleed),e.uEdgeDarken&&t.watercolorEdgeDarken!==void 0&&(e.uEdgeDarken.value=t.watercolorEdgeDarken),e.uPaperTexture&&t.watercolorPaperTexture!==void 0&&(e.uPaperTexture.value=t.watercolorPaperTexture),e.uPaperScale&&t.watercolorPaperScale!==void 0&&(e.uPaperScale.value=t.watercolorPaperScale),e.uWetness&&t.watercolorWetness!==void 0&&(e.uWetness.value=t.watercolorWetness),e.uGranulation&&t.watercolorGranulation!==void 0&&(e.uGranulation.value=t.watercolorGranulation),e.uPaperHue&&t.watercolorPaperHue!==void 0&&(e.uPaperHue.value=t.watercolorPaperHue);break;case"noise":e.uAmount&&t.noiseAmount!==void 0&&(e.uAmount.value=t.noiseAmount),e.uType&&t.noiseType!==void 0&&(e.uType.value=t.noiseType),e.uMode&&t.noiseMode!==void 0&&(e.uMode.value=t.noiseMode),e.uScale&&t.noiseScale!==void 0&&(e.uScale.value=t.noiseScale),e.uMono&&t.noiseMono!==void 0&&(e.uMono.value=t.noiseMono),e.uShadowAmt&&t.noiseShadow!==void 0&&(e.uShadowAmt.value=t.noiseShadow),e.uMidAmt&&t.noiseMid!==void 0&&(e.uMidAmt.value=t.noiseMid),e.uHighAmt&&t.noiseHigh!==void 0&&(e.uHighAmt.value=t.noiseHigh),e.uAnimSpeed&&t.noiseAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.noiseAnimSpeed);break;case"kaleidoscope":e.uSegments&&t.kaleidoscopeSegments!==void 0&&(e.uSegments.value=t.kaleidoscopeSegments),e.uAngle&&t.kaleidoscopeAngle!==void 0&&(e.uAngle.value=t.kaleidoscopeAngle),e.uCenterX&&t.kaleidoscopeCenterX!==void 0&&(e.uCenterX.value=t.kaleidoscopeCenterX),e.uCenterY&&t.kaleidoscopeCenterY!==void 0&&(e.uCenterY.value=t.kaleidoscopeCenterY),e.uZoom&&t.kaleidoscopeZoom!==void 0&&(e.uZoom.value=t.kaleidoscopeZoom),e.uMode&&t.kaleidoscopeMode!==void 0&&(e.uMode.value=t.kaleidoscopeMode),e.uSpiralAmount&&t.kaleidoscopeSpiral!==void 0&&(e.uSpiralAmount.value=t.kaleidoscopeSpiral),e.uAnimSpeed&&t.kaleidoscopeAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.kaleidoscopeAnimSpeed),e.uMix&&t.kaleidoscopeMix!==void 0&&(e.uMix.value=t.kaleidoscopeMix);break;case"mirror":e.uMode&&t.mirrorMode!==void 0&&(e.uMode.value=t.mirrorMode),e.uPosition&&t.mirrorPosition!==void 0&&(e.uPosition.value=t.mirrorPosition),e.uOffset&&t.mirrorOffset!==void 0&&(e.uOffset.value=t.mirrorOffset),e.uFlipSide&&t.mirrorFlipSide!==void 0&&(e.uFlipSide.value=t.mirrorFlipSide),e.uMix&&t.mirrorMix!==void 0&&(e.uMix.value=t.mirrorMix);break;case"plasma":e.uSpeed&&t.plasmaSpeed!==void 0&&(e.uSpeed.value=t.plasmaSpeed),e.uScale&&t.plasmaScale!==void 0&&(e.uScale.value=t.plasmaScale),e.uComplexity&&t.plasmaComplexity!==void 0&&(e.uComplexity.value=t.plasmaComplexity),e.uPalette&&t.plasmaPalette!==void 0&&(e.uPalette.value=t.plasmaPalette),e.uMode&&t.plasmaMode!==void 0&&(e.uMode.value=t.plasmaMode),e.uBlendMode&&t.plasmaBlendMode!==void 0&&(e.uBlendMode.value=t.plasmaBlendMode),e.uMix&&t.plasmaMix!==void 0&&(e.uMix.value=t.plasmaMix),e.uWarpAmount&&t.plasmaWarpAmount!==void 0&&(e.uWarpAmount.value=t.plasmaWarpAmount),e.uAudioReact&&t.plasmaAudioReact!==void 0&&(e.uAudioReact.value=t.plasmaAudioReact);break;case"posterize":e.uLevels&&t.posterizeLevels!==void 0&&(e.uLevels.value=t.posterizeLevels),e.uDitherAmount&&t.posterizeDither!==void 0&&(e.uDitherAmount.value=t.posterizeDither),e.uAnimSpeed&&t.posterizeAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.posterizeAnimSpeed),e.uPaletteLock&&t.posterizePalette!==void 0&&(e.uPaletteLock.value=t.posterizePalette);break;case"edgeDetect":e.uThreshold&&t.edgeThreshold!==void 0&&(e.uThreshold.value=t.edgeThreshold),e.uThickness&&t.edgeThickness!==void 0&&(e.uThickness.value=t.edgeThickness),e.uMode&&t.edgeMode!==void 0&&(e.uMode.value=t.edgeMode),e.uInvert&&t.edgeInvert!==void 0&&(e.uInvert.value=t.edgeInvert),e.uEdgeR&&t.edgeTintR!==void 0&&(e.uEdgeR.value=t.edgeTintR),e.uEdgeG&&t.edgeTintG!==void 0&&(e.uEdgeG.value=t.edgeTintG),e.uEdgeB&&t.edgeTintB!==void 0&&(e.uEdgeB.value=t.edgeTintB),e.uTintEdges&&t.edgeTintEdges!==void 0&&(e.uTintEdges.value=t.edgeTintEdges),e.uGlow&&t.edgeGlow!==void 0&&(e.uGlow.value=t.edgeGlow),e.uEdgeOnly&&t.edgeOnlyAlpha!==void 0&&(e.uEdgeOnly.value=t.edgeOnlyAlpha);break;case"outline":if(e.uThickness&&t.outlineThickness!==void 0&&(e.uThickness.value=t.outlineThickness),e.uColor&&t.outlineColor!==void 0){const n=t.outlineColor;e.uColor.value.set(n[0]||1,n[1]||1,n[2]||1)}e.uOnly&&t.outlineOnly!==void 0&&(e.uOnly.value=t.outlineOnly),e.uGlow&&t.outlineGlow!==void 0&&(e.uGlow.value=t.outlineGlow),e.uPosition&&t.outlinePosition!==void 0&&(e.uPosition.value=t.outlinePosition),e.uCrawl&&t.outlineCrawl!==void 0&&(e.uCrawl.value=t.outlineCrawl),e.uGlowFalloff&&t.outlineGlowFalloff!==void 0&&(e.uGlowFalloff.value=t.outlineGlowFalloff),e.uAlphaAware&&t.outlineAlphaAware!==void 0&&(e.uAlphaAware.value=t.outlineAlphaAware);break;case"emboss":e.uStrength&&t.embossStrength!==void 0&&(e.uStrength.value=t.embossStrength),e.uAngle&&t.embossAngle!==void 0&&(e.uAngle.value=t.embossAngle),e.uHeight&&t.embossHeight!==void 0&&(e.uHeight.value=t.embossHeight),e.uHighlightR&&t.embossHighlightR!==void 0&&(e.uHighlightR.value=t.embossHighlightR),e.uHighlightG&&t.embossHighlightG!==void 0&&(e.uHighlightG.value=t.embossHighlightG),e.uHighlightB&&t.embossHighlightB!==void 0&&(e.uHighlightB.value=t.embossHighlightB),e.uShadowR&&t.embossShadowR!==void 0&&(e.uShadowR.value=t.embossShadowR),e.uShadowG&&t.embossShadowG!==void 0&&(e.uShadowG.value=t.embossShadowG),e.uShadowB&&t.embossShadowB!==void 0&&(e.uShadowB.value=t.embossShadowB),e.uNormalMode&&t.embossNormalMode!==void 0&&(e.uNormalMode.value=t.embossNormalMode),e.uMetallicness&&t.embossMetallicness!==void 0&&(e.uMetallicness.value=t.embossMetallicness);break;case"halftone":if(e.uDotSize&&t.halftoneDotSize!==void 0&&(e.uDotSize.value=t.halftoneDotSize),e.uDotShape&&t.halftoneDotShape!==void 0&&(e.uDotShape.value=t.halftoneDotShape),e.uAngleC&&t.halftoneAngleC!==void 0&&(e.uAngleC.value=t.halftoneAngleC),e.uAngleM&&t.halftoneAngleM!==void 0&&(e.uAngleM.value=t.halftoneAngleM),e.uAngleY&&t.halftoneAngleY!==void 0&&(e.uAngleY.value=t.halftoneAngleY),e.uAngleK&&t.halftoneAngleK!==void 0&&(e.uAngleK.value=t.halftoneAngleK),e.uMode&&t.halftoneMode!==void 0&&(e.uMode.value=t.halftoneMode),e.uDriftSpeed&&t.halftoneDrift!==void 0&&(e.uDriftSpeed.value=t.halftoneDrift),e.uSpotColor&&t.halftoneSpotColor!==void 0){const n=t.halftoneSpotColor;e.uSpotColor.value.set(n[0]||0,n[1]||0,n[2]||0)}break;case"toon":if(e.uSteps&&t.toonSteps!==void 0&&(e.uSteps.value=t.toonSteps),e.uOutline&&t.toonOutline!==void 0&&(e.uOutline.value=t.toonOutline),e.uOutlineColor&&t.toonOutlineColor!==void 0){const n=t.toonOutlineColor;e.uOutlineColor.value.set(n[0]||0,n[1]||0,n[2]||0)}e.uShadowBand&&t.toonShadowBand!==void 0&&(e.uShadowBand.value=t.toonShadowBand),e.uRampSoftness&&t.toonRampSoftness!==void 0&&(e.uRampSoftness.value=t.toonRampSoftness),e.uColorPop&&t.toonColorPop!==void 0&&(e.uColorPop.value=t.toonColorPop);break;case"kuwahara":e.uRadius&&t.kuwaharaRadius!==void 0&&(e.uRadius.value=t.kuwaharaRadius),e.uEdgeSharpness&&t.kuwaharaEdgeSharpness!==void 0&&(e.uEdgeSharpness.value=t.kuwaharaEdgeSharpness),e.uColorPunch&&t.kuwaharaColorPunch!==void 0&&(e.uColorPunch.value=t.kuwaharaColorPunch);break;case"tiltShift":e.uMode&&t.tiltShiftMode!==void 0&&(e.uMode.value=t.tiltShiftMode),e.uFocusY&&t.tiltShiftFocusY!==void 0&&(e.uFocusY.value=t.tiltShiftFocusY),e.uFocusX&&t.tiltShiftFocusX!==void 0&&(e.uFocusX.value=t.tiltShiftFocusX),e.uFocusBand&&t.tiltShiftFocusBand!==void 0&&(e.uFocusBand.value=t.tiltShiftFocusBand),e.uFalloff&&t.tiltShiftFalloff!==void 0&&(e.uFalloff.value=t.tiltShiftFalloff),e.uMaxBlur&&t.tiltShiftMaxBlur!==void 0&&(e.uMaxBlur.value=t.tiltShiftMaxBlur),e.uAngle&&t.tiltShiftAngle!==void 0&&(e.uAngle.value=t.tiltShiftAngle),e.uSaturation&&t.tiltShiftSaturation!==void 0&&(e.uSaturation.value=t.tiltShiftSaturation);break;case"defocusBokeh":e.uRadius&&t.bokehRadius!==void 0&&(e.uRadius.value=t.bokehRadius),e.uSamples&&t.bokehSamples!==void 0&&(e.uSamples.value=t.bokehSamples),e.uBrightWeight&&t.bokehBrightWeight!==void 0&&(e.uBrightWeight.value=t.bokehBrightWeight),e.uThreshold&&t.bokehThreshold!==void 0&&(e.uThreshold.value=t.bokehThreshold),e.uChromaFringe&&t.bokehChromaFringe!==void 0&&(e.uChromaFringe.value=t.bokehChromaFringe),e.uShape&&t.bokehShape!==void 0&&(e.uShape.value=t.bokehShape),e.uRotation&&t.bokehRotation!==void 0&&(e.uRotation.value=t.bokehRotation),e.uMix&&t.bokehMix!==void 0&&(e.uMix.value=t.bokehMix);break;case"chromaticAberration":e.uAmount&&t.caAmount!==void 0&&(e.uAmount.value=t.caAmount),e.uMode&&t.caMode!==void 0&&(e.uMode.value=t.caMode),e.uAngle&&t.caAngle!==void 0&&(e.uAngle.value=t.caAngle),e.uCenterX&&t.caCenterX!==void 0&&(e.uCenterX.value=t.caCenterX),e.uCenterY&&t.caCenterY!==void 0&&(e.uCenterY.value=t.caCenterY),e.uEdgeFalloff&&t.caEdgeFalloff!==void 0&&(e.uEdgeFalloff.value=t.caEdgeFalloff),e.uMix&&t.caMix!==void 0&&(e.uMix.value=t.caMix);break;case"godRays":e.uIntensity&&t.godRaysIntensity!==void 0&&(e.uIntensity.value=t.godRaysIntensity),e.uDecay&&t.godRaysDecay!==void 0&&(e.uDecay.value=t.godRaysDecay),e.uExposure&&t.godRaysExposure!==void 0&&(e.uExposure.value=t.godRaysExposure),e.uDensity&&t.godRaysDensity!==void 0&&(e.uDensity.value=t.godRaysDensity),e.uThreshold&&t.godRaysThreshold!==void 0&&(e.uThreshold.value=t.godRaysThreshold),e.uCenterX&&t.godRaysCenterX!==void 0&&(e.uCenterX.value=t.godRaysCenterX),e.uCenterY&&t.godRaysCenterY!==void 0&&(e.uCenterY.value=t.godRaysCenterY),e.uSamples&&t.godRaysSamples!==void 0&&(e.uSamples.value=t.godRaysSamples),e.uTintR&&t.godRaysTintR!==void 0&&(e.uTintR.value=t.godRaysTintR),e.uTintG&&t.godRaysTintG!==void 0&&(e.uTintG.value=t.godRaysTintG),e.uTintB&&t.godRaysTintB!==void 0&&(e.uTintB.value=t.godRaysTintB),e.uMix&&t.godRaysMix!==void 0&&(e.uMix.value=t.godRaysMix);break;case"halation":e.uAmount&&t.halationAmount!==void 0&&(e.uAmount.value=t.halationAmount),e.uRadius&&t.halationRadius!==void 0&&(e.uRadius.value=t.halationRadius),e.uThreshold&&t.halationThreshold!==void 0&&(e.uThreshold.value=t.halationThreshold),e.uTintR&&t.halationTintR!==void 0&&(e.uTintR.value=t.halationTintR),e.uTintG&&t.halationTintG!==void 0&&(e.uTintG.value=t.halationTintG),e.uTintB&&t.halationTintB!==void 0&&(e.uTintB.value=t.halationTintB),e.uMode&&t.halationMode!==void 0&&(e.uMode.value=t.halationMode),e.uMix&&t.halationMix!==void 0&&(e.uMix.value=t.halationMix);break;case"anamorphicStreak":e.uIntensity&&t.anaIntensity!==void 0&&(e.uIntensity.value=t.anaIntensity),e.uLength&&t.anaLength!==void 0&&(e.uLength.value=t.anaLength),e.uThreshold&&t.anaThreshold!==void 0&&(e.uThreshold.value=t.anaThreshold),e.uTintR&&t.anaTintR!==void 0&&(e.uTintR.value=t.anaTintR),e.uTintG&&t.anaTintG!==void 0&&(e.uTintG.value=t.anaTintG),e.uTintB&&t.anaTintB!==void 0&&(e.uTintB.value=t.anaTintB),e.uAngle&&t.anaAngle!==void 0&&(e.uAngle.value=t.anaAngle),e.uSamples&&t.anaSamples!==void 0&&(e.uSamples.value=t.anaSamples),e.uMix&&t.anaMix!==void 0&&(e.uMix.value=t.anaMix);break;case"lensDirt":e.uAmount&&t.dirtAmount!==void 0&&(e.uAmount.value=t.dirtAmount),e.uScale&&t.dirtScale!==void 0&&(e.uScale.value=t.dirtScale),e.uThreshold&&t.dirtThreshold!==void 0&&(e.uThreshold.value=t.dirtThreshold),e.uTintWarmth&&t.dirtTintWarmth!==void 0&&(e.uTintWarmth.value=t.dirtTintWarmth),e.uScratches&&t.dirtScratches!==void 0&&(e.uScratches.value=t.dirtScratches),e.uSpots&&t.dirtSpots!==void 0&&(e.uSpots.value=t.dirtSpots),e.uMode&&t.dirtMode!==void 0&&(e.uMode.value=t.dirtMode),e.uAnimSpeed&&t.dirtAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.dirtAnimSpeed);break;case"diffusionPromist":e.uAmount&&t.diffAmount!==void 0&&(e.uAmount.value=t.diffAmount),e.uRadius&&t.diffRadius!==void 0&&(e.uRadius.value=t.diffRadius),e.uThreshold&&t.diffThreshold!==void 0&&(e.uThreshold.value=t.diffThreshold),e.uShadowLift&&t.diffShadowLift!==void 0&&(e.uShadowLift.value=t.diffShadowLift),e.uHighlightBloom&&t.diffHighlightBloom!==void 0&&(e.uHighlightBloom.value=t.diffHighlightBloom),e.uHaze&&t.diffHaze!==void 0&&(e.uHaze.value=t.diffHaze),e.uHazeWarmth&&t.diffHazeWarmth!==void 0&&(e.uHazeWarmth.value=t.diffHazeWarmth),e.uMix&&t.diffMix!==void 0&&(e.uMix.value=t.diffMix);break;case"filmGrain":e.uAmount&&t.grainAmount!==void 0&&(e.uAmount.value=t.grainAmount),e.uSize&&t.grainSize!==void 0&&(e.uSize.value=t.grainSize),e.uShadowGrain&&t.grainShadow!==void 0&&(e.uShadowGrain.value=t.grainShadow),e.uMidGrain&&t.grainMid!==void 0&&(e.uMidGrain.value=t.grainMid),e.uHighGrain&&t.grainHigh!==void 0&&(e.uHighGrain.value=t.grainHigh),e.uMono&&t.grainMono!==void 0&&(e.uMono.value=t.grainMono),e.uStock&&t.grainStock!==void 0&&(e.uStock.value=t.grainStock),e.uColorJitter&&t.grainColorJitter!==void 0&&(e.uColorJitter.value=t.grainColorJitter),e.uAnimSpeed&&t.grainAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.grainAnimSpeed);break;case"heatHaze":e.uAmount&&t.hazeAmount!==void 0&&(e.uAmount.value=t.hazeAmount),e.uScale&&t.hazeScale!==void 0&&(e.uScale.value=t.hazeScale),e.uSpeed&&t.hazeSpeed!==void 0&&(e.uSpeed.value=t.hazeSpeed),e.uDirectionY&&t.hazeDirectionY!==void 0&&(e.uDirectionY.value=t.hazeDirectionY),e.uTurbulence&&t.hazeTurbulence!==void 0&&(e.uTurbulence.value=t.hazeTurbulence),e.uMode&&t.hazeMode!==void 0&&(e.uMode.value=t.hazeMode),e.uFocusY&&t.hazeFocusY!==void 0&&(e.uFocusY.value=t.hazeFocusY),e.uFocusBand&&t.hazeFocusBand!==void 0&&(e.uFocusBand.value=t.hazeFocusBand);break;case"wave":e.uAmplitude&&t.waveAmplitude!==void 0&&(e.uAmplitude.value=t.waveAmplitude),e.uFrequency&&t.waveFrequency!==void 0&&(e.uFrequency.value=t.waveFrequency),e.uSpeed&&t.waveSpeed!==void 0&&(e.uSpeed.value=t.waveSpeed),e.uType&&t.waveType!==void 0&&(e.uType.value=t.waveType),e.uWaveform&&t.waveWaveform!==void 0&&(e.uWaveform.value=t.waveWaveform),e.uPhase&&t.wavePhase!==void 0&&(e.uPhase.value=t.wavePhase),e.uSecondaryAmt&&t.waveSecondary!==void 0&&(e.uSecondaryAmt.value=t.waveSecondary),e.uChromaSplit&&t.waveChromaSplit!==void 0&&(e.uChromaSplit.value=t.waveChromaSplit);break;case"fisheye":e.uStrength&&t.fisheyeStrength!==void 0&&(e.uStrength.value=t.fisheyeStrength),e.uRadius&&t.fisheyeRadius!==void 0&&(e.uRadius.value=t.fisheyeRadius),e.uCenterX&&t.fisheyeCenterX!==void 0&&(e.uCenterX.value=t.fisheyeCenterX),e.uCenterY&&t.fisheyeCenterY!==void 0&&(e.uCenterY.value=t.fisheyeCenterY),e.uZoom&&t.fisheyeZoom!==void 0&&(e.uZoom.value=t.fisheyeZoom),e.uMode&&t.fisheyeMode!==void 0&&(e.uMode.value=t.fisheyeMode),e.uChromaEdge&&t.fisheyeChromaEdge!==void 0&&(e.uChromaEdge.value=t.fisheyeChromaEdge);break;case"crt":e.uScanlines&&t.crtScanlines!==void 0&&(e.uScanlines.value=t.crtScanlines),e.uScanCount&&t.crtScanCount!==void 0&&(e.uScanCount.value=t.crtScanCount),e.uMask&&t.crtMask!==void 0&&(e.uMask.value=t.crtMask),e.uMaskType&&t.crtMaskType!==void 0&&(e.uMaskType.value=t.crtMaskType),e.uCurvature&&t.crtCurvature!==void 0&&(e.uCurvature.value=t.crtCurvature),e.uVignette&&t.crtVignette!==void 0&&(e.uVignette.value=t.crtVignette),e.uGlow&&t.crtGlow!==void 0&&(e.uGlow.value=t.crtGlow),e.uRollingBar&&t.crtRollingBar!==void 0&&(e.uRollingBar.value=t.crtRollingBar),e.uChromatic&&t.crtChromatic!==void 0&&(e.uChromatic.value=t.crtChromatic);break;case"lensDistortion":e.uAmount&&t.lensDistAmount!==void 0&&(e.uAmount.value=t.lensDistAmount),e.uMode&&t.lensDistMode!==void 0&&(e.uMode.value=t.lensDistMode),e.uCenterX&&t.lensDistCenterX!==void 0&&(e.uCenterX.value=t.lensDistCenterX),e.uCenterY&&t.lensDistCenterY!==void 0&&(e.uCenterY.value=t.lensDistCenterY),e.uCubic&&t.lensDistCubic!==void 0&&(e.uCubic.value=t.lensDistCubic),e.uAnamorphicX&&t.lensDistAnamorphicX!==void 0&&(e.uAnamorphicX.value=t.lensDistAnamorphicX),e.uEdgeFade&&t.lensDistEdgeFade!==void 0&&(e.uEdgeFade.value=t.lensDistEdgeFade),e.uChromaFringe&&t.lensDistChromaFringe!==void 0&&(e.uChromaFringe.value=t.lensDistChromaFringe);break;case"chromaKey":e.uKeyR&&t.chromaKeyR!==void 0&&(e.uKeyR.value=t.chromaKeyR),e.uKeyG&&t.chromaKeyG!==void 0&&(e.uKeyG.value=t.chromaKeyG),e.uKeyB&&t.chromaKeyB!==void 0&&(e.uKeyB.value=t.chromaKeyB),e.uTolerance&&t.chromaKeyTolerance!==void 0&&(e.uTolerance.value=t.chromaKeyTolerance),e.uSoftness&&t.chromaKeySoftness!==void 0&&(e.uSoftness.value=t.chromaKeySoftness),e.uSpillSuppress&&t.chromaKeySpill!==void 0&&(e.uSpillSuppress.value=t.chromaKeySpill),e.uMatte&&t.chromaKeyMatte!==void 0&&(e.uMatte.value=t.chromaKeyMatte),e.uMode&&t.chromaKeyMode!==void 0&&(e.uMode.value=t.chromaKeyMode);break;case"lumaKey":e.uLowCut&&t.lumaKeyLowCut!==void 0&&(e.uLowCut.value=t.lumaKeyLowCut),e.uHighCut&&t.lumaKeyHighCut!==void 0&&(e.uHighCut.value=t.lumaKeyHighCut),e.uInvert&&t.lumaKeyInvert!==void 0&&(e.uInvert.value=t.lumaKeyInvert),e.uGamma&&t.lumaKeyGamma!==void 0&&(e.uGamma.value=t.lumaKeyGamma),e.uMatte&&t.lumaKeyMatte!==void 0&&(e.uMatte.value=t.lumaKeyMatte),e.uPremultiply&&t.lumaKeyPremultiply!==void 0&&(e.uPremultiply.value=t.lumaKeyPremultiply);break;case"differenceKey":e.uRefR&&t.diffKeyR!==void 0&&(e.uRefR.value=t.diffKeyR),e.uRefG&&t.diffKeyG!==void 0&&(e.uRefG.value=t.diffKeyG),e.uRefB&&t.diffKeyB!==void 0&&(e.uRefB.value=t.diffKeyB),e.uTolerance&&t.diffKeyTolerance!==void 0&&(e.uTolerance.value=t.diffKeyTolerance),e.uSoftness&&t.diffKeySoftness!==void 0&&(e.uSoftness.value=t.diffKeySoftness),e.uInvert&&t.diffKeyInvert!==void 0&&(e.uInvert.value=t.diffKeyInvert),e.uMatte&&t.diffKeyMatte!==void 0&&(e.uMatte.value=t.diffKeyMatte),e.uMode&&t.diffKeyMode!==void 0&&(e.uMode.value=t.diffKeyMode);break;case"thermal":e.uIntensity&&t.thermalIntensity!==void 0&&(e.uIntensity.value=t.thermalIntensity),e.uPalette&&t.thermalPalette!==void 0&&(e.uPalette.value=t.thermalPalette),e.uShimmer&&t.thermalShimmer!==void 0&&(e.uShimmer.value=t.thermalShimmer),e.uSensorNoise&&t.thermalSensorNoise!==void 0&&(e.uSensorNoise.value=t.thermalSensorNoise);break;case"nightVision":e.uIntensity&&t.nightVisionIntensity!==void 0&&(e.uIntensity.value=t.nightVisionIntensity),e.uNoise&&t.nightVisionNoise!==void 0&&(e.uNoise.value=t.nightVisionNoise),e.uVignette&&t.nightVisionVignette!==void 0&&(e.uVignette.value=t.nightVisionVignette),e.uPhosphor&&t.nightVisionPhosphor!==void 0&&(e.uPhosphor.value=t.nightVisionPhosphor),e.uBloom&&t.nightVisionBloom!==void 0&&(e.uBloom.value=t.nightVisionBloom),e.uScopeMask&&t.nightVisionScopeMask!==void 0&&(e.uScopeMask.value=t.nightVisionScopeMask),e.uRollingNoise&&t.nightVisionRollingNoise!==void 0&&(e.uRollingNoise.value=t.nightVisionRollingNoise);break;case"brightness":e.uAmount&&t.brightnessAmount!==void 0&&(e.uAmount.value=t.brightnessAmount);break;case"contrast":e.uAmount&&t.contrastAmount!==void 0&&(e.uAmount.value=t.contrastAmount);break;case"saturation":e.uAmount&&t.saturationAmount!==void 0&&(e.uAmount.value=t.saturationAmount);break;case"hue":e.uAmount&&t.hueShift!==void 0&&(e.uAmount.value=t.hueShift);break;case"bloom":e.uAmount&&t.amount!==void 0&&(e.uAmount.value=t.amount),e.uIntensity&&t.bloomIntensity!==void 0&&(e.uIntensity.value=t.bloomIntensity),e.uThreshold&&t.threshold!==void 0&&(e.uThreshold.value=t.threshold),e.uKnee&&t.bloomKnee!==void 0&&(e.uKnee.value=t.bloomKnee),e.uRadius&&t.bloomRadius!==void 0&&(e.uRadius.value=t.bloomRadius),e.uAnamorphic&&t.bloomAnamorphic!==void 0&&(e.uAnamorphic.value=t.bloomAnamorphic),e.uTintR&&t.red!==void 0&&(e.uTintR.value=t.red),e.uTintG&&t.green!==void 0&&(e.uTintG.value=t.green),e.uTintB&&t.blue!==void 0&&(e.uTintB.value=t.blue);break;case"feedbackZoom":e.uAmount&&t.amount!==void 0&&(e.uAmount.value=t.amount),e.uZoom&&t.feedbackZoom!==void 0&&(e.uZoom.value=t.feedbackZoom),e.uRotation&&t.feedbackRotation!==void 0&&(e.uRotation.value=t.feedbackRotation),e.uDecay&&t.feedbackDecay!==void 0&&(e.uDecay.value=t.feedbackDecay),e.uHueShift&&t.feedbackHueShift!==void 0&&(e.uHueShift.value=t.feedbackHueShift),e.uMaskCenter&&t.feedbackMaskCenter!==void 0&&(e.uMaskCenter.value=t.feedbackMaskCenter);break;case"exposure":e.uExposure&&t.exposureStops!==void 0&&(e.uExposure.value=t.exposureStops),e.uRollOff&&t.exposureRollOff!==void 0&&(e.uRollOff.value=t.exposureRollOff),e.uHighlightProtect&&t.exposureHighlightProtect!==void 0&&(e.uHighlightProtect.value=t.exposureHighlightProtect);break;case"gamma":e.uShadows&&t.gammaShadows!==void 0&&(e.uShadows.value=t.gammaShadows),e.uMids&&t.gammaMids!==void 0&&(e.uMids.value=t.gammaMids),e.uHighlights&&t.gammaHighlights!==void 0&&(e.uHighlights.value=t.gammaHighlights),e.uMix&&t.gammaMix!==void 0&&(e.uMix.value=t.gammaMix);break;case"vibrance":e.uVibrance&&t.vibranceAmount!==void 0&&(e.uVibrance.value=t.vibranceAmount),e.uSkinProtect&&t.vibranceSkinProtect!==void 0&&(e.uSkinProtect.value=t.vibranceSkinProtect),e.uHighlightProtect&&t.vibranceHighlightProtect!==void 0&&(e.uHighlightProtect.value=t.vibranceHighlightProtect),e.uCeiling&&t.vibranceCeiling!==void 0&&(e.uCeiling.value=t.vibranceCeiling);break;case"temperatureTint":e.uTemperature&&t.tempTemperature!==void 0&&(e.uTemperature.value=t.tempTemperature),e.uTint&&t.tempTint!==void 0&&(e.uTint.value=t.tempTint),e.uShadowTemp&&t.tempShadow!==void 0&&(e.uShadowTemp.value=t.tempShadow),e.uHighlightTemp&&t.tempHighlight!==void 0&&(e.uHighlightTemp.value=t.tempHighlight),e.uSplitTone&&t.tempSplitTone!==void 0&&(e.uSplitTone.value=t.tempSplitTone),e.uAutoCycle&&t.tempAutoCycle!==void 0&&(e.uAutoCycle.value=t.tempAutoCycle);break;case"colorBalance":e.uShadowR&&t.cbShadowR!==void 0&&(e.uShadowR.value=t.cbShadowR),e.uShadowG&&t.cbShadowG!==void 0&&(e.uShadowG.value=t.cbShadowG),e.uShadowB&&t.cbShadowB!==void 0&&(e.uShadowB.value=t.cbShadowB),e.uMidR&&t.cbMidR!==void 0&&(e.uMidR.value=t.cbMidR),e.uMidG&&t.cbMidG!==void 0&&(e.uMidG.value=t.cbMidG),e.uMidB&&t.cbMidB!==void 0&&(e.uMidB.value=t.cbMidB),e.uHighR&&t.cbHighR!==void 0&&(e.uHighR.value=t.cbHighR),e.uHighG&&t.cbHighG!==void 0&&(e.uHighG.value=t.cbHighG),e.uHighB&&t.cbHighB!==void 0&&(e.uHighB.value=t.cbHighB),e.uPreserveLuma&&t.cbPreserveLuma!==void 0&&(e.uPreserveLuma.value=t.cbPreserveLuma),e.uMix&&t.cbMix!==void 0&&(e.uMix.value=t.cbMix);break;case"curves":e.uContrast&&t.curvesContrast!==void 0&&(e.uContrast.value=t.curvesContrast),e.uToe&&t.curvesToe!==void 0&&(e.uToe.value=t.curvesToe),e.uShoulder&&t.curvesShoulder!==void 0&&(e.uShoulder.value=t.curvesShoulder),e.uBlackCrush&&t.curvesBlackCrush!==void 0&&(e.uBlackCrush.value=t.curvesBlackCrush),e.uMix&&t.curvesMix!==void 0&&(e.uMix.value=t.curvesMix);break;case"liftGammaGain":e.uLiftR&&t.lggLiftR!==void 0&&(e.uLiftR.value=t.lggLiftR),e.uLiftG&&t.lggLiftG!==void 0&&(e.uLiftG.value=t.lggLiftG),e.uLiftB&&t.lggLiftB!==void 0&&(e.uLiftB.value=t.lggLiftB),e.uGammaR&&t.lggGammaR!==void 0&&(e.uGammaR.value=t.lggGammaR),e.uGammaG&&t.lggGammaG!==void 0&&(e.uGammaG.value=t.lggGammaG),e.uGammaB&&t.lggGammaB!==void 0&&(e.uGammaB.value=t.lggGammaB),e.uGainR&&t.lggGainR!==void 0&&(e.uGainR.value=t.lggGainR),e.uGainG&&t.lggGainG!==void 0&&(e.uGainG.value=t.lggGainG),e.uGainB&&t.lggGainB!==void 0&&(e.uGainB.value=t.lggGainB),e.uLumaOnly&&t.lggLumaOnly!==void 0&&(e.uLumaOnly.value=t.lggLumaOnly),e.uMix&&t.lggMix!==void 0&&(e.uMix.value=t.lggMix);break;case"filmicTonemap":e.uCurve&&t.tonemapCurve!==void 0&&(e.uCurve.value=t.tonemapCurve),e.uExposure&&t.tonemapExposure!==void 0&&(e.uExposure.value=t.tonemapExposure),e.uContrast&&t.tonemapContrast!==void 0&&(e.uContrast.value=t.tonemapContrast),e.uMix&&t.tonemapMix!==void 0&&(e.uMix.value=t.tonemapMix);break;case"selectiveColor":e.uTargetHue&&t.selColorTargetHue!==void 0&&(e.uTargetHue.value=t.selColorTargetHue),e.uHueRange&&t.selColorRange!==void 0&&(e.uHueRange.value=t.selColorRange),e.uFeather&&t.selColorFeather!==void 0&&(e.uFeather.value=t.selColorFeather),e.uMode&&t.selColorMode!==void 0&&(e.uMode.value=t.selColorMode),e.uReplaceHue&&t.selColorReplaceHue!==void 0&&(e.uReplaceHue.value=t.selColorReplaceHue),e.uSatBoost&&t.selColorSatBoost!==void 0&&(e.uSatBoost.value=t.selColorSatBoost);break;case"compressionArtifacts":e.uBlockSize&&t.compArtBlockSize!==void 0&&(e.uBlockSize.value=t.compArtBlockSize),e.uQuality&&t.compArtQuality!==void 0&&(e.uQuality.value=t.compArtQuality),e.uChromaSubsample&&t.compArtChromaSubsample!==void 0&&(e.uChromaSubsample.value=t.compArtChromaSubsample),e.uBlockNoise&&t.compArtBlockNoise!==void 0&&(e.uBlockNoise.value=t.compArtBlockNoise),e.uMode&&t.compArtMode!==void 0&&(e.uMode.value=t.compArtMode),e.uMix&&t.compArtMix!==void 0&&(e.uMix.value=t.compArtMix);break;case"erode":e.uRadius&&t.erodeRadius!==void 0&&(e.uRadius.value=t.erodeRadius),e.uShape&&t.erodeShape!==void 0&&(e.uShape.value=t.erodeShape),e.uChannel&&t.erodeChannel!==void 0&&(e.uChannel.value=t.erodeChannel),e.uMix&&t.erodeMix!==void 0&&(e.uMix.value=t.erodeMix);break;case"dilate":e.uRadius&&t.dilateRadius!==void 0&&(e.uRadius.value=t.dilateRadius),e.uShape&&t.dilateShape!==void 0&&(e.uShape.value=t.dilateShape),e.uChannel&&t.dilateChannel!==void 0&&(e.uChannel.value=t.dilateChannel),e.uMix&&t.dilateMix!==void 0&&(e.uMix.value=t.dilateMix);break;case"displacement":e.uAmount&&t.dispAmount!==void 0&&(e.uAmount.value=t.dispAmount),e.uScale&&t.dispScale!==void 0&&(e.uScale.value=t.dispScale),e.uSpeed&&t.dispSpeed!==void 0&&(e.uSpeed.value=t.dispSpeed),e.uMode&&t.dispMode!==void 0&&(e.uMode.value=t.dispMode),e.uTurbulence&&t.dispTurbulence!==void 0&&(e.uTurbulence.value=t.dispTurbulence),e.uChromatic&&t.dispChromatic!==void 0&&(e.uChromatic.value=t.dispChromatic);break;case"twirl":e.uAngle&&t.twirlAngle!==void 0&&(e.uAngle.value=t.twirlAngle),e.uRadius&&t.twirlRadius!==void 0&&(e.uRadius.value=t.twirlRadius),e.uCenterX&&t.twirlCenterX!==void 0&&(e.uCenterX.value=t.twirlCenterX),e.uCenterY&&t.twirlCenterY!==void 0&&(e.uCenterY.value=t.twirlCenterY),e.uFalloff&&t.twirlFalloff!==void 0&&(e.uFalloff.value=t.twirlFalloff),e.uAnimSpeed&&t.twirlAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.twirlAnimSpeed),e.uMix&&t.twirlMix!==void 0&&(e.uMix.value=t.twirlMix);break;case"pinchBulge":e.uAmount&&t.pinchAmount!==void 0&&(e.uAmount.value=t.pinchAmount),e.uRadius&&t.pinchRadius!==void 0&&(e.uRadius.value=t.pinchRadius),e.uCenterX&&t.pinchCenterX!==void 0&&(e.uCenterX.value=t.pinchCenterX),e.uCenterY&&t.pinchCenterY!==void 0&&(e.uCenterY.value=t.pinchCenterY),e.uFalloff&&t.pinchFalloff!==void 0&&(e.uFalloff.value=t.pinchFalloff),e.uChromatic&&t.pinchChromatic!==void 0&&(e.uChromatic.value=t.pinchChromatic),e.uMix&&t.pinchMix!==void 0&&(e.uMix.value=t.pinchMix);break;case"polarTransform":e.uMode&&t.polarMode!==void 0&&(e.uMode.value=t.polarMode),e.uRotation&&t.polarRotation!==void 0&&(e.uRotation.value=t.polarRotation),e.uZoom&&t.polarZoom!==void 0&&(e.uZoom.value=t.polarZoom),e.uCenterX&&t.polarCenterX!==void 0&&(e.uCenterX.value=t.polarCenterX),e.uCenterY&&t.polarCenterY!==void 0&&(e.uCenterY.value=t.polarCenterY),e.uMix&&t.polarMix!==void 0&&(e.uMix.value=t.polarMix);break;case"falseColor":e.uMode&&t.falseColorMode!==void 0&&(e.uMode.value=t.falseColorMode),e.uMix&&t.falseColorMix!==void 0&&(e.uMix.value=t.falseColorMix),e.uShowOriginal&&t.falseColorShowOriginal!==void 0&&(e.uShowOriginal.value=t.falseColorShowOriginal),e.uMidpoint&&t.falseColorMidpoint!==void 0&&(e.uMidpoint.value=t.falseColorMidpoint),e.uRange&&t.falseColorRange!==void 0&&(e.uRange.value=t.falseColorRange);break;case"shadowRecovery":e.uAmount&&t.shadowAmount!==void 0&&(e.uAmount.value=t.shadowAmount),e.uThreshold&&t.shadowThreshold!==void 0&&(e.uThreshold.value=t.shadowThreshold),e.uSoftness&&t.shadowSoftness!==void 0&&(e.uSoftness.value=t.shadowSoftness),e.uColorRecovery&&t.shadowColorRecovery!==void 0&&(e.uColorRecovery.value=t.shadowColorRecovery),e.uHighlightProtect&&t.shadowHighlightProtect!==void 0&&(e.uHighlightProtect.value=t.shadowHighlightProtect),e.uMix&&t.shadowMix!==void 0&&(e.uMix.value=t.shadowMix);break;case"highlightRolloff":e.uAmount&&t.highRolloffAmount!==void 0&&(e.uAmount.value=t.highRolloffAmount),e.uThreshold&&t.highRolloffThreshold!==void 0&&(e.uThreshold.value=t.highRolloffThreshold),e.uSoftness&&t.highRolloffSoftness!==void 0&&(e.uSoftness.value=t.highRolloffSoftness),e.uPreserveHue&&t.highRolloffPreserveHue!==void 0&&(e.uPreserveHue.value=t.highRolloffPreserveHue),e.uMaxValue&&t.highRolloffMaxValue!==void 0&&(e.uMaxValue.value=t.highRolloffMaxValue),e.uMix&&t.highRolloffMix!==void 0&&(e.uMix.value=t.highRolloffMix);break;case"ascii":e.uCellSize&&t.asciiCellSize!==void 0&&(e.uCellSize.value=t.asciiCellSize),e.uContrast&&t.asciiContrast!==void 0&&(e.uContrast.value=t.asciiContrast),e.uColorMix&&t.asciiColorMix!==void 0&&(e.uColorMix.value=t.asciiColorMix),e.uMode&&t.asciiMode!==void 0&&(e.uMode.value=t.asciiMode),e.uInvert&&t.asciiInvert!==void 0&&(e.uInvert.value=t.asciiInvert),e.uTintR&&t.asciiTintR!==void 0&&(e.uTintR.value=t.asciiTintR),e.uTintG&&t.asciiTintG!==void 0&&(e.uTintG.value=t.asciiTintG),e.uTintB&&t.asciiTintB!==void 0&&(e.uTintB.value=t.asciiTintB);break;case"comicInk":e.uInkStrength&&t.comicInkStrength!==void 0&&(e.uInkStrength.value=t.comicInkStrength),e.uInkThreshold&&t.comicInkThreshold!==void 0&&(e.uInkThreshold.value=t.comicInkThreshold),e.uPosterize&&t.comicInkPosterize!==void 0&&(e.uPosterize.value=t.comicInkPosterize),e.uHalftoneShadow&&t.comicInkHalftone!==void 0&&(e.uHalftoneShadow.value=t.comicInkHalftone),e.uHalftoneSize&&t.comicInkHalftoneSize!==void 0&&(e.uHalftoneSize.value=t.comicInkHalftoneSize),e.uColorMix&&t.comicInkColorMix!==void 0&&(e.uColorMix.value=t.comicInkColorMix),e.uInkR&&t.comicInkR!==void 0&&(e.uInkR.value=t.comicInkR),e.uInkG&&t.comicInkG!==void 0&&(e.uInkG.value=t.comicInkG),e.uInkB&&t.comicInkB!==void 0&&(e.uInkB.value=t.comicInkB);break;case"datamoshLite":e.uMode&&(e.uMode.value=so.datamoshLite),e.uAmount&&(e.uAmount.value=t.amount??t.datamoshIntensity??.5),e.uAmount2&&(e.uAmount2.value=t.amount2??t.datamoshSmear??.3),e.uAmount3&&(e.uAmount3.value=t.amount3??t.datamoshChannelSplit??.4);break;case"scanlineDrift":e.uIntensity&&t.scanDriftIntensity!==void 0&&(e.uIntensity.value=t.scanDriftIntensity),e.uFrequency&&t.scanDriftFrequency!==void 0&&(e.uFrequency.value=t.scanDriftFrequency),e.uSpeed&&t.scanDriftSpeed!==void 0&&(e.uSpeed.value=t.scanDriftSpeed),e.uWaveform&&t.scanDriftWaveform!==void 0&&(e.uWaveform.value=t.scanDriftWaveform),e.uChromaSplit&&t.scanDriftChromaSplit!==void 0&&(e.uChromaSplit.value=t.scanDriftChromaSplit),e.uChunkiness&&t.scanDriftChunkiness!==void 0&&(e.uChunkiness.value=t.scanDriftChunkiness);break;case"tapeDropout":e.uDensity&&t.tapeDropoutDensity!==void 0&&(e.uDensity.value=t.tapeDropoutDensity),e.uLength&&t.tapeDropoutLength!==void 0&&(e.uLength.value=t.tapeDropoutLength),e.uColor&&t.tapeDropoutColor!==void 0&&(e.uColor.value=t.tapeDropoutColor),e.uSpeed&&t.tapeDropoutSpeed!==void 0&&(e.uSpeed.value=t.tapeDropoutSpeed),e.uNoiseAmp&&t.tapeDropoutNoise!==void 0&&(e.uNoiseAmp.value=t.tapeDropoutNoise),e.uMix&&t.tapeDropoutMix!==void 0&&(e.uMix.value=t.tapeDropoutMix);break;case"rippleCaustics":e.uIntensity&&t.causticsIntensity!==void 0&&(e.uIntensity.value=t.causticsIntensity),e.uScale&&t.causticsScale!==void 0&&(e.uScale.value=t.causticsScale),e.uSpeed&&t.causticsSpeed!==void 0&&(e.uSpeed.value=t.causticsSpeed),e.uRefraction&&t.causticsRefraction!==void 0&&(e.uRefraction.value=t.causticsRefraction),e.uTintR&&t.causticsTintR!==void 0&&(e.uTintR.value=t.causticsTintR),e.uTintG&&t.causticsTintG!==void 0&&(e.uTintG.value=t.causticsTintG),e.uTintB&&t.causticsTintB!==void 0&&(e.uTintB.value=t.causticsTintB),e.uMode&&t.causticsMode!==void 0&&(e.uMode.value=t.causticsMode);break;case"shockwave":e.uTriggerTime&&t.shockTriggerTime!==void 0&&(e.uTriggerTime.value=t.shockTriggerTime),e.uSpeed&&t.shockSpeed!==void 0&&(e.uSpeed.value=t.shockSpeed),e.uAmplitude&&t.shockAmplitude!==void 0&&(e.uAmplitude.value=t.shockAmplitude),e.uRingWidth&&t.shockRingWidth!==void 0&&(e.uRingWidth.value=t.shockRingWidth),e.uCenterX&&t.shockCenterX!==void 0&&(e.uCenterX.value=t.shockCenterX),e.uCenterY&&t.shockCenterY!==void 0&&(e.uCenterY.value=t.shockCenterY),e.uChromatic&&t.shockChromatic!==void 0&&(e.uChromatic.value=t.shockChromatic),e.uMode&&t.shockMode!==void 0&&(e.uMode.value=t.shockMode);break;case"drosteRecursive":e.uZoom&&t.drosteZoom!==void 0&&(e.uZoom.value=t.drosteZoom),e.uRotation&&t.drosteRotation!==void 0&&(e.uRotation.value=t.drosteRotation),e.uIterations&&t.drosteIterations!==void 0&&(e.uIterations.value=t.drosteIterations),e.uOffsetX&&t.drosteOffsetX!==void 0&&(e.uOffsetX.value=t.drosteOffsetX),e.uOffsetY&&t.drosteOffsetY!==void 0&&(e.uOffsetY.value=t.drosteOffsetY),e.uFrameSize&&t.drosteFrameSize!==void 0&&(e.uFrameSize.value=t.drosteFrameSize),e.uMix&&t.drosteMix!==void 0&&(e.uMix.value=t.drosteMix);break;case"slitScan":e.uIntensity&&t.slitScanIntensity!==void 0&&(e.uIntensity.value=t.slitScanIntensity),e.uMode&&t.slitScanMode!==void 0&&(e.uMode.value=t.slitScanMode),e.uPattern&&t.slitScanPattern!==void 0&&(e.uPattern.value=t.slitScanPattern),e.uSpeed&&t.slitScanSpeed!==void 0&&(e.uSpeed.value=t.slitScanSpeed),e.uChromaSplit&&t.slitScanChromaSplit!==void 0&&(e.uChromaSplit.value=t.slitScanChromaSplit);break;case"volumetricFogOverlay":e.uDensity&&t.fogDensity!==void 0&&(e.uDensity.value=t.fogDensity),e.uScale&&t.fogScale!==void 0&&(e.uScale.value=t.fogScale),e.uSpeed&&t.fogSpeed!==void 0&&(e.uSpeed.value=t.fogSpeed),e.uHeightFalloff&&t.fogHeightFalloff!==void 0&&(e.uHeightFalloff.value=t.fogHeightFalloff),e.uDepthSim&&t.fogDepthSim!==void 0&&(e.uDepthSim.value=t.fogDepthSim),e.uColorR&&t.fogColorR!==void 0&&(e.uColorR.value=t.fogColorR),e.uColorG&&t.fogColorG!==void 0&&(e.uColorG.value=t.fogColorG),e.uColorB&&t.fogColorB!==void 0&&(e.uColorB.value=t.fogColorB),e.uTurbulence&&t.fogTurbulence!==void 0&&(e.uTurbulence.value=t.fogTurbulence),e.uMode&&t.fogMode!==void 0&&(e.uMode.value=t.fogMode);break;case"rainFogSnowOverlay":e.uType&&t.weatherType!==void 0&&(e.uType.value=t.weatherType),e.uDensity&&t.weatherDensity!==void 0&&(e.uDensity.value=t.weatherDensity),e.uSpeed&&t.weatherSpeed!==void 0&&(e.uSpeed.value=t.weatherSpeed),e.uAngle&&t.weatherAngle!==void 0&&(e.uAngle.value=t.weatherAngle),e.uSize&&t.weatherSize!==void 0&&(e.uSize.value=t.weatherSize),e.uFogAmount&&t.weatherFog!==void 0&&(e.uFogAmount.value=t.weatherFog),e.uColorR&&t.weatherColorR!==void 0&&(e.uColorR.value=t.weatherColorR),e.uColorG&&t.weatherColorG!==void 0&&(e.uColorG.value=t.weatherColorG),e.uColorB&&t.weatherColorB!==void 0&&(e.uColorB.value=t.weatherColorB);break;case"particleOverlayFx":e.uMode&&t.partMode!==void 0&&(e.uMode.value=t.partMode),e.uDensity&&t.partDensity!==void 0&&(e.uDensity.value=t.partDensity),e.uSize&&t.partSize!==void 0&&(e.uSize.value=t.partSize),e.uSpeed&&t.partSpeed!==void 0&&(e.uSpeed.value=t.partSpeed),e.uTwinkle&&t.partTwinkle!==void 0&&(e.uTwinkle.value=t.partTwinkle),e.uColorR&&t.partColorR!==void 0&&(e.uColorR.value=t.partColorR),e.uColorG&&t.partColorG!==void 0&&(e.uColorG.value=t.partColorG),e.uColorB&&t.partColorB!==void 0&&(e.uColorB.value=t.partColorB),e.uBlend&&t.partBlend!==void 0&&(e.uBlend.value=t.partBlend);break;case"glintStarburst":e.uIntensity&&t.glintIntensity!==void 0&&(e.uIntensity.value=t.glintIntensity),e.uThreshold&&t.glintThreshold!==void 0&&(e.uThreshold.value=t.glintThreshold),e.uLength&&t.glintLength!==void 0&&(e.uLength.value=t.glintLength),e.uPoints&&t.glintPoints!==void 0&&(e.uPoints.value=t.glintPoints),e.uRotation&&t.glintRotation!==void 0&&(e.uRotation.value=t.glintRotation),e.uColorR&&t.glintColorR!==void 0&&(e.uColorR.value=t.glintColorR),e.uColorG&&t.glintColorG!==void 0&&(e.uColorG.value=t.glintColorG),e.uColorB&&t.glintColorB!==void 0&&(e.uColorB.value=t.glintColorB);break;case"embossRelight":e.uStrength&&t.embRelStrength!==void 0&&(e.uStrength.value=t.embRelStrength),e.uAngle&&t.embRelAngle!==void 0&&(e.uAngle.value=t.embRelAngle),e.uHeight&&t.embRelHeight!==void 0&&(e.uHeight.value=t.embRelHeight),e.uDetail&&t.embRelDetail!==void 0&&(e.uDetail.value=t.embRelDetail),e.uSpecular&&t.embRelSpecular!==void 0&&(e.uSpecular.value=t.embRelSpecular),e.uColorPreserve&&t.embRelColorPreserve!==void 0&&(e.uColorPreserve.value=t.embRelColorPreserve),e.uAmbient&&t.embRelAmbient!==void 0&&(e.uAmbient.value=t.embRelAmbient);break;case"dotMatrix":e.uDotSize&&t.dmDotSize!==void 0&&(e.uDotSize.value=t.dmDotSize),e.uDotShape&&t.dmDotShape!==void 0&&(e.uDotShape.value=t.dmDotShape),e.uGap&&t.dmGap!==void 0&&(e.uGap.value=t.dmGap),e.uPosterize&&t.dmPosterize!==void 0&&(e.uPosterize.value=t.dmPosterize),e.uGlow&&t.dmGlow!==void 0&&(e.uGlow.value=t.dmGlow),e.uBgR&&t.dmBgR!==void 0&&(e.uBgR.value=t.dmBgR),e.uBgG&&t.dmBgG!==void 0&&(e.uBgG.value=t.dmBgG),e.uBgB&&t.dmBgB!==void 0&&(e.uBgB.value=t.dmBgB);break;case"matrixRain":e.uDensity&&t.matrixDensity!==void 0&&(e.uDensity.value=t.matrixDensity),e.uSpeed&&t.matrixSpeed!==void 0&&(e.uSpeed.value=t.matrixSpeed),e.uCellSize&&t.matrixCellSize!==void 0&&(e.uCellSize.value=t.matrixCellSize),e.uTrailLength&&t.matrixTrailLength!==void 0&&(e.uTrailLength.value=t.matrixTrailLength),e.uColorR&&t.matrixColorR!==void 0&&(e.uColorR.value=t.matrixColorR),e.uColorG&&t.matrixColorG!==void 0&&(e.uColorG.value=t.matrixColorG),e.uColorB&&t.matrixColorB!==void 0&&(e.uColorB.value=t.matrixColorB),e.uBgMix&&t.matrixBgMix!==void 0&&(e.uBgMix.value=t.matrixBgMix);break;case"binaryCode":e.uDensity&&t.binDensity!==void 0&&(e.uDensity.value=t.binDensity),e.uSpeed&&t.binSpeed!==void 0&&(e.uSpeed.value=t.binSpeed),e.uCellSize&&t.binCellSize!==void 0&&(e.uCellSize.value=t.binCellSize),e.uColorR&&t.binColorR!==void 0&&(e.uColorR.value=t.binColorR),e.uColorG&&t.binColorG!==void 0&&(e.uColorG.value=t.binColorG),e.uColorB&&t.binColorB!==void 0&&(e.uColorB.value=t.binColorB),e.uBgMix&&t.binBgMix!==void 0&&(e.uBgMix.value=t.binBgMix),e.uContrast&&t.binContrast!==void 0&&(e.uContrast.value=t.binContrast);break;case"crosshatch":e.uDensity&&t.hatchDensity!==void 0&&(e.uDensity.value=t.hatchDensity),e.uAngle&&t.hatchAngle!==void 0&&(e.uAngle.value=t.hatchAngle),e.uLineWidth&&t.hatchLineWidth!==void 0&&(e.uLineWidth.value=t.hatchLineWidth),e.uContrast&&t.hatchContrast!==void 0&&(e.uContrast.value=t.hatchContrast),e.uPaperR&&t.hatchPaperR!==void 0&&(e.uPaperR.value=t.hatchPaperR),e.uPaperG&&t.hatchPaperG!==void 0&&(e.uPaperG.value=t.hatchPaperG),e.uPaperB&&t.hatchPaperB!==void 0&&(e.uPaperB.value=t.hatchPaperB),e.uInkR&&t.hatchInkR!==void 0&&(e.uInkR.value=t.hatchInkR),e.uInkG&&t.hatchInkG!==void 0&&(e.uInkG.value=t.hatchInkG),e.uInkB&&t.hatchInkB!==void 0&&(e.uInkB.value=t.hatchInkB);break;case"blockMosaic":e.uTileSize&&t.mosaicTileSize!==void 0&&(e.uTileSize.value=t.mosaicTileSize),e.uMode&&t.mosaicMode!==void 0&&(e.uMode.value=t.mosaicMode),e.uGrout&&t.mosaicGrout!==void 0&&(e.uGrout.value=t.mosaicGrout),e.uColorJitter&&t.mosaicColorJitter!==void 0&&(e.uColorJitter.value=t.mosaicColorJitter),e.uGroutR&&t.mosaicGroutR!==void 0&&(e.uGroutR.value=t.mosaicGroutR),e.uGroutG&&t.mosaicGroutG!==void 0&&(e.uGroutG.value=t.mosaicGroutG),e.uGroutB&&t.mosaicGroutB!==void 0&&(e.uGroutB.value=t.mosaicGroutB);break;case"terrain3D":if(e.uMode&&(e.uMode.value=t.terrainMode??t.mode??1),e.uAmount&&(e.uAmount.value=t.terrainHeight??t.amount??.5),e.uAmount2&&(e.uAmount2.value=t.terrainCamHeight??t.amount2??.5),e.uAmount3&&(e.uAmount3.value=t.terrainSpeed??t.amount3??.5),e.uThreshold&&(e.uThreshold.value=t.terrainFog??t.threshold??.4),e.uAngle&&(e.uAngle.value=t.terrainYaw??t.angle??0),e.uCenter){const n=t.terrainPitch??t.centerX??.5,c=t.terrainRoll??t.centerY??.5;e.uCenter.value.set(n,c)}e.uColor&&e.uColor.value.set(t.terrainFogR??t.red??.05,t.terrainFogG??t.green??.07,t.terrainFogB??t.blue??.12),e.uHorizonFade&&t.terrainHorizonFade!==void 0&&(e.uHorizonFade.value=t.terrainHorizonFade),e.uSourceMix&&t.terrainSourceMix!==void 0&&(e.uSourceMix.value=t.terrainSourceMix);break;case"wrappedTerrain":e.uShape&&t.wtShape!==void 0&&(e.uShape.value=t.wtShape),e.uHeight&&t.wtHeight!==void 0&&(e.uHeight.value=t.wtHeight),e.uRotateX&&t.wtRotateX!==void 0&&(e.uRotateX.value=t.wtRotateX),e.uRotateY&&t.wtRotateY!==void 0&&(e.uRotateY.value=t.wtRotateY),e.uAutoRotate&&t.wtAutoRotate!==void 0&&(e.uAutoRotate.value=t.wtAutoRotate),e.uCamDistance&&t.wtCamDistance!==void 0&&(e.uCamDistance.value=t.wtCamDistance),e.uSpecular&&t.wtSpecular!==void 0&&(e.uSpecular.value=t.wtSpecular),e.uAmbient&&t.wtAmbient!==void 0&&(e.uAmbient.value=t.wtAmbient),e.uFogDistance&&t.wtFogDistance!==void 0&&(e.uFogDistance.value=t.wtFogDistance),e.uFogColor&&e.uFogColor.value.set(t.wtFogR??.05,t.wtFogG??.07,t.wtFogB??.12),e.uHorizonFade&&t.wtHorizonFade!==void 0&&(e.uHorizonFade.value=t.wtHorizonFade),e.uSourceMix&&t.wtSourceMix!==void 0&&(e.uSourceMix.value=t.wtSourceMix),e.uTileScale&&t.wtTileScale!==void 0&&(e.uTileScale.value=t.wtTileScale);break;case"stringOrb":e.uRadius&&t.soRadius!==void 0&&(e.uRadius.value=t.soRadius),e.uHeight&&t.soHeight!==void 0&&(e.uHeight.value=t.soHeight),e.uLatCount&&t.soLatCount!==void 0&&(e.uLatCount.value=t.soLatCount),e.uLonCount&&t.soLonCount!==void 0&&(e.uLonCount.value=t.soLonCount),e.uDiagCount&&t.soDiagCount!==void 0&&(e.uDiagCount.value=t.soDiagCount),e.uSlope&&t.soSlope!==void 0&&(e.uSlope.value=t.soSlope),e.uWidth&&t.soWidth!==void 0&&(e.uWidth.value=t.soWidth),e.uSpin&&t.soSpin!==void 0&&(e.uSpin.value=t.soSpin),e.uTilt&&t.soTilt!==void 0&&(e.uTilt.value=t.soTilt),e.uFlow&&t.soFlow!==void 0&&(e.uFlow.value=t.soFlow),e.uIntensity&&t.soIntensity!==void 0&&(e.uIntensity.value=t.soIntensity),e.uGlow&&t.soGlow!==void 0&&(e.uGlow.value=t.soGlow),e.uGlowColor&&e.uGlowColor.value.set(t.soGlowR??.4,t.soGlowG??.85,t.soGlowB??1),e.uHorizonFade&&t.soHorizonFade!==void 0&&(e.uHorizonFade.value=t.soHorizonFade),e.uTileScale&&t.soTileScale!==void 0&&(e.uTileScale.value=t.soTileScale);break;case"sphereWireframe":e.uRadius&&t.swRadius!==void 0&&(e.uRadius.value=t.swRadius),e.uHeight&&t.swHeight!==void 0&&(e.uHeight.value=t.swHeight),e.uMeridians&&t.swMeridians!==void 0&&(e.uMeridians.value=t.swMeridians),e.uParallels&&t.swParallels!==void 0&&(e.uParallels.value=t.swParallels),e.uWidth&&t.swWidth!==void 0&&(e.uWidth.value=t.swWidth),e.uSpin&&t.swSpin!==void 0&&(e.uSpin.value=t.swSpin),e.uTilt&&t.swTilt!==void 0&&(e.uTilt.value=t.swTilt),e.uIntensity&&t.swIntensity!==void 0&&(e.uIntensity.value=t.swIntensity),e.uHaloGlow&&t.swHaloGlow!==void 0&&(e.uHaloGlow.value=t.swHaloGlow),e.uColor&&e.uColor.value.set(t.swColorR??.5,t.swColorG??.9,t.swColorB??1),e.uHorizonFade&&t.swHorizonFade!==void 0&&(e.uHorizonFade.value=t.swHorizonFade),e.uFillSource&&t.swFillSource!==void 0&&(e.uFillSource.value=t.swFillSource),e.uTileScale&&t.swTileScale!==void 0&&(e.uTileScale.value=t.swTileScale);break;case"voxelCubeCluster":e.uGridSize&&t.vccGridSize!==void 0&&(e.uGridSize.value=t.vccGridSize),e.uCubeSize&&t.vccCubeSize!==void 0&&(e.uCubeSize.value=t.vccCubeSize),e.uSpacing&&t.vccSpacing!==void 0&&(e.uSpacing.value=t.vccSpacing),e.uHeight&&t.vccHeight!==void 0&&(e.uHeight.value=t.vccHeight),e.uSpin&&t.vccSpin!==void 0&&(e.uSpin.value=t.vccSpin),e.uTilt&&t.vccTilt!==void 0&&(e.uTilt.value=t.vccTilt),e.uCamDistance&&t.vccCamDistance!==void 0&&(e.uCamDistance.value=t.vccCamDistance),e.uSpecular&&t.vccSpecular!==void 0&&(e.uSpecular.value=t.vccSpecular),e.uAmbient&&t.vccAmbient!==void 0&&(e.uAmbient.value=t.vccAmbient),e.uHorizonFade&&t.vccHorizonFade!==void 0&&(e.uHorizonFade.value=t.vccHorizonFade),e.uBgColor&&e.uBgColor.value.set(t.vccBgR??.04,t.vccBgG??.05,t.vccBgB??.08);break;case"mobiusLattice":e.uMajorR&&t.mlMajorR!==void 0&&(e.uMajorR.value=t.mlMajorR),e.uRibbonW&&t.mlRibbonW!==void 0&&(e.uRibbonW.value=t.mlRibbonW),e.uTwists&&t.mlTwists!==void 0&&(e.uTwists.value=t.mlTwists),e.uSpin&&t.mlSpin!==void 0&&(e.uSpin.value=t.mlSpin),e.uTilt&&t.mlTilt!==void 0&&(e.uTilt.value=t.mlTilt),e.uLineDensity&&t.mlLineDensity!==void 0&&(e.uLineDensity.value=t.mlLineDensity),e.uLineWidth&&t.mlLineWidth!==void 0&&(e.uLineWidth.value=t.mlLineWidth),e.uIntensity&&t.mlIntensity!==void 0&&(e.uIntensity.value=t.mlIntensity),e.uLineColor&&e.uLineColor.value.set(t.mlLineR??1,t.mlLineG??.85,t.mlLineB??.4),e.uHorizonFade&&t.mlHorizonFade!==void 0&&(e.uHorizonFade.value=t.mlHorizonFade);break;case"crystalShardField":e.uShardCount&&t.csfShardCount!==void 0&&(e.uShardCount.value=t.csfShardCount),e.uShardSize&&t.csfShardSize!==void 0&&(e.uShardSize.value=t.csfShardSize),e.uSpread&&t.csfSpread!==void 0&&(e.uSpread.value=t.csfSpread),e.uChromaEdge&&t.csfChromaEdge!==void 0&&(e.uChromaEdge.value=t.csfChromaEdge),e.uRefraction&&t.csfRefraction!==void 0&&(e.uRefraction.value=t.csfRefraction),e.uSpin&&t.csfSpin!==void 0&&(e.uSpin.value=t.csfSpin),e.uIntensity&&t.csfIntensity!==void 0&&(e.uIntensity.value=t.csfIntensity),e.uTint&&e.uTint.value.set(t.csfTintR??.85,t.csfTintG??.95,t.csfTintB??1),e.uHorizonFade&&t.csfHorizonFade!==void 0&&(e.uHorizonFade.value=t.csfHorizonFade);break;case"tubeLattice":e.uTubeCount&&t.tlTubeCount!==void 0&&(e.uTubeCount.value=t.tlTubeCount),e.uTubeRadius&&t.tlTubeRadius!==void 0&&(e.uTubeRadius.value=t.tlTubeRadius),e.uSpread&&t.tlSpread!==void 0&&(e.uSpread.value=t.tlSpread),e.uSpin&&t.tlSpin!==void 0&&(e.uSpin.value=t.tlSpin),e.uTilt&&t.tlTilt!==void 0&&(e.uTilt.value=t.tlTilt),e.uTwist&&t.tlTwist!==void 0&&(e.uTwist.value=t.tlTwist),e.uIntensity&&t.tlIntensity!==void 0&&(e.uIntensity.value=t.tlIntensity),e.uRimColor&&e.uRimColor.value.set(t.tlRimR??0,t.tlRimG??.95,t.tlRimB??1),e.uHorizonFade&&t.tlHorizonFade!==void 0&&(e.uHorizonFade.value=t.tlHorizonFade);break;case"discoMirrorBall":e.uRadius&&t.dmbRadius!==void 0&&(e.uRadius.value=t.dmbRadius),e.uFacetCount&&t.dmbFacetCount!==void 0&&(e.uFacetCount.value=t.dmbFacetCount),e.uSpin&&t.dmbSpin!==void 0&&(e.uSpin.value=t.dmbSpin),e.uTilt&&t.dmbTilt!==void 0&&(e.uTilt.value=t.dmbTilt),e.uChaseSpeed&&t.dmbChaseSpeed!==void 0&&(e.uChaseSpeed.value=t.dmbChaseSpeed),e.uChaseHueWidth&&t.dmbChaseHueWidth!==void 0&&(e.uChaseHueWidth.value=t.dmbChaseHueWidth),e.uSparkle&&t.dmbSparkle!==void 0&&(e.uSparkle.value=t.dmbSparkle),e.uIntensity&&t.dmbIntensity!==void 0&&(e.uIntensity.value=t.dmbIntensity),e.uHighlightColor&&e.uHighlightColor.value.set(t.dmbHighlightR??1,t.dmbHighlightG??1,t.dmbHighlightB??.85),e.uHorizonFade&&t.dmbHorizonFade!==void 0&&(e.uHorizonFade.value=t.dmbHorizonFade);break;case"lissajousKnot":e.uRatioX&&t.lkRatioX!==void 0&&(e.uRatioX.value=t.lkRatioX),e.uRatioY&&t.lkRatioY!==void 0&&(e.uRatioY.value=t.lkRatioY),e.uRatioZ&&t.lkRatioZ!==void 0&&(e.uRatioZ.value=t.lkRatioZ),e.uPhaseX&&t.lkPhaseX!==void 0&&(e.uPhaseX.value=t.lkPhaseX),e.uPhaseY&&t.lkPhaseY!==void 0&&(e.uPhaseY.value=t.lkPhaseY),e.uTubeRadius&&t.lkTubeRadius!==void 0&&(e.uTubeRadius.value=t.lkTubeRadius),e.uScale&&t.lkScale!==void 0&&(e.uScale.value=t.lkScale),e.uSpin&&t.lkSpin!==void 0&&(e.uSpin.value=t.lkSpin),e.uTilt&&t.lkTilt!==void 0&&(e.uTilt.value=t.lkTilt),e.uIntensity&&t.lkIntensity!==void 0&&(e.uIntensity.value=t.lkIntensity),e.uTubeColor&&e.uTubeColor.value.set(t.lkTubeR??1,t.lkTubeG??.5,t.lkTubeB??.85),e.uHorizonFade&&t.lkHorizonFade!==void 0&&(e.uHorizonFade.value=t.lkHorizonFade);break;case"helixParticleStream":e.uHelices&&t.hpsHelices!==void 0&&(e.uHelices.value=t.hpsHelices),e.uHelixRadius&&t.hpsHelixRadius!==void 0&&(e.uHelixRadius.value=t.hpsHelixRadius),e.uTurns&&t.hpsTurns!==void 0&&(e.uTurns.value=t.hpsTurns),e.uHeight&&t.hpsHeight!==void 0&&(e.uHeight.value=t.hpsHeight),e.uTubeRadius&&t.hpsTubeRadius!==void 0&&(e.uTubeRadius.value=t.hpsTubeRadius),e.uRiseSpeed&&t.hpsRiseSpeed!==void 0&&(e.uRiseSpeed.value=t.hpsRiseSpeed),e.uSpin&&t.hpsSpin!==void 0&&(e.uSpin.value=t.hpsSpin),e.uTilt&&t.hpsTilt!==void 0&&(e.uTilt.value=t.hpsTilt),e.uIntensity&&t.hpsIntensity!==void 0&&(e.uIntensity.value=t.hpsIntensity),e.uTint&&e.uTint.value.set(t.hpsTintR??.4,t.hpsTintG??1,t.hpsTintB??.7),e.uHorizonFade&&t.hpsHorizonFade!==void 0&&(e.uHorizonFade.value=t.hpsHorizonFade);break;case"donutConstellation":e.uMajorR&&t.dcMajorR!==void 0&&(e.uMajorR.value=t.dcMajorR),e.uMinorR&&t.dcMinorR!==void 0&&(e.uMinorR.value=t.dcMinorR),e.uStarCount&&t.dcStarCount!==void 0&&(e.uStarCount.value=t.dcStarCount),e.uStarSize&&t.dcStarSize!==void 0&&(e.uStarSize.value=t.dcStarSize),e.uSpin&&t.dcSpin!==void 0&&(e.uSpin.value=t.dcSpin),e.uTilt&&t.dcTilt!==void 0&&(e.uTilt.value=t.dcTilt),e.uTintIntensity&&t.dcTintIntensity!==void 0&&(e.uTintIntensity.value=t.dcTintIntensity),e.uTorusColor&&e.uTorusColor.value.set(t.dcTorusR??.8,t.dcTorusG??.4,t.dcTorusB??1),e.uStarColor&&e.uStarColor.value.set(t.dcStarR??1,t.dcStarG??1,t.dcStarB??.85),e.uHorizonFade&&t.dcHorizonFade!==void 0&&(e.uHorizonFade.value=t.dcHorizonFade);break;case"numberGrid":case"explode3D":case"sphereProject":case"cubeProject":case"cylinderWrap":case"torusTunnel":case"diamondGem":case"shatter3D":case"mobiusStrip":case"voxelDisplace":case"waveSurface":case"prismSplit":case"origamiFold":case"mirrorRoom":case"hexGrid":case"spiralTile":case"shingleStack":case"voronoiShatter":case"braillePattern":case"circuitBoard":case"stainedGlass":case"wovenFabric":case"mosaicTile":case"neonOutline":case"pixelSort":case"linocut":case"topoMap":case"ledWall":{if(e.uAmount&&(e.uAmount.value=t.amount??t.intensity??.5),e.uAmount2&&(e.uAmount2.value=t.amount2??t.size??.5),e.uAmount3&&(e.uAmount3.value=t.amount3??t.softness??.5),e.uThreshold&&(e.uThreshold.value=t.threshold??.5),e.uAngle&&(e.uAngle.value=t.angle??0),e.uCenter){const n=t.centerX??.5,c=t.centerY??.5;e.uCenter.value.set(n,c)}e.uColor&&e.uColor.value.set(t.red??.5,t.green??.5,t.blue??.5);break}case"tunnelFlight":e.uSpeed&&t.tunnelSpeed!==void 0&&(e.uSpeed.value=t.tunnelSpeed),e.uTwist&&t.tunnelTwist!==void 0&&(e.uTwist.value=t.tunnelTwist),e.uTunnelDepth&&t.tunnelDepth!==void 0&&(e.uTunnelDepth.value=t.tunnelDepth),e.uCenterX&&t.tunnelCenterX!==void 0&&(e.uCenterX.value=t.tunnelCenterX),e.uCenterY&&t.tunnelCenterY!==void 0&&(e.uCenterY.value=t.tunnelCenterY),e.uMode&&t.tunnelMode!==void 0&&(e.uMode.value=t.tunnelMode),e.uChromatic&&t.tunnelChromatic!==void 0&&(e.uChromatic.value=t.tunnelChromatic);break;case"infiniteMirror":e.uIterations&&t.infMirrorIterations!==void 0&&(e.uIterations.value=t.infMirrorIterations),e.uShrink&&t.infMirrorShrink!==void 0&&(e.uShrink.value=t.infMirrorShrink),e.uRotation&&t.infMirrorRotation!==void 0&&(e.uRotation.value=t.infMirrorRotation),e.uTintFade&&t.infMirrorTintFade!==void 0&&(e.uTintFade.value=t.infMirrorTintFade),e.uHueShift&&t.infMirrorHueShift!==void 0&&(e.uHueShift.value=t.infMirrorHueShift),e.uMode&&t.infMirrorMode!==void 0&&(e.uMode.value=t.infMirrorMode),e.uOffsetX&&t.infMirrorOffsetX!==void 0&&(e.uOffsetX.value=t.infMirrorOffsetX),e.uOffsetY&&t.infMirrorOffsetY!==void 0&&(e.uOffsetY.value=t.infMirrorOffsetY);break;case"fractalWarp":e.uAmount&&t.fractalWarpAmount!==void 0&&(e.uAmount.value=t.fractalWarpAmount),e.uScale&&t.fractalWarpScale!==void 0&&(e.uScale.value=t.fractalWarpScale),e.uOctaves&&t.fractalWarpOctaves!==void 0&&(e.uOctaves.value=t.fractalWarpOctaves),e.uSpeed&&t.fractalWarpSpeed!==void 0&&(e.uSpeed.value=t.fractalWarpSpeed),e.uChromatic&&t.fractalWarpChromatic!==void 0&&(e.uChromatic.value=t.fractalWarpChromatic),e.uMode&&t.fractalWarpMode!==void 0&&(e.uMode.value=t.fractalWarpMode);break;case"crystalRefract":e.uScale&&t.crystalScale!==void 0&&(e.uScale.value=t.crystalScale),e.uRefraction&&t.crystalRefraction!==void 0&&(e.uRefraction.value=t.crystalRefraction),e.uSparkle&&t.crystalSparkle!==void 0&&(e.uSparkle.value=t.crystalSparkle),e.uEdgeGlow&&t.crystalEdgeGlow!==void 0&&(e.uEdgeGlow.value=t.crystalEdgeGlow),e.uTintR&&t.crystalTintR!==void 0&&(e.uTintR.value=t.crystalTintR),e.uTintG&&t.crystalTintG!==void 0&&(e.uTintG.value=t.crystalTintG),e.uTintB&&t.crystalTintB!==void 0&&(e.uTintB.value=t.crystalTintB),e.uMode&&t.crystalMode!==void 0&&(e.uMode.value=t.crystalMode);break;case"fluidDistort":e.uAmount&&t.fluidDistAmount!==void 0&&(e.uAmount.value=t.fluidDistAmount),e.uScale&&t.fluidDistScale!==void 0&&(e.uScale.value=t.fluidDistScale),e.uSpeed&&t.fluidDistSpeed!==void 0&&(e.uSpeed.value=t.fluidDistSpeed),e.uTurbulence&&t.fluidDistTurbulence!==void 0&&(e.uTurbulence.value=t.fluidDistTurbulence),e.uMode&&t.fluidDistMode!==void 0&&(e.uMode.value=t.fluidDistMode);break;case"wormhole":e.uPullStrength&&t.wormholePullStrength!==void 0&&(e.uPullStrength.value=t.wormholePullStrength),e.uRotation&&t.wormholeRotation!==void 0&&(e.uRotation.value=t.wormholeRotation),e.uCenterX&&t.wormholeCenterX!==void 0&&(e.uCenterX.value=t.wormholeCenterX),e.uCenterY&&t.wormholeCenterY!==void 0&&(e.uCenterY.value=t.wormholeCenterY),e.uTwist&&t.wormholeTwist!==void 0&&(e.uTwist.value=t.wormholeTwist),e.uChromatic&&t.wormholeChromatic!==void 0&&(e.uChromatic.value=t.wormholeChromatic),e.uAnimSpeed&&t.wormholeAnimSpeed!==void 0&&(e.uAnimSpeed.value=t.wormholeAnimSpeed);break;case"geometricTile":e.uTiles&&t.geomTiles!==void 0&&(e.uTiles.value=t.geomTiles),e.uMode&&t.geomMode!==void 0&&(e.uMode.value=t.geomMode),e.uRotation&&t.geomRotation!==void 0&&(e.uRotation.value=t.geomRotation),e.uOffsetX&&t.geomOffsetX!==void 0&&(e.uOffsetX.value=t.geomOffsetX),e.uMix&&t.geomMix!==void 0&&(e.uMix.value=t.geomMix);break;case"geometricTilePro":e.uAmount&&t.geomProTileCount!==void 0&&(e.uAmount.value=t.geomProTileCount),e.uAmount2&&t.geomProFlipRange!==void 0&&(e.uAmount2.value=t.geomProFlipRange),e.uAmount3&&t.geomProSpeed!==void 0&&(e.uAmount3.value=t.geomProSpeed),e.uThreshold&&t.geomProGap!==void 0&&(e.uThreshold.value=t.geomProGap);break;case"motionTrails":e.uLength&&t.motionTrailsLength!==void 0&&(e.uLength.value=t.motionTrailsLength),e.uAngle&&t.motionTrailsAngle!==void 0&&(e.uAngle.value=t.motionTrailsAngle),e.uSamples&&t.motionTrailsSamples!==void 0&&(e.uSamples.value=t.motionTrailsSamples),e.uFalloff&&t.motionTrailsFalloff!==void 0&&(e.uFalloff.value=t.motionTrailsFalloff),e.uChromaSplit&&t.motionTrailsChromaSplit!==void 0&&(e.uChromaSplit.value=t.motionTrailsChromaSplit),e.uMode&&t.motionTrailsMode!==void 0&&(e.uMode.value=t.motionTrailsMode);break;case"echoRepeat":e.uCount&&t.echoCount!==void 0&&(e.uCount.value=t.echoCount),e.uOffsetX&&t.echoOffsetX!==void 0&&(e.uOffsetX.value=t.echoOffsetX),e.uOffsetY&&t.echoOffsetY!==void 0&&(e.uOffsetY.value=t.echoOffsetY),e.uDecay&&t.echoDecay!==void 0&&(e.uDecay.value=t.echoDecay),e.uHueShift&&t.echoHueShift!==void 0&&(e.uHueShift.value=t.echoHueShift),e.uMode&&t.echoMode!==void 0&&(e.uMode.value=t.echoMode);break;case"ghostDouble":e.uOpacity&&t.ghostOpacity!==void 0&&(e.uOpacity.value=t.ghostOpacity),e.uOffsetX&&t.ghostOffsetX!==void 0&&(e.uOffsetX.value=t.ghostOffsetX),e.uOffsetY&&t.ghostOffsetY!==void 0&&(e.uOffsetY.value=t.ghostOffsetY),e.uMirror&&t.ghostMirror!==void 0&&(e.uMirror.value=t.ghostMirror),e.uTintR&&t.ghostTintR!==void 0&&(e.uTintR.value=t.ghostTintR),e.uTintG&&t.ghostTintG!==void 0&&(e.uTintG.value=t.ghostTintG),e.uTintB&&t.ghostTintB!==void 0&&(e.uTintB.value=t.ghostTintB),e.uBlend&&t.ghostBlend!==void 0&&(e.uBlend.value=t.ghostBlend);break;case"strobeFlash":e.uRate&&t.strobeRate!==void 0&&(e.uRate.value=t.strobeRate),e.uDuty&&t.strobeDuty!==void 0&&(e.uDuty.value=t.strobeDuty),e.uIntensity&&t.strobeIntensity!==void 0&&(e.uIntensity.value=t.strobeIntensity),e.uMode&&t.strobeMode!==void 0&&(e.uMode.value=t.strobeMode),e.uTintR&&t.strobeTintR!==void 0&&(e.uTintR.value=t.strobeTintR),e.uTintG&&t.strobeTintG!==void 0&&(e.uTintG.value=t.strobeTintG),e.uTintB&&t.strobeTintB!==void 0&&(e.uTintB.value=t.strobeTintB);break;case"lightPaint":e.uIntensity&&t.lightPaintIntensity!==void 0&&(e.uIntensity.value=t.lightPaintIntensity),e.uThreshold&&t.lightPaintThreshold!==void 0&&(e.uThreshold.value=t.lightPaintThreshold),e.uTrailLength&&t.lightPaintTrailLength!==void 0&&(e.uTrailLength.value=t.lightPaintTrailLength),e.uFlowAngle&&t.lightPaintFlowAngle!==void 0&&(e.uFlowAngle.value=t.lightPaintFlowAngle),e.uFlowScale&&t.lightPaintFlowScale!==void 0&&(e.uFlowScale.value=t.lightPaintFlowScale),e.uChromaShift&&t.lightPaintChromaShift!==void 0&&(e.uChromaShift.value=t.lightPaintChromaShift),e.uTintR&&t.lightPaintTintR!==void 0&&(e.uTintR.value=t.lightPaintTintR),e.uTintG&&t.lightPaintTintG!==void 0&&(e.uTintG.value=t.lightPaintTintG),e.uTintB&&t.lightPaintTintB!==void 0&&(e.uTintB.value=t.lightPaintTintB);break;case"recursiveEcho":e.uDepth&&t.recEchoDepth!==void 0&&(e.uDepth.value=t.recEchoDepth),e.uZoom&&t.recEchoZoom!==void 0&&(e.uZoom.value=t.recEchoZoom),e.uRotation&&t.recEchoRotation!==void 0&&(e.uRotation.value=t.recEchoRotation),e.uOpacity&&t.recEchoOpacity!==void 0&&(e.uOpacity.value=t.recEchoOpacity),e.uHueShift&&t.recEchoHueShift!==void 0&&(e.uHueShift.value=t.recEchoHueShift),e.uOffsetX&&t.recEchoOffsetX!==void 0&&(e.uOffsetX.value=t.recEchoOffsetX),e.uOffsetY&&t.recEchoOffsetY!==void 0&&(e.uOffsetY.value=t.recEchoOffsetY),e.uMode&&t.recEchoMode!==void 0&&(e.uMode.value=t.recEchoMode);break;case"invert":e.uMode&&t.invertMode!==void 0&&(e.uMode.value=t.invertMode),e.uAmount&&t.invertAmount!==void 0&&(e.uAmount.value=t.invertAmount),e.uThreshold&&t.invertThreshold!==void 0&&(e.uThreshold.value=t.invertThreshold),e.uStrobeRate&&t.invertStrobeRate!==void 0&&(e.uStrobeRate.value=t.invertStrobeRate);break;case"blobTrack":case"blobContour":case"blobHeatmap":e.uThreshold&&(e.uThreshold.value=t.blobThreshold??.3),e.uShape&&(e.uShape.value=t.blobShape??0),e.uColor&&(e.uColor.value=t.blobColor??0),e.uThickness&&(e.uThickness.value=t.blobThickness??2),e.uMinSize&&(e.uMinSize.value=t.blobMinSize??.02),e.uMaxBlobs&&(e.uMaxBlobs.value=t.blobMaxBlobs??32),e.uShowCoords&&(e.uShowCoords.value=t.blobShowCoords??1),e.uShowBBox&&(e.uShowBBox.value=t.blobShowBBox??1),e.uShowCenter&&(e.uShowCenter.value=t.blobShowCenter??1),e.uTrailLength&&(e.uTrailLength.value=t.blobTrailLength??.3),e.uGridSize&&(e.uGridSize.value=t.blobGridSize??16),e.uMix&&(e.uMix.value=t.blobMix??.8),e.uColorMode&&(e.uColorMode.value=t.blobColorMode??0),e.uFixedColor&&e.uFixedColor.value.set(t.blobFixedColorR??0,t.blobFixedColorG??1,t.blobFixedColorB??.4),e.uMarkerSize&&(e.uMarkerSize.value=t.blobMarkerSize??1),e.uBlendMode&&(e.uBlendMode.value=t.blobBlendMode??0);break;case"timeSmear":case"chronophoto":e.uMode&&(e.uMode.value=t.mode??0),e.uAmount&&(e.uAmount.value=t.amount??.5),e.uAmount2&&(e.uAmount2.value=t.amount2??.5),e.uAmount3&&(e.uAmount3.value=t.amount3??.7),e.uSpeed&&(e.uSpeed.value=t.speed??1);break;case"opticalFlowDatamosh":e.uIntensity&&t.ofdmIntensity!==void 0&&(e.uIntensity.value=t.ofdmIntensity),e.uMotionScale&&t.ofdmMotionScale!==void 0&&(e.uMotionScale.value=t.ofdmMotionScale),e.uPersistence&&t.ofdmPersistence!==void 0&&(e.uPersistence.value=t.ofdmPersistence),e.uChromaSplit&&t.ofdmChromaSplit!==void 0&&(e.uChromaSplit.value=t.ofdmChromaSplit),e.uBlockSize&&t.ofdmBlockSize!==void 0&&(e.uBlockSize.value=t.ofdmBlockSize),e.uFreeze&&t.ofdmFreeze!==void 0&&(e.uFreeze.value=t.ofdmFreeze),e.uMode&&t.ofdmMode!==void 0&&(e.uMode.value=t.ofdmMode);break;case"flowFieldTrails":e.uFlowScale&&t.fftFlowScale!==void 0&&(e.uFlowScale.value=t.fftFlowScale),e.uTrailLength&&t.fftTrailLength!==void 0&&(e.uTrailLength.value=t.fftTrailLength),e.uSamples&&t.fftSamples!==void 0&&(e.uSamples.value=t.fftSamples),e.uSpeed&&t.fftSpeed!==void 0&&(e.uSpeed.value=t.fftSpeed),e.uChromaSplit&&t.fftChromaSplit!==void 0&&(e.uChromaSplit.value=t.fftChromaSplit),e.uContrast&&t.fftContrast!==void 0&&(e.uContrast.value=t.fftContrast),e.uMode&&t.fftMode!==void 0&&(e.uMode.value=t.fftMode),e.uColorCycle&&t.fftColorCycle!==void 0&&(e.uColorCycle.value=t.fftColorCycle);break;case"reactionDiffusion":e.uFeedRate&&t.rdFeedRate!==void 0&&(e.uFeedRate.value=t.rdFeedRate),e.uKillRate&&t.rdKillRate!==void 0&&(e.uKillRate.value=t.rdKillRate),e.uDiffusionA&&t.rdDiffusionA!==void 0&&(e.uDiffusionA.value=t.rdDiffusionA),e.uDiffusionB&&t.rdDiffusionB!==void 0&&(e.uDiffusionB.value=t.rdDiffusionB),e.uPatternScale&&t.rdPatternScale!==void 0&&(e.uPatternScale.value=t.rdPatternScale),e.uLumaMask&&t.rdLumaMask!==void 0&&(e.uLumaMask.value=t.rdLumaMask),e.uMode&&t.rdMode!==void 0&&(e.uMode.value=t.rdMode),e.uColorR&&t.rdColorR!==void 0&&(e.uColorR.value=t.rdColorR),e.uColorG&&t.rdColorG!==void 0&&(e.uColorG.value=t.rdColorG),e.uColorB&&t.rdColorB!==void 0&&(e.uColorB.value=t.rdColorB),e.uMix&&t.rdMix!==void 0&&(e.uMix.value=t.rdMix),e.uReseed&&t.rdReseed!==void 0&&(e.uReseed.value=t.rdReseed);break;case"neonTubeTrace":e.uEdgeThreshold&&t.ntEdgeThreshold!==void 0&&(e.uEdgeThreshold.value=t.ntEdgeThreshold),e.uTubeWidth&&t.ntTubeWidth!==void 0&&(e.uTubeWidth.value=t.ntTubeWidth),e.uGlow&&t.ntGlow!==void 0&&(e.uGlow.value=t.ntGlow),e.uGlowRadius&&t.ntGlowRadius!==void 0&&(e.uGlowRadius.value=t.ntGlowRadius),e.uTintR&&t.ntTintR!==void 0&&(e.uTintR.value=t.ntTintR),e.uTintG&&t.ntTintG!==void 0&&(e.uTintG.value=t.ntTintG),e.uTintB&&t.ntTintB!==void 0&&(e.uTintB.value=t.ntTintB),e.uChase&&t.ntChase!==void 0&&(e.uChase.value=t.ntChase),e.uChaseSpeed&&t.ntChaseSpeed!==void 0&&(e.uChaseSpeed.value=t.ntChaseSpeed),e.uFlicker&&t.ntFlicker!==void 0&&(e.uFlicker.value=t.ntFlicker),e.uBg&&t.ntBg!==void 0&&(e.uBg.value=t.ntBg);break;case"depthParallax":e.uDepthStrength&&t.dpDepthStrength!==void 0&&(e.uDepthStrength.value=t.dpDepthStrength),e.uPushIn&&t.dpPushIn!==void 0&&(e.uPushIn.value=t.dpPushIn),e.uLayers&&t.dpLayers!==void 0&&(e.uLayers.value=t.dpLayers),e.uChromatic&&t.dpChromatic!==void 0&&(e.uChromatic.value=t.dpChromatic),e.uDepthBoost&&t.dpDepthBoost!==void 0&&(e.uDepthBoost.value=t.dpDepthBoost),e.uMode&&t.dpMode!==void 0&&(e.uMode.value=t.dpMode),e.uPanX&&t.dpPanX!==void 0&&(e.uPanX.value=t.dpPanX),e.uPanY&&t.dpPanY!==void 0&&(e.uPanY.value=t.dpPanY);break;case"pointCloudDissolve":e.uDissolve&&t.pcdDissolve!==void 0&&(e.uDissolve.value=t.pcdDissolve),e.uDotSize&&t.pcdDotSize!==void 0&&(e.uDotSize.value=t.pcdDotSize),e.uScatterRadius&&t.pcdScatterRadius!==void 0&&(e.uScatterRadius.value=t.pcdScatterRadius),e.uAttract&&t.pcdAttract!==void 0&&(e.uAttract.value=t.pcdAttract),e.uTurbulence&&t.pcdTurbulence!==void 0&&(e.uTurbulence.value=t.pcdTurbulence),e.uMode&&t.pcdMode!==void 0&&(e.uMode.value=t.pcdMode),e.uBgR&&t.pcdBgR!==void 0&&(e.uBgR.value=t.pcdBgR),e.uBgG&&t.pcdBgG!==void 0&&(e.uBgG.value=t.pcdBgG),e.uBgB&&t.pcdBgB!==void 0&&(e.uBgB.value=t.pcdBgB),e.uHueShift&&t.pcdHueShift!==void 0&&(e.uHueShift.value=t.pcdHueShift);break;case"pixelSand":e.uGravity&&t.psGravity!==void 0&&(e.uGravity.value=t.psGravity),e.uTurbulence&&t.psTurbulence!==void 0&&(e.uTurbulence.value=t.psTurbulence),e.uThreshold&&t.psThreshold!==void 0&&(e.uThreshold.value=t.psThreshold),e.uPersistence&&t.psPersistence!==void 0&&(e.uPersistence.value=t.psPersistence),e.uMode&&t.psMode!==void 0&&(e.uMode.value=t.psMode),e.uReplenish&&t.psReplenish!==void 0&&(e.uReplenish.value=t.psReplenish),e.uChromaSplit&&t.psChromaSplit!==void 0&&(e.uChromaSplit.value=t.psChromaSplit),e.uGrainSize&&t.psGrainSize!==void 0&&(e.uGrainSize.value=t.psGrainSize);break;case"liquidGlass":e.uBlobs&&t.lgBlobs!==void 0&&(e.uBlobs.value=t.lgBlobs),e.uBlobSize&&t.lgBlobSize!==void 0&&(e.uBlobSize.value=t.lgBlobSize),e.uRefraction&&t.lgRefraction!==void 0&&(e.uRefraction.value=t.lgRefraction),e.uChromatic&&t.lgChromatic!==void 0&&(e.uChromatic.value=t.lgChromatic),e.uSpecular&&t.lgSpecular!==void 0&&(e.uSpecular.value=t.lgSpecular),e.uCausticAmount&&t.lgCausticAmount!==void 0&&(e.uCausticAmount.value=t.lgCausticAmount),e.uSpeed&&t.lgSpeed!==void 0&&(e.uSpeed.value=t.lgSpeed),e.uTintR&&t.lgTintR!==void 0&&(e.uTintR.value=t.lgTintR),e.uTintG&&t.lgTintG!==void 0&&(e.uTintG.value=t.lgTintG),e.uTintB&&t.lgTintB!==void 0&&(e.uTintB.value=t.lgTintB);break;case"hologramScan":e.uIntensity&&t.hsIntensity!==void 0&&(e.uIntensity.value=t.hsIntensity),e.uScanFreq&&t.hsScanFreq!==void 0&&(e.uScanFreq.value=t.hsScanFreq),e.uScanSpeed&&t.hsScanSpeed!==void 0&&(e.uScanSpeed.value=t.hsScanSpeed),e.uGridSpacing&&t.hsGridSpacing!==void 0&&(e.uGridSpacing.value=t.hsGridSpacing),e.uRGBFlicker&&t.hsRGBFlicker!==void 0&&(e.uRGBFlicker.value=t.hsRGBFlicker),e.uBrokenBands&&t.hsBrokenBands!==void 0&&(e.uBrokenBands.value=t.hsBrokenBands),e.uTintR&&t.hsTintR!==void 0&&(e.uTintR.value=t.hsTintR),e.uTintG&&t.hsTintG!==void 0&&(e.uTintG.value=t.hsTintG),e.uTintB&&t.hsTintB!==void 0&&(e.uTintB.value=t.hsTintB),e.uOpacityFlicker&&t.hsOpacityFlicker!==void 0&&(e.uOpacityFlicker.value=t.hsOpacityFlicker),e.uEdgeGlow&&t.hsEdgeGlow!==void 0&&(e.uEdgeGlow.value=t.hsEdgeGlow);break;case"laserSlice":e.uMode&&t.lsMode!==void 0&&(e.uMode.value=t.lsMode),e.uSpeed&&t.lsSpeed!==void 0&&(e.uSpeed.value=t.lsSpeed),e.uBeamWidth&&t.lsBeamWidth!==void 0&&(e.uBeamWidth.value=t.lsBeamWidth),e.uGlow&&t.lsGlow!==void 0&&(e.uGlow.value=t.lsGlow),e.uSparks&&t.lsSparks!==void 0&&(e.uSparks.value=t.lsSparks),e.uEraseAmount&&t.lsEraseAmount!==void 0&&(e.uEraseAmount.value=t.lsEraseAmount),e.uTintR&&t.lsTintR!==void 0&&(e.uTintR.value=t.lsTintR),e.uTintG&&t.lsTintG!==void 0&&(e.uTintG.value=t.lsTintG),e.uTintB&&t.lsTintB!==void 0&&(e.uTintB.value=t.lsTintB),e.uReveal&&t.lsReveal!==void 0&&(e.uReveal.value=t.lsReveal),e.uPersistence&&t.lsPersistence!==void 0&&(e.uPersistence.value=t.lsPersistence);break;case"auraField":e.uIntensity&&t.afIntensity!==void 0&&(e.uIntensity.value=t.afIntensity),e.uRadius&&t.afRadius!==void 0&&(e.uRadius.value=t.afRadius),e.uEdgeAmount&&t.afEdgeAmount!==void 0&&(e.uEdgeAmount.value=t.afEdgeAmount),e.uLumaAmount&&t.afLumaAmount!==void 0&&(e.uLumaAmount.value=t.afLumaAmount),e.uAudioReact&&t.afAudioReact!==void 0&&(e.uAudioReact.value=t.afAudioReact),e.uHueShift&&t.afHueShift!==void 0&&(e.uHueShift.value=t.afHueShift),e.uTintR&&t.afTintR!==void 0&&(e.uTintR.value=t.afTintR),e.uTintG&&t.afTintG!==void 0&&(e.uTintG.value=t.afTintG),e.uTintB&&t.afTintB!==void 0&&(e.uTintB.value=t.afTintB),e.uMode&&t.afMode!==void 0&&(e.uMode.value=t.afMode);break;case"smokeDisintegrate":e.uAmount&&t.smokeAmount!==void 0&&(e.uAmount.value=t.smokeAmount),e.uScale&&t.smokeScale!==void 0&&(e.uScale.value=t.smokeScale),e.uSpeed&&t.smokeSpeed!==void 0&&(e.uSpeed.value=t.smokeSpeed),e.uDirection&&t.smokeDirection!==void 0&&(e.uDirection.value=t.smokeDirection),e.uEdgeFade&&t.smokeEdgeFade!==void 0&&(e.uEdgeFade.value=t.smokeEdgeFade),e.uSmokeColorR&&t.smokeColorR!==void 0&&(e.uSmokeColorR.value=t.smokeColorR),e.uSmokeColorG&&t.smokeColorG!==void 0&&(e.uSmokeColorG.value=t.smokeColorG),e.uSmokeColorB&&t.smokeColorB!==void 0&&(e.uSmokeColorB.value=t.smokeColorB),e.uMode&&t.smokeMode!==void 0&&(e.uMode.value=t.smokeMode);break;case"shimmerCloth":e.uAmplitude&&t.clothAmplitude!==void 0&&(e.uAmplitude.value=t.clothAmplitude),e.uFrequency&&t.clothFrequency!==void 0&&(e.uFrequency.value=t.clothFrequency),e.uSpeed&&t.clothSpeed!==void 0&&(e.uSpeed.value=t.clothSpeed),e.uThreadDensity&&t.clothThreadDensity!==void 0&&(e.uThreadDensity.value=t.clothThreadDensity),e.uThreadDepth&&t.clothThreadDepth!==void 0&&(e.uThreadDepth.value=t.clothThreadDepth),e.uShimmer&&t.clothShimmer!==void 0&&(e.uShimmer.value=t.clothShimmer),e.uMode&&t.clothMode!==void 0&&(e.uMode.value=t.clothMode);break;case"glitchQuilt":e.uTileSize&&t.gqTileSize!==void 0&&(e.uTileSize.value=t.gqTileSize),e.uShuffleAmount&&t.gqShuffleAmount!==void 0&&(e.uShuffleAmount.value=t.gqShuffleAmount),e.uRotateAmount&&t.gqRotateAmount!==void 0&&(e.uRotateAmount.value=t.gqRotateAmount),e.uDelayAmount&&t.gqDelayAmount!==void 0&&(e.uDelayAmount.value=t.gqDelayAmount),e.uChromaSplit&&t.gqChromaSplit!==void 0&&(e.uChromaSplit.value=t.gqChromaSplit),e.uTriggerRate&&t.gqTriggerRate!==void 0&&(e.uTriggerRate.value=t.gqTriggerRate),e.uMode&&t.gqMode!==void 0&&(e.uMode.value=t.gqMode);break;case"cellularAutomataBurn":e.uCellSize&&t.caCellSize!==void 0&&(e.uCellSize.value=t.caCellSize),e.uBirthThreshold&&t.caBirthThreshold!==void 0&&(e.uBirthThreshold.value=t.caBirthThreshold),e.uSurvivalLow&&t.caSurvivalLow!==void 0&&(e.uSurvivalLow.value=t.caSurvivalLow),e.uSurvivalHigh&&t.caSurvivalHigh!==void 0&&(e.uSurvivalHigh.value=t.caSurvivalHigh),e.uColorR&&t.caColorR!==void 0&&(e.uColorR.value=t.caColorR),e.uColorG&&t.caColorG!==void 0&&(e.uColorG.value=t.caColorG),e.uColorB&&t.caColorB!==void 0&&(e.uColorB.value=t.caColorB),e.uMode&&t.caMode!==void 0&&(e.uMode.value=t.caMode),e.uMix&&t.caMix!==void 0&&(e.uMix.value=t.caMix);break;case"rorschachMirror":e.uMode&&t.rmMode!==void 0&&(e.uMode.value=t.rmMode),e.uInkAmount&&t.rmInkAmount!==void 0&&(e.uInkAmount.value=t.rmInkAmount),e.uFluidEdges&&t.rmFluidEdges!==void 0&&(e.uFluidEdges.value=t.rmFluidEdges),e.uTintR&&t.rmTintR!==void 0&&(e.uTintR.value=t.rmTintR),e.uTintG&&t.rmTintG!==void 0&&(e.uTintG.value=t.rmTintG),e.uTintB&&t.rmTintB!==void 0&&(e.uTintB.value=t.rmTintB),e.uBgR&&t.rmBgR!==void 0&&(e.uBgR.value=t.rmBgR),e.uBgG&&t.rmBgG!==void 0&&(e.uBgG.value=t.rmBgG),e.uBgB&&t.rmBgB!==void 0&&(e.uBgB.value=t.rmBgB),e.uMixOriginal&&t.rmMixOriginal!==void 0&&(e.uMixOriginal.value=t.rmMixOriginal);break;case"spectralPrismTunnel":e.uTunnelDepth&&t.sptTunnelDepth!==void 0&&(e.uTunnelDepth.value=t.sptTunnelDepth),e.uPrismSpread&&t.sptPrismSpread!==void 0&&(e.uPrismSpread.value=t.sptPrismSpread),e.uRotation&&t.sptRotation!==void 0&&(e.uRotation.value=t.sptRotation),e.uSpeed&&t.sptSpeed!==void 0&&(e.uSpeed.value=t.sptSpeed),e.uSlices&&t.sptSlices!==void 0&&(e.uSlices.value=t.sptSlices),e.uFade&&t.sptFade!==void 0&&(e.uFade.value=t.sptFade);break;case"ledVolume":e.uVoxelSize&&t.ledVoxelSize!==void 0&&(e.uVoxelSize.value=t.ledVoxelSize),e.uDepthPulse&&t.ledDepthPulse!==void 0&&(e.uDepthPulse.value=t.ledDepthPulse),e.uDepthSpeed&&t.ledDepthSpeed!==void 0&&(e.uDepthSpeed.value=t.ledDepthSpeed),e.uPosterize&&t.ledPosterize!==void 0&&(e.uPosterize.value=t.ledPosterize),e.uGlow&&t.ledGlow!==void 0&&(e.uGlow.value=t.ledGlow),e.uPerspective&&t.ledPerspective!==void 0&&(e.uPerspective.value=t.ledPerspective),e.uMode&&t.ledMode!==void 0&&(e.uMode.value=t.ledMode),e.uBgR&&t.ledBgR!==void 0&&(e.uBgR.value=t.ledBgR),e.uBgG&&t.ledBgG!==void 0&&(e.uBgG.value=t.ledBgG),e.uBgB&&t.ledBgB!==void 0&&(e.uBgB.value=t.ledBgB);break;case"posterTear":e.uTearAmount&&t.ptTearAmount!==void 0&&(e.uTearAmount.value=t.ptTearAmount),e.uTearAngle&&t.ptTearAngle!==void 0&&(e.uTearAngle.value=t.ptTearAngle),e.uTearJitter&&t.ptTearJitter!==void 0&&(e.uTearJitter.value=t.ptTearJitter),e.uShiftBelow&&t.ptShiftBelow!==void 0&&(e.uShiftBelow.value=t.ptShiftBelow),e.uOffsetX&&t.ptOffsetX!==void 0&&(e.uOffsetX.value=t.ptOffsetX),e.uOffsetY&&t.ptOffsetY!==void 0&&(e.uOffsetY.value=t.ptOffsetY),e.uTearGlow&&t.ptTearGlow!==void 0&&(e.uTearGlow.value=t.ptTearGlow),e.uMode&&t.ptMode!==void 0&&(e.uMode.value=t.ptMode);break;case"paintPeel":e.uAmount&&t.ppAmount!==void 0&&(e.uAmount.value=t.ppAmount),e.uScale&&t.ppScale!==void 0&&(e.uScale.value=t.ppScale),e.uLumaBias&&t.ppLumaBias!==void 0&&(e.uLumaBias.value=t.ppLumaBias),e.uCurl&&t.ppCurl!==void 0&&(e.uCurl.value=t.ppCurl),e.uShadow&&t.ppShadow!==void 0&&(e.uShadow.value=t.ppShadow),e.uBgR&&t.ppBgR!==void 0&&(e.uBgR.value=t.ppBgR),e.uBgG&&t.ppBgG!==void 0&&(e.uBgG.value=t.ppBgG),e.uBgB&&t.ppBgB!==void 0&&(e.uBgB.value=t.ppBgB),e.uMode&&t.ppMode!==void 0&&(e.uMode.value=t.ppMode);break;case"audioShockBloom":e.uIntensity&&t.asbIntensity!==void 0&&(e.uIntensity.value=t.asbIntensity),e.uBloomThreshold&&t.asbBloomThreshold!==void 0&&(e.uBloomThreshold.value=t.asbBloomThreshold),e.uBloomRadius&&t.asbBloomRadius!==void 0&&(e.uBloomRadius.value=t.asbBloomRadius),e.uShockSpeed&&t.asbShockSpeed!==void 0&&(e.uShockSpeed.value=t.asbShockSpeed),e.uShockAmplitude&&t.asbShockAmplitude!==void 0&&(e.uShockAmplitude.value=t.asbShockAmplitude),e.uChromaSplit&&t.asbChromaSplit!==void 0&&(e.uChromaSplit.value=t.asbChromaSplit),e.uStrobeAmount&&t.asbStrobeAmount!==void 0&&(e.uStrobeAmount.value=t.asbStrobeAmount),e.uTintR&&t.asbTintR!==void 0&&(e.uTintR.value=t.asbTintR),e.uTintG&&t.asbTintG!==void 0&&(e.uTintG.value=t.asbTintG),e.uTintB&&t.asbTintB!==void 0&&(e.uTintB.value=t.asbTintB),e.uAudioGate&&t.asbAudioGate!==void 0&&(e.uAudioGate.value=t.asbAudioGate);break;case"vhsFullDeck":e.uTracking&&t.vhsFdTracking!==void 0&&(e.uTracking.value=t.vhsFdTracking),e.uHeadSwitch&&t.vhsFdHeadSwitch!==void 0&&(e.uHeadSwitch.value=t.vhsFdHeadSwitch),e.uChromaBleed&&t.vhsFdChromaBleed!==void 0&&(e.uChromaBleed.value=t.vhsFdChromaBleed),e.uDropouts&&t.vhsFdDropouts!==void 0&&(e.uDropouts.value=t.vhsFdDropouts),e.uTapeNoise&&t.vhsFdTapeNoise!==void 0&&(e.uTapeNoise.value=t.vhsFdTapeNoise),e.uScanlines&&t.vhsFdScanlines!==void 0&&(e.uScanlines.value=t.vhsFdScanlines),e.uColorBleed&&t.vhsFdColorBleed!==void 0&&(e.uColorBleed.value=t.vhsFdColorBleed),e.uSaturation&&t.vhsFdSaturation!==void 0&&(e.uSaturation.value=t.vhsFdSaturation),e.uTrackingJump&&t.vhsFdTrackingJump!==void 0&&(e.uTrackingJump.value=t.vhsFdTrackingJump),e.uMode&&t.vhsFdMode!==void 0&&(e.uMode.value=t.vhsFdMode);break;case"analogFeedbackRack":e.uMix&&t.afrMix!==void 0&&(e.uMix.value=t.afrMix),e.uZoom&&t.afrZoom!==void 0&&(e.uZoom.value=t.afrZoom),e.uRotation&&t.afrRotation!==void 0&&(e.uRotation.value=t.afrRotation),e.uDecay&&t.afrDecay!==void 0&&(e.uDecay.value=t.afrDecay),e.uHueShift&&t.afrHueShift!==void 0&&(e.uHueShift.value=t.afrHueShift),e.uMaskCenter&&t.afrMaskCenter!==void 0&&(e.uMaskCenter.value=t.afrMaskCenter),e.uChromaSplit&&t.afrChromaSplit!==void 0&&(e.uChromaSplit.value=t.afrChromaSplit),e.uOffsetX&&t.afrOffsetX!==void 0&&(e.uOffsetX.value=t.afrOffsetX),e.uOffsetY&&t.afrOffsetY!==void 0&&(e.uOffsetY.value=t.afrOffsetY),e.uMode&&t.afrMode!==void 0&&(e.uMode.value=t.afrMode);break;case"clubLaserGrid":e.uIntensity&&t.clgIntensity!==void 0&&(e.uIntensity.value=t.clgIntensity),e.uGridDensity&&t.clgGridDensity!==void 0&&(e.uGridDensity.value=t.clgGridDensity),e.uPerspective&&t.clgPerspective!==void 0&&(e.uPerspective.value=t.clgPerspective),e.uSpeed&&t.clgSpeed!==void 0&&(e.uSpeed.value=t.clgSpeed),e.uIntersectionGlow&&t.clgIntersectionGlow!==void 0&&(e.uIntersectionGlow.value=t.clgIntersectionGlow),e.uLineWidth&&t.clgLineWidth!==void 0&&(e.uLineWidth.value=t.clgLineWidth),e.uTintR&&t.clgTintR!==void 0&&(e.uTintR.value=t.clgTintR),e.uTintG&&t.clgTintG!==void 0&&(e.uTintG.value=t.clgTintG),e.uTintB&&t.clgTintB!==void 0&&(e.uTintB.value=t.clgTintB),e.uAudioReact&&t.clgAudioReact!==void 0&&(e.uAudioReact.value=t.clgAudioReact),e.uMode&&t.clgMode!==void 0&&(e.uMode.value=t.clgMode);break;case"mirrorShards":e.uShards&&t.msShards!==void 0&&(e.uShards.value=t.msShards),e.uShardSize&&t.msShardSize!==void 0&&(e.uShardSize.value=t.msShardSize),e.uRotation&&t.msRotation!==void 0&&(e.uRotation.value=t.msRotation),e.uDelayAmount&&t.msDelayAmount!==void 0&&(e.uDelayAmount.value=t.msDelayAmount),e.uChromatic&&t.msChromatic!==void 0&&(e.uChromatic.value=t.msChromatic),e.uMode&&t.msMode!==void 0&&(e.uMode.value=t.msMode);break;case"ghostExposure":e.uExposure&&t.geExposure!==void 0&&(e.uExposure.value=t.geExposure),e.uDecay&&t.geDecay!==void 0&&(e.uDecay.value=t.geDecay),e.uHueShiftPerFrame&&t.geHueShiftPerFrame!==void 0&&(e.uHueShiftPerFrame.value=t.geHueShiftPerFrame),e.uIntensity&&t.geIntensity!==void 0&&(e.uIntensity.value=t.geIntensity),e.uMode&&t.geMode!==void 0&&(e.uMode.value=t.geMode),e.uClamp&&t.geClamp!==void 0&&(e.uClamp.value=t.geClamp);break;case"thermalContour":e.uPalette&&t.tcPalette!==void 0&&(e.uPalette.value=t.tcPalette),e.uContourCount&&t.tcContourCount!==void 0&&(e.uContourCount.value=t.tcContourCount),e.uContourWidth&&t.tcContourWidth!==void 0&&(e.uContourWidth.value=t.tcContourWidth),e.uContourGlow&&t.tcContourGlow!==void 0&&(e.uContourGlow.value=t.tcContourGlow),e.uIntensity&&t.tcIntensity!==void 0&&(e.uIntensity.value=t.tcIntensity),e.uTrackBlobs&&t.tcTrackBlobs!==void 0&&(e.uTrackBlobs.value=t.tcTrackBlobs),e.uMix&&t.tcMix!==void 0&&(e.uMix.value=t.tcMix);break;case"dreamDiffusion":e.uBloomAmount&&t.ddBloomAmount!==void 0&&(e.uBloomAmount.value=t.ddBloomAmount),e.uBloomRadius&&t.ddBloomRadius!==void 0&&(e.uBloomRadius.value=t.ddBloomRadius),e.uHalation&&t.ddHalation!==void 0&&(e.uHalation.value=t.ddHalation),e.uChromaticBlur&&t.ddChromaticBlur!==void 0&&(e.uChromaticBlur.value=t.ddChromaticBlur),e.uPastelRolloff&&t.ddPastelRolloff!==void 0&&(e.uPastelRolloff.value=t.ddPastelRolloff),e.uShadowLift&&t.ddShadowLift!==void 0&&(e.uShadowLift.value=t.ddShadowLift),e.uSoftness&&t.ddSoftness!==void 0&&(e.uSoftness.value=t.ddSoftness),e.uTintR&&t.ddTintR!==void 0&&(e.uTintR.value=t.ddTintR),e.uTintG&&t.ddTintG!==void 0&&(e.uTintG.value=t.ddTintG),e.uTintB&&t.ddTintB!==void 0&&(e.uTintB.value=t.ddTintB);break;case"topoWarp":e.uContourCount&&t.twContourCount!==void 0&&(e.uContourCount.value=t.twContourCount),e.uContourWidth&&t.twContourWidth!==void 0&&(e.uContourWidth.value=t.twContourWidth),e.uDisplacement&&t.twDisplacement!==void 0&&(e.uDisplacement.value=t.twDisplacement),e.uChromaticEdge&&t.twChromaticEdge!==void 0&&(e.uChromaticEdge.value=t.twChromaticEdge),e.uColorR&&t.twColorR!==void 0&&(e.uColorR.value=t.twColorR),e.uColorG&&t.twColorG!==void 0&&(e.uColorG.value=t.twColorG),e.uColorB&&t.twColorB!==void 0&&(e.uColorB.value=t.twColorB),e.uShadowRidges&&t.twShadowRidges!==void 0&&(e.uShadowRidges.value=t.twShadowRidges),e.uMix&&t.twMix!==void 0&&(e.uMix.value=t.twMix);break;case"strobeSequencer":e.uBPM&&t.ssBPM!==void 0&&(e.uBPM.value=t.ssBPM),e.uSteps&&t.ssSteps!==void 0&&(e.uSteps.value=t.ssSteps),e.uPattern&&t.ssPattern!==void 0&&(e.uPattern.value=t.ssPattern),e.uMode&&t.ssMode!==void 0&&(e.uMode.value=t.ssMode),e.uIntensity&&t.ssIntensity!==void 0&&(e.uIntensity.value=t.ssIntensity),e.uTintR&&t.ssTintR!==void 0&&(e.uTintR.value=t.ssTintR),e.uTintG&&t.ssTintG!==void 0&&(e.uTintG.value=t.ssTintG),e.uTintB&&t.ssTintB!==void 0&&(e.uTintB.value=t.ssTintB),e.uSwing&&t.ssSwing!==void 0&&(e.uSwing.value=t.ssSwing);break}}function kn(u){const i=Tt(u);if(i)return i.defaults;switch(u){case"gpuFluidSim":return{injectStrength:1.5,velocityFromGradient:1.4,vorticity:1,dyeDecay:2.4,velocityDecay:2.3,outputBoost:.7,timeScale:1.6};case"vignette":return{vignetteSize:.8,vignetteSoftness:.4,vignetteRoundness:.5,vignetteShape:0,vignetteAspect:1,vignetteCenterX:.5,vignetteCenterY:.5,vignetteColorR:0,vignetteColorG:0,vignetteColorB:0,vignetteTintAmount:0,vignetteBreathing:0,vignetteBreathSpeed:.5};case"edgeFeather":return{featherTop:0,featherBottom:0,featherLeft:0,featherRight:0,featherSoftness:.5,featherGamma:1,featherMattePreview:0};case"colorama":return{coloramaPalette:0,coloramaOffset:0,coloramaSpeed:.2,coloramaContrast:1,coloramaMix:1,coloramaBands:0,coloramaAudioReact:0,coloramaHueShift:0};case"dither":return{ditherType:0,ditherIntensity:1,ditherScale:1,ditherColorDepth:2,ditherPalette:0,ditherPixelLock:0};case"vhs":return{vhsTracking:.5,vhsNoise:.3,vhsDistortion:.3,vhsColorBleed:.5,vhsScanlines:.3,vhsHeadSwitch:0,vhsTapeWobble:0,vhsDropout:0,vhsChromaDelay:0,vhsTrackingJump:0,vhsSaturation:1};case"glitch":return{glitchIntensity:.5,glitchSpeed:1,glitchBlockSize:.3,glitchRGBSplit:.5,glitchJitter:.3,glitchTriggerMode:0,glitchBlockHold:.3,glitchVerticalSlice:0,glitchFreezeBurst:0,glitchTearChance:0};case"rgbShift":return{rgbShiftAmount:5,rgbShiftAngle:0,rgbShiftMode:0,rgbShiftCenterX:.5,rgbShiftCenterY:.5,rgbShiftPrismSpread:1};case"scanlines":return{scanlinesIntensity:.5,scanlinesCount:200,scanlinesSpeed:0,scanlinesPhosphor:0,scanlinesRollingBar:0,scanlinesCurvature:0,scanlinesInterlace:0};case"pixelate":return{pixelateSize:8,pixelateMode:0,pixelateGrid:0,pixelateAnimSpeed:0,pixelateAnimAmount:0};case"blur":return{blurRadius:5,blurMode:1,blurAngle:0,blurQuality:1,blurEdgeProtect:.3,blurMix:1};case"sharpen":return{sharpenAmount:.5,sharpenMode:0,sharpenRadius:2,sharpenEdgeProtect:.2,sharpenClarity:0};case"noise":return{noiseAmount:.2,noiseType:0,noiseMode:0,noiseScale:1,noiseMono:0,noiseShadow:1,noiseMid:1,noiseHigh:1,noiseAnimSpeed:1};case"kaleidoscope":return{kaleidoscopeSegments:6,kaleidoscopeAngle:0,kaleidoscopeCenterX:.5,kaleidoscopeCenterY:.5,kaleidoscopeZoom:1,kaleidoscopeMode:0,kaleidoscopeSpiral:0,kaleidoscopeAnimSpeed:0,kaleidoscopeMix:1};case"mirror":return{mirrorMode:0,mirrorPosition:.5,mirrorOffset:.5,mirrorFlipSide:0,mirrorMix:1};case"plasma":return{plasmaSpeed:1,plasmaScale:5,plasmaComplexity:3,plasmaPalette:0,plasmaMode:0,plasmaBlendMode:0,plasmaMix:1,plasmaWarpAmount:.4,plasmaAudioReact:0};case"posterize":return{posterizeLevels:8,posterizeDither:0,posterizeAnimSpeed:0,posterizePalette:0};case"edgeDetect":return{edgeThreshold:.1,edgeThickness:1,edgeMode:0,edgeInvert:0,edgeTintR:1,edgeTintG:1,edgeTintB:1,edgeTintEdges:0,edgeGlow:0,edgeOnlyAlpha:0};case"outline":return{outlineThickness:2,outlineColor:[1,1,1],outlineOnly:0,outlineGlow:0,outlinePosition:1,outlineCrawl:0,outlineGlowFalloff:1,outlineAlphaAware:0};case"emboss":return{embossStrength:1,embossAngle:135,embossHeight:1,embossHighlightR:1,embossHighlightG:1,embossHighlightB:1,embossShadowR:0,embossShadowG:0,embossShadowB:0,embossNormalMode:0,embossMetallicness:0};case"wave":return{waveAmplitude:10,waveFrequency:5,waveSpeed:1,waveType:0,waveWaveform:0,wavePhase:0,waveSecondary:0,waveChromaSplit:0};case"fisheye":return{fisheyeStrength:.5,fisheyeRadius:1,fisheyeCenterX:.5,fisheyeCenterY:.5,fisheyeZoom:1,fisheyeMode:0,fisheyeChromaEdge:0};case"thermal":return{thermalIntensity:1,thermalPalette:0,thermalShimmer:0,thermalSensorNoise:0};case"nightVision":return{nightVisionIntensity:1.5,nightVisionNoise:.3,nightVisionVignette:.5,nightVisionPhosphor:0,nightVisionBloom:.6,nightVisionScopeMask:1,nightVisionRollingNoise:0};case"brightness":return{brightnessAmount:0};case"contrast":return{contrastAmount:0};case"saturation":return{saturationAmount:0};case"hue":return{hueShift:0};case"curves":return{curvesContrast:.4,curvesToe:0,curvesShoulder:0,curvesBlackCrush:0,curvesMix:1};case"liftGammaGain":return{lggLiftR:0,lggLiftG:0,lggLiftB:0,lggGammaR:1,lggGammaG:1,lggGammaB:1,lggGainR:1,lggGainG:1,lggGainB:1,lggLumaOnly:0,lggMix:1};case"exposure":return{exposureStops:0,exposureRollOff:0,exposureHighlightProtect:0};case"gamma":return{gammaShadows:1,gammaMids:1,gammaHighlights:1,gammaMix:1};case"temperatureTint":return{tempTemperature:0,tempTint:0,tempShadow:0,tempHighlight:0,tempSplitTone:0,tempAutoCycle:0};case"vibrance":return{vibranceAmount:.3,vibranceSkinProtect:.5,vibranceHighlightProtect:.3,vibranceCeiling:1};case"colorBalance":return{cbShadowR:0,cbShadowG:0,cbShadowB:0,cbMidR:0,cbMidG:0,cbMidB:0,cbHighR:0,cbHighG:0,cbHighB:0,cbPreserveLuma:1,cbMix:1};case"filmGrain":return{grainAmount:.3,grainSize:1,grainShadow:.7,grainMid:1,grainHigh:.5,grainMono:0,grainStock:1,grainColorJitter:0,grainAnimSpeed:1};case"bloom":return{amount:.6,bloomIntensity:1,threshold:.6,bloomKnee:.4,bloomRadius:.5,bloomAnamorphic:0,red:1,green:1,blue:1};case"chromaticAberration":return{caAmount:.4,caMode:1,caAngle:0,caCenterX:.5,caCenterY:.5,caEdgeFalloff:.5,caMix:1};case"lensDistortion":return{lensDistAmount:.4,lensDistMode:0,lensDistCenterX:.5,lensDistCenterY:.5,lensDistCubic:0,lensDistAnamorphicX:1.3,lensDistEdgeFade:1,lensDistChromaFringe:0};case"tiltShift":return{tiltShiftMode:0,tiltShiftFocusY:.5,tiltShiftFocusX:.5,tiltShiftFocusBand:.2,tiltShiftFalloff:.3,tiltShiftMaxBlur:.5,tiltShiftAngle:0,tiltShiftSaturation:1.2};case"godRays":return{godRaysIntensity:.7,godRaysDecay:.95,godRaysExposure:.4,godRaysDensity:.95,godRaysThreshold:.7,godRaysCenterX:.5,godRaysCenterY:.2,godRaysSamples:64,godRaysTintR:1,godRaysTintG:.95,godRaysTintB:.85,godRaysMix:1};case"heatHaze":return{hazeAmount:.4,hazeScale:8,hazeSpeed:1,hazeDirectionY:.5,hazeTurbulence:.5,hazeMode:0,hazeFocusY:.5,hazeFocusBand:.4};case"directionalBlur":return{dirBlurAmount:.25,dirBlurAngle:0,dirBlurSamples:16,dirBlurFalloff:.3,dirBlurCenterBias:0,dirBlurMix:1};case"zoomBlur":return{zoomBlurAmount:.25,zoomBlurCenterX:.5,zoomBlurCenterY:.5,zoomBlurSamples:16,zoomBlurFalloff:.3,zoomBlurChromatic:0,zoomBlurMix:1};case"radialBlur":return{radialBlurAmount:.25,radialBlurCenterX:.5,radialBlurCenterY:.5,radialBlurSamples:16,radialBlurFalloff:.3,radialBlurRadiusInner:0,radialBlurRadiusOuter:.7,radialBlurMix:1};case"halftone":return{halftoneDotSize:6,halftoneDotShape:0,halftoneAngleC:15,halftoneAngleM:75,halftoneAngleY:0,halftoneAngleK:45,halftoneMode:0,halftoneDrift:0,halftoneSpotColor:[0,0,0]};case"toon":return{toonSteps:4,toonOutline:.6,toonOutlineColor:[0,0,0],toonShadowBand:.3,toonRampSoftness:0,toonColorPop:.3};case"kuwahara":return{kuwaharaRadius:3,kuwaharaEdgeSharpness:.3,kuwaharaColorPunch:.2};case"oilPaint":return{oilPaintRadius:4,oilPaintIntensity:12,oilPaintBrushLength:.6,oilPaintBristle:.4,oilPaintColorPunch:.3,oilPaintHighlight:.2,oilPaintMode:0};case"watercolor":return{watercolorBleed:.5,watercolorEdgeDarken:.5,watercolorPaperTexture:.4,watercolorPaperScale:8,watercolorWetness:.3,watercolorGranulation:.2,watercolorPaperHue:0};case"crt":return{crtScanlines:.5,crtScanCount:480,crtMask:.5,crtMaskType:0,crtCurvature:.3,crtVignette:.4,crtGlow:.5,crtRollingBar:0,crtChromatic:.3};case"compressionArtifacts":return{compArtBlockSize:8,compArtQuality:.4,compArtChromaSubsample:.6,compArtBlockNoise:.2,compArtMode:0,compArtMix:1};case"chromaKey":return{chromaKeyR:0,chromaKeyG:1,chromaKeyB:0,chromaKeyTolerance:.25,chromaKeySoftness:.15,chromaKeySpill:.6,chromaKeyMatte:0,chromaKeyMode:1};case"lumaKey":return{lumaKeyLowCut:.4,lumaKeyHighCut:.6,lumaKeyInvert:0,lumaKeyGamma:1,lumaKeyMatte:0,lumaKeyPremultiply:0};case"differenceKey":return{diffKeyR:0,diffKeyG:0,diffKeyB:0,diffKeyTolerance:.3,diffKeySoftness:.15,diffKeyInvert:0,diffKeyMatte:0,diffKeyMode:0};case"erode":return{erodeRadius:2,erodeShape:1,erodeChannel:0,erodeMix:1};case"dilate":return{dilateRadius:2,dilateShape:1,dilateChannel:0,dilateMix:1};case"displacement":return{dispAmount:.4,dispScale:6,dispSpeed:1,dispMode:0,dispTurbulence:.5,dispChromatic:0};case"twirl":return{twirlAngle:1.5,twirlRadius:.5,twirlCenterX:.5,twirlCenterY:.5,twirlFalloff:1.5,twirlAnimSpeed:0,twirlMix:1};case"pinchBulge":return{pinchAmount:.4,pinchRadius:.5,pinchCenterX:.5,pinchCenterY:.5,pinchFalloff:1.5,pinchChromatic:0,pinchMix:1};case"filmicTonemap":return{tonemapCurve:0,tonemapExposure:1,tonemapContrast:0,tonemapMix:1};case"selectiveColor":return{selColorTargetHue:0,selColorRange:.1,selColorFeather:.1,selColorMode:0,selColorReplaceHue:.33,selColorSatBoost:0};case"falseColor":return{falseColorMode:0,falseColorMix:1,falseColorShowOriginal:1,falseColorMidpoint:.5,falseColorRange:0};case"shadowRecovery":return{shadowAmount:.5,shadowThreshold:.4,shadowSoftness:.3,shadowColorRecovery:.3,shadowHighlightProtect:.6,shadowMix:1};case"highlightRolloff":return{highRolloffAmount:.5,highRolloffThreshold:.7,highRolloffSoftness:.2,highRolloffPreserveHue:.5,highRolloffMaxValue:1,highRolloffMix:1};case"halation":return{halationAmount:.6,halationRadius:12,halationThreshold:.65,halationTintR:.9,halationTintG:.45,halationTintB:.2,halationMode:0,halationMix:1};case"anamorphicStreak":return{anaIntensity:.6,anaLength:.5,anaThreshold:.7,anaTintR:.6,anaTintG:.75,anaTintB:1,anaAngle:0,anaSamples:32,anaMix:1};case"lensDirt":return{dirtAmount:.5,dirtScale:8,dirtThreshold:.6,dirtTintWarmth:.4,dirtScratches:.2,dirtSpots:.6,dirtMode:0,dirtAnimSpeed:0};case"defocusBokeh":return{bokehRadius:12,bokehSamples:24,bokehBrightWeight:.8,bokehThreshold:.7,bokehChromaFringe:0,bokehShape:0,bokehRotation:0,bokehMix:1};case"diffusionPromist":return{diffAmount:.5,diffRadius:12,diffThreshold:.6,diffShadowLift:.3,diffHighlightBloom:.5,diffHaze:.3,diffHazeWarmth:.5,diffMix:1};case"ascii":return{asciiCellSize:12,asciiContrast:1.2,asciiColorMix:.3,asciiMode:0,asciiInvert:0,asciiTintR:0,asciiTintG:1,asciiTintB:.4};case"comicInk":return{comicInkStrength:1.2,comicInkThreshold:.3,comicInkPosterize:5,comicInkHalftone:.4,comicInkHalftoneSize:6,comicInkColorMix:.3,comicInkR:0,comicInkG:0,comicInkB:0};case"datamoshLite":return{amount:.5,amount2:.3,amount3:.4};case"scanlineDrift":return{scanDriftIntensity:.5,scanDriftFrequency:80,scanDriftSpeed:1,scanDriftWaveform:0,scanDriftChromaSplit:.3,scanDriftChunkiness:0};case"tapeDropout":return{tapeDropoutDensity:.4,tapeDropoutLength:.5,tapeDropoutColor:0,tapeDropoutSpeed:1,tapeDropoutNoise:.7,tapeDropoutMix:1};case"polarTransform":return{polarMode:0,polarRotation:0,polarZoom:1,polarCenterX:.5,polarCenterY:.5,polarMix:1};case"rippleCaustics":return{causticsIntensity:.6,causticsScale:8,causticsSpeed:.6,causticsRefraction:.4,causticsTintR:.6,causticsTintG:.85,causticsTintB:1,causticsMode:0};case"shockwave":return{shockTriggerTime:0,shockSpeed:.6,shockAmplitude:.06,shockRingWidth:.15,shockCenterX:.5,shockCenterY:.5,shockChromatic:.3,shockMode:0};case"drosteRecursive":return{drosteZoom:1.5,drosteRotation:5,drosteIterations:6,drosteOffsetX:.5,drosteOffsetY:.5,drosteFrameSize:.4,drosteMix:1};case"slitScan":return{slitScanIntensity:.5,slitScanMode:0,slitScanPattern:0,slitScanSpeed:1,slitScanChromaSplit:0};case"volumetricFogOverlay":return{fogDensity:.5,fogScale:6,fogSpeed:.5,fogHeightFalloff:-.3,fogDepthSim:.5,fogColorR:.85,fogColorG:.9,fogColorB:.95,fogTurbulence:1,fogMode:1};case"rainFogSnowOverlay":return{weatherType:0,weatherDensity:.5,weatherSpeed:1,weatherAngle:10,weatherSize:1,weatherFog:.2,weatherColorR:.85,weatherColorG:.9,weatherColorB:1};case"particleOverlayFx":return{partMode:0,partDensity:.4,partSize:1,partSpeed:1,partTwinkle:.5,partColorR:1,partColorG:1,partColorB:.9,partBlend:0};case"glintStarburst":return{glintIntensity:.7,glintThreshold:.75,glintLength:.4,glintPoints:4,glintRotation:0,glintColorR:1,glintColorG:.95,glintColorB:.85};case"embossRelight":return{embRelStrength:1,embRelAngle:135,embRelHeight:1,embRelDetail:1,embRelSpecular:.3,embRelColorPreserve:.5,embRelAmbient:.3};case"dotMatrix":return{dmDotSize:12,dmDotShape:0,dmGap:.2,dmPosterize:4,dmGlow:.4,dmBgR:0,dmBgG:0,dmBgB:0};case"matrixRain":return{matrixDensity:.6,matrixSpeed:1,matrixCellSize:14,matrixTrailLength:.5,matrixColorR:0,matrixColorG:1,matrixColorB:.4,matrixBgMix:.5};case"binaryCode":return{binDensity:.7,binSpeed:.5,binCellSize:12,binColorR:0,binColorG:1,binColorB:.3,binBgMix:.5,binContrast:1};case"crosshatch":return{hatchDensity:1,hatchAngle:30,hatchLineWidth:1,hatchContrast:1,hatchPaperR:.95,hatchPaperG:.93,hatchPaperB:.88,hatchInkR:.1,hatchInkG:.1,hatchInkB:.1};case"blockMosaic":return{mosaicTileSize:24,mosaicMode:0,mosaicGrout:.15,mosaicColorJitter:.1,mosaicGroutR:.1,mosaicGroutG:.1,mosaicGroutB:.1};case"numberGrid":return{amount:.35,amount2:.6,amount3:.3};case"braillePattern":return{amount:.4,amount2:.5,amount3:.5};case"circuitBoard":return{amount:.5,amount2:.5,amount3:.4};case"stainedGlass":return{amount:.5,amount2:.4,amount3:.5};case"wovenFabric":return{amount:.5,amount2:.5,amount3:.4};case"mosaicTile":return{amount:.5,amount2:.3,amount3:.3};case"neonOutline":return{amount:.5,amount2:.5,amount3:.6,red:1,green:.2,blue:.8};case"pixelSort":return{amount:.5,amount2:.4,amount3:.3};case"linocut":return{amount:.5,amount2:.4,amount3:.7,threshold:.5};case"topoMap":return{amount:.5,amount2:.4,amount3:.3,red:.25,green:.18,blue:.12};case"ledWall":return{amount:.4,amount2:.5,amount3:.5};case"explode3D":return{amount:.3,amount2:0,amount3:.3,threshold:.7,angle:0,red:1,green:.95,blue:.9};case"terrain3D":return{terrainMode:1,terrainHeight:.5,terrainCamHeight:.5,terrainSpeed:.3,terrainFog:.4,terrainYaw:0,terrainPitch:.5,terrainRoll:0,terrainFogR:.05,terrainFogG:.07,terrainFogB:.12,terrainHorizonFade:.7,terrainSourceMix:0};case"wrappedTerrain":return{wtShape:0,wtHeight:.4,wtRotateX:.5,wtRotateY:.5,wtAutoRotate:.4,wtCamDistance:2.5,wtSpecular:.4,wtAmbient:.3,wtFogDistance:.2,wtFogR:.05,wtFogG:.07,wtFogB:.12,wtHorizonFade:.6,wtSourceMix:0,wtTileScale:1};case"stringOrb":return{soRadius:.85,soHeight:.4,soLatCount:16,soLonCount:24,soDiagCount:8,soSlope:1.5,soWidth:.012,soSpin:.4,soTilt:.15,soFlow:.5,soIntensity:1,soGlow:.7,soGlowR:.4,soGlowG:.85,soGlowB:1,soHorizonFade:.7,soTileScale:1};case"sphereWireframe":return{swRadius:.85,swHeight:.4,swMeridians:16,swParallels:12,swWidth:.012,swSpin:.4,swTilt:.2,swIntensity:1.2,swHaloGlow:.7,swColorR:.5,swColorG:.9,swColorB:1,swHorizonFade:.7,swFillSource:.4,swTileScale:1};case"voxelCubeCluster":return{vccGridSize:4,vccCubeSize:.22,vccSpacing:.7,vccHeight:.5,vccSpin:.5,vccTilt:.5,vccCamDistance:4,vccSpecular:.4,vccAmbient:.3,vccHorizonFade:.6,vccBgR:.04,vccBgG:.05,vccBgB:.08};case"mobiusLattice":return{mlMajorR:.85,mlRibbonW:.3,mlTwists:1,mlSpin:.5,mlTilt:.25,mlLineDensity:16,mlLineWidth:.015,mlIntensity:1,mlLineR:1,mlLineG:.85,mlLineB:.4,mlHorizonFade:.6};case"crystalShardField":return{csfShardCount:16,csfShardSize:.28,csfSpread:1.2,csfChromaEdge:.4,csfRefraction:.5,csfSpin:.4,csfIntensity:1,csfTintR:.85,csfTintG:.95,csfTintB:1,csfHorizonFade:.6};case"tubeLattice":return{tlTubeCount:6,tlTubeRadius:.15,tlSpread:.9,tlSpin:.4,tlTilt:.3,tlTwist:.5,tlIntensity:1,tlRimR:0,tlRimG:.95,tlRimB:1,tlHorizonFade:.6};case"discoMirrorBall":return{dmbRadius:1,dmbFacetCount:16,dmbSpin:.6,dmbTilt:.2,dmbChaseSpeed:1.2,dmbChaseHueWidth:.3,dmbSparkle:.5,dmbIntensity:1.2,dmbHighlightR:1,dmbHighlightG:1,dmbHighlightB:.85,dmbHorizonFade:.5};case"lissajousKnot":return{lkRatioX:3,lkRatioY:4,lkRatioZ:5,lkPhaseX:.25,lkPhaseY:0,lkTubeRadius:.08,lkScale:1,lkSpin:.4,lkTilt:.25,lkIntensity:1,lkTubeR:1,lkTubeG:.5,lkTubeB:.85,lkHorizonFade:.6};case"helixParticleStream":return{hpsHelices:2,hpsHelixRadius:.5,hpsTurns:3,hpsHeight:2,hpsTubeRadius:.06,hpsRiseSpeed:1,hpsSpin:.3,hpsTilt:.2,hpsIntensity:1,hpsTintR:.4,hpsTintG:1,hpsTintB:.7,hpsHorizonFade:.6};case"donutConstellation":return{dcMajorR:1,dcMinorR:.18,dcStarCount:12,dcStarSize:.025,dcSpin:.4,dcTilt:.4,dcTintIntensity:1,dcTorusR:.8,dcTorusG:.4,dcTorusB:1,dcStarR:1,dcStarG:1,dcStarB:.85,dcHorizonFade:.6};case"sphereProject":return{amount:.8,amount2:.4,amount3:.2,threshold:.5,red:1,green:.95,blue:.9};case"cubeProject":return{amount:.6,amount2:.3,amount3:.2,angle:.5,red:1,green:.95,blue:.9};case"cylinderWrap":return{amount:.8,amount2:.5,amount3:.2,threshold:.5,red:1,green:.95,blue:.9};case"torusTunnel":return{amount:.8,amount2:.4,amount3:.3,threshold:.3,red:.1,green:.1,blue:.15};case"diamondGem":return{amount:.8,amount2:.5,amount3:.15,threshold:.6,red:1,green:.95,blue:.9};case"shatter3D":return{amount:.5,amount2:.4,amount3:.3,threshold:.3};case"mobiusStrip":return{amount:.8,amount2:.4,amount3:.2,threshold:.5,red:.8,green:.8,blue:.9};case"voxelDisplace":return{amount:.5,amount2:.4,amount3:.15,threshold:.2,red:1,green:.95,blue:.9};case"waveSurface":return{amount:.4,amount2:.5,amount3:.3,threshold:.5,red:.5,green:.7,blue:.9};case"prismSplit":return{amount:.5,amount2:.5,amount3:0,threshold:.3,red:1,green:1,blue:1};case"origamiFold":return{amount:.5,amount2:.4,amount3:.2,threshold:.6};case"mirrorRoom":return{amount:.8,amount2:.5,amount3:.15,threshold:.5,red:.9,green:.9,blue:1};case"hexGrid":return{amount:.8,amount2:.4,amount3:.3,threshold:.2};case"spiralTile":return{amount:.8,amount2:.4,amount3:.2,threshold:.3};case"shingleStack":return{amount:.8,amount2:.4,amount3:.25,threshold:.3};case"voronoiShatter":return{amount:.8,amount2:.4,amount3:.2,threshold:.3};case"geometricTile":return{geomTiles:4,geomMode:0,geomRotation:90,geomOffsetX:0,geomMix:1};case"geometricTilePro":return{geomProTileCount:.4,geomProFlipRange:.5,geomProSpeed:.3,geomProGap:.1};case"tunnelFlight":return{tunnelSpeed:1,tunnelTwist:.5,tunnelDepth:1.5,tunnelCenterX:.5,tunnelCenterY:.5,tunnelMode:0,tunnelChromatic:.2};case"infiniteMirror":return{infMirrorIterations:5,infMirrorShrink:.8,infMirrorRotation:5,infMirrorTintFade:.4,infMirrorHueShift:.05,infMirrorMode:0,infMirrorOffsetX:.5,infMirrorOffsetY:.5};case"crystalRefract":return{crystalScale:6,crystalRefraction:.4,crystalSparkle:.4,crystalEdgeGlow:.5,crystalTintR:.85,crystalTintG:.95,crystalTintB:1,crystalMode:0};case"feedbackZoom":return{amount:.85,feedbackZoom:1.04,feedbackRotation:.02,feedbackDecay:.04,feedbackHueShift:0,feedbackMaskCenter:0};case"fractalWarp":return{fractalWarpAmount:.5,fractalWarpScale:4,fractalWarpOctaves:4,fractalWarpSpeed:.7,fractalWarpChromatic:.2,fractalWarpMode:0};case"fluidDistort":return{fluidDistAmount:.5,fluidDistScale:4,fluidDistSpeed:.8,fluidDistTurbulence:.5,fluidDistMode:0};case"wormhole":return{wormholePullStrength:.5,wormholeRotation:1,wormholeCenterX:.5,wormholeCenterY:.5,wormholeTwist:.5,wormholeChromatic:.3,wormholeAnimSpeed:.5};case"motionTrails":return{motionTrailsLength:.4,motionTrailsAngle:0,motionTrailsSamples:16,motionTrailsFalloff:.5,motionTrailsChromaSplit:.2,motionTrailsMode:0};case"echoRepeat":return{echoCount:5,echoOffsetX:.05,echoOffsetY:.05,echoDecay:.7,echoHueShift:.02,echoMode:0};case"ghostDouble":return{ghostOpacity:.5,ghostOffsetX:.05,ghostOffsetY:0,ghostMirror:0,ghostTintR:1,ghostTintG:1,ghostTintB:1,ghostBlend:0};case"strobeFlash":return{strobeRate:4,strobeDuty:.5,strobeIntensity:1,strobeMode:0,strobeTintR:1,strobeTintG:1,strobeTintB:1};case"lightPaint":return{lightPaintIntensity:.7,lightPaintThreshold:.5,lightPaintTrailLength:.4,lightPaintFlowAngle:0,lightPaintFlowScale:6,lightPaintChromaShift:.3,lightPaintTintR:1,lightPaintTintG:.8,lightPaintTintB:.3};case"recursiveEcho":return{recEchoDepth:5,recEchoZoom:.95,recEchoRotation:5,recEchoOpacity:.6,recEchoHueShift:.05,recEchoOffsetX:.02,recEchoOffsetY:.02,recEchoMode:0};case"invert":return{invertMode:0,invertAmount:1,invertThreshold:.5,invertStrobeRate:4};case"blobTrack":return{blobThreshold:.3,blobShape:0,blobColor:0,blobColorMode:0,blobFixedColorR:0,blobFixedColorG:1,blobFixedColorB:.4,blobThickness:2,blobMinSize:.02,blobMaxBlobs:32,blobShowCoords:1,blobShowBBox:1,blobShowCenter:1,blobTrailLength:.3,blobGridSize:16,blobMix:.8,blobMarkerSize:1,blobBlendMode:0};case"blobContour":return{blobThreshold:.4,blobShape:0,blobColor:1,blobThickness:1.5,blobMinSize:.5,blobShowCoords:0,blobTrailLength:.4,blobGridSize:16,blobMix:.7};case"blobHeatmap":return{blobThreshold:.2,blobShape:0,blobColor:0,blobThickness:1,blobShowCoords:1,blobShowBBox:1,blobShowCenter:1,blobGridSize:16,blobMix:.85};case"timeSmear":return{mode:0,amount:.5,amount2:.5,amount3:.7,speed:1};case"chronophoto":return{mode:0,amount:.5,amount2:.3,amount3:.5,speed:1};case"opticalFlowDatamosh":return{ofdmIntensity:.7,ofdmMotionScale:1,ofdmPersistence:.7,ofdmChromaSplit:.3,ofdmBlockSize:12,ofdmFreeze:0,ofdmMode:0};case"flowFieldTrails":return{fftFlowScale:4,fftTrailLength:.4,fftSamples:24,fftSpeed:.8,fftChromaSplit:.3,fftContrast:1,fftMode:0,fftColorCycle:0};case"reactionDiffusion":return{rdFeedRate:.055,rdKillRate:.062,rdDiffusionA:1,rdDiffusionB:.5,rdPatternScale:1,rdLumaMask:.5,rdMode:0,rdColorR:.4,rdColorG:.85,rdColorB:1,rdMix:.6,rdReseed:.3};case"neonTubeTrace":return{ntEdgeThreshold:.15,ntTubeWidth:1.5,ntGlow:1,ntGlowRadius:6,ntTintR:1,ntTintG:.2,ntTintB:.7,ntChase:0,ntChaseSpeed:1,ntFlicker:0,ntBg:2};case"depthParallax":return{dpDepthStrength:.5,dpPushIn:.3,dpLayers:4,dpChromatic:.3,dpDepthBoost:1,dpMode:0,dpPanX:0,dpPanY:0};case"pointCloudDissolve":return{pcdDissolve:0,pcdDotSize:4,pcdScatterRadius:.4,pcdAttract:0,pcdTurbulence:.3,pcdMode:1,pcdBgR:0,pcdBgG:0,pcdBgB:0,pcdHueShift:0};case"pixelSand":return{psGravity:1,psTurbulence:.3,psThreshold:.6,psPersistence:.92,psMode:0,psReplenish:.6,psChromaSplit:0,psGrainSize:3};case"liquidGlass":return{lgBlobs:3,lgBlobSize:.18,lgRefraction:.5,lgChromatic:.4,lgSpecular:.5,lgCausticAmount:.3,lgSpeed:.5,lgTintR:.85,lgTintG:.95,lgTintB:1};case"hologramScan":return{hsIntensity:.7,hsScanFreq:200,hsScanSpeed:1,hsGridSpacing:12,hsRGBFlicker:.4,hsBrokenBands:.3,hsTintR:.4,hsTintG:.95,hsTintB:1,hsOpacityFlicker:.3,hsEdgeGlow:.6};case"laserSlice":return{lsMode:0,lsSpeed:1,lsBeamWidth:.02,lsGlow:1.2,lsSparks:.4,lsEraseAmount:.5,lsTintR:1,lsTintG:.1,lsTintB:.1,lsReveal:1,lsPersistence:.92};case"auraField":return{afIntensity:1,afRadius:12,afEdgeAmount:.6,afLumaAmount:.4,afAudioReact:.5,afHueShift:0,afTintR:.6,afTintG:.85,afTintB:1,afMode:1};case"smokeDisintegrate":return{smokeAmount:.4,smokeScale:4,smokeSpeed:1,smokeDirection:90,smokeEdgeFade:.5,smokeColorR:.85,smokeColorG:.85,smokeColorB:.9,smokeMode:0};case"shimmerCloth":return{clothAmplitude:.3,clothFrequency:8,clothSpeed:.7,clothThreadDensity:60,clothThreadDepth:.5,clothShimmer:.5,clothMode:0};case"glitchQuilt":return{gqTileSize:32,gqShuffleAmount:.4,gqRotateAmount:.3,gqDelayAmount:.3,gqChromaSplit:.3,gqTriggerRate:1,gqMode:0};case"cellularAutomataBurn":return{caCellSize:2,caBirthThreshold:.5,caSurvivalLow:1.5,caSurvivalHigh:3.5,caColorR:1,caColorG:.5,caColorB:.1,caMode:0,caMix:.7};case"rorschachMirror":return{rmMode:0,rmInkAmount:.4,rmFluidEdges:.3,rmTintR:.05,rmTintG:.05,rmTintB:.05,rmBgR:.95,rmBgG:.95,rmBgB:.92,rmMixOriginal:0};case"spectralPrismTunnel":return{sptTunnelDepth:1.5,sptPrismSpread:1,sptRotation:1,sptSpeed:1,sptSlices:12,sptFade:.5};case"ledVolume":return{ledVoxelSize:16,ledDepthPulse:.4,ledDepthSpeed:1,ledPosterize:4,ledGlow:.5,ledPerspective:.4,ledMode:1,ledBgR:0,ledBgG:0,ledBgB:0};case"posterTear":return{ptTearAmount:.3,ptTearAngle:35,ptTearJitter:.5,ptShiftBelow:.5,ptOffsetX:.05,ptOffsetY:.02,ptTearGlow:.3,ptMode:0};case"paintPeel":return{ppAmount:.3,ppScale:4,ppLumaBias:.5,ppCurl:.5,ppShadow:.5,ppBgR:.15,ppBgG:.13,ppBgB:.1,ppMode:0};case"audioShockBloom":return{asbIntensity:1,asbBloomThreshold:.6,asbBloomRadius:12,asbShockSpeed:.8,asbShockAmplitude:.05,asbChromaSplit:.4,asbStrobeAmount:.4,asbTintR:1,asbTintG:.95,asbTintB:.85,asbAudioGate:.3};case"vhsFullDeck":return{vhsFdTracking:.5,vhsFdHeadSwitch:.4,vhsFdChromaBleed:.5,vhsFdDropouts:.3,vhsFdTapeNoise:.4,vhsFdScanlines:.4,vhsFdColorBleed:.3,vhsFdSaturation:.85,vhsFdTrackingJump:.1,vhsFdMode:1};case"analogFeedbackRack":return{afrMix:.7,afrZoom:1.02,afrRotation:.005,afrDecay:.04,afrHueShift:.01,afrMaskCenter:0,afrChromaSplit:.2,afrOffsetX:0,afrOffsetY:0,afrMode:0};case"clubLaserGrid":return{clgIntensity:1,clgGridDensity:12,clgPerspective:.7,clgSpeed:1,clgIntersectionGlow:.7,clgLineWidth:1.5,clgTintR:.2,clgTintG:1,clgTintB:.5,clgAudioReact:.7,clgMode:0};case"mirrorShards":return{msShards:8,msShardSize:.2,msRotation:60,msDelayAmount:.3,msChromatic:.3,msMode:0};case"ghostExposure":return{geExposure:.3,geDecay:.04,geHueShiftPerFrame:.005,geIntensity:1,geMode:0,geClamp:.85};case"thermalContour":return{tcPalette:0,tcContourCount:8,tcContourWidth:.005,tcContourGlow:.5,tcIntensity:1,tcTrackBlobs:.4,tcMix:.85};case"dreamDiffusion":return{ddBloomAmount:1.2,ddBloomRadius:14,ddHalation:.5,ddChromaticBlur:.4,ddPastelRolloff:.6,ddShadowLift:.15,ddSoftness:.4,ddTintR:1.05,ddTintG:1,ddTintB:.95};case"topoWarp":return{twContourCount:12,twContourWidth:.008,twDisplacement:.5,twChromaticEdge:.3,twColorR:0,twColorG:.85,twColorB:1,twShadowRidges:.5,twMix:.85};case"strobeSequencer":return{ssBPM:120,ssSteps:16,ssPattern:21845,ssMode:0,ssIntensity:1,ssTintR:1,ssTintG:1,ssTintB:1,ssSwing:0};default:return{}}}const eu=`
  uniform sampler2D uTexture;      // Composited scene
  uniform vec2 uResolution;
  uniform float uFOV;              // Field of view in radians (pi = 180 degrees)
  uniform float uRotation;         // Dome rotation in radians
  uniform float uTilt;             // Dome tilt in radians
  uniform vec2 uOffset;            // Center offset (-1 to 1)
  uniform int uMode;               // 0=angular fisheye, 1=stereographic, 2=orthographic, 3=equirectangular
  uniform float uCurvature;        // Extra curvature control (0=flat, 1=full dome)
  uniform float uTruncation;       // Truncation angle as fraction of FOV (0.5 = half dome)
  varying vec2 vUv;

  #define PI 3.14159265359

  // Rotate a 2D point
  vec2 rotate2d(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  void main() {
    // Map UV to centered coordinates (-1 to 1), accounting for aspect ratio
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = (vUv - 0.5) * 2.0;

    // Force square mapping for domemaster output
    // (dome content is always circular in a square frame)
    if (aspect > 1.0) {
      uv.x *= aspect;
    } else {
      uv.y /= aspect;
    }

    // Apply center offset
    uv -= uOffset;

    // Apply rotation
    uv = rotate2d(uv, uRotation);

    // Distance from center
    float r = length(uv);
    float halfFOV = uFOV * 0.5;

    // Truncation: fade out beyond truncation angle
    float truncRadius = uTruncation;
    if (r > truncRadius) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Angular fisheye: r maps linearly to angle
    float theta;  // angle from center (0 = center, halfFOV = edge)
    float phi = atan(uv.y, uv.x);  // azimuthal angle

    int mode = uMode;

    if (mode == 0) {
      // Angular (equidistant) fisheye - standard planetarium/domemaster format
      // r maps linearly to angle: r=0 -> theta=0, r=1 -> theta=halfFOV
      theta = r * halfFOV;
    }
    else if (mode == 1) {
      // Stereographic fisheye - preserves shape better at edges
      theta = 2.0 * atan(r * tan(halfFOV * 0.5));
    }
    else if (mode == 2) {
      // Orthographic fisheye - less distortion at center
      theta = asin(min(r, 1.0)) * halfFOV / (PI * 0.5);
    }
    else {
      // Equirectangular (360 panoramic mapping)
      // Map x to longitude, y to latitude
      float lon = uv.x * PI;
      float lat = uv.y * PI * 0.5;
      // Convert spherical to direction, then to flat texture coords
      vec2 texUv = vec2(
        lon / PI * 0.5 + 0.5,
        lat / (PI * 0.5) * 0.5 + 0.5
      );
      texUv = clamp(texUv, 0.0, 1.0);
      gl_FragColor = texture2D(uTexture, texUv);
      return;
    }

    // Convert spherical angle back to flat texture coordinates
    // This is the inverse fisheye: dome angle -> flat source position
    // Apply tilt (rotate the sampling direction in 3D)
    float sinTheta = sin(theta);
    float cosTheta = cos(theta);

    // 3D direction on the dome
    vec3 dir = vec3(
      sinTheta * cos(phi),
      sinTheta * sin(phi),
      cosTheta
    );

    // Apply tilt around X axis
    float ct = cos(uTilt);
    float st = sin(uTilt);
    dir = vec3(
      dir.x,
      dir.y * ct - dir.z * st,
      dir.y * st + dir.z * ct
    );

    // Project back to 2D texture coordinates
    // Perspective projection from dome direction to flat source
    float z = max(dir.z, 0.001); // Prevent division by zero
    vec2 texUv = vec2(
      dir.x / z * 0.5 + 0.5,
      dir.y / z * 0.5 + 0.5
    );

    // Apply curvature blend: mix between flat (no reprojection) and full dome
    vec2 flatUv = vUv;
    texUv = mix(flatUv, texUv, uCurvature);

    // Clamp and sample
    texUv = clamp(texUv, 0.0, 1.0);

    vec4 color = texture2D(uTexture, texUv);

    // Vignette at dome edge for soft falloff
    float edgeFade = smoothstep(truncRadius, truncRadius - 0.05, r);
    color.rgb *= edgeFade;

    // Black outside the dome circle
    float circleMask = step(r, truncRadius);
    color.rgb *= circleMask;

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`,tu=`
precision highp float;
varying vec2 vUv;
uniform sampler2D tBankA;
uniform sampler2D tBankB;
uniform float uMix;
uniform float uTime;
uniform vec2  uRes;
uniform int   uBlendMode;

vec4 sampleA(vec2 uv) { return texture2D(tBankA, uv); }
vec4 sampleB(vec2 uv) { return texture2D(tBankB, uv); }

float xfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float xfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(xfHash(i), xfHash(i + vec2(1.0, 0.0)), f.x),
             mix(xfHash(i + vec2(0.0, 1.0)), xfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Per-channel blend math. Mirrors the canonical Photoshop-style modes
// the layer compositing path uses, scoped to a single fragment so it
// runs cheap inside the crossfade quad. Caller picks between these via
// uBlendMode and we sweep A → blended → B as the fader crosses 0..1.
vec3 xfBlend(vec3 a, vec3 b, int mode) {
  if (mode == 1) return a * b;                             // multiply
  if (mode == 2) return 1.0 - (1.0 - a) * (1.0 - b);       // screen
  if (mode == 3) return min(a + b, vec3(1.0));             // add (clamped)
  if (mode == 4) return abs(a - b);                        // difference
  if (mode == 5) return min(a, b);                         // darken
  if (mode == 6) return max(a, b);                         // lighten
  if (mode == 7) {                                          // overlay
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(lo, hi, step(vec3(0.5), a));
  }
  if (mode == 8) return a + b - 2.0 * a * b;               // exclusion
  return mix(a, b, 0.5);                                   // fallback (unused; mode==0 short-circuits)
}
`,ou=`
  // Smoothly snap to pure A / pure B inside the 2% dead zone at each
  // end. smoothstep gives a gentle ramp instead of a hard cut so the
  // operator can't see the artifacts retract — they're just gone.
  const float DEAD_ZONE = 0.02;
  if (uMix < DEAD_ZONE) {
    float t = smoothstep(0.0, DEAD_ZONE, uMix);
    gl_FragColor = mix(sampleA(vUv), gl_FragColor, t);
  } else if (uMix > 1.0 - DEAD_ZONE) {
    float t = smoothstep(1.0 - DEAD_ZONE, 1.0, uMix);
    gl_FragColor = mix(gl_FragColor, sampleB(vUv), t);
  }
`,au=`
  if (uBlendMode != 0) {
    vec3 a = sampleA(vUv).rgb;
    vec3 b = sampleB(vUv).rgb;
    vec3 blended = xfBlend(a, b, uBlendMode);
    // Overlap factor: 1 at uMix=0.5 (peak A+B mix), 0 at extremes.
    // Triangular envelope so the blend tint fades in / out smoothly
    // across the fader rather than popping in.
    float overlap = 1.0 - abs(uMix - 0.5) * 2.0;
    gl_FragColor = vec4(mix(gl_FragColor.rgb, blended, overlap), gl_FragColor.a);
  }
`;function re(u){return`${tu}
void main() {
${u}
${au}
${ou}
}`}const iu=re(`
  vec4 a = sampleA(vUv);
  vec4 b = sampleB(vUv);
  float ka = cos(uMix * 1.5707963);  // = sqrt(1 - uMix) curve
  float kb = sin(uMix * 1.5707963);
  gl_FragColor = a * ka + b * kb;
`),ru=re(`
  // 0..1 wipe position
  float pos = uMix;
  // Slight diagonal so the wipe edge has more visual interest than a vertical line.
  float wipeAt = pos + (vUv.y - 0.5) * 0.06;
  float side = step(vUv.x, wipeAt);
  gl_FragColor = mix(sampleB(vUv), sampleA(vUv), 1.0 - side);
`),lu=re(`
  // Triangle wave: 0 at the ends, 1 at midpoint
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);
  float offset = intensity * 0.04;  // peak ~4% of screen width

  // Channel-shifted samples of A and B individually, then crossfaded
  vec4 a;
  a.r = sampleA(vUv + vec2(-offset, 0.0)).r;
  a.g = sampleA(vUv).g;
  a.b = sampleA(vUv + vec2( offset, 0.0)).b;
  a.a = 1.0;

  vec4 b;
  b.r = sampleB(vUv + vec2(-offset, 0.0)).r;
  b.g = sampleB(vUv).g;
  b.b = sampleB(vUv + vec2( offset, 0.0)).b;
  b.a = 1.0;

  gl_FragColor = mix(a, b, smoothstep(0.0, 1.0, uMix));
`),uu=re(`
  float angle = uMix * 1.5707963;  // 0..π/2
  float ca = cos(angle);
  float sa = sin(angle);

  // Map screen x [0,1] → world x in cube view space [-1,1]
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;

  // Two faces of a cube: face A (front) at z=1, face B (right) at z=1
  // after a 90° rotation. We project both onto the viewport and pick
  // whichever is "facing the camera" at this pixel.

  // Face A unrotated normal (0,0,1) — visible when we look from x<edge
  // Face B unrotated normal (1,0,0) → after rotating by -angle around y,
  // becomes (cos,0,-sin). Visible when its projected x is on the right.

  // Edge x in screen space at this rotation: where the two faces meet.
  // Face A's right edge is at world x=1, projected x = ca after rotation.
  // Face B's left edge is at world x=1 (its own coord), projected to right.
  float edgeX = ca * 2.0 - 1.0; // matches the seam

  if (x < edgeX) {
    // Sample A — un-shrink the projection
    float u = (x + 1.0) / (edgeX + 1.0);
    // Tiny shading to suggest the cube face curving away
    float shade = mix(1.0, 0.65, smoothstep(0.6, 1.0, u));
    gl_FragColor = sampleA(vec2(u, y)) * shade;
  } else {
    // Sample B
    float u = (x - edgeX) / (1.0 - edgeX);
    float shade = mix(0.65, 1.0, smoothstep(0.0, 0.4, u));
    gl_FragColor = sampleB(vec2(u, y)) * shade;
  }

  // Bright seam line right at the cube edge for definition
  float dist = abs(x - edgeX);
  float seam = smoothstep(0.012, 0.0, dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), seam * 0.45);
`),nu=re(`
  // Shatter into ~12x7 cells
  vec2 cellSize = vec2(1.0 / 12.0, 1.0 / 7.0);
  vec2 cellId = floor(vUv / cellSize);
  vec2 cellUV = fract(vUv / cellSize);

  // Per-cell direction + per-cell delay (later-shattering cells revealed last)
  float delay = xfHash(cellId) * 0.4;
  float local = clamp((uMix - delay) / (1.0 - delay), 0.0, 1.0);

  // Each cell drifts in a randomized direction
  vec2 dir = normalize(vec2(xfHash(cellId + 1.7) - 0.5, xfHash(cellId + 3.3) - 0.5));
  // Plus a downward bias as if gravity pulled fragments
  dir.y -= 0.6;
  vec2 cellOffset = dir * local * 0.55;

  // Sample A at the shifted cell location (clamped UV — past edges = transparent fragment)
  vec2 sampleUv = vUv - cellOffset;
  vec4 a = sampleA(sampleUv);

  // Fade each fragment out near its lifetime end so they vanish into B
  float aAlpha = 1.0 - smoothstep(0.7, 1.0, local);
  // Mask off fragments whose cell has fully fallen off-screen
  if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) aAlpha = 0.0;

  vec4 b = sampleB(vUv);
  // Cell-edge "crack" line — thin dark border on each shard for definition
  vec2 edgeDist = min(cellUV, 1.0 - cellUV);
  float crack = smoothstep(0.04, 0.0, min(edgeDist.x, edgeDist.y));
  a.rgb = mix(a.rgb, vec3(0.0), crack * aAlpha * 0.55);

  gl_FragColor = mix(b, a, aAlpha);
`),su=re(`
  // Dot density that peaks at midpoint then falls away (so endpoints are clean)
  float density = 1.0 - abs(uMix - 0.5) * 2.0; // triangle 0..1..0

  // Radius of each dot — bigger = more B revealed
  float dotR = 0.6 + uMix * 0.5;

  vec2 grid = fract(vUv * 70.0) - 0.5;
  float d = length(grid);
  // Inside-dot mask: dot grows with density
  float dotMask = smoothstep(0.5 * dotR + 0.05, 0.5 * dotR - 0.05, d);
  // Modulate by density so endpoints converge to plain B/A
  dotMask *= density;

  // Outside dots: cross-fade from A to B by raw uMix as a base layer
  vec4 base = mix(sampleA(vUv), sampleB(vUv), uMix);
  // Dots themselves show B (so as A "halftones away", B leaks through dot holes)
  vec4 dotColor = sampleB(vUv);

  gl_FragColor = mix(base, dotColor, dotMask);
`),cu=re(`
  // Scramble peaks at midpoint
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);

  // Block grid — coarser at peak intensity (more visible chunks)
  float blockSize = mix(80.0, 22.0, intensity);
  vec2 block = floor(vUv * blockSize);

  // Per-block horizontal jitter (keyed to time so it skitters)
  float r = xfHash(block + floor(uTime * 12.0));
  float shift = (r - 0.5) * intensity * 0.18;

  // Per-block vertical channel-roll
  float vshift = (xfHash(block + 7.7) - 0.5) * intensity * 0.05;

  vec2 sampleUv = vUv + vec2(shift, vshift);

  // Pick A or B per-block, weighted by uMix — peak intensity → 50/50
  float pickB = step(xfHash(block + 13.13), uMix);
  vec4 sa = sampleA(sampleUv);
  vec4 sb = sampleB(sampleUv);
  vec4 col = mix(sa, sb, pickB);

  // Color channel split per-block at peak intensity for extra glitch flavour
  if (intensity > 0.5) {
    float pickRedB  = step(xfHash(block + 23.7), uMix);
    float pickBlueB = step(xfHash(block + 41.1), uMix);
    col.r = mix(sa.r, sb.r, pickRedB);
    col.b = mix(sa.b, sb.b, pickBlueB);
  }

  gl_FragColor = col;
`),fu=re(`
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);
  float disp = intensity * 0.09;

  // Animated flow-field offset — each pixel pulled along noise gradient
  vec2 nUV = vUv * 4.0 + uTime * 0.12;
  float n1 = xfNoise(nUV);
  float n2 = xfNoise(nUV + 13.7);
  vec2 offset = vec2(n1 - 0.5, n2 - 0.5) * disp;

  vec4 a = sampleA(vUv + offset);
  vec4 b = sampleB(vUv - offset);

  gl_FragColor = mix(a, b, smoothstep(0.0, 1.0, uMix));
`),vu=re(`
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);  // 0..1..0
  // Strobe rate scales from 2hz at edges to ~24hz at midpoint
  float rate = 2.0 + intensity * 22.0;
  float phase = fract(uTime * rate);
  // Duty biased by uMix so endpoints converge to all-A / all-B
  float pickB = step(uMix, phase);
  // Below: pickB=1 → show B. Above: pickB=0 → show A.
  // Wait, that's inverted — fix:
  float showA = step(phase, 1.0 - uMix);
  gl_FragColor = mix(sampleB(vUv), sampleA(vUv), showA);
`),du=re(`
  // Both banks shift horizontally — A by -uMix, B by (1-uMix)
  float aShift = uMix;
  float bShift = uMix - 1.0;

  vec2 aUv = vUv + vec2(aShift, 0.0);
  vec2 bUv = vUv + vec2(bShift, 0.0);

  // Pixel mask: which bank's region of the screen we're in
  bool inA = aUv.x >= 0.0 && aUv.x <= 1.0;
  bool inB = bUv.x >= 0.0 && bUv.x <= 1.0;

  vec4 col = vec4(0.0, 0.0, 0.0, 1.0);
  if (inA && !inB) col = sampleA(aUv);
  else if (inB && !inA) col = sampleB(bUv);
  else if (inA && inB) {
    // Overlap region (briefly during transition) — favor B since it's incoming
    col = sampleB(bUv);
  }

  // Bright seam at the slide edge
  float seamA = smoothstep(0.018, 0.0, aUv.x); // left edge of A
  float seamB = smoothstep(0.018, 0.0, 1.0 - bUv.x); // right edge of B
  col.rgb = mix(col.rgb, vec3(1.0), max(seamA, seamB) * 0.4);

  gl_FragColor = col;
`),Ot=[{name:"dissolve",label:"Dissolve",description:"Constant-power crossfade. Clean 50/50 at midpoint.",fragment:iu},{name:"wipe",label:"Hard Wipe",description:"Diagonal line wipe. Midpoint = 50/50 split screen.",fragment:ru},{name:"rgb-split",label:"RGB Split",description:"Chromatic aberration peaks at midpoint.",fragment:lu},{name:"cube",label:"Cube",description:"3D cube rotates A → B. Edge-on at midpoint.",fragment:uu},{name:"shatter",label:"Shatter",description:"A breaks into shards revealing B. Max explosion midpoint.",fragment:nu},{name:"halftone",label:"Halftone",description:"Pop-art dot pattern. Peak dots midpoint.",fragment:su},{name:"glitch",label:"Glitch",description:"Block-shifted datamosh. Peak chaos midpoint.",fragment:cu},{name:"liquid",label:"Liquid",description:"Noise-driven displacement morph.",fragment:fu},{name:"strobe",label:"Strobe Mix",description:"Rapid A/B alternation. Fastest at midpoint.",fragment:vu},{name:"slide",label:"Slide",description:"A slides off, B slides in. 50/50 split midpoint.",fragment:du}];function mu(u){return Ot.find(i=>i.name===u)||Ot[0]}function pu(u,i){const l=Math.max(0,Math.min(1,u));switch(i){case"linear":return l;case"constant-power":return Math.sin(l*Math.PI/2);case"sharp-cut":return l<.5?.5*Math.pow(2*l,4):1-.5*Math.pow(2*(1-l),4)}}function hu(u){const i=typeof window<"u"?window.location.origin:"",l=typeof window<"u"?window.location.pathname.replace(/\/[^/]*$/,"/"):"/",o=i+l+"lib/three.module.min.js",r=i+l+"lib/p5.min.js",a=/p5\.(min\.)?js|new\s+p5\s*\(/i.test(u),e=['<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}})();<\/script>',`<script type="importmap">{"imports":{"three":"${o}","three/":"${o.replace(/three\.module\.min\.js$/,"")}"}}<\/script>`,a?`<script src="${r}"><\/script>`:""].filter(Boolean).join(`
`);return/<head[^>]*>/i.test(u)?u.replace(/<head[^>]*>/i,t=>t+`
`+e):/<body[^>]*>/i.test(u)?u.replace(/<body[^>]*>/i,t=>t+`
`+e):e+`
`+u}const ke=new Map;function gu(u,i,l=1920,o=1080){const r=ke.get(u);if(r)return r;const a=document.createElement("iframe");a.style.cssText=`
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: ${l}px;
    height: ${o}px;
    border: none;
    pointer-events: none;
  `;const e=hu(i.htmlCode),t=new Blob([e],{type:"text/html"}),s=URL.createObjectURL(t);a.src=s,document.body.appendChild(a);const n=document.createElement("canvas");n.width=1,n.height=1;const c=n.getContext("2d");c&&(c.fillStyle="#000",c.fillRect(0,0,1,1));const f=new Ct(n);f.minFilter=O,f.magFilter=O,f.colorSpace=Qt;let v=null;const d=()=>{try{const g=a.contentDocument||a.contentWindow?.document;if(!g)return;const b=g.querySelector("canvas");if(!b||b.width<=0||b.height<=0)return;v!==b&&(f.image=b,p.canvas=b,v=b),f.needsUpdate=!0}catch{}},m=g=>{try{const b=a.contentWindow;b?.shaderParams&&Object.assign(b.shaderParams,g)}catch{}},h=()=>{f.dispose(),a.remove(),URL.revokeObjectURL(s),ke.delete(u)},p={id:u,iframe:a,canvas:n,texture:f,animationType:i.animationType,updateTexture:d,updateParams:m,dispose:h};return ke.set(u,p),p}function Mn(u){return ke.get(u)}function Dn(u){const i=ke.get(u);i&&i.dispose()}function An(u,i){const l=ke.get(u);l&&l.updateParams(i)}class Bn{renderer;scene;camera;width;height;compositeTarget;tempTarget;layerObjects=new Map;gpuEffectRunner=new la;gpuEffectLiveKeys=new Set;lastGpuEffectFrameTime=0;compositeScene;compositeMaterial;compositeQuad;blendMaterials=new Map;effectMaterials=new Map;effectTargetA;effectTargetB;effectBlendTarget;effectFeedbackTargets=new Map;effectFeedbackHasPrior=new Map;feedbackCopyMaterial=null;effectScene;effectQuad;startTime;manualTime=null;outputQuad;outputScene;colorTextures=new Map;maskMaterials=new Map;maskTarget=null;maskUnionTarget=null;maskUnionAccumMaterial=null;maskApplyMaterial=null;shapeMaskMaterial=null;shapeMaskTarget=null;drawingRendererRef=null;shapeRendererRef=null;edgeEffectTarget=null;groupTargets=new Map;groupShaderTargets=new Map;_copyGeometry;_copyMaterial;_copyMesh;_copyScene;_tempColor;domeEnabled=!1;domeScene=null;domeQuad=null;domeMaterial=null;domeSettings={mode:0,fov:Math.PI,rotation:0,tilt:0,offsetX:0,offsetY:0,curvature:1,truncation:1};transitionTarget=null;transitionScene=null;transitionQuad=null;transitionMaterial=null;transitionProgress=1;transitionStartTime=0;transitionDuration=0;bankATarget=null;bankBTarget=null;crossfadeScene=null;crossfadeQuad=null;crossfadeMaterials=new Map;crossfadeActive=!1;crossfadeValue=0;crossfadeTransitionName="dissolve";crossfadeBlendModeIndex=0;crossfadeStartTime=performance.now()/1e3;vjCrossfadeTargets=new Map;constructor(i,l,o,r={}){this.width=l,this.height=o;const a=r.preserveDrawingBuffer??!0;this.renderer=new wo({canvas:i,antialias:!1,alpha:!0,preserveDrawingBuffer:a,premultipliedAlpha:!1,powerPreference:"high-performance"}),this.renderer.setPixelRatio(1),this.renderer.setSize(l,o,!1),this.renderer.setClearColor(0,1),this.renderer.debug.checkShaderErrors=!0,this.detectGPU();const e=this.renderer.getContext();this.maxTextureSize=Math.min(e.getParameter(e.MAX_TEXTURE_SIZE)||4096,e.getParameter(e.MAX_RENDERBUFFER_SIZE)||4096),(this.width>this.maxTextureSize||this.height>this.maxTextureSize)&&(console.warn(`[RenderEngine] Project size ${this.width}x${this.height} exceeds GPU max ${this.maxTextureSize}x${this.maxTextureSize}; clamping.`),this.width=Math.min(this.width,this.maxTextureSize),this.height=Math.min(this.height,this.maxTextureSize),this.renderer.setSize(this.width,this.height,!1)),this.camera=new Zt(-1,1,1,-1,.1,10),this.camera.position.z=1,this.scene=new ue,this.compositeTarget=this.createRenderTarget(),this.tempTarget=this.createRenderTarget(),this.compositeScene=new ue,this.compositeMaterial=this.createBlendMaterial("normal");const t=new oe(2,2);this.compositeQuad=new ne(t,this.compositeMaterial),this.compositeScene.add(this.compositeQuad),this.crossfadeScene=new ue,this.crossfadeQuad=new ne(new oe(2,2)),this.crossfadeScene.add(this.crossfadeQuad),this.outputScene=new ue;const s=new q({vertexShader:Be,fragmentShader:ka,uniforms:{uTexture:{value:this.compositeTarget.texture},uOutputCrop:{value:new ot(0,0,1,1)},uOutputRotation:{value:0},uBrightness:{value:1},uContrast:{value:1},uGamma:{value:1}},depthTest:!1,depthWrite:!1}),n=new oe(2,2);this.outputQuad=new ne(n,s),this.outputScene.add(this.outputQuad),this.effectTargetA=this.createRenderTarget(),this.effectTargetB=this.createRenderTarget(),this.effectBlendTarget=this.createRenderTarget(),this.effectScene=new ue;const c=new oe(2,2);this.effectQuad=new ne(c),this.effectScene.add(this.effectQuad),this.startTime=performance.now()/1e3,this.initBlendMaterials(),this._copyGeometry=new oe(2,2),this._copyMaterial=new Ro({transparent:!0}),this._copyMesh=new ne(this._copyGeometry,this._copyMaterial),this._copyScene=new ue,this._copyScene.add(this._copyMesh),this._tempColor=new Jt}setOutputTransform(i){const l=this.outputQuad.material,o=Math.max(0,Math.min(.99,i.cropX??0)),r=Math.max(0,Math.min(.99,i.cropY??0)),a=Math.max(.01,Math.min(1-o,i.cropWidth??1)),e=Math.max(.01,Math.min(1-r,i.cropHeight??1)),t=((i.rotation??0)%360+360)%360,s=t===90?1:t===180?2:t===270?3:0;l.uniforms.uOutputCrop.value.set(o,r,a,e),l.uniforms.uOutputRotation.value=s,l.uniforms.uBrightness.value=Math.max(0,i.brightness??1),l.uniforms.uContrast.value=Math.max(0,i.contrast??1),l.uniforms.uGamma.value=Math.max(.001,i.gamma??1)}setWatermark(i){}applyWatermark(){}setDomeEnabled(i){this.domeEnabled=i}setDomeSettings(i){const l={angular:0,stereographic:1,orthographic:2,equirectangular:3};this.domeSettings={mode:l[i.mode]??0,fov:i.fov*Math.PI/180,rotation:i.rotation*Math.PI/180,tilt:i.tilt*Math.PI/180,offsetX:i.offsetX,offsetY:i.offsetY,curvature:i.curvature,truncation:i.truncation}}initDomeProjection(){if(this.domeScene)return;this.domeScene=new ue,this.domeMaterial=new q({vertexShader:Be,fragmentShader:eu,uniforms:{uTexture:{value:null},uResolution:{value:new P(this.width,this.height)},uFOV:{value:Math.PI},uRotation:{value:0},uTilt:{value:0},uOffset:{value:new P(0,0)},uMode:{value:0},uCurvature:{value:1},uTruncation:{value:1}},depthTest:!1,depthWrite:!1});const i=new oe(2,2);this.domeQuad=new ne(i,this.domeMaterial),this.domeScene.add(this.domeQuad)}applyDomeProjection(){this.domeEnabled&&(this.initDomeProjection(),!(!this.domeScene||!this.domeMaterial)&&(this.domeMaterial.uniforms.uTexture.value=this.compositeTarget.texture,this.domeMaterial.uniforms.uResolution.value.set(this.width,this.height),this.domeMaterial.uniforms.uFOV.value=this.domeSettings.fov,this.domeMaterial.uniforms.uRotation.value=this.domeSettings.rotation,this.domeMaterial.uniforms.uTilt.value=this.domeSettings.tilt,this.domeMaterial.uniforms.uOffset.value.set(this.domeSettings.offsetX,this.domeSettings.offsetY),this.domeMaterial.uniforms.uMode.value=this.domeSettings.mode,this.domeMaterial.uniforms.uCurvature.value=this.domeSettings.curvature,this.domeMaterial.uniforms.uTruncation.value=this.domeSettings.truncation,this.renderer.setRenderTarget(this.tempTarget),this.renderer.render(this.domeScene,this.camera),this._copyMaterial.map=this.tempTarget.texture,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.render(this._copyScene,this.camera)))}gpuRenderer="unknown";gpuVendor="unknown";gpuIsIntegrated=!1;maxTextureSize=4096;detectGPU(){const i=this.renderer.getContext(),l=i.getExtension("WEBGL_debug_renderer_info");l?(this.gpuRenderer=i.getParameter(l.UNMASKED_RENDERER_WEBGL)||"unknown",this.gpuVendor=i.getParameter(l.UNMASKED_VENDOR_WEBGL)||"unknown"):(this.gpuRenderer=i.getParameter(i.RENDERER)||"unknown",this.gpuVendor=i.getParameter(i.VENDOR)||"unknown");const o=this.gpuRenderer.toLowerCase();if(["nvidia","geforce","rtx","gtx","quadro","radeon rx","radeon pro","radeon vii","arc a"].some(h=>o.includes(h)))this.gpuIsIntegrated=!1;else{const h=["intel","uhd","iris","hd graphics","vega 3","vega 5","vega 6","vega 7","vega 8","vega 10","vega 11","radeon(tm) graphics","microsoft basic render","swiftshader","llvmpipe"];this.gpuIsIntegrated=h.some(p=>o.includes(p))}const e=i.getParameter(i.VERSION),t=i.getParameter(i.SHADING_LANGUAGE_VERSION),s=i.getParameter(i.MAX_TEXTURE_SIZE),n=i.getParameter(i.MAX_VIEWPORT_DIMS),c=i.getParameter(i.MAX_RENDERBUFFER_SIZE),f=i.drawingBufferWidth,v=i.drawingBufferHeight,d=this.renderer.getPixelRatio(),m=this.gpuIsIntegrated?"⚠️  INTEGRATED GPU (may cause shader timeouts)":"✅ Discrete GPU";if(console.log(`[GPU] Detected: ${this.gpuRenderer}`),console.log(`[GPU] Vendor: ${this.gpuVendor}`),console.log(`[GPU] Type: ${m}`),console.log(`[GPU] GL Version: ${e}`),console.log(`[GPU] GLSL Version: ${t}`),console.log(`[GPU] Max Texture Size: ${s}`),console.log(`[GPU] Max Renderbuffer: ${c}`),console.log(`[GPU] Max Viewport: ${n?.[0]}x${n?.[1]}`),console.log(`[GPU] Drawing Buffer: ${f}x${v}  (pixelRatio=${d}, window.devicePixelRatio=${typeof window<"u"?window.devicePixelRatio:"n/a"})`),console.log(`[GPU] Project Size: ${this.width}x${this.height}`),this.gpuIsIntegrated){const h=typeof navigator<"u"&&/Mac/i.test(navigator.platform);console.warn(h?"[GPU] Running on integrated GPU. Heavy shaders may slow down or timeout on this machine.":`[GPU] WARNING: Running on integrated GPU. Heavy shaders may timeout.
To fix: Open Windows Graphics Settings → Add this app → Set to "High Performance".
Or in NVIDIA Control Panel → Manage 3D Settings → Add this program → High-performance NVIDIA processor.`)}}getGPUInfo(){return{renderer:this.gpuRenderer,vendor:this.gpuVendor,isIntegrated:this.gpuIsIntegrated}}createRenderTarget(){const i=Math.min(this.width,this.maxTextureSize),l=Math.min(this.height,this.maxTextureSize);try{return new nt(i,l,{minFilter:O,magFilter:O,format:xe,type:st})}catch(o){return console.error(`[RenderEngine] RenderTarget allocation failed at ${i}x${l}:`,o),new nt(64,64,{minFilter:O,magFilter:O,format:xe,type:st})}}initBlendMaterials(){const i=["normal","multiply","screen","difference","add","subtract","overlay","darken","lighten","exclusion","hardlight","softlight","color-dodge","color-burn","hue","saturation","color","luminosity","divide","average","negation","phoenix","linear-light","hard-mix","vivid-light","pin-light"];for(const l of i)this.blendMaterials.set(l,this.createBlendMaterial(l))}createBlendMaterial(i){return new q({vertexShader:Be,fragmentShader:Et[i]||Et.normal,uniforms:{uBase:{value:null},uLayer:{value:null},uOpacity:{value:1}},transparent:!0,depthTest:!1,depthWrite:!1})}createLayerMaterial(i){return new q({vertexShader:wa,fragmentShader:Ra,uniforms:{uTexture:{value:null},uOpacity:{value:1},uBgOpacity:{value:1},uTopLeft:{value:new P(i.topLeft.x,i.topLeft.y)},uTopRight:{value:new P(i.topRight.x,i.topRight.y)},uBottomLeft:{value:new P(i.bottomLeft.x,i.bottomLeft.y)},uBottomRight:{value:new P(i.bottomRight.x,i.bottomRight.y)},uUseMeshPosition:{value:!1},uCropRegion:{value:new ot(0,0,1,1)},uCropEnabled:{value:!1},uLayerShapeType:{value:0},uLayerShapeFeather:{value:0},uLayerShapeRotation:{value:0},uLayerShapeScale:{value:1},uLayerShapeHasControlPoints:{value:0},uLayerShapeControlPointCount:{value:0},uLayerShapeControlPoints:{value:[new P(.2,.8),new P(.8,.8),new P(.2,.2),new P(.8,.2),new P(.5,.5)]},uFlipH:{value:!1},uFlipV:{value:!1},uContentFit:{value:0},uSourceAspect:{value:1},uLayerAspect:{value:1},uCustomShapeEnabled:{value:0},uCustomShapePointCount:{value:0},uCustomShapePoints:{value:Array.from({length:256},()=>new P(0,0))},uCustomShapeFit:{value:1},uCustomShapeBBox:{value:new ot(0,0,1,1)},uCustomShapeInvert:{value:0}},transparent:!0,depthTest:!1,depthWrite:!1,side:ko})}getOrCreateLayerObject(i){let l=this.layerObjects.get(i.id);const o="quad",r=l&&(i.warpMode==="mesh"&&l.warpMode!=="mesh"||i.warpMode!=="mesh"&&l.warpMode==="mesh"||i.warpMode==="mesh"&&i.meshGrid&&(l.meshGridSize?.rows!==i.meshGrid.rows||l.meshGridSize?.cols!==i.meshGrid.cols));let a=null;if(r&&l&&(a=l.material.uniforms.uTexture.value,l.mesh.geometry.dispose(),l.material.dispose(),l.renderTarget.dispose(),this.layerObjects.delete(i.id),l=void 0),!l){let e;if(i.warpMode==="mesh"&&i.meshGrid){const d=i.meshGrid.cols-1,m=i.meshGrid.rows-1;e=new oe(2,2,d,m)}else e=new oe(2,2,32,32);const s=this.createLayerMaterial(i.corners);a&&(s.uniforms.uTexture.value=a);const n=new ne(e,s),c=this.createRenderTarget(),f=e.attributes.position,v=new Float32Array(f.count*2);for(let d=0;d<f.count;d++)v[d*2]=(f.getX(d)+1)/2,v[d*2+1]=(f.getY(d)+1)/2;l={mesh:n,material:s,renderTarget:c,geometry:e,warpMode:i.warpMode==="mesh"?"mesh":"corners",meshGridSize:i.meshGrid?{rows:i.meshGrid.rows,cols:i.meshGrid.cols}:void 0,originalUVs:v,shapeType:o,defaultControlPoints:void 0},this.layerObjects.set(i.id,l)}return l}applyMeshWarp(i,l,o,r){const a=i.attributes.position,e=l.rows,t=l.cols;for(let s=0;s<a.count;s++){const n=r[s*2],c=1-r[s*2+1],f=n*(t-1),v=c*(e-1),d=Math.floor(f),m=Math.min(d+1,t-1),h=Math.floor(v),p=Math.min(h+1,e-1),g=f-d,b=v-h,y=l.points[h][d],T=l.points[h][m],C=l.points[p][d],w=l.points[p][m],x=(1-g)*(1-b)*y.x+g*(1-b)*T.x+(1-g)*b*C.x+g*b*w.x,S=(1-g)*(1-b)*y.y+g*(1-b)*T.y+(1-g)*b*C.y+g*b*w.y,R=o.topLeft.x+(o.topRight.x-o.topLeft.x)*x,k=o.topLeft.y+(o.topRight.y-o.topLeft.y)*x,D=o.bottomLeft.x+(o.bottomRight.x-o.bottomLeft.x)*x,A=o.bottomLeft.y+(o.bottomRight.y-o.bottomLeft.y)*x,M=D+(R-D)*S,z=A+(k-A)*S;a.setXY(s,M*2-1,z*2-1)}a.needsUpdate=!0}applyShapeWarp(i,l,o,r,a){if(!o.length||!r.length||l==="quad"||l==="rectangle")return;const e=i.attributes.position;if(l==="triangle"){for(let n=0;n<3&&n<o.length;n++){const c=o[n],f=a.topLeft.x+(a.topRight.x-a.topLeft.x)*c.x,v=a.topLeft.y+(a.topRight.y-a.topLeft.y)*c.x,d=a.bottomLeft.x+(a.bottomRight.x-a.bottomLeft.x)*c.x,m=a.bottomLeft.y+(a.bottomRight.y-a.bottomLeft.y)*c.x,h=d+(f-d)*c.y,p=m+(v-m)*c.y;e.setXY(n,h*2-1,p*2-1)}e.needsUpdate=!0;return}const t=o.map((n,c)=>({x:n.x-r[c].x,y:n.y-r[c].y})),s=o.length;for(let n=0;n<e.count;n++){const c=e.getX(n),f=e.getY(n),v=(c+1)/2,d=(f+1)/2,m=Math.sqrt(Math.pow(v-.5,2)+Math.pow(d-.5,2));if(m<.01){const U=a.topLeft.x+(a.topRight.x-a.topLeft.x)*v,W=a.topLeft.y+(a.topRight.y-a.topLeft.y)*v,_=a.bottomLeft.x+(a.bottomRight.x-a.bottomLeft.x)*v,N=a.bottomLeft.y+(a.bottomRight.y-a.bottomLeft.y)*v,Q=_+(U-_)*d,ee=N+(W-N)*d;e.setXY(n,Q*2-1,ee*2-1);continue}const g=(Math.atan2(d-.5,v-.5)+Math.PI)/(2*Math.PI)*s,b=Math.floor(g)%s,y=(b+1)%s,T=g-Math.floor(g),C={x:t[b].x*(1-T)+t[y].x*T,y:t[b].y*(1-T)+t[y].y*T},x=Math.min(1,m/.5),S=v+C.x*x,R=d+C.y*x,k=a.topLeft.x+(a.topRight.x-a.topLeft.x)*S,D=a.topLeft.y+(a.topRight.y-a.topLeft.y)*S,A=a.bottomLeft.x+(a.bottomRight.x-a.bottomLeft.x)*S,M=a.bottomLeft.y+(a.bottomRight.y-a.bottomLeft.y)*S,z=A+(k-A)*R,V=M+(D-M)*R;e.setXY(n,z*2-1,V*2-1)}e.needsUpdate=!0}updateLayerCorners(i,l){const o=this.layerObjects.get(i);o&&(o.material.uniforms.uTopLeft.value.set(l.topLeft.x,l.topLeft.y),o.material.uniforms.uTopRight.value.set(l.topRight.x,l.topRight.y),o.material.uniforms.uBottomLeft.value.set(l.bottomLeft.x,l.bottomLeft.y),o.material.uniforms.uBottomRight.value.set(l.bottomRight.x,l.bottomRight.y))}updateLayerTexture(i,l){const o=this.layerObjects.get(i);o&&(o.material.uniforms.uTexture.value=l)}removeLayer(i){const l=this.layerObjects.get(i);l&&(l.mesh.geometry.dispose(),l.material.dispose(),l.renderTarget.dispose(),this.layerObjects.delete(i));const o=this.colorTextures.get(i);o&&(o.dispose(),this.colorTextures.delete(i));const r=this.maskMaterials.get(i);r&&(r.dispose(),this.maskMaterials.delete(i))}hslToRgb(i,l,o){l/=100,o/=100;const r=t=>(t+i/30)%12,a=l*Math.min(o,1-o),e=t=>o-a*Math.max(-1,Math.min(r(t)-3,Math.min(9-r(t),1)));return[Math.round(e(0)*255),Math.round(e(8)*255),Math.round(e(4)*255)]}getOrCreateColorTexture(i,l){let o=this.colorTextures.get(i);if(!o){const n=new Uint8Array(4);o=new Bt(n,1,1,xe),o.minFilter=O,o.magFilter=O,this.colorTextures.set(i,o)}const[r,a,e]=this.hslToRgb(l.hue,l.saturation,l.lightness),t=Math.round(l.alpha*255),s=o.image.data;return s[0]=r,s[1]=a,s[2]=e,s[3]=t,o.needsUpdate=!0,o}getOrCreateFeedbackTarget(i){let l=this.effectFeedbackTargets.get(i);return l?(l.width!==this.width||l.height!==this.height)&&(l.setSize(this.width,this.height),this.effectFeedbackHasPrior.set(i,!1)):(l=this.createRenderTarget(),this.effectFeedbackTargets.set(i,l),this.effectFeedbackHasPrior.set(i,!1)),l}copyTextureToTarget(i,l){this.feedbackCopyMaterial||(this.feedbackCopyMaterial=new q({vertexShader:ge,fragmentShader:`
          uniform sampler2D uTexture;
          varying vec2 vUv;
          void main() { gl_FragColor = texture2D(uTexture, vUv); }
        `,uniforms:{uTexture:{value:null}},transparent:!1,depthTest:!1,depthWrite:!1})),this.feedbackCopyMaterial.uniforms.uTexture.value=i,this.effectQuad.material=this.feedbackCopyMaterial,this.renderer.setRenderTarget(l),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera)}getOrCreateEffectMaterial(i){let l=this.effectMaterials.get(i.id);if(!l){l=Jl(i.type),l.needsUpdate=!0,this.effectMaterials.set(i.id,l);const o=this.renderer.getContext(),r=l.program;if(r){const a=r.fragmentShader;a&&!o.getShaderParameter(a,o.COMPILE_STATUS)&&console.error(`[Effect ${i.type}] Fragment shader error:`,o.getShaderInfoLog(a))}}return l}getOrCreateMaskMaterial(i){let l=this.maskMaterials.get(i);if(!l){const o=[];for(let r=0;r<256;r++)o.push(new P(0,0));l=new q({vertexShader:ge,fragmentShader:qa,uniforms:{uTexture:{value:null},uPoints:{value:o},uPointCount:{value:0},uFeather:{value:0},uInvert:{value:0}},transparent:!0,depthTest:!1,depthWrite:!1}),this.maskMaterials.set(i,l)}return l}tessellateMaskShape(i){const l=[],r=i.length;if(r>=256){for(let s=0;s<Math.min(r,256);s++)l.push({x:i[s].x,y:i[s].y});return l}let a=0;for(let s=0;s<r;s++){const n=i[s],c=i[(s+1)%r];(n.cpOut||c.cpIn)&&a++}const e=256-r,t=a===0?1:Math.max(1,Math.min(12,Math.floor(e/a)+1));for(let s=0;s<r;s++){const n=i[s],c=(s+1)%r,f=i[c],v=n.cpOut||f.cpIn;if(l.push({x:n.x,y:n.y}),v&&t>1){const d=n.cpOut??n,m=f.cpIn??f;for(let h=1;h<t&&!(l.length>=256);h++){const p=h/t,g=1-p;l.push({x:g*g*g*n.x+3*g*g*p*d.x+3*g*p*p*m.x+p*p*p*f.x,y:g*g*g*n.y+3*g*g*p*d.y+3*g*p*p*m.y+p*p*p*f.y})}}if(l.length>=256)break}return l}getOrCreateMaskUnionAccumMaterial(){if(!this.maskUnionAccumMaterial){const i=[];for(let l=0;l<256;l++)i.push(new P(0,0));this.maskUnionAccumMaterial=new q({vertexShader:ge,fragmentShader:Ya,uniforms:{uPoints:{value:i},uPointCount:{value:0},uFeather:{value:0}},transparent:!0,blending:Mo,blendEquationAlpha:Ut,blendSrcAlpha:He,blendDstAlpha:He,blendEquation:Ut,blendSrc:He,blendDst:He,depthTest:!1,depthWrite:!1})}return this.maskUnionAccumMaterial}getOrCreateMaskApplyMaterial(){return this.maskApplyMaterial||(this.maskApplyMaterial=new q({vertexShader:ge,fragmentShader:Xa,uniforms:{uSource:{value:null},uMask:{value:null},uInvert:{value:0}},transparent:!0,depthTest:!1,depthWrite:!1})),this.maskApplyMaterial}applyMask(i,l,o){if(!l.enabled)return i;const a=(l.shapes??[]).filter(n=>n.closed&&n.points.length>=3);if(a.length===0)return i;const e=[];for(const n of a){let c=this.tessellateMaskShape(n.points);if(!(c.length<3)){if(c.length>64){console.warn(`[applyMask] Shape on layer ${o} tessellates to ${c.length} points (>64); downsampling for shader.`);const f=c.length/64,v=[];for(let d=0;d<64;d++)v.push(c[Math.floor(d*f)]);c=v}e.push(c)}}if(e.length===0)return i;this.maskTarget||(this.maskTarget=this.createRenderTarget());const t=this.renderer.getClearColor(this._tempColor),s=this.renderer.getClearAlpha();if(this.renderer.setClearColor(0,0),e.length===1){const n=e[0],c=this.getOrCreateMaskMaterial(o);c.uniforms.uTexture.value=i,c.uniforms.uPointCount.value=Math.min(n.length,64),c.uniforms.uFeather.value=l.feather,c.uniforms.uInvert.value=l.inverted?1:0;const f=c.uniforms.uPoints.value;for(let v=0;v<64;v++)v<n.length?f[v].set(n[v].x,n[v].y):f[v].set(0,0);this.effectQuad.material=c,this.renderer.setRenderTarget(this.maskTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera)}else{this.maskUnionTarget||(this.maskUnionTarget=this.createRenderTarget());const n=this.getOrCreateMaskUnionAccumMaterial();this.renderer.setRenderTarget(this.maskUnionTarget),this.renderer.clear();const c=this.renderer.autoClear;this.renderer.autoClear=!1,this.effectQuad.material=n;const f=n.uniforms.uPoints.value;for(const d of e){const m=Math.min(d.length,64);n.uniforms.uPointCount.value=m,n.uniforms.uFeather.value=l.feather;for(let h=0;h<64;h++)h<d.length?f[h].set(d[h].x,d[h].y):f[h].set(0,0);this.renderer.render(this.effectScene,this.camera)}this.renderer.autoClear=c;const v=this.getOrCreateMaskApplyMaterial();v.uniforms.uSource.value=i,v.uniforms.uMask.value=this.maskUnionTarget.texture,v.uniforms.uInvert.value=l.inverted?1:0,this.effectQuad.material=v,this.renderer.setRenderTarget(this.maskTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera)}return this.renderer.setClearColor(t,s),this.maskTarget.texture}applyShapeMask(i,l){if(!l.layerShape||!l.layerShape.enabled||l.layerShape.type==="rectangle")return i;if(l.layerShape.type==="custom"){const n=l.layerShape.params.customPoints;if(!n||n.length<3||!l.layerShape.params.customClosed)return i;this.shapeMaskTarget||(this.shapeMaskTarget=this.createRenderTarget());const c=this.getOrCreateMaskMaterial(l.id+"_custom");c.uniforms.uTexture.value=i,c.uniforms.uPointCount.value=Math.min(n.length,64),c.uniforms.uFeather.value=l.layerShape.params.feather??0,c.uniforms.uInvert.value=0;const f=c.uniforms.uPoints.value;for(let m=0;m<64;m++)m<n.length?f[m].set(n[m].x,n[m].y):f[m].set(0,0);const v=this.renderer.getClearColor(this._tempColor),d=this.renderer.getClearAlpha();return this.renderer.setClearColor(0,0),this.effectQuad.material=c,this.renderer.setRenderTarget(this.shapeMaskTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera),this.renderer.setClearColor(v,d),this.shapeMaskTarget.texture}this.shapeMaskTarget||(this.shapeMaskTarget=this.createRenderTarget()),this.shapeMaskMaterial||(this.shapeMaskMaterial=new q({vertexShader:ge,fragmentShader:Ka,uniforms:{uTexture:{value:null},uShapeType:{value:0},uRadiusX:{value:.5},uRadiusY:{value:.5},uSides:{value:6},uInnerRadius:{value:.4},uRotation:{value:0},uFeather:{value:0},uScale:{value:1},uLineWidth:{value:.05},uLineStart:{value:new P(.2,.5)},uLineEnd:{value:new P(.8,.5)},uInvert:{value:0},uHasControlPoints:{value:0},uControlPointCount:{value:0},uControlPoints:{value:[new P(.2,.8),new P(.8,.8),new P(.2,.2),new P(.8,.2),new P(.5,.5)]}},transparent:!0,depthTest:!1,depthWrite:!1}));const o={rectangle:0,circle:1,ellipse:2,triangle:3,polygon:4,star:5,line:6,polyline:6},r=l.layerShape.params,a=this.shapeMaskMaterial;a.uniforms.uTexture.value=i,a.uniforms.uShapeType.value=o[l.layerShape.type]??0,a.uniforms.uRadiusX.value=r.radiusX??.5,a.uniforms.uRadiusY.value=r.radiusY??.35,a.uniforms.uSides.value=r.sides??6,a.uniforms.uInnerRadius.value=r.innerRadius??.4,a.uniforms.uRotation.value=(r.rotation??0)*Math.PI/180,a.uniforms.uFeather.value=r.feather??0,a.uniforms.uScale.value=r.scale??1,a.uniforms.uLineWidth.value=r.lineWidth??.05,a.uniforms.uInvert.value=r.invert?1:0,a.uniforms.uHasControlPoints.value=0,a.uniforms.uControlPointCount.value=0;const e=l.layerShape.controlPoints;if(e&&e.length>0&&(l.layerShape.type==="circle"||l.layerShape.type==="triangle")){const n=a.uniforms.uControlPoints.value,c=Math.min(e.length,n.length);for(let f=0;f<c;f++)n[f].set(e[f].x,e[f].y);a.uniforms.uHasControlPoints.value=1,a.uniforms.uControlPointCount.value=c}const t=this.renderer.getClearColor(this._tempColor),s=this.renderer.getClearAlpha();return this.renderer.setClearColor(0,0),this.effectQuad.material=a,this.renderer.setRenderTarget(this.shapeMaskTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera),this.renderer.setClearColor(t,s),this.shapeMaskTarget.texture}applyEffects(i,l,o="__composition__"){const r=l.filter(h=>h.enabled);if(r.length===0)return i;const a=performance.now(),e=this.manualTime!==null?this.manualTime:a/1e3-this.startTime,t=H(Qe),s=t?.isActive?t.rms??0:0,n=this.lastGpuEffectFrameTime>0?Math.min(.1,(a-this.lastGpuEffectFrameTime)/1e3):1/60;this.lastGpuEffectFrameTime=a;let c=i,f=this.effectTargetA,v=this.effectTargetB;const d=this.renderer.getClearColor(this._tempColor),m=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0);for(let h=0;h<r.length;h++){const p=r[h],g=p.opacity??1,b=p.blendMode??"normal",y=g<1||b!=="normal",T=c;if(ua(p.type)){const S=`${o}::${p.id}`;this.gpuEffectLiveKeys.add(S);const R=this.gpuEffectRunner.runGpuEffect(c,p,o,n,this.renderer,this.width,this.height);if(y){const k=this.blendMaterials.get(b)||this.blendMaterials.get("normal");k.uniforms.uBase.value=T,k.uniforms.uLayer.value=R,k.uniforms.uOpacity.value=g,this.effectQuad.material=k,this.renderer.setRenderTarget(this.effectBlendTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera),c=this.effectBlendTarget.texture;const D=f;f=v,v=D}else c=R;continue}const C=this.getOrCreateEffectMaterial(p);Ql(C,p,this.width,this.height,e,s),C.uniforms.uTexture.value=c;const w=!!C.uniforms.uFeedback&&!!C.uniforms.uHasFeedback;let x=null;if(w){x=this.getOrCreateFeedbackTarget(p.id);const S=this.effectFeedbackHasPrior.get(p.id)===!0;C.uniforms.uFeedback.value=S?x.texture:null,C.uniforms.uHasFeedback.value=S?1:0}if(this.effectQuad.material=C,this.renderer.setRenderTarget(f),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera),w&&x&&(this.copyTextureToTarget(f.texture,x),this.effectFeedbackHasPrior.set(p.id,!0)),y){const S=this.blendMaterials.get(b)||this.blendMaterials.get("normal");S.uniforms.uBase.value=T,S.uniforms.uLayer.value=f.texture,S.uniforms.uOpacity.value=g,this.effectQuad.material=S,this.renderer.setRenderTarget(this.effectBlendTarget),this.renderer.clear(),this.renderer.render(this.effectScene,this.camera),c=this.effectBlendTarget.texture;const R=f;f=v,v=R}else{c=f.texture;const S=f;f=v,v=S}}return this.renderer.setClearColor(d,m),c}reapStaleGpuEffects(){this.gpuEffectRunner.isReady()&&(this.gpuEffectRunner.reapStale(this.gpuEffectLiveKeys),this.gpuEffectLiveKeys.clear())}buildRenderPlan(i){const l=[];new Set(i.filter(o=>o.parentGroupId).map(o=>o.id));for(const o of i)if(!o.parentGroupId&&o.visible)if(o.type==="group"){const r=!!o.source?.texture,a=i.filter(e=>e.parentGroupId===o.id&&e.visible&&(r||this.hasLayerTexture(e)));a.length>0&&l.push({kind:"group",group:o,children:a})}else this.hasLayerTexture(o)&&l.push({kind:"standalone",layer:o});return l}hasLayerTexture(i){if((i.type==="media"||i.type==="screen")&&i.source){if(i.source.texture)return!0;const l=this.layerObjects.get(i.id);return!!(l&&l.material.uniforms.uTexture.value)}return!!(i.type==="lines"&&i._linesTexture||i.type==="svg"&&i._svgTexture||i.type==="color"&&i.colorContent||i.type==="lightpainting"&&i._lightPaintingTexture||i.type==="text"&&i._textTexture||i.type==="splat"&&i._splatTexture||i.type==="model3d"&&i._model3dTexture||i.type==="gpu"&&i._gpuLayerTexture)}render(i,l,o,r){const a=this.buildRenderPlan(i);if(a.reverse(),this.crossfadeActive){const e=a.filter(c=>this.unitBank(c)==="A"),t=a.filter(c=>this.unitBank(c)==="B"),s=a.filter(c=>!this.unitBank(c));this.ensureBankTargets();const n=this.compositeTarget;this.compositeTarget=this.bankATarget,this.renderer.setRenderTarget(this.bankATarget),this.renderer.setClearColor(0,1),this.renderer.clear(),this.renderUnitsToCurrentTarget(e),this.compositeTarget=this.bankBTarget,this.renderer.setRenderTarget(this.bankBTarget),this.renderer.setClearColor(0,1),this.renderer.clear(),this.renderUnitsToCurrentTarget(t),this.compositeTarget=n,this.applyBankCrossfade(),s.length>0&&this.renderUnitsToCurrentTarget(s,1)}else this.renderer.setRenderTarget(this.compositeTarget),this.renderer.setClearColor(0,1),this.renderer.clear(),this.renderUnitsToCurrentTarget(a);if(l){this.swapTargets();const e=this.blendMaterials.get("add")||this.blendMaterials.get("normal");e.uniforms.uBase.value=this.tempTarget.texture,e.uniforms.uLayer.value=l,e.uniforms.uOpacity.value=1,this.compositeQuad.material=e,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.render(this.compositeScene,this.camera)}if(o&&o.length>0){let e=this.compositeTarget.texture;e=this.applyEffects(e,o,"__composition__"),e!==this.compositeTarget.texture&&(this._copyMaterial.map=e,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.render(this._copyScene,this.camera))}if(r&&r.length>0)for(const e of r){if(e.value<=.001||e.effects.length===0)continue;const t=e.effects.filter(f=>f.enabled);if(t.length===0)continue;this.swapTargets();const s=this.tempTarget.texture,n=this.applyEffects(s,t,`__macro__${e.id}`),c=this.blendMaterials.get("normal");c.uniforms.uBase.value=s,c.uniforms.uLayer.value=n,c.uniforms.uOpacity.value=e.value,this.compositeQuad.material=c,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.clear(),this.renderer.render(this.compositeScene,this.camera)}this.applyWatermark(),this.applyDomeProjection(),this.transitionProgress<1?this.applyTransition():(this.renderer.setRenderTarget(null),this.outputQuad.material.uniforms.uTexture.value=this.compositeTarget.texture,this.renderer.render(this.outputScene,this.camera)),this.reapStaleGpuEffects()}swapTargets(){this._copyMaterial.map=this.compositeTarget.texture,this.renderer.setRenderTarget(this.tempTarget),this.renderer.render(this._copyScene,this.camera)}compositeTexture(i,l,o,r){if(r){const a=this.blendMaterials.get("normal");a.uniforms.uBase.value=this.createBlackTexture(),a.uniforms.uLayer.value=i,a.uniforms.uOpacity.value=l,this.compositeQuad.material=a,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.render(this.compositeScene,this.camera)}else{this.swapTargets();const a=this.blendMaterials.get(o)||this.blendMaterials.get("normal");a.uniforms.uBase.value=this.tempTarget.texture,a.uniforms.uLayer.value=i,a.uniforms.uOpacity.value=l,this.compositeQuad.material=a,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.render(this.compositeScene,this.camera)}}renderGroupToTexture(i,l){let o=this.groupTargets.get(i.id);o||(o=this.createRenderTarget(),this.groupTargets.set(i.id,o)),this.renderer.setRenderTarget(o),this.renderer.setClearColor(0,0),this.renderer.clear();const r=i.groupConfig,a=r?.shaderMode==="unified",e=r?.overrideStyles??!1,t=i.source?.texture??null,s=this.compositeTarget;this.compositeTarget=o;let n=0;for(const m of l){const h=t!=null;if(!h&&!this.hasLayerTexture(m))continue;let p=null,g=null,b=null;h&&(m.source?(p=m.source.texture,m.source.texture=t):m.source={texture:t,type:"shader",src:"",id:"group-inject",name:"group"},g=m.contentFit,b=m.cropRegion,a?(m.contentFit="stretch",m._unifiedCrop=!0):e&&i.contentFit&&(m.contentFit=i.contentFit));const y=m.effects,T=(i.effects?.length??0)>0;T&&(e?m.effects=i.effects:m.effects=[...m.effects??[],...i.effects??[]]);const C=m.edgeEffects,w=i.edgeEffects?.enabled&&(i.edgeEffects.effects?.length??0)>0;w&&(m.edgeEffects=i.edgeEffects);const x=this.getOrCreateLayerObject(m),S=this.getLayerTexture(m,x);if(S){const R=this.processLayerPipeline(m,x,S),k=m._seqGate,D=m.opacity*(typeof k=="number"?k:1);this.compositeTexture(R,D,m.blendMode,n===0),n++}T&&(m.effects=y),w&&(m.edgeEffects=C),h&&(p!==null&&m.source?m.source.texture=p:m.source?.id==="group-inject"&&(m.source=null),m.contentFit=g,m.cropRegion=b,delete m._unifiedCrop)}this.compositeTarget=s;const c=i.corners,f=c.topLeft.x!==0||c.topLeft.y!==1||c.topRight.x!==1||c.topRight.y!==1||c.bottomLeft.x!==0||c.bottomLeft.y!==0||c.bottomRight.x!==1||c.bottomRight.y!==0;let v=o.texture;if(f){const m=this.getOrCreateLayerObject(i);m.material.uniforms.uTexture.value=o.texture,m.material.uniforms.uUseMeshPosition.value=!1,m.material.uniforms.uCustomShapeEnabled.value=0,m.material.uniforms.uCustomShapeInvert.value=0,m.material.uniforms.uLayerShapeType.value=0,m.material.uniforms.uCropEnabled.value=!1,m.material.uniforms.uFlipH.value=!1,m.material.uniforms.uFlipV.value=!1,m.material.uniforms.uContentFit.value=0,this.updateLayerCorners(i.id,i.corners);const h=this.renderer.getClearColor(this._tempColor),p=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0),this.scene.add(m.mesh),this.renderer.setRenderTarget(m.renderTarget),this.renderer.clear(),this.renderer.render(this.scene,this.camera),this.scene.remove(m.mesh),this.renderer.setClearColor(h,p),v=m.renderTarget.texture}const d=i._postCompositeEffects;return d&&d.length>0&&(v=this.applyEffects(v,d,i.id)),v}getLayerTexture(i,l){return i.type==="lines"?i._linesTexture:i.type==="svg"?i._svgTexture:i.type==="lightpainting"?i._lightPaintingTexture:i.type==="text"?i._textTexture:i.type==="splat"?i._splatTexture:i.type==="model3d"?i._model3dTexture:i.type==="gpu"?i._gpuLayerTexture:i.type==="color"&&i.colorContent?this.getOrCreateColorTexture(i.id,i.colorContent):i.source?.texture||l.material.uniforms.uTexture.value}processLayerPipeline(i,l,o){l.material.uniforms.uTexture.value=o,l.material.uniforms.uBgOpacity.value=i.type==="gpu"?i.gpuLayerContent?.bgOpacity??1:1;const r=i.layerShape?.enabled?i.layerShape.type:"rectangle",e={rectangle:0,circle:1,triangle:2}[r]??0;if(i.cropRegion&&e===0?(l.material.uniforms.uCropEnabled.value=!0,l.material.uniforms.uCropRegion.value.set(i.cropRegion.x,i.cropRegion.y,i.cropRegion.width,i.cropRegion.height)):(l.material.uniforms.uCropEnabled.value=!1,l.material.uniforms.uCropRegion.value.set(0,0,1,1)),l.material.uniforms.uLayerShapeType.value=e,l.material.uniforms.uLayerShapeFeather.value=i.layerShape?.params.feather??0,l.material.uniforms.uLayerShapeRotation.value=(i.layerShape?.params.rotation??0)*Math.PI/180,l.material.uniforms.uLayerShapeScale.value=i.layerShape?.params.scale??1,l.material.uniforms.uLayerShapeHasControlPoints.value=0,l.material.uniforms.uLayerShapeControlPointCount.value=0,r==="custom"&&i.layerShape?.params.customPoints&&i.layerShape.params.customClosed){const x=i.layerShape.params.customPoints;if(x.length>=3){const S=[];for(let F=0;F<x.length;F++){const he=x[F],Co=(F+1)%x.length,De=x[Co],To=he.cpOut||De.cpIn;if(S.push({x:he.x,y:he.y}),To){const Dt=he.cpOut??he,At=De.cpIn??De;for(let tt=1;tt<24;tt++){const X=tt/24,j=1-X;S.push({x:j*j*j*he.x+3*j*j*X*Dt.x+3*j*X*X*At.x+X*X*X*De.x,y:j*j*j*he.y+3*j*j*X*Dt.y+3*j*X*X*At.y+X*X*X*De.y})}}}const k=Math.min(S.length,256);let D=0,A=1,M=0,z=1;for(let F=0;F<k;F++)D=Math.min(D,S[F].x),A=Math.max(A,S[F].x),M=Math.min(M,S[F].y),z=Math.max(z,S[F].y);const V=D<0||A>1||M<0||z>1,U=A-D,W=z-M;l.material.uniforms.uCustomShapeEnabled.value=1,l.material.uniforms.uCustomShapePointCount.value=k;const _=l.material.uniforms.uCustomShapePoints.value;for(let F=0;F<k;F++)V?_[F].set((S[F].x-D)/U,(S[F].y-M)/W):_[F].set(S[F].x,S[F].y);let N=1,Q=1,ee=0,et=0;for(let F=0;F<k;F++)N=Math.min(N,_[F].x),Q=Math.min(Q,_[F].y),ee=Math.max(ee,_[F].x),et=Math.max(et,_[F].y);l.material.uniforms.uCustomShapeBBox.value.set(N,Q,ee,et);const yo=i.layerShape?.params.customShapeFit??"warp",So={mask:0,warp:1,fill:2};l.material.uniforms.uCustomShapeFit.value=So[yo]??1,l.material.uniforms.uCustomShapeInvert.value=i.layerShape?.params.invert?1:0}else l.material.uniforms.uCustomShapeEnabled.value=0,l.material.uniforms.uCustomShapeInvert.value=0}else l.material.uniforms.uCustomShapeEnabled.value=0,l.material.uniforms.uCustomShapeInvert.value=0;l.material.uniforms.uFlipH.value=i.flipH||!1,l.material.uniforms.uFlipV.value=i.flipV||!1;const t={stretch:0,fill:1,crop:2};l.material.uniforms.uContentFit.value=t[i.contentFit||"stretch"]??0;let s=this.width/this.height;if(o&&o.image){const x=o.image;x.videoWidth&&x.videoHeight?s=x.videoWidth/x.videoHeight:x.width&&x.height&&(s=x.width/x.height)}l.material.uniforms.uSourceAspect.value=s;const n=i.corners,c=Math.min(n.topLeft.x,n.bottomLeft.x,n.topRight.x,n.bottomRight.x),f=Math.max(n.topLeft.x,n.bottomLeft.x,n.topRight.x,n.bottomRight.x),v=Math.min(n.topLeft.y,n.bottomLeft.y,n.topRight.y,n.bottomRight.y),d=Math.max(n.topLeft.y,n.bottomLeft.y,n.topRight.y,n.bottomRight.y);l.material.uniforms.uLayerAspect.value=(d-v)*this.height>0?(f-c)*this.width/((d-v)*this.height):1;const m=i.layerShape?.controlPoints;if((e===1||e===2)&&m&&m.length>0){const x=l.material.uniforms.uLayerShapeControlPoints.value,S=Math.min(m.length,x.length);for(let R=0;R<S;R++)x[R].set(m[R].x,m[R].y);l.material.uniforms.uLayerShapeHasControlPoints.value=1,l.material.uniforms.uLayerShapeControlPointCount.value=S}let h=i.corners;if(r==="custom"&&i.layerShape?.params.customPoints&&i.layerShape.params.customClosed){const x=i.layerShape.params.customPoints;if(x.length>=3){let S=1/0,R=-1/0,k=1/0,D=-1/0;for(const U of x)S=Math.min(S,U.x,U.cpOut?.x??U.x,U.cpIn?.x??U.x),R=Math.max(R,U.x,U.cpOut?.x??U.x,U.cpIn?.x??U.x),k=Math.min(k,U.y,U.cpOut?.y??U.y,U.cpIn?.y??U.y),D=Math.max(D,U.y,U.cpOut?.y??U.y,U.cpIn?.y??U.y);const A=Math.min(S,0),M=Math.max(R,1),z=Math.min(k,0),V=Math.max(D,1);if(A<0||M>1||z<0||V>1){let U=function(_,N){const Q=1-_,ee=1-N;return{x:W.bottomLeft.x*Q*ee+W.bottomRight.x*_*ee+W.topLeft.x*Q*N+W.topRight.x*_*N,y:W.bottomLeft.y*Q*ee+W.bottomRight.y*_*ee+W.topLeft.y*Q*N+W.topRight.y*_*N}};const W=i.corners;h={topLeft:U(A,V),topRight:U(M,V),bottomLeft:U(A,z),bottomRight:U(M,z)}}}}i.warpMode==="mesh"&&i.meshGrid&&l.originalUVs?(this.applyMeshWarp(l.geometry,i.meshGrid,i.corners,l.originalUVs),l.material.uniforms.uUseMeshPosition.value=!0):(l.material.uniforms.uUseMeshPosition.value=!1,this.updateLayerCorners(i.id,h));let p,g;if(i._unifiedCrop){const x=i.corners,S=Math.min(x.topLeft.x,x.topRight.x,x.bottomLeft.x,x.bottomRight.x),R=Math.max(x.topLeft.x,x.topRight.x,x.bottomLeft.x,x.bottomRight.x),k=Math.min(x.topLeft.y,x.topRight.y,x.bottomLeft.y,x.bottomRight.y),D=Math.max(x.topLeft.y,x.topRight.y,x.bottomLeft.y,x.bottomRight.y);p=l.material.uniforms.uCropEnabled.value,g=l.material.uniforms.uCropRegion.value.clone(),l.material.uniforms.uCropEnabled.value=!0,l.material.uniforms.uCropRegion.value.set(S,1-D,R-S,D-k)}const b=this.renderer.getClearColor(this._tempColor),y=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0),this.scene.add(l.mesh),this.renderer.setRenderTarget(l.renderTarget),this.renderer.clear(),this.renderer.render(this.scene,this.camera),this.scene.remove(l.mesh),this.renderer.setClearColor(b,y),i._unifiedCrop&&(l.material.uniforms.uCropEnabled.value=p,l.material.uniforms.uCropRegion.value.copy(g),delete i._unifiedCrop);let T=l.renderTarget.texture;i.effects&&i.effects.length>0&&(T=this.applyEffects(T,i.effects,i.id)),i.mask&&i.mask.enabled&&i.mask.shapes&&i.mask.shapes.some(x=>x.closed&&x.points.length>=3)&&(T=this.applyMask(T,i.mask,i.id));const C=i.effects&&i.effects.length>0,w=["rectangle","circle","triangle","custom"];return i.layerShape&&i.layerShape.enabled&&i.layerShape.type!=="rectangle"&&(C||!w.includes(i.layerShape.type))&&(T=this.applyShapeMask(T,i)),i.edgeEffects?.enabled&&i.edgeEffects.effects.length>0&&(T=this.renderLayerEdgeEffects(T,i)),T}blackTexture=null;createBlackTexture(){if(!this.blackTexture){const i=new Uint8Array([0,0,0,0]);this.blackTexture=new Bt(i,1,1,xe),this.blackTexture.needsUpdate=!0}return this.blackTexture}resize(i,l,o,r){this.width=i,this.height=l,this.renderer.setPixelRatio(1),this.renderer.setSize(i,l,!1),this.compositeTarget.setSize(i,l),this.tempTarget.setSize(i,l),this.effectTargetA.setSize(i,l),this.effectTargetB.setSize(i,l),this.effectBlendTarget.setSize(i,l);for(const a of this.layerObjects.values())a.renderTarget.setSize(i,l);this.bankATarget&&this.bankATarget.setSize(i,l),this.bankBTarget&&this.bankBTarget.setSize(i,l);for(const a of this.vjCrossfadeTargets.values())a.setSize(i,l)}getRenderer(){return this.renderer}reinitAfterContextRestore(){try{try{this.compositeTarget.dispose()}catch{}try{this.tempTarget.dispose()}catch{}try{this.effectTargetA.dispose()}catch{}try{this.effectTargetB.dispose()}catch{}try{this.effectBlendTarget.dispose()}catch{}this.effectFeedbackTargets.forEach(l=>{try{l.dispose()}catch{}}),this.effectFeedbackTargets.clear(),this.effectFeedbackHasPrior.clear(),this.compositeTarget=this.createRenderTarget(),this.tempTarget=this.createRenderTarget(),this.effectTargetA=this.createRenderTarget(),this.effectTargetB=this.createRenderTarget(),this.effectBlendTarget=this.createRenderTarget();const i=this.outputQuad?.material;i&&i.uniforms?.uTexture&&(i.uniforms.uTexture.value=this.compositeTarget.texture,i.needsUpdate=!0);for(const l of this.blendMaterials.values())try{l.dispose()}catch{}this.blendMaterials.clear(),this.initBlendMaterials(),this.renderer.debug.checkShaderErrors=!0,console.log("[RenderEngine] Reinitialised after context restore.")}catch(i){console.error("[RenderEngine] reinitAfterContextRestore failed:",i)}}setDrawingRenderer(i){this.drawingRendererRef=i}setShapeRenderer(i){this.shapeRendererRef=i}renderLayerEdgeEffects(i,l){const o=this.shapeRendererRef||this.drawingRendererRef;if(!l.edgeEffects?.enabled||l.edgeEffects.effects.length===0||!o)return i;const r=l.layerShape?Ta(l.layerShape):[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];if(r.length<3)return i;const a=l.corners,e=r.map(p=>{const g=a.topLeft.x+(a.topRight.x-a.topLeft.x)*p.x,b=a.topLeft.y+(a.topRight.y-a.topLeft.y)*p.x,y=a.bottomLeft.x+(a.bottomRight.x-a.bottomLeft.x)*p.x,T=a.bottomLeft.y+(a.bottomRight.y-a.bottomLeft.y)*p.x;return{x:y+(g-y)*p.y,y:T+(b-T)*p.y}}),t=e.reduce((p,g)=>p+g.x,0)/e.length,s=e.reduce((p,g)=>p+g.y,0)/e.length,n=this.compositeTarget?.width||1920,c=this.compositeTarget?.height||1080,f=5,v=e.map(p=>{const g=t-p.x,b=s-p.y,y=g*n,T=b*c,C=Math.sqrt(y*y+T*T)||1;return{x:p.x+y/C*f/n,y:p.y+T/C*f/c}});let d;if(v.length<=64)d=v;else{d=[];const p=v.length/64;for(let g=0;g<64;g++)d.push(v[Math.floor(g*p)])}this.edgeEffectTarget||(this.edgeEffectTarget=this.createRenderTarget());let m=i;const h=!!this.shapeRendererRef;for(const p of l.edgeEffects.effects){if(!p.enabled)continue;let g;h?g={id:p.id,name:"edge-effect",shape:{id:"edge-temp",type:"pointClickLine",visible:!0,locked:!1,position:{x:0,y:0},rotation:0,scale:{x:1,y:1},zIndex:0,points:d,closed:!0,cornerStyle:"sharp"},fill:p.fill,stroke:p.stroke,animation:p.animation,warpCorners:Ht(),warpEnabled:!1,meshWarp:It(),meshWarpEnabled:!1,shadowEnabled:!1,blendMode:p.blendMode??"normal",opacity:p.opacity??1}:g={id:p.id,name:"edge-effect",visible:!0,locked:!1,zIndex:0,position:{x:0,y:0},rotation:0,scale:{x:1,y:1},shape:{type:"pointClick",points:d,closed:!0,cornerStyle:"sharp"},stroke:p.stroke,drawAnimation:{enabled:!1,drawProgress:1,drawSpeed:1,trailLength:0,loopMode:"once",reverse:!1,easing:"linear"},warpCorners:Ht(),warpEnabled:!1,meshWarp:It(),meshWarpEnabled:!1,blendMode:p.blendMode??"normal",opacity:p.opacity??1};const b=o.renderElements([g],this.edgeEffectTarget);this.swapTargets(),this.tempTarget.texture;const y=this.blendMaterials.get("normal");y.uniforms.uBase.value=this.createBlackTexture(),y.uniforms.uLayer.value=m,y.uniforms.uOpacity.value=1,this.compositeQuad.material=y,this.renderer.setRenderTarget(this.tempTarget),this.renderer.render(this.compositeScene,this.camera);const T=this.blendMaterials.get(p.blendMode)||this.blendMaterials.get("normal");T.uniforms.uBase.value=this.tempTarget.texture,T.uniforms.uLayer.value=b,T.uniforms.uOpacity.value=p.opacity,this.compositeQuad.material=T,this.renderer.setRenderTarget(this.effectTargetA),this.renderer.setClearColor(0,0),this.renderer.clear(),this.renderer.render(this.compositeScene,this.camera),m=this.effectTargetA.texture}return m}getCompositeTexture(){return this.compositeTarget.texture}readCompositePixels(){const i=this.width,l=this.height,o=new Uint8Array(i*l*4);this.renderer.readRenderTargetPixels(this.compositeTarget,0,0,i,l,o);const r=new Uint8Array(i*l*4),a=i*4;for(let e=0;e<l;e++){const t=(l-1-e)*a;r.set(o.subarray(t,t+a),e*a)}return{width:i,height:l,data:r}}dispose(){this.compositeTarget.dispose(),this.tempTarget.dispose(),this.effectTargetA.dispose(),this.effectTargetB.dispose(),this.effectBlendTarget.dispose(),this.effectFeedbackTargets.forEach(i=>{try{i.dispose()}catch{}}),this.effectFeedbackTargets.clear(),this.effectFeedbackHasPrior.clear(),this.feedbackCopyMaterial?.dispose(),this.feedbackCopyMaterial=null,this.blackTexture?.dispose(),this.maskTarget?.dispose(),this.maskUnionTarget?.dispose(),this.maskUnionAccumMaterial?.dispose(),this.maskApplyMaterial?.dispose();for(const i of this.blendMaterials.values())i.dispose();for(const i of this.effectMaterials.values())i.dispose();this.effectMaterials.clear();for(const i of this.maskMaterials.values())i.dispose();this.maskMaterials.clear();for(const i of this.layerObjects.values())i.mesh.geometry.dispose(),i.material.dispose(),i.renderTarget.dispose();for(const i of this.colorTextures.values())i.dispose();this.colorTextures.clear(),this.transitionTarget?.dispose(),this.transitionMaterial?.dispose(),this.domeMaterial?.dispose(),this.bankATarget?.dispose(),this.bankBTarget?.dispose(),this.bankATarget=null,this.bankBTarget=null;for(const i of this.crossfadeMaterials.values())try{i.dispose()}catch{}this.crossfadeMaterials.clear(),this.disposeVJCrossfadeTargets(),this._copyGeometry.dispose(),this._copyMaterial.dispose(),this.renderer.dispose()}removeEffectMaterial(i){const l=this.effectMaterials.get(i);l&&(l.dispose(),this.effectMaterials.delete(i))}startTransition(i,l="dissolve"){if(!(i<=0)){if(!this.transitionTarget){this.transitionTarget=this.createRenderTarget(),this.transitionScene=new ue,this.transitionMaterial=new q({vertexShader:Be,fragmentShader:yu,uniforms:{uSnapshot:{value:null},uLive:{value:null},uProgress:{value:0},uType:{value:0},uTime:{value:0}},depthTest:!1,depthWrite:!1});const o=new oe(2,2);this.transitionQuad=new ne(o,this.transitionMaterial),this.transitionScene.add(this.transitionQuad)}this.transitionTarget.setSize(this.width,this.height),this._copyMaterial.map=this.compositeTarget.texture,this.renderer.setRenderTarget(this.transitionTarget),this.renderer.render(this._copyScene,this.camera),this.renderer.setRenderTarget(null),this.transitionMaterial.uniforms.uSnapshot.value=this.transitionTarget.texture,this.transitionMaterial.uniforms.uType.value=xu[l]??0,this.transitionProgress=0,this.transitionStartTime=performance.now()/1e3,this.transitionDuration=i}}isTransitioning(){return this.transitionProgress<1}setCrossfade(i,l,o,r="constant-power",a="normal"){this.crossfadeActive=i,this.crossfadeValue=pu(l,r),this.crossfadeTransitionName=o,this.crossfadeBlendModeIndex=bu[a]??0}isCrossfadeActive(){return this.crossfadeActive}ensureBankTargets(){this.bankATarget||(this.bankATarget=this.createRenderTarget()),this.bankBTarget||(this.bankBTarget=this.createRenderTarget())}getCrossfadeMaterial(i){let l=this.crossfadeMaterials.get(i);if(l)return l;const o=mu(i);return l=new q({vertexShader:Be,fragmentShader:o.fragment,uniforms:{tBankA:{value:null},tBankB:{value:null},uMix:{value:0},uTime:{value:0},uRes:{value:new P(this.width,this.height)},uBlendMode:{value:0}},depthTest:!1,depthWrite:!1}),this.crossfadeMaterials.set(i,l),l}unitBank(i){return i.kind==="group"?i.group.bank:i.layer.bank}renderUnitsToCurrentTarget(i,l=0){let o=l;for(const r of i){if(r.kind==="group"){const v=this.renderGroupToTexture(r.group,r.children);if(v){const d=r.group._seqGate,m=r.group.opacity*(typeof d=="number"?d:1);this.compositeTexture(v,m,r.group.blendMode,o===0),o++}continue}const a=r.layer,e=this.getOrCreateLayerObject(a),t=this.getLayerTexture(a,e);if(!t)continue;const s=this.processLayerPipeline(a,e,t),n=a._seqGate,c=a.opacity*(typeof n=="number"?n:1);this.compositeTexture(s,c,a.blendMode,o===0),o++;const f=a._lightPaintingGPUTexture;a.type==="lightpainting"&&f&&(this.compositeTexture(f,c,"add",!1),o++)}}applyBankCrossfade(){if(!this.crossfadeActive||!this.crossfadeQuad||!this.crossfadeScene||!this.bankATarget||!this.bankBTarget)return;const i=this.getCrossfadeMaterial(this.crossfadeTransitionName);i.uniforms.tBankA.value=this.bankATarget.texture,i.uniforms.tBankB.value=this.bankBTarget.texture,i.uniforms.uMix.value=this.crossfadeValue,i.uniforms.uTime.value=performance.now()/1e3-this.crossfadeStartTime,i.uniforms.uBlendMode.value=this.crossfadeBlendModeIndex,(i.uniforms.uRes.value.x!==this.width||i.uniforms.uRes.value.y!==this.height)&&i.uniforms.uRes.value.set(this.width,this.height),this.crossfadeQuad.material=i,this.renderer.setRenderTarget(this.compositeTarget),this.renderer.clear(),this.renderer.render(this.crossfadeScene,this.camera)}getOrCreateVJCrossfadeTarget(i){let l=this.vjCrossfadeTargets.get(i);return l||(l=this.createRenderTarget(),this.vjCrossfadeTargets.set(i,l)),l}renderVJCrossfadeToTarget(i,l,o){if(!this.crossfadeQuad||!this.crossfadeScene||!l&&!o)return i;const r=this.getCrossfadeMaterial(this.crossfadeTransitionName);r.uniforms.tBankA.value=l??o,r.uniforms.tBankB.value=o??l;let a=this.crossfadeValue;return!l&&o&&(a=1),l&&!o&&(a=0),r.uniforms.uMix.value=a,r.uniforms.uTime.value=performance.now()/1e3-this.crossfadeStartTime,(r.uniforms.uRes.value.x!==this.width||r.uniforms.uRes.value.y!==this.height)&&r.uniforms.uRes.value.set(this.width,this.height),this.crossfadeQuad.material=r,this.renderer.setRenderTarget(i),this.renderer.clear(),this.renderer.render(this.crossfadeScene,this.camera),i}disposeVJCrossfadeTargets(){for(const i of this.vjCrossfadeTargets.values())try{i.dispose()}catch{}this.vjCrossfadeTargets.clear()}applyTransition(){if(!this.transitionMaterial||!this.transitionScene||this.transitionProgress>=1)return;const l=performance.now()/1e3-this.transitionStartTime;this.transitionProgress=Math.min(1,l/this.transitionDuration);const o=this.transitionProgress,r=this.transitionMaterial.uniforms.uType.value,e=new Set([1,2,3,4,5,6]).has(r)?o:o*o*(3-2*o);this.transitionMaterial.uniforms.uLive.value=this.compositeTarget.texture,this.transitionMaterial.uniforms.uProgress.value=e,this.transitionMaterial.uniforms.uTime.value=l,this.renderer.setRenderTarget(this.tempTarget),this.renderer.render(this.transitionScene,this.camera),this.renderer.setRenderTarget(null),this.outputQuad.material.uniforms.uTexture.value=this.tempTarget.texture,this.renderer.render(this.outputScene,this.camera)}}const xu={dissolve:0,wipeUp:1,wipeDown:2,wipeLeft:3,wipeRight:4,wave:5,iris:6,voxelize:7,warp:8,explode:9,pixelMelt:10},bu={normal:0,multiply:1,screen:2,add:3,difference:4,darken:5,lighten:6,overlay:7,exclusion:8},yu=`
  uniform sampler2D uSnapshot;
  uniform sampler2D uLive;
  uniform float uProgress;
  uniform int uType;
  uniform float uTime;
  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 snap = texture2D(uSnapshot, uv);
    vec4 live = texture2D(uLive, uv);
    vec4 col = snap;

    if (uType == 0) {
      // Dissolve with a gentle radial drift on the snapshot — fights the
      // "freeze" feel without showing layer geometry of the old preset.
      vec2 c = vec2(0.5);
      vec2 drift = (uv - c) * uProgress * 0.06;
      vec4 driftSnap = texture2D(uSnapshot, uv - drift);
      col = mix(driftSnap, live, uProgress);
    }
    else if (uType == 1) {
      // wipeUp: live emerges from bottom (uv.y small in standard UV).
      // Edge moves up from y=0 to y=1 as progress goes 0→1.
      float edge = uProgress;
      float feather = 0.04;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 2) {
      // wipeDown: live emerges from top (uv.y large).
      // Edge moves down from y=1 to y=0 as progress goes 0→1.
      float edge = 1.0 - uProgress;
      float feather = 0.04;
      float reveal = smoothstep(edge, edge + feather, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 3) {
      // wipeLeft: live emerges from left (uv.x small).
      float edge = uProgress;
      float feather = 0.04;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.x);
      col = mix(snap, live, reveal);
    }
    else if (uType == 4) {
      // wipeRight: live emerges from right (uv.x large).
      float edge = 1.0 - uProgress;
      float feather = 0.04;
      float reveal = smoothstep(edge, edge + feather, uv.x);
      col = mix(snap, live, reveal);
    }
    else if (uType == 5) {
      // wave: wipeUp-style sweep with sinusoidal wobble — Disney projection style.
      float wobble = 0.06 * sin(uv.x * 14.0 + uProgress * 6.2831);
      float edge = uProgress + wobble;
      float feather = 0.05;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 6) {
      // iris: circular reveal from center. Account for aspect via y-stretch.
      vec2 c = vec2(0.5);
      float dist = distance(uv, c);
      float r = uProgress * 0.85;  // 0.85 ≈ corner distance, leaves a soft last reveal
      float feather = 0.05;
      float reveal = 1.0 - smoothstep(r - feather, r, dist);
      col = mix(snap, live, reveal);
    }
    else if (uType == 7) {
      // voxelize: block reveal — each cell flips at its own hash threshold.
      float cells = 36.0;
      vec2 cellId = floor(uv * cells);
      float h = hash21(cellId);
      float reveal = step(h, uProgress);
      // Sample snapshot at cell-center for a chunky pixelated look on remaining cells
      vec2 cellCenter = (cellId + 0.5) / cells;
      vec4 chunkSnap = texture2D(uSnapshot, cellCenter);
      col = mix(chunkSnap, live, reveal);
    }
    else if (uType == 8) {
      // warp: snapshot UVs displace outward radially as transition progresses,
      // creating a feeling of zoom/rush as it fades into the new preset.
      vec2 c = vec2(0.5);
      vec2 dir = uv - c;
      float dist = length(dir);
      vec2 warpedUv = uv + normalize(dir + vec2(0.0001)) * uProgress * dist * 0.6;
      vec4 warpedSnap = texture2D(uSnapshot, warpedUv);
      col = mix(warpedSnap, live, uProgress);
    }
    else if (uType == 9) {
      // explode: snapshot pixel-tiles fly outward from center, live revealed beneath.
      float tiles = 28.0;
      vec2 tileId = floor(uv * tiles) / tiles + 0.5 / tiles;
      vec2 dir = normalize(tileId - vec2(0.5) + vec2(0.0001));
      float h = hash21(tileId * 7.3);
      vec2 offset = dir * uProgress * (0.4 + h * 0.5);
      vec2 sampleUv = uv - offset;
      vec4 fragSnap = texture2D(uSnapshot, sampleUv);
      // If sample wandered off-screen, contribute nothing.
      float inBounds = step(0.0, sampleUv.x) * step(sampleUv.x, 1.0)
                     * step(0.0, sampleUv.y) * step(sampleUv.y, 1.0);
      float snapAlpha = (1.0 - uProgress) * (1.0 - uProgress) * inBounds;
      col = vec4(mix(live.rgb, fragSnap.rgb, snapAlpha), 1.0);
    }
    else if (uType == 10) {
      // pixelMelt: snapshot drips/melts down in vertical columns at varied rates.
      float dripCols = 100.0;
      float colId = floor(uv.x * dripCols);
      float h = hash21(vec2(colId, 7.0));
      float meltStart = h * 0.45;
      float meltAmount = max(0.0, uProgress - meltStart) / max(0.0001, 1.0 - meltStart);
      // Each column shifts down (in UV terms, v decreases since v=0 is bottom)
      vec2 dripUv = vec2(uv.x, uv.y + meltAmount * 0.7);
      vec4 dripSnap = texture2D(uSnapshot, dripUv);
      // Hide snapshot once column has melted past the bottom
      float snapAlpha = (1.0 - smoothstep(0.7, 1.0, meltAmount));
      col = vec4(mix(live.rgb, dripSnap.rgb, snapAlpha), 1.0);
    }

    gl_FragColor = col;
  }
`;async function Un(u){return new Promise((i,l)=>{new Do().load(u,r=>{r.minFilter=O,r.magFilter=O,r.needsUpdate=!0,i(r)},void 0,l)})}function Pn(u){const i=new Ao(u);return i.minFilter=O,i.magFilter=O,i.format=xe,i}function Su(u){const i=new Ct(u);return i.minFilter=O,i.magFilter=O,i.format=xe,i}const vt=new Map;function Cu(u,i,l=1920,o=1080){const r=vt.get(u);if(r)return r;const a=document.createElement("iframe");a.src=i,a.width=String(l),a.height=String(o),a.style.position="absolute",a.style.left="-9999px",a.style.top="-9999px",a.style.border="none",a.style.pointerEvents="none",document.body.appendChild(a);const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("2d");t&&(t.fillStyle="#000",t.fillRect(0,0,1,1));const s=Su(e);let n=null;const f={iframe:a,canvas:e,texture:s,updateTexture:()=>{try{const v=a.contentDocument||a.contentWindow?.document;if(!v)return;const d=v.querySelector("canvas");if(!d||d.width<=0||d.height<=0)return;n!==d&&(s.image=d,f.canvas=d,n=d),s.needsUpdate=!0}catch{}}};return vt.set(u,f),f}function _t(u){return vt.get(u)}function Tu(u){return u*u}function wu(u){return u*(2-u)}function Ru(u){return u<.5?2*u*u:-1+(4-2*u)*u}function ku(u){return u<1?0:1}function Mu(u,i){switch(i){case"ease-in":return Tu(u);case"ease-out":return wu(u);case"ease-in-out":return Ru(u);case"step":return ku(u);default:return u}}function Du(u,i){if(u.length===0)return;if(u.length===1||i<=u[0].time)return u[0].value;if(i>=u[u.length-1].time)return u[u.length-1].value;let l=0,o=u.length-1;for(;l<o-1;){const n=l+o>>1;u[n].time<=i?l=n:o=n}const r=u[l],a=u[o],e=a.time-r.time;if(e<=0)return r.value;const t=(i-r.time)/e,s=Mu(t,r.easing);return r.value+(a.value-r.value)*s}function Au(u,i){if(u.length===0)return;let l=u[0].value;for(const o of u)if(o.time<=i)l=o.value;else break;return l}function Bu(u,i){return u.type==="boolean"?Au(u.boolKeyframes,i):Du(u.keyframes,i)}const Uu={duration:30,isPlaying:!1,isLooping:!0,currentTime:0,zoom:40,scrollLeft:0};function Vt(){return{isOpen:!1,config:{...Uu},timelines:{},selectedLayerId:null,selectedTrackKey:null,activeOverrides:{},armedTracks:{},selectedKeyframe:null}}let Y=null,qe=0,Pe=null,Pu=0;function fo(u){if(!Pe){Y=null;return}const i=H(Pe);if(!i.config.isPlaying){Y=null;return}++Pu%60===0&&console.log("[KF Tick] t=",i.config.currentTime.toFixed(2),"overrides=",JSON.stringify(i.activeOverrides));const l=qe>0?(u-qe)/1e3:0;qe=u;let o=i.config.currentTime+l;if(o>=i.config.duration)if(i.config.isLooping)o=o%i.config.duration;else{o=i.config.duration,Pe.update(a=>({...a,config:{...a.config,isPlaying:!1,currentTime:o},activeOverrides:ve(a.timelines,o)})),Y=null;return}const r=ve(i.timelines,o);Pe.update(a=>({...a,config:{...a.config,currentTime:o},activeOverrides:r})),Y=requestAnimationFrame(fo)}function ve(u,i){const l={};for(const[o,r]of Object.entries(u)){const a={};let e=!1;for(const t of r.tracks){const s=Bu(t,i);s!==void 0&&(a[t.key]=s,e=!0)}e&&(l[o]=a)}return l}function Fu(){const u=Le(Vt());Pe=u;const{subscribe:i,set:l,update:o}=u;return{subscribe:i,toggleOpen(){o(r=>({...r,isOpen:!r.isOpen}))},setOpen(r){o(a=>({...a,isOpen:r}))},selectLayer(r){o(a=>({...a,selectedLayerId:r,selectedTrackKey:null}))},selectTrack(r){o(a=>({...a,selectedTrackKey:r}))},play(){o(r=>r.config.isPlaying?r:(qe=0,Y=requestAnimationFrame(fo),{...r,config:{...r.config,isPlaying:!0}}))},pause(){o(r=>(Y&&(cancelAnimationFrame(Y),Y=null),{...r,config:{...r.config,isPlaying:!1}}))},stop(){o(r=>(Y&&(cancelAnimationFrame(Y),Y=null),{...r,config:{...r.config,isPlaying:!1,currentTime:0},activeOverrides:{}}))},seek(r){o(a=>{const e=Math.max(0,Math.min(r,a.config.duration));return{...a,config:{...a.config,currentTime:e},activeOverrides:ve(a.timelines,e)}})},setDuration(r){o(a=>({...a,config:{...a.config,duration:Math.max(1,r)}}))},setLooping(r){o(a=>({...a,config:{...a.config,isLooping:r}}))},setZoom(r){o(a=>({...a,config:{...a.config,zoom:Math.max(5,Math.min(200,r))}}))},setScrollLeft(r){o(a=>({...a,config:{...a.config,scrollLeft:Math.max(0,r)}}))},ensureTrack(r,a,e,t){o(s=>{const n=s.timelines[r]||{layerId:r,tracks:[]};if(n.tracks.some(f=>f.key===a))return s;const c={key:a,label:e,type:t,keyframes:[],boolKeyframes:[]};return{...s,timelines:{...s.timelines,[r]:{...n,tracks:[...n.tracks,c]}}}})},removeTrack(r,a){o(e=>{const t=e.timelines[r];if(!t)return e;const s=t.tracks.filter(n=>n.key!==a);if(s.length===0){const{[r]:n,...c}=e.timelines;return{...e,timelines:c}}return{...e,timelines:{...e.timelines,[r]:{...t,tracks:s}}}})},addKeyframe(r,a,e,t,s="linear",n,c){console.log("[KF Store] addKeyframe:",r,a,"at",e,"=",t),o(f=>{let v=f.timelines[r];v?v={...v,tracks:[...v.tracks]}:v={layerId:r,tracks:[]};let d=v.tracks.findIndex(g=>g.key===a);if(d<0){const g=c||(typeof t=="boolean"?"boolean":"number");v.tracks.push({key:a,label:n||a.split(":").pop()||a,type:g,keyframes:[],boolKeyframes:[]}),d=v.tracks.length-1}const m={...v.tracks[d]};if(m.type==="boolean"){const g={time:e,value:t},b=m.boolKeyframes.filter(y=>Math.abs(y.time-e)>.001);b.push(g),b.sort((y,T)=>y.time-T.time),m.boolKeyframes=b}else{const g={time:e,value:t,easing:s},b=m.keyframes.filter(y=>Math.abs(y.time-e)>.001);b.push(g),b.sort((y,T)=>y.time-T.time),m.keyframes=b}v.tracks[d]=m;const h={...f.timelines,[r]:v},p=ve(h,f.config.currentTime);return{...f,timelines:h,activeOverrides:p}})},removeKeyframe(r,a,e){console.log("[KF Store] removeKeyframe:",r,a,"at time",e),o(t=>{const s=t.timelines[r];if(!s)return console.warn("[KF Store] removeKeyframe: no timeline for",r,"available timelines:",Object.keys(t.timelines)),t;const n=s.tracks.findIndex(y=>y.key===a);if(n<0)return console.warn("[KF Store] removeKeyframe: no track",a),t;const c={...s.tracks[n]};console.log("[KF Store] removeKeyframe: track has",c.keyframes.length,"numeric kfs,",c.boolKeyframes.length,"bool kfs"),console.log("[KF Store] removeKeyframe: existing times:",c.type==="boolean"?c.boolKeyframes.map(y=>y.time):c.keyframes.map(y=>y.time));const f=.05,v=c.type==="boolean"?c.boolKeyframes.length:c.keyframes.length;c.type==="boolean"?c.boolKeyframes=c.boolKeyframes.filter(y=>Math.abs(y.time-e)>f):c.keyframes=c.keyframes.filter(y=>Math.abs(y.time-e)>f);const d=c.type==="boolean"?c.boolKeyframes.length:c.keyframes.length;console.log("[KF Store] removeKeyframe: removed",v-d,"kfs, remaining:",d);const m=[...s.tracks];m[n]=c;const h={...t.timelines,[r]:{...s,tracks:m}},p=ve(h,t.config.currentTime),g=t.selectedKeyframe,b=g&&g.layerId===r&&g.trackKey===a&&Math.abs(g.time-e)<=.05?null:g;return{...t,timelines:h,activeOverrides:p,selectedKeyframe:b}})},moveKeyframe(r,a,e,t){console.log("[KF Store] moveKeyframe:",r,a,"from",e,"to",t),o(s=>{const n=s.timelines[r];if(!n)return console.warn("[KF Store] moveKeyframe: no timeline"),s;const c=n.tracks.findIndex(g=>g.key===a);if(c<0)return console.warn("[KF Store] moveKeyframe: no track"),s;const f={...n.tracks[c]};f.type==="boolean"?f.boolKeyframes=f.boolKeyframes.map(g=>Math.abs(g.time-e)<.05?{...g,time:t}:g).sort((g,b)=>g.time-b.time):f.keyframes=f.keyframes.map(g=>Math.abs(g.time-e)<.05?{...g,time:t}:g).sort((g,b)=>g.time-b.time);const v=[...n.tracks];v[c]=f;const d={...s.timelines,[r]:{...n,tracks:v}},m=ve(d,s.config.currentTime),h=s.selectedKeyframe,p=h&&h.layerId===r&&h.trackKey===a&&Math.abs(h.time-e)<.05?{...h,time:t}:h;return{...s,timelines:d,activeOverrides:m,selectedKeyframe:p}})},updateKeyframeEasing(r,a,e,t){o(s=>{const n=s.timelines[r];if(!n)return s;const c=n.tracks.findIndex(d=>d.key===a);if(c<0)return s;const f={...n.tracks[c]};f.keyframes=f.keyframes.map(d=>Math.abs(d.time-e)<.001?{...d,easing:t}:d);const v=[...n.tracks];return v[c]=f,{...s,timelines:{...s.timelines,[r]:{...n,tracks:v}}}})},updateKeyframeValue(r,a,e,t){o(s=>{const n=s.timelines[r];if(!n)return s;const c=n.tracks.findIndex(m=>m.key===a);if(c<0)return s;const f={...n.tracks[c]};if(f.type==="number"&&typeof t=="number")f.keyframes=f.keyframes.map(m=>Math.abs(m.time-e)<.001?{...m,value:t}:m);else if(f.type==="boolean"&&typeof t=="boolean")f.boolKeyframes=f.boolKeyframes.map(m=>Math.abs(m.time-e)<.001?{...m,value:t}:m);else return s;const v=[...n.tracks];v[c]=f;const d={...s.timelines,[r]:{...n,tracks:v}};return{...s,timelines:d,activeOverrides:ve(d,s.config.currentTime)}})},selectKeyframe(r,a,e){o(t=>({...t,selectedKeyframe:{layerId:r,trackKey:a,time:e}}))},clearSelection(){o(r=>r.selectedKeyframe?{...r,selectedKeyframe:null}:r)},exportAll(){const r=H({subscribe:i});return Object.values(r.timelines).map(a=>({layerId:a.layerId,tracks:a.tracks}))},importAll(r){const a={};for(const e of r)a[e.layerId]={layerId:e.layerId,tracks:e.tracks.map(t=>({...t,keyframes:t.keyframes||[],boolKeyframes:t.boolKeyframes||[]}))};o(e=>({...e,timelines:a}))},hasKeyframes(r){const e=H({subscribe:i}).timelines[r];return e?e.tracks.some(t=>t.keyframes.length>0||t.boolKeyframes.length>0):!1},getTrack(r,a){return H({subscribe:i}).timelines[r]?.tracks.find(t=>t.key===a)},hasKeyframeAt(r,a,e){const t=this.getTrack(r,a);return t?t.type==="boolean"?t.boolKeyframes.some(s=>Math.abs(s.time-e)<.001):t.keyframes.some(s=>Math.abs(s.time-e)<.001):!1},toggleArmed(r,a){o(e=>{const t=`${r}:${a}`,s={...e.armedTracks};return s[t]?delete s[t]:s[t]=!0,{...e,armedTracks:s}})},isArmed(r,a){return!!H({subscribe:i}).armedTracks[`${r}:${a}`]},autoRecord(r,a,e,t,s){const n=H({subscribe:i}),c=`${r}:${a}`,f=!!n.armedTracks[c];console.log("[KF Store] autoRecord:",r,a,"armed=",f,"armKeys=",Object.keys(n.armedTracks)),f&&(this.ensureTrack(r,a,t,s),this.addKeyframe(r,a,n.config.currentTime,e,"linear",t,s))},clearAll(){console.log("[KF Store] clearAll called"),o(r=>(console.log("[KF Store] clearAll: removing",Object.keys(r.timelines).length,"timelines"),{...r,timelines:{},armedTracks:{},activeOverrides:{}})),console.log("[KF Store] clearAll done")},clearLayer(r){o(a=>{const{[r]:e,...t}=a.timelines,s={...a.armedTracks};for(const n of Object.keys(s))n.startsWith(`${r}:`)&&delete s[n];return{...a,timelines:t,armedTracks:s,activeOverrides:ve(t,a.config.currentTime)}})},reset(){Y&&(cancelAnimationFrame(Y),Y=null),l(Vt())}}}const Te=Fu(),Wt=new Map;function Gu(u){if(!u)return;const i=Wt.get(u);if(i)return i;try{const o=Uo(u)?.metadata?.INPUTS||[];return Wt.set(u,o),o}catch{return}}const be=4,ze=8,vo=32,mo=64;function dt(){return typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,u=>{const i=Math.random()*16|0;return(u==="x"?i:i&3|8).toString(16)})}function $(u=be,i=ze){return Array(u).fill(null).map(()=>Array(i).fill(null))}function po(u="Block 1",i=be,l=ze){return{id:dt(),name:u,clipGrid:$(i,l),bankBClipGrid:$(i,l)}}function Je(){return{opacity:1,blendMode:"normal",solo:!1,mute:!1,activeColumn:null,activeClip:null,effects:[]}}function qt(){const u=po("Block 1",be,ze);return{numLayers:be,numColumns:ze,blocks:[u],activeBlockId:u.id,clipGrid:u.clipGrid,layerStates:Array(be).fill(null).map(()=>Je()),bankBClipGrid:u.bankBClipGrid,bankBLayerStates:Array(be).fill(null).map(()=>Je()),selectedDeck:"A",masterOpacity:1,isOpen:!1,isLive:!1,compositionEffects:[],stageMode:!1,mapMode:!1,stagePresetId:null,stoppedAll:!1,selectedLayerIndex:null,crossfaderEnabled:!1,crossfaderValue:0,crossfaderTransition:"dissolve",crossfaderCurve:"constant-power",crossfaderBlendMode:"normal",quantization:"off",pendingTriggers:[]}}function E(u,i){return i==="B"?u.bankBClipGrid:u.clipGrid}function G(u,i){return i==="B"?u.bankBLayerStates:u.layerStates}function I(u,i,l,o){return i==="B"?{...u,bankBLayerStates:l,...o!=null?{bankBClipGrid:o}:{}}:{...u,layerStates:l,...o!=null?{clipGrid:o}:{}}}function le(u,i,l){return u.blocks.map(o=>o.id!==u.activeBlockId?o:i==="A"?{...o,clipGrid:l.map(r=>[...r])}:{...o,bankBClipGrid:l.map(r=>[...r])})}const zu=performance.now();function Lu(u){switch(u){case"1/4":return 1;case"1/2":return 2;case"1bar":return 4;case"2bar":return 8;case"4bar":return 16;default:return 0}}function Hu(u){const i=performance.now(),l=Lu(u);if(l===0)return i;const o=H(Qe),r=o.manualBPM||o.bpm||120;if(r<=0)return i;const a=6e4/r;let e,t;o.isActive&&o.beat.beatCount>0&&o.beat.timeSinceLastBeat>=0?(e=i-o.beat.timeSinceLastBeat*1e3,t=o.beat.beatCount):(e=zu,t=0);const s=(i-e)/a,n=t+s,c=Math.ceil((n+.001)/l)*l;return e+(c-t)*a}let _e=null;function Iu(u){if(_e!==null)return;const i=()=>{_e=null;let l=!1,o=[];if(u.update(a=>{if(a.pendingTriggers.length===0)return a;const e=performance.now(),t=[],s=[];for(const n of a.pendingTriggers)n.fireAt<=e?t.push(n):s.push(n);return t.length===0?a:(l=!0,o=t,{...a,pendingTriggers:s})}),l)for(const a of o)Ye(a.layerIndex,a.columnIndex,a.bank);H(se).pendingTriggers.length>0&&(_e=requestAnimationFrame(i))};_e=requestAnimationFrame(i)}let Ye=()=>{};const ye=new Map,we=new Map;function Eu(u){return!u||/^(blob:|file:|data:)/i.test(u)}function Yt(u){return u.type==="shader"?"shader":u.type==="video"?"video":u.type==="threejs"||u.type==="synthvision"?"threejs":u.type==="spout"?"spout":u.type==="effect"?"effect":"image"}function Xe(u){if(!u||u.type!=="video"||!u.src)return u.videoElement;let i=ye.get(u.id);if(i&&i.src!==u.src){try{i.pause()}catch{}i.removeAttribute("src"),ye.delete(u.id),i=void 0}if(!i){i=document.createElement("video"),Eu(u.src)||(i.crossOrigin="anonymous"),i.loop=!0,i.muted=!0,i.playsInline=!0,i.preload="auto",i.src=u.src,u.isPlaying=u.isPlaying??!0;const l=i,o=()=>{u.isPlaying!==!1&&l.play().catch(r=>console.warn("[vjClipLauncher] video autoplay failed:",r))};l.readyState>=2?o():l.addEventListener("loadeddata",o,{once:!0}),ye.set(u.id,i)}return u.videoElement=i,i}function Ou(){const{subscribe:u,set:i,update:l}=Le(qt());return Ye=(o,r,a)=>{let e=!1,t=!1,s=null,n=null;l(v=>{const d=E(v,a),h=[...G(v,a)],p=d[o]?.[r];if(!p)return v;if(p.type==="preset")return p.presetId&&Pt(async()=>{const{project:C}=await import("./layers-BFOZSqIE.js").then(w=>w.ab);return{project:C}},__vite__mapDeps([0,1,2,3]),import.meta.url).then(({project:C})=>{C.loadComposition(p.presetId)}).catch(C=>{console.error("[VJ] preset load failed:",C)}),!v.mapMode||!!(h[o].activeClip&&h[o].activeClip.id===p.id)?(e=!1,v):(h[o]={...h[o],activeColumn:r,activeClip:p},e=!0,n=p,{...I(v,a,h),stoppedAll:!1});p.type==="video"&&Xe(p);const g=h[o].activeClip;return t=!!(g&&g.id===p.id),s=t?null:g,n=p,t?(e=!1,v):(h[o]={...h[o],activeColumn:r,activeClip:p},e=!0,{...I(v,a,h),stoppedAll:!1})});const c=n,f=s;if(c&&c.type==="video"&&c.videoElement){try{c.videoElement.currentTime=0}catch{}c.videoElement.paused&&c.videoElement.play().catch(()=>{})}if(f&&f.type==="video"&&f.videoElement&&f.videoElement!==c?.videoElement)try{f.videoElement.pause()}catch{}e&&(Te.seek(0),Te.play())},{subscribe:u,set:i,update:l,reset(){for(const o of ye.values())o.pause(),o.src="";ye.clear(),we.clear(),i(qt())},setOpen(o,r){l(a=>({...a,isOpen:o})),r?.fromWorkspace||Pt(async()=>{const{workspace:a}=await import("./workspace-B5Ik-X_L.js");return{workspace:a}},__vite__mapDeps([4,1,2]),import.meta.url).then(({workspace:a})=>{a.setActive(o?"vj":"main")})},setClip(o,r,a,e="A"){l(t=>{const n=E(t,e).map(f=>[...f]);if(a&&a.type==="video"){Xe(a);let f=ye.get(a.id);if(!f){f=document.createElement("video"),!a.src.startsWith("blob:")&&!a.src.startsWith("file:")&&(f.crossOrigin="anonymous"),f.loop=!0,f.muted=!0,f.playsInline=!0,f.preload="auto",f.src=a.src,a.isPlaying=a.isPlaying??!0;const v=f,d=()=>v.play().catch(m=>console.warn("[vjClipLauncher] video autoplay failed:",m));v.readyState>=2?d():v.addEventListener("loadeddata",d,{once:!0}),ye.set(a.id,f)}a.videoElement=f}if(a&&a.type==="threejs"){const f=Cu(a.id,a.src);a.iframeElement=f.iframe}if(a&&(a.type==="jsanimation"||a.type==="p5js")&&a.jsAnimation){const f=gu(a.id,a.jsAnimation);a.iframeElement=f.iframe}n[o][r]=a;const c=t.blocks.map(f=>{if(f.id!==t.activeBlockId)return f;if(e==="A"){const d=f.clipGrid.map(m=>[...m]);return d[o][r]=a,{...f,clipGrid:d}}const v=(f.bankBClipGrid??$(t.numLayers,t.numColumns)).map(d=>[...d]);return v[o][r]=a,{...f,bankBClipGrid:v}});return e==="A"?{...t,clipGrid:n,blocks:c}:{...t,bankBClipGrid:n,blocks:c}})},clearClip(o,r,a="A"){l(e=>{const t=E(e,a),s=G(e,a),n=t[o]?.[r];if(n){const d=a==="B"?"-B":"";we.delete(`vj-${o}${d}-${n.id}`)}const c=t.map(d=>[...d]);c[o][r]=null;const f=[...s];f[o].activeColumn===r&&(f[o]={...f[o],activeColumn:null,activeClip:null});const v=e.blocks.map(d=>{if(d.id!==e.activeBlockId)return d;if(a==="A"){const h=d.clipGrid.map(p=>[...p]);return h[o][r]=null,{...d,clipGrid:h}}const m=(d.bankBClipGrid??$(e.numLayers,e.numColumns)).map(h=>[...h]);return m[o][r]=null,{...d,bankBClipGrid:m}});return a==="A"?{...e,clipGrid:c,layerStates:f,blocks:v}:{...e,bankBClipGrid:c,bankBLayerStates:f,blocks:v}})},clearSynthVisionClips(){l(o=>{let r=!1;const a=o.clipGrid.map((n,c)=>n.map((f,v)=>f?.type==="synthvision"?(we.delete(`vj-${c}-${f.id}`),r=!0,null):f)),e=o.bankBClipGrid.map((n,c)=>n.map((f,v)=>f?.type==="synthvision"?(we.delete(`vj-${c}-B-${f.id}`),r=!0,null):f));if(!r)return o;const t=o.layerStates.map(n=>n.activeClip?.type==="synthvision"?{...n,activeColumn:null,activeClip:null}:n),s=o.bankBLayerStates.map(n=>n.activeClip?.type==="synthvision"?{...n,activeColumn:null,activeClip:null}:n);return{...o,clipGrid:a,layerStates:t,bankBClipGrid:e,bankBLayerStates:s}})},triggerClip(o,r,a="A"){const e=H({subscribe:u}),t=e.quantization;if(t==="off"){Ye(o,r,a);return}if(!E(e,a)[o]?.[r])return;const c=e.pendingTriggers.findIndex(d=>d.layerIndex===o&&d.columnIndex===r&&d.bank===a);if(c>=0){l(d=>({...d,pendingTriggers:d.pendingTriggers.filter((m,h)=>h!==c)}));return}const f=Hu(t),v=performance.now();l(d=>({...d,pendingTriggers:[...d.pendingTriggers,{id:dt(),layerIndex:o,columnIndex:r,bank:a,fireAt:f,queuedAt:v}]})),Iu({update:l})},triggerClipNow(o,r,a="A"){Ye(o,r,a)},triggerColumn(o,r="A"){let a=!1;l(e=>{const t=E(e,r),n=G(e,r).map((f,v)=>{const d=t[v]?.[o];return d?(d.type==="video"&&Xe(d),a=!0,{...f,activeColumn:o,activeClip:d}):f});return{...I(e,r,n),stoppedAll:!1}}),a&&(Te.seek(0),Te.play())},stopLayer(o,r="A"){l(a=>{const t=[...G(a,r)];return t[o]={...t[o],activeColumn:null,activeClip:null},I(a,r,t)})},stopAll(){l(o=>{const r=o.layerStates.map(e=>({...e,activeColumn:null,activeClip:null})),a=o.bankBLayerStates.map(e=>({...e,activeColumn:null,activeClip:null}));return{...o,layerStates:r,bankBLayerStates:a,stoppedAll:!0,pendingTriggers:[]}})},setQuantization(o){l(r=>({...r,quantization:o,pendingTriggers:o==="off"?[]:r.pendingTriggers}))},clearPendingTriggers(){l(o=>o.pendingTriggers.length===0?o:{...o,pendingTriggers:[]})},cancelPendingTrigger(o,r,a="A"){l(e=>({...e,pendingTriggers:e.pendingTriggers.filter(t=>!(t.layerIndex===o&&t.columnIndex===r&&t.bank===a))}))},setLayerOpacity(o,r,a="A"){l(e=>{const s=[...G(e,a)];return s[o]={...s[o],opacity:Math.max(0,Math.min(1,r))},I(e,a,s)})},setLayerBlendMode(o,r,a="A"){l(e=>{const s=[...G(e,a)];return s[o]={...s[o],blendMode:r},I(e,a,s)})},toggleLayerSolo(o,r="A"){l(a=>{const t=[...G(a,r)];return t[o]={...t[o],solo:!t[o].solo},I(a,r,t)})},toggleLayerMute(o,r="A"){l(a=>{const t=[...G(a,r)];return t[o]={...t[o],mute:!t[o].mute},I(a,r,t)})},setMasterOpacity(o){l(r=>({...r,masterOpacity:Math.max(0,Math.min(1,o))}))},toggleLive(){l(o=>({...o,isLive:!o.isLive}))},setLive(o){l(r=>({...r,isLive:o}))},addLayerEffect(o,r,a="A"){l(e=>{const s=[...G(e,a)];return s[o]={...s[o],effects:[...s[o].effects,r]},I(e,a,s)})},removeLayerEffect(o,r,a="A"){l(e=>{const s=[...G(e,a)];return s[o]={...s[o],effects:s[o].effects.filter(n=>n.id!==r)},I(e,a,s)})},toggleLayerEffect(o,r,a="A"){l(e=>{const s=[...G(e,a)];return s[o]={...s[o],effects:s[o].effects.map(n=>n.id===r?{...n,enabled:!n.enabled}:n)},I(e,a,s)})},updateActiveClipShaderValue(o,r,a,e="A"){l(c=>{const f=G(c,e),v=E(c,e),d=[...f],m=d[o]?.activeClip;if(!m)return c;const h={...m,shaderValues:{...m.shaderValues||{},[r]:a}};d[o]={...d[o],activeClip:h};const p=v.map(g=>[...g]);for(let g=0;g<c.numColumns;g++){const b=p[o]?.[g];b&&b.id===m.id&&(p[o][g]=h)}return I(c,e,d,p)});const t=H({subscribe:u}),n=(e==="B"?t.bankBLayerStates:t.layerStates)[o]?.activeClip?.id;n&&(typeof a=="number"||typeof a=="boolean")&&Te.autoRecord(`vj-${n}`,`shader:${r}`,a,r,typeof a=="boolean"?"boolean":"number")},batchUpdateShaderValues(o,r,a="A"){l(e=>{const t=G(e,a),s=E(e,a),n=[...t],c=n[o]?.activeClip;if(!c)return e;const f={...c,shaderValues:{...c.shaderValues||{},...r}};n[o]={...n[o],activeClip:f};const v=s.map(d=>[...d]);for(let d=0;d<e.numColumns;d++){const m=v[o]?.[d];m&&m.id===c.id&&(v[o][d]=f)}return I(e,a,n,v)})},updateActiveClipSplatContent(o,r,a="A"){l(e=>{const t=G(e,a),s=E(e,a),n=[...t];if(o<0||o>=n.length)return e;const c=n[o]?.activeClip;if(!c||c.type!=="splat")return e;const f={...c,splatContent:{...c.splatContent||$e(),...r}};n[o]={...n[o],activeClip:f};const v=s.map(d=>[...d]);for(let d=0;d<e.numColumns;d++){const m=v[o]?.[d];m&&m.id===c.id&&(v[o][d]=f)}return I(e,a,n,v)})},updateActiveClipModel3DContent(o,r,a="A"){l(e=>{const t=G(e,a),s=E(e,a),n=[...t];if(o<0||o>=n.length)return e;const c=n[o]?.activeClip;if(!c||c.type!=="model3d")return e;const f={...c,model3dContent:{...c.model3dContent||Ze(),...r}};n[o]={...n[o],activeClip:f};const v=s.map(d=>[...d]);for(let d=0;d<e.numColumns;d++){const m=v[o]?.[d];m&&m.id===c.id&&(v[o][d]=f)}return I(e,a,n,v)})},updateActiveClipVideoProps(o,r,a="A"){l(e=>{const t=G(e,a),s=E(e,a),n=[...t];if(o<0||o>=n.length)return e;const c=n[o]?.activeClip;if(!c||c.type!=="video")return e;const f={...c,...r};n[o]={...n[o],activeClip:f};const v=s.map(h=>[...h]);for(let h=0;h<e.numColumns;h++){const p=v[o]?.[h];p&&p.id===c.id&&(v[o][h]=f)}const d=le(e,a,v);return{...I(e,a,n,v),blocks:d}})},updateClipSplatContent(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(p=>[...p]),f=c[o]?.[r];if(!f||f.type!=="splat")return t;const v={...f,splatContent:{...f.splatContent||$e(),...a}};c[o][r]=v;const d=[...n];d[o]?.activeClip?.id===f.id&&(d[o]={...d[o],activeClip:v});const m=le(t,e,c);return{...I(t,e,d,c),blocks:m}})},updateClipModel3DContent(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(p=>[...p]),f=c[o]?.[r];if(!f||f.type!=="model3d")return t;const v={...f,model3dContent:{...f.model3dContent||Ze(),...a}};c[o][r]=v;const d=[...n];d[o]?.activeClip?.id===f.id&&(d[o]={...d[o],activeClip:v});const m=le(t,e,c);return{...I(t,e,d,c),blocks:m}})},updateClipEffectSource(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(p=>[...p]),f=c[o]?.[r];if(!f||f.type!=="effect")return t;const v={...f,effectSource:a};c[o][r]=v;const d=[...n];d[o]?.activeClip?.id===f.id&&(d[o]={...d[o],activeClip:v});const m=le(t,e,c);return{...I(t,e,d,c),blocks:m}})},updateLayerEffectParams(o,r,a,e="A"){l(c=>{const v=[...G(c,e)];return v[o]={...v[o],effects:v[o].effects.map(d=>d.id===r?{...d,params:{...d.params,...a}}:d)},I(c,e,v)});const t=H({subscribe:u}),n=(e==="B"?t.bankBLayerStates:t.layerStates)[o]?.activeClip?.id;if(n)for(const[c,f]of Object.entries(a)){if(typeof f!="number"&&typeof f!="boolean")continue;const v=`fx:${r}:${c}`;Te.autoRecord(`vj-${n}`,v,f,c,typeof f=="boolean"?"boolean":"number")}},addCompositionEffect(o){l(r=>({...r,compositionEffects:[...r.compositionEffects,o]}))},removeCompositionEffect(o){l(r=>({...r,compositionEffects:r.compositionEffects.filter(a=>a.id!==o)}))},toggleCompositionEffect(o){l(r=>({...r,compositionEffects:r.compositionEffects.map(a=>a.id===o?{...a,enabled:!a.enabled}:a)}))},updateCompositionEffectParams(o,r){l(a=>({...a,compositionEffects:a.compositionEffects.map(e=>e.id===o?{...e,params:{...e.params,...r}}:e)}))},addClipEffect(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(m=>[...m]),f=c[o]?.[r];if(!f)return t;c[o][r]={...f,effects:[...f.effects||[],a]};const v=[...n];v[o].activeClip?.id===f.id&&(v[o]={...v[o],activeClip:c[o][r]});const d=le(t,e,c);return e==="A"?{...t,clipGrid:c,layerStates:v,blocks:d}:{...t,bankBClipGrid:c,bankBLayerStates:v,blocks:d}})},removeClipEffect(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(m=>[...m]),f=c[o]?.[r];if(!f)return t;c[o][r]={...f,effects:(f.effects||[]).filter(m=>m.id!==a)};const v=[...n];v[o].activeClip?.id===f.id&&(v[o]={...v[o],activeClip:c[o][r]});const d=le(t,e,c);return e==="A"?{...t,clipGrid:c,layerStates:v,blocks:d}:{...t,bankBClipGrid:c,bankBLayerStates:v,blocks:d}})},toggleClipEffect(o,r,a,e="A"){l(t=>{const s=E(t,e),n=G(t,e),c=s.map(m=>[...m]),f=c[o]?.[r];if(!f)return t;c[o][r]={...f,effects:(f.effects||[]).map(m=>m.id===a?{...m,enabled:!m.enabled}:m)};const v=[...n];v[o].activeClip?.id===f.id&&(v[o]={...v[o],activeClip:c[o][r]});const d=le(t,e,c);return e==="A"?{...t,clipGrid:c,layerStates:v,blocks:d}:{...t,bankBClipGrid:c,bankBLayerStates:v,blocks:d}})},updateClipShaderValue(o,r,a,e,t="A"){l(s=>{const n=E(s,t),c=G(s,t),f=n.map(p=>[...p]),v=f[o]?.[r];if(!v)return s;const d={...v,shaderValues:{...v.shaderValues||{},[a]:e}};f[o][r]=d;const m=[...c];m[o].activeClip?.id===v.id&&(m[o]={...m[o],activeClip:d});const h=le(s,t,f);return t==="A"?{...s,clipGrid:f,layerStates:m,blocks:h}:{...s,bankBClipGrid:f,bankBLayerStates:m,blocks:h}})},setLayerEffectParamAuto(o,r,a,e,t="A"){l(s=>{const n=t==="B"?s.bankBLayerStates:s.layerStates;if(!n[o])return s;const c=n[o].effects.map(v=>{if(v.id!==r)return v;const d={...v.paramAuto??{}};e===null?delete d[a]:d[a]=e;const m=Object.keys(d).length>0,{paramAuto:h,...p}=v;return m?{...p,paramAuto:d}:p}),f=[...n];return f[o]={...f[o],effects:c},t==="B"?{...s,bankBLayerStates:f}:{...s,layerStates:f}})},setClipShaderValueAuto(o,r,a){l(e=>{const t=c=>{const f={...c.shaderValueAuto??{}};a===null?delete f[r]:f[r]=a;const v=Object.keys(f).length>0,{shaderValueAuto:d,...m}=c;return v?{...m,shaderValueAuto:f}:m},s=c=>c.map(f=>f.map(v=>v&&v.id===o?t(v):v)),n=c=>c.map(f=>!f?.activeClip||f.activeClip.id!==o?f:{...f,activeClip:t(f.activeClip)});return{...e,clipGrid:s(e.clipGrid),bankBClipGrid:s(e.bankBClipGrid),layerStates:n(e.layerStates),bankBLayerStates:n(e.bankBLayerStates)}})},updateClipEffectParams(o,r,a,e,t="A"){l(s=>{const n=E(s,t),c=G(s,t),f=n.map(h=>[...h]),v=f[o]?.[r];if(!v)return s;f[o][r]={...v,effects:(v.effects||[]).map(h=>h.id===a?{...h,params:{...h.params,...e}}:h)};const d=[...c];d[o].activeClip?.id===v.id&&(d[o]={...d[o],activeClip:f[o][r]});const m=le(s,t,f);return t==="A"?{...s,clipGrid:f,layerStates:d,blocks:m}:{...s,bankBClipGrid:f,bankBLayerStates:d,blocks:m}})},addBlock(o){l(r=>{const a=r.blocks.length+1,e=po(o||`Block ${a}`,r.numLayers,r.numColumns);return{...r,blocks:[...r.blocks,e]}})},setActiveBlock(o){l(r=>{const a=r.blocks.find(c=>c.id===o);if(!a)return r;const e=a.bankBClipGrid??$(r.numLayers,r.numColumns),t=(c,f)=>c.map((v,d)=>{if(!v.activeClip)return{...v,activeColumn:null};const m=f[d]||[],h=m.findIndex(p=>p&&p.id===v.activeClip.id);return h<0?{...v,activeColumn:null}:{...v,activeColumn:h,activeClip:m[h]||v.activeClip}}),s=t(r.layerStates,a.clipGrid),n=t(r.bankBLayerStates,e);return{...r,activeBlockId:o,clipGrid:a.clipGrid.map(c=>[...c]),bankBClipGrid:e.map(c=>[...c]),layerStates:s,bankBLayerStates:n}})},renameBlock(o,r){l(a=>{const e=a.blocks.map(t=>t.id===o?{...t,name:r}:t);return{...a,blocks:e}})},deleteBlock(o){l(r=>{if(r.blocks.length<=1)return r;const a=r.blocks.filter(s=>s.id!==o);let e=r.activeBlockId,t=r.clipGrid;if(r.activeBlockId===o){const s=a[0];e=s.id,t=s.clipGrid.map(n=>[...n])}return{...r,blocks:a,activeBlockId:e,clipGrid:t}})},duplicateBlock(o){l(r=>{const a=r.blocks.find(s=>s.id===o);if(!a)return r;const e=a.bankBClipGrid??$(r.numLayers,r.numColumns),t={id:dt(),name:`${a.name} (copy)`,clipGrid:a.clipGrid.map(s=>[...s]),bankBClipGrid:e.map(s=>[...s])};return{...r,blocks:[...r.blocks,t]}})},reorderLayers(o,r){l(a=>{if(o===r||o<0||o>=a.numLayers||r<0||r>=a.numLayers)return a;const e=[...a.layerStates],[t]=e.splice(o,1);e.splice(r,0,t);const s=[...a.clipGrid],[n]=s.splice(o,1);s.splice(r,0,n);const c=[...a.bankBLayerStates],[f]=c.splice(o,1);c.splice(r,0,f);const v=[...a.bankBClipGrid],[d]=v.splice(o,1);v.splice(r,0,d);const m=a.blocks.map(h=>{const p=[...h.clipGrid],[g]=p.splice(o,1);p.splice(r,0,g);const y=[...h.bankBClipGrid??$(a.numLayers,a.numColumns)],[T]=y.splice(o,1);return y.splice(r,0,T),{...h,clipGrid:p,bankBClipGrid:y}});return{...a,layerStates:e,clipGrid:s,blocks:m,bankBLayerStates:c,bankBClipGrid:v}})},addLayer(){l(o=>{if(o.numLayers>=vo)return o;const r=o.numLayers+1,a=o.numColumns,e=o.blocks.map(f=>({...f,clipGrid:[...f.clipGrid,Array(a).fill(null)],bankBClipGrid:[...f.bankBClipGrid??$(o.numLayers,a),Array(a).fill(null)]})),t=[...o.clipGrid,Array(a).fill(null)],s=[...o.bankBClipGrid,Array(a).fill(null)],n=[...o.layerStates,Je()],c=[...o.bankBLayerStates,Je()];return{...o,numLayers:r,clipGrid:t,blocks:e,layerStates:n,bankBClipGrid:s,bankBLayerStates:c}})},removeLayer(o){l(r=>{if(r.numLayers<=1)return r;const a=o!==void 0?o:r.numLayers-1;if(a<0||a>=r.numLayers)return r;const e=r.numLayers-1,t=r.blocks.map(v=>({...v,clipGrid:v.clipGrid.filter((d,m)=>m!==a),bankBClipGrid:(v.bankBClipGrid??$(r.numLayers,r.numColumns)).filter((d,m)=>m!==a)})),s=r.clipGrid.filter((v,d)=>d!==a),n=r.bankBClipGrid.filter((v,d)=>d!==a),c=r.layerStates.filter((v,d)=>d!==a),f=r.bankBLayerStates.filter((v,d)=>d!==a);return{...r,numLayers:e,clipGrid:s,blocks:t,layerStates:c,bankBClipGrid:n,bankBLayerStates:f}})},addColumn(){l(o=>{if(o.numColumns>=mo)return o;const r=o.numColumns+1,a=o.blocks.map(s=>({...s,clipGrid:s.clipGrid.map(n=>[...n,null]),bankBClipGrid:(s.bankBClipGrid??$(o.numLayers,o.numColumns)).map(n=>[...n,null])})),e=o.clipGrid.map(s=>[...s,null]),t=o.bankBClipGrid.map(s=>[...s,null]);return{...o,numColumns:r,clipGrid:e,blocks:a,bankBClipGrid:t}})},removeColumn(o){l(r=>{if(r.numColumns<=1)return r;const a=o!==void 0?o:r.numColumns-1;if(a<0||a>=r.numColumns)return r;const e=r.numColumns-1,t=d=>d.activeColumn===a?{...d,activeColumn:null}:d.activeColumn!==null&&d.activeColumn>a?{...d,activeColumn:d.activeColumn-1}:d,s=r.blocks.map(d=>({...d,clipGrid:d.clipGrid.map(m=>m.filter((h,p)=>p!==a)),bankBClipGrid:(d.bankBClipGrid??$(r.numLayers,r.numColumns)).map(m=>m.filter((h,p)=>p!==a))})),n=r.clipGrid.map(d=>d.filter((m,h)=>h!==a)),c=r.bankBClipGrid.map(d=>d.filter((m,h)=>h!==a)),f=r.layerStates.map(t),v=r.bankBLayerStates.map(t);return{...r,numColumns:e,clipGrid:n,blocks:s,layerStates:f,bankBClipGrid:c,bankBLayerStates:v}})},toggleStageMode(){l(o=>({...o,stageMode:!o.stageMode,mapMode:!1}))},setStageMode(o){l(r=>({...r,stageMode:o,mapMode:o?!1:r.mapMode}))},toggleMapMode(){l(o=>({...o,mapMode:!o.mapMode,stageMode:!1}))},setMapMode(o){l(r=>({...r,mapMode:o,stageMode:o?!1:r.stageMode}))},setSubMode(o){l(r=>({...r,stageMode:o==="stage",mapMode:o==="map"}))},setStagePreset(o){l(r=>({...r,stagePresetId:o}))},setSelectedLayerIndex(o){l(r=>({...r,selectedLayerIndex:o}))},setSelectedDeck(o){l(r=>({...r,selectedDeck:o}))},setCrossfaderEnabled(o){l(r=>o?{...r,crossfaderEnabled:!0}:{...r,crossfaderEnabled:!1,crossfaderValue:0,selectedDeck:"A"})},setCrossfaderValue(o){const r=Math.max(0,Math.min(1,o));l(a=>({...a,crossfaderValue:r}))},setCrossfaderTransition(o){l(r=>({...r,crossfaderTransition:o}))},setCrossfaderCurve(o){l(r=>({...r,crossfaderCurve:o}))},setCrossfaderBlendMode(o){l(r=>({...r,crossfaderBlendMode:o}))},cutToA(){l(o=>({...o,crossfaderValue:0}))},cutToB(){l(o=>({...o,crossfaderValue:1}))}}}const se=Ou(),ho=$t(se,u=>{const i=u.crossfaderEnabled,l=u.layerStates.some(a=>a.solo),o=i&&u.bankBLayerStates.some(a=>a.solo),r=[];for(let a=0;a<u.layerStates.length;a++){const e=u.layerStates[a];if(e.mute||l&&!e.solo)continue;const t=e.activeClip;t&&t.type!=="preset"&&r.push({clip:t,opacity:e.opacity,blendMode:e.blendMode,effects:[...t.effects||[],...e.effects],layerIndex:a,bank:i?"A":null})}if(i)for(let a=0;a<u.bankBLayerStates.length;a++){const e=u.bankBLayerStates[a];if(e.mute||o&&!e.solo)continue;const t=e.activeClip;t&&t.type!=="preset"&&r.push({clip:t,opacity:e.opacity,blendMode:e.blendMode,effects:[...t.effects||[],...e.effects],layerIndex:a,bank:"B"})}return r}),_u=$t([se,ho],([u,i])=>{if(!u.isLive)return null;const l=[];for(const o of i){const r=o.layerIndex,a=o.clip,e=o.opacity*u.masterOpacity;a.type==="video"&&Xe(a);const t=o.bank?`-${o.bank}`:"",s=`vj-${r}${t}-${a.id}`;let n=we.get(s);if(n){const R=Yt(a),k=n.src!==a.src;if(n.id=a.id,n.type=R,n.name=a.name,n.src=a.src,k&&(n.texture?.dispose?.(),n.texture=void 0,n.videoElement=void 0),n.shaderValues=a.shaderValues||{},a.videoElement&&(n.videoElement=a.videoElement),n._assetRef=a._assetRef,a.iframeElement&&(n.iframeElement=a.iframeElement),a.type==="video"&&(n.playbackMode=a.playbackMode||"loop",n.playbackRate=a.playbackRate??1,n.trimStart=a.trimStart??0,n.trimEnd=a.trimEnd??1,n.isPlaying=a.isPlaying!==!1),a.type==="threejs"){const D=_t(a.id);D&&(n.threejsCanvas=D.canvas)}a.type==="synthvision"&&a.synthVisionCanvas&&(n.threejsCanvas=a.synthVisionCanvas),a.type==="effect"&&a.effectSource&&(n.effectSource=a.effectSource)}else{const R=Yt(a);if(n={id:a.id,type:R,name:a.name,src:a.src,_assetRef:a._assetRef,shaderCode:a.shaderCode,shaderInputs:Gu(a.shaderCode),shaderValues:a.shaderValues||{},videoElement:a.videoElement,iframeElement:a.iframeElement,playbackMode:a.playbackMode||"loop",playbackRate:a.playbackRate??1,trimStart:a.trimStart??0,trimEnd:a.trimEnd??1,isPlaying:a.isPlaying!==!1},a.type==="threejs"){const k=_t(a.id);k&&(n.threejsCanvas=k.canvas)}a.type==="synthvision"&&a.synthVisionCanvas&&(n.threejsCanvas=a.synthVisionCanvas),a.type==="spout"&&a.spoutSource&&(n.spoutSource={senderName:a.spoutSource,name:a.spoutSource,width:1920,height:1080}),a.type==="effect"&&a.effectSource&&(n.effectSource=a.effectSource),we.set(s,n)}let c="media";a.type==="splat"?c="splat":a.type==="model3d"&&(c="model3d");const f=o.bank?`-${o.bank}`:"",v=a.type==="video"?a.zoom??1:1,d=a.type==="video"?a.rotation??0:0,m=a.type==="video"?a.opacity??1:1,h=a.type==="video"?a.anchorX??.5:.5,p=a.type==="video"?a.anchorY??.5:.5;let g;if(a.type==="video"){const R=a.fit??"cover";g=R==="cover"?"fill":R==="contain"?"crop":"stretch"}const b=Math.cos(d*Math.PI/180),y=Math.sin(d*Math.PI/180),T=h-.5,C=p-.5,w=(R,k)=>{const D=R*v,A=k*v,M=D*b-A*y,z=D*y+A*b;return{x:M+.5+T,y:z+.5+C}},x={topLeft:w(-.5,.5),topRight:w(.5,.5),bottomLeft:w(-.5,-.5),bottomRight:w(.5,-.5)},S={id:`vj-layer-${r}${f}`,name:a.name,type:c,visible:!0,locked:!1,opacity:e*m,blendMode:o.blendMode,source:n,linesContent:null,svgContent:null,colorContent:null,lightPaintingContent:null,advLightPaintingContent:null,textContent:null,splatContent:a.type==="splat"?a.splatContent||$e():null,model3dContent:a.type==="model3d"?a.model3dContent||Ze():null,pixelFXContent:null,gpuLayerContent:null,position:{x:0,y:0},scale:{x:1,y:1},rotation:0,flipH:!1,flipV:!1,contentFit:g,warpMode:"corners",corners:x,meshGrid:null,mask:null,cropRegion:null,layerShape:null,edgeEffects:null,effects:o.effects,bank:o.bank??void 0};l.push(S)}return l.length>0?l:null}),Fn=Object.freeze(Object.defineProperty({__proto__:null,DEFAULT_VJ_COLUMNS:ze,DEFAULT_VJ_LAYERS:be,MAX_VJ_COLUMNS:mo,MAX_VJ_LAYERS:vo,activeVJLayers:ho,vjClipLauncher:se,vjOutputLayers:_u},Symbol.toStringTag,{value:"Module"}));let mt=null,pt=null,ht=null,gt=null,xt=null,bt=null,yt=null,St=null;function Gn(u,i,l,o,r,a,e,t,s){mt=u,pt=i,o&&(ht=o),r&&(gt=r),a&&(xt=a),e&&(bt=e),t&&(yt=t),s&&(St=s)}const te={amount:.5,speed:1,invert:!1,bpmSync:!1,autoPhase:0,autoMode:"loop",autoSpeedHz:.15,autoMin:0,autoMax:1,autoPlaying:!0};function Xt(u,i,l="A",o="vj",r){return o==="mapping"?`map:${u}:${i}`:r?`vjc:${r}:${i}`:l==="B"?`B:${u}:${i}`:`${u}:${i}`}function Kt(u,i,l,o="A",r="vj"){return r==="mapping"?`map:${u}:fx:${i}:${l}`:o==="B"?`B:${u}:fx:${i}:${l}`:`${u}:fx:${i}:${l}`}function Nt(u,i,l,o="A",r="vj"){return r==="mapping"?`map:${u}:edge:${i}:${l}`:o==="B"?`B:${u}:edge:${i}:${l}`:`${u}:edge:${i}:${l}`}function jt(u,i,l="mapping"){return l==="mapping"?`map:${u}:gpu:${i}`:`${u}:gpu:${i}`}const Ke="xfade:value";let K=[];const J=new Map,go=new Map;function zn(u,i,l,o,r){go.set(`${u}:fx:${i}:${l}`,{min:o,max:r})}function Ln(u,i,l,o){J.set(`map:${u}:gpu:${i}`,{min:l,max:o})}function Hn(u){const i=`map:${u}:gpu:`;for(const l of J.keys())l.startsWith(i)&&J.delete(l)}const xo=new Map;function In(u,i,l,o,r){xo.set(`${u}:edge:${i}:${l}`,{min:o,max:r})}const de=new Map,Z=new Map;function En(u,i,l="vj",o){const r=o?`vjc:${o}:`:l==="mapping"?`map:${u}:`:`vj:${u}:`;for(const a of J.keys())a.startsWith(r)&&J.delete(a);for(const a of i)(a.TYPE==="float"||a.TYPE==="long"||a.TYPE==="event")&&J.set(`${r}${a.NAME}`,{min:a.MIN??0,max:a.MAX??1})}function On(u,i){return de.get(`${u}:${i}`)??null}function Vu(u){const i=`A:${u}:`,l=`B:${u}:`,o=`${u}:`;for(const r of de.keys())(r.startsWith(i)||r.startsWith(l)||r.startsWith(o))&&de.delete(r)}function _n(u,i,l,o="A"){Z.set(`${o}:${u}:${i}`,l)}function Wu(u){const i=`A:${u}:`,l=`B:${u}:`,o=`${u}:`;for(const r of Z.keys())(r.startsWith(i)||r.startsWith(l)||r.startsWith(o))&&Z.delete(r)}function qu(u){K=[];for(const[i,l]of u){const o=i.split(":");if(o[0]==="xfade"&&o[1]==="value"){K.push({mod:l,special:"xfade-value",bank:"A",target:"vj",layerIndex:-1,isEffect:!1,isEdgeEffect:!1,isGPU:!1,effectId:"",paramName:""});continue}let r="vj",a="A",e=0;if(o[0]==="vjc"){K.push({mod:l,bank:"A",target:"vj",clipId:o[1],layerIndex:-1,isEffect:!1,isEdgeEffect:!1,isGPU:!1,effectId:"",paramName:o.slice(2).join(":")});continue}o[0]==="map"?(r="mapping",e=1):o[0]==="B"&&(a="B",e=1);const t=parseInt(o[e],10);isNaN(t)||(o[e+1]==="fx"?K.push({mod:l,bank:a,target:r,layerIndex:t,isEffect:!0,isEdgeEffect:!1,isGPU:!1,effectId:o[e+2],paramName:o[e+3]}):o[e+1]==="edge"?K.push({mod:l,bank:a,target:r,layerIndex:t,isEffect:!1,isEdgeEffect:!0,isGPU:!1,effectId:o[e+2],paramName:o.slice(e+3).join(":")}):o[e+1]==="gpu"?K.push({mod:l,bank:a,target:r,layerIndex:t,isEffect:!1,isEdgeEffect:!1,isGPU:!0,effectId:"",paramName:o.slice(e+2).join(":")}):K.push({mod:l,bank:a,target:r,layerIndex:t,isEffect:!1,isEdgeEffect:!1,isGPU:!1,effectId:"",paramName:o[e+1]}))}}function Yu(){const{subscribe:u,update:i,set:l}=Le(new Map);return u(o=>{qu(o),K.length>0&&(ce.resetDtBaseline(),ce.running||ce.start())}),{subscribe:u,setModulation(o,r,a,e="A",t,s){const n=t??a.target??"vj",c={...a,target:n};i(f=>{const v=new Map(f),d=Xt(o,r,e,n,s);return c.source==="manual"?v.delete(d):v.set(d,c),v})},getModulation(o,r,a="A",e="vj",t){return H({subscribe:u}).get(Xt(o,r,a,e,t))},setEffectModulation(o,r,a,e,t="A",s){const n=s??e.target??"vj",c={...e,target:n};i(f=>{const v=new Map(f),d=Kt(o,r,a,t,n);return c.source==="manual"?v.delete(d):v.set(d,c),v})},getEffectModulation(o,r,a,e="A",t="vj"){return H({subscribe:u}).get(Kt(o,r,a,e,t))},setEdgeEffectModulation(o,r,a,e,t="mapping"){const s={...e,target:t};i(n=>{const c=new Map(n),f=Nt(o,r,a,"A",t);return s.source==="manual"?c.delete(f):c.set(f,s),c})},getEdgeEffectModulation(o,r,a,e="mapping"){return H({subscribe:u}).get(Nt(o,r,a,"A",e))},setGPUParamModulation(o,r,a){const e={...a,target:"mapping"};i(t=>{const s=new Map(t),n=jt(o,r,"mapping");return e.source==="manual"?s.delete(n):s.set(n,e),s})},getGPUParamModulation(o,r){return H({subscribe:u}).get(jt(o,r,"mapping"))},setCrossfaderModulation(o){i(r=>{const a=new Map(r);return o.source==="manual"?a.delete(Ke):a.set(Ke,o),a})},getCrossfaderModulation(){return H({subscribe:u}).get(Ke)},clearLayer(o){i(r=>{const a=new Map(r),e=`${o}:`,t=`B:${o}:`;for(const s of r.keys())(s.startsWith(t)||s.startsWith(e)&&!s.startsWith("B:")&&s[e.length]!==void 0)&&a.delete(s);return a}),Wu(o),Vu(o)},clearAll(){l(new Map)},bulkLoad(o){const r=new Map;for(const{key:a,mod:e}of o)typeof a=="string"&&a.length>0&&e&&r.set(a,e);l(r)}}}const ae=Yu();function Vn(u,i,l,o="A",r="vj",a){if(l==="manual")ae.setModulation(u,i,{source:"manual",target:r,...te},o,r,a);else{const e=ae.getModulation(u,i,o,r,a),t=l==="auto";ae.setModulation(u,i,{source:l,target:r,amount:e?.amount??te.amount,speed:e?.speed??te.speed,invert:e?.invert??te.invert,autoPhase:e?.autoPhase??te.autoPhase,autoMode:e?.autoMode??te.autoMode,autoSpeedHz:e?.autoSpeedHz??te.autoSpeedHz,autoMin:e?.autoMin??te.autoMin,autoMax:e?.autoMax??te.autoMax,autoPlaying:t?!0:te.autoPlaying},o,r,a)}l!=="manual"&&!ce.running&&ce.start()}function Wn(u,i,l,o="A"){const r=ae.getModulation(u,i,o);r&&ae.setModulation(u,i,{...r,amount:l},o)}function qn(u,i,l,o="A"){const r=ae.getModulation(u,i,o);r&&ae.setModulation(u,i,{...r,speed:l},o)}class Xu{animFrameId=null;isRunning=!1;startTime=0;start(){this.isRunning||(this.isRunning=!0,this.startTime=performance.now(),this.lastApplyTimeSec=0,this.tick())}stop(){this.isRunning=!1,this.lastApplyTimeSec=0,this.animFrameId!==null&&(cancelAnimationFrame(this.animFrameId),this.animFrameId=null)}resetDtBaseline(){this.lastApplyTimeSec=0}get running(){return this.isRunning}tick=()=>{if(this.isRunning){if(K.length===0){this.stop();return}this.applyModulations(),this.animFrameId=requestAnimationFrame(this.tick)}};lastApplyTimeSec=0;applyModulations(){const i=H(Qe),l=(performance.now()-this.startTime)/1e3;if(globalThis.__modCacheDebug){globalThis.__modCacheDumpAt||(globalThis.__modCacheDumpAt=0);const s=performance.now();if(s-globalThis.__modCacheDumpAt>1e3){globalThis.__modCacheDumpAt=s,console.log("[modEngine] parsedCache contents:",K.length,"entries");for(const n of K)console.log("  →",{target:n.target,layer:n.layerIndex,isEffect:n.isEffect,isEdge:n.isEdgeEffect,fx:n.effectId.slice(0,8),param:n.paramName,src:n.mod.source,phase:typeof n.mod.autoPhase=="number"?n.mod.autoPhase.toFixed(3):"-",playing:n.mod.autoPlaying})}}this.lastApplyTimeSec>0&&Math.min(.1,Math.max(0,l-this.lastApplyTimeSec)),this.lastApplyTimeSec=l;const o=H(se),r=new Map,a=new Map,e=new Map,t=new Map;for(const s of K){let{bank:n,layerIndex:c}=s;const{mod:f,isEffect:v,isEdgeEffect:d,isGPU:m,effectId:h,paramName:p,special:g}=s;if(f.source==="auto")continue;if(s.clipId){let C=-1,w="A";for(let x=0;x<o.layerStates.length;x++)if(o.layerStates[x]?.activeClip?.id===s.clipId){C=x,w="A";break}if(C<0){for(let x=0;x<o.bankBLayerStates.length;x++)if(o.bankBLayerStates[x]?.activeClip?.id===s.clipId){C=x,w="B";break}}if(C<0){globalThis.__loggedDormantClips||(globalThis.__loggedDormantClips=new Set);const x=s.clipId+":"+s.paramName;if(!globalThis.__loggedDormantClips.has(x)){globalThis.__loggedDormantClips.add(x);const S=o.layerStates.map(k=>k?.activeClip?.id??"·").join("|"),R=o.bankBLayerStates.map(k=>k?.activeClip?.id??"·").join("|");console.log("[modEngine] vjc dormant — clipId not active on any deck. clipId=",s.clipId," param=",s.paramName," deckA=",S," deckB=",R)}continue}c=C,n=w}let b=this.getSignal(f.source,i,l,f.speed,f.bpmSync===!0,f);if(f.invert&&(b=1-b),g==="xfade-value"){const C=Math.max(0,Math.min(1,.5+(b-.5)*f.amount*2));de.set(Ke,C),se.setCrossfaderValue(C);continue}const y=s.target==="mapping";if(!y&&(c<0||c>=o.numLayers))continue;const T=!y&&n==="B"?o.bankBLayerStates:o.layerStates;if(d){if(!y||!xt||!bt)continue;const C=`${n}:${c}:edge:${h}:${p}`;let w=Z.get(C);if(w===void 0){const M=bt(c,h,p);if(typeof M!="number")continue;w=M,Z.set(C,w)}const x=xo.get(`${c}:edge:${h}:${p}`),S=x?.min??0,R=x?.max??1,k=R-S,D=w+(b-.5)*f.amount*k,A=Math.max(S,Math.min(R,D));xt(c,h,p,A),de.set(C,A)}else if(m){const C=`M:${c}:gpu:${p}`,w=J.get(`map:${c}:gpu:${p}`),x=w?.min??0,S=w?.max??1,R=S-x;let k=Z.get(C);if(k===void 0){const z=St?St(c,p):void 0;if(typeof z!="number")continue;k=z,Z.set(C,k)}const D=k+(b-.5)*f.amount*R,A=Math.max(x,Math.min(S,D));let M=t.get(c);M||(M={},t.set(c,M)),M[p]=A,de.set(C,A)}else if(v){const C=`${n}:${c}:fx:${h}:${p}`;let w=Z.get(C);if(w===void 0){let M;if(y&&gt)M=gt(c,h,p);else if(!y){const V=T[c]?.effects.find(W=>W.id===h);if(!V)continue;const U=V.params[p];M=typeof U=="number"?U:void 0}if(typeof M!="number")continue;w=M,Z.set(C,w)}const x=go.get(`${c}:fx:${h}:${p}`),S=x?.min??0,R=x?.max??1,k=R-S,D=w+(b-.5)*f.amount*k,A=Math.max(S,Math.min(R,D));if(y){if(ht){ht(c,h,{[p]:A}),globalThis.__modFxCounters||(globalThis.__modFxCounters=new Map);const M=`${c}:${h.slice(0,8)}:${p}`,z=globalThis.__modFxCounters,V=(z.get(M)??0)+1;z.set(M,V),V%120===1&&console.log("[modEngine] fx-tick #"+V,M," val=",A.toFixed(3))}}else se.updateLayerEffectParams(c,h,{[p]:A},n);de.set(C,A)}else if(!v){const C=`${n}:${c}:${p}`;let w=s.clipId?J.get(`vjc:${s.clipId}:${p}`):y?J.get(`map:${c}:${p}`):J.get(`vj:${c}:${p}`);w||(w=J.get(`${c}:${p}`));let x=Z.get(C);if(x===void 0){let M;if(y&&pt)M=pt(c,p);else{const z=T[c];if(!z?.activeClip)continue;M=z.activeClip.shaderValues?.[p]}typeof M=="number"?x=M:x=w?(w.min+w.max)/2:.5,Z.set(C,x)}const S=w?w.max-w.min:2,R=x+(b-.5)*f.amount*S,k=w?Math.max(w.min,Math.min(w.max,R)):R;de.set(C,k);const D=y?e:n==="B"?a:r;let A=D.get(c);A||(A={},D.set(c,A)),A[p]=k}}for(const[s,n]of r)se.batchUpdateShaderValues(s,n,"A");for(const[s,n]of a)se.batchUpdateShaderValues(s,n,"B");if(mt)for(const[s,n]of e)mt(s,n);if(yt)for(const[s,n]of t)yt(s,n)}getSignal(i,l,o,r,a,e){switch(i){case"sub":return l.bands.sub;case"bass":return l.bands.bass;case"lowMid":return l.bands.lowMid;case"mid":return l.bands.mid;case"highMid":return l.bands.highMid;case"treble":return l.bands.treble;case"air":return l.bands.air;case"presence":return l.bands.presence;case"high":return l.bands.high;case"amplitude":return l.amplitude;case"beatPhase":return l.beatPhase;case"kick":{const t=l.kickSnare;if(!t)return 0;const s=t.timeSinceLastKick/1e3;return Math.max(0,t.kickIntensity*Math.exp(-s/.15))}case"snare":{const t=l.kickSnare;if(!t)return 0;const s=t.timeSinceLastSnare/1e3;return Math.max(0,t.snareIntensity*Math.exp(-s/.15))}case"lfo-sine":{const t=a&&l.bpm>0?r*(l.bpm/60):r;return(Math.sin(o*t*Math.PI*2)+1)/2}case"lfo-saw":{const t=a&&l.bpm>0?r*(l.bpm/60):r;return o*t%1}case"lfo-square":{const t=a&&l.bpm>0?r*(l.bpm/60):r;return Math.sin(o*t*Math.PI*2)>0?1:0}case"lfo-tri":{const t=a&&l.bpm>0?r*(l.bpm/60):r,s=o*t%1;return s<.5?s*2:2-s*2}case"auto":{if(!e)return 0;const t=e.autoPhase??0,s=e.autoMode==="pingpong"?t<.5?t*2:2-t*2:t,n=e.autoMin??0,c=e.autoMax??1;return n+s*(c-n)}default:return 0}}}const ce=new Xu;Qe.subscribe(u=>{u.isActive&&!ce.running&&K.length>0&&ce.start()});const bo="ghostarcade-modulation-sync";let Se=null,Ne=null,Me=null;const Ku=33;function Nu(){if(!Se){try{Se=new BroadcastChannel(bo)}catch(u){console.warn("[ModSync] BroadcastChannel unavailable:",u);return}Ne=ae.subscribe(()=>{Me||(Me=setTimeout(()=>{Me=null,$u()},Ku))}),console.log("[ModSync] Editor: broadcasting modulation map")}}function ju(){if(Ne&&(Ne(),Ne=null),Me&&(clearTimeout(Me),Me=null),Se){try{Se.close()}catch{}Se=null}}function $u(){if(!Se)return;const u=H(ae),i=[];for(const[l,o]of u.entries())i.push({key:l,mod:o});try{Se.postMessage({type:"mod-state",entries:i})}catch(l){console.warn("[ModSync] broadcast failed:",l)}}let Ue=null;function Zu(){if(Ue)return()=>{};try{Ue=new BroadcastChannel(bo)}catch(i){return console.warn("[ModSync] BroadcastChannel unavailable on receiver:",i),()=>{}}const u=Ue;return u.onmessage=i=>{const l=i.data;if(!(!l||l.type!=="mod-state"))try{const o=Array.isArray(l.entries)?l.entries:[];ae.bulkLoad(o),o.length>0&&!ce.running&&ce.start()}catch(o){console.error("[ModSync] receiver apply failed:",o)}},console.log("[ModSync] Receiver started"),()=>{try{u.close()}catch{}Ue===u&&(Ue=null)}}const Yn=Object.freeze(Object.defineProperty({__proto__:null,startModulationBroadcast:Nu,startModulationBroadcastReceiver:Zu,stopModulationBroadcast:ju},Symbol.toStringTag,{value:"Module"}));export{Un as $,mn as A,pe as B,Sn as C,be as D,yn as E,bn as F,xn as G,gn as H,hn as I,pn as J,da as K,ma as L,Ze as M,Gn as N,eo as O,Ko as P,Xo as Q,Bn as R,Eo as S,Io as T,Nu as U,ju as V,ra as W,_u as X,_t as Y,Mn as Z,Yo as _,_n as a,Pn as a0,Cu as a1,gu as a2,to as a3,ln as a4,an as a5,rn as a6,oo as a7,$o as a8,jo as a9,un as aA,nn as aB,Fn as aC,Yn as aD,In as aa,Ln as ab,zn as ac,Ho as ad,No as ae,sn as af,cn as ag,vn as ah,Hn as ai,ea as aj,qo as ak,Wo as al,En as am,Vn as an,An as ao,Xt as ap,Wn as aq,On as ar,ce as as,$e as at,qn as au,uo as av,lo as aw,Qo as ax,_o as ay,Vo as az,ae as b,Tn as c,ya as d,Po as e,ze as f,kt as g,Jo as h,ct as i,va as j,Te as k,xa as l,Zo as m,Cn as n,ba as o,It as p,fn as q,kn as r,no as s,dn as t,Dn as u,se as v,Sa as w,wn as x,Rn as y,Ca as z};
