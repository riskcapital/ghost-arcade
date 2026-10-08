import type {MobileEffectDef, MobileEffectInstance} from '../standaloneEffects';
export const FLUX_MODULES=[{id:'warp',name:'Liquid',hint:'Bend and ripple'},{id:'fold',name:'Fold',hint:'Reflect and spiral'},{id:'prism',name:'Prism',hint:'Split color and space'},{id:'echo',name:'Echo',hint:'Spatial trails'},{id:'solar',name:'Solar',hint:'Remap the spectrum'},{id:'slice',name:'Slice',hint:'Cut and displace'}] as const;
export type FluxState={energy?:number;x:number;y:number;mix:number;active:boolean;latch:boolean;beat:boolean;modules:string[]};
export const defaultFlux=():FluxState=>({x:.5,y:.5,mix:.8,active:false,latch:false,beat:false,modules:['warp','prism']});
export function fluxEffect(s:FluxState,gain:number,beat:number):MobileEffectInstance{
 const params:Record<string,number>={fluxX:s.x,fluxY:s.y,fluxEnergy:Math.max(0,Math.min(1,s.energy||0)),fluxGain:gain,fluxBeat:s.beat?beat:0,fluxSync:s.beat?1:0};
 for(const m of FLUX_MODULES)params[m.id]=s.modules.includes(m.id)?1:0;
 return {type:'_flux',enabled:gain>.0005&&s.modules.length>0,params};
}
export const FLUX_EFFECT:MobileEffectDef={type:'_flux',label:'Flux',category:'Internal',internal:true,
 defaults:{fluxEnergy:0,fluxX:.5,fluxY:.5,fluxGain:0,fluxBeat:0,fluxSync:0,warp:0,fold:0,prism:0,echo:0,solar:0,slice:0},
 fragment:`precision highp float;
varying vec2 vUv;uniform sampler2D uInput;uniform vec2 uResolution;uniform float uTime;
uniform float fluxEnergy,fluxX,fluxY,fluxGain,fluxBeat,fluxSync,warp,fold,prism,echo,solar,slice;
const float PI=3.14159265;
vec2 wrapUV(vec2 p){return 1.0-abs(mod(p,2.0)-1.0);}
vec4 sampleAt(vec2 p){return texture2D(uInput,wrapUV(p));}
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
void main(){
 vec4 dry=texture2D(uInput,vUv);float x=fluxX*2.0-1.0,y=clamp(fluxY+fluxEnergy*.35,0.0,1.3);
 float clock=mix(uTime*.7,fluxBeat*1.5707963,fluxSync);
 float pulse=mix(1.0,.75+.25*cos(fluxBeat*6.2831853),fluxSync);
 vec2 p=vUv-.5;float radius=length(p);
 // Fold changes the coordinate domain that Liquid and Slice operate inside.
 if(fold>.5){float sectors=3.0+floor(y*9.0);float a=atan(p.y,p.x)+x*PI+warp*radius*(y*9.0);float sector=2.0*PI/sectors;a=abs(mod(a+sector*.5,sector)-sector*.5);p=vec2(cos(a),sin(a))*radius;}
 if(warp>.5){p=rot(x*radius*5.0+y*sin(clock)*.25)*p;p+=vec2(sin(p.y*(5.0+y*18.0)+clock),cos(p.x*(6.0+y*15.0)-clock))*(.015+y*.14)*pulse;}
 if(slice>.5){float bands=5.0+floor(y*28.0);float row=floor((p.y+.5)*bands);p.x+=sin(row*2.399+floor(clock*3.0))*(.015+y*.22)*x;p.y+=prism*sin(p.x*15.0+clock)*y*.05;}
 p=rot(x*.35+fluxEnergy*sin(clock)*.4)*p/(1.0+y*.65+fluxEnergy*.5);vec2 uv=p+.5;
 vec4 wet=sampleAt(uv);
 if(echo>.5){vec2 d=vec2(x*.16,(y-.5)*.2);vec4 a=sampleAt((rot(fold*x*.25)*p)*(1.0+y*.4)+.5+d);vec4 b=sampleAt(p*(1.0+y*.8)+.5-d);wet=wet*.5+a*.3+b*.2;}
 if(prism>.5){vec2 d=(normalize(p+vec2(.0001))*(.003+y*.035)+vec2(x*.012,0.0))*(1.0+warp*y*2.0+echo*y);wet.r=sampleAt(uv+d).r;wet.b=sampleAt(uv-d).b;wet.rgb=mix(wet.rgb,wet.gbr,.2*y);}
 if(solar>.5){float l=dot(wet.rgb,vec3(.299,.587,.114));vec3 pal=.5+.5*cos(6.2831853*(vec3(0.0,.33,.67)+l*(1.0+y*3.0)+x*.5+prism*radius*2.0));wet.rgb=mix(wet.rgb,pal*(.25+.75*l),.45+.55*y);}
 wet.rgb=clamp(wet.rgb,0.0,1.0);gl_FragColor=mix(dry,wet,clamp(fluxGain,0.0,1.0));
}`};
