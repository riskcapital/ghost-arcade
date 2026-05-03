/*{
    "DESCRIPTION": "Digital rain columns falling within the frame, pooling at the bottom edge",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "columns", "TYPE": "float", "MIN": 10.0, "MAX": 60.0, "DEFAULT": 30.0},
        {"NAME": "fallSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 1.5},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.1, "MAX": 0.6, "DEFAULT": 0.3},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "primaryColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.3, 1.0]},
        {"NAME": "headColor", "TYPE": "color", "DEFAULT": [0.8, 1.0, 0.9, 1.0]},
        {"NAME": "poolGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * fallSpeed;
    vec3 col = vec3(0.005, 0.01, 0.005);
    
    float colWidth = 1.0 / columns;
    float colIndex = floor(uv.x / colWidth);
    float colUV = fract(uv.x / colWidth);
    
    // Column center emphasis
    float colCenter = 1.0 - abs(colUV - 0.5) * 2.0;
    colCenter = pow(colCenter, 2.0);
    
    // Multiple streams per column
    for (int s = 0; s < 3; s++) {
        float streamId = colIndex + float(s) * 100.0;
        float speed_var = 0.5 + hash(streamId * 73.1) * 1.0;
        float phase = hash(streamId * 311.7);
        float headY = fract(-(t * speed_var * 0.15 + phase));
        
        // Trail
        float distFromHead = uv.y - headY;
        if (distFromHead > 0.0 && distFromHead < trailLength) {
            float trail = 1.0 - distFromHead / trailLength;
            trail = pow(trail, 2.0);
            
            // Character flicker
            float charSize = 0.02;
            float charIndex = floor(uv.y / charSize);
            float flicker = step(0.3, hash2(vec2(charIndex, colIndex + TIME * 5.0)));
            
            col += primaryColor.rgb * trail * colCenter * flicker * brightness * 0.4;
        }
        
        // Head (brightest point)
        float headDist = abs(uv.y - headY);
        float head = smoothstep(0.015, 0.0, headDist) * colCenter;
        col += headColor.rgb * head * brightness;
    }
    
    // Pool at bottom
    float poolIntensity = 0.0;
    for (int c = 0; c < 30; c++) {
        if (float(c) >= columns) break;
        float cid = float(c);
        float cx = (cid + 0.5) * colWidth;
        float dist = abs(uv.x - cx);
        float contrib = smoothstep(colWidth, 0.0, dist);
        // Streams contribute to pool based on timing
        for (int s = 0; s < 2; s++) {
            float sid = cid + float(s) * 100.0;
            float spd = 0.5 + hash(sid * 73.1) * 1.0;
            float ph = hash(sid * 311.7);
            float headY = fract(-(t * spd * 0.15 + ph));
            if (headY < 0.1) poolIntensity += contrib * (0.1 - headY) * 2.0;
        }
    }
    
    float poolY = 0.03 + sin(uv.x * 20.0 + TIME * 2.0) * 0.005;
    if (uv.y < poolY) {
        col += primaryColor.rgb * poolGlow * 0.3 * (poolY - uv.y) / poolY;
    }
    col += primaryColor.rgb * smoothstep(0.01, 0.0, abs(uv.y - poolY)) * poolGlow * 0.2;
    
    // Side edge glow
    float sideGlow = smoothstep(0.03, 0.0, uv.x) + smoothstep(0.97, 1.0, uv.x);
    col += primaryColor.rgb * sideGlow * 0.05;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
