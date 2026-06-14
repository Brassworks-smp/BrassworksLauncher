
pub(crate) mod serde;

use std::io::{self, BufReader, BufWriter, Seek, SeekFrom};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::fmt::{self, Debug, Write as _};
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::fs::{self, File};
use std::sync::LazyLock;
use std::time::Duration;
use std::{env, thread};
use std::ffi::OsStr;

use indexmap::IndexSet;

use zip::ZipArchive;

use sha1::{Digest, Sha1};
use uuid::{uuid, Uuid};

use crate::path::{PathExt, PathBufExt};
use crate::download::{self, Batch};
use crate::maven::Gav;

/// Suppress the console window that flashes on Windows when a child process is
/// spawned from a GUI app (Java `-version` probes, install processors, etc.).
pub(crate) fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}


pub(crate) const RESOURCES_URL: &str = "https://resources.download.minecraft.net/";

pub(crate) const JVM_META_MANIFEST_URL: &str = "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

pub(crate) const LIBRARIES_URL: &str = "https://libraries.minecraft.net/";

pub(crate) const UUID_NAMESPACE: Uuid = uuid!("8df5a464-38de-11ec-aa66-3fd636ee2ed7");

pub(crate) const LEGACY_JVM_ARGS: &[&str] = &[
    "-Djava.library.path=${natives_directory}",
    "-Dminecraft.launcher.brand=${launcher_name}",
    "-Dminecraft.launcher.version=${launcher_version}",
    "-cp",
    "${classpath}",
];

#[derive(Debug, Clone)]
pub struct Installer {
    version: String,
    versions_dir: PathBuf,
    libraries_dir: PathBuf,
    assets_dir: PathBuf,
    jvm_dir: PathBuf,
    bin_dir: PathBuf,
    mc_dir: PathBuf,
    strict_assets_check: bool,
    strict_libraries_check: bool,
    strict_jvm_check: bool,
    jvm_policy: JvmPolicy,
    launcher_name: Option<String>,
    launcher_version: Option<String>,
}

impl Installer {

    pub fn new(version: impl Into<String>) -> Self {
        
        let mc_dir = default_main_dir().unwrap_or_else(|| Path::new(""));

        Self {
            version: version.into(),
            versions_dir: mc_dir.join("versions"),
            libraries_dir: mc_dir.join("libraries"),
            assets_dir: mc_dir.join("assets"),
            jvm_dir: mc_dir.join("jvm"),
            bin_dir: mc_dir.join("bin"),
            mc_dir: mc_dir.to_path_buf(),
            strict_assets_check: false,
            strict_libraries_check: false,
            strict_jvm_check: false,
            jvm_policy: JvmPolicy::SystemThenMojang,
            launcher_name: None,
            launcher_version: None,
        }

    }

    #[inline]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[inline]
    pub fn set_version(&mut self, version: impl Into<String>) -> &mut Self {
        self.version = version.into();
        self
    }

    #[inline]
    pub fn versions_dir(&self) -> &Path {
        &self.versions_dir
    }

    #[inline]
    pub fn set_versions_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.versions_dir = dir.into();
        self
    }

    #[inline]
    pub fn libraries_dir(&self) -> &Path {
        &self.libraries_dir
    }

    #[inline]
    pub fn set_libraries_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.libraries_dir = dir.into();
        self
    }

    #[inline]
    pub fn assets_dir(&self) -> &Path {
        &self.assets_dir
    }

    #[inline]
    pub fn set_assets_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.assets_dir = dir.into();
        self
    }

    #[inline]
    pub fn jvm_dir(&self) -> &Path {
        &self.jvm_dir
    }

    #[inline]
    pub fn set_jvm_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.jvm_dir = dir.into();
        self
    }

    #[inline]
    pub fn bin_dir(&self) -> &Path {
        &self.bin_dir
    }

    #[inline]
    pub fn set_bin_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.bin_dir = dir.into();
        self
    }

    #[inline]
    pub fn mc_dir(&self) -> &Path {
        &self.mc_dir
    }

    #[inline]
    pub fn set_mc_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        self.mc_dir = dir.into();
        self
    }

    #[inline]
    pub fn set_main_dir(&mut self, dir: impl Into<PathBuf>) -> &mut Self {
        let mc_dir = dir.into();
        self.versions_dir = mc_dir.join("versions");
        self.assets_dir = mc_dir.join("assets");
        self.libraries_dir = mc_dir.join("libraries");
        self.jvm_dir = mc_dir.join("jvm");
        self.bin_dir = mc_dir.join("bin");
        self.mc_dir = mc_dir;
        self
    }

    #[inline]
    pub fn strict_assets_check(&self) -> bool {
        self.strict_assets_check
    }

    #[inline]
    pub fn set_strict_assets_check(&mut self, strict: bool) -> &mut Self {
        self.strict_assets_check = strict;
        self
    }

    #[inline]
    pub fn strict_libraries_check(&self) -> bool {
        self.strict_libraries_check
    }

    #[inline]
    pub fn set_strict_libraries_check(&mut self, strict: bool) -> &mut Self {
        self.strict_libraries_check = strict;
        self
    }

    #[inline]
    pub fn strict_jvm_check(&self) -> bool {
        self.strict_jvm_check
    }

    #[inline]
    pub fn set_strict_jvm_check(&mut self, strict: bool) -> &mut Self {
        self.strict_jvm_check = strict;
        self
    }

    #[inline]
    pub fn jvm_policy(&self) -> &JvmPolicy {
        &self.jvm_policy
    }

    #[inline]
    pub fn set_jvm_policy(&mut self, policy: JvmPolicy) -> &mut Self {
        self.jvm_policy = policy;
        self
    }

    pub fn launcher_name(&self) -> &str {
        self.launcher_name.as_deref().unwrap_or(env!("CARGO_PKG_NAME"))
    }

    #[inline]
    pub fn set_launcher_name(&mut self, name: impl Into<String>) -> &mut Self {
        self.launcher_name = Some(name.into());
        self
    }

    pub fn launcher_version(&self) -> &str {
        self.launcher_version.as_deref().unwrap_or(env!("CARGO_PKG_VERSION"))
    }

    #[inline]
    pub fn set_launcher_version(&mut self, version: impl Into<String>) -> &mut Self {
        self.launcher_version = Some(version.into());
        self
    }

    #[inline]
    pub fn install(&mut self, mut handler: impl Handler) -> Result<Game> {
        self.install_dyn(&mut handler)
    }

    #[inline(never)]
    fn install_dyn(&mut self, handler: &mut dyn Handler) -> Result<Game> {
        
        let mut features = HashSet::new();
        handler.on_event(Event::FilterFeatures { features: &mut features });
        handler.on_event(Event::LoadedFeatures { features: &features });
        
        let mut batch = Batch::new();
        let hierarchy = self.load_hierarchy(&mut *handler, &self.version)?;
        let mut lib_files = self.load_libraries(&mut *handler, &hierarchy, &features, &mut batch)?;
        let logger_config = self.load_logger(&mut *handler, &hierarchy, &mut batch)?;
        let assets = self.load_assets(&mut *handler, &hierarchy, &mut batch)?;
        let jvm = self.load_jvm(&mut *handler, &hierarchy, &mut batch)?;

        let main_class = hierarchy.iter()
            .find_map(|v| v.metadata.main_class.as_ref())
            .cloned()
            .ok_or(Error::MainClassNotFound {  })?;

        if !batch.is_empty() {
            
            let mut cancel = false;
            handler.on_event(Event::DownloadResources { cancel: &mut cancel });

            if cancel {
                return Err(Error::DownloadResourcesCancelled {  });
            }

            let result = batch.download((&mut *handler).into_download())
                .map_err(|e| Error::new_reqwest(e, "download resources"))?;

            if result.cancelled() {
                return Err(Error::DownloadResourcesCancelled {  });
            }

            result.into_result()?;

            handler.on_event(Event::DownloadedResources);

        }

        let bin_dir = self.finalize_libraries(&mut *handler, &mut lib_files)?;

        if let Some(assets) = &assets {
            self.finalize_assets(assets)?;
        }

        self.finalize_jvm(&jvm)?;

        let mut jvm_args = Vec::new();
        let mut game_args = Vec::new();

        for version in &hierarchy {
            if let Some(version_args) = &version.metadata.arguments {
                self.check_args(&mut jvm_args, &version_args.jvm, &features, None);
                self.check_args(&mut game_args, &version_args.game, &features, None);
            } else if let Some(version_legacy_args) = &version.metadata.legacy_arguments {
                jvm_args = LEGACY_JVM_ARGS.iter().copied().map(str::to_string).collect::<Vec<_>>();
                game_args = version_legacy_args.split_whitespace().map(str::to_string).collect::<Vec<_>>();
                break;
            }
        }

        if let Some(logger_config) = &logger_config {
            let logger_file = canonicalize_file(&logger_config.file)?;
            jvm_args.push(logger_config.argument.replace("${path}", &logger_file.to_string_lossy()));
        }

        let bin_dir = canonicalize_file(&bin_dir)?;
        let mc_dir = canonicalize_file(&self.mc_dir)?;
        let libraries_dir = canonicalize_file(&self.libraries_dir)?;
        let assets_dir = canonicalize_file(&self.assets_dir)?;
        let jvm_file = canonicalize_file(&jvm.file)?;
        let assets_virtual_dir = match &assets {
            Some(Assets { mapping: Some(mapping), .. }) => Some(canonicalize_file(&mapping.virtual_dir)?),
            _ => None,
        };

        let repl_arg = |arg: &str| {
            Some(match arg {
                #[cfg(windows)]      "classpath_separator" => ";".to_string(),
                #[cfg(not(windows))] "classpath_separator" => ":".to_string(),
                "classpath" => env::join_paths(lib_files.class_files.iter())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                "natives_directory" => bin_dir.display().to_string(),
                "launcher_name" => self.launcher_name().to_string(),
                "launcher_version" => self.launcher_version().to_string(),
                "version_name" => hierarchy[0].name.clone(),
                "version_type" => return hierarchy.iter() 
                    .filter_map(|v| v.metadata.r#type.as_ref())
                    .map(|t| t.as_str().to_string())
                    .next(),
                "game_directory" => mc_dir.display().to_string(),
                "library_directory" => libraries_dir.display().to_string(),
                "assets_root" => assets_dir.display().to_string(),
                "assets_index_name" => return assets.as_ref()
                    .map(|assets| assets.id.clone()),
                "game_assets" => return assets_virtual_dir.as_ref()
                    .map(|dir| dir.display().to_string()),
                _ => return None
            })
        };

        replace_strings_args(&mut jvm_args, repl_arg);
        replace_strings_args(&mut game_args, repl_arg);

        Ok(Game {
            jvm_file, 
            mc_dir,
            main_class, 
            jvm_args, 
            game_args,
        })

    }

    fn load_hierarchy(&self, 
        handler: &mut dyn Handler, 
        root_version: &str
    ) -> Result<Vec<LoadedVersion>> {

        if root_version.is_empty() {
            return Err(Error::VersionNotFound { version: String::new() });
        }

        handler.on_event(Event::LoadHierarchy { root_version });

        let mut hierarchy = Vec::new();
        let mut current_name = Some(root_version.to_string());
        let mut unique_names = HashSet::new();

        while let Some(version_name) = current_name.take() {
            
            if !unique_names.insert(version_name.clone()) {
                return Err(Error::HierarchyLoop { version: version_name });
            }

            let version = self.load_version(handler, version_name)?;
            if let Some(next_name) = &version.metadata.inherits_from {
                current_name = Some(next_name.clone());
            }
            hierarchy.push(version);

        }

        handler.on_event(Event::LoadedHierarchy { hierarchy: &hierarchy });

        Ok(hierarchy)

    }

    fn load_version(&self, 
        handler: &mut dyn Handler, 
        version: String,
    ) -> Result<LoadedVersion> {

        if version.is_empty() {
            return Err(Error::VersionNotFound { version: String::new() });
        }

        let dir = self.versions_dir.join(&version);
        let file = dir.join_with_extension(&version, "json");

        handler.on_event(Event::LoadVersion { version: &version, file: &file });

        for i in 0..2 {

            let reader = match File::open(&file) {
                Ok(reader) => BufReader::new(reader),
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    let mut retry = false;
                    if i == 0 {
                        handler.on_event(Event::NeedVersion { version: &version, file: &file, retry: &mut retry });
                    }
                    if retry {
                        continue;
                    } else {
                        break;
                    }
                }
                Err(e) => return Err(Error::new_io_file(e, &file))
            };

            let mut deserializer = serde_json::Deserializer::from_reader(reader);
            let metadata = serde_path_to_error::deserialize::<_, Box<serde::VersionMetadata>>(&mut deserializer)
                .map_err(|e| Error::new_json_file(e, &file))?;

            handler.on_event(Event::LoadedVersion { version: &version, file: &file });

            return Ok(LoadedVersion { name: version, dir, metadata });

        }

        Err(Error::VersionNotFound { version })

    }

    fn load_client(&self, 
        handler: &mut dyn Handler, 
        hierarchy: &[LoadedVersion], 
        batch: &mut Batch,
    ) -> Result<PathBuf> {
        
        let root_version = &hierarchy[0];
        let file = root_version.dir.join_with_extension(&root_version.name, "jar");

        handler.on_event(Event::LoadClient);

        let dl = hierarchy.iter()
            .filter_map(|version| version.metadata.downloads.get("client"))
            .next();

        if let Some(dl) = dl {
            let check_client_sha1 = dl.sha1.as_deref().filter(|_| self.strict_libraries_check);
            if !check_file(&file, dl.size, check_client_sha1)? {
                batch.push(dl.url.clone(), file.clone())
                    .set_expected_size(dl.size)
                    .set_expected_sha1(dl.sha1.as_deref().copied());
            }
        } else if !file.is_file() {
            return Err(Error::ClientNotFound {  });
        }

        handler.on_event(Event::LoadedClient { file: &file });
        
        Ok(file)

    }

    fn load_libraries(&self,
        handler: &mut dyn Handler,
        hierarchy: &[LoadedVersion], 
        features: &HashSet<String>,
        batch: &mut Batch,
    ) -> Result<LibrariesFiles> {

        let client_file = self.load_client(&mut *handler, &hierarchy, &mut *batch)?;

        handler.on_event(Event::LoadLibraries);

        let mut libraries_set = HashSet::new();
        let mut libraries = Vec::new();

        let mut modern_args = false;

        for version in hierarchy {

            modern_args |= version.metadata.arguments.is_some();

            for lib in &version.metadata.libraries {

                let mut lib_gav = lib.name.clone();

                if let Some(lib_natives) = &lib.natives {
                    
                    let (Some(os_name), Some(os_bits)) = (os_name(), os_bits()) else {
                        continue;
                    };

                    let Some(classifier) = lib_natives.get(os_name) else {
                        continue;
                    };

                    const ARCH_REPLACEMENT_PATTERN: &str = "${arch}";
                    let new_gav;
                    if let Some(pattern_idx) = classifier.find(ARCH_REPLACEMENT_PATTERN) {
                        let mut classifier = classifier.clone();
                        classifier.replace_range(pattern_idx..pattern_idx + ARCH_REPLACEMENT_PATTERN.len(), os_bits);
                        new_gav = lib_gav.with_classifier(Some(&classifier));
                    } else {
                        new_gav = lib_gav.with_classifier(Some(&classifier));
                    }

                    let Some(new_gav) = new_gav else {
                        continue;
                    };

                    lib_gav = new_gav;

                }

                if let Some(lib_rules) = &lib.rules {
                    if !self.check_rules(lib_rules, features, None) {
                        continue;
                    }
                }

                let lib_gav_wildcard = lib_gav.with_version("-").unwrap();
                if !libraries_set.insert(lib_gav_wildcard) {
                    continue;
                }

                libraries.push(LoadedLibrary {
                    name: lib_gav,
                    path: None,
                    download: None,
                    natives: lib.natives.is_some(),
                });

                let lib_obj = libraries.last_mut().unwrap();

                let lib_dl;
                if lib_obj.natives {
                    lib_dl = lib.downloads.classifiers.get(lib_obj.name.classifier().unwrap());
                } else {
                    lib_dl = lib.downloads.artifact.as_ref();
                }

                if let Some(lib_dl) = lib_dl {
                    lib_obj.path = lib_dl.path.as_ref().map(PathBuf::from);
                    lib_obj.download = Some(LibraryDownload {
                        url: lib_dl.download.url.to_string(),
                        size: lib_dl.download.size,
                        sha1: lib_dl.download.sha1.as_deref().copied(),
                    });
                } else if let Some(repo_url) = &lib.url {
                    

                    let mut url = repo_url.clone();
                    if !url.ends_with('/') {
                        url.push('/');
                    }
                    write!(url, "{}", lib_obj.name.url()).unwrap();

                    lib_obj.download = Some(LibraryDownload {
                        url,
                        size: None,
                        sha1: None,
                    });

                }

                if let Some(lib_source) = &lib_obj.download {
                    if lib_source.url.is_empty() {
                        lib_obj.download = None;
                    }
                }

            }

        }

        handler.on_event(Event::FilterLibraries { libraries: &mut libraries });
        handler.on_event(Event::LoadedLibraries { libraries: &libraries });

        let mut lib_files = LibrariesFiles::default();

        for lib in libraries {

            let lib_file = if let Some(lib_rel_path) = lib.path.as_deref() {
                self.libraries_dir.join(check_path_relative_and_safe(lib_rel_path)?)
            } else {
                self.libraries_dir.join(&lib.name.file())
            };

            if let Some(download) = lib.download {
                let check_source_sha1 = download.sha1.as_ref().filter(|_| self.strict_libraries_check);
                if !check_file(&lib_file, download.size, check_source_sha1)? {
                    batch.push(download.url, lib_file.clone())
                        .set_expected_size(download.size)
                        .set_expected_sha1(download.sha1);
                }
            } else if !lib_file.is_file() {
                return Err(Error::LibraryNotFound { name: lib.name })
            }

            (if lib.natives { 
                &mut lib_files.natives_files 
            } else { 
                &mut lib_files.class_files 
            }).push(lib_file);

        }

        handler.on_event(Event::FilterLibrariesFiles { 
            class_files: &mut lib_files.class_files, 
            natives_files: &mut lib_files.natives_files });
        handler.on_event(Event::LoadedLibrariesFiles { 
            class_files: &lib_files.class_files, 
            natives_files: &lib_files.natives_files });

        if modern_args {
            lib_files.class_files.push(client_file);
        } else {
            lib_files.class_files.insert(0, client_file);
        }

        Ok(lib_files)

    }

    fn finalize_libraries(&self,
        handler: &mut dyn Handler,
        lib_files: &mut LibrariesFiles
    ) -> Result<PathBuf> {

        let mut hash_buf = Vec::new();

        for file in &mut lib_files.class_files {
            *file = canonicalize_file(file)?;
            hash_buf.extend_from_slice(file.as_os_str().as_encoded_bytes());
        }
        
        for file in &mut lib_files.natives_files {
            *file = canonicalize_file(file)?;
            hash_buf.extend_from_slice(file.as_os_str().as_encoded_bytes());
        }

        let bin_uuid = Uuid::new_v5(&UUID_NAMESPACE, &hash_buf);
        let bin_dir = self.bin_dir.join(&self.version)
            .appended(format!("-{}", bin_uuid.hyphenated()));

        fs::create_dir_all(&bin_dir)
            .map_err(|e| Error::new_io(e, format!("create dir: {}", bin_dir.display())))?;

        for src_file in &lib_files.natives_files {
            
            let ext = src_file.extension()
                .map(OsStr::as_encoded_bytes)
                .unwrap_or_default();

            match ext {
                b"zip" | b"jar" => {

                    let src_reader = File::open(src_file)
                        .map_err(|e| Error::new_io_file(e, src_file))
                        .map(BufReader::new)?;

                    let mut archive = ZipArchive::new(src_reader)
                        .map_err(|e| Error::new_zip_file(e, src_file))?;
                    
                    for i in 0..archive.len() {
                        
                        let mut file = archive.by_index(i).unwrap();
                        let Some(file_path) = file.enclosed_name() else {
                            continue;
                        };
                        let Some(file_ext) = file_path.extension() else {
                            continue;
                        };

                        if !matches!(file_ext.as_encoded_bytes(), b"so" | b"dll" | b"dylib") {
                            continue;
                        }

                        let file_name = file_path.file_name().unwrap();
                        let dst_file = bin_dir.join(file_name);

                        let mut dst_writer = File::create(&dst_file)
                            .map_err(|e| Error::new_io_file(e, &dst_file))?;

                        io::copy(&mut file, &mut dst_writer)
                            .map_err(|e| Error::new_io(e, format!("extract: {}, from: {}, to: {}", 
                                file.name(),
                                src_file.display(),
                                dst_file.display())))?;

                    }

                }
                _ => {


                    let Some(mut file_name) = src_file.file_name() else {
                        continue;
                    };

                    let file_name_bytes = file_name.as_encoded_bytes();
                    let mut file_name_new_len = file_name_bytes.len();
                    for part in file_name_bytes.rsplit(|&n| n == b'.') {
                        
                        debug_assert_ne!(file_name_new_len, 0);
                        file_name_new_len -= part.len();
                        if file_name_new_len == 0 {
                            continue;  
                        }

                        if part == b"so" {
                            file_name = unsafe { 
                                OsStr::from_encoded_bytes_unchecked(&file_name_bytes[..file_name_new_len + 2])
                            };
                            break;
                        }

                        file_name_new_len -= 1;  

                    }

                    let dst_file = bin_dir.join(file_name);
                    symlink_or_copy_file(&src_file, &dst_file)?;

                }
            }
            
        }

        handler.on_event(Event::ExtractedBinaries { dir: &bin_dir });

        Ok(bin_dir)

    }

    fn load_logger(&self,
        handler: &mut dyn Handler,
        hierarchy: &[LoadedVersion], 
        batch: &mut Batch,
    ) -> Result<Option<LoggerConfig>> {

        let config = hierarchy.iter()
            .filter_map(|version| version.metadata.logging.get("client"))
            .next();

        let Some(config) = config else {
            handler.on_event(Event::NoLogger);
            return Ok(None);
        };

        handler.on_event(Event::LoadLogger { id: &config.file.id });

        let file = self.assets_dir
            .join("log_configs")
            .joined(config.file.id.as_str());

        if !check_file(&file, config.file.download.size, config.file.download.sha1.as_deref())? {
            batch.push(config.file.download.url.clone(), file.clone())
                .set_expected_size(config.file.download.size)
                .set_expected_sha1(config.file.download.sha1.as_deref().copied());
        }

        handler.on_event(Event::LoadedLogger { id: &config.file.id });

        Ok(Some(LoggerConfig {
            kind: config.r#type,
            argument: config.argument.clone(),
            file,
        }))

    }

    fn load_assets(&self, 
        handler: &mut dyn Handler, 
        hierarchy: &[LoadedVersion], 
        batch: &mut Batch,
    ) -> Result<Option<Assets>> {

        #[derive(Debug)]
        struct IndexInfo<'a> {
            download: Option<&'a serde::Download>,
            id: &'a str,
        }

        let index_info = hierarchy.iter()
            .find_map(|version| {
                if let Some(asset_index) = &version.metadata.asset_index {
                    Some(IndexInfo {
                        download: Some(&asset_index.download),
                        id: &asset_index.id,
                    })
                } else if let Some(asset_id) = &version.metadata.assets {
                    Some(IndexInfo {
                        download: None,
                        id: &asset_id,
                    })
                } else {
                    None
                }
            });

        let Some(index_info) = index_info else {
            handler.on_event(Event::NoAssets);
            return Ok(None);
        };

        handler.on_event(Event::LoadAssets { id: index_info.id });

        let indexes_dir = self.assets_dir.join("indexes");
        let index_file = indexes_dir.join_with_extension(index_info.id, "json");

        let mut index_downloaded = false;
        if let Some(dl) = index_info.download {
            if !check_file(&index_file, dl.size, dl.sha1.as_deref())? {
                download::single(dl.url.clone(), index_file.clone())
                    .set_expected_size(dl.size)
                    .set_expected_sha1(dl.sha1.as_deref().copied())
                    .download((&mut *handler).into_download())?;
                index_downloaded = true;
            }
        }

        let asset_index = {

            let reader = match File::open(&index_file) {
                Ok(reader) => BufReader::new(reader),
                Err(e) if !index_downloaded && e.kind() == io::ErrorKind::NotFound =>
                    return Err(Error::AssetsNotFound { id: index_info.id.to_owned() }),
                Err(e) => 
                    return Err(Error::new_io_file(e, &index_file))
            };
    
            let mut deserializer = serde_json::Deserializer::from_reader(reader);
            serde_path_to_error::deserialize::<_, serde::AssetIndex>(&mut deserializer)
                .map_err(|e| Error::new_json_file(e, &index_file))?

        };
        
        handler.on_event(Event::LoadedAssets { 
            id: index_info.id, 
            count: asset_index.objects.len(),
        });

        let objects_dir = self.assets_dir.join("objects");
        let mut asset_file_name = String::new();
        let mut unique_hashes = HashSet::new();

        let mut assets = Assets {
            id: index_info.id.to_string(),
            mapping: None,
        };

        if asset_index.r#virtual || asset_index.map_to_resources {
            assets.mapping = Some(AssetsMapping {
                objects: Vec::new(),
                virtual_dir: self.assets_dir
                    .join("virtual")
                    .joined(assets.id.as_str())
                    .into_boxed_path(),
                resources: asset_index.map_to_resources,
            });
        }

        for (asset_rel_file, asset) in &asset_index.objects {

            asset_file_name.clear();
            for byte in *asset.hash {
                write!(asset_file_name, "{byte:02x}").unwrap();
            }
            
            let asset_hash_prefix = &asset_file_name[0..2];
            let asset_hash_file = objects_dir
                .join(asset_hash_prefix)
                .joined(asset_file_name.as_str());

            if let Some(mapping) = &mut assets.mapping {
                mapping.objects.push(AssetObject {
                    rel_file: PathBuf::from(asset_rel_file).into_boxed_path(),
                    object_file: asset_hash_file.clone().into_boxed_path(),
                    size: asset.size,
                });
            }

            if !unique_hashes.insert(&*asset.hash) {
                continue;
            }

            let check_asset_sha1 = self.strict_assets_check.then_some(&*asset.hash);
            if !check_file(&asset_hash_file, Some(asset.size), check_asset_sha1)? {
                batch.push(format!("{RESOURCES_URL}{asset_hash_prefix}/{asset_file_name}"), asset_hash_file)
                    .set_expected_size(Some(asset.size))
                    .set_expected_sha1(Some(*asset.hash));
            }

        }

        handler.on_event(Event::VerifiedAssets { 
            id: index_info.id, 
            count: asset_index.objects.len(),
        });

        Ok(Some(assets))

    }

    fn finalize_assets(&self, assets: &Assets) -> Result<()> {

        let Some(mapping) = &assets.mapping else {
            return Ok(());
        };

        let resources_dir = mapping.resources
            .then(|| self.mc_dir.join("resources"));

        for object in &mapping.objects {
            
            let virtual_file = mapping.virtual_dir.join(&object.rel_file);
            if let Some(parent_dir) = virtual_file.parent() {
                fs::create_dir_all(parent_dir)
                    .map_err(|e| Error::new_io(e, format!("create dir: {}", parent_dir.display())))?;
            }
            hard_link_file(&object.object_file, &virtual_file)?;

            if let Some(resources_dir) = &resources_dir {

                let resource_file = resources_dir.join(&object.rel_file);
                if !check_file(&resource_file, Some(object.size), None)? {
                    
                    if let Some(parent_dir) = resource_file.parent() {
                        fs::create_dir_all(parent_dir)
                            .map_err(|e| Error::new_io(e, format!("create dir: {}", parent_dir.display())))?;
                    }

                    fs::copy(&object.object_file, &resource_file)
                        .map_err(|e| Error::new_io(e, format!("copy: {}, to: {}",
                            object.object_file.display(),
                            resource_file.display())))?;

                }

            }

        }

        Ok(())

    }
    
    fn load_jvm(&self, 
        handler: &mut dyn Handler, 
        hierarchy: &[LoadedVersion], 
        batch: &mut Batch,
    ) -> Result<Jvm> {

        let version = hierarchy.iter()
            .find_map(|version| version.metadata.java_version.as_ref());

        let major_version = version
            .map(|v| v.major_version)
            .unwrap_or(8);  

        let distribution = version
            .and_then(|v| v.component.as_deref())
            .or_else(|| Some(match major_version {
                8 => "jre-legacy",
                16 => "java-runtime-alpha",
                17 => "java-runtime-gamma",
                21 => "java-runtime-delta",
                _ => return None
            }));
        
        handler.on_event(Event::LoadJvm { major_version });

        let jvm = if let Some(distribution) = distribution {
            match self.jvm_policy {
                JvmPolicy::Static(ref file) => 
                    Some(self.load_static_jvm(handler, &file, major_version)?),
                JvmPolicy::System => 
                    self.load_system_jvm(handler, major_version)?,
                JvmPolicy::Mojang => 
                    self.load_mojang_jvm(handler, distribution, batch)?,
                JvmPolicy::SystemThenMojang => {
                    let mut jvm = self.load_system_jvm(handler, major_version)?;
                    if jvm.is_none() {
                        jvm = self.load_mojang_jvm(handler, distribution, batch)?;
                    }
                    jvm
                }
                JvmPolicy::MojangThenSystem => {
                    let mut jvm = self.load_mojang_jvm(handler, distribution, batch)?;
                    if jvm.is_none() {
                        jvm = self.load_system_jvm(handler, major_version)?;
                    }
                    jvm
                }
            }
        } else {
            match self.jvm_policy {
                JvmPolicy::Static(ref file) => 
                    Some(self.load_static_jvm(handler, &file, major_version)?),
                JvmPolicy::System | 
                JvmPolicy::SystemThenMojang | 
                JvmPolicy::MojangThenSystem => 
                    self.load_system_jvm(handler, major_version)?,
                JvmPolicy::Mojang => None,
            }
        };

        let Some(jvm) = jvm else {
            return Err(Error::JvmNotFound { major_version });
        };

        let version = jvm.version.as_ref()
            .map(|v| v.full.as_str());
        
        let compatible = jvm.version.as_ref()
            .map(|v| v.major_compatibility.is_some())
            .unwrap_or(false);

        handler.on_event(Event::LoadedJvm { 
            file: &jvm.file, 
            version, 
            compatible,
        });

        Ok(jvm)

    }

    fn load_static_jvm(&self,
        _handler: &mut dyn Handler,
        file: &Path,
        major_version: u32,
    ) -> Result<Jvm> {

        let mut jvm = Jvm {
            file: file.to_path_buf(),
            version: None,
            mojang: None,
        };

        self.find_jvm_versions(std::slice::from_mut(&mut jvm), major_version);
        Ok(jvm)

    }

    fn load_system_jvm(&self,
        handler: &mut dyn Handler,
        major_version: u32,
    ) -> Result<Option<Jvm>> {

        let mut candidates = IndexSet::new();
        let exec_name = jvm_exec_name();

        if let Some(path) = env::var_os("PATH") {
            for mut path in env::split_paths(&path) {
                path.push(exec_name);
                if path.is_file() {
                    candidates.insert(path);
                }
            }
        }

        #[cfg(target_os = "linux")] {
            if let Ok(read_dir) = fs::read_dir("/usr/lib/jvm/") {
                for entry in read_dir {
                    let Ok(entry) = entry else { continue };
                    let path = entry.path()
                        .joined("bin")
                        .joined(exec_name);
                    if path.is_file() {
                        candidates.insert(path);
                    }
                }
            }
        }

        #[cfg(windows)] {

            const REG_PATHS: [&str; 4] = [
                "SOFTWARE\\JavaSoft\\Java Development Kit",
                "SOFTWARE\\JavaSoft\\Java Runtime Environment",
                "SOFTWARE\\JavaSoft\\JDK",
                "SOFTWARE\\JavaSoft\\JRE",
            ];

            for path in REG_PATHS {
                let Ok(key) = windows_registry::LOCAL_MACHINE.open(path) else { continue };
                let Ok(keys) = key.keys() else { continue };
                for sub_key in keys {
                    let Ok(sub_key) = key.open(&sub_key) else { continue };
                    let Ok(java_home) = sub_key.get_string("JavaHome") else { continue };
                    let path = PathBuf::from(java_home)
                        .joined("bin")
                        .joined(exec_name);
                    if path.is_file() {
                        candidates.insert(path);
                    }
                }
            }

        }

        let mut jvms = candidates.into_iter().map(|file| Jvm {
            file,
            version: None,
            mojang: None,
        }).collect::<Vec<_>>();

        self.find_jvm_versions(&mut jvms, major_version);

        let mut min_score_jvm = None;
        for jvm in jvms {

            let Some(version) = &jvm.version else { continue };

            let Some(score) = version.major_compatibility else {
                handler.on_event(Event::FoundJvmSystemVersion { 
                    file: &jvm.file, 
                    version: &version.full, 
                    compatible: false,
                });
                continue;
            };

            handler.on_event(Event::FoundJvmSystemVersion { 
                file: &jvm.file, 
                version: &version.full, 
                compatible: true,
            });

            if let Some((_, min_score)) = min_score_jvm {
                if min_score <= score {
                    continue;
                }
            }

            min_score_jvm = Some((jvm, score));

        }

        Ok(min_score_jvm.map(|(jvm, _score)| jvm))

    }

    fn load_mojang_jvm(&self,
        handler: &mut dyn Handler,
        distribution: &str,
        batch: &mut Batch,
    ) -> Result<Option<Jvm>> {

        if cfg!(target_os = "linux") && cfg!(target_feature = "crt-static") {
            handler.on_event(Event::WarnJvmUnsupportedDynamicCrt);
            return Ok(None);
        }

        let Some(jvm_platform) = mojang_jvm_platform() else {
            handler.on_event(Event::WarnJvmUnsupportedPlatform);
            return Ok(None);
        };

        let meta_manifest = {

            let mut entry = download::single_cached(JVM_META_MANIFEST_URL)
                .set_keep_open()
                .download((&mut *handler).into_download())?;

            let reader = BufReader::new(entry.take_handle().unwrap());
            let mut deserializer = serde_json::Deserializer::from_reader(reader);
            serde_path_to_error::deserialize::<_, serde::JvmMetaManifest>(&mut deserializer)
                .map_err(|e| Error::new_json_file(e, entry.file()))?

        };

        let Some(meta_platform) = meta_manifest.platforms.get(jvm_platform) else {
            handler.on_event(Event::WarnJvmUnsupportedPlatform);
            return Ok(None);
        };

        let Some(meta_distribution) = meta_platform.distributions.get(distribution) else {
            handler.on_event(Event::WarnJvmMissingDistribution);
            return Ok(None);
        };

        let Some(meta_variant) = meta_distribution.variants.get(0) else {
            handler.on_event(Event::WarnJvmMissingDistribution);
            return Ok(None);
        };

        let dir = self.jvm_dir.join(distribution);
        let manifest_file = self.jvm_dir.join_with_extension(distribution, "json");

        let bin_file = if cfg!(target_os = "macos") {
            dir.join("jre.bundle/Contents/Home/bin/java")
        } else {
            dir.join("bin").joined(jvm_exec_name())
        };

        let manifest = {
            
            if !check_file(&manifest_file, meta_variant.manifest.size, meta_variant.manifest.sha1.as_deref())? {
                download::single(meta_variant.manifest.url.clone(), manifest_file.clone())
                    .set_expected_size(meta_variant.manifest.size)
                    .set_expected_sha1(meta_variant.manifest.sha1.as_deref().copied())
                    .set_keep_open()
                    .download((&mut *handler).into_download())?;
            }
            
            let reader = File::open(&manifest_file)
                .map_err(|e| Error::new_io_file(e, &manifest_file))
                .map(BufReader::new)?;

            let mut deserializer = serde_json::Deserializer::from_reader(reader);
            serde_path_to_error::deserialize::<_, serde::JvmManifest>(&mut deserializer)
                .map_err(|e| Error::new_json_file(e, &manifest_file))?

        };

        let mut mojang_jvm = MojangJvm::default();
        
        for (rel_file, manifest_file) in &manifest.files {

            let rel_file = Path::new(rel_file);
            let file = dir.join(rel_file);

            match manifest_file {
                serde::JvmManifestFile::Directory => {
                    fs::create_dir_all(&file)
                        .map_err(|e| Error::new_io(e, format!("create dir: {}", file.display())))?;
                }
                serde::JvmManifestFile::File { 
                    executable, 
                    downloads 
                } => {

                    if *executable {
                        mojang_jvm.executables.push(file.clone().into_boxed_path());
                    }
                    
                    let dl = &downloads.raw;
                    
                    let check_dl_sha1 = dl.sha1.as_deref().filter(|_| self.strict_jvm_check);
                    if !check_file(&file, dl.size, check_dl_sha1)? {
                        batch.push(dl.url.clone(), file)
                            .set_expected_size(dl.size)
                            .set_expected_sha1(dl.sha1.as_deref().copied());
                    }

                }
                serde::JvmManifestFile::Link { 
                    target
                } => {
                    mojang_jvm.links.push(MojangJvmLink {
                        file: file.into_boxed_path(),
                        target_file: PathBuf::from(target).into_boxed_path(),
                    });
                }
            }

        }

        Ok(Some(Jvm {
            file: bin_file,
            version: Some(JvmVersion {
                full: meta_variant.version.name.clone(),
                major_compatibility: Some(0),  
            }),
            mojang: Some(mojang_jvm),
        }))

    }

    fn find_jvm_versions(&self, jvms: &mut [Jvm], major_version: u32) {

        let mut children = Vec::new();
        let mut remaining = 0usize;

        for jvm in jvms.iter_mut() {
            
            let mut probe = Command::new(&jvm.file);
            probe
                .arg("-version")
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            no_window(&mut probe);
            let child = probe.spawn().ok();
            
            if child.is_some() {
                remaining += 1;
            }

            children.push(child);

        }

        const TRIES_COUNT: usize = 30;  
        const TRIES_SLEEP: Duration = Duration::from_millis(100);
        
        for _ in 0..TRIES_COUNT {

            for (child_idx, child_opt) in children.iter_mut().enumerate() {

                let Some(child) = child_opt else { continue };
                let Ok(status) = child.try_wait() else {
                    let _ = child.kill();
                    *child_opt = None;
                    remaining -= 1;
                    continue;
                };

                let Some(status) = status else { continue };
                let child = child_opt.take().unwrap();
                remaining -= 1;
                
                if !status.success() {
                    continue;
                }

                let output = child.wait_with_output().unwrap();
                let Ok(output) = String::from_utf8(output.stderr) else { 
                    continue; 
                };

                jvms[child_idx].version = output.lines()
                    .filter_map(|line| line.split_once('"'))
                    .filter_map(|(_, line)| line.split_once('"'))
                    .map(|(version, _)| version)
                    .next()
                    .and_then(|version| {
                        
                        let actual_major_version = parse_jvm_major_version(version)?;

                        Some(JvmVersion {
                            full: version.to_string(),
                            major_compatibility: calc_jvm_major_compatibility(major_version, actual_major_version),
                        })

                    });
                
            }

            if remaining == 0 {
                break;
            }

            thread::sleep(TRIES_SLEEP);

        }

    }

    fn finalize_jvm(&self, jvm: &Jvm) -> Result<()> {

        let Some(mojang_jvm) = &jvm.mojang else {
            return Ok(());
        };

        #[cfg(unix)]
        for exec_file in &mojang_jvm.executables {

            use std::os::unix::fs::PermissionsExt;

            let mut perm = exec_file.metadata()
                .map_err(|e| Error::new_io_file(e, &exec_file))?
                .permissions();

            let mode = perm.mode();
            let new_mode = mode | ((mode & 0o444) >> 2);
            if new_mode != mode {
                
                perm.set_mode(new_mode);
                fs::set_permissions(exec_file, perm)
                    .map_err(|e| Error::new_io(e, format!("set permissions: {}", exec_file.display())))?;

            }
            
        }

        for link in &mojang_jvm.links {
            link_file(&link.target_file, &link.file)?;
        }

        Ok(())

    }

    fn check_args(&self,
        dest: &mut Vec<String>,
        args: &[serde::VersionArgument],
        features: &HashSet<String>,
        mut all_features: Option<&mut HashSet<String>>,
    ) {

        for arg in args {
                    
            if let serde::VersionArgument::Conditional(cond) = arg {
                if let Some(rules) = &cond.rules {
                    if !self.check_rules(rules, features, all_features.as_deref_mut()) {
                        continue;
                    }
                }
            }

            match arg {
                serde::VersionArgument::Raw(val) => dest.push(val.clone()),
                serde::VersionArgument::Conditional(cond) => 
                    match &cond.value {
                        serde::SingleOrVec::Single(val) => dest.push(val.clone()),
                        serde::SingleOrVec::Vec(vals) => dest.extend_from_slice(&vals),
                    },
            }

        }

    }

    fn check_rules(&self,
        rules: &[serde::Rule],
        features: &HashSet<String>,
        mut all_features: Option<&mut HashSet<String>>,
    ) -> bool {

        let mut allowed = false;

        for rule in rules {
            match self.check_rule(rule, features, all_features.as_deref_mut()) {
                Some(serde::RuleAction::Allow) => allowed = true,
                Some(serde::RuleAction::Disallow) => allowed = false,
                None => (),
            }
        }

        allowed

    }

    fn check_rule(&self, 
        rule: &serde::Rule, 
        features: &HashSet<String>, 
        mut all_features: Option<&mut HashSet<String>>
    ) -> Option<serde::RuleAction> {

        if !self.check_rule_os(&rule.os) {
            return None;
        }

        for (feature, feature_expected) in &rule.features {

            if features.contains(feature) != *feature_expected {
                return None;
            }
            
            if let Some(all_features) = all_features.as_deref_mut() {
                all_features.insert(feature.clone());
            }

        }

        Some(rule.action)

    }

    fn check_rule_os(&self, rule_os: &serde::RuleOs) -> bool {

        if let Some(name) = rule_os.name.as_deref() {
            match os_name() {
                Some(os_name) if name == os_name => (),
                _ => return false,
            }
        }

        if let Some(arch) = rule_os.arch.as_deref() {
            match os_arch() {
                Some(os_arch) if arch == os_arch => (),
                _ => return false,
            }
        }

        if let Some(version) = rule_os.version.as_deref() {
            match os_version() {
                Some(os_version) if version.is_match(os_version) => (),
                _ => return false,
            }
        }

        true

    }

}

#[derive(Debug)]
#[non_exhaustive]
pub enum Event<'a> {
    FilterFeatures { features: &'a mut HashSet<String> },
    LoadedFeatures { features: &'a HashSet<String> },
    LoadHierarchy { root_version: &'a str },
    LoadedHierarchy { hierarchy: &'a [LoadedVersion] },
    LoadVersion { version: &'a str, file: &'a Path },
    NeedVersion { version: &'a str, file: &'a Path, retry: &'a mut bool },
    LoadedVersion { version: &'a str, file: &'a Path },
    LoadClient,
    LoadedClient { file: &'a Path },
    LoadLibraries,
    FilterLibraries { libraries: &'a mut Vec<LoadedLibrary> },
    LoadedLibraries { libraries: &'a [LoadedLibrary] },
    FilterLibrariesFiles { class_files: &'a mut Vec<PathBuf>, natives_files: &'a mut Vec<PathBuf> },
    LoadedLibrariesFiles { class_files: &'a [PathBuf], natives_files: &'a [PathBuf] },
    NoLogger,
    LoadLogger { id: &'a str },
    LoadedLogger { id: &'a str },
    NoAssets,
    LoadAssets { id: &'a str },
    LoadedAssets { id: &'a str, count: usize },
    VerifiedAssets { id: &'a str, count: usize },
    LoadJvm { major_version: u32 },
    FoundJvmSystemVersion { file: &'a Path, version: &'a str, compatible: bool },
    WarnJvmUnsupportedDynamicCrt,
    WarnJvmUnsupportedPlatform,
    WarnJvmMissingDistribution,
    LoadedJvm { file: &'a Path, version: Option<&'a str>, compatible: bool },
    DownloadResources { cancel: &'a mut bool },
    DownloadedResources,
    DownloadProgress { count: u32, total_count: u32, size: u32, total_size: u32 },
    ExtractedBinaries { dir: &'a Path },
}

pub trait Handler {
    fn on_event(&mut self, event: Event);

    /// Return `true` to request that an in-progress resource download be aborted.
    fn cancelled(&self) -> bool {
        false
    }
}

impl<H: Handler + ?Sized> Handler for &mut H {
    #[inline]
    fn on_event(&mut self, event: Event) {
        (**self).on_event(event)
    }

    #[inline]
    fn cancelled(&self) -> bool {
        (**self).cancelled()
    }
}

impl Handler for () {
    fn on_event(&mut self, event: Event) {
        let _ = event;
    }
}

pub(crate) trait HandlerInto: Handler + Sized {

    #[inline]
    fn into_download(self) -> impl download::Handler {
        pub(crate) struct Adapter<H: Handler>(pub H);
        impl<H: Handler> download::Handler for Adapter<H> {
            fn on_progress(&mut self, count: u32, total_count: u32, size: u32, total_size: u32) {
                self.0.on_event(Event::DownloadProgress { count, total_count, size, total_size });
            }
            fn cancelled(&self) -> bool {
                self.0.cancelled()
            }
        }
        Adapter(self)
    }

}

impl<H: Handler> HandlerInto for H {}


#[derive(thiserror::Error, Debug)]
#[non_exhaustive]
pub enum Error {
    #[error("hierarchy loop: {version}")]
    HierarchyLoop {
        version: String,
    },
    #[error("version not found: {version}")]
    VersionNotFound {
        version: String,
    },
    #[error("assets not found: {id}")]
    AssetsNotFound {
        id: String,
    },
    #[error("client not found")]
    ClientNotFound {  },
    #[error("library not found: {name}")]
    LibraryNotFound {
        name: Gav,
    },
    #[error("jvm not found")]
    JvmNotFound {
        major_version: u32,
    },
    #[error("main class not found")]
    MainClassNotFound {  },
    #[error("download resources cancelled")]
    DownloadResourcesCancelled {  },
    #[error("download: {} errors over {} entries", batch.errors_count(), batch.len())]
    Download {
        batch: download::BatchResult,
    },
    #[error("internal: {error} @ {origin}")]
    Internal {
        #[source]
        error: Box<dyn std::error::Error + Send + Sync>,
        origin: Box<str>,
    },
}

impl From<download::BatchResult> for Error {
    fn from(batch: download::BatchResult) -> Self {
        Self::Download { batch }
    }
}

impl From<download::EntryError> for Error {
    fn from(value: download::EntryError) -> Self {
        Self::Download { batch: download::BatchResult::from(value) }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {

    /// `true` if this error was produced because the install was cancelled.
    #[inline]
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::DownloadResourcesCancelled { .. })
            || matches!(self, Self::Download { batch } if batch.cancelled())
    }

    #[inline]
    pub(crate) fn new_io(error: io::Error, origin: impl Into<Box<str>>) -> Self {
        Self::Internal { error: Box::new(error), origin: origin.into() }
    }
    
    #[inline]
    pub(crate) fn new_json(error: serde_path_to_error::Error<serde_json::Error>, origin: impl Into<Box<str>>) -> Self {
        Self::Internal { error: Box::new(error), origin: origin.into() }
    }
    
    #[inline]
    pub(crate) fn new_zip(error: zip::result::ZipError, origin: impl Into<Box<str>>) -> Self {
        Self::Internal { error: Box::new(error), origin: origin.into() }
    }

    #[inline]
    pub(crate) fn new_reqwest(error: reqwest::Error, origin: impl Into<Box<str>>) -> Self {
        Self::Internal { error: Box::new(error), origin: origin.into() }
    }

    #[inline]
    pub(crate) fn new_io_file(error: io::Error, file: impl AsRef<Path>) -> Self {
        Self::new_io(error, file.as_ref().display().to_string())
    }
    
    #[inline]
    pub(crate) fn new_json_file(error: serde_path_to_error::Error<serde_json::Error>, file: impl AsRef<Path>) -> Self {
        Self::new_json(error, file.as_ref().display().to_string())
    }

    #[inline]
    pub(crate) fn new_zip_file(error: zip::result::ZipError, file: impl AsRef<Path>) -> Self {
        Self::new_zip(error, file.as_ref().display().to_string())
    }

}

#[derive(Debug, Clone)]
pub enum JvmPolicy {
    Static(PathBuf),
    System,
    Mojang,
    SystemThenMojang,
    MojangThenSystem,
}

#[derive(Clone)]
pub struct LoadedVersion {
    name: String,
    dir: PathBuf,
    metadata: Box<serde::VersionMetadata>,
}

impl LoadedVersion {

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn channel(&self) -> Option<VersionChannel> {
        self.metadata.r#type.map(VersionChannel::from)
    }

}

impl fmt::Debug for LoadedVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoadedVersion")
            .field("name", &self.name)
            .field("dir", &self.dir)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VersionChannel {
    Release,
    Snapshot,
    Beta,
    Alpha,
}

impl From<serde::VersionType> for VersionChannel {
    #[inline]
    fn from(value: serde::VersionType) -> Self {
        match value {
            serde::VersionType::Release => Self::Release,
            serde::VersionType::Snapshot => Self::Snapshot,
            serde::VersionType::OldBeta => Self::Beta,
            serde::VersionType::OldAlpha => Self::Alpha,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedLibrary {
    pub name: Gav,
    pub path: Option<PathBuf>,
    pub download: Option<LibraryDownload>,
    pub natives: bool,
}

#[derive(Debug, Clone)]
pub struct LibraryDownload {
    pub url: String,
    pub size: Option<u32>,
    pub sha1: Option<[u8; 20]>,
}

pub trait LibraryFilter {

    fn filter_libraries(&self, libraries: &mut Vec<LoadedLibrary>);

    fn filter_libraries_files(&self, classes_files: &mut Vec<PathBuf>, natives_files: &mut Vec<PathBuf>);

}

impl Debug for dyn LibraryFilter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "dyn LibraryFilter")
    }
}

#[derive(Debug, Clone)]
pub struct Game {
    pub jvm_file: PathBuf,
    pub mc_dir: PathBuf,
    pub main_class: String,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
}

impl Game {

    pub(crate) fn replace_args<F>(&mut self, mut func: F)
    where
        F: FnMut(&str) -> Option<String>,
    {
        replace_strings_args(&mut self.jvm_args, &mut func);
        replace_strings_args(&mut self.game_args, &mut func);
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.jvm_file);
        command
            .current_dir(&self.mc_dir)
            .args(&self.jvm_args)
            .arg(&self.main_class)
            .args(&self.game_args);
        no_window(&mut command);
        command
    }

    pub fn spawn(&self) -> io::Result<Child> {
        self.command().spawn()
    }

    pub fn spawn_and_wait(&self) -> io::Result<ExitStatus> {
        self.spawn()?.wait()
    }

}


#[derive(Debug, Default)]
struct LibrariesFiles {
    class_files: Vec<PathBuf>,
    natives_files: Vec<PathBuf>,
}

#[derive(Debug)]
struct LoggerConfig {
    #[allow(unused)]
    kind: serde::VersionLoggingType,
    argument: String,
    file: PathBuf,
}

#[derive(Debug)]
struct Assets {
    id: String,
    mapping: Option<AssetsMapping>,
}

#[derive(Debug)]
struct AssetsMapping {
    objects: Vec<AssetObject>,
    virtual_dir: Box<Path>,
    resources: bool,
}

#[derive(Debug)]
struct AssetObject {
    rel_file: Box<Path>,
    object_file: Box<Path>,
    size: u32,
}

#[derive(Debug)]
struct Jvm {
    file: PathBuf,
    version: Option<JvmVersion>,
    mojang: Option<MojangJvm>,
}

#[derive(Debug)]
struct JvmVersion {
    full: String,
    major_compatibility: Option<u32>,
}

#[derive(Debug, Default)]
struct MojangJvm {
    executables: Vec<Box<Path>>,
    links: Vec<MojangJvmLink>,
}

#[derive(Debug)]
struct MojangJvmLink {
    file: Box<Path>,
    target_file: Box<Path>,
}

pub(crate) fn check_path_relative_and_safe<P: AsRef<Path>>(path: P) -> Result<P> {
    if path.as_ref().is_relative_and_safe() {
        Ok(path)
    } else {
        Err(Error::new_io_file(io::Error::new(io::ErrorKind::InvalidInput, "path is not relative or contains unsafe components"), path))
    }
}

pub(crate) fn check_file(file: &Path, size: Option<u32>, sha1: Option<&[u8; 20]>) -> Result<bool> {
    check_file_advanced(file, size, sha1, false)
}

pub(crate) fn check_file_advanced(file: &Path, size: Option<u32>, sha1: Option<&[u8; 20]>, not_found_valid: bool) -> Result<bool> {

    fn inner(file: &Path, size: Option<u32>, sha1: Option<&[u8; 20]>, not_found_valid: bool) -> io::Result<bool> {
    
        if let Some(sha1) = sha1 {
            match File::open(file) {
                Ok(mut reader) => {
    
                    if let Some(size) = size {
                        let actual_size = reader.seek(SeekFrom::End(0))?;
                        if size as u64 != actual_size {
                            return Ok(false);
                        }
                        reader.seek(SeekFrom::Start(0))?;
                    }
                    
                    let mut digest = Sha1::new();
                    io::copy(&mut reader, &mut digest)?;
                    if digest.finalize().as_slice() != sha1 {
                        return Ok(false);
                    }
                    
                    Ok(true)
    
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(not_found_valid),
                Err(e) => return Err(e),
            }
        } else {
            match (file.metadata(), size) {
                (Ok(metadata), Some(size)) => Ok(metadata.len() == size as u64),
                (Ok(_metadata), None) => Ok(true),
                (Err(e), _) if e.kind() == io::ErrorKind::NotFound => Ok(not_found_valid),
                (Err(e), _) => return Err(e),
            }
        }
    
    }

    inner(file, size, sha1, not_found_valid)
        .map_err(|e| Error::new_io(e, format!("check file: {}", file.display())))

}

fn replace_strings_args<'input, F>(ss: &mut [String], mut func: F)
where 
    F: FnMut(&str) -> Option<String>,
{
    for s in ss {
        replace_string_args(s, &mut func);
    }
}

fn replace_string_args<F>(s: &mut String, mut func: F)
where 
    F: FnMut(&str) -> Option<String>,
{

    let mut cursor = 0;

    while let Some(open_idx) = s[cursor..].find("${") {
        
        let open_idx = cursor + open_idx;
        let Some(close_idx) = s[open_idx + 2..].find('}') else { break };
        let close_idx = open_idx + 2 + close_idx + 1;
        cursor = close_idx;

        if let Some(value) = func(&s[open_idx + 2..close_idx - 1]) {
            
            s.replace_range(open_idx..close_idx, &value);
            
            let repl_len = close_idx - open_idx;
            let repl_diff = value.len() as isize - repl_len as isize;
            cursor = cursor.checked_add_signed(repl_diff).unwrap();

        }

    }

}

fn parse_jvm_major_version(version: &str) -> Option<u32> {
    
    if !version.contains('.') {
        if let Some((major, _patch)) = version.split_once('u') {
            return major.parse::<u32>().ok();
        }
    }

    let mut comp = version.split('.');
    let mut major = comp.next()?.parse::<u32>().ok()?;
    if major == 1 {
        major = comp.next()?.parse::<u32>().ok()?;
    }
    Some(major)

}

fn calc_jvm_major_compatibility(expected_version: u32, version: u32) -> Option<u32> {
    if expected_version <= 8 {
        (expected_version == version).then_some(0)
    } else {
        if version >= expected_version {
            Some(version - expected_version)
        } else {
            None
        }
    }
}

#[inline]
pub(crate) fn canonicalize_file(file: &Path) -> Result<PathBuf> {
    dunce::canonicalize(file)
        .map_err(|e| Error::new_io(e, format!("canonicalize: {}", file.display())))
}

#[inline]
pub(crate) fn link_file(original: &Path, link: &Path) -> Result<()> {

    let err;
    let action;

    #[cfg(unix)] {
        err = std::os::unix::fs::symlink(original, link);
        action = "symlink";
    }

    #[cfg(not(unix))] {
        let parent_dir = link.parent().unwrap();
        let file = parent_dir.join(&original);
        err = fs::hard_link(original, &file);
        action = "hard link";
    }

    match err {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(Error::new_io(e, format!("{action}: {}, to: {}", original.display(), link.display()))),
    }

}

#[inline]
pub(crate) fn symlink_or_copy_file(original: &Path, link: &Path) -> Result<()> {

    let err;
    let action;

    #[cfg(unix)] {
        err = match std::os::unix::fs::symlink(original, link) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e),
        };
        action = "symlink";
    }

    #[cfg(not(unix))] {
        err = fs::copy(original, link).map(|_| ());
        action = "copy";
    }

    err.map_err(|e| Error::new_io(e, format!("{action}: {}, to: {}", original.display(), link.display())))

}

#[inline]
pub(crate) fn hard_link_file(original: &Path, link: &Path) -> Result<()> {
    match fs::hard_link(original, link) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(Error::new_io(e, format!("hard link: {}, to: {}", original.display(), link.display()))),
    }
}

pub(crate) fn write_version_metadata(file: &Path, metadata: &serde::VersionMetadata) -> Result<()> {

    let dir = file.parent().unwrap();
    fs::create_dir_all(dir)
        .map_err(|e| Error::new_io_file(e, dir))?;

    let writer = File::create(file)
        .map_err(|e| Error::new_io_file(e, file))
        .map(BufWriter::new)?;

    let mut serializer = serde_json::Serializer::new(writer);
    serde_path_to_error::serialize(&metadata, &mut serializer)
        .map_err(|e| Error::new_json_file(e, file))?;

    Ok(())

}

pub fn default_main_dir() -> Option<&'static Path> {

    static MAIN_DIR: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
        if cfg!(target_os = "windows") {
            dirs::data_dir().map(|dir| dir.joined(".minecraft"))
        } else if cfg!(target_os = "macos") {
            dirs::data_dir().map(|dir| dir.joined("minecraft"))
        } else {
            dirs::home_dir().map(|dir| dir.joined(".minecraft"))
        }
    });

    MAIN_DIR.as_deref()
    
}

#[inline]
fn os_name() -> Option<&'static str> {
    Some(match env::consts::OS {
        "windows" => "windows",
        "linux" => "linux",
        "macos" => "osx",
        "freebsd" => "freebsd",
        "openbsd" => "openbsd",
        "netbsd" => "netbsd",
        "android" => "android",
        _ => return None
    })
}

#[inline]
fn os_arch() -> Option<&'static str> {
    Some(match env::consts::ARCH {
        "x86" => "x86",
        "x86_64" => "x86_64",
        "arm" => "arm32",
        "aarch64" => "arm64",
        _ => return None
    })
}

#[inline]
fn os_bits() -> Option<&'static str> {
    Some(match env::consts::ARCH {
        "x86" | "arm" => "32",
        "x86_64" | "aarch64" => "64",
        _ => return None
    })
}

#[inline]
fn os_version() -> Option<&'static str> {

    static VERSION: LazyLock<Option<String>> = LazyLock::new(|| {
        use os_info::Version;
        match os_info::get().version() {
            Version::Unknown => None,
            version => Some(version.to_string())
        }
    });

    VERSION.as_deref()

}

#[inline]
fn jvm_exec_name() -> &'static str {
    if cfg!(windows) { "javaw.exe" } else { "java" }
}

#[inline]
fn mojang_jvm_platform() -> Option<&'static str> {
    Some(match (env::consts::OS, env::consts::ARCH) {
        ("macos", "x86_64") => "mac-os",
        ("macos", "aarch64") => "mac-os-arm64",
        ("linux", "x86") => "linux-i386",
        ("linux", "x86_64") => "linux",
        ("windows", "x86") => "windows-x86",
        ("windows", "x86_64") => "windows-x64",
        ("windows", "aarch64") => "windows-arm64",
        _ => return None
    })
}

#[cfg(test)]
mod tests {

    #[test]
    fn replace_string_args() {
        
        use super::replace_string_args;

        let mut buf = "${begin}foo${middle}bar${end}".to_string();
        replace_string_args(&mut buf, |_arg| None);
        assert_eq!(buf, "${begin}foo${middle}bar${end}");
        replace_string_args(&mut buf, |arg| if arg == "middle" { Some(".:.".to_string()) } else { None });
        assert_eq!(buf, "${begin}foo.:.bar${end}");
        replace_string_args(&mut buf, |arg| Some(format!("[  {arg}  ]")));
        assert_eq!(buf, "[  begin  ]foo.:.bar[  end  ]");

    }

    #[test]
    fn parse_jvm_major_version() {

        use super::parse_jvm_major_version;

        assert_eq!(parse_jvm_major_version("7u80"), Some(7));
        assert_eq!(parse_jvm_major_version("8u51"), Some(8));
        assert_eq!(parse_jvm_major_version("17"), Some(17));
        assert_eq!(parse_jvm_major_version("17.0"), Some(17));
        assert_eq!(parse_jvm_major_version("17.0.2"), Some(17));
        assert_eq!(parse_jvm_major_version("1.8.0_111"), Some(8));
        assert_eq!(parse_jvm_major_version("10.0.2"), Some(10));

        assert_eq!(parse_jvm_major_version("10.foo"), Some(10));
        assert_eq!(parse_jvm_major_version("1.foo"), None);
        assert_eq!(parse_jvm_major_version("foou51"), None);
        assert_eq!(parse_jvm_major_version("8ufoo"), Some(8));

    }

    #[test]
    fn calc_jvm_major_compatibility() {

        use super::calc_jvm_major_compatibility;
        
        assert_eq!(calc_jvm_major_compatibility(7, 7), Some(0));
        assert_eq!(calc_jvm_major_compatibility(8, 8), Some(0));
        assert_eq!(calc_jvm_major_compatibility(8, 7), None);

        assert_eq!(calc_jvm_major_compatibility(9, 8), None);
        assert_eq!(calc_jvm_major_compatibility(9, 9), Some(0));
        assert_eq!(calc_jvm_major_compatibility(9, 11), Some(2));
        assert_eq!(calc_jvm_major_compatibility(9, 17), Some(8));
        assert_eq!(calc_jvm_major_compatibility(17, 17), Some(0));
        assert_eq!(calc_jvm_major_compatibility(17, 11), None);

    }

}
