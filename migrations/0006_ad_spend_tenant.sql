-- Rebuild ad_spend so tenant is part of the primary key.
-- @skip_if_column ad_spend.tenant

CREATE TABLE ad_spend_mt (
  tenant TEXT NOT NULL DEFAULT 'royal',
  day TEXT NOT NULL,
  usd REAL NOT NULL,
  fx REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant, day)
);

INSERT INTO ad_spend_mt (tenant, day, usd, fx, updated_at)
SELECT 'royal', day, usd, fx, updated_at FROM ad_spend;

DROP TABLE ad_spend;
ALTER TABLE ad_spend_mt RENAME TO ad_spend;
CREATE INDEX IF NOT EXISTS idx_ad_spend_day ON ad_spend(day);
