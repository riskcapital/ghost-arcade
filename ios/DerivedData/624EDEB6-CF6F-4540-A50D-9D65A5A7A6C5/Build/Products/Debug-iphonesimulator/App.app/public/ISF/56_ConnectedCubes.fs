/*{
    "DESCRIPTION": "Connected Floating Cubes - wireframe cubes with sinusoidal signal paths",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "cubeCount", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "cubeMinSize", "TYPE": "float", "DEFAULT": 0.01, "MIN": 0.005, "MAX": 0.03},
        {"NAME": "cubeMaxSize", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.03, "MAX": 0.12},
        {"NAME": "centralCubeSize", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.03, "MAX": 0.15},
        {"NAME": "signalWaves", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "signalAmplitude", "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0, "MAX": 0.08},
        {"NAME": "signalFreq", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 20.0},
        {"NAME": "connectionRange", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.6},
        {"NAME": "fillOpacity", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Cube Fill"},
        {"NAME": "blueIntensity", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "rotationSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n)*43758.5453); }

float lineSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa=p-a, ba=b-a;
    float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    return length(pa-ba*h);
}

// Get cube vertex projected to 2D
vec2 getCubeVertex(int i, vec2 center, float size, float rotAngle, float tilt) {
    float cx=cos(rotAngle), sx=sin(rotAngle);
    float cy=cos(tilt), sy=sin(tilt);
    float cz=cos(rotAngle*0.7), sz=sin(rotAngle*0.7);

    vec3 v = vec3(
        float((i/1) - 2*(i/2))-0.5,
        float((i/2) - 2*(i/4))-0.5,
        float((i/4) - 2*(i/8))-0.5
    ) * size;

    v = vec3(v.x, v.y*cx-v.z*sx, v.y*sx+v.z*cx);
    v = vec3(v.x*cy+v.z*sy, v.y, -v.x*sy+v.z*cy);
    v = vec3(v.x*cz-v.y*sz, v.x*sz+v.y*cz, v.z);

    float p = 1.0/(1.5+v.z);
    return center + v.xy * p;
}

// Project wireframe cube and return minimum distance
float wireCube(vec2 uv, vec2 center, float size, float rotAngle, float tilt) {
    // Get all 8 vertices
    vec2 v0 = getCubeVertex(0, center, size, rotAngle, tilt);
    vec2 v1 = getCubeVertex(1, center, size, rotAngle, tilt);
    vec2 v2 = getCubeVertex(2, center, size, rotAngle, tilt);
    vec2 v3 = getCubeVertex(3, center, size, rotAngle, tilt);
    vec2 v4 = getCubeVertex(4, center, size, rotAngle, tilt);
    vec2 v5 = getCubeVertex(5, center, size, rotAngle, tilt);
    vec2 v6 = getCubeVertex(6, center, size, rotAngle, tilt);
    vec2 v7 = getCubeVertex(7, center, size, rotAngle, tilt);

    // 12 edges - compute minimum distance
    float minD = 1e10;
    minD = min(minD, lineSeg(uv, v0, v1));
    minD = min(minD, lineSeg(uv, v0, v2));
    minD = min(minD, lineSeg(uv, v0, v4));
    minD = min(minD, lineSeg(uv, v1, v3));
    minD = min(minD, lineSeg(uv, v1, v5));
    minD = min(minD, lineSeg(uv, v2, v3));
    minD = min(minD, lineSeg(uv, v2, v6));
    minD = min(minD, lineSeg(uv, v3, v7));
    minD = min(minD, lineSeg(uv, v4, v5));
    minD = min(minD, lineSeg(uv, v4, v6));
    minD = min(minD, lineSeg(uv, v5, v7));
    minD = min(minD, lineSeg(uv, v6, v7));

    return minD;
}

// Get cube position by index
vec2 getCubePos(float i, float t) {
    float h1 = hash(i*1.7+0.3);
    float h2 = hash(i*2.3+7.1);
    return vec2(
        (h1-0.5)*1.2 + sin(t*0.2+i*0.7)*0.05,
        (h2-0.5)*0.9 + cos(t*0.15+i*1.1)*0.04
    );
}

// Get cube size by index
float getCubeSz(float i) {
    float h3 = hash(i*3.1+1.3);
    return mix(cubeMinSize, cubeMaxSize, h3);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;

    vec3 col = vec3(0.0);
    float w = 0.001;

    // === CENTRAL WIREFRAME CUBE (large, complex) ===
    float centralRot = t * rotationSpeed;
    float cd = wireCube(uv, vec2(0.0), centralCubeSize, centralRot, centralRot*0.6);
    col += vec3(0.7, 0.8, 1.0) * w / (cd + w) * 0.6;

    // Second nested cube inside
    float cd2 = wireCube(uv, vec2(0.0), centralCubeSize*0.6, centralRot*1.3+0.5, centralRot*0.8+0.3);
    col += vec3(0.5, 0.6, 0.9) * w / (cd2 + w) * 0.35;

    // === FLOATING CUBES ===
    for (float i=0.0; i<40.0; i++) {
        if (i >= cubeCount) break;
        float h4 = hash(i*5.3+3.7);
        float h5 = hash(i*7.1+5.3);

        vec2 cPos = getCubePos(i, t);
        float cSize = getCubeSz(i);

        float cubeRot = t * rotationSpeed * (0.5+h4) + i*0.5;
        float cubeTilt = t * rotationSpeed * (0.3+h5) + i*0.7;

        float cdist = wireCube(uv, cPos, cSize, cubeRot, cubeTilt);

        // Blue-tinted wireframe
        vec3 cubeCol = mix(vec3(0.4, 0.5, 0.8), vec3(0.3, 0.4, 1.0), h4) * blueIntensity;
        col += cubeCol * w / (cdist + w) * 0.4;

        // Fill (subtle)
        if (fillOpacity > 0.0) {
            float fill = smoothstep(cSize*0.8, 0.0, cdist);
            col += cubeCol * fill * fillOpacity * 0.3;
        }
    }

    // === SIGNAL WAVE CONNECTIONS ===
    for (float wave = 0.0; wave < 8.0; wave++) {
        if (wave >= signalWaves) break;

        // Pick two cubes to connect (or connect to center)
        float srcIdx = mod(wave * 3.0, cubeCount);
        float dstIdx = mod(wave * 5.0 + 7.0, cubeCount);

        vec2 src = wave < 2.0 ? vec2(0.0) : getCubePos(srcIdx, t);
        vec2 dst = getCubePos(dstIdx, t);

        float dist = length(src - dst);
        if (dist > connectionRange && wave >= 2.0) continue;

        // Sinusoidal path between points
        vec2 dir = dst - src;
        vec2 perp = normalize(vec2(-dir.y, dir.x));

        // Signal-wave sub-sampling trimmed 60 → 30 (sine path still smooth at this density).
        for (float s = 0.0; s < 30.0; s++) {
            float param = s / 30.0;
            vec2 linePos = src + dir * param;

            // Sine wave offset
            float sineOffset = sin(param * signalFreq * PI + t * 3.0 + wave) * signalAmplitude;
            linePos += perp * sineOffset;

            float pd = length(uv - linePos);
            float fade = param * (1.0 - param) * 4.0; // Fade at endpoints
            col += vec3(0.3, 0.4, 0.7) * 0.0003 / (pd + 0.003) * fade;
        }
    }

    // === INTER-CUBE CONNECTION LINES (straight, subtle) ===
    for (float i=0.0; i<40.0; i++) {
        if (i >= cubeCount) break;
        for (float j=0.0; j<40.0; j++) {
            if (j <= i) continue;
            if (j >= cubeCount) break;
            if (j > i+5.0) break; // Limit connections

            vec2 posI = getCubePos(i, t);
            vec2 posJ = getCubePos(j, t);
            float dist = length(posI - posJ);
            if (dist < connectionRange * 0.6) {
                float ld = lineSeg(uv, posI, posJ);
                float alpha = (1.0 - dist/(connectionRange*0.6)) * 0.15;
                col += vec3(0.2, 0.3, 0.5) * w*0.5 / (ld + w*3.0) * alpha;
            }
        }
    }

    // Background: very dark navy
    col += vec3(0.01, 0.01, 0.03);

    gl_FragColor = vec4(col, 1.0);
}
