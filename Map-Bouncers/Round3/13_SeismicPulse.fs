/*{
    "DESCRIPTION": "Seismic Pulse - Shockwaves emanate from edges inward with wave interference where pulses collide",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "pulseRate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "waveWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "decayRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "edgeSources", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 4.0},
        {"NAME": "waveColor", "TYPE": "color", "DEFAULT": [0.2, 0.6, 1.0, 1.0]},
        {"NAME": "interferenceColor", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.1, 1.0]},
        {"NAME": "groundColor", "TYPE": "color", "DEFAULT": [0.05, 0.03, 0.08, 1.0]},
        {"NAME": "epicenterColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.8, 1.0]},
        {"NAME": "displacement", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float waveFromEdge(float edgeDist, float t, float rate, float width) {
    float wave = 0.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float phase = fract(t * rate * 0.2 - fi * 0.2);
        float waveFront = phase * 0.6;
        float dist = abs(edgeDist - waveFront);
        float w = width * 0.02 * (1.0 + phase);
        float pulse = exp(-dist * dist / (w * w)) * (1.0 - phase);
        wave += pulse;
    }
    return wave;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    
    // Ground with subtle texture
    float groundNoise = noise(uv * 20.0) * 0.1;
    vec3 col = groundColor.rgb * (0.8 + groundNoise);
    
    // Waves from each edge
    float totalWave = 0.0;
    float waveL = 0.0, waveR = 0.0, waveB = 0.0, waveT = 0.0;
    
    if (edgeSources >= 1.0) {
        waveL = waveFromEdge(edgeL, t, pulseRate, waveWidth);
        totalWave += waveL;
    }
    if (edgeSources >= 2.0) {
        waveR = waveFromEdge(edgeR, t + 1.5, pulseRate, waveWidth);
        totalWave += waveR;
    }
    if (edgeSources >= 3.0) {
        waveB = waveFromEdge(edgeB, t + 0.7, pulseRate, waveWidth);
        totalWave += waveB;
    }
    if (edgeSources >= 4.0) {
        waveT = waveFromEdge(edgeT, t + 2.3, pulseRate, waveWidth);
        totalWave += waveT;
    }
    
    // Interference: where waves overlap, boost intensity
    float interference = 0.0;
    interference += waveL * waveR;
    interference += waveL * waveB;
    interference += waveL * waveT;
    interference += waveR * waveB;
    interference += waveR * waveT;
    interference += waveB * waveT;
    
    // Apply waves
    col += waveColor.rgb * totalWave * 0.6;
    col += interferenceColor.rgb * interference * 1.5;
    
    // Constructive interference flash
    float constructive = step(1.5, totalWave);
    col += epicenterColor.rgb * constructive * 0.3;
    
    // UV displacement from waves
    if (displacement > 0.0) {
        vec2 grad = vec2(
            waveFromEdge(edgeL + 0.01, t, pulseRate, waveWidth) - waveFromEdge(edgeL - 0.01, t, pulseRate, waveWidth),
            waveFromEdge(edgeB + 0.01, t + 0.7, pulseRate, waveWidth) - waveFromEdge(edgeB - 0.01, t + 0.7, pulseRate, waveWidth)
        );
        float dispNoise = noise((uv + grad * displacement * 0.1) * 10.0);
        col += groundColor.rgb * dispNoise * displacement * 0.3;
    }
    
    // Edge epicenter glow
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    float epicenterGlow = exp(-edgeDist * 20.0) * 0.2;
    float pulse = sin(t * pulseRate * 3.0) * 0.5 + 0.5;
    col += epicenterColor.rgb * epicenterGlow * pulse;
    
    // Seismograph lines (horizontal reference lines)
    float gridLine = smoothstep(0.005, 0.0, abs(fract(uv.y * 20.0) - 0.5) - 0.48);
    col += waveColor.rgb * gridLine * 0.05;
    
    gl_FragColor = vec4(col, 1.0);
}
