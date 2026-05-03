/*{
    "DESCRIPTION": "Plasma containment - tokamak magnetic confinement with particles",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "torusMajor", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.1, "MAX": 0.4, "LABEL": "Torus Major R"},
        {"NAME": "torusMinor", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.02, "MAX": 0.15, "LABEL": "Torus Minor R"},
        {"NAME": "plasmaTemp", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0, "LABEL": "Temperature"},
        {"NAME": "magneticCoils", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 24.0},
        {"NAME": "coilVisibility", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "instability", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "viewAngle", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "particleDensity", "TYPE": "float", "DEFAULT": 40.0, "MIN": 10.0, "MAX": 80.0},
        {"NAME": "containmentField", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1,0)), f.x),
               mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), f.x), f.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Flatten view for top-down with tilt
    vec2 p = uv;
    p.y /= mix(1.0, 0.4, viewAngle); // Perspective squash
    
    float d = length(p);
    float angle = atan(p.y, p.x);
    
    vec3 col = vec3(0.02, 0.02, 0.04);
    
    // Torus distance (2D cross-section of torus from above)
    float torusDist = abs(d - torusMajor);
    float inTorus = smoothstep(torusMinor + 0.01, torusMinor - 0.01, torusDist);
    
    // Plasma glow inside torus
    float plasmaIntensity = exp(-torusDist * torusDist / (torusMinor * torusMinor * 0.5));
    
    // Plasma instabilities (noise-based ELMs)
    float instNoise = noise(vec2(angle * 5.0, t * 3.0)) * instability;
    float instNoise2 = noise(vec2(angle * 12.0, t * 5.0)) * instability * 0.5;
    plasmaIntensity += (instNoise + instNoise2) * inTorus;
    
    // Plasma color by temperature
    vec3 plasmaCol = mix(vec3(0.8, 0.3, 0.1), vec3(0.3, 0.6, 1.0), plasmaTemp * 0.5);
    plasmaCol = mix(plasmaCol, vec3(1.0, 0.9, 0.8), pow(plasmaIntensity, 3.0));
    col += plasmaCol * plasmaIntensity * plasmaTemp * 0.8;
    
    // Magnetic coils
    if (coilVisibility > 0.0) {
        for (float i = 0.0; i < 24.0; i++) {
            if (i >= magneticCoils) break;
            float coilAngle = i * PI * 2.0 / magneticCoils;
            vec2 coilPos = torusMajor * vec2(cos(coilAngle), sin(coilAngle) * mix(1.0, 0.4, viewAngle));
            
            // Coil as small circle
            float cd = length(uv - coilPos);
            float coil = smoothstep(0.015, 0.01, cd) * coilVisibility;
            col += vec3(0.3, 0.35, 0.5) * coil;
            
            // Coil glow
            col += vec3(0.15, 0.2, 0.35) * coilVisibility * 0.003 / (cd + 0.01);
        }
    }
    
    // Plasma particles orbiting in torus
    for (float i = 0.0; i < 80.0; i++) {
        if (i >= particleDensity) break;
        
        float particleAngle = i * PI * 2.0 / particleDensity + t * (1.0 + hash(i) * 0.5);
        float particleR = torusMajor + (hash(i * 7.3) - 0.5) * torusMinor * 1.5;
        particleR += sin(t * 3.0 + i * 2.0) * instability * 0.02;
        
        vec2 particlePos = particleR * vec2(
            cos(particleAngle), 
            sin(particleAngle) * mix(1.0, 0.4, viewAngle)
        );
        
        float pd = length(uv - particlePos);
        float pBright = hash(i * 11.1) * 0.5 + 0.5;
        
        col += plasmaCol * pBright * 0.002 / (pd + 0.004);
    }
    
    // Containment field boundary
    if (containmentField > 0.0) {
        float fieldR1 = torusMajor + torusMinor + 0.02;
        float fieldR2 = torusMajor - torusMinor - 0.02;
        
        float fd1 = abs(d - fieldR1);
        float fd2 = abs(d - fieldR2);
        
        // Dashed field lines
        float dash = step(0.5, fract(angle * magneticCoils / (PI * 2.0)));
        col += vec3(0.2, 0.3, 0.6) * containmentField * 0.001 / (fd1 + 0.003) * dash * 0.3;
        col += vec3(0.2, 0.3, 0.6) * containmentField * 0.001 / (fd2 + 0.003) * dash * 0.3;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
