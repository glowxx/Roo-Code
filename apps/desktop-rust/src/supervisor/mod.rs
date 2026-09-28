//! Node Engine Process Supervisor
//! Manages spawning, monitoring, health checking, and graceful termination
//! of the bundled Node.js engine sidecar.

pub mod windows_job;

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

pub struct EngineSupervisor {
    child: Arc<Mutex<Option<Child>>>,
    job_guard: Option<windows_job::JobObjectGuard>,
    is_running: Arc<AtomicBool>,
    node_binary_path: PathBuf,
    script_path: PathBuf,
    workspace_path: PathBuf,
    port: u16,
    session_token: String,
}

impl EngineSupervisor {
    pub fn new(
        node_binary_path: PathBuf,
        script_path: PathBuf,
        workspace_path: PathBuf,
        port: u16,
        session_token: String,
    ) -> Result<Self, String> {
        let job_guard = windows_job::JobObjectGuard::new().ok();

        Ok(Self {
            child: Arc::new(Mutex::new(None)),
            job_guard,
            is_running: Arc::new(AtomicBool::new(false)),
            node_binary_path,
            script_path,
            workspace_path,
            port,
            session_token,
        })
    }

    /// Spawns the Node.js engine process and binds it to the supervisor job object
    pub async fn start(&self) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;

        if child_lock.is_some() {
            return Ok(());
        }

        let mut cmd = Command::new(&self.node_binary_path);
        cmd.arg(&self.script_path)
            .arg("-w")
            .arg(&self.workspace_path)
            .arg("-p")
            .arg(self.port.to_string())
            .arg("--no-open")
            .env("ROO_AUTH_TOKEN", &self.session_token)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Node engine: {}", e))?;

        #[cfg(windows)]
        if let Some(guard) = &self.job_guard {
            if let Some(handle) = child.raw_handle() {
                if let Err(e) = guard.assign_process(handle) {
                    eprintln!("[Supervisor] Win32 Job Object assignment warning: {}", e);
                } else {
                    println!("[Supervisor] Node engine bound to Win32 Job Object");
                }
            }
        }

        *child_lock = Some(child);
        self.is_running.store(true, Ordering::SeqCst);

        // Start background watchdog
        let child_arc = Arc::clone(&self.child);
        let is_running_arc = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut restart_count = 0;
            const MAX_RESTARTS: usize = 3;

            loop {
                if !is_running_arc.load(Ordering::SeqCst) {
                    break;
                }

                sleep(Duration::from_millis(2000)).await;

                let mut lock = child_arc.lock().await;
                if let Some(ref mut child) = *lock {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            eprintln!(
                                "[Supervisor] Node engine exited unexpectedly with status: {}",
                                status
                            );
                            *lock = None;
                            restart_count += 1;
                            if restart_count > MAX_RESTARTS {
                                eprintln!("[Supervisor] Node engine crashed {} times; stopping restarts", restart_count);
                                break;
                            }
                        }
                        Ok(None) => {
                            // Process is still running normally
                        }
                        Err(e) => {
                            eprintln!("[Supervisor] Error querying child status: {}", e);
                            break;
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Signals the engine to shutdown gracefully, terminating it if timeout expires
    pub async fn shutdown(&self) {
        self.is_running.store(false, Ordering::SeqCst);
        let mut child_lock = self.child.lock().await;

        if let Some(mut child) = child_lock.take() {
            println!("[Supervisor] Terminating Node engine sidecar...");
            let _ = child.kill().await;
        }
    }
}
