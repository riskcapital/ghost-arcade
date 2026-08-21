// Linux SCM_RIGHTS fd-passing side channel — Milestone 1 of the Linux
// zero-copy native-renderer preview work.
//
// Node's `net` module can send/receive `net.Socket`/`net.Server` handles
// between Node processes over its own IPC channel, but it cannot receive
// arbitrary file descriptors (e.g. a dma-buf fd) via SCM_RIGHTS ancillary
// data on a plain Unix domain socket. This addon does the raw
// socket/bind/listen/accept/recvmsg calls needed to receive one.
//
// Usage from JS (see native-renderer-broker.js):
//   addon.listen(path)  -> boolean, call before spawning ghost-render-core
//   addon.poll()        -> { connected, received, fd, tag } | null
//   addon.close()       -> void
//
// `ghost-render-core` connects to `path` and sends a tagged fd via
// SCM_RIGHTS once its side is up (see spawn_linux_fd_channel_sender in
// native-renderer/src/main.rs). For this milestone the fd is just an
// anonymous memfd proving the transport works end to end; the real
// Vulkan dma-buf export (Milestone 2) will reuse this same channel.

#include <napi.h>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <cstdint>
#include <string>

namespace {

int g_listen_fd = -1;
int g_conn_fd = -1;
std::string g_socket_path;

void CloseChannel() {
  if (g_conn_fd >= 0) {
    close(g_conn_fd);
    g_conn_fd = -1;
  }
  if (g_listen_fd >= 0) {
    close(g_listen_fd);
    g_listen_fd = -1;
  }
  if (!g_socket_path.empty()) {
    unlink(g_socket_path.c_str());
    g_socket_path.clear();
  }
}

Napi::Value Listen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "listen(path) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();

  CloseChannel();

  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK, 0);
  if (fd < 0) return Napi::Boolean::New(env, false);

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  if (path.size() >= sizeof(addr.sun_path)) {
    close(fd);
    return Napi::Boolean::New(env, false);
  }
  strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);

  unlink(path.c_str());  // stale socket file from a prior run

  if (bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
    close(fd);
    return Napi::Boolean::New(env, false);
  }
  if (listen(fd, 1) != 0) {
    close(fd);
    unlink(path.c_str());
    return Napi::Boolean::New(env, false);
  }

  g_listen_fd = fd;
  g_socket_path = path;
  return Napi::Boolean::New(env, true);
}

// Non-blocking: accepts a pending connection if one hasn't been accepted
// yet, then tries to receive one SCM_RIGHTS fd + an 8-byte little-endian
// tag as the message payload. Returns null when there's nothing new.
Napi::Value Poll(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (g_conn_fd < 0 && g_listen_fd >= 0) {
    int accepted = accept4(g_listen_fd, nullptr, nullptr, SOCK_NONBLOCK);
    if (accepted >= 0) {
      g_conn_fd = accepted;
    }
  }

  if (g_conn_fd < 0) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("connected", Napi::Boolean::New(env, false));
    result.Set("received", Napi::Boolean::New(env, false));
    return result;
  }

  uint8_t tag_buf[8] = {0};
  struct iovec iov;
  iov.iov_base = tag_buf;
  iov.iov_len = sizeof(tag_buf);

  union {
    char buf[CMSG_SPACE(sizeof(int))];
    struct cmsghdr align;
  } cmsg_buf;
  memset(&cmsg_buf, 0, sizeof(cmsg_buf));

  struct msghdr msg;
  memset(&msg, 0, sizeof(msg));
  msg.msg_iov = &iov;
  msg.msg_iovlen = 1;
  msg.msg_control = cmsg_buf.buf;
  msg.msg_controllen = sizeof(cmsg_buf.buf);

  ssize_t n = recvmsg(g_conn_fd, &msg, MSG_DONTWAIT);
  if (n <= 0) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("connected", Napi::Boolean::New(env, true));
    result.Set("received", Napi::Boolean::New(env, false));
    return result;
  }

  int received_fd = -1;
  struct cmsghdr* cmsg = CMSG_FIRSTHDR(&msg);
  if (cmsg != nullptr && cmsg->cmsg_level == SOL_SOCKET && cmsg->cmsg_type == SCM_RIGHTS) {
    memcpy(&received_fd, CMSG_DATA(cmsg), sizeof(int));
  }

  uint64_t tag = 0;
  memcpy(&tag, tag_buf, sizeof(tag));

  Napi::Object result = Napi::Object::New(env);
  result.Set("connected", Napi::Boolean::New(env, true));
  result.Set("received", Napi::Boolean::New(env, received_fd >= 0));
  result.Set("fd", Napi::Number::New(env, received_fd));
  // JS numbers are safe integers up to 2^53; this tag is a once-per-second
  // counter, nowhere near that in any realistic session.
  result.Set("tag", Napi::Number::New(env, static_cast<double>(tag)));
  return result;
}

Napi::Value Close(const Napi::CallbackInfo& info) {
  CloseChannel();
  return info.Env().Undefined();
}

// The caller owns lifetime of any fd returned by poll() once received —
// call this once done with it (Milestone 1 just logs + closes; Milestone 3
// will import it into the preview addon instead).
Napi::Value CloseFd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() >= 1 && info[0].IsNumber()) {
    int fd = info[0].As<Napi::Number>().Int32Value();
    if (fd >= 0) close(fd);
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listen", Napi::Function::New(env, Listen));
  exports.Set("poll", Napi::Function::New(env, Poll));
  exports.Set("close", Napi::Function::New(env, Close));
  exports.Set("closeFd", Napi::Function::New(env, CloseFd));
  exports.Set("platform", Napi::String::New(env, "linux"));
  return exports;
}

}  // namespace

NODE_API_MODULE(linux_fd_channel_addon, Init)
