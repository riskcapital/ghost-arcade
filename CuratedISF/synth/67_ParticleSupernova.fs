/*{"DESCRIPTION":"Particle Supernova - 3D explosion with shockwave ring and debris trails","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":2.0},{"NAME":"explosionPhase","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.0},{"NAME":"particleCount","TYPE":"float","DEFAULT":80.0,"MIN":20.0,"MAX":120.0},{"NAME":"shockwaveRadius","TYPE":"float","DEFAULT":0.4,"MIN":0.1,"MAX":0.8},{"NAME":"coreColor","TYPE":"color","DEFAULT":[1.0,0.8,0.4,1.0]},{"NAME":"shockColor","TYPE":"color","DEFAULT":[0.3,0.5,1.0,1.0]},{"NAME":"debrisTrails","TYPE":"float","DEFAULT":0.7,"MIN":0.0,"MAX":1.5},{"NAME":"cameraDistance","TYPE":"float","DEFAULT":3.0,"MIN":1.5,"MAX":6.0},{"NAME":"bloomIntensity","TYPE":"float","DEFAULT":1.5,"MIN":0.0,"MAX":4.0},{"NAME":"turbulence","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(float n){return fract(sin(n)*43758.5453);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float phase=explosionPhase+sin(t*0.3)*0.2;
    float camA=t*0.2;
    vec3 ro=vec3(sin(camA),sin(t*0.15)*0.3,cos(camA))*cameraDistance;
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.0);
    // Core glow
    float coreDist=length(uv);
    float coreGlow=0.02/(coreDist*coreDist+0.01)*exp(-phase*3.0);
    col+=coreColor.rgb*coreGlow*bloomIntensity;
    // Shockwave ring
    float swR=shockwaveRadius*phase*2.0;
    for(int i=0;i<100;i++){
        if(float(i)>=particleCount)break;
        float fi=float(i);
        float h1=hash(fi*1.7+0.3),h2=hash(fi*2.3+7.1),h3=hash(fi*3.1+1.3),h4=hash(fi*5.3+3.7);
        // 3D position on expanding sphere
        float theta=h1*PI*2.0,phi=acos(h2*2.0-1.0);
        float r=phase*(0.5+h3*1.5)+h4*0.05*turbulence;
        vec3 pPos=r*vec3(sin(phi)*cos(theta),sin(phi)*sin(theta),cos(phi));
        // Turbulence displacement
        pPos+=vec3(noise3(pPos*3.0+t),noise3(pPos*3.0+100.0+t),noise3(pPos*3.0+200.0+t))*turbulence*0.1;
        // Project to screen
        vec3 toP=pPos-ro;
        float along=dot(toP,ww);
        if(along<0.0)continue;
        vec2 proj=vec2(dot(toP,uu),dot(toP,vv))/along*1.5;
        float pd=length(uv-proj);
        float zBright=1.0/(1.0+along*0.3);
        // Trail
        float trail=exp(-pd*pd/(0.0005*debrisTrails+0.0001));
        float age=length(pPos)/2.0;
        vec3 pCol=mix(coreColor.rgb,shockColor.rgb,age);
        col+=pCol*trail*zBright*0.03;
        col+=pCol*0.001/(pd+0.003)*zBright;
    }
    // Shockwave shell
    float shellR=phase*1.5;
    float shellDist=abs(coreDist-shellR*0.3);
    float shell=exp(-shellDist*shellDist*200.0)*phase;
    col+=shockColor.rgb*shell*0.5;
    col=pow(col,vec3(0.85));
    gl_FragColor=vec4(col,1.0);
}
