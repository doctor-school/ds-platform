@host:academy
Feature: Alpha

  Background:
    Given the alpha page is open

  @EARS-1
  Scenario Outline: every row bound
    Then I see <count> items

    Examples:
      | count |
      | 1     |
      | 2     |

    Examples:
      | count |
      | 3     |

  @EARS-1
  Scenario Outline: a later row unbound
    Then I see <count> items

    Examples:
      | count |
      | 1     |

    Examples:
      | count |
      | 2     |
      | many  |

  @EARS-1
  Scenario: background only
