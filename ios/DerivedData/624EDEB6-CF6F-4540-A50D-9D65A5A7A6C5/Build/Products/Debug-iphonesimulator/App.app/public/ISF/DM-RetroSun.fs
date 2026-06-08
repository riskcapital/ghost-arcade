/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Retro synthwave sunset with grid",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Retro"],
    "INPUTS": [
        {"NAME": "sunSize", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25, "LABEL": "Sun Size"},
        {"NAME": "sunY", "TYPE": "float", "MIN": 0.3, "MAX": 0.7, "DEFAULT": 0.5, "LABEL": "Sun Height"},
        {"NAME": "gridSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Grid Speed"},
        {"NAME": "gridDensity", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0, "LABEL": "Grid Lines"},
        {"NAME": "stripeCount", "TYPE": "float", "MIN": 0.0, "MAX": 10.0, "DEFAULT": 5.0, "LABEL": "Sun Stripes"},
        {"NAME": "sunColor1", "TYPE": "color", "DEFAULT": [1.0, 0.9, 0.0, 1.0], "LABEL": "Sun Top"},
        {"NAME": "sunColor2", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Sun Bottom"},
        {"NAME": "skyColor", "TYPE": "color", "DEFAULT": [0.1, 0.0, 0.2, 1.0], "LABEL": "Sky"},
        {"NAME": "gridColor", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.8, 1.0], "LABEL": "Grid"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * gridSpeed;
    vec3 col = skyColor.rgb;

    // Gradient sky
    col = mix(skyColor.rgb * 1.5, skyColor.rgb * 0.3, uv.y);

    // Sun
    vec2 sunPos = vec2(0.5, sunY);
    vec2 sunUV = uv - sunPos;
    sunUV.x *= aspect;

    float sunDist = length(sunUV);
    float sun = smoothstep(sunSize, sunSize - 0.01, sunDist);

    // Sun gradient
    vec3 sunCol = mix(sunColor2.rgb, sunColor1.rgb, (uv.y - (sunY - sunSize)) / (sunSize * 2.0));

    // Sun stripes (horizontal bands cut out)
    if (stripeCount > 0.0) {
        float stripe = step(0.5, fract((sunY - uv.y) * stripeCount * 10.0));
        sun *= mix(1.0, stripe, step(uv.y, sunY));
    }

    col = mix(col, sunCol, sun);

    // Sun glow
    float glow = smoothstep(sunSize * 2.0, sunSize, sunDist) * 0.3;
    col += sunColor2.rgb * glow;

    // Ground/horizon
    if (uv.y < sunY - sunSize * 0.8) {
        // Perspective grid
        float groundY = sunY - sunSize * 0.8;
        float perspY = (groundY - uv.y) / groundY;
        perspY = pow(perspY, 1.5); // Perspective curve

        // Horizontal lines
        float horizLines = fract(perspY * gridDensity + t);
        float hLine = smoothstep(0.02, 0.0, abs(horizLines - 0.5) - 0.45);

        // Vertical lines
        float perspX = (uv.x - 0.5) / (1.0 - perspY * 0.8);
        float vertLines = fract(perspX * gridDensity * 0.5);
        float vLine = smoothstep(0.02, 0.0, abs(vertLines - 0.5) - 0.45);

        float grid = max(hLine, vLine) * perspY;

        // Ground color
        vec3 groundCol = skyColor.rgb * 0.2;
        col = mix(col, groundCol, step(uv.y, groundY));
        col += gridColor.rgb * grid * 0.8;
    }

    gl_FragColor = vec4(col, 1.0);
}
