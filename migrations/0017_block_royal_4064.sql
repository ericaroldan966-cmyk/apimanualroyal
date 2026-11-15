-- Hard purge: 4064 must never remain on Royal (panel can re-POST until API rejects it).
DELETE FROM whatsapp_lines
WHERE tenant = 'royal'
  AND number = '5491134264064';
