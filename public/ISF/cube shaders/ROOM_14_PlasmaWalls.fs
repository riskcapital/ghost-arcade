/*{
    "DESCRIPTION": "Window into a room with living plasma flowing along the walls and edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "plasmaScale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "edgeWidth", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.6}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Plasma function: layered sine waves
float plasma(vec2 p, float t) {
    float v = 0.0;
    v += sin(p.x * 3.0 + t * 1.1);
    v += sin(p.y * 2.7 - t * 0.9);
    v += sin((p.x + p.y) * 2.3 + t * 0.7);
    v += sin(length(p) * 3.5 - t * 1.3);
    return v * 0.25; // -1 to 1
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    // Distance from each of 4 edges
    float dLeft = uv.x;
    float dRight = 1.0 - uv.x;
    float dBottom = uv.y;
    float dTop = 1.0 - uv.y;
    float minEdge = min(min(dLeft, dRight), min(dBottom, dTop));

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.4;
        vec2 luv = fromCenter * parallax;

        // Recompute edge distances at this parallax depth
        vec2 layerUV = luv * 0.5 + 0.5;
        float ldL = layerUV.x;
        float ldR = 1.0 - layerUV.x;
        float ldB = layerUV.y;
        float ldT = 1.0 - layerUV.y;
        float lMinEdge = min(min(ldL, ldR), min(ldB, ldT));

        // Edge proximity: 1 at edge, 0 at center
        float ew = edgeWidth * (1.0 + z * 0.3);
        float edgeProximity = smoothstep(ew, 0.0, lMinEdge);

        // Plasma coordinates along each edge
        // Use the coordinate parallel to the nearest edge for flow
        float flowCoord;
        if (ldL < ldR && ldL < ldB && ldL < ldT) {
            flowCoord = layerUV.y; // left wall: flow vertically
        } else if (ldR < ldB && ldR < ldT) {
            flowCoord = layerUV.y; // right wall: flow vertically
        } else if (ldB < ldT) {
            flowCoord = layerUV.x; // bottom wall: flow horizontally
        } else {
            flowCoord = layerUV.x; // top wall: flow horizontally
        }

        // Plasma pattern flowing along the wall
        vec2 plasmaUV = vec2(flowCoord * 6.0 * plasmaScale, lMinEdge * 10.0);
        float flowSpeed = t * (0.8 + fi * 0.15) * (1.0 + sin(fi * 2.3) * 0.3);
        float p = plasma(plasmaUV + vec2(flowSpeed, fi * 2.0), flowSpeed);

        // Add noise for organic variation
        float n = noise(plasmaUV * 2.0 + vec2(t * 0.3, fi * 5.0));
        p = p * 0.7 + n * 0.5;

        // Shape: concentrated at edges
        float glow = edgeProximity * (0.6 + p * 0.5);
        glow = max(glow, 0.0);
        glow *= glow; // sharpen

        // Depth brightness
        float brightness = (1.0 - z * 0.65) * intensity;
        brightness *= 1.0 + beat * 0.4 * (1.0 - z);

        // Neon plasma colors: cycle through vibrant hues per layer
        float hue = fi * 0.8 + colorShift + p * 1.5;
        vec3 plasmaCol = vec3(
            0.5 + 0.5 * sin(hue),
            0.5 + 0.5 * sin(hue + 2.094),
            0.5 + 0.5 * sin(hue + 4.189)
        );
        // Boost saturation
        plasmaCol = pow(plasmaCol, vec3(0.7));
        plasmaCol *= 1.0 + high * 0.5;

        col += plasmaCol * glow * brightness * 0.3;
    }

    // Hot edge glow: bright line at the very edge
    float edgeLine = exp(-minEdge * 20.0) * 0.15 * intensity * (1.0 + beat * 0.6);
    float edgeHue = t * 0.5 + colorShift;
    vec3 edgeCol = vec3(
        0.5 + 0.5 * sin(edgeHue),
        0.5 + 0.5 * sin(edgeHue + 2.094),
        0.5 + 0.5 * sin(edgeHue + 4.189)
    );
    col += edgeCol * edgeLine;

    // Room vignette: keep center dark
    float centerDark = smoothstep(0.0, 0.4, edgeDist);
    col *= 0.3 + centerDark * 0.7;

    gl_FragColor = vec4(col, 1.0);
}
