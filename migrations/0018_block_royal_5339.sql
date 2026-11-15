-- Hard purge: 5339 must never remain on Royal.
DELETE FROM whatsapp_lines
WHERE tenant = 'royal'
  AND number = '5491165525339';
