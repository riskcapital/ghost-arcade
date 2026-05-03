/*{
    "DESCRIPTION": "Chaotic Orbital Mesh - tangled wireframe ellipses, geodesic shell, particle scatter",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "orbitCount", "TYPE": "float", "DEFAULT": 18.0, "MIN": 5.0, "MAX": 30.0},
        {"NAME": "meshDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "geodesicDetail", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 20.0},
        {"NAME": "tiltChaos", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "particleCount", "TYPE": "float", "DEFAULT": 60.0, "MIN": 10.0, "MAX": 100.0},
        {"NAME": "coreRadius", "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.05, "MAX": 0.35},
        {"NAME": "outerRadius", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.2, "MAX": 0.5},
        {"NAME": "lineWeight", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "tangledOverlap", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "verticalStretch", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "glowFalloff", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 4.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define ORBIT_SAMPLES 80.0

float hash(float n) { return fract(sin(n)*43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    float w = 0.0008 * lineWeight;
    
    // === CHAOTIC ORBITAL ELLIPSES ===
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= orbitCount) break;
        
        // Each orbit has unique tilt, eccentricity, size, phase
        float h1 = hash(i * 7.3 + 1.0);
        float h2 = hash(i * 3.1 + 5.0);
        float h3 = hash(i * 11.7 + 3.0);
        float h4 = hash(i * 5.3 + 9.0);
        
        float orbitR = mix(coreRadius, outerRadius, h1) * meshDensity;
        float ecc = 0.2 + h2 * 0.6 * verticalStretch;
        float tiltX = (h3 - 0.5) * PI * tiltChaos;
        float tiltY = (h4 - 0.5) * PI * tiltChaos * 0.7;
        float phase = h1 * PI * 2.0 + t * (0.1 + h2 * 0.3);
        
        // Trace orbit as point cloud
        vec2 prevP = vec2(0.0);
        for (float s = 0.0; s < ORBIT_SAMPLES; s++) {
            float a = s / ORBIT_SAMPLES * PI * 2.0 + phase;
            
            // 3D ellipse
            vec3 p3 = vec3(cos(a) * orbitR, sin(a) * orbitR * ecc, 0.0);
            
            // Rotate around X
            float cx = cos(tiltX), sx = sin(tiltX);
            p3 = vec3(p3.x, p3.y*cx - p3.z*sx, p3.y*sx + p3.z*cx);
            
            // Rotate around Y
            float cy = cos(tiltY + t*0.05), sy = sin(tiltY + t*0.05);
            p3 = vec3(p3.x*cy + p3.z*sy, p3.y, -p3.x*sy + p3.z*cy);
            
            // Slow overall rotation
            float cz = cos(t*0.02), sz = sin(t*0.02);
            p3 = vec3(p3.x*cz - p3.y*sz, p3.x*sz + p3.y*cz, p3.z);
            
            float perspective = 1.0 / (1.3 + p3.z * 0.4);
            vec2 proj = p3.xy * perspective;
            
            float zBright = 0.4 + 0.6 * (0.5 + 0.5 * p3.z / orbitR);
            
            float pd = length(uv - proj);
            col += w / (pd + w * 0.8) * (1.0/ORBIT_SAMPLES) * 2.5 * zBright;
            
            // Tangential connections between close orbits (tangled look)
            if (tangledOverlap > 0.0 && s == 0.0) {
                // connect to next orbit's corresponding point for mesh effect
                float nextI = mod(i + 1.0, orbitCount);
                float nh1 = hash(nextI * 7.3 + 1.0);
                float nextR = mix(coreRadius, outerRadius, nh1) * meshDensity;
                float na = phase + hash(i * 2.7) * 0.5;
                vec3 np = vec3(cos(na)*nextR, sin(na)*nextR*0.5, 0.0);
                float ncx = cos(hash(nextI*3.1+5.0)*PI*tiltChaos);
                float nsx = sin(hash(nextI*3.1+5.0)*PI*tiltChaos);
                np = vec3(np.x, np.y*ncx, np.y*nsx);
                np = vec3(np.x*cz-np.y*sz, np.x*sz+np.y*cz, np.z);
                vec2 nproj = np.xy / (1.3+np.z*0.4);
                
                // Connection line
                vec2 pa = uv - proj, ba = nproj - proj;
                float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
                float ld = length(pa - ba*h);
                col += w*0.5 / (ld + w*3.0) * tangledOverlap * 0.06;
            }
        }
    }
    
    // === GEODESIC LATTICE (icosahedron-like) ===
    for (float i = 0.0; i < 20.0; i++) {
        if (i >= geodesicDetail) break;
        for (float j = 0.0; j < 20.0; j++) {
            if (j <= i) continue;
            if (j >= geodesicDetail) break;
            
            float a1 = i * 2.399 + t * 0.1; // golden angle
            float a2 = j * 2.399 + t * 0.1;
            float r1 = coreRadius * 1.2;
            
            float phi1 = acos(1.0 - 2.0*i/geodesicDetail);
            float phi2 = acos(1.0 - 2.0*j/geodesicDetail);
            
            vec3 p1 = r1 * vec3(sin(phi1)*cos(a1), sin(phi1)*sin(a1), cos(phi1));
            vec3 p2 = r1 * vec3(sin(phi2)*cos(a2), sin(phi2)*sin(a2), cos(phi2));
            
            float dist3d = length(p1-p2);
            if (dist3d < r1 * 1.0) {
                // Rotate
                float cz=cos(t*0.02), sz=sin(t*0.02);
                p1.xy = vec2(p1.x*cz-p1.y*sz, p1.x*sz+p1.y*cz);
                p2.xy = vec2(p2.x*cz-p2.y*sz, p2.x*sz+p2.y*cz);
                
                vec2 pr1 = p1.xy/(1.3+p1.z*0.3);
                vec2 pr2 = p2.xy/(1.3+p2.z*0.3);
                
                vec2 pa=uv-pr1, ba=pr2-pr1;
                float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
                float ld=length(pa-ba*h);
                col += w*0.3 / (ld + w*2.0) * 0.12;
            }
        }
    }
    
    // === SCATTERED PARTICLES ===
    for (float i = 0.0; i < 100.0; i++) {
        if (i >= particleCount) break;
        float h1 = hash(i*1.3+0.7);
        float h2 = hash(i*2.1+3.1);
        float h3 = hash(i*3.7+1.3);
        
        vec2 pos = vec2(
            (h1-0.5)*1.0 + sin(t*0.1+i*0.7)*0.03,
            (h2-0.5)*0.8 + cos(t*0.08+i*1.1)*0.03
        );
        
        float pd = length(uv - pos);
        float bright = 0.3 + h3 * 0.7;
        col += bright * 0.0003 / (pd*pd + 0.00005);
    }
    
    // === CENTRAL CORE GLOW ===
    float coreD = length(uv);
    col += 0.005 / (coreD*coreD + 0.003) * 0.15;
    
    // Glow falloff
    col *= exp(-coreD * glowFalloff * 0.5);
    col = min(col, 1.0);
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
