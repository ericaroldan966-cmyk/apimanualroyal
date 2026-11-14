-- Drop cancelled Royal WhatsApp line 4064 from the panel admin list.
DELETE FROM whatsapp_lines
WHERE tenant = 'royal'
  AND number = '5491134264064';
