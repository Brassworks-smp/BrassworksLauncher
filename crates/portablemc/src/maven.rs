
use std::cmp::Ordering;
use std::iter::FusedIterator;
use std::path::PathBuf;
use std::num::NonZero;
use std::str::FromStr;
use std::borrow::Cow;
use std::ops::Range;
use std::{fmt, hash};


#[derive(Clone)]
pub struct Gav {
    raw: Box<str>,
    group_len: NonZero<u16>,
    artifact_len: NonZero<u16>,
    version_len: NonZero<u16>,
    classifier_len: Option<NonZero<u16>>,
    extension_len: Option<NonZero<u16>>,
}

impl Gav {

    pub fn new(group: &str, artifact: &str, version: &str, classifier: Option<&str>, extension: Option<&str>) -> Option<Self> {
        
        let mut raw = format!("{group}:{artifact}:{version}");
        
        let mut classifier_len = None;
        if let Some(classifier) = classifier {
            raw.push(':');
            raw.push_str(classifier);
            classifier_len = Some(NonZero::new(classifier.len() as _)?);
        }

        let mut extension_len = None;
        if let Some(extension) = extension && extension != "jar" {
            raw.push('@');
            raw.push_str(extension);
            extension_len = Some(NonZero::new(extension.len() as _)?);
        }

        if raw.len() > u16::MAX as usize {
            return None;
        }

        check_gav_chars(&raw)?;

        Some(Self {
            raw: raw.into_boxed_str(),
            group_len: NonZero::new(group.len() as _)?,
            artifact_len: NonZero::new(artifact.len() as _)?,
            version_len: NonZero::new(version.len() as _)?,
            classifier_len,
            extension_len,
        })

    }

    fn _from_str(raw: Cow<str>) -> Option<Self> {

        if raw.len() > u16::MAX as usize {
            return None;
        }

        check_gav_chars(&raw)?;

        let mut split = raw.split('@');
        let raw0 = split.next()?;
        let (extension_len, strip_jar) = match split.next() {
            Some(s) if s == "jar" => (None, true),
            Some(s) => (Some(NonZero::new(s.len() as _)?), false),
            None => (None, false),
        };

        if split.next().is_some() {
            return None;
        }

        let mut split = raw0.split(':');
        let group_len = NonZero::new(split.next()?.len() as _)?;
        let artifact_len = NonZero::new(split.next()?.len() as _)?;
        let version_len = NonZero::new(split.next()?.len() as _)?;
        let classifier_len = match split.next() {
            Some(s) => Some(NonZero::new(s.len() as _)?),
            None => None,
        };

        if split.next().is_some() {
            return None;
        }

        let mut raw = raw.into_owned();
        if strip_jar {
            raw.truncate(raw.len() - "@jar".len());
        }

        Some(Self {
            raw: raw.into_boxed_str(),
            group_len,
            artifact_len,
            version_len,
            classifier_len,
            extension_len,
        })

    }

    #[inline]
    fn group_range(&self) -> Range<usize> {
        0..self.group_len.get() as usize
    }

    #[inline]
    fn artifact_range(&self) -> Range<usize> {
        let prev = self.group_range();
        prev.end + 1..prev.end + 1 + self.artifact_len.get() as usize
    }

    #[inline]
    fn version_range(&self) -> Range<usize> {
        let prev = self.artifact_range();
        prev.end + 1..prev.end + 1 + self.version_len.get() as usize
    }

    #[inline]
    fn classifier_range(&self) -> Range<usize> {
        let prev = self.version_range();
        match self.classifier_len {
            Some(classifier_len) => prev.end + 1..prev.end + 1 + classifier_len.get() as usize,
            None => prev.end..prev.end
        }
    }

    #[inline]
    fn extension_range(&self) -> Range<usize> {
        let prev = self.classifier_range();
        match self.extension_len {
            Some(extension_len) => prev.end + 1..prev.end + 1 + extension_len.get() as usize,
            None => prev.end..prev.end
        }
    }

    #[inline]
    pub fn group(&self) -> &str {
        &self.raw[self.group_range()]
    }

    #[inline]
    pub fn with_group(&self, group: &str) -> Option<Self> {
        Self::new(group, self.artifact(), self.version(), self.classifier(), Some(self.extension()))
    }

    #[inline]
    pub fn artifact(&self) -> &str {
        &self.raw[self.artifact_range()]
    }

    #[inline]
    pub fn with_artifact(&self, artifact: &str) -> Option<Self> {
        Self::new(self.group(), artifact, self.version(), self.classifier(), Some(self.extension()))
    }

    #[inline]
    pub fn version(&self) -> &str {
        &self.raw[self.version_range()]
    }

    #[inline]
    pub fn with_version(&self, version: &str) -> Option<Self> {
        Self::new(self.group(), self.artifact(), version, self.classifier(), Some(self.extension()))
    }

    #[inline]
    pub fn classifier(&self) -> Option<&str> {
        let range = self.classifier_range();
        if range.is_empty() {
            None
        } else {
            Some(&self.raw[self.classifier_range()])
        }
    }

    #[inline]
    pub fn with_classifier(&self, classifier: Option<&str>) -> Option<Self> {
        Self::new(self.group(), self.artifact(), self.version(), classifier, Some(self.extension()))
    }

    #[inline]
    pub fn extension(&self) -> &str {
        let range = self.extension_range();
        if range.is_empty() {
            "jar"
        } else {
            &self.raw[range]
        }
    }

    #[inline]
    pub fn with_extension(&self, extension: Option<&str>) -> Option<Self> {
        Self::new(self.group(), self.artifact(), self.version(), self.classifier(), extension)
    }

    #[inline]
    pub fn as_str(&self) -> &str {
        &self.raw
    }

    #[inline]
    pub fn url(&self) -> GavUrl<'_> {
        GavUrl(self)
    }

    pub fn file(&self) -> PathBuf {

        let len = 
            self.group_len.get() as usize + 1 + 
            self.artifact_len.get() as usize + 1 + 
            self.version_len.get() as usize + 1 +
            self.artifact_len.get() as usize + 1 +
            self.version_len.get() as usize +
            self.classifier_len.map(|len| 1 + len.get() as usize).unwrap_or(0) + 1 +
            self.extension().len();
        
        let mut buf = PathBuf::with_capacity(len);

        for group_part in self.group().split('.') {
            buf.push(group_part);
        }

        let artifact = self.artifact();
        let version = self.version();
        buf.push(artifact);
        buf.push(version);

        buf.push(artifact);
        buf.as_mut_os_string().push("-");
        buf.as_mut_os_string().push(version);
        if let Some(classifier) = self.classifier() {
            buf.as_mut_os_string().push("-");
            buf.as_mut_os_string().push(classifier);
        }
        buf.as_mut_os_string().push(".");
        buf.as_mut_os_string().push(self.extension());

        debug_assert_eq!(buf.as_os_str().len(), len);

        buf

    }

}

impl FromStr for Gav {
    
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::_from_str(Cow::Borrowed(s)).ok_or(())
    }

}

impl PartialEq for Gav {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Eq for Gav { }

impl PartialOrd for Gav {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Gav {
    fn cmp(&self, other: &Self) -> Ordering {
        self.as_str().cmp(other.as_str())
    }
}

impl hash::Hash for Gav {
    fn hash<H: hash::Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

impl fmt::Display for Gav {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for Gav {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Gav").field(&self.raw).finish()
    }
}

impl<'de> serde::Deserialize<'de> for Gav {

    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {

        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            
            type Value = Gav;
        
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                write!(formatter, "a string gav (group:artifact:version[:classifier][@extension])")
            }

            fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error, 
            {
                Gav::_from_str(Cow::Owned(v))
                    .ok_or_else(|| E::custom("invalid string gav (group:artifact:version[:classifier][@extension])"))
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error, 
            {
                Gav::_from_str(Cow::Borrowed(v))
                    .ok_or_else(|| E::custom("invalid string gav (group:artifact:version[:classifier][@extension])"))
            }

        }

        deserializer.deserialize_string(Visitor)

    }

}

impl serde::Serialize for Gav {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer
    {
        serializer.serialize_str(self.as_str())
    }
}

pub struct GavUrl<'a>(&'a Gav);

impl fmt::Display for GavUrl<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {

        for group_part in self.0.group().split('.') {
            f.write_str(group_part)?;
            f.write_str("/")?;
        }
        
        let artifact = self.0.artifact();
        let version = self.0.version();

        f.write_str(artifact)?;
        f.write_str("/")?;
        f.write_str(version)?;
        f.write_str("/")?;
        f.write_str(artifact)?;
        f.write_str("-")?;
        f.write_str(version)?;

        if let Some(classifier) = self.0.classifier() {
            f.write_str("-")?;
            f.write_str(classifier)?;
        }

        f.write_str(".")?;
        f.write_str(self.0.extension())

    }
}

fn check_gav_chars(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    (0..bytes.len())
        .all(|i| 
            bytes[i].is_ascii_alphanumeric() || 
            matches!(bytes[i], b'-' | b'_' | b'+' | b':' | b'@' | b'*') || 
            (bytes[i] == b'.' && (i == 0 || bytes[i - 1] != b'.')))
        .then_some(s)
}

#[derive(Debug)]
pub(crate) struct MetadataParser<'a> {
    tokenizer: Option<xmlparser::Tokenizer<'a>>,
}

impl<'a> MetadataParser<'a> {

    pub fn new(buffer: &'a str) -> Self {
        Self {
            tokenizer: Some(xmlparser::Tokenizer::from(buffer)),
        }
    }

}

impl<'a> Iterator for MetadataParser<'a> {

    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {

        use xmlparser::{Token, ElementEnd};

        let tokenizer = self.tokenizer.as_mut()?;
        let mut version = false;

        while let Ok(token) = tokenizer.next()? {

            match token {
                Token::ElementStart { prefix, local, .. } => {
                    if prefix.is_empty() && local == "version" {
                        if !version {
                            version = true;
                        } else {
                            break;  
                        }
                    } else if version {
                        break;  
                    }
                }
                Token::ElementEnd { end: ElementEnd::Close(prefix, local), .. } => {
                    if version {
                        if prefix.is_empty() && local == "version" {
                            version = false;
                        } else {
                            break;  
                        }
                    }
                }
                Token::ElementEnd { end: ElementEnd::Empty, .. } => {
                    if version {
                        break;  
                    }
                }
                Token::Text { text } => {
                    if version {
                        return Some(text.as_str());
                    }
                }
                _ => continue,
            }

        }

        self.tokenizer = None;
        None

    }
    
}

impl FusedIterator for MetadataParser<'_> {  }


#[cfg(test)]
mod tests {

    use std::str::FromStr;
    use super::Gav;

    #[test]
    fn empty_parts() {
        assert!(Gav::new("", "baz", "0.1.2-beta", None, None).is_none());
        assert!(Gav::new("foo.bar", "", "0.1.2-beta", None, None).is_none());
        assert!(Gav::new("foo.bar", "baz", "", None, None).is_none());
        assert!(Gav::new("foo.bar", "baz", "0.1.2-beta", Some(""), None).is_none());
        assert!(Gav::new("foo.bar", "baz", "0.1.2-beta", None, Some("")).is_none());
    }

    #[test]
    fn invalid_chars() {
        assert!(Gav::new("foo..bar", "baz", "0.1.2-beta", None, None).is_none());
        assert!(Gav::new("foo.bar", "/baz", "0.1.2-beta", None, None).is_none());
        assert!(Gav::new("foo.bar", "baz", "!0.1.2-beta", None, None).is_none());
    }

    #[test]
    fn file_debug_assert() {
        Gav::new("foo.bar", "baz", "0.1.2-beta", None, None).unwrap().file();
        Gav::new("foo.bar", "baz", "0.1.2-beta", Some("natives"), None).unwrap().file();
        Gav::new("foo.bar", "baz", "0.1.2-beta", None, Some("jar")).unwrap().file();
        Gav::new("foo.bar", "baz", "0.1.2-beta", Some("natives"), Some("jar")).unwrap().file();
    }

    #[test]
    fn as_str_correct() {
        assert_eq!(Gav::new("foo.bar", "baz", "0.1.2-beta", None, None).unwrap().as_str(), "foo.bar:baz:0.1.2-beta");
        assert_eq!(Gav::new("foo.bar", "baz", "0.1.2-beta", Some("natives"), None).unwrap().as_str(), "foo.bar:baz:0.1.2-beta:natives");
        assert_eq!(Gav::new("foo.bar", "baz", "0.1.2-beta", None, Some("jar")).unwrap().as_str(), "foo.bar:baz:0.1.2-beta");
        assert_eq!(Gav::new("foo.bar", "baz", "0.1.2-beta", Some("natives"), Some("jar")).unwrap().as_str(), "foo.bar:baz:0.1.2-beta:natives");
        assert_eq!(Gav::new("foo.bar_ok", "baz", "0.1.2+beta", None, None).unwrap().as_str(), "foo.bar_ok:baz:0.1.2+beta");
    }

    #[test]
    fn from_str_correct() {

        const WRONG_CASES: &'static [&'static str] = &[
            "", ":", "::",
            "foo.bar::", ":baz:", "::0.1.2-beta",
            "foo.bar:baz:", "foo.bar::0.1.2-beta", ":baz:0.1.2-beta",
            "foo.bar:baz:0.1.2-beta:",
            "foo.bar:baz:0.1.2-beta@",
        ];

        for case in WRONG_CASES {
            assert_eq!(Gav::from_str(case), Err(()));
        }

        let gav = Gav::from_str("foo.bar:baz:0.1.2-beta").unwrap();
        assert_eq!(gav.group(), "foo.bar");
        assert_eq!(gav.artifact(), "baz");
        assert_eq!(gav.version(), "0.1.2-beta");
        assert_eq!(gav.classifier(), None);
        assert_eq!(gav.extension(), "jar");

        let gav = Gav::from_str("foo.bar:baz:0.1.2-beta:natives@txt").unwrap();
        assert_eq!(gav.group(), "foo.bar");
        assert_eq!(gav.artifact(), "baz");
        assert_eq!(gav.version(), "0.1.2-beta");
        assert_eq!(gav.classifier(), Some("natives"));
        assert_eq!(gav.extension(), "txt");

    }

    #[test]
    fn modify() {

        let gav = Gav::from_str("foo.bar:baz:0.1.2-beta").unwrap();
        assert_eq!(gav.with_group("foo1.bar2").unwrap().as_str(), "foo1.bar2:baz:0.1.2-beta");
        assert_eq!(gav.with_artifact("baz1").unwrap().as_str(), "foo.bar:baz1:0.1.2-beta");
        assert_eq!(gav.with_version("0.1.3-alpha").unwrap().as_str(), "foo.bar:baz:0.1.3-alpha");
        assert_eq!(gav.with_classifier(Some("natives")).unwrap().as_str(), "foo.bar:baz:0.1.2-beta:natives");
        assert_eq!(gav.with_extension(Some("txt")).unwrap().as_str(), "foo.bar:baz:0.1.2-beta@txt");

    }

    #[test]
    fn canonicalized() {
        assert_eq!(Gav::from_str("foo.bar:baz:0.1.2-beta").unwrap(), Gav::from_str("foo.bar:baz:0.1.2-beta@jar").unwrap());
    }

}

#[cfg(test)]
mod gav_more {

    use std::path::PathBuf;
    use std::str::FromStr;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use super::Gav;

    fn p(parts: &[&str]) -> PathBuf {
        PathBuf::from(parts.join(std::path::MAIN_SEPARATOR_STR))
    }

    #[test]
    fn file_plain() {
        let gav = Gav::from_str("net.fabricmc:fabric-loader:0.16.0").unwrap();
        assert_eq!(
            gav.file(),
            p(&["net", "fabricmc", "fabric-loader", "0.16.0", "fabric-loader-0.16.0.jar"])
        );
    }

    #[test]
    fn file_with_classifier() {
        let gav = Gav::from_str("org.lwjgl:lwjgl:3.3.3:natives-macos").unwrap();
        assert_eq!(
            gav.file(),
            p(&["org", "lwjgl", "lwjgl", "3.3.3", "lwjgl-3.3.3-natives-macos.jar"])
        );
    }

    #[test]
    fn file_with_extension() {
        let gav = Gav::from_str("com.example:thing:1.0@txt").unwrap();
        assert_eq!(gav.file(), p(&["com", "example", "thing", "1.0", "thing-1.0.txt"]));
    }

    #[test]
    fn file_with_classifier_and_extension() {
        let gav = Gav::from_str("com.example:thing:1.0:data@zip").unwrap();
        assert_eq!(
            gav.file(),
            p(&["com", "example", "thing", "1.0", "thing-1.0-data.zip"])
        );
    }

    #[test]
    fn file_single_group_segment() {
        let gav = Gav::from_str("foo:bar:1").unwrap();
        assert_eq!(gav.file(), p(&["foo", "bar", "1", "bar-1.jar"]));
    }

    #[test]
    fn url_plain() {
        let gav = Gav::from_str("net.fabricmc:fabric-loader:0.16.0").unwrap();
        assert_eq!(
            gav.url().to_string(),
            "net/fabricmc/fabric-loader/0.16.0/fabric-loader-0.16.0.jar"
        );
    }

    #[test]
    fn url_with_classifier() {
        let gav = Gav::from_str("org.lwjgl:lwjgl:3.3.3:natives-macos").unwrap();
        assert_eq!(
            gav.url().to_string(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-macos.jar"
        );
    }

    #[test]
    fn url_with_extension() {
        let gav = Gav::from_str("com.example:thing:1.0@txt").unwrap();
        assert_eq!(gav.url().to_string(), "com/example/thing/1.0/thing-1.0.txt");
    }

    #[test]
    fn url_uses_forward_slashes_always() {
        let gav = Gav::from_str("a.b.c.d:e:1.2.3").unwrap();
        assert_eq!(gav.url().to_string(), "a/b/c/d/e/1.2.3/e-1.2.3.jar");
    }

    #[test]
    fn accessors() {
        let gav = Gav::from_str("a.b:c:1.0:cls@ext").unwrap();
        assert_eq!(gav.group(), "a.b");
        assert_eq!(gav.artifact(), "c");
        assert_eq!(gav.version(), "1.0");
        assert_eq!(gav.classifier(), Some("cls"));
        assert_eq!(gav.extension(), "ext");
        assert_eq!(gav.as_str(), "a.b:c:1.0:cls@ext");
    }

    #[test]
    fn default_extension_is_jar() {
        let gav = Gav::from_str("a.b:c:1.0").unwrap();
        assert_eq!(gav.extension(), "jar");
        assert_eq!(gav.classifier(), None);
    }

    #[test]
    fn jar_extension_is_stripped_from_raw() {
        let gav = Gav::from_str("a.b:c:1.0@jar").unwrap();
        assert_eq!(gav.as_str(), "a.b:c:1.0");
        assert_eq!(gav.extension(), "jar");
    }

    #[test]
    fn equality_ignores_explicit_jar() {
        let a = Gav::from_str("a.b:c:1.0").unwrap();
        let b = Gav::from_str("a.b:c:1.0@jar").unwrap();
        assert_eq!(a, b);
        let mut ha = DefaultHasher::new();
        let mut hb = DefaultHasher::new();
        a.hash(&mut ha);
        b.hash(&mut hb);
        assert_eq!(ha.finish(), hb.finish());
    }

    #[test]
    fn ordering_is_by_string() {
        let a = Gav::from_str("a:a:1").unwrap();
        let b = Gav::from_str("a:b:1").unwrap();
        let c = Gav::from_str("b:a:1").unwrap();
        assert!(a < b);
        assert!(b < c);
        let mut v = vec![c.clone(), a.clone(), b.clone()];
        v.sort();
        assert_eq!(v, vec![a, b, c]);
    }

    #[test]
    fn with_methods_preserve_other_parts() {
        let gav = Gav::from_str("a.b:c:1.0:cls@ext").unwrap();
        assert_eq!(gav.with_group("x.y").unwrap().as_str(), "x.y:c:1.0:cls@ext");
        assert_eq!(gav.with_artifact("z").unwrap().as_str(), "a.b:z:1.0:cls@ext");
        assert_eq!(gav.with_version("2.0").unwrap().as_str(), "a.b:c:2.0:cls@ext");
        assert_eq!(
            gav.with_classifier(None).unwrap().as_str(),
            "a.b:c:1.0@ext"
        );
        assert_eq!(
            gav.with_classifier(Some("other")).unwrap().as_str(),
            "a.b:c:1.0:other@ext"
        );
    }

    #[test]
    fn with_extension_none_and_jar_drop_suffix() {
        let gav = Gav::from_str("a.b:c:1.0@ext").unwrap();
        assert_eq!(gav.with_extension(None).unwrap().as_str(), "a.b:c:1.0");
        assert_eq!(gav.with_extension(Some("jar")).unwrap().as_str(), "a.b:c:1.0");
        assert_eq!(gav.with_extension(Some("zip")).unwrap().as_str(), "a.b:c:1.0@zip");
    }

    #[test]
    fn new_matches_from_str() {
        let made = Gav::new("a.b", "c", "1.0", Some("cls"), Some("ext")).unwrap();
        let parsed = Gav::from_str("a.b:c:1.0:cls@ext").unwrap();
        assert_eq!(made, parsed);
    }

    #[test]
    fn new_rejects_empty_and_bad_chars() {
        assert!(Gav::new("", "c", "1", None, None).is_none());
        assert!(Gav::new("a", "", "1", None, None).is_none());
        assert!(Gav::new("a", "c", "", None, None).is_none());
        assert!(Gav::new("a..b", "c", "1", None, None).is_none());
        assert!(Gav::new("a", "c/d", "1", None, None).is_none());
        assert!(Gav::new("a", "c", "1 0", None, None).is_none());
    }

    #[test]
    fn from_str_rejects_extra_separators() {
        assert!(Gav::from_str("a:b:c:d:e").is_err());
        assert!(Gav::from_str("a:b:c@d@e").is_err());
        assert!(Gav::from_str("a:b:c:").is_err());
        assert!(Gav::from_str("a:b:c@").is_err());
    }

    #[test]
    fn allows_plus_and_star_and_underscore() {
        assert!(Gav::from_str("a_b:c:1.0+build").is_ok());
        assert!(Gav::from_str("a.b:c:*").is_ok());
    }

    #[test]
    fn serde_roundtrip() {
        let gav = Gav::from_str("a.b:c:1.0:cls@ext").unwrap();
        let json = serde_json::to_string(&gav).unwrap();
        assert_eq!(json, "\"a.b:c:1.0:cls@ext\"");
        let back: Gav = serde_json::from_str(&json).unwrap();
        assert_eq!(back, gav);
    }

    #[test]
    fn serde_rejects_garbage() {
        let bad: Result<Gav, _> = serde_json::from_str("\"not a gav\"");
        assert!(bad.is_err());
    }

    #[test]
    fn display_is_as_str() {
        let gav = Gav::from_str("a.b:c:1.0").unwrap();
        assert_eq!(format!("{gav}"), "a.b:c:1.0");
    }

    #[test]
    fn url_with_classifier_and_extension() {
        let gav = Gav::from_str("a.b:c:1.0:linux@tar.gz").unwrap();
        assert_eq!(gav.url().to_string(), "a/b/c/1.0/c-1.0-linux.tar.gz");
    }

    #[test]
    fn file_deep_group() {
        let gav = Gav::from_str("com.mojang.brigadier:lib:1.2.3").unwrap();
        assert_eq!(
            gav.file(),
            p(&["com", "mojang", "brigadier", "lib", "1.2.3", "lib-1.2.3.jar"])
        );
    }

    #[test]
    fn hashset_dedups_equal_gavs() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(Gav::from_str("a:b:1").unwrap());
        set.insert(Gav::from_str("a:b:1@jar").unwrap());
        set.insert(Gav::from_str("a:b:2").unwrap());
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn serde_vec_roundtrip() {
        let gavs = vec![
            Gav::from_str("a:b:1").unwrap(),
            Gav::from_str("c.d:e:2.0:cls").unwrap(),
        ];
        let json = serde_json::to_string(&gavs).unwrap();
        assert_eq!(json, "[\"a:b:1\",\"c.d:e:2.0:cls\"]");
        let back: Vec<Gav> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, gavs);
    }

    #[test]
    fn sort_orders_by_string() {
        let mut gavs = vec![
            Gav::from_str("z:z:1").unwrap(),
            Gav::from_str("a:b:2").unwrap(),
            Gav::from_str("a:b:1").unwrap(),
        ];
        gavs.sort();
        let as_strings: Vec<&str> = gavs.iter().map(|g| g.as_str()).collect();
        assert_eq!(as_strings, vec!["a:b:1", "a:b:2", "z:z:1"]);
    }

    #[test]
    fn with_chains_preserve_value() {
        let gav = Gav::from_str("a:b:1").unwrap();
        let chained = gav
            .with_group("x.y")
            .unwrap()
            .with_version("9.9")
            .unwrap()
            .with_classifier(Some("native"))
            .unwrap();
        assert_eq!(chained.as_str(), "x.y:b:9.9:native");
        assert_eq!(chained.group(), "x.y");
        assert_eq!(chained.version(), "9.9");
        assert_eq!(chained.classifier(), Some("native"));
    }

    #[test]
    fn extension_jar_is_default_after_clearing() {
        let gav = Gav::from_str("a:b:1@zip").unwrap();
        let cleared = gav.with_extension(None).unwrap();
        assert_eq!(cleared.extension(), "jar");
        assert_eq!(cleared.as_str(), "a:b:1");
    }

    #[test]
    fn classifier_none_yields_no_classifier() {
        let gav = Gav::from_str("a:b:1").unwrap();
        assert_eq!(gav.classifier(), None);
        let with = gav.with_classifier(Some("x")).unwrap();
        assert_eq!(with.classifier(), Some("x"));
        let without = with.with_classifier(None).unwrap();
        assert_eq!(without.classifier(), None);
    }
}
