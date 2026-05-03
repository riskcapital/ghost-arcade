// ============================================================================
// Shader 06: Audio Reactive Reaction-Diffusion
// Gray-Scott reaction-diffusion where feed/kill rates are modulated by
// frequency bands. Bass swells organic growth, treble triggers decay.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

// Ping-pong: previous simulation state (R=chemical_A, G=chemical_B, BA=aux)
Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gFeedRate;         // base feed rate, default 0.055
    float gKillRate;         // base kill rate, default 0.062
    float gDiffuseA;         // diffusion rate A, default 1.0
    float gDiffuseB;         // diffusion rate B, default 0.5
    float gSimSpeed;         // simulation steps per frame, default 8.0
    float gAudioFeedMod;     // audio modulation of feed, default 0.02
    float gAudioKillMod;     // audio modulation of kill, default 0.015
    float gColorIntensity;   // output color brightness, default 2.0
};

// Laplacian with 3x3 kernel (weighted)
float2 Laplacian(float2 uv, float2 texel)
{
    // Center weight -1, adjacent 0.2, diagonal 0.05
    float2 center = gFeedback.SampleLevel(samPointClamp, uv, 0).rg;

    float2 sum = center * -1.0;

    sum += gFeedback.SampleLevel(samPointClamp, uv + float2( texel.x, 0), 0).rg * 0.2;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2(-texel.x, 0), 0).rg * 0.2;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2(0,  texel.y), 0).rg * 0.2;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2(0, -texel.y), 0).rg * 0.2;

    sum += gFeedback.SampleLevel(samPointClamp, uv + float2( texel.x,  texel.y), 0).rg * 0.05;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2(-texel.x,  texel.y), 0).rg * 0.05;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2( texel.x, -texel.y), 0).rg * 0.05;
    sum += gFeedback.SampleLevel(samPointClamp, uv + float2(-texel.x, -texel.y), 0).rg * 0.05;

    return sum;
}

// Seed injection: drop chemical B at audio-driven locations
float SeedInjection(float2 uv, float t)
{
    float seed = 0.0;

    // Frequency-driven seed points
    [unroll]
    for (int i = 0; i < 6; i++)
    {
        float fi = (float)i / 6.0;
        float energy = SampleFFT(fi);

        if (energy > 0.4)
        {
            float angle = fi * TWO_PI + t * 0.3 + sin(t * fi * 2.0) * 0.5;
            float radius = 0.1 + fi * 0.15;
            float2 center = 0.5 + float2(cos(angle), sin(angle)) * radius;

            float dist = length(uv - center);
            seed += smoothstep(0.02, 0.0, dist) * energy;
        }
    }

    // Waveform-driven seed along a curve
    float waveY = SampleWaveform(uv.x) * 0.1;
    float waveDist = abs(uv.y - 0.5 - waveY);
    seed += smoothstep(0.005, 0.0, waveDist) * gSpectralFlux * 2.0;

    return saturate(seed);
}

float4 PS_ReactionDiffusion(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 texel = 1.0 / gResolution;
    float t = gTime;

    // Read current state
    float4 state = gFeedback.SampleLevel(samPointClamp, uv, 0);
    float A = state.r;
    float B = state.g;

    // Audio-modulated parameters
    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // Bass increases feed (growth), treble increases kill (decay)
    float feed = gFeedRate + bass * gAudioFeedMod - high * gAudioFeedMod * 0.5;
    float kill = gKillRate + high * gAudioKillMod - bass * gAudioKillMod * 0.3;

    // Mid frequencies create local parameter variation
    float2 centered = uv - 0.5;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);
    float midWave = sin(theta * 6.0 + t * mid * 2.0) * mid * 0.005;
    feed += midWave;
    kill += sin(r * 20.0 + t) * mid * 0.003;

    // Spectral centroid shifts the parameter space
    feed += (gSpectralCentroid - 0.5) * 0.005;

    // Clamp to stable parameter ranges
    feed = clamp(feed, 0.01, 0.1);
    kill = clamp(kill, 0.03, 0.08);

    // Run multiple simulation steps
    int steps = (int)gSimSpeed;
    float dt = 1.0;

    [loop]
    for (int s = 0; s < steps; s++)
    {
        float2 lap = Laplacian(uv, texel);

        float reaction = A * B * B;
        float newA = A + (gDiffuseA * lap.x - reaction + feed * (1.0 - A)) * dt;
        float newB = B + (gDiffuseB * lap.y + reaction - (kill + feed) * B) * dt;

        A = saturate(newA);
        B = saturate(newB);
    }

    // Seed injection
    float seeds = SeedInjection(uv, t);
    B = saturate(B + seeds * 0.5);

    // Initialize: if first frame or very low activity, seed center
    float totalActivity = A + B;
    if (gTime < 0.1)
    {
        float initDist = length(uv - 0.5);
        if (initDist < 0.05) B = 1.0;
        A = 1.0;
    }

    // --- Colorization ---

    // Map chemical concentrations to color
    float bConc = B;
    float aConc = A;
    float edge = saturate(length(float2(
        gFeedback.SampleLevel(samPointClamp, uv + float2(texel.x, 0), 0).g -
        gFeedback.SampleLevel(samPointClamp, uv - float2(texel.x, 0), 0).g,
        gFeedback.SampleLevel(samPointClamp, uv + float2(0, texel.y), 0).g -
        gFeedback.SampleLevel(samPointClamp, uv - float2(0, texel.y), 0).g
    )) * 10.0);

    // Color palette driven by audio
    float hueBase = gSpectralCentroid * 0.5 + t * 0.02;

    // Chemical B concentration → warm/hot colors
    float3 bColor = Palette(bConc + hueBase,
        float3(0.5, 0.5, 0.5),
        float3(0.5, 0.5, 0.5),
        float3(1.0, 1.0, 0.5),
        float3(0.0, 0.15, 0.20));

    // Edges → bright spectral highlights
    float3 edgeColor = SpectralColor(hueBase + 0.3) * edge * 2.0;

    // Background: chemical A regions are dark
    float3 bgColor = float3(0.01, 0.005, 0.02) * aConc;

    float3 color = lerp(bgColor, bColor, bConc) * gColorIntensity + edgeColor;

    // Emission bloom on high-concentration areas
    float bloom = smoothstep(0.5, 0.9, bConc) * gAudioRMS;
    color += SpectralColor(hueBase + bConc * 0.5) * bloom * 1.5;

    // Store simulation state in RG, visual in output
    // Note: render target must be R16G16B16A16_FLOAT
    // We pack A,B into the output and read back next frame
    // The visual output goes to a separate resolve pass, OR
    // we use R=A, G=B and compute color in a second pass.
    // For single-pass: store state and display simultaneously:

    return float4(A, B, edge, 1.0);
}

// --- Second pass: colorize the RD state ---
// Bind the RD output as t3, run this pass to the display target

float4 PS_RDColorize(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 texel = 1.0 / gResolution;
    float t = gTime;

    float4 state = gFeedback.SampleLevel(samLinearClamp, uv, 0);
    float A = state.r;
    float B = state.g;
    float edge = state.b;

    float hueBase = gSpectralCentroid * 0.5 + t * 0.02;

    // Rich multi-layer coloring
    float3 bColor = Palette(B * 0.8 + hueBase,
        float3(0.5, 0.5, 0.5),
        float3(0.5, 0.5, 0.5),
        float3(1.0, 1.0, 0.5),
        float3(0.0, 0.15, 0.20));

    float3 edgeColor = SpectralColor(hueBase + 0.3) * edge * 3.0;
    float3 bgColor = float3(0.008, 0.003, 0.015);

    float3 color = lerp(bgColor, bColor * gColorIntensity, B) + edgeColor;

    // Bloom
    float bloom = smoothstep(0.5, 0.9, B) * gAudioRMS;
    color += SpectralColor(hueBase + B * 0.5) * bloom * 2.0;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
