import type {MobileEffectDef, MobileEffectInstance} from '../standaloneEffects';
export const FLUX_MODULES=[{id:'warp',name:'Liquid',hint:'Bend and ripple'},{id:'fold',name:'Fold',hint:'Reflect and spiral'},{id:'prism',name:'Prism',hint:'Split color and space'},{id:'echo',name:'Echo',hint:'Spatial trails'},{id:'solar',name:'Solar',hint:'Remap the spectrum'},{id:'slice',name:'Slice',hint:'Cut and displace'},{id:'tile',name:'Tile',hint:'Repeat the picture'},{id:'tunnel',name:'Tunnel',hint:'Streak toward the centre'},{id:'pixel',name:'Pixel',hint:'Break into blocks'},{id:'glitch',name:'Glitch',hint:'Tear and shift bands'},{id:'ink',name:'Ink',hint:'Flatten to bold tones'},{id:'throb',name:'Pulse',hint:'Breathe with the beat'}] as const;
/** How the effected picture is laid over the clean one. The order is the shader's `fluxBlend` number. */
export const FLUX_BLENDS=['Mix','Add','Screen','Multiply','Difference','Lighten','Overlay'] as const;
export type FluxState={energy?:number;x:number;y:number;mix:number;blend?:number;active:boolean;latch:boolean;beat:boolean;modules:string[]};
export const defaultFlux=():FluxState=>({x:.5,y:.5,mix:.8,active:false,latch:false,beat:false,modules:['warp','prism']});
export function fluxEffect(s:FluxState,gain:number,beat:number):MobileEffectInstance{
 const params:Record<string,number>={fluxX:s.x,fluxY:s.y,fluxEnergy:Math.max(0,Math.min(1,s.energy||0)),fluxGain:gain,fluxBeat:s.beat?beat:0,fluxSync:s.beat?1:0,fluxBlend:Math.max(0,Math.min(FLUX_BLENDS.length-1,Math.round(s.blend||0)))};
 for(const m of FLUX_MODULES)params[m.id]=s.modules.includes(m.id)?1:0;
 return {type:'_flux',enabled:gain>.0005&&s.modules.length>0,params};
}
export const FLUX_EFFECT:MobileEffectDef={type:'_flux',label:'Flux',category:'Internal',internal:true,
 defaults:{fluxEnergy:0,fluxX:.5,fluxY:.5,fluxGain:0,fluxBeat:0,fluxSync:0,fluxBlend:0,warp:0,fold:0,prism:0,echo:0,solar:0,slice:0,tile:0,tunnel:0,pixel:0,glitch:0,ink:0,throb:0},
 fragment:`precision highp float;
varying vec2 vUv;uniform sampler2D uInput;uniform vec2 uResolution;uniform float uTime;
uniform float fluxEnergy,fluxX,fluxY,fluxGain,fluxBeat,fluxSync,warp,fold,prism,echo,solar,slice;
uniform float tile,tunnel,pixel,glitch,ink,throb;
uniform float fluxBlend;
const float PI=3.14159265;
vec2 wrapUV(vec2 p){return 1.0-abs(mod(p,2.0)-1.0);}
vec4 sampleAt(vec2 p){return texture2D(uInput,wrapUV(p));}
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
void main(){
 vec4 dry=texture2D(uInput,vUv);float x=fluxX*2.0-1.0,y=clamp(fluxY+fluxEnergy*.35,0.0,1.3);
 float clock=mix(uTime*.7,fluxBeat*1.5707963,fluxSync);
 float pulse=mix(1.0,.75+.25*cos(fluxBeat*6.2831853),fluxSync);
 vec2 p=vUv-.5;float radius=length(p);
 // Tile repeats the picture before anything bends it, so every copy takes the other effects.
 if(tile>.5){float n=2.0+floor(y*5.0);p=fract((p+.5)*n+vec2(x*.5,0.0))-.5;radius=length(p);}
 // Fold changes the coordinate domain that Liquid and Slice operate inside.
 if(fold>.5){float sectors=3.0+floor(y*9.0);float a=atan(p.y,p.x)+x*PI+warp*radius*(y*9.0);float sector=2.0*PI/sectors;a=abs(mod(a+sector*.5,sector)-sector*.5);p=vec2(cos(a),sin(a))*radius;}
 if(warp>.5){p=rot(x*radius*5.0+y*sin(clock)*.25)*p;p+=vec2(sin(p.y*(5.0+y*18.0)+clock),cos(p.x*(6.0+y*15.0)-clock))*(.015+y*.14)*pulse;}
 if(slice>.5){float bands=5.0+floor(y*28.0);float row=floor((p.y+.5)*bands);p.x+=sin(row*2.399+floor(clock*3.0))*(.015+y*.22)*x;p.y+=prism*sin(p.x*15.0+clock)*y*.05;}
 p=rot(x*.35+fluxEnergy*sin(clock)*.4)*p/(1.0+y*.65+fluxEnergy*.5);vec2 uv=p+.5;
 if(pixel>.5){float rows=150.0-min(y,1.0)*138.0;vec2 cells=vec2(rows*uResolution.x/max(uResolution.y,1.0),rows);uv=(floor(uv*cells)+.5)/cells;}
 vec4 wet=sampleAt(uv);
 if(tunnel>.5){vec3 acc=wet.rgb;float total=1.0;for(int i=1;i<8;i++){float f=float(i)/8.0;float w=1.0-f;acc+=sampleAt((rot(x*f*.6)*(uv-.5))*(1.0-f*(.08+min(y,1.0)*.5))+.5).rgb*w;total+=w;}wet.rgb=acc/total;}
 if(glitch>.5){float tick=floor(clock*8.0);float band=floor(vUv.y*(6.0+y*30.0));float h=fract(sin(band*91.7+tick*13.3)*43758.5);float on=step(1.0-(.15+min(y,1.0)*.5),h);vec2 g=vec2((h-.5)*(.05+y*.3)*on,0.0);vec2 split=vec2(.006+.01*abs(x),0.0);wet.rgb=vec3(sampleAt(uv+g+split).r,sampleAt(uv+g).g,sampleAt(uv+g-split).b);}
 if(echo>.5){vec2 d=vec2(x*.16,(y-.5)*.2);vec4 a=sampleAt((rot(fold*x*.25)*p)*(1.0+y*.4)+.5+d);vec4 b=sampleAt(p*(1.0+y*.8)+.5-d);wet=wet*.5+a*.3+b*.2;}
 if(prism>.5){vec2 d=(normalize(p+vec2(.0001))*(.003+y*.035)+vec2(x*.012,0.0))*(1.0+warp*y*2.0+echo*y);wet.r=sampleAt(uv+d).r;wet.b=sampleAt(uv-d).b;wet.rgb=mix(wet.rgb,wet.gbr,.2*y);}
 if(solar>.5){float l=dot(wet.rgb,vec3(.299,.587,.114));vec3 pal=.5+.5*cos(6.2831853*(vec3(0.0,.33,.67)+l*(1.0+y*3.0)+x*.5+prism*radius*2.0));wet.rgb=mix(wet.rgb,pal*(.25+.75*l),.45+.55*y);}
 if(ink>.5){float l=dot(wet.rgb,vec3(.299,.587,.114));float steps=2.0+floor((1.0-min(y,1.0))*5.0);float q=floor(l*steps+.5)/steps;vec3 tint=.5+.5*cos(6.2831853*(vec3(0.0,.33,.67)+x*.5+.6));wet.rgb=mix(vec3(q),q*tint*1.6,.6);}
 // A smooth swell, never a hard flash: once a beat when synced, slow when free.
 if(throb>.5){float ph=mix(uTime*(.5+min(y,1.0)),fluxBeat,fluxSync);float swell=pow(.5+.5*cos(ph*6.2831853),1.0+y*5.0);wet.rgb*=mix(.3,1.15,swell);}
 wet.rgb=clamp(wet.rgb,0.0,1.0);
 vec3 d=dry.rgb,w=wet.rgb,blended=w;
 if(fluxBlend>5.5)blended=mix(2.0*d*w,1.0-2.0*(1.0-d)*(1.0-w),step(.5,d));
 else if(fluxBlend>4.5)blended=max(d,w);
 else if(fluxBlend>3.5)blended=abs(d-w);
 else if(fluxBlend>2.5)blended=d*w;
 else if(fluxBlend>1.5)blended=1.0-(1.0-d)*(1.0-w);
 else if(fluxBlend>.5)blended=d+w;
 float amount=clamp(fluxGain,0.0,1.0);
 gl_FragColor=vec4(mix(d,clamp(blended,0.0,1.0),amount),mix(dry.a,max(dry.a,wet.a),amount));
}`};
