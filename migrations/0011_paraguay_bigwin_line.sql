INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('paraguay', '5491165760027', 1, 'R1', '2026-09-25T00:00:00.000Z');

UPDATE whatsapp_lines SET active = 1, label = 'R1' WHERE tenant = 'paraguay' AND number = '5491165760027';
DELETE FROM whatsapp_lines WHERE tenant = 'paraguay' AND number != '5491165760027';
