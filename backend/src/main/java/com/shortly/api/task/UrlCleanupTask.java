package com.shortly.api.task;

import com.shortly.api.repository.UrlRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;

@Component
@RequiredArgsConstructor
@Slf4j
public class UrlCleanupTask {

    private final UrlRepository urlRepository;

    @Scheduled(fixedRateString = "60000") // Run every 60 seconds
    @Transactional
    public void cleanupExpiredUrls() {
        int deletedCount = urlRepository.deleteExpiredUrls(Instant.now());
        if (deletedCount > 0) {
            log.info("Cleaned up {} expired temporary URLs", deletedCount);
        }
    }
}
