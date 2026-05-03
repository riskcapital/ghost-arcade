/*{
    "DESCRIPTION": "Plasma energy tendrils that cling to and crawl along the frame edges",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "edgeWidth", "TYPE": "float", "MIN": 0.02, "MAX": 0.3, "DEFAULT": 0.12},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "primaryColor", "TYPE": "color", "DEFAULT": [0.2, 0.5, 1.0, 1.0]},
        {"NAME": "secondaryColor", "TYPE": "color", "DEFAULT": [0.8, 0.2, 1.0, 1.0]},
        {"NAME": "coreGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    // Distance to each edge
    float dLeft = uv.x;
    float dRight = 1.0 - uv.x;
    float dBottom = uv.y;
    float dTop = 1.0 - uv.y;
    float dEdge = min(min(dLeft, dRight), min(dBottom, dTop));
    
    // Edge-following coordinate
    float edgeCoord = 0.0;
    if (dLeft <= dRight && dLeft <= dBottom && dLeft <= dTop) {
        edgeCoord = uv.y;
    } else if (dRight <= dLeft && dRight <= dBottom && dRight <= dTop) {
        edgeCoord = 1.0 - uv.y;
    } else if (dBottom <= dLeft && dBottom <= dRight && dBottom <= dTop) {
        edgeCoord = 1.0 - uv.x;
    } else {
        edgeCoord = uv.x;
    }
    
    // Plasma noise along edges
    float plasma = fbm(vec2(edgeCoord * complexity * 3.0 + t, dEdge * 10.0 - t * 0.5));
    plasma += fbm(vec2(edgeCoord * complexity * 5.0 - t * 1.3, dEdge * 15.0 + t * 0.3)) * 0.5;
    
    // Edge falloff
    float edgeFalloff = smoothstep(edgeWidth, 0.0, dEdge);
    float plasmaShape = edgeFalloff * plasma * intensity;
    
    // Tendril extensions
    float tendril = fbm(vec2(uv.x * complexity * 2.0 + t * 0.7, uv.y * complexity * 2.0 - t * 0.5));
    float tendrilShape = smoothstep(edgeWidth * 2.0, 0.0, dEdge) * tendril * 0.5;
    
    float combined = plasmaShape + tendrilShape;
    
    // Color
    vec3 col = mix(primaryColor.rgb, secondaryColor.rgb, plasma);
    col *= combined;
    
    // Core brightness at the very edge
    float core = smoothstep(0.01, 0.0, dEdge) * coreGlow;
    col += vec3(core) * mix(primaryColor.rgb, vec3(1.0), 0.5);
    
    // Corner intensification
    float cornerDist = min(min(uv.x, 1.0 - uv.x), 1.0) * min(min(uv.y, 1.0 - uv.y), 1.0);
    float cornerBoost = smoothstep(0.05, 0.0, cornerDist) * 0.5;
    col += mix(primaryColor.rgb, secondaryColor.rgb, 0.5) * cornerBoost * intensity;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
