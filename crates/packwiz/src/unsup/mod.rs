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
pub use signing::{
    generate_key_id, generate_seed, insecure_hashes, public_key_spec, sign, PublicKey, SignFormat,
};

pub const SUPPORTED_UNSUP: &str = "1.2.5";
