package live.ghostarcade.vision;

import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GhostVision")
public class GhostVisionPlugin extends Plugin {
    private boolean active = false;
    private String captureProfile = "object-relief";
    private String facingMode = "environment";
    private String lastError = null;

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        call.resolve(capabilitiesObject(call.getString("facingMode", "environment"), call.getString("captureProfile", captureProfile)));
    }

    @PluginMethod
    public void start(PluginCall call) {
        captureProfile = call.getString("captureProfile", "object-relief");
        facingMode = call.getString("facingMode", "person-aura".equals(captureProfile) ? "user" : facingMode);
        active = false;
        lastError = "Android native vision analysis is capability-only in this build.";
        JSObject status = statusObject();
        notifyListeners("status", status);
        call.resolve(status);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        lastError = null;
        JSObject status = statusObject();
        notifyListeners("status", status);
        call.resolve(status);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        JSObject ret = new JSObject();
        ret.put("active", active);
        ret.put("captureProfile", captureProfile);
        ret.put("facingMode", facingMode);
        ret.put("capabilities", capabilitiesObject(facingMode, captureProfile));
        if (lastError != null) ret.put("error", lastError);
        return ret;
    }

    private JSObject capabilitiesObject(String facingMode, String profile) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        boolean hasCamera = pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
            || pm.hasSystemFeature(PackageManager.FEATURE_CAMERA)
            || pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT);
        boolean hasDepthFeature = pm.hasSystemFeature("android.hardware.camera.depth");
        boolean hasArFeature = pm.hasSystemFeature("android.hardware.camera.ar");
        boolean camera2Depth = false;

        try {
            CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (manager != null) {
                for (String id : manager.getCameraIdList()) {
                    CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                    int[] caps = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
                    if (caps == null) continue;
                    for (int cap : caps) {
                        if (cap == CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT) {
                            camera2Depth = true;
                            break;
                        }
                    }
                    if (camera2Depth) break;
                }
            }
        } catch (Exception ignored) {
        }

        boolean nativeDepth = hasDepthFeature || camera2Depth;
        JSArray notes = new JSArray();
        notes.put("Android bridge currently reports native camera/depth capabilities; capture analysis is implemented on iOS first.");
        if (hasArFeature) notes.put("AR camera feature detected.");

        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("platform", "android");
        ret.put("facingMode", facingMode);
        ret.put("camera", hasCamera);
        ret.put("color", hasCamera);
        ret.put("depth", nativeDepth);
        ret.put("nativeDepth", nativeDepth);
        ret.put("lidar", false);
        ret.put("trueDepth", false);
        ret.put("segmentation", false);
        ret.put("personSegmentation", false);
        ret.put("preferredWidth", "rgb-fast".equals(profile) ? 1280 : 1920);
        ret.put("preferredHeight", "rgb-fast".equals(profile) ? 720 : 1080);
        ret.put("preferredFrameRate", "rgb-fast".equals(profile) ? 60 : 30);
        ret.put("notes", notes);
        return ret;
    }
}
