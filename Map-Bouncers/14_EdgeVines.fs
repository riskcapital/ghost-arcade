/*{
    "DESCRIPTION": "Organic vines growing along and from the frame edges inward",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "growthSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "vineWidth", "TYPE": "float", "MIN": 0.003, "MAX": 0.02, "DEFAULT": 0.008},
        {"NAME": "branchDensity", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "vineColor", "TYPE": "color", "DEFAULT": [0.1, 0.8, 0.3, 1.0]},
        {"NAME": "flowerColor", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.5, 1.0]},
        {"NAME": "depth", "TYPE": "float", "MIN": 0.05, "MAX": 0.4, "DEFAULT": 0.2},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4}
    ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

float vine(vec2 uv, float baseCoord, float perpCoord, float seed, float growth) {
    float wave = 0.0;
    float amp = depth * 0.5;
    for (int i = 0; i < 4; i++) {
        float freq = branchDensity * (float(i) + 1.0);
        wave += sin(baseCoord * freq + seed * 10.0 + TIME * growthSpeed * 0.5) * amp;
        amp *= 0.5;
    }
    float vinePos = wave;
    float dist = abs(perpCoord - vinePos);
    float growMask = smoothstep(growth + 0.05, growth - 0.05, baseCoord);
    return smoothstep(vineWidth, vineWidth * 0.2, dist) * growMask;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * growthSpeed;
    float growth = fract(t * 0.1) * 1.5;
    
    vec3 col = vec3(0.01, 0.015, 0.01);
    
    // Bottom edge vines (growing upward)
    for (int i = 0; i < 3; i++) {
        float seed = float(i) * 3.7;
        float v = vine(vec2(uv.x, uv.y), uv.x * 3.0, uv.y, seed, growth);
        float depthFade = smoothstep(depth * 1.5, 0.0, uv.y);
        col += vineColor.rgb * v * depthFade * 0.7;
    }
    
    // Top edge vines (growing downward)
    for (int i = 0; i < 3; i++) {
        float seed = float(i) * 5.3 + 20.0;
        float v = vine(vec2(uv.x, 1.0 - uv.y), uv.x * 3.0, 1.0 - uv.y, seed, growth);
        float depthFade = smoothstep(depth * 1.5, 0.0, 1.0 - uv.y);
        col += vineColor.rgb * v * depthFade * 0.7;
    }
    
    // Left edge vines
    for (int i = 0; i < 2; i++) {
        float seed = float(i) * 7.1 + 40.0;
        float v = vine(vec2(uv.y, uv.x), uv.y * 3.0, uv.x, seed, growth);
        float depthFade = smoothstep(depth * 1.5, 0.0, uv.x);
        col += vineColor.rgb * v * depthFade * 0.6;
    }
    
    // Right edge vines
    for (int i = 0; i < 2; i++) {
        float seed = float(i) * 11.3 + 60.0;
        float v = vine(vec2(uv.y, 1.0 - uv.x), uv.y * 3.0, 1.0 - uv.x, seed, growth);
        float depthFade = smoothstep(depth * 1.5, 0.0, 1.0 - uv.x);
        col += vineColor.rgb * v * depthFade * 0.6;
    }
    
    // Flower/node points at vine intersections
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec2 fPos = vec2(hash(vec2(fi, 1.0)) * 0.8 + 0.1, hash(vec2(fi, 2.0)) * 0.8 + 0.1);
        float edgeDist = min(min(fPos.x, 1.0 - fPos.x), min(fPos.y, 1.0 - fPos.y));
        if (edgeDist < depth) {
            float dist = length(uv - fPos);
            float bloom = sin(TIME * 2.0 + fi * 1.7) * 0.5 + 0.5;
            float flower = smoothstep(0.015, 0.005, dist) * bloom;
            col += flowerColor.rgb * flower * 0.8;
            col += flowerColor.rgb * smoothstep(0.03, 0.01, dist) * bloom * 0.2;
        }
    }
    
    // Edge glow
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += vineColor.rgb * smoothstep(0.02, 0.0, edgeDist) * glowAmount * 0.3;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
