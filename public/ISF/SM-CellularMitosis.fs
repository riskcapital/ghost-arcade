/*{
    "DESCRIPTION": "Cellular Mitosis - Organic cells fill the shape dividing and pushing against each other and edges",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "cellScale", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 15.0},
        {"NAME": "membraneWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "nucleusSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 0.6},
        {"NAME": "divisionRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "cellColor", "TYPE": "color", "DEFAULT": [0.15, 0.35, 0.2, 1.0]},
        {"NAME": "membraneColor", "TYPE": "color", "DEFAULT": [0.3, 0.7, 0.4, 1.0]},
        {"NAME": "nucleusColor", "TYPE": "color", "DEFAULT": [0.4, 0.2, 0.5, 1.0]},
        {"NAME": "fluidColor", "TYPE": "color", "DEFAULT": [0.6, 0.8, 0.5, 1.0]},
        {"NAME": "edgePressure", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

// Animated Voronoi for cells
vec3 voronoiCell(vec2 p, float t) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    
    float md = 8.0;   // distance to nearest
    float md2 = 8.0;  // distance to second nearest
    vec2 mr;
    vec2 cellCenter;
    
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = vec2(hash2(n + g), hash2(n + g + 100.0));
            
            // Animate cell centers (mitosis motion)
            float divPhase = fract(t * 0.2 + hash2(n + g + 50.0));
            vec2 divDir = vec2(cos(hash2(n + g + 200.0) * 6.28), sin(hash2(n + g + 200.0) * 6.28));
            float divAmount = sin(divPhase * 3.14159) * 0.15 * step(0.7, hash2(n + g + 300.0));
            o += divDir * divAmount;
            
            // Organic pulsation
            o += vec2(sin(t * 2.0 + hash2(n + g) * 6.28), cos(t * 1.5 + hash2(n + g + 50.0) * 6.28)) * 0.05;
            
            vec2 r = g + o - f;
            float d = length(r);
            
            if (d < md) {
                md2 = md;
                md = d;
                mr = r;
                cellCenter = n + g;
            } else if (d < md2) {
                md2 = d;
            }
        }
    }
    
    return vec3(md, md2 - md, hash2(cellCenter) * 0.5 + hash2(cellCenter + 500.0) * 0.5);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    // Cells compress near edges
    float compression = 1.0 + (1.0 - smoothstep(0.0, 0.15, edgeDist)) * edgePressure * 2.0;
    vec2 cellUV = uv * cellScale * compression;
    
    vec3 v = voronoiCell(cellUV, t);
    float cellDist = v.x;
    float edgeWidth = v.y;
    float cellId = v.z;
    
    // Cell membrane
    float membrane = smoothstep(membraneWidth * 0.08, membraneWidth * 0.02, edgeWidth);
    
    // Cell interior
    float interior = 1.0 - membrane;
    
    // Cell coloring based on ID
    vec3 cCol = cellColor.rgb * (0.7 + cellId * 0.6);
    
    // Nucleus
    float nucleus = smoothstep(nucleusSize * 0.4, nucleusSize * 0.2, cellDist);
    
    // Division indicator (cells about to divide get pinched)
    float dividing = step(0.8, fract(t * divisionRate + cellId * 5.0));
    float pinch = 1.0 - smoothstep(0.0, 0.3, abs(cellDist - 0.2)) * dividing * 0.5;
    
    // Organelle texture inside cells
    float organelles = noise(cellUV * 5.0 + cellId * 100.0 + t * 0.3);
    organelles = pow(organelles, 3.0) * 0.3;
    
    // Compose
    vec3 col = cCol * interior;
    col = mix(col, membraneColor.rgb, membrane);
    col = mix(col, nucleusColor.rgb, nucleus * 0.7);
    col += fluidColor.rgb * organelles * interior;
    
    // Edge pressure visualization (cells flatten against boundary)
    float wallPressure = exp(-edgeDist * 15.0) * edgePressure;
    col += membraneColor.rgb * wallPressure * 0.3;
    
    // Membrane tension glow at shape edges
    float tensionGlow = exp(-edgeDist * 30.0) * membrane * 0.5;
    col += fluidColor.rgb * tensionGlow;
    
    // Cytoplasm flow
    float flow = noise(cellUV * 3.0 + vec2(t * 0.5, t * 0.3)) * 0.15;
    col += fluidColor.rgb * flow * interior * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
