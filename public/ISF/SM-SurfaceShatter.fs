/*{
    "DESCRIPTION": "Flat surface shattering into triangular shards that peel and fall away revealing a glowing void",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "shatterProgress", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "shardCount", "TYPE": "float", "MIN": 4.0, "MAX": 12.0, "DEFAULT": 7.0},
        {"NAME": "facadeColor", "TYPE": "color", "DEFAULT": [0.9, 0.88, 0.85, 1.0]},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.2, 0.5, 1.0, 1.0]},
        {"NAME": "animateAuto", "TYPE": "bool", "DEFAULT": true},
        {"NAME": "impactX", "TYPE": "float", "MIN": 0.2, "MAX": 0.8, "DEFAULT": 0.5},
        {"NAME": "impactY", "TYPE": "float", "MIN": 0.2, "MAX": 0.8, "DEFAULT": 0.5},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.8}
    ]
}*/

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Voronoi for crack pattern
float voronoiCracks(vec2 p, out vec2 cellID) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 1.0, d2 = 1.0;
    vec2 bestID = i;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 n = vec2(float(x), float(y));
            vec2 pt = hash2(i + n);
            float d = length(n + pt - f);
            if (d < d1) { d2 = d1; d1 = d; bestID = i + n; }
            else if (d < d2) { d2 = d; }
        }
    }
    cellID = bestID;
    return d2 - d1;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float progress = animateAuto ? fract(TIME * 0.15) : shatterProgress;
    // Make it cycle: break then reset
    float cycle = progress;
    
    vec2 impact = vec2(impactX, impactY);
    float scale = shardCount;
    vec2 p = uv * scale;
    
    vec2 cellID;
    float crackDist = voronoiCracks(p, cellID);
    float cellH = hash(cellID);
    float cellH2 = hash(cellID + vec2(50.0));
    float cellH3 = hash(cellID + vec2(100.0));
    
    vec2 cellCenter = (cellID + hash2(cellID)) / scale;
    float distFromImpact = length(cellCenter - impact);
    
    // Shards break outward from impact point
    float breakTime = distFromImpact * 0.8 + cellH * 0.2;
    float isBroken = smoothstep(breakTime, breakTime + 0.05, cycle);
    float fallTime = max(cycle - breakTime, 0.0) * 5.0;
    
    // Crack lines
    float crackLine = smoothstep(0.05, 0.02, crackDist);
    float crackVisible = smoothstep(breakTime - 0.1, breakTime, cycle);
    
    // Void behind with glow
    vec3 voidCol = vec3(0.01);
    float voidGlow = smoothstep(0.5, 0.0, length(uv - impact)) * glowIntensity;
    voidCol += glowColor.rgb * voidGlow * 0.3;
    // Pulsing energy in the void
    float energy = sin(length(uv - impact) * 30.0 - TIME * 4.0) * 0.5 + 0.5;
    voidCol += glowColor.rgb * energy * isBroken * 0.15;
    
    vec3 col = voidCol;
    
    if (isBroken < 0.5) {
        // Intact facade
        vec3 fCol = facadeColor.rgb;
        // Subtle surface texture
        float texNoise = hash(floor(uv * 80.0)) * 0.04;
        fCol += vec3(texNoise - 0.02);
        
        // Show cracks before breaking
        fCol = mix(fCol, vec3(0.1), crackLine * crackVisible);
        
        // Stress darkening near cracks
        float stress = smoothstep(0.1, 0.04, crackDist) * crackVisible * 0.1;
        fCol -= vec3(stress);
        
        col = fCol;
    } else {
        // Shard peeling away
        float gravity = fallTime * fallTime * 0.4;
        vec2 fallDir = normalize(cellCenter - impact);
        float rotSpeed = (cellH2 - 0.5) * 4.0;
        float rot = fallTime * rotSpeed;
        float drift = fallTime * 0.2;
        
        vec2 shardOffset = fallDir * drift + vec2(0.0, -gravity * 0.2);
        vec2 shardCenter = cellCenter + shardOffset;
        
        // Check if we're viewing the falling shard
        vec2 toPixel = uv - shardCenter;
        float ca = cos(rot);
        float sa = sin(rot);
        vec2 rotP = vec2(toPixel.x * ca + toPixel.y * sa, -toPixel.x * sa + toPixel.y * ca);
        rotP *= scale;
        
        // Check if rotated point is within the original cell
        vec2 checkP = rotP + hash2(cellID);
        float checkDist = length(checkP - fract(checkP + 0.5) + 0.5 - hash2(cellID));
        
        float shardAlpha = max(1.0 - fallTime * 0.25, 0.0);
        float sSize = 0.5 / scale;
        if (length(rotP) < sSize * 2.0 && shardAlpha > 0.0) {
            vec3 shardCol = facadeColor.rgb * (0.5 + 0.5 * max(cos(rot), 0.0));
            // Light edge on shard
            shardCol += vec3(0.1) * smoothstep(sSize * 2.0, sSize, length(rotP));
            col = mix(col, shardCol, shardAlpha * 0.7);
        }
    }
    
    // Glowing crack edges
    float glowCrack = smoothstep(0.08, 0.02, crackDist) * isBroken;
    col += glowColor.rgb * glowCrack * 0.2;
    
    // Container edge
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += glowColor.rgb * smoothstep(0.01, 0.0, eDist) * 0.15 * cycle;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
