-- Restore Royal WhatsApp 4064 into active rotation.
INSERT INTO whatsapp_lines (tenant, number, active, label, created_at)
VALUES ('royal', '5491134264064', 1, '4064', '2026-11-16T00:00:00.000Z')
ON CONFLICT(tenant, number) DO UPDATE SET active = 1, label = '4064';
