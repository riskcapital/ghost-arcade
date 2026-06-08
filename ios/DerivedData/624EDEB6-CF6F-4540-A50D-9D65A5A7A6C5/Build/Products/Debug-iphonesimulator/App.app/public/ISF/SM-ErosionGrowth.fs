/*{
    "DESCRIPTION": "Erosion Growth - Crystalline structures grow inward from edges like frost on a window",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "growthRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "branchDetail", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "crystalScale", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 20.0},
        {"NAME": "symmetry", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "crystalColor", "TYPE": "color", "DEFAULT": [0.7, 0.85, 1.0, 1.0]},
        {"NAME": "tipColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "baseColor", "TYPE": "color", "DEFAULT": [0.15, 0.2, 0.35, 1.0]},
        {"NAME": "thickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "sparkle", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

// Dendrite / frost pattern
float dendrite(vec2 p, float seed) {
    float angle = atan(p.y, p.x);
    float r = length(p);
    
    // Symmetry fold
    float sym = symmetry;
    float foldAngle = mod(angle + 3.14159, 6.28318 / sym) - 3.14159 / sym;
    vec2 folded = vec2(cos(foldAngle), abs(sin(foldAngle))) * r;
    
    // Main branch
    float branch = abs(folded.y) - thickness * 0.02 * (1.0 - folded.x * 2.0);
    branch = smoothstep(0.01, -0.005, branch) * step(0.0, folded.x);
    
    // Sub-branches
    float subBranch = 0.0;
    for (int i = 1; i < 6; i++) {
        float fi = float(i);
        if (fi > branchDetail * 5.0) break;
        float branchPos = fi * 0.08;
        if (folded.x < branchPos) continue;
        
        vec2 bp = folded - vec2(branchPos, 0.0);
        float bAngle = 0.6 + fi * 0.1;
        vec2 rotBp = vec2(
            bp.x * cos(bAngle) + bp.y * sin(bAngle),
            -bp.x * sin(bAngle) + bp.y * cos(bAngle)
        );
        
        float bLen = (0.15 - fi * 0.02) * branchDetail;
        float bLine = abs(rotBp.y) - thickness * 0.008 * (1.0 - rotBp.x / bLen);
        float bMask = step(0.0, rotBp.x) * step(rotBp.x, bLen);
        subBranch += smoothstep(0.005, -0.002, bLine) * bMask;
    }
    
    return min(branch + subBranch, 1.0);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    // Edge distance
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    // Growth front - advances from edges inward
    float growthFront = fract(t * growthRate * 0.2) * 0.6;
    float inGrowthZone = smoothstep(growthFront + 0.05, growthFront - 0.02, edgeDist);
    
    vec3 col = baseColor.rgb;
    
    // Frost patterns growing from each edge
    float frost = 0.0;
    
    // Bottom edge growth
    vec2 pB = vec2(uv.x - 0.5, uv.y) * crystalScale;
    frost += dendrite(pB + vec2(0.0, -0.1), 0.0) * smoothstep(growthFront, 0.0, edgeB);
    
    // Top edge growth
    vec2 pT = vec2(uv.x - 0.5, -(1.0 - uv.y)) * crystalScale;
    frost += dendrite(pT + vec2(0.0, -0.1), 100.0) * smoothstep(growthFront, 0.0, edgeT);
    
    // Left edge growth
    vec2 pL = vec2(uv.y - 0.5, uv.x) * crystalScale;
    frost += dendrite(pL + vec2(0.0, -0.1), 200.0) * smoothstep(growthFront, 0.0, edgeL);
    
    // Right edge growth
    vec2 pR = vec2(uv.y - 0.5, -(1.0 - uv.x)) * crystalScale;
    frost += dendrite(pR + vec2(0.0, -0.1), 300.0) * smoothstep(growthFront, 0.0, edgeR);
    
    // Corner crystallizations
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0);
    corners[1] = vec2(1.0, 0.0);
    corners[2] = vec2(1.0, 1.0);
    corners[3] = vec2(0.0, 1.0);
    
    for (int i = 0; i < 4; i++) {
        vec2 cp = (uv - corners[i]) * crystalScale * 0.7;
        float cornerFrost = dendrite(cp, float(i) * 50.0 + 500.0);
        float cornerDist = length(uv - corners[i]);
        frost += cornerFrost * smoothstep(growthFront * 1.5, 0.0, cornerDist);
    }
    
    frost = min(frost, 1.0);
    
    // Organic noise overlay on frost
    float frostNoise = fbm(uv * crystalScale * 2.0 + t * 0.1);
    frost *= 0.7 + frostNoise * 0.3 * branchDetail;
    
    // Crystal coloring
    vec3 crystalCol = mix(crystalColor.rgb, tipColor.rgb, frost * 0.5);
    
    // Growing tip glow
    float tipDist = abs(edgeDist - growthFront);
    float tipGlow = exp(-tipDist * tipDist * 500.0) * frost;
    crystalCol += tipColor.rgb * tipGlow * 0.5;
    
    // Sparkle highlights
    float sparklePattern = noise(uv * 80.0 + t * 2.0);
    float sparkleThresh = 1.0 - sparkle * 0.15;
    float sparkleMask = step(sparkleThresh, sparklePattern) * frost;
    float sparkleAnim = pow(sin(t * 8.0 + hash2(floor(uv * 80.0)) * 6.28) * 0.5 + 0.5, 8.0);
    
    // Ice thickness creates depth
    float iceDepth = frost * (1.0 - edgeDist * 2.0);
    crystalCol *= 0.8 + iceDepth * 0.4;
    
    // Apply frost over base
    col = mix(col, crystalCol, frost * inGrowthZone);
    col += tipColor.rgb * sparkleMask * sparkleAnim * sparkle;
    
    // Edge rim frost (always present)
    float edgeFrost = exp(-edgeDist * 30.0) * 0.3;
    col += crystalColor.rgb * edgeFrost;
    
    gl_FragColor = vec4(col, 1.0);
}
