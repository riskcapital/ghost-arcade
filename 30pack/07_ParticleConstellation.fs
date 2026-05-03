/*{
    "DESCRIPTION": "Particle constellation forming triangular shapes",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "density", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0},
        {"NAME": "drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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
    float col = 0.0;
    
    // Triangle constellation shape
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    float triDist = d - 0.2 * (1.0 + 0.3 * cos(3.0 * angle + t * 0.5));
    
    // Particles scattered with bias toward triangle
    for (float i = 0.0; i < 60.0; i++) {
        float h1 = hash(vec2(i, 1.0));
        float h2 = hash(vec2(i, 2.0));
        float h3 = hash(vec2(i, 3.0));
        
        float a = h1 * PI * 2.0 + t * drift * (h3 - 0.5);
        float r = h2 * 0.5 * density;
        
        // Bias particles toward triangle shape
        float triR = 0.2 * (1.0 + 0.3 * cos(3.0 * a));
        r = mix(r, triR, 0.4 + 0.2 * sin(t + i));
        
        vec2 pos = r * vec2(cos(a), sin(a));
        pos += vec2(sin(t * 0.3 + i), cos(t * 0.2 + i * 1.3)) * drift * 0.05;
        
        float pd = length(uv - pos);
        float size = 0.002 + 0.002 * h3;
        col += size * size / (pd * pd + 0.00001);
    }
    
    col = clamp(col, 0.0, 1.0);
    vec3 color = vec3(0.7, 0.75, 1.0) * col;
    
    gl_FragColor = vec4(color, 1.0);
}
