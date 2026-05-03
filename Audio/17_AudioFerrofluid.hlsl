// ============================================================================
// Shader 17: Audio Ferrofluid Simulation
// SDF-based ferrofluid spikes where spike height and density respond to
// FFT. Surface tension parameter tied to spectral smoothness. Metallic
// shader with environment reflections.
// Target: D3D11 PS 5.0 | Fullscreen quad | Raymarched
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gSpikeHeight;      // max spike displacement, default 0.6
    float gSpikeCount;       // spike density, default 8.0
    float gMetallic;         // metallic reflection, default 0.9
    float gSurfaceTension;   // smoothness between spikes, default 0.15
    float gBaseRadius;       // ferrofluid blob radius, default 1.0
    float gCameraOrbit;      // camera speed, default 0.12
    float gEnvIntensity;     // environment map brightness, default 1.5
    float gTrailDecay;       // feedback decay, default 0.93
};

// Procedural environment map (colorful studio lighting)
float3 EnvMap(float3 rd, float t)
{
    // Multiple colored area lights
    float3 env = 0.0;

    // Top warm light
    float top = smoothstep(0.3, 1.0, rd.y);
    env += float3(0.8, 0.6, 0.4) * top * 0.3;

    // Side spectral lights that rotate
    [unroll]
    for (int i = 0; i < 4; i++)
    {
        float fi = (float)i / 4.0;
        float angle = fi * TWO_PI + t * 0.1;
        float3 lightDir = float3(cos(angle), 0.2, sin(angle));

        float energy = SampleFFT(fi * 0.25);
        float d = max(dot(rd, normalize(lightDir)), 0.0);
        float spot = pow(d, 8.0 + energy * 16.0);

        env += SpectralColor(fi + gSpectralCentroid + t * 0.01) * spot * (0.5 + energy * 2.0);
    }

    // Bottom dark
    env *= smoothstep(-0.5, 0.2, rd.y);

    // Horizon band
    float horizonBand = exp(-rd.y * rd.y * 20.0);
    env += float3(0.05, 0.08, 0.12) * horizonBand;

    return env * gEnvIntensity;
}

// Ferrofluid SDF: base sphere + FFT-driven spikes
float FerrofluidSDF(float3 p, float t)
{
    float r = length(p);
    float3 dir = p / max(r, 0.001);

    // Base sphere
    float base = r - gBaseRadius;

    // Spike field: multiple radial spikes driven by FFT
    float spikes = 0.0;
    float count = gSpikeCount;

    // Spherical coordinate-based spike distribution
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    float phi = atan2(dir.z, dir.x);

    // FFT-driven spike pattern
    [unroll]
    for (int i = 0; i < 8; i++)
    {
        float fi = (float)i / 8.0;
        float energy = SampleFFT(fi);

        // Spike direction
        float sTheta = fi * PI;
        float sPhi = fi * PHI * TWO_PI;

        float3 spikeDir = float3(
            sin(sTheta) * cos(sPhi),
            cos(sTheta),
            sin(sTheta) * sin(sPhi)
        );

        // Slowly rotate spike field
        float rot = t * 0.05;
        float cr = cos(rot), sr = sin(rot);
        spikeDir.xz = float2(spikeDir.x * cr - spikeDir.z * sr,
                              spikeDir.x * sr + spikeDir.z * cr);

        // Spike contribution: gaussian cone
        float alignment = max(dot(dir, spikeDir), 0.0);
        float spikeWidth = 0.15 + gSurfaceTension * 0.2;
        float spike = exp(-(1.0 - alignment) / (spikeWidth * spikeWidth));
        spike *= energy * gSpikeHeight;

        spikes += spike;
    }

    // Waveform adds fine ripple texture
    float waveU = frac(phi / TWO_PI + 0.5);
    float wave = SampleWaveform(waveU) * 0.03 * gAudioRMS;

    // Noise-based surface detail
    float detail = (Noise3D(dir * 6.0 + t * 0.3) - 0.5) * 0.02 * gAudioRMS;

    // Surface tension smoothing: blend between spiky and smooth
    float tension = lerp(1.0, 0.3, gSurfaceTension);
    spikes *= tension;

    return base - spikes - wave - detail;
}

// Normal
float3 FerroNormal(float3 p, float t)
{
    float eps = 0.002;
    float d = FerrofluidSDF(p, t);
    return normalize(float3(
        FerrofluidSDF(p + float3(eps, 0, 0), t) - d,
        FerrofluidSDF(p + float3(0, eps, 0), t) - d,
        FerrofluidSDF(p + float3(0, 0, eps), t) - d
    ));
}

float4 PS_Ferrofluid(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Camera
    float camAngle = t * gCameraOrbit;
    float camPitch = 0.3 + sin(t * 0.08) * 0.15;
    float camDist = 3.0 + sin(t * 0.1) * 0.2;

    float3 ro = float3(
        cos(camAngle) * cos(camPitch) * camDist,
        sin(camPitch) * camDist + 0.5,
        sin(camAngle) * cos(camPitch) * camDist
    );

    float3 fwd = normalize(-ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 2.0 + right * ndc.x + up * ndc.y);

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
        float d = FerrofluidSDF(p, t);

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
        float3 nor = FerroNormal(pos, t);

        // Metallic BRDF
        float NdotV = max(dot(nor, -rd), 0.0);
        float fresnel = pow(1.0 - NdotV, 5.0);
        fresnel = lerp(0.04, 1.0, fresnel); // Schlick approximation

        // Reflection
        float3 refl = reflect(rd, nor);
        float3 envColor = EnvMap(refl, t);

        // Diffuse: very dark for metallic surface
        float3 baseColor = float3(0.02, 0.02, 0.03); // near-black ferrofluid

        // Audio-reactive color tint at spike tips
        float spikeIntensity = length(pos) - gBaseRadius;
        spikeIntensity = saturate(spikeIntensity / gSpikeHeight);
        float3 tipTint = SpectralColor(gSpectralCentroid + spikeIntensity + t * 0.01);
        baseColor = lerp(baseColor, tipTint * 0.1, spikeIntensity * gAudioRMS);

        // Compose: metallic reflection + minimal diffuse
        float3 surface = lerp(baseColor, envColor, fresnel * gMetallic);

        // Specular highlights from env lights
        [unroll]
        for (int li = 0; li < 4; li++)
        {
            float fi = (float)li / 4.0;
            float angle = fi * TWO_PI + t * 0.1;
            float3 lightDir = normalize(float3(cos(angle), 0.5, sin(angle)));
            float spec = pow(max(dot(refl, lightDir), 0.0), 64.0);
            float energy = SampleFFT(fi * 0.25);
            surface += SpectralColor(fi + gSpectralCentroid) * spec * (0.5 + energy * 2.0);
        }

        // Edge darkening (more absorption at grazing angles for metallic)
        surface *= 0.5 + NdotV * 0.5;

        // Spike tip emission
        surface += tipTint * spikeIntensity * spikeIntensity * gAudioRMS * 1.5;

        color = surface;
    }
    else
    {
        // Environment background
        color = EnvMap(rd, t) * 0.1;
    }

    // Floor reflection plane
    if (!hit && rd.y < 0.0)
    {
        float floorT = -ro.y / rd.y;
        if (floorT > 0.0 && floorT < 10.0)
        {
            float3 floorPos = ro + rd * floorT;
            float floorR = length(floorPos.xz);

            // Reflective dark floor
            float floorRefl = 0.3 * exp(-floorR * 0.1);
            float3 floorReflDir = float3(rd.x, -rd.y, rd.z);

            // Re-trace toward ferrofluid for floor reflection
            float3 floorColor = EnvMap(floorReflDir, t) * floorRefl * 0.3;

            // Concentric ripple pattern
            float ripple = sin(floorR * 15.0 - t * 2.0) * 0.5 + 0.5;
            ripple *= exp(-floorR * 0.3) * gAudioRMS;
            floorColor += SpectralColor(gSpectralCentroid) * ripple * 0.05;

            color = lerp(color, floorColor, smoothstep(10.0, 3.0, floorT));
        }
    }

    color += trail * 0.15;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.5, 1.2, lum) * 0.5;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
