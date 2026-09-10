CREATE TABLE IF NOT EXISTS leads_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'VISIT',
  fbclid TEXT,
  fbp TEXT,
  fbc TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  campaign_name TEXT,
  adset_name TEXT,
  ad_name TEXT,
  landing_url TEXT,
  referrer TEXT,
  telefono TEXT,
  client_ip TEXT,
  user_agent TEXT,
  tenant TEXT NOT NULL DEFAULT 'royal',
  ad INTEGER,
  lead_enviado INTEGER NOT NULL DEFAULT 0,
  lead_event_id TEXT,
  lead_sent_at TEXT,
  lead_events_received INTEGER,
  lead_meta_error TEXT,
  purchase_enviado INTEGER NOT NULL DEFAULT 0,
  purchase_event_id TEXT,
  monto_purchase REAL,
  fecha_purchase TEXT,
  purchase_events_received INTEGER,
  purchase_meta_error TEXT
);

INSERT INTO leads_v2 (
  ref, created_at, updated_at, status,
  fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
  landing_url, referrer, telefono, client_ip, user_agent, tenant, ad,
  lead_enviado, lead_event_id, lead_sent_at, lead_events_received, lead_meta_error,
  purchase_enviado, purchase_event_id, monto_purchase, fecha_purchase,
  purchase_events_received, purchase_meta_error
)
SELECT
  ref, created_at, updated_at, status,
  fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
  landing_url, referrer, telefono, client_ip, user_agent,
  COALESCE(tenant, 'royal'), NULL,
  lead_enviado, lead_event_id, lead_sent_at, lead_events_received, lead_meta_error,
  purchase_enviado, purchase_event_id, monto_purchase, fecha_purchase,
  purchase_events_received, purchase_meta_error
FROM leads
ORDER BY created_at ASC, ref ASC;

DROP TABLE leads;
ALTER TABLE leads_v2 RENAME TO leads;

CREATE INDEX IF NOT EXISTS idx_leads_telefono ON leads(telefono);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_ad_id ON leads(ad_id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant);
