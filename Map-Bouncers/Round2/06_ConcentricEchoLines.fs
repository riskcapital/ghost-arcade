/*{
    "DESCRIPTION": "Concentric rectangular frames starting from the container edge, receding into center with depth",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "layerCount", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 16.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.015, "DEFAULT": 0.004},
        {"NAME": "animSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 0.7},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.1},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.6, 1.0, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.5, 1.0]},
        {"NAME": "breathe", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "perspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 center = vec2(0.5, 0.5);
    float t = TIME * animSpeed;
    vec3 col = vec3(0.008);
    int layers = int(layerCount);
    
    for (int i = 0; i < 30; i++) {
        if (i >= layers) break;
        float fi = float(i);
        float depth = fi / float(layers);
        
        // Scale from 1.0 (full container edge) down to near-zero (center)
        float scale = 1.0 - depth;
        float breathAmt = sin(t * 1.5 + fi * 0.4) * breathe * 0.03;
        scale += breathAmt;
        scale = max(scale, 0.01);
        
        // Rotation increases with depth
        float angle = fi * rotationSpeed * 0.15 + t * rotationSpeed * 0.3;
        float ca = cos(angle);
        float sa = sin(angle);
        
        vec2 p = uv - center;
        vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
        
        // Half-sizes: at scale=1.0 this is exactly 0.5 (touching container edge)
        float halfW = scale * 0.5;
        float halfH = scale * 0.5;
        
        // Perspective shift - deeper layers offset slightly
        float offX = sin(t * 0.2 + fi * 0.3) * perspective * depth * 0.03;
        float offY = cos(t * 0.15 + fi * 0.5) * perspective * depth * 0.02;
        rp -= vec2(offX, offY);
        
        float px = abs(rp.x);
        float py = abs(rp.y);
        
        // Distance to rectangle edges
        float insideX = halfW - px;
        float insideY = halfH - py;
        float rectDist;
        if (insideX > 0.0 && insideY > 0.0) {
            rectDist = min(insideX, insideY);
        } else {
            rectDist = length(max(vec2(-insideX, -insideY), 0.0));
        }
        
        float pulse = 0.5 + 0.5 * sin(t * 2.5 - fi * 0.6);
        float lw = lineWidth * (0.6 + pulse * 0.4);
        float line = smoothstep(lw, lw * 0.15, rectDist);
        float glow = smoothstep(lw * 5.0, lw * 0.5, rectDist) * 0.08;
        
        float alpha = (1.0 - depth * 0.5) * (0.5 + pulse * 0.5);
        vec3 lineCol = mix(colorA.rgb, colorB.rgb, depth);
        
        col += lineCol * (line + glow) * alpha;
        
        // Corner accents - brighter at corners
        float cornerX = abs(px - halfW);
        float cornerY = abs(py - halfH);
        float cornerDist = length(vec2(cornerX, cornerY));
        float corner = smoothstep(lw * 3.0, 0.0, cornerDist) * alpha * 0.4;
        col += vec3(1.0) * corner * 0.3;
    }
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
