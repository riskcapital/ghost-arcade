// ============================================================================
// Shader 20: FFT Displacement Sphere
// Sphere with vertex displacement driven by FFT bins mapped to latitude.
// Surface normals recalculated per-frame creating shifting iridescent
// reflections. Multi-layer displacement with waveform fine detail.
// Target: D3D11 PS 5.0 | Fullscreen quad | Raymarched
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gSphereRadius;     // base radius, default 1.2
    float gDisplaceAmount;   // FFT displacement scale, default 0.5
    float gWaveDetail;       // waveform fine detail amount, default 0.15
    float gIridStrength;     // iridescence intensity, default 2.0
    float gCameraOrbit;      // camera orbit speed, default 0.1
    float gEnvBrightness;    // environment reflection brightness, default 1.5
    float gTrailDecay;       // feedback decay, default 0.94
    float gNoiseOctaves;     // surface noise detail, default 3.0
};

// FFT-displaced sphere SDF
float DisplacedSphereSDF(float3 p, float t)
{
    float r = length(p);
    float3 dir = p / max(r, 0.001);

    // Spherical coordinates
    float theta = acos(clamp(dir.y, -1.0, 1.0)); // latitude [0, PI]
    float phi = atan2(dir.z, dir.x);               // longitude [-PI, PI]

    // Normalise to [0,1] for texture sampling
    float latU = theta / PI;
    float lonU = phi / TWO_PI + 0.5;

    // --- FFT displacement mapped to latitude ---
    float fftDisplace = SampleFFT(latU) * gDisplaceAmount;

    // Smooth FFT: average neighboring bins for less jagged surface
    float fftSmooth = (SampleFFT(latU) * 0.5 +
                       SampleFFT(frac(latU + 0.02)) * 0.25 +
                       SampleFFT(frac(latU - 0.02)) * 0.25) * gDisplaceAmount;

    // --- Waveform fine detail mapped to longitude ---
    float waveDisplace = SampleWaveform(lonU) * gWaveDetail;

    // --- Second FFT layer: longitude bands ---
    float fftLon = SampleFFT(frac(lonU * 0.5)) * gDisplaceAmount * 0.3;

    // --- Noise detail ---
    float noiseDisplace = 0.0;
    float noiseFreq = 4.0;
    float noiseAmp = 0.03 * gAudioRMS;
    int octaves = (int)gNoiseOctaves;

    [loop]
    for (int i = 0; i < octaves; i++)
    {
        noiseDisplace += Noise3D(dir * noiseFreq + t * 0.2) * noiseAmp;
        noiseFreq *= 2.2;
        noiseAmp *= 0.45;
    }

    // Total displacement
    float displacement = fftSmooth + waveDisplace + fftLon + noiseDisplace;

    // Breathing: subtle uniform scale
    float breath = sin(t * 0.3) * 0.02 + gAudioRMS * 0.05;

    return r - (gSphereRadius + displacement + breath);
}

// Analytical normal via central differences
float3 DisplacedSphereNormal(float3 p, float t)
{
    float eps = 0.003;
    float d = DisplacedSphereSDF(p, t);
    return normalize(float3(
        DisplacedSphereSDF(p + float3(eps, 0, 0), t) - d,
        DisplacedSphereSDF(p + float3(0, eps, 0), t) - d,
        DisplacedSphereSDF(p + float3(0, 0, eps), t) - d
    ));
}

// Iridescent thin-film interference color
float3 ThinFilmIridescence(float cosTheta, float thickness, float t)
{
    // Simulate spectral interference pattern
    float3 color = 0.0;

    // Multiple wavelength channels
    [unroll]
    for (int i = 0; i < 8; i++)
    {
        float wavelength = 0.38 + (float)i * 0.05; // 380nm - 750nm range
        float phase = TWO_PI * 2.0 * thickness * cosTheta / wavelength;
        float interference = cos(phase) * 0.5 + 0.5;

        // Wavelength to RGB (simplified)
        float3 wColor = SpectralColor((float)i / 8.0);
        color += wColor * interference;
    }

    return color / 4.0; // normalize
}

// Rich procedural environment
float3 Environment(float3 rd, float t)
{
    float3 env = 0.0;

    // Gradient sky
    float sky = rd.y * 0.5 + 0.5;
    env = lerp(float3(0.02, 0.01, 0.04), float3(0.01, 0.02, 0.05), sky);

    // Rotating spectral lights
    [unroll]
    for (int i = 0; i < 6; i++)
    {
        float fi = (float)i / 6.0;
        float energy = SampleFFT(fi);

        float angle = fi * TWO_PI + t * 0.15;
        float elevation = sin(fi * PI * 2.0 + t * 0.1) * 0.5;
        float3 lightDir = normalize(float3(cos(angle), elevation, sin(angle)));

        float d = max(dot(rd, lightDir), 0.0);
        float spot = pow(d, 12.0 + energy * 24.0);

        env += SpectralColor(fi + gSpectralCentroid + t * 0.005) * spot * (0.3 + energy * 2.5);
    }

    // Nebula-like background clouds
    float nebula = FBM(rd.xz * 3.0 + t * 0.01, 3) * 0.1;
    env += SpectralColor(t * 0.003 + 0.3) * nebula;

    return env * gEnvBrightness;
}

float4 PS_FFTDisplaceSphere(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Camera
    float camAngle = t * gCameraOrbit;
    float camPitch = sin(t * 0.06) * 0.3;
    float camDist = 3.2 + sin(t * 0.09) * 0.2;

    float3 ro = float3(
        cos(camAngle) * cos(camPitch) * camDist,
        sin(camPitch) * camDist,
        sin(camAngle) * cos(camPitch) * camDist
    );

    float3 fwd = normalize(-ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.8 + right * ndc.x + up * ndc.y);

    // Feedback
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Raymarch
    float3 color = 0.0;
    float totalT = 0.0;
    bool hit = false;

    [loop]
    for (int i = 0; i < 80; i++)
    {
        float3 p = ro + rd * totalT;
        float d = DisplacedSphereSDF(p, t);

        // Near-surface glow
        if (d < 0.3)
        {
            float glowD = exp(-d * d * 60.0);
            float3 dir = p / max(length(p), 0.001);
            float latU = acos(clamp(dir.y, -1.0, 1.0)) / PI;
            float fftE = SampleFFT(latU);
            color += SpectralColor(latU + gSpectralCentroid) * glowD * fftE * 0.01;
        }

        if (d < 0.001)
        {
            hit = true;
            break;
        }

        totalT += d * 0.6;
        if (totalT > 8.0) break;
    }

    if (hit)
    {
        float3 pos = ro + rd * totalT;
        float3 nor = DisplacedSphereNormal(pos, t);
        float3 dir = normalize(pos);

        // Surface parameters
        float theta = acos(clamp(dir.y, -1.0, 1.0));
        float phi = atan2(dir.z, dir.x);
        float latU = theta / PI;
        float lonU = phi / TWO_PI + 0.5;

        float fftVal = SampleFFT(latU);
        float waveVal = abs(SampleWaveform(lonU));

        // --- Iridescent surface ---
        float NdotV = max(dot(nor, -rd), 0.0);

        // Thin film thickness varies with FFT and position
        float filmThickness = 0.4 + fftVal * 0.3 + waveVal * 0.1;
        float3 iridColor = ThinFilmIridescence(NdotV, filmThickness, t);

        // Fresnel
        float fresnel = pow(1.0 - NdotV, 4.0);

        // Reflection
        float3 refl = reflect(rd, nor);
        float3 envColor = Environment(refl, t);

        // Base color from FFT latitude band
        float3 baseColor = SpectralColor(latU + gSpectralCentroid + t * 0.01);

        // Compose surface
        float3 surface = baseColor * 0.05; // minimal diffuse
        surface += envColor * (fresnel * 0.6 + 0.2); // environment reflection
        surface += iridColor * gIridStrength * (0.5 + fftVal); // iridescence

        // Specular highlights
        float3 lightDir = normalize(float3(0.5, 0.8, 0.3));
        float spec = pow(max(dot(refl, lightDir), 0.0), 48.0);
        surface += float3(1, 0.97, 0.93) * spec * 0.8;

        // FFT latitude bands: emission along frequency ridges
        float ridgeGlow = fftVal * fftVal * 1.5;
        surface += baseColor * ridgeGlow;

        // Waveform longitude streaks
        float waveStreak = exp(-waveVal * 30.0) * gAudioRMS;
        surface += SpectralColor(lonU + gSpectralCentroid + 0.3) * waveStreak * 0.5;

        // Displacement edge glow: bright at steep displacement boundaries
        float3 sideNor = normalize(pos);
        float normalDeviation = 1.0 - abs(dot(nor, sideNor));
        surface += SpectralColor(gSpectralCentroid + normalDeviation) * normalDeviation * 1.0;

        float fog = exp(-totalT * 0.08);
        color += surface * fog;
    }
    else
    {
        color += Environment(rd, t) * 0.15;
    }

    color += trail * 0.2;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.4, 1.0, lum) * 0.4;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 1.8;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
