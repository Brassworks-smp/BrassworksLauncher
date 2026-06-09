
use std::io::{self, BufWriter, Read, Seek, SeekFrom, Write};
use std::iter::FusedIterator;
use std::cmp::Ordering;
use std::path::Path;
use std::{env, mem};
use std::sync::Arc;
use std::error;

use sha1::{Digest, Sha1};

use reqwest::{Client, StatusCode, header};

use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::fs::{self, File};
use tokio::task::JoinSet;
use tokio::sync::mpsc;

use crate::path::PathBufExt;


pub fn single(url: impl Into<Box<str>>, file: impl Into<Box<Path>>) -> Single {
    Single(Entry::new(url.into(), file.into()))
}

pub fn single_cached(url: impl Into<Box<str>>) -> Single {
    Single(Entry::new_cached(url.into()))
}

#[derive(Debug)]
pub struct Single(Entry);

impl Single {

    #[inline]
    pub fn url(&self) -> &str {
        self.0.url()
    }

    #[inline]
    pub fn file(&self) -> &Path {
        self.0.file()
    }

    #[inline]
    pub fn set_expected_size(&mut self, size: Option<u32>) -> &mut Self {
        self.0.set_expected_size(size);
        self
    }

    #[inline]
    pub fn set_expected_sha1(&mut self, sha1: Option<[u8; 20]>) -> &mut Self {
        self.0.set_expected_sha1(sha1);
        self
    }

    #[inline]
    pub fn set_keep_open(&mut self) -> &mut Self {
        self.0.set_keep_open();
        self
    }

    #[inline]
    pub fn set_use_cache(&mut self) -> &mut Self {
        self.0.set_use_cache();
        self
    }

    #[inline]
    pub fn set_max_retry(&mut self, count: u8) -> &mut Self {
        self.0.set_max_retry(count);
        self
    }

    #[must_use]
    pub fn download(&mut self, mut handler: impl Handler) -> Result<EntrySuccess, EntryError> {

        let client = crate::http::client()
            .map_err(|e| EntryError { 
                core: self.0.core.clone(), 
                kind: EntryErrorKind::new_reqwest(e),
            })?;

        crate::tokio::sync(download_single(client, &mut handler, &self.0))

    }

}

#[derive(Debug)]
pub struct Batch {
    entries: Vec<Entry>,
}

impl Batch {

    #[inline]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn push(&mut self, url: impl Into<Box<str>>, file: impl Into<Box<Path>>) -> &mut Entry {
        self.entries.push(Entry::new(url.into(), file.into()));
        self.entries.last_mut().unwrap()
    }

    pub fn push_cached(&mut self, url: impl Into<Box<str>>) -> &mut Entry {
        self.entries.push(Entry::new_cached(url.into()));
        self.entries.last_mut().unwrap()
    }

    pub fn entry(&self, index: usize) -> &Entry {
        &self.entries[index]
    }

    pub fn entry_mut(&mut self, index: usize) -> &mut Entry {
        &mut self.entries[index]
    }

    pub fn download(&mut self, mut handler: impl Handler) -> reqwest::Result<BatchResult> {
        let client = crate::http::client()?;
        let entries = mem::take(&mut self.entries);
        Ok(crate::tokio::sync(download_many(client, &mut handler, 40, entries)))
    }

}

#[derive(Debug, Clone)]
struct EntryCore {
    url: Box<str>,
    file: Box<Path>,
}

#[derive(Debug)]
pub struct Entry {
    core: EntryCore,
    expected_size: Option<u32>,
    expected_sha1: Option<[u8; 20]>,
    use_cache: bool,
    keep_open: bool,
    max_retry: u8,
}

impl Entry {

    fn new(url: Box<str>, file: Box<Path>) -> Self {
        Self {
            core: EntryCore {
                url,
                file,
            },
            expected_size: None,
            expected_sha1: None,
            use_cache: false,
            keep_open: false,
            max_retry: 2,
        }
    }

    fn new_cached(url: Box<str>) -> Self {
        
        let url_digest = {
            let mut sha1 = Sha1::new();
            sha1.update(&*url);
            format!("{:x}", sha1.finalize())
        };

        let mut file = dirs::cache_dir()
            .unwrap_or(env::temp_dir());

        file.push("portablemc-cache");
        file.push(url_digest);

        let mut ret = Self::new(url, file.into_boxed_path());
        ret.set_use_cache();
        ret

    }

    #[inline]
    pub fn url(&self) -> &str {
        &self.core.url
    }

    #[inline]
    pub fn file(&self) -> &Path {
        &self.core.file
    }

    #[inline]
    pub fn expected_size(&self) -> Option<u32> {
        self.expected_size
    }

    #[inline]
    pub fn set_expected_size(&mut self, size: Option<u32>) -> &mut Self {
        self.expected_size = size;
        self
    }

    #[inline]
    pub fn expected_sha1(&self) -> Option<&[u8; 20]> {
        self.expected_sha1.as_ref()
    }

    #[inline]
    pub fn set_expected_sha1(&mut self, sha1: Option<[u8; 20]>) -> &mut Self {
        self.expected_sha1 = sha1;
        self
    }

    #[inline]
    pub fn set_keep_open(&mut self) -> &mut Self {
        self.keep_open = true;
        self
    }

    #[inline]
    pub fn keep_open(&self) -> bool {
        self.keep_open
    }

    #[inline]
    pub fn set_use_cache(&mut self) -> &mut Self {
        self.use_cache = true;
        self
    }

    #[inline]
    pub fn use_cache(&self) -> bool {
        self.use_cache
    }

    #[inline]
    pub fn set_max_retry(&mut self, count: u8) -> &mut Self {
        self.max_retry = count;
        self
    }

}

#[derive(Debug)]
pub struct BatchResult {
    entries: Box<[Result<EntrySuccess, EntryError>]>,
    errors: Box<[usize]>,
}

impl BatchResult {

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn entry(&self, index: usize) -> Result<&EntrySuccess, &EntryError> {
        self.entries[index].as_ref()
    }

    #[inline]
    pub fn entry_mut(&mut self, index: usize) -> Result<&mut EntrySuccess, &mut EntryError> {
        self.entries[index].as_mut()
    }

    #[inline]
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    #[inline]
    pub fn successes_count(&self) -> usize {
        self.entries.len() - self.errors.len()
    }

    #[inline]
    pub fn errors_count(&self) -> usize {
        self.errors.len()
    }

    pub fn iter_successes(&self) -> BatchResultSuccessesIter<'_> {
        BatchResultSuccessesIter {
            entries: self.entries.iter(),
            count: self.successes_count(),
        }
    }

    pub fn iter_errors(&self) -> BatchResultErrorsIter<'_> {
        BatchResultErrorsIter {
            errors: self.errors.iter(),
            entries: &self.entries,
        }
    }

    pub fn into_result(self) -> Result<Self, Self> {
        if self.has_errors() {
            Err(self)
        } else {
            Ok(self)
        }
    }

}

impl From<Result<EntrySuccess, EntryError>> for BatchResult {
    fn from(value: Result<EntrySuccess, EntryError>) -> Self {
        Self {
            errors: if value.is_err() { Box::new([0]) } else { Box::new([]) },
            entries: Box::new([value]),
        }
    }
}

impl From<EntrySuccess> for BatchResult {
    fn from(value: EntrySuccess) -> Self {
        Self {
            entries: Box::new([Ok(value)]),
            errors: Box::new([]),
        }
    }
}

impl From<EntryError> for BatchResult {
    fn from(value: EntryError) -> Self {
        Self {
            entries: Box::new([Err(value)]),
            errors: Box::new([0]),
        }
    }
}

#[derive(Debug)]
pub struct BatchResultSuccessesIter<'a> {
    entries: std::slice::Iter<'a, Result<EntrySuccess, EntryError>>,
    count: usize,
}

impl FusedIterator for BatchResultSuccessesIter<'_> { }
impl ExactSizeIterator for BatchResultSuccessesIter<'_> { }
impl<'a> Iterator for BatchResultSuccessesIter<'a> {

    type Item = &'a EntrySuccess;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Ok(success) = self.entries.next()? {
                self.count -= 1;
                return Some(success);
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.count, Some(self.count))
    }

}

#[derive(Debug)]
pub struct BatchResultErrorsIter<'a> {
    errors: std::slice::Iter<'a, usize>,
    entries: &'a [Result<EntrySuccess, EntryError>],
}

impl FusedIterator for BatchResultErrorsIter<'_> { }
impl ExactSizeIterator for BatchResultErrorsIter<'_> { }
impl<'a> Iterator for BatchResultErrorsIter<'a> {

    type Item = &'a EntryError;

    fn next(&mut self) -> Option<Self::Item> {
        let index = *self.errors.next()?;
        Some(self.entries[index].as_ref().unwrap_err())
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.errors.size_hint()
    }

}

#[derive(Debug)]
pub struct EntrySuccess {
    core: EntryCore,
    inner: EntrySuccessInner,
}

#[derive(Debug)]
struct EntrySuccessInner {
    size: u32,
    sha1: [u8; 20],
    handle: Option<std::fs::File>,
}

impl EntrySuccess {

    #[inline]
    pub fn url(&self) -> &str {
        &self.core.url
    }

    #[inline]
    pub fn file(&self) -> &Path {
        &self.core.file
    }

    #[inline]
    pub fn size(&self) -> u32 {
        self.inner.size
    }

    #[inline]
    pub fn sha1(&self) -> &[u8; 20] {
        &self.inner.sha1
    }

    #[inline]
    pub fn handle(&self) -> Option<&std::fs::File> {
        self.inner.handle.as_ref()
    }

    #[inline]
    pub fn handle_mut(&mut self) -> Option<&mut std::fs::File> {
        self.inner.handle.as_mut()
    }

    #[inline]
    pub fn take_handle(&mut self) -> Option<std::fs::File> {
        self.inner.handle.take()
    }

    pub(crate) fn read_handle_to_string(&mut self) -> Option<io::Result<String>> {
        let mut handle = self.take_handle()?;
        let mut buf = String::new();
        match handle.read_to_string(&mut buf) {
            Ok(_) => Some(Ok(buf)),
            Err(e) => Some(Err(e)),
        }
    }

}

#[derive(thiserror::Error, Debug)]
#[error("{core:?}: {kind}")]
pub struct EntryError {
    core: EntryCore,
    #[source]
    kind: EntryErrorKind,
}

#[derive(thiserror::Error, Debug)]
pub enum EntryErrorKind {
    #[error("invalid size")]
    InvalidSize,
    #[error("invalid sha1")]
    InvalidSha1,
    #[error("invalid status: {0}")]
    InvalidStatus(u16),
    #[error("internal: {0}")]
    Internal(#[source] Box<dyn error::Error + Send + Sync>),
}

impl EntryErrorKind {

    #[inline]
    fn new_io(e: io::Error) -> Self {
        Self::Internal(Box::new(e))
    }

    #[inline]
    fn new_reqwest(e: reqwest::Error) -> Self {
        Self::Internal(Box::new(e))
    }

}

impl EntryError {

    #[inline]
    pub fn url(&self) -> &str {
        &self.core.url
    }

    #[inline]
    pub fn file(&self) -> &Path {
        &self.core.file
    }

    #[inline]
    pub fn kind(&self) -> &EntryErrorKind {
        &self.kind
    }

}

pub trait Handler {
    fn on_progress(&mut self, count: u32, total_count: u32, size: u32, total_size: u32);
}

impl<H: Handler + ?Sized> Handler for &mut H {
    #[inline]
    fn on_progress(&mut self, count: u32, total_count: u32, size: u32, total_size: u32) {
        Handler::on_progress(&mut **self, count, total_count, size, total_size)
    }
}

impl Handler for () {
    fn on_progress(&mut self, count: u32, total_count: u32, size: u32, total_size: u32) {
        let _ = (count, total_count, size, total_size);
    }
}

#[inline]
async fn download_many(
    client: Client,
    handler: &mut dyn Handler,
    concurrent_count: usize,
    entries: Vec<Entry>,
) -> BatchResult {

    let entries = Arc::new(entries);

    let mut indices = (0..entries.len()).collect::<Vec<_>>();

    indices.sort_by(|&a_index, &b_index| {
        match (entries[a_index].expected_size, entries[b_index].expected_size) {
            (Some(a), Some(b)) => Ord::cmp(&a, &b),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    });

    let mut size = 0;
    let total_size = indices.iter()
        .map(|&index| entries[index].expected_size.unwrap_or(0))
        .sum::<u32>();

    let progress_size_interval = total_size / 1000;
    let mut last_size = 0u32;

    handler.on_progress(0, entries.len() as u32, size, total_size);

    let mut completed = 0;
    let mut futures = JoinSet::new();

    let (
        progress_tx, 
        mut progress_rx,
    ) = mpsc::channel(concurrent_count * 2);

    let mut results = (0..entries.len()).map(|_| None).collect::<Vec<_>>();

    while completed < entries.len() || !futures.is_empty() {
        
        while futures.len() < concurrent_count && !indices.is_empty() {
            futures.spawn(download_many_entry(
                client.clone(), 
                Arc::clone(&entries),
                indices.pop().unwrap(),  
                progress_tx.clone()));
        }

        let mut force_progress = false;

        tokio::select! {
            Some(res) = futures.join_next() => {
                let (index, res) = res.expect("task should not be cancelled nor panicking");
                completed += 1;
                force_progress = true;
                let prev_res = results[index].replace(res);
                debug_assert!(prev_res.is_none());
            }
            Some(progress) = progress_rx.recv() => {
                size += progress as u32;
            }
            else => {
                continue;
            }
        }
        
        if force_progress || size - last_size >= progress_size_interval {
            handler.on_progress(completed as u32, entries.len() as u32, size, total_size);
            last_size = size;
        }

    }

    assert!(futures.is_empty());

    let entries = Arc::into_inner(entries).unwrap();
    let mut ret_entries = Vec::with_capacity(entries.len());
    let mut ret_errors = Vec::new();

    for (entry, res) in entries.into_iter().zip(results) {
        let res = res.expect("all entries should have a result");
        if res.is_err() {
            ret_errors.push(ret_entries.len());
        }
        ret_entries.push(match res {
            Ok(inner) => Ok(EntrySuccess { core: entry.core, inner }),
            Err(kind) => Err(EntryError { core: entry.core, kind }),
        });
    }

    BatchResult {
        entries: ret_entries.into_boxed_slice(),
        errors: ret_errors.into_boxed_slice(),
    }

}

async fn download_many_entry(
    client: Client, 
    entries: Arc<Vec<Entry>>,
    index: usize,
    progress_sender: mpsc::Sender<u32>,
) -> (usize, Result<EntrySuccessInner, EntryErrorKind>) {

    let progress_sender = ChannelEntryProgressSender {
        sender: progress_sender,
    };

    (index, download_entry(client, &entries[index], progress_sender).await)

}

async fn download_single(
    client: Client,
    handler: &mut dyn Handler,
    entry: &Entry,
) -> Result<EntrySuccess, EntryError> {

    let mut size = 0u32;
    let total_size = entry.expected_size.unwrap_or(0);

    handler.on_progress(0, 1, 0, total_size);

    let progress_sender = DirectEntryProgressSender {
        handler: &mut *handler,
        size: &mut size,
        total_size,
    };

    let res = download_entry(client, entry, progress_sender).await;

    handler.on_progress(1, 1, size, total_size);

    match res {
        Ok(inner) => Ok(EntrySuccess { core: entry.core.clone(), inner }),
        Err(kind) => Err(EntryError { core: entry.core.clone(), kind }),
    }

}

async fn download_entry(
    client: Client, 
    entry: &Entry,
    mut progress_sender: impl EntryProgressSender,
) -> Result<EntrySuccessInner, EntryErrorKind> {

    let mut req = client.get(&*entry.core.url);
    
    let cache_file = entry.use_cache.then(|| {
        entry.core.file.to_path_buf().appended(".cache")
    });

    let mut cache = None;
    if let Some(cache_file) = cache_file.as_deref() {
        cache = check_download_cache(&entry.core.file, cache_file).await
            .map_err(EntryErrorKind::new_io)?;
    }

    if let Some((_, cache_meta)) = &cache {
        if let Some(etag) = cache_meta.etag.as_deref() {
            req = req.header(header::IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = cache_meta.last_modified.as_deref() {
            req = req.header(header::IF_MODIFIED_SINCE, last_modified);
        }
    }

    let mut res = match req.send().await {
        Ok(res) => res,
        Err(e) if cache.is_some() && (e.is_timeout() || e.is_request() || e.is_connect()) => {
            let (handle, cache_meta) = cache.unwrap();
            return Ok(EntrySuccessInner { 
                size: cache_meta.size, 
                sha1: cache_meta.sha1.0,
                handle: entry.keep_open.then_some(handle),
            });
        }
        Err(e) => {
            return Err(EntryErrorKind::new_reqwest(e));
        }
    };

    if res.status() == StatusCode::NOT_MODIFIED && cache.is_some() {
        let (handle, cache_meta) = cache.unwrap();
        return Ok(EntrySuccessInner { 
            size: cache_meta.size, 
            sha1: cache_meta.sha1.0,
            handle: entry.keep_open.then_some(handle),
        });
    } else if res.status() != StatusCode::OK {
        return Err(EntryErrorKind::InvalidStatus(res.status().as_u16()));
    }

    drop(cache);

    if let Some(parent_dir) = entry.core.file.parent() {
        fs::create_dir_all(parent_dir).await.map_err(EntryErrorKind::new_io)?;
    }

    let mut file = File::options()
        .write(true)
        .create(true)
        .truncate(true)
        .read(entry.keep_open)
        .open(&*entry.core.file).await
        .map_err(EntryErrorKind::new_io)?;
    
    let mut try_num = 0u8;
    let (size, sha1) = 'success: loop {

        let mut size = 0usize;
        let mut sha1 = Sha1::new();

        let (retry, mut err) = loop {

            let chunk = match res.chunk().await {
                Ok(chunk) => chunk,
                Err(e) => break (e.is_timeout() || e.is_decode(), EntryErrorKind::new_reqwest(e)),
            };

            let Some(chunk) = chunk else {

                let Ok(size) = u32::try_from(size) else {
                    break (false, EntryErrorKind::InvalidSize);
                };

                let sha1 = sha1.finalize();

                if let Some(expected_size) = entry.expected_size {
                    if expected_size != size {
                        break (false, EntryErrorKind::InvalidSize);
                    }
                }

                if let Some(expected_sha1) = &entry.expected_sha1 {
                    if expected_sha1 != sha1.as_slice() {
                        break (false, EntryErrorKind::InvalidSha1);
                    }
                }

                break 'success (size, sha1);

            };

            let delta = chunk.len();
            size += delta;

            match AsyncWriteExt::write_all(&mut file, &chunk).await {
                Ok(_) => (),
                Err(e) => break (false, EntryErrorKind::new_io(e)),
            }
            match Write::write_all(&mut sha1, &chunk) {
                Ok(_) => (),
                Err(e) => break (false, EntryErrorKind::new_io(e)),
            }

            progress_sender.send(delta as u32).await;

        };

        if retry && try_num < entry.max_retry {
            
            try_num += 1;
            
            let rewind_res = async || -> Result<(), EntryErrorKind> {
                
                file.rewind().await.map_err(EntryErrorKind::new_io)?;
                file.set_len(0).await.map_err(EntryErrorKind::new_io)?;
                
                res = client.get(&*entry.core.url).send().await.map_err(EntryErrorKind::new_reqwest)?;
                if res.status() != StatusCode::OK {
                    return Err(EntryErrorKind::InvalidStatus(res.status().as_u16()));
                }

                Ok(())

            }().await;

            match rewind_res {
                Ok(()) => continue,
                Err(e) => {
                    err = e;
                }
            }

        }
        
        let _ = file.flush().await;
        drop(file);
        
        let _ = fs::remove_file(&*entry.core.file).await;

        if let Some(cache_file) = cache_file.as_deref() {
            let _ = fs::remove_file(cache_file).await;
        }
        
        return Err(err);

    };

    if let Some(cache_file) = cache_file.as_deref() {

        let etag = res.headers().get(header::ETAG)
            .and_then(|h| h.to_str().ok().map(str::to_string));

        let last_modified = res.headers().get(header::LAST_MODIFIED)
            .and_then(|h| h.to_str().ok().map(str::to_string));

        if etag.is_some() || last_modified.is_some() {

            let cache_meta_writer = File::create(cache_file).await.map_err(EntryErrorKind::new_io)?;
            let cache_meta_writer = BufWriter::new(cache_meta_writer.into_std().await);

            let res = serde_json::to_writer(cache_meta_writer, &serde::CacheMeta {
                url: entry.core.url.to_string(),
                size,
                sha1: crate::serde::HexString(sha1.into()),
                etag,
                last_modified,
            });

            if res.is_err() {
                let _ = fs::remove_file(cache_file).await;
            }

        }

    }

    file.flush().await.map_err(EntryErrorKind::new_io)?;

    let handle;
    if entry.keep_open {
        let mut file = file.into_std().await;
        file.rewind().map_err(EntryErrorKind::new_io)?;
        handle = Some(file);
    } else {
        handle = None;
    }

    Ok(EntrySuccessInner {
        size,
        sha1: sha1.into(),
        handle,
    })

}

async fn check_download_cache(file: &Path, cache_file: &Path) -> io::Result<Option<(std::fs::File, serde::CacheMeta)>> {

    let cache = match File::open(cache_file).await {
        Ok(file) => serde_json::from_reader::<_, serde::CacheMeta>(file.into_std().await).ok(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };

    let Some(cache) = cache else {
        return Ok(None);
    };

    let mut reader = match File::open(file).await {
        Ok(reader) => reader,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };

    let actual_size = reader.seek(SeekFrom::End(0)).await?;
    if cache.size as u64 != actual_size {
        return Ok(None);
    }

    reader.rewind().await?;

    let mut reader = reader.into_std().await;
    let mut digest = Sha1::new();
    io::copy(&mut reader, &mut digest)?;
    if cache.sha1.0 != digest.finalize().as_slice() {
        return Ok(None);
    }

    reader.rewind()?;

    Ok(Some((reader, cache)))

}

trait EntryProgressSender {
    async fn send(&mut self, delta: u32);
}

struct ChannelEntryProgressSender {
    sender: mpsc::Sender<u32>,
}

impl EntryProgressSender for ChannelEntryProgressSender {
    async fn send(&mut self, delta: u32) {
        self.sender.send(delta).await.unwrap();
    }
}

struct DirectEntryProgressSender<'a> {
    handler: &'a mut dyn Handler,
    size: &'a mut u32,
    total_size: u32,
}

impl EntryProgressSender for DirectEntryProgressSender<'_> {
    async fn send(&mut self, delta: u32) {
        *self.size += delta;
        self.handler.on_progress(0, 1, *self.size, self.total_size);
    }
}

mod serde {

    use crate::serde::HexString;

    #[derive(Debug, serde::Deserialize, serde::Serialize)]
    pub struct CacheMeta {
        pub url: String,
        pub size: u32,
        pub sha1: HexString<20>,
        pub etag: Option<String>,
        pub last_modified: Option<String>,
    }

}
