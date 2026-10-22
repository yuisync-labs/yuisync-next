-- Additive audit ledger. No commercial or customer data is duplicated here.
ALTER TABLE luna_proposals ADD COLUMN operation_id TEXT;
CREATE INDEX luna_proposals_operation ON luna_proposals(tenant_id,module_id,conversation_id,operation_id,status);
CREATE TABLE luna_proposal_presentations (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL, proposal_version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  outbound_message_id TEXT NOT NULL, presented_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,conversation_id,proposal_id),
  FOREIGN KEY(tenant_id,module_id,proposal_id) REFERENCES luna_proposals(tenant_id,module_id,id)
);
CREATE INDEX luna_presentations_message ON luna_proposal_presentations(tenant_id,module_id,conversation_id,outbound_message_id);
CREATE TABLE luna_operation_events (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  previous_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,conversation_id,event_id),
  FOREIGN KEY (tenant_id,module_id,conversation_id)
    REFERENCES luna_conversations(tenant_id,module_id,conversation_id)
);
