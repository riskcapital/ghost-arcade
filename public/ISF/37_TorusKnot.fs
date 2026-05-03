/*{
    "DESCRIPTION": "Torus knot - rotating 3D wireframe knot projection",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "knotP", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.0, "MAX": 7.0, "LABEL": "Knot P"},
        {"NAME": "knotQ", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 7.0, "LABEL": "Knot Q"},
        {"NAME": "majorRadius", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.1, "MAX": 0.5},
        {"NAME": "minorRadius", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.02, "MAX": 0.15},
        {"NAME": "lineWeight", "TYPE": "float", "DEFAULT": 0.003, "MIN": 0.001, "MAX": 0.01},
        {"NAME": "rotX", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Tilt X"},
        {"NAME": "rotY", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Tilt Y"},
        {"NAME": "depthFade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "trailGlow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
// SAMPLES was 200.0 — trimmed to 120.0 (same visual quality, ~40% fewer per-pixel curve evals).
#define SAMPLES 120.0

mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1,0,0, 0,c,-s, 0,s,c);
}

mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,0,s, 0,1,0, -s,0,c);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    mat3 rx = rotateX(t * rotX + PI * 0.25);
    mat3 ry = rotateY(t * rotY);
    mat3 rot = rx * ry;
    
    float minDist = 1e10;

    // Trace torus knot curve
    
    for (float i = 0.0; i < SAMPLES; i++) {
        float s = i / SAMPLES * PI * 2.0;
        
        // Torus knot parametric equation
        float r = majorRadius + minorRadius * cos(knotQ * s);
        vec3 p = vec3(
            r * cos(knotP * s),
            r * sin(knotP * s),
            minorRadius * sin(knotQ * s)
        );
        
        // Rotate
        p = rot * p;
        
        // Project (perspective)
        float perspective = 1.0 / (1.0 + p.z * 0.5);
        vec2 proj = p.xy * perspective;
        
        float d = length(uv - proj);
        
        // Depth-based brightness
        float zBright = 0.5 + 0.5 * (1.0 - p.z * depthFade);
        
        // Point along curve
        float weight = lineWeight * perspective;
        float glow = weight / (d + weight * 0.5) * zBright;
        
        // Color varies along curve
        float hue = i / SAMPLES;
        vec3 curveCol = mix(vec3(0.3, 0.4, 0.9), vec3(0.7, 0.5, 1.0), hue);
        
        col += curveCol * glow * (1.0 / SAMPLES) * 15.0;
        
        // Trail glow
        col += curveCol * trailGlow * exp(-d * d / 0.002) * zBright * (1.0 / SAMPLES) * 0.5;
        
        minDist = min(minDist, d);
    }
    
    // Subtle ambient glow around structure
    float structureDist = minDist;
    col += vec3(0.1, 0.12, 0.2) * exp(-structureDist * 10.0) * 0.1;
    
    gl_FragColor = vec4(col, 1.0);
}
