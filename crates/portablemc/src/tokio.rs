
use std::future::Future;


pub fn sync<F: Future>(future: F) -> F::Output {
    
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()
        .unwrap();

    rt.block_on(future)
    
}
