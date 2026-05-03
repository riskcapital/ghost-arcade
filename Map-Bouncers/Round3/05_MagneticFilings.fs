/*{
    "DESCRIPTION": "Magnetic Filings - Thousands of particles align along field lines anchored to corners and concave points",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "fieldStrength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "filingDensity", "TYPE": "float", "DEFAULT": 40.0, "MIN": 10.0, "MAX": 80.0},
        {"NAME": "filingLength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "poleCount", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "filingColor", "TYPE": "color", "DEFAULT": [0.6, 0.6, 0.65, 1.0]},
        {"NAME": "fieldColor", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.5, 1.0]},
        {"NAME": "poleGlow", "TYPE": "color", "DEFAULT": [0.4, 0.6, 1.0, 1.0]},
        {"NAME": "metalSheen", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "polarity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Define magnetic poles at corners and edge midpoints
    vec2 poles[8];
    poles[0] = vec2(0.0, 0.0);
    poles[1] = vec2(1.0, 0.0);
    poles[2] = vec2(1.0, 1.0);
    poles[3] = vec2(0.0, 1.0);
    poles[4] = vec2(0.5, 0.0);
    poles[5] = vec2(1.0, 0.5);
    poles[6] = vec2(0.5, 1.0);
    poles[7] = vec2(0.0, 0.5);
    
    // Animate pole positions slightly
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        poles[i] += vec2(sin(t + fi * 1.7), cos(t * 0.8 + fi * 2.3)) * 0.03;
    }
    
    // Calculate magnetic field direction at this point
    vec2 field = vec2(0.0);
    float totalField = 0.0;
    
    for (int i = 0; i < 8; i++) {
        if (float(i) >= poleCount) break;
        float fi = float(i);
        vec2 diff = uv - poles[i];
        diff.x *= aspect;
        float dist = length(diff) + 0.01;
        float sign = (mod(fi, 2.0) < 1.0) ? 1.0 : -1.0;
        sign = mix(sign, 1.0, 1.0 - polarity);
        
        vec2 dir = normalize(diff) * sign;
        float strength = fieldStrength / (dist * dist + 0.1);
        field += dir * strength;
        totalField += strength;
    }
    
    field = normalize(field);
    float fieldMag = length(field);
    float fieldAngle = atan(field.y, field.x);
    
    vec3 col = vec3(0.02);
    
    // Field line visualization (subtle background)
    float fieldLines = sin(fieldAngle * 20.0) * 0.5 + 0.5;
    fieldLines = pow(fieldLines, 4.0);
    col += fieldColor.rgb * fieldLines * 0.05;
    
    // Iron filings as oriented line segments
    float filings = 0.0;
    float gridSize = filingDensity;
    
    vec2 cellId = floor(uv * gridSize);
    
    for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
            vec2 neighborCell = cellId + vec2(float(dx), float(dy));
            
            // Random position within cell
            vec2 filingPos = (neighborCell + vec2(
                hash2(neighborCell),
                hash2(neighborCell + 200.0)
            )) / gridSize;
            
            // Calculate field at filing position
            vec2 localField = vec2(0.0);
            for (int i = 0; i < 8; i++) {
                if (float(i) >= poleCount) break;
                float fi = float(i);
                vec2 diff = filingPos - poles[i];
                diff.x *= aspect;
                float dist = length(diff) + 0.01;
                float sign = (mod(fi, 2.0) < 1.0) ? 1.0 : -1.0;
                sign = mix(sign, 1.0, 1.0 - polarity);
                localField += normalize(diff) * sign * fieldStrength / (dist * dist + 0.1);
            }
            vec2 filingDir = normalize(localField);
            
            // Filing line segment
            float fLen = filingLength * 0.01;
            vec2 toUv = uv - filingPos;
            toUv.x *= aspect;
            
            // Project onto filing direction
            float along = dot(toUv, filingDir);
            float perp = abs(dot(toUv, vec2(-filingDir.y, filingDir.x)));
            
            float inLength = step(abs(along), fLen);
            float inWidth = smoothstep(fLen * 0.15, fLen * 0.05, perp);
            
            // Metallic brightness variation
            float shimmer = 0.7 + 0.3 * sin(hash2(neighborCell) * 100.0 + t * 2.0);
            
            filings += inLength * inWidth * shimmer;
        }
    }
    
    // Metallic sheen on filings
    vec3 filingCol = filingColor.rgb;
    float sheen = pow(abs(sin(fieldAngle * 3.0 + t)), 4.0) * metalSheen;
    filingCol += vec3(sheen * 0.3);
    
    col += filingCol * min(filings, 1.0) * 0.8;
    
    // Pole glow
    for (int i = 0; i < 8; i++) {
        if (float(i) >= poleCount) break;
        float fi = float(i);
        vec2 diff = uv - poles[i];
        diff.x *= aspect;
        float dist = length(diff);
        
        float sign = (mod(fi, 2.0) < 1.0) ? 1.0 : -1.0;
        vec3 pCol = (sign > 0.0) ? poleGlow.rgb : poleGlow.rgb * vec3(1.0, 0.5, 0.5);
        
        float glow = exp(-dist * dist * 80.0) * 0.5;
        float pulse = 0.8 + 0.2 * sin(t * 3.0 + fi * 1.5);
        col += pCol * glow * pulse;
    }
    
    // Edge proximity field concentration
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeField = exp(-edgeDist * 15.0) * 0.1;
    col += fieldColor.rgb * edgeField;
    
    gl_FragColor = vec4(col, 1.0);
}
