/*{
    "DESCRIPTION": "Infinite tunnel of rectangular frames receding into the center with parallax depth",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "tunnelSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "ringDensity", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.015, "DEFAULT": 0.005},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.6, 1.0]},
        {"NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "pulse", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "sway", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * tunnelSpeed;
    
    vec2 center = vec2(0.5 + sin(t * 0.3) * sway, 0.5 + cos(t * 0.2) * sway);
    vec2 p = uv - center;
    
    vec3 col = vec3(0.005);
    
    // Rectangular distance (Chebyshev)
    float maxCoord = max(abs(p.x * aspect), abs(p.y));
    
    // Animated depth
    float depth = maxCoord;
    float tunnelZ = fract(log(depth + 0.001) * ringDensity * 0.5 - t);
    
    // Draw rings at different depths
    for (int i = 0; i < 30; i++) {
        float fi = float(i);
        if (fi >= ringDensity) break;
        
        float ringDepth = (fi + fract(-t)) / ringDensity;
        float scale = exp(-ringDepth * 3.0);
        
        float angle = ringDepth * twist * 6.2832 + t * twist * 0.5;
        float ca = cos(angle);
        float sa = sin(angle);
        vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
        rp *= vec2(aspect, 1.0);
        
        // Rectangular frame at this depth
        float halfSize = scale * 0.45;
        float px = abs(rp.x);
        float py = abs(rp.y);
        
        // Distance to rectangle
        float dx = abs(px - halfSize);
        float dy = abs(py - halfSize);
        float rectDist;
        if (px <= halfSize && py <= halfSize) {
            rectDist = min(dx, dy);
        } else {
            rectDist = length(max(vec2(px - halfSize, py - halfSize), 0.0));
        }
        
        float lw = lineWidth * scale * 3.0;
        float pulseFactor = 1.0 + sin(t * 3.0 + fi * 0.5) * pulse * 0.3;
        float ring = smoothstep(lw, lw * 0.1, rectDist);
        float glow = smoothstep(lw * 5.0, lw * 0.5, rectDist) * 0.1;
        
        float alpha = scale * pulseFactor;
        alpha = clamp(alpha, 0.0, 1.0);
        
        vec3 ringCol = mix(colorA.rgb, colorB.rgb, ringDepth);
        
        col += ringCol * (ring + glow) * alpha;
        
        // Corner highlights
        float cornerX = abs(px - halfSize);
        float cornerY = abs(py - halfSize);
        float cornerDist = length(vec2(cornerX, cornerY));
        float corner = smoothstep(lw * 2.0, 0.0, cornerDist) * alpha * 0.3;
        col += ringCol * corner;
    }
    
    // Outer frame edge glow that pulses
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgePulse = 0.5 + 0.5 * sin(t * 2.0);
    col += colorA.rgb * smoothstep(0.02, 0.0, eDist) * 0.2 * edgePulse;
    
    // Scanlines for depth effect
    float scan = sin(uv.y * RENDERSIZE.y * 0.5) * 0.03;
    col += vec3(scan * 0.5);
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
