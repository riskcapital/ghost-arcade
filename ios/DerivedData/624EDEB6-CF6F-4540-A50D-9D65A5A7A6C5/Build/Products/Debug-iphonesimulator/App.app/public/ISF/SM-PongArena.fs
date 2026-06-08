/*{
    "DESCRIPTION": "Autonomous multi-ball pong bouncing in the frame with trails and edge reactions",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "ballCount", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0},
        {"NAME": "ballSpeed", "TYPE": "float", "MIN": 0.2, "MAX": 3.0, "DEFAULT": 1.2},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "ballGlow", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.5},
        {"NAME": "edgeReact", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8},
        {"NAME": "sizeVariation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "colorSpread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.008);
    int count = int(ballCount);
    
    for (int b = 0; b < 30; b++) {
        if (b >= count) break;
        float bid = float(b);
        float t = TIME * ballSpeed;
        
        float vx = 0.3 + hash(bid * 17.3) * 0.8;
        float vy = 0.2 + hash(bid * 31.7) * 0.7;
        vx *= (hash(bid * 53.1) > 0.5) ? 1.0 : -1.0;
        vy *= (hash(bid * 67.3) > 0.5) ? 1.0 : -1.0;
        float startX = hash(bid * 127.1);
        float startY = hash(bid * 311.7);
        
        float px = abs(fract((startX + vx * t * 0.08) * 0.5) * 2.0 - 1.0);
        float py = abs(fract((startY + vy * t * 0.08) * 0.5) * 2.0 - 1.0);
        
        vec2 ballPos = vec2(px, py);
        float ballSize = 0.006 + hash(bid * 93.7) * 0.014 * sizeVariation;
        float hue = fract(bid * 0.07 + colorSpread * hash(bid * 41.3));
        vec3 ballCol = hsv2rgb(vec3(hue, 0.85, 1.0));
        
        // Trail
        int trailSteps = int(trailLength * 15.0);
        for (int ti = 1; ti <= 15; ti++) {
            if (ti > trailSteps) break;
            float tOff = float(ti) * 0.004 / ballSpeed;
            float tPast = t - tOff;
            float tpx = abs(fract((startX + vx * tPast * 0.08) * 0.5) * 2.0 - 1.0);
            float tpy = abs(fract((startY + vy * tPast * 0.08) * 0.5) * 2.0 - 1.0);
            vec2 tDiff = (uv - vec2(tpx, tpy)) * vec2(aspect, 1.0);
            float tDist = length(tDiff);
            float fade = 1.0 - float(ti) / float(trailSteps + 1);
            col += ballCol * smoothstep(ballSize * 1.8, ballSize * 0.2, tDist) * fade * 0.1;
        }
        
        // Ball body + glow
        vec2 diff = (uv - ballPos) * vec2(aspect, 1.0);
        float dist = length(diff);
        float glow = ballSize * ballGlow / (dist + 0.001);
        col += ballCol * clamp(glow * 0.035, 0.0, 0.35);
        float solid = smoothstep(ballSize, ballSize * 0.3, dist);
        col += ballCol * solid;
        col += vec3(smoothstep(ballSize * 0.25, 0.0, dist) * 0.5);
        
        // Edge flashes
        float epx = min(ballPos.x, 1.0 - ballPos.x);
        float epy = min(ballPos.y, 1.0 - ballPos.y);
        if (epx < 0.04) {
            float fx = (ballPos.x < 0.5) ? 0.0 : 1.0;
            float ed = abs(uv.x - fx);
            col += ballCol * smoothstep(0.04, 0.0, ed) * smoothstep(0.25, 0.0, abs(uv.y - ballPos.y)) * edgeReact * 0.5;
        }
        if (epy < 0.04) {
            float fy = (ballPos.y < 0.5) ? 0.0 : 1.0;
            float ed = abs(uv.y - fy);
            col += ballCol * smoothstep(0.04, 0.0, ed) * smoothstep(0.25, 0.0, abs(uv.x - ballPos.x)) * edgeReact * 0.5;
        }
    }
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += vec3(smoothstep(0.005, 0.001, edgeDist) * 0.12);
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
