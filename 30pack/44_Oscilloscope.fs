/*{
    "DESCRIPTION": "Oscilloscope display - Lissajous curves with phosphor persistence",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "freqX", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Frequency X"},
        {"NAME": "freqY", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Frequency Y"},
        {"NAME": "phaseShift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 6.28, "LABEL": "Phase"},
        {"NAME": "amplitude", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.5},
        {"NAME": "traceWidth", "TYPE": "float", "DEFAULT": 0.003, "MIN": 0.001, "MAX": 0.01},
        {"NAME": "persistence", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0, "LABEL": "Phosphor Decay"},
        {"NAME": "harmonics", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Add Harmonics"},
        {"NAME": "gridBrightness", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Graticule"},
        {"NAME": "phosphorColor", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Green/Blue Phosphor"}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
#define SAMPLES 400.0

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Phosphor color
    vec3 phosphor = mix(vec3(0.2, 0.8, 0.3), vec3(0.3, 0.5, 1.0), phosphorColor);
    
    vec3 col = vec3(0.01, 0.01, 0.02);
    
    // Graticule (oscilloscope grid)
    if (gridBrightness > 0.0) {
        vec2 grid = uv * 10.0;
        float gx = abs(fract(grid.x) - 0.5);
        float gy = abs(fract(grid.y) - 0.5);
        float gridLine = min(gx, gy);
        col += vec3(0.05, 0.08, 0.05) * smoothstep(0.02, 0.0, gridLine) * gridBrightness;
        
        // Major axes
        col += vec3(0.08, 0.12, 0.08) * smoothstep(0.005, 0.0, abs(uv.x)) * gridBrightness;
        col += vec3(0.08, 0.12, 0.08) * smoothstep(0.005, 0.0, abs(uv.y)) * gridBrightness;
        
        // Sub-divisions (dots)
        float dotGrid = min(abs(fract(grid.x * 5.0) - 0.5), abs(fract(grid.y * 5.0) - 0.5));
        float onAxis = step(abs(uv.x), 0.005) + step(abs(uv.y), 0.005);
        col += vec3(0.03) * smoothstep(0.05, 0.0, dotGrid) * gridBrightness * 0.3;
    }
    
    // Trace Lissajous curve
    float minDist = 1e10;
    float closestParam = 0.0;
    
    for (float i = 0.0; i < SAMPLES; i++) {
        float s = i / SAMPLES;
        float phase = phaseShift + t * 0.5;
        
        float x = sin(freqX * s * PI * 2.0 + phase) * amplitude;
        float y = sin(freqY * s * PI * 2.0) * amplitude;
        
        // Add harmonics
        if (harmonics > 0.0) {
            x += sin(freqX * 2.0 * s * PI * 2.0 + phase * 1.5) * amplitude * 0.2 * harmonics;
            y += sin(freqY * 3.0 * s * PI * 2.0 + 0.5) * amplitude * 0.15 * harmonics;
            x += sin(freqX * 0.5 * s * PI * 2.0 + phase * 0.7) * amplitude * 0.1 * harmonics;
        }
        
        vec2 point = vec2(x, y);
        float d = length(uv - point);
        
        if (d < minDist) {
            minDist = d;
            closestParam = s;
        }
    }
    
    // Beam trace with phosphor persistence
    float beam = traceWidth / (minDist + traceWidth * 0.3);
    
    // Persistence fade based on how "old" the trace is
    float age = fract(closestParam - fract(t * 0.5));
    float persistFade = pow(1.0 - age, (1.0 - persistence) * 5.0 + 0.5);
    
    // Bright head
    float head = exp(-age * age / 0.001) * 3.0;
    
    col += phosphor * beam * (persistFade + head) * 0.15;
    
    // Bloom / glow halo
    float bloom = traceWidth * 5.0 / (minDist + traceWidth * 2.0);
    col += phosphor * 0.3 * bloom * (persistFade + head) * 0.02;
    
    // Screen curvature darkening
    float screenDist = length(uv * 1.5);
    col *= 1.0 - screenDist * 0.2;
    
    // Scanline effect
    col *= 0.95 + 0.05 * sin(gl_FragCoord.y * 3.0);
    
    gl_FragColor = vec4(col, 1.0);
}
