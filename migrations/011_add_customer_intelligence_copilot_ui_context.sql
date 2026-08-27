-- task MARKETING-R1-T06.4: bounded, persisted state for the currently active dashboard-selected
-- population (queryPlanHash, label-projected filters, resolved snapshot ids, matchingPopulation,
-- turn association) - the same per-field JSON column convention pinned_context_json/
-- resolved_ids_json already use on this table. Nullable: most sessions never carry a uiContext.
ALTER TABLE customer_intelligence_copilot_conversation
  ADD COLUMN ui_context_json JSON NULL AFTER resolved_ids_json;
