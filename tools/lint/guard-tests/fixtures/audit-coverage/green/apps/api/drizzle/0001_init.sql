-- Fixture migration: attaches the audit trigger to widget_a, and creates an
-- audit_ledger partition child table (partition-noise the guard must ignore —
-- it is not a schema-declared table).
CREATE TRIGGER widget_a_audit AFTER INSERT OR UPDATE OR DELETE
  ON "widget_a" FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE TABLE "audit_ledger_p2099_01" PARTITION OF "audit_ledger"
  FOR VALUES FROM ('2099-01-01') TO ('2099-02-01');
