package com.shortly.api.controller;

import com.shortly.api.dto.request.CreateUrlRequest;
import com.shortly.api.dto.response.UrlResponse;
import com.shortly.api.security.CurrentUser;
import com.shortly.api.service.UrlService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/urls")
@RequiredArgsConstructor
public class UrlController {

    private final UrlService urlService;

    @PostMapping
    public ResponseEntity<UrlResponse> create(
            @Valid @RequestBody CreateUrlRequest req,
            @CurrentUser Long userId) {
        UrlResponse res = urlService.create(req, userId);
        return ResponseEntity.created(URI.create("/api/v1/urls/" + res.id())).body(res);
    }

    @PostMapping("/anonymous")
    public ResponseEntity<UrlResponse> createAnonymous(
            @Valid @RequestBody CreateUrlRequest req) {
        UrlResponse res = urlService.createAnonymous(req);
        return ResponseEntity.created(URI.create("/api/v1/urls/" + res.id())).body(res);
    }

    @GetMapping("/{id}")
    public ResponseEntity<UrlResponse> getById(@PathVariable Long id, @CurrentUser Long userId) {
        return ResponseEntity.ok(urlService.getById(id, userId));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, @CurrentUser Long userId) {
        urlService.delete(id, userId);
        return ResponseEntity.noContent().build();
    }
    
    @GetMapping
    public ResponseEntity<Map<String, Object>> list(@CurrentUser Long userId) {
        return ResponseEntity.ok(Map.of("items", urlService.listUserUrls(userId)));
    }
}
