-- Person numbers use SQLite rowid. Do not copy leads into a new table.
ALTER TABLE leads ADD COLUMN ad INTEGER;
