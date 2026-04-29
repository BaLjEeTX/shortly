package com.shortly.api.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.Instant;

@Entity
@Table(name = "url_stats")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
@Builder
public class UrlStats {
    @Id
    @Column(name = "url_id")
    private Long urlId;

    @Column(name = "click_count", nullable = false)
    @Builder.Default
    private Long clickCount = 0L;

    @Column(name = "last_clicked_at")
    private Instant lastClickedAt;

    @Column(name = "last_aggregated_event_id", nullable = false)
    @Builder.Default
    private Long lastAggregatedEventId = 0L;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
