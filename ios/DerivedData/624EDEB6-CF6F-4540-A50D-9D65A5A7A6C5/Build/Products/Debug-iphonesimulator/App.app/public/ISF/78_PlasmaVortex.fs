/*{"DESCRIPTION":"Plasma Vortex - swirling 3D energy tornado with volumetric core","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.6,"MIN":0.0,"MAX":2.0},{"NAME":"vortexHeight","TYPE":"float","DEFAULT":3.0,"MIN":1.0,"MAX":5.0},{"NAME":"vortexRadius","TYPE":"float","DEFAULT":0.5,"MIN":0.1,"MAX":1.0},{"NAME":"spiralArms","TYPE":"float","DEFAULT":3.0,"MIN":1.0,"MAX":6.0},{"NAME":"coreColor","TYPE":"color","DEFAULT":[1.0,0.8,0.4,1.0]},{"NAME":"outerColor","TYPE":"color","DEFAULT":[0.3,0.2,0.8,1.0]},{"NAME":"particleCount","TYPE":"float","DEFAULT":60.0,"MIN":10.0,"MAX":100.0},{"NAME":"turbulence","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5},{"NAME":"cameraDistance","TYPE":"float","DEFAULT":3.0,"MIN":1.5,"MAX":6.0},{"NAME":"bloomIntensity","TYPE":"float","DEFAULT":1.5,"MIN":0.0,"MAX":4.0}]}*/
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
    float ca=t*0.3;
    vec3 ro=vec3(sin(ca)*cameraDistance,1.0+sin(t*0.2)*0.5,cos(ca)*cameraDistance);
    vec3 ww=normalize(-ro+vec3(0,0.5,0)),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.01,0.005,0.02);
    // Volumetric vortex
    for(float i=0.0;i<40.0;i++){
        float td=i*0.2;
        vec3 p=ro+rd*td;
        float y=p.y;
        if(y<-0.5||y>vortexHeight)continue;
        float yNorm=y/vortexHeight;
        // Radius narrows toward top (funnel)
        float localR=vortexRadius*(1.0-yNorm*0.6);
        float r=length(p.xz);
        float angle=atan(p.z,p.x);
        // Spiral density
        float spiral=0.0;
        for(float arm=0.0;arm<6.0;arm++){
            if(arm>=spiralArms)break;
            float armAngle=arm*PI*2.0/spiralArms+yNorm*8.0+t*3.0;
            float angleDiff=mod(angle-armAngle+PI,PI*2.0)-PI;
            spiral+=exp(-angleDiff*angleDiff*20.0);
        }
        float radialFade=exp(-(r-localR)*(r-localR)/(localR*localR*0.3));
        float heightFade=yNorm*(1.0-yNorm)*4.0;
        float d=spiral*radialFade*heightFade;
        // Turbulence
        d+=noise3(p*3.0+t)*turbulence*radialFade*0.3;
        d=max(d,0.0);
        vec3 vCol=mix(outerColor.rgb,coreColor.rgb,1.0-r/(localR+0.1));
        vCol=mix(vCol,coreColor.rgb,pow(yNorm,2.0));
        float fog=exp(-td*0.08);
        col+=vCol*d*0.02*fog;
    }
    // Particles spiraling
    for(float i=0.0;i<100.0;i++){
        if(i>=particleCount)break;
        float fi=i;
        float py=hash(fi*1.7)*vortexHeight;
        float yNorm=py/vortexHeight;
        float localR=vortexRadius*(1.0-yNorm*0.6)*(0.5+hash(fi*3.1)*0.8);
        float pa=fi*PI*2.0/spiralArms+yNorm*8.0+t*3.0+hash(fi*2.3)*PI*2.0;
        vec3 pp=vec3(cos(pa)*localR,py,sin(pa)*localR);
        vec3 toP=pp-ro;
        float along=dot(toP,rd);
        if(along<0.0)continue;
        vec3 closest=ro+rd*along;
        float pd=length(closest-pp);
        float zB=exp(-along*0.08);
        col+=mix(outerColor.rgb,coreColor.rgb,yNorm)*0.002/(pd*pd+0.001)*zB*bloomIntensity;
    }
    col=pow(col,vec3(0.85));
    gl_FragColor=vec4(col,1.0);
}
