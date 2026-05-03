/*{
    "DESCRIPTION": "Hexagonal geometric tiles creating a deep abyss receding from the container edges into infinity",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "depthLayers", "TYPE": "float", "MIN": 5.0, "MAX": 25.0, "DEFAULT": 14.0},
        {"NAME": "tileScale", "TYPE": "float", "MIN": 3.0, "MAX": 15.0, "DEFAULT": 8.0},
        {"NAME": "animSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.6},
        {"NAME": "colorTop", "TYPE": "color", "DEFAULT": [0.2, 0.6, 0.9, 1.0]},
        {"NAME": "colorDeep", "TYPE": "color", "DEFAULT": [0.05, 0.02, 0.15, 1.0]},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "separation", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.04},
        {"NAME": "sinkCenter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
}

vec4 hexCoord(vec2 uv) {
    vec2 r = vec2(1.0, 1.73);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = uv - gv;
    return vec4(gv, id);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * animSpeed;
    
    vec3 col = colorDeep.rgb;
    int layers = int(depthLayers);
    
    // Distance from container edge determines base depth
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float centerDist = length(uv - vec2(0.5));
    
    // Draw layers from deepest to surface
    for (int i = 0; i < 25; i++) {
        int li = layers - 1 - i;
        if (li < 0) break;
        float fi = float(li);
        float depth = fi / float(layers);
        
        // Each layer is slightly smaller and offset
        float scale = 1.0 - depth * 0.8;
        vec2 layerUV = (uv - 0.5) / scale + 0.5;
        
        // Skip if outside container
        if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) continue;
        
        // Hex grid at this layer
        vec2 hexUV = layerUV * tileScale * vec2(aspect, 1.0);
        vec4 hc = hexCoord(hexUV);
        float hDist = hexDist(hc.xy);
        float hID = hash(hc.zw + fi * 100.0);
        
        // Each hex tile sinks at different rate
        float sinkThreshold = mix(centerDist * 2.0, hID, sinkCenter);
        float tileSink = sin(t + hID * 6.2832 + fi * 0.3) * 0.5 + 0.5;
        float tileDepth = depth + tileSink * 0.05;
        
        // Hex edge line
        float hexEdge = smoothstep(0.5 - separation, 0.5 - separation + 0.02, hDist);
        float hexFill = 1.0 - hexEdge;
        
        // Color based on depth
        vec3 tileCol = mix(colorTop.rgb, colorDeep.rgb, tileDepth);
        tileCol *= 0.8 + hID * 0.2;
        
        // Lighting: top-lit
        float shade = 0.7 + 0.3 * (1.0 - depth);
        tileCol *= shade;
        
        // Step shadow between layers
        float stepShadow = smoothstep(0.5, 0.45, hDist) * 0.15 * depth;
        tileCol -= vec3(stepShadow);
        
        // Pulse glow on some tiles
        float pulseOn = step(0.7, hID);
        float pulse = sin(t * 2.0 + hID * 10.0) * 0.5 + 0.5;
        tileCol += colorTop.rgb * pulseOn * pulse * edgeGlow * 0.15 * (1.0 - depth);
        
        col = mix(col, tileCol, hexFill * (1.0 - depth * 0.3));
        
        // Hex edge lines
        float edgeLine = smoothstep(0.5, 0.48, hDist) * smoothstep(0.42, 0.44, hDist);
        col += colorTop.rgb * edgeLine * 0.05 * (1.0 - depth);
    }
    
    // Container edge frame
    float frameDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += colorTop.rgb * smoothstep(0.01, 0.0, frameDist) * edgeGlow * 0.3;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
