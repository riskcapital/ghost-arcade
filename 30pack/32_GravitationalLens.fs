/*{
    "DESCRIPTION": "Gravitational lensing - spacetime distortion grid with singularity",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "gridDensity", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 30.0},
        {"NAME": "lensStrength", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "accretionBrightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "accretionWidth", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.01, "MAX": 0.2},
        {"NAME": "eventHorizon", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.02, "MAX": 0.2},
        {"NAME": "gridOpacity", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "warpX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -0.5, "MAX": 0.5, "LABEL": "Singularity X"},
        {"NAME": "warpY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -0.5, "MAX": 0.5, "LABEL": "Singularity Y"},
        {"NAME": "starDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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
    vec3 col = vec3(0.0);
    
    vec2 center = vec2(warpX, warpY);
    vec2 toCenter = uv - center;
    float d = length(toCenter);
    float angle = atan(toCenter.y, toCenter.x);
    
    // Gravitational lensing distortion
    float warpFactor = lensStrength / (d + 0.01);
    vec2 warpedUV = uv + normalize(toCenter) * warpFactor;
    
    // Also add rotational frame-dragging
    float frameDrag = lensStrength * 0.5 / (d * d + 0.01);
    warpedUV += vec2(-toCenter.y, toCenter.x) * frameDrag * 0.1;
    
    // Distorted grid
    vec2 grid = warpedUV * gridDensity;
    float lineX = abs(fract(grid.x) - 0.5);
    float lineY = abs(fract(grid.y) - 0.5);
    float gridLine = min(lineX, lineY);
    float gridVal = smoothstep(0.02, 0.0, gridLine) * gridOpacity;
    
    // Grid color - bluer near singularity (blueshift)
    vec3 gridCol = mix(vec3(0.2, 0.25, 0.5), vec3(0.5, 0.5, 0.8), smoothstep(0.3, 0.05, d));
    col += gridCol * gridVal * smoothstep(eventHorizon, eventHorizon + 0.02, d);
    
    // Accretion disk
    float diskR = eventHorizon + accretionWidth;
    float diskDist = abs(d - diskR);
    float disk = exp(-diskDist * diskDist / (accretionWidth * accretionWidth * 0.1));
    
    // Doppler shift on disk - approaching side brighter
    float doppler = 0.5 + 0.5 * sin(angle + t * 2.0);
    
    vec3 accCol = mix(vec3(0.8, 0.4, 0.1), vec3(0.3, 0.5, 1.0), doppler * 0.5);
    accCol = mix(accCol, vec3(1.0, 0.9, 0.8), pow(disk, 3.0));
    col += accCol * disk * accretionBrightness * doppler;
    
    // Photon ring at event horizon edge
    float photonRing = exp(-pow((d - eventHorizon - 0.005) * 200.0, 2.0));
    col += vec3(0.9, 0.8, 0.6) * photonRing * accretionBrightness * 0.5;
    
    // Event horizon - total blackness
    float horizon = smoothstep(eventHorizon + 0.005, eventHorizon - 0.005, d);
    col *= 1.0 - horizon;
    
    // Background distorted stars
    vec2 starUV = warpedUV * 30.0;
    vec2 starId = floor(starUV);
    float star = hash(starId);
    if (star > 1.0 - starDensity * 0.1 && d > eventHorizon) {
        float sd = length(fract(starUV) - 0.5);
        float twinkle = 0.5 + 0.5 * sin(t * 2.0 + star * 50.0);
        float magnification = 1.0 + lensStrength / (d * d + 0.01);
        col += vec3(0.6, 0.65, 0.9) * 0.004 / (sd + 0.01) * twinkle * 0.3 * min(magnification, 3.0);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
