/*{
    "DESCRIPTION": "Particle nodes connected by lines that bounce off all frame edges - network graph style",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "nodeCount", "TYPE": "float", "MIN": 4.0, "MAX": 16.0, "DEFAULT": 10.0},
        {"NAME": "nodeSize", "TYPE": "float", "MIN": 0.005, "MAX": 0.03, "DEFAULT": 0.012},
        {"NAME": "connectionDist", "TYPE": "float", "MIN": 0.1, "MAX": 0.6, "DEFAULT": 0.35},
        {"NAME": "lineThickness", "TYPE": "float", "MIN": 0.001, "MAX": 0.008, "DEFAULT": 0.003},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.6},
        {"NAME": "nodeColor", "TYPE": "color", "DEFAULT": [0.3, 0.8, 1.0, 1.0]},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.2, 0.5, 0.8, 1.0]},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0}
    ]
}*/

vec2 getNodePos(float id) {
    float t = TIME * speed;
    float px = fract(sin(id * 127.1 + 311.7) * 43758.5453);
    float py = fract(sin(id * 269.5 + 183.3) * 43758.5453);
    float vx = sin(id * 1.3 + 0.7) * 0.4 + sin(id * 3.7) * 0.15;
    float vy = cos(id * 2.1 + 0.3) * 0.35 + cos(id * 4.1) * 0.1;
    float margin = 0.02;
    float x = abs(fract((px + vx * t * 0.1) * 0.5) * 2.0 - 1.0) * (1.0 - 2.0 * margin) + margin;
    float y = abs(fract((py + vy * t * 0.1) * 0.5) * 2.0 - 1.0) * (1.0 - 2.0 * margin) + margin;
    return vec2(x, y);
}

float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    vec2 closest = a + t * ab;
    return length(p - closest);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.01, 0.01, 0.02);
    int count = int(nodeCount);
    
    // Draw connections
    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        vec2 posA = getNodePos(float(i));
        for (int j = 0; j < 16; j++) {
            if (j >= count || j <= i) break;
            vec2 posB = getNodePos(float(j));
            float nodeDist = length((posA - posB) * vec2(aspect, 1.0));
            if (nodeDist < connectionDist) {
                float segDist = distToSegment(uv * vec2(aspect, 1.0), posA * vec2(aspect, 1.0), posB * vec2(aspect, 1.0));
                float lineAlpha = smoothstep(lineThickness, lineThickness * 0.3, segDist);
                float fade = 1.0 - (nodeDist / connectionDist);
                float pulse = 0.7 + 0.3 * sin(TIME * pulseSpeed + float(i + j) * 0.5);
                col += lineColor.rgb * lineAlpha * fade * pulse * 0.6;
            }
        }
    }
    
    // Draw nodes
    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        vec2 pos = getNodePos(float(i));
        vec2 diff = (uv - pos) * vec2(aspect, 1.0);
        float dist = length(diff);
        float glow = nodeSize * 2.0 / (dist + 0.001);
        glow = clamp(glow, 0.0, 4.0);
        col += nodeColor.rgb * glow * 0.08;
        float solid = smoothstep(nodeSize, nodeSize * 0.5, dist);
        col += nodeColor.rgb * solid;
        float ring = smoothstep(nodeSize * 1.3, nodeSize * 1.1, dist) - smoothstep(nodeSize * 1.1, nodeSize * 0.9, dist);
        float ringPulse = 0.5 + 0.5 * sin(TIME * pulseSpeed * 2.0 + float(i));
        col += nodeColor.rgb * ring * ringPulse * 0.5;
    }
    
    // Edge frame glow
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeGlow = smoothstep(0.03, 0.0, edgeDist) * 0.15;
    col += lineColor.rgb * edgeGlow;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
