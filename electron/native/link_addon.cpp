/**
 * Ghost Arcade — Ableton Link native addon.
 *
 * Thin N-API wrapper around ableton::Link (vendored at vendor/link,
 * GPLv2 — commercial distribution requires Ableton's no-cost
 * proprietary Link license, see docs/time-sync-review-2026-06.md).
 *
 * Design: ONE LinkSession instance lives in the Electron main process.
 * Link spawns its own network/service threads internally and every
 * method we expose is thread-safe by Link's design. The renderer POLLS
 * getState() (Link clients conventionally capture state per tick anyway),
 * and the JS side re-anchors a local beat-phase extrapolation on each
 * poll. Start/stop and peer-count changes are also pushed at once through
 * setEventHandler(fn) (an N-API thread-safe function), so a transport
 * change in another app does not wait for the next poll.
 */

#include <napi.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>

#include <ableton/Link.hpp>

namespace {

/** What the Link callbacks and the JS thread share. Held by shared_ptr so
 *  an event still queued for the JS thread keeps Link alive until it runs. */
struct LinkCore {
    explicit LinkCore(double bpm) : link(bpm) {}
    ableton::Link link;
    std::atomic<double> quantum{4.0};
};

double clampQuantum(double q, double fallback) {
    return (q >= 1.0 && q <= 64.0) ? q : fallback;
}

/** The session as JS reads it, captured now against `quantum`. */
Napi::Object stateObject(Napi::Env env, LinkCore& core, double quantum) {
    auto& link = core.link;
    const auto time = link.clock().micros();
    const auto state = link.captureAppSessionState();
    const auto playingTime = state.timeForIsPlaying();

    Napi::Object out = Napi::Object::New(env);
    out.Set("enabled", Napi::Boolean::New(env, link.isEnabled()));
    out.Set("tempo", Napi::Number::New(env, state.tempo()));
    out.Set("beat", Napi::Number::New(env, state.beatAtTime(time, quantum)));
    out.Set("phase", Napi::Number::New(env, state.phaseAtTime(time, quantum)));
    out.Set("quantum", Napi::Number::New(env, quantum));
    out.Set("peers", Napi::Number::New(env, static_cast<double>(link.numPeers())));
    out.Set("playing", Napi::Boolean::New(env, state.isPlaying()));
    out.Set("startStopSync", Napi::Boolean::New(env, link.isStartStopSyncEnabled()));
    out.Set("micros", Napi::Number::New(env, static_cast<double>(time.count())));
    // When the transport last started or stopped (Link's clock, µs), and the
    // beat there against the same quantum.
    out.Set("playingMicros", Napi::Number::New(env, static_cast<double>(playingTime.count())));
    out.Set("playingBeat", Napi::Number::New(env, state.beatAtTime(playingTime, quantum)));
    return out;
}

} // namespace

class LinkSession : public Napi::ObjectWrap<LinkSession> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "LinkSession", {
            InstanceMethod("enable", &LinkSession::Enable),
            InstanceMethod("isEnabled", &LinkSession::IsEnabled),
            InstanceMethod("setTempo", &LinkSession::SetTempo),
            InstanceMethod("setQuantum", &LinkSession::SetQuantum),
            InstanceMethod("enableStartStopSync", &LinkSession::EnableStartStopSync),
            InstanceMethod("isStartStopSyncEnabled", &LinkSession::IsStartStopSyncEnabled),
            InstanceMethod("setIsPlaying", &LinkSession::SetIsPlaying),
            InstanceMethod("setIsPlayingAndRequestBeatAtTime", &LinkSession::SetIsPlayingAndRequestBeatAtTime),
            InstanceMethod("requestBeatAtStartPlayingTime", &LinkSession::RequestBeatAtStartPlayingTime),
            InstanceMethod("timeAtBeat", &LinkSession::TimeAtBeat),
            InstanceMethod("clockMicros", &LinkSession::ClockMicros),
            InstanceMethod("setEventHandler", &LinkSession::SetEventHandler),
            InstanceMethod("getState", &LinkSession::GetState),
        });
        exports.Set("LinkSession", func);
        return exports;
    }

    /** new LinkSession(initialBpm = 120) — Link starts DISABLED; call
     *  enable(true) to join/announce on the local network. */
    LinkSession(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<LinkSession>(info)
    {
        double bpm = 120.0;
        if (info.Length() >= 1 && info[0].IsNumber()) {
            bpm = info[0].As<Napi::Number>().DoubleValue();
        }
        if (bpm < 20.0 || bpm > 999.0) bpm = 120.0;
        m_core = std::make_shared<LinkCore>(bpm);
    }

    ~LinkSession() override {
        clearEventHandler();
    }

private:
    std::shared_ptr<LinkCore> m_core;
    std::mutex m_eventsMutex;
    Napi::ThreadSafeFunction m_events;
    bool m_hasEvents = false;

    ableton::Link& link() { return m_core->link; }

    static double numberArg(const Napi::CallbackInfo& info, size_t i, double fallback) {
        return info.Length() > i && info[i].IsNumber() ? info[i].As<Napi::Number>().DoubleValue() : fallback;
    }

    Napi::Value Enable(const Napi::CallbackInfo& info) {
        bool on = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        link().enable(on);
        return info.Env().Undefined();
    }

    Napi::Value IsEnabled(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), link().isEnabled());
    }

    Napi::Value SetTempo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "bpm number expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        double bpm = info[0].As<Napi::Number>().DoubleValue();
        if (bpm < 20.0 || bpm > 999.0) return Napi::Boolean::New(env, false);
        auto state = link().captureAppSessionState();
        state.setTempo(bpm, link().clock().micros());
        link().commitAppSessionState(state);
        return Napi::Boolean::New(env, true);
    }

    Napi::Value SetQuantum(const Napi::CallbackInfo& info) {
        if (info.Length() >= 1 && info[0].IsNumber()) {
            double q = info[0].As<Napi::Number>().DoubleValue();
            if (q >= 1.0 && q <= 64.0) m_core->quantum = q;
        }
        return info.Env().Undefined();
    }

    Napi::Value EnableStartStopSync(const Napi::CallbackInfo& info) {
        bool on = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        link().enableStartStopSync(on);
        return info.Env().Undefined();
    }

    Napi::Value IsStartStopSyncEnabled(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), link().isStartStopSyncEnabled());
    }

    /** setIsPlaying(playing, timeMicros = now). */
    Napi::Value SetIsPlaying(const Napi::CallbackInfo& info) {
        bool playing = info.Length() >= 1 ? info[0].ToBoolean().Value() : true;
        const auto now = link().clock().micros();
        const auto at = std::chrono::microseconds(static_cast<long long>(numberArg(info, 1, static_cast<double>(now.count()))));
        auto state = link().captureAppSessionState();
        state.setIsPlaying(playing, at);
        link().commitAppSessionState(state);
        return info.Env().Undefined();
    }

    /** setIsPlayingAndRequestBeatAtTime(playing, timeMicros, beat, quantum). */
    Napi::Value SetIsPlayingAndRequestBeatAtTime(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 4 || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsNumber()) {
            Napi::TypeError::New(env, "(playing, timeMicros, beat, quantum) expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const bool playing = info[0].ToBoolean().Value();
        const auto at = std::chrono::microseconds(static_cast<long long>(info[1].As<Napi::Number>().DoubleValue()));
        const double beat = info[2].As<Napi::Number>().DoubleValue();
        const double quantum = clampQuantum(info[3].As<Napi::Number>().DoubleValue(), m_core->quantum);
        auto state = link().captureAppSessionState();
        state.setIsPlayingAndRequestBeatAtTime(playing, at, beat, quantum);
        link().commitAppSessionState(state);
        return env.Undefined();
    }

    /** requestBeatAtStartPlayingTime(beat, quantum): a no-op while not playing. */
    Napi::Value RequestBeatAtStartPlayingTime(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
            Napi::TypeError::New(env, "(beat, quantum) expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const double beat = info[0].As<Napi::Number>().DoubleValue();
        const double quantum = clampQuantum(info[1].As<Napi::Number>().DoubleValue(), m_core->quantum);
        auto state = link().captureAppSessionState();
        state.requestBeatAtStartPlayingTime(beat, quantum);
        link().commitAppSessionState(state);
        return env.Undefined();
    }

    /** timeAtBeat(beat, quantum) → Link clock µs when the session reaches `beat`. */
    Napi::Value TimeAtBeat(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "beat number expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const double beat = info[0].As<Napi::Number>().DoubleValue();
        const double quantum = clampQuantum(numberArg(info, 1, m_core->quantum), m_core->quantum);
        const auto state = link().captureAppSessionState();
        return Napi::Number::New(env, static_cast<double>(state.timeAtBeat(beat, quantum).count()));
    }

    Napi::Value ClockMicros(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(link().clock().micros().count()));
    }

    void clearEventHandler() {
        // Swap the callbacks out first: Link holds its callback mutex while it
        // calls them, so once these return no callback is still running.
        link().setStartStopCallback([](bool) {});
        link().setNumPeersCallback([](std::size_t) {});
        std::lock_guard<std::mutex> lock(m_eventsMutex);
        if (m_hasEvents) {
            m_events.Release();
            m_hasEvents = false;
        }
    }

    /** setEventHandler(fn | null): fn({ type: 'startStop' | 'peers', ...state })
     *  on the JS thread for each start/stop or peer-count change. */
    Napi::Value SetEventHandler(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        clearEventHandler();
        if (info.Length() < 1 || !info[0].IsFunction()) return env.Undefined();

        {
            std::lock_guard<std::mutex> lock(m_eventsMutex);
            m_events = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "LinkEvents", 0, 1);
            // Pushed events never keep the process alive on their own.
            m_events.Unref(env);
            m_hasEvents = true;
        }

        auto post = [this](const char* type) {
            std::lock_guard<std::mutex> lock(m_eventsMutex);
            if (!m_hasEvents) return;
            std::shared_ptr<LinkCore> core = m_core;
            m_events.NonBlockingCall([core, type](Napi::Env env, Napi::Function fn) {
                Napi::Object state = stateObject(env, *core, core->quantum);
                state.Set("type", Napi::String::New(env, type));
                fn.Call({ state });
            });
        };
        link().setStartStopCallback([post](bool) { post("startStop"); });
        link().setNumPeersCallback([post](std::size_t) { post("peers"); });
        return env.Undefined();
    }

    /** Snapshot of the session: tempo, beat/phase at "now" against the
     *  current quantum, peer count, transport. `micros` is Link's clock
     *  at capture time so JS can extrapolate phase between polls. */
    Napi::Value GetState(const Napi::CallbackInfo& info) {
        return stateObject(info.Env(), *m_core, m_core->quantum);
    }
};

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    return LinkSession::Init(env, exports);
}

NODE_API_MODULE(link_addon, InitModule)
