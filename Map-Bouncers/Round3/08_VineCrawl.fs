/*{
    "DESCRIPTION": "Vine Crawl - Organic tendrils grow along edges then branch inward like ivy overtaking a wall",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "vineCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 16.0},
        {"NAME": "branchDepth", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "vineWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "leafDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "vineColor", "TYPE": "color", "DEFAULT": [0.15, 0.4, 0.1, 1.0]},
        {"NAME": "leafColor", "TYPE": "color", "DEFAULT": [0.2, 0.6, 0.15, 1.0]},
        {"NAME": "flowerColor", "TYPE": "color", "DEFAULT": [0.8, 0.3, 0.5, 1.0]},
        {"NAME": "tipColor", "TYPE": "color", "DEFAULT": [0.5, 0.8, 0.3, 1.0]},
        {"NAME": "glowAmount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
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
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
}

// Soft line segment distance
float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    vec3 col = vec3(0.02, 0.03, 0.02);
    float vineMask = 0.0;
    float leafMask = 0.0;
    float flowerMask = 0.0;
    
    // Edge vines - crawl along perimeter
    float perim = 0.0;
    vec2 edgeNormal = vec2(0.0);
    if (uv.x <= 1.0 - uv.x && uv.x <= uv.y && uv.x <= 1.0 - uv.y) {
        perim = uv.y;
        edgeNormal = vec2(1.0, 0.0);
    } else if (1.0 - uv.x <= uv.y && 1.0 - uv.x <= 1.0 - uv.y) {
        perim = 1.0 + (1.0 - uv.y);
        edgeNormal = vec2(-1.0, 0.0);
    } else if (uv.y <= 1.0 - uv.y) {
        perim = 3.0 + uv.x;
        edgeNormal = vec2(0.0, 1.0);
    } else {
        perim = 2.0 + (1.0 - uv.x);
        edgeNormal = vec2(0.0, -1.0);
    }
    
    // Multiple vine strands along edges
    for (int v = 0; v < 16; v++) {
        if (float(v) >= vineCount) break;
        float fv = float(v);
        float seed = fv * 17.3;
        
        // Vine grows along edge with wobble inward
        float growth = fract(t * 0.2 + hash(seed) * 5.0);
        float vinePerim = hash(seed + 1.0) * 4.0;
        
        // Sample vine path as curve
        int segments = 15;
        for (int s = 0; s < 14; s++) {
            float fs = float(s);
            float t0 = fs / float(segments);
            float t1 = (fs + 1.0) / float(segments);
            
            if (t0 > growth) break;
            
            // Points along edge with inward wobble
            float wobble0 = noise(vec2(t0 * 10.0 + seed, fv)) * 0.08 * branchDepth;
            float wobble1 = noise(vec2(t1 * 10.0 + seed, fv)) * 0.08 * branchDepth;
            
            // Map back to UV space along nearest edge
            vec2 p0, p1;
            float edgeSide = mod(fv, 4.0);
            if (edgeSide < 1.0) { // left
                p0 = vec2(wobble0, t0);
                p1 = vec2(wobble1, t1);
            } else if (edgeSide < 2.0) { // right
                p0 = vec2(1.0 - wobble0, t0);
                p1 = vec2(1.0 - wobble1, t1);
            } else if (edgeSide < 3.0) { // bottom
                p0 = vec2(t0, wobble0);
                p1 = vec2(t1, wobble1);
            } else { // top
                p0 = vec2(t0, 1.0 - wobble0);
                p1 = vec2(t1, 1.0 - wobble1);
            }
            
            float d = segDist(uv, p0, p1);
            float w = vineWidth * 0.005 * (1.0 - t0 * 0.5);
            vineMask += smoothstep(w, w * 0.2, d);
            
            // Branch inward at intervals
            if (mod(fs, 3.0) < 1.0 && branchDepth > 0.2) {
                float bAngle = (hash(seed + fs * 7.0) - 0.5) * 1.5;
                vec2 bDir;
                if (edgeSide < 1.0) bDir = vec2(1.0, bAngle);
                else if (edgeSide < 2.0) bDir = vec2(-1.0, bAngle);
                else if (edgeSide < 3.0) bDir = vec2(bAngle, 1.0);
                else bDir = vec2(bAngle, -1.0);
                bDir = normalize(bDir);
                
                float bLen = 0.05 + hash(seed + fs * 3.0) * 0.1 * branchDepth;
                vec2 bEnd = p0 + bDir * bLen;
                
                float bd = segDist(uv, p0, bEnd);
                float bw = w * 0.6;
                vineMask += smoothstep(bw, bw * 0.2, bd) * 0.8;
                
                // Leaf at branch end
                if (leafDensity > 0.2) {
                    float ld = length(uv - bEnd);
                    float leafSize = 0.012 + hash(seed + fs) * 0.008;
                    vec2 leafDir = normalize(bDir);
                    vec2 toLeaf = (uv - bEnd);
                    float leafShape = length(vec2(dot(toLeaf, leafDir) * 1.5, dot(toLeaf, vec2(-leafDir.y, leafDir.x))));
                    leafMask += smoothstep(leafSize, leafSize * 0.3, leafShape) * leafDensity;
                }
                
                // Occasional flower
                if (hash(seed + fs * 11.0) > 0.7) {
                    float fd = length(uv - bEnd);
                    float petalAngle = atan(uv.y - bEnd.y, uv.x - bEnd.x);
                    float petals = sin(petalAngle * 5.0 + t) * 0.003;
                    flowerMask += smoothstep(0.01 + petals, 0.003, fd) * leafDensity;
                }
            }
        }
    }
    
    vineMask = min(vineMask, 1.0);
    leafMask = min(leafMask, 1.0);
    flowerMask = min(flowerMask, 1.0);
    
    // Vine texture
    float vineNoise = fbm(uv * 30.0) * 0.3;
    vec3 vCol = vineColor.rgb * (0.8 + vineNoise);
    
    // Compose
    col = mix(col, vCol, vineMask);
    col = mix(col, leafColor.rgb * (0.8 + vineNoise * 0.5), leafMask);
    col = mix(col, flowerColor.rgb, flowerMask);
    
    // Bioluminescent glow
    if (glowAmount > 0.0) {
        float glow = (vineMask + leafMask * 0.5) * glowAmount;
        float glowPulse = sin(t * 3.0 + uv.x * 10.0 + uv.y * 10.0) * 0.5 + 0.5;
        col += tipColor.rgb * glow * glowPulse * 0.3;
    }
    
    // Edge ambient
    float edgeGlow = exp(-edgeDist * 20.0) * 0.1;
    col += vineColor.rgb * edgeGlow;
    
    gl_FragColor = vec4(col, 1.0);
}
