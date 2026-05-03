/*{
    "DESCRIPTION": "Building facade cracking apart - flat white surface breaking into geometric shards that fall away",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "crackProgress", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "crackDensity", "TYPE": "float", "MIN": 3.0, "MAX": 15.0, "DEFAULT": 7.0},
        {"NAME": "fallSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.6},
        {"NAME": "facadeColor", "TYPE": "color", "DEFAULT": [0.92, 0.9, 0.87, 1.0]},
        {"NAME": "crackColor", "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.08, 1.0]},
        {"NAME": "depthColor", "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.05, 1.0]},
        {"NAME": "animateAuto", "TYPE": "bool", "DEFAULT": true},
        {"NAME": "crackWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.015, "DEFAULT": 0.005}
    ]
}*/

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float voronoi(vec2 p, out vec2 cellCenter, out vec2 cellID) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash2(i + neighbor);
            vec2 diff = neighbor + point - f;
            float dist = length(diff);
            if (dist < minDist) {
                minDist = dist;
                cellCenter = i + neighbor + point;
                cellID = i + neighbor;
            }
        }
    }
    return minDist;
}

float voronoiEdge(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist1 = 1.0;
    float minDist2 = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash2(i + neighbor);
            float dist = length(neighbor + point - f);
            if (dist < minDist1) {
                minDist2 = minDist1;
                minDist1 = dist;
            } else if (dist < minDist2) {
                minDist2 = dist;
            }
        }
    }
    return minDist2 - minDist1;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float progress = animateAuto ? (sin(TIME * fallSpeed * 0.3) * 0.5 + 0.5) : crackProgress;
    
    vec2 cellC, cellI;
    float scale = crackDensity;
    vec2 p = uv * scale;
    
    float dist = voronoi(p, cellC, cellI);
    float edge = voronoiEdge(p);
    
    // Each cell has a unique "break time" based on distance from edges
    float cellHash = fract(sin(dot(cellI, vec2(127.1, 311.7))) * 43758.5453);
    vec2 cellUV = cellC / scale;
    float edgeDist = min(min(cellUV.x, 1.0 - cellUV.x), min(cellUV.y, 1.0 - cellUV.y));
    
    // Cracks start from edges and propagate inward
    float breakThreshold = edgeDist * 1.5 + cellHash * 0.3;
    float isBroken = smoothstep(breakThreshold, breakThreshold - 0.05, progress);
    
    // Crack lines
    float crack = smoothstep(crackWidth * scale, crackWidth * scale * 0.2, edge);
    float crackVisible = smoothstep(breakThreshold + 0.1, breakThreshold, progress);
    
    // Shard falling animation
    float fallProgress = max(progress - breakThreshold, 0.0) * 3.0;
    float fallAmount = fallProgress * fallProgress; // acceleration
    float shardY = fallAmount * 0.5;
    float shardRotation = fallProgress * (cellHash - 0.5) * 2.0;
    float shardScale = max(1.0 - fallProgress * 0.3, 0.0);
    float shardAlpha = max(1.0 - fallProgress * 0.8, 0.0);
    
    // Offset UV for falling shards
    vec2 shardUV = uv;
    if (isBroken > 0.5) {
        shardUV.y += shardY;
        shardUV.x += sin(shardRotation) * 0.02;
    }
    
    // Recalculate voronoi for shifted shard
    vec2 sc2, si2;
    float dist2 = voronoi(shardUV * scale, sc2, si2);
    
    // Build the final color
    vec3 col = depthColor.rgb; // void behind
    
    // Facade surface (unbroken or falling)
    float facadeMask = 1.0;
    if (isBroken > 0.5) {
        facadeMask = shardAlpha;
        // Shade falling shards darker on one side
        float shardShade = 0.8 + 0.2 * sin(shardRotation);
        vec3 shardCol = facadeColor.rgb * shardShade;
        // Edge darkening on shards
        float shardEdge = smoothstep(0.0, 0.15, dist2);
        shardCol *= 0.7 + shardEdge * 0.3;
        col = mix(col, shardCol, shardAlpha);
    } else {
        // Intact facade with subtle texture
        float brickNoise = fract(sin(dot(floor(uv * 40.0), vec2(127.1, 311.7))) * 43758.5453);
        vec3 fCol = facadeColor.rgb * (0.95 + brickNoise * 0.05);
        col = fCol;
    }
    
    // Draw crack lines on surface
    float crackLine = crack * crackVisible;
    if (isBroken < 0.5) {
        col = mix(col, crackColor.rgb, crackLine * 0.9);
        // Crack glow/shadow
        float crackGlow = smoothstep(crackWidth * scale * 3.0, crackWidth * scale * 0.5, edge) * crackVisible;
        col -= vec3(crackGlow * 0.1);
    }
    
    // Edge shadow on the container frame
    float frameDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float frameShadow = smoothstep(0.02, 0.0, frameDist);
    col -= vec3(frameShadow * 0.1 * progress);
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
