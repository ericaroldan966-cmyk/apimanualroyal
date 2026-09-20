CREATE TABLE IF NOT EXISTS whatsapp_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant TEXT NOT NULL,
  number TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant, number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_lines_tenant ON whatsapp_lines(tenant);
CREATE INDEX IF NOT EXISTS idx_whatsapp_lines_tenant_active ON whatsapp_lines(tenant, active);

INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('royal', '5491125689335', 1, '9335', '2026-09-20T00:00:00.000Z'),
  ('royal', '5491125778364', 1, '8364', '2026-09-20T00:00:00.000Z'),
  ('royal', '5491125693189', 1, '3189', '2026-09-20T00:00:00.000Z'),
  ('royal', '5491125546449', 1, '6449', '2026-09-20T00:00:00.000Z'),
  ('kova', '5491125689335', 1, '9335', '2026-09-20T00:00:00.000Z'),
  ('kova', '5491125778364', 1, '8364', '2026-09-20T00:00:00.000Z'),
  ('kova', '5491125546449', 1, '6449', '2026-09-20T00:00:00.000Z'),
  ('kova', '5491125693189', 1, '3189', '2026-09-20T00:00:00.000Z'),
  ('fantastico', '5491133449549', 1, '9549', '2026-09-20T00:00:00.000Z'),
  ('paraguay', '595992132731', 1, '2731', '2026-09-20T00:00:00.000Z');
