/*{
    "DESCRIPTION": "Log-polar spiral fractal with iterated polar-to-cartesian conversion and fract tiling. Faithful expansion of tweetable GLSL algo #7.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Fractal"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Speed" },
        { "NAME": "foldAngle", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 3.14, "LABEL": "Fold Angle" },
        { "NAME": "foldDepth", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 8.0, "LABEL": "Fold Depth" },
        { "NAME": "brightness", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.005, "MAX": 0.1, "LABEL": "Brightness" },
        { "NAME": "falloff", "TYPE": "float", "DEFAULT": 2000.0, "MIN": 500.0, "MAX": 5000.0, "LABEL": "Edge Falloff" },
        { "NAME": "spiralScale", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0, "LABEL": "Spiral Scale" },
        { "NAME": "warpStr", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.5, "MAX": 6.0, "LABEL": "Warp" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 col = vec3(0.0);
    float g = 0.0;
    float ca = cos(foldAngle), sa = sin(foldAngle);
    mat2 foldRot = mat2(ca, sa, -sa, ca);
    float k = TIME * speed * 0.5;
    int maxFolds = int(foldDepth);

    for (float i = 0.0; i < 100.0; i += 1.0) {
        float v = 0.1;
        vec3 p = vec3((gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y), 1.0 - g);
        p.zx *= foldRot;

        for (int j = 0; j < 8; j++) {
            if (j >= maxFolds) break;
            float l = length(p.xy);
            v *= l;
            p = vec3(l * spiralScale - k, atan(p.y, p.x) / 3.14159, p.z / max(l, 0.001) + l * warpStr);
            p.xy = fract(vec2(p.y + p.x, p.x + p.x)) - 0.5;
        }

        float e = length(p) * v;
        g += e;
        col += hsv2rgb(vec3(g * p.y, 1.0, brightness / exp(max(0.0, e * falloff))));
    }

    gl_FragColor = vec4(col, 1.0);
}
