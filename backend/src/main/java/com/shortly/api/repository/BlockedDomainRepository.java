package com.shortly.api.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

@Repository
public interface BlockedDomainRepository extends JpaRepository<com.shortly.api.domain.Url, String> {
    @Query(value = "SELECT EXISTS(SELECT 1 FROM blocked_domains WHERE domain = :domain)", nativeQuery = true)
    boolean existsByDomainIgnoreCase(String domain);
}
