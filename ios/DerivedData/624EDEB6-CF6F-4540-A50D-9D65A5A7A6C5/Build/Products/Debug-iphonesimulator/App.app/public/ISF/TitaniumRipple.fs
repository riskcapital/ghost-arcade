/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Titanium surface with rippling metallic reflections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "rippleScale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0},
        {"NAME": "metalness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.9},
        {"NAME": "roughness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.1},
        {"NAME": "anisotropy", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float ripple(vec2 p, float t) {
    float d = length(p);
    return sin(d * rippleScale - t * 2.0) * exp(-d * 0.3);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Create multiple ripple sources
    float r = 0.0;
    r += ripple(uv - vec2(0.3, 0.2), t);
    r += ripple(uv + vec2(0.2, 0.3), t * 1.1);
    r += ripple(uv - vec2(-0.25, 0.15), t * 0.9);
    r *= 0.3;

    // Anisotropic brushed metal texture
    float brushed = snoise(vec2(uv.x * 50.0, uv.y * 3.0 + t * 0.5)) * anisotropy * 0.1;

    // Calculate normals from ripples
    float eps = 0.01;
    float rx = ripple(uv + vec2(eps, 0.0), t) - ripple(uv - vec2(eps, 0.0), t);
    float ry = ripple(uv + vec2(0.0, eps), t) - ripple(uv - vec2(0.0, eps), t);
    vec3 normal = normalize(vec3(-rx * 2.0, -ry * 2.0, 0.3 + roughness));

    // Add brushed texture to normal
    normal.x += brushed;
    normal = normalize(normal);

    // Lighting
    vec3 light1 = normalize(vec3(0.5, 0.5, 1.0));
    vec3 light2 = normalize(vec3(-0.3, 0.2, 0.8));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float diff = max(dot(normal, light1), 0.0);
    float diff2 = max(dot(normal, light2), 0.0) * 0.3;

    float spec1 = pow(max(dot(reflect(-light1, normal), viewDir), 0.0), 64.0 * (1.0 - roughness));
    float spec2 = pow(max(dot(reflect(-light2, normal), viewDir), 0.0), 32.0 * (1.0 - roughness));

    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

    // Titanium color with subtle iridescence
    vec3 baseColor = hsv2rgb(vec3(hue + r * 0.05, saturation, 0.85));
    vec3 titanium = mix(vec3(0.75, 0.78, 0.82), baseColor, saturation * 2.0);

    // Combine
    vec3 col = titanium * (0.2 + diff * 0.5 + diff2);
    col += vec3(1.0) * spec1 * metalness;
    col += vec3(0.9, 0.95, 1.0) * spec2 * metalness * 0.5;
    col += titanium * fresnel * 0.4;

    // Subtle environment reflection
    float env = snoise(normal.xy * 3.0 + t * 0.2) * 0.5 + 0.5;
    col += titanium * env * metalness * 0.15;

    gl_FragColor = vec4(col, 1.0);
}
