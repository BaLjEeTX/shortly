package com.shortly.api.config;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RateLimitFilter extends OncePerRequestFilter {

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final int redirectLimit;
    private final int createLimit;

    public RateLimitFilter(
            @Value("${app.rate-limit.redirect-per-ip-per-min}") int redirectLimit,
            @Value("${app.rate-limit.create-per-user-per-min}") int createLimit) {
        this.redirectLimit = redirectLimit;
        this.createLimit = createLimit;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                     FilterChain chain) throws ServletException, IOException {
        String path = req.getRequestURI();
        String key;
        int limit;

        if (path.startsWith("/api/v1/urls") && "POST".equals(req.getMethod())) {
            key = "user:" + req.getHeader("Authorization");
            limit = createLimit;
        } else if (path.matches("/[a-zA-Z0-9]{1,10}")) {
            key = "ip:" + req.getRemoteAddr();
            limit = redirectLimit;
        } else {
            chain.doFilter(req, res);
            return;
        }

        Bucket bucket = buckets.computeIfAbsent(key,
            k -> Bucket.builder()
                .addLimit(Bandwidth.simple(limit, Duration.ofMinutes(1)))
                .build());

        if (bucket.tryConsume(1)) {
            chain.doFilter(req, res);
        } else {
            res.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            res.setHeader("Retry-After", "60");
            res.setContentType("application/problem+json");
            res.getWriter().write(
                "{\"type\":\"https://shortly.app/errors/rate-limit\","
                + "\"title\":\"Too Many Requests\",\"status\":429}");
        }
    }
}
