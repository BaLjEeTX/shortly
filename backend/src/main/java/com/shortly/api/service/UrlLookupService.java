package com.shortly.api.service;

import com.shortly.api.repository.UrlRepository;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class UrlLookupService {

    private final UrlRepository urlRepository;
    private final StringRedisTemplate redis;
    private final MeterRegistry meterRegistry;

    @Value("${app.cache.url-ttl}")
    private Duration urlTtl;

    @Value("${app.cache.not-found-ttl}")
    private Duration notFoundTtl;

    private static final String CACHE_PREFIX = "url:";
    private static final String NOT_FOUND_MARKER = "__NF__";

    /**
     * Returns the long URL for a short code, or empty if not found.
     * Cache-aside pattern with negative caching to prevent cache penetration.
     */
    public Optional<String> resolve(String shortCode) {
        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            // 1. Cache lookup
            String cached = redis.opsForValue().get(CACHE_PREFIX + shortCode);
            if (cached != null) {
                if (NOT_FOUND_MARKER.equals(cached)) {
                    meterRegistry.counter("redirect.cache", "result", "negative_hit").increment();
                    return Optional.empty();
                }
                meterRegistry.counter("redirect.cache", "result", "hit").increment();
                return Optional.of(cached);
            }

            meterRegistry.counter("redirect.cache", "result", "miss").increment();

            // 2. DB fallback
            Optional<String> longUrl = urlRepository
                .findActiveLongUrlByShortCode(shortCode);

            // 3. Populate cache (positive or negative)
            if (longUrl.isPresent()) {
                redis.opsForValue().set(CACHE_PREFIX + shortCode, longUrl.get(), urlTtl);
            } else {
                redis.opsForValue().set(
                    CACHE_PREFIX + shortCode, NOT_FOUND_MARKER, notFoundTtl);
            }
            return longUrl;

        } finally {
            sample.stop(meterRegistry.timer("redirect.lookup"));
        }
    }
}
