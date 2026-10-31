-- ARS quote used by the profitability tab. The existing fx column stays as the panel already saved it.
ALTER TABLE ad_spend ADD COLUMN fx_ars REAL NOT NULL DEFAULT 0;
ALTER TABLE ad_spend ADD COLUMN fx_kind TEXT NOT NULL DEFAULT '';
