/*{
    "DESCRIPTION": "Electric Fence - Electricity arcs between nearest edge points, crawling the perimeter and jumping across narrow sections",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "boltCount", "TYPE": "float", "DEFAULT": 6.0, "MIN": 1.0, "MAX": 12.0},
        {"NAME": "boltWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "jaggedness", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "glowIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "crawlSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "boltColor", "TYPE": "color", "DEFAULT": [0.5, 0.7, 1.0, 1.0]},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.8, 1.0]},
        {"NAME": "coreColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "branchiness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

// Lightning bolt distance function
float boltLine(vec2 uv, vec2 a, vec2 b, float seed, float t) {
    vec2 dir = b - a;
    float len = length(dir);
    vec2 norm = dir / max(len, 0.001);
    
    float minDist = 999.0;
    int segments = 20;
    vec2 prev = a;
    
    for (int i = 1; i <= 20; i++) {
        float fi = float(i) / float(segments);
        vec2 p = a + dir * fi;
        
        // Jagged displacement perpendicular to bolt direction
        float disp = noise(vec2(fi * 8.0 + seed, t * 5.0 * speed + seed)) * 2.0 - 1.0;
        disp += noise(vec2(fi * 16.0 + seed, t * 8.0 * speed + seed * 2.0)) * 0.5 - 0.25;
        disp *= jaggedness * 0.08 * sin(fi * 3.14159);
        
        vec2 perp = vec2(-norm.y, norm.x);
        p += perp * disp;
        
        // Distance to this segment
        vec2 pa = uv - prev;
        vec2 ba = p - prev;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);
        
        prev = p;
    }
    
    return minDist;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME;
    
    // Edge distances
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    vec3 col = vec3(0.0);
    
    // Crawling edge energy
    float perim = 0.0;
    float totalPerim = 2.0 * (1.0 + 1.0); // normalized perimeter
    if (edgeL <= edgeR && edgeL <= edgeB && edgeL <= edgeT) {
        perim = 1.0 - uv.y;
    } else if (edgeT <= edgeR && edgeT <= edgeB) {
        perim = (1.0) + uv.x;
    } else if (edgeR <= edgeB) {
        perim = (2.0) + uv.y;
    } else {
        perim = (3.0) + (1.0 - uv.x);
    }
    float crawl = sin(perim * 20.0 - t * crawlSpeed * 10.0) * 0.5 + 0.5;
    crawl = pow(crawl, 3.0);
    float edgeCrawl = crawl * exp(-edgeDist * 40.0) * 0.5;
    col += boltColor.rgb * edgeCrawl;
    
    // Main bolts between edges
    for (int i = 0; i < 12; i++) {
        if (float(i) >= boltCount) break;
        float fi = float(i);
        float seed = fi * 17.3 + 5.7;
        
        // Bolt flicker timing
        float flickerPhase = hash(fi * 3.7 + floor(t * 3.0)) ;
        float flicker = step(0.3, flickerPhase);
        if (flicker < 0.5) continue;
        
        // Choose start/end points on edges
        float startEdge = mod(fi, 4.0);
        float endEdge = mod(fi + 1.0 + floor(hash(fi * 11.3) * 3.0), 4.0);
        
        vec2 startPt, endPt;
        float st = fract(hash(fi * 7.1) + t * crawlSpeed * 0.2);
        float et = fract(hash(fi * 13.3) + t * crawlSpeed * 0.15);
        
        if (startEdge < 1.0) startPt = vec2(0.0, st);
        else if (startEdge < 2.0) startPt = vec2(1.0, st);
        else if (startEdge < 3.0) startPt = vec2(st, 0.0);
        else startPt = vec2(st, 1.0);
        
        if (endEdge < 1.0) endPt = vec2(0.0, et);
        else if (endEdge < 2.0) endPt = vec2(1.0, et);
        else if (endEdge < 3.0) endPt = vec2(et, 0.0);
        else endPt = vec2(et, 1.0);
        
        float bDist = boltLine(uv, startPt, endPt, seed, t);
        
        float w = boltWidth * 0.003;
        float core = exp(-bDist * bDist / (w * w));
        float glow = exp(-bDist * bDist / (w * w * 20.0)) * glowIntensity;
        float outerGlow = exp(-bDist * bDist / (w * w * 100.0)) * glowIntensity * 0.3;
        
        col += coreColor.rgb * core * flicker;
        col += boltColor.rgb * glow * flicker;
        col += glowColor.rgb * outerGlow * flicker;
        
        // Branch bolts
        if (branchiness > 0.1) {
            for (int j = 0; j < 3; j++) {
                float fj = float(j);
                float bt = 0.2 + fj * 0.3;
                vec2 branchStart = mix(startPt, endPt, bt);
                float bAngle = (hash(fi * 5.3 + fj * 11.7) - 0.5) * 2.0;
                vec2 branchEnd = branchStart + vec2(cos(bAngle), sin(bAngle)) * 0.15 * branchiness;
                branchEnd = clamp(branchEnd, vec2(0.0), vec2(1.0));
                
                float brDist = boltLine(uv, branchStart, branchEnd, seed + fj * 100.0, t);
                float brCore = exp(-brDist * brDist / (w * w * 0.5));
                float brGlow = exp(-brDist * brDist / (w * w * 10.0)) * glowIntensity * 0.5;
                
                col += coreColor.rgb * brCore * flicker * branchiness * 0.5;
                col += boltColor.rgb * brGlow * flicker * branchiness * 0.3;
            }
        }
    }
    
    // Corner spark nodes
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0);
    corners[1] = vec2(1.0, 0.0);
    corners[2] = vec2(1.0, 1.0);
    corners[3] = vec2(0.0, 1.0);
    
    for (int i = 0; i < 4; i++) {
        float d = length(uv - corners[i]);
        float spark = exp(-d * d * 200.0) * (0.5 + 0.5 * sin(t * 10.0 + float(i) * 1.5));
        col += coreColor.rgb * spark * 0.5;
    }
    
    // Ambient edge glow
    float ambientEdge = exp(-edgeDist * 15.0) * 0.15;
    col += glowColor.rgb * ambientEdge;
    
    gl_FragColor = vec4(col, 1.0);
}
