-- Logical rollback for 001_add_master_customer_prestashop_customer_id.sql.
-- Destructive to every PrestaShop link currently stored: DROP COLUMN loses
-- prestashop_customer_id for every linked master_customer. This is NOT safe to run
-- once Customer Profile depends on this column in production. Before running this
-- after productive activation, export and back up the full mapping first.

ALTER TABLE master_customer
  DROP INDEX uq_master_customer_prestashop_customer_id;

ALTER TABLE master_customer
  DROP COLUMN prestashop_customer_id;
