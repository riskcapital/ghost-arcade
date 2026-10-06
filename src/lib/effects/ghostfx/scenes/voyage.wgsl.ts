/** Bounded, fragment-only native scenes. No readbacks, history textures or CPU simulation. */
export const VOYAGE_SCENES = ['hyperdrive', 'tidal', 'mandala', 'corona'] as const;
export const VOYAGE_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  bass: f32, mid: f32, treble: f32, bassFast: f32,
  midFast: f32, trebFast: f32, energy: f32, beatPhase: f32,
  beatPulse: f32, amp: f32, hue: f32, exposure: f32,
  detail: f32, motion: f32, depth: f32, palette: f32,
  light: vec4<f32>, ambient: f32, drive: f32, bgAlpha: f32, scene: f32,
};
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) i:u32)->V {
  let p=array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0));
  var o:V; o.pos=vec4(p[i],0.0,1.0); o.uv=p[i]; return o;
}
fn tint(x:f32)->vec3<f32> {
  let v=0.5+0.5*sin(x*6.2831853+u.hue*6.2831853);
  if(u.palette<0.5) { return mix(vec3(0.12,0.08,0.65),vec3(0.12,0.95,1.0),v); }
  if(u.palette<1.5) { return mix(vec3(0.8,0.08,0.025),vec3(1.0,0.82,0.25),v); }
  if(u.palette<2.5) { return mix(vec3(0.2,0.04,0.8),vec3(1.0,0.25,0.65),v); }
  if(u.palette<3.5) { return mix(vec3(0.2,0.55,0.32),vec3(0.85,1.0,0.4),v); }
  if(u.palette<4.5) { return mix(vec3(0.35,0.55,0.75),vec3(1.0),v); }
  return 0.5+0.5*cos(6.2831853*(x+u.hue+vec3(0.0,0.33,0.67)));
}
fn glow(d:f32,w:f32)->f32 {
  let width=max(w,0.65/max(u.resolution.y,1.0));
  return exp(-abs(d)/width)*0.8+exp(-abs(d)/(width*4.0))*0.12;
}
@fragment fn fsMain(in:V)->@location(0) vec4<f32> {
  let p=in.uv*vec2(u.resolution.x/max(u.resolution.y,1.0),1.0);
  let t=u.time*u.motion;
  let bass=min(u.bass,2.0); let mid=min(u.mid,2.0);
  let r=length(p); let angle=atan2(p.y,p.x);
  var col=vec3(0.0);
  if(u.scene<0.5) {
    // Concentric perspective gates: angular harmonics use integer frequencies,
    // keeping the tunnel seamless at atan2's branch cut.
    for(var i=0;i<24;i++) {
      let z=fract((f32(i)+0.5)/24.0+t*0.075);
      let radius=0.045+z*z*2.8*u.depth;
      let twist=t*0.24+z*(3.0+bass*1.2);
      let facets=radius*(1.0+(0.08+mid*0.07)*sin(angle*floor(u.detail)+twist));
      let w=0.002+z*0.012;
      col+=tint(z*0.7+t*0.025)*glow(r-facets,w)*smoothstep(0.0,0.14,z)*(1.0-z)*0.65;
    }
    col*=1.0+bass*0.28;
  } else if(u.scene<1.5) {
    // A layered luminous terrain, with bass swelling the hills instead of flashing.
    for(var i=0;i<32;i++) {
      let z=f32(i)/31.0;
      let y=-0.95+z*1.65;
      let wave=sin(p.x*(2.0+z*3.0)+t*0.55+z*8.0)*0.12;
      let fine=sin(p.x*u.detail-z*6.0-t*0.3)*0.035;
      let d=p.y-y-(wave+fine)*(0.5+u.depth+bass*0.25)*sin(z*3.14159);
      col+=tint(z*0.8)*glow(d,0.003+z*0.003)*(0.2+z*0.5);
    }
  } else if(u.scene<2.5) {
    // Interlaced petal chambers with an open center and smooth harmonic motion.
    for(var i=0;i<12;i++) {
      let n=f32(i); let phase=t*0.16+n*0.38;
      let petal=sin(angle*floor(u.detail)+phase);
      let radius=(0.13+n*0.085)*u.depth*(1.0+(0.14+bass*0.1)*petal+0.06*sin(angle*2.0-phase));
      col+=tint(n*0.085+t*0.01)*glow(r-radius,0.004+mid*0.002)*0.65;
    }
  } else {
    // Solar filaments flow around a dark core, retaining space for layering.
    for(var i=0;i<16;i++) {
      let n=f32(i); let phase=angle*floor(u.detail)+n*0.39-t*0.5;
      let radius=(0.25+n*0.021)*u.depth+sin(phase)*(0.025+mid*0.025)+sin(angle*3.0+t*0.35+n)*0.04;
      col+=tint(n*0.07)*glow(r-radius,0.004+bass*0.003)*0.5;
    }
    col+=tint(0.7)*exp(-abs(r-0.45*u.depth)*5.0)*0.1;
  }
  col*=2.6*(1.0-smoothstep(0.4,2.5,r));
  let alpha=max(u.bgAlpha,clamp(max(col.r,max(col.g,col.b)),0.0,1.0));
  return vec4(col,alpha);
}
`;
