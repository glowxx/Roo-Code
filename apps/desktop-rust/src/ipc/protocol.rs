//! Versioned and Monotonic IPC Protocol Specification
//! Ensures type safety, backwards compatibility, and out-of-order rejection.

use serde::{Deserialize, Serialize};

pub const CURRENT_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcEnvelope {
    pub protocol_version: u32,
    pub msg_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub workspace_epoch: u32,
    pub sequence_number: u64,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub channel: String,
    pub payload: serde_json::Value,
    pub timestamp: u64,
}

impl IpcEnvelope {
    pub fn new(
        channel: impl Into<String>,
        msg_type: impl Into<String>,
        payload: serde_json::Value,
        workspace_epoch: u32,
        sequence_number: u64,
    ) -> Self {
        Self {
            protocol_version: CURRENT_PROTOCOL_VERSION,
            msg_id: uuid::Uuid::new_v4().to_string(),
            request_id: None,
            task_id: None,
            workspace_epoch,
            sequence_number,
            msg_type: msg_type.into(),
            channel: channel.into(),
            payload,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }
    }

    /// Verifies whether the envelope is compatible with current engine version
    pub fn is_version_supported(&self) -> bool {
        self.protocol_version == CURRENT_PROTOCOL_VERSION
    }

    /// Validates whether the event is still fresh or stale based on workspace epoch and sequence
    pub fn is_fresh(&self, current_epoch: u32, last_seen_sequence: u64) -> bool {
        if self.workspace_epoch < current_epoch {
            return false;
        }
        if self.sequence_number > 0 && self.sequence_number <= last_seen_sequence {
            return false;
        }
        true
    }
}
