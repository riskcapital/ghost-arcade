/*{"DESCRIPTION":"Infinite Staircase - Escher-like impossible geometry","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.25,"MIN":0.0,"MAX":1.0},{"NAME":"stairWidth","TYPE":"float","DEFAULT":0.8,"MIN":0.3,"MAX":1.5},{"NAME":"stepHeight","TYPE":"float","DEFAULT":0.15,"MIN":0.05,"MAX":0.3},{"NAME":"stepDepth","TYPE":"float","DEFAULT":0.2,"MIN":0.1,"MAX":0.4},{"NAME":"lightColor","TYPE":"color","DEFAULT":[0.4,0.5,1.0,1.0]},{"NAME":"ambientColor","TYPE":"color","DEFAULT":[0.03,0.02,0.06,1.0]},{"NAME":"fogDensity","TYPE":"float","DEFAULT":0.05,"MIN":0.0,"MAX":0.15},{"NAME":"cameraPath","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":2.0},{"NAME":"edgeLight","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"spiralTightness","TYPE":"float","DEFAULT":1.0,"MIN":0.3,"MAX":2.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float sdBox(vec3 p,vec3 b){vec3 d=abs(p)-b;return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0);}
float scene(vec3 p){
    float rep=stepDepth;
    // Spiral staircase
    float angle=atan(p.z,p.x);
    float r=length(p.xz);
    // Height increases with angle
    float expectedY=angle/(PI*2.0)*stepHeight*16.0*spiralTightness;
    float localY=p.y-expectedY;
    localY=mod(localY+stepHeight*0.5,stepHeight)-stepHeight*0.5;
    // Step as box
    float step=sdBox(vec3(r-stairWidth*0.5,localY,0.0),vec3(stairWidth*0.5,stepHeight*0.4,stepDepth*0.4));
    // Inner column
    float column=length(p.xz)-0.1;
    // Outer wall
    float wall=-(length(p.xz)-stairWidth-0.05);
    wall=max(wall,length(p.xz)-stairWidth-0.1);
    return min(step,min(max(column,-0.5),wall));
}
vec3 getNormal(vec3 p){vec2 e=vec2(0.001,0.0);return normalize(vec3(scene(p+e.xyy)-scene(p-e.xyy),scene(p+e.yxy)-scene(p-e.yxy),scene(p+e.yyx)-scene(p-e.yyx)));}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    // Camera ascending the staircase
    float camAngle=t*cameraPath;
    float camY=camAngle/(PI*2.0)*stepHeight*16.0*spiralTightness;
    float camR=stairWidth*0.5;
    vec3 ro=vec3(cos(camAngle)*camR,camY+0.3,sin(camAngle)*camR);
    vec3 lookAt=vec3(cos(camAngle+0.5)*camR,camY+0.5,sin(camAngle+0.5)*camR);
    vec3 ww=normalize(lookAt-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 rd=normalize(uv.x*uu+uv.y*vv+1.5*ww);
    vec3 col=vec3(0.0);
    float td=0.0;float glow=0.0;
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p);
        glow+=exp(-d*8.0)*0.005;
        if(d<0.001){
            vec3 n=getNormal(p);
            // Edge lighting from above
            vec3 ld=normalize(vec3(0.0,1.0,0.0));
            float diff=max(dot(n,ld),0.0);
            float spec=pow(max(dot(reflect(-ld,n),-rd),0.0),32.0);
            float fresnel=pow(1.0-abs(dot(n,-rd)),3.0);
            col=ambientColor.rgb+lightColor.rgb*(diff*0.4+spec*0.2+fresnel*edgeLight*0.1);
            float fog=1.0-exp(-td*fogDensity);
            col=mix(col,ambientColor.rgb,fog);
            break;
        }
        td+=d;if(td>30.0)break;
    }
    col+=lightColor.rgb*glow*edgeLight*0.3;
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
