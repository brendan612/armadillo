package com.armadillo.vault.autofill;

import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveRequest;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;

import androidx.annotation.RequiresApi;

import com.armadillo.vault.MainActivity;
import com.armadillo.vault.R;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@RequiresApi(api = Build.VERSION_CODES.O)
public class ArmadilloAutofillService extends AutofillService {

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback) {
        AssistStructure lastStructure = request.getFillContexts()
                .get(request.getFillContexts().size() - 1)
                .getStructure();
        List<AssistStructure> structures = lastStructure != null
                ? Collections.singletonList(lastStructure)
                : new ArrayList<>();

        if (structures.isEmpty()) {
            callback.onSuccess(null);
            return;
        }

        StructureParser parser = new StructureParser();
        for (AssistStructure structure : structures) {
            parser.parse(structure);
        }

        if (!parser.hasFields()) {
            callback.onSuccess(null);
            return;
        }

        // Ignore our own app
        if ("com.armadillo.vault".equals(parser.getPackageName())) {
            callback.onSuccess(null);
            return;
        }

        List<AutofillCredential> credentials;
        try {
            CredentialStore store = new CredentialStore(this);
            credentials = store.loadCredentials();
        } catch (Exception e) {
            callback.onSuccess(null);
            return;
        }

        AutofillId usernameId = parser.getUsernameIds().isEmpty() ? null : parser.getUsernameIds().get(0);
        AutofillId passwordId = parser.getPasswordIds().isEmpty() ? null : parser.getPasswordIds().get(0);

        if (usernameId == null && passwordId == null) {
            callback.onSuccess(null);
            return;
        }

        // If vault is locked (no credentials synced), offer unlock
        if (credentials.isEmpty()) {
            FillResponse.Builder responseBuilder = new FillResponse.Builder();
            Dataset.Builder authDataset = new Dataset.Builder();

            RemoteViews authPresentation = new RemoteViews(getPackageName(), R.layout.autofill_item);
            authPresentation.setTextViewText(R.id.autofill_item_title, "Armadillo");
            authPresentation.setTextViewText(R.id.autofill_item_username, "Tap to unlock vault");

            Intent authIntent = new Intent(this, MainActivity.class);
            authIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            IntentSender sender = PendingIntent.getActivity(
                    this, 1001, authIntent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            ).getIntentSender();

            if (usernameId != null) {
                authDataset.setValue(usernameId, AutofillValue.forText(""), authPresentation);
            }
            if (passwordId != null) {
                authDataset.setValue(passwordId, AutofillValue.forText(""), authPresentation);
            }
            authDataset.setAuthentication(sender);

            responseBuilder.addDataset(authDataset.build());

            try {
                callback.onSuccess(responseBuilder.build());
            } catch (Exception e) {
                callback.onSuccess(null);
            }
            return;
        }

        // Filter by domain if available
        List<AutofillCredential> matched = filterByDomain(credentials, parser.getWebDomain());

        // Build fill response
        FillResponse.Builder responseBuilder = new FillResponse.Builder();
        int count = 0;

        for (AutofillCredential cred : matched) {
            if (count >= 10) break; // Limit suggestions

            RemoteViews presentation = new RemoteViews(getPackageName(), R.layout.autofill_item);
            presentation.setTextViewText(R.id.autofill_item_title, cred.title);
            presentation.setTextViewText(R.id.autofill_item_username, cred.username);

            Dataset.Builder datasetBuilder = new Dataset.Builder();
            if (usernameId != null) {
                datasetBuilder.setValue(usernameId, AutofillValue.forText(cred.username), presentation);
            }
            if (passwordId != null) {
                datasetBuilder.setValue(passwordId, AutofillValue.forText(cred.password), presentation);
            }

            responseBuilder.addDataset(datasetBuilder.build());
            count++;
        }

        if (count == 0) {
            callback.onSuccess(null);
            return;
        }

        try {
            callback.onSuccess(responseBuilder.build());
        } catch (Exception e) {
            callback.onSuccess(null);
        }
    }

    @Override
    public void onSaveRequest(SaveRequest request, SaveCallback callback) {
        // Armadillo manages its own credential storage; no system-level save needed
        callback.onSuccess();
    }

    private List<AutofillCredential> filterByDomain(List<AutofillCredential> credentials, String webDomain) {
        if (webDomain == null || webDomain.isEmpty()) {
            return credentials; // No domain to filter by — show all
        }

        String targetDomain = extractDomain(webDomain);
        List<AutofillCredential> matched = new ArrayList<>();

        for (AutofillCredential cred : credentials) {
            for (String url : cred.urls) {
                String credDomain = extractDomain(url);
                if (credDomain != null && domainMatches(credDomain, targetDomain)) {
                    matched.add(cred);
                    break;
                }
            }
        }

        // If no domain matches, fall back to all credentials
        return matched.isEmpty() ? credentials : matched;
    }

    private String extractDomain(String urlOrDomain) {
        if (urlOrDomain == null || urlOrDomain.isEmpty()) return null;
        try {
            String normalized = urlOrDomain;
            if (!normalized.contains("://")) {
                normalized = "https://" + normalized;
            }
            URI uri = new URI(normalized);
            String host = uri.getHost();
            return host != null ? host.toLowerCase() : urlOrDomain.toLowerCase();
        } catch (Exception e) {
            return urlOrDomain.toLowerCase();
        }
    }

    private boolean domainMatches(String credDomain, String targetDomain) {
        if (credDomain.equals(targetDomain)) return true;
        // Match subdomains: login.example.com matches example.com
        return credDomain.endsWith("." + targetDomain) || targetDomain.endsWith("." + credDomain);
    }
}
