/*{"DESCRIPTION":"Liquid Metal - raymarched metaball mercury with environment reflections","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.4,"MIN":0.0,"MAX":1.5},{"NAME":"blobCount","TYPE":"float","DEFAULT":5.0,"MIN":2.0,"MAX":8.0},{"NAME":"smoothness","TYPE":"float","DEFAULT":0.3,"MIN":0.05,"MAX":0.8},{"NAME":"reflectColor","TYPE":"color","DEFAULT":[0.3,0.4,0.8,1.0]},{"NAME":"metalColor","TYPE":"color","DEFAULT":[0.7,0.72,0.75,1.0]},{"NAME":"envRotation","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":2.0},{"NAME":"fresnelPower","TYPE":"float","DEFAULT":3.0,"MIN":1.0,"MAX":8.0},{"NAME":"specularHard","TYPE":"float","DEFAULT":64.0,"MIN":8.0,"MAX":256.0},{"NAME":"cameraOrbit","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"distortion","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
float smin(float a,float b,float k){float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);return mix(b,a,h)-k*h*(1.0-h);}
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float scene(vec3 p,float t){
    float d=1e10;
    for(float i=0.0;i<8.0;i++){
        if(i>=blobCount)break;
        float fi=i;
        vec3 bp=vec3(sin(t*0.5+fi*2.1)*0.4,sin(t*0.7+fi*1.3)*0.3,cos(t*0.3+fi*1.7)*0.4);
        float r=0.2+0.08*sin(t+fi*3.0);
        d=smin(d,length(p-bp)-r,smoothness);
    }
    // Surface distortion
    d+=noise3(p*5.0+t*0.5)*0.02*distortion;
    return d;
}
vec3 getNormal(vec3 p,float t){vec2 e=vec2(0.001,0.0);return normalize(vec3(scene(p+e.xyy,t)-scene(p-e.xyy,t),scene(p+e.yxy,t)-scene(p-e.yxy,t),scene(p+e.yyx,t)-scene(p-e.yyx,t)));}
vec3 envMap(vec3 rd,float t){
    float a=atan(rd.z,rd.x)+t*envRotation;
    float b=rd.y;
    float bands=0.5+0.5*sin(a*3.0)*sin(b*5.0);
    return mix(reflectColor.rgb*0.3,reflectColor.rgb,bands);
}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*cameraOrbit;
    vec3 ro=vec3(sin(ca)*2.5,0.5,cos(ca)*2.5);
    vec3 ta=vec3(0);
    vec3 ww=normalize(ta-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.02,0.02,0.04);
    float td=0.0;
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p,t);
        if(d<0.001){
            vec3 n=getNormal(p,t);
            vec3 refl=reflect(rd,n);
            float fresnel=pow(1.0-abs(dot(n,-rd)),fresnelPower);
            vec3 envCol=envMap(refl,t);
            vec3 ld=normalize(vec3(0.5,0.8,0.3));
            float diff=max(dot(n,ld),0.0);
            float spec=pow(max(dot(reflect(-ld,n),-rd),0.0),specularHard);
            col=metalColor.rgb*(diff*0.4+0.1);
            col+=envCol*fresnel*0.6;
            col+=vec3(1.0)*spec*0.8;
            float fog=1.0-exp(-td*0.1);
            col=mix(col,vec3(0.02,0.02,0.04),fog);
            break;
        }
        td+=d;
        if(td>20.0)break;
    }
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
