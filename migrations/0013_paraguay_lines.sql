INSERT OR IGNORE INTO whatsapp_lines (tenant, number, active, label, created_at) VALUES
  ('paraguay', '5491168571780', 1, '1780', '2026-10-31T00:00:00.000Z'),
  ('paraguay', '5491125193334', 1, '3334', '2026-10-31T00:00:00.000Z'),
  ('paraguay', '5491168572036', 1, '2036', '2026-10-31T00:00:00.000Z'),
  ('paraguay', '5491168716683', 1, '6683', '2026-10-31T00:00:00.000Z'),
  ('paraguay', '5491125584915', 1, '4915', '2026-10-31T00:00:00.000Z');

UPDATE whatsapp_lines SET active = 1, label = '1780' WHERE tenant = 'paraguay' AND number = '5491168571780';
UPDATE whatsapp_lines SET active = 1, label = '3334' WHERE tenant = 'paraguay' AND number = '5491125193334';
UPDATE whatsapp_lines SET active = 1, label = '2036' WHERE tenant = 'paraguay' AND number = '5491168572036';
UPDATE whatsapp_lines SET active = 1, label = '6683' WHERE tenant = 'paraguay' AND number = '5491168716683';
UPDATE whatsapp_lines SET active = 1, label = '4915' WHERE tenant = 'paraguay' AND number = '5491125584915';

DELETE FROM whatsapp_lines
WHERE tenant = 'paraguay'
  AND number NOT IN (
    '5491168571780',
    '5491125193334',
    '5491168572036',
    '5491168716683',
    '5491125584915'
  );
