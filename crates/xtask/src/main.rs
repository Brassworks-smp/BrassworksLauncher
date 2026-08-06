use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const WORKSPACE_PACKAGES: &[&str] = &[
    "brassworks-core",
    "brassworks-launcher",
    "java",
    "packwiz",
    "portablemc",
];

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 2 || args[0] != "bump-version" {
        return Err(
            "usage: cargo bump-version <major|minor|patch|version> (example: cargo bump-version patch)"
                .into(),
        );
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "could not locate the workspace root".to_string())?;
    let cargo_toml = read(root.join("Cargo.toml"))?;
    let old_version = workspace_version(&cargo_toml)?;
    let version = resolve_version(&old_version, &args[1])?;

    let updates = [
        (
            root.join("Cargo.toml"),
            replace_workspace_version(&cargo_toml, &version)?,
        ),
        (
            root.join("frontend/package.json"),
            replace_json_version(&read(root.join("frontend/package.json"))?, &version)?,
        ),
        (
            root.join("frontend/src-tauri/tauri.conf.json"),
            replace_json_version(
                &read(root.join("frontend/src-tauri/tauri.conf.json"))?,
                &version,
            )?,
        ),
        (
            root.join("changelog.md"),
            replace_changelog_version(&read(root.join("changelog.md"))?, &version),
        ),
        (
            root.join("Cargo.lock"),
            replace_lock_versions(&read(root.join("Cargo.lock"))?, &version)?,
        ),
    ];

    for (path, contents) in updates {
        fs::write(&path, contents).map_err(|error| format!("write {}: {error}", path.display()))?;
    }
    println!("Bumped Brassworks Launcher from {old_version} to {version}.");
    println!("Run the build checks, review the diff, and commit the release bump.");
    Ok(())
}

fn read(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("read {}: {error}", path.display()))
}

fn validate_version(version: &str) -> Result<(), String> {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<_> = core.split('.').collect();
    let suffix_valid = version
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+'));
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()))
        || !suffix_valid
    {
        return Err(format!("'{version}' is not a valid semantic version"));
    }
    Ok(())
}

fn resolve_version(current: &str, requested: &str) -> Result<String, String> {
    if !matches!(requested, "major" | "minor" | "patch") {
        validate_version(requested)?;
        return Ok(requested.to_string());
    }
    validate_version(current)?;
    let core = current.split(['-', '+']).next().unwrap_or_default();
    let mut parts = core
        .split('.')
        .map(|part| part.parse::<u64>().map_err(|error| error.to_string()));
    let major = parts.next().unwrap()?;
    let minor = parts.next().unwrap()?;
    let patch = parts.next().unwrap()?;
    match requested {
        "major" => major.checked_add(1).map(|value| format!("{value}.0.0")),
        "minor" => minor
            .checked_add(1)
            .map(|value| format!("{major}.{value}.0")),
        "patch" => patch
            .checked_add(1)
            .map(|value| format!("{major}.{minor}.{value}")),
        _ => unreachable!(),
    }
    .ok_or_else(|| format!("cannot bump {requested} version beyond u64::MAX"))
}

fn workspace_version(contents: &str) -> Result<String, String> {
    let section = section(contents, "[workspace.package]")?;
    version_value(section, "version = \"")
}

fn replace_workspace_version(contents: &str, version: &str) -> Result<String, String> {
    replace_version_in_section(contents, "[workspace.package]", "version = \"", version)
}

fn replace_json_version(contents: &str, version: &str) -> Result<String, String> {
    replace_first_version(contents, "\"version\": \"", version)
}

fn replace_changelog_version(contents: &str, version: &str) -> String {
    match contents.split_once('\n') {
        Some((first, rest)) if first.starts_with("# ") => format!("# {version}\n{rest}"),
        _ => format!("# {version}\n\n{contents}"),
    }
}

fn replace_lock_versions(contents: &str, version: &str) -> Result<String, String> {
    let mut output = contents.to_string();
    for package in WORKSPACE_PACKAGES {
        let marker = format!("[[package]]\nname = \"{package}\"\n");
        let start = output
            .find(&marker)
            .ok_or_else(|| format!("Cargo.lock does not contain workspace package '{package}'"))?;
        let tail = start + marker.len();
        let relative = output[tail..]
            .find("version = \"")
            .ok_or_else(|| format!("Cargo.lock package '{package}' has no version"))?;
        let version_start = tail + relative + "version = \"".len();
        let version_end = output[version_start..]
            .find('"')
            .map(|offset| version_start + offset)
            .ok_or_else(|| format!("Cargo.lock package '{package}' has an invalid version"))?;
        output.replace_range(version_start..version_end, version);
    }
    Ok(output)
}

fn section<'a>(contents: &'a str, heading: &str) -> Result<&'a str, String> {
    let start = contents
        .find(heading)
        .ok_or_else(|| format!("missing {heading} section"))?;
    let body_start = start + heading.len();
    let end = contents[body_start..]
        .find("\n[")
        .map(|offset| body_start + offset)
        .unwrap_or(contents.len());
    Ok(&contents[body_start..end])
}

fn replace_version_in_section(
    contents: &str,
    heading: &str,
    prefix: &str,
    version: &str,
) -> Result<String, String> {
    let selected = section(contents, heading)?;
    let replaced = replace_first_version(selected, prefix, version)?;
    let start = selected.as_ptr() as usize - contents.as_ptr() as usize;
    let mut output = contents.to_string();
    output.replace_range(start..start + selected.len(), &replaced);
    Ok(output)
}

fn replace_first_version(contents: &str, prefix: &str, version: &str) -> Result<String, String> {
    let prefix_start = contents
        .find(prefix)
        .ok_or_else(|| format!("missing version field '{prefix}'"))?;
    let value_start = prefix_start + prefix.len();
    let value_end = contents[value_start..]
        .find('"')
        .map(|offset| value_start + offset)
        .ok_or_else(|| "unterminated version field".to_string())?;
    let mut output = contents.to_string();
    output.replace_range(value_start..value_end, version);
    Ok(output)
}

fn version_value(contents: &str, prefix: &str) -> Result<String, String> {
    let start = contents
        .find(prefix)
        .map(|offset| offset + prefix.len())
        .ok_or_else(|| "missing workspace version".to_string())?;
    let end = contents[start..]
        .find('"')
        .map(|offset| start + offset)
        .ok_or_else(|| "unterminated workspace version".to_string())?;
    Ok(contents[start..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_semantic_versions() {
        assert!(validate_version("1.2.3").is_ok());
        assert!(validate_version("1.2.3-beta.1+build.4").is_ok());
        assert!(validate_version("1.2").is_err());
        assert!(validate_version("v1.2.3").is_err());
    }

    #[test]
    fn resolves_exact_and_relative_versions() {
        assert_eq!(resolve_version("1.2.3", "patch").unwrap(), "1.2.4");
        assert_eq!(resolve_version("1.2.3", "minor").unwrap(), "1.3.0");
        assert_eq!(resolve_version("1.2.3", "major").unwrap(), "2.0.0");
        assert_eq!(resolve_version("1.2.3", "4.5.6").unwrap(), "4.5.6");
    }

    #[test]
    fn updates_only_the_workspace_version() {
        let input =
            "[workspace.package]\nversion = \"0.9.0\"\n\n[dependencies]\nthing = \"1.0.0\"\n";
        let output = replace_workspace_version(input, "0.10.0").unwrap();
        assert!(output.contains("version = \"0.10.0\""));
        assert!(output.contains("thing = \"1.0.0\""));
    }

    #[test]
    fn updates_workspace_packages_without_touching_dependencies() {
        let input = "[[package]]\nname = \"brassworks-core\"\nversion = \"0.9.0\"\n\n[[package]]\nname = \"brassworks-launcher\"\nversion = \"0.9.0\"\n\n[[package]]\nname = \"java\"\nversion = \"0.9.0\"\n\n[[package]]\nname = \"packwiz\"\nversion = \"0.9.0\"\n\n[[package]]\nname = \"portablemc\"\nversion = \"0.9.0\"\n\n[[package]]\nname = \"dependency\"\nversion = \"0.9.0\"\n";
        let output = replace_lock_versions(input, "0.10.0").unwrap();
        assert_eq!(output.matches("version = \"0.10.0\"").count(), 5);
        assert!(output.contains("name = \"dependency\"\nversion = \"0.9.0\""));
    }
}
