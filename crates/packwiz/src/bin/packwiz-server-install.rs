//! Standalone packwiz installer for game servers.
//!
//! Point it at a `pack.toml` URL and it syncs the modpack into a directory,
//! defaulting to server-side files. Meant to be dropped into a server start
//! script the same way you'd use the upstream `packwiz-installer`:
//!
//! ```sh
//! packwiz-server-install https://example.com/pack.toml
//! ```

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::ExitCode;

use packwiz::{Installer, Side, SyncOptions, SyncProgress, SyncStage};

const USAGE: &str = "\
packwiz-server-install — install a packwiz modpack into a directory

USAGE:
    packwiz-server-install [OPTIONS] <PACK_URL>

ARGS:
    <PACK_URL>              URL (or local path) to the pack.toml

OPTIONS:
    -d, --dir <DIR>        Install directory (default: current directory)
    -s, --side <SIDE>      client | server | both (default: server)
    -m, --manifest <PATH>  Manifest/lock file path (default: <DIR>/packwiz.json)
    -f, --force            Reinstall even if already up to date
    -x, --exclude <LIST>   Comma-separated mods/files to leave out (repeatable).
                           Matches a metafile path, filename, mod name, or their
                           basename/stem, e.g. --exclude sodium,mods/badmod.pw.toml
        --unsup            Process an unsup pack (flavored optional groups)
        --flavor <NAME>    Select an unsup flavor (repeatable)
        --public-key <K>   unsup public key for signature verification
    -q, --quiet            Only print errors
    -h, --help             Print this help
";

struct Args {
    pack_url: String,
    dir: PathBuf,
    side: Side,
    manifest: Option<PathBuf>,
    force: bool,
    unsup: bool,
    flavors: HashSet<String>,
    exclude: Vec<String>,
    public_key: Option<String>,
    quiet: bool,
}

fn parse_side(s: &str) -> Result<Side, String> {
    match s.to_ascii_lowercase().as_str() {
        "server" => Ok(Side::Server),
        "client" => Ok(Side::Client),
        "both" => Ok(Side::Both),
        other => Err(format!("unknown side '{other}' (expected client, server, or both)")),
    }
}

fn parse_args() -> Result<Args, String> {
    let mut pack_url: Option<String> = None;
    let mut dir: Option<PathBuf> = None;
    let mut side = Side::Server;
    let mut manifest: Option<PathBuf> = None;
    let mut force = false;
    let mut unsup = false;
    let mut flavors = HashSet::new();
    let mut exclude: Vec<String> = Vec::new();
    let mut public_key = None;
    let mut quiet = false;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut take = |name: &str| -> Result<String, String> {
            args.next().ok_or_else(|| format!("{name} requires a value"))
        };
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{USAGE}");
                std::process::exit(0);
            }
            "-d" | "--dir" => dir = Some(PathBuf::from(take("--dir")?)),
            "-s" | "--side" => side = parse_side(&take("--side")?)?,
            "-m" | "--manifest" => manifest = Some(PathBuf::from(take("--manifest")?)),
            "-f" | "--force" => force = true,
            "-x" | "--exclude" => {
                for item in take("--exclude")?.split(',') {
                    let item = item.trim();
                    if !item.is_empty() {
                        exclude.push(item.to_string());
                    }
                }
            }
            "--unsup" => unsup = true,
            "--flavor" => {
                flavors.insert(take("--flavor")?);
            }
            "--public-key" => public_key = Some(take("--public-key")?),
            "-q" | "--quiet" => quiet = true,
            other if other.starts_with('-') && other != "-" => {
                return Err(format!("unknown option '{other}'"));
            }
            _ => {
                if pack_url.replace(arg).is_some() {
                    return Err("more than one pack URL given".to_string());
                }
            }
        }
    }

    Ok(Args {
        pack_url: pack_url.ok_or("missing <PACK_URL>")?,
        dir: dir.unwrap_or_else(|| PathBuf::from(".")),
        side,
        manifest,
        force,
        unsup,
        flavors,
        exclude,
        public_key,
        quiet,
    })
}

fn run() -> Result<(), String> {
    let args = parse_args()?;

    std::fs::create_dir_all(&args.dir)
        .map_err(|e| format!("cannot create install dir {}: {e}", args.dir.display()))?;

    let manifest_path = args
        .manifest
        .clone()
        .unwrap_or_else(|| args.dir.join("packwiz.json"));

    let mut opts = SyncOptions::new(args.pack_url.clone(), args.dir.clone(), manifest_path);
    opts.side = args.side;
    opts.unsup = args.unsup;
    opts.flavors = args.flavors;
    opts.exclude = args.exclude;
    opts.public_key = args.public_key;

    if !args.quiet {
        eprintln!("Installing {} into {}", args.pack_url, args.dir.display());
    }

    let quiet = args.quiet;
    let mut last_stage: Option<SyncStage> = None;
    let mut progress = |p: SyncProgress| {
        if quiet {
            return;
        }
        // Reprint on stage change, or on a fresh count within the same stage.
        let stage_changed = last_stage != Some(p.stage);
        last_stage = Some(p.stage);
        if p.total > 0 {
            eprintln!("[{:?}] {}/{} {}", p.stage, p.current, p.total, p.message);
        } else if stage_changed {
            eprintln!("[{:?}] {}", p.stage, p.message);
        }
    };

    let manifest = Installer::new()
        .sync(&opts, args.force, &|| false, &mut progress)
        .map_err(|e| e.to_string())?;

    if !quiet {
        eprintln!("Done — {} files managed.", manifest.mods.len());
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("error: {msg}");
            ExitCode::FAILURE
        }
    }
}
