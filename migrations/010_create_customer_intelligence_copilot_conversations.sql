CREATE TABLE IF NOT EXISTS customer_intelligence_copilot_conversation (
  conversation_id CHAR(36) NOT NULL,
  version VARCHAR(96) NOT NULL,
  title VARCHAR(255) NULL,
  status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  last_activity_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  pinned_feature_snapshot_id BIGINT UNSIGNED NOT NULL,
  pinned_rfm_snapshot_id BIGINT UNSIGNED NULL,
  pinned_cluster_snapshot_id BIGINT UNSIGNED NULL,
  pinned_context_json JSON NOT NULL,
  resolved_ids_json JSON NOT NULL,
  summary_version VARCHAR(96) NULL,
  summary_text TEXT NULL,
  PRIMARY KEY (conversation_id),
  KEY idx_ci_copilot_conversation_activity (status, last_activity_at),
  KEY idx_ci_copilot_conversation_updated (updated_at),
  KEY idx_ci_copilot_conversation_feature_snapshot (pinned_feature_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_intelligence_copilot_message (
  message_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  turn_id VARCHAR(96) NOT NULL,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(64) NOT NULL,
  query_ids_json JSON NOT NULL,
  source_query_ids_json JSON NOT NULL,
  model_provider VARCHAR(64) NULL,
  model_name VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (message_id),
  KEY idx_ci_copilot_message_conversation_created (conversation_id, created_at),
  KEY idx_ci_copilot_message_turn (conversation_id, turn_id),
  CONSTRAINT fk_ci_copilot_message_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES customer_intelligence_copilot_conversation (conversation_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_intelligence_copilot_query_execution (
  conversation_id CHAR(36) NOT NULL,
  turn_id VARCHAR(96) NOT NULL,
  query_id VARCHAR(128) NOT NULL,
  query_plan_hash CHAR(64) NOT NULL,
  plan_json JSON NOT NULL,
  snapshot_provenance_json JSON NOT NULL,
  row_count INT UNSIGNED NOT NULL,
  truncated TINYINT(1) NOT NULL DEFAULT 0,
  result_metadata_json JSON NOT NULL,
  result_sample_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (conversation_id, query_id),
  KEY idx_ci_copilot_query_turn (conversation_id, turn_id),
  KEY idx_ci_copilot_query_hash (query_plan_hash),
  CONSTRAINT fk_ci_copilot_query_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES customer_intelligence_copilot_conversation (conversation_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_intelligence_copilot_reference (
  conversation_id CHAR(36) NOT NULL,
  references_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (conversation_id),
  CONSTRAINT fk_ci_copilot_reference_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES customer_intelligence_copilot_conversation (conversation_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
