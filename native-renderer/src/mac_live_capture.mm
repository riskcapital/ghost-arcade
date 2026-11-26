// Live capture inside the render core (macOS): cameras through AVFoundation,
// screens and windows through ScreenCaptureKit.
//
// The capture settings are the ones the Electron capture addon uses
// (electron/native/live_capture_addon.mm), so the frames are the same:
// 32BGRA, sRGB for screens, the High preset for cameras, 60 fps at most,
// the cursor shown, a captured window's output following its pixel size.
// The difference is where a frame goes. The addon copied each one into a
// global IOSurface of its own for the editor to pass to the core by id;
// here the latest CVPixelBuffer is simply kept, and the core imports its
// IOSurface into the source's picture slot. A buffer the core takes stays
// retained until the GPU has read it, so the capture pool cannot reuse it
// early.

#import "mac_live_capture.h"

#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

#include <os/lock.h>

#include <algorithm>
#include <cmath>
#include <cstring>

// `@available` needs compiler-rt, which the Rust link leaves out, so the
// OS checks ask NSProcessInfo. ScreenCaptureKit is weak linked; nothing
// touches it before the macOS 12.3 check.
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
#pragma clang diagnostic ignored "-Wunguarded-availability"

static BOOL GhostOSAtLeast(NSInteger major, NSInteger minor) {
  return [NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){major, minor, 0}];
}

static void GhostCopyError(NSString *message, char *error, size_t capacity) {
  if (!error || capacity == 0) return;
  const char *utf8 = message.UTF8String ?: "";
  std::strncpy(error, utf8, capacity - 1);
  error[capacity - 1] = 0;
}

static NSString *GhostString(const char *value) {
  return value ? ([NSString stringWithUTF8String:value] ?: @"") : @"";
}

static double GhostHostSeconds(void) {
  return CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()));
}

static uint32_t GhostNumericSourceID(NSString *sourceID) {
  NSArray<NSString *> *parts = [sourceID componentsSeparatedByString:@":"];
  if (parts.count < 2) return 0;
  return (uint32_t)strtoul(parts[1].UTF8String ?: "0", nullptr, 10);
}

// ScreenCaptureKit sizes (SCWindow.frame, SCDisplay.width) are in points;
// these turn them into the pixels the screen shows (as the addon does).
static const NSUInteger kGhostMaxCaptureDimension = 8192;

static CGFloat GhostScaleForDisplayID(CGDirectDisplayID displayID) {
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
    if (number && number.unsignedIntValue == displayID) return screen.backingScaleFactor;
  }
  return 0;
}

static CGFloat GhostLargestBackingScale(void) {
  CGFloat scale = 1;
  for (NSScreen *screen in NSScreen.screens) scale = MAX(scale, screen.backingScaleFactor);
  return scale;
}

static NSUInteger GhostPixels(CGFloat points, CGFloat scale) {
  const CGFloat pixels = std::round(std::max<CGFloat>(1, points) * std::max<CGFloat>(1, scale));
  return (NSUInteger)std::min<CGFloat>(pixels, kGhostMaxCaptureDimension);
}

@interface GhostCoreCaptureSession : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate, SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) dispatch_queue_t frameQueue;
@property(nonatomic, strong) AVCaptureSession *cameraSession;
@property(nonatomic, strong) SCStream *screenStream API_AVAILABLE(macos(12.3));
@property(nonatomic, strong) SCStreamConfiguration *screenConfig API_AVAILABLE(macos(12.3));
@property(nonatomic, assign) CFAbsoluteTime lastResizeAt;
@property(atomic, assign) BOOL stopped;
@end

@implementation GhostCoreCaptureSession {
  os_unfair_lock _lock;
  CVPixelBufferRef _latest;
  uint64_t _frame;
  double _presentationSeconds;
  double _arrivedSeconds;
  BOOL _running;
  BOOL _failed;
  NSString *_error;
}

- (instancetype)init {
  self = [super init];
  if (!self) return nil;
  _lock = OS_UNFAIR_LOCK_INIT;
  _frameQueue = dispatch_queue_create("art.ghostarcade.core-live-capture", DISPATCH_QUEUE_SERIAL);
  return self;
}

- (void)dealloc {
  if (_latest) CVPixelBufferRelease(_latest);
}

- (void)fail:(NSString *)message {
  os_unfair_lock_lock(&_lock);
  _failed = YES;
  _running = NO;
  _error = [message copy];
  os_unfair_lock_unlock(&_lock);
}

- (void)setRunning {
  os_unfair_lock_lock(&_lock);
  _running = YES;
  os_unfair_lock_unlock(&_lock);
}

- (void)takeSampleBuffer:(CMSampleBufferRef)sampleBuffer {
  if (self.stopped) return;
  CVImageBufferRef image = CMSampleBufferGetImageBuffer(sampleBuffer);
  if (!image || CFGetTypeID(image) != CVPixelBufferGetTypeID()) return;
  CVPixelBufferRef pixels = (CVPixelBufferRef)image;
  if (!CVPixelBufferGetIOSurface(pixels)) return;
  if (CVPixelBufferGetWidth(pixels) == 0 || CVPixelBufferGetHeight(pixels) == 0) return;
  const double arrived = GhostHostSeconds();
  const CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
  const double presented = CMTIME_IS_NUMERIC(pts) ? CMTimeGetSeconds(pts) : arrived;
  CVPixelBufferRetain(pixels);
  os_unfair_lock_lock(&_lock);
  CVPixelBufferRef previous = _latest;
  _latest = pixels;
  _frame++;
  _presentationSeconds = presented;
  _arrivedSeconds = arrived;
  _running = YES;
  os_unfair_lock_unlock(&_lock);
  if (previous) CVPixelBufferRelease(previous);
}

- (int)latestSince:(uint64_t)since frame:(GhostLiveCaptureFrame *)out {
  os_unfair_lock_lock(&_lock);
  if (!_latest || _frame <= since) {
    os_unfair_lock_unlock(&_lock);
    return 0;
  }
  CVPixelBufferRef pixels = CVPixelBufferRetain(_latest);
  out->pixel_buffer = (void *)pixels;
  out->iosurface = (void *)CVPixelBufferGetIOSurface(pixels);
  out->width = (uint32_t)CVPixelBufferGetWidth(pixels);
  out->height = (uint32_t)CVPixelBufferGetHeight(pixels);
  out->pixel_format = (uint32_t)CVPixelBufferGetPixelFormatType(pixels);
  out->frame = _frame;
  out->presentation_seconds = _presentationSeconds;
  out->arrived_seconds = _arrivedSeconds;
  os_unfair_lock_unlock(&_lock);
  return 1;
}

- (void)state:(GhostLiveCaptureState *)state {
  os_unfair_lock_lock(&_lock);
  state->frames = _frame;
  state->width = _latest ? (uint32_t)CVPixelBufferGetWidth(_latest) : 0;
  state->height = _latest ? (uint32_t)CVPixelBufferGetHeight(_latest) : 0;
  state->running = _running ? 1 : 0;
  state->failed = _failed ? 1 : 0;
  os_unfair_lock_unlock(&_lock);
}

- (NSString *)lastError {
  os_unfair_lock_lock(&_lock);
  NSString *error = _error ?: @"";
  os_unfair_lock_unlock(&_lock);
  return error;
}

// MARK: camera

- (void)captureOutput:(AVCaptureOutput *)output
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
       fromConnection:(AVCaptureConnection *)connection {
  (void)output;
  (void)connection;
  [self takeSampleBuffer:sampleBuffer];
}

- (BOOL)configureAndStartCamera:(NSString *)deviceID error:(NSString **)message {
  AVCaptureDevice *device = nil;
  if (deviceID.length > 0) device = [AVCaptureDevice deviceWithUniqueID:deviceID];
  if (!device) device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  if (!device) {
    *message = @"No camera is available";
    return NO;
  }
  NSError *error = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
  if (!input) {
    *message = error.localizedDescription ?: @"Could not open camera";
    return NO;
  }
  AVCaptureSession *session = [[AVCaptureSession alloc] init];
  [session beginConfiguration];
  if ([session canSetSessionPreset:AVCaptureSessionPresetHigh]) session.sessionPreset = AVCaptureSessionPresetHigh;
  if (![session canAddInput:input]) {
    [session commitConfiguration];
    *message = @"Could not attach camera input";
    return NO;
  }
  [session addInput:input];
  AVCaptureVideoDataOutput *output = [[AVCaptureVideoDataOutput alloc] init];
  output.alwaysDiscardsLateVideoFrames = YES;
  output.videoSettings = @{
    (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferMetalCompatibilityKey: @YES,
    (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
  };
  [output setSampleBufferDelegate:self queue:self.frameQueue];
  if (![session canAddOutput:output]) {
    [session commitConfiguration];
    *message = @"Could not attach camera output";
    return NO;
  }
  [session addOutput:output];
  [session commitConfiguration];
  self.cameraSession = session;
  __weak GhostCoreCaptureSession *weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [session startRunning];
    GhostCoreCaptureSession *strongSelf = weakSelf;
    if (!strongSelf) return;
    if (session.isRunning) [strongSelf setRunning];
    else if (!strongSelf.stopped) [strongSelf fail:@"The camera session did not start"];
  });
  return YES;
}

- (BOOL)startCamera:(NSString *)deviceID error:(NSString **)message {
  const AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (status == AVAuthorizationStatusAuthorized) return [self configureAndStartCamera:deviceID error:message];
  if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
    *message = @"Camera permission is denied for the render core";
    return NO;
  }
  __weak GhostCoreCaptureSession *weakSelf = self;
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
    GhostCoreCaptureSession *strongSelf = weakSelf;
    if (!strongSelf || strongSelf.stopped) return;
    if (!granted) {
      [strongSelf fail:@"Camera permission is denied for the render core"];
      return;
    }
    NSString *failure = nil;
    if (![strongSelf configureAndStartCamera:deviceID error:&failure]) [strongSelf fail:failure ?: @"Could not open camera"];
  }];
  return YES;
}

// MARK: screen

- (void)stream:(SCStream *)stream
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
  if (type != SCStreamOutputTypeScreen || !CMSampleBufferDataIsReady(sampleBuffer)) return;
  [self followContentSizeOfSampleBuffer:sampleBuffer stream:stream];
  [self takeSampleBuffer:sampleBuffer];
}

// A captured window that is resized, or moved to a screen with another
// scale, keeps the output size it started at unless the output follows
// the content's pixel size (at most twice a second), as the addon does.
- (void)followContentSizeOfSampleBuffer:(CMSampleBufferRef)sampleBuffer stream:(SCStream *)stream API_AVAILABLE(macos(12.3)) {
  SCStreamConfiguration *current = self.screenConfig;
  if (!current || stream != self.screenStream) return;
  CFArrayRef attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
  if (!attachmentsArray || CFArrayGetCount(attachmentsArray) == 0) return;
  NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(attachmentsArray, 0);
  NSDictionary *rectDict = info[SCStreamFrameInfoContentRect];
  NSNumber *contentScale = info[SCStreamFrameInfoContentScale];
  NSNumber *scaleFactor = info[SCStreamFrameInfoScaleFactor];
  if (!rectDict || !contentScale || !scaleFactor) return;
  CGRect contentRect = CGRectZero;
  if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)rectDict, &contentRect)) return;
  const CGFloat fit = contentScale.doubleValue;
  const CGFloat scale = scaleFactor.doubleValue;
  if (fit <= 0 || scale <= 0) return;
  const NSUInteger wantW = GhostPixels(contentRect.size.width / fit, scale);
  const NSUInteger wantH = GhostPixels(contentRect.size.height / fit, scale);
  const NSUInteger haveW = (NSUInteger)current.width;
  const NSUInteger haveH = (NSUInteger)current.height;
  if ((wantW > haveW ? wantW - haveW : haveW - wantW) <= 2 && (wantH > haveH ? wantH - haveH : haveH - wantH) <= 2) return;
  const CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - self.lastResizeAt < 0.5) return;
  self.lastResizeAt = now;
  SCStreamConfiguration *next = [[SCStreamConfiguration alloc] init];
  next.width = wantW;
  next.height = wantH;
  next.pixelFormat = current.pixelFormat;
  next.minimumFrameInterval = current.minimumFrameInterval;
  next.queueDepth = current.queueDepth;
  next.showsCursor = current.showsCursor;
  next.colorSpaceName = current.colorSpaceName;
  self.screenConfig = next;
  [stream updateConfiguration:next completionHandler:^(__unused NSError *error) {}];
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error API_AVAILABLE(macos(12.3)) {
  (void)stream;
  if (self.stopped) return;
  [self fail:error.localizedDescription ?: @"Screen capture stopped"];
}

- (void)startScreen:(NSString *)sourceID displayID:(NSString *)displayID kind:(NSString *)kind API_AVAILABLE(macos(12.3)) {
  __weak GhostCoreCaptureSession *weakSelf = self;
  [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                             onScreenWindowsOnly:NO
                                               completionHandler:^(SCShareableContent *content, NSError *error) {
    GhostCoreCaptureSession *strongSelf = weakSelf;
    if (!strongSelf || strongSelf.stopped) return;
    if (!content || error) {
      [strongSelf fail:error.localizedDescription ?: @"Could not enumerate capture sources"];
      return;
    }
    SCContentFilter *filter = nil;
    NSUInteger width = 1920;
    NSUInteger height = 1080;
    const uint32_t numericSourceID = GhostNumericSourceID(sourceID);
    if ([kind isEqualToString:@"screen"]) {
      uint32_t wantedDisplayID = (uint32_t)strtoul(displayID.UTF8String ?: "0", nullptr, 10);
      if (wantedDisplayID == 0) wantedDisplayID = numericSourceID;
      SCDisplay *selected = nil;
      for (SCDisplay *display in content.displays) {
        if (display.displayID == wantedDisplayID) { selected = display; break; }
      }
      if (!selected && content.displays.count > 0) selected = content.displays.firstObject;
      if (selected) {
        filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
        CGFloat scale = 0;
        if (GhostOSAtLeast(14, 0)) scale = filter.pointPixelScale;
        if (scale <= 0) scale = GhostScaleForDisplayID(selected.displayID);
        if (scale <= 0) scale = GhostLargestBackingScale();
        width = GhostPixels(selected.width, scale);
        height = GhostPixels(selected.height, scale);
      }
    } else {
      SCWindow *selected = nil;
      for (SCWindow *window in content.windows) {
        if (window.windowID == numericSourceID) { selected = window; break; }
      }
      if (selected) {
        filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
        CGFloat scale = 0;
        if (GhostOSAtLeast(14, 0)) scale = filter.pointPixelScale;
        if (scale <= 0) scale = GhostLargestBackingScale();
        width = GhostPixels(selected.frame.size.width, scale);
        height = GhostPixels(selected.frame.size.height, scale);
      }
    }
    if (!filter) {
      [strongSelf fail:@"The selected screen or window is no longer available"];
      return;
    }
    SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
    config.width = width;
    config.height = height;
    config.pixelFormat = kCVPixelFormatType_32BGRA;
    config.minimumFrameInterval = CMTimeMake(1, 60);
    config.queueDepth = 6;
    config.showsCursor = YES;
    config.capturesAudio = NO;
    config.colorSpaceName = kCGColorSpaceSRGB;
    SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:strongSelf];
    NSError *outputError = nil;
    if (![stream addStreamOutput:strongSelf
                            type:SCStreamOutputTypeScreen
              sampleHandlerQueue:strongSelf.frameQueue
                           error:&outputError]) {
      [strongSelf fail:outputError.localizedDescription ?: @"Could not attach screen capture output"];
      return;
    }
    strongSelf.screenStream = stream;
    strongSelf.screenConfig = config;
    [stream startCaptureWithCompletionHandler:^(NSError *startError) {
      GhostCoreCaptureSession *session = weakSelf;
      if (!session) return;
      if (startError) [session fail:startError.localizedDescription ?: @"Screen capture did not start"];
      else [session setRunning];
    }];
  }];
}

- (void)stop {
  self.stopped = YES;
  AVCaptureSession *camera = self.cameraSession;
  self.cameraSession = nil;
  if (camera) dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [camera stopRunning]; });
  if (GhostOSAtLeast(12, 3)) {
    SCStream *stream = self.screenStream;
    self.screenStream = nil;
    self.screenConfig = nil;
    if (stream) [stream stopCaptureWithCompletionHandler:^(__unused NSError *error) {}];
  }
  os_unfair_lock_lock(&_lock);
  CVPixelBufferRef latest = _latest;
  _latest = nullptr;
  _running = NO;
  os_unfair_lock_unlock(&_lock);
  if (latest) CVPixelBufferRelease(latest);
}

@end

struct GhostLiveCapture {
  GhostCoreCaptureSession *session;
};

extern "C" GhostLiveCapture *ghost_live_capture_start_camera(const char *device_id, char *error, size_t error_capacity) {
  @autoreleasepool {
    GhostCoreCaptureSession *session = [[GhostCoreCaptureSession alloc] init];
    NSString *message = nil;
    if (![session startCamera:GhostString(device_id) error:&message]) {
      [session stop];
      GhostCopyError(message ?: @"Could not open camera", error, error_capacity);
      return nullptr;
    }
    return new GhostLiveCapture{session};
  }
}

extern "C" GhostLiveCapture *ghost_live_capture_start_screen(const char *source_id, const char *display_id,
                                                           const char *kind, char *error, size_t error_capacity) {
  @autoreleasepool {
    if (GhostOSAtLeast(12, 3)) {
      GhostCoreCaptureSession *session = [[GhostCoreCaptureSession alloc] init];
      [session startScreen:GhostString(source_id) displayID:GhostString(display_id) kind:GhostString(kind)];
      return new GhostLiveCapture{session};
    }
    GhostCopyError(@"Screen capture requires macOS 12.3 or newer", error, error_capacity);
    return nullptr;
  }
}

extern "C" void ghost_live_capture_stop(GhostLiveCapture *capture) {
  if (!capture) return;
  @autoreleasepool {
    [capture->session stop];
    capture->session = nil;
  }
  delete capture;
}

extern "C" int ghost_live_capture_latest(GhostLiveCapture *capture, uint64_t since_frame, GhostLiveCaptureFrame *frame) {
  if (!capture || !frame) return 0;
  return [capture->session latestSince:since_frame frame:frame];
}

extern "C" void ghost_live_capture_state(GhostLiveCapture *capture, GhostLiveCaptureState *state) {
  if (!state) return;
  *state = GhostLiveCaptureState{};
  if (capture) [capture->session state:state];
}

extern "C" void ghost_live_capture_error(GhostLiveCapture *capture, char *error, size_t error_capacity) {
  @autoreleasepool {
    GhostCopyError(capture ? [capture->session lastError] : @"", error, error_capacity);
  }
}

extern "C" void ghost_live_capture_release_pixel_buffer(void *pixel_buffer) {
  if (pixel_buffer) CVPixelBufferRelease((CVPixelBufferRef)pixel_buffer);
}

extern "C" char *ghost_live_capture_list_cameras_json(void) {
  @autoreleasepool {
    NSArray<AVCaptureDeviceType> *deviceTypes;
    if (GhostOSAtLeast(14, 0)) {
      deviceTypes = @[ AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternal ];
    } else {
      deviceTypes = @[ AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternalUnknown ];
    }
    AVCaptureDeviceDiscoverySession *discovery = [AVCaptureDeviceDiscoverySession
      discoverySessionWithDeviceTypes:deviceTypes
      mediaType:AVMediaTypeVideo
      position:AVCaptureDevicePositionUnspecified];
    NSMutableArray *devices = [NSMutableArray array];
    for (AVCaptureDevice *device in discovery.devices) {
      [devices addObject:@{ @"id": device.uniqueID ?: @"", @"name": device.localizedName ?: @"" }];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:devices options:0 error:nil];
    if (!json) return strdup("[]");
    char *out = (char *)malloc(json.length + 1);
    if (!out) return nullptr;
    memcpy(out, json.bytes, json.length);
    out[json.length] = 0;
    return out;
  }
}

extern "C" void ghost_live_capture_free_string(char *value) {
  free(value);
}

extern "C" int ghost_live_capture_camera_authorization(void) {
  return (int)[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
}

extern "C" int ghost_live_capture_screen_preflight(void) {
  return CGPreflightScreenCaptureAccess() ? 1 : 0;
}

extern "C" double ghost_live_capture_host_seconds(void) {
  return GhostHostSeconds();
}
