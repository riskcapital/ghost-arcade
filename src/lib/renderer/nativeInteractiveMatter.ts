/** Interactive matter: obstacle-aware Eulerian smoke, particle liquid, finite-radius
 * rigid balls and extruded-polygon volumetric shadows. Follows the storage-buffer
 * solver used by GhostFX Liquid and the light scattering model of Volumetric Nodes.
 * Geometry is authored in screen space; depth is an explicit extrusion, not LiDAR. */
export const MATTER_W=256, MATTER_H=144;
export const MATTER_COMMON=/* wgsl */`
struct U { view:vec4<f32>, style:vec4<f32>, touch:vec4<f32>, params:vec4<f32>, flags:vec4<f32> };
struct M { light:vec4<f32>, physics:vec4<f32>, material:vec4<f32>, grid:vec4<f32>, emitter:vec4<f32>, emission:vec4<f32>, look:vec4<f32>, surface:vec4<f32>, beam:vec4<f32>, lighting:vec4<f32>, audio:vec4<f32>, clock:vec4<f32>, mods:array<vec4<f32>,80> };
struct Particle { state:vec4<f32>, life:vec4<f32> };
struct Geo { wall:vec4<f32>, source:vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> shapes:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> touches:array<vec4<f32>>;
@group(0) @binding(4) var<uniform> m:M;
@group(0) @binding(10) var<storage,read> emissionState:array<vec4<f32>>;
fn ctrl(index:u32,base:f32)->f32{
 let a=m.mods[index*2u];let b=m.mods[index*2u+1u];if(a.x<.5){return base;}var signal=0.;let source=u32(a.x);var phase=u.view.z*a.z*select(1.,max(m.clock.y,1.)/60.,b.z>.5);
 switch(source){case 1u,2u:{signal=m.audio.x;}case 3u:{signal=(m.audio.x+m.audio.y)*.5;}case 4u:{signal=m.audio.y;}case 5u:{signal=(m.audio.y+m.audio.z)*.5;}case 6u,7u,8u,9u:{signal=m.audio.z;}case 10u:{signal=m.audio.w;}case 11u:{signal=m.clock.x;}case 12u,13u:{signal=m.audio.x;}case 14u:{signal=.5+.5*sin(phase*6.2831853);}case 15u:{signal=1.-abs(fract(phase)*2.-1.);}case 16u:{signal=fract(phase);}case 17u:{signal=select(0.,1.,fract(phase)<.5);}default:{}}
 signal=clamp(signal,0.,1.);if(b.w>.5){signal=select(signal,1.-signal,a.w>.5);return mix(b.x,b.y,signal);}if(source<11u||source==12u||source==13u){signal=.5+signal*.5;}signal=select(signal,1.-signal,a.w>.5);return clamp(base+(signal-.5)*a.y*(b.y-b.x),b.x,b.y);
}
fn lightPosition()->vec3<f32>{return vec3<f32>(ctrl(0u,m.light.x),ctrl(1u,m.light.y),ctrl(2u,m.light.z));}
fn emitterPosition()->vec2<f32>{return vec2<f32>(ctrl(16u,m.emitter.x),ctrl(17u,m.emitter.y));}
fn particleCount()->u32{return select(select(select(1024u,16384u,u.style.x==9.||m.grid.z>.5),4096u,u.style.x==10.||m.material.w>.5),96u,u.style.x==7.);}
fn lifetime()->f32{return max(.05,ctrl(27u,m.look.w));}
fn particleFade(age:f32)->f32{if(age<=0.||age>=lifetime()){return 0.;}return smoothstep(0.,.04,age)*smoothstep(0.,min(.3,lifetime()*.15),lifetime()-age);}
fn emissionGate()->f32{if(m.emission.x<.5){return 1.;}if(m.emission.x<1.5){let period=max(ctrl(22u,m.emission.z),.2);return select(0.,1.,fract(emissionState[1].w/period)*period<ctrl(23u,m.emission.w));}return select(0.,1.,emissionState[0].y>0.);}
fn tintColor()->vec3<f32>{let h=ctrl(24u,m.look.x)/360.;let k=fract(vec3<f32>(h)+vec3<f32>(0.,2./3.,1./3.));return clamp(abs(k*6.-3.)-1.,vec3<f32>(0.),vec3<f32>(1.))*.85+.15;}

fn hash(v:f32)->f32{return fract(sin(v*127.1+311.7)*43758.5453);}
fn palette(t:f32)->vec3<f32>{return .52+.48*cos(6.28318*(vec3<f32>(t)+vec3<f32>(0.,.33,.67)));}
fn aspect()->vec2<f32>{return vec2<f32>(u.view.x/u.view.y,1.);}
fn ix(p:vec2<i32>)->u32{return u32(clamp(p.y,0,143)*256+clamp(p.x,0,255));}
fn cell(p:vec2<f32>)->u32{return ix(vec2<i32>(p*vec2<f32>(256.,144.)));}
fn point(s:u32,i:u32)->vec2<f32>{return shapes[s*66u+2u+i].xy;}
fn inside(s:u32,p:vec2<f32>)->bool{let n=u32(shapes[s*66u+1u].z);var hit=false;for(var j=0u;j<n;j++){let a=point(s,j);let b=point(s,(j+1u)%n);if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x){hit=!hit;}}}return hit;}
fn noise(p:vec3<f32>)->f32{let i=floor(p);let f=fract(p);let w=f*f*(3.-2.*f);let n=dot(i,vec3<f32>(1.,57.,113.));return mix(mix(mix(hash(n),hash(n+1.),w.x),mix(hash(n+57.),hash(n+58.),w.x),w.y),mix(mix(hash(n+113.),hash(n+114.),w.x),mix(hash(n+170.),hash(n+171.),w.x),w.y),w.z);}
fn fbm(p:vec3<f32>)->f32{return noise(p)*.57+noise(p*2.03+4.1)*.28+noise(p*4.13+7.2)*.15;}
`;
export const MATTER_EMISSION=MATTER_COMMON.replace('var<storage,read> emissionState','var<storage,read_write> emissionState')+/* wgsl */`
// A rate accumulator allocates new birth tickets. Particle life.x is AGE, never
// a retry timer: expired/dead slots cannot reactivate at their old positions.
@compute @workgroup_size(1) fn cs_emission(){
 if(u.params.w>.5){return;}var state=emissionState[0];var births=emissionState[1];state.w=0.;
 if(state.z!=u.flags.x){state=vec4<f32>(m.clock.z,0.,u.flags.x,1.);births=vec4<f32>(0.);}
 let dt=clamp(u.view.w,0.,.05);if(state.x!=m.clock.z){state.x=m.clock.z;state.y=ctrl(23u,m.emission.w);}else{state.y=max(0.,state.y-dt);}
 births.w+=dt;emissionState[0]=state;emissionState[1]=births;
 let count=f32(particleCount());let limit=select(select(200.,2200.,u.style.x==9.),select(1500.,12.,u.style.x==7.),u.style.x==10.||u.style.x==7.);
 // Bound occupancy so long lifetimes keep emitting instead of filling the pool.
 let rate=min(limit,count/(lifetime()+.1))*max(0.,ctrl(7u,m.physics.w));
 let amount=births.z+dt*rate*emissionGate();let born=floor(amount);
 births.x=(births.x+births.y)%count;births.y=born;births.z=fract(amount);emissionState[1]=births;
}
`;
export const MATTER_GEOMETRY=MATTER_COMMON+/* wgsl */`
@group(0) @binding(5) var<storage,read_write> geometry:array<Geo>;
@compute @workgroup_size(8,8) fn cs_geometry(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let p=(vec2<f32>(id.xy)+.5)/vec2<f32>(256.,144.);let asp=aspect();var wall=vec4<f32>(2.,0.,0.,0.);var source=vec4<f32>(0.);
 for(var s=0u;s<u32(u.style.y);s++){
  let base=s*66u;let box=shapes[base];if(any(p<box.xy-.07)||any(p>box.zw+.07)){continue;}
  let n=u32(shapes[base+1u].z);var dist=10.;var normal=vec2<f32>(0.,-1.);let within=inside(s,p);
  for(var j=0u;j<n;j++){let a=point(s,j)*asp;let b=point(s,(j+1u)%n)*asp;let e=b-a;let d=p*asp-a-e*clamp(dot(p*asp-a,e)/max(dot(e,e),.000001),0.,1.);let lengthD=length(d);if(lengthD<dist){dist=lengthD;normal=normalize(d+vec2<f32>(.000001))*select(1.,-1.,within);}}
  let sd=dist*select(1.,-1.,within);let solid=shapes[base+1u].w==0.;if(solid&&sd<wall.x){wall=vec4<f32>(sd,normal,shapes[base+2u].w);}
  let mat=shapes[base+2u].z;let edge=exp(-dist*dist/0.00015)*select(1.,0.,within&&solid);let top=clamp(-normal.y+.3,0.,1.);let bottom=clamp(normal.y+.1,0.,1.);
  if(mat==1.){source.x=max(source.x,edge*(.3+top*.7));source.y=max(source.y,edge*top*.7);}
  if(mat==2.){source.y=max(source.y,edge*(.2+top*.8));}
  if(mat==3.){source.z=max(source.z,edge*bottom);}
  if(mat==4.){source.w=max(source.w,edge);}
 }
 geometry[id.y*256u+id.x]=Geo(wall,source);
}
`;
export const MATTER_FLUID=MATTER_COMMON+/* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<Particle>;
@group(0) @binding(5) var<storage,read> geometry:array<Geo>;
@group(0) @binding(6) var<storage,read> fieldIn:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> fieldOut:array<vec4<f32>>;
@group(0) @binding(8) var<storage,read> pressureIn:array<vec2<f32>>;
@group(0) @binding(9) var<storage,read_write> pressureOut:array<vec2<f32>>;
fn fluid(p:vec2<f32>)->vec4<f32>{let q=clamp(p*vec2<f32>(256.,144.)-.5,vec2<f32>(0.),vec2<f32>(255.,143.));let i=vec2<i32>(floor(q));let f=fract(q);return mix(mix(fieldIn[ix(i)],fieldIn[ix(i+vec2<i32>(1,0))],f.x),mix(fieldIn[ix(i+vec2<i32>(0,1))],fieldIn[ix(i+vec2<i32>(1,1))],f.x),f.y);}
@compute @workgroup_size(8,8) fn cs_advect(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let i=id.y*256u+id.x;if(u.params.w>.5){fieldOut[i]=fieldIn[i];return;}if(geometry[i].wall.x<0.){fieldOut[i]=vec4<f32>(0.);return;}
 let dt=clamp(u.view.w,.001,.033);let uv=(vec2<f32>(id.xy)+.5)/vec2<f32>(256.,144.);let current=fieldIn[i];var back=uv-current.xy*dt;
 // Stop back-traces at the first wall; checking the endpoint alone leaks smoke through thin blockers.
 for(var j=1u;j<=8u;j++){let q=mix(uv,back,f32(j)/8.);if(geometry[cell(q)].wall.x<0.){back=mix(uv,back,f32(j-1u)/8.);break;}}
 var f=fluid(back);if(emissionState[0].w>.5){f=vec4<f32>(0.);}
 let src=geometry[i].source;var smoke=src.y;var heat=src.x;
 if(m.grid.w>.5){let d=(uv-emitterPosition())*aspect();let spot=exp(-dot(d,d)/max(pow(ctrl(18u,m.emitter.z),2.),.00001));smoke+=spot*select(0.,1.,u.style.x==8.);heat+=spot*select(0.,1.,u.style.x==11.);}
 if(m.grid.w<.5&&m.material.z<.5){if(u.style.x==8.){smoke+=exp(-pow((uv.x-.5)*12.,2.))*smoothstep(.96,.99,uv.y);}if(u.style.x==11.){heat+=exp(-pow((uv.x-.5)*9.,2.))*smoothstep(.96,.99,uv.y);}}
 let flow=ctrl(7u,m.physics.w)*3.*emissionGate();f.z=clamp(f.z*exp(-dt/max(ctrl(27u,m.look.w),.2))+(smoke+heat*ctrl(4u,m.physics.x))*dt*flow*3.,0.,3.);f.w=clamp(f.w*exp(-dt/max(ctrl(27u,m.look.w),.2)*1.8)+heat*dt*flow*9.*ctrl(31u,m.surface.w),0.,2.);
 let curl=vec2<f32>(cos(uv.y*32.+u.view.z*.5)+sin(uv.y*65.-u.view.z),sin(uv.x*28.-u.view.z*.4));
 f.x+=curl.x*dt*.075*(f.z+f.w)*ctrl(26u,m.look.z);f.y-=dt*(f.z*.06+f.w*.35)*ctrl(31u,m.surface.w);f=vec4<f32>(f.xy*(exp(-dt*.12)),f.zw);
 for(var t=0u;t<u32(u.flags.y);t++){let input=touches[t];let d=(input.xy-uv)*aspect();let force=dt*input.z*.035/(dot(d,d)+.009);let radial=select(select(1.,-1.,input.w==1.),.1,input.w==2.);let swirl=select(.2,1.5,input.w==2.);f=vec4<f32>(f.xy+((d*radial+vec2<f32>(-d.y,d.x)*swirl)*force/aspect()),f.zw);}
 if(m.grid.w>.5){let d=uv-emitterPosition();let nozzle=exp(-dot(d,d)/max(pow(ctrl(18u,m.emitter.z)*2.,2.),.00001));let a=ctrl(39u,m.lighting.w)*.0174533;f=vec4<f32>(f.xy+vec2<f32>(cos(a),sin(a))*ctrl(19u,m.emitter.w)*nozzle*dt*flow,f.zw);}
 f=vec4<f32>(clamp(f.xy,vec2<f32>(-.65),vec2<f32>(.65)),f.zw);fieldOut[i]=f;
}
fn velocity(p:vec2<i32>,fallback:vec2<f32>)->vec2<f32>{let i=ix(p);return select(fieldIn[i].xy,vec2<f32>(0.),geometry[i].wall.x<0.);}
@compute @workgroup_size(8,8) fn cs_divergence(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let p=vec2<i32>(id.xy);let i=ix(p);let v=fieldIn[i].xy;let div=(velocity(p+vec2<i32>(1,0),v).x-velocity(p-vec2<i32>(1,0),v).x+velocity(p+vec2<i32>(0,1),v).y-velocity(p-vec2<i32>(0,1),v).y)*.5;pressureOut[i]=vec2<f32>(0.,select(div,0.,geometry[i].wall.x<0.));
}
fn pressure(p:vec2<i32>,own:f32)->f32{let i=ix(p);return select(pressureIn[i].x,own,geometry[i].wall.x<0.);}
@compute @workgroup_size(8,8) fn cs_jacobi(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let p=vec2<i32>(id.xy);let i=ix(p);let v=pressureIn[i];let sum=pressure(p+vec2<i32>(1,0),v.x)+pressure(p-vec2<i32>(1,0),v.x)+pressure(p+vec2<i32>(0,1),v.x)+pressure(p-vec2<i32>(0,1),v.x);pressureOut[i]=vec2<f32>((sum-v.y)*.25,v.y);
}
@compute @workgroup_size(8,8) fn cs_project(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let p=vec2<i32>(id.xy);let i=ix(p);var f=fieldIn[i];if(u.params.w>.5){fieldOut[i]=f;return;}let wall=geometry[i].wall;if(wall.x<0.){fieldOut[i]=vec4<f32>(0.);return;}
 let own=pressureIn[i].x;f=vec4<f32>(f.xy-(vec2<f32>(pressure(p+vec2<i32>(1,0),own)-pressure(p-vec2<i32>(1,0),own),pressure(p+vec2<i32>(0,1),own)-pressure(p-vec2<i32>(0,1),own))*.5),f.zw);
 if(wall.x<.012){let n=wall.yz;let inward=min(dot(f.xy*aspect(),n),0.);f=vec4<f32>(f.xy-(n*inward/aspect()),f.zw);}fieldOut[i]=f;
}
`;
export const MATTER_PARTICLES=MATTER_COMMON+/* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<Particle>;
@group(0) @binding(5) var<storage,read> geometry:array<Geo>;
@group(0) @binding(6) var<storage,read_write> nextParticles:array<Particle>;
@group(0) @binding(7) var<storage,read> mass:array<u32>;
fn density(p:vec2<f32>)->f32{return f32(mass[cell(p)])/4096.;}
@compute @workgroup_size(64) fn cs_step(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=16384u){return;}var p=particles[i];if(u.params.w>.5){nextParticles[i]=p;return;}let asp=aspect();let ball=u.style.x==7.;let liquid=u.style.x==10.||m.material.w>.5;let cloud=u.style.x==9.||m.grid.z>.5;let count=particleCount();if(i>=count){p.life.x=0.;nextParticles[i]=p;return;}
 let dt=clamp(u.view.w,0.,.05);let seed=hash(f32(i)+u.flags.x*53.);
 let radius=select(select(.0018,.0035+ctrl(9u,m.material.y)*.0025,liquid),.013+seed*.009+ctrl(9u,m.material.y)*.012,ball);
 if(p.life.z!=u.flags.x||emissionState[0].w>.5){p.life=vec4<f32>(0.,seed,u.flags.x,radius);}
 if(p.life.x>=lifetime()||p.state.x<-.1||p.state.x>1.1||p.state.y<-.15||p.state.y>1.15){p.life.x=0.;}
 let ticket=emissionState[1];let offset=(i+count-u32(ticket.x))%count;
 if(offset<u32(ticket.y)){
  let birthSeed=hash(f32(i)*3.17+floor(ticket.w*11.));var origin=vec2<f32>(.06+birthSeed*.88,.01);var emitted=false;
  for(var s=0u;s<u32(u.style.y)&&m.grid.w<.5;s++){let base=s*66u;let mat=shapes[base+2u].z;if((mat==3.&&liquid)||(mat==4.&&cloud)||(mat==1.&&!ball&&!liquid&&!cloud)||shapes[base+1u].w==1.){let n=u32(shapes[base+1u].z);let j=u32(hash(f32(i)*11.7+f32(s))*f32(n));let a=point(s,j);let b=point(s,(j+1u)%n);origin=mix(a,b,birthSeed);let outward=normalize((origin-shapes[base+1u].xy)*asp+vec2<f32>(.00001));origin+=outward*(radius+.016)/asp;emitted=true;break;}}
  if(cloud&&!emitted){origin=vec2<f32>(hash(f32(i)*2.4),hash(f32(i)*3.9));}
  if(!ball&&!cloud&&!liquid&&!emitted){origin.y=.97;}
  var velocity=vec2<f32>((birthSeed-.5)*.06,select(-.08,.03,liquid||ball));
  if(m.grid.w>.5){let a=ctrl(39u,m.lighting.w)*.0174533;let direction=vec2<f32>(cos(a),sin(a));let side=vec2<f32>(-direction.y,direction.x);origin=emitterPosition()+side*(birthSeed-.5)*ctrl(18u,m.emitter.z)*2./asp;velocity=(direction*ctrl(19u,m.emitter.w)+side*(birthSeed-.5)*.015)/asp;}
  p.state=vec4<f32>(origin,velocity);p.life=vec4<f32>(.0001,birthSeed,u.flags.x,radius);
 }
 if(p.life.x<=0.){nextParticles[i]=p;return;}
 var pos=p.state.xy;var vel=p.state.zw;let start=pos;
 for(var step=0u;step<4u;step++){
  let h=dt*.25;
  if(cloud){let home=vec2<f32>(hash(f32(i)*2.4),hash(f32(i)*3.9));vel+=(home-pos)*h*.5;vel+=vec2<f32>(sin(pos.y*24.+u.view.z*.4),cos(pos.x*20.-u.view.z*.35))*h*.05*ctrl(26u,m.look.z);}
  else{vel.y+=select(-.13,(u.style.w*.65),ball||liquid)*h;}
  for(var t=0u;t<u32(u.flags.y);t++){let input=touches[t];let d=(input.xy-pos)*asp;let f=h*.10*input.z/(dot(d,d)+.006);let radial=select(select(1.,-1.,input.w==1.),.1,input.w==2.);vel+=(d*radial+vec2<f32>(-d.y,d.x)*select(.2,1.8,input.w==2.))*f/asp;}
  if(liquid){let e=vec2<f32>(1./256.,1./144.);let grad=vec2<f32>(density(pos+vec2<f32>(e.x,0.))-density(pos-vec2<f32>(e.x,0.)),density(pos+vec2<f32>(0.,e.y))-density(pos-vec2<f32>(0.,e.y)));let rho=density(pos);let pressure=max(0.,rho-(1.8+ctrl(28u,m.surface.x)*1.2))/max(rho,.5);vel-=grad*h*.18*pressure/asp;vel*=exp(-h*(.08+ctrl(8u,m.material.x)*1.8));}
  if(ball){for(var j=0u;j<96u;j++){if(j==i){continue;}let q=particles[j];if(q.life.x<=0.||q.life.x>=lifetime()){continue;}let d=(pos-q.state.xy)*asp;let len=length(d);let separation=radius+q.life.w;if(len<separation&&len>.00001){let n=d/len;pos+=n*(separation-len)*.18/asp;let approach=dot((vel-q.state.zw)*asp,n);if(approach<0.){vel-=n*approach*(1.+ctrl(5u,m.physics.y))*.5/asp;}}}}
  vel*=exp(-h*select(.08,.6,cloud));let speed=length(vel*asp);vel*=min(1.,1.2/max(speed,.00001));pos+=vel*h;
  let wall=geometry[cell(pos)].wall;
  if(wall.x<radius&&length(wall.yz)>.1){let n=wall.yz;pos+=n*(radius-wall.x+.001)/asp;let vv=vel*asp;let approach=dot(vv,n);if(approach<0.){let tangent=vv-n*approach;vel=(tangent*(1.-ctrl(6u,m.physics.z)*.3)-n*approach*select(.02,ctrl(5u,m.physics.y),ball))/asp;}}
  if(ball||liquid){let r=radius/asp;if(pos.y>1.-r.y){pos.y=1.-r.y;vel.y=-abs(vel.y)*select(.02,ctrl(5u,m.physics.y),ball);vel.x*=1.-ctrl(6u,m.physics.z)*.15;}if(pos.x<r.x){pos.x=r.x;vel.x=abs(vel.x)*ctrl(5u,m.physics.y);}if(pos.x>1.-r.x){pos.x=1.-r.x;vel.x=-abs(vel.x)*ctrl(5u,m.physics.y);}}
 }
 p.state=vec4<f32>(pos,vel);p.life.x+=dt;if(p.life.x>=lifetime()){p.life.x=0.;}p.life.w=radius;nextParticles[i]=p;
}
@compute @workgroup_size(64) fn cs_copy(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<16384u){nextParticles[id.x]=particles[id.x];}}
`;
export const MATTER_MASS=MATTER_COMMON+/* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<Particle>;
@group(0) @binding(6) var<storage,read> massIn:array<u32>;
@group(0) @binding(7) var<storage,read_write> mass:array<atomic<u32>>;
@compute @workgroup_size(64) fn cs_clear(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<36864u){atomicStore(&mass[id.x],0u);}}
@compute @workgroup_size(64) fn cs_splat(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=4096u||!(u.style.x==10.||m.material.w>.5)){return;}let p=particles[i];let fade=particleFade(p.life.x);if(fade<=0.){return;}
 let coord=p.state.xy*vec2<f32>(256.,144.);let base=vec2<i32>(floor(coord));let r=2.1+ctrl(9u,m.material.y)*1.9;
 // Stretch each density kernel along velocity so a falling jet becomes a sheet,
 // while slower particles merge into a thicker, rounded pool.
 let velocity=p.state.zw*vec2<f32>(256.,144.);let axis=normalize(velocity+vec2<f32>(.0001));let stretch=1.+min(1.5,length(velocity)*.02);
 for(var y=-7;y<=7;y++){for(var x=-7;x<=7;x++){let q=base+vec2<i32>(x,y);if(any(q<vec2<i32>(0))||q.x>=256||q.y>=144){continue;}let delta=vec2<f32>(q)+.5-coord;let along=dot(delta,axis)/stretch;let across=dot(delta,vec2<f32>(-axis.y,axis.x));let d=(along*along+across*across)/(r*r);atomicAdd(&mass[ix(q)],u32(exp(-d*1.5)*1300.*fade/stretch));}}
}
fn smoothMass(p:vec2<i32>,axis:vec2<i32>)->u32{var sum=0.;var weight=0.;let radius=1.0+ctrl(28u,m.surface.x)*1.5;for(var j=-3;j<=3;j++){let w=exp(-f32(j*j)/(radius*radius));sum+=f32(massIn[ix(p+axis*j)])*w;weight+=w;}return u32(sum/weight);}
@compute @workgroup_size(8,8) fn cs_smooth_x(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<256u&&id.y<144u){atomicStore(&mass[ix(vec2<i32>(id.xy))],smoothMass(vec2<i32>(id.xy),vec2<i32>(1,0)));}}
@compute @workgroup_size(8,8) fn cs_smooth_y(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<256u&&id.y<144u){atomicStore(&mass[ix(vec2<i32>(id.xy))],smoothMass(vec2<i32>(id.xy),vec2<i32>(0,1)));}}
`;
export const MATTER_LIGHT=MATTER_COMMON+/* wgsl */`
@group(0) @binding(5) var<storage,read> geometry:array<Geo>;
@group(0) @binding(6) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> lighting:array<vec4<f32>>;
fn visibility(p:vec3<f32>,light:vec3<f32>)->f32{let delta=light-p;var visible=1.;for(var j=1u;j<=18u;j++){let q=p+delta*(f32(j)/19.);if(any(q.xy<vec2<f32>(0.))||any(q.xy>vec2<f32>(1.))){continue;}let g=geometry[cell(q.xy)].wall;let sdf=max(g.x,q.z-g.w);visible=min(visible,mix(1.,smoothstep(-.003,.002+ctrl(35u,m.beam.w)*.07,sdf),ctrl(36u,m.lighting.x)));if(visible<.01){break;}}return visible;}
@compute @workgroup_size(8,8) fn cs_light(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=256u||id.y>=144u){return;}let i=id.y*256u+id.x;let uv=(vec2<f32>(id.xy)+.5)/vec2<f32>(256.,144.);var light=lightPosition();if(u.style.x==6.&&u.flags.y>0.){light=vec3<f32>(touches[0].xy,light.z);}
 let g=geometry[i].wall;let surfaceZ=select(0.,g.w,g.x<0.);let ground=visibility(vec3<f32>(uv,surfaceZ+.012),light);
 var col=vec3<f32>(0.);var trans=1.;let f=fluid[i];let tint=tintColor();
 for(var j=0u;j<16u;j++){let z=.95-f32(j)*.059;if(z<surfaceZ){break;}let p=vec3<f32>(uv,z);let d=(light-p)*vec3<f32>(aspect(),1.);let dist=length(d);let gHG=.35;let ct=d.z/max(dist,.001);let phase=(1.-gHG*gHG)/pow(max(1.+gHG*gHG-2.*gHG*ct,.01),1.5);
  let density=ctrl(4u,m.physics.x)*.6+f.z*exp(-pow((z-.17)*4.,2.))*2.;let grain=1.-ctrl(26u,m.look.z)*.25+ctrl(26u,m.look.z)*.25*fbm(vec3<f32>(uv*12.,z*8.-u.view.z*.1));let extinction=exp(-density*grain*.059);let axis=normalize(vec3<f32>((vec2<f32>(ctrl(32u,m.beam.x),ctrl(33u,m.beam.y))-light.xy)*aspect(),-light.z));let cutoff=cos(ctrl(34u,m.beam.z)*.00872665);let cone=smoothstep(cutoff, min(.999,cutoff+.01+ctrl(35u,m.beam.w)*.25),dot(-d/max(dist,.001),axis));let scatter=tint*ctrl(3u,m.light.w)*visibility(p,light)*phase*cone/(1.+dist*dist*ctrl(37u,m.lighting.y));col+=trans*(1.-extinction)*scatter;trans*=extinction;
 }
 lighting[i]=vec4<f32>(col,ground);
}
`;
export const MATTER_RENDER=MATTER_COMMON+/* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<Particle>;
@group(0) @binding(5) var<storage,read> geometry:array<Geo>;
@group(0) @binding(6) var<storage,read> fluid:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read> mass:array<u32>;
@group(0) @binding(8) var<storage,read> lighting:array<vec4<f32>>;
struct V { @builtin(position) pos:vec4<f32>, @location(0) uv:vec2<f32>, @location(1) color:vec4<f32>, @location(2) world:vec2<f32> };
@vertex fn vs_bg(@builtin(vertex_index) i:u32)->V{var p=array<vec2<f32>,3>(vec2<f32>(-1.,-1.),vec2<f32>(3.,-1.),vec2<f32>(-1.,3.));var o:V;o.pos=vec4<f32>(p[i],0.,1.);o.uv=p[i]*vec2<f32>(.5,-.5)+.5;o.color=vec4<f32>(0.);o.world=o.uv;return o;}
fn sampleF(p:vec2<f32>)->vec4<f32>{let q=clamp(p*vec2<f32>(256.,144.)-.5,vec2<f32>(0.),vec2<f32>(255.,143.));let i=vec2<i32>(floor(q));let f=fract(q);return mix(mix(fluid[ix(i)],fluid[ix(i+vec2<i32>(1,0))],f.x),mix(fluid[ix(i+vec2<i32>(0,1))],fluid[ix(i+vec2<i32>(1,1))],f.x),f.y);}
fn sampleL(p:vec2<f32>)->vec4<f32>{let q=clamp(p*vec2<f32>(256.,144.)-.5,vec2<f32>(0.),vec2<f32>(255.,143.));let i=vec2<i32>(floor(q));let f=fract(q);return mix(mix(lighting[ix(i)],lighting[ix(i+vec2<i32>(1,0))],f.x),mix(lighting[ix(i+vec2<i32>(0,1))],lighting[ix(i+vec2<i32>(1,1))],f.x),f.y);}
fn density(p:vec2<f32>)->f32{let q=p*vec2<f32>(256.,144.)-.5;let i=vec2<i32>(floor(q));let f=fract(q);return mix(mix(f32(mass[ix(i)]),f32(mass[ix(i+vec2<i32>(1,0))]),f.x),mix(f32(mass[ix(i+vec2<i32>(0,1))]),f32(mass[ix(i+vec2<i32>(1,1))]),f.x),f.y)/4096.;}
fn flame(t:f32)->vec3<f32>{return vec3<f32>(min(2.,t*3.),pow(max(t,0.),1.7)*1.2,pow(max(t,0.),3.)*.65);}
@fragment fn fs_bg(v:V)->@location(0) vec4<f32>{
 let uv=v.uv;let geo=geometry[cell(uv)];let f=sampleF(uv);let lit=select(vec4<f32>(0.,0.,0.,1.),sampleL(uv),u.style.x==6.);let wall=geo.wall.x<0.;let tint=tintColor();let n=fbm(vec3<f32>(uv*vec2<f32>(35.,24.),u.view.z*.23));
 var col=select(vec3<f32>(0.),lit.rgb,u.style.x==6.);var alpha=0.;
 if(wall){col=vec3<f32>(.018,.024,.032)*(.25+lit.a*ctrl(3u,m.light.w))+exp(-abs(geo.wall.x)*600.)*tint*.15;alpha=.8;}
 if(!wall){let smoke=1.-exp(-f.z*1.5);let normal=normalize(vec3<f32>((sampleF(uv+vec2<f32>(.004,0.)).z-sampleF(uv-vec2<f32>(.004,0.)).z)*-3.,(sampleF(uv+vec2<f32>(0.,.007)).z-sampleF(uv-vec2<f32>(0.,.007)).z)*-3.,.3));let direction=normalize(lightPosition()-vec3<f32>(uv,.2));let diffuse=.15+max(dot(normal,direction),0.)*lit.a*ctrl(3u,m.light.w);col+=mix(vec3<f32>(.3),tint,.5)*smoke*diffuse*(.6+n*.5);
  let tongues=fbm(vec3<f32>(uv*vec2<f32>(64.,38.)+vec2<f32>(sin(uv.y*25.-u.view.z*2.),u.view.z*1.8),u.view.z*.6));let heat=max(0.,f.w*(.25+tongues*.9)-f.z*.18-.035);let hot=flame(heat);col+=mix(tint*hot.r,vec3<f32>(hot.r),clamp(heat*.55,0.,.8))*2.;alpha=max(alpha,clamp(smoke+heat,0.,1.));
 }
 // Thin emissive char follows the object itself; the solver carries hot gas above it.
 for(var s=0u;s<u32(u.style.y);s++){let base=s*66u;if(shapes[base+2u].z==1.&&inside(s,uv)){let grain=fbm(vec3<f32>(uv*60.,u.view.z*.3));let cracks=pow(max(0.,1.-abs(grain-.5)*8.),7.);col+=tint*cracks*.6;}}
 if((u.style.x==10.||m.material.w>.5)&&!wall){
  let d=density(uv);let coverage=smoothstep(.055,.14,d);let e=vec2<f32>(1./256.,1./144.);
  let grad=vec2<f32>(density(uv+vec2<f32>(e.x,0.))-density(uv-vec2<f32>(e.x,0.)),density(uv+vec2<f32>(0.,e.y))-density(uv-vec2<f32>(0.,e.y)));
  let ripple=vec2<f32>(sin(uv.y*45.-u.view.z*2.3)+sin(uv.x*31.+u.view.z*1.1),cos(uv.x*38.-u.view.z*1.8))*min(d,.9)*.025;
  let normal=normalize(vec3<f32>(-grad*(2.4/(1.+d*2.))+ripple,.24));let rough=ctrl(29u,m.surface.y);let refract=ctrl(30u,m.surface.z);
  let l=normalize(vec3<f32>(-.35,-.55,.85));let halfway=normalize(l+vec3<f32>(0.,0.,1.));
  let spec=pow(max(dot(normal,halfway),0.),mix(180.,12.,rough));let fres=.035+.965*pow(1.-normal.z,5.);
  let reflection=reflect(vec3<f32>(0.,0.,-1.),normal);let sky=mix(vec3<f32>(.015,.028,.045),vec3<f32>(.52,.68,.78),smoothstep(-.5,.8,reflection.y));
  let strip=exp(-pow((reflection.x+reflection.y*.35-.15)/(.065+rough*.2),2.));
  let thickness=1.-exp(-d*.9);let transmission=mix(tint*.46,tint*.055,thickness);
  let distorted=uv+normal.xy*.06*refract;let caustic=pow(.5+.5*sin(distorted.x*42.+sin(distorted.y*29.-u.view.z*.8)*2.),14.)*.06*refract;
  let water=transmission*(.65+.35*normal.z)+sky*(.18+fres*.82)+vec3<f32>(strip*(.15+fres*.85)*(1.-rough*.65)+spec*1.5+caustic);
  col=mix(col,water,coverage);alpha=max(alpha,coverage);
 }
 if(u.style.x==6.){col+=tint*ctrl(38u,m.lighting.z);alpha=max(alpha,clamp(max(col.r,max(col.g,col.b))*2.,0.,1.));}col=vec3<f32>(1.)-exp(-col*1.25);return vec4<f32>(pow(max(col,vec3<f32>(0.)),vec3<f32>(.85)),alpha*ctrl(25u,m.look.y));
}
@vertex fn vs_particle(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V{
 let p=particles[ii];var corners=array<vec2<f32>,6>(vec2<f32>(-1.,-1.),vec2<f32>(1.,-1.),vec2<f32>(-1.,1.),vec2<f32>(-1.,1.),vec2<f32>(1.,-1.),vec2<f32>(1.,1.));let c=corners[vi];let ball=u.style.x==7.;var size=select(.0018+p.life.y*.0015,p.life.w,ball);if(u.style.x==10.||u.style.x==6.||u.style.x==8.||m.material.w>.5){size=0.;}var o:V;let offset=c*size/aspect();o.pos=vec4<f32>((p.state.xy+offset)*vec2<f32>(2.,-2.)+vec2<f32>(-1.,1.),0.,1.);o.uv=c;o.world=p.state.xy;o.color=vec4<f32>(mix(tintColor(),vec3<f32>(1.),p.life.y*.2),ctrl(25u,m.look.y)*particleFade(p.life.x));return o;
}
@fragment fn fs_particle(v:V)->@location(0) vec4<f32>{let r=dot(v.uv,v.uv);if(r>1.||v.color.a<=0.){discard;}let ball=u.style.x==7.;if(ball){let normal=vec3<f32>(v.uv*vec2<f32>(1.,-1.),sqrt(max(0.,1.-r)));let light=normalize((lightPosition()-vec3<f32>(v.world,.08))*vec3<f32>(aspect(),1.));let h=normalize(light+vec3<f32>(0.,0.,1.));let diffuse=max(dot(normal,light),0.);let spec=pow(max(dot(normal,h),0.),90.);let rim=pow(1.-normal.z,3.);let col=v.color.rgb*(.12+diffuse*.7)+vec3<f32>(spec*1.3+rim*.3);return vec4<f32>(col,v.color.a);}let glow=exp(-r*3.);let tint=select(v.color.rgb,tintColor(),u.style.x==11.||m.material.z>.5);return vec4<f32>(tint*glow,glow*.65*v.color.a);}
`;
