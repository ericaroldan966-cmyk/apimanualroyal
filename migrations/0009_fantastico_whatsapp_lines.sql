INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('fantastico', '5491178916874', 1, 'Princ 1', '2026-09-20T00:00:00.000Z'),
  ('fantastico', '5492235482370', 1, 'Princ 2', '2026-09-20T00:00:00.000Z'),
  ('fantastico', '5491178879763', 1, 'Princ 3', '2026-09-20T00:00:00.000Z'),
  ('fantastico', '5491176755150', 1, 'Princ 4', '2026-09-20T00:00:00.000Z'),
  ('fantastico', '5491176755153', 1, 'Princ 5', '2026-09-20T00:00:00.000Z');

UPDATE whatsapp_lines SET active = 0 WHERE tenant = 'fantastico' AND number = '5491133449549';
