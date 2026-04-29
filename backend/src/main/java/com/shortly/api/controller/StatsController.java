package com.shortly.api.controller;

import com.shortly.api.security.CurrentUser;
import com.shortly.api.service.StatsService;
import com.shortly.api.service.UrlService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/urls/{id}/stats")
@RequiredArgsConstructor
public class StatsController {
    private final StatsService statsService;
    private final UrlService urlService;

    @GetMapping
    public ResponseEntity<?> getSummary(@PathVariable Long id, @CurrentUser Long userId) {
        urlService.getById(id, userId); // check ownership
        return ResponseEntity.ok(statsService.getStats(id));
    }

    @GetMapping("/timeseries")
    public ResponseEntity<?> getTimeSeries(@PathVariable Long id, @CurrentUser Long userId) {
        urlService.getById(id, userId);
        return ResponseEntity.ok(statsService.getTimeSeries(id));
    }
    
    @GetMapping("/referrers")
    public ResponseEntity<?> getReferrers(@PathVariable Long id, @CurrentUser Long userId) {
        urlService.getById(id, userId);
        return ResponseEntity.ok(statsService.getReferrers(id));
    }
}
