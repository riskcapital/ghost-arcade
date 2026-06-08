/*{
    "CREDIT": "ChatGPT",
    "DESCRIPTION": "Fluid Melt Geometry in Z-space — 3D noise warp + kaleidoscopic geometry melting over time (fixed swizzle)",
    "CATEGORIES": [ "generator" ],
    "INPUTS": [
        { "NAME": "speed",      "TYPE": "float", "MIN": 0.0, "MAX": 3.0,  "DEFAULT": 1.0 },
        { "NAME": "scale",      "TYPE": "float", "MIN": 0.5, "MAX": 10.0, "DEFAULT": 3.0 },
        { "NAME": "meltIntensity","TYPE": "float","MIN": 0.0, "MAX": 2.0,  "DEFAULT": 0.8 },
        { "NAME": "depthSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0,  "DEFAULT": 0.5 }
    ]
}*/

#define PI     3.141592653589793
#define TWO_PI (2.0 * PI)
const int OCTAVES = 4;

float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.11369, 0.13787));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p), u = f*f*(3.0 - 2.0*f);
    float n000 = hash3(i + vec3(0.0));
    float n100 = hash3(i + vec3(1.0,0.0,0.0));
    float n010 = hash3(i + vec3(0.0,1.0,0.0));
    float n110 = hash3(i + vec3(1.0,1.0,0.0));
    float n001 = hash3(i + vec3(0.0,0.0,1.0));
    float n101 = hash3(i + vec3(1.0,0.0,1.0));
    float n011 = hash3(i + vec3(0.0,1.0,1.0));
    float n111 = hash3(i + vec3(1.0,1.0,1.0));
    float nx00 = mix(n000,n100,u.x), nx10 = mix(n010,n110,u.x);
    float nx01 = mix(n001,n101,u.x), nx11 = mix(n011,n111,u.x);
    float nxy0 = mix(nx00,nx10,u.y), nxy1 = mix(nx01,nx11,u.y);
    return mix(nxy0, nxy1, u.z);
}

float fbm3(vec3 p) {
    float v = 0.0, a = 0.6;
    for(int i=0; i<OCTAVES; i++){
        v += a * noise3(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

vec2 hex(vec2 p) {
    float q = (p.x*2.0 + p.y)/sqrt(3.0);
    float r = p.y*2.0/3.0;
    vec2 f = fract(vec2(q, r)) - 0.5;
    return f;
}

void main() {
    vec2 uv = gl_FragCoord.xy/RENDERSIZE.xy;
    vec2 c = uv*2.0 - 1.0;
    c.x *= RENDERSIZE.x/RENDERSIZE.y;

    float t = TIME * speed;
    vec3 pos = vec3(c*scale, t*depthSpeed);

    vec3 warp = pos + meltIntensity * vec3(
        fbm3(pos + vec3(1.0,0.0,0.0)),
        fbm3(pos + vec3(0.0,1.0,0.0)),
        fbm3(pos + vec3(0.0,0.0,1.0))
    );

    vec2 wuv = warp.xy;
    vec2 h = hex(wuv);
    float grid = smoothstep(0.45, 0.48, length(h));
    float rmask = length(c);
    float bloom = smoothstep(0.5, 0.0, rmask - 0.2*sin(t*0.5));
    float pattern = mix(grid, bloom, 0.6 + 0.4 * fbm3(warp*0.5));

    // --- FIXED HSV → RGB ---
    float hue = fract(fbm3(warp*0.8) + t*0.1);
    float sat = 0.8, val = pattern;
    // Use a vec4 so .www is valid:
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p1 = abs(fract(vec3(hue) + K.xyz)*6.0 - K.www);
    vec3 rgb = val * mix(vec3(K.x), clamp(p1 - vec3(K.x), 0.0, 1.0), sat);

    float vig = smoothstep(0.7, 1.0, rmask);
    gl_FragColor = vec4(rgb * (1.0 - vig), 1.0);
}
