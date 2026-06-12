/**
 * Ghost Arcade — Ableton Link native addon.
 *
 * Thin N-API wrapper around ableton::Link (vendored at vendor/link,
 * GPLv2 — commercial distribution requires Ableton's no-cost
 * proprietary Link license, see docs/time-sync-review-2026-06.md).
 *
 * Design: ONE LinkSession instance lives in the Electron main process.
 * Link spawns its own network/service threads internally and every
 * method we expose is thread-safe by Link's design. No callbacks /
 * ThreadSafeFunctions — the renderer POLLS getState() (Link clients
 * conventionally capture state per tick anyway), and the JS side
 * re-anchors a local beat-phase extrapolation on each poll, so 4-Hz
 * polling gives frame-accurate phase between polls.
 */

#include <napi.h>

#include <memory>

#include <ableton/Link.hpp>

class LinkSession : public Napi::ObjectWrap<LinkSession> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "LinkSession", {
            InstanceMethod("enable", &LinkSession::Enable),
            InstanceMethod("isEnabled", &LinkSession::IsEnabled),
            InstanceMethod("setTempo", &LinkSession::SetTempo),
            InstanceMethod("setQuantum", &LinkSession::SetQuantum),
            InstanceMethod("enableStartStopSync", &LinkSession::EnableStartStopSync),
            InstanceMethod("setIsPlaying", &LinkSession::SetIsPlaying),
            InstanceMethod("getState", &LinkSession::GetState),
        });
        exports.Set("LinkSession", func);
        return exports;
    }

    /** new LinkSession(initialBpm = 120) — Link starts DISABLED; call
     *  enable(true) to join/announce on the local network. */
    LinkSession(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<LinkSession>(info)
        , m_quantum(4.0)
    {
        double bpm = 120.0;
        if (info.Length() >= 1 && info[0].IsNumber()) {
            bpm = info[0].As<Napi::Number>().DoubleValue();
        }
        if (bpm < 20.0 || bpm > 999.0) bpm = 120.0;
        m_link = std::make_unique<ableton::Link>(bpm);
    }

private:
    std::unique_ptr<ableton::Link> m_link;
    double m_quantum;

    Napi::Value Enable(const Napi::CallbackInfo& info) {
        bool on = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        m_link->enable(on);
        return info.Env().Undefined();
    }

    Napi::Value IsEnabled(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), m_link->isEnabled());
    }

    Napi::Value SetTempo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "bpm number expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        double bpm = info[0].As<Napi::Number>().DoubleValue();
        if (bpm < 20.0 || bpm > 999.0) return Napi::Boolean::New(env, false);
        auto state = m_link->captureAppSessionState();
        state.setTempo(bpm, m_link->clock().micros());
        m_link->commitAppSessionState(state);
        return Napi::Boolean::New(env, true);
    }

    Napi::Value SetQuantum(const Napi::CallbackInfo& info) {
        if (info.Length() >= 1 && info[0].IsNumber()) {
            double q = info[0].As<Napi::Number>().DoubleValue();
            if (q >= 1.0 && q <= 64.0) m_quantum = q;
        }
        return info.Env().Undefined();
    }

    Napi::Value EnableStartStopSync(const Napi::CallbackInfo& info) {
        bool on = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        m_link->enableStartStopSync(on);
        return info.Env().Undefined();
    }

    Napi::Value SetIsPlaying(const Napi::CallbackInfo& info) {
        bool playing = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        auto state = m_link->captureAppSessionState();
        state.setIsPlaying(playing, m_link->clock().micros());
        m_link->commitAppSessionState(state);
        return info.Env().Undefined();
    }

    /** Snapshot of the session: tempo, beat/phase at "now" against the
     *  current quantum, peer count, transport. `micros` is Link's clock
     *  at capture time so JS can extrapolate phase between polls. */
    Napi::Value GetState(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        const auto time = m_link->clock().micros();
        const auto state = m_link->captureAppSessionState();

        Napi::Object out = Napi::Object::New(env);
        out.Set("enabled", Napi::Boolean::New(env, m_link->isEnabled()));
        out.Set("tempo", Napi::Number::New(env, state.tempo()));
        out.Set("beat", Napi::Number::New(env, state.beatAtTime(time, m_quantum)));
        out.Set("phase", Napi::Number::New(env, state.phaseAtTime(time, m_quantum)));
        out.Set("quantum", Napi::Number::New(env, m_quantum));
        out.Set("peers", Napi::Number::New(env, static_cast<double>(m_link->numPeers())));
        out.Set("playing", Napi::Boolean::New(env, state.isPlaying()));
        out.Set("micros", Napi::Number::New(env, static_cast<double>(time.count())));
        return out;
    }
};

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    return LinkSession::Init(env, exports);
}

NODE_API_MODULE(link_addon, InitModule)
