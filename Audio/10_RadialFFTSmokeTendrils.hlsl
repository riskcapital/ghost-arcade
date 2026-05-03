// ============================================================================
// Shader 10: Radial FFT Smoke Tendrils
// Noise-based volumetric tendrils emanating from center. Each tendril's
// length, curl rate, and opacity are bound to an FFT bin. Creates a
// frequency-mapped smoke jellyfish / organic nebula.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gTendrilCount;     // number of major tendrils, default 16
    float gTendrilLength;    // max tendril reach, default 0.4
    float gCurlStrength;     // how much tendrils curl, default 2.0
    float gSmokeDensity;     // volumetric density, default 3.0
    float gTrailDecay;       // feedback persistence, default 0.95
    float gColorRichness;    // palette saturation, default 1.5
    float gBreathRate;       // organic breathing speed, default 0.3
    float gTurbulence;       // fine noise turbulence, default 1.0
};

// Tendril density function: how much "smoke" is at this point
// Returns density [0,1+] and tendril_id for coloring
float2 TendrilDensity(float2 uv, float t)
{
    float2 centered = uv - 0.5;
    float r = length(centered);
    float theta = atan2(centered.y, centered.x);

    float totalDensity = 0.0;
    float dominantID = 0.0;
    float maxContrib = 0.0;

    int tendrils = (int)gTendrilCount;

    [loop]
    for (int i = 0; i < tendrils; i++)
    {
        float fi = (float)i / (float)tendrils;

        // FFT energy for this tendril
        float energy = SampleFFT(fi);
        float energySmooth = SampleFFT(fi) * 0.7 + SampleFFT(frac(fi + 0.05)) * 0.3;

        // Tendril base angle
        float baseAngle = fi * TWO_PI;

        // Organic breathing: slow oscillation of tendril angle
        float breathe = sin(t * gBreathRate + fi * 3.0) * 0.1;
        float tendrilAngle = baseAngle + breathe;

        // Curl: tendril curves as it extends outward
        float curl = sin(r * gCurlStrength * PI + t * 0.5 + fi * 2.0) * r * 0.5;
        tendrilAngle += curl * energySmooth;

        // Waveform adds organic wobble
        float wave = SampleWaveform(frac(fi + r * 2.0)) * 0.1 * r;
        tendrilAngle += wave;

        // Angular distance from this tendril's center line
        float angleDiff = atan2(sin(theta - tendrilAngle), cos(theta - tendrilAngle));

        // Tendril width: wider at base, tapers toward tip
        float tendrilWidth = (0.08 + energy * 0.06) * (1.0 - r * 1.5);
        tendrilWidth = max(tendrilWidth, 0.005);

        // Gaussian cross-section
        float crossSection = exp(-angleDiff * angleDiff / (tendrilWidth * tendrilWidth));

        // Radial extent: tendril length driven by FFT energy
        float maxR = 0.05 + energySmooth * gTendrilLength;
        float radialFade = smoothstep(maxR, maxR * 0.3, r);

        // Fine turbulence within tendril
        float turb = GradNoise(float2(theta * 5.0 + fi * 10.0, r * 20.0 + t * 0.5)) * gTurbulence;
        float turbDisplace = turb * 0.3 * r;
        crossSection *= (0.7 + turbDisplace * 0.6);

        // This tendril's contribution
        float contrib = crossSection * radialFade * energySmooth * gSmokeDensity;

        totalDensity += contrib;

        if (contrib > maxContrib)
        {
            maxContrib = contrib;
            dominantID = fi;
        }
    }

    // Central core mass
    float coreDensity = exp(-r * r * 80.0) * (0.5 + gAudioRMS);
    totalDensity += coreDensity;

    return float2(totalDensity, dominantID);
}

// Volumetric smoke color based on density and position
float3 SmokeColor(float density, float tendrilID, float2 uv, float t)
{
    float r = length(uv - 0.5);

    // Base hue from tendril identity + spectral centroid
    float hue = tendrilID + gSpectralCentroid * 0.3 + t * 0.015;

    // Primary color
    float3 primary = Palette(hue,
        float3(0.5, 0.5, 0.5),
        float3(0.5, 0.5, 0.3),
        float3(1.0, 0.7, 0.4),
        float3(0.0, 0.15, 0.25));

    // Secondary color for depth (shifted hue)
    float3 secondary = SpectralColor(hue + 0.4);

    // Blend based on density: denser = brighter primary, thinner = secondary
    float3 smokeCol = lerp(secondary * 0.3, primary, saturate(density));

    // Core glow: white-hot at center
    float coreBlend = exp(-r * r * 50.0);
    smokeCol = lerp(smokeCol, float3(1.0, 0.95, 0.85), coreBlend * gAudioRMS);

    // Emission: brighter at higher density
    smokeCol *= 0.5 + density * gColorRichness;

    return smokeCol;
}

float4 PS_SmokeTendrils(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    // Aspect correction
    float aspect = gResolution.x / gResolution.y;
    float2 auv = float2((uv.x - 0.5) * aspect + 0.5, uv.y);

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Subtle UV distortion from bass
    float bass = BassBand();
    float2 distort = CurlNoise2D(auv * 3.0 + t * 0.1, 0.01) * bass * 0.005;
    float2 distortedUV = auv + distort;

    // Compute smoke density
    float2 densityData = TendrilDensity(distortedUV, t);
    float density = densityData.x;
    float tendrilID = densityData.y;

    // Smoke coloring
    float3 smokeColor = SmokeColor(density, tendrilID, distortedUV, t);

    // --- Layered rendering ---

    // Background: deep space
    float r = length(uv - 0.5);
    float3 bg = lerp(float3(0.005, 0.003, 0.012), float3(0.0, 0.0, 0.005), r * 2.0);

    // Subtle background nebula (very large scale noise)
    float nebula = FBM(uv * 2.0 + t * 0.01, 3) * 0.05;
    bg += SpectralColor(t * 0.005) * nebula;

    // Smoke contribution (additive blending with density-based opacity)
    float opacity = saturate(density * 0.8);
    float3 color = lerp(bg, smokeColor, opacity);

    // Add emissive glow on top
    color += smokeColor * max(density - 0.5, 0.0) * 2.0;

    // Trail contribution
    color += trail * 0.3;

    // --- Inner particle sparkle ---
    // Tiny bright points within dense smoke regions
    if (density > 0.3)
    {
        float sparkle = pow(ValueNoise(uv * 300.0 + t * 2.0), 15.0);
        float sparkleEnergy = SampleFFT(frac(tendrilID * 3.0 + 0.1));
        color += float3(1, 0.95, 0.8) * sparkle * density * sparkleEnergy * 0.8;
    }

    // --- Outer corona ---
    // Soft radial glow beyond tendril tips
    float coronaR = 0.2 + gAudioRMS * 0.1;
    float corona = exp(-(r - coronaR) * (r - coronaR) * 30.0) * gAudioRMS * 0.3;
    corona *= (r > coronaR * 0.8) ? 1.0 : 0.0;
    color += SpectralColor(gSpectralCentroid + 0.2) * corona;

    // --- Waveform halo ring ---
    float theta = atan2(uv.y - 0.5, (uv.x - 0.5) * aspect);
    float waveU = frac(theta / TWO_PI + 0.5);
    float wave = SampleWaveform(waveU);
    float haloR = 0.35 + wave * 0.03;
    float haloDist = abs(r - haloR);
    float halo = exp(-haloDist * haloDist * 5000.0) * 0.15;
    color += SpectralColor(waveU + t * 0.02) * halo;

    // Post: bloom on bright areas
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.5, 1.2, lum) * 0.4;

    // Vignette
    float vig = 1.0 - r * r * 3.0;
    color *= smoothstep(0.0, 0.3, vig);

    return float4(ACESFilm(color), 1.0);
}
