use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};

use crate::error::{PackwizError, Result};

pub const INSECURE_HASHES: [&str; 3] = ["md5", "sha1", "murmur2"];

#[derive(Debug, Clone)]
pub enum PublicKey {
        Ed25519(VerifyingKey),
        Signify { key_id: u64, key: VerifyingKey },
}

impl PublicKey {
            pub fn parse(spec: &str) -> Result<Self> {
        let (kind, b64) = spec
            .trim()
            .split_once(char::is_whitespace)
            .map(|(k, v)| (k, v.trim()))
            .ok_or_else(|| {
                PackwizError::Other(
                    "public key must be 'ed25519 <base64>' or 'signify <base64>'".into(),
                )
            })?;
        let data = b64decode(b64)?;
        match kind {
            "ed25519" => Ok(PublicKey::Ed25519(vk_from_slice(&data)?)),
            "signify" => {
                                if data.len() < 42 || &data[0..2] != b"Ed" {
                    return Err(PackwizError::Other(
                        "not a signify Ed25519 public key".into(),
                    ));
                }
                let key_id = u64::from_be_bytes(data[2..10].try_into().unwrap());
                Ok(PublicKey::Signify {
                    key_id,
                    key: vk_from_slice(&data[10..42])?,
                })
            }
            other => Err(PackwizError::Other(format!(
                "unknown public key type '{other}'"
            ))),
        }
    }

            pub fn verify(&self, data: &[u8], sig_file: &[u8]) -> bool {
        match self {
            PublicKey::Ed25519(key) => match sig_from_slice(sig_file) {
                Ok(sig) => key.verify_strict(data, &sig).is_ok(),
                Err(_) => false,
            },
            PublicKey::Signify { key_id, key } => {
                let Ok(text) = std::str::from_utf8(sig_file) else {
                    return false;
                };
                                let Some(line) = text.lines().nth(1) else {
                    return false;
                };
                let Ok(raw) = b64decode(line.trim()) else {
                    return false;
                };
                if raw.len() < 74 || &raw[0..2] != b"Ed" {
                    return false;
                }
                if u64::from_be_bytes(raw[2..10].try_into().unwrap()) != *key_id {
                    return false;
                }
                match sig_from_slice(&raw[10..74]) {
                    Ok(sig) => key.verify_strict(data, &sig).is_ok(),
                    Err(_) => false,
                }
            }
        }
    }
}

pub fn insecure_hashes<'a>(formats: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut found = std::collections::BTreeSet::new();
    for f in formats {
        let lf = f.to_lowercase();
        if INSECURE_HASHES.contains(&lf.as_str()) {
            found.insert(lf);
        }
    }
    found.into_iter().collect()
}

fn b64decode(s: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| PackwizError::Other(format!("invalid base64: {e}")))
}

fn vk_from_slice(bytes: &[u8]) -> Result<VerifyingKey> {
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| PackwizError::Other("ed25519 public key must be 32 bytes".into()))?;
    VerifyingKey::from_bytes(&arr)
        .map_err(|e| PackwizError::Other(format!("invalid ed25519 public key: {e}")))
}

fn sig_from_slice(bytes: &[u8]) -> Result<Signature> {
    let arr: [u8; 64] = bytes
        .try_into()
        .map_err(|_| PackwizError::Other("ed25519 signature must be 64 bytes".into()))?;
    Ok(Signature::from_bytes(&arr))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::RngCore;

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn gen_key() -> SigningKey {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        SigningKey::from_bytes(&seed)
    }

    #[test]
    fn ed25519_round_trip() {
        let sk = gen_key();
        let key = PublicKey::Ed25519(sk.verifying_key());
        let msg = b"pack.toml contents";
        let sig = sk.sign(msg).to_bytes();

        assert!(key.verify(msg, &sig));
        assert!(!key.verify(b"tampered", &sig), "wrong message rejected");
        let mut bad = sig;
        bad[0] ^= 0xFF;
        assert!(!key.verify(msg, &bad), "tampered signature rejected");
        assert!(!key.verify(msg, &sig[..63]), "short signature rejected");
    }

    #[test]
    fn signify_round_trip() {
        let sk = gen_key();
        let vk = sk.verifying_key();
        let key_id: u64 = 0x0102_0304_0506_0708;

                let mut pk = Vec::new();
        pk.extend_from_slice(b"Ed");
        pk.extend_from_slice(&key_id.to_be_bytes());
        pk.extend_from_slice(vk.as_bytes());
        let spec = format!("signify {}", b64(&pk));

        let msg = b"pack.toml contents";
        let mut sig_blob = Vec::new();
        sig_blob.extend_from_slice(b"Ed");
        sig_blob.extend_from_slice(&key_id.to_be_bytes());
        sig_blob.extend_from_slice(&sk.sign(msg).to_bytes());
        let sig_file = format!("untrusted comment: test\n{}\n", b64(&sig_blob));

        let parsed = PublicKey::parse(&spec).unwrap();
        assert!(parsed.verify(msg, sig_file.as_bytes()));
        assert!(!parsed.verify(b"tampered", sig_file.as_bytes()));

                let mut wrong = Vec::new();
        wrong.extend_from_slice(b"Ed");
        wrong.extend_from_slice(&0u64.to_be_bytes());
        wrong.extend_from_slice(&sk.sign(msg).to_bytes());
        let wrong_file = format!("untrusted comment: x\n{}\n", b64(&wrong));
        assert!(!parsed.verify(msg, wrong_file.as_bytes()), "wrong key id rejected");
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(PublicKey::parse("nonsense").is_err());
        assert!(PublicKey::parse("rsa AAAA").is_err());
        assert!(PublicKey::parse("ed25519 not-base64!!").is_err());
        assert!(PublicKey::parse("ed25519 QQ==").is_err(), "wrong key length");
    }

    #[test]
    fn flags_insecure_hashes() {
        let found = insecure_hashes(["sha256", "MD5", "murmur2", "sha512", "sha1"]);
        assert_eq!(found, vec!["md5", "murmur2", "sha1"]);
        assert!(insecure_hashes(["sha256", "sha512"]).is_empty());
    }

            #[test]
    #[ignore = "network: fetches Rewind Upsilon's pack.toml + unsup.sig"]
    fn verifies_real_signed_pack() {
        let base = "https://rewindmc.com/packwiz/upsilon/";
        let pack = reqwest::blocking::get(format!("{base}pack.toml"))
            .unwrap()
            .bytes()
            .unwrap();
        let sig = reqwest::blocking::get(format!("{base}unsup.sig"))
            .unwrap()
            .bytes()
            .unwrap();

                let key = PublicKey::parse(
            "signify RWRMdtXoEByibcnaB2iyFWE8g14yNd5Jp6XzXc/HgEE18baymXBMR4ak",
        )
        .unwrap();
        assert!(key.verify(&pack, &sig), "real signature should verify");

                let mut tampered = pack.to_vec();
        tampered.push(b'\n');
        assert!(!key.verify(&tampered, &sig));

                let other = gen_key();
        let mut pk = Vec::new();
        pk.extend_from_slice(b"Ed");
        pk.extend_from_slice(&0u64.to_be_bytes());
        pk.extend_from_slice(other.verifying_key().as_bytes());
        let wrong = PublicKey::parse(&format!("signify {}", b64(&pk))).unwrap();
        assert!(!wrong.verify(&pack, &sig));
    }
}
