
use std::path::{Component, Path, PathBuf};
use std::ffi::OsStr;


pub trait PathExt {

    fn join_with_extension<P: AsRef<Path>, S: AsRef<OsStr>>(&self, name: P, extension: S) -> PathBuf;

    fn append<S: AsRef<OsStr>>(&self, s: S) -> PathBuf;

    fn is_relative_and_safe(&self) -> bool;

}

impl PathExt for Path {

    #[inline]
    fn join_with_extension<P: AsRef<Path>, S: AsRef<OsStr>>(&self, name: P, extension: S) -> PathBuf {
        self.join(name).appended(".").appended(extension)
    }

    #[inline]
    fn append<S: AsRef<OsStr>>(&self, s: S) -> PathBuf {
        self.to_path_buf().appended(s)
    }

    fn is_relative_and_safe(&self) -> bool {
        self.components().all(|c| matches!(c, Component::CurDir | Component::Normal(_)))
    }

}


pub trait PathBufExt {

    fn joined<P: AsRef<Path>>(self, path: P) -> Self;

    fn appended<S: AsRef<OsStr>>(self, s: S) -> Self;

}

impl PathBufExt for PathBuf {
    
    #[inline]
    fn joined<P: AsRef<Path>>(mut self, path: P) -> Self {
        self.push(path);
        self
    }

    #[inline]
    fn appended<S: AsRef<OsStr>>(mut self, s: S) -> Self {
        self.as_mut_os_string().push(s);
        self
    }

}


#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn paths() {

        const SEP: &str = std::path::MAIN_SEPARATOR_STR;
        
        let path = Path::new("foo");
        assert_eq!(path.join_with_extension("bar", "json"), PathBuf::from(format!("foo{SEP}bar.json")));
        assert_eq!(path.append(SEP).appended("bar.json"), PathBuf::from(format!("foo{SEP}bar.json")));
        assert_eq!(path.join("bar").joined("baz"), PathBuf::from(format!("foo{SEP}bar{SEP}baz")));
        
    }

}
