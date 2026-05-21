/**
 * Ghost Arcade — NDI Native Addon
 *
 * Wraps NewTek's NDI Advanced SDK in an N-API addon so the Electron
 * main process can stream slice pixels to NDI senders. Mirrors the
 * IPC shape of the Spout / Syphon addons:
 *
 *   ndi_create_sender({ name })     → opaque sender id (string)
 *   ndi_send_image({ id, data, width, height })  → frame upload
 *   ndi_destroy_sender({ id })      → tear-down
 *   ndi_available()                 → bool (always true once loaded)
 *
 * Build prerequisites:
 *  - NDI Advanced SDK (free, NewTek terms). Install from
 *    https://ndi.video/sdk/. On macOS the default install path is
 *    /Library/NDI Advanced SDK for Apple/, on Windows it's
 *    C:\Program Files\NDI\NDI Advanced SDK\.
 *  - The CMakeLists in this folder detects the SDK at one of the
 *    standard install paths and only builds this addon when found.
 *    Without the SDK installed the build skips ndi_addon entirely and
 *    main.js falls back to a no-op stub (NDI dropdown still appears
 *    in slice settings but sends are silently dropped — Spout /
 *    Syphon continue to work as before).
 *
 * Frame format:
 *  - Input is BGRA (8-bit per channel, 4 bytes per pixel) as produced
 *    by Electron's readPixels path. NDI expects the same byte order
 *    so we forward the buffer with no swizzle.
 *
 * Threading:
 *  - NDIlib_send_create / send_destroy / send_send_video_v2_async are
 *    thread-safe per the SDK docs. We call them synchronously from
 *    the V8 thread; SDK does the actual network IO internally.
 */

#include <napi.h>
#include <Processing.NDI.Lib.h>

#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct NdiSender {
  NDIlib_send_instance_t instance = nullptr;
  std::string name;
  // Per-sender frame buffer. NDI's async send keeps a reference to
  // the bytes until the next send call, so we hold onto the previous
  // frame's storage rather than pushing the caller's V8 buffer (which
  // could be GC'd between calls).
  std::vector<uint8_t> frameStorage;
};

std::map<std::string, std::unique_ptr<NdiSender>> g_senders;
std::mutex g_mutex;
bool g_ndi_initialized = false;

bool ensureNDIInitialized() {
  if (g_ndi_initialized) return true;
  if (!NDIlib_initialize()) return false;
  g_ndi_initialized = true;
  return true;
}

Napi::Value Available(const Napi::CallbackInfo& info) {
  // SDK is loaded at startup if it's there at all; ensureNDIInitialized
  // runs the SDK's CPU feature check which may fail on ancient hardware.
  return Napi::Boolean::New(info.Env(), ensureNDIInitialized());
}

Napi::Value CreateSender(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected { name }").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!ensureNDIInitialized()) {
    Napi::Error::New(env, "NDIlib_initialize failed (unsupported CPU?)").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  std::string name = opts.Get("name").As<Napi::String>().Utf8Value();

  // Bail if a sender with this name already exists — caller should
  // destroy first. Avoids double-create.
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_senders.count(name)) {
      Napi::Error::New(env, "NDI sender with this name already exists").ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  NDIlib_send_create_t desc = {};
  desc.p_ndi_name = name.c_str();
  desc.p_groups = nullptr;
  desc.clock_video = true;   // pace at the configured framerate
  desc.clock_audio = false;

  auto sender = std::make_unique<NdiSender>();
  sender->instance = NDIlib_send_create(&desc);
  if (!sender->instance) {
    Napi::Error::New(env, "NDIlib_send_create returned null — check NDI runtime is installed").ThrowAsJavaScriptException();
    return env.Null();
  }
  sender->name = name;

  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_senders[name] = std::move(sender);
  }
  return Napi::String::New(env, name);
}

Napi::Value DestroySender(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected { name }").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string name = info[0].As<Napi::Object>().Get("name").As<Napi::String>().Utf8Value();
  std::unique_ptr<NdiSender> sender;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_senders.find(name);
    if (it == g_senders.end()) return Napi::Boolean::New(env, false);
    sender = std::move(it->second);
    g_senders.erase(it);
  }
  if (sender && sender->instance) {
    NDIlib_send_destroy(sender->instance);
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value SendImage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected { name, data, width, height }").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  std::string name = opts.Get("name").As<Napi::String>().Utf8Value();
  Napi::Buffer<uint8_t> data = opts.Get("data").As<Napi::Buffer<uint8_t>>();
  int width = opts.Get("width").As<Napi::Number>().Int32Value();
  int height = opts.Get("height").As<Napi::Number>().Int32Value();

  if (width <= 0 || height <= 0) {
    Napi::Error::New(env, "Invalid frame dimensions").ThrowAsJavaScriptException();
    return env.Null();
  }
  size_t expected = static_cast<size_t>(width) * height * 4;
  if (data.Length() < expected) {
    Napi::Error::New(env, "Frame buffer smaller than width*height*4").ThrowAsJavaScriptException();
    return env.Null();
  }

  NdiSender* sender = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_senders.find(name);
    if (it == g_senders.end()) {
      Napi::Error::New(env, "No NDI sender with this name — call create first").ThrowAsJavaScriptException();
      return env.Null();
    }
    sender = it->second.get();
  }

  // Copy the frame into the sender's persistent storage. NDI's async
  // send retains the buffer until the next send call returns; using
  // the caller's V8 buffer directly would be a use-after-free since
  // GC could reclaim it between calls.
  sender->frameStorage.assign(data.Data(), data.Data() + expected);

  NDIlib_video_frame_v2_t frame = {};
  frame.xres = width;
  frame.yres = height;
  frame.FourCC = NDIlib_FourCC_type_BGRA;
  frame.line_stride_in_bytes = width * 4;
  frame.p_data = sender->frameStorage.data();
  frame.frame_format_type = NDIlib_frame_format_type_progressive;

  // Async send pumps the network IO on the SDK's own thread. We
  // return immediately; next send_send_video call blocks if the
  // previous one is still in flight, which gives us natural back-
  // pressure without needing a per-sender inFlight flag.
  NDIlib_send_send_video_async_v2(sender->instance, &frame);
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available",      Napi::Function::New(env, Available));
  exports.Set("createSender",   Napi::Function::New(env, CreateSender));
  exports.Set("destroySender",  Napi::Function::New(env, DestroySender));
  exports.Set("sendImage",      Napi::Function::New(env, SendImage));
  return exports;
}

}  // namespace

NODE_API_MODULE(ndi_addon, Init)
