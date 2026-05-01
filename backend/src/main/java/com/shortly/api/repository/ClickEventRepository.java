package com.shortly.api.repository;

import com.shortly.api.domain.ClickEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;

@Repository
@RequiredArgsConstructor
public class ClickEventRepository {

    private final JdbcTemplate jdbc;

    /**
     * Bulk insert: 1 round-trip for N rows. Way faster than JPA saveAll.
     *
     * Uses INSERT … SELECT so that clicks on URLs without a `urls` row
     * (anonymous Redis-only URLs, soft-deleted URLs, expired URLs) are
     * silently skipped instead of failing the batch with a NOT NULL
     * violation on url_id.
     */
    public void batchInsert(List<ClickEvent> events) {
        jdbc.batchUpdate(
            """
            INSERT INTO click_events
                (url_id, clicked_at, referrer, user_agent, ip_address)
            SELECT id, ?, ?, ?, ?::inet
              FROM urls
             WHERE short_code = ?
               AND deleted_at IS NULL
            """,
            events,
            500,  // JDBC batch size
            (ps, ev) -> {
                ps.setTimestamp(1, Timestamp.from(ev.clickedAt()));
                ps.setString(2, ev.referrer());
                ps.setString(3, ev.userAgent());
                ps.setString(4, ev.ipAddress());
                ps.setString(5, ev.shortCode());
            }
        );
    }

    public List<java.util.Map<String, Object>> getTimeSeries(Long urlId) {
        return jdbc.queryForList(
            "SELECT DATE_TRUNC('day', clicked_at) as date, COUNT(*) as clicks " +
            "FROM click_events WHERE url_id = ? GROUP BY date ORDER BY date ASC",
            urlId
        );
    }

    public List<java.util.Map<String, Object>> getTopReferrers(Long urlId) {
        return jdbc.queryForList(
            "SELECT referrer as name, COUNT(*) as clicks " +
            "FROM click_events WHERE url_id = ? " +
            "GROUP BY referrer ORDER BY clicks DESC LIMIT 5",
            urlId
        );
    }
}
