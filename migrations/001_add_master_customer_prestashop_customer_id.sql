-- CP-R1-T02: link master_customer (CRM, main_management) to ps_customer (PrestaShop, pesas_productiva).
-- Additive only. Runs against main_management. Not executed yet — design artifact only.
--
-- MySQL treats NULL as distinct in a UNIQUE index, so this column can stay NULL
-- for every master_customer that has no resolved PrestaShop link yet; no partial/
-- filtered index is needed.
--
-- No FK to ps_customer: CRM and PrestaShop are kept as separate logical sources
-- (see README "Sources") even though they share physical infrastructure today.
-- Referential integrity against ps_customer is enforced by the Identity Resolver
-- and the population job, not by the database.

ALTER TABLE master_customer
  ADD COLUMN prestashop_customer_id INT UNSIGNED NULL AFTER platform_origin;

ALTER TABLE master_customer
  ADD CONSTRAINT uq_master_customer_prestashop_customer_id
  UNIQUE (prestashop_customer_id);
