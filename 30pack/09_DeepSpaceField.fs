/*{
    "DESCRIPTION": "Deep space particle field with drifting blue particles",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "particleCount", "TYPE": "float", "DEFAULT": 80.0, "MIN": 20.0, "MAX": 120.0},
        {"NAME": "spread", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    for (float i = 0.0; i < 120.0; i++) {
        if (i >= particleCount) break;
        
        float h1 = hash(vec2(i * 1.3, 0.7));
        float h2 = hash(vec2(0.3, i * 2.1));
        float h3 = hash(vec2(i, i * 0.7));
        
        vec2 pos = vec2(
            (h1 - 0.5) * 1.8 * spread,
            (h2 - 0.5) * 1.2 * spread
        );
        
        // Slow drift
        pos += vec2(
            sin(t * 0.15 * (h3 + 0.5) + i * 0.5) * 0.08,
            cos(t * 0.12 * (h3 + 0.5) + i * 0.7) * 0.06
        );
        
        float pd = length(uv - pos);
        float brightness = h3 * 0.5 + 0.5;
        float size = 0.001 + 0.003 * h3;
        
        float glow = size / (pd + 0.003) * 0.02 * brightness;
        
        // Blue-white color variation
        vec3 pCol = mix(vec3(0.3, 0.4, 0.8), vec3(0.7, 0.8, 1.0), h3);
        col += pCol * glow;
    }
    
    // Subtle background nebula
    float n = hash(floor(uv * 5.0));
    col += vec3(0.02, 0.02, 0.06) * n;
    
    gl_FragColor = vec4(col, 1.0);
}
