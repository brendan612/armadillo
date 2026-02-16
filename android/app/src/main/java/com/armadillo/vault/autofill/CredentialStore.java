package com.armadillo.vault.autofill;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.util.List;

public class CredentialStore {

    private static final String PREFS_FILE = "armadillo_autofill_store";
    private static final String PREFS_FILE_FALLBACK = "armadillo_autofill_store_fallback";
    private static final String KEY_CREDENTIALS = "credentials_json";
    private static final String KEY_CAPTURED = "captured_credentials_json";
    private static final String KEY_UPDATED_AT = "updated_at";

    private final SharedPreferences prefs;

    public CredentialStore(Context context) {
        SharedPreferences selectedPrefs;
        try {
            MasterKey masterKey = new MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();

            selectedPrefs = EncryptedSharedPreferences.create(
                    context,
                    PREFS_FILE,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception ignored) {
            // Some OEM/device configurations can fail to initialize encrypted prefs
            // in AutofillService contexts; keep autofill functional with a local fallback.
            selectedPrefs = context.getSharedPreferences(PREFS_FILE_FALLBACK, Context.MODE_PRIVATE);
        }

        prefs = selectedPrefs;
    }

    public void saveCredentials(List<AutofillCredential> credentials) {
        String json = AutofillCredential.toJsonArray(credentials);
        prefs.edit()
                .putString(KEY_CREDENTIALS, json)
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .apply();
    }

    public List<AutofillCredential> loadCredentials() {
        String json = prefs.getString(KEY_CREDENTIALS, null);
        return AutofillCredential.fromJsonArray(json);
    }

    public List<AutofillCredential> loadCapturedCredentials() {
        String json = prefs.getString(KEY_CAPTURED, null);
        return AutofillCredential.fromJsonArray(json);
    }

    public void saveCapturedCredentials(List<AutofillCredential> captures) {
        String json = AutofillCredential.toJsonArray(captures);
        prefs.edit()
                .putString(KEY_CAPTURED, json)
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .apply();
    }

    public void appendCapturedCredential(AutofillCredential capture) {
        List<AutofillCredential> existing = loadCapturedCredentials();
        existing.add(capture);
        saveCapturedCredentials(existing);
    }

    public List<AutofillCredential> consumeCapturedCredentials() {
        List<AutofillCredential> captures = loadCapturedCredentials();
        prefs.edit()
                .remove(KEY_CAPTURED)
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .apply();
        return captures;
    }

    public void clear() {
        prefs.edit().clear().apply();
    }

    public boolean hasCredentials() {
        String json = prefs.getString(KEY_CREDENTIALS, null);
        return json != null && !json.equals("[]") && !json.isEmpty();
    }

    public boolean hasCapturedCredentials() {
        String json = prefs.getString(KEY_CAPTURED, null);
        return json != null && !json.equals("[]") && !json.isEmpty();
    }

    public long getLastUpdatedTimestamp() {
        return prefs.getLong(KEY_UPDATED_AT, 0);
    }
}
