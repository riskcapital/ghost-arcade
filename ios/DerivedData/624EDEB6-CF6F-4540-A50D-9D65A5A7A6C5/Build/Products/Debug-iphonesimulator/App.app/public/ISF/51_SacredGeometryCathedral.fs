/*{
    "DESCRIPTION": "Sacred Geometry Cathedral - nested flower of life, orbital ellipses, wireframe cube",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "complexity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "seedOfLifeRadius", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.05, "MAX": 0.25},
        {"NAME": "metatronScale", "TYPE": "float", "DEFAULT": 0.28, "MIN": 0.1, "MAX": 0.45},
        {"NAME": "outerEllipseCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "ellipseEccentricity", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.8},
        {"NAME": "cubeSize", "TYPE": "float", "DEFAULT": 0.07, "MIN": 0.03, "MAX": 0.15},
        {"NAME": "cubeRotSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "lineGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "concentricRings", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 24.0},
        {"NAME": "flowerPetals", "TYPE": "float", "DEFAULT": 6.0, "MIN": 4.0, "MAX": 12.0},
        {"NAME": "innerRotation", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

mat2 rot(float a) { float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

float lineSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa=p-a, ba=b-a;
    float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    return length(pa-ba*h);
}

float circle(vec2 p, vec2 c, float r) {
    return abs(length(p-c)-r);
}

float ellipse(vec2 p, vec2 c, float rx, float ry, float angle) {
    vec2 q = (p-c) * rot(-angle);
    float d = length(vec2(q.x/rx, q.y/ry));
    return abs(d - 1.0) * min(rx, ry);
}

vec2 getMetaNode(float i, float t, float scale, float rotation) {
    if (i < 0.5) return vec2(0.0);
    if (i < 7.0) {
        float a = (i - 1.0) * PI / 3.0 + t * rotation * 0.5;
        return scale * 0.5 * vec2(cos(a), sin(a));
    }
    float a = (i - 7.0) * PI / 3.0 + t * rotation * 0.5;
    return scale * vec2(cos(a + PI/6.0), sin(a + PI/6.0));
}

vec2 getCubeVert(float i, float cs, float cRot) {
    vec3 v = vec3(
        mod(floor(i), 2.0) - 0.5,
        mod(floor(i / 2.0), 2.0) - 0.5,
        mod(floor(i / 4.0), 2.0) - 0.5
    ) * cs * 2.0;

    float cx=cos(cRot), sx=sin(cRot);
    float cy=cos(cRot*0.7), sy=sin(cRot*0.7);
    float cz=cos(cRot*0.4), sz=sin(cRot*0.4);

    v = vec3(v.x, v.y*cx-v.z*sx, v.y*sx+v.z*cx);
    v = vec3(v.x*cy+v.z*sy, v.y, -v.x*sy+v.z*cy);
    v = vec3(v.x*cz-v.y*sz, v.x*sz+v.y*cz, v.z);

    float perspective = 1.0 / (1.5 + v.z);
    return v.xy * perspective;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    float w = 0.001 * lineGlow;

    // Concentric rings
    float d = length(uv);
    for (float i = 1.0; i <= 24.0; i++) {
        if (i > concentricRings) break;
        float r = i * 0.035 * complexity;
        float ring = circle(uv, vec2(0.0), r);
        float alpha = 0.15 + 0.1 * sin(i * 0.5 + t);
        col += w / (ring + w) * alpha;
    }

    // Seed of Life
    float solR = seedOfLifeRadius;
    col += w / (circle(uv, vec2(0.0), solR) + w) * 0.4;
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= flowerPetals) break;
        float a = i * PI * 2.0 / flowerPetals + t * innerRotation;
        vec2 c = solR * vec2(cos(a), sin(a));
        col += w / (circle(uv, c, solR) + w) * 0.3;
        vec2 c2 = solR * 2.0 * vec2(cos(a), sin(a));
        col += w / (circle(uv, c2, solR) + w) * 0.15;
        float a2 = a + PI / flowerPetals;
        vec2 c3 = solR * 1.732 * vec2(cos(a2), sin(a2));
        col += w / (circle(uv, c3, solR) + w) * 0.12;
    }

    // Metatron's Cube connections and nodes
    for (float i = 0.0; i < 13.0; i++) {
        vec2 n1 = getMetaNode(i, t, metatronScale, innerRotation);
        for (float j = 0.0; j < 13.0; j++) {
            if (j <= i) continue;
            vec2 n2 = getMetaNode(j, t, metatronScale, innerRotation);
            float dist = length(n1 - n2);
            if (dist < metatronScale * 1.2) {
                float ld = lineSeg(uv, n1, n2);
                col += w * 0.5 / (ld + w * 2.0) * 0.08;
            }
        }
        float nd = length(uv - n1);
        col += 0.001 / (nd * nd + 0.0001) * 0.02;
    }

    // Orbital ellipses
    for (float i = 0.0; i < 8.0; i++) {
        if (i >= outerEllipseCount) break;
        float r = 0.2 + i * 0.06;
        float ecc = ellipseEccentricity + 0.1 * sin(t * 0.3 + i);
        float tilt = i * 0.15 + t * 0.05;
        float eDist = ellipse(uv, vec2(0.0), r, r * ecc, tilt);
        col += w / (eDist + w) * 0.2;
    }

    // Wireframe cube
    float cs = cubeSize;
    float cRot = t * cubeRotSpeed;

    // Draw 12 edges
    for (float e = 0.0; e < 12.0; e++) {
        float i1, i2;
        if (e < 4.0) { i1 = e; i2 = mod(e + 1.0, 4.0); }
        else if (e < 8.0) { i1 = e; i2 = mod(e - 4.0 + 1.0, 4.0) + 4.0; }
        else { i1 = e - 8.0; i2 = e - 8.0 + 4.0; }

        vec2 v1 = getCubeVert(i1, cs, cRot);
        vec2 v2 = getCubeVert(i2, cs, cRot);
        float ld = lineSeg(uv, v1, v2);
        col += w / (ld + w) * 0.35;
    }

    // Cube vertices
    for (float i = 0.0; i < 8.0; i++) {
        vec2 v = getCubeVert(i, cs, cRot);
        float vd = length(uv - v);
        col += 0.0005 / (vd * vd + 0.00005) * 0.03;
    }

    // Radial spokes
    float angle = atan(uv.y, uv.x);
    for (float i = 0.0; i < 12.0; i++) {
        float a = i * PI / 6.0 + t * 0.02;
        float spoke = abs(sin(angle - a)) * d;
        col += 0.0002 / (spoke + 0.003) * smoothstep(0.5, 0.05, d) * 0.1;
    }

    // Triangular frame
    for (float i = 0.0; i < 2.0; i++) {
        float r = 0.32 + i * 0.08;
        float rot_offset = i * PI / 6.0 + t * 0.03;
        for (float j = 0.0; j < 3.0; j++) {
            float a1 = j * PI * 2.0 / 3.0 + rot_offset;
            float a2 = (j + 1.0) * PI * 2.0 / 3.0 + rot_offset;
            vec2 p1 = r * vec2(cos(a1), sin(a1));
            vec2 p2 = r * vec2(cos(a2), sin(a2));
            float ld = lineSeg(uv, p1, p2);
            col += w / (ld + w) * 0.15;
        }
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(vec3(col), 1.0);
}
