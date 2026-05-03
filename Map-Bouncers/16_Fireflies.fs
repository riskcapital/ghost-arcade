/*{
    "DESCRIPTION": "Glowing firefly particles drifting softly, bouncing gently off frame edges",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "fireflyCount", "TYPE": "float", "MIN": 10.0, "MAX": 60.0, "DEFAULT": 30.0},
        {"NAME": "glowRadius", "TYPE": "float", "MIN": 0.01, "MAX": 0.08, "DEFAULT": 0.035},
        {"NAME": "driftSpeed", "TYPE": "float", "MIN": 0.05, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "pulseRate", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "warmColor", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.2, 1.0]},
        {"NAME": "coolColor", "TYPE": "color", "DEFAULT": [0.2, 0.8, 0.5, 1.0]},
        {"NAME": "trailAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.005, 0.008, 0.015);
    int count = int(fireflyCount);
    
    for (int i = 0; i < 60; i++) {
        if (i >= count) break;
        float id = float(i);
        float t = TIME * driftSpeed;
        
        // Organic drift paths that bounce off edges
        float px = hash(id * 127.1);
        float py = hash(id * 311.7);
        float vx1 = sin(id * 1.7 + t * (0.3 + hash(id * 73.1) * 0.2));
        float vy1 = cos(id * 2.3 + t * (0.25 + hash(id * 47.3) * 0.15));
        float vx2 = sin(id * 3.1 + t * 0.15) * 0.3;
        float vy2 = cos(id * 4.7 + t * 0.12) * 0.25;
        
        float x = abs(fract((px + (vx1 + vx2) * 0.15) * 0.5) * 2.0 - 1.0) * 0.9 + 0.05;
        float y = abs(fract((py + (vy1 + vy2) * 0.15) * 0.5) * 2.0 - 1.0) * 0.9 + 0.05;
        
        // Pulsing glow
        float pulsePhase = hash(id * 269.5) * 6.2832;
        float pulse = pow(sin(TIME * pulseRate + pulsePhase) * 0.5 + 0.5, 3.0);
        
        vec2 pos = vec2(x, y);
        vec2 diff = (uv - pos) * vec2(aspect, 1.0);
        float dist = length(diff);
        
        float glow = glowRadius * pulse / (dist + 0.001);
        glow = clamp(glow * 0.08, 0.0, 1.0);
        
        // Color varies per firefly
        float colorMix = hash(id * 183.7);
        vec3 ffColor = mix(warmColor.rgb, coolColor.rgb, colorMix);
        
        col += ffColor * glow;
        
        // Core
        float core = smoothstep(0.005, 0.001, dist) * pulse;
        col += ffColor * core * 0.5;
        col += vec3(core * 0.3);
        
        // Trail
        if (trailAmount > 0.01) {
            for (int ti = 1; ti <= 5; ti++) {
                float tOff = float(ti) * 0.003;
                float tx = abs(fract((px + ((vx1 - tOff * 10.0) + vx2) * 0.15) * 0.5) * 2.0 - 1.0) * 0.9 + 0.05;
                float ty = abs(fract((py + ((vy1 - tOff * 10.0) + vy2) * 0.15) * 0.5) * 2.0 - 1.0) * 0.9 + 0.05;
                vec2 tDiff = (uv - vec2(tx, ty)) * vec2(aspect, 1.0);
                float tDist = length(tDiff);
                float tGlow = glowRadius * 0.3 * pulse / (tDist + 0.001);
                float fade = 1.0 - float(ti) / 6.0;
                col += ffColor * clamp(tGlow * 0.02, 0.0, 0.2) * trailAmount * fade;
            }
        }
    }
    
    // Subtle ambient from edges
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += warmColor.rgb * smoothstep(0.05, 0.0, eDist) * 0.02;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
