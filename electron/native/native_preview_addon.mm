/**
 * Ghost Arcade Native Preview Addon (macOS)
 *
 * Embeds a CAMetalLayer-backed NSView inside the main Electron window and
 * presents the native renderer's IOSurface output directly. This is the editor
 * side of the single-render contract: the Rust/wgpu core renders once, exports
 * an IOSurface, and this presenter blits that same texture into the canvas
 * region without creating a second browser-side renderer.
 */

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>
#import <CoreVideo/CoreVideo.h>
#include <napi.h>
#include <cmath>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>
#include <simd/simd.h>

struct GhostOverlayVertex {
  simd_float2 position;
  simd_float4 color;
  simd_float4 borderColor;
  simd_float4 style;
};

struct GhostOverlayHandle {
  simd_float2 position;
  std::string kind;
};

@interface GhostNativePreviewView : NSView
- (NSDictionary*)statusDictionary;
- (BOOL)presentIOSurfaceID:(IOSurfaceID)surfaceID
                    width:(NSUInteger)width
                   height:(NSUInteger)height
                   flipped:(BOOL)flipped;
- (BOOL)setIOSurfaceID:(IOSurfaceID)surfaceID
                 width:(NSUInteger)width
                height:(NSUInteger)height
                flipped:(BOOL)flipped;
- (BOOL)presentActiveIOSurface;
- (void)schedulePresentActiveIOSurface;
- (void)stopPump;
- (void)setOverlayLines:(const std::vector<simd_float2>&)lines
                  points:(const std::vector<simd_float2>&)points
                 handles:(const std::vector<GhostOverlayHandle>&)handles;
- (void)setContentRect:(NSRect)rect generation:(uint64_t)generation;
- (uint64_t)geometryGeneration;
- (void)setGeometryCoordinateView:(NSView*)coordinateView;
@end

static CVReturn GhostNativePreviewDisplayLinkCallback(
  CVDisplayLinkRef displayLink,
  const CVTimeStamp* now,
  const CVTimeStamp* outputTime,
  CVOptionFlags flagsIn,
  CVOptionFlags* flagsOut,
  void* displayLinkContext
);

@implementation GhostNativePreviewView {
  id<MTLDevice> device_;
  id<MTLCommandQueue> commandQueue_;
  id<MTLRenderPipelineState> pipeline_;
  id<MTLRenderPipelineState> overlayLinePipeline_;
  id<MTLRenderPipelineState> overlayPointPipeline_;
  CAMetalLayer* metalLayer_;
  CVDisplayLinkRef displayLink_;
  dispatch_source_t fallbackTimer_;
  IOSurfaceID activeSurfaceID_;
  NSUInteger activeWidth_;
  NSUInteger activeHeight_;
  BOOL activeFlipped_;
  BOOL pumpActive_;
  BOOL presentScheduled_;
  CFTimeInterval lastPresentScheduledAt_;
  uint64_t displayLinkSkippedFrames_;
  NSUInteger lastWidth_;
  NSUInteger lastHeight_;
  IOSurfaceID lastSurfaceID_;
  uint64_t frameCount_;
  NSString* lastError_;
  id<MTLBuffer> overlayLineBuffer_;
  id<MTLBuffer> overlayPointBuffer_;
  NSUInteger overlayLineVertexCount_;
  NSUInteger overlayPointVertexCount_;
  NSRect contentRect_;
  uint64_t geometryGeneration_;
  __weak NSView* geometryCoordinateView_;
}

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (!self) return nil;

  self.wantsLayer = YES;
  self.autoresizesSubviews = NO;
  self.layer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
  self.layer.masksToBounds = YES;
  contentRect_ = NSMakeRect(0.0, 0.0, frame.size.width, frame.size.height);

  device_ = MTLCreateSystemDefaultDevice();
  if (!device_) {
    lastError_ = @"MTLCreateSystemDefaultDevice returned nil";
    return self;
  }

  commandQueue_ = [device_ newCommandQueue];
  if (!commandQueue_) {
    lastError_ = @"Failed to create Metal command queue";
    return self;
  }

  metalLayer_ = [CAMetalLayer layer];
  metalLayer_.device = device_;
  metalLayer_.pixelFormat = MTLPixelFormatBGRA8Unorm;
  metalLayer_.framebufferOnly = YES;
  metalLayer_.opaque = YES;
  metalLayer_.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
  metalLayer_.contentsScale = self.window.screen.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor ?: 1.0;
  metalLayer_.frame = self.bounds;
  [self.layer addSublayer:metalLayer_];

  NSError* error = nil;
  NSString* source =
    @"#include <metal_stdlib>\n"
     "using namespace metal;\n"
     "struct VSOut { float4 position [[position]]; float2 uv; };\n"
     "vertex VSOut vs_main(uint vid [[vertex_id]]) {\n"
     "  float2 pos[4] = { float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0), float2(1.0, 1.0) };\n"
     "  float2 uv[4] = { float2(0.0, 1.0), float2(1.0, 1.0), float2(0.0, 0.0), float2(1.0, 0.0) };\n"
     "  VSOut out; out.position = float4(pos[vid], 0.0, 1.0); out.uv = uv[vid]; return out;\n"
     "}\n"
     "fragment float4 fs_main(VSOut in [[stage_in]], texture2d<float> tex [[texture(0)]], constant uint& flipY [[buffer(0)]]) {\n"
     "  constexpr sampler s(address::clamp_to_edge, filter::linear);\n"
     "  float2 uv = in.uv;\n"
     "  if (flipY != 0) uv.y = 1.0 - uv.y;\n"
     "  return tex.sample(s, uv);\n"
     "}\n"
     "struct OverlayVertex { float2 position; float4 color; float4 borderColor; float4 style; };\n"
     "struct OverlayOut { float4 position [[position]]; float4 color; float4 borderColor; float4 style; float pointSize [[point_size]]; };\n"
     "vertex OverlayOut overlay_vs(const device OverlayVertex* vertices [[buffer(0)]], constant float4& transform [[buffer(1)]], uint vid [[vertex_id]]) {\n"
     "  OverlayOut out; float2 p = vertices[vid].position; out.position = float4(transform.x + p.x * transform.z, transform.y - p.y * transform.w, 0.0, 1.0); out.color = vertices[vid].color; out.borderColor = vertices[vid].borderColor; out.style = vertices[vid].style; out.pointSize = vertices[vid].style.x; return out;\n"
     "}\n"
     "fragment float4 overlay_line_fs(OverlayOut in [[stage_in]]) { return in.color; }\n"
     "float segmentDistance(float2 p, float2 a, float2 b) {\n"
     "  float2 pa = p - a; float2 ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0); return length(pa - ba * h);\n"
     "}\n"
     "fragment float4 overlay_point_fs(OverlayOut in [[stage_in]], float2 pointCoord [[point_coord]]) {\n"
     "  float size = in.style.x / max(in.style.w, 1.0); float border = in.style.y; int kind = int(in.style.z + 0.5); float2 p = (pointCoord - 0.5) * size;\n"
     "  float coverage = 0.0; float borderMask = 0.0;\n"
     "  if (kind == 2) { coverage = step(abs(p.y), 6.0); borderMask = coverage * max(step(4.0, abs(p.y)), max(step(size * 0.5 - 2.0, abs(p.x)), 0.0)); }\n"
     "  else if (kind == 3) { coverage = step(abs(p.x), 6.0); borderMask = coverage * max(step(4.0, abs(p.x)), max(step(size * 0.5 - 2.0, abs(p.y)), 0.0)); }\n"
     "  else { float radius = size * 0.5 - 1.0; float d = length(p); coverage = step(d, radius); borderMask = coverage * step(radius - border, d); }\n"
     "  if (coverage < 0.5) discard_fragment();\n"
     "  float4 result = mix(in.color, in.borderColor, borderMask);\n"
     "  if (kind == 4) {\n"
     "    float glyph = min(min(segmentDistance(p, float2(-8.0, 0.0), float2(8.0, 0.0)), segmentDistance(p, float2(0.0, -8.0), float2(0.0, 8.0))), min(min(segmentDistance(p, float2(-8.0, 0.0), float2(-5.0, -3.0)), segmentDistance(p, float2(-8.0, 0.0), float2(-5.0, 3.0))), min(min(segmentDistance(p, float2(8.0, 0.0), float2(5.0, -3.0)), segmentDistance(p, float2(8.0, 0.0), float2(5.0, 3.0))), min(min(segmentDistance(p, float2(0.0, -8.0), float2(-3.0, -5.0)), segmentDistance(p, float2(0.0, -8.0), float2(3.0, -5.0))), min(segmentDistance(p, float2(0.0, 8.0), float2(-3.0, 5.0)), segmentDistance(p, float2(0.0, 8.0), float2(3.0, 5.0)))))));\n"
     "    if (glyph < 1.15) result = in.borderColor;\n"
     "  } else if (kind == 5) {\n"
     "    float ring = abs(length(p) - 6.0); bool arc = !(p.x > 2.0 && p.y < -4.5); float arrow = min(segmentDistance(p, float2(2.5, -6.0), float2(7.0, -6.0)), segmentDistance(p, float2(7.0, -6.0), float2(7.0, -1.5)));\n"
     "    if ((ring < 1.2 && arc) || arrow < 1.2) result = in.borderColor;\n"
     "  } else if (kind == 6) {\n"
     "    float glyph = min(segmentDistance(p, float2(-6.0, 6.0), float2(6.0, -6.0)), min(min(segmentDistance(p, float2(-6.0, 6.0), float2(-2.0, 6.0)), segmentDistance(p, float2(-6.0, 6.0), float2(-6.0, 2.0))), min(segmentDistance(p, float2(6.0, -6.0), float2(2.0, -6.0)), segmentDistance(p, float2(6.0, -6.0), float2(6.0, -2.0)))));\n"
     "    if (glyph < 1.1) result = in.borderColor;\n"
     "  }\n"
     "  return result;\n"
     "}\n";
  id<MTLLibrary> library = [device_ newLibraryWithSource:source options:nil error:&error];
  if (!library) {
    lastError_ = [NSString stringWithFormat:@"Failed to compile Metal preview shaders: %@", error.localizedDescription ?: @"unknown"];
    return self;
  }

  MTLRenderPipelineDescriptor* descriptor = [[MTLRenderPipelineDescriptor alloc] init];
  descriptor.vertexFunction = [library newFunctionWithName:@"vs_main"];
  descriptor.fragmentFunction = [library newFunctionWithName:@"fs_main"];
  descriptor.colorAttachments[0].pixelFormat = metalLayer_.pixelFormat;
  pipeline_ = [device_ newRenderPipelineStateWithDescriptor:descriptor error:&error];
  if (!pipeline_) {
    lastError_ = [NSString stringWithFormat:@"Failed to create Metal preview pipeline: %@", error.localizedDescription ?: @"unknown"];
  }

  MTLRenderPipelineDescriptor* overlayLineDescriptor = [[MTLRenderPipelineDescriptor alloc] init];
  overlayLineDescriptor.vertexFunction = [library newFunctionWithName:@"overlay_vs"];
  overlayLineDescriptor.fragmentFunction = [library newFunctionWithName:@"overlay_line_fs"];
  overlayLineDescriptor.colorAttachments[0].pixelFormat = metalLayer_.pixelFormat;
  overlayLineDescriptor.colorAttachments[0].blendingEnabled = YES;
  overlayLineDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
  overlayLineDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
  overlayLineDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
  overlayLineDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
  overlayLinePipeline_ = [device_ newRenderPipelineStateWithDescriptor:overlayLineDescriptor error:&error];

  MTLRenderPipelineDescriptor* overlayPointDescriptor = [overlayLineDescriptor copy];
  overlayPointDescriptor.fragmentFunction = [library newFunctionWithName:@"overlay_point_fs"];
  overlayPointPipeline_ = [device_ newRenderPipelineStateWithDescriptor:overlayPointDescriptor error:&error];
  if (!overlayLinePipeline_ || !overlayPointPipeline_) {
    lastError_ = [NSString stringWithFormat:@"Failed to create Metal editor-overlay pipelines: %@", error.localizedDescription ?: @"unknown"];
  }
  return self;
}

- (void)dealloc {
  [self stopPump];
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)isOpaque {
  return YES;
}

- (NSView*)hitTest:(NSPoint)point {
  // This view must never steal editor interactions if the platform compositor
  // places it above the web contents during a transition.
  return nil;
}

- (void)setFrame:(NSRect)frame {
  [super setFrame:frame];
  // CAMetalLayer is a local child of the AppKit-owned backing layer. Keeping
  // those coordinate spaces separate is essential: assigning self.bounds to a
  // root backing layer displaces and clips the drawable by the NSView's frame
  // origin whenever the editor canvas is not at window origin.
  metalLayer_.frame = self.bounds;
  CGFloat scale = self.window.screen.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor ?: 1.0;
  metalLayer_.contentsScale = scale;
  metalLayer_.drawableSize = CGSizeMake(
    MAX(1.0, self.bounds.size.width * scale),
    MAX(1.0, self.bounds.size.height * scale)
  );
  // The native view is attached directly to the DOM canvas rectangle. Its
  // drawable content therefore always occupies the complete local view; a
  // second independently updated crop rectangle is not permitted.
  @synchronized (self) {
    contentRect_ = self.bounds;
  }
}

- (void)setContentRect:(NSRect)rect generation:(uint64_t)generation {
  @synchronized (self) {
    contentRect_ = self.bounds;
    geometryGeneration_ = generation;
  }
}

- (uint64_t)geometryGeneration {
  @synchronized (self) {
    return geometryGeneration_;
  }
}

- (void)setGeometryCoordinateView:(NSView*)coordinateView {
  geometryCoordinateView_ = coordinateView;
}

- (NSDictionary*)statusDictionary {
  NSRect contentRect;
  uint64_t geometryGeneration = 0;
  @synchronized (self) {
    contentRect = contentRect_;
    geometryGeneration = geometryGeneration_;
  }
  NSView* hostView = self.superview;
  const NSRect hostBounds = hostView ? hostView.bounds : NSZeroRect;
  NSView* coordinateView = geometryCoordinateView_ ?: hostView;
  const NSRect coordinateBounds = coordinateView ? coordinateView.bounds : NSZeroRect;
  const NSRect hostFrame = self.frame;
  const NSRect coordinateFrame = (
    hostView && coordinateView && hostView != coordinateView
      ? [hostView convertRect:hostFrame toView:coordinateView]
      : hostFrame
  );
  const CGFloat viewX = coordinateFrame.origin.x - coordinateBounds.origin.x;
  const CGFloat viewY = coordinateView && coordinateView.isFlipped
    ? coordinateFrame.origin.y - coordinateBounds.origin.y
    : NSMaxY(coordinateBounds) - NSMaxY(coordinateFrame);
  return @{
    @"available": @(device_ != nil && commandQueue_ != nil && pipeline_ != nil && overlayLinePipeline_ != nil && overlayPointPipeline_ != nil),
    @"attached": @(self.superview != nil),
    @"mode": @"shared-texture-import-blit",
    @"presentation": @"underlay-zero-copy",
    @"transport": @"iosurface",
    @"pumpActive": @(pumpActive_),
    @"maxFps": @60,
    @"displayLinkSkippedFrames": @(displayLinkSkippedFrames_),
    @"lastSurfaceID": @(lastSurfaceID_),
    @"width": @(lastWidth_),
    @"height": @(lastHeight_),
    @"framesPresented": @(frameCount_),
    @"geometryGeneration": @(geometryGeneration),
    @"viewX": @(viewX),
    @"viewY": @(viewY),
    @"viewWidth": @(coordinateFrame.size.width),
    @"viewHeight": @(coordinateFrame.size.height),
    @"contentX": @(contentRect.origin.x),
    @"contentY": @(contentRect.origin.y),
    @"contentWidth": @(contentRect.size.width),
    @"contentHeight": @(contentRect.size.height),
    @"coordinateWidth": @(coordinateBounds.size.width),
    @"coordinateHeight": @(coordinateBounds.size.height),
    @"hostViewX": @(hostFrame.origin.x - hostBounds.origin.x),
    @"hostViewY": @(hostView && hostView.isFlipped
      ? hostFrame.origin.y - hostBounds.origin.y
      : NSMaxY(hostBounds) - NSMaxY(hostFrame)),
    @"hostWidth": @(hostBounds.size.width),
    @"hostHeight": @(hostBounds.size.height),
    @"error": lastError_ ?: (id)[NSNull null],
  };
}

- (BOOL)presentIOSurfaceID:(IOSurfaceID)surfaceID
                    width:(NSUInteger)width
                   height:(NSUInteger)height
                   flipped:(BOOL)flipped {
  if (!device_ || !commandQueue_ || !pipeline_ || !metalLayer_) {
    lastError_ = @"Metal presenter is not initialized";
    return NO;
  }
  if (surfaceID == 0 || width == 0 || height == 0) {
    lastError_ = @"Invalid IOSurface metadata";
    return NO;
  }

  IOSurfaceRef surface = IOSurfaceLookup(surfaceID);
  if (!surface) {
    lastError_ = [NSString stringWithFormat:@"IOSurfaceLookup(%u) returned nil", surfaceID];
    return NO;
  }

  // The core can replace its export target while Electron is processing the
  // preceding metadata response (window resize, output promotion, fullscreen).
  // Metal aborts the entire process when a texture descriptor is larger than
  // the IOSurface allocation, so the allocation itself is authoritative.
  const NSUInteger surfaceWidth = (NSUInteger)IOSurfaceGetWidth(surface);
  const NSUInteger surfaceHeight = (NSUInteger)IOSurfaceGetHeight(surface);
  if (surfaceWidth == 0 || surfaceHeight == 0) {
    CFRelease(surface);
    lastError_ = [NSString stringWithFormat:@"IOSurfaceLookup(%u) has invalid dimensions", surfaceID];
    return NO;
  }

  MTLTextureDescriptor* textureDescriptor =
    [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                       width:surfaceWidth
                                                      height:surfaceHeight
                                                   mipmapped:NO];
  textureDescriptor.usage = MTLTextureUsageShaderRead;
  id<MTLTexture> texture = [device_ newTextureWithDescriptor:textureDescriptor
                                                   iosurface:surface
                                                       plane:0];
  CFRelease(surface);

  if (!texture) {
    lastError_ = @"Failed to create Metal texture from IOSurface";
    return NO;
  }

  id<CAMetalDrawable> drawable = [metalLayer_ nextDrawable];
  if (!drawable) {
    lastError_ = @"CAMetalLayer returned no drawable";
    return NO;
  }

  MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
  pass.colorAttachments[0].texture = drawable.texture;
  pass.colorAttachments[0].loadAction = MTLLoadActionClear;
  pass.colorAttachments[0].storeAction = MTLStoreActionStore;
  pass.colorAttachments[0].clearColor = MTLClearColorMake(0.0, 0.0, 0.0, 1.0);

  id<MTLCommandBuffer> commandBuffer = [commandQueue_ commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [commandBuffer renderCommandEncoderWithDescriptor:pass];
  NSRect contentRect;
  id<MTLBuffer> lineBuffer = nil;
  id<MTLBuffer> pointBuffer = nil;
  NSUInteger lineVertexCount = 0;
  NSUInteger pointVertexCount = 0;
  @synchronized (self) {
    contentRect = contentRect_;
    lineBuffer = overlayLineBuffer_;
    pointBuffer = overlayPointBuffer_;
    lineVertexCount = overlayLineVertexCount_;
    pointVertexCount = overlayPointVertexCount_;
  }

  const double boundsWidth = MAX(1.0, self.bounds.size.width);
  const double boundsHeight = MAX(1.0, self.bounds.size.height);
  const double pixelScaleX = (double)drawable.texture.width / boundsWidth;
  const double pixelScaleY = (double)drawable.texture.height / boundsHeight;
  {
    static char lastGeomSig[512] = {0};
    char geomSig[512];
    // onScreen: where AppKit actually shows this view (window coords, bottom
    // -left) — the ground truth the JS rect math has to agree with.
    NSRect onScreen = self.superview ? [self convertRect:self.bounds toView:nil] : NSZeroRect;
    CGRect layerBounds = metalLayer_.bounds;
    CGAffineTransform t = metalLayer_.affineTransform;
    snprintf(geomSig, sizeof(geomSig),
      "b=%.0fx%.0f d=%lux%lu c=%.1f,%.1f,%.1fx%.1f s=%.1f src=%lux%lu frame=%.0f,%.0f,%.0fx%.0f win=%.0f,%.0f,%.0fx%.0f lb=%.0fx%.0f xf=%.2f,%.2f",
      boundsWidth, boundsHeight,
      (unsigned long)drawable.texture.width, (unsigned long)drawable.texture.height,
      contentRect.origin.x, contentRect.origin.y, contentRect.size.width, contentRect.size.height,
      (double)metalLayer_.contentsScale,
      (unsigned long)width, (unsigned long)height,
      self.frame.origin.x, self.frame.origin.y, self.frame.size.width, self.frame.size.height,
      onScreen.origin.x, onScreen.origin.y, onScreen.size.width, onScreen.size.height,
      layerBounds.size.width, layerBounds.size.height,
      (double)t.a, (double)t.d);
    if (strncmp(lastGeomSig, geomSig, sizeof(geomSig)) != 0) {
      strncpy(lastGeomSig, geomSig, sizeof(lastGeomSig) - 1);
      fprintf(stderr, "[preview-geom] %s\n", geomSig);
    }
  }
  MTLViewport contentViewport = {
    contentRect.origin.x * pixelScaleX,
    contentRect.origin.y * pixelScaleY,
    MAX(1.0, contentRect.size.width * pixelScaleX),
    MAX(1.0, contentRect.size.height * pixelScaleY),
    0.0,
    1.0,
  };
  [encoder setViewport:contentViewport];
  uint32_t flipValue = flipped ? 1 : 0;
  [encoder setRenderPipelineState:pipeline_];
  [encoder setFragmentTexture:texture atIndex:0];
  [encoder setFragmentBytes:&flipValue length:sizeof(flipValue) atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];

  if (overlayLinePipeline_ && overlayPointPipeline_) {
    MTLViewport workspaceViewport = {
      0.0,
      0.0,
      (double)drawable.texture.width,
      (double)drawable.texture.height,
      0.0,
      1.0,
    };
    [encoder setViewport:workspaceViewport];
    simd_float4 overlayTransform = {
      (float)(contentRect.origin.x / boundsWidth * 2.0 - 1.0),
      (float)(1.0 - contentRect.origin.y / boundsHeight * 2.0),
      (float)(contentRect.size.width / boundsWidth * 2.0),
      (float)(contentRect.size.height / boundsHeight * 2.0),
    };
    [encoder setVertexBytes:&overlayTransform length:sizeof(overlayTransform) atIndex:1];
    if (lineBuffer && lineVertexCount > 0) {
      [encoder setRenderPipelineState:overlayLinePipeline_];
      [encoder setVertexBuffer:lineBuffer offset:0 atIndex:0];
      [encoder drawPrimitives:MTLPrimitiveTypeLine vertexStart:0 vertexCount:lineVertexCount];
    }
    if (pointBuffer && pointVertexCount > 0) {
      [encoder setRenderPipelineState:overlayPointPipeline_];
      [encoder setVertexBuffer:pointBuffer offset:0 atIndex:0];
      [encoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:pointVertexCount];
    }
  }
  [encoder endEncoding];
  [commandBuffer presentDrawable:drawable];
  [commandBuffer commit];

  lastSurfaceID_ = surfaceID;
  lastWidth_ = surfaceWidth;
  lastHeight_ = surfaceHeight;
  frameCount_++;
  lastError_ = nil;
  return YES;
}

- (void)setOverlayLines:(const std::vector<simd_float2>&)lines
                  points:(const std::vector<simd_float2>&)points
                 handles:(const std::vector<GhostOverlayHandle>&)handles {
  const simd_float4 lineColor = { 0.72f, 0.43f, 1.0f, 0.9f };
  const simd_float4 clearColor = { 0.0f, 0.0f, 0.0f, 0.0f };
  const simd_float4 meshColor = { 1.0f, 0.0f, 0.67f, 1.0f };
  const simd_float4 whiteColor = { 1.0f, 1.0f, 1.0f, 1.0f };
  const float pointScale = MAX(1.0f, (float)metalLayer_.contentsScale);
  std::vector<GhostOverlayVertex> lineVertices;
  std::vector<GhostOverlayVertex> pointVertices;
  lineVertices.reserve(lines.size());
  pointVertices.reserve(points.size() + handles.size());
  for (const simd_float2& point : lines) {
    lineVertices.push_back({ point, lineColor, clearColor, { 1.0f, 0.0f, 0.0f, 0.0f } });
  }
  for (const simd_float2& point : points) {
    pointVertices.push_back({ point, meshColor, whiteColor, { 12.0f * pointScale, 2.0f, 0.0f, pointScale } });
  }
  for (const GhostOverlayHandle& handle : handles) {
    simd_float4 fill = { 0.055f, 0.065f, 0.085f, 0.96f };
    simd_float4 border = whiteColor;
    simd_float4 style = { 20.0f, 2.0f, 1.0f, 0.0f };
    if (handle.kind == "edge-horizontal") {
      fill = { 0.0f, 0.67f, 1.0f, 1.0f };
      style = { 40.0f, 2.0f, 2.0f, 0.0f };
    } else if (handle.kind == "edge-vertical") {
      fill = { 0.0f, 0.67f, 1.0f, 1.0f };
      style = { 40.0f, 2.0f, 3.0f, 0.0f };
    } else if (handle.kind == "move") {
      border = { 0.73f, 0.53f, 0.99f, 1.0f };
      style = { 36.0f, 2.0f, 4.0f, 0.0f };
    } else if (handle.kind == "rotate") {
      border = { 1.0f, 0.0f, 0.67f, 1.0f };
      style = { 28.0f, 2.0f, 5.0f, 0.0f };
    } else if (handle.kind == "scale") {
      border = { 0.0f, 0.8f, 1.0f, 1.0f };
      style = { 28.0f, 2.0f, 6.0f, 0.0f };
    } else {
      fill = { 0.73f, 0.53f, 0.99f, 1.0f };
    }
    style.x *= pointScale;
    style.w = pointScale;
    pointVertices.push_back({ handle.position, fill, border, style });
  }
  @synchronized (self) {
    overlayLineBuffer_ = lineVertices.empty()
      ? nil
      : [device_ newBufferWithBytes:lineVertices.data()
                             length:lineVertices.size() * sizeof(GhostOverlayVertex)
                            options:MTLResourceStorageModeShared];
    overlayPointBuffer_ = pointVertices.empty()
      ? nil
      : [device_ newBufferWithBytes:pointVertices.data()
                             length:pointVertices.size() * sizeof(GhostOverlayVertex)
                            options:MTLResourceStorageModeShared];
    overlayLineVertexCount_ = lineVertices.size();
    overlayPointVertexCount_ = pointVertices.size();
  }
}

- (BOOL)presentActiveIOSurface {
  IOSurfaceID surfaceID = 0;
  NSUInteger width = 0;
  NSUInteger height = 0;
  BOOL flipped = NO;
  @synchronized (self) {
    surfaceID = activeSurfaceID_;
    width = activeWidth_;
    height = activeHeight_;
    flipped = activeFlipped_;
  }
  if (surfaceID == 0 || width == 0 || height == 0) return NO;
  return [self presentIOSurfaceID:surfaceID width:width height:height flipped:flipped];
}

- (void)schedulePresentActiveIOSurface {
  const CFTimeInterval now = CACurrentMediaTime();
  const CFTimeInterval minInterval = 1.0 / 60.0;
  @synchronized (self) {
    if (now - lastPresentScheduledAt_ < minInterval) {
      displayLinkSkippedFrames_++;
      return;
    }
    if (presentScheduled_) return;
    lastPresentScheduledAt_ = now;
    presentScheduled_ = YES;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    @synchronized (self) {
      presentScheduled_ = NO;
    }
    [self presentActiveIOSurface];
  });
}

- (BOOL)ensurePump {
  if (pumpActive_) return YES;
  CVDisplayLinkRef link = nil;
  CVReturn err = CVDisplayLinkCreateWithActiveCGDisplays(&link);
  if (err != kCVReturnSuccess || !link) {
    // CoreVideo can refuse a display link during app/display transitions.
    // Keep the exact same IOSurface -> Metal presentation path and substitute
    // only its clock with a native main-queue timer.
    fallbackTimer_ = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_TIMER,
      0,
      0,
      dispatch_get_main_queue()
    );
    if (!fallbackTimer_) {
      lastError_ = [NSString stringWithFormat:@"CVDisplayLinkCreateWithActiveCGDisplays failed: %d", err];
      return NO;
    }
    const uint64_t interval = NSEC_PER_SEC / 60;
    dispatch_source_set_timer(
      fallbackTimer_,
      dispatch_time(DISPATCH_TIME_NOW, 0),
      interval,
      interval / 10
    );
    __weak GhostNativePreviewView* weakSelf = self;
    dispatch_source_set_event_handler(fallbackTimer_, ^{
      GhostNativePreviewView* strongSelf = weakSelf;
      if (strongSelf) [strongSelf presentActiveIOSurface];
    });
    dispatch_resume(fallbackTimer_);
    pumpActive_ = YES;
    lastError_ = nil;
    return YES;
  }
  CVDisplayLinkSetOutputCallback(link, GhostNativePreviewDisplayLinkCallback, (__bridge void*)self);
  err = CVDisplayLinkStart(link);
  if (err != kCVReturnSuccess) {
    CVDisplayLinkRelease(link);
    lastError_ = [NSString stringWithFormat:@"CVDisplayLinkStart failed: %d", err];
    return NO;
  }
  displayLink_ = link;
  pumpActive_ = YES;
  return YES;
}

- (BOOL)setIOSurfaceID:(IOSurfaceID)surfaceID
                 width:(NSUInteger)width
                height:(NSUInteger)height
                flipped:(BOOL)flipped {
  if (surfaceID == 0 || width == 0 || height == 0) {
    lastError_ = @"Invalid IOSurface metadata";
    return NO;
  }
  IOSurfaceRef surface = IOSurfaceLookup(surfaceID);
  if (!surface) {
    lastError_ = [NSString stringWithFormat:@"IOSurfaceLookup(%u) returned nil", surfaceID];
    return NO;
  }
  const NSUInteger surfaceWidth = (NSUInteger)IOSurfaceGetWidth(surface);
  const NSUInteger surfaceHeight = (NSUInteger)IOSurfaceGetHeight(surface);
  CFRelease(surface);
  if (surfaceWidth == 0 || surfaceHeight == 0) {
    lastError_ = [NSString stringWithFormat:@"IOSurfaceLookup(%u) has invalid dimensions", surfaceID];
    return NO;
  }
  @synchronized (self) {
    activeSurfaceID_ = surfaceID;
    activeWidth_ = surfaceWidth;
    activeHeight_ = surfaceHeight;
    activeFlipped_ = flipped;
  }
  return [self ensurePump];
}

- (void)stopPump {
  if (displayLink_) {
    CVDisplayLinkStop(displayLink_);
    CVDisplayLinkRelease(displayLink_);
    displayLink_ = nil;
  }
  if (fallbackTimer_) {
    dispatch_source_cancel(fallbackTimer_);
    fallbackTimer_ = nil;
  }
  pumpActive_ = NO;
  presentScheduled_ = NO;
  lastPresentScheduledAt_ = 0;
  @synchronized (self) {
    activeSurfaceID_ = 0;
    activeWidth_ = 0;
    activeHeight_ = 0;
    activeFlipped_ = NO;
  }
}
@end

static CVReturn GhostNativePreviewDisplayLinkCallback(
  CVDisplayLinkRef displayLink,
  const CVTimeStamp* now,
  const CVTimeStamp* outputTime,
  CVOptionFlags flagsIn,
  CVOptionFlags* flagsOut,
  void* displayLinkContext
) {
  GhostNativePreviewView* view = (__bridge GhostNativePreviewView*)displayLinkContext;
  if (!view) return kCVReturnSuccess;
  [view schedulePresentActiveIOSurface];
  return kCVReturnSuccess;
}

static GhostNativePreviewView* gPreviewView = nil;
static NSView* gParentWebView = nil;
static NSView* gPreviewHostView = nil;
static std::mutex gMutex;

static void StabilizeHostWindow(NSView* parentWebView) {
  if (!parentWebView) return;
  NSWindow* window = parentWebView.window;
  if (!window) return;

  // Electron needs an alpha-capable Chromium surface so the Metal child view
  // can show through the editor viewport. The containing AppKit window must
  // still be opaque, otherwise every transparent Chromium pixel becomes a
  // literal hole through to applications behind Ghost Arcade.
  NSColor* backingColor = [NSColor colorWithCalibratedRed:(5.0 / 255.0)
                                                    green:(7.0 / 255.0)
                                                     blue:(11.0 / 255.0)
                                                    alpha:1.0];
  window.opaque = YES;
  window.backgroundColor = backingColor;

  NSView* contentView = window.contentView;
  if (contentView) {
    contentView.wantsLayer = YES;
    contentView.layer.backgroundColor = backingColor.CGColor;
  }
}

struct PreviewRectValues {
  double x = 0.0;
  double y = 0.0;
  double width = 1.0;
  double height = 1.0;
  double contentX = 0.0;
  double contentY = 0.0;
  double contentWidth = 1.0;
  double contentHeight = 1.0;
  uint64_t generation = 0;
};

static void RunOnMainSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

static NSView* ParentViewFromBuffer(const Napi::Value& value) {
  if (!value.IsBuffer()) return nil;
  auto buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(NSView*)) return nil;
  NSView* view = *reinterpret_cast<NSView* const*>(buffer.Data());
  return view;
}

static double NumberProp(const Napi::Object& object, const char* key, double fallback) {
  Napi::Value value = object.Get(key);
  if (!value.IsNumber()) return fallback;
  double number = value.As<Napi::Number>().DoubleValue();
  return std::isfinite(number) ? number : fallback;
}

static PreviewRectValues ParseRectValues(const Napi::Object& rectObject) {
  PreviewRectValues rect;
  rect.x = NumberProp(rectObject, "x", 0.0);
  rect.y = NumberProp(rectObject, "y", 0.0);
  rect.width = MAX(1.0, NumberProp(rectObject, "width", 1.0));
  rect.height = MAX(1.0, NumberProp(rectObject, "height", 1.0));
  rect.contentX = NumberProp(rectObject, "contentX", 0.0);
  rect.contentY = NumberProp(rectObject, "contentY", 0.0);
  rect.contentWidth = MAX(1.0, NumberProp(rectObject, "contentWidth", rect.width));
  rect.contentHeight = MAX(1.0, NumberProp(rectObject, "contentHeight", rect.height));
  rect.generation = (uint64_t)MAX(0.0, floor(NumberProp(rectObject, "generation", 0.0)));
  return rect;
}

static NSRect RectFromTopLeftValues(const PreviewRectValues& rect, NSView* coordinateView) {
  const CGFloat x = (CGFloat)rect.x;
  const CGFloat y = (CGFloat)rect.y;
  const CGFloat w = (CGFloat)rect.width;
  const CGFloat h = (CGFloat)rect.height;
  const NSRect bounds = coordinateView ? coordinateView.bounds : NSZeroRect;
  if (coordinateView && coordinateView.isFlipped) {
    return NSMakeRect(bounds.origin.x + x, bounds.origin.y + y, w, h);
  }
  return NSMakeRect(bounds.origin.x + x, NSMaxY(bounds) - y - h, w, h);
}

static NSRect HostFrameFromWebClientRect(
  const PreviewRectValues& rect,
  NSView* webView,
  NSView* hostView
) {
  if (!webView || !hostView) return NSZeroRect;
  const NSRect webFrame = RectFromTopLeftValues(rect, webView);
  return webView == hostView
    ? webFrame
    : [webView convertRect:webFrame toView:hostView];
}

static Napi::Object StatusObject(Napi::Env env) {
  NSDictionary* status = gPreviewView ? [gPreviewView statusDictionary] : @{
    @"available": @NO,
    @"attached": @NO,
    @"mode": @"unavailable",
    @"presentation": @"unavailable",
    @"transport": @"none",
    @"pumpActive": @NO,
    @"lastSurfaceID": @0,
    @"width": @0,
    @"height": @0,
    @"framesPresented": @0,
    @"geometryGeneration": @0,
    @"viewX": @0,
    @"viewY": @0,
    @"viewWidth": @0,
    @"viewHeight": @0,
    @"contentX": @0,
    @"contentY": @0,
    @"contentWidth": @0,
    @"contentHeight": @0,
    @"coordinateWidth": @0,
    @"coordinateHeight": @0,
    @"hostViewX": @0,
    @"hostViewY": @0,
    @"hostWidth": @0,
    @"hostHeight": @0,
    @"error": [NSNull null],
  };
  Napi::Object object = Napi::Object::New(env);
  for (NSString* key in status) {
    id value = status[key];
    const char* ckey = key.UTF8String;
    if ([value isKindOfClass:NSNumber.class]) {
      const char* objCType = [value objCType];
      if (strcmp(objCType, @encode(BOOL)) == 0) {
        object.Set(ckey, Napi::Boolean::New(env, [value boolValue]));
      } else {
        object.Set(ckey, Napi::Number::New(env, [value doubleValue]));
      }
    } else if ([value isKindOfClass:NSString.class]) {
      object.Set(ckey, Napi::String::New(env, [value UTF8String]));
    } else {
      object.Set(ckey, env.Null());
    }
  }
  return object;
}

static Napi::Value Attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsObject()) {
    Napi::TypeError::New(env, "attach(parentViewHandle, rect) expected").ThrowAsJavaScriptException();
    return StatusObject(env);
  }

  NSView* parentWebView = ParentViewFromBuffer(info[0]);
  if (!parentWebView) {
    Napi::Error::New(env, "Invalid parent NSView handle").ThrowAsJavaScriptException();
    return StatusObject(env);
  }
  PreviewRectValues rectValues = ParseRectValues(info[1].As<Napi::Object>());

  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    gParentWebView = parentWebView;
    StabilizeHostWindow(gParentWebView);
    // Browser getBoundingClientRect() values belong to Chromium's live client
    // view, not NSWindow.contentView. Build the rect in that coordinate space,
    // then convert it once into the stable window host. Metal stays parented to
    // the host while every update refreshes the Chromium handle, so a replaced
    // Chromium view cannot leave the presenter in a stale coordinate system.
    NSView* hostView = gParentWebView.window.contentView ?: gParentWebView;
    NSView* coordinateView = gParentWebView;
    NSRect frame = HostFrameFromWebClientRect(rectValues, coordinateView, hostView);
    if (!gPreviewView) {
      gPreviewView = [[GhostNativePreviewView alloc] initWithFrame:frame];
    }
    // Chromium is the sole geometry owner. A flexible autoresizing mask lets
    // AppKit mutate the child a second time after a browser rect has already
    // been acknowledged, which can leave the preview permanently cropped
    // after interactive window resizing.
    gPreviewView.autoresizingMask = NSViewNotSizable;
    gPreviewHostView = hostView;
    [gPreviewView setGeometryCoordinateView:coordinateView];
    gPreviewView.frame = frame;
    [gPreviewView setContentRect:gPreviewView.bounds generation:rectValues.generation];
    if (gPreviewView.superview != hostView) {
      [gPreviewView removeFromSuperview];
      // The native composite is the workspace underlay. Chromium remains the
      // front sibling so every DOM control, picker, and modal participates in
      // normal web z-order while the Metal view renders continuously beneath.
      [hostView addSubview:gPreviewView positioned:NSWindowBelow relativeTo:nil];
    }

  });
  return StatusObject(env);
}

static Napi::Value Update(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSView* parentWebView = nil;
  Napi::Object rectObject;
  if (info.Length() >= 2 && info[0].IsBuffer() && info[1].IsObject()) {
    parentWebView = ParentViewFromBuffer(info[0]);
    rectObject = info[1].As<Napi::Object>();
  } else if (info.Length() >= 1 && info[0].IsObject()) {
    rectObject = info[0].As<Napi::Object>();
  } else {
    return StatusObject(env);
  }
  PreviewRectValues rectValues = ParseRectValues(rectObject);
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    if (!gPreviewView) return;
    if (parentWebView) gParentWebView = parentWebView;
    NSView* currentWebView = gParentWebView;
    NSView* hostView = currentWebView.window.contentView
      ?: gPreviewHostView
      ?: gPreviewView.superview
      ?: currentWebView;
    NSView* coordinateView = currentWebView;
    if (!coordinateView || !hostView) return;
    if (rectValues.generation > 0 && rectValues.generation < [gPreviewView geometryGeneration]) return;
    StabilizeHostWindow(currentWebView ?: coordinateView);
    if (gPreviewView.superview != hostView) {
      [gPreviewView removeFromSuperview];
      [hostView addSubview:gPreviewView positioned:NSWindowBelow relativeTo:nil];
    }
    gPreviewHostView = hostView;
    [gPreviewView setGeometryCoordinateView:coordinateView];
    gPreviewView.frame = HostFrameFromWebClientRect(rectValues, coordinateView, hostView);
    [gPreviewView setContentRect:gPreviewView.bounds generation:rectValues.generation];
  });
  return StatusObject(env);
}

static Napi::Value StabilizeHost(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "stabilizeHost(parentViewHandle) expected").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  NSView* parentWebView = ParentViewFromBuffer(info[0]);
  if (!parentWebView) {
    Napi::Error::New(env, "Invalid parent NSView handle").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  RunOnMainSync(^{
    StabilizeHostWindow(parentWebView);
  });
  return Napi::Boolean::New(env, true);
}

static Napi::Value PresentIOSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) return Napi::Boolean::New(env, false);
  IOSurfaceID surfaceID = (IOSurfaceID)info[0].As<Napi::Number>().Uint32Value();
  NSUInteger width = (NSUInteger)info[1].As<Napi::Number>().Uint32Value();
  NSUInteger height = (NSUInteger)info[2].As<Napi::Number>().Uint32Value();
  BOOL flipped = info.Length() >= 4 ? info[3].As<Napi::Boolean>().Value() : NO;
  __block BOOL ok = NO;
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    ok = gPreviewView ? [gPreviewView presentIOSurfaceID:surfaceID width:width height:height flipped:flipped] : NO;
  });
  return Napi::Boolean::New(env, ok);
}

static Napi::Value SetIOSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) return Napi::Boolean::New(env, false);
  IOSurfaceID surfaceID = (IOSurfaceID)info[0].As<Napi::Number>().Uint32Value();
  NSUInteger width = (NSUInteger)info[1].As<Napi::Number>().Uint32Value();
  NSUInteger height = (NSUInteger)info[2].As<Napi::Number>().Uint32Value();
  BOOL flipped = info.Length() >= 4 ? info[3].As<Napi::Boolean>().Value() : NO;
  __block BOOL ok = NO;
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    ok = gPreviewView ? [gPreviewView setIOSurfaceID:surfaceID width:width height:height flipped:flipped] : NO;
  });
  return Napi::Boolean::New(env, ok);
}

static std::vector<simd_float2> ParseOverlayPoints(const Napi::Object& object, const char* key) {
  std::vector<simd_float2> points;
  Napi::Value value = object.Get(key);
  if (!value.IsArray()) return points;
  Napi::Array array = value.As<Napi::Array>();
  points.reserve(array.Length());
  for (uint32_t i = 0; i < array.Length(); i++) {
    Napi::Value entry = array.Get(i);
    if (!entry.IsObject()) continue;
    Napi::Object point = entry.As<Napi::Object>();
    const double x = NumberProp(point, "x", 0.0);
    const double y = NumberProp(point, "y", 0.0);
    // Keep canvas-normalized coordinates unbounded. The presenter maps them
    // through its canvas sub-rectangle into workspace clip space, allowing
    // controls to remain visible in the authoring area while pixels stay
    // clipped to the project canvas.
    points.push_back(simd_make_float2((float)x, (float)y));
  }
  return points;
}

static std::vector<GhostOverlayHandle> ParseOverlayHandles(const Napi::Object& object) {
  std::vector<GhostOverlayHandle> handles;
  Napi::Value value = object.Get("handles");
  if (!value.IsArray()) return handles;
  Napi::Array array = value.As<Napi::Array>();
  handles.reserve(array.Length());
  for (uint32_t i = 0; i < array.Length(); i++) {
    Napi::Value entry = array.Get(i);
    if (!entry.IsObject()) continue;
    Napi::Object handle = entry.As<Napi::Object>();
    Napi::Value kindValue = handle.Get("kind");
    if (!kindValue.IsString()) continue;
    handles.push_back({
      simd_make_float2(
        (float)NumberProp(handle, "x", 0.0),
        (float)NumberProp(handle, "y", 0.0)
      ),
      kindValue.As<Napi::String>().Utf8Value(),
    });
  }
  return handles;
}

static Napi::Value SetOverlay(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return StatusObject(env);
  Napi::Object overlay = info[0].As<Napi::Object>();
  std::vector<simd_float2> lines = ParseOverlayPoints(overlay, "lines");
  std::vector<simd_float2> points = ParseOverlayPoints(overlay, "points");
  std::vector<GhostOverlayHandle> handles = ParseOverlayHandles(overlay);
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    [gPreviewView setOverlayLines:lines points:points handles:handles];
  });
  return StatusObject(env);
}

static Napi::Value StopPump(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    [gPreviewView stopPump];
  });
  return StatusObject(env);
}

static Napi::Value Detach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    [gPreviewView stopPump];
    [gPreviewView removeFromSuperview];
    gPreviewView = nil;
    gParentWebView = nil;
    gPreviewHostView = nil;
  });
  return StatusObject(env);
}

static Napi::Value Status(const Napi::CallbackInfo& info) {
  return StatusObject(info.Env());
}

// ── Named monitor views ─────────────────────────────────────────────────
// Small auxiliary presenters (deck A/B confidence monitors) that share the
// exact IOSurface → Metal presentation path of the main preview. Additive:
// nothing here touches the primary gPreviewView state.

static NSMutableDictionary<NSString*, GhostNativePreviewView*>* gMonitorViews = nil;

static Napi::Value MonitorAttach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[2].IsObject()) {
    Napi::TypeError::New(env, "monitorAttach(name, parentViewHandle, rect) expected").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  NSString* name = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  NSView* parentWebView = ParentViewFromBuffer(info[1]);
  if (!parentWebView) {
    Napi::Error::New(env, "Invalid parent NSView handle").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  PreviewRectValues rectValues = ParseRectValues(info[2].As<Napi::Object>());
  __block BOOL ok = NO;
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    if (!gMonitorViews) gMonitorViews = [NSMutableDictionary new];
    StabilizeHostWindow(parentWebView);
    NSView* hostView = parentWebView.window.contentView ?: parentWebView;
    NSRect frame = HostFrameFromWebClientRect(rectValues, parentWebView, hostView);
    GhostNativePreviewView* view = gMonitorViews[name];
    if (!view) {
      view = [[GhostNativePreviewView alloc] initWithFrame:frame];
      gMonitorViews[name] = view;
    }
    view.autoresizingMask = NSViewNotSizable;
    [view setGeometryCoordinateView:parentWebView];
    view.frame = frame;
    [view setContentRect:view.bounds generation:rectValues.generation];
    if (view.superview != hostView) {
      [view removeFromSuperview];
      // Monitors sit above the main preview underlay but stay behind
      // Chromium so DOM chrome keeps normal web z-order.
      if (gPreviewView && gPreviewView.superview == hostView) {
        [hostView addSubview:view positioned:NSWindowAbove relativeTo:gPreviewView];
      } else {
        [hostView addSubview:view positioned:NSWindowBelow relativeTo:nil];
      }
    }
    ok = YES;
  });
  return Napi::Boolean::New(env, ok);
}

static Napi::Value MonitorSetIOSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  NSString* name = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  IOSurfaceID surfaceID = (IOSurfaceID)info[1].As<Napi::Number>().Uint32Value();
  NSUInteger width = (NSUInteger)info[2].As<Napi::Number>().Uint32Value();
  NSUInteger height = (NSUInteger)info[3].As<Napi::Number>().Uint32Value();
  BOOL flipped = info.Length() >= 5 && info[4].IsBoolean() ? info[4].As<Napi::Boolean>().Value() : NO;
  __block BOOL ok = NO;
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    GhostNativePreviewView* view = gMonitorViews ? gMonitorViews[name] : nil;
    ok = view ? [view setIOSurfaceID:surfaceID width:width height:height flipped:flipped] : NO;
  });
  return Napi::Boolean::New(env, ok);
}

static Napi::Value MonitorDetach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSString* name = info.Length() >= 1 && info[0].IsString()
    ? [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()]
    : nil;
  std::lock_guard<std::mutex> lock(gMutex);
  RunOnMainSync(^{
    if (!gMonitorViews) return;
    NSArray<NSString*>* names = name ? @[name] : gMonitorViews.allKeys;
    for (NSString* key in names) {
      GhostNativePreviewView* view = gMonitorViews[key];
      if (!view) continue;
      [view stopPump];
      [view removeFromSuperview];
      [gMonitorViews removeObjectForKey:key];
    }
  });
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("stabilizeHost", Napi::Function::New(env, StabilizeHost));
  exports.Set("presentIOSurface", Napi::Function::New(env, PresentIOSurface));
  exports.Set("setIOSurface", Napi::Function::New(env, SetIOSurface));
  exports.Set("setOverlay", Napi::Function::New(env, SetOverlay));
  exports.Set("stopPump", Napi::Function::New(env, StopPump));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("status", Napi::Function::New(env, Status));
  exports.Set("monitorAttach", Napi::Function::New(env, MonitorAttach));
  exports.Set("monitorSetIOSurface", Napi::Function::New(env, MonitorSetIOSurface));
  exports.Set("monitorDetach", Napi::Function::New(env, MonitorDetach));
  exports.Set("platform", Napi::String::New(env, "macos-native-preview"));
  return exports;
}

NODE_API_MODULE(native_preview_addon, Init)
