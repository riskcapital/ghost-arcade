package com.ghostarcade.mobile;

import android.app.Presentation;
import android.content.Intent;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.Settings;
import android.view.Display;
import android.view.ViewGroup;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity implements DisplayManager.DisplayListener {
    private DisplayManager displays;
    private Presentation presentation;
    private FrameLayout outputHost;
    private WebView outputView;
    private int displayId = -1;
    private int revision = 0;
    private boolean keptScreenOn;

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CompanionLinkPlugin.class);
        registerPlugin(StudioCapturePlugin.class);
        super.onCreate(savedInstanceState);
        WebView controller = getBridge().getWebView();
        controller.getSettings().setSupportMultipleWindows(true);
        controller.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        controller.addJavascriptInterface(new OutputMessages(), "GhostOutputAndroid");
        // Retain Capacitor camera permissions, file pickers and JS dialogs.
        controller.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (view != controller || outputHost == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
                closeOutputView();
                WebView output = new WebView(outputHost.getContext());
                output.setBackgroundColor(Color.BLACK);
                output.setWebChromeClient(this);
                output.getSettings().setJavaScriptEnabled(true);
                output.getSettings().setMediaPlaybackRequiresUserGesture(false);
                output.getSettings().setAllowFileAccess(false);
                output.setHorizontalScrollBarEnabled(false);
                output.setVerticalScrollBarEnabled(false);
                outputHost.addView(output, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                outputView = output;
                ((WebView.WebViewTransport)resultMsg.obj).setWebView(output);
                resultMsg.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView window) { if(window == outputView) closeOutputView(); }
        });
        // Back closes whatever sheet or dialog is open, the way Escape does. With nothing open it
        // sends the app to the background instead of ending it, so a running show is never lost.
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                controller.evaluateJavascript("!!document.querySelector('dialog[open],[role=\"dialog\"],[role=\"alertdialog\"]')", open -> {
                    if ("true".equals(open)) {
                        controller.requestFocus();
                        controller.dispatchKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_ESCAPE));
                        controller.dispatchKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_ESCAPE));
                    } else moveTaskToBack(true);
                });
            }
        });
        displays = (DisplayManager)getSystemService(DISPLAY_SERVICE);
        displays.registerDisplayListener(this, new Handler(Looper.getMainLooper()));
        updateDisplay();
    }
    private final class OutputMessages {
        @JavascriptInterface public void postMessage(String json) {
            runOnUiThread(() -> {
                try {
                    String type = new JSONObject(json).optString("type");
                    if ("ready".equals(type)) publishConnection();
                    if ("status".equals(type)) android.util.Log.i("GhostOutput", new JSONObject(json).optString("state"));
                    if ("chooseWireless".equals(type)) {
                        Intent intent = new Intent(Settings.ACTION_CAST_SETTINGS);
                        if(intent.resolveActivity(getPackageManager()) == null) intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                        startActivity(intent);
                    }
                } catch(Exception error) { android.util.Log.w("GhostOutput", "Output request failed", error); }
            });
        }
    }
    @Override public void onDisplayAdded(int id) { updateDisplay(); }
    @Override public void onDisplayRemoved(int id) { updateDisplay(); }
    @Override public void onDisplayChanged(int id) { updateDisplay(); }
    @Override public void onResume() { super.onResume(); if(displays != null) updateDisplay(); }
    private void updateDisplay() {
        Display[] available = displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        Display chosen = null;
        for(Display display: available) { if(chosen == null || display.getDisplayId() == displayId) chosen = display; }
        if(chosen != null && presentation != null && chosen.getDisplayId() == displayId) { publishConnection(); return; }
        closePresentation();
        if(chosen != null) {
            try {
                final Presentation next = new Presentation(this, chosen);
                FrameLayout host = new FrameLayout(next.getContext());host.setBackgroundColor(Color.BLACK);
                next.setContentView(host);
                next.setOnDismissListener(dialog -> { if(presentation == next) { closeOutputView();presentation=null;outputHost=null;displayId=-1;restoreScreenWake();publishConnection(); } });
                next.show();
                if(next.getWindow()!=null) {
                    next.getWindow().setBackgroundDrawableResource(android.R.color.black);
                    next.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                }
                presentation=next;outputHost=host;displayId=chosen.getDisplayId();revision++;
                keptScreenOn=(getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }catch(WindowManager.InvalidDisplayException error) { closePresentation(); }
        }
        publishConnection();
    }
    private void publishConnection() {
        try {
            JSONObject detail=new JSONObject();detail.put("connected",presentation!=null);detail.put("revision",revision);
            if(presentation!=null) { Display d=presentation.getDisplay();JSONObject info=new JSONObject();info.put("name",d.getName());info.put("width",d.getMode().getPhysicalWidth());info.put("height",d.getMode().getPhysicalHeight());detail.put("display",info); }
            getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('ghost-external-display',{detail:"+detail+"}));",null);
        }catch(Exception error) { android.util.Log.w("GhostOutput","Output status failed",error); }
    }
    private void closeOutputView() { if(outputView!=null){ if(outputHost!=null)outputHost.removeView(outputView);outputView.stopLoading();outputView.destroy();outputView=null; } }
    private void restoreScreenWake() { if(!keptScreenOn)getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); }
    private void closePresentation() { closeOutputView();Presentation old=presentation;presentation=null;outputHost=null;displayId=-1;if(old!=null){old.dismiss();restoreScreenWake();} }
    @Override public void onDestroy() { if(displays!=null)displays.unregisterDisplayListener(this);closePresentation();super.onDestroy(); }
}
