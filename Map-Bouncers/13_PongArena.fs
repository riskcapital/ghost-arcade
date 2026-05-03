/*{
    "DESCRIPTION": "Autonomous pong-like ball bouncing in the frame with trails and edge reactions",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "ballSpeed", "TYPE": "float", "MIN": 0.2, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "ballGlow", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "edgeReact", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "ballColor", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.1, 1.0]},
        {"NAME": "gridVisible", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15},
        {"NAME": "multiball", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 2.0}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.01);
    
    // Subtle grid
    float gridX = abs(fract(uv.x * 20.0) - 0.5);
    float gridY = abs(fract(uv.y * 20.0) - 0.5);
    float grid = smoothstep(0.48, 0.5, gridX) + smoothstep(0.48, 0.5, gridY);
    col += vec3(grid * gridVisible * 0.1);
    
    // Center line
    float centerLine = smoothstep(0.003, 0.0, abs(uv.x - 0.5)) * 0.1 * gridVisible;
    col += vec3(centerLine);
    
    int balls = int(multiball);
    for (int b = 0; b < 5; b++) {
        if (b >= balls) break;
        float bid = float(b);
        float t = TIME * ballSpeed;
        
        float vx = 0.7 + sin(bid * 2.7) * 0.3;
        float vy = 0.5 + cos(bid * 1.3) * 0.3;
        float startX = fract(sin(bid * 127.1) * 43758.5);
        float startY = fract(sin(bid * 311.7) * 43758.5);
        
        float px = abs(fract((startX + vx * t * 0.1) * 0.5) * 2.0 - 1.0);
        float py = abs(fract((startY + vy * t * 0.1) * 0.5) * 2.0 - 1.0);
        
        vec2 ballPos = vec2(px, py);
        
        // Draw trail
        int trailSteps = int(trailLength * 20.0);
        for (int ti = 1; ti <= 20; ti++) {
            if (ti > trailSteps) break;
            float tOff = float(ti) * 0.005 / ballSpeed;
            float tPast = t - tOff;
            float tpx = abs(fract((startX + vx * tPast * 0.1) * 0.5) * 2.0 - 1.0);
            float tpy = abs(fract((startY + vy * tPast * 0.1) * 0.5) * 2.0 - 1.0);
            vec2 tPos = vec2(tpx, tpy);
            vec2 tDiff = (uv - tPos) * vec2(aspect, 1.0);
            float tDist = length(tDiff);
            float fade = 1.0 - float(ti) / float(trailSteps + 1);
            col += ballColor.rgb * smoothstep(0.015, 0.005, tDist) * fade * 0.15;
        }
        
        // Ball
        vec2 diff = (uv - ballPos) * vec2(aspect, 1.0);
        float dist = length(diff);
        float glow = 0.015 * ballGlow / (dist + 0.001);
        col += ballColor.rgb * clamp(glow * 0.1, 0.0, 0.5);
        float solid = smoothstep(0.015, 0.008, dist);
        col += ballColor.rgb * solid;
        col += vec3(smoothstep(0.005, 0.0, dist) * 0.5);
        
        // Edge reaction flashes
        float edgeProxX = min(ballPos.x, 1.0 - ballPos.x);
        float edgeProxY = min(ballPos.y, 1.0 - ballPos.y);
        
        if (edgeProxX < 0.03) {
            float flashX = (ballPos.x < 0.5) ? 0.0 : 1.0;
            float eDist = abs(uv.x - flashX);
            float flash = smoothstep(0.03, 0.0, eDist) * smoothstep(0.15, 0.0, abs(uv.y - ballPos.y));
            col += ballColor.rgb * flash * edgeReact;
        }
        if (edgeProxY < 0.03) {
            float flashY = (ballPos.y < 0.5) ? 0.0 : 1.0;
            float eDist = abs(uv.y - flashY);
            float flash = smoothstep(0.03, 0.0, eDist) * smoothstep(0.15, 0.0, abs(uv.x - ballPos.x));
            col += ballColor.rgb * flash * edgeReact;
        }
    }
    
    // Frame border
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float border = smoothstep(0.008, 0.004, edgeDist);
    col += vec3(border * 0.2);
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
