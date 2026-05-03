/*{
    "DESCRIPTION": "Iridescent flowing pebbles - organic cell-like blobs",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "scale", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "iridescence", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec2 p = uv * scale;
    
    // Voronoi
    vec2 n = floor(p);
    vec2 f = fract(p);
    
    float md = 8.0;
    float md2 = 8.0;
    vec2 mg;
    vec2 mr;
    
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            o = 0.5 + 0.5 * sin(t + 6.2831 * o);
            
            vec2 r = g + o - f;
            float d = dot(r, r);
            
            if (d < md) {
                md2 = md;
                md = d;
                mr = r;
                mg = g;
            } else if (d < md2) {
                md2 = d;
            }
        }
    }
    
    md = sqrt(md);
    md2 = sqrt(md2);
    
    // Edge detection
    float edge = md2 - md;
    
    // Color
    vec2 cellId = n + mg;
    float hue = hash2(cellId).x;
    
    vec3 col = vec3(0.0);
    
    // Iridescent purple/blue coloring
    vec3 cellCol = mix(
        vec3(0.3, 0.2, 0.5),
        vec3(0.5, 0.4, 0.8),
        hue
    );
    cellCol = mix(cellCol, vec3(0.4, 0.5, 0.9), sin(hue * 6.28 + t) * 0.5 + 0.5 * iridescence);
    
    // Shading
    float shade = 0.5 + 0.5 * (1.0 - md * 2.0);
    col = cellCol * shade;
    
    // Edge highlight
    col += vec3(0.8, 0.7, 1.0) * smoothstep(0.05, 0.0, edge) * 0.5;
    
    // Specular-like highlight
    float spec = pow(1.0 - md, 4.0);
    col += vec3(0.6, 0.5, 0.8) * spec * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
