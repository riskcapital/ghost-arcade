/*{
    "DESCRIPTION": "Nested rotating gyroscope rings that scale to fit and interact with frame edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "ringCount", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 5.0},
        {"NAME": "ringWidth", "TYPE": "float", "MIN": 0.003, "MAX": 0.02, "DEFAULT": 0.008},
        {"NAME": "rotSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 0.8},
        {"NAME": "baseColor", "TYPE": "color", "DEFAULT": [0.3, 0.6, 1.0, 1.0]},
        {"NAME": "accentColor", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.2, 1.0]},
        {"NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.2},
        {"NAME": "glowStrength", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 center = vec2(0.5);
    vec2 p = (uv - center) * vec2(aspect, 1.0);
    float t = TIME * rotSpeed;
    
    vec3 col = vec3(0.01);
    int count = int(ringCount);
    
    for (int i = 0; i < 8; i++) {
        if (i >= count) break;
        float id = float(i);
        float radius = 0.15 + id * 0.06;
        
        // 3D rotation simulation
        float angleX = t * (0.5 + id * 0.3) + id * 1.047;
        float angleY = t * (0.3 + id * 0.2) + id * 0.785;
        float wobbleAmt = sin(t * 0.5 + id * 2.0) * wobble;
        
        // Tilt the ring (simulated 3D ellipse)
        float tiltX = cos(angleX + wobbleAmt);
        float tiltY = cos(angleY + wobbleAmt * 0.7);
        
        // Ring as ellipse
        float angle = atan(p.y, p.x) + t * (0.2 + id * 0.1);
        float ellipseR = radius / sqrt(pow(cos(angle) * tiltX, 2.0) + pow(sin(angle), 2.0));
        float dist = abs(length(p) - ellipseR);
        
        // Depth-based brightness (front/back)
        float depthFactor = 0.5 + 0.5 * sin(angle + t * id * 0.5);
        
        float ring = smoothstep(ringWidth, ringWidth * 0.1, dist);
        float glow = smoothstep(ringWidth * 6.0, ringWidth * 0.5, dist) * 0.15;
        
        float colorMix = fract(id * 0.2 + sin(t * 0.3) * 0.1);
        vec3 ringCol = mix(baseColor.rgb, accentColor.rgb, colorMix);
        
        col += ringCol * ring * depthFactor;
        col += ringCol * glow * glowStrength * depthFactor;
        
        // Edge interaction: brighten where ring approaches frame edge
        vec2 ringPoint = center + vec2(cos(angle) * ellipseR / aspect, sin(angle) * ellipseR);
        float edgeDist = min(min(ringPoint.x, 1.0 - ringPoint.x), min(ringPoint.y, 1.0 - ringPoint.y));
        if (edgeDist < 0.05 && ring > 0.1) {
            float edgeBright = smoothstep(0.05, 0.0, edgeDist);
            col += accentColor.rgb * ring * edgeBright * 0.5;
        }
    }
    
    // Center glow
    float centerDist = length(p);
    float centerGlow = 0.03 / (centerDist + 0.01);
    col += baseColor.rgb * clamp(centerGlow * 0.05, 0.0, 0.15) * glowStrength;
    
    // Frame edge accent
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += baseColor.rgb * smoothstep(0.015, 0.0, eDist) * 0.15;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
