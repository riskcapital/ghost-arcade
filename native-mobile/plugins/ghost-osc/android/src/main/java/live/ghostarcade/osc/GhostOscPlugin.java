package live.ghostarcade.osc;

import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GhostOsc")
public class GhostOscPlugin extends Plugin {
    private final Object lock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private DatagramSocket socket;
    private ExecutorService executor;
    private volatile boolean listening = false;
    private int currentPort = 0;
    private String lastError = null;

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 8000);
        if (port < 1 || port > 65535) {
            call.reject("OSC port must be between 1 and 65535.");
            return;
        }

        try {
            startSocket(port);
            call.resolve(statusObject());
        } catch (Exception e) {
            lastError = e.getMessage();
            emitStatus();
            call.reject(lastError, e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopSocket(null);
        call.resolve(statusObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @Override
    protected void handleOnDestroy() {
        stopSocket(null);
        super.handleOnDestroy();
    }

    private void startSocket(int port) throws SocketException {
        synchronized (lock) {
            stopSocket(null);
            DatagramSocket next = new DatagramSocket(null);
            next.setReuseAddress(true);
            next.bind(new InetSocketAddress(port));
            socket = next;
            currentPort = port;
            lastError = null;
            listening = true;
            executor = Executors.newSingleThreadExecutor();
            executor.execute(this::listenLoop);
        }
        emitStatus();
    }

    private void stopSocket(String error) {
        DatagramSocket oldSocket;
        ExecutorService oldExecutor;
        synchronized (lock) {
            listening = false;
            oldSocket = socket;
            oldExecutor = executor;
            socket = null;
            executor = null;
            if (error != null) lastError = error;
        }
        if (oldSocket != null) {
            try {
                oldSocket.close();
            } catch (Exception ignored) {
            }
        }
        if (oldExecutor != null) {
            oldExecutor.shutdownNow();
        }
        emitStatus();
    }

    private JSObject statusObject() {
        JSObject ret = new JSObject();
        ret.put("listening", listening);
        ret.put("port", currentPort);
        if (lastError != null) ret.put("error", lastError);
        return ret;
    }

    private void emitStatus() {
        JSObject status = statusObject();
        runOnMain(() -> notifyListeners("status", status));
    }

    private void emitMessage(JSObject message) {
        runOnMain(() -> notifyListeners("message", message));
    }

    private void runOnMain(Runnable runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runnable.run();
        } else {
            mainHandler.post(runnable);
        }
    }

    private void listenLoop() {
        byte[] buffer = new byte[8192];
        while (listening) {
            DatagramSocket active = socket;
            if (active == null) return;
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                active.receive(packet);
                List<OscPacket> packets = OscParser.parse(packet.getData(), packet.getOffset(), packet.getLength());
                long receivedAt = System.currentTimeMillis();
                String from = packet.getAddress().getHostAddress();
                for (OscPacket osc : packets) {
                    JSObject event = new JSObject();
                    event.put("address", osc.address);
                    event.put("args", osc.args);
                    event.put("from", from);
                    event.put("port", currentPort);
                    event.put("receivedAt", receivedAt);
                    emitMessage(event);
                }
            } catch (SocketException e) {
                if (listening) stopSocket(e.getMessage());
                return;
            } catch (IOException e) {
                if (listening) lastError = e.getMessage();
                emitStatus();
            } catch (Exception e) {
                lastError = e.getMessage();
                emitStatus();
            }
        }
    }

    private static class OscPacket {
        final String address;
        final JSONArray args;

        OscPacket(String address, JSONArray args) {
            this.address = address;
            this.args = args;
        }
    }

    private static class OscParser {
        static List<OscPacket> parse(byte[] data, int offset, int length) {
            List<OscPacket> out = new ArrayList<>();
            parsePacket(data, offset, offset + length, out, 0);
            return out;
        }

        private static void parsePacket(byte[] data, int start, int end, List<OscPacket> out, int depth) {
            if (depth > 4 || start >= end) return;
            ReadString first = readString(data, start, end, start);
            if (first == null) return;
            if ("#bundle".equals(first.value)) {
                int index = first.next + 8;
                while (index + 4 <= end) {
                    int size = readInt(data, index);
                    index += 4;
                    if (size <= 0 || index + size > end) return;
                    parsePacket(data, index, index + size, out, depth + 1);
                    index += size;
                }
                return;
            }
            if (!first.value.startsWith("/")) return;
            ReadString tags = readString(data, first.next, end, start);
            if (tags == null || !tags.value.startsWith(",")) {
                out.add(new OscPacket(first.value, new JSONArray()));
                return;
            }
            int index = tags.next;
            JSONArray args = new JSONArray();
            String typeTags = tags.value.substring(1);
            for (int i = 0; i < typeTags.length(); i++) {
                char type = typeTags.charAt(i);
                try {
                    if (type == 'i') {
                        if (index + 4 > end) break;
                        args.put(arg("i", readInt(data, index)));
                        index += 4;
                    } else if (type == 'f') {
                        if (index + 4 > end) break;
                        args.put(arg("f", readFloat(data, index)));
                        index += 4;
                    } else if (type == 's') {
                        ReadString str = readString(data, index, end, start);
                        if (str == null) break;
                        args.put(arg("s", str.value));
                        index = str.next;
                    } else if (type == 'T') {
                        args.put(arg("T", true));
                    } else if (type == 'F') {
                        args.put(arg("F", false));
                    }
                } catch (Exception ignored) {
                    break;
                }
            }
            out.add(new OscPacket(first.value, args));
        }

        private static JSONObject arg(String type, Object value) throws Exception {
            JSONObject obj = new JSONObject();
            obj.put("type", type);
            obj.put("value", value);
            return obj;
        }

        private static int readInt(byte[] data, int index) {
            return ByteBuffer.wrap(data, index, 4).order(ByteOrder.BIG_ENDIAN).getInt();
        }

        private static float readFloat(byte[] data, int index) {
            return ByteBuffer.wrap(data, index, 4).order(ByteOrder.BIG_ENDIAN).getFloat();
        }

        private static ReadString readString(byte[] data, int index, int end, int base) {
            if (index >= end) return null;
            int cursor = index;
            while (cursor < end && data[cursor] != 0) cursor++;
            if (cursor >= end) return null;
            String value = new String(data, index, cursor - index, StandardCharsets.UTF_8);
            int next = cursor + 1;
            int consumed = next - base;
            next = base + ((consumed + 3) / 4) * 4;
            if (next > end) return null;
            return new ReadString(value, next);
        }
    }

    private static class ReadString {
        final String value;
        final int next;

        ReadString(String value, int next) {
            this.value = value;
            this.next = next;
        }
    }
}
