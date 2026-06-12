mod model;
mod resolve;
pub mod signing;

pub use model::{
    Choices, FlavorChoice, FlavorGroup, RawChoice, RawFlavorGroup, RawMetafile, StringOrVec,
    UnsupToml,
};
pub use resolve::{
    detect, keep_metafile, metafile_flavors_one, resolve, MetafileRef, Resolution,
};
pub use signing::{insecure_hashes, PublicKey};

pub const SUPPORTED_UNSUP: &str = "1.2.5";
