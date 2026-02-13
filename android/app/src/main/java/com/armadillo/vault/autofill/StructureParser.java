package com.armadillo.vault.autofill;

import android.app.assist.AssistStructure;
import android.os.Build;
import android.text.InputType;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;

import androidx.annotation.RequiresApi;

import java.util.ArrayList;
import java.util.List;

@RequiresApi(api = Build.VERSION_CODES.O)
public class StructureParser {

    private final List<AutofillId> usernameIds = new ArrayList<>();
    private final List<AutofillId> passwordIds = new ArrayList<>();
    private String webDomain = null;
    private String packageName = null;

    public void parse(AssistStructure structure) {
        if (structure == null) return;
        packageName = structure.getActivityComponent() != null
                ? structure.getActivityComponent().getPackageName()
                : null;

        for (int i = 0; i < structure.getWindowNodeCount(); i++) {
            AssistStructure.WindowNode windowNode = structure.getWindowNodeAt(i);
            traverseNode(windowNode.getRootViewNode());
        }
    }

    private void traverseNode(AssistStructure.ViewNode node) {
        if (node == null) return;

        if (node.getAutofillId() != null) {
            classifyNode(node);
        }

        if (node.getWebDomain() != null && !node.getWebDomain().isEmpty()) {
            webDomain = node.getWebDomain();
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            traverseNode(node.getChildAt(i));
        }
    }

    private void classifyNode(AssistStructure.ViewNode node) {
        // Check autofill hints first (most reliable)
        String[] hints = node.getAutofillHints();
        if (hints != null) {
            for (String hint : hints) {
                if (isUsernameHint(hint)) {
                    usernameIds.add(node.getAutofillId());
                    return;
                }
                if (isPasswordHint(hint)) {
                    passwordIds.add(node.getAutofillId());
                    return;
                }
            }
        }

        // Check HTML info for web forms
        if (node.getHtmlInfo() != null) {
            ViewStructure.HtmlInfo htmlInfo = node.getHtmlInfo();
            if ("input".equalsIgnoreCase(htmlInfo.getTag())) {
                List<android.util.Pair<String, String>> attrs = htmlInfo.getAttributes();
                if (attrs != null) {
                    String type = null;
                    String name = null;
                    String autocomplete = null;
                    for (android.util.Pair<String, String> attr : attrs) {
                        if ("type".equalsIgnoreCase(attr.first)) type = attr.second;
                        if ("name".equalsIgnoreCase(attr.first)) name = attr.second;
                        if ("autocomplete".equalsIgnoreCase(attr.first)) autocomplete = attr.second;
                    }
                    if ("password".equalsIgnoreCase(type)) {
                        passwordIds.add(node.getAutofillId());
                        return;
                    }
                    if (autocomplete != null) {
                        String ac = autocomplete.toLowerCase();
                        if (ac.contains("username") || ac.contains("email")) {
                            usernameIds.add(node.getAutofillId());
                            return;
                        }
                        if (ac.contains("current-password") || ac.contains("new-password")) {
                            passwordIds.add(node.getAutofillId());
                            return;
                        }
                    }
                    if (name != null) {
                        String n = name.toLowerCase();
                        if (n.contains("user") || n.contains("email") || n.contains("login")) {
                            usernameIds.add(node.getAutofillId());
                            return;
                        }
                        if (n.contains("pass")) {
                            passwordIds.add(node.getAutofillId());
                            return;
                        }
                    }
                }
            }
        }

        // Check input type for native Android views
        int inputType = node.getInputType();
        if (inputType != 0) {
            int variation = inputType & InputType.TYPE_MASK_VARIATION;
            if ((inputType & InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT) {
                if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD
                        || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
                        || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) {
                    passwordIds.add(node.getAutofillId());
                    return;
                }
                if (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                        || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) {
                    usernameIds.add(node.getAutofillId());
                    return;
                }
            }
        }

        // Check resource id as last resort
        String idEntry = node.getIdEntry();
        if (idEntry != null) {
            String id = idEntry.toLowerCase();
            if (id.contains("username") || id.contains("email") || id.contains("login") || id.contains("user_name")) {
                usernameIds.add(node.getAutofillId());
            } else if (id.contains("password") || id.contains("passwd") || id.contains("pass_word")) {
                passwordIds.add(node.getAutofillId());
            }
        }
    }

    private boolean isUsernameHint(String hint) {
        if (hint == null) return false;
        String h = hint.toLowerCase();
        return h.equals(View.AUTOFILL_HINT_USERNAME)
                || h.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS)
                || h.contains("username")
                || h.contains("email");
    }

    private boolean isPasswordHint(String hint) {
        if (hint == null) return false;
        String h = hint.toLowerCase();
        return h.equals(View.AUTOFILL_HINT_PASSWORD)
                || h.contains("password");
    }

    public List<AutofillId> getUsernameIds() { return usernameIds; }
    public List<AutofillId> getPasswordIds() { return passwordIds; }
    public String getWebDomain() { return webDomain; }
    public String getPackageName() { return packageName; }

    public boolean hasFields() {
        return !usernameIds.isEmpty() || !passwordIds.isEmpty();
    }
}
