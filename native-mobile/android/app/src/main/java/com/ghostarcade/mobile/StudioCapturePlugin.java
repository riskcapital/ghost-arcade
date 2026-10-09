package com.ghostarcade.mobile;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import java.io.File;
import java.io.FileOutputStream;

/**
 * The Android half of the StudioCapture bridge the app already uses on iOS: pairing by QR
 * code, the share sheet, haptics and the shortcut to this app's system settings. LiDAR and
 * dual-camera capture have no Android counterpart, so capabilities() reports them as absent.
 */
@CapacitorPlugin(name = "StudioCapture")
public class StudioCapturePlugin extends Plugin {
    private static final String SHARE_CHOSEN = "com.ghostarcade.mobile.SHARE_CHOSEN";
    private static final long MAX_SHARE_BYTES = 250_000_000L;
    private boolean shareChosen;
    private BroadcastReceiver shareReceiver;

    @PluginMethod public void capabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("lidar", false);
        result.put("dualCamera", false);
        result.put("platform", "android");
        call.resolve(result);
    }

    /** Opens Google's code scanner, which shows its own camera screen and needs no camera permission. */
    @PluginMethod public void scanPairingCode(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        GmsBarcodeScanning.getClient(getContext(), options).startScan()
            .addOnSuccessListener(code -> resolveScan(call, code.getRawValue()))
            .addOnCanceledListener(() -> resolveScan(call, null))
            .addOnFailureListener(error -> {
                if (error instanceof ApiException && ((ApiException) error).getStatusCode() == CommonStatusCodes.CANCELED) { resolveScan(call, null); return; }
                call.reject("The code scanner could not open. Scan the desktop QR with your camera app, or paste its pairing link.");
            });
    }

    private void resolveScan(PluginCall call, String url) {
        JSObject result = new JSObject();
        result.put("url", url == null ? "" : url);
        result.put("cancelled", url == null);
        call.resolve(result);
    }

    @PluginMethod public void shareFile(PluginCall call) {
        String name = safeName(call.getString("filename"));
        String text = call.getString("base64");
        String mime = call.getString("mimeType", "application/octet-stream");
        if (name == null) { call.reject("A file name is needed to share."); return; }
        if (text == null || text.isEmpty()) { call.reject("There is nothing to share."); return; }
        int comma = text.startsWith("data:") ? text.indexOf(',') : -1;
        if (comma >= 0) text = text.substring(comma + 1);
        if ((long) text.length() / 4 * 3 > MAX_SHARE_BYTES) { call.reject("This file is too large to share."); return; }
        final String payload = text;
        new Thread(() -> {
            try {
                byte[] data = Base64.decode(payload, Base64.DEFAULT);
                if (data.length == 0) { call.reject("The file could not be read."); return; }
                // Its own folder, emptied first, so the shared file keeps exactly the name the person sees.
                File folder = new File(getContext().getCacheDir(), "shared");
                File[] old = folder.listFiles();
                if (old != null) for (File file : old) file.delete();
                folder.mkdirs();
                File file = new File(folder, name);
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(data); }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(android.content.ClipData.newRawUri(name, uri));
                getActivity().runOnUiThread(() -> present(call, send, name));
            } catch (IllegalArgumentException error) {
                call.reject("The file could not be read.");
            } catch (Exception error) {
                call.reject("The file could not be shared.");
            }
        }).start();
    }

    private void present(PluginCall call, Intent send, String title) {
        shareChosen = false;
        listenForChoice();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent chosen = PendingIntent.getBroadcast(getContext(), 0, new Intent(SHARE_CHOSEN).setPackage(getContext().getPackageName()), flags);
        Intent chooser = Intent.createChooser(send, title, chosen.getIntentSender());
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, chooser, "shareDone"); }
        catch (Exception error) { call.reject("The file could not be shared."); }
    }

    private void listenForChoice() {
        if (shareReceiver != null) return;
        shareReceiver = new BroadcastReceiver() { @Override public void onReceive(Context context, Intent intent) { shareChosen = true; } };
        IntentFilter filter = new IntentFilter(SHARE_CHOSEN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) getContext().registerReceiver(shareReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(shareReceiver, filter);
    }

    /** The sheet has closed. Android only says whether a destination was picked, so that is what "completed" means here. */
    @ActivityCallback private void shareDone(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        out.put("completed", shareChosen);
        call.resolve(out);
    }

    @Override protected void handleOnDestroy() {
        if (shareReceiver != null) { try { getContext().unregisterReceiver(shareReceiver); } catch (Exception ignored) {} shareReceiver = null; }
    }

    private static String safeName(String raw) {
        if (raw == null) return null;
        String name = raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").trim();
        while (name.startsWith(".")) name = name.substring(1);
        if (name.length() > 120) name = name.substring(name.length() - 120);
        return name.isEmpty() ? null : name;
    }

    @PluginMethod public void haptic(PluginCall call) {
        String type = call.getString("type", "light");
        int effect;
        switch (type) {
            case "medium": effect = HapticFeedbackConstants.VIRTUAL_KEY; break;
            case "heavy": effect = HapticFeedbackConstants.LONG_PRESS; break;
            case "selection": effect = HapticFeedbackConstants.CLOCK_TICK; break;
            case "success": effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY; break;
            case "warning":
            case "error": effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS; break;
            default: effect = HapticFeedbackConstants.KEYBOARD_TAP;
        }
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            if (view != null) view.performHapticFeedback(effect);
            call.resolve();
        });
    }

    @PluginMethod public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) { call.reject("Settings could not be opened."); }
    }
}
