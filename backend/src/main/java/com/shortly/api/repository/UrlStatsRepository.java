package com.shortly.api.repository;

import com.shortly.api.domain.UrlStats;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;
import java.util.Optional;

public interface UrlStatsRepository extends JpaRepository<UrlStats, Long> {
    @Query("SELECT u.clickCount FROM UrlStats u WHERE u.urlId = :urlId")
    Optional<Long> findClickCountByUrlId(Long urlId);

    @Modifying
    @Transactional
    @Query(value = "INSERT INTO url_stats (url_id, click_count, last_aggregated_event_id, updated_at) VALUES (:urlId, 0, 0, NOW()) ON CONFLICT (url_id) DO NOTHING", nativeQuery = true)
    void initForUrl(Long urlId);
    @Modifying
    @Transactional
    @Query(value = "WITH new_clicks AS ( " +
            "SELECT ce.url_id, count(*) as cnt, max(ce.clicked_at) as max_clicked_at, max(ce.id) as max_id " +
            "FROM click_events ce " +
            "JOIN url_stats us ON ce.url_id = us.url_id " +
            "WHERE ce.id > us.last_aggregated_event_id " +
            "GROUP BY ce.url_id " +
            ") " +
            "UPDATE url_stats us " +
            "SET click_count = us.click_count + nc.cnt, " +
            "    last_clicked_at = nc.max_clicked_at, " +
            "    last_aggregated_event_id = nc.max_id, " +
            "    updated_at = NOW() " +
            "FROM new_clicks nc " +
            "WHERE us.url_id = nc.url_id", nativeQuery = true)
    int runAggregation();
}
