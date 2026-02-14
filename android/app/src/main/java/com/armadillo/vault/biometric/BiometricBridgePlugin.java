package com.armadillo.vault.biometric;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.Key;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "BiometricBridge")
public class BiometricBridgePlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_AUTH_TAG_LENGTH_BITS = 128;
    private static final int BIOMETRIC_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    @PluginMethod
    public void getStatus(PluginCall call) {
        BiometricManager biometricManager = BiometricManager.from(getContext());
        int status = biometricManager.canAuthenticate(BIOMETRIC_AUTHENTICATORS);

        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS || status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        result.put("enrolled", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("canAuthenticate", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("reason", mapStatusReason(status));
        call.resolve(result);
    }

    @PluginMethod
    public void wrapVaultKey(PluginCall call) {
        String rawVaultKeyBase64 = call.getString("rawVaultKeyBase64");
        if (rawVaultKeyBase64 == null || rawVaultKeyBase64.trim().isEmpty()) {
            call.reject("Missing rawVaultKeyBase64");
            return;
        }

        String keyAlias = call.getString("keyAlias", "armadillo_biometric_vault_key");
        byte[] rawVaultKey;
        try {
            rawVaultKey = decodeBase64(rawVaultKeyBase64);
        } catch (Exception e) {
            call.reject("rawVaultKeyBase64 is invalid");
            return;
        }

        try {
            SecretKey secretKey = getOrCreateSecretKey(keyAlias);
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);

            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Enable Biometric Unlock")
                .setSubtitle("Confirm biometric to secure quick unlock")
                .setAllowedAuthenticators(BIOMETRIC_AUTHENTICATORS)
                .setNegativeButtonText("Cancel")
                .build();

            authenticateWithCipher(call, promptInfo, cipher, true, keyAlias, rawVaultKey);
        } catch (Exception e) {
            call.reject("Biometric enrollment preparation failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unwrapVaultKey(PluginCall call) {
        String keyAlias = call.getString("keyAlias");
        String ivBase64 = call.getString("ivBase64");
        String ciphertextBase64 = call.getString("ciphertextBase64");

        if (keyAlias == null || keyAlias.trim().isEmpty()) {
            call.reject("Missing keyAlias");
            return;
        }
        if (ivBase64 == null || ivBase64.trim().isEmpty()) {
            call.reject("Missing ivBase64");
            return;
        }
        if (ciphertextBase64 == null || ciphertextBase64.trim().isEmpty()) {
            call.reject("Missing ciphertextBase64");
            return;
        }

        byte[] iv;
        byte[] ciphertext;
        try {
            iv = decodeBase64(ivBase64);
            ciphertext = decodeBase64(ciphertextBase64);
        } catch (Exception e) {
            call.reject("Encrypted biometric payload is invalid");
            return;
        }

        try {
            SecretKey secretKey = getExistingSecretKey(keyAlias);
            if (secretKey == null) {
                call.reject("Biometric key is unavailable");
                return;
            }

            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_AUTH_TAG_LENGTH_BITS, iv));

            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Armadillo")
                .setSubtitle("Confirm biometric to unlock your vault")
                .setAllowedAuthenticators(BIOMETRIC_AUTHENTICATORS)
                .setNegativeButtonText("Cancel")
                .build();

            authenticateWithCipher(call, promptInfo, cipher, false, keyAlias, ciphertext);
        } catch (Exception e) {
            call.reject("Biometric unlock preparation failed: " + e.getMessage());
        }
    }

    private void authenticateWithCipher(
        PluginCall call,
        BiometricPrompt.PromptInfo promptInfo,
        Cipher cipher,
        boolean encryptMode,
        String keyAlias,
        byte[] payload
    ) {
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("Biometric prompt unavailable: no active activity");
            return;
        }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        call.reject("Biometric authentication failed: " + errString);
                    }

                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        BiometricPrompt.CryptoObject cryptoObject = result.getCryptoObject();
                        Cipher authenticatedCipher = cryptoObject != null ? cryptoObject.getCipher() : null;
                        if (authenticatedCipher == null) {
                            call.reject("Biometric authentication returned no cipher");
                            return;
                        }

                        try {
                            if (encryptMode) {
                                byte[] ciphertext = authenticatedCipher.doFinal(payload);
                                byte[] iv = authenticatedCipher.getIV();
                                JSObject response = new JSObject();
                                response.put("keyAlias", keyAlias);
                                response.put("ivBase64", encodeBase64(iv));
                                response.put("ciphertextBase64", encodeBase64(ciphertext));
                                call.resolve(response);
                            } else {
                                byte[] rawVaultKey = authenticatedCipher.doFinal(payload);
                                JSObject response = new JSObject();
                                response.put("rawVaultKeyBase64", encodeBase64(rawVaultKey));
                                call.resolve(response);
                            }
                        } catch (Exception e) {
                            call.reject("Biometric crypto operation failed: " + e.getMessage());
                        }
                    }
                }
            );

            prompt.authenticate(promptInfo, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey getExistingSecretKey(String alias) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);

        if (!keyStore.containsAlias(alias)) {
            return null;
        }

        Key key = keyStore.getKey(alias, null);
        if (!(key instanceof SecretKey)) {
            return null;
        }

        return (SecretKey) key;
    }

    private SecretKey getOrCreateSecretKey(String alias) throws Exception {
        SecretKey existing = getExistingSecretKey(alias);
        if (existing != null) {
            return existing;
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setInvalidatedByBiometricEnrollment(true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            builder.setUserAuthenticationValidityDurationSeconds(-1);
        }

        keyGenerator.init(builder.build());
        return keyGenerator.generateKey();
    }

    private String mapStatusReason(int status) {
        if (status == BiometricManager.BIOMETRIC_SUCCESS) return "ok";
        if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "none_enrolled";
        if (status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) return "no_hardware";
        if (status == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) return "hw_unavailable";
        return "unknown";
    }

    private static String encodeBase64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static byte[] decodeBase64(String value) {
        return Base64.decode(value, Base64.NO_WRAP);
    }
}
