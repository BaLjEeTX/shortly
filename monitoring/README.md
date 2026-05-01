# Observability — Loki + Promtail + Prometheus + Grafana

Brought up alongside the rest of the stack:

```bash
docker compose up -d
```

Four extra containers start: `loki`, `promtail`, `prometheus`, `grafana`.

## Open Grafana

http://localhost:3001
Login: `admin` / `admin` (anonymous Viewer access is also enabled, so you can
browse without logging in).

The "Shortly — Overview" dashboard is auto-provisioned in the home folder. It
has live API logs, an ERROR/WARN-only panel, request rate by status, P50/P95/P99
latency, JVM heap, and live thread count.

## Useful queries

LogQL (Explore → Loki):

```
{service="api"}                                  # all api logs, live
{service="api", level="ERROR"}                   # errors only
{service="api"} |= "OAuth"                       # contains "OAuth"
{service="api"} | json | line_format "{{.message}}"
{service=~"api|postgres|redis"}                  # multi-service tail
sum by (level) (rate({service="api"}[5m]))       # log volume by level
```

PromQL (Explore → Prometheus):

```
sum by (status) (rate(http_server_requests_seconds_count{service="api"}[1m]))
histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket[5m])))
hikaricp_connections_active
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}
```

## How it's wired

```
┌──────────┐   stdout JSON   ┌──────────┐  push  ┌──────┐  query  ┌─────────┐
│   api    │────────────────▶│ promtail │───────▶│ loki │◀────────│ grafana │
└──────────┘                 └──────────┘        └──────┘         └─────────┘
                                                                       ▲
┌──────────┐  /actuator/prometheus                ┌────────────┐       │
│   api    │─────────────────────────────────────▶│ prometheus │───────┘
└──────────┘                                      └────────────┘
```

- The Spring Boot app writes JSON logs to stdout (configured in
  `backend/src/main/resources/logback-spring.xml`). MDC fields like `traceId`,
  `userId`, `requestId` come through as JSON keys.
- Promtail discovers every Docker container automatically, applies the
  compose service name as the `service` label, and JSON-decodes lines from the
  `api` service so `level` becomes a Loki label.
- Prometheus scrapes `http://api:8080/actuator/prometheus` every 15s.
- Grafana loads its datasources and dashboards from
  `monitoring/grafana/provisioning` on startup — edit the JSON dashboard and
  reload Grafana to pick changes up.

## Ports

| Service    | Host port | Notes                                |
|------------|-----------|--------------------------------------|
| Grafana    | 3001      | Frontend already uses 3000           |
| Prometheus | 9090      |                                      |
| Loki       | 3100      | Push API on `/loki/api/v1/push`      |

## Troubleshooting

**Promtail isn't shipping logs.** It needs the host Docker socket. On Linux
this Just Works. On Docker Desktop (Mac/Windows) the bind mount
`/var/run/docker.sock` already maps through the VM. If you see
"permission denied", run `chmod 666 /var/run/docker.sock` (Linux) or
restart Docker Desktop.

**Grafana shows "no data" on log panels.** Check `docker compose logs promtail`
— if it can't reach Loki you'll see connection refused. Wait ~10s after
`up -d` for Loki's healthcheck to pass.

**Prometheus target is DOWN.** Open http://localhost:9090/targets — if the
api target is red, the most likely cause is `/actuator/prometheus` returning
401 (Spring Security). The `SecurityConfig` has been updated to
`permitAll` that path; rebuild the api: `docker compose up -d --build api`.
