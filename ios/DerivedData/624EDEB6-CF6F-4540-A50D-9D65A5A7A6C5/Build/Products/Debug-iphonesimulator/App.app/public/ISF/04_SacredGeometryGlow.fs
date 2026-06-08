/*{
    "DESCRIPTION": "Glowing sacred geometry - vesica piscis with radial grid",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "glowIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "complexity", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0}
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
    
    // Central glowing orb
    col += 0.02 / (d * d + 0.01);
    
    // Concentric circles
    for (float i = 1.0; i < 6.0; i++) {
        float r = i * 0.08 + 0.02 * sin(t + i);
        float ring = abs(d - r);
        col += 0.001 / (ring + 0.002) * 0.3;
    }
    
    // Vesica piscis / overlapping circles
    float d1 = length(uv - vec2(0.12, 0.0));
    float d2 = length(uv - vec2(-0.12, 0.0));
    float vesica1 = abs(d1 - 0.2);
    float vesica2 = abs(d2 - 0.2);
    col += 0.001 / (vesica1 + 0.002) * 0.5;
    col += 0.001 / (vesica2 + 0.002) * 0.5;
    
    // Radial grid lines
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= complexity) break;
        float a = i * PI / complexity + t * 0.1;
        vec2 dir = vec2(cos(a), sin(a));
        float lineDist = abs(dot(uv, vec2(-dir.y, dir.x)));
        col += 0.0005 / (lineDist + 0.002) * smoothstep(0.5, 0.0, d);
    }
    
    col *= glowIntensity;
    
    // Soft white glow
    vec3 color = vec3(col) + vec3(0.9, 0.95, 1.0) * 0.01 / (d + 0.05);
    
    gl_FragColor = vec4(color, 1.0);
}
