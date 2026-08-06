//! In-process Java schematic conversion.
//!
//! The data model follows the same formats supported by SchemConvert, but is
//! implemented in Rust so downloads never have to leave the launcher.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use base64::Engine;
use fastnbt::{IntArray, LongArray, Value};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};

use crate::error::{CoreError, Result};

pub const CONVERTIBLE_FORMATS: &[&str] = &["nbt", "schem", "litematic", "schematic"];
const MAX_BLOCKS: usize = 64 * 1024 * 1024;

#[derive(Clone)]
struct BlockState {
    name: String,
    properties: HashMap<String, String>,
}

#[derive(Clone)]
struct Schematic {
    size: [usize; 3],
    palette: Vec<BlockState>,
    blocks: Vec<usize>,
    data_version: i32,
    block_entities: Vec<BlockEntity>,
    entities: Vec<Entity>,
}

#[derive(Clone)]
struct BlockEntity {
    pos: [i32; 3],
    nbt: HashMap<String, Value>,
}

#[derive(Clone)]
struct Entity {
    pos: [f64; 3],
    id: String,
    nbt: HashMap<String, Value>,
}

pub fn can_convert(format: &str) -> bool {
    CONVERTIBLE_FORMATS.contains(&format)
}

pub fn convert(
    bytes: &[u8],
    from: &str,
    to: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<Vec<u8>> {
    if from == to {
        return Ok(bytes.to_vec());
    }
    if !can_convert(from) || !can_convert(to) {
        return Err(CoreError::Modpack(format!(
            "conversion from .{from} to .{to} is not supported"
        )));
    }
    check_cancel(cancel)?;
    progress(0, 100);
    let raw = decompress(bytes)?;
    let value: HashMap<String, Value> = fastnbt::from_bytes(&raw)
        .map_err(|e| CoreError::Modpack(format!("invalid .{from} schematic: {e}")))?;
    let schematic = match from {
        "nbt" => read_structure(&value)?,
        "schem" => read_sponge(&value)?,
        "litematic" => read_litematic(&value)?,
        "schematic" => read_classic(&value)?,
        _ => unreachable!(),
    };
    check_cancel(cancel)?;
    progress(50, 100);
    let value = match to {
        "nbt" => write_structure(&schematic)?,
        "schem" => write_sponge(&schematic),
        "litematic" => write_litematic(&schematic),
        "schematic" => write_classic(&schematic),
        _ => unreachable!(),
    };
    let encoded = fastnbt::to_bytes(&value)
        .map_err(|e| CoreError::Modpack(format!("could not encode .{to} schematic: {e}")))?;
    check_cancel(cancel)?;
    progress(90, 100);
    let result = compress(&encoded)?;
    progress(100, 100);
    Ok(result)
}

fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(CoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn decompress(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        GzDecoder::new(bytes)
            .read_to_end(&mut out)
            .map_err(|e| CoreError::Modpack(format!("invalid compressed schematic: {e}")))?;
        Ok(out)
    } else {
        Ok(bytes.to_vec())
    }
}

fn compress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut writer = GzEncoder::new(Vec::new(), Compression::default());
    writer
        .write_all(bytes)
        .map_err(|e| CoreError::Modpack(format!("could not compress schematic: {e}")))?;
    writer
        .finish()
        .map_err(|e| CoreError::Modpack(format!("could not compress schematic: {e}")))
}

fn compound<'a>(value: &'a Value, key: &str) -> Result<&'a HashMap<String, Value>> {
    match value {
        Value::Compound(v) => Ok(v),
        _ => Err(CoreError::Modpack(format!(
            "schematic field '{key}' is not a compound"
        ))),
    }
}

fn root_compound<'a>(
    root: &'a HashMap<String, Value>,
    key: &str,
) -> Result<&'a HashMap<String, Value>> {
    root.get(key)
        .ok_or_else(|| CoreError::Modpack(format!("schematic is missing '{key}'")))
        .and_then(|v| compound(v, key))
}

fn number(value: Option<&Value>, key: &str) -> Result<i32> {
    match value {
        Some(Value::Byte(v)) => Ok(*v as i32),
        Some(Value::Short(v)) => Ok(*v as i32),
        Some(Value::Int(v)) => Ok(*v),
        Some(Value::Long(v)) => {
            i32::try_from(*v).map_err(|_| CoreError::Modpack(format!("'{key}' is too large")))
        }
        _ => Err(CoreError::Modpack(format!(
            "schematic is missing numeric field '{key}'"
        ))),
    }
}

fn decimal(value: Option<&Value>, key: &str) -> Result<f64> {
    match value {
        Some(Value::Float(v)) => Ok(*v as f64),
        Some(Value::Double(v)) => Ok(*v),
        Some(Value::Int(v)) => Ok(*v as f64),
        _ => Err(CoreError::Modpack(format!(
            "schematic is missing numeric field '{key}'"
        ))),
    }
}

fn int_position(value: Option<&Value>) -> Option<[i32; 3]> {
    match value {
        Some(Value::IntArray(v)) if v.len() >= 3 => Some([v[0], v[1], v[2]]),
        Some(Value::List(v)) if v.len() >= 3 => Some([
            number(v.first(), "x").ok()?,
            number(v.get(1), "y").ok()?,
            number(v.get(2), "z").ok()?,
        ]),
        _ => None,
    }
}

fn decimal_position(value: Option<&Value>) -> Option<[f64; 3]> {
    match value {
        Some(Value::List(v)) if v.len() >= 3 => Some([
            decimal(v.first(), "x").ok()?,
            decimal(v.get(1), "y").ok()?,
            decimal(v.get(2), "z").ok()?,
        ]),
        _ => None,
    }
}

fn dimensions(x: i32, y: i32, z: i32) -> Result<([usize; 3], usize)> {
    if x <= 0 || y <= 0 || z <= 0 {
        return Err(CoreError::Modpack(
            "schematic dimensions must be positive".into(),
        ));
    }
    let size = [x as usize, y as usize, z as usize];
    let volume = size[0]
        .checked_mul(size[1])
        .and_then(|v| v.checked_mul(size[2]))
        .filter(|v| *v <= MAX_BLOCKS)
        .ok_or_else(|| CoreError::Modpack("schematic is too large to convert safely".into()))?;
    Ok((size, volume))
}

fn state_from_value(value: &Value) -> Result<BlockState> {
    let map = compound(value, "palette entry")?;
    let name = match map.get("Name") {
        Some(Value::String(v)) => v.clone(),
        _ => return Err(CoreError::Modpack("palette entry has no block name".into())),
    };
    let properties = match map.get("Properties") {
        Some(Value::Compound(values)) => values
            .iter()
            .filter_map(|(k, v)| match v {
                Value::String(s) => Some((k.clone(), s.clone())),
                _ => None,
            })
            .collect(),
        _ => HashMap::new(),
    };
    Ok(BlockState { name, properties })
}

fn state_to_value(state: &BlockState) -> Value {
    let mut result = HashMap::from([("Name".into(), Value::String(state.name.clone()))]);
    if !state.properties.is_empty() {
        result.insert(
            "Properties".into(),
            Value::Compound(
                state
                    .properties
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect(),
            ),
        );
    }
    Value::Compound(result)
}

fn state_from_string(value: &str) -> BlockState {
    let (name, raw) = value.split_once('[').unwrap_or((value, ""));
    let properties = raw
        .trim_end_matches(']')
        .split(',')
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect();
    BlockState {
        name: name.to_string(),
        properties,
    }
}

fn state_to_string(state: &BlockState) -> String {
    if state.properties.is_empty() {
        return state.name.clone();
    }
    let mut properties: Vec<_> = state.properties.iter().collect();
    properties.sort_by(|a, b| a.0.cmp(b.0));
    format!(
        "{}[{}]",
        state.name,
        properties
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn read_structure(root: &HashMap<String, Value>) -> Result<Schematic> {
    let size = match root.get("size") {
        Some(Value::List(v)) if v.len() == 3 => {
            dimensions(
                number(v.first(), "size[0]")?,
                number(v.get(1), "size[1]")?,
                number(v.get(2), "size[2]")?,
            )?
            .0
        }
        _ => return Err(CoreError::Modpack("structure has no valid size".into())),
    };
    let volume = size[0] * size[1] * size[2];
    let mut palette = match root.get("palette") {
        Some(Value::List(v)) => v.iter().map(state_from_value).collect::<Result<Vec<_>>>()?,
        _ => return Err(CoreError::Modpack("structure has no palette".into())),
    };
    let air = palette
        .iter()
        .position(|v| v.name == "minecraft:air")
        .unwrap_or_else(|| {
            palette.push(state_from_string("minecraft:air"));
            palette.len() - 1
        });
    let mut blocks = vec![air; volume];
    let mut block_entities = Vec::new();
    if let Some(Value::List(values)) = root.get("blocks") {
        for value in values {
            let map = compound(value, "block")?;
            let state = number(map.get("state"), "state")? as usize;
            let pos = match map.get("pos") {
                Some(Value::List(v)) if v.len() == 3 => [
                    number(v.first(), "x")? as usize,
                    number(v.get(1), "y")? as usize,
                    number(v.get(2), "z")? as usize,
                ],
                _ => continue,
            };
            if pos[0] < size[0] && pos[1] < size[1] && pos[2] < size[2] && state < palette.len() {
                blocks[(pos[1] * size[2] + pos[2]) * size[0] + pos[0]] = state;
                if let Some(Value::Compound(nbt)) = map.get("nbt") {
                    block_entities.push(BlockEntity {
                        pos: [pos[0] as i32, pos[1] as i32, pos[2] as i32],
                        nbt: nbt.clone(),
                    });
                }
            }
        }
    }
    let entities = match root.get("entities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let entry = compound(value, "entity").ok()?;
                let pos = decimal_position(entry.get("pos"))?;
                let nbt = match entry.get("nbt") {
                    Some(Value::Compound(v)) => v.clone(),
                    _ => HashMap::new(),
                };
                let id = match nbt.get("id") {
                    Some(Value::String(v)) => v.clone(),
                    _ => String::new(),
                };
                Some(Entity { pos, id, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(Schematic {
        size,
        palette,
        blocks,
        data_version: number(root.get("DataVersion"), "DataVersion").unwrap_or(3955),
        block_entities,
        entities,
    })
}

fn write_structure(s: &Schematic) -> Result<HashMap<String, Value>> {
    // The 48-block limit belongs to Vanilla's structure-block UI, not the NBT
    // format. Create loads StructureTemplate data directly and supports larger
    // integer dimensions. Its exporter also ignores air, so mirror that sparse
    // representation to keep large schematics compact enough to use/upload.
    let mut blocks = Vec::new();
    for y in 0..s.size[1] {
        for z in 0..s.size[2] {
            for x in 0..s.size[0] {
                let index = (y * s.size[2] + z) * s.size[0] + x;
                let state = s.blocks[index];
                if s
                    .palette
                    .get(state)
                    .is_some_and(|entry| entry.name == "minecraft:air")
                {
                    continue;
                }
                let mut entry = HashMap::from([
                    (
                        "pos".into(),
                        Value::List(vec![
                            Value::Int(x as i32),
                            Value::Int(y as i32),
                            Value::Int(z as i32),
                        ]),
                    ),
                    ("state".into(), Value::Int(state as i32)),
                ]);
                if let Some(entity) = s
                    .block_entities
                    .iter()
                    .find(|entity| entity.pos == [x as i32, y as i32, z as i32])
                {
                    entry.insert("nbt".into(), Value::Compound(entity.nbt.clone()));
                }
                blocks.push(Value::Compound(entry));
            }
        }
    }
    Ok(HashMap::from([
        ("DataVersion".into(), Value::Int(s.data_version)),
        (
            "size".into(),
            Value::List(s.size.iter().map(|v| Value::Int(*v as i32)).collect()),
        ),
        (
            "palette".into(),
            Value::List(s.palette.iter().map(state_to_value).collect()),
        ),
        ("blocks".into(), Value::List(blocks)),
        (
            "entities".into(),
            Value::List(
                s.entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        if !entity.id.is_empty() {
                            nbt.insert("id".into(), Value::String(entity.id.clone()));
                        }
                        Value::Compound(HashMap::from([
                            (
                                "pos".into(),
                                Value::List(entity.pos.iter().map(|v| Value::Double(*v)).collect()),
                            ),
                            (
                                "blockPos".into(),
                                Value::List(
                                    entity.pos.iter().map(|v| Value::Int(*v as i32)).collect(),
                                ),
                            ),
                            ("nbt".into(), Value::Compound(nbt)),
                        ]))
                    })
                    .collect(),
            ),
        ),
    ]))
}

fn read_sponge(root: &HashMap<String, Value>) -> Result<Schematic> {
    let root = root
        .get("Schematic")
        .map(|v| compound(v, "Schematic"))
        .transpose()?
        .unwrap_or(root);
    let (size, volume) = dimensions(
        number(root.get("Width"), "Width")?,
        number(root.get("Height"), "Height")?,
        number(root.get("Length"), "Length")?,
    )?;
    let blocks_root = match root.get("Blocks") {
        Some(v) => compound(v, "Blocks")?,
        None => root,
    };
    let palette_map = match blocks_root.get("Palette") {
        Some(Value::Compound(v)) => v,
        _ => return Err(CoreError::Modpack("Sponge schematic has no palette".into())),
    };
    let max = palette_map
        .values()
        .filter_map(|v| number(Some(v), "palette index").ok())
        .max()
        .unwrap_or(0)
        .max(0) as usize;
    let mut palette = vec![state_from_string("minecraft:air"); max + 1];
    for (state, index) in palette_map {
        let index = number(Some(index), "palette index")? as usize;
        if index < palette.len() {
            palette[index] = state_from_string(state);
        }
    }
    let data = match blocks_root
        .get("Data")
        .or_else(|| blocks_root.get("BlockData"))
    {
        Some(Value::ByteArray(v)) => v.iter().map(|b| *b as u8).collect::<Vec<_>>(),
        _ => {
            return Err(CoreError::Modpack(
                "Sponge schematic has no block data".into(),
            ));
        }
    };
    let blocks = decode_varints(&data, volume)?;
    if blocks.iter().any(|index| *index >= palette.len()) {
        return Err(CoreError::Modpack(
            "Sponge block data references an invalid palette entry".into(),
        ));
    }
    let block_entities = match blocks_root
        .get("BlockEntities")
        .or_else(|| root.get("BlockEntities"))
    {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let nbt = compound(value, "block entity").ok()?.clone();
                Some(BlockEntity {
                    pos: int_position(nbt.get("Pos"))?,
                    nbt,
                })
            })
            .collect(),
        _ => Vec::new(),
    };
    let entities = match root.get("Entities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let entry = compound(value, "entity").ok()?;
                let pos = decimal_position(entry.get("Pos"))?;
                let id = match entry.get("Id") {
                    Some(Value::String(v)) => v.clone(),
                    _ => String::new(),
                };
                let nbt = match entry.get("Data") {
                    Some(Value::Compound(v)) => v.clone(),
                    _ => entry.clone(),
                };
                Some(Entity { pos, id, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(Schematic {
        size,
        palette,
        blocks,
        data_version: number(root.get("DataVersion"), "DataVersion").unwrap_or(3955),
        block_entities,
        entities,
    })
}

fn write_sponge(s: &Schematic) -> HashMap<String, Value> {
    let palette: HashMap<_, _> = s
        .palette
        .iter()
        .enumerate()
        .map(|(i, state)| (state_to_string(state), Value::Int(i as i32)))
        .collect();
    let data = encode_varints(&s.blocks)
        .into_iter()
        .map(|v| v as i8)
        .collect();
    let blocks = Value::Compound(HashMap::from([
        ("Palette".into(), Value::Compound(palette)),
        (
            "Data".into(),
            Value::ByteArray(fastnbt::ByteArray::new(data)),
        ),
        (
            "BlockEntities".into(),
            Value::List(
                s.block_entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        nbt.insert(
                            "Pos".into(),
                            Value::IntArray(IntArray::new(entity.pos.to_vec())),
                        );
                        Value::Compound(nbt)
                    })
                    .collect(),
            ),
        ),
    ]));
    HashMap::from([(
        "Schematic".into(),
        Value::Compound(HashMap::from([
            ("Version".into(), Value::Int(3)),
            ("DataVersion".into(), Value::Int(s.data_version)),
            ("Width".into(), Value::Short(s.size[0] as i16)),
            ("Height".into(), Value::Short(s.size[1] as i16)),
            ("Length".into(), Value::Short(s.size[2] as i16)),
            ("Blocks".into(), blocks),
            (
                "Entities".into(),
                Value::List(
                    s.entities
                        .iter()
                        .map(|entity| {
                            Value::Compound(HashMap::from([
                                (
                                    "Pos".into(),
                                    Value::List(
                                        entity.pos.iter().map(|v| Value::Double(*v)).collect(),
                                    ),
                                ),
                                ("Id".into(), Value::String(entity.id.clone())),
                                ("Data".into(), Value::Compound(entity.nbt.clone())),
                            ]))
                        })
                        .collect(),
                ),
            ),
        ])),
    )])
}

fn decode_varints(data: &[u8], count: usize) -> Result<Vec<usize>> {
    let mut output = Vec::with_capacity(count);
    let mut value = 0usize;
    let mut shift = 0;
    for byte in data {
        value |= ((byte & 0x7f) as usize) << shift;
        if byte & 0x80 == 0 {
            output.push(value);
            value = 0;
            shift = 0;
            if output.len() == count {
                break;
            }
        } else {
            shift += 7;
            if shift > 28 {
                return Err(CoreError::Modpack("invalid Sponge block varint".into()));
            }
        }
    }
    if output.len() != count {
        return Err(CoreError::Modpack(format!(
            "Sponge block data contains {} blocks, expected {count}",
            output.len()
        )));
    }
    Ok(output)
}

fn encode_varints(values: &[usize]) -> Vec<u8> {
    let mut out = Vec::new();
    for value in values {
        let mut v = *value;
        loop {
            let mut byte = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if v == 0 {
                break;
            }
        }
    }
    out
}

fn read_litematic(root: &HashMap<String, Value>) -> Result<Schematic> {
    let regions = root_compound(root, "Regions")?;
    let region = regions
        .values()
        .next()
        .ok_or_else(|| CoreError::Modpack("litematic contains no regions".into()))
        .and_then(|v| compound(v, "region"))?;
    let size_map = region
        .get("Size")
        .ok_or_else(|| CoreError::Modpack("litematic has no size".into()))
        .and_then(|v| compound(v, "Size"))?;
    let (size, volume) = dimensions(
        number(size_map.get("x"), "x")?.unsigned_abs() as i32,
        number(size_map.get("y"), "y")?.unsigned_abs() as i32,
        number(size_map.get("z"), "z")?.unsigned_abs() as i32,
    )?;
    let palette = match region.get("BlockStatePalette") {
        Some(Value::List(v)) => v.iter().map(state_from_value).collect::<Result<Vec<_>>>()?,
        _ => return Err(CoreError::Modpack("litematic has no block palette".into())),
    };
    let longs = match region.get("BlockStates") {
        Some(Value::LongArray(v)) => v.iter().copied().collect::<Vec<_>>(),
        _ => return Err(CoreError::Modpack("litematic has no block states".into())),
    };
    let bits = bits_per_block(palette.len());
    let mask = (1u64 << bits) - 1;
    let mut blocks = Vec::with_capacity(volume);
    for i in 0..volume {
        let bit = i * bits;
        let word = bit / 64;
        let offset = bit % 64;
        let mut value = (longs.get(word).copied().unwrap_or(0) as u64) >> offset;
        if offset + bits > 64 {
            value |= (longs.get(word + 1).copied().unwrap_or(0) as u64) << (64 - offset);
        }
        blocks.push((value & mask) as usize);
    }
    if blocks.iter().any(|index| *index >= palette.len()) {
        return Err(CoreError::Modpack(
            "litematic block data references an invalid palette entry".into(),
        ));
    }
    let block_entities = match region.get("TileEntities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let mut nbt = compound(value, "tile entity").ok()?.clone();
                let pos = [
                    number(nbt.get("x"), "x").ok()?,
                    number(nbt.get("y"), "y").ok()?,
                    number(nbt.get("z"), "z").ok()?,
                ];
                nbt.remove("x");
                nbt.remove("y");
                nbt.remove("z");
                Some(BlockEntity { pos, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    let entities = match region.get("Entities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let nbt = compound(value, "entity").ok()?.clone();
                let pos = decimal_position(nbt.get("Pos"))?;
                let id = match nbt.get("id") {
                    Some(Value::String(v)) => v.clone(),
                    _ => String::new(),
                };
                Some(Entity { pos, id, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(Schematic {
        size,
        palette,
        blocks,
        data_version: number(root.get("MinecraftDataVersion"), "MinecraftDataVersion")
            .unwrap_or(3955),
        block_entities,
        entities,
    })
}

fn write_litematic(s: &Schematic) -> HashMap<String, Value> {
    let bits = bits_per_block(s.palette.len());
    let words = (s.blocks.len() * bits).div_ceil(64);
    let mut packed = vec![0u64; words];
    for (i, value) in s.blocks.iter().enumerate() {
        let bit = i * bits;
        let word = bit / 64;
        let offset = bit % 64;
        packed[word] |= (*value as u64) << offset;
        if offset + bits > 64 {
            packed[word + 1] |= (*value as u64) >> (64 - offset);
        }
    }
    let size = || {
        Value::Compound(HashMap::from([
            ("x".into(), Value::Int(s.size[0] as i32)),
            ("y".into(), Value::Int(s.size[1] as i32)),
            ("z".into(), Value::Int(s.size[2] as i32)),
        ]))
    };
    let region = Value::Compound(HashMap::from([
        (
            "Position".into(),
            Value::Compound(HashMap::from([
                ("x".into(), Value::Int(0)),
                ("y".into(), Value::Int(0)),
                ("z".into(), Value::Int(0)),
            ])),
        ),
        ("Size".into(), size()),
        (
            "BlockStatePalette".into(),
            Value::List(s.palette.iter().map(state_to_value).collect()),
        ),
        (
            "BlockStates".into(),
            Value::LongArray(LongArray::new(
                packed.into_iter().map(|v| v as i64).collect(),
            )),
        ),
        (
            "TileEntities".into(),
            Value::List(
                s.block_entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        nbt.insert("x".into(), Value::Int(entity.pos[0]));
                        nbt.insert("y".into(), Value::Int(entity.pos[1]));
                        nbt.insert("z".into(), Value::Int(entity.pos[2]));
                        Value::Compound(nbt)
                    })
                    .collect(),
            ),
        ),
        (
            "Entities".into(),
            Value::List(
                s.entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        nbt.insert(
                            "Pos".into(),
                            Value::List(entity.pos.iter().map(|v| Value::Double(*v)).collect()),
                        );
                        if !entity.id.is_empty() {
                            nbt.insert("id".into(), Value::String(entity.id.clone()));
                        }
                        Value::Compound(nbt)
                    })
                    .collect(),
            ),
        ),
    ]));
    HashMap::from([
        ("Version".into(), Value::Int(6)),
        ("SubVersion".into(), Value::Int(1)),
        ("MinecraftDataVersion".into(), Value::Int(s.data_version)),
        (
            "Metadata".into(),
            Value::Compound(HashMap::from([
                (
                    "Name".into(),
                    Value::String("Converted by Brassworks".into()),
                ),
                ("RegionCount".into(), Value::Int(1)),
                ("TotalBlocks".into(), Value::Int(s.blocks.len() as i32)),
                ("EnclosingSize".into(), size()),
            ])),
        ),
        (
            "Regions".into(),
            Value::Compound(HashMap::from([("Brassworks".into(), region)])),
        ),
    ])
}

fn bits_per_block(palette: usize) -> usize {
    let needed = usize::BITS as usize - palette.saturating_sub(1).leading_zeros() as usize;
    needed.max(2)
}

fn legacy_mappings() -> &'static HashMap<String, String> {
    // Mapping table adapted from PiTheGuy/SchemConvert (GPL-3.0), the reference
    // implementation requested for this converter.
    static MAPPINGS: OnceLock<HashMap<String, String>> = OnceLock::new();
    MAPPINGS.get_or_init(|| {
        let encoded = include_str!("legacy_mappings.b64").trim();
        let compressed = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("embedded legacy schematic mappings are valid base64");
        let mut decoded = Vec::new();
        GzDecoder::new(compressed.as_slice())
            .read_to_end(&mut decoded)
            .expect("embedded legacy schematic mappings are valid gzip");
        let root: serde_json::Value = serde_json::from_slice(&decoded)
            .expect("embedded legacy schematic mappings are valid JSON");
        root.get("blocks")
            .and_then(serde_json::Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())))
            .collect()
    })
}

fn read_classic(root: &HashMap<String, Value>) -> Result<Schematic> {
    let (size, volume) = dimensions(
        number(root.get("Width"), "Width")?,
        number(root.get("Height"), "Height")?,
        number(root.get("Length"), "Length")?,
    )?;
    let ids = match root.get("Blocks") {
        Some(Value::ByteArray(value)) => value.iter().map(|v| *v as u8).collect::<Vec<_>>(),
        _ => {
            return Err(CoreError::Modpack(
                "classic schematic has no Blocks array".into(),
            ))
        }
    };
    let data = match root.get("Data") {
        Some(Value::ByteArray(value)) => value.iter().map(|v| *v as u8).collect::<Vec<_>>(),
        _ => vec![0; volume],
    };
    if ids.len() != volume || data.len() != volume {
        return Err(CoreError::Modpack(
            "classic schematic block data size does not match its dimensions".into(),
        ));
    }
    let mappings = legacy_mappings();
    let mut palette = Vec::<BlockState>::new();
    let mut palette_lookup = HashMap::<String, usize>::new();
    let mut blocks = Vec::with_capacity(volume);
    for (id, data) in ids.into_iter().zip(data) {
        let key = format!("{}:{}", id, data & 0x0f);
        let state = mappings
            .get(&key)
            .map(String::as_str)
            .unwrap_or("minecraft:air");
        let index = *palette_lookup.entry(state.to_string()).or_insert_with(|| {
            let index = palette.len();
            palette.push(state_from_string(state));
            index
        });
        blocks.push(index);
    }
    let block_entities = match root.get("TileEntities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let mut nbt = compound(value, "tile entity").ok()?.clone();
                let pos = [
                    number(nbt.get("x"), "x").ok()?,
                    number(nbt.get("y"), "y").ok()?,
                    number(nbt.get("z"), "z").ok()?,
                ];
                nbt.remove("x");
                nbt.remove("y");
                nbt.remove("z");
                Some(BlockEntity { pos, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    let entities = match root.get("Entities") {
        Some(Value::List(values)) => values
            .iter()
            .filter_map(|value| {
                let nbt = compound(value, "entity").ok()?.clone();
                let pos = decimal_position(nbt.get("Pos"))?;
                let id = match nbt.get("id") {
                    Some(Value::String(v)) => v.clone(),
                    _ => String::new(),
                };
                Some(Entity { pos, id, nbt })
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(Schematic {
        size,
        palette,
        blocks,
        data_version: 3955,
        block_entities,
        entities,
    })
}

fn write_classic(s: &Schematic) -> HashMap<String, Value> {
    let mappings = legacy_mappings();
    let mut reverse = HashMap::<String, (u8, u8)>::new();
    for (legacy, modern) in mappings {
        if let Some((id, data)) = legacy
            .split_once(':')
            .and_then(|(id, data)| Some((id.parse::<u16>().ok()?, data.parse::<u8>().ok()?)))
        {
            if id <= u8::MAX as u16 {
                reverse.entry(modern.clone()).or_insert((id as u8, data));
            }
        }
    }
    let mut ids = Vec::with_capacity(s.blocks.len());
    let mut data = Vec::with_capacity(s.blocks.len());
    for palette_index in &s.blocks {
        let state = s
            .palette
            .get(*palette_index)
            .map(state_to_string)
            .unwrap_or_else(|| "minecraft:air".into());
        let base = state.split('[').next().unwrap_or(&state);
        let (id, metadata) = reverse
            .get(&state)
            .or_else(|| reverse.get(base))
            .copied()
            .unwrap_or((0, 0));
        ids.push(id as i8);
        data.push(metadata as i8);
    }
    HashMap::from([
        ("Width".into(), Value::Short(s.size[0] as i16)),
        ("Height".into(), Value::Short(s.size[1] as i16)),
        ("Length".into(), Value::Short(s.size[2] as i16)),
        ("Materials".into(), Value::String("Alpha".into())),
        (
            "Blocks".into(),
            Value::ByteArray(fastnbt::ByteArray::new(ids)),
        ),
        (
            "Data".into(),
            Value::ByteArray(fastnbt::ByteArray::new(data)),
        ),
        (
            "TileEntities".into(),
            Value::List(
                s.block_entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        nbt.insert("x".into(), Value::Int(entity.pos[0]));
                        nbt.insert("y".into(), Value::Int(entity.pos[1]));
                        nbt.insert("z".into(), Value::Int(entity.pos[2]));
                        Value::Compound(nbt)
                    })
                    .collect(),
            ),
        ),
        (
            "Entities".into(),
            Value::List(
                s.entities
                    .iter()
                    .map(|entity| {
                        let mut nbt = entity.nbt.clone();
                        nbt.insert(
                            "Pos".into(),
                            Value::List(entity.pos.iter().map(|v| Value::Double(*v)).collect()),
                        );
                        if !entity.id.is_empty() {
                            nbt.insert("id".into(), Value::String(entity.id.clone()));
                        }
                        Value::Compound(nbt)
                    })
                    .collect(),
            ),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn sample() -> Schematic {
        Schematic {
            size: [2, 1, 2],
            palette: vec![
                state_from_string("minecraft:air"),
                state_from_string("minecraft:stone"),
                state_from_string("minecraft:oak_log[axis=y]"),
            ],
            blocks: vec![0, 1, 2, 1],
            data_version: 3955,
            block_entities: vec![BlockEntity {
                pos: [1, 0, 0],
                nbt: HashMap::from([("id".into(), Value::String("minecraft:chest".into()))]),
            }],
            entities: vec![Entity {
                pos: [0.5, 1.0, 0.5],
                id: "minecraft:armor_stand".into(),
                nbt: HashMap::new(),
            }],
        }
    }

    fn sparse_structure_without_air() -> HashMap<String, Value> {
        HashMap::from([
            ("DataVersion".into(), Value::Int(3955)),
            (
                "size".into(),
                Value::List(vec![Value::Int(4), Value::Int(1), Value::Int(1)]),
            ),
            (
                "palette".into(),
                Value::List(vec![state_to_value(&state_from_string("minecraft:stone"))]),
            ),
            (
                "blocks".into(),
                Value::List(vec![Value::Compound(HashMap::from([
                    (
                        "pos".into(),
                        Value::List(vec![Value::Int(1), Value::Int(0), Value::Int(0)]),
                    ),
                    ("state".into(), Value::Int(0)),
                ]))]),
            ),
            ("entities".into(), Value::List(Vec::new())),
        ])
    }

    fn block_names(schematic: &Schematic) -> Vec<&str> {
        schematic
            .blocks
            .iter()
            .map(|index| schematic.palette[*index].name.as_str())
            .collect()
    }

    #[test]
    fn modern_formats_round_trip() {
        let cancel = AtomicBool::new(false);
        let mut progress = |_, _| {};
        let nbt =
            compress(&fastnbt::to_bytes(&write_structure(&sample()).unwrap()).unwrap()).unwrap();
        let schem = convert(&nbt, "nbt", "schem", &cancel, &mut progress).unwrap();
        let litematic = convert(&schem, "schem", "litematic", &cancel, &mut progress).unwrap();
        let roundtrip = convert(&litematic, "litematic", "nbt", &cancel, &mut progress).unwrap();
        let root: HashMap<String, Value> =
            fastnbt::from_bytes(&decompress(&roundtrip).unwrap()).unwrap();
        let decoded = read_structure(&root).unwrap();
        assert_eq!(decoded.size, [2, 1, 2]);
        assert_eq!(decoded.blocks, vec![0, 1, 2, 1]);
        assert_eq!(decoded.block_entities.len(), 1);
        assert_eq!(decoded.entities.len(), 1);
    }

    #[test]
    fn sparse_create_air_survives_every_round_trip() {
        let sparse = sparse_structure_without_air();
        let decoded = read_structure(&sparse).unwrap();
        assert_eq!(
            block_names(&decoded),
            vec![
                "minecraft:air",
                "minecraft:stone",
                "minecraft:air",
                "minecraft:air",
            ]
        );

        let source = compress(&fastnbt::to_bytes(&sparse).unwrap()).unwrap();
        for format in ["litematic", "schem", "schematic"] {
            let converted = convert(
                &source,
                "nbt",
                format,
                &AtomicBool::new(false),
                &mut |_, _| {},
            )
            .unwrap();
            let roundtrip = convert(
                &converted,
                format,
                "nbt",
                &AtomicBool::new(false),
                &mut |_, _| {},
            )
            .unwrap();
            let root: HashMap<String, Value> =
                fastnbt::from_bytes(&decompress(&roundtrip).unwrap()).unwrap();
            let decoded = read_structure(&root).unwrap();
            assert_eq!(
                block_names(&decoded),
                vec![
                    "minecraft:air",
                    "minecraft:stone",
                    "minecraft:air",
                    "minecraft:air",
                ],
                "air changed after a .nbt -> .{format} -> .nbt round trip",
            );
        }
    }

    #[test]
    fn create_nbt_supports_large_sparse_dimensions() {
        let mut large = sample();
        large.size = [96, 64, 2];
        large.blocks = vec![0; large.size.iter().product()];
        large.blocks[0] = 1;
        large.blocks[large.size.iter().product::<usize>() - 1] = 2;
        large.block_entities.clear();
        large.entities.clear();

        let source = compress(&fastnbt::to_bytes(&write_sponge(&large)).unwrap()).unwrap();
        let converted = convert(
            &source,
            "schem",
            "nbt",
            &AtomicBool::new(false),
            &mut |_, _| {},
        )
        .unwrap();
        let encoded: HashMap<String, Value> =
            fastnbt::from_bytes(&decompress(&converted).unwrap()).unwrap();
        let stored_blocks = match encoded.get("blocks") {
            Some(Value::List(blocks)) => blocks,
            _ => panic!("structure has no block list"),
        };
        assert_eq!(stored_blocks.len(), 2);

        let decoded = read_structure(&encoded).unwrap();
        assert_eq!(decoded.size, [96, 64, 2]);
        assert_eq!(decoded.blocks[0], 1);
        assert_eq!(decoded.blocks.last(), Some(&2));
    }

    #[test]
    fn cancelled_conversion_stops() {
        let cancel = AtomicBool::new(true);
        let mut progress = |_, _| {};
        assert!(matches!(
            convert(&[], "nbt", "schem", &cancel, &mut progress),
            Err(CoreError::Cancelled)
        ));
    }

    #[test]
    fn classic_schematic_converts_both_directions() {
        let cancel = AtomicBool::new(false);
        let mut progress = |_, _| {};
        let nbt =
            compress(&fastnbt::to_bytes(&write_structure(&sample()).unwrap()).unwrap()).unwrap();
        let classic = convert(&nbt, "nbt", "schematic", &cancel, &mut progress).unwrap();
        let roundtrip = convert(&classic, "schematic", "schem", &cancel, &mut progress).unwrap();
        let root: HashMap<String, Value> =
            fastnbt::from_bytes(&decompress(&roundtrip).unwrap()).unwrap();
        let decoded = read_sponge(&root).unwrap();
        assert_eq!(decoded.size, [2, 1, 2]);
        assert_eq!(decoded.blocks.len(), 4);
        assert!(decoded
            .palette
            .iter()
            .any(|state| state.name == "minecraft:stone"));
    }
}
