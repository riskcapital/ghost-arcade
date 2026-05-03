/*{
    "DESCRIPTION": "Laser beams that bounce and reflect off all frame edges like a laser light show",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "beamCount", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "beamWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.015, "DEFAULT": 0.004},
        {"NAME": "bounces", "TYPE": "float", "MIN": 2.0, "MAX": 12.0, "DEFAULT": 6.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.7},
        {"NAME": "glowSize", "TYPE": "float", "MIN": 0.005, "MAX": 0.05, "DEFAULT": 0.02},
        {"NAME": "hueOffset", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0},
        {"NAME": "trailFade", "TYPE": "float", "MIN": 0.3, "MAX": 1.0, "DEFAULT": 0.8}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + t * ab));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.005);
    int bCount = int(beamCount);
    int bMax = int(bounces);
    
    for (int b = 0; b < 6; b++) {
        if (b >= bCount) break;
        float bid = float(b);
        float t = TIME * speed + bid * 1.7;
        
        // Starting point and direction
        float startAngle = sin(t * 0.3 + bid * 2.1) * 0.8 + bid * 1.047;
        vec2 dir = normalize(vec2(cos(startAngle), sin(startAngle)));
        vec2 pos = vec2(0.5 + sin(t * 0.2 + bid) * 0.3, 0.5 + cos(t * 0.15 + bid * 1.5) * 0.3);
        
        float hue = fract(bid * 0.33 + hueOffset);
        vec3 beamCol = hsv2rgb(vec3(hue, 0.9, 1.0));
        
        for (int i = 0; i < 12; i++) {
            if (i >= bMax) break;
            
            // Find intersection with frame edges
            float tMin = 1000.0;
            vec2 normal = vec2(0.0);
            
            if (dir.x > 0.001) { float tt = (1.0 - pos.x) / dir.x; if (tt > 0.001 && tt < tMin) { tMin = tt; normal = vec2(-1,0); } }
            if (dir.x < -0.001) { float tt = -pos.x / dir.x; if (tt > 0.001 && tt < tMin) { tMin = tt; normal = vec2(1,0); } }
            if (dir.y > 0.001) { float tt = (1.0 - pos.y) / dir.y; if (tt > 0.001 && tt < tMin) { tMin = tt; normal = vec2(0,-1); } }
            if (dir.y < -0.001) { float tt = -pos.y / dir.y; if (tt > 0.001 && tt < tMin) { tMin = tt; normal = vec2(0,1); } }
            
            vec2 hitPoint = pos + dir * tMin;
            hitPoint = clamp(hitPoint, 0.0, 1.0);
            
            // Draw beam segment
            vec2 uvAspect = vec2(uv.x * aspect, uv.y);
            vec2 posAspect = vec2(pos.x * aspect, pos.y);
            vec2 hitAspect = vec2(hitPoint.x * aspect, hitPoint.y);
            float dist = distToSegment(uvAspect, posAspect, hitAspect);
            
            float fade = pow(trailFade, float(i));
            float beam = smoothstep(beamWidth + glowSize, beamWidth * 0.2, dist);
            col += beamCol * beam * fade * 0.4;
            float glow = (beamWidth * 3.0) / (dist + 0.001);
            col += beamCol * clamp(glow * 0.01, 0.0, 0.3) * fade;
            
            // Hit point glow
            float hitDist = length(uvAspect - hitAspect);
            float hitGlow = smoothstep(0.02, 0.0, hitDist) * fade;
            col += beamCol * hitGlow * 0.5;
            
            // Reflect
            dir = reflect(dir, normal);
            pos = hitPoint + dir * 0.001;
        }
    }
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
