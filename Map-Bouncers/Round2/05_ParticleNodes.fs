/*{
    "DESCRIPTION": "Dense particle network with visible connection lines and depth layers bouncing off edges",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "nodeCount", "TYPE": "float", "MIN": 8.0, "MAX": 30.0, "DEFAULT": 20.0},
        {"NAME": "nodeSize", "TYPE": "float", "MIN": 0.004, "MAX": 0.025, "DEFAULT": 0.01},
        {"NAME": "connectionDist", "TYPE": "float", "MIN": 0.15, "MAX": 0.6, "DEFAULT": 0.4},
        {"NAME": "lineThickness", "TYPE": "float", "MIN": 0.001, "MAX": 0.01, "DEFAULT": 0.004},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "depthLayers", "TYPE": "float", "MIN": 1.0, "MAX": 3.0, "DEFAULT": 2.0},
        {"NAME": "nodeColor", "TYPE": "color", "DEFAULT": [0.3, 0.85, 1.0, 1.0]},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.15, 0.4, 0.7, 1.0]},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec2 getNodePos(float id, float layer) {
    float t = TIME * speed * (0.5 + layer * 0.5);
    float px = hash(id * 127.1 + layer * 1000.0);
    float py = hash(id * 311.7 + layer * 2000.0);
    float vx = sin(id * 1.3 + 0.7 + layer * 3.0) * 0.5 + sin(id * 3.7 + layer) * 0.2;
    float vy = cos(id * 2.1 + 0.3 + layer * 2.0) * 0.4 + cos(id * 4.1 + layer) * 0.15;
    float m = 0.03;
    float x = abs(fract((px + vx * t * 0.08) * 0.5) * 2.0 - 1.0) * (1.0 - 2.0 * m) + m;
    float y = abs(fract((py + vy * t * 0.08) * 0.5) * 2.0 - 1.0) * (1.0 - 2.0 * m) + m;
    return vec2(x, y);
}

float distToSeg(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + t * ab));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 uvA = vec2(uv.x * aspect, uv.y);
    vec3 col = vec3(0.008, 0.01, 0.018);
    int count = int(nodeCount);
    int layers = int(depthLayers);
    
    for (int L = 0; L < 3; L++) {
        if (L >= layers) break;
        float layer = float(L);
        float layerAlpha = 1.0 - layer * 0.3;
        float layerScale = 1.0 - layer * 0.15;
        vec3 lNodeCol = nodeColor.rgb * layerAlpha;
        vec3 lLineCol = lineColor.rgb * layerAlpha;
        float lNodeSize = nodeSize * layerScale;
        float lLineW = lineThickness * layerScale;
        
        // Draw connections first (behind nodes)
        for (int i = 0; i < 30; i++) {
            if (i >= count) break;
            vec2 posA = getNodePos(float(i), layer);
            vec2 posAa = vec2(posA.x * aspect, posA.y);
            for (int j = 0; j < 30; j++) {
                if (j >= count || j <= i) break;
                vec2 posB = getNodePos(float(j), layer);
                vec2 posBa = vec2(posB.x * aspect, posB.y);
                float nd = length(posAa - posBa);
                if (nd < connectionDist) {
                    float sd = distToSeg(uvA, posAa, posBa);
                    float fade = 1.0 - (nd / connectionDist);
                    fade = fade * fade;
                    float pulse = 0.6 + 0.4 * sin(TIME * pulseSpeed + float(i + j) * 0.3);
                    // Thicker, more visible lines
                    float lineAlpha = smoothstep(lLineW, lLineW * 0.15, sd);
                    float lineGlow = smoothstep(lLineW * 4.0, lLineW * 0.5, sd) * 0.15;
                    col += lLineCol * (lineAlpha * 0.7 + lineGlow) * fade * pulse;
                    
                    // Data pulse traveling along line
                    float pulsePos = fract(TIME * pulseSpeed * 0.3 + float(i) * 0.1);
                    vec2 pulsePoint = mix(posAa, posBa, pulsePos);
                    float pulseDist = length(uvA - pulsePoint);
                    col += lNodeCol * smoothstep(0.015, 0.003, pulseDist) * fade * 0.4;
                }
            }
        }
        
        // Draw nodes
        for (int i = 0; i < 30; i++) {
            if (i >= count) break;
            vec2 pos = getNodePos(float(i), layer);
            vec2 posA2 = vec2(pos.x * aspect, pos.y);
            float dist = length(uvA - posA2);
            
            // Outer glow
            float glow = lNodeSize * 3.0 / (dist + 0.001);
            col += lNodeCol * clamp(glow * 0.03, 0.0, 0.25);
            // Solid core
            float solid = smoothstep(lNodeSize, lNodeSize * 0.3, dist);
            col += lNodeCol * solid * 0.9;
            // Bright center
            col += vec3(smoothstep(lNodeSize * 0.4, 0.0, dist) * 0.5) * layerAlpha;
            // Pulsing ring
            float ring = smoothstep(lNodeSize * 1.6, lNodeSize * 1.3, dist) - smoothstep(lNodeSize * 1.3, lNodeSize * 1.0, dist);
            float ringP = 0.5 + 0.5 * sin(TIME * pulseSpeed * 2.0 + float(i));
            col += lNodeCol * ring * ringP * 0.6;
        }
    }
    
    // Edge frame glow
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += lineColor.rgb * smoothstep(0.025, 0.0, eDist) * 0.2;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
