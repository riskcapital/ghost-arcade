/**
 * Frames of the offscreen three.js / p5 hosts, handed to the render core
 * without a CPU copy (macOS).
 *
 * With `offscreen: { useSharedTexture: true }` every paint arrives in the
 * Electron main process as an IOSurface that is local to this process: its
 * IOSurfaceID cannot be looked up from the render core. Each host gets a
 * small ring of global IOSurfaces here instead. A paint is copied into the
 * next one on the GPU (a blit, or a compute pass when the page's format
 * differs or its premultiplied alpha must be straightened), and the core
 * imports that surface by ID the way it imports camera frames.
 *
 * The copy waits for the GPU on a worker thread, never on the main thread;
 * the caller releases Chromium's texture once the promise settles.
 */

#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#include <napi.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr uint32_t kMinSlots = 3;
constexpr uint32_t kMaxSlots = 8;
constexpr uint32_t kDefaultSlots = 4;
constexpr uint32_t kMaxDimension = 8192;
// Surfaces of a ring that was resized are kept this many publishes longer:
// the core may still be importing the last frames that pointed at them.
constexpr uint32_t kRetireAfterPublishes = 8;

NSString* const kKernelSource = @R"(
#include <metal_stdlib>
using namespace metal;
struct Params { uint2 origin; uint unpremultiply; uint pad; };
kernel void copy_frame(texture2d<float, access::read> src [[texture(0)]],
                       texture2d<float, access::write> dst [[texture(1)]],
                       constant Params& params [[buffer(0)]],
                       uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= dst.get_width() || gid.y >= dst.get_height()) return;
  float4 c = src.read(gid + params.origin);
  if (params.unpremultiply != 0 && c.a > 0.0 && c.a < 1.0) c.rgb = min(c.rgb / c.a, float3(1.0));
  dst.write(clamp(c, 0.0, 1.0), gid);
}
)";

struct GpuContext {
  id<MTLDevice> device = nil;
  id<MTLCommandQueue> queue = nil;
  id<MTLComputePipelineState> pipeline = nil;
  std::string error;
};

GpuContext& Gpu() {
  static GpuContext context;
  static std::once_flag once;
  std::call_once(once, [] {
    @autoreleasepool {
      context.device = MTLCreateSystemDefaultDevice();
      if (!context.device) { context.error = "no Metal device"; return; }
      context.queue = [context.device newCommandQueue];
      NSError* error = nil;
      id<MTLLibrary> library = [context.device newLibraryWithSource:kKernelSource options:nil error:&error];
      id<MTLFunction> function = library ? [library newFunctionWithName:@"copy_frame"] : nil;
      if (function) context.pipeline = [context.device newComputePipelineStateWithFunction:function error:&error];
      if (!context.queue || !context.pipeline) {
        context.error = std::string("Metal setup failed: ") +
          (error.localizedDescription ? error.localizedDescription.UTF8String : "unknown");
        context.queue = nil;
        context.pipeline = nil;
      }
    }
  });
  return context;
}

struct RingSurface {
  IOSurfaceRef surface = nullptr;
  id<MTLTexture> texture = nil;
  uint32_t id = 0;
};

void ReleaseSurface(RingSurface& s) {
  s.texture = nil;
  if (s.surface) {
    IOSurfaceDecrementUseCount(s.surface);
    CFRelease(s.surface);
    s.surface = nullptr;
  }
  s.id = 0;
}

struct Retired {
  RingSurface surface;
  uint32_t remaining = 0;
};

struct RingState {
  std::mutex mutex;
  uint32_t slotCount = kDefaultSlots;
  uint32_t width = 0;
  uint32_t height = 0;
  std::vector<RingSurface> slots;
  std::vector<Retired> retired;
  uint32_t next = 0;
  uint32_t inFlight = 0;
  uint64_t published = 0;
  uint64_t failures = 0;
  uint64_t busy = 0;
  uint64_t reallocations = 0;
  double lastGpuMs = 0;
  std::string lastError;
  bool destroyed = false;

  ~RingState() { releaseAll(); }

  void releaseAll() {
    for (auto& s : slots) ReleaseSurface(s);
    slots.clear();
    for (auto& r : retired) ReleaseSurface(r.surface);
    retired.clear();
    width = height = 0;
  }

  void ageRetired() {
    for (auto it = retired.begin(); it != retired.end();) {
      if (it->remaining == 0 || --it->remaining == 0) {
        ReleaseSurface(it->surface);
        it = retired.erase(it);
      } else {
        ++it;
      }
    }
  }

  // Caller holds the mutex.
  bool ensure(uint32_t w, uint32_t h, std::string& error) {
    if (w == width && h == height && slots.size() == slotCount) return true;
    for (auto& s : slots) {
      if (s.surface) retired.push_back({s, kRetireAfterPublishes});
    }
    slots.clear();
    width = height = 0;
    GpuContext& gpu = Gpu();
    if (!gpu.device) { error = gpu.error; return false; }
    const size_t bytesPerRow = ((size_t(w) * 4 + 63) / 64) * 64;
    NSDictionary* properties = @{
      (id)kIOSurfaceWidth: @(w),
      (id)kIOSurfaceHeight: @(h),
      (id)kIOSurfaceBytesPerElement: @4,
      (id)kIOSurfaceBytesPerRow: @(bytesPerRow),
      (id)kIOSurfaceAllocSize: @(bytesPerRow * h),
      (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA),
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
      // The core is another process and finds the surface by its ID.
      (id)kIOSurfaceIsGlobal: @YES,
#pragma clang diagnostic pop
    };
    MTLTextureDescriptor* descriptor =
      [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm width:w height:h mipmapped:NO];
    descriptor.storageMode = MTLStorageModeShared;
    descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
    std::vector<RingSurface> fresh(slotCount);
    for (auto& s : fresh) {
      s.surface = IOSurfaceCreate((__bridge CFDictionaryRef)properties);
      if (!s.surface) { error = "IOSurfaceCreate failed"; break; }
      IOSurfaceIncrementUseCount(s.surface);
      s.id = IOSurfaceGetID(s.surface);
      s.texture = [gpu.device newTextureWithDescriptor:descriptor iosurface:s.surface plane:0];
      if (!s.texture) { error = "could not bind an IOSurface to Metal"; break; }
    }
    if (!error.empty()) {
      for (auto& s : fresh) ReleaseSurface(s);
      return false;
    }
    slots = std::move(fresh);
    width = w;
    height = h;
    next = 0;
    reallocations += 1;
    return true;
  }
};

MTLPixelFormat SourceFormat(const std::string& name) {
  if (name == "rgba") return MTLPixelFormatRGBA8Unorm;
  if (name == "rgbaf16") return MTLPixelFormatRGBA16Float;
  return MTLPixelFormatBGRA8Unorm;
}

class PublishWorker : public Napi::AsyncWorker {
 public:
  PublishWorker(Napi::Env env, std::shared_ptr<RingState> ring, IOSurfaceRef source, RingSurface target,
                uint32_t x, uint32_t y, uint32_t w, uint32_t h, MTLPixelFormat format, bool unpremultiply, int probe)
    : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), ring_(std::move(ring)),
      source_(source), target_(target), x_(x), y_(y), w_(w), h_(h), format_(format), unpremultiply_(unpremultiply),
      probe_(probe) {}

  ~PublishWorker() override {
    if (source_) CFRelease(source_);
  }

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    @autoreleasepool {
      const auto started = std::chrono::steady_clock::now();
      GpuContext& gpu = Gpu();
      const size_t sw = IOSurfaceGetWidth(source_);
      const size_t sh = IOSurfaceGetHeight(source_);
      if (size_t(x_) + w_ > sw || size_t(y_) + h_ > sh) {
        SetError("the frame is outside its surface");
        return;
      }
      MTLTextureDescriptor* descriptor =
        [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format_ width:sw height:sh mipmapped:NO];
      descriptor.usage = MTLTextureUsageShaderRead;
      descriptor.storageMode = gpu.device.hasUnifiedMemory ? MTLStorageModeShared : MTLStorageModeManaged;
      id<MTLTexture> source = [gpu.device newTextureWithDescriptor:descriptor iosurface:source_ plane:0];
      if (!source) {
        SetError("could not bind the page's surface to Metal");
        return;
      }
      id<MTLCommandBuffer> commands = [gpu.queue commandBuffer];
      const bool blit = format_ == MTLPixelFormatBGRA8Unorm && !unpremultiply_;
      if (blit) {
        id<MTLBlitCommandEncoder> encoder = [commands blitCommandEncoder];
        [encoder copyFromTexture:source sourceSlice:0 sourceLevel:0
                    sourceOrigin:MTLOriginMake(x_, y_, 0) sourceSize:MTLSizeMake(w_, h_, 1)
                       toTexture:target_.texture destinationSlice:0 destinationLevel:0
               destinationOrigin:MTLOriginMake(0, 0, 0)];
        [encoder endEncoding];
      } else {
        struct { uint32_t x, y, unpremultiply, pad; } params = {x_, y_, unpremultiply_ ? 1u : 0u, 0};
        id<MTLComputeCommandEncoder> encoder = [commands computeCommandEncoder];
        [encoder setComputePipelineState:gpu.pipeline];
        [encoder setTexture:source atIndex:0];
        [encoder setTexture:target_.texture atIndex:1];
        [encoder setBytes:&params length:sizeof(params) atIndex:0];
        const MTLSize group = MTLSizeMake(16, 16, 1);
        const MTLSize groups = MTLSizeMake((w_ + 15) / 16, (h_ + 15) / 16, 1);
        [encoder dispatchThreadgroups:groups threadsPerThreadgroup:group];
        [encoder endEncoding];
      }
      [commands commit];
      [commands waitUntilCompleted];
      if (commands.status == MTLCommandBufferStatusError) {
        SetError(commands.error.localizedDescription ? commands.error.localizedDescription.UTF8String : "the GPU copy failed");
        return;
      }
      gpuMs_ = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
      compute_ = !blit;
      if (probe_ != 0) blank_ = ProbeBlank();
    }
  }

  // Until a page first draws, its frames are blank and the host holds them
  // back. Sparse, and only asked for until then. 1 = no alpha anywhere (a
  // see-through page), 2 = black everywhere (an opaque one).
  bool ProbeBlank() {
    IOSurfaceRef surface = target_.surface;
    if (IOSurfaceLock(surface, kIOSurfaceLockReadOnly, nullptr) != kIOReturnSuccess) return false;
    const uint8_t* base = static_cast<const uint8_t*>(IOSurfaceGetBaseAddress(surface));
    const size_t bytesPerRow = IOSurfaceGetBytesPerRow(surface);
    bool blank = true;
    const size_t total = size_t(w_) * h_;
    for (size_t i = 0; i < total && blank; i += 97) {
      const uint8_t* px = base + (i / w_) * bytesPerRow + (i % w_) * 4;
      blank = probe_ == 1 ? px[3] == 0 : (px[0] | px[1] | px[2]) == 0;
    }
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, nullptr);
    return blank;
  }

  void OnOK() override {
    {
      std::lock_guard<std::mutex> lock(ring_->mutex);
      ring_->inFlight -= 1;
      ring_->published += 1;
      ring_->lastGpuMs = gpuMs_;
      ring_->lastError.clear();
    }
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("surfaceId", Napi::Number::New(env, target_.id));
    result.Set("width", Napi::Number::New(env, w_));
    result.Set("height", Napi::Number::New(env, h_));
    result.Set("gpuMs", Napi::Number::New(env, gpuMs_));
    result.Set("compute", Napi::Boolean::New(env, compute_));
    if (probe_ != 0) result.Set("blank", Napi::Boolean::New(env, blank_));
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    {
      std::lock_guard<std::mutex> lock(ring_->mutex);
      ring_->inFlight -= 1;
      ring_->failures += 1;
      ring_->lastError = error.Message();
    }
    deferred_.Reject(error.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<RingState> ring_;
  IOSurfaceRef source_;
  RingSurface target_;
  uint32_t x_, y_, w_, h_;
  MTLPixelFormat format_;
  bool unpremultiply_;
  int probe_;
  double gpuMs_ = 0;
  bool compute_ = false;
  bool blank_ = false;
};

class JsFrameRing : public Napi::ObjectWrap<JsFrameRing> {
 public:
  static Napi::Function Define(Napi::Env env) {
    return DefineClass(env, "JsFrameRing", {
      InstanceMethod("publish", &JsFrameRing::Publish),
      InstanceMethod("status", &JsFrameRing::Status),
      InstanceMethod("destroy", &JsFrameRing::Destroy),
    });
  }

  explicit JsFrameRing(const Napi::CallbackInfo& info) : Napi::ObjectWrap<JsFrameRing>(info), ring_(std::make_shared<RingState>()) {
    if (info.Length() > 0 && info[0].IsObject()) {
      Napi::Value slots = info[0].As<Napi::Object>().Get("slots");
      if (slots.IsNumber()) {
        ring_->slotCount = std::max(kMinSlots, std::min(kMaxSlots, slots.As<Napi::Number>().Uint32Value()));
      }
    }
  }

  ~JsFrameRing() override {
    std::lock_guard<std::mutex> lock(ring_->mutex);
    ring_->destroyed = true;
  }

 private:
  Napi::Value Reject(Napi::Env env, const std::string& message) {
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(Napi::Error::New(env, message).Value());
    return deferred.Promise();
  }

  // publish(ioSurfaceHandle: Buffer, { x, y, width, height, pixelFormat, unpremultiply, probeBlank })
  //   -> Promise<{ surfaceId, width, height, gpuMs, compute, blank? }>
  Napi::Value Publish(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
      return Reject(env, "publish(handle, frame) needs the paint's IOSurface handle and its rectangle");
    }
    auto handle = info[0].As<Napi::Buffer<uint8_t>>();
    if (handle.Length() < sizeof(IOSurfaceRef)) return Reject(env, "the IOSurface handle is not a pointer");
    IOSurfaceRef source = *reinterpret_cast<IOSurfaceRef const*>(handle.Data());
    if (!source) return Reject(env, "the IOSurface handle is null");
    Napi::Object frame = info[1].As<Napi::Object>();
    auto num = [&](const char* key) -> uint32_t {
      Napi::Value v = frame.Get(key);
      if (!v.IsNumber()) return 0;
      double d = v.As<Napi::Number>().DoubleValue();
      return d > 0 && d < 1e9 ? uint32_t(d) : 0;
    };
    const uint32_t x = num("x"), y = num("y"), w = num("width"), h = num("height");
    if (w == 0 || h == 0 || w > kMaxDimension || h > kMaxDimension) return Reject(env, "the frame size is out of range");
    Napi::Value formatValue = frame.Get("pixelFormat");
    const std::string format = formatValue.IsString() ? formatValue.As<Napi::String>().Utf8Value() : "bgra";
    Napi::Value unpremultiplyValue = frame.Get("unpremultiply");
    const bool unpremultiply = unpremultiplyValue.IsBoolean() && unpremultiplyValue.As<Napi::Boolean>().Value();
    Napi::Value probeValue = frame.Get("probeBlank");
    const std::string probeName = probeValue.IsString() ? probeValue.As<Napi::String>().Utf8Value() : "";
    const int probe = probeName == "alpha" ? 1 : probeName == "rgb" ? 2 : 0;

    RingSurface target;
    {
      std::lock_guard<std::mutex> lock(ring_->mutex);
      if (ring_->destroyed) return Reject(env, "the ring was destroyed");
      // One slot always stays clear of the copies: the core may be reading it.
      if (ring_->inFlight + 1 >= ring_->slotCount) {
        ring_->busy += 1;
        return Reject(env, "busy");
      }
      if (ring_->inFlight > 0 && (ring_->width != w || ring_->height != h)) {
        ring_->busy += 1;
        return Reject(env, "busy");
      }
      std::string error;
      if (!ring_->ensure(w, h, error)) {
        ring_->failures += 1;
        ring_->lastError = error;
        return Reject(env, error);
      }
      if (!Gpu().pipeline) return Reject(env, Gpu().error);
      ring_->ageRetired();
      target = ring_->slots[ring_->next];
      ring_->next = (ring_->next + 1) % ring_->slotCount;
      ring_->inFlight += 1;
    }
    CFRetain(source);
    auto* worker = new PublishWorker(env, ring_, source, target, x, y, w, h, SourceFormat(format), unpremultiply, probe);
    Napi::Promise promise = worker->Promise();
    worker->Queue();
    return promise;
  }

  Napi::Value Status(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(ring_->mutex);
    Napi::Object out = Napi::Object::New(env);
    out.Set("width", Napi::Number::New(env, ring_->width));
    out.Set("height", Napi::Number::New(env, ring_->height));
    out.Set("slots", Napi::Number::New(env, ring_->slotCount));
    out.Set("inFlight", Napi::Number::New(env, ring_->inFlight));
    out.Set("published", Napi::Number::New(env, double(ring_->published)));
    out.Set("failures", Napi::Number::New(env, double(ring_->failures)));
    out.Set("busy", Napi::Number::New(env, double(ring_->busy)));
    out.Set("reallocations", Napi::Number::New(env, double(ring_->reallocations)));
    out.Set("retired", Napi::Number::New(env, double(ring_->retired.size())));
    out.Set("lastGpuMs", Napi::Number::New(env, ring_->lastGpuMs));
    out.Set("lastError", Napi::String::New(env, ring_->lastError));
    Napi::Array ids = Napi::Array::New(env, ring_->slots.size());
    for (size_t i = 0; i < ring_->slots.size(); i++) ids.Set(uint32_t(i), Napi::Number::New(env, ring_->slots[i].id));
    out.Set("surfaceIds", ids);
    return out;
  }

  // The surfaces go when the last copy using them has finished: workers hold
  // the ring state, so a copy in flight keeps its target alive.
  Napi::Value Destroy(const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(ring_->mutex);
    ring_->destroyed = true;
    if (ring_->inFlight == 0) ring_->releaseAll();
    return info.Env().Undefined();
  }

  std::shared_ptr<RingState> ring_;
};

Napi::Value Available(const Napi::CallbackInfo& info) {
  GpuContext& gpu = Gpu();
  return Napi::Boolean::New(info.Env(), gpu.device != nil && gpu.pipeline != nil);
}

Napi::Value LastError(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), Gpu().error);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("JsFrameRing", JsFrameRing::Define(env));
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("lastError", Napi::Function::New(env, LastError));
  return exports;
}

}  // namespace

NODE_API_MODULE(js_frame_ring_addon, Init)
