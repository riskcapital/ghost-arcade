/*{
    "DESCRIPTION": "Recursive Shattered Lattice - nested rotating squares with triangular shards and particle scatter",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "recursionDepth", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "baseSize", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.5},
        {"NAME": "rotationPerLevel", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "shrinkRatio", "TYPE": "float", "DEFAULT": 0.72, "MIN": 0.5, "MAX": 0.9},
        {"NAME": "shardCount", "TYPE": "float", "DEFAULT": 30.0, "MIN": 5.0, "MAX": 60.0},
        {"NAME": "shardSpread", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.2, "MAX": 1.0},
        {"NAME": "particleDensity", "TYPE": "float", "DEFAULT": 50.0, "MIN": 10.0, "MAX": 100.0},
        {"NAME": "lineGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "diagonals", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Cross Diagonals"},
        {"NAME": "shardRotation", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "connectLines", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Inter-level Links"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n)*43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

mat2 rot(float a) { float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

float lineSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa=p-a, ba=b-a;
    float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    return length(pa-ba*h);
}

float triangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    float d = min(lineSeg(p,a,b), min(lineSeg(p,b,c), lineSeg(p,c,a)));
    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    float w = 0.0008 * lineGlow;
    
    // === NESTED ROTATING SQUARES ===
    vec2 prevCorners[4];
    
    for (float level = 0.0; level < 10.0; level++) {
        if (level >= recursionDepth) break;
        
        float size = baseSize * pow(shrinkRatio, level);
        float angle = level * rotationPerLevel + t * (0.05 + level * 0.01);
        float opacity = 0.5 - level * 0.03;
        
        // 4 corners of rotated square
        vec2 corners[4];
        for (int i = 0; i < 4; i++) {
            float ca = float(i) * PI * 0.5 + PI * 0.25 + angle;
            corners[i] = size * sqrt(2.0) * vec2(cos(ca), sin(ca));
        }
        
        // Draw square edges
        for (int i = 0; i < 4; i++) {
            int j = (i+1) < 4 ? i+1 : 0;
            float ld = lineSeg(uv, corners[i], corners[j]);
            col += w / (ld + w) * opacity;
        }
        
        // Diagonals
        if (diagonals > 0.0) {
            float d1 = lineSeg(uv, corners[0], corners[2]);
            float d2 = lineSeg(uv, corners[1], corners[3]);
            col += w*0.5 / (d1 + w*2.0) * diagonals * opacity * 0.4;
            col += w*0.5 / (d2 + w*2.0) * diagonals * opacity * 0.4;
        }
        
        // Inter-level connections
        if (connectLines > 0.0 && level > 0.0) {
            for (int i = 0; i < 4; i++) {
                float ld = lineSeg(uv, prevCorners[i], corners[i]);
                col += w*0.3 / (ld + w*3.0) * connectLines * opacity * 0.3;
            }
        }
        
        // Corner nodes
        for (int i = 0; i < 4; i++) {
            float nd = length(uv - corners[i]);
            col += 0.0003 / (nd*nd + 0.00003) * opacity * 0.05;
            prevCorners[i] = corners[i];
        }
    }
    
    // === TRIANGULAR SHARDS (debris) ===
    for (float i = 0.0; i < 60.0; i++) {
        if (i >= shardCount) break;
        
        float h1 = hash(i*1.7+0.3);
        float h2 = hash(i*2.3+7.1);
        float h3 = hash(i*3.1+1.3);
        float h4 = hash(i*5.3+3.7);
        
        // Position scattered around
        vec2 center = vec2(
            (h1-0.5) * 1.4 * shardSpread,
            (h2-0.5) * 1.0 * shardSpread
        );
        center += vec2(sin(t*0.2+i), cos(t*0.15+i*1.3)) * 0.02;
        
        float shardSize = 0.01 + h3 * 0.03;
        float shardAngle = h4 * PI * 2.0 + t * shardRotation * (h1-0.5);
        
        // Triangle vertices
        vec2 tv[3];
        for (int v = 0; v < 3; v++) {
            float va = float(v) * PI * 2.0 / 3.0 + shardAngle;
            float vr = shardSize * (0.5 + hash(i*7.0+float(v)) * 0.8); // Irregular
            tv[v] = center + vr * vec2(cos(va), sin(va));
        }
        
        float td = triangle(uv, tv[0], tv[1], tv[2]);
        float shardAlpha = 0.2 + h3 * 0.3;
        col += w*0.8 / (td + w*1.5) * shardAlpha;
    }
    
    // === SCATTERED PARTICLES (star-like) ===
    for (float i = 0.0; i < 100.0; i++) {
        if (i >= particleDensity) break;
        
        float h1 = hash(i*1.3+100.0);
        float h2 = hash(i*2.7+200.0);
        float h3 = hash(i*4.1+300.0);
        
        vec2 pos = vec2(
            (h1-0.5) * 1.6,
            (h2-0.5) * 1.2
        );
        pos += vec2(sin(t*0.1+i*0.5), cos(t*0.08+i*0.7)) * 0.01;
        
        float pd = length(uv - pos);
        float bright = h3 * 0.5 + 0.3;
        col += bright * 0.0002 / (pd*pd + 0.00003);
    }
    
    col = min(col, 1.0);
    gl_FragColor = vec4(vec3(col), 1.0);
}
