/*{
    "DESCRIPTION": "Atomic Rosette - delicate orbital petals forming flower pattern on deep indigo",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "petalOrbits", "TYPE": "float", "DEFAULT": 7.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "orbitRadius", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.08, "MAX": 0.4},
        {"NAME": "eccentricity", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.2, "MAX": 0.9},
        {"NAME": "lineDelicacy", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.5, "LABEL": "Line Thinness"},
        {"NAME": "innerRosette", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Inner Pattern"},
        {"NAME": "outerHalo", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "bgPurple", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Background Depth"},
        {"NAME": "nucleusGlow", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "petalPhaseOffset", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "secondaryPetals", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "glowSoftness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define SAMPLES 120.0

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Deep indigo/purple background
    float d = length(uv);
    vec3 bg = mix(
        vec3(0.08, 0.05, 0.18) * bgPurple,
        vec3(0.04, 0.02, 0.1) * bgPurple,
        d * 1.5
    );
    vec3 col = bg;
    
    float w = 0.0006 * lineDelicacy;
    
    // === PRIMARY PETAL ORBITS ===
    // Each orbit is a tilted ellipse creating flower pattern
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= petalOrbits) break;
        
        float orbitAngle = i * PI / petalOrbits + petalPhaseOffset;
        float phase = t * (0.2 + i * 0.02);
        
        // Trace elliptical orbit
        vec2 prevProj = vec2(0.0);
        for (float s = 0.0; s < SAMPLES; s++) {
            float a = s / SAMPLES * PI * 2.0 + phase;
            
            float r = orbitRadius;
            float ecc = eccentricity;
            
            // 3D ellipse
            vec3 p = vec3(cos(a) * r, sin(a) * r * ecc, 0.0);
            
            // Tilt to create petal
            float tilt = orbitAngle;
            float ct=cos(tilt), st=sin(tilt);
            p = vec3(p.x*ct - p.z*st, p.y, p.x*st + p.z*ct);
            
            // Gentle overall rotation
            float cr=cos(t*0.05), sr=sin(t*0.05);
            p.xz = vec2(p.x*cr+p.z*sr, -p.x*sr+p.z*cr);
            
            vec2 proj = p.xy;
            float zFade = 0.5 + 0.5 * (0.5 + 0.5*p.z/r);
            
            float pd = length(uv - proj);
            
            // Very thin glowing line
            float glow = w / (pd + w) * zFade;
            
            // Warm rose-gold to cool lavender color
            vec3 petalCol = mix(
                vec3(0.7, 0.5, 0.4),
                vec3(0.5, 0.4, 0.7),
                0.5 + 0.5 * sin(a * 2.0 + i)
            );
            
            col += petalCol * glow * (1.0/SAMPLES) * 3.0;
            
            // Soft outer glow
            col += petalCol * exp(-pd*pd/(0.001*glowSoftness)) * zFade * (1.0/SAMPLES) * 0.15;
        }
    }
    
    // === SECONDARY PETALS (smaller, rotated) ===
    if (secondaryPetals > 0.0) {
        for (float i = 0.0; i < 12.0; i++) {
            if (i >= petalOrbits) break;
            
            float orbitAngle = (i + 0.5) * PI / petalOrbits + petalPhaseOffset;
            float phase = t * (0.15 + i * 0.02);
            
            for (float s = 0.0; s < 60.0; s++) {
                float a = s / 60.0 * PI * 2.0 + phase;
                
                float r = orbitRadius * 0.5;
                vec3 p = vec3(cos(a)*r, sin(a)*r*eccentricity*0.8, 0.0);
                
                float tilt = orbitAngle;
                float ct=cos(tilt), st=sin(tilt);
                p = vec3(p.x*ct, p.y, p.x*st);
                
                float cr=cos(t*0.05), sr=sin(t*0.05);
                p.xz = vec2(p.x*cr+p.z*sr, -p.x*sr+p.z*cr);
                
                vec2 proj = p.xy;
                float pd = length(uv - proj);
                float zFade = 0.5 + 0.5*p.z/r;
                
                vec3 secCol = vec3(0.5, 0.35, 0.55);
                col += secCol * w*0.5 / (pd + w*2.0) * (1.0/60.0) * secondaryPetals * 1.5 * max(zFade,0.2);
            }
        }
    }
    
    // === INNER ROSETTE DETAIL ===
    if (innerRosette > 0.0) {
        // Small inner circles
        for (float i = 0.0; i < 6.0; i++) {
            float a = i * PI / 3.0 + t * 0.1;
            float r = orbitRadius * 0.25;
            vec2 c = r * vec2(cos(a), sin(a));
            float cd = abs(length(uv - c) - r * 0.5);
            col += vec3(0.5, 0.4, 0.6) * w*0.3 / (cd + w*2.0) * innerRosette * 0.3;
        }
        
        // Central atom symbol
        float centerRing = abs(d - orbitRadius*0.15);
        col += vec3(0.6, 0.5, 0.7) * w*0.5 / (centerRing + w*2.0) * innerRosette * 0.2;
    }
    
    // === NUCLEUS ===
    float nucleusPulse = 1.0 + 0.1*sin(t*2.0);
    col += vec3(0.6, 0.45, 0.5) * nucleusGlow * 0.003 / (d*d + 0.002) * nucleusPulse;
    
    // Tiny nucleus dots
    for (float i = 0.0; i < 3.0; i++) {
        float a = i * PI * 2.0 / 3.0 + t * 0.5;
        vec2 np = 0.01 * vec2(cos(a), sin(a));
        float nd = length(uv - np);
        col += vec3(0.7, 0.6, 0.8) * nucleusGlow * 0.001 / (nd*nd + 0.0002);
    }
    
    // === OUTER HALO ===
    if (outerHalo > 0.0) {
        float haloR = orbitRadius * 1.3;
        float haloDist = abs(d - haloR);
        float halo = exp(-haloDist*haloDist*200.0) * outerHalo * 0.2;
        col += vec3(0.4, 0.3, 0.5) * halo;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
