Feature: API readiness via GET /v1/ready
  As an operator or external readiness probe
  I want a public readiness endpoint that verifies Postgres + pgvector
  So that I can detect whether the API can actually serve real traffic
  (not just whether the process is alive — that is /v1/health)

  Background:
    Given the API process is running
    And the Postgres connection pool is initialized from DATABASE_URL
    And the initial Drizzle migration has been applied

  # EARS-1
  Scenario: Readiness endpoint reports ok when Postgres + pgvector both respond
    Given Postgres accepts connections
    And the "vector" extension is installed in the database
    When the client sends a GET request to "/v1/ready"
    Then the response status is 200
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "ok"
    And the response body has field "checks.postgres" equal to "ok"
    And the response body has field "checks.pgvector" equal to "ok"
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the ReadinessResponse schema from "@ds/schemas"

  # EARS-2 — degraded variant A
  Scenario: Readiness endpoint reports down when Postgres is unreachable
    Given Postgres refuses TCP connections (port closed) or rejects queries within the statement_timeout
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
    When the client sends a GET request to "/v1/ready"
    Then the response status is 503
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "down"
    And the response body has field "checks.postgres" equal to "ok"
    And the response body has field "checks.pgvector" equal to "down"
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the ReadinessResponse schema from "@ds/schemas"
