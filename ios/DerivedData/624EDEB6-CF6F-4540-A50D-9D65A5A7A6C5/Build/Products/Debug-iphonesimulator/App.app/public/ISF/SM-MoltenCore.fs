/*{
    "DESCRIPTION": "Molten Core - Center glows like molten metal cooling to dark crust near edges with cracks revealing glow",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "coreTemp", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "crustThickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "crackDensity", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 16.0},
        {"NAME": "crackWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "moltenColor", "TYPE": "color", "DEFAULT": [1.0, 0.6, 0.0, 1.0]},
        {"NAME": "hotColor", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.0, 1.0]},
        {"NAME": "crustColor", "TYPE": "color", "DEFAULT": [0.15, 0.08, 0.05, 1.0]},
        {"NAME": "crackGlow", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.05, 1.0]},
        {"NAME": "convection", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p, float t) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p + t * 0.1 * float(i + 1));
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

float voronoiCracks(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 8.0, md2 = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = vec2(hash2(n + g), hash2(n + g + 100.0));
            float d = length(g + o - f);
            if (d < md) { md2 = md; md = d; }
            else if (d < md2) { md2 = d; }
        }
    }
    return md2 - md;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float centerDist = length(uv - vec2(0.5));
    float normEdge = smoothstep(0.0, 0.4, edgeDist);
    
    // Convection currents
    vec2 convUV = uv;
    if (convection > 0.0) {
        float cx = fbm(uv * 3.0 + vec2(t * 0.2, 0.0), t);
        float cy = fbm(uv * 3.0 + vec2(0.0, t * 0.2) + 100.0, t);
        convUV += (vec2(cx, cy) - 0.5) * convection * 0.05;
    }
    
    // Temperature gradient: hot center, cool edges
    float temp = normEdge * coreTemp;
    
    // Molten flow texture
    float flow1 = fbm(convUV * 4.0, t * 0.5);
    float flow2 = fbm(convUV * 6.0 + 50.0, t * 0.3);
    float moltenTex = mix(flow1, flow2, 0.5);
    
    // Core glow
    vec3 molten = mix(hotColor.rgb, moltenColor.rgb, moltenTex);
    molten *= temp * (0.8 + moltenTex * 0.4);
    
    // White-hot center
    float whitehot = exp(-centerDist * centerDist * 20.0) * coreTemp;
    molten += vec3(whitehot * 0.5);
    
    // Crust formation at edges
    float crustMask = smoothstep(0.3 * crustThickness, 0.05, edgeDist);
    float crustTex = fbm(uv * 8.0, t * 0.05);
    vec3 crust = crustColor.rgb * (0.6 + crustTex * 0.4);
    
    // Cracks in the crust revealing molten underneath
    float cracks = voronoiCracks(convUV * crackDensity);
    float crackLine = smoothstep(crackWidth * 0.08, crackWidth * 0.02, cracks);
    
    // Cracks glow more where hotter
    float crackHeat = crackLine * (0.3 + temp * 0.7);
    vec3 crackCol = crackGlow.rgb * crackHeat;
    
    // Compose: molten core visible through cracks in crust
    vec3 col = molten;
    col = mix(col, crust, crustMask * (1.0 - crackLine * 0.8));
    col += crackCol * crustMask * 0.8;
    
    // Ember particles
    for (int i = 0; i < 15; i++) {
        float fi = float(i);
        float ex = 0.5 + sin(t * 0.5 + fi * 2.0) * 0.3 * hash2(vec2(fi, 0.0));
        float ey = fract(hash2(vec2(fi, 1.0)) + t * (0.05 + hash2(vec2(fi, 2.0)) * 0.1));
        float ed = length(uv - vec2(ex, ey));
        float ember = exp(-ed * ed * 5000.0);
        float flicker = 0.5 + 0.5 * sin(t * 10.0 + fi * 7.0);
        col += moltenColor.rgb * ember * flicker * 0.5;
    }
    
    // Edge cooling glow
    float coolGlow = exp(-edgeDist * 20.0) * 0.15;
    col += hotColor.rgb * coolGlow * (0.5 + 0.5 * sin(t * 2.0));
    
    // Heat haze distortion subtle
    float haze = noise(uv * 30.0 + t * 2.0) * temp * 0.05;
    col *= 1.0 + haze;
    
    gl_FragColor = vec4(col, 1.0);
}
