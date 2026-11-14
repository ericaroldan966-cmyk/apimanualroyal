-- Drop cancelled or stale Royal WhatsApp lines from the panel admin list.
DELETE FROM whatsapp_lines
WHERE tenant = 'royal'
  AND number IN (
    '5491134264064',
    '5491166226807',
    '5491166226816'
  );
