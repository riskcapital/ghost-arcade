/*{
    "DESCRIPTION": "Sacred Geometry Cathedral - nested flower of life, metatron's cube, orbital ellipses, wireframe platonic solid",
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

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    float w = 0.001 * lineGlow; // base line weight
    
    // === LAYER 1: Concentric rings (outermost frame) ===
    float d = length(uv);
    for (float i = 1.0; i <= 24.0; i++) {
        if (i > concentricRings) break;
        float r = i * 0.035 * complexity;
        float ring = circle(uv, vec2(0.0), r);
        // Vary opacity by ring
        float alpha = 0.15 + 0.1 * sin(i * 0.5 + t);
        col += w / (ring + w) * alpha;
    }
    
    // === LAYER 2: Seed of Life (7 circles) ===
    float solR = seedOfLifeRadius;
    col += w / (circle(uv, vec2(0.0), solR) + w) * 0.4;
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= flowerPetals) break;
        float a = i * PI * 2.0 / flowerPetals + t * innerRotation;
        vec2 c = solR * vec2(cos(a), sin(a));
        col += w / (circle(uv, c, solR) + w) * 0.3;
        
        // Second ring of circles (flower of life extension)
        vec2 c2 = solR * 2.0 * vec2(cos(a), sin(a));
        col += w / (circle(uv, c2, solR) + w) * 0.15;
        
        // Intermediate circles
        float a2 = a + PI / flowerPetals;
        vec2 c3 = solR * 1.732 * vec2(cos(a2), sin(a2));
        col += w / (circle(uv, c3, solR) + w) * 0.12;
    }
    
    // === LAYER 3: Metatron's Cube (13 nodes + connections) ===
    vec2 metaNodes[13];
    metaNodes[0] = vec2(0.0);
    for (int i = 0; i < 6; i++) {
        float a = float(i) * PI / 3.0 + t * innerRotation * 0.5;
        metaNodes[i+1] = metatronScale * 0.5 * vec2(cos(a), sin(a));
        metaNodes[i+7] = metatronScale * vec2(cos(a + PI/6.0), sin(a + PI/6.0));
    }
    
    // Draw all connections
    for (int i = 0; i < 13; i++) {
        for (int j = i+1; j < 13; j++) {
            float ld = lineSeg(uv, metaNodes[i], metaNodes[j]);
            float dist = length(metaNodes[i] - metaNodes[j]);
            if (dist < metatronScale * 1.2) {
                col += w * 0.5 / (ld + w * 2.0) * 0.08;
            }
        }
        // Node dots
        float nd = length(uv - metaNodes[i]);
        col += 0.001 / (nd * nd + 0.0001) * 0.02;
    }
    
    // === LAYER 4: Horizontal orbital ellipses ===
    for (float i = 0.0; i < 8.0; i++) {
        if (i >= outerEllipseCount) break;
        float r = 0.2 + i * 0.06;
        float ecc = ellipseEccentricity + 0.1 * sin(t * 0.3 + i);
        float tilt = i * 0.15 + t * 0.05;
        float eDist = ellipse(uv, vec2(0.0), r, r * ecc, tilt);
        col += w / (eDist + w) * 0.2;
    }
    
    // === LAYER 5: Wireframe cube (projected) ===
    float cs = cubeSize;
    float cRot = t * cubeRotSpeed;
    
    // 8 vertices of cube
    vec2 cubeVerts[8];
    for (int i = 0; i < 8; i++) {
        vec3 v = vec3(
            float((i>>0)&1) - 0.5,
            float((i>>1)&1) - 0.5,
            float((i>>2)&1) - 0.5
        ) * cs * 2.0;
        
        // Rotate
        float cx=cos(cRot), sx=sin(cRot);
        float cy=cos(cRot*0.7), sy=sin(cRot*0.7);
        float cz=cos(cRot*0.4), sz=sin(cRot*0.4);
        
        // Rx
        v = vec3(v.x, v.y*cx-v.z*sx, v.y*sx+v.z*cx);
        // Ry
        v = vec3(v.x*cy+v.z*sy, v.y, -v.x*sy+v.z*cy);
        // Rz
        v = vec3(v.x*cz-v.y*sz, v.x*sz+v.y*cz, v.z);
        
        float perspective = 1.0 / (1.5 + v.z);
        cubeVerts[i] = v.xy * perspective;
    }
    
    // 12 edges of cube
    int edges[24];
    edges[0]=0; edges[1]=1; edges[2]=0; edges[3]=2; edges[4]=0; edges[5]=4;
    edges[6]=1; edges[7]=3; edges[8]=1; edges[9]=5; edges[10]=2; edges[11]=3;
    edges[12]=2; edges[13]=6; edges[14]=3; edges[15]=7; edges[16]=4; edges[17]=5;
    edges[18]=4; edges[19]=6; edges[20]=5; edges[21]=7; edges[22]=6; edges[23]=7;
    
    for (int i = 0; i < 12; i++) {
        float ld = lineSeg(uv, cubeVerts[edges[i*2]], cubeVerts[edges[i*2+1]]);
        col += w / (ld + w) * 0.35;
    }
    
    // Vertex dots on cube
    for (int i = 0; i < 8; i++) {
        float vd = length(uv - cubeVerts[i]);
        col += 0.0005 / (vd * vd + 0.00005) * 0.03;
    }
    
    // === LAYER 6: Radial spokes (subtle) ===
    float angle = atan(uv.y, uv.x);
    for (float i = 0.0; i < 12.0; i++) {
        float a = i * PI / 6.0 + t * 0.02;
        float spoke = abs(sin(angle - a)) * d;
        col += 0.0002 / (spoke + 0.003) * smoothstep(0.5, 0.05, d) * 0.1;
    }
    
    // === LAYER 7: Vesica Piscis pairs ===
    for (float i = 0.0; i < 3.0; i++) {
        float a = i * PI / 3.0 + t * innerRotation * 0.3;
        float sep = solR * 0.7;
        vec2 c1 = sep * vec2(cos(a), sin(a));
        vec2 c2 = -c1;
        float vr = length(c1 - c2) * 0.7;
        col += w * 0.7 / (circle(uv, c1, vr) + w * 2.0) * 0.08;
        col += w * 0.7 / (circle(uv, c2, vr) + w * 2.0) * 0.08;
    }
    
    // === LAYER 8: Outer triangular frame ===
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
