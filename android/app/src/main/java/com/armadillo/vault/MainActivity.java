package com.armadillo.vault;

import android.os.Bundle;

import com.armadillo.vault.autofill.AutofillBridgePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutofillBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
