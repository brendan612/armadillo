package com.armadillo.vault.autofill;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.List;

public class CredentialStore {

    private static final String PREFS_FILE = "armadillo_autofill_store";
    private static final String KEY_CREDENTIALS = "credentials_json";
    private static final String KEY_UPDATED_AT = "updated_at";

    private final SharedPreferences prefs;

    public CredentialStore(Context context) throws GeneralSecurityException, IOException {
        MasterKey masterKey = new MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();

        prefs = EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
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

    public void clear() {
        prefs.edit().clear().apply();
    }

    public boolean hasCredentials() {
        String json = prefs.getString(KEY_CREDENTIALS, null);
        return json != null && !json.equals("[]") && !json.isEmpty();
    }

    public long getLastUpdatedTimestamp() {
        return prefs.getLong(KEY_UPDATED_AT, 0);
    }
}
