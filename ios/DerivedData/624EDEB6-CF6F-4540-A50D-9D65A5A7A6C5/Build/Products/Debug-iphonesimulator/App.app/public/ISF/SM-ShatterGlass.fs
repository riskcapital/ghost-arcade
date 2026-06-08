/*{
    "DESCRIPTION": "Shatter Glass - A pane of glass that cracks from impact, fracture lines terminating at edges",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "impactX", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "impactY", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "crackDensity", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 24.0},
        {"NAME": "shardDetail", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "crackWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "glassColor", "TYPE": "color", "DEFAULT": [0.7, 0.8, 0.9, 1.0]},
        {"NAME": "crackColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "shardTint", "TYPE": "color", "DEFAULT": [0.3, 0.5, 0.7, 1.0]},
        {"NAME": "refractStrength", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Voronoi for shard patterns
vec2 voronoi(vec2 p, float seed) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 8.0;
    float md2 = 8.0;
    vec2 mr;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = vec2(hash2(n + g + seed), hash2(n + g + seed + 100.0));
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < md) {
                md2 = md;
                md = d;
                mr = r;
            } else if (d < md2) {
                md2 = d;
            }
        }
    }
    return vec2(sqrt(md), sqrt(md2) - sqrt(md));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    vec2 impact = vec2(impactX, impactY);
    
    // Animated impact point drifts slowly
    impact += vec2(sin(t * 0.5) * 0.1, cos(t * 0.7) * 0.1);
    
    float distFromImpact = length(uv - impact);
    float angle = atan(uv.y - impact.y, uv.x - impact.x);
    
    // Edge distance
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    vec3 col = glassColor.rgb;
    
    // Radial crack lines from impact
    float cracks = 0.0;
    for (int i = 0; i < 24; i++) {
        if (float(i) >= crackDensity) break;
        float fi = float(i);
        float crackAngle = fi / crackDensity * 6.28318 + hash(fi * 7.3) * 0.3;
        
        // Crack propagation wave
        float propagation = fract(t * 0.5);
        float crackLen = propagation * (0.5 + hash(fi * 3.1) * 1.0);
        
        // Angular distance to this crack
        float angleDiff = abs(mod(angle - crackAngle + 3.14159, 6.28318) - 3.14159);
        
        // Crack follows a wobbly path outward
        float wobble = noise(vec2(distFromImpact * 15.0, fi * 10.0 + t)) * 0.15 * shardDetail;
        angleDiff = abs(angleDiff - wobble);
        
        // Width varies with distance
        float w = crackWidth * 0.003 * (1.0 + distFromImpact * 2.0);
        
        float crackMask = step(distFromImpact, crackLen);
        float crackLine = smoothstep(w, w * 0.1, angleDiff) * crackMask;
        cracks = max(cracks, crackLine);
    }
    
    // Concentric ring cracks
    float ringCracks = 0.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float ringR = 0.08 + fi * 0.12;
        float ringW = crackWidth * 0.002;
        float ringDist = abs(distFromImpact - ringR);
        float ring = smoothstep(ringW, ringW * 0.1, ringDist);
        ring *= step(distFromImpact, 0.08 + float(int(crackDensity / 4.0)) * 0.12);
        ringCracks = max(ringCracks, ring);
    }
    
    // Voronoi shard pattern (secondary cracks)
    float voroScale = 4.0 + shardDetail * 8.0;
    vec2 v = voronoi(uv * voroScale + vec2(t * 0.1), 0.0);
    float shardEdge = smoothstep(0.05, 0.02, v.y);
    float shardId = hash2(floor(uv * voroScale));
    
    // Shard displacement / refraction
    float shardAngle = shardId * 6.28;
    vec2 shardOffset = vec2(cos(shardAngle), sin(shardAngle)) * refractStrength * 0.02;
    shardOffset *= (1.0 - edgeDist * 5.0); // More displacement near edges
    
    // Each shard gets slight color variation
    vec3 shardCol = mix(glassColor.rgb, shardTint.rgb, shardId * 0.3);
    
    // Glass reflections
    float reflection = noise(uv * 20.0 + vec2(t * 0.2)) * 0.15;
    reflection += pow(1.0 - edgeDist, 3.0) * 0.1;
    
    // Impact stress pattern (radial gradient)
    float stress = exp(-distFromImpact * 3.0) * 0.2;
    vec3 stressColor = vec3(1.0, 0.95, 0.9);
    
    // Compose glass surface
    col = shardCol + reflection;
    col += stressColor * stress;
    
    // Draw cracks
    float allCracks = max(max(cracks, ringCracks), shardEdge * shardDetail);
    col = mix(col, crackColor.rgb, allCracks * 0.9);
    
    // Crack glow
    float crackGlow = max(cracks, ringCracks);
    col += crackColor.rgb * crackGlow * 0.3;
    
    // Edge frame highlight
    float frameLine = smoothstep(0.01, 0.005, edgeDist);
    col = mix(col, crackColor.rgb * 0.5, frameLine * 0.5);
    
    // Spider web at impact point
    float impactGlow = exp(-distFromImpact * distFromImpact * 50.0) * 0.4;
    col += crackColor.rgb * impactGlow;
    
    // Falling shard particles
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float px = hash(fi * 13.7) * 0.8 + 0.1;
        float py = fract(hash(fi * 7.3) - t * (0.1 + hash(fi * 3.1) * 0.2));
        float ps = 0.005 + hash(fi * 11.1) * 0.01;
        float pd = length(uv - vec2(px, py));
        float particle = smoothstep(ps, ps * 0.3, pd);
        float sparkle = pow(sin(t * 10.0 + fi * 5.0) * 0.5 + 0.5, 8.0);
        col += crackColor.rgb * particle * sparkle * 0.4;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
