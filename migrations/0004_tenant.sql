ALTER TABLE leads ADD COLUMN tenant TEXT NOT NULL DEFAULT 'royal';
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant);
