#include "mac_video_decoder.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CVPixelBufferIOSurface.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <VideoToolbox/VideoToolbox.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <pthread/qos.h>
#include <string>

namespace {
// Four asynchronous submissions at a time, with a separate hard bound on
// surfaces waiting for B-frame presentation order. Never block a VT callback.
constexpr size_t kDecodeBatch = 4;
constexpr size_t kMaxPendingFrames = 24;
constexpr size_t kDefaultPendingFrames = 8;

void write_error(char *out, size_t capacity, const std::string &message) {
    if (out && capacity) std::snprintf(out, capacity, "%s", message.c_str());
}

std::string describe(NSError *error, const char *fallback) {
    return error ? std::string(error.localizedDescription.UTF8String ?: fallback) : fallback;
}

std::string vt_error(const char *operation, OSStatus status) {
    return std::string(operation) + " (VideoToolbox status " + std::to_string(status) + ")";
}

bool finite_time(CMTime time) {
    return CMTIME_IS_NUMERIC(time) && std::isfinite(CMTimeGetSeconds(time));
}

uint32_t color_matrix(CFTypeRef value, uint32_t height) {
    if (value && CFEqual(value, kCVImageBufferYCbCrMatrix_ITU_R_601_4)) return 1;
    if (value && CFEqual(value, kCVImageBufferYCbCrMatrix_ITU_R_2020)) return 3;
    if (value && CFEqual(value, kCVImageBufferYCbCrMatrix_ITU_R_709_2)) return 2;
    return height <= 576 ? 1 : 2;
}

double number_value(CFTypeRef value, double fallback) {
    double result = fallback;
    if (value && CFGetTypeID(value) == CFNumberGetTypeID())
        CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberDoubleType, &result);
    return result;
}

unsigned source_bit_depth(CMFormatDescriptionRef format) {
    // The extension is optional on every OS. Use its dictionary key directly
    // so this static shim needs neither a macOS-12 symbol nor Clang's version
    // availability runtime when Rust performs the final executable link.
    const double bits = number_value(CMFormatDescriptionGetExtension(format,
        CFSTR("BitsPerComponent")), 0.0);
    if (bits > 0 && bits <= 32) return static_cast<unsigned>(bits);
    // Older systems do not always expose BitsPerComponent. HEVC's decoder
    // configuration record includes bit_depth_luma_minus8/chroma_minus8.
    CFTypeRef atoms_value = CMFormatDescriptionGetExtension(format,
        kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms);
    if (atoms_value && CFGetTypeID(atoms_value) == CFDictionaryGetTypeID()) {
        CFTypeRef hvcc = CFDictionaryGetValue(static_cast<CFDictionaryRef>(atoms_value), CFSTR("hvcC"));
        if (hvcc && CFGetTypeID(hvcc) == CFDataGetTypeID() &&
            CFDataGetLength(static_cast<CFDataRef>(hvcc)) >= 23) {
            const UInt8 *bytes = CFDataGetBytePtr(static_cast<CFDataRef>(hvcc));
            if (bytes[0] == 1) return 8 + std::max(bytes[17] & 7, bytes[18] & 7);
        }
    }
    return 0; // Unknown: offer the supported native formats without guessing.
}

std::string unsupported_format(CMFormatDescriptionRef format) {
    const FourCharCode codec = CMFormatDescriptionGetMediaSubType(format);
    CFTypeRef alpha = CMFormatDescriptionGetExtension(format,
        kCMFormatDescriptionExtension_ContainsAlphaChannel);
    if (codec == kCMVideoCodecType_HEVCWithAlpha || codec == kCMVideoCodecType_AppleProRes4444 ||
        codec == kCMVideoCodecType_AppleProRes4444XQ ||
        (alpha && CFEqual(alpha, kCFBooleanTrue)) ||
        CMFormatDescriptionGetExtension(format, kCMFormatDescriptionExtension_AlphaChannelMode)) {
        return "Video with an alpha channel requires the compatibility decoder to preserve transparency";
    }
    const CMVideoDimensions size = CMVideoFormatDescriptionGetDimensions(format);
    const CGRect clean = CMVideoFormatDescriptionGetCleanAperture(format, true);
    if (std::abs(clean.origin.x) > 1e-6 || std::abs(clean.origin.y) > 1e-6 ||
        std::abs(clean.size.width - size.width) > 1e-6 ||
        std::abs(clean.size.height - size.height) > 1e-6) {
        return "Video clean-aperture cropping requires the compatibility decoder to preserve geometry";
    }
    CFTypeRef aspect_value = CMFormatDescriptionGetExtension(format,
        kCMFormatDescriptionExtension_PixelAspectRatio);
    if (aspect_value) {
        if (CFGetTypeID(aspect_value) != CFDictionaryGetTypeID())
            return "Video has an invalid pixel aspect ratio";
        const auto aspect = static_cast<CFDictionaryRef>(aspect_value);
        const double horizontal = number_value(CFDictionaryGetValue(aspect,
            kCMFormatDescriptionKey_PixelAspectRatioHorizontalSpacing), 0.0);
        const double vertical = number_value(CFDictionaryGetValue(aspect,
            kCMFormatDescriptionKey_PixelAspectRatioVerticalSpacing), 0.0);
        if (!(horizontal > 0.0 && vertical > 0.0) || horizontal != vertical)
            return "Video with non-square pixels requires the compatibility decoder to preserve geometry";
    }
    if (source_bit_depth(format) > 10)
        return "Video above 10 bits per component requires the compatibility decoder to preserve precision";
    return {};
}

struct DecodedFrame {
    CVPixelBufferRef pixel = nullptr;
    CMTime pts = kCMTimeInvalid;
    GhostGpuVideoFrame info = {};
    ~DecodedFrame() { if (pixel) CVPixelBufferRelease(pixel); }
};

struct VideoWorkerPriority {
    pthread_t thread = nullptr;
    pthread_override_t override = nullptr;

    void follow_current_worker() {
        const pthread_t current = pthread_self();
        if (override && pthread_equal(thread, current)) return;
        if (override) pthread_override_qos_class_end_np(override);
        thread = current;
        // The renderer's next presentation depends on this worker. An override
        // raises effective QoS without permanently changing a caller's base
        // priority, and can safely end on a different thread after a Rust move.
        override = pthread_override_qos_class_start_np(current, QOS_CLASS_USER_INITIATED, 0);
    }

    ~VideoWorkerPriority() {
        if (override) pthread_override_qos_class_end_np(override);
    }
};
} // namespace

struct GhostMacVideoDecoder {
    VideoWorkerPriority worker_priority;
    __strong id<NSObject> playback_activity = nil;
    __strong AVURLAsset *asset = nil;
    __strong AVAssetTrack *track = nil;
    __strong AVAssetReader *reader = nil;
    __strong AVAssetReaderTrackOutput *output = nil;
    // This metadata-only cursor defines the exact next presentation timestamp.
    // AVAssetReader still does all compressed sample demultiplexing in decode
    // order. The cursor avoids guessing a codec-specific B-frame reorder depth.
    __strong AVSampleCursor *presentation = nil;
    VTDecompressionSessionRef session = nullptr;
    GhostVideoMetadata metadata = {};
    std::mutex callback_mutex;
    std::deque<std::unique_ptr<DecodedFrame>> pending;
    std::string failure;
    CMTime first_pts = kCMTimeZero;
    CMTimeRange source_timeline = kCMTimeRangeInvalid;
    CMTimeRange target_timeline = kCMTimeRangeInvalid;
    double end_seconds = std::numeric_limits<double>::infinity();
    uint32_t default_matrix = 2;
    size_t queue_capacity = kDefaultPendingFrames;
    bool reader_ended = false;
    bool range_ended = false;
    bool require_p010 = false;

    CMTime cursor_time(AVSampleCursor *cursor) const {
        // AVSampleCursor reports media time while AVAssetReader's output PTS
        // includes the container edit list (notably MP4's B-frame offset).
        return CMTimeMapTimeFromRangeToRange(cursor.presentationTimeStamp,
                                             source_timeline, target_timeline);
    }

    CMTime presentation_time() const { return cursor_time(presentation); }

    AVSampleCursor *cursor_at(double seconds) const {
        const CMTime source_start = CMTimeMapTimeFromRangeToRange(
            CMTimeMakeWithSeconds(seconds, 1000000000), target_timeline, source_timeline);
        AVSampleCursor *cursor = [track makeSampleCursorWithPresentationTimeStamp:source_start];
        // The seconds API can round a rational boundary slightly downward on
        // conversion to nanoseconds. Snap only this conversion uncertainty,
        // preserving the containing picture for genuine between-frame cuts.
        AVSampleCursor *next_cursor = [cursor copy];
        if ([next_cursor stepInPresentationOrderByCount:1] == 1 &&
            std::abs(CMTimeGetSeconds(cursor_time(next_cursor)) - seconds) <= 0.000000001)
            cursor = next_cursor;
        return cursor;
    }

    ~GhostMacVideoDecoder() {
        [reader cancelReading];
        if (session) {
            // All callbacks complete before their context and queued buffers
            // are destroyed. Frames handed to Rust have independent retains.
            VTDecompressionSessionWaitForAsynchronousFrames(session);
            VTDecompressionSessionInvalidate(session);
            CFRelease(session);
        }
        if (playback_activity) {
            [[NSProcessInfo processInfo] endActivity:playback_activity];
            playback_activity = nil;
        }
    }

    bool wait_for_decode() {
        const OSStatus status = VTDecompressionSessionWaitForAsynchronousFrames(session);
        std::lock_guard<std::mutex> lock(callback_mutex);
        if (status != noErr && failure.empty()) failure = vt_error("Hardware decode failed", status);
        return failure.empty();
    }

    static void decoded(void *context, void *, OSStatus status, VTDecodeInfoFlags flags,
                        CVImageBufferRef image, CMTime pts, CMTime duration) {
        auto *self = static_cast<GhostMacVideoDecoder *>(context);
        std::lock_guard<std::mutex> lock(self->callback_mutex);
        if (!self->failure.empty()) return;
        if (status != noErr) {
            self->failure = vt_error("Hardware decode callback failed", status);
            return;
        }
        if (!image || (flags & kVTDecodeInfo_FrameDropped)) {
            self->failure = "Hardware decoder dropped a required video frame";
            return;
        }
        if (!finite_time(pts)) {
            self->failure = "Hardware decoder returned a frame without a presentation timestamp";
            return;
        }
        // Pre-roll is needed for codec references but must never be presented.
        if (CMTimeCompare(pts, self->first_pts) < 0 ||
            CMTimeGetSeconds(pts) >= self->end_seconds) return;

        CVPixelBufferRef pixel = static_cast<CVPixelBufferRef>(image);
        const OSType format = CVPixelBufferGetPixelFormatType(pixel);
        if (format != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange &&
            format != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange &&
            format != kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange &&
            format != kCVPixelFormatType_420YpCbCr10BiPlanarFullRange) {
            self->failure = "Hardware decoder did not produce an NV12 or P010 surface";
            return;
        }
        if (self->require_p010 && format != kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange &&
            format != kCVPixelFormatType_420YpCbCr10BiPlanarFullRange) {
            self->failure = "Hardware decoder did not preserve the video's 10-bit pixel precision";
            return;
        }
        IOSurfaceRef surface = CVPixelBufferGetIOSurface(pixel);
        if (!surface || CVPixelBufferGetPlaneCount(pixel) != 2) {
            self->failure = "Hardware decoder did not produce a two-plane IOSurface";
            return;
        }
        if (self->pending.size() >= self->queue_capacity) {
            self->failure = "Video presentation reorder window exceeds the bounded hardware queue";
            return;
        }

        auto frame = std::make_unique<DecodedFrame>();
        frame->pixel = CVPixelBufferRetain(pixel);
        frame->pts = pts;
        frame->info.pixel_buffer = pixel;
        frame->info.iosurface_id = IOSurfaceGetID(surface);
        frame->info.width = static_cast<uint32_t>(CVPixelBufferGetWidth(pixel));
        frame->info.height = static_cast<uint32_t>(CVPixelBufferGetHeight(pixel));
        frame->info.pixel_format = format;
        CFTypeRef matrix = CVBufferGetAttachment(pixel, kCVImageBufferYCbCrMatrixKey, nullptr);
        frame->info.color_matrix = matrix ? color_matrix(matrix, frame->info.height) : self->default_matrix;
        frame->info.full_range = format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ||
                                 format == kCVPixelFormatType_420YpCbCr10BiPlanarFullRange;
        frame->info.pts_seconds = CMTimeGetSeconds(pts);
        frame->info.duration_seconds = finite_time(duration) && CMTimeGetSeconds(duration) > 0.0
            ? CMTimeGetSeconds(duration) : 1.0 / self->metadata.fps;
        self->pending.push_back(std::move(frame));
    }

    bool initialize(const char *path) {
        worker_priority.follow_current_worker();
        // Active decoder sessions serve live preview/output even while another
        // app has focus. Apple's user-initiated activity prevents App Nap;
        // allowing idle system sleep avoids a global sleep/display assertion.
        // The token is ended on every close, including failed initialization.
        playback_activity = [[NSProcessInfo processInfo]
            beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep
            reason:@"Ghost Arcade native video playback"];
        NSString *filename = [[NSFileManager defaultManager]
            stringWithFileSystemRepresentation:path length:std::strlen(path)];
        if (!filename) { failure = "Video path is not a valid macOS file path"; return false; }
        asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:filename]
            options:@{ AVURLAssetPreferPreciseDurationAndTimingKey: @YES }];
        track = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
        if (!track) { failure = "The asset has no readable video track"; return false; }
        if ([track hasMediaCharacteristic:AVMediaCharacteristicContainsAlphaChannel]) {
            failure = "Video with an alpha channel requires the compatibility decoder to preserve transparency";
            return false;
        }
        if (!track.canProvideSampleCursors) {
            failure = "The asset cannot provide precise video presentation ordering";
            return false;
        }
        size_t media_segments = 0;
        for (AVAssetTrackSegment *segment in track.segments) {
            if (segment.empty) continue;
            ++media_segments;
            source_timeline = segment.timeMapping.source;
            target_timeline = segment.timeMapping.target;
        }
        if (media_segments != 1 || !CMTIMERANGE_IS_VALID(source_timeline) ||
            !CMTIMERANGE_IS_VALID(target_timeline) ||
            CMTimeCompare(source_timeline.duration, kCMTimeZero) <= 0 ||
            CMTimeCompare(target_timeline.duration, kCMTimeZero) <= 0) {
            failure = "Complex video edit lists currently require the compatibility decoder";
            return false;
        }
        // The GPU frame contract currently describes the coded planes, without
        // orientation. Reject transformed tracks so the visible fallback can
        // honor their display transform instead of silently showing them wrong.
        const CGAffineTransform transform = track.preferredTransform;
        if (transform.a != 1.0 || transform.b != 0.0 || transform.c != 0.0 ||
            transform.d != 1.0 || transform.tx != 0.0 || transform.ty != 0.0) {
            failure = "Video display transforms currently require the compatibility decoder";
            return false;
        }
        AVSampleCursor *first = [track makeSampleCursorAtFirstSampleInDecodeOrder];
        if (!first) { failure = "The video track contains no samples"; return false; }
        CMFormatDescriptionRef format = [first copyCurrentSampleFormatDescription];
        if (!format) { failure = "The video track has no codec format description"; return false; }
        failure = unsupported_format(format);
        if (!failure.empty()) { CFRelease(format); return false; }
        require_p010 = source_bit_depth(format) > 8;
        const CMVideoDimensions dimensions = CMVideoFormatDescriptionGetDimensions(format);
        metadata.width = static_cast<uint32_t>(std::max(0, dimensions.width));
        metadata.height = static_cast<uint32_t>(std::max(0, dimensions.height));
        metadata.fps = track.nominalFrameRate;
        if (!(std::isfinite(metadata.fps) && metadata.fps > 0.0)) {
            const double minimum_duration = CMTimeGetSeconds(track.minFrameDuration);
            metadata.fps = std::isfinite(minimum_duration) && minimum_duration > 0.0
                ? 1.0 / minimum_duration : 30.0;
        }
        // The asset duration may include a longer audio tail. A video loop must
        // advance at the playable video end, matching seek's own trim boundary.
        metadata.duration_seconds = std::min(CMTimeGetSeconds(asset.duration),
            CMTimeGetSeconds(CMTimeRangeGetEnd(target_timeline)));
        if (!metadata.width || !metadata.height || !std::isfinite(metadata.duration_seconds) ||
            metadata.duration_seconds <= 0.0) {
            failure = "The video track has invalid dimensions or duration";
            CFRelease(format);
            return false;
        }
        default_matrix = color_matrix(CMFormatDescriptionGetExtension(format,
            kCMFormatDescriptionExtension_YCbCrMatrix), metadata.height);
        CFTypeRef source_range = CMFormatDescriptionGetExtension(format,
            kCMFormatDescriptionExtension_FullRangeVideo);
        const bool full_range = source_range && CFEqual(source_range, kCFBooleanTrue);
        const OSType nv12 = full_range ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
                                      : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
        const OSType p010 = full_range ? kCVPixelFormatType_420YpCbCr10BiPlanarFullRange
                                      : kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange;
        NSDictionary *decoder_specification = @{
            (__bridge NSString *)kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder: @YES,
        };
        NSDictionary *pixel_attributes = @{
            (__bridge NSString *)kCVPixelBufferPixelFormatTypeKey: require_p010 ? @[@(p010)] : @[@(nv12), @(p010)],
            (__bridge NSString *)kCVPixelBufferIOSurfacePropertiesKey: @{},
            (__bridge NSString *)kCVPixelBufferMetalCompatibilityKey: @YES,
        };
        VTDecompressionOutputCallbackRecord callback = { decoded, this };
        const OSStatus status = VTDecompressionSessionCreate(kCFAllocatorDefault, format,
            (__bridge CFDictionaryRef)decoder_specification, (__bridge CFDictionaryRef)pixel_attributes,
            &callback, &session);
        CFRelease(format);
        if (status != noErr || !session) {
            failure = vt_error("A hardware video decoder is unavailable for this clip", status);
            return false;
        }
        CFTypeRef using_hardware = nullptr;
        const OSStatus property_status = VTSessionCopyProperty(session,
            kVTDecompressionPropertyKey_UsingHardwareAcceleratedVideoDecoder,
            kCFAllocatorDefault, &using_hardware);
        metadata.hardware = property_status == noErr && using_hardware &&
                            CFEqual(using_hardware, kCFBooleanTrue);
        if (using_hardware) CFRelease(using_hardware);
        if (!metadata.hardware) {
            failure = "VideoToolbox could not verify hardware-accelerated decoding";
            return false;
        }
        return seek(0.0, std::numeric_limits<double>::infinity());
    }

    bool seek(double start, double end, AVSampleCursor *selected = nil) {
        worker_priority.follow_current_worker();
        if (!std::isfinite(start) || start < 0.0 || std::isnan(end) || end <= start) {
            failure = "Video seek requires a finite nonnegative start and an end after the start";
            return false;
        }
        // No previous callback may observe the new trim bounds or add an old
        // frame after the queue is cleared. Keep the hardware session itself.
        VTDecompressionSessionWaitForAsynchronousFrames(session);
        [reader cancelReading];
        reader = nil;
        output = nil;
        pending.clear();
        failure.clear();
        reader_ended = false;
        range_ended = false;
        end_seconds = std::min({end, metadata.duration_seconds,
                               CMTimeGetSeconds(CMTimeRangeGetEnd(target_timeline))});
        if (start >= end_seconds) { range_ended = true; return true; }
        presentation = selected ? [selected copy] : cursor_at(start);
        if (!presentation) { failure = "Cannot locate the requested video frame"; return false; }
        // A precise asset cursor starts at the frame containing the requested
        // time (or the first later frame if the track starts after that time).
        first_pts = presentation_time();
        if (!finite_time(first_pts)) { failure = "Video frame has invalid timing"; return false; }
        AVSampleCursor *decode_start = [presentation copy];
        const NSInteger refresh = decode_start.samplesRequiredForDecoderRefresh;
        if (refresh > 0) [decode_start stepInDecodeOrderByCount:-refresh];
        // An open-GOP leading B-frame may follow the next sync sample in
        // decode order while preceding it in presentation order. Starting an
        // AVAssetReader time range at that later sync PTS would omit the
        // requested picture (and its previous-GOP references) entirely.
        while (!decode_start.currentSampleSyncInfo.sampleIsFullSync ||
               CMTimeCompare(cursor_time(decode_start), first_pts) > 0) {
            if ([decode_start stepInDecodeOrderByCount:-1] == 0) break;
        }
        CMTime keyframe_start = cursor_time(decode_start);
        if (!finite_time(keyframe_start)) { failure = "Video keyframe has invalid timing"; return false; }
        if (CMTimeCompare(keyframe_start, kCMTimeZero) < 0) keyframe_start = kCMTimeZero;

        NSError *reader_error = nil;
        reader = [[AVAssetReader alloc] initWithAsset:asset error:&reader_error];
        if (!reader) { failure = describe(reader_error, "Cannot open compressed video reader"); return false; }
        output = [[AVAssetReaderTrackOutput alloc] initWithTrack:track outputSettings:nil];
        output.alwaysCopiesSampleData = NO;
        if (![reader canAddOutput:output]) {
            failure = "Cannot read compressed video samples from this asset";
            return false;
        }
        [reader addOutput:output];
        // Read past the requested end as necessary: a reference frame with a
        // later PTS may be needed to decode the final B-frame before the cut.
        reader.timeRange = CMTimeRangeMake(keyframe_start, kCMTimePositiveInfinity);
        if (![reader startReading]) { failure = describe(reader.error, "Cannot start compressed video reading"); return false; }
        return true;
    }

    int step(double reference, int direction, double start, double end, GhostGpuVideoFrame *result) {
        if (!std::isfinite(reference) || !std::isfinite(start) || start < 0.0 ||
            std::isnan(end) || end < start || (direction != -1 && direction != 1)) {
            failure = "Video frame step requires finite timing, a valid trim, and direction -1 or 1";
            return -1;
        }
        end = std::min(end, metadata.duration_seconds);
        if (start >= end) return 0;
        AVSampleCursor *first = cursor_at(start);
        AVSampleCursor *last = cursor_at(end);
        if (!first || !last) { failure = "Cannot locate video trim frames"; return -1; }
        // The trim end is exclusive, including when it falls exactly on a
        // rational presentation boundary represented by a double.
        if (CMTimeGetSeconds(cursor_time(last)) >= end - 0.000000001 &&
            [last stepInPresentationOrderByCount:-1] == 0) return 0;
        if (CMTimeCompare(cursor_time(first), cursor_time(last)) > 0) return 0;
        AVSampleCursor *selected = cursor_at(std::max(start, std::min(reference, end)));
        if (!selected) { failure = "Cannot locate the current video frame"; return -1; }
        if (CMTimeCompare(cursor_time(selected), cursor_time(first)) < 0) selected = [first copy];
        if (CMTimeCompare(cursor_time(selected), cursor_time(last)) > 0) selected = [last copy];
        AVSampleCursor *neighbor = [selected copy];
        if ([neighbor stepInPresentationOrderByCount:direction] == direction &&
            CMTimeCompare(cursor_time(neighbor), cursor_time(first)) >= 0 &&
            CMTimeCompare(cursor_time(neighbor), cursor_time(last)) <= 0)
            selected = neighbor;
        // Pass the cursor itself so no seconds round-trip can choose a
        // different picture. next() advances presentation after the result.
        if (!seek(std::max(start, CMTimeGetSeconds(cursor_time(selected))), end, selected)) return -1;
        return next(result);
    }

    bool decode_batch() {
        if (pending.size() >= queue_capacity) {
            failure = "Video presentation reorder window exceeds the bounded hardware queue";
            return false;
        }
        // Each submitted sample contains one frame; reserve its potential
        // callback slot before submitting. Pending + in-flight <= capacity.
        const size_t batch_size = std::min(kDecodeBatch, queue_capacity - pending.size());
        for (size_t submitted = 0; submitted < batch_size && !reader_ended; ) {
            CMSampleBufferRef sample = [output copyNextSampleBuffer];
            if (!sample) {
                reader_ended = true;
                if (reader.status == AVAssetReaderStatusFailed) {
                    std::lock_guard<std::mutex> lock(callback_mutex);
                    failure = describe(reader.error, "Compressed video reading failed");
                }
                break;
            }
            if (CMSampleBufferGetNumSamples(sample) == 0) { CFRelease(sample); continue; }
            if (CMSampleBufferGetNumSamples(sample) != 1) {
                CFRelease(sample);
                std::lock_guard<std::mutex> lock(callback_mutex);
                failure = "Compressed video sample contains more than one frame";
                break;
            }
            CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
            if (!format || !VTDecompressionSessionCanAcceptFormatDescription(session, format)) {
                CFRelease(sample);
                std::lock_guard<std::mutex> lock(callback_mutex);
                failure = "Video codec changes require the compatibility decoder";
                break;
            }
            std::string format_failure = unsupported_format(format);
            const CMVideoDimensions frame_size = CMVideoFormatDescriptionGetDimensions(format);
            if (format_failure.empty() &&
                (frame_size.width != static_cast<int32_t>(metadata.width) ||
                 frame_size.height != static_cast<int32_t>(metadata.height)))
                format_failure = "Video resolution changes require the compatibility decoder and a new frame budget";
            if (format_failure.empty() && !require_p010 && source_bit_depth(format) > 8)
                format_failure = "Video bit-depth changes require the compatibility decoder to preserve precision";
            if (!format_failure.empty()) {
                CFRelease(sample);
                std::lock_guard<std::mutex> lock(callback_mutex);
                failure = std::move(format_failure);
                break;
            }
            const OSStatus status = VTDecompressionSessionDecodeFrame(session, sample,
                kVTDecodeFrame_EnableAsynchronousDecompression | kVTDecodeFrame_EnableTemporalProcessing,
                nullptr, nullptr);
            CFRelease(sample);
            ++submitted;
            if (status != noErr) {
                std::lock_guard<std::mutex> lock(callback_mutex);
                failure = vt_error("Cannot submit a compressed hardware video frame", status);
                break;
            }
        }
        // This also releases delayed temporal-processing callbacks. Only the
        // media worker waits here. The callback queue never waits for a reader.
        return wait_for_decode();
    }

    int next(GhostGpuVideoFrame *result) {
        worker_priority.follow_current_worker();
        if (!failure.empty()) return -1;
        if (range_ended) return 0;
        for (;;) {
            const CMTime expected = presentation_time();
            if (!finite_time(expected)) { failure = "Video presentation cursor has invalid timing"; return -1; }
            if (CMTimeGetSeconds(expected) >= end_seconds) {
                range_ended = true;
                [reader cancelReading];
                pending.clear();
                return 0;
            }
            // There are no callbacks in flight between batches, so this lookup
            // and transfer need no lock. Compare rational timestamps directly.
            const auto found = std::find_if(pending.begin(), pending.end(), [&](const auto &frame) {
                return CMTimeCompare(frame->pts, expected) == 0;
            });
            if (found != pending.end()) {
                *result = (*found)->info;
                (*found)->pixel = nullptr; // Transfer the +1 retain to Rust.
                pending.erase(found);
                if ([presentation stepInPresentationOrderByCount:1] == 0) {
                    range_ended = true;
                    [reader cancelReading];
                    pending.clear();
                }
                return 1;
            }
            if (reader_ended) {
                failure = "Hardware decoder did not return the expected presentation frame";
                return -1;
            }
            if (!decode_batch()) return -1;
        }
    }
};

extern "C" GhostMacVideoDecoder *ghost_mac_video_open(const char *path,
    GhostVideoMetadata *metadata, char *error, size_t error_capacity) {
    @autoreleasepool {
        @try {
            auto decoder = std::make_unique<GhostMacVideoDecoder>();
            if (!decoder->initialize(path)) {
                write_error(error, error_capacity, decoder->failure);
                return nullptr;
            }
            *metadata = decoder->metadata;
            return decoder.release();
        } @catch (NSException *exception) {
            write_error(error, error_capacity, exception.reason.UTF8String ?: "Cannot open hardware video decoder");
            return nullptr;
        }
    }
}

extern "C" int ghost_mac_video_seek(GhostMacVideoDecoder *decoder, double start,
    double end, char *error, size_t error_capacity) {
    @autoreleasepool {
        @try {
            if (decoder->seek(start, end)) return 0;
            write_error(error, error_capacity, decoder->failure);
        } @catch (NSException *exception) {
            decoder->wait_for_decode();
            decoder->failure = exception.reason.UTF8String ?: "Cannot seek hardware video decoder";
            write_error(error, error_capacity, exception.reason.UTF8String ?: "Cannot seek hardware video decoder");
        }
        return -1;
    }
}

extern "C" int ghost_mac_video_set_queue_capacity(GhostMacVideoDecoder *decoder,
    size_t capacity, char *error, size_t error_capacity) {
    if (capacity == 0 || capacity > kMaxPendingFrames || capacity < decoder->pending.size()) {
        write_error(error, error_capacity, "Hardware queue capacity must be 1 to 24 and fit existing frames");
        return -1;
    }
    // Public operations are serialized by Rust's exclusive decoder borrow;
    // next_frame always drains its asynchronous submissions before returning.
    decoder->queue_capacity = capacity;
    return 0;
}

extern "C" int ghost_mac_video_step_frame(GhostMacVideoDecoder *decoder, double reference,
    int direction, double start, double end, GhostGpuVideoFrame *frame,
    char *error, size_t error_capacity) {
    @autoreleasepool {
        @try {
            const int status = decoder->step(reference, direction, start, end, frame);
            if (status < 0) write_error(error, error_capacity, decoder->failure);
            return status;
        } @catch (NSException *exception) {
            decoder->wait_for_decode();
            decoder->failure = exception.reason.UTF8String ?: "Cannot step hardware video frame";
            write_error(error, error_capacity, decoder->failure);
            return -1;
        }
    }
}

extern "C" int ghost_mac_video_next_frame(GhostMacVideoDecoder *decoder,
    GhostGpuVideoFrame *frame, char *error, size_t error_capacity) {
    @autoreleasepool {
        @try {
            const int status = decoder->next(frame);
            if (status < 0) write_error(error, error_capacity, decoder->failure);
            return status;
        } @catch (NSException *exception) {
            decoder->wait_for_decode();
            decoder->failure = exception.reason.UTF8String ?: "Cannot decode hardware video frame";
            write_error(error, error_capacity, exception.reason.UTF8String ?: "Cannot decode hardware video frame");
            return -1;
        }
    }
}

extern "C" void ghost_mac_video_close(GhostMacVideoDecoder *decoder) {
    @autoreleasepool { delete decoder; }
}

extern "C" void ghost_mac_video_release_pixel_buffer(void *pixel_buffer) {
    if (pixel_buffer) CVPixelBufferRelease(static_cast<CVPixelBufferRef>(pixel_buffer));
}
