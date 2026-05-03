/*{
    "DESCRIPTION": "Interference hologram - layered sine wave holographic display",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "waveLayers", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "baseFreq", "TYPE": "float", "DEFAULT": 15.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "freqSpread", "TYPE": "float", "DEFAULT": 1.3, "MIN": 1.0, "MAX": 2.0, "LABEL": "Frequency Ratio"},
        {"NAME": "waveAmplitude", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.8},
        {"NAME": "phaseMode", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Radial/Linear"},
        {"NAME": "chromatic", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Chromatic Split"},
        {"NAME": "scanlineFreq", "TYPE": "float", "DEFAULT": 200.0, "MIN": 50.0, "MAX": 500.0},
        {"NAME": "glitchAmount", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "exposure", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Glitch displacement
    float glitch = 0.0;
    if (glitchAmount > 0.0) {
        float glitchLine = floor(uv.y * 50.0);
        float glitchTrigger = step(0.95 - glitchAmount * 0.3, hash(vec2(glitchLine, floor(t * 3.0))));
        glitch = (hash(vec2(glitchLine, floor(t * 10.0))) - 0.5) * 0.1 * glitchTrigger * glitchAmount;
    }
    
    vec3 col = vec3(0.0);
    
    // Three color channels with chromatic offset
    for (float ch = 0.0; ch < 3.0; ch++) {
        float chromOffset = (ch - 1.0) * chromatic * 0.01;
        vec2 chUV = uv + vec2(glitch + chromOffset, 0.0);
        
        float interference = 0.0;
        
        for (float layer = 0.0; layer < 10.0; layer++) {
            if (layer >= waveLayers) break;
            
            float freq = baseFreq * pow(freqSpread, layer);
            float phase = t * (1.0 + layer * 0.3) + layer * 0.7;
            float layerAmp = waveAmplitude / (1.0 + layer * 0.5);
            
            float wave;
            if (phaseMode < 0.5) {
                // Radial waves
                float d = length(chUV);
                wave = sin(d * freq - phase) * layerAmp;
            } else {
                // Linear waves with rotation
                float angle = layer * PI / waveLayers;
                vec2 dir = vec2(cos(angle), sin(angle));
                wave = sin(dot(chUV, dir) * freq - phase) * layerAmp;
            }
            
            // Mix radial and linear
            float d = length(chUV);
            float radial = sin(d * freq - phase) * layerAmp;
            float angle = layer * PI / waveLayers;
            vec2 dir = vec2(cos(angle), sin(angle));
            float linear = sin(dot(chUV, dir) * freq - phase) * layerAmp;
            
            wave = mix(linear, radial, phaseMode);
            interference += wave;
        }
        
        // Normalize
        interference = interference / waveLayers * 2.0;
        interference = 0.5 + 0.5 * interference;
        interference = pow(interference, 1.5) * exposure;
        
        if (ch < 0.5) col.r = interference;
        else if (ch < 1.5) col.g = interference;
        else col.b = interference;
    }
    
    // Tint
    col *= vec3(0.6, 0.7, 1.0);
    
    // Holographic scanlines
    float scan = 0.5 + 0.5 * sin(gl_FragCoord.y / RENDERSIZE.y * scanlineFreq * PI);
    col *= 0.85 + 0.15 * scan;
    
    // Subtle horizontal line artifacts
    float hLine = step(0.98, hash(vec2(floor(uv.y * 200.0), floor(t * 2.0))));
    col += vec3(0.3, 0.4, 0.8) * hLine * 0.2 * glitchAmount;
    
    gl_FragColor = vec4(col, 1.0);
}
