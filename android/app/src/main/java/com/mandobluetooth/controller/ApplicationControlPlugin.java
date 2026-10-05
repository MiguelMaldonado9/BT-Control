package com.mandobluetooth.controller;

import android.app.Activity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ApplicationControl")
public class ApplicationControlPlugin extends Plugin {

    @PluginMethod
    public void exitApp(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No se pudo cerrar la aplicación.");
            return;
        }
        call.resolve();
        activity.runOnUiThread(activity::finishAndRemoveTask);
    }
}
