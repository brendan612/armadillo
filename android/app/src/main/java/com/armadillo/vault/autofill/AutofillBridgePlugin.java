package com.armadillo.vault.autofill;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.view.autofill.AutofillManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AutofillBridge")
public class AutofillBridgePlugin extends Plugin {

    @PluginMethod
    public void syncCredentials(PluginCall call) {
        try {
            JSArray credentialsArray = call.getArray("credentials");
            if (credentialsArray == null) {
                call.reject("Missing credentials array");
                return;
            }

            List<AutofillCredential> credentials = new ArrayList<>();
            for (int i = 0; i < credentialsArray.length(); i++) {
                try {
                    JSONObject obj = credentialsArray.optJSONObject(i);
                    if (obj == null) {
                        Object raw = credentialsArray.opt(i);
                        if (raw instanceof JSONObject) {
                            obj = (JSONObject) raw;
                        } else if (raw != null) {
                            obj = new JSONObject(String.valueOf(raw));
                        }
                    }
                    if (obj == null) {
                        continue;
                    }
                    credentials.add(AutofillCredential.fromJson(obj));
                } catch (Exception ignored) {
                    // Skip malformed entries instead of rejecting the whole sync batch.
                }
            }

            CredentialStore store = new CredentialStore(getContext());
            store.saveCredentials(credentials);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("count", credentials.size());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to save credentials: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        try {
            CredentialStore store = new CredentialStore(getContext());
            store.clear();

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to clear credentials: " + e.getMessage());
        }
    }

    @PluginMethod
    public void consumeCapturedCredentials(PluginCall call) {
        try {
            CredentialStore store = new CredentialStore(getContext());
            List<AutofillCredential> captures = store.consumeCapturedCredentials();
            JSArray captureRows = new JSArray();
            for (AutofillCredential capture : captures) {
                captureRows.put(toJsObject(capture));
            }

            JSObject result = new JSObject();
            result.put("captures", captureRows);
            result.put("count", captures.size());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to consume captured credentials: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isAutofillServiceEnabled(PluginCall call) {
        JSObject result = new JSObject();

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("enabled", false);
            result.put("supported", false);
            call.resolve(result);
            return;
        }

        AutofillManager afm = getContext().getSystemService(AutofillManager.class);
        boolean enabled = afm != null && afm.hasEnabledAutofillServices();
        result.put("enabled", enabled);
        result.put("supported", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openAutofillSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Autofill not supported on this Android version");
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE);
            intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open autofill settings: " + e.getMessage());
        }
    }

    private JSObject toJsObject(AutofillCredential credential) {
        JSObject row = new JSObject();
        row.put("id", credential.id);
        row.put("title", credential.title);
        row.put("username", credential.username);
        row.put("password", credential.password);
        row.put("packageName", credential.packageName);
        row.put("webDomain", credential.webDomain);
        row.put("capturedAt", credential.capturedAt);

        JSArray urls = new JSArray();
        for (String url : credential.urls) {
            urls.put(url);
        }
        row.put("urls", urls);

        JSArray linkedPackages = new JSArray();
        for (String linkedPackage : credential.linkedAndroidPackages) {
            linkedPackages.put(linkedPackage);
        }
        row.put("linkedAndroidPackages", linkedPackages);
        return row;
    }
}
