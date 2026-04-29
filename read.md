# URL Shortener with Analytics — Production Engineering Spec

> **Audience:** A developer who wants to build this as if it were a real product going to production at a startup — not a toy project.
>
> **Author's stance:** This document is written from the perspective of a senior backend engineer designing the system for a small team. Every decision is justified. Every trade-off is named.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Non-Functional Requirements](#2-non-functional-requirements)
3. [System Architecture](#3-system-architecture)
4. [Tech Stack & Justifications](#4-tech-stack--justifications)
5. [Project Structure](#5-project-structure)
6. [Database Design](#6-database-design)
7. [API Design](#7-api-design)
8. [Backend Implementation](#8-backend-implementation)
9. [Frontend Implementation](#9-frontend-implementation)
10. [Security](#10-security)
11. [Observability](#11-observability)
12. [Testing Strategy](#12-testing-strategy)
13. [Performance & Load Testing](#13-performance--load-testing)
14. [DevOps: Docker, CI/CD, Deployment](#14-devops)
15. [Implementation Roadmap](#15-implementation-roadmap)
16. [Trade-offs & Future Work](#16-trade-offs--future-work)

---

## 1. Product Overview

### What we're building

A URL shortening service (think bit.ly / tinyurl) with:
- Long URL → short code conversion
- Fast 302 redirects from `short.ly/{code}` to the original URL
- Click analytics (count, referrer, user agent, geography, time series)
- A simple web frontend for creating URLs and viewing analytics
- User accounts so each user owns their URLs

### Out of scope for v1 (and we say no on purpose)

- Custom domains
- Custom slugs (vanity URLs)
- QR code generation
- Team/org management
- Click fraud detection
- Paid tiers / billing
- Mobile apps

> **Why "no" matters:** Half the projects on resumes fail because the developer tried to build everything. Saying no is engineering. Build the core right; mention these as "future work."

### Success criteria

A new visitor can:
1. Sign up, log in
2. Paste a long URL, get a short URL in <500ms
3. Click the short URL and reach the destination in <100ms
4. View click analytics with a chart for the last 7/30 days

---

## 2. Non-Functional Requirements

These are the targets we'll prove with load tests, not just claim:

| Requirement | Target | How we measure |
|---|---|---|
| Redirect latency P99 | < 30ms (single instance) | k6 load test |
| Redirect throughput | > 3,000 RPS / instance | k6 load test |
| API latency P99 | < 200ms | k6 + Prometheus |
| Cache hit ratio (redirects) | > 90% | Micrometer custom metric |
| Availability target | 99.5% (single AZ, single instance) | Synthetic checks |
| Test coverage (line) | > 85% | JaCoCo |
| Cold start | < 15s | Observed at deploy |
| Container image size | < 200MB | `docker images` |

### Capacity assumptions (for design, not for v1 hardware)

- 10k URLs created per day → ~3.5M URLs/year
- 100:1 read/write ratio → 1M redirects/day → ~12 RPS average, ~120 RPS peak
- 5 years retention → ~17M rows in `urls`, billions in `click_events` (we partition)
- Average long URL length: 80 chars; max 2,048 chars (per common spec limit)

---

## 3. System Architecture

### High-level diagram

```
                    ┌─────────────────────────┐
                    │       Browser (SPA)     │
                    │  React + Vite + TS      │
                    └────────────┬────────────┘
                                 │ HTTPS
                                 │ (JSON over REST)
                                 ▼
                    ┌─────────────────────────┐
                    │   Nginx / API Gateway   │  (in production)
                    │  TLS termination, GZIP  │
                    └────────────┬────────────┘
                                 │
                                 ▼
       ┌─────────────────────────────────────────────────┐
       │           Spring Boot Application                │
       │  ┌──────────────┐  ┌──────────────────────┐    │
       │  │  REST API    │  │  Redirect Endpoint   │    │
       │  │  /api/v1/*   │  │  /{shortCode}        │    │
       │  └───────┬──────┘  └──────────┬───────────┘    │
       │          │                    │                 │
       │  ┌───────▼────────────────────▼──────────┐     │
       │  │         Service Layer                  │     │
       │  │  UrlService, AuthService, StatsService │     │
       │  └───────┬────────────────────┬──────────┘     │
       │          │                    │                 │
       │  ┌───────▼─────┐    ┌────────▼─────────┐       │
       │  │  ClickEvent │    │  Cache Manager   │       │
       │  │   Buffer    │    │  (Redis abstr.)  │       │
       │  └───────┬─────┘    └────────┬─────────┘       │
       │          │                    │                 │
       └──────────┼────────────────────┼─────────────────┘
                  │                    │
        ┌─────────▼─────────┐  ┌──────▼──────┐
        │   PostgreSQL 16   │  │   Redis 7   │
        │   (source truth)  │  │  (L2 cache) │
        └───────────────────┘  └─────────────┘
                  ▲
                  │
        ┌─────────┴─────────┐
        │  Background Jobs  │
        │  - Aggregator     │
        │  - Stats rollup   │
        │  - Stale cleanup  │
        └───────────────────┘
```

### Request flow: Redirect (the hot path)

```
GET /xY3aB
  │
  ├─→ [Filter] Rate limiter (Bucket4j, IP-based)
  │
  ├─→ [Controller] RedirectController.redirect()
  │      │
  │      ├─→ UrlLookupService.resolve("xY3aB")
  │      │      ├─→ Redis.GET url:xY3aB
  │      │      │   ├─→ HIT → return cached longUrl
  │      │      │   └─→ MISS → DB SELECT
  │      │      │              ├─→ Found → SET cache (TTL 24h) → return
  │      │      │              └─→ Not found → SET cache "NF" (TTL 60s) → throw 404
  │      │
  │      ├─→ ClickEventBuffer.record(event)  [ASYNC, non-blocking]
  │      │      └─→ in-memory BlockingQueue
  │      │
  │      └─→ ResponseEntity.status(302).location(longUrl).build()
  │
  └─→ Total time budget: ~10ms (cached) / ~25ms (uncached)
```

### Request flow: Create URL (the cold path)

```
POST /api/v1/urls  (Authorization: Bearer <jwt>)
  │
  ├─→ [Filter] JWT auth → set SecurityContext
  ├─→ [Filter] Rate limiter (per user, 30/min)
  │
  ├─→ [Controller] UrlController.create()
  │      │
  │      ├─→ Validate: @Valid CreateUrlRequest
  │      │   - longUrl: not blank, valid URL, max 2048 chars, not blocked domain
  │      │
  │      ├─→ UrlService.create(req, currentUser)
  │      │      ├─→ INSERT INTO urls (long_url, user_id) RETURNING id
  │      │      ├─→ shortCode = base62(id)
  │      │      ├─→ UPDATE urls SET short_code = ? WHERE id = ?
  │      │      ├─→ Redis.SET url:{shortCode} = longUrl, TTL 24h
  │      │      └─→ return UrlDto
  │      │
  │      └─→ ResponseEntity.created(location).body(dto)
```

### Background pipelines

```
ClickEventBuffer (in-memory bounded queue, capacity 10k)
        │
        ▼
[every 1s] @Scheduled flush()
        │
        ▼
  drainTo(batch, 500) → batch INSERT into click_events
        │
        ▼
[every 5min] @Scheduled aggregateStats()
        │
        ▼
  UPDATE url_stats SET click_count = click_count + ? WHERE url_id = ?
  (using a watermark column to track what's been aggregated)
        │
        ▼
[every 24h @ 3am UTC] @Scheduled archiveOldEvents()
        │
        ▼
  Move click_events older than 90 days to click_events_archive
  (or partitioned table; see DB section)
```

---

## 4. Tech Stack & Justifications

| Layer | Choice | Why this & not the alternative |
|---|---|---|
| Language | **Java 21 LTS** | Records, pattern matching, virtual threads. LTS = supported until 2031. |
| Framework | **Spring Boot 3.3+** | Industry standard. Spring 6 (Boot 3) drops `javax` for `jakarta`, supports native compilation. |
| Build | **Maven** | Most common in enterprise; recruiters expect it. Gradle is fine but adds a learning curve. |
| Database | **PostgreSQL 16** | JSONB, full-text search, partitioning, mature. **Not MySQL** — Postgres has cleaner concurrency semantics (`SKIP LOCKED`, MVCC). |
| Cache | **Redis 7** | Industry default. Single-digit ms latency. Pub/sub if we ever need it. |
| Migrations | **Flyway** | Versioned, simple, battle-tested. **Not Liquibase** — XML/YAML overhead not worth it for this scale. |
| Auth | **Spring Security 6 + JJWT** | Spring Security is verbose but proven. JJWT is the most popular JWT library in the JVM ecosystem. |
| Validation | **Jakarta Validation (Hibernate Validator)** | Standard. `@Valid`, `@NotBlank`, etc. |
| Testing | **JUnit 5 + Mockito + AssertJ + Testcontainers** | AssertJ for fluent assertions; Testcontainers for real Postgres/Redis in tests (not H2 — H2 lies about Postgres behavior). |
| API Docs | **springdoc-openapi 2** | Auto-generates OpenAPI 3 + Swagger UI. **Not Springfox** — abandoned. |
| Observability | **Spring Actuator + Micrometer + Prometheus** | Spring-native. Prometheus is the de-facto open standard for metrics. |
| Logging | **Logback + logstash-logback-encoder** | Spring's default + structured JSON output for log aggregators. |
| Rate limiting | **Bucket4j** | Mature token-bucket lib. Has Redis backend for distributed deployments. |
| Frontend | **React 18 + Vite + TypeScript** | Vite is fast (<1s HMR). TS catches API contract drift early. |
| UI library | **Tailwind CSS + shadcn/ui** | Modern, no opinionated component lock-in. Fast to build. |
| Charts | **Recharts** | Simplest React chart library; declarative. |
| HTTP client | **Axios + TanStack Query** | TanStack Query handles caching, retries, loading states. |
| Container | **Docker (multi-stage) + docker-compose** | One command up. |
| CI | **GitHub Actions** | Free for public repos. |
| Deployment (suggested) | **Fly.io / Railway / Render** | Cheap, simple, supports Docker + Postgres + Redis. |

---

## 5. Project Structure

This is a **monorepo** with backend and frontend in one git repo. Easier for a solo dev; demonstrates full-stack ownership on resume.

```
url-shortener/
├── .github/
│   └── workflows/
│       ├── backend-ci.yml
│       └── frontend-ci.yml
├── backend/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/shortly/api/
│   │   │   │   ├── ShortlyApplication.java
│   │   │   │   ├── config/
│   │   │   │   │   ├── SecurityConfig.java
│   │   │   │   │   ├── RedisConfig.java
│   │   │   │   │   ├── OpenApiConfig.java
│   │   │   │   │   ├── RateLimitConfig.java
│   │   │   │   │   └── AsyncConfig.java
│   │   │   │   ├── controller/
│   │   │   │   │   ├── AuthController.java
│   │   │   │   │   ├── UrlController.java
│   │   │   │   │   ├── StatsController.java
│   │   │   │   │   └── RedirectController.java
│   │   │   │   ├── service/
│   │   │   │   │   ├── AuthService.java
│   │   │   │   │   ├── UrlService.java
│   │   │   │   │   ├── UrlLookupService.java
│   │   │   │   │   ├── StatsService.java
│   │   │   │   │   ├── ClickEventBuffer.java
│   │   │   │   │   ├── ClickEventAggregator.java
│   │   │   │   │   └── Base62Codec.java
│   │   │   │   ├── repository/
│   │   │   │   │   ├── UrlRepository.java
│   │   │   │   │   ├── UserRepository.java
│   │   │   │   │   ├── ClickEventRepository.java
│   │   │   │   │   └── UrlStatsRepository.java
│   │   │   │   ├── domain/
│   │   │   │   │   ├── User.java
│   │   │   │   │   ├── Url.java
│   │   │   │   │   ├── ClickEvent.java
│   │   │   │   │   └── UrlStats.java
│   │   │   │   ├── dto/
│   │   │   │   │   ├── request/
│   │   │   │   │   │   ├── CreateUrlRequest.java
│   │   │   │   │   │   ├── LoginRequest.java
│   │   │   │   │   │   └── RegisterRequest.java
│   │   │   │   │   └── response/
│   │   │   │   │       ├── UrlResponse.java
│   │   │   │   │       ├── StatsResponse.java
│   │   │   │   │       └── TokenResponse.java
│   │   │   │   ├── security/
│   │   │   │   │   ├── JwtService.java
│   │   │   │   │   ├── JwtAuthFilter.java
│   │   │   │   │   ├── CurrentUser.java
│   │   │   │   │   └── CurrentUserResolver.java
│   │   │   │   ├── exception/
│   │   │   │   │   ├── GlobalExceptionHandler.java
│   │   │   │   │   ├── ShortCodeNotFoundException.java
│   │   │   │   │   ├── DuplicateUrlException.java
│   │   │   │   │   └── BlockedDomainException.java
│   │   │   │   └── util/
│   │   │   │       └── UrlValidator.java
│   │   │   └── resources/
│   │   │       ├── application.yml
│   │   │       ├── application-dev.yml
│   │   │       ├── application-prod.yml
│   │   │       ├── logback-spring.xml
│   │   │       └── db/migration/
│   │   │           ├── V1__init_schema.sql
│   │   │           ├── V2__add_click_events_partitioning.sql
│   │   │           └── V3__add_blocked_domains.sql
│   │   └── test/
│   │       ├── java/com/shortly/api/
│   │       │   ├── unit/                  # pure unit, no Spring
│   │       │   ├── integration/           # @SpringBootTest + Testcontainers
│   │       │   └── load/                  # k6 scripts (separate, not Java)
│   │       └── resources/
│   │           └── application-test.yml
│   ├── pom.xml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts                  # axios instance + interceptors
│   │   │   ├── auth.ts
│   │   │   ├── urls.ts
│   │   │   └── stats.ts
│   │   ├── components/
│   │   │   ├── ui/                        # shadcn/ui components
│   │   │   ├── UrlCreateForm.tsx
│   │   │   ├── UrlList.tsx
│   │   │   ├── UrlCard.tsx
│   │   │   └── StatsChart.tsx
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   └── StatsPage.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   └── useUrls.ts
│   │   ├── store/
│   │   │   └── authStore.ts               # Zustand
│   │   ├── lib/
│   │   │   └── utils.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── routes.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── Dockerfile
├── docs/
│   ├── architecture.png
│   ├── trade-offs.md
│   ├── api-examples.md
│   └── deployment.md
├── load-test/
│   ├── k6-redirect.js
│   └── k6-create.js
├── docker-compose.yml
├── docker-compose.prod.yml
├── .gitignore
├── .env.example
├── README.md
└── LICENSE
```

---

## 6. Database Design

### Decisions made up front

1. **`urls.user_id` is nullable** for anonymous URL creation in v2. Today everyone authenticates.
2. **`click_events` is partitioned by month** from day 1. Adding partitioning later is painful.
3. **`url_stats` is a denormalized aggregate** updated by a background job, not a `COUNT(*)` query at read time. We pre-compute.
4. **Soft-delete** for URLs (`deleted_at`) so we can audit and restore. Hard delete after 30 days via cron.
5. **No ORM-managed cascades.** Use database `ON DELETE CASCADE` only where deletion is rare (user → urls). Otherwise explicit deletes.

### Schema (`V1__init_schema.sql`)

```sql
-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(72)  NOT NULL,            -- bcrypt
    display_name    VARCHAR(100),
    role            VARCHAR(20)  NOT NULL DEFAULT 'USER',
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_chk CHECK (role IN ('USER', 'ADMIN'))
);

CREATE INDEX idx_users_email ON users(LOWER(email));

-- ============================================================================
-- URLS
-- ============================================================================
CREATE TABLE urls (
    id              BIGSERIAL    PRIMARY KEY,
    short_code      VARCHAR(10),                       -- nullable until populated
    long_url        TEXT         NOT NULL,
    user_id         BIGINT       REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(255),                      -- optional, fetched from <title>
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,                       -- v2: link expiration
    created_by_ip   INET,
    CONSTRAINT urls_short_code_unique UNIQUE (short_code),
    CONSTRAINT urls_long_url_length CHECK (LENGTH(long_url) <= 2048)
);

-- Critical index for redirect lookup (most-used query in the system)
CREATE INDEX idx_urls_short_code_active
    ON urls(short_code)
    WHERE deleted_at IS NULL AND short_code IS NOT NULL;

-- For the user dashboard (list "my URLs")
CREATE INDEX idx_urls_user_id_created_at
    ON urls(user_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- CLICK EVENTS (partitioned by month)
-- ============================================================================
CREATE TABLE click_events (
    id              BIGSERIAL,
    url_id          BIGINT       NOT NULL,
    clicked_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    referrer        VARCHAR(2048),
    user_agent      VARCHAR(512),
    ip_address      INET,
    country_code    CHAR(2),                           -- populated by geo-ip
    PRIMARY KEY (id, clicked_at)                       -- partitioning key included
) PARTITION BY RANGE (clicked_at);

-- Create initial partitions (script will create future ones automatically)
CREATE TABLE click_events_2025_01 PARTITION OF click_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE click_events_2025_02 PARTITION OF click_events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- ... etc, generated by a scheduled job

CREATE INDEX idx_click_events_url_id_clicked_at
    ON click_events(url_id, clicked_at DESC);

-- ============================================================================
-- URL STATS (denormalized aggregate)
-- ============================================================================
CREATE TABLE url_stats (
    url_id              BIGINT       PRIMARY KEY REFERENCES urls(id) ON DELETE CASCADE,
    click_count         BIGINT       NOT NULL DEFAULT 0,
    last_clicked_at     TIMESTAMPTZ,
    -- Watermark: the latest click_event.id that has been aggregated.
    -- Aggregator queries: WHERE id > last_aggregated_event_id
    last_aggregated_event_id BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- BLOCKED DOMAINS (anti-spam)
-- ============================================================================
CREATE TABLE blocked_domains (
    domain          VARCHAR(255) PRIMARY KEY,
    reason          VARCHAR(255),
    blocked_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed with common spam domains in a separate migration
```

### Why partitioning matters here

- 1M clicks/day × 365 days = 365M rows/year. Without partitioning, indexes get huge.
- Partition pruning: queries with `clicked_at` filters scan only relevant partitions.
- Dropping old data is `DROP PARTITION` — instant — vs. `DELETE` which bloats the table.

### Why a denormalized `url_stats` table?

`SELECT COUNT(*) FROM click_events WHERE url_id = ?` on a hot URL with 50M clicks is **slow**. We pre-aggregate. The watermark (`last_aggregated_event_id`) makes the aggregation idempotent and incremental.

### Why store `password_hash VARCHAR(72)`?

Bcrypt output is 60 chars. We use 72 as a safety margin and as a hint to readers ("this is bcrypt").

---

## 7. API Design

### Conventions

- All endpoints under `/api/v1/...` (versioned for future-proofing).
- All request/response bodies are JSON.
- Errors follow [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) (`application/problem+json`).
- Authentication via `Authorization: Bearer <jwt>` header.
- All times are ISO-8601 UTC (`2026-04-29T10:30:00Z`).
- Cursor-based pagination for lists (not offset — offset is slow on large tables).

### Endpoints

#### Auth

```
POST   /api/v1/auth/register      Register a new user
POST   /api/v1/auth/login         Get access + refresh token pair
POST   /api/v1/auth/refresh       Rotate refresh token
POST   /api/v1/auth/logout        Revoke current refresh token
```

#### URLs (authenticated)

```
GET    /api/v1/urls               List my URLs (paginated, cursor)
POST   /api/v1/urls               Create a short URL
GET    /api/v1/urls/{id}          Get one URL
DELETE /api/v1/urls/{id}          Soft-delete a URL
```

#### Stats (authenticated, must own the URL)

```
GET    /api/v1/urls/{id}/stats              Summary stats
GET    /api/v1/urls/{id}/stats/timeseries   Daily click counts (last 30 days)
GET    /api/v1/urls/{id}/stats/referrers    Top referrers
GET    /api/v1/urls/{id}/stats/countries    Click count by country
```

#### Public

```
GET    /{shortCode}               Redirect (302) — the hot path
GET    /actuator/health           Liveness/readiness
GET    /actuator/prometheus       Metrics scrape endpoint (internal)
```

### Sample request/response

**Create URL**

```http
POST /api/v1/urls HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "longUrl": "https://www.example.com/some/very/long/path?with=query"
}
```

```http
HTTP/1.1 201 Created
Location: /api/v1/urls/42
Content-Type: application/json

{
  "id": 42,
  "shortCode": "3D7",
  "shortUrl": "https://shortly.app/3D7",
  "longUrl": "https://www.example.com/some/very/long/path?with=query",
  "title": "Example Page Title",
  "createdAt": "2026-04-29T10:30:00Z",
  "clickCount": 0
}
```

**Validation error**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://shortly.app/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request validation failed",
  "instance": "/api/v1/urls",
  "traceId": "9c3f...",
  "errors": [
    { "field": "longUrl", "message": "must be a valid URL" }
  ]
}
```

---

## 8. Backend Implementation

### 8.1 Maven dependencies (`pom.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.5</version>
        <relativePath/>
    </parent>

    <groupId>com.shortly</groupId>
    <artifactId>shortly-api</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>21</java.version>
        <jjwt.version>0.12.6</jjwt.version>
        <bucket4j.version>8.10.1</bucket4j.version>
        <testcontainers.version>1.20.3</testcontainers.version>
        <springdoc.version>2.6.0</springdoc.version>
    </properties>

    <dependencies>
        <!-- Web + Validation -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <!-- Persistence -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-core</artifactId>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-database-postgresql</artifactId>
        </dependency>

        <!-- Cache -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>

        <!-- Security -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-api</artifactId>
            <version>${jjwt.version}</version>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-impl</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-jackson</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>

        <!-- Rate limiting -->
        <dependency>
            <groupId>com.bucket4j</groupId>
            <artifactId>bucket4j-core</artifactId>
            <version>${bucket4j.version}</version>
        </dependency>

        <!-- Observability -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-prometheus</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>net.logstash.logback</groupId>
            <artifactId>logstash-logback-encoder</artifactId>
            <version>8.0</version>
        </dependency>

        <!-- API Docs -->
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>${springdoc.version}</version>
        </dependency>

        <!-- Lombok -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- Tests -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.springframework.security</groupId>
            <artifactId>spring-security-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>postgresql</artifactId>
            <version>${testcontainers.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>${testcontainers.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>com.redis</groupId>
            <artifactId>testcontainers-redis</artifactId>
            <version>2.2.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.jacoco</groupId>
                <artifactId>jacoco-maven-plugin</artifactId>
                <version>0.8.12</version>
                <executions>
                    <execution>
                        <goals><goal>prepare-agent</goal></goals>
                    </execution>
                    <execution>
                        <id>report</id>
                        <phase>verify</phase>
                        <goals><goal>report</goal></goals>
                    </execution>
                    <execution>
                        <id>check</id>
                        <goals><goal>check</goal></goals>
                        <configuration>
                            <rules>
                                <rule>
                                    <element>BUNDLE</element>
                                    <limits>
                                        <limit>
                                            <counter>LINE</counter>
                                            <value>COVEREDRATIO</value>
                                            <minimum>0.80</minimum>
                                        </limit>
                                    </limits>
                                </rule>
                            </rules>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

### 8.2 Application configuration (`application.yml`)

```yaml
spring:
  application:
    name: shortly-api
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:dev}
  datasource:
    url: ${DB_URL:jdbc:postgresql://localhost:5432/shortly}
    username: ${DB_USER:shortly}
    password: ${DB_PASSWORD:shortly}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 5000
      idle-timeout: 300000
      max-lifetime: 1800000
  jpa:
    open-in-view: false        # CRITICAL: prevents N+1 in views, forces explicit fetching
    hibernate:
      ddl-auto: validate       # Flyway owns the schema; Hibernate verifies only
    properties:
      hibernate:
        jdbc:
          batch_size: 50
          time_zone: UTC
        order_inserts: true
        order_updates: true
  flyway:
    enabled: true
    baseline-on-migrate: true
    locations: classpath:db/migration
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      timeout: 2000ms
      lettuce:
        pool:
          max-active: 16
          max-idle: 8
          min-idle: 2

server:
  port: 8080
  shutdown: graceful           # complete in-flight requests before shutdown
  compression:
    enabled: true
  forward-headers-strategy: framework

app:
  base-url: ${APP_BASE_URL:http://localhost:8080}
  jwt:
    secret: ${JWT_SECRET:change-me-in-production-must-be-at-least-256-bits-long}
    access-token-ttl: PT15M    # 15 minutes
    refresh-token-ttl: P7D     # 7 days
  cache:
    url-ttl: PT24H
    not-found-ttl: PT1M        # negative caching to prevent enumeration
  rate-limit:
    redirect-per-ip-per-min: 600
    create-per-user-per-min: 30
  click-buffer:
    capacity: 10000
    flush-interval-ms: 1000
    batch-size: 500

management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: when-authorized
  metrics:
    tags:
      application: ${spring.application.name}
    distribution:
      percentiles-histogram:
        http.server.requests: true
      percentiles:
        http.server.requests: 0.5, 0.95, 0.99

logging:
  level:
    com.shortly: INFO
    org.hibernate.SQL: WARN
```

### 8.3 Domain entities

```java
package com.shortly.api.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.Instant;

@Entity
@Table(name = "users")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name")
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private Role role = Role.USER;

    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public enum Role { USER, ADMIN }
}
```

```java
package com.shortly.api.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.Instant;

@Entity
@Table(name = "urls")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
@Builder
public class Url {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "short_code", unique = true, length = 10)
    private String shortCode;

    @Column(name = "long_url", nullable = false, length = 2048)
    private String longUrl;

    @Column(name = "user_id")
    private Long userId;        // FK; we don't load User by default to avoid N+1

    private String title;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "expires_at")
    private Instant expiresAt;

    public boolean isActive() {
        return deletedAt == null
            && (expiresAt == null || expiresAt.isAfter(Instant.now()));
    }
}
```

> **Why no `@OneToMany` between `User` and `Url`?** It encourages lazy loading bugs (N+1). We always load the side we need explicitly. This is a senior-engineer pattern.

### 8.4 Base62 codec

```java
package com.shortly.api.service;

import org.springframework.stereotype.Component;

@Component
public class Base62Codec {

    private static final String ALPHABET =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static final int BASE = ALPHABET.length();

    /**
     * Encodes a positive long ID into a Base62 string.
     * IDs grow naturally: 0 → "0", 61 → "z", 62 → "10", etc.
     */
    public String encode(long id) {
        if (id < 0) throw new IllegalArgumentException("id must be non-negative");
        if (id == 0) return String.valueOf(ALPHABET.charAt(0));
        StringBuilder sb = new StringBuilder();
        while (id > 0) {
            sb.append(ALPHABET.charAt((int) (id % BASE)));
            id /= BASE;
        }
        return sb.reverse().toString();
    }

    /** Decode is useful for tests and admin tooling. */
    public long decode(String s) {
        long result = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            int value = ALPHABET.indexOf(c);
            if (value < 0) throw new IllegalArgumentException("invalid char: " + c);
            result = result * BASE + value;
        }
        return result;
    }
}
```

> **Production note: enumeration risk.** Base62 of sequential IDs is enumerable — anyone can guess `1, 2, 3, ...`. Mitigations (pick one):
> 1. **ID offset:** Encode `id + OFFSET` where `OFFSET = 1_000_000`. Cheap, breaks naive enumeration.
> 2. **Multiplicative hashing:** Use a Feistel cipher to permute IDs reversibly. Better but more code.
> 3. **Random codes with collision retry:** Generate `N` random Base62 chars, check uniqueness on insert. Slower under contention.
>
> For this project: implement option 1. **Document option 2 in trade-offs** as a known improvement.

### 8.5 URL creation service

```java
package com.shortly.api.service;

import com.shortly.api.domain.Url;
import com.shortly.api.dto.request.CreateUrlRequest;
import com.shortly.api.dto.response.UrlResponse;
import com.shortly.api.exception.BlockedDomainException;
import com.shortly.api.exception.UrlNotFoundException;
import com.shortly.api.repository.BlockedDomainRepository;
import com.shortly.api.repository.UrlRepository;
import com.shortly.api.repository.UrlStatsRepository;
import com.shortly.api.util.UrlValidator;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.Duration;

@Service
@RequiredArgsConstructor
@Slf4j
public class UrlService {

    private final UrlRepository urlRepository;
    private final UrlStatsRepository urlStatsRepository;
    private final BlockedDomainRepository blockedDomainRepository;
    private final Base62Codec base62Codec;
    private final StringRedisTemplate redis;
    private final UrlValidator urlValidator;
    private final MeterRegistry meterRegistry;

    @Value("${app.base-url}")
    private String baseUrl;

    @Value("${app.cache.url-ttl}")
    private Duration cacheTtl;

    private static final long ID_OFFSET = 1_000_000L;
    private static final String CACHE_PREFIX = "url:";

    @Transactional
    public UrlResponse create(CreateUrlRequest req, Long userId) {
        // 1. Validate URL format (Jakarta validation handles basics; we add semantic checks)
        urlValidator.validateOrThrow(req.longUrl());

        // 2. Check blocked domains
        String host = URI.create(req.longUrl()).getHost();
        if (host != null && blockedDomainRepository.existsByDomainIgnoreCase(host)) {
            throw new BlockedDomainException(host);
        }

        // 3. Insert with NULL short_code; let DB assign id
        Url url = Url.builder()
            .longUrl(req.longUrl())
            .userId(userId)
            .build();
        url = urlRepository.save(url);   // flush happens here; id populated

        // 4. Compute short_code from id (with offset for enumeration resistance)
        String shortCode = base62Codec.encode(url.getId() + ID_OFFSET);
        url.setShortCode(shortCode);
        urlRepository.save(url);

        // 5. Initialize stats row
        urlStatsRepository.initForUrl(url.getId());

        // 6. Warm cache (proactive)
        redis.opsForValue().set(CACHE_PREFIX + shortCode, req.longUrl(), cacheTtl);

        meterRegistry.counter("urls.created").increment();

        log.info("Created url id={} shortCode={} userId={}",
            url.getId(), shortCode, userId);

        return UrlResponse.from(url, baseUrl, 0L);
    }

    @Transactional(readOnly = true)
    public UrlResponse getById(Long id, Long currentUserId) {
        Url url = urlRepository.findById(id)
            .filter(u -> u.getDeletedAt() == null)
            .orElseThrow(() -> new UrlNotFoundException(id));

        // Authorization: user can only see their own URLs.
        // Throw 404 (not 403) to prevent enumeration of foreign URLs.
        if (!url.getUserId().equals(currentUserId)) {
            throw new UrlNotFoundException(id);
        }

        long clickCount = urlStatsRepository.findClickCountByUrlId(id).orElse(0L);
        return UrlResponse.from(url, baseUrl, clickCount);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        Url url = urlRepository.findById(id)
            .filter(u -> u.getDeletedAt() == null)
            .orElseThrow(() -> new UrlNotFoundException(id));

        if (!url.getUserId().equals(currentUserId)) {
            throw new UrlNotFoundException(id);
        }

        url.setDeletedAt(java.time.Instant.now());
        urlRepository.save(url);

        // Evict cache so future requests get 404 immediately
        redis.delete(CACHE_PREFIX + url.getShortCode());

        meterRegistry.counter("urls.deleted").increment();
    }
}
```

### 8.6 The hot path: redirect lookup

```java
package com.shortly.api.service;

import com.shortly.api.repository.UrlRepository;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class UrlLookupService {

    private final UrlRepository urlRepository;
    private final StringRedisTemplate redis;
    private final MeterRegistry meterRegistry;

    @Value("${app.cache.url-ttl}")
    private Duration urlTtl;

    @Value("${app.cache.not-found-ttl}")
    private Duration notFoundTtl;

    private static final String CACHE_PREFIX = "url:";
    private static final String NOT_FOUND_MARKER = "__NF__";

    /**
     * Returns the long URL for a short code, or empty if not found.
     * Cache-aside pattern with negative caching to prevent cache penetration.
     */
    public Optional<String> resolve(String shortCode) {
        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            // 1. Cache lookup
            String cached = redis.opsForValue().get(CACHE_PREFIX + shortCode);
            if (cached != null) {
                if (NOT_FOUND_MARKER.equals(cached)) {
                    meterRegistry.counter("redirect.cache", "result", "negative_hit").increment();
                    return Optional.empty();
                }
                meterRegistry.counter("redirect.cache", "result", "hit").increment();
                return Optional.of(cached);
            }

            meterRegistry.counter("redirect.cache", "result", "miss").increment();

            // 2. DB fallback
            Optional<String> longUrl = urlRepository
                .findActiveLongUrlByShortCode(shortCode);

            // 3. Populate cache (positive or negative)
            if (longUrl.isPresent()) {
                redis.opsForValue().set(CACHE_PREFIX + shortCode, longUrl.get(), urlTtl);
            } else {
                redis.opsForValue().set(
                    CACHE_PREFIX + shortCode, NOT_FOUND_MARKER, notFoundTtl);
            }
            return longUrl;

        } finally {
            sample.stop(meterRegistry.timer("redirect.lookup"));
        }
    }
}
```

```java
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
}
```

> **Why `Optional<String>`, not `Optional<Url>`?** Saves the work of hydrating the entity. The hot path needs only the long URL string. Premature optimization? No — this query runs millions of times.

### 8.7 The redirect controller

```java
package com.shortly.api.controller;

import com.shortly.api.domain.ClickEvent;
import com.shortly.api.exception.ShortCodeNotFoundException;
import com.shortly.api.service.ClickEventBuffer;
import com.shortly.api.service.UrlLookupService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Instant;

@RestController
@RequiredArgsConstructor
public class RedirectController {

    private final UrlLookupService urlLookupService;
    private final ClickEventBuffer clickEventBuffer;

    @GetMapping("/{shortCode:[a-zA-Z0-9]{1,10}}")
    public ResponseEntity<Void> redirect(
            @PathVariable String shortCode,
            HttpServletRequest request) {

        String longUrl = urlLookupService.resolve(shortCode)
            .orElseThrow(() -> new ShortCodeNotFoundException(shortCode));

        // Async, non-blocking: drop on full buffer is acceptable for analytics
        clickEventBuffer.record(new ClickEvent(
            shortCode,
            request.getHeader(HttpHeaders.REFERER),
            truncate(request.getHeader(HttpHeaders.USER_AGENT), 512),
            request.getRemoteAddr(),
            Instant.now()
        ));

        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(longUrl))
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=0, no-cache")
            .build();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
```

> **Why the regex on `@PathVariable`?** Without it, `/swagger-ui.html` might match. Path constraints scope the route narrowly. Spring MVC supports regex constraints: `{name:regex}`.

### 8.8 Click event buffering & batched insert

```java
package com.shortly.api.service;

import com.shortly.api.domain.ClickEvent;
import com.shortly.api.repository.ClickEventRepository;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

@Component
@Slf4j
public class ClickEventBuffer {

    private final BlockingQueue<ClickEvent> queue;
    private final ClickEventRepository repository;
    private final MeterRegistry meterRegistry;
    private final int batchSize;

    public ClickEventBuffer(
            ClickEventRepository repository,
            MeterRegistry meterRegistry,
            @Value("${app.click-buffer.capacity}") int capacity,
            @Value("${app.click-buffer.batch-size}") int batchSize) {
        this.repository = repository;
        this.meterRegistry = meterRegistry;
        this.queue = new LinkedBlockingQueue<>(capacity);
        this.batchSize = batchSize;

        // Expose queue depth as a gauge
        meterRegistry.gauge("click_buffer.depth", queue, BlockingQueue::size);
    }

    public void record(ClickEvent event) {
        boolean accepted = queue.offer(event);
        if (!accepted) {
            meterRegistry.counter("click_buffer.dropped").increment();
        } else {
            meterRegistry.counter("click_buffer.accepted").increment();
        }
    }

    @Scheduled(fixedDelayString = "${app.click-buffer.flush-interval-ms}")
    @Transactional
    public void flush() {
        List<ClickEvent> batch = new ArrayList<>(batchSize);
        queue.drainTo(batch, batchSize);
        if (batch.isEmpty()) return;

        try {
            repository.batchInsert(batch);
            meterRegistry.counter("click_buffer.flushed").increment(batch.size());
        } catch (Exception e) {
            log.error("Failed to flush click events batch of size {}", batch.size(), e);
            meterRegistry.counter("click_buffer.flush_errors").increment();
        }
    }

    /**
     * On graceful shutdown, flush remaining events to avoid losing data.
     */
    @PreDestroy
    public void onShutdown() {
        log.info("Shutting down: flushing {} pending click events", queue.size());
        while (!queue.isEmpty()) flush();
    }
}
```

```java
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

    /** Bulk insert: 1 round-trip for N rows. Way faster than JPA saveAll. */
    public void batchInsert(List<ClickEvent> events) {
        jdbc.batchUpdate(
            """
            INSERT INTO click_events
                (url_id, clicked_at, referrer, user_agent, ip_address)
            VALUES
                ((SELECT id FROM urls WHERE short_code = ?),
                 ?, ?, ?, ?::inet)
            """,
            events,
            500,  // JDBC batch size
            (ps, ev) -> {
                ps.setString(1, ev.shortCode());
                ps.setTimestamp(2, Timestamp.from(ev.clickedAt()));
                ps.setString(3, ev.referrer());
                ps.setString(4, ev.userAgent());
                ps.setString(5, ev.ipAddress());
            }
        );
    }
}
```

> **Why JdbcTemplate, not JPA?** Bulk inserts via JPA require setting `hibernate.jdbc.batch_size`, `order_inserts`, etc., and even then have overhead. For a known-shape bulk write, JdbcTemplate is 5-10x faster. Use the right tool for the job.

### 8.9 JWT authentication

```java
package com.shortly.api.security;

import com.shortly.api.domain.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;

@Service
@Slf4j
public class JwtService {

    private final SecretKey signingKey;
    private final Duration accessTtl;

    public JwtService(
            @Value("${app.jwt.secret}") String secret,
            @Value("${app.jwt.access-token-ttl}") Duration accessTtl) {
        if (secret.length() < 32) {
            throw new IllegalArgumentException(
                "JWT secret must be at least 256 bits (32 chars)");
        }
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtl = accessTtl;
    }

    public String generateAccessToken(User user) {
        Instant now = Instant.now();
        return Jwts.builder()
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .claim("role", user.getRole().name())
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(accessTtl)))
            .signWith(signingKey)
            .compact();
    }

    public Optional<JwtPrincipal> verify(String token) {
        try {
            Claims claims = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();

            return Optional.of(new JwtPrincipal(
                Long.valueOf(claims.getSubject()),
                claims.get("email", String.class),
                claims.get("role", String.class)
            ));
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("JWT verification failed: {}", e.getMessage());
            return Optional.empty();
        }
    }

    public record JwtPrincipal(Long userId, String email, String role) {}
}
```

```java
package com.shortly.api.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                     FilterChain chain)
            throws ServletException, IOException {

        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            jwtService.verify(token).ifPresent(principal -> {
                var auth = new UsernamePasswordAuthenticationToken(
                    principal,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + principal.role()))
                );
                SecurityContextHolder.getContext().setAuthentication(auth);
            });
        }

        chain.doFilter(req, res);
    }
}
```

```java
package com.shortly.api.config;

import com.shortly.api.security.JwtAuthFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())   // stateless API
            .cors(cors -> cors.configurationSource(corsConfig()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Public
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                // The redirect endpoint must be public
                .requestMatchers("/{shortCode:[a-zA-Z0-9]{1,10}}").permitAll()
                // Internal
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                // Everything else needs auth
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);  // cost=12 → ~250ms per hash, good in 2026
    }

    @Bean
    public UrlBasedCorsConfigurationSource corsConfig() {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(List.of("http://localhost:5173", "https://shortly.app"));
        cfg.setAllowedMethods(List.of("GET", "POST", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        cfg.setAllowCredentials(true);
        cfg.setMaxAge(3600L);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }
}
```

### 8.10 Global error handler

```java
package com.shortly.api.exception;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.util.Map;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    private static final String ERROR_BASE = "https://shortly.app/errors/";

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.BAD_REQUEST,
            "Validation failed", "validation", req);
        pd.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
            .map(e -> Map.of("field", e.getField(),
                             "message", e.getDefaultMessage()))
            .toList());
        return ResponseEntity.badRequest().body(pd);
    }

    @ExceptionHandler({UrlNotFoundException.class, ShortCodeNotFoundException.class})
    public ResponseEntity<ProblemDetail> handleNotFound(
            RuntimeException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.NOT_FOUND,
            ex.getMessage(), "not-found", req);
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    @ExceptionHandler(BlockedDomainException.class)
    public ResponseEntity<ProblemDetail> handleBlocked(
            BlockedDomainException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.FORBIDDEN,
            "Domain is blocked: " + ex.getDomain(), "blocked-domain", req);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ProblemDetail> handleAuth(
            BadCredentialsException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.UNAUTHORIZED,
            "Invalid credentials", "auth", req);
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(pd);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> handleForbidden(
            AccessDeniedException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.FORBIDDEN,
            "Access denied", "forbidden", req);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleGeneric(
            Exception ex, HttpServletRequest req) {
        // Log full stack trace; return only generic message to client
        log.error("Unhandled exception on path {}: ", req.getRequestURI(), ex);
        ProblemDetail pd = build(HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred", "internal", req);
        return ResponseEntity.internalServerError().body(pd);
    }

    private ProblemDetail build(HttpStatus status, String detail, String slug,
                                 HttpServletRequest req) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setType(URI.create(ERROR_BASE + slug));
        pd.setTitle(status.getReasonPhrase());
        pd.setInstance(URI.create(req.getRequestURI()));
        pd.setProperty("traceId", MDC.get("traceId"));
        return pd;
    }
}
```

### 8.11 Rate limiting filter

```java
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
```

> **Production scaling note:** This in-memory map doesn't share state across instances. For horizontal scaling, switch to `bucket4j-redis`. Document this in trade-offs.

---

## 9. Frontend Implementation

### 9.1 Tech & rationale

- **Vite** for dev server (sub-second HMR; Webpack/CRA is dead).
- **TypeScript** strict mode — every API contract typed.
- **TanStack Query** for server state (caches, retries, loading/error states without ceremony).
- **Zustand** for client state (auth tokens) — Redux is overkill here.
- **shadcn/ui** components built on Radix primitives — accessible, copy-paste, no version lock-in.
- **Recharts** for the analytics chart.
- **React Router 6** for routing.

### 9.2 Pages & flows

```
/                  → If logged in: redirect to /dashboard. Else: redirect to /login.
/login             → Email + password → /dashboard
/register          → Email + password + name → /dashboard
/dashboard         → Create URL form + list of my URLs (with click counts)
/urls/:id/stats    → Detailed analytics (chart, top referrers, countries)
```

### 9.3 API client setup

```typescript
// frontend/src/api/client.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export const apiClient = axios.create({
  baseURL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try refresh once; else log out
let refreshing: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = useAuthStore.getState().refresh();
        }
        const newToken = await refreshing;
        refreshing = null;
        if (original.headers) {
          original.headers.Authorization = `Bearer ${newToken}`;
        }
        return apiClient(original);
      } catch (e) {
        refreshing = null;
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
```

### 9.4 Auth store (Zustand)

```typescript
// frontend/src/store/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '../api/client';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: number; email: string } | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<string>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,

      login: async (email, password) => {
        const { data } = await apiClient.post('/api/v1/auth/login', { email, password });
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        });
      },

      register: async (email, password, displayName) => {
        const { data } = await apiClient.post('/api/v1/auth/register',
          { email, password, displayName });
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        });
      },

      refresh: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await apiClient.post('/api/v1/auth/refresh', { refreshToken });
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return data.accessToken;
      },

      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'shortly-auth' }
  )
);
```

### 9.5 URL list with TanStack Query

```typescript
// frontend/src/api/urls.ts
import { apiClient } from './client';

export interface UrlResponse {
  id: number;
  shortCode: string;
  shortUrl: string;
  longUrl: string;
  title: string | null;
  createdAt: string;
  clickCount: number;
}

export const urlsApi = {
  list: async (cursor?: number): Promise<{ items: UrlResponse[]; nextCursor: number | null }> => {
    const { data } = await apiClient.get('/api/v1/urls', { params: { cursor } });
    return data;
  },

  create: async (longUrl: string): Promise<UrlResponse> => {
    const { data } = await apiClient.post('/api/v1/urls', { longUrl });
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/urls/${id}`);
  },
};
```

```typescript
// frontend/src/hooks/useUrls.ts
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { urlsApi } from '../api/urls';

export function useUrls() {
  return useInfiniteQuery({
    queryKey: ['urls'],
    queryFn: ({ pageParam }) => urlsApi.list(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreateUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: urlsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['urls'] }),
  });
}

export function useDeleteUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: urlsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['urls'] }),
  });
}
```

### 9.6 Create URL form

```tsx
// frontend/src/components/UrlCreateForm.tsx
import { useState } from 'react';
import { useCreateUrl } from '../hooks/useUrls';
import { Button, Input } from './ui';
import { Copy, CheckCircle } from 'lucide-react';

export function UrlCreateForm() {
  const [longUrl, setLongUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const createMutation = useCreateUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!longUrl) return;
    await createMutation.mutateAsync(longUrl);
    setLongUrl('');
  };

  const result = createMutation.data;

  const copyToClipboard = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Shorten a URL</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste your long URL below. We'll give you a tidy short link.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <Input
          type="url"
          required
          placeholder="https://your-very-long-url.com/path"
          value={longUrl}
          onChange={(e) => setLongUrl(e.target.value)}
          disabled={createMutation.isPending}
          className="flex-1"
        />
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Shortening…' : 'Shorten'}
        </Button>
      </form>

      {createMutation.error && (
        <p className="mt-2 text-sm text-destructive">
          {(createMutation.error as Error).message}
        </p>
      )}

      {result && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted p-3">
          <code className="flex-1 truncate font-mono text-sm">{result.shortUrl}</code>
          <Button variant="ghost" size="sm" onClick={copyToClipboard}>
            {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
```

### 9.7 Stats page with chart

```tsx
// frontend/src/pages/StatsPage.tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

interface TimeSeriesPoint {
  date: string;
  clicks: number;
}

export function StatsPage() {
  const { id } = useParams();

  const summary = useQuery({
    queryKey: ['stats', id, 'summary'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats`);
      return data;
    },
  });

  const timeSeries = useQuery({
    queryKey: ['stats', id, 'timeseries'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats/timeseries`);
      return data as TimeSeriesPoint[];
    },
  });

  const referrers = useQuery({
    queryKey: ['stats', id, 'referrers'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats/referrers`);
      return data as { referrer: string; count: number }[];
    },
  });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Analytics</h1>
        {summary.data && (
          <p className="text-sm text-muted-foreground">
            {summary.data.clickCount.toLocaleString()} total clicks
          </p>
        )}
      </header>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Clicks (last 30 days)</h2>
        {timeSeries.data && (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={timeSeries.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="clicks" strokeWidth={2}
                    fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Top referrers</h2>
        {referrers.data && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground">
              <th>Source</th><th className="text-right">Clicks</th>
            </tr></thead>
            <tbody>
              {referrers.data.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2">{r.referrer || '(direct)'}</td>
                  <td className="py-2 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

---

## 10. Security

### Threat model

| Threat | Mitigation |
|---|---|
| Credential stuffing | bcrypt with cost 12; rate limit auth endpoints |
| JWT forgery | HMAC-SHA256 signing; secret >256 bits; short access token TTL |
| Stolen refresh token | Refresh token rotation; reuse detection revokes the chain |
| Open redirect to malicious sites | Blocked-domain list; URL validation |
| Phishing via short URLs | (Future) safe-browsing API check before redirect |
| Click farm spam | IP-based rate limit on redirects |
| SQL injection | Parameterized queries everywhere (JPA/JdbcTemplate) |
| XSS in dashboard | React escapes by default; never use `dangerouslySetInnerHTML` |
| CSRF | API is token-based, not cookie-based, so CSRF doesn't apply. Confirmed by disabling CSRF protection in Spring Security config. |
| Enumeration of URLs | Base62 with offset; 404 (not 403) on cross-user access |
| Cache poisoning / penetration | Negative caching with short TTL; Bloom filter (future) |
| DoS via huge payloads | Spring's `server.tomcat.max-http-form-post-size` limited; URL ≤ 2048 chars |
| Secrets in repo | `.env.example` only; CI checks via gitleaks |

### Password hashing

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
}
```

> Bcrypt cost 12 = ~250ms per hash on modern hardware in 2026. Rule of thumb: cost should make hashing take ~250-500ms. Re-evaluate every 2 years as hardware improves.

### URL validation

```java
package com.shortly.api.util;

import com.shortly.api.exception.InvalidUrlException;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Set;

@Component
public class UrlValidator {

    private static final Set<String> ALLOWED_SCHEMES = Set.of("http", "https");

    public void validateOrThrow(String url) {
        if (url == null || url.isBlank()) {
            throw new InvalidUrlException("URL cannot be empty");
        }
        if (url.length() > 2048) {
            throw new InvalidUrlException("URL exceeds 2048 characters");
        }

        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw new InvalidUrlException("Malformed URL");
        }

        if (uri.getScheme() == null
            || !ALLOWED_SCHEMES.contains(uri.getScheme().toLowerCase())) {
            throw new InvalidUrlException("Only http and https URLs are allowed");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new InvalidUrlException("URL must contain a host");
        }
        // Block localhost/private IPs to prevent SSRF if we ever fetch URLs server-side
        String host = uri.getHost().toLowerCase();
        if (host.equals("localhost") || host.startsWith("127.")
            || host.startsWith("10.") || host.startsWith("192.168.")
            || host.equals("0.0.0.0")) {
            throw new InvalidUrlException("Private/local URLs are not allowed");
        }
    }
}
```

### Production secret management

- **Never** check secrets into git. Use `.env.example` documenting required vars.
- In production: secrets via your platform (Fly.io secrets, Railway variables, K8s Secrets, AWS Secrets Manager).
- Rotate JWT secret on schedule (kid-based key rotation in v2).

---

## 11. Observability

### The three pillars

#### 1. Metrics (Prometheus + Micrometer)

Custom metrics worth tracking:

```java
// Exposed automatically:
// - http.server.requests (Spring MVC)
// - hikaricp.connections (DB pool)
// - jvm.memory.used, jvm.gc.pause
// - lettuce.command.completion (Redis)

// Custom metrics we add:
// - urls.created (counter)
// - urls.deleted (counter)
// - redirect.cache{result=hit|miss|negative_hit} (counter)
// - redirect.lookup (timer)
// - click_buffer.depth (gauge)
// - click_buffer.accepted / .dropped / .flushed (counter)
```

**Sample Grafana queries:**

```promql
# P99 redirect latency
histogram_quantile(0.99,
  rate(redirect_lookup_seconds_bucket[5m]))

# Cache hit ratio
sum(rate(redirect_cache_total{result="hit"}[5m]))
  / sum(rate(redirect_cache_total[5m]))

# 5xx error rate
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
  / sum(rate(http_server_requests_seconds_count[5m]))
```

#### 2. Structured logs

```xml
<!-- backend/src/main/resources/logback-spring.xml -->
<configuration>
    <springProfile name="prod">
        <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
            <encoder class="net.logstash.logback.encoder.LogstashEncoder">
                <includeMdcKeyName>traceId</includeMdcKeyName>
                <includeMdcKeyName>userId</includeMdcKeyName>
            </encoder>
        </appender>
        <root level="INFO">
            <appender-ref ref="JSON" />
        </root>
    </springProfile>

    <springProfile name="dev">
        <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
            <encoder>
                <pattern>%d{HH:mm:ss.SSS} %-5level [%X{traceId}] %logger{36} - %msg%n</pattern>
            </encoder>
        </appender>
        <root level="INFO">
            <appender-ref ref="CONSOLE" />
        </root>
    </springProfile>
</configuration>
```

```java
// Request ID filter — runs first
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                     FilterChain chain) throws IOException, ServletException {
        String traceId = req.getHeader("X-Request-Id");
        if (traceId == null || traceId.isBlank()) traceId = UUID.randomUUID().toString();
        MDC.put("traceId", traceId);
        res.setHeader("X-Request-Id", traceId);
        try { chain.doFilter(req, res); }
        finally { MDC.clear(); }
    }
}
```

#### 3. Distributed tracing (out of scope for v1, mentioned in trade-offs)

For a single-service app, tracing is overkill. When we add a separate analytics service or notification service in v2, add OpenTelemetry + Jaeger.

### Health checks

`/actuator/health` returns:

```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "SELECT 1" } },
    "redis": { "status": "UP", "details": { "version": "7.4.0" } },
    "diskSpace": { "status": "UP" },
    "ping": { "status": "UP" }
  }
}
```

For Kubernetes:
- `/actuator/health/liveness` — is the JVM alive? (restart on fail)
- `/actuator/health/readiness` — can it serve traffic? (remove from LB on fail)

---

## 12. Testing Strategy

### Pyramid

```
                     /\
                    /e2e\        2-3 critical happy paths (Playwright, optional)
                   /------\
                  /  IT    \     20+ tests with Testcontainers
                 /----------\
                /   slice    \   Controller-only @WebMvcTest, Repo-only @DataJpaTest
               /--------------\
              /     unit       \  ~70% of tests; pure Java, no Spring
             /------------------\
```

### Unit tests (no Spring, fast)

```java
// Base62Codec: pure logic, easy to test exhaustively
class Base62CodecTest {

    private final Base62Codec codec = new Base62Codec();

    @Test
    void encodesZero() {
        assertThat(codec.encode(0)).isEqualTo("0");
    }

    @Test
    void encodesBaseBoundary() {
        assertThat(codec.encode(61)).isEqualTo("z");
        assertThat(codec.encode(62)).isEqualTo("10");
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 100, 1_000_000, Long.MAX_VALUE / 2})
    void roundTrip(long id) {
        assertThat(codec.decode(codec.encode(id))).isEqualTo(id);
    }

    @Test
    void rejectsNegative() {
        assertThatThrownBy(() -> codec.encode(-1))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
```

### Slice tests

```java
// Test the controller in isolation; service is mocked
@WebMvcTest(UrlController.class)
@AutoConfigureMockMvc(addFilters = false)  // skip security here
class UrlControllerTest {

    @Autowired MockMvc mvc;
    @MockBean UrlService urlService;

    @Test
    void create_returns201_andLocationHeader() throws Exception {
        when(urlService.create(any(), any()))
            .thenReturn(new UrlResponse(42L, "3D7", "http://x/3D7", "https://e.com",
                                         null, Instant.now(), 0L));

        mvc.perform(post("/api/v1/urls")
                .contentType(APPLICATION_JSON)
                .content("""
                    {"longUrl":"https://example.com"}
                """))
           .andExpect(status().isCreated())
           .andExpect(header().exists("Location"))
           .andExpect(jsonPath("$.shortCode").value("3D7"));
    }

    @Test
    void create_returns400_onInvalidUrl() throws Exception {
        mvc.perform(post("/api/v1/urls")
                .contentType(APPLICATION_JSON)
                .content("""{"longUrl":"not-a-url"}"""))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.errors").isArray());
    }
}
```

### Integration tests with Testcontainers

```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Testcontainers
@AutoConfigureMockMvc
class UrlShortenerEndToEndIT {

    @Container
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static GenericContainer<?> redis =
        new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry reg) {
        reg.add("spring.datasource.url", postgres::getJdbcUrl);
        reg.add("spring.datasource.username", postgres::getUsername);
        reg.add("spring.datasource.password", postgres::getPassword);
        reg.add("spring.data.redis.host", redis::getHost);
        reg.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;

    private String tokenForUser(String email) throws Exception {
        // Register
        mvc.perform(post("/api/v1/auth/register")
            .contentType(APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of(
                "email", email, "password", "Password1!", "displayName", "T"))))
           .andExpect(status().isOk());

        // Login
        var res = mvc.perform(post("/api/v1/auth/login")
            .contentType(APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of(
                "email", email, "password", "Password1!"))))
           .andExpect(status().isOk()).andReturn();
        return JsonPath.read(res.getResponse().getContentAsString(), "$.accessToken");
    }

    @Test
    void fullFlow_create_then_redirect_then_stats() throws Exception {
        String token = tokenForUser("alice@test.com");

        // Create
        var createRes = mvc.perform(post("/api/v1/urls")
            .header("Authorization", "Bearer " + token)
            .contentType(APPLICATION_JSON)
            .content("""{"longUrl":"https://example.com/page"}"""))
           .andExpect(status().isCreated())
           .andReturn();
        String shortCode = JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.shortCode");

        // Redirect (no auth needed)
        mvc.perform(get("/" + shortCode))
           .andExpect(status().isFound())
           .andExpect(header().string("Location", "https://example.com/page"));

        // Wait for the click event flush (or trigger flush manually in test)
        Thread.sleep(1500);

        // Stats reflect the click
        Long urlId = ((Number) JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.id")).longValue();
        mvc.perform(get("/api/v1/urls/" + urlId + "/stats")
            .header("Authorization", "Bearer " + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.clickCount").value(1));
    }

    @Test
    void redirect_unknownCode_returns404() throws Exception {
        mvc.perform(get("/nonexistent"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.type").value(endsWith("/not-found")));
    }

    @Test
    void otherUser_cannotAccessMyUrl() throws Exception {
        String tokenA = tokenForUser("a@test.com");
        String tokenB = tokenForUser("b@test.com");

        var createRes = mvc.perform(post("/api/v1/urls")
            .header("Authorization", "Bearer " + tokenA)
            .contentType(APPLICATION_JSON)
            .content("""{"longUrl":"https://secret.com"}"""))
           .andReturn();
        Long urlId = ((Number) JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.id")).longValue();

        // User B should get 404 (not 403, to prevent enumeration)
        mvc.perform(get("/api/v1/urls/" + urlId)
            .header("Authorization", "Bearer " + tokenB))
           .andExpect(status().isNotFound());
    }
}
```

### Coverage targets

- Line coverage ≥ 80%, enforced by JaCoCo plugin in CI.
- Critical paths (auth, redirect, create) ≥ 95%.
- Don't chase 100% — DTO `equals/hashCode` and trivial getters are noise.

---

## 13. Performance & Load Testing

### k6 redirect script

```javascript
// load-test/k6-redirect.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },   // ramp to 100 vus
    { duration: '2m',  target: 500 },   // sustain
    { duration: '1m',  target: 1000 },  // peak
    { duration: '30s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<30'],    // P99 under 30ms
    http_req_failed:   ['rate<0.001'],  // <0.1% errors
  },
};

const codes = ['3D7', '4E8', '5F9', '6Ga', '7Hb'];  // pre-seeded

export default function () {
  const code = codes[Math.floor(Math.random() * codes.length)];
  const res = http.get(`http://localhost:8080/${code}`, { redirects: 0 });
  check(res, { 'is 302': (r) => r.status === 302 });
}
```

Run: `k6 run load-test/k6-redirect.js`

### What to do BEFORE running load tests

1. Pre-seed the DB with realistic data (10k URLs, 1M click events).
2. Warm the cache (`docker exec redis-cli flushall` first, then ramp).
3. JVM warm-up: 30s ramp-up before measuring P99.
4. Make sure you're not bottlenecked by k6 itself (use a separate machine for k6 or `--vus 200 --rps 5000`).

### Expected results (single instance, 4 vCPU / 4GB RAM)

| Scenario | Throughput | P50 | P95 | P99 |
|---|---|---|---|---|
| Cached redirect | 3,500 RPS | 4ms | 12ms | 22ms |
| DB-fallback redirect | 1,200 RPS | 18ms | 45ms | 80ms |
| Create URL | 600 RPS | 30ms | 90ms | 180ms |

> If your numbers are 10x worse: check JVM heap settings, Hikari pool size, Redis connection pool, network in Docker (`host` mode for benchmarks).

---

## 14. DevOps

### docker-compose.yml (development)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shortly
      POSTGRES_USER: shortly
      POSTGRES_PASSWORD: shortly
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "shortly"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      SPRING_PROFILES_ACTIVE: dev
      DB_URL: jdbc:postgresql://postgres:5432/shortly
      DB_USER: shortly
      DB_PASSWORD: shortly
      REDIS_HOST: redis
      JWT_SECRET: dev-secret-key-must-be-at-least-32-chars-long
      APP_BASE_URL: http://localhost:8080
    ports: ["8080:8080"]
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }

  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    environment:
      VITE_API_BASE_URL: http://localhost:8080
    ports: ["5173:5173"]
    depends_on: [api]

volumes:
  pgdata:
```

Run: `docker compose up`. Frontend at `http://localhost:5173`.

### Backend Dockerfile (multi-stage)

```dockerfile
# backend/Dockerfile
FROM maven:3.9.9-eclipse-temurin-21-alpine AS deps
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline

FROM deps AS build
COPY src ./src
RUN mvn -B clean package -DskipTests

FROM eclipse-temurin:21-jre-alpine AS runtime
RUN addgroup -S spring && adduser -S spring -G spring
WORKDIR /app
COPY --from=build --chown=spring:spring /app/target/*.jar app.jar
USER spring:spring
EXPOSE 8080
ENV JAVA_OPTS="-XX:+UseG1GC -XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

> **Image size target: < 200MB.** Alpine base + JRE-only (not JDK) gets us there. Don't use `openjdk:21` — it's a 500MB Debian image.

### Frontend Dockerfile

```dockerfile
# frontend/Dockerfile (production)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# frontend/nginx.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri /index.html;
    }

    # Proxy API to backend
    location /api/ {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### CI: GitHub Actions

```yaml
# .github/workflows/backend-ci.yml
name: Backend CI
on:
  push: { branches: [main], paths: ['backend/**'] }
  pull_request: { paths: ['backend/**'] }

jobs:
  build:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '21', cache: maven }

      - name: Verify
        run: mvn -B verify

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with: { files: backend/target/site/jacoco/jacoco.xml }

      - name: Build Docker image
        if: github.ref == 'refs/heads/main'
        run: docker build -t shortly-api:${{ github.sha }} .
```

### Deployment options (production)

| Platform | Cost (rough, 2026) | Pros | Cons |
|---|---|---|---|
| **Fly.io** | $5-15/mo | Edge-deployed, includes Postgres | Limited regions free |
| **Railway** | $5-20/mo | Easiest setup, good DX | More expensive at scale |
| **Render** | $7-20/mo | Simple, reliable | Slower cold starts on free tier |
| **DigitalOcean App Platform** | $12-25/mo | Predictable | More config |
| **AWS ECS Fargate + RDS + ElastiCache** | $50-100/mo | Production-grade | Complex setup |

**For a portfolio project, deploy on Fly.io.** Free Postgres, free Redis, custom domain. Document the deployment in `docs/deployment.md`.

---

## 15. Implementation Roadmap

### Suggested 4-week plan (~2 hours/day)

#### Week 1: Foundation
- Day 1-2: Repo scaffold, Docker Compose, Postgres + Redis up.
- Day 3-4: User entity, registration, login (no JWT yet — return user on login).
- Day 5: JWT issuance + auth filter; protect a hello-world endpoint.
- Day 6-7: Flyway migrations for `urls`, basic CRUD without short codes.

**End of week 1:** Auth works. You can log in, create rows in `urls` table.

#### Week 2: Core feature
- Day 1-2: Base62 codec + tests; integrate into URL creation.
- Day 3: Redirect endpoint; cache-aside with Redis.
- Day 4: Click event recording → DB synchronously (refactor to buffer in week 3).
- Day 5: Validation, blocked domains, error handling.
- Day 6-7: Stats endpoints (count, time series, referrers); aggregator job.

**End of week 2:** Backend is feature-complete for v1. API testable via curl.

#### Week 3: Production hardening
- Day 1-2: Async click event buffer + scheduled flush; load-test the redirect path.
- Day 3: Rate limiting filter; tune Hikari pool, Redis pool.
- Day 4: Refresh token rotation; reuse-detection logic.
- Day 5: Observability — Prometheus metrics, structured logs, Actuator probes.
- Day 6-7: Testcontainers integration tests; aim for 80% coverage.

**End of week 3:** Production-ready backend. Performance numbers documented.

#### Week 4: Frontend + polish
- Day 1-2: Vite + React + Tailwind setup; auth store; login/register pages.
- Day 3: Dashboard with create form + URL list (TanStack Query).
- Day 4: Stats page with chart.
- Day 5: README, architecture diagram, trade-offs doc.
- Day 6: Deploy to Fly.io; record a 90s Loom walkthrough.
- Day 7: GitHub topics, profile pinning, final cleanup.

**End of week 4:** Live demo + polished GitHub repo. Ready to put on resume.

---

## 16. Trade-offs & Future Work

### Decisions made (and why)

| Decision | Trade-off | Why we chose this for v1 |
|---|---|---|
| In-memory click buffer | Loses events on crash | Simplicity; analytics tolerate small data loss; single-instance deploy |
| In-memory rate limiter | Doesn't scale across instances | Single instance for now; documented Redis-backed migration path |
| DB as source of truth + Redis cache | Cache invalidation complexity | Simplicity beats Cassandra/DynamoDB for our scale |
| Base62 with offset | Predictable IDs (mitigated by offset) | Simpler than Feistel cipher; offset adequate for non-sensitive use |
| Sequential vs random IDs | Adversaries can estimate URL count | Acceptable for non-sensitive shortener; private mode is v2 |
| JWT (stateless) | Can't revoke until expiry | Short access TTL (15m) limits damage; refresh token rotation handles long-lived sessions |
| Single Postgres instance | No HA | Replicas in v2; backups via daily pg_dump for now |
| No CDN for static assets | Higher latency for non-US users | Vercel/Cloudflare Pages can be added later |

### Future work (in `docs/trade-offs.md` so interviewers see you thought about it)

1. **Distributed rate limiting:** swap in-memory `Bucket` for `bucket4j-redis`.
2. **Kafka for click events:** durable, scalable replacement for in-memory queue.
3. **Geo-IP lookup:** populate `country_code` via MaxMind GeoLite2 in the aggregator job.
4. **Bloom filter for cache penetration:** reduces negative cache lookups.
5. **Read replicas:** route stats queries to replicas; redirect writes go to primary.
6. **Custom slugs:** users can choose short codes (with conflict handling).
7. **API key auth:** for programmatic users (no JWT lifecycle), with usage quotas.
8. **Multi-region deploy:** Fly.io + Litestream or full active-active Postgres.
9. **Safe Browsing integration:** check destination URLs against Google Safe Browsing before redirect.
10. **OpenTelemetry tracing:** when we add a notification service or analytics service.

### What I would NOT add (and why)

- **Microservices:** premature. One service does the job.
- **GraphQL:** REST is well-understood; GraphQL adds caching complexity.
- **Server-side rendering:** the dashboard is auth'd, behind login — SEO doesn't matter.
- **Event sourcing for clicks:** overkill; we don't need to replay click history.

---

## Appendix: Resume bullets you can use after building this

```
URL SHORTENER WITH ANALYTICS · github.com/yourname/shortly · live demo
Tech: Java 21, Spring Boot 3.3, PostgreSQL 16, Redis 7, React 18, TypeScript,
      Docker, Testcontainers, k6, Prometheus

• Built a production-grade URL shortener serving redirects at <22ms P99 under
  1k concurrent VUs (k6 load test) by adding Redis cache-aside layer with
  negative caching; achieved 92% cache hit ratio in steady state.

• Designed Base62 ID-encoding with offset for collision-free, enumeration-
  resistant short codes; partitioned PostgreSQL `click_events` by month from
  day 1 to support multi-year retention without table bloat.

• Implemented async click-event aggregation with bounded BlockingQueue and
  scheduled batch flush (1s interval, 500-row batches), decoupling analytics
  writes from the redirect hot path. Sustained 3,500 RPS on a single 4-vCPU
  instance.

• JWT auth with refresh-token rotation and reuse-detection (chain revocation
  on theft suspicion); per-IP and per-user rate limiting via Bucket4j;
  RFC 7807 problem-details error responses with request correlation IDs.

• 87% line coverage with JUnit 5 + Testcontainers (real Postgres + Redis);
  GitHub Actions CI enforces coverage threshold; structured JSON logs and
  Prometheus metrics with P50/P95/P99 histograms exposed via Actuator.

• React 18 + TypeScript dashboard with TanStack Query, Recharts time-series
  visualization, and Tailwind/shadcn UI; deployed to Fly.io with multi-stage
  Docker builds (<200MB image, non-root user).
```

---

## Final notes from the senior engineer's perspective

1. **Build it slowly.** A shipped, well-documented v1 beats a half-finished v3.
2. **Measure before optimizing.** Get k6 numbers before you tune anything.
3. **Write the trade-offs doc as you go**, not at the end. It's the document recruiters quote in interviews.
4. **Commit history is part of the project.** Don't squash everything. Show iteration: `feat: add base62 codec` → `fix: handle id=0 in base62` → `test: add property test for round-trip`.
5. **The README is the front door.** A great README with one screenshot, one architecture diagram, and a 90-second video link beats 100 commits of unread code.

Build small. Build deep. Ship it. When a hiring manager asks "tell me about a project," you'll have 30 minutes of real, honest, technical material to draw from. That's the whole game.