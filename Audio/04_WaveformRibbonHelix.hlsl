// ============================================================================
// Shader 04: Waveform Ribbon Helix
// Raw waveform data extruded along a spiraling ribbon in 3D space.
// Ribbon thickness and twist rate respond to RMS energy.
// Color mapped to instantaneous frequency / spectral centroid.
// Target: D3D11 PS 5.0 | Fullscreen quad | Raymarched SDF
// ============================================================================

#include "AudioShaderCommon.hlsli"

cbuffer ShaderParams : register(b1)
{
    float gHelixRadius;      // helix orbit radius, default 1.2
    float gHelixPitch;       // helix vertical pitch, default 0.8
    float gRibbonWidth;      // base ribbon width, default 0.08
    float gTwistRate;        // ribbon twist per revolution, default 3.0
    float gCameraOrbitSpeed; // camera orbit speed, default 0.2
    float gEmissionPower;    // glow emission strength, default 3.0
    float gTrailLength;      // number of helix loops visible, default 6.0
    float gWaveformScale;    // waveform displacement scale, default 0.4
};

// Helix ribbon SDF
// p: query point
// Returns (distance, waveform_position for coloring)
float2 HelixRibbonSDF(float3 p, float t)
{
    float bestDist = 1e6;
    float bestU = 0.0;

    // Sample along the helix spine
    const int SAMPLES = 96;

    [loop]
    for (int i = 0; i < SAMPLES; i++)
    {
        float u = (float)i / (float)SAMPLES;

        // Helix parameter: angle along spiral
        float angle = u * TWO_PI * gTrailLength + t * 0.5;
        float height = u * gHelixPitch * gTrailLength - gHelixPitch * gTrailLength * 0.5;

        // Sample waveform at this position
        float wave = SampleWaveform(frac(u + t * 0.1)) * gWaveformScale;

        // FFT energy at this position modulates radius
        float fftVal = SampleFFT(u);

        // Spine point on helix
        float r = gHelixRadius + wave + fftVal * 0.2;
        float3 spine = float3(
            cos(angle) * r,
            height + wave * 0.5,
            sin(angle) * r
        );

        // Ribbon cross-section: twisted flat ribbon
        // Compute local frame
        float nextAngle = angle + 0.1;
        float nextHeight = height + 0.1 * gHelixPitch;
        float3 nextSpine = float3(cos(nextAngle) * r, nextHeight, sin(nextAngle) * r);
        float3 tangent = normalize(nextSpine - spine);
        float3 normal = normalize(float3(-cos(angle), 0, -sin(angle)));
        float3 binormal = cross(tangent, normal);

        // Twist the ribbon
        float twist = angle * gTwistRate + gAudioRMS * TWO_PI;
        float ct = cos(twist), st = sin(twist);
        float3 ribbonNormal = normal * ct + binormal * st;

        // Distance to ribbon (flat cross-section)
        float3 delta = p - spine;
        float alongNormal = dot(delta, ribbonNormal);
        float alongTangent = dot(delta, tangent);

        // Ribbon width modulated by RMS and local FFT
        float width = gRibbonWidth * (0.5 + gAudioRMS + fftVal * 0.5);
        float thickness = 0.01 + fftVal * 0.02;

        // Flat ribbon SDF (rectangular cross-section)
        float dNormal = abs(alongNormal) - thickness;
        float dWidth = abs(dot(delta, cross(tangent, ribbonNormal))) - width;
        float dist = length(max(float2(dNormal, dWidth), 0.0));

        // Point distance to spine (for fallback / glow)
        float spineDist = length(delta - tangent * alongTangent);

        // Use minimum of ribbon SDF and a capsule approximation for robustness
        float capsuleDist = spineDist - (thickness + width) * 0.5;
        float d = min(dist, max(capsuleDist, 0.0));

        if (d < bestDist)
        {
            bestDist = d;
            bestU = u;
        }
    }

    return float2(bestDist, bestU);
}

// Simplified glow ribbon for performance - uses distance field glow
float3 RibbonGlow(float2 sdf, float t)
{
    float dist = sdf.x;
    float u = sdf.y;

    // FFT value at this position
    float fftVal = SampleFFT(u);

    // Color based on position along helix + spectral centroid
    float hue = u + gSpectralCentroid * 0.5 + t * 0.03;
    float3 baseColor = SpectralColor(hue);

    // Sharp ribbon core
    float core = exp(-dist * dist * 8000.0) * (1.0 + fftVal * 2.0);

    // Medium glow
    float glow1 = exp(-dist * dist * 800.0) * fftVal;

    // Wide soft glow
    float glow2 = exp(-dist * 50.0) * fftVal * 0.3;

    // Edge highlight: brighter at ribbon edges
    float edge = exp(-abs(dist - 0.03) * abs(dist - 0.03) * 5000.0) * fftVal * 0.5;

    float intensity = (core + glow1 + glow2 + edge) * gEmissionPower;

    // Add complementary color in glow for richness
    float3 glowColor = SpectralColor(hue + 0.5) * glow2 * gEmissionPower;

    return baseColor * intensity + glowColor;
}

float4 PS_WaveformRibbon(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = uv * 2.0 - 1.0;
    ndc.x *= gResolution.x / gResolution.y;

    float t = gTime;

    // Orbiting camera
    float camAngle = t * gCameraOrbitSpeed;
    float camDist = 3.5 + sin(t * 0.1) * 0.5;
    float camHeight = sin(t * 0.15) * 1.0 + gAudioRMS * 0.5;
    float3 ro = float3(cos(camAngle) * camDist, camHeight, sin(camAngle) * camDist);
    float3 target = float3(0, 0, 0);
    float3 fwd = normalize(target - ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.5 + right * ndc.x + up * ndc.y);

    // Raymarch the ribbon SDF
    float3 color = 0.0;
    float totalDist = 0.0;
    float minDist = 1e6;
    float minU = 0.0;

    [loop]
    for (int i = 0; i < 64; i++)
    {
        float3 p = ro + rd * totalDist;
        float2 sdf = HelixRibbonSDF(p, t);

        if (sdf.x < minDist)
        {
            minDist = sdf.x;
            minU = sdf.y;
        }

        // Accumulate volumetric glow even when not hitting surface
        if (sdf.x < 0.5)
        {
            float3 glowContrib = RibbonGlow(sdf, t) * 0.04;
            color += glowContrib * exp(-totalDist * 0.1);
        }

        if (sdf.x < 0.002) break;

        totalDist += max(sdf.x * 0.5, 0.01);
        if (totalDist > 15.0) break;
    }

    // If we hit the surface, add solid contribution
    if (minDist < 0.05)
    {
        float3 hitGlow = RibbonGlow(float2(minDist, minU), t);
        color += hitGlow;
    }

    // Background: subtle radial gradient
    float bgGrad = length(ndc) * 0.3;
    float3 bg = lerp(float3(0.01, 0.005, 0.02), float3(0.0, 0.0, 0.01), bgGrad);

    // Subtle background particles
    float2 bgUV = ndc * 3.0;
    float stars = pow(ValueNoise(bgUV * 50.0 + t * 0.01), 12.0) * 0.3;
    bg += stars;

    color += bg * (1.0 - saturate(length(color)));

    // Post: vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 1.5;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
