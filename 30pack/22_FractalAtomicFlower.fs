/*{
    "DESCRIPTION": "Fractal atomic flower - kaleidoscopic symmetry pattern",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "foldSymmetry", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "iterations", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 8.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Kaleidoscopic fold
    float foldAngle = PI / foldSymmetry;
    angle = mod(angle, foldAngle * 2.0);
    angle = abs(angle - foldAngle);
    
    vec2 p = d * vec2(cos(angle), sin(angle));
    
    // Iterative fractal transformation
    float col = 0.0;
    float scale = 1.0;
    
    for (float i = 0.0; i < 8.0; i++) {
        if (i >= iterations) break;
        
        p = abs(p) - 0.3 / scale;
        
        // Rotate
        float a = t * 0.1 + i * 0.5;
        float c = cos(a), s = sin(a);
        p = mat2(c, -s, s, c) * p;
        
        // Circle at this iteration
        float cd = abs(length(p) - 0.15 / scale);
        col += 0.002 / (cd + 0.003) / scale;
        
        // Petal shapes
        float petalAngle = atan(p.y, p.x);
        float petalR = length(p);
        float petal = abs(petalR - 0.1 * (1.0 + 0.5 * cos(petalAngle * 3.0)) / scale);
        col += 0.001 / (petal + 0.003) / scale;
        
        scale *= 2.0;
    }
    
    // Atomic orbit overlay
    for (float i = 0.0; i < 3.0; i++) {
        float orbitAngle = i * PI / 3.0 + t * 0.3;
        vec2 oUV = uv;
        float c = cos(orbitAngle), s = sin(orbitAngle);
        oUV = mat2(c, -s, s, c) * oUV;
        
        float orbit = abs(length(vec2(oUV.x, oUV.y * 3.0)) - 0.2);
        col += 0.001 / (orbit + 0.005) * 0.3;
    }
    
    col = clamp(col, 0.0, 1.0);
    
    // Invert for white background look
    float bg = 1.0 - col * 0.8;
    vec3 color = vec3(bg);
    
    gl_FragColor = vec4(color, 1.0);
}
