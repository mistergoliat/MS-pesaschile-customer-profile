-- Rollback for 011_add_customer_intelligence_copilot_ui_context.sql
-- TARGET: same local MariaDB schema as the forward migration. DO NOT APPLY TO PRESTASHOP RDS.

ALTER TABLE customer_intelligence_copilot_conversation
  DROP COLUMN ui_context_json;
