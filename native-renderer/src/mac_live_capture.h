#ifndef GHOST_MAC_LIVE_CAPTURE_H
#define GHOST_MAC_LIVE_CAPTURE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GhostLiveCapture GhostLiveCapture;

typedef struct {
    // An owned +1 CVPixelBufferRef (IOSurface backed, 32BGRA). The caller
    // releases it with ghost_live_capture_release_pixel_buffer once the GPU
    // has finished reading it.
    void *pixel_buffer;
    // The buffer's IOSurfaceRef, valid while pixel_buffer is retained.
    void *iosurface;
    uint32_t width;
    uint32_t height;
    uint32_t pixel_format;
    uint64_t frame;
    // Host-clock seconds (CMClockGetHostTimeClock): the sample's
    // presentation time and when the frame callback ran.
    double presentation_seconds;
    double arrived_seconds;
} GhostLiveCaptureFrame;

typedef struct {
    uint64_t frames;
    uint32_t width;
    uint32_t height;
    // 1 while the camera session runs or the screen stream has started.
    uint8_t running;
    // 1 once the stream or session reported a failure (see error).
    uint8_t failed;
} GhostLiveCaptureState;

// Starts a camera session (empty device_id = the default camera). Returns
// null and fills error when the camera cannot be opened. Camera permission
// that is not yet decided is requested; the session then starts once it is
// granted, or fails.
GhostLiveCapture *ghost_live_capture_start_camera(const char *device_id,
                                                char *error, size_t error_capacity);
// Starts a ScreenCaptureKit stream of a display or a window. source_id is
// the Chromium desktopCapturer id ("screen:<id>:0" / "window:<id>:0");
// kind is "screen" or "window". Starts asynchronously; failures show in
// the state's `failed` and ghost_live_capture_error.
GhostLiveCapture *ghost_live_capture_start_screen(const char *source_id,
                                                const char *display_id,
                                                const char *kind,
                                                char *error, size_t error_capacity);
// Stops the session and frees it. Frames already taken stay valid.
void ghost_live_capture_stop(GhostLiveCapture *capture);
// 1 and a frame when one newer than since_frame has arrived, else 0.
int ghost_live_capture_latest(GhostLiveCapture *capture, uint64_t since_frame,
                              GhostLiveCaptureFrame *frame);
void ghost_live_capture_state(GhostLiveCapture *capture, GhostLiveCaptureState *state);
// The session's last error, or an empty string.
void ghost_live_capture_error(GhostLiveCapture *capture, char *error, size_t error_capacity);
void ghost_live_capture_release_pixel_buffer(void *pixel_buffer);
// Cameras as a JSON array of {"id","name"}; free with ghost_live_capture_free_string.
char *ghost_live_capture_list_cameras_json(void);
void ghost_live_capture_free_string(char *value);
// Camera: 0 not determined, 1 restricted, 2 denied, 3 authorized.
int ghost_live_capture_camera_authorization(void);
// Screen Recording: 1 when this process may capture the screen.
int ghost_live_capture_screen_preflight(void);
double ghost_live_capture_host_seconds(void);

#ifdef __cplusplus
}
#endif
#endif
