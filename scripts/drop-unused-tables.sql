-- Removes tables and a column the app no longer uses.
-- Back up the database first. Run it once on each database; on an already-cleaned database the last statement reports an error that can be ignored.
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS receipt_sequences;
DROP TABLE IF EXISTS sales_receipts;
ALTER TABLE users DROP COLUMN is_super_admin;
