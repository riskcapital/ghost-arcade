package com.ghostarcade.mobile;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
@CapacitorPlugin(name="CompanionLink")
public class CompanionLinkPlugin extends Plugin {
 private String pending;
 @Override public void load(){Intent i=getActivity().getIntent();pending=i!=null?i.getDataString():null;}
 @Override protected void handleOnNewIntent(Intent intent){pending=intent.getDataString();}
 @PluginMethod public void takePairingLink(PluginCall call){JSObject result=new JSObject();result.put("url",pending==null?"":pending);pending=null;call.resolve(result);}
}
