// ============================================================================
// Shader 12: Phase-Correlated Double Pendulum
// Simulated double pendulum system where arm lengths and masses shift
// with bass/mid/treble. Trace path rendered with waveform-colored
// persistent trails. Multiple pendulums for visual density.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gPendulumCount;    // number of concurrent pendulums, default 6
    float gTrailDecay;       // persistence trail decay, default 0.975
    float gLineGlow;         // trace glow radius, default 0.004
    float gArmBrightness;    // arm/joint visibility, default 1.0
    float gSimSpeed;         // simulation speed multiplier, default 1.0
    float gGravity;          // gravity constant, default 9.81
    float gDamping;          // energy damping, default 0.999
    float gColorSpeed;       // trail color cycle speed, default 0.1
};

// Double pendulum state
struct PendulumState
{
    float theta1, theta2;    // angles
    float omega1, omega2;    // angular velocities
    float L1, L2;            // arm lengths
    float m1, m2;            // masses
};

// Double pendulum derivatives (Lagrangian mechanics)
float4 PendulumDerivatives(PendulumState s, float g)
{
    float dt = s.theta1 - s.theta2;
    float sinDt = sin(dt);
    float cosDt = cos(dt);

    float M = s.m1 + s.m2;

    // Denominators
    float den1 = s.L1 * (2.0 * s.m1 + s.m2 - s.m2 * cos(2.0 * dt));
    float den2 = s.L2 * (2.0 * s.m1 + s.m2 - s.m2 * cos(2.0 * dt));

    // Angular accelerations
    float alpha1 = (-g * M * sin(s.theta1)
                    - s.m2 * g * sin(s.theta1 - 2.0 * s.theta2)
                    - 2.0 * sinDt * s.m2 * (s.omega2 * s.omega2 * s.L2 + s.omega1 * s.omega1 * s.L1 * cosDt))
                    / den1;

    float alpha2 = (2.0 * sinDt * (s.omega1 * s.omega1 * s.L1 * M
                    + g * M * cos(s.theta1)
                    + s.omega2 * s.omega2 * s.L2 * s.m2 * cosDt))
                    / den2;

    return float4(s.omega1, s.omega2, alpha1, alpha2);
}

// RK4 integration step
PendulumState IntegratePendulum(PendulumState s, float dt, float g)
{
    // k1
    float4 k1 = PendulumDerivatives(s, g);

    // k2
    PendulumState s2 = s;
    s2.theta1 = s.theta1 + k1.x * dt * 0.5;
    s2.theta2 = s.theta2 + k1.y * dt * 0.5;
    s2.omega1 = s.omega1 + k1.z * dt * 0.5;
    s2.omega2 = s.omega2 + k1.w * dt * 0.5;
    float4 k2 = PendulumDerivatives(s2, g);

    // k3
    PendulumState s3 = s;
    s3.theta1 = s.theta1 + k2.x * dt * 0.5;
    s3.theta2 = s.theta2 + k2.y * dt * 0.5;
    s3.omega1 = s.omega1 + k2.z * dt * 0.5;
    s3.omega2 = s.omega2 + k2.w * dt * 0.5;
    float4 k3 = PendulumDerivatives(s3, g);

    // k4
    PendulumState s4 = s;
    s4.theta1 = s.theta1 + k3.x * dt;
    s4.theta2 = s.theta2 + k3.y * dt;
    s4.omega1 = s.omega1 + k3.z * dt;
    s4.omega2 = s.omega2 + k3.w * dt;
    float4 k4 = PendulumDerivatives(s4, g);

    // Combine
    PendulumState result = s;
    result.theta1 = s.theta1 + (k1.x + 2.0*k2.x + 2.0*k3.x + k4.x) * dt / 6.0;
    result.theta2 = s.theta2 + (k1.y + 2.0*k2.y + 2.0*k3.y + k4.y) * dt / 6.0;
    result.omega1 = (s.omega1 + (k1.z + 2.0*k2.z + 2.0*k3.z + k4.z) * dt / 6.0) * gDamping;
    result.omega2 = (s.omega2 + (k1.w + 2.0*k2.w + 2.0*k3.w + k4.w) * dt / 6.0) * gDamping;
    result.L1 = s.L1;
    result.L2 = s.L2;
    result.m1 = s.m1;
    result.m2 = s.m2;

    return result;
}

// Get pendulum tip positions
float2 PendulumTip1(PendulumState s)
{
    return float2(sin(s.theta1), cos(s.theta1)) * s.L1;
}

float2 PendulumTip2(PendulumState s)
{
    float2 p1 = PendulumTip1(s);
    return p1 + float2(sin(s.theta2), cos(s.theta2)) * s.L2;
}

// Distance from point to line segment
float SegDist(float2 p, float2 a, float2 b)
{
    float2 pa = p - a;
    float2 ba = b - a;
    float h = clamp(dot(pa, ba) / (dot(ba, ba) + 0.0001), 0.0, 1.0);
    return length(pa - ba * h);
}

float4 PS_DoublePendulum(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    float aspect = gResolution.x / gResolution.y;
    float2 p = (uv - 0.5) * 2.0;
    p.x *= aspect;

    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Slight trail color shift over time
    float2 trailShift = float2(sin(t * 0.01), cos(t * 0.01)) * 0.001;
    trail.rg += gFeedback.SampleLevel(samLinearClamp, uv + trailShift, 0).rg * 0.005;

    float3 color = 0.0;
    int count = (int)gPendulumCount;

    [loop]
    for (int pi = 0; pi < count; pi++)
    {
        float fi = (float)pi / (float)count;

        // Initialize pendulum with unique starting conditions
        PendulumState pend;
        pend.theta1 = PI * 0.5 + fi * 0.3 + sin(t * 0.01 + fi * 5.0) * 0.01;
        pend.theta2 = PI * 0.75 + fi * 0.5 + cos(t * 0.01 + fi * 3.0) * 0.01;
        pend.omega1 = 0.0;
        pend.omega2 = 0.0;

        // Audio-modulated arm lengths and masses
        pend.L1 = 0.3 + bass * 0.15 + fi * 0.05;
        pend.L2 = 0.25 + mid * 0.12 + fi * 0.04;
        pend.m1 = 1.0 + bass * 0.5;
        pend.m2 = 1.0 + high * 0.8;

        float g = gGravity + mid * 2.0;

        // Simulate forward from a deterministic starting state
        // Use time as the integration span
        float simTime = fmod(t * gSimSpeed, 60.0); // wrap to prevent divergence
        float dt = 0.01;
        int steps = (int)(simTime / dt);
        steps = min(steps, 2000);

        [loop]
        for (int s = 0; s < steps; s++)
        {
            pend = IntegratePendulum(pend, dt, g);
        }

        // Now trace the last ~200 steps and render
        float3 pendColor = SpectralColor(fi + gSpectralCentroid + t * gColorSpeed);

        float2 prevTip = PendulumTip2(pend);

        [loop]
        for (int trace = 0; trace < 200; trace++)
        {
            pend = IntegratePendulum(pend, dt, g);
            float2 tip = PendulumTip2(pend);

            // Distance from pixel to this trace segment
            float dist = SegDist(p, prevTip, tip);

            // Glow
            float glow = exp(-dist * dist / (gLineGlow * gLineGlow));

            // Fade older parts of trace
            float traceFade = (float)(200 - trace) / 200.0;

            // Velocity-based brightness
            float vel = length(tip - prevTip) / dt;
            float velBright = 0.5 + 0.5 / (1.0 + vel * 0.5);

            // Waveform color modulation along trace
            float waveU = frac((float)trace / 200.0 + fi);
            float wave = SampleWaveform(waveU) * 0.5 + 0.5;
            float3 segColor = lerp(pendColor, SpectralColor(fi + wave + t * 0.02), 0.3);

            color += segColor * glow * traceFade * velBright * 0.015;

            prevTip = tip;
        }

        // Draw arms and joints for the current state
        float2 pivot = float2(0, 0);
        float2 joint = PendulumTip1(pend);
        float2 tip = PendulumTip2(pend);

        // Arm 1
        float arm1Dist = SegDist(p, pivot, joint);
        float arm1 = exp(-arm1Dist * arm1Dist * 30000.0);
        color += float3(0.3, 0.4, 0.5) * arm1 * gArmBrightness * 0.3;

        // Arm 2
        float arm2Dist = SegDist(p, joint, tip);
        float arm2 = exp(-arm2Dist * arm2Dist * 30000.0);
        color += float3(0.3, 0.4, 0.5) * arm2 * gArmBrightness * 0.3;

        // Joints (bright dots)
        float pivotGlow = exp(-dot(p - pivot, p - pivot) * 5000.0);
        float jointGlow = exp(-dot(p - joint, p - joint) * 5000.0);
        float tipGlow   = exp(-dot(p - tip, p - tip) * 3000.0);

        float energy = SampleFFT(fi);
        color += pendColor * (pivotGlow + jointGlow) * 0.5;
        color += pendColor * tipGlow * (1.0 + energy * 2.0);
    }

    // Combine with trail
    float3 finalColor = trail + color;

    // Background
    float bgR = length(p) * 0.15;
    finalColor += float3(0.005, 0.003, 0.01) * (1.0 - saturate(bgR));

    // Bloom
    float lum = dot(finalColor, float3(0.2126, 0.7152, 0.0722));
    finalColor += finalColor * smoothstep(0.3, 0.8, lum) * 0.3;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    finalColor *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(finalColor), 1.0);
}
