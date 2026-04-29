package com.shortly.api.util;

import com.shortly.api.exception.InvalidUrlException;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Set;

@Component
public class UrlValidator {

    private static final Set<String> ALLOWED_SCHEMES = Set.of("http", "https");

    public void validateOrThrow(String url) {
        if (url == null || url.isBlank()) {
            throw new InvalidUrlException("URL cannot be empty");
        }
        if (url.length() > 2048) {
            throw new InvalidUrlException("URL exceeds 2048 characters");
        }

        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw new InvalidUrlException("Malformed URL");
        }

        if (uri.getScheme() == null
            || !ALLOWED_SCHEMES.contains(uri.getScheme().toLowerCase())) {
            throw new InvalidUrlException("Only http and https URLs are allowed");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new InvalidUrlException("URL must contain a host");
        }
        // Block localhost/private IPs to prevent SSRF if we ever fetch URLs server-side
        String host = uri.getHost().toLowerCase();
        if (host.equals("localhost") || host.startsWith("127.")
            || host.startsWith("10.") || host.startsWith("192.168.")
            || host.equals("0.0.0.0")) {
            throw new InvalidUrlException("Private/local URLs are not allowed");
        }
    }
}
