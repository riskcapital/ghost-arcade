// GPU-side H.264 recording for macOS.
//
// The mirror of windows_video_encoder.rs: the core encodes its own composite
// instead of handing every frame back to the host process. The Electron
// recorder read the composite to system memory each frame (8.3MB at 1080p,
// ~250MB/s at 30fps), piped it to ffmpeg, and ffmpeg uploaded it to the GPU
// again to encode. The pixels were already on the GPU and VideoToolbox is on
// the GPU; the round trip existed only because the encoder lived elsewhere.
//
// AVAssetWriter does the muxing and picks the hardware H.264 encoder. The
// composite arrives as the IOSurface the core already exports -- the same one
// Syphon and the editor preview read -- wrapped in a CVPixelBuffer without a
// copy, so a take is exactly what went to screen.

#include "mac_video_recorder.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>

#include <algorithm>
#include <string>

namespace {

void set_error(char *error, size_t capacity, const std::string &message) {
    if (!error || capacity == 0) return;
    const size_t length = std::min(message.size(), capacity - 1);
    std::copy_n(message.begin(), length, error);
    error[length] = '\0';
}

/// Bitrate for a quality tier at this pixel rate. The tiers are defined at
/// 1080p30; scale by pixel rate so 4K or 60fps is not starved.
int64_t bitrate_for(const std::string &quality, uint32_t width, uint32_t height, uint32_t fps) {
    int64_t tier = 20000000;
    if (quality == "archive") tier = 40000000;
    else if (quality == "web") tier = 8000000;
    const double reference = 1920.0 * 1080.0 * 30.0;
    const double actual = static_cast<double>(width) * height * std::max(1u, fps);
    const double scaled = static_cast<double>(tier) * (actual / reference);
    return static_cast<int64_t>(std::clamp(scaled, 2000000.0, 240000000.0));
}

} // namespace

struct GhostMacVideoRecorder {
    AVAssetWriter *writer = nil;
    AVAssetWriterInput *input = nil;
    AVAssetWriterInputPixelBufferAdaptor *adaptor = nil;
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t fps = 30;
    uint64_t frames = 0;
    // Wall clock for pacing. The core renders as fast as it can; stamping
    // every rendered frame at 1/fps would play the take back in slow motion.
    CFAbsoluteTime started = 0;
    bool has_started = false;
    int64_t last_index = -1;
    bool finished = false;
};

GhostMacVideoRecorder *ghost_mac_recorder_open(const char *path, uint32_t width,
                                               uint32_t height, uint32_t fps,
                                               const char *quality, char *error,
                                               size_t error_capacity) {
    @autoreleasepool {
        if (!path || width == 0 || height == 0) {
            set_error(error, error_capacity, "native recording: invalid recorder geometry");
            return nullptr;
        }
        // H.264 wants even dimensions.
        if ((width % 2) != 0 || (height % 2) != 0) {
            set_error(error, error_capacity,
                      "native recording: H.264 needs both dimensions even");
            return nullptr;
        }
        fps = std::clamp(fps, 1u, 240u);

        NSString *file = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:file];
        // AVAssetWriter refuses to overwrite.
        [[NSFileManager defaultManager] removeItemAtURL:url error:nil];

        NSError *nsError = nil;
        AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:url
                                                         fileType:AVFileTypeMPEG4
                                                            error:&nsError];
        if (!writer) {
            set_error(error, error_capacity,
                      std::string("native recording: AVAssetWriter failed: ") +
                          (nsError ? nsError.localizedDescription.UTF8String : "unknown"));
            return nullptr;
        }

        NSDictionary *compression = @{
            AVVideoAverageBitRateKey : @(bitrate_for(quality ? quality : "high", width, height, fps)),
            AVVideoExpectedSourceFrameRateKey : @(fps),
            AVVideoMaxKeyFrameIntervalKey : @(fps * 2),
            AVVideoProfileLevelKey : AVVideoProfileLevelH264HighAutoLevel,
        };
        NSDictionary *settings = @{
            AVVideoCodecKey : AVVideoCodecTypeH264,
            AVVideoWidthKey : @(width),
            AVVideoHeightKey : @(height),
            AVVideoCompressionPropertiesKey : compression,
        };
        AVAssetWriterInput *input =
            [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                               outputSettings:settings];
        // Live capture: frames arrive in order and must not be reordered.
        input.expectsMediaDataInRealTime = YES;

        NSDictionary *sourceAttributes = @{
            (NSString *)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
            (NSString *)kCVPixelBufferWidthKey : @(width),
            (NSString *)kCVPixelBufferHeightKey : @(height),
            (NSString *)kCVPixelBufferIOSurfacePropertiesKey : @{},
        };
        AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor
            assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                       sourcePixelBufferAttributes:sourceAttributes];

        if (![writer canAddInput:input]) {
            set_error(error, error_capacity, "native recording: writer rejected the H.264 input");
            return nullptr;
        }
        [writer addInput:input];
        if (![writer startWriting]) {
            set_error(error, error_capacity,
                      std::string("native recording: startWriting failed: ") +
                          (writer.error ? writer.error.localizedDescription.UTF8String : "unknown"));
            return nullptr;
        }
        [writer startSessionAtSourceTime:kCMTimeZero];

        auto *recorder = new GhostMacVideoRecorder();
        recorder->writer = writer;
        recorder->input = input;
        recorder->adaptor = adaptor;
        recorder->width = width;
        recorder->height = height;
        recorder->fps = fps;
        return recorder;
    }
}

int ghost_mac_recorder_append(GhostMacVideoRecorder *recorder, uint32_t iosurface_id,
                              char *error, size_t error_capacity) {
    @autoreleasepool {
        if (!recorder || recorder->finished) {
            set_error(error, error_capacity, "native recording: recorder is not running");
            return -1;
        }
        // Which output frame does *now* belong to? Renders landing inside a
        // slot already written are dropped, so the file stays in step with
        // real time however fast the core happens to run.
        const CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
        if (!recorder->has_started) {
            recorder->started = now;
            recorder->has_started = true;
        }
        const double elapsed = now - recorder->started;
        const int64_t index = static_cast<int64_t>(std::max(0.0, elapsed) * recorder->fps);
        if (index <= recorder->last_index) return 0;

        // The writer applies backpressure; dropping here is correct, because
        // the alternative is stalling the render thread.
        if (!recorder->input.readyForMoreMediaData) return 0;

        IOSurfaceRef surface = IOSurfaceLookup(iosurface_id);
        if (!surface) {
            set_error(error, error_capacity, "native recording: output IOSurface went away");
            return -1;
        }
        CVPixelBufferRef pixels = nullptr;
        const CVReturn created =
            CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nullptr, &pixels);
        CFRelease(surface);
        if (created != kCVReturnSuccess || !pixels) {
            set_error(error, error_capacity,
                      "native recording: could not wrap the composite IOSurface");
            return -1;
        }

        const CMTime pts = CMTimeMake(index, static_cast<int32_t>(recorder->fps));
        const BOOL ok = [recorder->adaptor appendPixelBuffer:pixels withPresentationTime:pts];
        CVPixelBufferRelease(pixels);
        if (!ok) {
            NSError *writerError = recorder->writer.error;
            set_error(error, error_capacity,
                      std::string("native recording: appendPixelBuffer failed: ") +
                          (writerError ? writerError.localizedDescription.UTF8String : "unknown"));
            return -1;
        }
        recorder->last_index = index;
        recorder->frames += 1;
        return 1;
    }
}

int ghost_mac_recorder_finish(GhostMacVideoRecorder *recorder, uint64_t *frames,
                              double *duration_seconds, char *error,
                              size_t error_capacity) {
    @autoreleasepool {
        if (!recorder) {
            set_error(error, error_capacity, "native recording: no recorder");
            return -1;
        }
        if (frames) *frames = recorder->frames;
        if (duration_seconds) *duration_seconds = ghost_mac_recorder_duration(recorder);
        if (recorder->finished) return 1;
        recorder->finished = true;

        [recorder->input markAsFinished];
        // finishWritingWithCompletionHandler is asynchronous, and the file has
        // no moov atom until it lands. The caller is stopping a recording, so
        // waiting here is right: returning early hands back an unplayable file.
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        [recorder->writer finishWritingWithCompletionHandler:^{
            dispatch_semaphore_signal(done);
        }];
        dispatch_semaphore_wait(done,
                                dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)));
        if (recorder->writer.status == AVAssetWriterStatusFailed) {
            NSError *writerError = recorder->writer.error;
            set_error(error, error_capacity,
                      std::string("native recording: finish failed: ") +
                          (writerError ? writerError.localizedDescription.UTF8String : "unknown"));
            return -1;
        }
        return 1;
    }
}

uint64_t ghost_mac_recorder_frames(const GhostMacVideoRecorder *recorder) {
    return recorder ? recorder->frames : 0;
}

double ghost_mac_recorder_duration(const GhostMacVideoRecorder *recorder) {
    if (!recorder || recorder->last_index < 0) return 0.0;
    // The last timestamp, not the frame count: a static scene renders rarely,
    // so three frames can span five seconds.
    return static_cast<double>(recorder->last_index + 1) / std::max(1u, recorder->fps);
}

void ghost_mac_recorder_free(GhostMacVideoRecorder *recorder) {
    if (!recorder) return;
    // A dropped recorder still owes the file its moov atom.
    if (!recorder->finished) {
        ghost_mac_recorder_finish(recorder, nullptr, nullptr, nullptr, 0);
    }
    recorder->writer = nil;
    recorder->input = nil;
    recorder->adaptor = nil;
    delete recorder;
}
