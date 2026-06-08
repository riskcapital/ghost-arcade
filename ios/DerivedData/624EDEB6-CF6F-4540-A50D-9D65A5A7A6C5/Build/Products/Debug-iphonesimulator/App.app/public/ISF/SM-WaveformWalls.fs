/*{
    "DESCRIPTION": "Animated waveforms that emanate from and bounce between frame edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "waveCount", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.05, "MAX": 0.4, "DEFAULT": 0.15},
        {"NAME": "frequency", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.2, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.015, "DEFAULT": 0.005},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.7, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0]},
        {"NAME": "mirrorMode", "TYPE": "bool", "DEFAULT": true}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    vec3 col = vec3(0.01);
    int count = int(waveCount);
    
    // Horizontal waves from edges
    for (int i = 0; i < 6; i++) {
        if (i >= count) break;
        float id = float(i);
        float yBase = (id + 1.0) / (float(count) + 1.0);
        
        float wave = 0.0;
        wave += sin(uv.x * frequency * 6.2832 + t * 3.0 + id * 2.0) * amplitude;
        wave += sin(uv.x * frequency * 2.5 * 6.2832 - t * 2.0 + id * 1.5) * amplitude * 0.3;
        wave += sin(uv.x * frequency * 0.5 * 6.2832 + t * 1.5 + id * 3.0) * amplitude * 0.5;
        
        // Bounce wave: reflect amplitude at edges
        float edgeDampL = smoothstep(0.0, 0.1, uv.x);
        float edgeDampR = smoothstep(1.0, 0.9, uv.x);
        float edgeDamp = edgeDampL * edgeDampR;
        
        // Wave increases near edges
        float edgeBoost = 1.0 + (1.0 - edgeDamp) * 0.5;
        wave *= edgeBoost;
        
        float waveY = yBase + wave;
        float dist = abs(uv.y - waveY);
        
        float line = smoothstep(lineWidth, lineWidth * 0.2, dist);
        float glow = smoothstep(lineWidth * 8.0, lineWidth, dist) * 0.2;
        
        float blend = uv.x + id * 0.15;
        vec3 waveCol = mix(colorA.rgb, colorB.rgb, fract(blend));
        
        col += waveCol * (line + glow);
        
        // Mirror wave
        if (mirrorMode) {
            float mirrorY = (1.0 - yBase) - wave * 0.5;
            float mirrorDist = abs(uv.y - mirrorY);
            float mirrorLine = smoothstep(lineWidth * 1.5, lineWidth * 0.5, mirrorDist) * 0.3;
            col += waveCol * mirrorLine * 0.4;
        }
    }
    
    // Vertical wave accents from top/bottom edges
    for (int i = 0; i < 3; i++) {
        float id = float(i);
        float xBase = (id + 1.0) / 4.0;
        float wave = sin(uv.y * frequency * 4.0 + t * 2.5 + id * 3.0) * amplitude * 0.5;
        float waveX = xBase + wave;
        float dist = abs(uv.x - waveX);
        float line = smoothstep(lineWidth * 0.7, lineWidth * 0.1, dist) * 0.3;
        col += mix(colorA.rgb, colorB.rgb, 0.5) * line;
    }
    
    // Edge pulse
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float ePulse = sin(TIME * 4.0) * 0.5 + 0.5;
    col += mix(colorA.rgb, colorB.rgb, ePulse) * smoothstep(0.02, 0.0, eDist) * 0.2;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
