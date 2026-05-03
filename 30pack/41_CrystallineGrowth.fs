/*{
    "DESCRIPTION": "Crystalline growth - procedural crystal formation with faceted geometry",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "crystalScale", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "growthPhase", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "facetSharpness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "lightAngleX", "TYPE": "float", "DEFAULT": 0.5, "MIN": -1.0, "MAX": 1.0},
        {"NAME": "lightAngleY", "TYPE": "float", "DEFAULT": 0.8, "MIN": -1.0, "MAX": 1.0},
        {"NAME": "specularPower", "TYPE": "float", "DEFAULT": 16.0, "MIN": 2.0, "MAX": 64.0},
        {"NAME": "transparency", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "internalRefraction", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "bgBrightness", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(bgBrightness);
    
    // Multiple Voronoi layers for crystal structure
    float totalHeight = 0.0;
    vec3 totalNormal = vec3(0.0, 0.0, 1.0);
    float edge = 1.0;
    
    for (float layer = 0.0; layer < 3.0; layer++) {
        float sc = crystalScale * (1.0 + layer * 0.7);
        vec2 p = uv * sc;
        vec2 n = floor(p);
        vec2 f = fract(p);
        
        float md = 8.0;
        float md2 = 8.0;
        vec2 mr;
        vec2 mg;
        
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hash2(n + g);
                
                // Growth animation
                float growth = growthPhase + 0.5 * sin(t + hash(n + g) * 6.28);
                o *= growth;
                o = 0.5 + (o - 0.5) * clamp(growth, 0.0, 1.0);
                
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < md) { md2 = md; md = d; mr = r; mg = g; }
                else if (d < md2) { md2 = d; }
            }
        }
        
        md = sqrt(md);
        md2 = sqrt(md2);
        
        float edgeDist = md2 - md;
        edge = min(edge, edgeDist);
        
        // Faceted height from cell hash
        float cellHash = hash(n + mg);
        float height = cellHash * (0.3 + growthPhase * 0.7);
        height *= pow(1.0 - md, facetSharpness);
        
        totalHeight += height / (1.0 + layer);
        
        // Approximate normal from Voronoi
        vec3 layerNormal = normalize(vec3(
            mr.x * facetSharpness,
            mr.y * facetSharpness,
            1.0
        ));
        totalNormal += layerNormal / (1.0 + layer);
    }
    
    totalNormal = normalize(totalNormal);
    
    // Lighting
    vec3 lightDir = normalize(vec3(lightAngleX, lightAngleY, 1.0));
    float diff = max(dot(totalNormal, lightDir), 0.0);
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflDir = reflect(-lightDir, totalNormal);
    float spec = pow(max(dot(reflDir, viewDir), 0.0), specularPower);
    
    // Crystal color
    vec3 crystalCol = mix(vec3(0.5, 0.5, 0.6), vec3(0.7, 0.7, 0.8), totalHeight * 2.0);
    
    // Internal refraction color
    vec3 refrCol = vec3(0.3, 0.35, 0.5) * (1.0 + sin(uv.x * 30.0 + totalNormal.x * 10.0) * 0.2);
    crystalCol = mix(crystalCol, refrCol, internalRefraction * transparency);
    
    col = crystalCol * (diff * 0.7 + 0.3);
    col += vec3(0.9, 0.9, 1.0) * spec * 0.5;
    
    // Edge highlight (crystal boundaries)
    float edgeHighlight = smoothstep(0.05, 0.0, edge * crystalScale);
    col += vec3(0.3, 0.3, 0.4) * edgeHighlight * 0.3;
    
    // Subtle inner glow
    col += vec3(0.2, 0.2, 0.35) * transparency * exp(-totalHeight * 5.0) * 0.2;
    
    gl_FragColor = vec4(col, 1.0);
}
