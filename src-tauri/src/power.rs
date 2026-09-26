use std::sync::{Mutex, mpsc};
use std::thread::{self, JoinHandle};

use crate::error::AppError;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct PowerSettings {
    pub keep_awake: bool,
    pub prevent_screen_sleep: bool,
}

impl PowerSettings {
    fn flags(self) -> u32 {
        0x8000_0000
            | u32::from(self.keep_awake || self.prevent_screen_sleep)
            | if self.prevent_screen_sleep { 2 } else { 0 }
    }
}

struct Request(PowerSettings, mpsc::SyncSender<Result<(), AppError>>);
struct Worker {
    sender: mpsc::Sender<Request>,
    thread: JoinHandle<()>,
}
struct State {
    worker: Option<Worker>,
    current: PowerSettings,
    error: Option<AppError>,
}

pub struct PowerManager {
    state: Mutex<State>,
}

impl PowerManager {
    pub fn new() -> Self {
        Self::with_backend(apply_native)
    }

    fn with_backend(
        mut apply: impl FnMut(PowerSettings) -> Result<(), AppError> + Send + 'static,
    ) -> Self {
        let (sender, receiver) = mpsc::channel::<Request>();
        let worker = thread::Builder::new()
            .name("pi-power".into())
            .spawn(move || {
                // SetThreadExecutionState is thread-scoped: apply and release on this same worker.
                while let Ok(Request(settings, reply)) = receiver.recv() {
                    let _ = reply.send(apply(settings));
                }
                let _ = apply(PowerSettings::default());
            });
        let (worker, error) = match worker {
            Ok(thread) => (Some(Worker { sender, thread }), None),
            Err(_) => (None, Some(unavailable())),
        };
        Self {
            state: Mutex::new(State {
                worker,
                current: PowerSettings::default(),
                error,
            }),
        }
    }

    pub fn supported(&self) -> bool {
        cfg!(windows)
    }

    pub fn error(&self) -> Option<AppError> {
        self.state
            .lock()
            .map(|state| state.error.clone())
            .unwrap_or_else(|_| Some(unavailable()))
    }

    pub fn restore(&self, settings: PowerSettings) {
        if let Err(error) = self.apply_and_persist(settings, || Ok(())) {
            if let Ok(mut state) = self.state.lock() {
                state.error = Some(error);
            }
        }
    }

    pub fn apply_and_persist(
        &self,
        next: PowerSettings,
        persist: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut state = self.state.lock().map_err(|_| unavailable())?;
        let previous = state.current;
        if previous != next {
            apply_worker(&state, next)?;
        }
        if let Err(error) = persist() {
            if previous != next {
                if let Err(rollback) = apply_worker(&state, previous) {
                    state.current = next;
                    state.error = Some(rollback);
                    return Err(AppError::new(
                        "POWER_ROLLBACK_FAILED",
                        "保存失败且电源状态恢复失败，请重启应用以释放电源请求",
                    ));
                }
            }
            return Err(error);
        }
        state.current = next;
        state.error = None;
        Ok(())
    }

    pub fn shutdown(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(Worker { sender, thread }) = state.worker.take() {
                drop(sender);
                let _ = thread.join();
            }
            state.current = PowerSettings::default();
        }
    }
}

impl Drop for PowerManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn apply_worker(state: &State, settings: PowerSettings) -> Result<(), AppError> {
    let worker = state.worker.as_ref().ok_or_else(unavailable)?;
    let (reply, receive) = mpsc::sync_channel(1);
    worker
        .sender
        .send(Request(settings, reply))
        .map_err(|_| unavailable())?;
    receive.recv().map_err(|_| unavailable())?
}

fn unavailable() -> AppError {
    AppError::new("POWER_UNAVAILABLE", "系统电源服务不可用，请重启应用后重试")
}

#[cfg(windows)]
fn apply_native(settings: PowerSettings) -> Result<(), AppError> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    // SAFETY: the Win32 API takes only an integer bitmask and runs on our dedicated thread.
    if unsafe { SetThreadExecutionState(settings.flags()) } == 0 {
        Err(AppError::new(
            "POWER_APPLY_FAILED",
            "无法应用电源设置，请检查系统电源策略后重试",
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn apply_native(settings: PowerSettings) -> Result<(), AppError> {
    if settings.keep_awake || settings.prevent_screen_sleep {
        Err(AppError::new(
            "POWER_UNSUPPORTED",
            "当前平台暂不支持应用内电源控制，请使用系统电源设置",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[test]
    fn flags_are_independent_and_display_also_keeps_system_awake() {
        assert_eq!(PowerSettings::default().flags(), 0x8000_0000);
        assert_eq!(
            PowerSettings {
                keep_awake: true,
                prevent_screen_sleep: false
            }
            .flags(),
            0x8000_0001
        );
        assert_eq!(
            PowerSettings {
                keep_awake: false,
                prevent_screen_sleep: true
            }
            .flags(),
            0x8000_0003
        );
        assert_eq!(
            PowerSettings {
                keep_awake: true,
                prevent_screen_sleep: true
            }
            .flags(),
            0x8000_0003
        );
    }
    #[test]
    fn updates_roll_back_and_release_on_the_same_thread() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let manager = PowerManager::with_backend(move |s| {
            recorded
                .lock()
                .unwrap()
                .push((s.flags(), thread::current().id()));
            Ok(())
        });
        let keep = PowerSettings {
            keep_awake: true,
            prevent_screen_sleep: false,
        };
        manager.apply_and_persist(keep, || Ok(())).unwrap();
        assert!(
            manager
                .apply_and_persist(PowerSettings::default(), || Err(unavailable()))
                .is_err()
        );
        manager.shutdown();
        manager.shutdown();
        let calls = calls.lock().unwrap();
        assert_eq!(
            calls.iter().map(|c| c.0).collect::<Vec<_>>(),
            vec![0x8000_0001, 0x8000_0000, 0x8000_0001, 0x8000_0000]
        );
        assert!(
            calls
                .iter()
                .all(|c| c.1 == calls[0].1 && c.1 != thread::current().id())
        );
    }
    #[test]
    fn native_failure_never_persists_and_restore_reports_error() {
        let manager = PowerManager::with_backend(|_| Err(unavailable()));
        let keep = PowerSettings {
            keep_awake: true,
            prevent_screen_sleep: false,
        };
        assert!(
            manager
                .apply_and_persist(keep, || panic!("must not persist"))
                .is_err()
        );
        manager.restore(keep);
        assert!(manager.error().is_some());
    }
    #[test]
    fn rollback_failure_is_reported_and_can_be_recovered() {
        let mut count = 0;
        let manager = PowerManager::with_backend(move |_| {
            count += 1;
            if count == 2 {
                Err(unavailable())
            } else {
                Ok(())
            }
        });
        let keep = PowerSettings {
            keep_awake: true,
            prevent_screen_sleep: false,
        };
        let error = manager
            .apply_and_persist(keep, || Err(unavailable()))
            .unwrap_err();
        assert_eq!(error.code, "POWER_ROLLBACK_FAILED");
        assert!(manager.error().is_some());
        manager
            .apply_and_persist(PowerSettings::default(), || Ok(()))
            .unwrap();
        assert!(manager.error().is_none());
    }
    #[test]
    fn unchanged_settings_persist_without_a_system_call() {
        let calls = Arc::new(Mutex::new(0));
        let recorded = calls.clone();
        let manager = PowerManager::with_backend(move |_| {
            *recorded.lock().unwrap() += 1;
            Ok(())
        });
        manager
            .apply_and_persist(PowerSettings::default(), || Ok(()))
            .unwrap();
        assert!(
            manager
                .apply_and_persist(PowerSettings::default(), || Err(unavailable()))
                .is_err()
        );
        assert!(manager.error().is_none());
        assert_eq!(*calls.lock().unwrap(), 0);
        manager.shutdown();
        assert_eq!(*calls.lock().unwrap(), 1);
    }
    #[test]
    fn drop_releases_the_worker_request() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        {
            let manager = PowerManager::with_backend(move |settings| {
                recorded.lock().unwrap().push(settings.flags());
                Ok(())
            });
            manager
                .apply_and_persist(
                    PowerSettings {
                        keep_awake: true,
                        prevent_screen_sleep: false,
                    },
                    || Ok(()),
                )
                .unwrap();
        }
        assert_eq!(*calls.lock().unwrap(), vec![0x8000_0001, 0x8000_0000]);
    }
    #[test]
    fn stopped_worker_rejects_changes_without_persisting() {
        let manager = PowerManager::with_backend(|_| Ok(()));
        manager.shutdown();
        let error = manager
            .apply_and_persist(
                PowerSettings {
                    keep_awake: true,
                    prevent_screen_sleep: false,
                },
                || panic!("must not persist"),
            )
            .unwrap_err();
        assert_eq!(error.code, "POWER_UNAVAILABLE");
    }
}
