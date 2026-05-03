/*{
    "DESCRIPTION": "Smoke Chamber - Volumetric smoke fills the shape colliding with and curling off boundaries",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "smokeDensity", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "riseSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "curlStrength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "smokeColor", "TYPE": "color", "DEFAULT": [0.6, 0.6, 0.65, 1.0]},
        {"NAME": "lightColor", "TYPE": "color", "DEFAULT": [1.0, 0.9, 0.7, 1.0]},
        {"NAME": "ambientColor", "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.1, 1.0]},
        {"NAME": "edgeCurl", "TYPE": "color", "DEFAULT": [0.8, 0.7, 0.5, 1.0]},
        {"NAME": "lightDir", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 7; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

// Curl noise for smoke motion
vec2 curlNoise(vec2 p) {
    float eps = 0.01;
    float n1 = fbm(p + vec2(eps, 0.0));
    float n2 = fbm(p - vec2(eps, 0.0));
    float n3 = fbm(p + vec2(0.0, eps));
    float n4 = fbm(p - vec2(0.0, eps));
    return vec2(n3 - n4, -(n1 - n2)) / (2.0 * eps);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    // Smoke advection with curl noise
    vec2 smokeUV = uv;
    smokeUV.y -= t * riseSpeed * 0.3; // Rise
    
    // Edge repulsion - smoke curls when hitting walls
    vec2 edgeForce = vec2(0.0);
    edgeForce.x += exp(-edgeL * 10.0) * curlStrength * 0.1;
    edgeForce.x -= exp(-edgeR * 10.0) * curlStrength * 0.1;
    edgeForce.y += exp(-edgeB * 10.0) * curlStrength * 0.1;
    edgeForce.y -= exp(-edgeT * 10.0) * curlStrength * 0.1;
    
    // Curl noise motion
    vec2 curl = curlNoise(smokeUV * 3.0 + t * 0.2) * turbulence * 0.15;
    smokeUV += curl + edgeForce;
    
    // Layer multiple smoke octaves
    float smoke = 0.0;
    smoke += fbm(smokeUV * 3.0 + t * 0.1) * 0.5;
    smoke += fbm(smokeUV * 6.0 - t * 0.15 + 50.0) * 0.3;
    smoke += fbm(smokeUV * 12.0 + t * 0.08 + 100.0) * 0.2;
    
    smoke = pow(smoke, 1.5) * smokeDensity * 2.0;
    smoke = clamp(smoke, 0.0, 1.0);
    
    // Edge pooling - smoke accumulates in corners and along edges
    float cornerPool = 0.0;
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0);
    corners[1] = vec2(1.0, 0.0);
    corners[2] = vec2(1.0, 1.0);
    corners[3] = vec2(0.0, 1.0);
    for (int i = 0; i < 4; i++) {
        float cd = length(uv - corners[i]);
        cornerPool += exp(-cd * 5.0) * 0.3;
    }
    smoke += cornerPool * smokeDensity * 0.5;
    smoke = clamp(smoke, 0.0, 1.0);
    
    // Edge curl wisps
    float edgeCurlWisp = 0.0;
    float edgeWispNoise = fbm(vec2(uv.y * 8.0 + t, edgeL * 10.0));
    edgeCurlWisp += exp(-edgeL * 8.0) * edgeWispNoise * curlStrength;
    edgeCurlWisp += exp(-edgeR * 8.0) * fbm(vec2(uv.y * 8.0 + t + 50.0, edgeR * 10.0)) * curlStrength;
    edgeCurlWisp += exp(-edgeB * 8.0) * fbm(vec2(uv.x * 8.0 + t + 100.0, edgeB * 10.0)) * curlStrength;
    edgeCurlWisp += exp(-edgeT * 8.0) * fbm(vec2(uv.x * 8.0 + t + 150.0, edgeT * 10.0)) * curlStrength;
    
    // Lighting
    vec2 lightPos = vec2(0.5 + lightDir * 0.3, 0.8);
    float lightDist = length(uv - lightPos);
    float lighting = exp(-lightDist * 2.0);
    
    // Smoke scattering
    vec3 litSmoke = mix(ambientColor.rgb, smokeColor.rgb, 0.5 + lighting * 0.5);
    litSmoke += lightColor.rgb * lighting * smoke * 0.3;
    
    // Compose
    vec3 col = ambientColor.rgb;
    col = mix(col, litSmoke, smoke);
    col += edgeCurl.rgb * edgeCurlWisp * 0.2;
    
    // God rays through smoke
    float rays = 0.0;
    vec2 rayDir = normalize(uv - lightPos);
    float rayAngle = atan(rayDir.y, rayDir.x);
    rays = pow(0.5 + 0.5 * sin(rayAngle * 12.0), 4.0) * exp(-lightDist * 3.0);
    col += lightColor.rgb * rays * (1.0 - smoke * 0.5) * 0.15;
    
    gl_FragColor = vec4(col, 1.0);
}
