/*{
  "CREDIT": "Three-Body Orbits",
  "CATEGORIES": ["generator"],
  "DESCRIPTION": "Three-body Figure-8 orbit with 30 visual effect styles.",
  "INPUTS": [
    {"NAME": "effectStyle", "TYPE": "long", "DEFAULT": 0,
     "LABELS": ["Orbits", "Ribbons", "Particles", "Fire", "Neon", "Plasma", "Stardust", "Wireframe", "Kaleidoscope", "Glitch", "Nebula", "Bloom", "Tendrils", "Lasers", "Echoes", "Trails", "Lightning", "Smoke", "Crystal", "Aurora", "Spiral", "Pulse", "Matrix", "Void", "Prism", "Ink", "Circuit", "Gravity Wells", "Comet", "Hologram"],
     "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    {"NAME": "quality", "TYPE": "long", "DEFAULT": 1,
     "LABELS": ["Low", "Medium", "High"],
     "VALUES": [0, 1, 2]},
    {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.05, "MAX": 3.0},
    {"NAME": "zoom", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.3, "MAX": 5.0},
    {"NAME": "lineScale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
    {"NAME": "glowAmount", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 5.0},
    {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
    {"NAME": "bodySize", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 5.0},
    {"NAME": "autoRotateSpeed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
    {"NAME": "rotationX", "TYPE": "float", "DEFAULT": 0.3, "MIN": -3.14, "MAX": 3.14},
    {"NAME": "rotationY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14},
    {"NAME": "cameraDistance", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 20.0},
    {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.08, 1.0]},
    {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.08, 0.5, 1.0, 1.0]},
    {"NAME": "color3", "TYPE": "color", "DEFAULT": [0.15, 1.0, 0.4, 1.0]}
  ]
}*/

#define MAX_STEPS 350
#define SOFT 0.015
#define PI 3.14159265

mat3 rX(float a){float s=sin(a),c=cos(a);return mat3(1,0,0,0,c,-s,0,s,c);}
mat3 rY(float a){float s=sin(a),c=cos(a);return mat3(c,0,s,0,1,0,-s,0,c);}
vec2 grav(vec2 a,vec2 b){vec2 r=b-a;float d2=dot(r,r)+SOFT*SOFT;return r/(d2*sqrt(d2));}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h);}
vec2 proj(vec3 p,float cd){return p.xy*cd/(cd+p.z);}

float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.0;a*=0.5;}return v;}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}

// Figure-8 three-body orbit (Chenciner-Montgomery, equal mass m1=m2=m3=1)
void orbit(out vec2 p1,out vec2 p2,out vec2 p3,out vec2 v1,out vec2 v2,out vec2 v3,out float T){
    p1=vec2(-1,0);p2=vec2(1,0);p3=vec2(0);
    float vx=0.347117,vy=0.532725;
    T=6.3259;
    v1=vec2(vx,vy);v2=vec2(vx,vy);v3=vec2(-2.0*vx,-2.0*vy);
}

void main(){
    int numSteps=quality==0?150:(quality==1?250:350);
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE)/RENDERSIZE.y/zoom;
    vec2 uvOrig=uv;

    // Pre-loop UV transforms
    if(effectStyle==3) uv+=vec2(0,fbm(uv*10.0+TIME*3.0)*lineScale*0.02);
    if(effectStyle==8){
        float ka=atan(uv.y,uv.x);float kr=length(uv);
        float segs=3.0+lineScale*5.0;
        ka=mod(ka,2.0*PI/segs);ka=abs(ka-PI/segs);
        uv=vec2(cos(ka),sin(ka))*kr;
    }
    if(effectStyle==27){ // Gravity Wells — pre-distort UV
        // Distortion applied after body positions are known (post-loop)
    }

    // Orbit setup
    vec2 p1,p2,p3,v1,v2,v3;float T;
    orbit(p1,p2,p3,v1,v2,v3,T);
    mat3 rot=rY(rotationY+TIME*autoRotateSpeed)*rX(rotationX);
    float dt=T/float(numSteps);
    float phase=fract(TIME*speed/T);
    int curStep=int(phase*float(numSteps));

    // Shared integration loop
    float md1=1e5,md2=1e5,md3=1e5;
    float bl1=0.0,bl2=0.0,bl3=0.0;
    vec2 sp1=proj(rot*vec3(p1,0),cameraDistance);
    vec2 sp2=proj(rot*vec3(p2,0),cameraDistance);
    vec2 sp3=proj(rot*vec3(p3,0),cameraDistance);
    vec2 sc1=sp1,sc2=sp2,sc3=sp3;

    // Trail tracking: previous body positions for directional effects
    vec2 pp1=sp1,pp2=sp2,pp3=sp3;
    int prevStep=curStep-1;
    if(prevStep<0) prevStep+=numSteps;

    for(int i=0;i<MAX_STEPS;i++){
        if(i>=numSteps) break;
        vec2 a1=grav(p1,p2)+grav(p1,p3);
        vec2 a2=grav(p2,p1)+grav(p2,p3);
        vec2 a3=grav(p3,p1)+grav(p3,p2);
        v1+=a1*dt*.5;v2+=a2*dt*.5;v3+=a3*dt*.5;
        p1+=v1*dt;p2+=v2*dt;p3+=v3*dt;
        a1=grav(p1,p2)+grav(p1,p3);
        a2=grav(p2,p1)+grav(p2,p3);
        a3=grav(p3,p1)+grav(p3,p2);
        v1+=a1*dt*.5;v2+=a2*dt*.5;v3+=a3*dt*.5;

        vec2 s1=proj(rot*vec3(p1,0),cameraDistance);
        vec2 s2=proj(rot*vec3(p2,0),cameraDistance);
        vec2 s3=proj(rot*vec3(p3,0),cameraDistance);
        float d1=sdSeg(uv,sp1,s1);
        float d2=sdSeg(uv,sp2,s2);
        float d3=sdSeg(uv,sp3,s3);

        // Trail-aware accumulation: fade based on distance from current step
        float stepFade=1.0;
        if(effectStyle==15||effectStyle==28){ // Trails / Comet — directional fade
            int dist=curStep-i;
            if(dist<0) dist+=numSteps;
            float trailWindow=float(numSteps)*trailLength*0.3;
            stepFade=exp(-float(dist)/trailWindow);
        }

        md1=min(md1,d1);md2=min(md2,d2);md3=min(md3,d3);
        bl1+=stepFade/(1.0+d1*d1*800.0);
        bl2+=stepFade/(1.0+d2*d2*800.0);
        bl3+=stepFade/(1.0+d3*d3*800.0);
        if(i==curStep){sc1=s1;sc2=s2;sc3=s3;}
        if(i==prevStep){pp1=s1;pp2=s2;pp3=s3;}
        sp1=s1;sp2=s2;sp3=s3;
    }

    float invS=1.0/float(numSteps);
    bl1*=invS;bl2*=invS;bl3*=invS;

    // Body marker helper
    float bs=0.025*bodySize;

    // === Effect coloring (30 styles) ===
    vec3 col=vec3(0.005);
    float w;

    if(effectStyle==0){ // Orbits — clean glowing lines + body markers
        w=0.006*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*1.2;
        col+=color2.rgb*exp(-md2*md2/(w*w))*1.2;
        col+=color3.rgb*exp(-md3*md3/(w*w))*1.2;
        col+=color1.rgb*bl1*glowAmount*3.0;
        col+=color2.rgb*bl2*glowAmount*3.0;
        col+=color3.rgb*bl3*glowAmount*3.0;
        col+=color1.rgb*bs/(length(uv-sc1)+bs*0.08)*0.4;
        col+=color2.rgb*bs/(length(uv-sc2)+bs*0.08)*0.4;
        col+=color3.rgb*bs/(length(uv-sc3)+bs*0.08)*0.4;
    }
    else if(effectStyle==1){ // Ribbons — wide smooth bands
        w=0.025*lineScale;
        col+=color1.rgb*smoothstep(w,w*0.3,md1)*glowAmount*0.7;
        col+=color2.rgb*smoothstep(w,w*0.3,md2)*glowAmount*0.7;
        col+=color3.rgb*smoothstep(w,w*0.3,md3)*glowAmount*0.7;
        col+=color1.rgb*exp(-md1/(w*3.0))*0.2*glowAmount;
        col+=color2.rgb*exp(-md2/(w*3.0))*0.2*glowAmount;
        col+=color3.rgb*exp(-md3/(w*3.0))*0.2*glowAmount;
    }
    else if(effectStyle==2){ // Particles — sparkling point cloud
        float spark=hash2(floor(uv*200.0+TIME*3.0));
        float m=step(0.5,spark)*glowAmount*10.0;
        col+=color1.rgb*bl1*m;col+=color2.rgb*bl2*m;col+=color3.rgb*bl3*m;
        float ps=0.015*lineScale*bodySize;
        col+=color1.rgb*ps*ps/(dot(uv-sc1,uv-sc1)+ps*ps)*0.5;
        col+=color2.rgb*ps*ps/(dot(uv-sc2,uv-sc2)+ps*ps)*0.5;
        col+=color3.rgb*ps*ps/(dot(uv-sc3,uv-sc3)+ps*ps)*0.5;
    }
    else if(effectStyle==3){ // Fire — flame trails with FBM noise
        float heat=(bl1+bl2+bl3)*glowAmount*8.0;
        heat*=fbm(uvOrig*8.0-vec2(0,TIME*3.0))*0.5+0.5;
        col=vec3(smoothstep(0.0,0.3,heat),smoothstep(0.2,0.7,heat),smoothstep(0.6,1.2,heat));
        w=0.008;
        col+=vec3(1.0,0.9,0.7)*(exp(-md1*md1/(w*w))+exp(-md2*md2/(w*w))+exp(-md3*md3/(w*w)));
    }
    else if(effectStyle==4){ // Neon — thick tube glow with chromatic fringe
        float r=0.018*lineScale;
        col+=vec3(1)*smoothstep(r,r*0.3,md1);
        col+=vec3(1)*smoothstep(r,r*0.3,md2);
        col+=vec3(1)*smoothstep(r,r*0.3,md3);
        float gs=r*3.0*glowAmount;float cs=r*0.3;
        col.r+=color1.r*gs/(md1+gs*0.2)+color2.r*gs/(md2+gs*0.2)+color3.r*gs/(md3+gs*0.2);
        col.g+=color1.g*gs/((md1+cs)+gs*0.2)+color2.g*gs/((md2+cs)+gs*0.2)+color3.g*gs/((md3+cs)+gs*0.2);
        col.b+=color1.b*gs/((md1+cs*2.0)+gs*0.2)+color2.b*gs/((md2+cs*2.0)+gs*0.2)+color3.b*gs/((md3+cs*2.0)+gs*0.2);
        col*=0.15;
    }
    else if(effectStyle==5){ // Plasma — electric arcs between bodies
        w=0.005;
        col+=color1.rgb*exp(-md1*md1/(w*w));
        col+=color2.rgb*exp(-md2*md2/(w*w));
        col+=color3.rgb*exp(-md3*md3/(w*w));
        float da=sdSeg(uv,sc1,sc2),db=sdSeg(uv,sc2,sc3),dc=sdSeg(uv,sc3,sc1);
        float aw=0.01*lineScale;float n=fbm(uv*20.0+TIME*5.0);
        col+=(color1.rgb+color2.rgb)*0.5*exp(-da*da/(aw*aw))*n*glowAmount;
        col+=(color2.rgb+color3.rgb)*0.5*exp(-db*db/(aw*aw))*n*glowAmount;
        col+=(color3.rgb+color1.rgb)*0.5*exp(-dc*dc/(aw*aw))*n*glowAmount;
        col+=color1.rgb*0.01*bodySize/(dot(uv-sc1,uv-sc1)+0.001);
        col+=color2.rgb*0.01*bodySize/(dot(uv-sc2,uv-sc2)+0.001);
        col+=color3.rgb*0.01*bodySize/(dot(uv-sc3,uv-sc3)+0.001);
    }
    else if(effectStyle==6){ // Stardust — cosmic dust with background stars
        col+=color1.rgb*bl1*glowAmount*5.0;
        col+=color2.rgb*bl2*glowAmount*5.0;
        col+=color3.rgb*bl3*glowAmount*5.0;
        col+=vec3(0.05)*step(0.99,hash2(floor(uv*250.0)));
        w=0.004;
        col+=color1.rgb*exp(-md1*md1/(w*w))*0.5;
        col+=color2.rgb*exp(-md2*md2/(w*w))*0.5;
        col+=color3.rgb*exp(-md3*md3/(w*w))*0.5;
    }
    else if(effectStyle==7){ // Wireframe — triangulated mesh between bodies
        w=0.004*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w));
        col+=color2.rgb*exp(-md2*md2/(w*w));
        col+=color3.rgb*exp(-md3*md3/(w*w));
        float da=sdSeg(uv,sc1,sc2),db=sdSeg(uv,sc2,sc3),dc=sdSeg(uv,sc3,sc1);
        float ww=0.003*lineScale;vec3 wc=(color1.rgb+color2.rgb+color3.rgb)*0.33;
        col+=wc*(exp(-da*da/(ww*ww))+exp(-db*db/(ww*ww))+exp(-dc*dc/(ww*ww)))*glowAmount;
        float vs=0.01*bodySize;
        col+=color1.rgb*vs/(length(uv-sc1)+vs*0.1)*0.3;
        col+=color2.rgb*vs/(length(uv-sc2)+vs*0.1)*0.3;
        col+=color3.rgb*vs/(length(uv-sc3)+vs*0.1)*0.3;
    }
    else if(effectStyle==8){ // Kaleidoscope — mirrored symmetry
        w=0.008*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*glowAmount;
        col+=color2.rgb*exp(-md2*md2/(w*w))*glowAmount;
        col+=color3.rgb*exp(-md3*md3/(w*w))*glowAmount;
        col+=color1.rgb*bl1*5.0*glowAmount;
        col+=color2.rgb*bl2*5.0*glowAmount;
        col+=color3.rgb*bl3*5.0*glowAmount;
    }
    else if(effectStyle==9){ // Glitch — RGB shift + scanlines
        w=0.006*lineScale;float sh=0.008*glowAmount;
        col.r+=color1.r*exp(-(md1+sh)*(md1+sh)/(w*w))+color2.r*exp(-(md2+sh)*(md2+sh)/(w*w))+color3.r*exp(-(md3+sh)*(md3+sh)/(w*w));
        col.g+=color1.g*exp(-md1*md1/(w*w))+color2.g*exp(-md2*md2/(w*w))+color3.g*exp(-md3*md3/(w*w));
        col.b+=color1.b*exp(-(md1-sh)*(md1-sh)/(w*w))+color2.b*exp(-(md2-sh)*(md2-sh)/(w*w))+color3.b*exp(-(md3-sh)*(md3-sh)/(w*w));
        col*=0.7+0.3*(sin(gl_FragCoord.y*3.0)*0.5+0.5);
        col=mix(col,col.gbr*2.0,step(0.97,hash2(floor(uvOrig*vec2(8,12)+floor(TIME*4.0))))*0.5);
    }
    else if(effectStyle==10){ // Nebula — volumetric gas clouds
        col+=color1.rgb*bl1*glowAmount*8.0;
        col+=color2.rgb*bl2*glowAmount*8.0;
        col+=color3.rgb*bl3*glowAmount*8.0;
        col*=(fbm(uvOrig*5.0+TIME*0.3)*0.5+0.5)*1.5;
        w=0.01;
        col+=color1.rgb*exp(-md1/(w*5.0))*0.3;
        col+=color2.rgb*exp(-md2/(w*5.0))*0.3;
        col+=color3.rgb*exp(-md3/(w*5.0))*0.3;
        col+=vec3(0.04)*step(0.99,hash2(floor(uvOrig*200.0)));
    }
    else if(effectStyle==11){ // Bloom — soft photographic glow
        w=0.006*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*1.5;
        col+=color2.rgb*exp(-md2*md2/(w*w))*1.5;
        col+=color3.rgb*exp(-md3*md3/(w*w))*1.5;
        col+=color1.rgb*bl1*glowAmount*8.0;
        col+=color2.rgb*bl2*glowAmount*8.0;
        col+=color3.rgb*bl3*glowAmount*8.0;
        float bw=0.04*glowAmount;
        col+=color1.rgb*exp(-md1/(bw*2.0))*glowAmount*0.15;
        col+=color2.rgb*exp(-md2/(bw*2.0))*glowAmount*0.15;
        col+=color3.rgb*exp(-md3/(bw*2.0))*glowAmount*0.15;
        col=col/(1.0+col*0.5);col=pow(col,vec3(0.9));
    }
    else if(effectStyle==12){ // Tendrils — organic vine-like displacement
        w=0.008*lineScale;
        float n1=sin(md1*80.0+TIME*4.0)*0.003*trailLength;
        float n2=sin(md2*80.0+TIME*4.3)*0.003*trailLength;
        float n3=sin(md3*80.0+TIME*4.7)*0.003*trailLength;
        col+=color1.rgb*exp(-(md1+n1)*(md1+n1)/(w*w))*glowAmount;
        col+=color2.rgb*exp(-(md2+n2)*(md2+n2)/(w*w))*glowAmount;
        col+=color3.rgb*exp(-(md3+n3)*(md3+n3)/(w*w))*glowAmount;
        col+=color1.rgb*bl1*3.0*glowAmount;
        col+=color2.rgb*bl2*3.0*glowAmount;
        col+=color3.rgb*bl3*3.0*glowAmount;
        float vine=fbm(uv*30.0+TIME*2.0);
        col*=0.7+vine*0.6;
    }
    else if(effectStyle==13){ // Lasers — ultra-thin bright beams
        w=0.002*lineScale;
        float core1=exp(-md1*md1/(w*w*0.3));
        float core2=exp(-md2*md2/(w*w*0.3));
        float core3=exp(-md3*md3/(w*w*0.3));
        col+=vec3(1.0)*(core1+core2+core3)*2.0;
        float outer=w*4.0*glowAmount;
        col+=color1.rgb*exp(-md1*md1/(outer*outer));
        col+=color2.rgb*exp(-md2*md2/(outer*outer));
        col+=color3.rgb*exp(-md3*md3/(outer*outer));
        col+=color1.rgb*bs*1.5/(length(uv-sc1)+bs*0.05)*0.3;
        col+=color2.rgb*bs*1.5/(length(uv-sc2)+bs*0.05)*0.3;
        col+=color3.rgb*bs*1.5/(length(uv-sc3)+bs*0.05)*0.3;
    }
    else if(effectStyle==14){ // Echoes — time-offset ghost copies
        w=0.006*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*1.5;
        col+=color2.rgb*exp(-md2*md2/(w*w))*1.5;
        col+=color3.rgb*exp(-md3*md3/(w*w))*1.5;
        int echoCount=int(4.0+trailLength*4.0);
        for(int e=1;e<9;e++){
            if(e>=echoCount) break;
            float ef=float(e)/float(echoCount);
            float ep=fract(phase-ef*0.15*trailLength);
            int es=int(ep*float(numSteps));
            float fade=1.0-ef;fade*=fade;
            col+=color1.rgb*bl1*fade*glowAmount*2.0;
            col+=color2.rgb*bl2*fade*glowAmount*2.0;
            col+=color3.rgb*bl3*fade*glowAmount*2.0;
        }
        col+=color1.rgb*bs/(length(uv-sc1)+bs*0.08)*0.5;
        col+=color2.rgb*bs/(length(uv-sc2)+bs*0.08)*0.5;
        col+=color3.rgb*bs/(length(uv-sc3)+bs*0.08)*0.5;
    }
    else if(effectStyle==15){ // Trails — fading gradient tails (uses stepFade in loop)
        w=0.008*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*0.8;
        col+=color2.rgb*exp(-md2*md2/(w*w))*0.8;
        col+=color3.rgb*exp(-md3*md3/(w*w))*0.8;
        col+=color1.rgb*bl1*glowAmount*6.0;
        col+=color2.rgb*bl2*glowAmount*6.0;
        col+=color3.rgb*bl3*glowAmount*6.0;
        col+=color1.rgb*bs*1.5/(length(uv-sc1)+bs*0.06)*0.6;
        col+=color2.rgb*bs*1.5/(length(uv-sc2)+bs*0.06)*0.6;
        col+=color3.rgb*bs*1.5/(length(uv-sc3)+bs*0.06)*0.6;
    }
    else if(effectStyle==16){ // Lightning — jagged noise-displaced paths
        w=0.005*lineScale;
        float jag=vnoise(uv*50.0+TIME*8.0)*0.01*trailLength;
        col+=color1.rgb*exp(-(md1+jag)*(md1+jag)/(w*w))*glowAmount*1.5;
        col+=color2.rgb*exp(-(md2+jag)*(md2+jag)/(w*w))*glowAmount*1.5;
        col+=color3.rgb*exp(-(md3+jag)*(md3+jag)/(w*w))*glowAmount*1.5;
        float flash=step(0.98,hash2(floor(uv*5.0+floor(TIME*12.0))));
        col+=(color1.rgb+color2.rgb+color3.rgb)*0.33*flash*3.0*glowAmount;
        float spark=step(0.995,hash2(floor(uv*100.0+TIME*20.0)));
        col+=vec3(1)*spark*2.0;
    }
    else if(effectStyle==17){ // Smoke — soft diffused volumetric
        float dens=(bl1+bl2+bl3)*glowAmount*12.0;
        float turb=fbm(uvOrig*6.0+TIME*0.8)*0.5+0.5;
        dens*=turb;
        col+=color1.rgb*bl1*turb*glowAmount*10.0;
        col+=color2.rgb*bl2*turb*glowAmount*10.0;
        col+=color3.rgb*bl3*turb*glowAmount*10.0;
        col*=0.6+fbm(uvOrig*3.0-TIME*0.5)*0.8;
        w=0.02*lineScale;
        col+=color1.rgb*exp(-md1/(w*4.0))*0.15;
        col+=color2.rgb*exp(-md2/(w*4.0))*0.15;
        col+=color3.rgb*exp(-md3/(w*4.0))*0.15;
    }
    else if(effectStyle==18){ // Crystal — faceted geometric hard-edge
        w=0.012*lineScale;
        float f1=step(md1,w)*glowAmount;
        float f2=step(md2,w)*glowAmount;
        float f3=step(md3,w)*glowAmount;
        col+=color1.rgb*f1*0.8;col+=color2.rgb*f2*0.8;col+=color3.rgb*f3*0.8;
        // Specular edge
        float edge1=smoothstep(w,w*0.8,md1)-smoothstep(w*0.8,w*0.6,md1);
        float edge2=smoothstep(w,w*0.8,md2)-smoothstep(w*0.8,w*0.6,md2);
        float edge3=smoothstep(w,w*0.8,md3)-smoothstep(w*0.8,w*0.6,md3);
        col+=vec3(1)*(edge1+edge2+edge3)*1.5;
        col+=color1.rgb*bs*0.8/(length(uv-sc1)+bs*0.1)*0.4;
        col+=color2.rgb*bs*0.8/(length(uv-sc2)+bs*0.1)*0.4;
        col+=color3.rgb*bs*0.8/(length(uv-sc3)+bs*0.1)*0.4;
    }
    else if(effectStyle==19){ // Aurora — vertical curtain waves
        float wave=sin(uv.x*20.0+TIME*2.0)*0.5+0.5;
        float curtain=(bl1+bl2+bl3)*glowAmount*15.0*wave;
        col+=color1.rgb*curtain*bl1/(bl1+bl2+bl3+0.001)*3.0;
        col+=color2.rgb*curtain*bl2/(bl1+bl2+bl3+0.001)*3.0;
        col+=color3.rgb*curtain*bl3/(bl1+bl2+bl3+0.001)*3.0;
        col*=0.8+sin(uv.y*40.0+TIME*3.0)*0.2;
        w=0.005;
        col+=color1.rgb*exp(-md1*md1/(w*w))*0.5;
        col+=color2.rgb*exp(-md2*md2/(w*w))*0.5;
        col+=color3.rgb*exp(-md3*md3/(w*w))*0.5;
    }
    else if(effectStyle==20){ // Spiral — spiraling displacement around paths
        w=0.006*lineScale;
        float sp=sin(md1*120.0*trailLength-TIME*6.0)*0.004;
        col+=color1.rgb*exp(-(md1+sp)*(md1+sp)/(w*w))*glowAmount;
        sp=sin(md2*120.0*trailLength-TIME*6.0)*0.004;
        col+=color2.rgb*exp(-(md2+sp)*(md2+sp)/(w*w))*glowAmount;
        sp=sin(md3*120.0*trailLength-TIME*6.0)*0.004;
        col+=color3.rgb*exp(-(md3+sp)*(md3+sp)/(w*w))*glowAmount;
        col+=color1.rgb*bl1*4.0*glowAmount;
        col+=color2.rgb*bl2*4.0*glowAmount;
        col+=color3.rgb*bl3*4.0*glowAmount;
    }
    else if(effectStyle==21){ // Pulse — rhythmic brightness waves along orbit
        w=0.006*lineScale;
        float pulse=sin(TIME*8.0*speed)*0.5+0.5;
        float pulse2=sin(TIME*8.0*speed+2.094)*0.5+0.5;
        float pulse3=sin(TIME*8.0*speed+4.189)*0.5+0.5;
        col+=color1.rgb*exp(-md1*md1/(w*w))*(0.5+pulse*1.5)*glowAmount;
        col+=color2.rgb*exp(-md2*md2/(w*w))*(0.5+pulse2*1.5)*glowAmount;
        col+=color3.rgb*exp(-md3*md3/(w*w))*(0.5+pulse3*1.5)*glowAmount;
        col+=color1.rgb*bl1*glowAmount*3.0*pulse;
        col+=color2.rgb*bl2*glowAmount*3.0*pulse2;
        col+=color3.rgb*bl3*glowAmount*3.0*pulse3;
        col+=color1.rgb*bs*pulse/(length(uv-sc1)+bs*0.08)*0.5;
        col+=color2.rgb*bs*pulse2/(length(uv-sc2)+bs*0.08)*0.5;
        col+=color3.rgb*bs*pulse3/(length(uv-sc3)+bs*0.08)*0.5;
    }
    else if(effectStyle==22){ // Matrix — digital rain + grid-snapped orbits
        vec2 grid=floor(uv*40.0)/40.0;
        float rain=step(0.96,hash2(grid+floor(TIME*6.0)));
        col+=vec3(0.0,0.15,0.0)*rain;
        w=0.008*lineScale;
        vec3 mc=vec3(0.1,1.0,0.2);
        col+=mc*exp(-md1*md1/(w*w))*0.8;
        col+=mc*exp(-md2*md2/(w*w))*0.8;
        col+=mc*exp(-md3*md3/(w*w))*0.8;
        col+=mc*bl1*glowAmount*4.0;
        col+=mc*bl2*glowAmount*4.0;
        col+=mc*bl3*glowAmount*4.0;
        col*=0.8+0.2*step(0.5,fract(gl_FragCoord.y/3.0));
    }
    else if(effectStyle==23){ // Void — inverted dark orbits in bright field
        w=0.008*lineScale;
        float orb=exp(-md1*md1/(w*w))+exp(-md2*md2/(w*w))+exp(-md3*md3/(w*w));
        float glow=(bl1+bl2+bl3)*glowAmount*5.0;
        vec3 bg=(color1.rgb+color2.rgb+color3.rgb)*0.15;
        col=bg*(1.0-orb*0.9)*(1.0-glow*0.3);
        col+=vec3(0.005)/(orb+0.01)*0.01;
        col=max(col,vec3(0));
    }
    else if(effectStyle==24){ // Prism — rainbow spectrum splitting
        w=0.006*lineScale;
        for(int c=0;c<6;c++){
            float hue=float(c)/6.0;
            vec3 rc=hsv2rgb(vec3(hue,1.0,1.0));
            float offset=float(c)*0.002*glowAmount;
            col+=rc*exp(-(md1+offset)*(md1+offset)/(w*w))*0.4;
            col+=rc*exp(-(md2+offset)*(md2+offset)/(w*w))*0.4;
            col+=rc*exp(-(md3+offset)*(md3+offset)/(w*w))*0.4;
        }
        col+=color1.rgb*bl1*2.0;col+=color2.rgb*bl2*2.0;col+=color3.rgb*bl3*2.0;
    }
    else if(effectStyle==25){ // Ink — watercolor/ink wash with paper texture
        float paper=fbm(uvOrig*15.0)*0.15+0.85;
        w=0.015*lineScale;
        float ink1=smoothstep(w,w*0.1,md1);
        float ink2=smoothstep(w,w*0.1,md2);
        float ink3=smoothstep(w,w*0.1,md3);
        float bleed=fbm(uvOrig*20.0+TIME*0.5)*0.5+0.5;
        col+=color1.rgb*ink1*bleed*glowAmount;
        col+=color2.rgb*ink2*bleed*glowAmount;
        col+=color3.rgb*ink3*bleed*glowAmount;
        col+=color1.rgb*exp(-md1/(w*2.0))*0.15*bleed;
        col+=color2.rgb*exp(-md2/(w*2.0))*0.15*bleed;
        col+=color3.rgb*exp(-md3/(w*2.0))*0.15*bleed;
        col*=paper;
    }
    else if(effectStyle==26){ // Circuit — PCB-trace geometric + solder dots
        w=0.004*lineScale;
        float trace1=step(md1,w);
        float trace2=step(md2,w);
        float trace3=step(md3,w);
        col+=color1.rgb*trace1*0.9;col+=color2.rgb*trace2*0.9;col+=color3.rgb*trace3*0.9;
        // Glow around traces
        col+=color1.rgb*exp(-md1/(w*6.0))*0.08*glowAmount;
        col+=color2.rgb*exp(-md2/(w*6.0))*0.08*glowAmount;
        col+=color3.rgb*exp(-md3/(w*6.0))*0.08*glowAmount;
        // Solder dots at body positions
        float dot1=smoothstep(0.02*bodySize,0.015*bodySize,length(uv-sc1));
        float dot2=smoothstep(0.02*bodySize,0.015*bodySize,length(uv-sc2));
        float dot3=smoothstep(0.02*bodySize,0.015*bodySize,length(uv-sc3));
        col+=color1.rgb*dot1;col+=color2.rgb*dot2;col+=color3.rgb*dot3;
        // Substrate grid
        col+=vec3(0.02)*step(0.97,fract(uv.x*30.0))+vec3(0.02)*step(0.97,fract(uv.y*30.0));
    }
    else if(effectStyle==27){ // Gravity Wells — lens distortion around bodies
        // Warp UV around each body
        vec2 wuv=uv;
        float wellStr=0.02*glowAmount*bodySize;
        vec2 d2sc1=wuv-sc1;float dl1=length(d2sc1)+0.01;
        vec2 d2sc2=wuv-sc2;float dl2=length(d2sc2)+0.01;
        vec2 d2sc3=wuv-sc3;float dl3=length(d2sc3)+0.01;
        wuv+=d2sc1*wellStr/(dl1*dl1);
        wuv+=d2sc2*wellStr/(dl2*dl2);
        wuv+=d2sc3*wellStr/(dl3*dl3);
        // Render warped grid + orbits
        float grid=step(0.97,fract(wuv.x*15.0))+step(0.97,fract(wuv.y*15.0));
        col+=vec3(0.04)*grid;
        w=0.006*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*glowAmount;
        col+=color2.rgb*exp(-md2*md2/(w*w))*glowAmount;
        col+=color3.rgb*exp(-md3*md3/(w*w))*glowAmount;
        col+=color1.rgb*0.02*bodySize/(dl1*dl1+0.001)*0.3;
        col+=color2.rgb*0.02*bodySize/(dl2*dl2+0.001)*0.3;
        col+=color3.rgb*0.02*bodySize/(dl3*dl3+0.001)*0.3;
    }
    else if(effectStyle==28){ // Comet — bright head + fading directional tail (uses stepFade)
        w=0.005*lineScale;
        col+=color1.rgb*exp(-md1*md1/(w*w))*0.6;
        col+=color2.rgb*exp(-md2*md2/(w*w))*0.6;
        col+=color3.rgb*exp(-md3*md3/(w*w))*0.6;
        col+=color1.rgb*bl1*glowAmount*8.0;
        col+=color2.rgb*bl2*glowAmount*8.0;
        col+=color3.rgb*bl3*glowAmount*8.0;
        // Bright comet heads
        float head=bs*2.0;
        col+=color1.rgb*head/(length(uv-sc1)+head*0.04)*0.8;
        col+=color2.rgb*head/(length(uv-sc2)+head*0.04)*0.8;
        col+=color3.rgb*head/(length(uv-sc3)+head*0.04)*0.8;
        col+=vec3(1.0)*head*0.5/(length(uv-sc1)+head*0.02)*0.3;
        col+=vec3(1.0)*head*0.5/(length(uv-sc2)+head*0.02)*0.3;
        col+=vec3(1.0)*head*0.5/(length(uv-sc3)+head*0.02)*0.3;
    }
    else{ // 29: Hologram — scan-line holographic + flicker
        w=0.007*lineScale;
        float scanline=sin(gl_FragCoord.y*2.0+TIME*15.0)*0.3+0.7;
        float flicker=0.85+0.15*sin(TIME*30.0);
        col+=color1.rgb*exp(-md1*md1/(w*w))*glowAmount*scanline;
        col+=color2.rgb*exp(-md2*md2/(w*w))*glowAmount*scanline;
        col+=color3.rgb*exp(-md3*md3/(w*w))*glowAmount*scanline;
        col+=color1.rgb*bl1*3.0*glowAmount;
        col+=color2.rgb*bl2*3.0*glowAmount;
        col+=color3.rgb*bl3*3.0*glowAmount;
        col*=flicker;
        col*=0.9+0.1*step(0.5,fract(gl_FragCoord.y/2.0));
        col+=color1.rgb*bs/(length(uv-sc1)+bs*0.08)*0.3*scanline;
        col+=color2.rgb*bs/(length(uv-sc2)+bs*0.08)*0.3*scanline;
        col+=color3.rgb*bs/(length(uv-sc3)+bs*0.08)*0.3*scanline;
        col=mix(col,col*vec3(0.7,1.0,0.9),0.3);
    }

    col*=1.0+audioBeat*0.4;
    gl_FragColor=vec4(col,1.0);
}
