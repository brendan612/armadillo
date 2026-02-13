package com.armadillo.vault.autofill;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class AutofillCredential {
    public String id;
    public String title;
    public String username;
    public String password;
    public List<String> urls;

    public AutofillCredential() {
        this.urls = new ArrayList<>();
    }

    public AutofillCredential(String id, String title, String username, String password, List<String> urls) {
        this.id = id;
        this.title = title;
        this.username = username;
        this.password = password;
        this.urls = urls != null ? urls : new ArrayList<>();
    }

    public JSONObject toJson() throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("id", id);
        obj.put("title", title);
        obj.put("username", username);
        obj.put("password", password);
        JSONArray urlArray = new JSONArray();
        for (String url : urls) {
            urlArray.put(url);
        }
        obj.put("urls", urlArray);
        return obj;
    }

    public static AutofillCredential fromJson(JSONObject obj) throws JSONException {
        AutofillCredential cred = new AutofillCredential();
        cred.id = obj.optString("id", "");
        cred.title = obj.optString("title", "");
        cred.username = obj.optString("username", "");
        cred.password = obj.optString("password", "");
        cred.urls = new ArrayList<>();
        JSONArray urlArray = obj.optJSONArray("urls");
        if (urlArray != null) {
            for (int i = 0; i < urlArray.length(); i++) {
                cred.urls.add(urlArray.getString(i));
            }
        }
        return cred;
    }

    public static List<AutofillCredential> fromJsonArray(String json) {
        List<AutofillCredential> list = new ArrayList<>();
        if (json == null || json.isEmpty()) return list;
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                list.add(fromJson(array.getJSONObject(i)));
            }
        } catch (JSONException e) {
            // Return empty list on parse failure
        }
        return list;
    }

    public static String toJsonArray(List<AutofillCredential> credentials) {
        JSONArray array = new JSONArray();
        for (AutofillCredential cred : credentials) {
            try {
                array.put(cred.toJson());
            } catch (JSONException e) {
                // Skip malformed entries
            }
        }
        return array.toString();
    }
}
