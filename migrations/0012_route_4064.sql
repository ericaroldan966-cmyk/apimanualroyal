INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('royal', '5491134264064', 1, '4064', '2026-10-06T00:00:00.000Z'),
  ('kova', '5491134264064', 1, '4064', '2026-10-06T00:00:00.000Z'),
  ('paraguay', '5491134264064', 1, '4064', '2026-10-06T00:00:00.000Z');

UPDATE whatsapp_lines SET active = 0 WHERE tenant IN ('royal', 'kova', 'paraguay') AND number != '5491134264064';
UPDATE whatsapp_lines SET active = 1, label = '4064' WHERE tenant IN ('royal', 'kova', 'paraguay') AND number = '5491134264064';
