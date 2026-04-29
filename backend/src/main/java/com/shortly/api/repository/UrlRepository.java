package com.shortly.api.repository;

import com.shortly.api.domain.Url;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface UrlRepository extends JpaRepository<Url, Long> {

    @Query("""
        SELECT u.longUrl FROM Url u
        WHERE u.shortCode = :shortCode
          AND u.deletedAt IS NULL
          AND (u.expiresAt IS NULL OR u.expiresAt > CURRENT_TIMESTAMP)
        """)
    Optional<String> findActiveLongUrlByShortCode(String shortCode);

    java.util.List<Url> findByUserIdAndDeletedAtIsNullOrderByCreatedAtDesc(Long userId);
}
