/*{
    "DESCRIPTION": "Dark crystalline obsidian shards with specular highlights",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "sharpness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "reflectivity", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Voronoi for crystal facets
    vec2 p = uv * 6.0 * sharpness;
    vec2 n = floor(p);
    vec2 f = fract(p);
    
    float md = 8.0;
    vec2 mg;
    
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            o = 0.5 + 0.3 * sin(t * 0.5 + 6.2831 * o);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < md) { md = d; mg = g; }
        }
    }
    
    vec2 cellId = n + mg;
    float cellHash = hash(cellId);
    
    // Dark base with specular
    float facet = sqrt(md);
    float edge = smoothstep(0.0, 0.1, facet);
    
    // Facet angle for "reflection"
    float reflection = pow(1.0 - facet, 3.0) * reflectivity;
    float facetAngle = cellHash * 6.28;
    float specular = pow(max(sin(facetAngle + t * 0.3) * 0.5 + 0.5, 0.0), 8.0);
    
    vec3 col = vec3(0.02, 0.02, 0.03); // Very dark base
    col += vec3(0.1, 0.1, 0.15) * edge * cellHash;
    col += vec3(0.5, 0.5, 0.6) * specular * reflection * 0.3;
    
    // Subtle purple edge glow
    float edgeDist = 1.0 - edge;
    col += vec3(0.2, 0.1, 0.3) * edgeDist * 0.5;
    
    // Some white dot sparkles
    float sparkle = noise(uv * 50.0 + t);
    if (sparkle > 0.95) {
        col += vec3(0.5) * (sparkle - 0.95) * 20.0;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
