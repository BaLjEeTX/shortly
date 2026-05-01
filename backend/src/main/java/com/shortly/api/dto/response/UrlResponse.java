package com.shortly.api.dto.response;

import com.shortly.api.domain.Url;
import java.time.Instant;

public record UrlResponse(
    Long id,
    String shortCode,
    String shortUrl,
    String longUrl,
    String title,
    Instant createdAt,
    Long clickCount
) {
    public static UrlResponse from(Url url, String baseUrl, Long clickCount) {
        return new UrlResponse(
            url.getId(),
            url.getShortCode(),
            baseUrl + "/" + url.getShortCode(),
            url.getLongUrl(),
            url.getTitle(),
            url.getCreatedAt(),
            clickCount
        );
    }

    /** Build a response for an ephemeral, Redis-only anonymous URL (no DB row, no id). */
    public static UrlResponse anon(String shortCode, String longUrl, String baseUrl) {
        return new UrlResponse(
            null,
            shortCode,
            baseUrl + "/" + shortCode,
            longUrl,
            null,
            Instant.now(),
            0L
        );
    }
}
