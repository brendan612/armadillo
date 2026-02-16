package com.armadillo.vault.autofill;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class AutofillCredential {
    public String id;
    public String title;
    public String username;
    public String password;
    public List<String> urls;
    public List<String> linkedAndroidPackages;
    public String packageName;
    public String webDomain;
    public long capturedAt;

    public AutofillCredential() {
        this.urls = new ArrayList<>();
        this.linkedAndroidPackages = new ArrayList<>();
        this.packageName = "";
        this.webDomain = "";
        this.capturedAt = 0L;
    }

    public AutofillCredential(
            String id,
            String title,
            String username,
            String password,
            List<String> urls,
            List<String> linkedAndroidPackages,
            String packageName,
            String webDomain,
            long capturedAt
    ) {
        this.id = id;
        this.title = title;
        this.username = username;
        this.password = password;
        this.urls = urls != null ? urls : new ArrayList<>();
        this.linkedAndroidPackages = linkedAndroidPackages != null ? linkedAndroidPackages : new ArrayList<>();
        this.packageName = packageName != null ? packageName : "";
        this.webDomain = webDomain != null ? webDomain : "";
        this.capturedAt = capturedAt;
    }

    public JSONObject toJson() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("id", id);
            obj.put("title", title);
            obj.put("username", username);
            obj.put("password", password);
            JSONArray urlArray = new JSONArray();
            for (String url : urls) {
                urlArray.put(url);
            }
            obj.put("urls", urlArray);
            JSONArray packageArray = new JSONArray();
            for (String linkedPackage : linkedAndroidPackages) {
                packageArray.put(linkedPackage);
            }
            obj.put("linkedAndroidPackages", packageArray);
            obj.put("packageName", packageName);
            obj.put("webDomain", webDomain);
            obj.put("capturedAt", capturedAt);
        } catch (Exception ignored) {
            // Best-effort JSON serialization for local persistence.
        }
        return obj;
    }

    public static AutofillCredential fromJson(JSONObject obj) {
        AutofillCredential cred = new AutofillCredential();
        cred.id = obj.optString("id", "");
        cred.title = obj.optString("title", "");
        cred.username = obj.optString("username", "");
        cred.password = obj.optString("password", "");
        cred.urls = new ArrayList<>();
        JSONArray urlArray = obj.optJSONArray("urls");
        if (urlArray != null) {
            for (int i = 0; i < urlArray.length(); i++) {
                String url = urlArray.optString(i, "").trim();
                if (!url.isEmpty()) {
                    cred.urls.add(url);
                }
            }
        }
        cred.linkedAndroidPackages = new ArrayList<>();
        JSONArray linkedPackages = obj.optJSONArray("linkedAndroidPackages");
        if (linkedPackages != null) {
            for (int i = 0; i < linkedPackages.length(); i++) {
                String linkedPackage = linkedPackages.optString(i, "").trim().toLowerCase();
                if (!linkedPackage.isEmpty() && !cred.linkedAndroidPackages.contains(linkedPackage)) {
                    cred.linkedAndroidPackages.add(linkedPackage);
                }
            }
        }
        cred.packageName = obj.optString("packageName", "").trim().toLowerCase();
        cred.webDomain = obj.optString("webDomain", "").trim().toLowerCase();
        cred.capturedAt = obj.optLong("capturedAt", 0L);
        return cred;
    }

    public static List<AutofillCredential> fromJsonArray(String json) {
        List<AutofillCredential> list = new ArrayList<>();
        if (json == null || json.isEmpty()) return list;
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject row = array.optJSONObject(i);
                if (row == null) continue;
                list.add(fromJson(row));
            }
        } catch (Exception e) {
            // Return empty list on parse failure
        }
        return list;
    }

    public static String toJsonArray(List<AutofillCredential> credentials) {
        JSONArray array = new JSONArray();
        for (AutofillCredential cred : credentials) {
            if (cred == null) continue;
            array.put(cred.toJson());
        }
        return array.toString();
    }
}
