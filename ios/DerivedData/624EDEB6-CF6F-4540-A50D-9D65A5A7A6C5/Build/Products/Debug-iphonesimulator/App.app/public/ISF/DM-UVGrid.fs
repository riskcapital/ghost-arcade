/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "UV debug grid with numeric-style center axes for mapping alignment",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME":"grid","TYPE":"float","MIN":4.0,"MAX":40.0,"DEFAULT":12.0,"LABEL":"Grid"},
        {"NAME":"lineWidth","TYPE":"float","MIN":0.003,"MAX":0.05,"DEFAULT":0.01,"LABEL":"Line Width"},
        {"NAME":"axisBoost","TYPE":"float","MIN":0.0,"MAX":2.0,"DEFAULT":1.0,"LABEL":"Axis Boost"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 c = uv - 0.5;

    vec3 base = vec3(uv.x, uv.y, 0.5);

    vec2 g = fract(uv * grid);
    float lx = min(g.x, 1.0 - g.x);
    float ly = min(g.y, 1.0 - g.y);
    float line = 1.0 - smoothstep(lineWidth, lineWidth * 1.6, min(lx, ly));

    float axisX = 1.0 - smoothstep(lineWidth, lineWidth * 1.8, abs(c.x));
    float axisY = 1.0 - smoothstep(lineWidth, lineWidth * 1.8, abs(c.y));

    vec3 color = mix(base, vec3(1.0), line * 0.6);
    color = mix(color, vec3(1.0, 0.2, 0.2), axisX * axisBoost);
    color = mix(color, vec3(0.2, 1.0, 0.2), axisY * axisBoost);

    gl_FragColor = vec4(color, 1.0);
}

