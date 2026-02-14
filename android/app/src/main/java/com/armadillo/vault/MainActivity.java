package com.armadillo.vault;

import android.os.Bundle;

import com.armadillo.vault.autofill.AutofillBridgePlugin;
import com.armadillo.vault.biometric.BiometricBridgePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutofillBridgePlugin.class);
        registerPlugin(BiometricBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
