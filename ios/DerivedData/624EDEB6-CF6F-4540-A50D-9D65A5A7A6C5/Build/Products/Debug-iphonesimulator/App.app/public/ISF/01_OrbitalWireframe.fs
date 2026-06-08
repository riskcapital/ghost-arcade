/*{
    "DESCRIPTION": "Orbital wireframe lines with scattered geometric shapes",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "lineCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 20.0},
        {"NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float line(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    for (float i = 0.0; i < 20.0; i++) {
        if (i >= lineCount) break;
        float angle = t + i * PI / lineCount;
        float r = 0.3 + 0.1 * sin(t * 0.7 + i);
        vec2 a = r * vec2(cos(angle), sin(angle));
        float angle2 = angle + PI * 0.6 + 0.3 * sin(t + i * 0.5);
        vec2 b = r * vec2(cos(angle2), sin(angle2));
        
        a.xy *= rot(t * 0.3 + i * 0.2);
        b.xy *= rot(t * 0.3 + i * 0.2);
        
        float d = line(uv, a, b);
        col += 0.002 / (d + 0.001);
    }
    
    // Scattered small shapes
    for (float i = 0.0; i < 12.0; i++) {
        float a = i * 2.399 + t * 0.2;
        float r = 0.15 + 0.25 * fract(sin(i * 127.1) * 43758.5453);
        vec2 p = r * vec2(cos(a + t * 0.1), sin(a * 1.3 + t * 0.15));
        float d = length(uv - p);
        float shape = abs(d - 0.015);
        col += 0.001 / (shape + 0.001);
    }
    
    col *= brightness;
    gl_FragColor = vec4(vec3(col), 1.0);
}
