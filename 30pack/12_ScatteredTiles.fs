/*{
    "DESCRIPTION": "Floating scattered geometric tiles on grid",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "gridDensity", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 15.0},
        {"NAME": "scatter", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float box(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    vec2 grid = uv * gridDensity;
    
    for (float dy = -1.0; dy <= 1.0; dy++) {
        for (float dx = -1.0; dx <= 1.0; dx++) {
            vec2 id = floor(grid) + vec2(dx, dy);
            vec2 gv = grid - id - 0.5;
            
            float h = hash(id);
            float h2 = hash(id * 1.7 + 3.1);
            float h3 = hash(id * 2.3 + 7.7);
            
            // Scatter offset
            vec2 offset = (vec2(h, h2) - 0.5) * scatter;
            offset += vec2(sin(t * 0.5 + h * 6.28), cos(t * 0.3 + h2 * 6.28)) * 0.1;
            
            vec2 p = gv - offset;
            
            // Rotation
            p *= rot(h3 * 6.28 + t * 0.2 * (h - 0.5));
            
            float size = 0.15 + 0.15 * h;
            
            // Mix of circles and squares
            float shape;
            if (h3 > 0.5) {
                shape = box(p, vec2(size));
            } else {
                shape = length(p) - size;
            }
            
            // Outline
            float outline = abs(shape) - 0.01;
            col += 0.001 / (outline + 0.003) * 0.3;
            
            // Fill with slight transparency
            col += smoothstep(0.01, -0.01, shape) * 0.15 * (0.5 + 0.5 * sin(t + h * 10.0));
        }
    }
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
