#ifndef GHOST_MAC_VIDEO_DECODER_H
#define GHOST_MAC_VIDEO_DECODER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GhostMacVideoDecoder GhostMacVideoDecoder;

typedef struct {
    uint32_t width;
    uint32_t height;
    double fps;
    double duration_seconds;
    uint8_t hardware;
} GhostVideoMetadata;

typedef struct {
    // An owned +1 CVPixelBufferRef. The caller must eventually release it.
    void *pixel_buffer;
    uint32_t iosurface_id;
    uint32_t width;
    uint32_t height;
    uint32_t pixel_format;
    uint32_t color_matrix;
    uint8_t full_range;
    double pts_seconds;
    double duration_seconds;
} GhostGpuVideoFrame;

GhostMacVideoDecoder *ghost_mac_video_open(const char *path,
                                         GhostVideoMetadata *metadata,
                                         char *error, size_t error_capacity);
int ghost_mac_video_seek(GhostMacVideoDecoder *decoder, double start_seconds,
                         double end_seconds, char *error, size_t error_capacity);
int ghost_mac_video_step_frame(GhostMacVideoDecoder *decoder, double reference_seconds,
                               int direction, double range_start, double range_end,
                               GhostGpuVideoFrame *frame, char *error, size_t error_capacity);
int ghost_mac_video_set_queue_capacity(GhostMacVideoDecoder *decoder, size_t capacity,
                                      char *error, size_t error_capacity);
// Returns 1 for a frame, 0 for end of range, and -1 for an error.
int ghost_mac_video_next_frame(GhostMacVideoDecoder *decoder,
                               GhostGpuVideoFrame *frame,
                               char *error, size_t error_capacity);
void ghost_mac_video_close(GhostMacVideoDecoder *decoder);
void ghost_mac_video_release_pixel_buffer(void *pixel_buffer);

#ifdef __cplusplus
}
#endif
#endif
