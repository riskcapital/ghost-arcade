/*{
    "DESCRIPTION": "Volumetric fractal nebula with subtractive HSV coloring and log-polar layering. Faithful expansion of tweetable GLSL algo #1.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Volumetric"],
    "INPUTS": [
        { "NAME": "hue", "TYPE": "float", "DEFAULT": 0.58, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hue" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 0.57, "MIN": 0.2, "MAX": 1.5, "LABEL": "Zoom" },
        { "NAME": "marchStep", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.2, "LABEL": "March Step" },
        { "NAME": "detail", "TYPE": "float", "DEFAULT": 0.32, "MIN": 0.05, "MAX": 0.8, "LABEL": "Detail" },
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0, "LABEL": "Speed" },
        { "NAME": "satMod", "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.0, "MAX": 0.5, "LABEL": "Saturation" },
        { "NAME": "modPeriod", "TYPE": "float", "DEFAULT": 2.8, "MIN": 1.0, "MAX": 5.0, "LABEL": "Mod Period" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 col = vec3(0.0);
    float e = 0.0, g = 0.0, R = 0.0;
    vec3 q = vec3(0.0);
    vec3 d = vec3((gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y), zoom);
    q.y -= 1.0;
    q.z -= 1.0;

    float tm = TIME * speed;

    for (float i = 0.0; i < 79.0; i += 1.0) {
        col -= hsv2rgb(vec3(hue, R + g * satMod, e - e * i / 4.5));
        float s = modPeriod;
        q += d * e * R * marchStep;
        vec3 p = q;
        g += p.y / s;
        R = length(p);
        p = vec3(R, exp2(mod(-0.25 - p.z + tm, s) / max(R, 0.001)), p.x);
        p.y -= 1.0;
        e = p.y;
        for (int k = 0; k < 10; k++) {
            float s2 = s * exp2(float(k));
            if (s2 >= 1000.0) break;
            e -= abs(dot(sin(p.xzy * s2 + e * p.y), cos(vec3(p.z) * s2 - e)) / s2 * detail);
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
