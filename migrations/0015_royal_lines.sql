INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('royal', '5491125189009', 1, '9009', '2026-10-31T18:45:00.000Z'),
  ('royal', '5491168716471', 1, '6471', '2026-10-31T18:45:00.000Z'),
  ('royal', '5491125189268', 1, '9268', '2026-10-31T18:45:00.000Z');

UPDATE whatsapp_lines SET active = 1, label = '9009' WHERE tenant = 'royal' AND number = '5491125189009';
UPDATE whatsapp_lines SET active = 1, label = '6471' WHERE tenant = 'royal' AND number = '5491168716471';
UPDATE whatsapp_lines SET active = 1, label = '9268' WHERE tenant = 'royal' AND number = '5491125189268';

DELETE FROM whatsapp_lines
WHERE tenant = 'royal'
  AND number NOT IN (
    '5491125189009',
    '5491168716471',
    '5491125189268'
  );
