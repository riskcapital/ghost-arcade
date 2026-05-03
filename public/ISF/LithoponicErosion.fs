/*{
    "DESCRIPTION": "Log-polar volumetric with ray reversal and cosine dot-product density. Faithful expansion of tweetable GLSL algo #12.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Abstract"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Speed" },
        { "NAME": "hue", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hue" },
        { "NAME": "marchStep", "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.05, "MAX": 0.5, "LABEL": "March Step" },
        { "NAME": "density", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 1.5, "LABEL": "Density" },
        { "NAME": "flipPoint", "TYPE": "float", "DEFAULT": 35.0, "MIN": 20.0, "MAX": 45.0, "LABEL": "Flip Point" },
        { "NAME": "saturation", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Saturation" },
        { "NAME": "offsetY", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0, "LABEL": "Y Offset" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 col = vec3(0.0);
    float e = 0.0, R = 0.0;
    vec3 q = vec3(0.0);
    vec3 d = vec3((gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y) + vec2(0.0, offsetY), 1.0);
    q.y -= 1.0;
    q.z -= 1.0;

    float t = TIME * speed;

    for (float i = 0.0; i < 50.0; i += 1.0) {
        e += i / 5000.0;

        // Flip ray direction after flipPoint
        if (i > flipPoint) d = vec3(-1.0);

        col += hsv2rgb(vec3(hue, e - saturation, e / 17.0));
        float s = 1.0;
        q += d * e * R * marchStep;
        vec3 p = q;
        R = length(p);
        p = vec3(
            log(max(R, 0.001)) - t * 0.2,
            -p.z / max(R, 0.001),
            p.y - p.x - t * 0.2
        );
        p.y -= 1.0;
        e = p.y;
        for (int k = 0; k < 9; k++) {
            float s2 = exp2(float(k));
            if (s2 >= 500.0) break;
            e += cos(dot(cos(p * s2), sin(p.zxy * s2))) / s2 * density;
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
