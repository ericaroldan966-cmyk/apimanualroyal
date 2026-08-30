CREATE TABLE IF NOT EXISTS ad_spend (
  day TEXT PRIMARY KEY,
  usd REAL NOT NULL,
  fx REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_day ON ad_spend(day);
