/*{
  "DESCRIPTION": "GhostFX: fourteen evolving worlds with immersive geometry, volumetric light and continuous audio-driven GPU feedback.",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2.0",
  "CATEGORIES": [
    "Generator",
    "Audio Reactive"
  ],
  "INPUTS": [
    {
      "NAME": "movement",
      "LABEL": "Movement",
      "TYPE": "long",
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13
      ],
      "LABELS": [
        "Silk Ribbons",
        "Deep Space",
        "Fractal Bloom",
        "Liquid Marble",
        "Orbital Jelly",
        "Prism Tunnel",
        "Cathedral Flight",
        "Nebula Nursery",
        "Glass Organism",
        "Alien Ocean",
        "Infinite Machinery",
        "Aurora Vault",
        "Magnetic Garden",
        "Mandel Orbit"
      ],
      "DEFAULT": 0
    },
    {
      "NAME": "journey",
      "LABEL": "Journey \u00b7 explore movements",
      "TYPE": "bool",
      "DEFAULT": false
    },
    {
      "NAME": "journeySeconds",
      "LABEL": "Journey \u00b7 seconds per world",
      "TYPE": "float",
      "MIN": 15,
      "MAX": 90,
      "DEFAULT": 24
    },
    {
      "NAME": "drift",
      "LABEL": "Flow speed",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 0.6
    },
    {
      "NAME": "curl",
      "LABEL": "Curl",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 0.8
    },
    {
      "NAME": "ribbons",
      "LABEL": "Ribbons",
      "TYPE": "float",
      "MIN": 1,
      "MAX": 6,
      "DEFAULT": 3
    },
    {
      "NAME": "palette",
      "LABEL": "Color drift",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.2
    },
    {
      "NAME": "reactivity",
      "LABEL": "Music response",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "memory",
      "LABEL": "Trail memory",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.7
    },
    {
      "NAME": "depth",
      "LABEL": "Immersion",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "detail",
      "LABEL": "Structure detail",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.65
    },
    {
      "NAME": "evolution",
      "LABEL": "World evolution",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.6
    },
    {
      "NAME": "morph",
      "LABEL": "Movement morph \u00b7 seconds",
      "TYPE": "float",
      "MIN": 0.5,
      "MAX": 8,
      "DEFAULT": 2.5
    },
    {
      "NAME": "_ghost0",
      "TYPE": "float",
      "DEFAULT": 1
    },
    {
      "NAME": "_ghost1",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost2",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost3",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost4",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost5",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost6",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost7",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost8",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost9",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost10",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost11",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost12",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghost13",
      "TYPE": "float",
      "DEFAULT": 0
    },
    {
      "NAME": "_ghostClock",
      "TYPE": "float",
      "DEFAULT": -1
    }
  ]
}*/

float clockTime(){return _ghostClock>=0.?_ghostClock:TIME*(.1+drift*.2);}

vec3 colors(float x){return .5+.5*cos(6.28318*(vec3(.04,.24,.49)+x));}
vec3 silk(vec2 coords){
 vec2 p=(coords-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);
 float t=clockTime(),bass=audioBass*reactivity,mid=audioMid*reactivity,high=audioHigh*reactivity;
 float phase=t*.21+sin(t*.13)*.4;
 p+=vec2(sin(p.y*2.+t*.6),cos(p.x*2.1-t*.45))*(.12+curl*.11);
 vec3 col=vec3(.004,.007,.015);
 for(int i=0;i<6;i++){
  float fi=float(i);float active=clamp(ribbons-fi,0.,1.);
  float angle=phase+fi*1.0472+sin(t*.2+fi)*.35;
  vec2 q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
  float wave=sin(q.x*(2.7+bass*.6)+t+fi*1.5)*(.18+bass*.08)+sin(q.x*5.-t*.7+fi)*(.04+mid*.03);
  float dist=abs(q.y-wave);
  float silk=exp(-dist*(23.-mid*4.));
  float core=exp(-dist*110.);
  vec3 tint=colors(palette+fi*.095+t*.018+q.x*.08);
  float threads=.5+.5*sin((q.y-wave)*620.+sin(q.x*12.+t)*2.);
  float weave=pow(threads,5.)*exp(-dist*38.);
  col+=(silk*.2+core*(.1+high*.15)+weave*.16*detail)*tint*active;
 }
 float halo=exp(-dot(p,p)*2.8);col+=colors(palette+.3+t*.015)*halo*(.02+bass*.045);
 return 1.-exp(-col*1.5);
}

vec3 vision(vec2 uv,float m){
 vec2 p=(uv-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);float t=clockTime(),b=audioBass*reactivity,hi=audioHigh*reactivity;
 float rad=max(length(p),.02),angle=atan(p.y,p.x);vec3 c=vec3(.002,.004,.012);
 if(m<1.5){ // Forward star travel: each star fades at both ends of its journey.
  for(int i=0;i<48;i++){float f=float(i);float z=fract(f*.6180339-t*.1);float a=f*2.399963;vec2 star=vec2(cos(a),sin(a))*(.08+fract(f*.173)*.45)/(.12+z*2.);
   vec2 delta=p-star;vec2 dir=normalize(star+vec2(.0001));float along=dot(delta,dir),across=dot(delta,vec2(-dir.y,dir.x));
   float streak=.002+pow(1.-z,3.)*.025*depth;float glow=exp(-across*across/(.00001+pow(1.-z,3.)*.00008)-along*along/(streak*streak));float fade=smoothstep(0.,.14,z)*(1.-smoothstep(.8,1.,z));c+=colors(palette+f*.03)*glow*fade*(.5+hi*.5);}
  c+=colors(palette+t*.025)*pow(.5+.5*sin(angle*3.+log(rad)*5.-t),5.)*exp(-rad*3.)*(.08+b*.07);
 }else if(m<2.5){vec2 q=p;float glow=0.;for(int i=0;i<5;i++){q=abs(q)/max(dot(q,q),.2)-vec2(.8+sin(t*.17)*.2,.6);q=mat2(.8,-.6,.6,.8)*q;glow+=exp(-abs(length(q)-.65-b*.06)*14.)/(float(i)+2.);}c+=colors(palette+rad*.2+t*.025)*glow*.6;
 }else if(m<3.5){vec2 q=p;for(int i=0;i<4;i++){float f=float(i);q+=vec2(sin(q.y*(2.+f)+t*.5),cos(q.x*(2.+f)-t*.4))*(.16+curl*.09);}float bands=sin(q.x*7.+q.y*5.+t);c=colors(palette+bands*.2+t*.016)*(.1+.6*pow(.5+.5*bands,3.))*(.8+b*.2);
 }else if(m<4.5){for(int i=0;i<5;i++){float f=float(i);vec2 center=.25*vec2(sin(t*.4+f*1.25),cos(t*.3+f*1.7));float d=length(p-center);float ring=exp(-abs(d-(.13+.03*sin(angle*5.+t+f)+b*.025))*65.);float membrane=exp(-d*12.)*pow(.5+.5*sin(d*80.-t*2.+sin(angle*6.+f)),4.);
 c+=colors(palette+f*.12+t*.018)*(ring*.4+membrane*.12*detail);}}
 else {float twist=angle+sin(log(rad)*2.-t)*(.15+curl*.2);float spokes=pow(.5+.5*cos(twist*8.),18.);float rings=pow(.5+.5*cos(log(rad)*12.+t*3.),18.);c+=colors(palette+log(rad)*.12+t*.03)*(spokes*.22+rings*.4)*smoothstep(.02,.12,rad)*(1.+b*.3);}
 return 1.-exp(-c*1.3);
}

mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fogNoise(vec3 p){return noise3(p)*.58+noise3(p*2.03+7.)*.28+noise3(p*4.07-3.)*.14;}
float boxSDF(vec3 p,vec3 b){vec3 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,max(d.y,d.z)),0.);}
float field(vec3 p,float m,float t){
 if(m<6.5){ // Vaulted ribs and an endless colonnade.
  vec3 q=p;q.z=mod(q.z+2.,4.)-2.;q.x=abs(q.x)-2.2;
  float pillars=length(q.xz)-.19;
  float arch=abs(length(vec2(p.x,p.y-.35))-2.2)-.085;
  arch=max(arch,abs(q.z)-.12);
  return min(min(pillars,arch),p.y+1.8);
 }
 if(m<8.5){ // A breathing, folded glass organism, never a whole-frame bass pulse.
  p.xy*=turn(t*.12);p.xz*=turn(t*.16);float wave=.09*sin(p.x*6.+t)+.06*sin(p.y*8.-t*.7);
  float shell=abs(length(p)-(.95+wave*evolution))-.035;
  vec3 q=p;for(int i=0;i<3;i++){q=abs(q)-vec3(.35,.25,.3);q.xy*=turn(.7+t*.035*evolution);q.xz*=turn(.8);}
  return min(shell,length(q)-.16);
 }
 if(m<10.5){ // Machinery drifting through repeating lattice chambers.
  vec3 q=mod(p+1.5,3.)-1.5;q.xy*=turn(.22*sin(t*.3+p.z*.2)*evolution);
  float beams=min(boxSDF(q,vec3(.065,1.5,.065)),min(boxSDF(q,vec3(1.5,.065,.065)),boxSDF(q,vec3(.065,.065,1.5))));
  float cage=abs(length(q.xy)-.9)-.045;cage=max(cage,abs(q.z)-.12);
  return min(beams,cage);
 }
 // Magnetic garden: luminous stems and orbiting seed pods.
 vec3 q=p;q.xz=mod(q.xz+1.2,2.4)-1.2;
 float bend=.22*sin(p.y*2.+t*.65+p.z*.2);q.x+=bend;q.z+=.12*cos(p.y*3.-t*.4);
 float stem=length(q.xz)-.028;
 float pod=length(vec3(q.x,q.y-.6*sin(p.x+p.z+t*.3),q.z))-.25;
 return min(min(stem,pod),p.y+1.5);
}
vec3 architecture(vec2 uv,float m){
 float t=clockTime(),b=audioBass*reactivity,hi=audioHigh*reactivity;
 vec2 p=(uv-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);
 vec3 ro=vec3(.35*sin(t*.23),.12*sin(t*.19),t*1.6),rd=normalize(vec3(p,1.1/(.7+depth*.3)));
 rd.xy*=turn(.07*sin(t*.16)*evolution);
 if(m>7.5&&m<9.){ro=vec3(0,0,-3.1);rd=normalize(vec3(p,1.25));}
 float travel=0.,glow=0.;bool hit=false;vec3 pos=ro;
 for(int i=0;i<48;i++){if(float(i)>28.+detail*19.)break;pos=ro+rd*travel;float d=field(pos,m,t);glow+=exp(-abs(d)*18.)*.014;if(d<.004){hit=true;break;}travel+=max(.012,abs(d)*.65);if(travel>15.)break;}
 vec3 c=colors(palette+t*.018+rd.y*.2)*glow*(.5+audioMid*reactivity*.4);
 if(hit){vec2 e=vec2(.006,0.);vec3 n=normalize(vec3(field(pos+e.xyy,m,t)-field(pos-e.xyy,m,t),field(pos+e.yxy,m,t)-field(pos-e.yxy,m,t),field(pos+e.yyx,m,t)-field(pos-e.yyx,m,t)));
  vec3 light=normalize(vec3(sin(t*.4),1.,-1.));float diffuse=max(0.,dot(n,light)),rim=pow(1.-abs(dot(n,rd)),3.);
  float filigree=pow(.5+.5*sin(pos.y*(12.+detail*20.)+sin(pos.z*4.)*2.+t),12.);
  vec3 tint=colors(palette+pos.z*.045+pos.y*.09+t*.025);
  c+=tint*(.13+diffuse*.7+rim*(.6+hi*.5)+filigree*(.1+b*.12))*exp(-travel*.12);
  c+=pow(max(0.,dot(reflect(rd,n),light)),28.)*vec3(.55,.75,1.)*.65;
 }
 return 1.-exp(-c*1.5);
}
vec3 nebula(vec2 uv,float m){
 float t=clockTime();vec2 p=(uv-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);vec3 ray=normalize(vec3(p,1.2)),sum=vec3(0.);float trans=1.;
 for(int i=0;i<24;i++){if(float(i)>13.+detail*10.)break;float z=.6+float(i)*.26;vec3 q=ray*z+vec3(0,0,t*.55);q.xy*=turn(z*.16+sin(t*.1)*.3);
  float cloud;
  if(m<8.){float n=fogNoise(q*(1.4+depth*.4)+vec3(sin(t*.2),0,0));float hollow=1.-exp(-length(q.xy-vec2(.3*sin(q.z+t*.07),.2*cos(q.z)))*2.);
   cloud=smoothstep(.53,.79,n)*hollow*(1.-smoothstep(1.4,3.4,length(q.xy)));}
  else{float curtain=sin(q.x*2.+sin(q.z*1.7+t*.2)*2.);cloud=exp(-abs(q.y-curtain*.45)*18.)*(.4+.6*noise3(q*3.));}
  float density=cloud*(.12+audioMid*reactivity*.06);sum+=trans*density*colors(palette+z*.16+cloud*.55+t*.015);trans*=1.-density*.7;
 }
 float star=pow(max(0.,noise3(vec3(p*180.+vec2(t*.22,t*.09),.7))-.78)*4.5,8.);sum+=min(star,.7)*(.4+audioHigh*reactivity*.3)*trans;
 if(m<8.){float halo=exp(-length(p-vec2(.12*sin(t*.09),.07)) * 9.);sum+=colors(palette+.4)*halo*.12*trans;}
 return 1.-exp(-sum*2.1);
}
vec3 ocean(vec2 uv){
 float t=clockTime();vec2 p=(uv-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);float horizon=p.y+.08;
 vec3 sky=colors(palette+.2+t*.01)*(.06+.12*exp(-abs(horizon)*12.));
 if(horizon>0.){float moon=length(p-vec2(.3,.23));sky+=colors(palette+.45)*exp(-abs(moon-.085)*100.)*.7;return sky;}
 float z=1./max(.035,-horizon),x=p.x*z;vec2 q=vec2(x,z+t*2.);
 float wave=0.;for(int i=0;i<4;i++){float f=float(i)+1.;wave+=sin(q.x*f*.7+sin(q.y*.35*f+t)*1.4+t*.25*f)/f;}
 float foam=pow(.5+.5*sin(wave*3.+q.y*.5),12.);float reflection=exp(-abs(p.x-.3)*5.)*pow(.5+.5*sin(wave*2.),5.);
 vec3 sea=colors(palette+wave*.08+t*.016)*(.12+foam*(.45+audioHigh*reactivity*.3)+reflection*.4);return mix(sky,sea,1.-exp(-abs(horizon)*12.));
}
vec3 mandel(vec2 uv){
 float t=clockTime();vec2 p=(uv-.5)*vec2(RENDERSIZE.x/RENDERSIZE.y,1.);p*=turn(t*.045);vec2 z=p*(1.8+depth*.4),c=vec2(-.68+.12*sin(t*.17*evolution),.24+.14*cos(t*.13*evolution));float trap=10.,energy=0.;
 for(int i=0;i<24;i++){if(float(i)>12.+detail*11.)break;z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;float r=dot(z,z);trap=min(trap,abs(length(z)-.65));energy+=exp(-abs(z.y)*8.)*.035;if(r>16.)break;}
 vec3 col=colors(palette+log(max(trap,.0001))*.065+t*.018)*exp(-trap*9.)+colors(palette+.3)*energy*(.3+audioMid*reactivity*.3);return 1.-exp(-col*1.6);
}
void main(){vec2 uv=isf_FragNormCoord;vec3 c=vec3(0.);float w=0.;
if(_ghost0>.003){c+=silk(uv)*_ghost0;w+=_ghost0;}
if(_ghost1>.003){c+=vision(uv,1.)*_ghost1;w+=_ghost1;}
if(_ghost2>.003){c+=vision(uv,2.)*_ghost2;w+=_ghost2;}
if(_ghost3>.003){c+=vision(uv,3.)*_ghost3;w+=_ghost3;}
if(_ghost4>.003){c+=vision(uv,4.)*_ghost4;w+=_ghost4;}
if(_ghost5>.003){c+=vision(uv,5.)*_ghost5;w+=_ghost5;}
if(_ghost6>.003){c+=architecture(uv,6.)*_ghost6;w+=_ghost6;}
if(_ghost7>.003){c+=nebula(uv,7.)*_ghost7;w+=_ghost7;}
if(_ghost8>.003){c+=architecture(uv,8.)*_ghost8;w+=_ghost8;}
if(_ghost9>.003){c+=ocean(uv)*_ghost9;w+=_ghost9;}
if(_ghost10>.003){c+=architecture(uv,10.)*_ghost10;w+=_ghost10;}
if(_ghost11>.003){c+=nebula(uv,11.)*_ghost11;w+=_ghost11;}
if(_ghost12>.003){c+=architecture(uv,12.)*_ghost12;w+=_ghost12;}
if(_ghost13>.003){c+=mandel(uv)*_ghost13;w+=_ghost13;}
c/=max(w,.001);float vignette=1.-.26*pow(length((uv-.5)*1.3),2.);gl_FragColor=vec4(c*vignette,1.);}
