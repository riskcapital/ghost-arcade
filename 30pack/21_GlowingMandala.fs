/*{
    "DESCRIPTION": "Glowing geometric mandala spirograph pattern",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "petals", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 16.0},
        {"NAME": "layers", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 8.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    for (float layer = 1.0; layer <= 8.0; layer++) {
        if (layer > layers) break;
        
        float r = layer * 0.05;
        float p = petals + layer * 2.0;
        float phase = t * 0.2 * layer + layer * 0.5;
        
        // Spirograph curve: parametric rose
        float roseR = r * (1.0 + 0.5 * cos(p * angle + phase));
        float roseDist = abs(d - roseR);
        
        float glow = 0.001 / (roseDist + 0.002);
        glow *= smoothstep(0.5, 0.0, d);
        
        col += glow * (0.8 / layer);
    }
    
    // Inner rotating geometry
    for (float i = 0.0; i < 12.0; i++) {
        float a = i * PI * 2.0 / 12.0 + t * 0.5;
        vec2 lineDir = vec2(cos(a), sin(a));
        float lineDist = abs(dot(uv, vec2(-lineDir.y, lineDir.x)));
        col += 0.0003 / (lineDist + 0.003) * smoothstep(0.3, 0.0, d);
    }
    
    // Central glow
    col += 0.03 / (d * d + 0.01);
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
