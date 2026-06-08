/*{
    "DESCRIPTION": "Gravitational Lensing - A black hole drifts inside the shape warping a starfield with light bending near edges",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "lensStrength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "starDensity", "TYPE": "float", "DEFAULT": 200.0, "MIN": 50.0, "MAX": 500.0},
        {"NAME": "accretionDisk", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "eventHorizon", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.01, "MAX": 0.15},
        {"NAME": "starColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.95, 1.0]},
        {"NAME": "diskColorInner", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.3, 1.0]},
        {"NAME": "diskColorOuter", "TYPE": "color", "DEFAULT": [0.8, 0.2, 0.05, 1.0]},
        {"NAME": "nebulaColor", "TYPE": "color", "DEFAULT": [0.1, 0.05, 0.2, 1.0]},
        {"NAME": "edgeLensing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
}

// Starfield
float stars(vec2 p, float density) {
    vec2 cell = floor(p * density);
    vec2 f = fract(p * density);
    float star = 0.0;
    float rnd = hash2(cell);
    if (rnd > 0.85) {
        vec2 starPos = vec2(hash2(cell + 10.0), hash2(cell + 20.0));
        float d = length(f - starPos);
        float brightness = hash2(cell + 30.0);
        float size = 0.02 + brightness * 0.03;
        star = smoothstep(size, size * 0.2, d) * brightness;
    }
    return star;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Black hole position - drifts inside shape, bouncing off edges
    vec2 bhPos = vec2(
        0.5 + sin(t * 0.7) * 0.25,
        0.5 + cos(t * 0.5) * 0.25
    );
    
    // Edge distances
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    // Gravitational lensing distortion
    vec2 diff = uv - bhPos;
    diff.x *= aspect;
    float dist = length(diff);
    
    // Lens equation - bends light around the black hole
    float lensR = lensStrength * 0.05;
    vec2 lensed = uv;
    if (dist > 0.001) {
        float deflection = lensR * lensR / (dist + 0.01);
        vec2 bendDir = normalize(diff);
        lensed = uv + bendDir * deflection;
    }
    
    // Edge lensing - light bends near shape edges too
    vec2 edgeBend = vec2(0.0);
    float eL = uv.x, eR = 1.0 - uv.x, eB = uv.y, eT = 1.0 - uv.y;
    edgeBend.x += exp(-eL * 15.0) * 0.03 - exp(-eR * 15.0) * 0.03;
    edgeBend.y += exp(-eB * 15.0) * 0.03 - exp(-eT * 15.0) * 0.03;
    lensed += edgeBend * edgeLensing;
    
    vec3 col = vec3(0.0);
    
    // Background nebula
    float neb = fbm(lensed * 3.0 + t * 0.05);
    float neb2 = fbm(lensed * 5.0 - t * 0.03 + 100.0);
    col += nebulaColor.rgb * neb * 0.3;
    col += nebulaColor.rgb * vec3(1.2, 0.8, 0.6) * neb2 * 0.15;
    
    // Stars with lensing
    float starField = stars(lensed, starDensity * 0.1);
    starField += stars(lensed + 100.0, starDensity * 0.15) * 0.7;
    starField += stars(lensed + 200.0, starDensity * 0.05) * 0.5;
    
    // Star color temperature variation
    float temp = hash2(floor(lensed * starDensity * 0.1));
    vec3 sCol = mix(starColor.rgb, starColor.rgb * vec3(0.8, 0.9, 1.2), temp);
    col += sCol * starField;
    
    // Einstein ring
    float einsteinR = lensR * 0.8;
    float ringDist = abs(dist - einsteinR);
    float ring = exp(-ringDist * ringDist * 2000.0) * 0.8;
    col += starColor.rgb * ring;
    
    // Accretion disk
    if (accretionDisk > 0.0) {
        float diskInner = eventHorizon * 1.5;
        float diskOuter = eventHorizon * 5.0;
        float diskR = dist;
        float diskAngle = atan(diff.y, diff.x) + t * 2.0;
        
        float inDisk = smoothstep(diskInner, diskInner + 0.01, diskR) * 
                       smoothstep(diskOuter + 0.01, diskOuter, diskR);
        
        // Disk texture - spiral structure
        float spiral = sin(diskAngle * 3.0 + log(diskR + 0.01) * 10.0) * 0.5 + 0.5;
        float diskNoise = noise(vec2(diskAngle * 5.0, diskR * 20.0 + t * 3.0));
        float diskTex = mix(spiral, diskNoise, 0.4);
        
        // Temperature gradient (hotter closer to center)
        float diskTemp = 1.0 - smoothstep(diskInner, diskOuter, diskR);
        vec3 diskCol = mix(diskColorOuter.rgb, diskColorInner.rgb, diskTemp);
        
        // Relativistic beaming (one side brighter)
        float beaming = 0.7 + 0.3 * cos(diskAngle - t);
        
        col += diskCol * inDisk * diskTex * accretionDisk * beaming * 1.5;
    }
    
    // Event horizon (absorbs all light)
    float horizon = smoothstep(eventHorizon, eventHorizon * 0.5, dist);
    col *= 1.0 - horizon;
    
    // Photon sphere glow
    float photonSphere = exp(-abs(dist - eventHorizon * 1.2) * 100.0) * 0.5;
    col += diskColorInner.rgb * photonSphere;
    
    // Edge light streaks (light hugging the edges from lensing)
    float edgeStreak = exp(-edgeDist * 20.0) * edgeLensing;
    float streakPattern = sin(atan(uv.y - 0.5, uv.x - 0.5) * 8.0 + t * 2.0) * 0.5 + 0.5;
    col += starColor.rgb * edgeStreak * streakPattern * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
