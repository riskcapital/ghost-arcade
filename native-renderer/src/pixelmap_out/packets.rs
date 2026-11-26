//! Art-Net 4 (ArtDmx, ArtSync), ANSI E1.31 (sACN) and WLED DRGB packet
//! builders. A byte-for-byte port of `electron/pixelmap-packets.cjs` and
//! `electron/wled-packet.cjs`; `tests.rs` checks every builder against
//! packets the JS modules made (`testdata/packets.json`).

pub(crate) const ARTNET_PORT: u16 = 6454;
pub(crate) const SACN_PORT: u16 = 5568;
pub(crate) const DMX_SLOTS: usize = 512;
pub(crate) const ARTNET_MAX_UNIVERSE: u32 = 32767;
pub(crate) const SACN_MIN_UNIVERSE: u32 = 1;
pub(crate) const SACN_MAX_UNIVERSE: u32 = 63999;
pub(crate) const SACN_DEFAULT_PRIORITY: u8 = 100;
pub(crate) const SACN_MAX_PRIORITY: u8 = 200;
const SACN_SOURCE_NAME_BYTES: usize = 64;

const ARTNET_ID: &[u8; 8] = b"Art-Net\0";
const ARTNET_PROTOCOL_VERSION: u8 = 14;
const OP_DMX: u16 = 0x5000;
const OP_SYNC: u16 = 0x5200;

const ACN_PACKET_IDENTIFIER: [u8; 12] = [0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00];
const VECTOR_ROOT_E131_DATA: u32 = 0x0000_0004;
const VECTOR_E131_DATA_PACKET: u32 = 0x0000_0002;
const VECTOR_DMP_SET_PROPERTY: u8 = 0x02;
const SACN_HEADER_BYTES: usize = 126;

const SACN_OPTION_PREVIEW: u8 = 0x80;
const SACN_OPTION_TERMINATED: u8 = 0x40;
const SACN_OPTION_FORCE_SYNC: u8 = 0x20;

/// One DRGB packet carries at most this many LEDs.
pub(crate) const WLED_MAX_LEDS: usize = 490;

fn dmx_data(data: &[u8]) -> Result<&[u8], String> {
    if data.is_empty() || data.len() > DMX_SLOTS {
        return Err("DMX data must be 1-512 channels".to_string());
    }
    Ok(data)
}

/// ArtDmx (OpCode 0x5000): 18-byte header; the length is even (2-512), so an
/// odd channel count is padded with one zero slot.
pub(crate) fn build_art_dmx(universe: u32, sequence: u8, physical: u8, data: &[u8]) -> Result<Vec<u8>, String> {
    if universe > ARTNET_MAX_UNIVERSE {
        return Err("Art-Net universe must be 0-32767".to_string());
    }
    let slots = dmx_data(data)?;
    let length = (slots.len() + slots.len() % 2).max(2);
    let mut packet = vec![0_u8; 18 + length];
    packet[0..8].copy_from_slice(ARTNET_ID);
    packet[8..10].copy_from_slice(&OP_DMX.to_le_bytes());
    packet[10] = 0;
    packet[11] = ARTNET_PROTOCOL_VERSION;
    packet[12] = sequence;
    packet[13] = physical;
    packet[14] = (universe & 0xff) as u8;
    packet[15] = ((universe >> 8) & 0x7f) as u8;
    packet[16..18].copy_from_slice(&(length as u16).to_be_bytes());
    packet[18..18 + slots.len()].copy_from_slice(slots);
    Ok(packet)
}

/// ArtSync (OpCode 0x5200).
pub(crate) fn build_art_sync() -> Vec<u8> {
    let mut packet = vec![0_u8; 14];
    packet[0..8].copy_from_slice(ARTNET_ID);
    packet[8..10].copy_from_slice(&OP_SYNC.to_le_bytes());
    packet[11] = ARTNET_PROTOCOL_VERSION;
    packet
}

/// Art-Net sequence runs 1-255; 0 means "sequencing disabled", so it is skipped.
pub(crate) fn next_artnet_sequence(previous: Option<u8>) -> u8 {
    match previous.unwrap_or(0) {
        0 | 255 => 1,
        value => value + 1,
    }
}

/// sACN sequence runs 0-255 and wraps; the first one is 0.
pub(crate) fn next_sacn_sequence(previous: Option<u8>) -> u8 {
    previous.map_or(0, |value| value.wrapping_add(1))
}

/// A UUID string (or 32 hex digits) as the 16-byte CID.
pub(crate) fn parse_sacn_cid(cid: &str) -> Result<[u8; 16], String> {
    let hex: String = cid.chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("sACN CID must be a UUID".to_string());
    }
    let mut out = [0_u8; 16];
    for (index, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// JS `String.prototype.trim`: ECMAScript white space and line terminators.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// UTF-8 source name, cut on a character boundary to leave a null terminator.
pub(crate) fn encode_source_name(name: Option<&str>) -> [u8; SACN_SOURCE_NAME_BYTES] {
    let trimmed = name.map(js_trim).filter(|text| !text.is_empty()).unwrap_or("Ghost Arcade");
    let mut encoded = trimmed.as_bytes();
    if encoded.len() > SACN_SOURCE_NAME_BYTES - 1 {
        let mut end = SACN_SOURCE_NAME_BYTES - 1;
        while end > 0 && (encoded[end] & 0xc0) == 0x80 {
            end -= 1;
        }
        encoded = &encoded[..end];
    }
    let mut field = [0_u8; SACN_SOURCE_NAME_BYTES];
    field[..encoded.len()].copy_from_slice(encoded);
    field
}

fn flags_and_length(length: usize) -> [u8; 2] {
    (0x7000_u16 | (length as u16 & 0x0fff)).to_be_bytes()
}

pub(crate) struct E131Options<'a> {
    pub universe: u32,
    pub sequence: u8,
    pub priority: u8,
    pub source_name: &'a [u8; SACN_SOURCE_NAME_BYTES],
    pub cid: &'a [u8; 16],
    pub preview: bool,
    pub terminated: bool,
    pub force_sync: bool,
    pub sync_address: u16,
}

/// E1.31 data packet: Root layer, Framing layer, DMP layer, start code, slots.
pub(crate) fn build_e131(options: &E131Options, data: &[u8]) -> Result<Vec<u8>, String> {
    if !(SACN_MIN_UNIVERSE..=SACN_MAX_UNIVERSE).contains(&options.universe) {
        return Err("sACN universe must be 1-63999".to_string());
    }
    if options.priority > SACN_MAX_PRIORITY {
        return Err("sACN priority must be 0-200".to_string());
    }
    if u32::from(options.sync_address) > SACN_MAX_UNIVERSE {
        return Err("sACN sync address must be 0-63999".to_string());
    }
    let slots = dmx_data(data)?;
    let length = SACN_HEADER_BYTES + slots.len();
    let mut packet = vec![0_u8; length];
    packet[0..2].copy_from_slice(&0x0010_u16.to_be_bytes());
    packet[4..16].copy_from_slice(&ACN_PACKET_IDENTIFIER);
    packet[16..18].copy_from_slice(&flags_and_length(length - 16));
    packet[18..22].copy_from_slice(&VECTOR_ROOT_E131_DATA.to_be_bytes());
    packet[22..38].copy_from_slice(options.cid);

    packet[38..40].copy_from_slice(&flags_and_length(length - 38));
    packet[40..44].copy_from_slice(&VECTOR_E131_DATA_PACKET.to_be_bytes());
    packet[44..108].copy_from_slice(options.source_name);
    packet[108] = options.priority;
    packet[109..111].copy_from_slice(&options.sync_address.to_be_bytes());
    packet[111] = options.sequence;
    packet[112] = (if options.preview { SACN_OPTION_PREVIEW } else { 0 })
        | (if options.terminated { SACN_OPTION_TERMINATED } else { 0 })
        | (if options.force_sync { SACN_OPTION_FORCE_SYNC } else { 0 });
    packet[113..115].copy_from_slice(&(options.universe as u16).to_be_bytes());

    packet[115..117].copy_from_slice(&flags_and_length(length - 115));
    packet[117] = VECTOR_DMP_SET_PROPERTY;
    packet[118] = 0xa1;
    packet[121..123].copy_from_slice(&0x0001_u16.to_be_bytes());
    packet[123..125].copy_from_slice(&((slots.len() + 1) as u16).to_be_bytes());
    packet[125] = 0x00;
    packet[126..].copy_from_slice(slots);
    Ok(packet)
}

/// E1.31 multicast group for a universe: 239.255.{hi}.{lo}.
pub(crate) fn sacn_multicast_address(universe: u32) -> Result<std::net::Ipv4Addr, String> {
    if !(SACN_MIN_UNIVERSE..=SACN_MAX_UNIVERSE).contains(&universe) {
        return Err("sACN universe must be 1-63999".to_string());
    }
    Ok(std::net::Ipv4Addr::new(239, 255, ((universe >> 8) & 0xff) as u8, (universe & 0xff) as u8))
}

/// WLED DRGB (protocol 2): protocol byte, timeout seconds, RGB triples.
pub(crate) fn build_wled_realtime(pixels: &[u8]) -> Result<Vec<u8>, String> {
    if pixels.len() < 3 || pixels.len() > WLED_MAX_LEDS * 3 || pixels.len() % 3 != 0 {
        return Err("WLED requires 1–490 RGB LEDs per controller".to_string());
    }
    let mut packet = Vec::with_capacity(2 + pixels.len());
    packet.push(2);
    // Back to WLED's own effect after two seconds without frames.
    packet.push(2);
    packet.extend_from_slice(pixels);
    Ok(packet)
}
