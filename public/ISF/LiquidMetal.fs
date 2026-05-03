/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Liquid metal mercury effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "flowSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "blobScale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0},
        {"NAME": "reflectivity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "metalTint", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0},
        {"NAME": "surfaceTension", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

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

float metaball(vec2 p, vec2 center, float radius) {
    float d = length(p - center);
    return radius / (d * d + 0.01);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * flowSpeed;

    // Create metaball field
    float field = 0.0;

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float angle = fi * 0.785 + t * (0.3 + fi * 0.1);
        float radius = 0.2 + sin(t + fi) * 0.1;
        vec2 pos = vec2(cos(angle), sin(angle)) * radius;

        // Add noise to position
        pos += vec2(noise(vec2(fi, t)) - 0.5, noise(vec2(fi + 10.0, t)) - 0.5) * 0.3;

        field += metaball(uv * blobScale, pos * blobScale, 0.3 + fi * 0.05);
    }

    // Threshold for surface
    float surface = smoothstep(surfaceTension, surfaceTension + 0.1, field);

    // Calculate normals for lighting
    float eps = 0.01;
    float fx = metaball(uv * blobScale + vec2(eps, 0.0), vec2(0.0), 1.0) - field;
    float fy = metaball(uv * blobScale + vec2(0.0, eps), vec2(0.0), 1.0) - field;
    vec3 normal = normalize(vec3(fx, fy, 0.3));

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 32.0);

    // Metal color
    vec3 metalColor = mix(vec3(0.8, 0.8, 0.85), hsv2rgb(vec3(metalTint, 0.3, 0.9)), metalTint > 0.01 ? 1.0 : 0.0);

    // Environment reflection fake
    float envReflect = noise(uv * 5.0 + normal.xy * 2.0 + t * 0.5);
    envReflect = smoothstep(0.3, 0.7, envReflect);

    vec3 col = metalColor * diffuse * 0.5;
    col += vec3(1.0) * specular * reflectivity;
    col += metalColor * envReflect * reflectivity * 0.3;

    col *= surface;

    // Background
    col += vec3(0.05, 0.05, 0.08) * (1.0 - surface);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
