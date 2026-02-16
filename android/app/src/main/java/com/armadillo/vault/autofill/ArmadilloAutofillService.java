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
import android.service.autofill.SaveInfo;
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
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RequiresApi(api = Build.VERSION_CODES.O)
public class ArmadilloAutofillService extends AutofillService {
    private static final String APP_PACKAGE_NAME = "com.armadillo.vault";
    private static final int MAX_SUGGESTIONS = 10;

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback) {
        AssistStructure structure = getLatestStructure(request);
        if (structure == null) {
            callback.onSuccess(null);
            return;
        }

        StructureParser parser = new StructureParser();
        parser.parse(structure);

        if (!parser.hasFields()) {
            callback.onSuccess(null);
            return;
        }

        if (APP_PACKAGE_NAME.equals(parser.getPackageName())) {
            callback.onSuccess(null);
            return;
        }

        AutofillId usernameId = parser.getUsernameIds().isEmpty() ? null : parser.getUsernameIds().get(0);
        AutofillId passwordId = parser.getPasswordIds().isEmpty() ? null : parser.getPasswordIds().get(0);
        if (usernameId == null && passwordId == null) {
            callback.onSuccess(null);
            return;
        }

        List<AutofillCredential> credentials = new ArrayList<>();
        try {
            CredentialStore store = new CredentialStore(this);
            credentials = store.loadCredentials();
        } catch (Exception ignored) {
            // Treat store failures as locked/empty so the unlock dataset can still appear.
        }

        if (credentials.isEmpty()) {
            callback.onSuccess(buildUnlockResponse(usernameId, passwordId));
            return;
        }

        List<AutofillCredential> ranked;
        try {
            ranked = rankCredentials(credentials, parser.getWebDomain(), parser.getPackageName());
        } catch (Exception ignored) {
            ranked = credentials;
        }
        FillResponse.Builder responseBuilder = new FillResponse.Builder();
        SaveInfo saveInfo = buildSaveInfo(usernameId, passwordId);
        if (saveInfo != null) {
            responseBuilder.setSaveInfo(saveInfo);
        }

        int count = 0;
        for (AutofillCredential cred : ranked) {
            if (count >= MAX_SUGGESTIONS) break;
            if ((cred.username == null || cred.username.trim().isEmpty())
                    && (cred.password == null || cred.password.trim().isEmpty())) {
                continue;
            }

            String title = safeText(cred.title, "Credential");
            String subtitle = safeText(cred.username, "Tap to fill");
            RemoteViews presentation = new RemoteViews(getPackageName(), R.layout.autofill_item);
            presentation.setTextViewText(R.id.autofill_item_title, title);
            presentation.setTextViewText(R.id.autofill_item_username, subtitle);

            Dataset.Builder datasetBuilder = new Dataset.Builder();
            if (usernameId != null) {
                datasetBuilder.setValue(usernameId, AutofillValue.forText(safeText(cred.username, "")), presentation);
            }
            if (passwordId != null) {
                datasetBuilder.setValue(passwordId, AutofillValue.forText(safeText(cred.password, "")), presentation);
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
        AssistStructure structure = getLatestStructure(request);
        if (structure == null) {
            callback.onSuccess();
            return;
        }

        StructureParser parser = new StructureParser();
        parser.parse(structure);

        if (!parser.hasFields() || APP_PACKAGE_NAME.equals(parser.getPackageName())) {
            callback.onSuccess();
            return;
        }

        Map<String, String> valuesById = new HashMap<>();
        collectAutofillValues(structure, valuesById);

        String username = firstValueForIds(parser.getUsernameIds(), valuesById);
        String password = firstValueForIds(parser.getPasswordIds(), valuesById);
        if (username.isEmpty() || password.isEmpty()) {
            callback.onSuccess();
            return;
        }

        String packageName = safeText(parser.getPackageName(), "").trim().toLowerCase(Locale.US);
        String webDomain = normalizeDomain(parser.getWebDomain());

        AutofillCredential capture = new AutofillCredential();
        capture.id = UUID.randomUUID().toString();
        capture.username = username;
        capture.password = password;
        capture.packageName = packageName;
        capture.webDomain = webDomain;
        capture.capturedAt = System.currentTimeMillis();
        capture.title = inferCaptureTitle(webDomain, packageName, username);
        if (!webDomain.isEmpty()) {
            capture.urls.add("https://" + webDomain);
        }
        if (!packageName.isEmpty()) {
            capture.linkedAndroidPackages.add(packageName);
        }

        try {
            CredentialStore store = new CredentialStore(this);
            List<AutofillCredential> existing = store.loadCredentials();
            for (AutofillCredential credential : existing) {
                if (credentialsEquivalent(credential, capture)) {
                    callback.onSuccess();
                    return;
                }
            }

            List<AutofillCredential> pending = store.loadCapturedCredentials();
            for (AutofillCredential pendingCapture : pending) {
                if (credentialsEquivalent(pendingCapture, capture)) {
                    callback.onSuccess();
                    return;
                }
            }

            store.appendCapturedCredential(capture);
        } catch (Exception ignored) {
            // Non-fatal for platform save flow.
        }

        callback.onSuccess();
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
            if (host == null) {
                return urlOrDomain.toLowerCase(Locale.US);
            }
            return host.toLowerCase(Locale.US).replaceFirst("^www\\.", "");
        } catch (Exception e) {
            return urlOrDomain.toLowerCase(Locale.US).replaceFirst("^www\\.", "");
        }
    }

    private boolean domainMatches(String credDomain, String targetDomain) {
        if (credDomain == null || targetDomain == null) return false;
        if (credDomain.equals(targetDomain)) return true;
        return credDomain.endsWith("." + targetDomain) || targetDomain.endsWith("." + credDomain);
    }

    private AssistStructure getLatestStructure(FillRequest request) {
        if (request == null || request.getFillContexts() == null || request.getFillContexts().isEmpty()) {
            return null;
        }
        return request.getFillContexts()
                .get(request.getFillContexts().size() - 1)
                .getStructure();
    }

    private AssistStructure getLatestStructure(SaveRequest request) {
        if (request == null || request.getFillContexts() == null || request.getFillContexts().isEmpty()) {
            return null;
        }
        return request.getFillContexts()
                .get(request.getFillContexts().size() - 1)
                .getStructure();
    }

    private FillResponse buildUnlockResponse(AutofillId usernameId, AutofillId passwordId) {
        FillResponse.Builder responseBuilder = new FillResponse.Builder();
        SaveInfo saveInfo = buildSaveInfo(usernameId, passwordId);
        if (saveInfo != null) {
            responseBuilder.setSaveInfo(saveInfo);
        }

        Dataset.Builder authDataset = new Dataset.Builder();
        RemoteViews authPresentation = new RemoteViews(getPackageName(), R.layout.autofill_item);
        authPresentation.setTextViewText(R.id.autofill_item_title, "Armadillo");
        authPresentation.setTextViewText(R.id.autofill_item_username, "Unlock Armadillo to fill credentials");

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
        return responseBuilder.build();
    }

    private SaveInfo buildSaveInfo(AutofillId usernameId, AutofillId passwordId) {
        List<AutofillId> requiredIds = new ArrayList<>();
        int saveType = 0;

        if (usernameId != null) {
            requiredIds.add(usernameId);
            saveType |= SaveInfo.SAVE_DATA_TYPE_USERNAME;
        }
        if (passwordId != null) {
            requiredIds.add(passwordId);
            saveType |= SaveInfo.SAVE_DATA_TYPE_PASSWORD;
        }

        if (requiredIds.isEmpty() || saveType == 0) {
            return null;
        }
        return new SaveInfo.Builder(saveType, requiredIds.toArray(new AutofillId[0])).build();
    }

    private void collectAutofillValues(AssistStructure structure, Map<String, String> valuesById) {
        for (int i = 0; i < structure.getWindowNodeCount(); i++) {
            AssistStructure.WindowNode windowNode = structure.getWindowNodeAt(i);
            collectNodeValues(windowNode.getRootViewNode(), valuesById);
        }
    }

    private void collectNodeValues(AssistStructure.ViewNode node, Map<String, String> valuesById) {
        if (node == null) return;

        AutofillId autofillId = node.getAutofillId();
        AutofillValue autofillValue = node.getAutofillValue();
        if (autofillId != null && autofillValue != null && autofillValue.isText()) {
            CharSequence textValue = autofillValue.getTextValue();
            if (textValue != null) {
                String trimmed = textValue.toString().trim();
                if (!trimmed.isEmpty()) {
                    valuesById.put(autofillId.toString(), trimmed);
                }
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            collectNodeValues(node.getChildAt(i), valuesById);
        }
    }

    private String firstValueForIds(List<AutofillId> ids, Map<String, String> valuesById) {
        for (AutofillId id : ids) {
            String value = valuesById.get(id.toString());
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    private String normalizeDomain(String rawDomain) {
        String extracted = extractDomain(rawDomain);
        return extracted == null ? "" : extracted;
    }

    private String safeText(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }

    private String inferCaptureTitle(String webDomain, String packageName, String username) {
        if (webDomain != null && !webDomain.isEmpty()) {
            return webDomain;
        }
        if (packageName != null && !packageName.isEmpty()) {
            List<String> tokens = AppDomainHeuristics.derivePackageTokens(packageName);
            if (!tokens.isEmpty()) {
                return tokens.get(0);
            }
            return packageName;
        }
        if (username != null && !username.isEmpty()) {
            return username;
        }
        return "Captured Credential";
    }

    private List<AutofillCredential> rankCredentials(List<AutofillCredential> credentials, String webDomain, String packageName) {
        String targetDomain = normalizeDomain(webDomain);
        String targetPackage = safeText(packageName, "").toLowerCase(Locale.US);
        List<String> candidateDomains = AppDomainHeuristics.deriveCandidateDomains(targetPackage);
        List<String> packageTokens = AppDomainHeuristics.derivePackageTokens(targetPackage);

        List<ScoredCredential> scored = new ArrayList<>();
        for (AutofillCredential credential : credentials) {
            int score = 0;
            String title = safeText(credential.title, "").toLowerCase(Locale.US);
            String username = safeText(credential.username, "").toLowerCase(Locale.US);
            Set<String> credentialDomains = extractCredentialDomains(credential);
            Set<String> credentialPackages = extractCredentialPackages(credential);

            if (!targetPackage.isEmpty() && credentialPackages.contains(targetPackage)) {
                score += 200;
            }

            if (!targetDomain.isEmpty()) {
                for (String domain : credentialDomains) {
                    if (domain.equals(targetDomain)) {
                        score += 140;
                    } else if (domainMatches(domain, targetDomain)) {
                        score += 110;
                    }
                }
            }

            for (String candidateDomain : candidateDomains) {
                for (String domain : credentialDomains) {
                    if (domain.equals(candidateDomain)) {
                        score += 90;
                    } else if (domainMatches(domain, candidateDomain)) {
                        score += 70;
                    }
                }
            }

            for (String token : packageTokens) {
                if (title.contains(token)) score += 8;
                if (username.contains(token)) score += 4;
            }

            if (score == 0) {
                score = 1;
            }
            scored.add(new ScoredCredential(credential, score));
        }

        Collections.sort(scored, new Comparator<ScoredCredential>() {
            @Override
            public int compare(ScoredCredential left, ScoredCredential right) {
                int scoreCompare = Integer.compare(right.score, left.score);
                if (scoreCompare != 0) return scoreCompare;

                String leftTitle = safeText(left.credential.title, "").toLowerCase(Locale.US);
                String rightTitle = safeText(right.credential.title, "").toLowerCase(Locale.US);
                int titleCompare = leftTitle.compareTo(rightTitle);
                if (titleCompare != 0) return titleCompare;

                String leftUser = safeText(left.credential.username, "").toLowerCase(Locale.US);
                String rightUser = safeText(right.credential.username, "").toLowerCase(Locale.US);
                return leftUser.compareTo(rightUser);
            }
        });

        List<AutofillCredential> ranked = new ArrayList<>();
        for (ScoredCredential row : scored) {
            ranked.add(row.credential);
        }
        return ranked;
    }

    private Set<String> extractCredentialDomains(AutofillCredential credential) {
        Set<String> domains = new HashSet<>();
        for (String url : credential.urls) {
            String domain = extractDomain(url);
            if (domain != null && !domain.isEmpty()) {
                domains.add(domain);
            }
        }
        String directDomain = extractDomain(credential.webDomain);
        if (directDomain != null && !directDomain.isEmpty()) {
            domains.add(directDomain);
        }
        return domains;
    }

    private Set<String> extractCredentialPackages(AutofillCredential credential) {
        Set<String> packages = new HashSet<>();
        if (credential.linkedAndroidPackages != null) {
            for (String linkedPackage : credential.linkedAndroidPackages) {
                if (linkedPackage == null) continue;
                String normalized = linkedPackage.trim().toLowerCase(Locale.US);
                if (!normalized.isEmpty()) {
                    packages.add(normalized);
                }
            }
        }
        if (credential.packageName != null) {
            String normalizedPackage = credential.packageName.trim().toLowerCase(Locale.US);
            if (!normalizedPackage.isEmpty()) {
                packages.add(normalizedPackage);
            }
        }
        return packages;
    }

    private boolean credentialsEquivalent(AutofillCredential left, AutofillCredential right) {
        String leftUser = safeText(left.username, "").toLowerCase(Locale.US);
        String rightUser = safeText(right.username, "").toLowerCase(Locale.US);
        if (leftUser.isEmpty() || rightUser.isEmpty() || !leftUser.equals(rightUser)) {
            return false;
        }

        Set<String> leftPackages = extractCredentialPackages(left);
        Set<String> rightPackages = extractCredentialPackages(right);
        for (String linkedPackage : leftPackages) {
            if (rightPackages.contains(linkedPackage)) {
                return true;
            }
        }

        Set<String> leftDomains = extractCredentialDomains(left);
        Set<String> rightDomains = extractCredentialDomains(right);
        for (String leftDomain : leftDomains) {
            for (String rightDomain : rightDomains) {
                if (domainMatches(leftDomain, rightDomain)) {
                    return true;
                }
            }
        }

        return leftPackages.isEmpty() && rightPackages.isEmpty() && leftDomains.isEmpty() && rightDomains.isEmpty();
    }

    private static final class ScoredCredential {
        private final AutofillCredential credential;
        private final int score;

        private ScoredCredential(AutofillCredential credential, int score) {
            this.credential = credential;
            this.score = score;
        }
    }
}
