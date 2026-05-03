/*{
    "DESCRIPTION": "Fractal dimension - recursive geometric subdivision with depth",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "iterations", "TYPE": "float", "DEFAULT": 6.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "foldType", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Triangle/Square"},
        {"NAME": "rotationPer", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rotation Per Step"},
        {"NAME": "scaleFactor", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.5, "MAX": 3.0},
        {"NAME": "lineWeight", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 2.0},
        {"NAME": "fillMode", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Outline/Fill"},
        {"NAME": "colorByDepth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "offsetX", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.5, "MAX": 2.0, "LABEL": "Fold Offset X"},
        {"NAME": "offsetY", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.5, "MAX": 2.0, "LABEL": "Fold Offset Y"}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(0.0);
    vec2 z = uv * 2.0;
    
    float trap = 1e10;
    float totalScale = 1.0;
    
    for (float i = 0.0; i < 10.0; i++) {
        if (i >= iterations) break;
        
        // Fold operation
        if (foldType < 0.5) {
            // Triangle fold (Sierpinski)
            z = abs(z);
            if (z.x - z.y < 0.0) z = z.yx; // Fold along diagonal
            z -= vec2(offsetX, offsetY) * 0.5;
            if (z.x - z.y < 0.0) z = z.yx;
        } else {
            // Square fold (Vicsek/carpet)
            z = abs(z);
            z -= vec2(offsetX, offsetY) * 0.5;
            z = abs(z);
        }
        
        // Scale
        z *= scaleFactor;
        totalScale *= scaleFactor;
        z -= vec2(offsetX, offsetY) * (scaleFactor - 1.0) * 0.5;
        
        // Rotation per iteration
        z *= rot(rotationPer * 0.3 + t * 0.1);
        
        // Orbit trap for coloring
        float d = length(z) / totalScale;
        trap = min(trap, d);
        
        // Draw at this iteration level
        float iterD = min(abs(z.x), abs(z.y)) / totalScale;
        float weight = lineWeight * 0.003 / totalScale;
        float line = weight / (iterD + weight * 0.5);
        
        // Color by depth
        float depthMix = i / iterations;
        vec3 iterCol = mix(
            vec3(0.3, 0.4, 0.8),
            vec3(0.7, 0.5, 1.0),
            depthMix * colorByDepth
        );
        
        col += iterCol * line * (1.0 / (i + 1.0)) * 0.15;
    }
    
    // Fill mode adds orbit trap coloring
    if (fillMode > 0.0) {
        float trapCol = exp(-trap * 20.0);
        col += mix(vec3(0.1, 0.15, 0.3), vec3(0.4, 0.3, 0.6), trap * 5.0) * trapCol * fillMode;
    }
    
    // Edge distance for clean outline
    float edgeDist = min(abs(z.x), abs(z.y)) / totalScale;
    float edge = lineWeight * 0.002 / (edgeDist + lineWeight * 0.001);
    col += vec3(0.5, 0.55, 0.8) * edge * 0.1;
    
    gl_FragColor = vec4(col, 1.0);
}
