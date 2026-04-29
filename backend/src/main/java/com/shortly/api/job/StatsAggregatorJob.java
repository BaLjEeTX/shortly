package com.shortly.api.job;

import com.shortly.api.repository.UrlStatsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class StatsAggregatorJob {

    private final UrlStatsRepository urlStatsRepository;

    @Scheduled(fixedDelay = 10000) // Run every 10 seconds
    public void aggregateStats() {
        try {
            int updatedRows = urlStatsRepository.runAggregation();
            if (updatedRows > 0) {
                log.info("Aggregated click stats for {} URLs", updatedRows);
            }
        } catch (Exception e) {
            log.error("Failed to run stats aggregation", e);
        }
    }
}
