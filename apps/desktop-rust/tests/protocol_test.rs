use roo_desktop_rust_lib::commands::fs::validate_path_within_root;
use roo_desktop_rust_lib::ipc::protocol::{IpcEnvelope, CURRENT_PROTOCOL_VERSION};
use serde_json::json;
use std::env;

#[test]
fn test_ipc_envelope_creation_and_version() {
    let payload = json!({ "status": "running", "taskId": "task-abc-123" });
    let env = IpcEnvelope::new("task:status", "event", payload.clone(), 1, 42);

    assert_eq!(env.protocol_version, CURRENT_PROTOCOL_VERSION);
    assert_eq!(env.channel, "task:status");
    assert_eq!(env.msg_type, "event");
    assert_eq!(env.workspace_epoch, 1);
    assert_eq!(env.sequence_number, 42);
    assert!(env.is_version_supported());
}

#[test]
fn test_ipc_envelope_freshness_and_stale_rejection() {
    let env = IpcEnvelope::new(
        "terminal:chunk",
        "stream_chunk",
        json!({ "line": "ok" }),
        2,
        100,
    );

    // Same epoch, newer sequence -> Fresh
    assert!(env.is_fresh(2, 99));

    // Older epoch -> Stale (discard)
    assert!(!env.is_fresh(3, 99));

    // Same epoch, older or equal sequence -> Stale (out of order duplicate)
    assert!(!env.is_fresh(2, 100));
    assert!(!env.is_fresh(2, 105));
}

#[test]
fn test_validate_path_within_root_boundary() {
    let current_dir = env::current_dir().expect("Failed to get current dir");
    let current_dir_str = current_dir.to_str().expect("Valid UTF-8 dir");

    // Relative path inside root
    let safe_res = validate_path_within_root("Cargo.toml", current_dir_str);
    assert!(safe_res.is_ok(), "Safe path inside root should succeed");

    // Relative traversal escaping root
    let traverse_res = validate_path_within_root("../../../Windows/System32", current_dir_str);
    assert!(
        traverse_res.is_err(),
        "Traversal outside root must be rejected"
    );

    // Empty path
    assert!(validate_path_within_root("", current_dir_str).is_err());
}
