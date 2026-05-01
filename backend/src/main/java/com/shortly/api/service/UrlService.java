package com.shortly.api.service;

import com.shortly.api.domain.Url;
import com.shortly.api.dto.request.CreateUrlRequest;
import com.shortly.api.dto.response.UrlResponse;
import com.shortly.api.exception.BlockedDomainException;
import com.shortly.api.exception.UrlNotFoundException;
import com.shortly.api.repository.BlockedDomainRepository;
import com.shortly.api.repository.UrlRepository;
import com.shortly.api.repository.UrlStatsRepository;
import com.shortly.api.util.UrlValidator;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.Duration;

@Service
@RequiredArgsConstructor
@Slf4j
public class UrlService {

    private final UrlRepository urlRepository;
    private final UrlStatsRepository urlStatsRepository;
    private final BlockedDomainRepository blockedDomainRepository;
    private final Base62Codec base62Codec;
    private final StringRedisTemplate redis;
    private final UrlValidator urlValidator;
    private final MeterRegistry meterRegistry;

    @Value("${app.base-url}")
    private String baseUrl;

    @Value("${app.cache.url-ttl}")
    private Duration cacheTtl;

    private static final long ID_OFFSET = 1_000_000L;
    private static final String CACHE_PREFIX = "url:";
    // Anonymous (Redis-only) URLs use a separate id space, far above any DB
    // primary key we'll plausibly reach, so their short codes can never collide
    // with codes derived from `urls.id + ID_OFFSET`.
    private static final long ANON_ID_OFFSET = 10_000_000_000L;
    private static final String ANON_COUNTER_KEY = "url:anon:counter";

    @Transactional
    public UrlResponse create(CreateUrlRequest req, Long userId) {
        return createPersisted(req, userId);
    }

    /**
     * Anonymous URLs live ONLY in Redis with a TTL. No DB row, no url_stats
     * row, no cleanup job needed — Redis evicts them when the TTL expires.
     * Capacity is bounded by Redis's `maxmemory` + `allkeys-lru` policy, so
     * abuse can never blow up Postgres or grow the heap.
     */
    public UrlResponse createAnonymous(CreateUrlRequest req) {
        // 1. Validate + clamp TTL to [1, 5] minutes
        int duration = (req.durationMinutes() != null) ? req.durationMinutes() : 5;
        duration = Math.max(1, Math.min(5, duration));
        Duration ttl = Duration.ofMinutes(duration);

        // 2. Validate URL format and blocked domain — same checks as the durable path
        urlValidator.validateOrThrow(req.longUrl());
        String host = URI.create(req.longUrl()).getHost();
        if (host != null && blockedDomainRepository.existsByDomainIgnoreCase(host)) {
            throw new BlockedDomainException(host);
        }

        // 3. Get a unique id from Redis INCR (atomic, no DB roundtrip).
        //    Add ANON_ID_OFFSET so the codespace is disjoint from DB-backed URLs.
        Long counter = redis.opsForValue().increment(ANON_COUNTER_KEY);
        if (counter == null) {
            // Lettuce only returns null if the connection is broken; surface a clean error.
            throw new IllegalStateException("Redis unavailable; cannot create anonymous URL");
        }
        String shortCode = base62Codec.encode(ANON_ID_OFFSET + counter);

        // 4. Single Redis write with TTL — that's the only persistence
        redis.opsForValue().set(CACHE_PREFIX + shortCode, req.longUrl(), ttl);

        meterRegistry.counter("urls.created", "kind", "anonymous").increment();
        log.info("Created anonymous url shortCode={} ttlMinutes={}", shortCode, duration);

        return UrlResponse.anon(shortCode, req.longUrl(), baseUrl);
    }

    private UrlResponse createPersisted(CreateUrlRequest req, Long userId) {
        // 1. Validate URL format (Jakarta validation handles basics; we add semantic checks)
        urlValidator.validateOrThrow(req.longUrl());

        // 2. Check blocked domains
        String host = URI.create(req.longUrl()).getHost();
        if (host != null && blockedDomainRepository.existsByDomainIgnoreCase(host)) {
            throw new BlockedDomainException(host);
        }

        // 3. Insert with NULL short_code; let DB assign id
        Url url = Url.builder()
            .longUrl(req.longUrl())
            .userId(userId)
            .build();
        url = urlRepository.save(url);   // flush happens here; id populated

        // 4. Compute short_code from id (with offset for enumeration resistance)
        String shortCode = base62Codec.encode(url.getId() + ID_OFFSET);
        url.setShortCode(shortCode);
        urlRepository.save(url);

        // 5. Initialize stats row
        urlStatsRepository.initForUrl(url.getId());

        // 6. Warm cache (proactive)
        redis.opsForValue().set(CACHE_PREFIX + shortCode, req.longUrl(), cacheTtl);

        meterRegistry.counter("urls.created", "kind", "persistent").increment();
        log.info("Created url id={} shortCode={} userId={}", url.getId(), shortCode, userId);

        return UrlResponse.from(url, baseUrl, 0L);
    }

    @Transactional(readOnly = true)
    public UrlResponse getById(Long id, Long currentUserId) {
        Url url = urlRepository.findById(id)
            .filter(u -> u.getDeletedAt() == null)
            .orElseThrow(() -> new UrlNotFoundException(id));

        // Authorization: user can only see their own URLs.
        // Throw 404 (not 403) to prevent enumeration of foreign URLs.
        if (!url.getUserId().equals(currentUserId)) {
            throw new UrlNotFoundException(id);
        }

        long clickCount = urlStatsRepository.findClickCountByUrlId(id).orElse(0L);
        return UrlResponse.from(url, baseUrl, clickCount);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        Url url = urlRepository.findById(id)
            .filter(u -> u.getDeletedAt() == null)
            .orElseThrow(() -> new UrlNotFoundException(id));

        if (!url.getUserId().equals(currentUserId)) {
            throw new UrlNotFoundException(id);
        }

        url.setDeletedAt(java.time.Instant.now());
        urlRepository.save(url);

        // Evict cache so future requests get 404 immediately
        redis.delete(CACHE_PREFIX + url.getShortCode());

        meterRegistry.counter("urls.deleted").increment();
    }

    @Transactional(readOnly = true)
    public java.util.List<UrlResponse> listUserUrls(Long userId) {
        return urlRepository.findByUserIdAndDeletedAtIsNullOrderByCreatedAtDesc(userId).stream()
            .map(url -> {
                long clickCount = urlStatsRepository.findClickCountByUrlId(url.getId()).orElse(0L);
                return UrlResponse.from(url, baseUrl, clickCount);
            })
            .collect(java.util.stream.Collectors.toList());
    }
}
