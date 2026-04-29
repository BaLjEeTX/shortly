package com.shortly.api.controller;

import com.shortly.api.domain.ClickEvent;
import com.shortly.api.exception.ShortCodeNotFoundException;
import com.shortly.api.service.ClickEventBuffer;
import com.shortly.api.service.UrlLookupService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Instant;

@RestController
@RequiredArgsConstructor
public class RedirectController {

    private final UrlLookupService urlLookupService;
    private final ClickEventBuffer clickEventBuffer;

    @GetMapping("/{shortCode:[a-zA-Z0-9]{1,10}}")
    public ResponseEntity<Void> redirect(
            @PathVariable String shortCode,
            HttpServletRequest request) {

        String longUrl = urlLookupService.resolve(shortCode)
            .orElseThrow(() -> new ShortCodeNotFoundException(shortCode));

        // Async, non-blocking: drop on full buffer is acceptable for analytics
        clickEventBuffer.record(new ClickEvent(
            shortCode,
            request.getHeader(HttpHeaders.REFERER),
            truncate(request.getHeader(HttpHeaders.USER_AGENT), 512),
            request.getRemoteAddr(),
            Instant.now()
        ));

        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(longUrl))
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=0, no-cache")
            .build();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
