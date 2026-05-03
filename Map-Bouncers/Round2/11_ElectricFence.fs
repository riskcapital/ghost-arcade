/*{
    "DESCRIPTION": "Electric arcs jumping between opposite frame edges with crackling energy",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "arcCount", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "arcWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.006},
        {"NAME": "jitter", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.08},
        {"NAME": "speed", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "arcColor", "TYPE": "color", "DEFAULT": [0.5, 0.7, 1.0, 1.0]},
        {"NAME": "coreColor", "TYPE": "color", "DEFAULT": [0.9, 0.95, 1.0, 1.0]},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

float lightning(vec2 uv, float yBase, float seed, float t) {
    float offset = 0.0;
    float amp = jitter;
    float freq = 3.0;
    for (int i = 0; i < 6; i++) {
        offset += (noise(vec2(uv.x * freq + seed * 100.0, t * speed + seed * 50.0 + float(i) * 7.0)) - 0.5) * amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    float dist = abs(uv.y - yBase - offset);
    return dist;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME;
    vec3 col = vec3(0.005, 0.005, 0.015);
    int count = int(arcCount);
    
    // Horizontal arcs (left to right)
    for (int i = 0; i < 4; i++) {
        if (i >= count / 2 + 1) break;
        float id = float(i);
        float yBase = (id + 1.0) / (float(count / 2 + 1) + 1.0);
        float dist = lightning(uv, yBase, id, t);
        
        float flicker = 0.5 + 0.5 * step(0.3, hash(vec2(floor(t * 15.0), id)));
        float core = smoothstep(arcWidth, arcWidth * 0.1, dist) * flicker;
        float glow = smoothstep(arcWidth * 8.0, arcWidth * 0.5, dist) * flicker * 0.3;
        
        col += coreColor.rgb * core;
        col += arcColor.rgb * glow;
        
        // Branch arcs
        float branchSeed = hash(vec2(id, floor(t * 3.0)));
        if (branchSeed > 0.5) {
            float bx = fract(branchSeed * 7.0) * 0.6 + 0.2;
            if (abs(uv.x - bx) < 0.15) {
                float bDist = lightning(vec2(uv.y, uv.x), bx, id + 10.0, t);
                col += arcColor.rgb * smoothstep(arcWidth * 2.0, arcWidth * 0.3, bDist) * flicker * 0.3;
            }
        }
    }
    
    // Vertical arcs (top to bottom)
    for (int i = 0; i < 4; i++) {
        if (i >= (count + 1) / 2) break;
        float id = float(i) + 10.0;
        float xBase = (float(i) + 1.0) / (float((count + 1) / 2) + 1.0);
        vec2 rotUV = vec2(uv.y, uv.x);
        float dist = lightning(rotUV, xBase, id, t);
        
        float flicker = 0.5 + 0.5 * step(0.4, hash(vec2(floor(t * 12.0), id)));
        float core = smoothstep(arcWidth, arcWidth * 0.1, dist) * flicker;
        float glow = smoothstep(arcWidth * 8.0, arcWidth * 0.5, dist) * flicker * 0.3;
        
        col += coreColor.rgb * core;
        col += arcColor.rgb * glow;
    }
    
    // Edge glow
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float eGlow = smoothstep(0.04, 0.0, eDist) * edgeGlow;
    float ePulse = 0.5 + 0.5 * sin(TIME * 10.0 + uv.x * 20.0 + uv.y * 20.0);
    col += arcColor.rgb * eGlow * ePulse;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
