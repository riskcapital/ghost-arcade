/*{
    "DESCRIPTION": "Golden log-polar vortex with 3D axis rotation and warm palette volumetrics. Faithful expansion of tweetable GLSL algo #9.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Volumetric"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Speed" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0, "LABEL": "Zoom" },
        { "NAME": "marchStep", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.01, "MAX": 0.2, "LABEL": "March Step" },
        { "NAME": "glowStr", "TYPE": "float", "DEFAULT": 4000.0, "MIN": 1000.0, "MAX": 10000.0, "LABEL": "Glow Falloff" },
        { "NAME": "glowBright", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.005, "MAX": 0.1, "LABEL": "Glow Brightness" },
        { "NAME": "warmR", "TYPE": "float", "DEFAULT": 0.62, "MIN": 0.0, "MAX": 1.0, "LABEL": "Warm Red" },
        { "NAME": "warmG", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Warm Green" },
        { "NAME": "rotAxis", "TYPE": "float", "DEFAULT": 1.6, "MIN": 0.0, "MAX": 3.14, "LABEL": "Rotation Axis" }
    ]
}*/

precision highp float;

mat3 rotate3D(float angle, vec3 axis) {
    vec3 a = normalize(axis);
    float c = cos(angle), s = sin(angle);
    float oc = 1.0 - c;
    return mat3(
        oc * a.x * a.x + c,       oc * a.x * a.y - s * a.z, oc * a.x * a.z + s * a.y,
        oc * a.x * a.y + s * a.z, oc * a.y * a.y + c,       oc * a.y * a.z - s * a.x,
        oc * a.x * a.z - s * a.y, oc * a.y * a.z + s * a.x, oc * a.z * a.z + c
    );
}

void main() {
    vec4 col = vec4(0.0);
    float e = 0.0, R = 0.0;
    vec3 q = vec3(0.0);
    vec3 d = vec3(gl_FragCoord.xy * zoom / RENDERSIZE - 2.0, 1.0);
    d *= rotate3D(rotAxis, vec3(1.0, -0.7, 2.0));
    q.x -= 1.0;
    q.z -= 1.0;

    float tm = TIME * speed;

    for (float i = 0.0; i < 99.0; i += 1.0) {
        col += exp(-e * glowStr) * glowBright * vec4(1.0, vec3(warmR, warmG, 0.0));
        float s = 2.0;
        q += d * e * R * marchStep;
        vec3 p = q;
        R = length(p);
        p = vec3(log2(max(R, 0.001)) - tm, exp(-p.z / max(R, 0.001)), atan(p.x, p.y));
        p.y -= 1.0;
        e = p.y;
        for (int k = 0; k < 11; k++) {
            float s2 = 2.0 * exp2(float(k));
            if (s2 >= 2000.0) break;
            e += sin(dot(cos(p * s2), cos(p.yxz * s2 - 1.0))) / s2;
        }
    }

    gl_FragColor = col;
}
