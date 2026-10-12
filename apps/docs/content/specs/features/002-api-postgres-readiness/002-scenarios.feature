@host:academy
Feature: API readiness via GET /v1/ready
  As an operator or external readiness probe
  I want a public readiness endpoint that verifies Postgres + pgvector + object storage
  So that I can detect whether the API can actually serve real traffic
  (not just whether the process is alive — that is /v1/health)

  Background:
    Given the API process is running
    And the Postgres connection pool is initialized from DATABASE_URL
    And the initial Drizzle migration has been applied
    And the object-storage probe has run at startup

  # EARS-1
  Scenario: Readiness endpoint reports ok when Postgres, pgvector and object storage all respond
    Given Postgres accepts connections
    And the "vector" extension is installed in the database
    And the last object-storage probe succeeded
    When the client sends a GET request to "/v1/ready"
    Then the response status is 200
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "ok"
    And the response body has field "checks.postgres" equal to "ok"
    And the response body has field "checks.pgvector" equal to "ok"
    And the response body has field "checks.objectStorage" equal to "ok"
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the ReadinessResponse schema from "@ds/schemas"

  # EARS-2 — degraded variant A
  Scenario: Readiness endpoint reports down when Postgres is unreachable
    Given Postgres refuses TCP connections (port closed) or rejects queries within the statement_timeout
    And the last object-storage probe succeeded
    When the client sends a GET request to "/v1/ready"
    Then the response status is 503
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "down"
    And the response body has field "checks.postgres" equal to "down"
    And the response body has field "checks.pgvector" equal to "ok"
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the ReadinessResponse schema from "@ds/schemas"

  # EARS-2 — degraded variant B
  Scenario: Readiness endpoint reports down when the pgvector extension is missing
    Given Postgres accepts connections
    And the "vector" extension is NOT installed in the database
    And the last object-storage probe succeeded
    When the client sends a GET request to "/v1/ready"
    Then the response status is 503
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "down"
    And the response body has field "checks.postgres" equal to "ok"
    And the response body has field "checks.pgvector" equal to "down"
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the ReadinessResponse schema from "@ds/schemas"

  # EARS-2 — degraded variant C
  Scenario: Readiness endpoint reports down when object storage refuses the credentials
    Given Postgres accepts connections
    And the "vector" extension is installed in the database
    And the object store answers the probe with "InvalidAccessKeyId" HTTP 403
    When the client sends a GET request to "/v1/ready"
    Then the response status is 503
    And the response body has field "status" equal to "down"
    And the response body has field "checks.postgres" equal to "ok"
    And the response body has field "checks.pgvector" equal to "ok"
    And the response body has field "checks.objectStorage" equal to "down"
    And the response body does not contain "InvalidAccessKeyId"
    And the response body matches the ReadinessResponse schema from "@ds/schemas"

  # EARS-3
  Scenario: The object-storage state is cached, refreshed every 60 seconds and logged on transitions only
    Given the api started while the object store refuses the credentials
    Then the api log has one WARN "object storage is down: InvalidAccessKeyId (HTTP 403)"
    When 3 refresh intervals of 60 seconds pass with the store still refusing
    Then the api log still has exactly one such WARN
    When the credentials are fixed and the next refresh interval passes
    Then the api log has a LOG "object storage recovered"
    And "GET /v1/ready" responds 200 without any request reaching the object store
    And "GET /v1/health" responded 200 throughout
