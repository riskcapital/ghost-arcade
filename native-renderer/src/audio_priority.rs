//! Scheduling class for the clip audio mixer thread. An ordinary thread can be
//! held off the CPU for tens of milliseconds when other programs keep every
//! core busy, and the device then plays silence. Each OS has a class for audio
//! work that ordinary load does not starve; ask for it, and fall back quietly
//! when it is refused (the mixer still renders ahead to ride out short stalls).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MixerPriority { Unknown = 0, Normal = 1, Raised = 2, Realtime = 3 }
impl MixerPriority {
    pub fn label(self) -> &'static str {
        match self { Self::Unknown => "unknown", Self::Normal => "normal", Self::Raised => "raised", Self::Realtime => "realtime" }
    }
    pub fn from_u8(value: u8) -> Self {
        match value { 1 => Self::Normal, 2 => Self::Raised, 3 => Self::Realtime, _ => Self::Unknown }
    }
}

/// Held by the mixer thread for its lifetime (Windows reverts MMCSS on drop).
pub struct PriorityGuard { pub priority: MixerPriority, #[cfg(windows)] task: Option<windows::Win32::Foundation::HANDLE> }
impl PriorityGuard {
    pub fn normal() -> Self { Self { priority: MixerPriority::Normal, #[cfg(windows)] task: None } }
}
#[cfg(windows)]
impl Drop for PriorityGuard {
    fn drop(&mut self) {
        if let Some(handle) = self.task.take() { let _ = unsafe { windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(handle) }; }
    }
}

/// Raise the calling thread. `period` is how often it is woken (one device
/// callback); the work per wake is a small part of that.
#[cfg(target_os = "macos")]
pub fn raise_current_thread(period: std::time::Duration) -> PriorityGuard {
    #[repr(C)] struct TimeConstraint { period: u32, computation: u32, constraint: u32, preemptible: i32 }
    #[repr(C)] struct Timebase { numer: u32, denom: u32 }
    unsafe extern "C" {
        fn pthread_self() -> usize;
        fn pthread_mach_thread_np(thread: usize) -> u32;
        fn thread_policy_set(thread: u32, flavor: u32, info: *mut i32, count: u32) -> i32;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
        fn pthread_set_qos_class_self_np(qos: u32, relative: i32) -> i32;
    }
    const THREAD_TIME_CONSTRAINT_POLICY: u32 = 2;
    const QOS_CLASS_USER_INTERACTIVE: u32 = 0x21;
    let mut timebase = Timebase { numer: 0, denom: 0 };
    if unsafe { mach_timebase_info(&mut timebase) } == 0 && timebase.numer > 0 {
        let ticks = |ns: f64| (ns * timebase.denom as f64 / timebase.numer as f64).clamp(1.0, u32::MAX as f64) as u32;
        let period_ns = period.as_nanos().clamp(1_000_000, 50_000_000) as f64;
        // The time-constraint class the system audio threads use: up to half
        // of each period of CPU, finished within the period.
        let mut policy = TimeConstraint { period: ticks(period_ns), computation: ticks(period_ns * 0.5), constraint: ticks(period_ns), preemptible: 1 };
        let thread = unsafe { pthread_mach_thread_np(pthread_self()) };
        if unsafe { thread_policy_set(thread, THREAD_TIME_CONSTRAINT_POLICY, &mut policy as *mut TimeConstraint as *mut i32, 4) } == 0 {
            return PriorityGuard { priority: MixerPriority::Realtime };
        }
    }
    let priority = if unsafe { pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0) } == 0 { MixerPriority::Raised } else { MixerPriority::Normal };
    PriorityGuard { priority }
}

#[cfg(windows)]
pub fn raise_current_thread(_period: std::time::Duration) -> PriorityGuard {
    use windows::{Win32::System::Threading::{AvSetMmThreadCharacteristicsW, GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL}, core::w};
    let mut task_index = 0;
    // MMCSS "Pro Audio": the class DAWs and the Windows audio engine use.
    if let Ok(handle) = unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) } {
        return PriorityGuard { priority: MixerPriority::Realtime, task: Some(handle) };
    }
    let priority = if unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL) }.is_ok() { MixerPriority::Raised } else { MixerPriority::Normal };
    PriorityGuard { priority, task: None }
}

#[cfg(target_os = "linux")]
pub fn raise_current_thread(_period: std::time::Duration) -> PriorityGuard {
    #[repr(C)] struct SchedParam { sched_priority: i32 }
    unsafe extern "C" {
        fn pthread_self() -> usize;
        fn pthread_setschedparam(thread: usize, policy: i32, param: *const SchedParam) -> i32;
        fn setpriority(which: i32, who: u32, prio: i32) -> i32;
    }
    const SCHED_FIFO: i32 = 1;
    const PRIO_PROCESS: i32 = 0;
    // Real-time FIFO where the user's limits allow it (audio group / rtprio),
    // else a lower nice value for this thread (Linux nice is per thread), else as is.
    if unsafe { pthread_setschedparam(pthread_self(), SCHED_FIFO, &SchedParam { sched_priority: 10 }) } == 0 {
        return PriorityGuard { priority: MixerPriority::Realtime };
    }
    let priority = if unsafe { setpriority(PRIO_PROCESS, 0, -10) } == 0 { MixerPriority::Raised } else { MixerPriority::Normal };
    PriorityGuard { priority }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn raise_current_thread(_period: std::time::Duration) -> PriorityGuard { PriorityGuard { priority: MixerPriority::Normal } }
