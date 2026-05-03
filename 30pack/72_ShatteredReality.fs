/*{"DESCRIPTION":"Shattered Reality - fractured mirror planes with reflective surfaces floating in void","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.2,"MIN":0.0,"MAX":1.0},{"NAME":"shardCount","TYPE":"float","DEFAULT":15.0,"MIN":5.0,"MAX":25.0},{"NAME":"shardSize","TYPE":"float","DEFAULT":0.3,"MIN":0.1,"MAX":0.6},{"NAME":"reflectivity","TYPE":"float","DEFAULT":0.8,"MIN":0.0,"MAX":1.0},{"NAME":"edgeColor","TYPE":"color","DEFAULT":[0.4,0.6,1.0,1.0]},{"NAME":"voidColor","TYPE":"color","DEFAULT":[0.02,0.01,0.05,1.0]},{"NAME":"scatter","TYPE":"float","DEFAULT":1.0,"MIN":0.3,"MAX":2.0},{"NAME":"rotation","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"edgeGlow","TYPE":"float","DEFAULT":1.5,"MIN":0.0,"MAX":4.0},{"NAME":"cameraOrbit","TYPE":"float","DEFAULT":0.2,"MIN":0.0,"MAX":1.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(float n){return fract(sin(n)*43758.5453);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
// Plane SDF with finite extent
float sdPlane(vec3 p,vec3 n,float h,vec2 size){
    float planeDist=dot(p,n)-h;
    // Project onto plane
    vec3 onPlane=p-n*planeDist;
    // Finite bounds (approximate)
    float bounds=max(abs(dot(onPlane,vec3(1,0,0))),abs(dot(onPlane,vec3(0,1,0))))-size.x;
    return max(abs(planeDist)-0.002,bounds);
}
float scene(vec3 p,float t){
    float d=1e10;
    for(float i=0.0;i<25.0;i++){
        if(i>=shardCount)break;
        float fi=i;
        // Shard position
        vec3 sp=vec3((hash(fi*1.7)-0.5)*2.0*scatter,
                     (hash(fi*2.3+5.0)-0.5)*1.5*scatter,
                     (hash(fi*3.1+9.0)-0.5)*2.0*scatter);
        sp+=vec3(sin(t*0.2+fi),cos(t*0.15+fi*1.3),sin(t*0.1+fi*0.7))*0.1;
        vec3 lp=p-sp;
        // Rotate shard
        float ra=hash(fi*5.3)*PI*2.0+t*rotation*(hash(fi*7.1)-0.5);
        float rb=hash(fi*8.7)*PI+t*rotation*0.5*(hash(fi*4.3)-0.5);
        lp.xy*=rot(ra); lp.yz*=rot(rb);
        // Flat plane with extent
        float sz=shardSize*(0.3+hash(fi*9.1)*0.7);
        float shard=max(abs(lp.z)-0.003,max(abs(lp.x),abs(lp.y))-sz);
        d=min(d,shard);
    }
    return d;
}
vec3 getNormal(vec3 p,float t){vec2 e=vec2(0.001,0.0);return normalize(vec3(scene(p+e.xyy,t)-scene(p-e.xyy,t),scene(p+e.yxy,t)-scene(p-e.yxy,t),scene(p+e.yyx,t)-scene(p-e.yyx,t)));}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*cameraOrbit;
    vec3 ro=vec3(sin(ca)*3.0,sin(t*0.15)*0.5,cos(ca)*3.0);
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=voidColor.rgb;
    float td=0.0;float glow=0.0;
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p,t);
        glow+=exp(-d*10.0)*0.008;
        if(d<0.001){
            vec3 n=getNormal(p,t);
            vec3 refl=reflect(rd,n);
            float fresnel=pow(1.0-abs(dot(n,-rd)),3.0)*reflectivity;
            // Env reflection
            vec3 envCol=0.5+0.5*cos(6.28*(refl*0.5+vec3(0.0,0.33,0.67)));
            envCol*=edgeColor.rgb;
            vec3 ld=normalize(vec3(0.5,0.8,0.3));
            float diff=max(dot(n,ld),0.0);
            float spec=pow(max(dot(refl,ld),0.0),64.0);
            col=vec3(0.03)*(diff*0.5+0.1);
            col+=envCol*fresnel*0.5;
            col+=vec3(1.0)*spec*0.4;
            // Edge glow
            col+=edgeColor.rgb*edgeGlow*0.05;
            float fog=1.0-exp(-td*0.06);
            col=mix(col,voidColor.rgb,fog);
            break;
        }
        td+=d;if(td>20.0)break;
    }
    col+=edgeColor.rgb*glow*edgeGlow*0.3;
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
