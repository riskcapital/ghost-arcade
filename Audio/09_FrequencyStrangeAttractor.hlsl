// ============================================================================
// Shader 09: Frequency-Driven Strange Attractor
// Lorenz / Rössler attractor where system parameters (sigma, rho, beta)
// are continuously modulated by frequency bands. Creates morphing chaotic
// trajectories rendered as volumetric glow trails.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gAttractorType;    // 0=Lorenz, 1=Rossler, 2=Aizawa, default 0
    float gTrailDecay;       // persistence trail decay, default 0.97
    float gPointCount;       // trajectory sample points, default 8000
    float gStepSize;         // integration step, default 0.005
    float gGlowSize;         // point glow radius, default 0.006
    float gBrightness;       // overall emission, default 2.5
    float gCameraSpeed;      // orbit speed, default 0.12
    float gAudioModDepth;    // how much audio affects params, default 1.0
};

// Lorenz system: dx/dt = sigma*(y-x), dy/dt = x*(rho-z)-y, dz/dt = x*y - beta*z
float3 LorenzDerivative(float3 p, float sigma, float rho, float beta)
{
    return float3(
        sigma * (p.y - p.x),
        p.x * (rho - p.z) - p.y,
        p.x * p.y - beta * p.z
    );
}

// Rössler system: dx/dt = -y-z, dy/dt = x+a*y, dz/dt = b+z*(x-c)
float3 RosslerDerivative(float3 p, float a, float b, float c)
{
    return float3(
        -p.y - p.z,
        p.x + a * p.y,
        b + p.z * (p.x - c)
    );
}

// Aizawa system
float3 AizawaDerivative(float3 p, float a, float b, float c, float d, float e, float f)
{
    return float3(
        (p.z - b) * p.x - d * p.y,
        d * p.x + (p.z - b) * p.y,
        c + a * p.z - (p.z * p.z * p.z) / 3.0 - (p.x * p.x + p.y * p.y) * (1.0 + e * p.z) + f * p.z * p.x * p.x * p.x
    );
}

// Integrate one step with audio-modulated parameters
float3 IntegrateStep(float3 p, float t, float bass, float mid, float high)
{
    float mod = gAudioModDepth;
    float3 dp;

    int aType = (int)gAttractorType;

    if (aType == 0) // Lorenz
    {
        float sigma = 10.0 + bass * 5.0 * mod;
        float rho   = 28.0 + mid * 10.0 * mod - high * 3.0 * mod;
        float beta  = 2.667 + high * 1.5 * mod;
        dp = LorenzDerivative(p, sigma, rho, beta);
    }
    else if (aType == 1) // Rössler
    {
        float a = 0.2 + bass * 0.1 * mod;
        float b = 0.2 + mid * 0.15 * mod;
        float c = 5.7 + high * 3.0 * mod + bass * 2.0 * mod;
        dp = RosslerDerivative(p, a, b, c);
    }
    else // Aizawa
    {
        float a = 0.95 + bass * 0.1 * mod;
        float b = 0.7 + mid * 0.2 * mod;
        float c = 0.6 + high * 0.15 * mod;
        float d = 3.5 + bass * 0.5 * mod;
        float e = 0.25 + mid * 0.1 * mod;
        float f = 0.1 + high * 0.05 * mod;
        dp = AizawaDerivative(p, a, b, c, d, e, f);
    }

    return p + dp * gStepSize;
}

// Project 3D attractor point to screen space
float2 ProjectPoint(float3 p, float3 camPos, float3x3 camRot)
{
    float3 local = mul(camRot, p - camPos);

    // Perspective projection
    float fov = 1.5;
    if (local.z < 0.01) local.z = 0.01;
    return float2(local.x, local.y) * fov / local.z;
}

float4 PS_StrangeAttractor(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    float aspect = gResolution.x / gResolution.y;
    float2 p = (uv - 0.5) * 2.0;
    p.x *= aspect;

    // Audio bands
    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // Orbiting camera
    float camAngle = t * gCameraSpeed;
    float camPitch = sin(t * gCameraSpeed * 0.3) * 0.3;
    float camDist = 50.0; // Lorenz scale

    int aType = (int)gAttractorType;
    if (aType == 1) camDist = 20.0;  // Rössler is smaller
    if (aType == 2) camDist = 4.0;   // Aizawa is much smaller

    float3 camPos = float3(
        cos(camAngle) * camDist * cos(camPitch),
        sin(camPitch) * camDist * 0.5 + (aType == 0 ? 25.0 : 0.0),
        sin(camAngle) * camDist * cos(camPitch)
    );

    float3 camTarget = (aType == 0) ? float3(0, 0, 25) : float3(0, 0, 0);
    float3 fwd = normalize(camTarget - camPos);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3x3 camRot = float3x3(right, up, fwd);

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Integrate attractor trajectory and accumulate point cloud glow
    float3 color = 0.0;

    // Starting point (perturbed slightly by audio for variation)
    float3 pos;
    if (aType == 0) pos = float3(1.0 + bass * 0.5, 1.0, 1.0 + high * 0.3);
    else if (aType == 1) pos = float3(0.1, 0.1 + bass * 0.1, 0.1);
    else pos = float3(0.1, 0.0, 0.0);

    // Warm up attractor (skip initial transient)
    [loop]
    for (int w = 0; w < 200; w++)
    {
        pos = IntegrateStep(pos, t, bass, mid, high);
    }

    int points = (int)gPointCount;
    float invPoints = 1.0 / (float)points;

    [loop]
    for (int i = 0; i < points; i++)
    {
        pos = IntegrateStep(pos, t, bass, mid, high);

        // Project to screen
        float2 screenPos = ProjectPoint(pos, camPos, camRot);

        // Distance from this pixel to projected point
        float dist = length(p - screenPos);

        // Glow contribution
        float glow = exp(-dist * dist / (gGlowSize * gGlowSize));

        // Color based on trajectory position (velocity-based hue)
        float fi = (float)i * invPoints;
        float velocity = length(pos - IntegrateStep(pos, t, bass, mid, high)) / gStepSize;
        float hue = fi * 0.5 + gSpectralCentroid * 0.3 + velocity * 0.001 + t * 0.01;
        float3 ptColor = SpectralColor(hue);

        // Depth fade: dimmer when further from camera
        float3 local = mul(camRot, pos - camPos);
        float depthFade = 1.0 / (1.0 + local.z * 0.02);

        color += ptColor * glow * depthFade * invPoints * 3.0;
    }

    color *= gBrightness;

    // Combine with trail
    float3 finalColor = trail + color;

    // Add subtle center glow based on attractor density
    float centerGlow = exp(-dot(p, p) * 0.5) * gAudioRMS * 0.1;
    finalColor += SpectralColor(gSpectralCentroid) * centerGlow;

    // Bloom on bright areas
    float lum = dot(finalColor, float3(0.2126, 0.7152, 0.0722));
    float bloom = smoothstep(0.4, 1.0, lum);
    finalColor += finalColor * bloom * 0.4;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    finalColor *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(finalColor), 1.0);
}
