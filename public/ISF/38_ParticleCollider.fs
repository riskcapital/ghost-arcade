/*{
    "DESCRIPTION": "Particle physics collider - event display with tracks and decay paths",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "trackCount", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "curvature", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Magnetic Field"},
        {"NAME": "detectorRings", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "trackBrightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "collisionEnergy", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "detectorOpacity", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "jetsEnabled", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Show Jets"},
        {"NAME": "decayVertices", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Decay Visibility"},
        {"NAME": "eventRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float eventPhase = fract(t * eventRate);
    float eventIdx = floor(t * eventRate);
    
    vec3 col = vec3(0.0);
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Detector rings (calorimeter layers)
    for (float i = 1.0; i <= 8.0; i++) {
        if (i > detectorRings) break;
        float r = i * 0.1;
        float ring = abs(d - r);
        
        // Segmented detector
        float segments = 16.0 + i * 8.0;
        float segAngle = mod(angle, PI * 2.0 / segments) - PI / segments;
        float segDist = abs(segAngle * d);
        
        float detector = smoothstep(0.003, 0.0, ring) * detectorOpacity * 0.3;
        detector += smoothstep(0.002, 0.0, segDist) * smoothstep(r + 0.003, r - 0.003, d) * detectorOpacity * 0.15;
        
        col += vec3(0.15, 0.2, 0.35) * detector;
    }
    
    // Particle tracks from collision vertex
    for (float i = 0.0; i < 40.0; i++) {
        if (i >= trackCount) break;
        
        float trackSeed = hash(i + eventIdx * 100.0);
        float trackAngle = hash(i * 7.3 + eventIdx * 50.0) * PI * 2.0;
        float trackPt = (0.1 + hash(i * 3.1 + eventIdx * 30.0) * 0.9) * collisionEnergy;
        
        // Charge determines curvature direction
        float charge = step(0.5, hash(i * 11.3 + eventIdx * 20.0)) * 2.0 - 1.0;
        float curveR = trackPt / (curvature + 0.01) * 0.5;
        
        // Curved track (arc in magnetic field)
        vec2 dir = vec2(cos(trackAngle), sin(trackAngle));
        vec2 perp = vec2(-dir.y, dir.x) * charge;
        vec2 arcCenter = perp * curveR;
        
        float arcDist = abs(length(uv - arcCenter) - curveR);
        
        // Only show track going outward from vertex
        float alongTrack = dot(uv, dir);
        float trackMask = smoothstep(0.0, 0.02, alongTrack) * smoothstep(0.4 * collisionEnergy, 0.0, alongTrack);
        
        // Angular extent check
        float trackArcAngle = atan(uv.y - arcCenter.y, uv.x - arcCenter.x);
        float startArcAngle = atan(-arcCenter.y, -arcCenter.x);
        
        float brightness = trackBrightness * (0.3 + 0.7 * trackPt);
        float track = 0.001 / (arcDist + 0.002) * trackMask * brightness;
        
        // Color by particle type
        vec3 trackCol;
        if (trackSeed > 0.7) trackCol = vec3(0.8, 0.6, 0.3); // hadron
        else if (trackSeed > 0.4) trackCol = vec3(0.3, 0.5, 1.0); // electron
        else trackCol = vec3(0.5, 0.8, 0.4); // muon
        
        col += trackCol * track * 0.3;
        
        // Decay vertex
        if (decayVertices > 0.0 && trackSeed > 0.6) {
            float decayDist = 0.05 + hash(i * 5.5) * 0.1;
            vec2 decayPos = dir * decayDist;
            float dvd = length(uv - decayPos);
            col += vec3(0.6, 0.5, 0.8) * decayVertices * 0.002 / (dvd * dvd + 0.0005);
        }
    }
    
    // Jets (back-to-back energy deposits)
    if (jetsEnabled > 0.5) {
        float jetAngle1 = hash(eventIdx * 77.7) * PI * 2.0;
        float jetAngle2 = jetAngle1 + PI + (hash(eventIdx * 33.3) - 0.5) * 0.3;
        
        for (float j = 0.0; j < 2.0; j++) {
            float ja = j < 0.5 ? jetAngle1 : jetAngle2;
            vec2 jetDir = vec2(cos(ja), sin(ja));
            
            float along = dot(uv, jetDir);
            float perp2 = abs(dot(uv, vec2(-jetDir.y, jetDir.x)));
            
            float jetWidth = 0.02 + along * 0.15;
            float jet = exp(-perp2 * perp2 / (jetWidth * jetWidth + 0.0001)) * 
                        smoothstep(0.0, 0.05, along) * smoothstep(0.5, 0.2, along);
            
            col += vec3(0.4, 0.3, 0.6) * jet * collisionEnergy * 0.3;
        }
    }
    
    // Collision vertex glow
    float vertexPulse = exp(-eventPhase * 5.0);
    col += vec3(0.8, 0.8, 1.0) * 0.01 / (d * d + 0.002) * vertexPulse;
    
    gl_FragColor = vec4(col, 1.0);
}
