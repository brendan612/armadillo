package com.armadillo.vault.autofill;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class AppDomainHeuristics {
    private static final Set<String> PACKAGE_NOISE_TOKENS = new HashSet<>(Arrays.asList(
            "com", "org", "net", "io", "co", "app", "android", "mobile", "client",
            "prod", "debug", "release", "beta", "alpha", "free", "global"
    ));

    private static final Map<String, List<String>> PACKAGE_DOMAIN_OVERRIDES;
    static {
        Map<String, List<String>> overrides = new HashMap<>();
        overrides.put("com.instagram.android", Collections.singletonList("instagram.com"));
        overrides.put("com.facebook.katana", Collections.singletonList("facebook.com"));
        overrides.put("com.google.android.gm", Arrays.asList("mail.google.com", "google.com"));
        overrides.put("com.whatsapp", Collections.singletonList("whatsapp.com"));
        overrides.put("com.twitter.android", Arrays.asList("x.com", "twitter.com"));
        overrides.put("com.snapchat.android", Collections.singletonList("snapchat.com"));
        PACKAGE_DOMAIN_OVERRIDES = Collections.unmodifiableMap(overrides);
    }

    private AppDomainHeuristics() {}

    public static List<String> deriveCandidateDomains(String packageName) {
        if (packageName == null) return Collections.emptyList();
        String normalized = packageName.trim().toLowerCase(Locale.US);
        if (normalized.isEmpty()) return Collections.emptyList();

        List<String> candidates = new ArrayList<>();
        Set<String> deduped = new HashSet<>();

        List<String> overrideDomains = PACKAGE_DOMAIN_OVERRIDES.get(normalized);
        if (overrideDomains != null) {
            for (String domain : overrideDomains) {
                String candidate = domain.trim().toLowerCase(Locale.US);
                if (!candidate.isEmpty() && deduped.add(candidate)) {
                    candidates.add(candidate);
                }
            }
        }

        List<String> tokens = derivePackageTokens(normalized);
        for (String token : tokens) {
            String candidate = token + ".com";
            if (deduped.add(candidate)) {
                candidates.add(candidate);
            }
        }

        return candidates;
    }

    public static List<String> derivePackageTokens(String packageName) {
        if (packageName == null) return Collections.emptyList();
        String normalized = packageName.trim().toLowerCase(Locale.US);
        if (normalized.isEmpty()) return Collections.emptyList();

        String[] rawParts = normalized.split("\\.");
        List<String> tokens = new ArrayList<>();
        Set<String> deduped = new HashSet<>();
        for (String raw : rawParts) {
            String part = raw.trim();
            if (part.isEmpty() || PACKAGE_NOISE_TOKENS.contains(part)) continue;
            if (part.length() < 2) continue;
            if (!deduped.add(part)) continue;
            tokens.add(part);
        }
        return tokens;
    }
}
