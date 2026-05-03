/*{
    "DESCRIPTION": "Holographic interference - moiré patterns with rotating layered grids",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "gridLayers", "TYPE": "float", "DEFAULT": 3.0, "MIN": 2.0, "MAX": 6.0},
        {"NAME": "gridFrequency", "TYPE": "float", "DEFAULT": 30.0, "MIN": 10.0, "MAX": 80.0},
        {"NAME": "rotationOffset", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5, "LABEL": "Layer Offset Angle"},
        {"NAME": "gridType", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Lines/Circles"},
        {"NAME": "warp", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Spatial Warp"},
        {"NAME": "contrast", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "colorSeparation", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Chromatic Spread"},
        {"NAME": "centerPull", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Radial Distortion"},
        {"NAME": "invert", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }

float gridPattern(vec2 p, float freq, float type) {
    if (type < 0.5) {
        // Line grid
        return 0.5 + 0.5 * sin(p.x * freq);
    } else {
        // Circular grid
        return 0.5 + 0.5 * sin(length(p) * freq);
    }
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Spatial warp
    float d = length(uv);
    vec2 warpedUV = uv;
    if (warp > 0.0) {
        float warpAmount = sin(d * 10.0 - t * 2.0) * warp * 0.05;
        warpedUV += normalize(uv + 0.001) * warpAmount;
    }
    if (centerPull > 0.0) {
        warpedUV += normalize(uv + 0.001) * d * d * centerPull * 0.5;
    }
    
    // Chromatic separation
    vec3 col = vec3(0.0);
    
    for (float ch = 0.0; ch < 3.0; ch++) {
        float chromOffset = (ch - 1.0) * colorSeparation * 0.005;
        vec2 chromUV = warpedUV + vec2(chromOffset);
        
        float interference = 1.0;
        
        for (float layer = 0.0; layer < 6.0; layer++) {
            if (layer >= gridLayers) break;
            
            float layerAngle = layer * rotationOffset + t * (0.1 + layer * 0.02);
            vec2 layerUV = chromUV * rot(layerAngle);
            
            float pattern = gridPattern(layerUV, gridFrequency + layer * 2.0, gridType);
            interference *= pattern;
        }
        
        interference = pow(interference, 1.0 / contrast);
        
        if (ch < 0.5) col.r = interference;
        else if (ch < 1.5) col.g = interference;
        else col.b = interference;
    }
    
    // Tint toward blue/purple
    col = mix(col, col * vec3(0.7, 0.75, 1.0), 0.3);
    
    // Invert option
    col = mix(col, 1.0 - col, invert);
    
    // Subtle vignette
    float vig = 1.0 - d * 0.5;
    col *= vig;
    
    gl_FragColor = vec4(col, 1.0);
}
