-- Restore Royal WhatsApp 5339 into active rotation.
INSERT INTO whatsapp_lines (tenant, number, active, label, created_at)
VALUES ('royal', '5491165525339', 1, '5339', '2026-11-18T00:00:00.000Z')
ON CONFLICT(tenant, number) DO UPDATE SET active = 1, label = '5339';
