package com.shortly.api.domain;

import java.time.Instant;

public record ClickEvent(
    String shortCode,
    String referrer,
    String userAgent,
    String ipAddress,
    Instant clickedAt
) {}
