/*{
    "DESCRIPTION": "Cosmic web - large-scale universe structure with filaments and voids",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "webScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "filamentBrightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "nodeGlow", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "voidDarkness", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorTemp", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Blue/Purple"},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0, "LABEL": "Layer Depth"},
        {"NAME": "filamentWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "clusterSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float voronoiEdge(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    
    float md = 8.0, md2 = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < md) { md2 = md; md = d; }
            else if (d < md2) { md2 = d; }
        }
    }
    return md2 - sqrt(md);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(0.0);
    
    for (float layer = 0.0; layer < 5.0; layer++) {
        if (layer >= depth) break;
        
        float layerScale = webScale * (1.0 + layer * 0.4);
        float layerAlpha = 1.0 / (1.0 + layer * 0.6);
        
        vec2 p = uv * layerScale + vec2(layer * 3.7, layer * 2.1);
        p += vec2(t * 0.05 * (layer + 1.0), t * 0.03);
        
        // Turbulence displacement
        if (turbulence > 0.0) {
            p += vec2(noise(p * 2.0 + t * 0.1), noise(p * 2.0 + 100.0 + t * 0.1)) * turbulence * 0.3;
        }
        
        // Voronoi edge = filament
        float edge = voronoiEdge(p);
        
        // Filaments (bright at edges between voids)
        float filament = exp(-edge * edge / (filamentWidth * filamentWidth * 0.01)) * filamentBrightness;
        
        // Void darkness
        float voidMask = smoothstep(0.0, 0.3, edge) * voidDarkness;
        
        // Node clusters at vertices
        vec2 n = floor(p);
        vec2 f = fract(p);
        float minD = 8.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hash2(n + g);
                float d = length(g + o - f);
                minD = min(minD, d);
            }
        }
        float node = clusterSize * 0.01 / (minD * minD + 0.005);
        
        // Layer color
        vec3 layerCol = mix(
            mix(vec3(0.2, 0.3, 0.8), vec3(0.5, 0.3, 0.7), colorTemp),
            mix(vec3(0.4, 0.5, 1.0), vec3(0.7, 0.5, 0.9), colorTemp),
            layer / depth
        );
        
        col += layerCol * (filament + node * nodeGlow) * layerAlpha;
        col *= 1.0 - voidMask * 0.1 * layerAlpha;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
