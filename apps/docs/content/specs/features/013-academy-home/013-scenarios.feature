# 013 — Public Academy home and durable partner-lead capture
# User-facing browser scenarios plus API/worker failure branches.
# Tags map to the flat EARS ids in 013-requirements-en.md.

Feature: A visitor uses the Academy home and submits one durable partner lead

  Background:
    Given the public Academy home uses the owner-approved source pin "7330e4d8a99bdeca73285e2b4eabf09d7021788c"
    And the active lead policy has URL "https://doctor.school/index/privacy-pay" and immutable version evidence
    And the Academy lead endpoint is public, rate-limited, bot-protected, high-stakes authorized, and audited
    And the private Academy-leads Mattermost destination is configured only for the notifications worker

  @EARS-1 @EARS-2 @EARS-3 @happy
  Scenario: A guest opens the exact owner-curated Academy home
    When an unauthenticated visitor opens "/"
    Then the route renders without redirecting to "/webinars"
    And the sections appear in the order hero, What, People, Events, Why, Projects, partner value, formats, lead form, footer
    And the hero is one full-width partner hero with "14 партнёров · прозрачная модель"
    And People shows the Project block before exactly six supplied expert portraits
    And the Project block and Events show the same two canonical rows in the same order
    And the B2B row links exactly to "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd"
    And no dynamic feed, false project metric, replacement portrait, or disabled demo affordance appears

  @EARS-4 @happy
  Scenario: Navigation, mobile menu, login, and links are real
    Given the visitor can use the page header, footer, and mobile menu
    When the visitor activates each labelled navigation, content, contact, privacy, theme, and partner action
    Then each action reaches its documented route, section, URL, theme, or form state
    And the login action enters the existing authentication flow

  @EARS-4 @happy
  Scenario: Login defaults to webinars while the home remains public
    Given a visitor has no stronger saved resume destination
    When the visitor completes login
    Then the browser lands directly on "/webinars"
    When the authenticated visitor explicitly opens "/"
    Then the public Academy home remains visible

  @EARS-6 @failure
  Scenario Outline: Invalid lead input is rejected before a network request
    Given the lead form contains "<case>"
    When the visitor activates "Обсудить партнёрство"
    Then no request is sent to "/v1/academy/leads"
    And no database row is written
    And an actionable error is associated with and focuses "<field>"
    And all other valid input remains present

    Examples:
      | case                                  | field             |
      | no name                               | Имя               |
      | malformed email-or-Telegram contact   | Email или Telegram|
      | consent is not checked                | consent checkbox  |

  @EARS-6 @EARS-7 @failure
  Scenario Outline: Public protection rejects generically without exposing personal data
    Given a valid lead form and one generated Idempotency-Key
    And the request is rejected by "<protection>"
    When the visitor submits the form
    Then the response is "<status>" with a generic actionable message
    And the response, page, logs, errors, metrics, and traces contain no submitted name, company, contact, webhook URL, or provider payload
    And no lead, consent, or outbox row is created

    Examples:
      | protection | status |
      | rate limit | 429    |
      | bot gate   | rejected |

  @EARS-7 @EARS-8 @EARS-9 @happy
  Scenario: A valid partner request commits before the browser sees success
    Given the visitor enters a valid name, optional company, valid email-or-Telegram, optional role, and checks consent
    When the visitor submits with a new Idempotency-Key
    Then one withRequestAuditContext transaction creates one retained Academy lead
    And it creates immutable consent evidence tied restrictively to that lead
    And the evidence contains the exact policy URL, active version tag, normalized snapshot or retained reference, SHA-256, and database-clock acceptedAt
    And it creates one retained job outbox row whose payload is only the lead id
    And it completes the idempotency record
    And the transaction commits before a PD-free accepted response is returned
    And the browser shows "Заявка отправлена" without waiting for Mattermost

  @EARS-9 @failure
  Scenario: Client-supplied consent evidence cannot replace the server version
    Given a valid lead body also contains a forged policy version, hash, URL, or acceptedAt
    When the API accepts the request
    Then the stored evidence uses only the immutable active server policy and database clock
    And the guest lead is not stored through the unchanged user-FK consent_records model

  @EARS-10 @happy
  Scenario: A network ambiguity retries one accepted submission without a duplicate
    Given a valid submission commits but the browser loses the accepted response
    When the browser retries the same canonical payload with the same Idempotency-Key
    Then the API returns the identical accepted result
    And exactly one lead, one consent evidence row, one outbox row, and one notification intent exist

  @EARS-10 @failure
  Scenario: Reusing an idempotency key for different data conflicts without writing
    Given an accepted request exists for an Idempotency-Key
    When a caller sends a different canonical payload with that same key
    Then the API returns conflict without echoing either payload
    And no additional lead, consent, outbox, or notification is created

  @EARS-11 @EARS-12 @happy
  Scenario: The durable outbox delivers through the least-privilege worker
    Given a committed lead has a ready outbox row
    When the drainer creates a BullMQ job with job id equal to the outbox id
    And the notifications worker receives the job
    Then the worker loads the minimum lead fields by lead id
    And only the worker reads ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL
    And the message goes only to the private authorized Academy-leads channel with a stable lead id
    And provider acknowledgement completes the retained outbox
    And neither the secret nor message payload is logged

  @EARS-11 @EARS-13 @failure
  Scenario: Mattermost outage does not lose the lead or reverse visitor success
    Given a valid lead and outbox transaction has committed
    And Mattermost returns a transient failure or ambiguous timeout
    When the notifications worker handles delivery
    Then the visitor still has the accepted success state
    And the lead remains retained as the record of truth
    And the outbox remains pending with exponential backoff and jitter
    And an expired claim can be reclaimed after a Redis or worker restart
    And the stable lead id allows a duplicate message to be recognized after an ambiguous timeout

  @EARS-13 @failure
  Scenario: Exhausted delivery remains visible and replayable
    Given a lead notification reaches its automatic attempt limit
    When the final automatic attempt fails
    Then the retained outbox becomes exhausted rather than discarded
    And a PD-free operational alert is emitted
    And an authorized operator can replay the same outbox without creating another lead

  @EARS-14 @failure
  Scenario Outline: Unapproved egress fails closed after persistence
    Given a valid lead and outbox transaction has committed
    And the Mattermost destination has "<problem>"
    When the notifications worker evaluates the delivery
    Then no provider request is sent
    And the visitor keeps the accepted success state
    And the lead and outbox remain retained for retry or authorized replay
    And only a PD-free operational signal is emitted

    Examples:
      | problem                                      |
      | no verified RF or approved-perimeter status |
      | no ADR-0011 allowlist entry                  |
      | no Academy-leads worker secret               |

  @EARS-12 @failure
  Scenario: The Academy lead webhook never falls back or reaches the browser
    Given ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL is absent from the notifications worker
    And MATTERMOST_WEBHOOK_URL exists for release notifications
    When a lead notification becomes ready
    Then delivery fails closed without using MATTERMOST_WEBHOOK_URL
    And no NEXT_PUBLIC variable, portal bundle, API response, log, or trace contains either webhook URL

  @EARS-15 @happy
  Scenario: Lead data follows retained-row and masking policy
    Given the Feature 013 database migration is evaluated
    Then lead, consent evidence, and outbox entries exist in the code retention matrix
    And ordinary lifecycle uses classified status, deletedAt, append-only evidence, value erasure, tombstone, or crypto-shred
    And it never physically deletes or cascade-deletes an application-owned row
    And audit before/after images and all operational surfaces mask lead personal data

  @EARS-5 @EARS-16 @happy
  Scenario Outline: The complete page and form are accessible in every visual matrix cell
    Given the Academy home is rendered at the "<breakpoint>" breakpoint in the "<theme>" theme
    When a keyboard and screen-reader user navigates the full page and reject-to-accept form journey
    Then content order and exact assets remain correct
    And hover, active, focus, loading, error, and success states are visible
    And every control is keyboard-operable and labelled
    And axe reports no WCAG 2 A or AA violations

    Examples:
      | breakpoint | theme |
      | desktop    | light |
      | desktop    | dark  |
      | mobile     | light |
      | mobile     | dark  |
