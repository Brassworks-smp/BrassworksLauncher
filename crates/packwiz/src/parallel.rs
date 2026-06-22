use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

pub const DEFAULT_CONCURRENCY: usize = 16;

pub fn parallel_run<T, R>(
    items: &[T],
    workers: usize,
    cancel: impl Fn() -> bool,
    f: impl Fn(&T, &AtomicBool) -> R + Sync,
    mut on_progress: impl FnMut(u64, u64, usize),
) -> Vec<R>
where
    T: Sync,
    R: Send,
{
    let total = items.len();
    if total == 0 {
        return Vec::new();
    }
    let workers = workers.clamp(1, total);
    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let slots: Vec<Mutex<Option<R>>> = (0..total).map(|_| Mutex::new(None)).collect();
    let (tx, rx) = mpsc::channel::<usize>();

    std::thread::scope(|scope| {
        for _ in 0..workers {
            let tx = tx.clone();
            let next = &next;
            let slots = &slots;
            let f = &f;
            let stop = &stop;
            scope.spawn(move || loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= total {
                    break;
                }
                let r = f(&items[i], stop);
                *slots[i].lock().unwrap() = Some(r);
                let _ = tx.send(i);
            });
        }
        drop(tx);
        let mut done = 0u64;
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(i) => {
                    done += 1;
                    on_progress(done, total as u64, i);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if !stop.load(Ordering::Relaxed) && cancel() {
                stop.store(true, Ordering::Relaxed);
            }
        }
    });

    slots
        .into_iter()
        .map(|m| m.into_inner().unwrap().expect("every slot filled"))
        .collect()
}
