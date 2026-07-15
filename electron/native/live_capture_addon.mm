/**
 * Native live-source capture for the Ghost 2.0 renderer (macOS).
 *
 * Camera frames arrive as AVFoundation CVPixelBuffers. Screen/window frames
 * arrive as ScreenCaptureKit CVPixelBuffers. Both are retained as IOSurfaces
 * and imported by the Rust/Metal renderer without browser-side rendering.
 */

#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <napi.h>

#include <algorithm>
#include <map>
#include <mutex>
#include <string>

static NSString* GhostString(const std::string& value) {
  return [NSString stringWithUTF8String:value.c_str()] ?: @"";
}

static std::string GhostStdString(NSString* value) {
  return value ? std::string(value.UTF8String ?: "") : std::string();
}

static uint32_t GhostNumericSourceID(NSString* sourceID) {
  NSArray<NSString*>* parts = [sourceID componentsSeparatedByString:@":"];
  if (parts.count < 2) return 0;
  return (uint32_t)strtoul(parts[1].UTF8String ?: "0", nullptr, 10);
}

@interface GhostLiveCaptureSession : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate, SCStreamOutput, SCStreamDelegate>
{
  IOSurfaceRef _publishSurfaces[3];
  __strong id<MTLTexture> _publishTextures[3];
  NSUInteger _publishSurfaceIndex;
  size_t _publishWidth;
  size_t _publishHeight;
  CVMetalTextureCacheRef _textureCache;
}
@property(nonatomic, copy) NSString* sessionID;
@property(nonatomic, copy) NSString* kind;
@property(nonatomic, strong) AVCaptureSession* cameraSession;
@property(nonatomic, strong) SCStream* screenStream;
@property(nonatomic, strong) dispatch_queue_t frameQueue;
@property(nonatomic, strong) id<MTLDevice> metalDevice;
@property(nonatomic, strong) id<MTLCommandQueue> metalCommandQueue;
@property(nonatomic, assign) IOSurfaceRef latestSurface;
@property(nonatomic, assign) uint64_t frameNumber;
@property(nonatomic, copy) NSString* lastError;
- (BOOL)startCameraWithDeviceID:(NSString*)deviceID;
- (void)startScreenWithSourceID:(NSString*)sourceID
                      displayID:(NSString*)displayID
                           kind:(NSString*)kind;
- (void)stop;
- (NSDictionary*)textureInfo;
@end

@implementation GhostLiveCaptureSession

- (instancetype)init {
  self = [super init];
  if (!self) return nil;
  _frameQueue = dispatch_queue_create("art.ghostarcade.live-capture", DISPATCH_QUEUE_SERIAL);
  _latestSurface = nullptr;
  for (NSUInteger index = 0; index < 3; index++) {
    _publishSurfaces[index] = nullptr;
    _publishTextures[index] = nil;
  }
  _publishSurfaceIndex = 0;
  _publishWidth = 0;
  _publishHeight = 0;
  _textureCache = nullptr;
  _frameNumber = 0;
  _metalDevice = MTLCreateSystemDefaultDevice();
  _metalCommandQueue = [_metalDevice newCommandQueue];
  if (_metalDevice) {
    CVMetalTextureCacheCreate(kCFAllocatorDefault, nullptr, _metalDevice, nullptr, &_textureCache);
  }
  return self;
}

- (void)dealloc {
  [self stop];
  @synchronized(self) {
    if (_latestSurface) {
      CFRelease(_latestSurface);
      _latestSurface = nullptr;
    }
    for (NSUInteger index = 0; index < 3; index++) {
      _publishTextures[index] = nil;
      if (_publishSurfaces[index]) {
        IOSurfaceDecrementUseCount(_publishSurfaces[index]);
        CFRelease(_publishSurfaces[index]);
        _publishSurfaces[index] = nullptr;
      }
    }
  }
  if (_textureCache) {
    CFRelease(_textureCache);
    _textureCache = nullptr;
  }
}

- (BOOL)ensurePublishSurfacesWithWidth:(size_t)width height:(size_t)height {
  if (_publishWidth == width && _publishHeight == height && _publishSurfaces[0]) return YES;
  if (!self.metalDevice || !self.metalCommandQueue || !_textureCache) {
    self.lastError = @"Metal live-source publisher is unavailable";
    return NO;
  }

  @synchronized(self) {
    if (_latestSurface) {
      CFRelease(_latestSurface);
      _latestSurface = nullptr;
    }
    for (NSUInteger index = 0; index < 3; index++) {
      _publishTextures[index] = nil;
      if (_publishSurfaces[index]) {
        IOSurfaceDecrementUseCount(_publishSurfaces[index]);
        CFRelease(_publishSurfaces[index]);
        _publishSurfaces[index] = nullptr;
      }
    }

    const size_t bytesPerRow = ((width * 4 + 15) / 16) * 16;
    NSDictionary* properties = @{
      (id)kIOSurfaceWidth: @(width),
      (id)kIOSurfaceHeight: @(height),
      (id)kIOSurfaceBytesPerElement: @4,
      (id)kIOSurfaceBytesPerRow: @(bytesPerRow),
      (id)kIOSurfaceAllocSize: @(bytesPerRow * height),
      (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA),
      (id)kIOSurfaceIsGlobal: @YES,
    };
    MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
      width:width
      height:height
      mipmapped:NO];
    descriptor.textureType = MTLTextureType2D;
    descriptor.storageMode = MTLStorageModeShared;
    descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;

    for (NSUInteger index = 0; index < 3; index++) {
      _publishSurfaces[index] = IOSurfaceCreate((__bridge CFDictionaryRef)properties);
      if (!_publishSurfaces[index]) {
        self.lastError = @"Failed to allocate global live-source IOSurface";
        return NO;
      }
      IOSurfaceIncrementUseCount(_publishSurfaces[index]);
      _publishTextures[index] = [self.metalDevice
        newTextureWithDescriptor:descriptor
        iosurface:_publishSurfaces[index]
        plane:0];
      if (!_publishTextures[index]) {
        self.lastError = @"Failed to bind live-source IOSurface to Metal";
        return NO;
      }
    }
    _publishSurfaceIndex = 0;
    _publishWidth = width;
    _publishHeight = height;
  }
  return YES;
}

- (void)setLatestSurfaceFromPixelBuffer:(CVPixelBufferRef)pixelBuffer {
  if (!pixelBuffer) return;

  const size_t width = CVPixelBufferGetWidth(pixelBuffer);
  const size_t height = CVPixelBufferGetHeight(pixelBuffer);
  if (width == 0 || height == 0 || ![self ensurePublishSurfacesWithWidth:width height:height]) return;

  CVMetalTextureRef sourceWrapper = nullptr;
  const CVReturn textureStatus = CVMetalTextureCacheCreateTextureFromImage(
    kCFAllocatorDefault,
    _textureCache,
    pixelBuffer,
    nullptr,
    MTLPixelFormatBGRA8Unorm,
    width,
    height,
    0,
    &sourceWrapper);
  if (textureStatus != kCVReturnSuccess || !sourceWrapper) {
    self.lastError = [NSString stringWithFormat:@"Could not bind capture frame to Metal (%d)", textureStatus];
    return;
  }

  id<MTLTexture> sourceTexture = CVMetalTextureGetTexture(sourceWrapper);
  const NSUInteger targetIndex = _publishSurfaceIndex;
  id<MTLTexture> targetTexture = _publishTextures[targetIndex];
  id<MTLCommandBuffer> commandBuffer = [self.metalCommandQueue commandBuffer];
  id<MTLBlitCommandEncoder> encoder = [commandBuffer blitCommandEncoder];
  [encoder copyFromTexture:sourceTexture
               sourceSlice:0
               sourceLevel:0
              sourceOrigin:MTLOriginMake(0, 0, 0)
                sourceSize:MTLSizeMake(width, height, 1)
                 toTexture:targetTexture
          destinationSlice:0
          destinationLevel:0
         destinationOrigin:MTLOriginMake(0, 0, 0)];
  [encoder endEncoding];
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];
  CFRelease(sourceWrapper);

  if (commandBuffer.status == MTLCommandBufferStatusError) {
    self.lastError = commandBuffer.error.localizedDescription ?: @"Metal live-source blit failed";
    return;
  }

  @synchronized(self) {
    IOSurfaceRef published = _publishSurfaces[targetIndex];
    CFRetain(published);
    if (_latestSurface) CFRelease(_latestSurface);
    _latestSurface = published;
    _publishSurfaceIndex = (_publishSurfaceIndex + 1) % 3;
    _frameNumber++;
    _lastError = nil;
  }
}

- (void)captureOutput:(AVCaptureOutput*)output
 didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        fromConnection:(AVCaptureConnection*)connection {
  (void)output;
  (void)connection;
  [self setLatestSurfaceFromPixelBuffer:CMSampleBufferGetImageBuffer(sampleBuffer)];
}

- (void)stream:(SCStream*)stream
 didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
          ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
  (void)stream;
  if (type != SCStreamOutputTypeScreen || !CMSampleBufferDataIsReady(sampleBuffer)) return;
  [self setLatestSurfaceFromPixelBuffer:CMSampleBufferGetImageBuffer(sampleBuffer)];
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error API_AVAILABLE(macos(12.3)) {
  (void)stream;
  @synchronized(self) {
    _lastError = error.localizedDescription ?: @"Screen capture stopped";
  }
}

- (BOOL)configureAndStartCamera:(NSString*)deviceID {
  AVCaptureDevice* device = nil;
  if (deviceID.length > 0) device = [AVCaptureDevice deviceWithUniqueID:deviceID];
  if (!device) device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  if (!device) {
    self.lastError = @"No camera is available";
    return NO;
  }

  NSError* error = nil;
  AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
  if (!input) {
    self.lastError = error.localizedDescription ?: @"Could not open camera";
    return NO;
  }

  AVCaptureSession* session = [[AVCaptureSession alloc] init];
  [session beginConfiguration];
  if ([session canSetSessionPreset:AVCaptureSessionPresetHigh]) session.sessionPreset = AVCaptureSessionPresetHigh;
  if (![session canAddInput:input]) {
    [session commitConfiguration];
    self.lastError = @"Could not attach camera input";
    return NO;
  }
  [session addInput:input];

  AVCaptureVideoDataOutput* output = [[AVCaptureVideoDataOutput alloc] init];
  output.alwaysDiscardsLateVideoFrames = YES;
  output.videoSettings = @{
    (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferMetalCompatibilityKey: @YES,
    (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
  };
  [output setSampleBufferDelegate:self queue:self.frameQueue];
  if (![session canAddOutput:output]) {
    [session commitConfiguration];
    self.lastError = @"Could not attach camera output";
    return NO;
  }
  [session addOutput:output];
  [session commitConfiguration];

  self.cameraSession = session;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [session startRunning];
  });
  return YES;
}

- (BOOL)startCameraWithDeviceID:(NSString*)deviceID {
  self.kind = @"webcam";
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (status == AVAuthorizationStatusAuthorized) return [self configureAndStartCamera:deviceID];
  if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
    self.lastError = @"Camera permission is denied";
    return NO;
  }

  __weak GhostLiveCaptureSession* weakSelf = self;
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
    GhostLiveCaptureSession* strongSelf = weakSelf;
    if (!strongSelf) return;
    if (!granted) {
      strongSelf.lastError = @"Camera permission is denied";
      return;
    }
    [strongSelf configureAndStartCamera:deviceID];
  }];
  return YES;
}

- (void)startScreenWithSourceID:(NSString*)sourceID
                      displayID:(NSString*)displayID
                           kind:(NSString*)kind {
  self.kind = @"capture";
  if (@available(macOS 12.3, *)) {
    __weak GhostLiveCaptureSession* weakSelf = self;
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                               onScreenWindowsOnly:NO
                                                 completionHandler:^(SCShareableContent* content, NSError* error) {
      GhostLiveCaptureSession* strongSelf = weakSelf;
      if (!strongSelf) return;
      if (!content || error) {
        strongSelf.lastError = error.localizedDescription ?: @"Could not enumerate capture sources";
        return;
      }

      SCContentFilter* filter = nil;
      NSUInteger width = 1920;
      NSUInteger height = 1080;
      const uint32_t numericSourceID = GhostNumericSourceID(sourceID);
      if ([kind isEqualToString:@"screen"]) {
        uint32_t wantedDisplayID = (uint32_t)strtoul(displayID.UTF8String ?: "0", nullptr, 10);
        if (wantedDisplayID == 0) wantedDisplayID = numericSourceID;
        SCDisplay* selected = nil;
        for (SCDisplay* display in content.displays) {
          if (display.displayID == wantedDisplayID) { selected = display; break; }
        }
        if (!selected && content.displays.count > 0) selected = content.displays.firstObject;
        if (selected) {
          filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
          width = selected.width;
          height = selected.height;
        }
      } else {
        SCWindow* selected = nil;
        for (SCWindow* window in content.windows) {
          if (window.windowID == numericSourceID) { selected = window; break; }
        }
        if (selected) {
          filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
          width = (NSUInteger)std::max(1.0, selected.frame.size.width);
          height = (NSUInteger)std::max(1.0, selected.frame.size.height);
        }
      }

      if (!filter) {
        strongSelf.lastError = @"The selected screen or window is no longer available";
        return;
      }

      SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
      config.width = width;
      config.height = height;
      config.pixelFormat = kCVPixelFormatType_32BGRA;
      config.minimumFrameInterval = CMTimeMake(1, 60);
      config.queueDepth = 6;
      config.showsCursor = YES;
      config.capturesAudio = NO;
      config.colorSpaceName = kCGColorSpaceSRGB;

      SCStream* stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:strongSelf];
      NSError* outputError = nil;
      if (![stream addStreamOutput:strongSelf
                              type:SCStreamOutputTypeScreen
                sampleHandlerQueue:strongSelf.frameQueue
                             error:&outputError]) {
        strongSelf.lastError = outputError.localizedDescription ?: @"Could not attach screen capture output";
        return;
      }
      strongSelf.screenStream = stream;
      [stream startCaptureWithCompletionHandler:^(NSError* startError) {
        if (startError) strongSelf.lastError = startError.localizedDescription;
      }];
    }];
  } else {
    self.lastError = @"Screen capture requires macOS 12.3 or newer";
  }
}

- (void)stop {
  AVCaptureSession* camera = self.cameraSession;
  self.cameraSession = nil;
  if (camera) dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [camera stopRunning]; });

  if (@available(macOS 12.3, *)) {
    SCStream* stream = self.screenStream;
    self.screenStream = nil;
    if (stream) [stream stopCaptureWithCompletionHandler:^(__unused NSError* error) {}];
  }
}

- (NSDictionary*)textureInfo {
  @synchronized(self) {
    if (!_latestSurface) {
      return @{
        @"available": @NO,
        @"reason": _lastError ?: @"waiting-for-first-frame",
        @"frame": @(_frameNumber),
      };
    }
    return @{
      @"available": @YES,
      @"surfaceID": @(IOSurfaceGetID(_latestSurface)),
      @"width": @(IOSurfaceGetWidth(_latestSurface)),
      @"height": @(IOSurfaceGetHeight(_latestSurface)),
      @"frame": @(_frameNumber),
      @"format": @80,
      @"kind": _kind ?: @"capture",
    };
  }
}

@end

namespace {

std::map<std::string, GhostLiveCaptureSession*> g_sessions;
std::mutex g_sessions_mutex;

GhostLiveCaptureSession* SessionForID(const std::string& sessionID) {
  std::lock_guard<std::mutex> lock(g_sessions_mutex);
  auto it = g_sessions.find(sessionID);
  return it == g_sessions.end() ? nil : it->second;
}

Napi::Value Available(const Napi::CallbackInfo& info) {
  Napi::Object result = Napi::Object::New(info.Env());
  result.Set("available", Napi::Boolean::New(info.Env(), true));
  result.Set("webcam", Napi::Boolean::New(info.Env(), true));
  result.Set("capture", Napi::Boolean::New(info.Env(), true));
  result.Set("transport", Napi::String::New(info.Env(), "iosurface"));
  return result;
}

Napi::Value ListCameras(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSArray<AVCaptureDeviceType>* deviceTypes;
  if (@available(macOS 14.0, *)) {
    deviceTypes = @[ AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternal ];
  } else {
    deviceTypes = @[ AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternalUnknown ];
  }
  AVCaptureDeviceDiscoverySession* discovery = [AVCaptureDeviceDiscoverySession
    discoverySessionWithDeviceTypes:deviceTypes
    mediaType:AVMediaTypeVideo
    position:AVCaptureDevicePositionUnspecified];
  Napi::Array result = Napi::Array::New(env, discovery.devices.count);
  NSUInteger index = 0;
  for (AVCaptureDevice* device in discovery.devices) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("id", Napi::String::New(env, GhostStdString(device.uniqueID)));
    item.Set("name", Napi::String::New(env, GhostStdString(device.localizedName)));
    result.Set(index++, item);
  }
  return result;
}

std::string RequiredString(const Napi::Object& options, const char* key) {
  Napi::Value value = options.Get(key);
  return value.IsString() ? value.As<Napi::String>().Utf8Value() : std::string();
}

Napi::Value StartCamera(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  Napi::Object options = info[0].As<Napi::Object>();
  const std::string sessionID = RequiredString(options, "sessionId");
  const std::string deviceID = RequiredString(options, "deviceId");
  if (sessionID.empty()) return Napi::Boolean::New(env, false);

  GhostLiveCaptureSession* session = [[GhostLiveCaptureSession alloc] init];
  session.sessionID = GhostString(sessionID);
  if (![session startCameraWithDeviceID:GhostString(deviceID)]) return Napi::Boolean::New(env, false);
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    auto old = g_sessions.find(sessionID);
    if (old != g_sessions.end()) [old->second stop];
    g_sessions[sessionID] = session;
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value StartScreen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  Napi::Object options = info[0].As<Napi::Object>();
  const std::string sessionID = RequiredString(options, "sessionId");
  if (sessionID.empty()) return Napi::Boolean::New(env, false);

  GhostLiveCaptureSession* session = [[GhostLiveCaptureSession alloc] init];
  session.sessionID = GhostString(sessionID);
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    auto old = g_sessions.find(sessionID);
    if (old != g_sessions.end()) [old->second stop];
    g_sessions[sessionID] = session;
  }
  [session startScreenWithSourceID:GhostString(RequiredString(options, "sourceId"))
                        displayID:GhostString(RequiredString(options, "displayId"))
                             kind:GhostString(RequiredString(options, "kind"))];
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  const std::string sessionID = RequiredString(info[0].As<Napi::Object>(), "sessionId");
  GhostLiveCaptureSession* session = nil;
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    auto it = g_sessions.find(sessionID);
    if (it == g_sessions.end()) return Napi::Boolean::New(env, false);
    session = it->second;
    g_sessions.erase(it);
  }
  [session stop];
  return Napi::Boolean::New(env, true);
}

Napi::Value TextureInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return env.Null();
  const std::string sessionID = RequiredString(info[0].As<Napi::Object>(), "sessionId");
  GhostLiveCaptureSession* session = SessionForID(sessionID);
  if (!session) return env.Null();
  NSDictionary* state = [session textureInfo];
  Napi::Object result = Napi::Object::New(env);
  const bool available = [state[@"available"] boolValue];
  result.Set("available", Napi::Boolean::New(env, available));
  result.Set("frame", Napi::Number::New(env, [state[@"frame"] doubleValue]));
  if (!available) {
    result.Set("reason", Napi::String::New(env, GhostStdString(state[@"reason"])));
    return result;
  }
  IOSurfaceID surfaceID = (IOSurfaceID)[state[@"surfaceID"] unsignedIntValue];
  result.Set("handle", Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&surfaceID), sizeof(surfaceID)));
  result.Set("width", Napi::Number::New(env, [state[@"width"] doubleValue]));
  result.Set("height", Napi::Number::New(env, [state[@"height"] doubleValue]));
  result.Set("format", Napi::Number::New(env, [state[@"format"] doubleValue]));
  result.Set("kind", Napi::String::New(env, GhostStdString(state[@"kind"])));
  return result;
}

void Cleanup() {
  std::map<std::string, GhostLiveCaptureSession*> sessions;
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    sessions.swap(g_sessions);
  }
  for (const auto& entry : sessions) [entry.second stop];
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  env.AddCleanupHook(Cleanup);
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("listCameras", Napi::Function::New(env, ListCameras));
  exports.Set("startCamera", Napi::Function::New(env, StartCamera));
  exports.Set("startScreen", Napi::Function::New(env, StartScreen));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("receiveTextureInfo", Napi::Function::New(env, TextureInfo));
  return exports;
}

} // namespace

NODE_API_MODULE(live_capture_addon, Init)
