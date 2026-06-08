/*{
    "DESCRIPTION": "Radar Sweep - Rotating scan from centroid with edge contacts lighting up as sonar hits",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "sweepWidth", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.05, "MAX": 0.8},
        {"NAME": "ringCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "blipSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "fadeTrail", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "sweepColor", "TYPE": "color", "DEFAULT": [0.1, 1.0, 0.3, 1.0]},
        {"NAME": "gridColor", "TYPE": "color", "DEFAULT": [0.0, 0.3, 0.1, 1.0]},
        {"NAME": "blipColor", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.4, 1.0]},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.02, 1.0]},
        {"NAME": "scanLines", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Centroid
    vec2 center = vec2(0.5);
    vec2 p = uv - center;
    p.x *= aspect;
    float dist = length(p);
    float angle = atan(p.y, p.x);
    
    // Edge distances
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    vec3 col = bgColor.rgb;
    
    // CRT scanlines
    if (scanLines > 0.0) {
        float scan = sin(uv.y * RENDERSIZE.y * 0.5) * 0.5 + 0.5;
        col *= 0.9 + scan * 0.1 * scanLines;
    }
    
    // Range rings
    for (int i = 0; i < 10; i++) {
        if (float(i) >= ringCount) break;
        float fi = float(i) + 1.0;
        float ringR = fi / (ringCount + 1.0) * 0.5;
        float ringDist = abs(dist - ringR);
        float ring = smoothstep(0.003, 0.001, ringDist);
        col += gridColor.rgb * ring * 0.5;
    }
    
    // Cross-hairs
    float crossH = smoothstep(0.003, 0.001, abs(p.x)) * step(abs(p.y), 0.5);
    float crossV = smoothstep(0.003, 0.001, abs(p.y)) * step(abs(p.x), 0.5);
    col += gridColor.rgb * (crossH + crossV) * 0.3;
    
    // Rotating sweep beam
    float sweepAngle = t * 3.14159;
    float angleDiff = mod(angle - sweepAngle + 3.14159, 6.28318) - 3.14159;
    
    // Sweep trail (fades behind the beam)
    float sweep = 0.0;
    if (angleDiff < 0.0 && angleDiff > -3.14159 * sweepWidth * 2.0) {
        sweep = 1.0 + angleDiff / (3.14159 * sweepWidth * 2.0);
        sweep = pow(sweep, 2.0 / fadeTrail);
    }
    
    // Beam line
    float beamLine = exp(-angleDiff * angleDiff * 500.0);
    sweep = max(sweep, beamLine);
    
    col += sweepColor.rgb * sweep * 0.4 * smoothstep(0.5, 0.0, dist);
    
    // Edge contact blips - where sweep hits edges
    float edgeBlips = 0.0;
    for (int i = 0; i < 20; i++) {
        float fi = float(i);
        // Fixed blip positions near edges
        float bx = hash(fi * 7.3) * 0.9 + 0.05;
        float by = hash(fi * 13.1) * 0.9 + 0.05;
        vec2 blipPos = vec2(bx, by);
        
        // Only show blips near edges
        float blipEdgeDist = min(min(bx, 1.0 - bx), min(by, 1.0 - by));
        if (blipEdgeDist > 0.1) continue;
        
        // Blip angle from center
        vec2 bp = blipPos - center;
        bp.x *= aspect;
        float blipAngle = atan(bp.y, bp.x);
        float blipDist = length(bp);
        
        // Time since sweep passed this blip
        float blipAngleDiff = mod(sweepAngle - blipAngle + 3.14159, 6.28318) - 3.14159;
        float timeSinceSweep = blipAngleDiff / (speed * 3.14159);
        
        if (timeSinceSweep > 0.0 && timeSinceSweep < 2.0 * fadeTrail) {
            float fade = exp(-timeSinceSweep * 3.0 / fadeTrail);
            float d = length((uv - blipPos) * vec2(aspect, 1.0));
            float blip = smoothstep(blipSize * 0.015, blipSize * 0.005, d) * fade;
            float blipGlow = exp(-d * d * 2000.0) * fade * 0.5;
            
            col += blipColor.rgb * (blip + blipGlow);
        }
    }
    
    // Center dot
    float centerDot = smoothstep(0.008, 0.003, dist);
    col += sweepColor.rgb * centerDot;
    
    // Edge proximity indicator
    float edgeIndicator = exp(-edgeDist * 20.0) * 0.15;
    col += sweepColor.rgb * edgeIndicator * (0.5 + 0.5 * sin(t * 4.0));
    
    // Vignette
    float vignette = 1.0 - dist * 0.5;
    col *= vignette;
    
    gl_FragColor = vec4(col, 1.0);
}
