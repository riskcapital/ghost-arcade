/*{
    "DESCRIPTION": "Data stream matrix - falling code columns with parallax depth",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "columnCount", "TYPE": "float", "DEFAULT": 30.0, "MIN": 10.0, "MAX": 60.0},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 0.8},
        {"NAME": "depthLayers", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0},
        {"NAME": "glyphSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.2, "MAX": 1.0},
        {"NAME": "flickerRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorHue", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hue Shift"},
        {"NAME": "headBrightness", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 4.0},
        {"NAME": "bgGlow", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "scanLine", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "CRT Scanlines"}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float glyph(vec2 p, float seed) {
    // Abstract glyph pattern using hash grid
    vec2 g = floor(p * 3.0);
    float h = hash(g + seed);
    float d = length(fract(p * 3.0) - 0.5);
    
    // Mix of dots and dashes
    if (h > 0.6) return smoothstep(0.35, 0.2, d);
    if (h > 0.3) return smoothstep(0.4, 0.35, abs(fract(p.x * 3.0) - 0.5));
    return smoothstep(0.3, 0.2, min(abs(fract(p.x * 3.0) - 0.5), abs(fract(p.y * 3.0) - 0.5)));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    // Base color from hue
    vec3 baseCol = vec3(0.0);
    float h = colorHue;
    baseCol.r = abs(h * 6.0 - 3.0) - 1.0;
    baseCol.g = 2.0 - abs(h * 6.0 - 2.0);
    baseCol.b = 2.0 - abs(h * 6.0 - 4.0);
    baseCol = clamp(baseCol, 0.0, 1.0);
    baseCol = mix(baseCol, vec3(0.5, 0.6, 1.0), 0.3); // Always keep some blue
    
    for (float layer = 0.0; layer < 5.0; layer++) {
        if (layer >= depthLayers) break;
        
        float layerScale = 1.0 + layer * 0.5;
        float layerAlpha = 1.0 / (1.0 + layer * 0.8);
        float layerSpeed = 1.0 - layer * 0.15;
        
        float cols = columnCount / layerScale;
        float colWidth = 1.0 / cols;
        
        float colIdx = floor(uv.x * cols);
        float colFract = fract(uv.x * cols);
        
        float colHash = hash(vec2(colIdx, layer));
        float colHash2 = hash(vec2(colIdx + 100.0, layer));
        
        // Stream head position
        float headY = fract(colHash + t * (0.1 + colHash2 * 0.2) * layerSpeed);
        
        // Distance from stream head
        float distFromHead = headY - uv.y;
        if (distFromHead < 0.0) distFromHead += 1.0;
        
        // Trail fade
        float trail = smoothstep(trailLength, 0.0, distFromHead);
        
        // Head brightness
        float head = smoothstep(0.03, 0.0, distFromHead) * headBrightness;
        
        // Glyph grid
        float cellY = floor(uv.y * cols * glyphSize);
        float glyphSeed = hash(vec2(colIdx, cellY + floor(t * flickerRate * 10.0)));
        
        // Flicker
        float flicker = 1.0;
        if (flickerRate > 0.0) {
            flicker = 0.7 + 0.3 * step(0.3, hash(vec2(colIdx, cellY + floor(t * 5.0 * flickerRate))));
        }
        
        float brightness = (trail + head) * flicker * layerAlpha;
        
        // Glyph shape (centered in column)
        float glyphMask = smoothstep(0.45, 0.3, abs(colFract - 0.5));
        brightness *= glyphMask;
        
        col += baseCol * brightness * (0.3 + 0.7 * trail);
        col += vec3(1.0) * head * 0.3 * layerAlpha; // White head
    }
    
    // Background glow
    float bgNoise = hash(floor(uv * 100.0 + t));
    col += baseCol * bgGlow * 0.02 * bgNoise;
    
    // CRT scanlines
    float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * PI * 2.0);
    col *= 1.0 - scanLine * 0.15 * scan;
    
    // Vignette
    vec2 vig = uv * (1.0 - uv);
    col *= pow(vig.x * vig.y * 16.0, 0.15);
    
    gl_FragColor = vec4(col, 1.0);
}
