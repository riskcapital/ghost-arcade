/*{
    "DESCRIPTION": "Pulsar beacon - rotating emission beam with magnetosphere",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "beamWidth", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.02, "MAX": 0.5, "LABEL": "Beam Cone Angle"},
        {"NAME": "beamLength", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.2, "MAX": 1.5},
        {"NAME": "pulsarSize", "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.01, "MAX": 0.08},
        {"NAME": "magneticField", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Field Lines"},
        {"NAME": "fieldLineCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 16.0},
        {"NAME": "beamIntensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.3, "MAX": 4.0},
        {"NAME": "wobble", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Precession"},
        {"NAME": "particleJets", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "magnetosphereSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.5}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    vec3 col = vec3(0.0);
    
    // Rotation angle of the pulsar
    float rotAngle = t * 3.0;
    float precAngle = wobble * sin(t * 0.5) * 0.3;
    
    // Two beams (opposite poles)
    for (float beam = 0.0; beam < 2.0; beam++) {
        float beamAngle = rotAngle + beam * PI + precAngle * (beam < 0.5 ? 1.0 : -1.0);
        
        vec2 beamDir = vec2(cos(beamAngle), sin(beamAngle));
        
        float along = dot(uv, beamDir);
        float perp = abs(dot(uv, vec2(-beamDir.y, beamDir.x)));
        
        // Cone shape widens with distance
        float coneWidth = beamWidth * along;
        
        if (along > pulsarSize) {
            float beamDist = perp / max(coneWidth, 0.001);
            float beamFade = exp(-beamDist * beamDist * 3.0);
            float lengthFade = smoothstep(beamLength, pulsarSize, along);
            
            // Beam color: bright white core, blue edges
            vec3 beamCol = mix(vec3(0.3, 0.5, 1.0), vec3(0.9, 0.9, 1.0), exp(-beamDist * 2.0));
            col += beamCol * beamFade * lengthFade * beamIntensity;
        }
    }
    
    // Magnetic field lines (dipole)
    if (magneticField > 0.0) {
        for (float i = 0.0; i < 16.0; i++) {
            if (i >= fieldLineCount) break;
            
            float lineAngle = i * PI / fieldLineCount;
            
            // Dipole field line: r = R * sin^2(theta)
            for (float s = 0.0; s < 60.0; s++) {
                float theta = s / 60.0 * PI;
                float r = magnetosphereSize * sin(theta) * sin(theta);
                
                float x = r * cos(theta + rotAngle * 0.01);
                float y = r * sin(theta + rotAngle * 0.01);
                
                // Rotate field line around axis
                float c = cos(lineAngle), sn = sin(lineAngle);
                vec2 fp = vec2(x * c - y * sn, x * sn + y * c);
                
                float fd = length(uv - fp);
                col += vec3(0.15, 0.2, 0.4) * magneticField * 0.0002 / (fd + 0.003);
            }
        }
    }
    
    // Particle jets along rotation axis
    if (particleJets > 0.0) {
        vec2 jetDir = vec2(cos(rotAngle * 0.01 + precAngle), sin(rotAngle * 0.01 + precAngle));
        for (float i = 0.0; i < 30.0; i++) {
            float h = hash(vec2(i, floor(t * 5.0)));
            float r = (0.03 + h * 0.4) * (0.5 + 0.5 * sin(t * 2.0 + i));
            float spread = h * 0.02;
            vec2 pp = jetDir * r + vec2(-jetDir.y, jetDir.x) * (hash(vec2(i, 7.0)) - 0.5) * spread;
            
            float pd = length(uv - pp);
            col += vec3(0.4, 0.5, 0.9) * particleJets * 0.0005 / (pd + 0.003);
        }
    }
    
    // Pulsar core
    float coreDist = d - pulsarSize;
    if (d < pulsarSize) {
        col += vec3(0.8, 0.85, 1.0) * 2.0;
    }
    col += vec3(0.6, 0.7, 1.0) * pulsarSize * 0.02 / (d * d + pulsarSize * pulsarSize * 0.1);
    
    // Magnetosphere boundary
    float magBound = abs(d - magnetosphereSize);
    col += vec3(0.1, 0.15, 0.3) * magneticField * 0.001 / (magBound + 0.005) * 0.2;
    
    gl_FragColor = vec4(col, 1.0);
}
