//! Direct provider fallback used only when the shared schematic cache is rate limited.
//! Raw provider pages are cached locally so a throttled shared service does not turn
//! every launcher search into another request to the provider.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::createmod::{
    FilterOption, SchematicCard, SchematicDetail, SchematicDimensions, SchematicFilters,
    SchematicHome, SchematicSearch, SchematicSearchParams,
};
use crate::error::{CoreError, Result};

const MINECRAFT_BASE: &str = "https://www.minecraft-schematics.com";
const ABFIELDER_BASE: &str = "https://abfielder.com";
const LIST_TTL: Duration = Duration::from_secs(5 * 60);
const DETAIL_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Serialize, Deserialize)]
struct CachedPage {
    fetched_at: u64,
    body: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn cache_path(key: &str) -> Option<PathBuf> {
    let mut hash = Sha256::new();
    hash.update(key.as_bytes());
    let dir = dirs::cache_dir()?
        .join("brassworks")
        .join("schematic-provider-pages");
    Some(dir.join(format!("{:x}.json", hash.finalize())))
}

fn read_cached(key: &str) -> Option<CachedPage> {
    let path = cache_path(key)?;
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn write_cached(key: &str, body: &str) {
    let Some(path) = cache_path(key) else { return };
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let page = CachedPage {
        fetched_at: now(),
        body: body.to_string(),
    };
    let Ok(bytes) = serde_json::to_vec(&page) else {
        return;
    };
    let temp = path.with_extension("tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        let _ = std::fs::rename(temp, path);
    }
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent(concat!(
            "BrassworksLauncher/",
            env!("CARGO_PKG_VERSION"),
            " (direct schematic fallback)"
        ))
        .build()
        .map_err(|error| CoreError::Remote(error.to_string()))
}

pub(crate) fn cached_text(
    key: &str,
    ttl: Duration,
    request: impl FnOnce() -> Result<String>,
) -> Result<String> {
    let cached = read_cached(key);
    if let Some(page) = cached.as_ref() {
        if now().saturating_sub(page.fetched_at) < ttl.as_secs() {
            return Ok(page.body.clone());
        }
    }
    match request() {
        Ok(body) => {
            write_cached(key, &body);
            Ok(body)
        }
        Err(error) => cached.map(|page| page.body).ok_or(error),
    }
}

fn get_html(url: &str, ttl: Duration) -> Result<String> {
    cached_text(&format!("GET {url}"), ttl, || {
        let response = client()?
            .get(url)
            .header("Accept", "text/html,application/xhtml+xml")
            .send()
            .map_err(|error| CoreError::Remote(error.to_string()))?;
        if !response.status().is_success() {
            return Err(CoreError::Remote(format!("{url} -> {}", response.status())));
        }
        response
            .text()
            .map_err(|error| CoreError::Remote(error.to_string()))
    })
}

fn post_form(url: &str, form: &BTreeMap<&str, String>, ttl: Duration) -> Result<String> {
    let encoded = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().map(|(key, value)| (*key, value.as_str())))
        .finish();
    cached_text(&format!("POST {url} {encoded}"), ttl, || {
        let response = client()?
            .post(url)
            .header("Accept", "application/json")
            .form(form)
            .send()
            .map_err(|error| CoreError::Remote(error.to_string()))?;
        if !response.status().is_success() {
            return Err(CoreError::Remote(format!("{url} -> {}", response.status())));
        }
        let value: serde_json::Value = response
            .json()
            .map_err(|error| CoreError::Remote(format!("decode {url}: {error}")))?;
        Ok(value
            .get("results")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string())
    })
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static selector")
}

fn text(element: ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn absolute(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        href.to_string()
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            href.trim_start_matches('/')
        )
    }
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn blank_card(provider: &str, id: String, title: String) -> SchematicCard {
    SchematicCard {
        provider: provider.to_string(),
        name: id,
        title,
        description: String::new(),
        featured_image: None,
        rating: None,
        views: 0,
        downloads: 0,
        author: None,
        categories: Vec::new(),
        tags: Vec::new(),
        web_url: None,
        formats: Vec::new(),
        supports_views: false,
    }
}

fn minecraft_cards(html: &str) -> Vec<SchematicCard> {
    let document = Html::parse_fragment(html);
    let links = selector("a[href*='/schematic/']");
    let images = selector("img");
    let mut cards: Vec<SchematicCard> = Vec::new();
    for link in document.select(&links) {
        let href = link.value().attr("href").unwrap_or_default();
        let Some(id) = href
            .split("/schematic/")
            .nth(1)
            .and_then(|tail| tail.trim_start_matches('/').split(['/', '?', '&']).next())
            .filter(|id| id.bytes().all(|byte| byte.is_ascii_digit()))
            .map(str::to_string)
        else {
            continue;
        };
        let image = link.select(&images).next();
        if let Some(existing) = cards.iter_mut().find(|card| card.name == id) {
            if existing.featured_image.is_none() {
                existing.featured_image = image
                    .and_then(|value| value.value().attr("src"))
                    .map(|src| absolute(MINECRAFT_BASE, src));
            }
            continue;
        }
        let title = image
            .and_then(|value| value.value().attr("alt"))
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| text(link));
        if title.is_empty() {
            continue;
        }
        let mut card = blank_card("minecraft-schematics", id, title);
        card.featured_image = image
            .and_then(|value| value.value().attr("src"))
            .map(|src| absolute(MINECRAFT_BASE, src));
        card.web_url = Some(absolute(MINECRAFT_BASE, href));
        cards.push(card);
    }
    cards
}

fn abfielder_cards(html: &str) -> Vec<SchematicCard> {
    let document = Html::parse_document(html);
    let links = selector("a[href*='ProductDetails.php?id=']");
    let images = selector("img");
    let headings = selector("h3,h4,h5,h6");
    let mut seen = BTreeSet::new();
    let mut cards = Vec::new();
    for link in document.select(&links) {
        let href = link.value().attr("href").unwrap_or_default();
        let Some(id) = href
            .split("id=")
            .nth(1)
            .and_then(|value| value.split('&').next())
            .filter(|value| safe_id(value))
            .map(str::to_string)
        else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let image = link.select(&images).next();
        let title = link
            .select(&headings)
            .next()
            .map(text)
            .or_else(|| link.value().attr("aria-label").map(str::to_string))
            .or_else(|| {
                image
                    .and_then(|value| value.value().attr("alt"))
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text(link));
        if title.is_empty() {
            continue;
        }
        let mut card = blank_card("abfielder", id, title);
        card.featured_image = image
            .and_then(|value| value.value().attr("src"))
            .map(|src| absolute(ABFIELDER_BASE, src));
        card.web_url = Some(absolute(ABFIELDER_BASE, href));
        cards.push(card);
    }
    cards
}

fn cards(provider: &str, html: &str) -> Vec<SchematicCard> {
    match provider {
        "minecraft-schematics" => minecraft_cards(html),
        "abfielder" => abfielder_cards(html),
        _ => Vec::new(),
    }
}

fn table_value(document: &Html, label: &str) -> String {
    for row in document.select(&selector("tr")) {
        let value = text(row);
        if value
            .to_ascii_lowercase()
            .starts_with(&label.to_ascii_lowercase())
        {
            return value[label.len()..]
                .trim()
                .trim_start_matches(':')
                .trim()
                .to_string();
        }
    }
    String::new()
}

fn section_after_heading(document: &Html, label: &str) -> (String, String) {
    for heading in document.select(&selector("h2,h3")) {
        if text(heading).eq_ignore_ascii_case(label) {
            let mut sibling = heading.next_sibling();
            while let Some(node) = sibling {
                sibling = node.next_sibling();
                if let Some(element) = ElementRef::wrap(node) {
                    let plain = text(element);
                    if !plain.is_empty() {
                        return (element.inner_html(), plain);
                    }
                }
            }
        }
    }
    (String::new(), String::new())
}

fn first_number(value: &str) -> i64 {
    regex::Regex::new(r"[\d,]+")
        .unwrap()
        .find(value)
        .and_then(|found| found.as_str().replace(',', "").parse().ok())
        .unwrap_or(0)
}

fn minecraft_non_free(html: &str) -> bool {
    let page_text = text(Html::parse_document(html).root_element()).to_ascii_lowercase();
    page_text.contains("non-free")
        && page_text.contains("payment")
        && page_text.contains("subscription")
}

fn retain_free_minecraft(provider: &str, cards: Vec<SchematicCard>) -> Vec<SchematicCard> {
    if provider != "minecraft-schematics" {
        return cards;
    }
    cards
        .into_iter()
        .filter(|card| {
            let url = format!("{MINECRAFT_BASE}/schematic/{}/", card.name);
            get_html(&url, DETAIL_TTL)
                .map(|html| !minecraft_non_free(&html))
                .unwrap_or(false)
        })
        .collect()
}

fn blank_detail(provider: &str, id: &str, url: String) -> SchematicDetail {
    SchematicDetail {
        provider: provider.to_string(),
        id: Some(id.to_string()),
        name: id.to_string(),
        title: id.to_string(),
        author: None,
        uploaded_at: String::new(),
        description_html: String::new(),
        excerpt: String::new(),
        featured_image: None,
        gallery: Vec::new(),
        video: String::new(),
        categories: Vec::new(),
        tags: Vec::new(),
        required_mods: Vec::new(),
        required_mod_details: Vec::new(),
        dependencies_html: String::new(),
        materials: Vec::new(),
        version_history: Vec::new(),
        minecraft_version: String::new(),
        createmod_version: String::new(),
        block_count: 0,
        dimensions: SchematicDimensions::default(),
        views: 0,
        downloads: 0,
        rating: None,
        rating_count: 0,
        comment_count: 0,
        web_url: Some(url),
        formats: Vec::new(),
        supports_views: false,
    }
}

fn minecraft_detail(html: &str, id: &str, url: String) -> SchematicDetail {
    let document = Html::parse_document(html);
    let mut detail = blank_detail("minecraft-schematics", id, url);
    detail.title = document
        .select(&selector("h1"))
        .next()
        .map(text)
        .unwrap_or_else(|| id.to_string());
    detail.author = document
        .select(&selector("a[href*='/user/']"))
        .next()
        .map(text)
        .filter(|value| !value.is_empty());
    detail.uploaded_at = table_value(&document, "Posted on");
    let raw_format = table_value(&document, "File Format")
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !raw_format.is_empty() {
        detail.formats.push(raw_format);
    }
    detail.gallery = document
        .select(&selector(
            "a[href*='cdn.minecraft-schematics.com/pictures/']",
        ))
        .filter_map(|link| link.value().attr("href"))
        .map(str::to_string)
        .collect();
    detail.featured_image = detail.gallery.first().cloned();
    (detail.description_html, detail.excerpt) = section_after_heading(&document, "Description");
    let category = table_value(&document, "Category");
    if !category.is_empty() {
        detail.categories.push(category);
    }
    let theme = table_value(&document, "Theme");
    if !theme.is_empty() {
        detail.tags.push(theme);
    }
    detail.downloads = first_number(&table_value(&document, "Download(s)"));
    detail
}

fn abfielder_detail(html: &str, id: &str, url: String) -> SchematicDetail {
    let document = Html::parse_document(html);
    let mut detail = blank_detail("abfielder", id, url.clone());
    for script in document.select(&selector("script[type='application/ld+json']")) {
        let Ok(value) =
            serde_json::from_str::<serde_json::Value>(&script.text().collect::<String>())
        else {
            continue;
        };
        if value.get("@type").and_then(|value| value.as_str()) != Some("Product") {
            continue;
        }
        detail.title = value
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or(id)
            .to_string();
        detail.description_html = value
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        detail.excerpt = detail.description_html.clone();
        detail.featured_image = value
            .get("image")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        detail.author = value
            .pointer("/brand/name")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        detail.uploaded_at = value
            .get("datePublished")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        detail.downloads = value
            .pointer("/interactionStatistic/userInteractionCount")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        break;
    }
    if detail.title == id {
        detail.title = document
            .select(&selector("h1"))
            .next()
            .map(text)
            .unwrap_or_else(|| id.to_string());
    }
    let page_text = text(document.root_element()).to_ascii_lowercase();
    for format in ["litematic", "schem", "mcstructure"] {
        if page_text.contains(&format!(".{format}")) {
            detail.formats.push(format.to_string());
        }
    }
    detail.formats.sort();
    detail.formats.dedup();
    detail.gallery = document
        .select(&selector("img[src]"))
        .filter_map(|image| image.value().attr("src"))
        .filter(|src| {
            (src.contains("UploadedImages") || src.contains("PartnerUploadedImages"))
                && !src.contains("/320/")
        })
        .filter_map(|src| {
            url::Url::parse(&url)
                .ok()?
                .join(src)
                .ok()
                .map(|url| url.to_string())
        })
        .collect();
    detail
}

fn minecraft_order(sort: &str) -> &str {
    match sort {
        "most_viewed" | "trending" => "download_counter",
        "random" => "random",
        _ => "registration_date",
    }
}

fn abfielder_sort(sort: &str) -> &str {
    match sort {
        "newest" => "newest",
        "oldest" => "oldest",
        "most_viewed" | "trending" => "popular",
        _ => "relevance",
    }
}

pub fn home(provider: &str) -> Result<SchematicHome> {
    let url = match provider {
        "minecraft-schematics" => format!("{MINECRAFT_BASE}/latest/"),
        "abfielder" => format!("{ABFIELDER_BASE}/Products/BrowseProducts.php?page=1&sort=newest"),
        _ => {
            return Err(CoreError::Remote(format!(
                "unknown schematic provider {provider}"
            )))
        }
    };
    let items = retain_free_minecraft(provider, cards(provider, &get_html(&url, LIST_TTL)?));
    Ok(SchematicHome {
        trending: items.clone(),
        latest: items,
        highest: Vec::new(),
    })
}

pub fn search(provider: &str, params: &SchematicSearchParams) -> Result<SchematicSearch> {
    let page = params.page.max(1);
    let html = match provider {
        "minecraft-schematics"
            if params.query.trim().is_empty() && selected_native_filter_count(params) <= 1 =>
        {
            let base = if selected(&params.category) {
                format!("{MINECRAFT_BASE}/category/{}/", params.category)
            } else if selected(&params.theme) {
                format!("{MINECRAFT_BASE}/theme/{}/", params.theme)
            } else if selected(&params.size) {
                format!("{MINECRAFT_BASE}/size/{}/", params.size)
            } else {
                format!("{MINECRAFT_BASE}/latest/")
            };
            let url = if page == 1 {
                base
            } else {
                format!("{base}{page}/")
            };
            get_html(&url, LIST_TTL)?
        }
        "minecraft-schematics" => {
            let mut form = BTreeMap::new();
            form.insert("action", "search".to_string());
            form.insert("keyword", params.query.clone());
            form.insert("theme", filter_value(&params.theme));
            form.insert("size", filter_value(&params.size));
            form.insert(
                "category",
                if params.category == "all" {
                    String::new()
                } else {
                    params.category.clone()
                },
            );
            form.insert("format", String::new());
            form.insert("orderby", minecraft_order(&params.sort).to_string());
            form.insert("orderway", "desc".to_string());
            post_form(&format!("{MINECRAFT_BASE}/ajax.php"), &form, LIST_TTL)?
        }
        "abfielder" => {
            let mut url = url::Url::parse(&format!("{ABFIELDER_BASE}/Products/BrowseProducts.php"))
                .map_err(|error| CoreError::Remote(error.to_string()))?;
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("page", &page.to_string());
                query.append_pair("game", "minecraft");
                query.append_pair("productType", "1");
                if !params.query.trim().is_empty() {
                    query.append_pair("search", params.query.trim());
                }
                if !params.category.is_empty() && params.category != "all" {
                    query.append_pair("tag", &params.category);
                }
                query.append_pair("sort", abfielder_sort(&params.sort));
            }
            get_html(url.as_str(), LIST_TTL)?
        }
        _ => {
            return Err(CoreError::Remote(format!(
                "unknown schematic provider {provider}"
            )))
        }
    };
    let items = retain_free_minecraft(provider, cards(provider, &html));
    let has_next = match provider {
        "minecraft-schematics" if params.query.trim().is_empty() => {
            html.contains(&format!("/{}/", page + 1))
        }
        "abfielder" => items.len() >= 12,
        _ => false,
    };
    Ok(SchematicSearch {
        total: items.len() as i64,
        items,
        page,
        has_next,
    })
}

pub fn detail(provider: &str, id: &str) -> Result<SchematicDetail> {
    if !safe_id(id) {
        return Err(CoreError::Remote("invalid schematic id".to_string()));
    }
    let url = match provider {
        "minecraft-schematics" => format!("{MINECRAFT_BASE}/schematic/{id}/"),
        "abfielder" => format!("{ABFIELDER_BASE}/Products/ProductDetails.php?id={id}"),
        _ => {
            return Err(CoreError::Remote(format!(
                "unknown schematic provider {provider}"
            )))
        }
    };
    let html = get_html(&url, DETAIL_TTL)?;
    if provider == "minecraft-schematics" && minecraft_non_free(&html) {
        return Err(CoreError::Remote(
            "non-free Minecraft schematic is not available in Brassworks".to_string(),
        ));
    }
    Ok(match provider {
        "minecraft-schematics" => minecraft_detail(&html, id, url),
        "abfielder" => abfielder_detail(&html, id, url),
        _ => unreachable!(),
    })
}

pub fn filters(provider: &str) -> Result<SchematicFilters> {
    let (formats, categories, themes, sizes) = match provider {
        "minecraft-schematics" => (
            ["schem", "schematic"].as_slice(),
            minecraft_categories(),
            minecraft_themes(),
            minecraft_sizes(),
        ),
        "abfielder" => {
            let url = format!(
                "{ABFIELDER_BASE}/Products/BrowseProducts.php?game=minecraft&productType=1"
            );
            let categories = get_html(&url, LIST_TTL)
                .ok()
                .map(|html| parse_abfielder_tags(&html))
                .filter(|items| !items.is_empty())
                .unwrap_or_else(abfielder_popular_tags);
            (
                ["litematic", "schem", "mcstructure"].as_slice(),
                categories,
                Vec::new(),
                Vec::new(),
            )
        }
        _ => {
            return Err(CoreError::Remote(format!(
                "unknown schematic provider {provider}"
            )))
        }
    };
    Ok(SchematicFilters {
        categories,
        themes,
        sizes,
        formats: formats
            .iter()
            .map(|value| FilterOption {
                value: (*value).to_string(),
                label: format!(".{value}"),
            })
            .collect(),
        ..Default::default()
    })
}

fn selected(value: &str) -> bool {
    !value.is_empty() && value != "all"
}

fn filter_value(value: &str) -> String {
    selected(value)
        .then(|| value.to_string())
        .unwrap_or_default()
}

fn selected_native_filter_count(params: &SchematicSearchParams) -> usize {
    [&params.category, &params.theme, &params.size]
        .into_iter()
        .filter(|value| selected(value))
        .count()
}

fn options(values: &[(&str, &str)]) -> Vec<FilterOption> {
    values
        .iter()
        .map(|(value, label)| FilterOption {
            value: (*value).to_string(),
            label: (*label).to_string(),
        })
        .collect()
}

fn minecraft_categories() -> Vec<FilterOption> {
    options(&[
        ("arenas", "Arenas"),
        ("castles", "Castles"),
        ("dungeons", "Dungeons"),
        ("games", "Games"),
        ("houses-and-shops", "Houses and Shops"),
        ("miscellaneous", "Miscellaneous"),
        ("redstone", "Redstone"),
        ("temples", "Temples"),
        ("towers", "Towers"),
        ("towns", "Towns"),
        ("floating-islands", "Floating Islands"),
        ("gardens", "Gardens"),
        ("islands", "Islands"),
        ("pixel-art", "Pixel Art"),
        ("statues-and-sculptures", "Statues and Sculptures"),
        ("boats", "Boats"),
        ("flying-machines", "Flying Machines"),
        ("ground-vehicles", "Ground Vehicles"),
    ])
}

fn minecraft_themes() -> Vec<FilterOption> {
    options(&[
        ("ancient", "Ancient"),
        ("asian", "Asian"),
        ("futuristic", "Futuristic"),
        ("medieval", "Medieval"),
        ("modern", "Modern"),
        ("other", "Other"),
    ])
}

fn minecraft_sizes() -> Vec<FilterOption> {
    options(&[
        ("small", "Small"),
        ("medium", "Medium"),
        ("large", "Large"),
        ("huge", "Huge"),
    ])
}

fn abfielder_popular_tags() -> Vec<FilterOption> {
    options(&[
        ("28", "House"),
        ("18", "Castle"),
        ("30", "Mega Build"),
        ("80", "Iron Farm"),
        ("75", "Gold Farm"),
        ("60", "Creeper Farm"),
    ])
}

fn parse_abfielder_tags(html: &str) -> Vec<FilterOption> {
    let document = Html::parse_document(html);
    let select = selector("select");
    let option = selector("option");
    document
        .select(&select)
        .find_map(|element| {
            let attrs = format!(
                "{} {}",
                element.value().attr("name").unwrap_or_default(),
                element.value().attr("id").unwrap_or_default()
            )
            .to_ascii_lowercase();
            let values = element
                .select(&option)
                .filter_map(|item| {
                    let value = item.value().attr("value")?.trim();
                    let label = text(item);
                    (!value.is_empty() && value != "-1" && !label.eq_ignore_ascii_case("any")).then(
                        || FilterOption {
                            value: value.to_string(),
                            label,
                        },
                    )
                })
                .collect::<Vec<_>>();
            let looks_like_tags = attrs.contains("tag")
                || (values
                    .iter()
                    .any(|item| item.value == "28" && item.label == "House")
                    && values
                        .iter()
                        .any(|item| item.value == "18" && item.label == "Castle"));
            looks_like_tags.then_some(values)
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_cards_without_cross_provider_urls() {
        let minecraft = minecraft_cards(
            r#"<a href="/schematic/31032/"><img src="/image.png" alt="Roxwood Cabin"></a>"#,
        );
        assert_eq!(minecraft[0].provider, "minecraft-schematics");
        assert_eq!(
            minecraft[0].web_url.as_deref(),
            Some("https://www.minecraft-schematics.com/schematic/31032/")
        );

        let abfielder =
            abfielder_cards(r#"<a href="/Products/ProductDetails.php?id=7"><h5>Farm</h5></a>"#);
        assert_eq!(abfielder[0].provider, "abfielder");
    }

    #[test]
    fn detects_non_free_minecraft_notice() {
        assert!(minecraft_non_free(
            r#"<p>This creation is marked as "non-free", meaning you'll need to make a payment or purchase a subscription to download it.</p>"#,
        ));
        assert!(!minecraft_non_free("<p>A free cabin schematic.</p>"));
    }

    #[test]
    fn exposes_native_provider_filters() {
        assert!(minecraft_categories()
            .iter()
            .any(|item| item.value == "redstone"));
        assert_eq!(minecraft_themes().len(), 6);
        assert_eq!(minecraft_sizes().len(), 4);
        let tags = parse_abfielder_tags(
            r#"<select id="tagFilter"><option value="-1">Any</option><option value="18">Castle</option></select>"#,
        );
        assert_eq!(tags[0].label, "Castle");
    }
}
