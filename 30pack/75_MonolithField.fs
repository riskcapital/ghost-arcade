/*{"DESCRIPTION":"Monolith Field - floating black slabs with edge illumination","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.15,"MIN":0.0,"MAX":0.5},{"NAME":"monolithCount","TYPE":"float","DEFAULT":12.0,"MIN":3.0,"MAX":20.0},{"NAME":"slabWidth","TYPE":"float","DEFAULT":0.15,"MIN":0.05,"MAX":0.3},{"NAME":"slabHeight","TYPE":"float","DEFAULT":0.6,"MIN":0.2,"MAX":1.2},{"NAME":"slabDepth","TYPE":"float","DEFAULT":0.02,"MIN":0.005,"MAX":0.05},{"NAME":"edgeColor","TYPE":"color","DEFAULT":[0.3,0.5,1.0,1.0]},{"NAME":"spread","TYPE":"float","DEFAULT":1.5,"MIN":0.5,"MAX":3.0},{"NAME":"edgeGlow","TYPE":"float","DEFAULT":2.0,"MIN":0.0,"MAX":5.0},{"NAME":"levitation","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"cameraOrbit","TYPE":"float","DEFAULT":0.2,"MIN":0.0,"MAX":1.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
float hash(float n){return fract(sin(n)*43758.5453);}
float sdBox(vec3 p,vec3 b){vec3 d=abs(p)-b;return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float scene(vec3 p,float t){
    float d=1e10;
    for(float i=0.0;i<20.0;i++){
        if(i>=monolithCount)break;
        float fi=i;
        vec3 sp=vec3((hash(fi*1.7)-0.5)*spread*2.0,
                     sin(t*0.3+fi*1.1)*levitation,
                     (hash(fi*3.1+9.0)-0.5)*spread*2.0);
        vec3 lp=p-sp;
        float ra=hash(fi*5.3)*3.14+t*0.05*(hash(fi*7.1)-0.5);
        lp.xz*=rot(ra);
        float h=slabHeight*(0.5+hash(fi*2.3)*0.5);
        float w=slabWidth*(0.5+hash(fi*4.1)*0.5);
        d=min(d,sdBox(lp,vec3(w,h,slabDepth)));
    }
    // Ground plane
    d=min(d,p.y+1.0);
    return d;
}
vec3 getNormal(vec3 p,float t){vec2 e=vec2(0.001,0.0);return normalize(vec3(scene(p+e.xyy,t)-scene(p-e.xyy,t),scene(p+e.yxy,t)-scene(p-e.yxy,t),scene(p+e.yyx,t)-scene(p-e.yyx,t)));}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*cameraOrbit;
    vec3 ro=vec3(sin(ca)*3.5,0.8+sin(t*0.15)*0.3,cos(ca)*3.5);
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.008,0.005,0.015);
    float td=0.0;float glow=0.0;
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p,t);
        glow+=exp(-d*8.0)*0.008;
        if(d<0.001){
            vec3 n=getNormal(p,t);
            vec3 ld=normalize(vec3(0.3,0.8,0.5));
            float diff=max(dot(n,ld),0.0);
            float spec=pow(max(dot(reflect(-ld,n),-rd),0.0),64.0);
            float fresnel=pow(1.0-abs(dot(n,-rd)),4.0);
            // Nearly black material with edge light
            vec3 matCol=vec3(0.015);
            float isGround=1.0-step(0.01,p.y+0.99);
            matCol=mix(matCol,vec3(0.02,0.02,0.03),isGround);
            col=matCol*(diff*0.3+0.05);
            col+=edgeColor.rgb*fresnel*edgeGlow*0.2;
            col+=vec3(0.8,0.85,1.0)*spec*0.3;
            // Ground reflection
            if(isGround>0.5){
                col+=edgeColor.rgb*0.02*fresnel;
            }
            float fog=1.0-exp(-td*0.05);
            col=mix(col,vec3(0.005,0.003,0.01),fog);
            break;
        }
        td+=d;if(td>25.0)break;
    }
    col+=edgeColor.rgb*glow*edgeGlow*0.15;
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
