
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;

const DEFAULT_PORT: u16 = 25565;
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub online: bool,
    pub motd: String,
    pub version: Option<String>,
    pub players_online: i64,
    pub players_max: i64,
    pub favicon: Option<String>,
    pub ping_ms: u64,
    pub error: Option<String>,
}

impl ServerStatus {
    fn offline(error: impl Into<String>) -> Self {
        Self {
            online: false,
            motd: String::new(),
            version: None,
            players_online: 0,
            players_max: 0,
            favicon: None,
            ping_ms: 0,
            error: Some(error.into()),
        }
    }
}

pub fn ping(addr: &str) -> ServerStatus {
    match ping_inner(addr) {
        Ok(status) => status,
        Err(e) => ServerStatus::offline(e.to_string()),
    }
}

fn ping_inner(addr: &str) -> io::Result<ServerStatus> {
    let (mut host, mut port, explicit_port) = split_host_port(addr);
    if !explicit_port {
        if let Some((target, srv_port)) = resolve_srv(&host) {
            host = target;
            port = srv_port;
        }
    }
    let socket = (host.as_str(), port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "could not resolve host"))?;

    let started = Instant::now();
    let mut stream = TcpStream::connect_timeout(&socket, TIMEOUT)?;
    stream.set_read_timeout(Some(TIMEOUT))?;
    stream.set_write_timeout(Some(TIMEOUT))?;

    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0x00); 
    write_varint(&mut handshake, -1); 
    write_string(&mut handshake, &host);
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1); 
    write_framed(&mut stream, &handshake)?;

    let mut request = Vec::new();
    write_varint(&mut request, 0x00);
    write_framed(&mut stream, &request)?;

    let _len = read_varint(&mut stream)?;
    let _id = read_varint(&mut stream)?;
    let json = read_string(&mut stream)?;
    let ping_ms = started.elapsed().as_millis() as u64;

    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let motd = value
        .get("description")
        .map(extract_text)
        .map(|s| strip_formatting(&s))
        .unwrap_or_default();
    let version = value
        .get("version")
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| strip_formatting(s));
    let players_online = value
        .get("players")
        .and_then(|p| p.get("online"))
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let players_max = value
        .get("players")
        .and_then(|p| p.get("max"))
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let favicon = value
        .get("favicon")
        .and_then(|f| f.as_str())
        .filter(|s| s.starts_with("data:image"))
        .map(|s| s.to_string());

    Ok(ServerStatus {
        online: true,
        motd,
        version,
        players_online,
        players_max,
        favicon,
        ping_ms,
        error: None,
    })
}

fn split_host_port(addr: &str) -> (String, u16, bool) {
    let addr = addr.trim();
    if let Some(rest) = addr.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            match tail.strip_prefix(':').and_then(|p| p.parse().ok()) {
                Some(port) => return (host.to_string(), port, true),
                None => return (host.to_string(), DEFAULT_PORT, false),
            }
        }
    }
    if addr.matches(':').count() == 1 {
        if let Some((host, port)) = addr.split_once(':') {
            if let Ok(port) = port.parse::<u16>() {
                return (host.to_string(), port, true);
            }
        }
    }
    (addr.to_string(), DEFAULT_PORT, false)
}

fn resolve_srv(host: &str) -> Option<(String, u16)> {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    let url = format!(
        "https://cloudflare-dns.com/dns-query?name=_minecraft._tcp.{host}&type=SRV"
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("accept", "application/dns-json")
        .send()
        .ok()?;
    let json: serde_json::Value = resp.json().ok()?;
    for ans in json.get("Answer")?.as_array()? {
        if ans.get("type").and_then(|t| t.as_u64()) != Some(33) {
            continue;
        }
        let data = ans.get("data").and_then(|d| d.as_str())?;
        let parts: Vec<&str> = data.split_whitespace().collect();
        if parts.len() == 4 {
            if let Ok(port) = parts[2].parse::<u16>() {
                let target = parts[3].trim_end_matches('.').to_string();
                if !target.is_empty() {
                    return Some((target, port));
                }
            }
        }
    }
    None
}


fn extract_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(map) => {
            let mut out = String::new();
            if let Some(serde_json::Value::String(t)) = map.get("text") {
                out.push_str(t);
            }
            if let Some(serde_json::Value::Array(extra)) = map.get("extra") {
                for e in extra {
                    out.push_str(&extract_text(e));
                }
            }
            out
        }
        serde_json::Value::Array(arr) => arr.iter().map(extract_text).collect(),
        _ => String::new(),
    }
}

fn strip_formatting(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}


fn write_varint(buf: &mut Vec<u8>, value: i32) {
    let mut v = value as u32;
    loop {
        let mut byte = (v & 0x7F) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if v == 0 {
            break;
        }
    }
}

fn write_string(buf: &mut Vec<u8>, s: &str) {
    write_varint(buf, s.len() as i32);
    buf.extend_from_slice(s.as_bytes());
}

fn write_framed(stream: &mut TcpStream, body: &[u8]) -> io::Result<()> {
    let mut framed = Vec::with_capacity(body.len() + 4);
    write_varint(&mut framed, body.len() as i32);
    framed.extend_from_slice(body);
    stream.write_all(&framed)
}

fn read_varint<R: Read>(r: &mut R) -> io::Result<i32> {
    let mut num: i32 = 0;
    let mut shift = 0;
    loop {
        let mut byte = [0u8; 1];
        r.read_exact(&mut byte)?;
        num |= ((byte[0] & 0x7F) as i32) << shift;
        if byte[0] & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "varint too long"));
        }
    }
    Ok(num)
}

fn read_string<R: Read>(r: &mut R) -> io::Result<String> {
    let len = read_varint(r)?;
    if !(0..=(1 << 21)).contains(&len) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad string length"));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
