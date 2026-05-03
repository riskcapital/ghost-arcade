/*{
    "DESCRIPTION": "Spider Web - Structural web strands anchor to edges and corners with tension lines and dew drops",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "radialStrands", "TYPE": "float", "DEFAULT": 16.0, "MIN": 6.0, "MAX": 30.0},
        {"NAME": "spiralDensity", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "strandWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "dewDrops", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "webColor", "TYPE": "color", "DEFAULT": [0.8, 0.8, 0.85, 1.0]},
        {"NAME": "dewColor", "TYPE": "color", "DEFAULT": [0.9, 0.95, 1.0, 1.0]},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.3, 0.4, 0.6, 1.0]},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.04, 1.0]},
        {"NAME": "windStrength", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
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

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    // Web center (slightly off-center for natural look)
    vec2 center = vec2(0.48 + sin(t * 0.3) * 0.02, 0.52 + cos(t * 0.2) * 0.02);
    
    // Wind displacement
    vec2 wind = vec2(sin(t * 2.0), cos(t * 1.5)) * windStrength * 0.01;
    vec2 displaced = uv + wind * (length(uv - center));
    
    vec2 toCenter = displaced - center;
    float dist = length(toCenter);
    float angle = atan(toCenter.y, toCenter.x);
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    vec3 col = bgColor.rgb;
    float webMask = 0.0;
    
    // Radial strands from center to edges
    float radialAngle = mod(angle + 3.14159, 6.28318) / 6.28318 * radialStrands;
    float radialFrac = fract(radialAngle);
    float radialDist = min(radialFrac, 1.0 - radialFrac) * dist * 6.0;
    float radialLine = smoothstep(strandWidth * 0.02, strandWidth * 0.005, radialDist);
    
    // Strands sag slightly from wind
    float sag = sin(angle * 3.0 + t) * windStrength * 0.01 * dist;
    
    webMask += radialLine * 0.7;
    
    // Spiral capture threads
    float spiralR = dist * spiralDensity;
    float spiralAngle = angle / 6.28318;
    float spiralFrac = fract(spiralR - spiralAngle * 2.0);
    float spiralDist = min(spiralFrac, 1.0 - spiralFrac) / spiralDensity * 5.0;
    
    // Spiral only between certain radii and with some irregularity
    float spiralMask = step(0.05, dist) * step(dist, 0.45);
    float irregularity = 0.8 + 0.2 * noise(vec2(angle * 5.0, dist * 10.0));
    float spiralLine = smoothstep(strandWidth * 0.015, strandWidth * 0.003, spiralDist) * spiralMask * irregularity;
    
    webMask += spiralLine * 0.5;
    
    // Anchor strands to edges (from center toward corners and edge midpoints)
    vec2 anchors[8];
    anchors[0] = vec2(0.0, 0.0);
    anchors[1] = vec2(1.0, 0.0);
    anchors[2] = vec2(1.0, 1.0);
    anchors[3] = vec2(0.0, 1.0);
    anchors[4] = vec2(0.5, 0.0);
    anchors[5] = vec2(1.0, 0.5);
    anchors[6] = vec2(0.5, 1.0);
    anchors[7] = vec2(0.0, 0.5);
    
    for (int i = 0; i < 8; i++) {
        vec2 dir = anchors[i] - center;
        float len = length(dir);
        vec2 norm = dir / len;
        vec2 perp = vec2(-norm.y, norm.x);
        
        vec2 toP = displaced - center;
        float along = dot(toP, norm);
        float across = abs(dot(toP, perp));
        
        // Catenary sag
        float sagAmount = sin(along / len * 3.14159) * windStrength * 0.02;
        across = abs(across - sagAmount);
        
        if (along > 0.0 && along < len) {
            float anchorLine = smoothstep(strandWidth * 0.012, strandWidth * 0.003, across);
            webMask += anchorLine * 0.4;
        }
    }
    
    webMask = min(webMask, 1.0);
    
    // Web strand rendering with shimmer
    float shimmer = 0.7 + 0.3 * sin(dist * 50.0 + angle * 10.0 + t * 3.0);
    col += webColor.rgb * webMask * shimmer * 0.6;
    
    // Dew drops at strand intersections
    if (dewDrops > 0.0) {
        // Drops on spiral-radial intersections
        for (int i = 0; i < 20; i++) {
            float fi = float(i);
            float dropAngle = fi / 20.0 * 6.28318;
            for (int j = 0; j < 8; j++) {
                float fj = float(j);
                float dropR = 0.06 + fj * 0.05;
                vec2 dropPos = center + vec2(cos(dropAngle), sin(dropAngle)) * dropR;
                dropPos += wind * dropR; // wind displaces drops
                
                float d = length(uv - dropPos);
                float dropSize = 0.004 + hash(fi * 7.0 + fj * 13.0) * 0.003;
                
                if (d < dropSize * 2.0) {
                    float drop = smoothstep(dropSize, dropSize * 0.3, d);
                    float highlight = smoothstep(dropSize * 0.7, dropSize * 0.2, 
                        length(uv - dropPos + vec2(dropSize * 0.3)));
                    col += dewColor.rgb * drop * dewDrops * 0.6;
                    col += vec3(highlight * dewDrops * 0.4);
                }
            }
        }
    }
    
    // Subtle edge glow
    float edgeGlow = exp(-edgeDist * 15.0) * 0.08;
    col += glowColor.rgb * edgeGlow;
    
    gl_FragColor = vec4(col, 1.0);
}
