/*{
    "DESCRIPTION": "Log-polar volumetric nebula with fractal density accumulation. Faithful expansion of tweetable GLSL algo #6.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Cosmic"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Speed" },
        { "NAME": "hue", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hue" },
        { "NAME": "marchStep", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 1.0, "LABEL": "March Step" },
        { "NAME": "density", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.05, "MAX": 0.8, "LABEL": "Density" },
        { "NAME": "cameraX", "TYPE": "float", "DEFAULT": 0.3, "MIN": -1.0, "MAX": 1.0, "LABEL": "Camera X" },
        { "NAME": "cameraY", "TYPE": "float", "DEFAULT": -0.6, "MIN": -1.0, "MAX": 1.0, "LABEL": "Camera Y" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.2, "MAX": 1.5, "LABEL": "Zoom" },
        { "NAME": "oscillation", "TYPE": "float", "DEFAULT": 0.07, "MIN": 0.0, "MAX": 0.3, "LABEL": "Oscillation" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 col = vec3(0.0);
    float e = 0.0, R = 0.0, lastS = 0.0;
    vec3 q = vec3(0.0);
    vec3 d = vec3(gl_FragCoord.xy / RENDERSIZE * zoom - vec2(cameraX, cameraY), 0.5);
    q.z -= 1.0;
    q.y -= 1.0;

    float tm = TIME * speed;

    for (float i = 0.0; i < 97.0; i += 1.0) {
        col += hsv2rgb(vec3(hue, e, min(e * lastS, 1.0) / 95.0));
        float s = 5.0;
        q += d * e * R * marchStep;
        vec3 p = q;
        R = length(p);
        p = vec3(
            log(max(R, 0.001)) - tm * 0.5,
            exp(-p.z / max(R, 0.001)) + sin(tm) * oscillation + 0.2,
            atan(p.y, p.x)
        );
        p.y -= 1.0;
        e = p.y;
        for (int k = 0; k < 8; k++) {
            float s2 = 5.0 * exp2(float(k));
            if (s2 >= 1000.0) break;
            e += dot(sin(p.zxx * s2), vec3(0.4) - cos(p.yyz * s2)) / s2 * density;
            lastS = s2;
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
