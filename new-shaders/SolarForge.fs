/*{
    "DESCRIPTION": "Warped 2D flow pattern with domain warping and bright node points. Faithful expansion of tweetable GLSL algo #10.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "2D", "Flow"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 4.0, "MIN": 0.0, "MAX": 10.0, "LABEL": "Speed" },
        { "NAME": "warpAngle", "TYPE": "float", "DEFAULT": 5.0, "MIN": 0.0, "MAX": 6.28, "LABEL": "Warp Angle" },
        { "NAME": "scaleMult", "TYPE": "float", "DEFAULT": 1.2, "MIN": 1.05, "MAX": 1.5, "LABEL": "Scale Growth" },
        { "NAME": "baseScale", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0, "LABEL": "Base Scale" },
        { "NAME": "iterations", "TYPE": "float", "DEFAULT": 30.0, "MIN": 10.0, "MAX": 40.0, "LABEL": "Iterations" },
        { "NAME": "redBoost", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0, "LABEL": "Red Boost" },
        { "NAME": "nodeGlow", "TYPE": "float", "DEFAULT": 0.001, "MIN": 0.0001, "MAX": 0.01, "LABEL": "Node Glow" },
        { "NAME": "vignette", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.5, "LABEL": "Vignette" }
    ]
}*/

precision highp float;

void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - RENDERSIZE) / RENDERSIZE.y;
    vec2 n = vec2(0.0), N = vec2(0.0);
    float S = baseScale, a = 0.0;
    float cw = cos(warpAngle), sw = sin(warpAngle);
    mat2 m = mat2(cw, sw, -sw, cw);
    float t = TIME;
    int maxIter = int(iterations);

    for (int j = 0; j < 40; j++) {
        if (j >= maxIter) break;
        float fj = float(j);
        p *= m;
        n *= m;
        vec2 q = p * S + fj + n + t * speed + sin(t * speed) * 0.8;
        a += dot(cos(q) / S, vec2(1.0));
        vec2 sq = sin(q);
        n += sq;
        N += sq / (S + 60.0);
        S *= scaleMult;
    }

    vec4 col = vec4(0.1 - a * 0.1);
    col.r *= redBoost;
    col += min(0.7, nodeGlow / length(N));
    col -= col * dot(p, p) * vignette;

    gl_FragColor = vec4(col.rgb, 1.0);
}
