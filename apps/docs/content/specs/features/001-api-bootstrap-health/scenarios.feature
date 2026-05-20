Feature: API liveness via GET /v1/health
  As an operator or external uptime probe
  I want a public liveness endpoint
  So that I can detect whether the API process is running and responsive

  # EARS-1
  Scenario: Health endpoint reports ok on a running process
    Given the API process is running
    When the client sends a GET request to "/v1/health"
    Then the response status is 200
    And the response Content-Type is "application/json"
    And the response body has field "status" equal to "ok"
    And the response body has field "uptime" of type number with value >= 0
    And the response body has field "timestamp" matching an ISO-8601 datetime
    And the response body matches the HealthResponse schema from "@ds/schemas"
