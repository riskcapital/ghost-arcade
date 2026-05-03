/*{
    "DESCRIPTION": "Concentric echo layers of lines radiating from center, creating depth within the frame",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "layerCount", "TYPE": "float", "MIN": 3.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.006},
        {"NAME": "animSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 0.8},
        {"NAME": "depthScale", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.6, 1.0, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.5, 1.0]},
        {"NAME": "perspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 center = vec2(0.5, 0.5);
    vec2 p = uv - center;
    p.x *= aspect;
    
    float t = TIME * animSpeed;
    vec3 col = vec3(0.01);
    int layers = int(layerCount);
    
    for (int i = 0; i < 20; i++) {
        if (i >= layers) break;
        float fi = float(i);
        float depth = fi / float(layers);
        float scale = 1.0 - depth * depthScale * 0.4;
        float angle = fi * rotationSpeed * 0.3 + t * rotationSpeed * (1.0 + fi * 0.1);
        float ca = cos(angle);
        float sa = sin(angle);
        vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca) / scale;
        
        // Rectangular frame at this depth
        float px = abs(rp.x);
        float py = abs(rp.y);
        float halfW = (0.5 - depth * 0.03 * perspective) * aspect * 0.55;
        float halfH = (0.5 - depth * 0.03 * perspective) * 0.55;
        
        // Distance to rectangle edges
        float dx = abs(px - halfW);
        float dy = abs(py - halfH);
        float rectDist = min(dx, dy);
        if (px > halfW || py > halfH) {
            rectDist = length(max(vec2(px - halfW, py - halfH), 0.0));
        }
        
        float pulse = 0.5 + 0.5 * sin(t * 2.0 - fi * 0.8);
        float lw = lineWidth * (0.5 + pulse * 0.5) * (1.0 + depth * 0.5);
        float line = smoothstep(lw, lw * 0.2, rectDist);
        float alpha = (1.0 - depth * 0.7) * (0.4 + pulse * 0.6);
        
        vec3 lineCol = mix(colorA.rgb, colorB.rgb, depth + sin(t + fi) * 0.2);
        col += lineCol * line * alpha;
        
        // Corner accents
        float cornerDist = length(vec2(px - halfW, py - halfH));
        float corner = smoothstep(0.02, 0.005, cornerDist) * alpha * 0.5;
        col += lineCol * corner;
    }
    
    // Subtle vignette
    float vignette = 1.0 - length(uv - center) * 0.5;
    col *= vignette;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
