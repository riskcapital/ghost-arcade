// Native MIDI for the main process: device inputs and outputs, hot-plug, and
// (macOS) a "Ghost Arcade" virtual source + destination other apps can use.
//
// macOS: CoreMIDI. Windows: WinMM (no virtual ports: those need a driver).
//
// JS API (all calls on the main JS thread):
//   start(onEvent, { virtualName }) -> { ok, virtual, error? }
//     onEvent('messages', [{ p: portId, d: Uint8Array, t: ms }])  t on nowMs()'s clock
//     onEvent('ports')                                             the port list changed
//   ports()        -> { inputs: [{ id, name, manufacturer, virtual }], outputs: [...] }
//   send(id, data) -> boolean
//   nowMs()        -> monotonic milliseconds (the clock message times use)
//   stop()

#include <napi.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct Message {
  std::string port;
  std::vector<uint8_t> data;
  double t;
};

constexpr size_t kMaxSysex = 1 << 20;

// Splits a raw byte stream into whole MIDI messages: running status expanded,
// real-time bytes passed through even inside SysEx, SysEx gathered until F7.
class MidiParser {
 public:
  template <typename Emit>
  void Feed(const uint8_t* bytes, size_t n, Emit&& emit) {
    for (size_t i = 0; i < n; i++) {
      const uint8_t b = bytes[i];
      if (b >= 0xF8) {
        const uint8_t rt[1] = {b};
        emit(rt, 1);
        continue;
      }
      if (b == 0xF0) {
        sysex_.assign(1, b);
        in_sysex_ = true;
        running_ = 0;
        cur_.clear();
        need_ = 0;
        continue;
      }
      if (b == 0xF7) {
        if (in_sysex_) {
          sysex_.push_back(b);
          emit(sysex_.data(), sysex_.size());
          sysex_.clear();
          in_sysex_ = false;
        }
        continue;
      }
      if (b & 0x80) {
        // Any other status ends an unterminated SysEx (it is dropped).
        in_sysex_ = false;
        sysex_.clear();
        cur_.assign(1, b);
        if (b >= 0xF0) {
          running_ = 0;
          need_ = SystemCommonDataLength(b);
        } else {
          running_ = b;
          need_ = ChannelDataLength(b);
        }
        if (need_ == 0) {
          emit(cur_.data(), cur_.size());
          cur_.clear();
        }
        continue;
      }
      // Data byte.
      if (in_sysex_) {
        if (sysex_.size() < kMaxSysex) sysex_.push_back(b);
        continue;
      }
      if (cur_.empty()) {
        if (!running_) continue;  // Stray data byte.
        cur_.assign(1, running_);
        need_ = ChannelDataLength(running_);
      }
      cur_.push_back(b);
      if (--need_ <= 0) {
        emit(cur_.data(), cur_.size());
        cur_.clear();
        need_ = 0;
      }
    }
  }

  static int ChannelDataLength(uint8_t status) {
    const uint8_t kind = status & 0xF0;
    return (kind == 0xC0 || kind == 0xD0) ? 1 : 2;
  }
  static int SystemCommonDataLength(uint8_t status) {
    switch (status) {
      case 0xF1: case 0xF3: return 1;
      case 0xF2: return 2;
      default: return 0;  // F4, F5, F6
    }
  }

 private:
  std::vector<uint8_t> sysex_;
  bool in_sysex_ = false;
  uint8_t running_ = 0;
  std::vector<uint8_t> cur_;
  int need_ = 0;
};

struct PortInfo {
  std::string id;
  std::string name;
  std::string manufacturer;
  bool is_virtual = false;
};

// ---- Delivery to JS ---------------------------------------------------------

std::mutex g_queue_mutex;
std::vector<Message> g_queue;
bool g_ports_dirty = false;
Napi::ThreadSafeFunction g_tsfn;
std::atomic<bool> g_running{false};

void DeliverOnJsThread(Napi::Env env, Napi::Function callback) {
  std::vector<Message> batch;
  bool ports = false;
  {
    std::lock_guard<std::mutex> lock(g_queue_mutex);
    batch.swap(g_queue);
    ports = g_ports_dirty;
    g_ports_dirty = false;
  }
  if (ports) callback.Call({Napi::String::New(env, "ports")});
  if (!batch.empty()) {
    Napi::Array arr = Napi::Array::New(env, batch.size());
    for (size_t i = 0; i < batch.size(); i++) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("p", Napi::String::New(env, batch[i].port));
      o.Set("d", Napi::Buffer<uint8_t>::Copy(env, batch[i].data.data(), batch[i].data.size()));
      o.Set("t", Napi::Number::New(env, batch[i].t));
      arr.Set(static_cast<uint32_t>(i), o);
    }
    callback.Call({Napi::String::New(env, "messages"), arr});
  }
}

// Wakes the JS thread once per burst: a call is queued only when the queue
// goes from empty to non-empty.
void Wake(bool was_empty) {
  if (!was_empty || !g_running.load()) return;
  g_tsfn.NonBlockingCall([](Napi::Env env, Napi::Function cb) { DeliverOnJsThread(env, cb); });
}

void Push(const std::string& port, const uint8_t* data, size_t n, double t) {
  bool was_empty;
  {
    std::lock_guard<std::mutex> lock(g_queue_mutex);
    was_empty = g_queue.empty() && !g_ports_dirty;
    g_queue.push_back(Message{port, std::vector<uint8_t>(data, data + n), t});
  }
  Wake(was_empty);
}

void MarkPortsChanged() {
  bool was_empty;
  {
    std::lock_guard<std::mutex> lock(g_queue_mutex);
    was_empty = g_queue.empty() && !g_ports_dirty;
    g_ports_dirty = true;
  }
  Wake(was_empty);
}

}  // namespace

// ============================================================================
#if defined(__APPLE__)
// ============================================================================
#include <CoreFoundation/CoreFoundation.h>
#include <CoreMIDI/CoreMIDI.h>
#include <mach/mach_time.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace {

// Fixed ids for the virtual endpoints, so a DAW remembers its routing to them
// across launches. CoreMIDI falls back to a random id if one is taken.
constexpr SInt32 kVirtualSourceUniqueId = 0x47417631;       // 'GAv1'
constexpr SInt32 kVirtualDestinationUniqueId = 0x47417632;  // 'GAv2'

mach_timebase_info_data_t g_timebase{0, 0};
MIDIClientRef g_client = 0;
MIDIPortRef g_in_port = 0;
MIDIPortRef g_out_port = 0;
MIDIEndpointRef g_virtual_source = 0;
MIDIEndpointRef g_virtual_destination = 0;
std::string g_virtual_name = "Ghost Arcade";

struct InputContext {
  std::string id;
  MidiParser parser;
  MIDIEndpointRef endpoint = 0;
  bool connected = false;
};
// Contexts live as long as the addon: CoreMIDI may still call the read proc
// for a source while it is being disconnected.
std::mutex g_inputs_mutex;
std::map<std::string, std::unique_ptr<InputContext>> g_inputs;

double HostTimeToMs(uint64_t host) {
  if (g_timebase.denom == 0) mach_timebase_info(&g_timebase);
  return static_cast<double>(host) * g_timebase.numer / g_timebase.denom / 1e6;
}
double NowMs() { return HostTimeToMs(mach_absolute_time()); }

std::string CfString(MIDIObjectRef obj, CFStringRef prop) {
  CFStringRef value = nullptr;
  if (MIDIObjectGetStringProperty(obj, prop, &value) != noErr || !value) return "";
  char buf[512];
  std::string out;
  if (CFStringGetCString(value, buf, sizeof(buf), kCFStringEncodingUTF8)) out = buf;
  CFRelease(value);
  return out;
}

SInt32 UniqueId(MIDIObjectRef obj) {
  SInt32 id = 0;
  MIDIObjectGetIntegerProperty(obj, kMIDIPropertyUniqueID, &id);
  return id;
}

PortInfo EndpointInfo(MIDIEndpointRef ep, const char* prefix) {
  PortInfo info;
  info.id = std::string(prefix) + std::to_string(UniqueId(ep));
  info.name = CfString(ep, kMIDIPropertyDisplayName);
  if (info.name.empty()) info.name = CfString(ep, kMIDIPropertyName);
  info.manufacturer = CfString(ep, kMIDIPropertyManufacturer);
  return info;
}

void ReadPackets(const MIDIPacketList* list, InputContext* ctx) {
  if (!ctx || !g_running.load()) return;
  const MIDIPacket* packet = &list->packet[0];
  for (UInt32 i = 0; i < list->numPackets; i++) {
    // A sender may leave the time at 0 ("now").
    const double t = packet->timeStamp ? HostTimeToMs(packet->timeStamp) : NowMs();
    ctx->parser.Feed(packet->data, packet->length, [&](const uint8_t* d, size_t n) { Push(ctx->id, d, n, t); });
    packet = MIDIPacketNext(packet);
  }
}

void InputReadProc(const MIDIPacketList* list, void* /*readProcRefCon*/, void* srcConnRefCon) {
  ReadPackets(list, static_cast<InputContext*>(srcConnRefCon));
}

void VirtualReadProc(const MIDIPacketList* list, void* readProcRefCon, void* /*srcConnRefCon*/) {
  ReadPackets(list, static_cast<InputContext*>(readProcRefCon));
}

bool IsOwnEndpoint(MIDIEndpointRef ep) {
  return (g_virtual_source && ep == g_virtual_source) || (g_virtual_destination && ep == g_virtual_destination);
}

// Connect every source not connected yet; forget the ones that went away.
void SyncInputs() {
  std::lock_guard<std::mutex> lock(g_inputs_mutex);
  std::map<std::string, MIDIEndpointRef> present;
  const ItemCount n = MIDIGetNumberOfSources();
  for (ItemCount i = 0; i < n; i++) {
    MIDIEndpointRef ep = MIDIGetSource(i);
    if (!ep || IsOwnEndpoint(ep)) continue;
    present["in-" + std::to_string(UniqueId(ep))] = ep;
  }
  for (auto& [id, ctx] : g_inputs) {
    if (id == "virtual-in") continue;
    auto it = present.find(id);
    if (ctx->connected && (it == present.end() || it->second != ctx->endpoint)) {
      MIDIPortDisconnectSource(g_in_port, ctx->endpoint);
      ctx->connected = false;
    }
  }
  for (auto& [id, ep] : present) {
    auto& ctx = g_inputs[id];
    if (!ctx) {
      ctx = std::make_unique<InputContext>();
      ctx->id = id;
    }
    if (ctx->connected) continue;
    ctx->endpoint = ep;
    ctx->parser = MidiParser();
    if (MIDIPortConnectSource(g_in_port, ep, ctx.get()) == noErr) ctx->connected = true;
  }
}

void NotifyProc(const MIDINotification* message, void* /*refCon*/) {
  if (!g_running.load()) return;
  switch (message->messageID) {
    case kMIDIMsgSetupChanged:
      SyncInputs();
      MarkPortsChanged();
      break;
    default:
      break;
  }
}

CFStringRef MakeCfString(const std::string& s) {
  return CFStringCreateWithCString(kCFAllocatorDefault, s.c_str(), kCFStringEncodingUTF8);
}

void SetupEndpoint(MIDIEndpointRef ep, SInt32 unique_id) {
  if (MIDIObjectSetIntegerProperty(ep, kMIDIPropertyUniqueID, unique_id) != noErr) {
    // Taken (another copy of the app is running): keep CoreMIDI's id.
  }
  CFStringRef manufacturer = MakeCfString(g_virtual_name);
  MIDIObjectSetStringProperty(ep, kMIDIPropertyManufacturer, manufacturer);
  CFRelease(manufacturer);
}

bool PlatformStart(std::string& error, bool& has_virtual) {
  CFStringRef client_name = MakeCfString(g_virtual_name);
  OSStatus st = MIDIClientCreate(client_name, NotifyProc, nullptr, &g_client);
  if (st != noErr) {
    CFRelease(client_name);
    error = "MIDIClientCreate failed: " + std::to_string(st);
    return false;
  }
  MIDIInputPortCreate(g_client, CFSTR("Ghost Arcade In"), InputReadProc, nullptr, &g_in_port);
  MIDIOutputPortCreate(g_client, CFSTR("Ghost Arcade Out"), &g_out_port);

  // The destination other apps send to arrives as the "virtual-in" input.
  auto& vctx = g_inputs["virtual-in"];
  if (!vctx) {
    vctx = std::make_unique<InputContext>();
    vctx->id = "virtual-in";
  }
  has_virtual = MIDIDestinationCreate(g_client, client_name, VirtualReadProc, vctx.get(), &g_virtual_destination) == noErr;
  if (has_virtual) {
    SetupEndpoint(g_virtual_destination, kVirtualDestinationUniqueId);
    vctx->endpoint = g_virtual_destination;
    vctx->connected = true;
    if (MIDISourceCreate(g_client, client_name, &g_virtual_source) == noErr) {
      SetupEndpoint(g_virtual_source, kVirtualSourceUniqueId);
    } else {
      g_virtual_source = 0;
    }
  }
  CFRelease(client_name);
  SyncInputs();
  return true;
}

void PlatformStop() {
  {
    std::lock_guard<std::mutex> lock(g_inputs_mutex);
    for (auto& [id, ctx] : g_inputs) {
      if (ctx->connected && id != "virtual-in") MIDIPortDisconnectSource(g_in_port, ctx->endpoint);
      ctx->connected = false;
    }
  }
  if (g_virtual_source) MIDIEndpointDispose(g_virtual_source);
  if (g_virtual_destination) MIDIEndpointDispose(g_virtual_destination);
  g_virtual_source = g_virtual_destination = 0;
  if (g_client) MIDIClientDispose(g_client);
  g_client = g_in_port = g_out_port = 0;
}

void PlatformPorts(std::vector<PortInfo>& inputs, std::vector<PortInfo>& outputs) {
  const ItemCount ns = MIDIGetNumberOfSources();
  for (ItemCount i = 0; i < ns; i++) {
    MIDIEndpointRef ep = MIDIGetSource(i);
    if (ep && !IsOwnEndpoint(ep)) inputs.push_back(EndpointInfo(ep, "in-"));
  }
  const ItemCount nd = MIDIGetNumberOfDestinations();
  for (ItemCount i = 0; i < nd; i++) {
    MIDIEndpointRef ep = MIDIGetDestination(i);
    if (ep && !IsOwnEndpoint(ep)) outputs.push_back(EndpointInfo(ep, "out-"));
  }
  if (g_virtual_destination) inputs.push_back(PortInfo{"virtual-in", g_virtual_name, g_virtual_name, true});
  if (g_virtual_source) outputs.push_back(PortInfo{"virtual-out", g_virtual_name, g_virtual_name, true});
}

bool PlatformSend(const std::string& id, const uint8_t* data, size_t n) {
  MIDIEndpointRef dest = 0;
  bool to_virtual = false;
  if (id == "virtual-out") {
    if (!g_virtual_source) return false;
    to_virtual = true;
  } else {
    if (id.rfind("out-", 0) != 0) return false;
    const SInt32 unique = static_cast<SInt32>(std::stol(id.substr(4)));
    MIDIObjectRef obj = 0;
    MIDIObjectType type;
    if (MIDIObjectFindByUniqueID(unique, &obj, &type) != noErr || type != kMIDIObjectType_Destination) return false;
    dest = static_cast<MIDIEndpointRef>(obj);
  }
  // One packet holds up to 65535 bytes; long SysEx goes in pieces.
  size_t offset = 0;
  while (offset < n) {
    const size_t chunk = std::min<size_t>(n - offset, 60000);
    std::vector<uint8_t> buffer(sizeof(MIDIPacketList) + chunk + 64);
    auto* list = reinterpret_cast<MIDIPacketList*>(buffer.data());
    MIDIPacket* packet = MIDIPacketListInit(list);
    packet = MIDIPacketListAdd(list, buffer.size(), packet, 0, chunk, data + offset);
    if (!packet) return false;
    const OSStatus st = to_virtual ? MIDIReceived(g_virtual_source, list) : MIDISend(g_out_port, dest, list);
    if (st != noErr) return false;
    offset += chunk;
  }
  return true;
}

}  // namespace

// ============================================================================
#elif defined(_WIN32)
// ============================================================================
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>

#include <chrono>
#include <condition_variable>
#include <thread>

namespace {

constexpr int kSysexBuffers = 4;
constexpr DWORD kSysexBufferSize = 4096;

LARGE_INTEGER g_qpf{};
double NowMs() {
  if (!g_qpf.QuadPart) QueryPerformanceFrequency(&g_qpf);
  LARGE_INTEGER c;
  QueryPerformanceCounter(&c);
  return static_cast<double>(c.QuadPart) * 1000.0 / static_cast<double>(g_qpf.QuadPart);
}

std::string Narrow(const wchar_t* w) {
  int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 1) return "";
  std::string s(static_cast<size_t>(len - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), len, nullptr, nullptr);
  return s;
}

struct WinInput {
  std::string id;
  std::string name;
  HMIDIIN handle = nullptr;
  MidiParser parser;
  MIDIHDR headers[kSysexBuffers]{};
  std::vector<char> buffers[kSysexBuffers];
  std::atomic<bool> closing{false};
};

struct WinOutput {
  std::string id;
  std::string name;
  UINT index = 0;
  HMIDIOUT handle = nullptr;  // Opened on first send: outputs are exclusive.
};

std::mutex g_ports_mutex;
std::map<std::string, std::unique_ptr<WinInput>> g_win_inputs;
std::map<std::string, std::unique_ptr<WinOutput>> g_win_outputs;
std::vector<PortInfo> g_input_list, g_output_list;
std::thread g_poll_thread;
std::mutex g_poll_mutex;
std::condition_variable g_poll_cv;
bool g_poll_stop = false;

void CALLBACK InputProc(HMIDIIN, UINT msg, DWORD_PTR instance, DWORD_PTR p1, DWORD_PTR /*p2*/) {
  auto* in = reinterpret_cast<WinInput*>(instance);
  if (!in || in->closing.load() || !g_running.load()) return;
  const double t = NowMs();
  if (msg == MIM_DATA) {
    const uint8_t bytes[3] = {static_cast<uint8_t>(p1 & 0xFF), static_cast<uint8_t>((p1 >> 8) & 0xFF),
                              static_cast<uint8_t>((p1 >> 16) & 0xFF)};
    size_t n = 3;
    const uint8_t s = bytes[0];
    if (s >= 0xF8 || s == 0xF6) n = 1;
    else if (s >= 0xF0) n = 1 + MidiParser::SystemCommonDataLength(s);
    else if (s & 0x80) n = 1 + MidiParser::ChannelDataLength(s);
    in->parser.Feed(bytes, n, [&](const uint8_t* d, size_t len) { Push(in->id, d, len, t); });
  } else if (msg == MIM_LONGDATA) {
    auto* hdr = reinterpret_cast<MIDIHDR*>(p1);
    if (hdr->dwBytesRecorded) {
      in->parser.Feed(reinterpret_cast<uint8_t*>(hdr->lpData), hdr->dwBytesRecorded,
                      [&](const uint8_t* d, size_t len) { Push(in->id, d, len, t); });
    }
    if (!in->closing.load()) midiInAddBuffer(in->handle, hdr, sizeof(MIDIHDR));
  }
}

void CloseInput(WinInput* in) {
  in->closing = true;
  midiInStop(in->handle);
  midiInReset(in->handle);
  for (auto& h : in->headers) midiInUnprepareHeader(in->handle, &h, sizeof(MIDIHDR));
  midiInClose(in->handle);
  in->handle = nullptr;
}

bool OpenInput(WinInput* in, UINT index) {
  if (midiInOpen(&in->handle, index, reinterpret_cast<DWORD_PTR>(&InputProc), reinterpret_cast<DWORD_PTR>(in),
                 CALLBACK_FUNCTION) != MMSYSERR_NOERROR) {
    in->handle = nullptr;
    return false;
  }
  for (int i = 0; i < kSysexBuffers; i++) {
    in->buffers[i].assign(kSysexBufferSize, 0);
    in->headers[i] = MIDIHDR{};
    in->headers[i].lpData = in->buffers[i].data();
    in->headers[i].dwBufferLength = kSysexBufferSize;
    midiInPrepareHeader(in->handle, &in->headers[i], sizeof(MIDIHDR));
    midiInAddBuffer(in->handle, &in->headers[i], sizeof(MIDIHDR));
  }
  midiInStart(in->handle);
  return true;
}

// Ids are the device name plus its place among devices of the same name: WinMM
// indexes move when a device is unplugged.
template <typename Caps, typename GetCaps>
std::vector<std::pair<std::string, std::pair<UINT, std::string>>> Enumerate(UINT count, GetCaps get, const char* prefix) {
  std::vector<std::pair<std::string, std::pair<UINT, std::string>>> out;
  std::map<std::string, int> seen;
  for (UINT i = 0; i < count; i++) {
    Caps caps{};
    if (get(i, &caps, sizeof(caps)) != MMSYSERR_NOERROR) continue;
    const std::string name = Narrow(caps.szPname);
    const int k = seen[name]++;
    out.push_back({std::string(prefix) + name + "#" + std::to_string(k), {i, name}});
  }
  return out;
}

// Returns true when the list changed.
bool SyncPorts() {
  auto ins = Enumerate<MIDIINCAPSW>(midiInGetNumDevs(), [](UINT i, MIDIINCAPSW* c, UINT s) { return midiInGetDevCapsW(i, c, s); }, "in-");
  auto outs = Enumerate<MIDIOUTCAPSW>(midiOutGetNumDevs(), [](UINT i, MIDIOUTCAPSW* c, UINT s) { return midiOutGetDevCapsW(i, c, s); }, "out-");
  std::lock_guard<std::mutex> lock(g_ports_mutex);
  bool changed = false;
  std::map<std::string, std::pair<UINT, std::string>> in_map(ins.begin(), ins.end()), out_map(outs.begin(), outs.end());
  for (auto it = g_win_inputs.begin(); it != g_win_inputs.end();) {
    if (!in_map.count(it->first)) {
      if (it->second->handle) CloseInput(it->second.get());
      it = g_win_inputs.erase(it);
      changed = true;
    } else {
      ++it;
    }
  }
  for (auto& [id, v] : ins) {
    if (g_win_inputs.count(id)) continue;
    auto in = std::make_unique<WinInput>();
    in->id = id;
    in->name = v.second;
    OpenInput(in.get(), v.first);  // A device another app holds stays listed, unopened.
    g_win_inputs[id] = std::move(in);
    changed = true;
  }
  for (auto it = g_win_outputs.begin(); it != g_win_outputs.end();) {
    if (!out_map.count(it->first)) {
      if (it->second->handle) midiOutClose(it->second->handle);
      it = g_win_outputs.erase(it);
      changed = true;
    } else {
      it->second->index = out_map[it->first].first;
      ++it;
    }
  }
  for (auto& [id, v] : outs) {
    if (g_win_outputs.count(id)) continue;
    auto out = std::make_unique<WinOutput>();
    out->id = id;
    out->name = v.second;
    out->index = v.first;
    g_win_outputs[id] = std::move(out);
    changed = true;
  }
  if (changed) {
    g_input_list.clear();
    g_output_list.clear();
    for (auto& [id, v] : ins) g_input_list.push_back(PortInfo{id, v.second, "", false});
    for (auto& [id, v] : outs) g_output_list.push_back(PortInfo{id, v.second, "", false});
  }
  return changed;
}

bool PlatformStart(std::string& /*error*/, bool& has_virtual) {
  has_virtual = false;
  SyncPorts();
  g_poll_stop = false;
  // WinMM has no device notifications: look for changes once a second.
  g_poll_thread = std::thread([] {
    std::unique_lock<std::mutex> lock(g_poll_mutex);
    while (!g_poll_cv.wait_for(lock, std::chrono::seconds(1), [] { return g_poll_stop; })) {
      lock.unlock();
      if (SyncPorts()) MarkPortsChanged();
      lock.lock();
    }
  });
  return true;
}

void PlatformStop() {
  {
    std::lock_guard<std::mutex> lock(g_poll_mutex);
    g_poll_stop = true;
  }
  g_poll_cv.notify_all();
  if (g_poll_thread.joinable()) g_poll_thread.join();
  std::lock_guard<std::mutex> lock(g_ports_mutex);
  for (auto& [id, in] : g_win_inputs) if (in->handle) CloseInput(in.get());
  for (auto& [id, out] : g_win_outputs) if (out->handle) midiOutClose(out->handle);
  g_win_inputs.clear();
  g_win_outputs.clear();
  g_input_list.clear();
  g_output_list.clear();
}

void PlatformPorts(std::vector<PortInfo>& inputs, std::vector<PortInfo>& outputs) {
  std::lock_guard<std::mutex> lock(g_ports_mutex);
  inputs = g_input_list;
  outputs = g_output_list;
}

bool PlatformSend(const std::string& id, const uint8_t* data, size_t n) {
  std::lock_guard<std::mutex> lock(g_ports_mutex);
  auto it = g_win_outputs.find(id);
  if (it == g_win_outputs.end()) return false;
  WinOutput* out = it->second.get();
  if (!out->handle && midiOutOpen(&out->handle, out->index, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
    out->handle = nullptr;
    return false;
  }
  if (n == 0) return true;
  if (data[0] != 0xF0 && n <= 3) {
    DWORD packed = 0;
    for (size_t i = 0; i < n; i++) packed |= static_cast<DWORD>(data[i]) << (8 * i);
    return midiOutShortMsg(out->handle, packed) == MMSYSERR_NOERROR;
  }
  if (data[0] != 0xF0) {
    // Several short messages in one send.
    size_t i = 0;
    while (i < n) {
      size_t len = 1;
      const uint8_t s = data[i];
      if (s >= 0xF8 || s == 0xF6) len = 1;
      else if (s >= 0xF0) len = 1 + MidiParser::SystemCommonDataLength(s);
      else len = 1 + MidiParser::ChannelDataLength(s);
      if (i + len > n) return false;
      DWORD packed = 0;
      for (size_t k = 0; k < len; k++) packed |= static_cast<DWORD>(data[i + k]) << (8 * k);
      if (midiOutShortMsg(out->handle, packed) != MMSYSERR_NOERROR) return false;
      i += len;
    }
    return true;
  }
  std::vector<char> copy(data, data + n);
  MIDIHDR hdr{};
  hdr.lpData = copy.data();
  hdr.dwBufferLength = static_cast<DWORD>(n);
  hdr.dwBytesRecorded = static_cast<DWORD>(n);
  if (midiOutPrepareHeader(out->handle, &hdr, sizeof(hdr)) != MMSYSERR_NOERROR) return false;
  bool ok = midiOutLongMsg(out->handle, &hdr, sizeof(hdr)) == MMSYSERR_NOERROR;
  for (int waited = 0; ok && !(hdr.dwFlags & MHDR_DONE) && waited < 1000; waited++) Sleep(1);
  midiOutUnprepareHeader(out->handle, &hdr, sizeof(hdr));
  return ok;
}

}  // namespace

// ============================================================================
#else
// ============================================================================
namespace {
double NowMs() { return 0; }
bool PlatformStart(std::string& error, bool& has_virtual) {
  has_virtual = false;
  error = "native MIDI is not built for this platform";
  return false;
}
void PlatformStop() {}
void PlatformPorts(std::vector<PortInfo>&, std::vector<PortInfo>&) {}
bool PlatformSend(const std::string&, const uint8_t*, size_t) { return false; }
}  // namespace
#endif

// ---- JS bindings -----------------------------------------------------------

namespace {

bool g_has_virtual = false;

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(onEvent, options) needs a callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (g_running.load()) {
    result.Set("ok", true);
    result.Set("virtual", g_has_virtual);
    return result;
  }
#if defined(__APPLE__)
  if (info.Length() > 1 && info[1].IsObject()) {
    Napi::Value name = info[1].As<Napi::Object>().Get("virtualName");
    if (name.IsString() && !name.As<Napi::String>().Utf8Value().empty()) g_virtual_name = name.As<Napi::String>().Utf8Value();
  }
#endif
  g_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "ghost-midi", 0, 1);
  // Keep the event loop free to exit: MIDI never holds the app open.
  g_tsfn.Unref(env);
  g_running = true;
  std::string error;
  bool has_virtual = false;
  if (!PlatformStart(error, has_virtual)) {
    g_running = false;
    g_tsfn.Release();
    result.Set("ok", false);
    result.Set("error", error);
    return result;
  }
  g_has_virtual = has_virtual;
  result.Set("ok", true);
  result.Set("virtual", has_virtual);
  return result;
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (!g_running.load()) return info.Env().Undefined();
  g_running = false;
  PlatformStop();
  {
    std::lock_guard<std::mutex> lock(g_queue_mutex);
    g_queue.clear();
    g_ports_dirty = false;
  }
  g_tsfn.Release();
  g_has_virtual = false;
  return info.Env().Undefined();
}

Napi::Array PortsToArray(Napi::Env env, const std::vector<PortInfo>& ports) {
  Napi::Array arr = Napi::Array::New(env, ports.size());
  for (size_t i = 0; i < ports.size(); i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("id", ports[i].id);
    o.Set("name", ports[i].name);
    o.Set("manufacturer", ports[i].manufacturer);
    o.Set("virtual", ports[i].is_virtual);
    arr.Set(static_cast<uint32_t>(i), o);
  }
  return arr;
}

Napi::Value Ports(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::vector<PortInfo> inputs, outputs;
  if (g_running.load()) PlatformPorts(inputs, outputs);
  Napi::Object result = Napi::Object::New(env);
  result.Set("inputs", PortsToArray(env, inputs));
  result.Set("outputs", PortsToArray(env, outputs));
  return result;
}

Napi::Value Send(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_running.load() || info.Length() < 2 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  const std::string id = info[0].As<Napi::String>().Utf8Value();
  std::vector<uint8_t> bytes;
  if (info[1].IsTypedArray()) {
    Napi::TypedArray ta = info[1].As<Napi::TypedArray>();
    if (ta.TypedArrayType() != napi_uint8_array) return Napi::Boolean::New(env, false);
    Napi::Uint8Array u8 = info[1].As<Napi::Uint8Array>();
    bytes.assign(u8.Data(), u8.Data() + u8.ElementLength());
  } else if (info[1].IsArray()) {
    Napi::Array arr = info[1].As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      const uint32_t v = arr.Get(i).ToNumber().Uint32Value();
      if (v > 255) return Napi::Boolean::New(env, false);
      bytes.push_back(static_cast<uint8_t>(v));
    }
  } else {
    return Napi::Boolean::New(env, false);
  }
  bool ok = false;
  try {
    ok = PlatformSend(id, bytes.data(), bytes.size());
  } catch (...) {
    ok = false;
  }
  return Napi::Boolean::New(env, ok);
}

Napi::Value Now(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), NowMs()); }

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("ports", Napi::Function::New(env, Ports));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("nowMs", Napi::Function::New(env, Now));
#if defined(__APPLE__)
  exports.Set("virtualPortsSupported", true);
#else
  exports.Set("virtualPortsSupported", false);
#endif
  return exports;
}

}  // namespace

NODE_API_MODULE(midi_addon, Init)
