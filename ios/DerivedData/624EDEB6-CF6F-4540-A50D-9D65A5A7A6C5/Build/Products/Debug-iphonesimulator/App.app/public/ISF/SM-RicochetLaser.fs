/*{
    "DESCRIPTION": "Ricochet Laser - A laser beam bounces at reflection angles off every wall with fading trails and interference",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "laserCount", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "bounceCount", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "beamWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "trailFade", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "laserColor", "TYPE": "color", "DEFAULT": [1.0, 0.1, 0.1, 1.0]},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.2, 1.0]},
        {"NAME": "impactColor", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.4, 1.0]},
        {"NAME": "trailColor", "TYPE": "color", "DEFAULT": [0.5, 0.1, 0.05, 1.0]},
        {"NAME": "interference", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }

// Line segment distance
float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Compute ray bounce in a unit box
void bounceRay(inout vec2 pos, inout vec2 dir) {
    // Find nearest wall intersection
    vec2 tMin = (vec2(0.0) - pos) / dir;
    vec2 tMax = (vec2(1.0) - pos) / dir;
    
    vec2 t1 = min(tMin, tMax);
    vec2 t2 = max(tMin, tMax);
    
    // We need the smallest positive t
    float tHit = 1e10;
    int hitAxis = 0; // 0 = x wall, 1 = y wall
    
    for (int i = 0; i < 2; i++) {
        float tv = (i == 0) ? t2.x : t2.y;
        if (tv > 0.001 && tv < tHit) {
            tHit = tv;
            hitAxis = i;
        }
    }
    
    pos = pos + dir * tHit;
    pos = clamp(pos, vec2(0.001), vec2(0.999));
    
    if (hitAxis == 0) dir.x = -dir.x;
    else dir.y = -dir.y;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    vec3 col = vec3(0.01);
    float totalGlow = 0.0;
    
    // Multiple laser beams
    for (int L = 0; L < 6; L++) {
        if (float(L) >= laserCount) break;
        float fL = float(L);
        float seed = fL * 7.3;
        
        // Entry point and angle animated
        float entryAngle = t * 0.5 + fL * 2.094;
        vec2 pos = vec2(
            fract(sin(seed + 1.0) * 43758.5 + t * 0.1),
            0.0
        );
        vec2 dir = normalize(vec2(
            cos(entryAngle + hash(seed) * 3.0),
            sin(entryAngle + hash(seed + 1.0) * 1.5 + 0.5)
        ));
        
        // Make sure direction goes into the box
        if (pos.y <= 0.01) dir.y = abs(dir.y);
        if (pos.y >= 0.99) dir.y = -abs(dir.y);
        if (pos.x <= 0.01) dir.x = abs(dir.x);
        if (pos.x >= 0.99) dir.x = -abs(dir.x);
        
        // Trace bounces
        vec3 beamCol = laserColor.rgb;
        if (fL > 0.5 && fL < 1.5) beamCol = vec3(0.1, 1.0, 0.2);
        if (fL > 1.5 && fL < 2.5) beamCol = vec3(0.2, 0.4, 1.0);
        if (fL > 2.5) beamCol = laserColor.rgb * vec3(1.0, 0.5, 0.2);
        
        for (int b = 0; b < 40; b++) {
            if (float(b) >= bounceCount) break;
            
            vec2 prevPos = pos;
            bounceRay(pos, dir);
            
            float fb = float(b);
            float fade = pow(trailFade, fb * 0.5);
            
            // Beam line
            float d = segDist(uv, prevPos, pos);
            float w = beamWidth * 0.003;
            
            float core = exp(-d * d / (w * w * 0.5)) * fade;
            float glow = exp(-d * d / (w * w * 8.0)) * fade * 0.5;
            float outerGlow = exp(-d * d / (w * w * 40.0)) * fade * 0.15;
            
            col += beamCol * core;
            col += glowColor.rgb * glow;
            col += trailColor.rgb * outerGlow;
            
            // Impact flash at bounce point
            float impactD = length(uv - pos);
            float impact = exp(-impactD * impactD * 3000.0) * fade;
            col += impactColor.rgb * impact * 0.8;
            
            // Scatter sparks at impact
            for (int s = 0; s < 3; s++) {
                float fs = float(s);
                float sparkAngle = hash(fb * 3.0 + fs * 7.0 + seed) * 6.28;
                float sparkLen = 0.01 + hash(fb * 5.0 + fs * 11.0 + seed) * 0.02;
                vec2 sparkEnd = pos + vec2(cos(sparkAngle), sin(sparkAngle)) * sparkLen;
                float sparkD = segDist(uv, pos, sparkEnd);
                col += impactColor.rgb * exp(-sparkD * sparkD * 10000.0) * fade * 0.3;
            }
            
            totalGlow += glow * fade;
        }
    }
    
    // Interference pattern where beams cross
    if (interference > 0.0) {
        float interf = sin(totalGlow * 50.0 * interference) * 0.5 + 0.5;
        col *= 0.8 + interf * 0.2 * interference;
    }
    
    // Edge glow from nearby beams
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeReflect = exp(-edgeDist * 30.0) * totalGlow * 0.2;
    col += glowColor.rgb * edgeReflect;
    
    gl_FragColor = vec4(col, 1.0);
}
