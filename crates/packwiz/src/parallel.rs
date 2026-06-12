use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;

pub const DEFAULT_CONCURRENCY: usize = 16;

pub fn parallel_run<T, R>(
    items: &[T],
    workers: usize,
    f: impl Fn(&T) -> R + Sync,
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
    let slots: Vec<Mutex<Option<R>>> = (0..total).map(|_| Mutex::new(None)).collect();
    let (tx, rx) = mpsc::channel::<usize>();

    std::thread::scope(|scope| {
        for _ in 0..workers {
            let tx = tx.clone();
            let next = &next;
            let slots = &slots;
            let f = &f;
            scope.spawn(move || loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= total {
                    break;
                }
                let r = f(&items[i]);
                *slots[i].lock().unwrap() = Some(r);
                                let _ = tx.send(i);
            });
        }
        drop(tx); 
        let mut done = 0u64;
        while let Ok(i) = rx.recv() {
            done += 1;
            on_progress(done, total as u64, i);
        }
    });

    slots
        .into_iter()
        .map(|m| m.into_inner().unwrap().expect("every slot filled"))
        .collect()
}
