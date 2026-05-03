/*{"DESCRIPTION":"Cosmic Spine - vertebrae chain floating in void with energy pulses","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"vertebrae","TYPE":"float","DEFAULT":20.0,"MIN":5.0,"MAX":40.0},{"NAME":"spineRadius","TYPE":"float","DEFAULT":0.04,"MIN":0.01,"MAX":0.1},{"NAME":"discSpacing","TYPE":"float","DEFAULT":0.12,"MIN":0.05,"MAX":0.25},{"NAME":"curvature","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5},{"NAME":"boneColor","TYPE":"color","DEFAULT":[0.6,0.6,0.65,1.0]},{"NAME":"energyColor","TYPE":"color","DEFAULT":[0.3,0.5,1.0,1.0]},{"NAME":"pulseSpeed","TYPE":"float","DEFAULT":2.0,"MIN":0.0,"MAX":5.0},{"NAME":"cameraDistance","TYPE":"float","DEFAULT":2.5,"MIN":1.0,"MAX":5.0},{"NAME":"ribCount","TYPE":"float","DEFAULT":4.0,"MIN":0.0,"MAX":8.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float sdTorus(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}
float sdCapsule(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h)-r;}
float scene(vec3 p,float t){
    float d=1e10;
    for(float i=0.0;i<40.0;i++){
        if(i>=vertebrae)break;
        float fi=i;
        float y=fi*discSpacing-vertebrae*discSpacing*0.5;
        float cx=sin(y*curvature*2.0+t*0.3)*curvature*0.3;
        float cz=cos(y*curvature*1.5+t*0.2)*curvature*0.2;
        vec3 center=vec3(cx,y,cz);
        // Disc
        vec3 lp=p-center;
        float disc=sdTorus(lp,vec2(spineRadius*2.0,spineRadius*0.8));
        d=min(d,disc);
        // Ribs
        for(float r=0.0;r<8.0;r++){
            if(r>=ribCount)break;
            float ra=r*PI*2.0/ribCount+fi*0.2+t*0.1;
            vec3 ribEnd=center+vec3(cos(ra),0.0,sin(ra))*spineRadius*5.0;
            ribEnd.y+=sin(ra+t)*0.01;
            d=min(d,sdCapsule(p,center,ribEnd,spineRadius*0.3));
        }
        // Central cord
        if(i<vertebrae-1.0){
            float ny=(fi+1.0)*discSpacing-vertebrae*discSpacing*0.5;
            float ncx=sin(ny*curvature*2.0+t*0.3)*curvature*0.3;
            float ncz=cos(ny*curvature*1.5+t*0.2)*curvature*0.2;
            vec3 next=vec3(ncx,ny,ncz);
            d=min(d,sdCapsule(p,center,next,spineRadius*0.5));
        }
    }
    return d;
}
vec3 getNormal(vec3 p,float t){vec2 e=vec2(0.001,0.0);return normalize(vec3(scene(p+e.xyy,t)-scene(p-e.xyy,t),scene(p+e.yxy,t)-scene(p-e.yxy,t),scene(p+e.yyx,t)-scene(p-e.yyx,t)));}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*0.3;
    vec3 ro=vec3(sin(ca)*cameraDistance,sin(t*0.2)*0.5,cos(ca)*cameraDistance);
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.01,0.005,0.02);
    float td=0.0;float glow=0.0;
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p,t);
        glow+=exp(-d*15.0)*0.01;
        if(d<0.001){
            vec3 n=getNormal(p,t);
            vec3 ld=normalize(vec3(0.5,0.8,0.3));
            float diff=max(dot(n,ld),0.0);
            float spec=pow(max(dot(reflect(-ld,n),-rd),0.0),32.0);
            float pulse=0.5+0.5*sin(p.y*10.0-t*pulseSpeed*3.0);
            vec3 matCol=mix(boneColor.rgb,energyColor.rgb,pulse*0.3);
            col=matCol*(diff*0.7+0.15)+vec3(spec*0.3);
            col+=energyColor.rgb*pulse*0.1;
            float fog=1.0-exp(-td*0.08);
            col=mix(col,vec3(0.01,0.005,0.02),fog);
            break;
        }
        td+=d;if(td>20.0)break;
    }
    col+=energyColor.rgb*glow*0.5;
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
