ALTER TABLE leads ADD COLUMN legacy_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_legacy_ref ON leads(legacy_ref);
