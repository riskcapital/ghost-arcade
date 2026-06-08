/*{
    "DESCRIPTION": "Infinite rectangular tunnel starting from the container edge, receding to vanishing point",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "tunnelSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "ringCount", "TYPE": "float", "MIN": 8.0, "MAX": 40.0, "DEFAULT": 22.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.012, "DEFAULT": 0.004},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.6, 1.0]},
        {"NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "vanishX", "TYPE": "float", "MIN": 0.3, "MAX": 0.7, "DEFAULT": 0.5},
        {"NAME": "vanishY", "TYPE": "float", "MIN": 0.3, "MAX": 0.7, "DEFAULT": 0.5},
        {"NAME": "pulse", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "showSpokes", "TYPE": "bool", "DEFAULT": true}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * tunnelSpeed;
    
    vec2 vanish = vec2(vanishX, vanishY);
    vec2 p = uv - vanish;
    
    vec3 col = vec3(0.005);
    int count = int(ringCount);
    
    // Converging lines from edges to vanishing point (spokes)
    if (showSpokes) {
        // Corner lines
        for (int c = 0; c < 4; c++) {
            vec2 corner;
            if (c == 0) corner = vec2(0.0, 0.0);
            else if (c == 1) corner = vec2(1.0, 0.0);
            else if (c == 2) corner = vec2(1.0, 1.0);
            else corner = vec2(0.0, 1.0);
            
            vec2 dir = normalize((corner - vanish) * vec2(aspect, 1.0));
            vec2 uvA = (uv - vanish) * vec2(aspect, 1.0);
            float proj = dot(uvA, dir);
            vec2 closest = dir * proj;
            float dist = length(uvA - closest);
            if (proj > 0.0) {
                float spoke = smoothstep(lineWidth * 0.8, lineWidth * 0.1, dist);
                float fade = smoothstep(0.0, 0.3, proj);
                col += mix(colorA.rgb, colorB.rgb, 0.5) * spoke * fade * 0.15;
            }
        }
    }
    
    // Rectangular rings from edge to center
    for (int i = 0; i < 40; i++) {
        if (i >= count) break;
        float fi = float(i);
        
        // Depth: 0 = at the vanishing point, 1 = at the container edge
        float rawDepth = (fi + fract(t)) / float(count);
        float depth = rawDepth;
        
        // Scale: 1.0 means the rectangle touches the container edges
        // Use exponential scaling for perspective feel
        float scale = depth;
        
        // Twist rotation
        float angle = depth * twist * 3.14159 + t * twist * 0.3;
        float ca = cos(angle);
        float sa = sin(angle);
        vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
        
        // Half-sizes: at scale=1.0 the rect reaches the edge
        // We need to account for the vanishing point offset
        float halfW = scale * max(vanishX, 1.0 - vanishX);
        float halfH = scale * max(vanishY, 1.0 - vanishY);
        
        float px = abs(rp.x);
        float py = abs(rp.y);
        
        float insideX = halfW - px;
        float insideY = halfH - py;
        float rectDist;
        if (insideX > 0.0 && insideY > 0.0) {
            rectDist = min(insideX, insideY);
        } else {
            rectDist = length(max(vec2(-insideX, -insideY), 0.0));
        }
        
        float pulseFactor = 1.0 + sin(t * 3.0 + fi * 0.4) * pulse * 0.3;
        float lw = lineWidth * (0.3 + scale * 0.7);
        float ring = smoothstep(lw, lw * 0.1, rectDist);
        float glow = smoothstep(lw * 4.0, lw * 0.3, rectDist) * 0.06;
        
        float alpha = scale * pulseFactor;
        alpha = clamp(alpha, 0.0, 1.0);
        
        vec3 ringCol = mix(colorB.rgb, colorA.rgb, depth);
        col += ringCol * (ring * 0.8 + glow) * alpha;
        
        // Corner brightening
        float cx = abs(px - halfW);
        float cy = abs(py - halfH);
        float cDist = length(vec2(cx, cy));
        col += ringCol * smoothstep(lw * 3.0, 0.0, cDist) * alpha * 0.25;
    }
    
    // Outer container edge glow
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgePulse = 0.5 + 0.5 * sin(t * 2.0);
    col += colorA.rgb * smoothstep(0.015, 0.0, eDist) * 0.25 * edgePulse;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
