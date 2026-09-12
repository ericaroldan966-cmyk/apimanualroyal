-- Snapshot only. Railway applies migrations/*.sql on every boot; do not exec this file against an existing DB.
CREATE TABLE IF NOT EXISTS leads (
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
  purchase_meta_error TEXT,
  legacy_ref TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  monto REAL NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  events_received INTEGER,
  meta_status TEXT,
  meta_error TEXT,
  forced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_spend (
  tenant TEXT NOT NULL DEFAULT 'royal',
  day TEXT NOT NULL,
  usd REAL NOT NULL,
  fx REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant, day)
);

CREATE INDEX IF NOT EXISTS idx_leads_telefono ON leads(telefono);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_ad_id ON leads(ad_id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant);
CREATE INDEX IF NOT EXISTS idx_purchases_ref ON purchases(ref);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ad_spend_day ON ad_spend(day);
