/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Organic metallic forms with breathing depth animation",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 0.35},
        {"NAME": "scale", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "organicness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "depthPulse", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "blobSize", "TYPE": "float", "MIN": 0.3, "MAX": 2.5, "DEFAULT": 1.2},
        {"NAME": "blobCount", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0},
        {"NAME": "spread", "TYPE": "float", "MIN": 0.1, "MAX": 0.6, "DEFAULT": 0.25},
        {"NAME": "shininess", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15},
        {"NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.28, "DEFAULT": 0.8},
        {"NAME": "lightHeight", "TYPE": "float", "MIN": 0.2, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "subsurface", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float organicFBM(vec2 p, float t) {
    float f = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));

    for (int i = 0; i < 4; i++) {
        f += a * snoise(p + t * 0.1);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return f;
}

float organicBlob(vec2 p, vec2 center, float radius, float t, float organicAmount) {
    vec2 d = p - center;
    float angle = atan(d.y, d.x);
    float distort = snoise(vec2(angle * 3.0 + t, t * 0.5)) * organicAmount * 0.3;
    float dist = length(d) * (1.0 + distort);
    return radius * radius / (dist * dist + 0.0001);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Calculate the full field for gradient computation
float calcFullField(vec2 uv, float t, float organicAmt, float bSize, float dPulse, float bCount, float spr) {
    float warpStrength = organicAmt * 0.15;
    vec2 warp1 = vec2(organicFBM(uv * 2.0, t), organicFBM(uv * 2.0 + 5.0, t)) * warpStrength;
    vec2 warp2 = vec2(organicFBM(uv * 3.0 + warp1 * 2.0, t * 1.2),
                      organicFBM(uv * 3.0 + warp1 * 2.0 + 8.0, t * 1.2)) * warpStrength * 0.5;
    vec2 warpedUV = uv + warp1 + warp2;

    float field = 0.0;
    float breathe = sin(t * 0.8) * 0.5 + 0.5;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= bCount) break;
        float angle = i * PI * 2.0 / bCount + t * 0.2;
        float breathOffset = sin(t * 0.5 + i * 1.3) * dPulse * 0.15;
        float blobZ = sin(t * 0.3 + i * 2.1) * 0.5 + 0.5;
        blobZ = mix(0.3, 1.0, blobZ) + breathOffset;

        float dist = spr + sin(t * 0.4 + i * 0.9) * 0.08;
        vec2 center;
        center.x = cos(angle) * dist * blobZ;
        center.y = sin(angle) * dist * blobZ;

        center += vec2(
            snoise(vec2(i * 1.5, t * 0.3)) * 0.05,
            snoise(vec2(i * 1.5 + 10.0, t * 0.3)) * 0.05
        ) * organicAmt;

        float size = bSize * 0.12 * blobZ;
        field += organicBlob(warpedUV, center, size, t + i, organicAmt);
    }

    float centralSize = bSize * 0.22 * (1.0 + breathe * dPulse * 0.3);
    vec2 centralPos = vec2(
        snoise(vec2(t * 0.15, 0.0)) * 0.03,
        snoise(vec2(0.0, t * 0.15)) * 0.03
    );
    field += organicBlob(warpedUV, centralPos, centralSize, t, organicAmt);

    return field;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    uv /= scale; // Apply zoom/scale
    float t = TIME * speed;

    float warpStrength = organicness * 0.15;
    vec2 warp1 = vec2(organicFBM(uv * 2.0, t), organicFBM(uv * 2.0 + 5.0, t)) * warpStrength;
    vec2 warp2 = vec2(organicFBM(uv * 3.0 + warp1 * 2.0, t * 1.2),
                      organicFBM(uv * 3.0 + warp1 * 2.0 + 8.0, t * 1.2)) * warpStrength * 0.5;
    vec2 warpedUV = uv + warp1 + warp2;

    float field = 0.0;
    float depthAccum = 0.0;
    float breathe = sin(t * 0.8) * 0.5 + 0.5;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= blobCount) break;
        float angle = i * PI * 2.0 / blobCount + t * 0.2;
        float breathOffset = sin(t * 0.5 + i * 1.3) * depthPulse * 0.15;
        float blobZ = sin(t * 0.3 + i * 2.1) * 0.5 + 0.5;
        blobZ = mix(0.3, 1.0, blobZ) + breathOffset;

        float dist = spread + sin(t * 0.4 + i * 0.9) * 0.08;
        vec2 center;
        center.x = cos(angle) * dist * blobZ;
        center.y = sin(angle) * dist * blobZ;

        center += vec2(
            snoise(vec2(i * 1.5, t * 0.3)) * 0.05,
            snoise(vec2(i * 1.5 + 10.0, t * 0.3)) * 0.05
        ) * organicness;

        float size = blobSize * 0.12 * blobZ;
        float contrib = organicBlob(warpedUV, center, size, t + i, organicness);
        field += contrib;
        depthAccum += contrib * blobZ;
    }

    float centralSize = blobSize * 0.22 * (1.0 + breathe * depthPulse * 0.3);
    vec2 centralPos = vec2(
        snoise(vec2(t * 0.15, 0.0)) * 0.03,
        snoise(vec2(0.0, t * 0.15)) * 0.03
    );
    float centralBlob = organicBlob(warpedUV, centralPos, centralSize, t, organicness);
    field += centralBlob;
    depthAccum += centralBlob * (0.8 + breathe * 0.2);

    float threshold = 0.9;
    float surface = smoothstep(threshold - 0.4, threshold + 0.1, field);
    float depth = depthAccum / max(field, 0.01);

    // Manual gradient for normals
    float eps = 0.006;
    float fieldL = calcFullField(uv - vec2(eps, 0.0), t, organicness, blobSize, depthPulse, blobCount, spread);
    float fieldR = calcFullField(uv + vec2(eps, 0.0), t, organicness, blobSize, depthPulse, blobCount, spread);
    float fieldD = calcFullField(uv - vec2(0.0, eps), t, organicness, blobSize, depthPulse, blobCount, spread);
    float fieldU = calcFullField(uv + vec2(0.0, eps), t, organicness, blobSize, depthPulse, blobCount, spread);

    vec3 normal = normalize(vec3(
        (fieldL - fieldR) * 6.0,
        (fieldD - fieldU) * 6.0,
        0.3 + depth * 0.4
    ));

    float detail = snoise(warpedUV * 20.0 + t * 0.5) * organicness * 0.15;
    normal.xy += detail;
    normal = normalize(normal);

    // Dynamic light position based on parameters
    vec3 light1 = normalize(vec3(cos(lightAngle) * (1.0 - lightHeight), sin(lightAngle) * (1.0 - lightHeight), lightHeight));
    vec3 light2 = normalize(vec3(-cos(lightAngle + 2.0) * 0.6, sin(lightAngle + 2.0) * 0.4, 0.8));
    vec3 light3 = normalize(vec3(0.0, -0.5, 0.7));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float diff1 = max(dot(normal, light1), 0.0);
    float diff2 = max(dot(normal, light2), 0.0) * 0.4;
    float diff3 = max(dot(normal, light3), 0.0) * 0.2;
    float diffuse = diff1 + diff2 + diff3;

    float spec1 = pow(max(dot(reflect(-light1, normal), viewDir), 0.0), 48.0);
    float spec2 = pow(max(dot(reflect(-light2, normal), viewDir), 0.0), 24.0) * 0.4;
    float specular = (spec1 + spec2) * shininess;

    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    fresnel *= 1.0 + snoise(warpedUV * 5.0 + t) * 0.2 * organicness;

    float sss = pow(max(0.0, dot(normal, -light1) + 0.3), 2.0) * subsurface;

    // Metal color based on hue and saturation parameters
    vec3 baseColor = hsv2rgb(vec3(hue, saturation, 0.9));
    vec3 metalColor = mix(vec3(0.88, 0.88, 0.93), baseColor, saturation);
    vec3 deepColor = hsv2rgb(vec3(hue + 0.05, saturation * 1.5, 0.7));
    metalColor = mix(deepColor, metalColor, depth);

    vec3 col = metalColor * (0.12 + diffuse * 0.5);
    col += vec3(1.0) * specular;
    col += metalColor * fresnel * 0.35;
    col += hsv2rgb(vec3(hue + 0.1, saturation * 0.5, 0.95)) * sss;

    float ao = 0.7 + depth * 0.3;
    col *= ao;

    float env = organicFBM(normal.xy * 2.0 + warpedUV, t * 0.3);
    col += metalColor * env * shininess * 0.2;

    col *= surface;

    vec3 bg = vec3(0.015, 0.02, 0.035);
    float bgGlow = smoothstep(0.2, 1.0, field) * (1.0 - surface);
    bg += metalColor * bgGlow * 0.1 * depth;

    col = mix(bg, col, surface);

    // Enhanced edge glow
    float edge = smoothstep(threshold - 0.15, threshold, field) -
                 smoothstep(threshold, threshold + 0.25, field);
    col += metalColor * edge * edgeGlow * depth;

    gl_FragColor = vec4(col, 1.0);
}
