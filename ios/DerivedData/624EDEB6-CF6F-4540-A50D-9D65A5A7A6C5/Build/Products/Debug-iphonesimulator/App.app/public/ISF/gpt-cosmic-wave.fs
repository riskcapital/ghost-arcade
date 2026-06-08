```glsl
attribute vec2 isf_vertShaderInit;

#ifdef GL_ES
precision highp float;
#endif

uniform vec2  iResolution;
uniform float iTime;
uniform float timeScale;
uniform float gridRes;
uniform float noiseScale;
uniform float connectThresh;
uniform float meltAmount;
uniform float colorIntensity;

#define MAX_RES 16
#define OCTAVES 4
#define PI 3.141592653589793

float hash3(vec3 p){
    p = fract(p * vec3(0.1031,0.11369,0.13787));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x+p.y)*p.z);
}
float noise3(vec3 p){
    vec3 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f);
    float n000 = hash3(i+vec3(0.0));
    float n100 = hash3(i+vec3(1.0,0.0,0.0));
    float n010 = hash3(i+vec3(0.0,1.0,0.0));
    float n110 = hash3(i+vec3(1.0,1.0,0.0));
    float n001 = hash3(i+vec3(0.0,0.0,1.0));
    float n101 = hash3(i+vec3(1.0,0.0,1.0));
    float n011 = hash3(i+vec3(0.0,1.0,1.0));
    float n111 = hash3(i+vec3(1.0,1.0,1.0));
    float nx00 = mix(n000,n100,u.x), nx10 = mix(n010,n110,u.x);
    float nx01 = mix(n001,n101,u.x), nx11 = mix(n011,n111,u.x);
    float nxy0 = mix(nx00,nx10,u.y), nxy1 = mix(nx01,nx11,u.y);
    return mix(nxy0,nxy1,u.z);
}
float fbm3(vec3 p){
    float v = 0.0, amp = 0.6;
    for(int i=0;i<OCTAVES;i++){
        v += amp * noise3(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return v;
}
vec3 hsv2rgb(vec3 c){
    vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx,0.0,1.0), c.y);
}
float sdSegment(vec2 p, vec2 a, vec2 b){
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    return length(pa - ba*h);
}

void main(){
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 cent = uv*2.0 - 1.0;
    cent.x *= iResolution.x / iResolution.y;
    float t = iTime * timeScale;

    float bgN = fbm3(vec3(cent * noiseScale, t*0.05));
    vec3 bgCol = hsv2rgb(vec3(bgN+0.2, colorIntensity,1.0)) * (0.5+0.5*bgN);

    int res = clamp(int(floor(gridRes+0.5)),2,MAX_RES);
    float invRes = 1.0/float(res-1);
    float netVal = 0.0;

    for(int y=0; y<MAX_RES; y++){
        if(y>=res) break;
        for(int x=0; x<MAX_RES; x++){
            if(x>=res) break;
            vec2 base = vec2(float(x),float(y))*invRes - 0.5;
            base.x *= iResolution.x/iResolution.y;
            vec3 P = vec3(base, t*0.1);
            vec3 warp = P + meltAmount * vec3(
                noise3(P+vec3(1.0,0,0)),
                noise3(P+vec3(0,1.0,0)),
                noise3(P+vec3(0,0,1.0))
            );
            vec2 A = warp.xy;

            if(x<res-1){
                vec2 nb = vec2(float(x+1),float(y))*invRes - 0.5;
                nb.x *= iResolution.x/iResolution.y;
                vec3 P2 = vec3(nb, t*0.1);
                vec3 w2 = P2 + meltAmount * vec3(
                    noise3(P2+vec3(1.0,0,0)),
                    noise3(P2+vec3(0,1.0,0)),
                    noise3(P2+vec3(0,0,1.0))
                );
                netVal += smoothstep(connectThresh,0.0,sdSegment(cent,A,w2.xy));
            }
            if(y<res-1){
                vec2 nb = vec2(float(x),float(y+1))*invRes - 0.5;
                nb.x *= iResolution.x/iResolution.y;
                vec3 P3 = vec3(nb, t*0.1);
                vec3 w3 = P3 + meltAmount * vec3(
                    noise3(P3+vec3(1.0,0,0)),
                    noise3(P3+vec3(0,1.0,0)),
                    noise3(P3+vec3(0,0,1.0))
                );
                netVal += smoothstep(connectThresh,0.0,sdSegment(cent,A,w3.xy));
            }
        }
    }

    float hue    = fract(fbm3(vec3(cent*noiseScale*0.5, t*0.08)) + t*0.1);
    vec3 netCol = hsv2rgb(vec3(hue, colorIntensity, clamp(netVal,0.0,1.0)));

    vec3 col = mix(bgCol, netCol, clamp(netVal*1.5,0.0,1.0));
    gl_FragColor = vec4(col,1.0);
}
```