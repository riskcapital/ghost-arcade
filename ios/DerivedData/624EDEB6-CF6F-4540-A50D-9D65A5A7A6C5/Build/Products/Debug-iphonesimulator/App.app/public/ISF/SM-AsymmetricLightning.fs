/*{
    "DESCRIPTION": "Organic asymmetric electricity crawling along frame edges with branching tendrils",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "arcCount", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 1.0, "MAX": 15.0, "DEFAULT": 6.0},
        {"NAME": "branchDepth", "TYPE": "float", "MIN": 0.02, "MAX": 0.3, "DEFAULT": 0.12},
        {"NAME": "arcWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.008, "DEFAULT": 0.003},
        {"NAME": "boltColor", "TYPE": "color", "DEFAULT": [0.4, 0.6, 1.0, 1.0]},
        {"NAME": "coreColor", "TYPE": "color", "DEFAULT": [0.85, 0.9, 1.0, 1.0]},
        {"NAME": "flickerRate", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "chaos", "TYPE": "float", "MIN": 0.01, "MAX": 0.15, "DEFAULT": 0.05}
    ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x),
               mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y);
}

// Returns distance to a jagged lightning path along a 1D coordinate
float boltDist(vec2 uv, float basePos, float coord, float perpCoord, float seed, float t) {
    float offset = 0.0;
    float amp = chaos;
    float freq = 5.0;
    for (int i = 0; i < 7; i++) {
        offset += (noise(vec2(coord * freq + seed * 73.0, t * speed + seed * 37.0 + float(i) * 13.0)) - 0.5) * amp;
        amp *= 0.55;
        freq *= 2.1;
    }
    return abs(perpCoord - basePos - offset);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME;
    vec3 col = vec3(0.005, 0.005, 0.012);
    int count = int(arcCount);
    
    // Each arc lives on a specific edge and travels along it
    for (int i = 0; i < 8; i++) {
        if (i >= count) break;
        float id = float(i);
        float seed = id * 7.13 + 3.0;
        
        // Flicker: each bolt has independent random on/off
        float flickSeed = floor(t * flickerRate + id * 3.7);
        float flicker = step(0.25, hash(vec2(flickSeed, id)));
        if (flicker < 0.5) continue;
        
        // Assign each arc to an edge: 0=bottom, 1=right, 2=top, 3=left
        // But distribute unevenly - not one per edge
        float edgeChoice = hash(vec2(id * 127.1, floor(t * 0.5 + id)));
        int edge = int(edgeChoice * 4.0);
        
        // Arc travels along the edge over time
        float travelPos = fract(t * 0.15 * (0.5 + hash(vec2(id, 1.0)) * 0.5) + hash(vec2(id, 2.0)));
        float arcLength = 0.3 + hash(vec2(id, 3.0)) * 0.5;
        
        float coord, perpCoord, basePerp;
        float inRange;
        
        if (edge == 0) { // bottom
            coord = uv.x; perpCoord = uv.y; basePerp = 0.0;
            inRange = smoothstep(travelPos - arcLength * 0.5, travelPos - arcLength * 0.3, coord) *
                      smoothstep(travelPos + arcLength * 0.5, travelPos + arcLength * 0.3, coord);
        } else if (edge == 1) { // right
            coord = uv.y; perpCoord = 1.0 - uv.x; basePerp = 0.0;
            inRange = smoothstep(travelPos - arcLength * 0.5, travelPos - arcLength * 0.3, coord) *
                      smoothstep(travelPos + arcLength * 0.5, travelPos + arcLength * 0.3, coord);
        } else if (edge == 2) { // top
            coord = uv.x; perpCoord = 1.0 - uv.y; basePerp = 0.0;
            inRange = smoothstep(travelPos - arcLength * 0.5, travelPos - arcLength * 0.3, coord) *
                      smoothstep(travelPos + arcLength * 0.5, travelPos + arcLength * 0.3, coord);
        } else { // left
            coord = uv.y; perpCoord = uv.x; basePerp = 0.0;
            inRange = smoothstep(travelPos - arcLength * 0.5, travelPos - arcLength * 0.3, coord) *
                      smoothstep(travelPos + arcLength * 0.5, travelPos + arcLength * 0.3, coord);
        }
        
        float dist = boltDist(uv, basePerp, coord, perpCoord, seed, t);
        
        // Main bolt
        float core = smoothstep(arcWidth, arcWidth * 0.1, dist) * inRange;
        float glow = smoothstep(arcWidth * 8.0, arcWidth * 0.3, dist) * inRange * 0.3;
        
        col += coreColor.rgb * core * 0.9;
        col += boltColor.rgb * glow;
        
        // Branching tendrils going inward from the edge
        for (int br = 0; br < 3; br++) {
            float brSeed = seed + float(br) * 31.0;
            float brPos = travelPos + (hash(vec2(brSeed, 1.0)) - 0.5) * arcLength * 0.6;
            float brAngle = hash(vec2(brSeed, 2.0)) * 0.8 + 0.2;
            
            // Branch goes perpendicular from edge into the frame
            float brCoord = perpCoord;
            float brBaseCoord;
            if (edge == 0 || edge == 2) {
                brBaseCoord = uv.x;
            } else {
                brBaseCoord = uv.y;
            }
            
            float brDist = boltDist(uv, brPos, brCoord * 5.0, brBaseCoord, brSeed, t);
            float brRange = smoothstep(branchDepth, 0.0, perpCoord) * smoothstep(0.0, 0.02, perpCoord);
            float brLine = smoothstep(arcWidth * 1.5, arcWidth * 0.2, brDist) * brRange * inRange;
            float brGlow = smoothstep(arcWidth * 6.0, arcWidth * 0.5, brDist) * brRange * inRange * 0.2;
            
            col += boltColor.rgb * brLine * 0.5;
            col += boltColor.rgb * brGlow;
        }
    }
    
    // Edge ambient glow
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float eGlow = smoothstep(0.03, 0.0, eDist) * 0.08;
    col += boltColor.rgb * eGlow;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
