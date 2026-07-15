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

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <IOSurface/IOSurface.h>
#endif

#include <map>
#include <cstring>
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

// ============================================================
// Receiver path — discovery + per-source receivers.
//
// Discovery uses ONE global NDIlib_find instance (created lazily on
// first findSources call). NDI's discovery is mDNS-based; the finder
// keeps a running list of sources visible on the local network.
// Calling findSources() snapshots that list and returns names + URLs.
//
// A receiver is a per-source object. Caller passes the source name
// from findSources(), the addon resolves it to the underlying
// NDIlib_source_t and creates an NDIlib_recv. The renderer polls
// receiveFrame() at frame rate to pull the latest video frame as a
// BGRA buffer (we ask NDI for BGRX_BGRA pixel format so swizzle is
// avoided on the GL upload side).
// ============================================================

NDIlib_find_instance_t g_finder = nullptr;
std::mutex g_finder_mutex;

struct NdiReceiver {
  NDIlib_recv_instance_t instance = nullptr;
  std::string sourceName;
  // Persistent buffer for the most recently received frame so we can
  // copy out to a JS-owned Buffer without lifetime games against NDI's
  // own free path.
  std::vector<uint8_t> lastFrame;
  int lastWidth = 0;
  int lastHeight = 0;
  // Monotonic counter so callers can detect "is there a NEW frame?"
  // without comparing pixel content.
  uint64_t framesReceived = 0;
#if defined(__APPLE__)
  IOSurfaceRef sharedSurface = nullptr;
#endif
};
std::map<std::string, std::unique_ptr<NdiReceiver>> g_receivers;
std::mutex g_recv_mutex;
bool g_cleanup_hook_registered = false;

void CleanupAddonResources() {
  {
    std::lock_guard<std::mutex> lock(g_recv_mutex);
    for (auto& entry : g_receivers) {
      if (entry.second && entry.second->instance) {
        NDIlib_recv_destroy(entry.second->instance);
        entry.second->instance = nullptr;
      }
#if defined(__APPLE__)
      if (entry.second && entry.second->sharedSurface) {
        CFRelease(entry.second->sharedSurface);
        entry.second->sharedSurface = nullptr;
      }
#endif
    }
    g_receivers.clear();
  }

  {
    std::lock_guard<std::mutex> lock(g_mutex);
    for (auto& entry : g_senders) {
      if (entry.second && entry.second->instance) {
        NDIlib_send_destroy(entry.second->instance);
        entry.second->instance = nullptr;
      }
    }
    g_senders.clear();
  }

  {
    std::lock_guard<std::mutex> lock(g_finder_mutex);
    if (g_finder) {
      NDIlib_find_destroy(g_finder);
      g_finder = nullptr;
    }
  }

  if (g_ndi_initialized) {
    NDIlib_destroy();
    g_ndi_initialized = false;
  }
}

NDIlib_find_instance_t ensureFinder() {
  std::lock_guard<std::mutex> lock(g_finder_mutex);
  if (g_finder) return g_finder;
  NDIlib_find_create_t desc = {};
  desc.show_local_sources = true;   // include senders on this machine
  desc.p_groups = nullptr;
  desc.p_extra_ips = nullptr;
  g_finder = NDIlib_find_create_v2(&desc);
  return g_finder;
}

Napi::Value FindSources(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!ensureNDIInitialized()) {
    return Napi::Array::New(env, 0);
  }
  NDIlib_find_instance_t finder = ensureFinder();
  if (!finder) return Napi::Array::New(env, 0);

  // wait_for_sources is non-blocking when called with timeout 0 — it
  // returns immediately with the current source list. Renderer polls
  // this periodically; we don't need NDI's blocking wait semantics.
  NDIlib_find_wait_for_sources(finder, 0);
  uint32_t count = 0;
  const NDIlib_source_t* sources = NDIlib_find_get_current_sources(finder, &count);

  Napi::Array arr = Napi::Array::New(env, count);
  for (uint32_t i = 0; i < count; i++) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, sources[i].p_ndi_name ? sources[i].p_ndi_name : ""));
    obj.Set("url",  Napi::String::New(env, sources[i].p_url_address ? sources[i].p_url_address : ""));
    arr.Set(i, obj);
  }
  return arr;
}

Napi::Value CreateReceiver(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected { sourceName }").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!ensureNDIInitialized()) {
    Napi::Error::New(env, "NDI runtime not initialized").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string sourceName = info[0].As<Napi::Object>().Get("sourceName").As<Napi::String>().Utf8Value();

  // Resolve sourceName → NDIlib_source_t via the global finder.
  NDIlib_find_instance_t finder = ensureFinder();
  if (!finder) {
    Napi::Error::New(env, "Finder unavailable").ThrowAsJavaScriptException();
    return env.Null();
  }
  NDIlib_find_wait_for_sources(finder, 100);
  uint32_t count = 0;
  const NDIlib_source_t* sources = NDIlib_find_get_current_sources(finder, &count);
  const NDIlib_source_t* match = nullptr;
  for (uint32_t i = 0; i < count; i++) {
    if (sources[i].p_ndi_name && sourceName == sources[i].p_ndi_name) {
      match = &sources[i];
      break;
    }
  }
  if (!match) {
    Napi::Error::New(env, "Source not found in current network scan").ThrowAsJavaScriptException();
    return env.Null();
  }

  NDIlib_recv_create_v3_t desc = {};
  desc.source_to_connect_to = *match;
  desc.color_format = NDIlib_recv_color_format_BGRX_BGRA;
  desc.bandwidth = NDIlib_recv_bandwidth_highest;
  desc.allow_video_fields = false;

  auto receiver = std::make_unique<NdiReceiver>();
  receiver->instance = NDIlib_recv_create_v3(&desc);
  if (!receiver->instance) {
    Napi::Error::New(env, "NDIlib_recv_create_v3 returned null").ThrowAsJavaScriptException();
    return env.Null();
  }
  receiver->sourceName = sourceName;
  {
    std::lock_guard<std::mutex> lock(g_recv_mutex);
    // If a receiver already exists for this name, tear it down first
    // — caller shouldn't double-create but we defend.
    auto it = g_receivers.find(sourceName);
    if (it != g_receivers.end() && it->second->instance) {
      NDIlib_recv_destroy(it->second->instance);
#if defined(__APPLE__)
      if (it->second->sharedSurface) {
        CFRelease(it->second->sharedSurface);
        it->second->sharedSurface = nullptr;
      }
#endif
      g_receivers.erase(it);
    }
    g_receivers[sourceName] = std::move(receiver);
  }
  return Napi::String::New(env, sourceName);
}

Napi::Value DestroyReceiver(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  std::string sourceName = info[0].As<Napi::Object>().Get("sourceName").As<Napi::String>().Utf8Value();
  std::unique_ptr<NdiReceiver> recv;
  {
    std::lock_guard<std::mutex> lock(g_recv_mutex);
    auto it = g_receivers.find(sourceName);
    if (it == g_receivers.end()) return Napi::Boolean::New(env, false);
    recv = std::move(it->second);
    g_receivers.erase(it);
  }
  if (recv && recv->instance) NDIlib_recv_destroy(recv->instance);
#if defined(__APPLE__)
  if (recv && recv->sharedSurface) {
    CFRelease(recv->sharedSurface);
    recv->sharedSurface = nullptr;
  }
#endif
  return Napi::Boolean::New(env, true);
}

#if defined(__APPLE__)
IOSurfaceRef EnsureReceiverSurface(NdiReceiver* recv, int width, int height) {
  if (recv->sharedSurface &&
      IOSurfaceGetWidth(recv->sharedSurface) == static_cast<size_t>(width) &&
      IOSurfaceGetHeight(recv->sharedSurface) == static_cast<size_t>(height)) {
    return recv->sharedSurface;
  }
  if (recv->sharedSurface) {
    CFRelease(recv->sharedSurface);
    recv->sharedSurface = nullptr;
  }

  CFMutableDictionaryRef properties = CFDictionaryCreateMutable(
    kCFAllocatorDefault,
    0,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  int bytesPerElement = 4;
  int bytesPerRow = width * bytesPerElement;
  int allocSize = bytesPerRow * height;
  uint32_t pixelFormat = static_cast<uint32_t>(NDIlib_FourCC_type_BGRA);
  CFNumberRef widthValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &width);
  CFNumberRef heightValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &height);
  CFNumberRef elementValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &bytesPerElement);
  CFNumberRef rowValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &bytesPerRow);
  CFNumberRef sizeValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &allocSize);
  CFNumberRef formatValue = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &pixelFormat);
  CFDictionarySetValue(properties, kIOSurfaceWidth, widthValue);
  CFDictionarySetValue(properties, kIOSurfaceHeight, heightValue);
  CFDictionarySetValue(properties, kIOSurfaceBytesPerElement, elementValue);
  CFDictionarySetValue(properties, kIOSurfaceBytesPerRow, rowValue);
  CFDictionarySetValue(properties, kIOSurfaceAllocSize, sizeValue);
  CFDictionarySetValue(properties, kIOSurfacePixelFormat, formatValue);
  recv->sharedSurface = IOSurfaceCreate(properties);
  CFRelease(widthValue);
  CFRelease(heightValue);
  CFRelease(elementValue);
  CFRelease(rowValue);
  CFRelease(sizeValue);
  CFRelease(formatValue);
  CFRelease(properties);
  return recv->sharedSurface;
}
#endif

bool CaptureReceiverFrame(NdiReceiver* recv, bool keepCpuFrame) {
  NDIlib_video_frame_v2_t videoFrame = {};
  NDIlib_frame_type_e ft = NDIlib_recv_capture_v2(recv->instance, &videoFrame, nullptr, nullptr, 0);
  if (ft != NDIlib_frame_type_video) return false;

  const int width = videoFrame.xres;
  const int height = videoFrame.yres;
  const size_t sourceStride = videoFrame.line_stride_in_bytes > 0
    ? static_cast<size_t>(videoFrame.line_stride_in_bytes)
    : static_cast<size_t>(width) * 4;
  const size_t rowBytes = static_cast<size_t>(width) * 4;

  if (keepCpuFrame) {
    recv->lastFrame.resize(rowBytes * static_cast<size_t>(height));
    for (int row = 0; row < height; row++) {
      memcpy(
        recv->lastFrame.data() + static_cast<size_t>(row) * rowBytes,
        videoFrame.p_data + static_cast<size_t>(row) * sourceStride,
        rowBytes
      );
    }
  }

#if defined(__APPLE__)
  IOSurfaceRef surface = EnsureReceiverSurface(recv, width, height);
  if (surface) {
    IOSurfaceLock(surface, 0, nullptr);
    auto* destination = static_cast<uint8_t*>(IOSurfaceGetBaseAddress(surface));
    const size_t destinationStride = IOSurfaceGetBytesPerRow(surface);
    for (int row = 0; row < height; row++) {
      memcpy(
        destination + static_cast<size_t>(row) * destinationStride,
        videoFrame.p_data + static_cast<size_t>(row) * sourceStride,
        rowBytes
      );
    }
    IOSurfaceUnlock(surface, 0, nullptr);
  }
#endif

  recv->lastWidth = width;
  recv->lastHeight = height;
  recv->framesReceived++;
  NDIlib_recv_free_video_v2(recv->instance, &videoFrame);
  return true;
}

// Pull the next frame from a receiver. Returns:
//   { width, height, data: Buffer<BGRA bytes>, frame: <monotonic counter> }
// or `null` when no new frame is available (caller polls again).
//
// Frame counter lets the renderer skip texture uploads when no new
// frame has arrived since the last poll — saves GPU bandwidth on
// senders running below display refresh.
Napi::Value ReceiveFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return env.Null();
  std::string sourceName = info[0].As<Napi::Object>().Get("sourceName").As<Napi::String>().Utf8Value();

  NdiReceiver* recv = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_recv_mutex);
    auto it = g_receivers.find(sourceName);
    if (it == g_receivers.end()) return env.Null();
    recv = it->second.get();
  }

  if (!CaptureReceiverFrame(recv, true)) return env.Null();
  const size_t bytes = static_cast<size_t>(recv->lastWidth) * recv->lastHeight * 4;

  Napi::Object out = Napi::Object::New(env);
  out.Set("width",  Napi::Number::New(env, recv->lastWidth));
  out.Set("height", Napi::Number::New(env, recv->lastHeight));
  out.Set("frame",  Napi::Number::New(env, static_cast<double>(recv->framesReceived)));
  // Buffer::Copy duplicates the bytes into a V8-owned buffer; the
  // copy survives independent of our recv->lastFrame so the renderer
  // can hold the data across ticks.
  out.Set("data", Napi::Buffer<uint8_t>::Copy(env, recv->lastFrame.data(), bytes));
  return out;
}

Napi::Value ReceiveTextureInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return env.Null();
  const std::string sourceName = info[0].As<Napi::Object>().Get("sourceName").As<Napi::String>().Utf8Value();

  NdiReceiver* recv = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_recv_mutex);
    auto it = g_receivers.find(sourceName);
    if (it == g_receivers.end()) return env.Null();
    recv = it->second.get();
  }
  CaptureReceiverFrame(recv, false);

#if defined(__APPLE__)
  if (!recv->sharedSurface || recv->lastWidth <= 0 || recv->lastHeight <= 0) return env.Null();
  IOSurfaceID surfaceID = IOSurfaceGetID(recv->sharedSurface);
  Napi::Object out = Napi::Object::New(env);
  out.Set("available", Napi::Boolean::New(env, true));
  out.Set("handle", Napi::Buffer<uint8_t>::Copy(
    env,
    reinterpret_cast<uint8_t*>(&surfaceID),
    sizeof(surfaceID)
  ));
  out.Set("width", Napi::Number::New(env, recv->lastWidth));
  out.Set("height", Napi::Number::New(env, recv->lastHeight));
  out.Set("frame", Napi::Number::New(env, static_cast<double>(recv->framesReceived)));
  out.Set("format", Napi::Number::New(env, 80));
  out.Set("senderName", Napi::String::New(env, recv->sourceName));
  return out;
#else
  return env.Null();
#endif
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  if (!g_cleanup_hook_registered) {
    env.AddCleanupHook(CleanupAddonResources);
    g_cleanup_hook_registered = true;
  }

  exports.Set("available",       Napi::Function::New(env, Available));
  // Sender API
  exports.Set("createSender",    Napi::Function::New(env, CreateSender));
  exports.Set("destroySender",   Napi::Function::New(env, DestroySender));
  exports.Set("sendImage",       Napi::Function::New(env, SendImage));
  // Receiver API
  exports.Set("findSources",     Napi::Function::New(env, FindSources));
  exports.Set("createReceiver",  Napi::Function::New(env, CreateReceiver));
  exports.Set("destroyReceiver", Napi::Function::New(env, DestroyReceiver));
  exports.Set("receiveFrame",    Napi::Function::New(env, ReceiveFrame));
  exports.Set("receiveTextureInfo", Napi::Function::New(env, ReceiveTextureInfo));
  return exports;
}

}  // namespace

NODE_API_MODULE(ndi_addon, Init)
