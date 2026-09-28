//! Windows Job Object Process Supervision
//! Binds child processes (such as Node.exe engine) to a Win32 Job Object
//! configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
//!
//! Kernel Invariant: When the Rust supervisor process terminates under any
//! circumstance (graceful exit, crash, or SIGKILL/taskkill), the Windows kernel
//! automatically and immediately terminates all child processes in the job object.
//! This completely eliminates zombie processes.

#[cfg(windows)]
use std::os::windows::io::RawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct JobObjectGuard {
    #[cfg(windows)]
    handle: HANDLE,
}

unsafe impl Send for JobObjectGuard {}
unsafe impl Sync for JobObjectGuard {}

impl JobObjectGuard {
    pub fn new() -> Result<Self, String> {
        #[cfg(windows)]
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                return Err("Failed to create Win32 Job Object".to_string());
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let result = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );

            if result == 0 {
                CloseHandle(handle);
                return Err("Failed to configure JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE".to_string());
            }

            Ok(Self { handle })
        }

        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }

    pub fn assign_process(&self, _process_handle: RawHandle) -> Result<(), String> {
        #[cfg(windows)]
        unsafe {
            if self.handle.is_null() || self.handle == INVALID_HANDLE_VALUE {
                return Err("Invalid Job Object handle".to_string());
            }

            let res = AssignProcessToJobObject(self.handle, _process_handle as HANDLE);
            if res == 0 {
                return Err("Failed to assign process to Win32 Job Object".to_string());
            }
            Ok(())
        }

        #[cfg(not(windows))]
        {
            Ok(())
        }
    }
}

impl Drop for JobObjectGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if !self.handle.is_null() && self.handle != INVALID_HANDLE_VALUE {
                CloseHandle(self.handle);
            }
        }
    }
}
