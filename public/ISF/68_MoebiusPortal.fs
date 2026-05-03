/*{"DESCRIPTION":"Moebius Portal - twisted ring gateway with energy vortex","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"ringRadius","TYPE":"float","DEFAULT":0.3,"MIN":0.1,"MAX":0.5},{"NAME":"tubeRadius","TYPE":"float","DEFAULT":0.04,"MIN":0.01,"MAX":0.1},{"NAME":"twists","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"portalColor","TYPE":"color","DEFAULT":[0.3,0.4,1.0,1.0]},{"NAME":"vortexColor","TYPE":"color","DEFAULT":[0.6,0.2,0.9,1.0]},{"NAME":"vortexIntensity","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"cameraOrbit","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"energyPulse","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"distortion","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
// SAMPLES was 200.0 — trimmed to 128.0 (strip still reads continuous; ~35% fewer inner-loop steps).
#define SAMPLES 128.0
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*cameraOrbit;
    vec3 ro=vec3(sin(ca)*1.5,sin(t*0.2)*0.3,cos(ca)*1.5);
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.0);
    float minDist=1e10;
    // Trace Moebius strip as parametric curve
    for(float s=0.0;s<SAMPLES;s++){
        float u=s/SAMPLES*PI*2.0;
        // Moebius strip parametric
        float R=ringRadius;
        float halfTwist=twists*u*0.5;
        float cx=cos(u),sx=sin(u);
        // Center circle
        vec3 center=R*vec3(cx,0.0,sx);
        // Normal and binormal
        vec3 T=normalize(vec3(-sx,0.0,cx));
        vec3 N=vec3(cx,0.0,sx);
        vec3 B=vec3(0.0,1.0,0.0);
        // Twisted frame
        vec3 tN=N*cos(halfTwist)+B*sin(halfTwist);
        // Ring of tube around center
        for(float v=-1.0;v<=1.0;v+=0.5){
            vec3 p3=center+tN*tubeRadius*v;
            // Rotate whole thing
            float cr=cos(t*0.1),sr=sin(t*0.1);
            p3.xy=vec2(p3.x*cr-p3.y*sr,p3.x*sr+p3.y*cr);
            vec3 toP=p3-ro;
            float along=dot(toP,rd);
            if(along>0.0){
                vec3 closest=ro+rd*along;
                float d=length(closest-p3);
                minDist=min(minDist,d);
                float zBright=1.0/(1.0+along*0.3);
                float pulse=0.5+0.5*sin(u*4.0-t*energyPulse*5.0);
                col+=portalColor.rgb*0.0005/(d*d+0.0001)*zBright*pulse;
            }
        }
    }
    // Vortex in portal center
    float portalDist=length(uv);
    float vortexAngle=atan(uv.y,uv.x);
    float spiral=sin(vortexAngle*3.0-portalDist*20.0+t*5.0)*0.5+0.5;
    float vortex=exp(-portalDist*portalDist/(ringRadius*ringRadius*0.5))*spiral*vortexIntensity;
    // Distortion noise
    float nz=noise3(vec3(uv*5.0,t))*distortion;
    vortex*=0.5+0.5*nz;
    col+=vortexColor.rgb*vortex*0.3;
    // Edge bloom
    col+=portalColor.rgb*exp(-minDist*20.0)*0.2;
    col=pow(col,vec3(0.85));
    gl_FragColor=vec4(col,1.0);
}
