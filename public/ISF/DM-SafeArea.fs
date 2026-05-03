/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Safe-area guides (95% and 90%) for projector edge setup",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME":"background","TYPE":"color","DEFAULT":[0.04,0.04,0.05,1.0],"LABEL":"Background"},
        {"NAME":"guideColor","TYPE":"color","DEFAULT":[0.4,0.95,1.0,1.0],"LABEL":"Guide Color"},
        {"NAME":"lineWidth","TYPE":"float","MIN":0.001,"MAX":0.03,"DEFAULT":0.004,"LABEL":"Line Width"},
        {"NAME":"showCenter","TYPE":"bool","DEFAULT":true,"LABEL":"Center Cross"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float rectLine(vec2 uv, vec2 minV, vec2 maxV, float w) {
    float inside = step(minV.x, uv.x) * step(minV.y, uv.y) * step(uv.x, maxV.x) * step(uv.y, maxV.y);
    float edge = step(abs(uv.x - minV.x), w) + step(abs(uv.x - maxV.x), w) + step(abs(uv.y - minV.y), w) + step(abs(uv.y - maxV.y), w);
    return clamp(inside * edge, 0.0, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec3 color = background.rgb;

    float outer = rectLine(uv, vec2(0.025), vec2(0.975), lineWidth);
    float inner = rectLine(uv, vec2(0.05), vec2(0.95), lineWidth);

    color = mix(color, guideColor.rgb, outer);
    color = mix(color, guideColor.rgb * 0.75, inner);

    if (showCenter) {
        float cx = 1.0 - smoothstep(lineWidth, lineWidth * 2.0, abs(uv.x - 0.5));
        float cy = 1.0 - smoothstep(lineWidth, lineWidth * 2.0, abs(uv.y - 0.5));
        color = mix(color, vec3(1.0), max(cx, cy) * 0.7);
    }

    gl_FragColor = vec4(color, 1.0);
}

