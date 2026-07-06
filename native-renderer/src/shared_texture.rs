use base64::Engine;
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SharedTextureSourceFrameDescriptor {
    pub handle: String,
    pub platform: String,
    pub format: String,
    pub handle_encoding: String,
    pub handle_chars: usize,
    pub handle_byte_length: Option<u64>,
    pub frame: Option<u64>,
    pub sender_name: Option<String>,
    pub width: u32,
    pub height: u32,
}

impl SharedTextureSourceFrameDescriptor {
    pub fn from_command(command: &Value, width: usize, height: usize) -> Option<Self> {
        let shared_texture = command.get("shared_texture");
        let handle = string_or_number_at(command, "shared_handle")
            .or_else(|| string_or_number_at(command, "sharedHandle"))
            .or_else(|| string_or_number_at(command, "handle"))
            .or_else(|| nested_string_or_number_at(shared_texture, "handle"))
            .or_else(|| shared_texture.and_then(string_or_number))?;
        let handle_chars = handle.len();

        Some(Self {
            handle,
            platform: normalize_platform(
                string_at(command, "shared_texture_platform")
                    .or_else(|| string_at(command, "sharedTexturePlatform"))
                    .or_else(|| string_at(command, "platform"))
                    .or_else(|| nested_string_at(shared_texture, "platform"))
                    .unwrap_or("unknown"),
            ),
            format: string_or_number_at(command, "shared_texture_format")
                .or_else(|| string_or_number_at(command, "sharedTextureFormat"))
                .or_else(|| string_or_number_at(command, "format"))
                .or_else(|| nested_string_or_number_at(shared_texture, "format"))
                .unwrap_or_else(|| "unknown".to_string()),
            handle_encoding: normalize_handle_encoding(
                string_at(command, "shared_texture_handle_encoding")
                    .or_else(|| string_at(command, "sharedTextureHandleEncoding"))
                    .or_else(|| string_at(command, "handle_encoding"))
                    .or_else(|| string_at(command, "handleEncoding"))
                    .or_else(|| nested_string_at(shared_texture, "handle_encoding"))
                    .or_else(|| nested_string_at(shared_texture, "handleEncoding"))
                    .or_else(|| nested_string_at(shared_texture, "encoding"))
                    .unwrap_or("opaque"),
            ),
            handle_chars,
            handle_byte_length: number_at(command, "shared_texture_handle_byte_length")
                .or_else(|| number_at(command, "sharedTextureHandleByteLength"))
                .or_else(|| number_at(command, "handle_byte_length"))
                .or_else(|| number_at(command, "handleByteLength"))
                .or_else(|| nested_number_at(shared_texture, "handle_byte_length"))
                .or_else(|| nested_number_at(shared_texture, "handleByteLength")),
            frame: number_at(command, "shared_texture_frame")
                .or_else(|| number_at(command, "sharedTextureFrame"))
                .or_else(|| number_at(command, "frame"))
                .or_else(|| nested_number_at(shared_texture, "frame")),
            sender_name: string_at(command, "shared_texture_sender_name")
                .or_else(|| string_at(command, "sharedTextureSenderName"))
                .or_else(|| string_at(command, "sender_name"))
                .or_else(|| string_at(command, "senderName"))
                .or_else(|| nested_string_at(shared_texture, "sender_name"))
                .or_else(|| nested_string_at(shared_texture, "senderName"))
                .map(str::to_string),
            width: width.min(u32::MAX as usize) as u32,
            height: height.min(u32::MAX as usize) as u32,
        })
    }

    pub fn unsupported_reason(&self, backend: &str) -> String {
        let (import_path, handle_status) = match self.platform.as_str() {
            "dxgi" => {
                let handle_status = match self.dxgi_shared_handle() {
                    Ok(_) => "DXGI HANDLE metadata is valid".to_string(),
                    Err(err) => format!("DXGI HANDLE metadata is invalid: {err}"),
                };
                (
                    "DXGI metadata parsed; D3D11/D3D12 shared-handle import is pending for Windows builds",
                    handle_status,
                )
            }
            "iosurface" => (
                "IOSurface metadata parsed; cross-process IOSurface import is pending for this upload path",
                "IOSurface handle metadata is validated by the macOS import path".to_string(),
            ),
            _ => (
                "no native shared-texture import path is available for this platform",
                "handle metadata was not validated for this platform".to_string(),
            ),
        };
        format!(
            "shared texture source-frame upload is not implemented yet \
             (backend={backend}, platform={}, format={}, size={}x{}, handle_encoding={}, handle_chars={}, declared_bytes={}, frame={}, sender={}, import_path={import_path}, handle_status={handle_status})",
            self.platform,
            self.format,
            self.width,
            self.height,
            self.handle_encoding,
            self.handle_chars,
            self.handle_byte_length
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            self.frame
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            self.sender_name.as_deref().unwrap_or("unknown")
        )
    }

    pub fn iosurface_id(&self) -> Result<u32, String> {
        if self.platform != "iosurface" {
            return Err(format!(
                "shared texture platform `{}` is not IOSurface",
                self.platform
            ));
        }
        match self.handle_encoding.as_str() {
            "integer" | "opaque" => parse_u32_handle(&self.handle),
            "base64" => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(self.handle.as_bytes())
                    .map_err(|err| format!("invalid base64 IOSurface handle: {err}"))?;
                iosurface_id_from_bytes(&bytes)
            }
            "hex" => {
                let bytes = hex_bytes(&self.handle)?;
                iosurface_id_from_bytes(&bytes)
            }
            encoding => Err(format!(
                "unsupported IOSurface handle encoding `{encoding}`"
            )),
        }
    }

    pub fn dxgi_shared_handle(&self) -> Result<u64, String> {
        if self.platform != "dxgi" {
            return Err(format!(
                "shared texture platform `{}` is not DXGI",
                self.platform
            ));
        }
        match self.handle_encoding.as_str() {
            "integer" | "opaque" => parse_u64_handle(&self.handle, "DXGI shared handle"),
            "base64" => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(self.handle.as_bytes())
                    .map_err(|err| format!("invalid base64 DXGI shared handle: {err}"))?;
                dxgi_shared_handle_from_bytes(&bytes)
            }
            "hex" => {
                let bytes = hex_bytes(&self.handle)?;
                dxgi_shared_handle_from_bytes(&bytes)
            }
            encoding => Err(format!(
                "unsupported DXGI shared handle encoding `{encoding}`"
            )),
        }
    }
}

fn parse_u32_handle(handle: &str) -> Result<u32, String> {
    let trimmed = handle.trim();
    let parsed = trimmed
        .parse::<u64>()
        .map_err(|_| format!("IOSurface handle `{trimmed}` is not an integer ID"))?;
    u32::try_from(parsed).map_err(|_| format!("IOSurface ID `{trimmed}` exceeds u32 range"))
}

fn parse_u64_handle(handle: &str, label: &str) -> Result<u64, String> {
    let trimmed = handle.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is empty"));
    }
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16)
            .map_err(|_| format!("{label} `{trimmed}` is not a valid hex HANDLE"));
    }
    trimmed
        .parse::<u64>()
        .map_err(|_| format!("{label} `{trimmed}` is not an integer HANDLE"))
}

fn iosurface_id_from_bytes(bytes: &[u8]) -> Result<u32, String> {
    match bytes.len() {
        4 => Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        8 => Err(
            "received an 8-byte IOSurfaceRef pointer; native core runs in a separate process and requires a 4-byte IOSurfaceID"
                .to_string(),
        ),
        len => Err(format!(
            "IOSurface handle must be a 4-byte IOSurfaceID, received {len} bytes"
        )),
    }
}

fn dxgi_shared_handle_from_bytes(bytes: &[u8]) -> Result<u64, String> {
    match bytes.len() {
        8 => Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ])),
        len => Err(format!(
            "DXGI shared handle must be an 8-byte HANDLE, received {len} bytes"
        )),
    }
}

fn hex_bytes(handle: &str) -> Result<Vec<u8>, String> {
    let compact: String = handle
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace() && *ch != ':')
        .collect();
    if compact.len() % 2 != 0 {
        return Err("hex shared texture handle has an odd character count".to_string());
    }
    let mut bytes = Vec::with_capacity(compact.len() / 2);
    for pair in compact.as_bytes().chunks(2) {
        let text = std::str::from_utf8(pair)
            .map_err(|_| "hex shared texture handle contains invalid UTF-8".to_string())?;
        let value = u8::from_str_radix(text, 16)
            .map_err(|_| format!("hex shared texture handle contains invalid byte `{text}`"))?;
        bytes.push(value);
    }
    Ok(bytes)
}

fn normalize_platform(platform: &str) -> String {
    match platform.trim().to_ascii_lowercase().as_str() {
        "d3d11" | "d3d12" | "dxgi" | "spout" => "dxgi".to_string(),
        "iosurface" | "io-surface" | "metal" | "syphon" => "iosurface".to_string(),
        "" => "unknown".to_string(),
        other => other.to_string(),
    }
}

fn normalize_handle_encoding(encoding: &str) -> String {
    match encoding.trim().to_ascii_lowercase().as_str() {
        "b64" | "base64" => "base64".to_string(),
        "hex" => "hex".to_string(),
        "int" | "integer" | "u32" | "u64" => "integer".to_string(),
        "" => "opaque".to_string(),
        other => other.to_string(),
    }
}

fn string_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn nested_string_at<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a str> {
    value?.as_object()?.get(key)?.as_str()
}

fn string_or_number_at(value: &Value, key: &str) -> Option<String> {
    let value = value.get(key)?;
    string_or_number(value)
}

fn nested_string_or_number_at(value: Option<&Value>, key: &str) -> Option<String> {
    let value = value?.as_object()?.get(key)?;
    string_or_number(value)
}

fn string_or_number(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn number_at(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn nested_number_at(value: Option<&Value>, key: &str) -> Option<u64> {
    value?.as_object()?.get(key)?.as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_direct_dxgi_handle_metadata() {
        let command = json!({
            "shared_handle": "ZmFrZQ==",
            "shared_texture_platform": "spout",
            "shared_texture_format": 87,
            "shared_texture_handle_encoding": "b64",
            "shared_texture_handle_byte_length": 8,
            "shared_texture_frame": 12,
            "shared_texture_sender_name": "Resolume"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1920, 1080).unwrap();

        assert_eq!(descriptor.platform, "dxgi");
        assert_eq!(descriptor.handle, "ZmFrZQ==");
        assert_eq!(descriptor.format, "87");
        assert_eq!(descriptor.handle_encoding, "base64");
        assert_eq!(descriptor.handle_chars, 8);
        assert_eq!(descriptor.handle_byte_length, Some(8));
        assert_eq!(descriptor.frame, Some(12));
        assert_eq!(descriptor.sender_name.as_deref(), Some("Resolume"));
        assert_eq!(descriptor.width, 1920);
        assert_eq!(descriptor.height, 1080);
    }

    #[test]
    fn parses_dxgi_shared_handle_from_integer() {
        let command = json!({
            "shared_handle": "123456",
            "shared_texture_platform": "dxgi",
            "shared_texture_handle_encoding": "integer"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1920, 1080).unwrap();

        assert_eq!(descriptor.dxgi_shared_handle().unwrap(), 123456);
    }

    #[test]
    fn parses_dxgi_shared_handle_from_opaque_hex_integer() {
        let command = json!({
            "shared_handle": "0x123456789ABCDEF0",
            "shared_texture_platform": "spout"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1920, 1080).unwrap();

        assert_eq!(
            descriptor.dxgi_shared_handle().unwrap(),
            0x1234_5678_9abc_def0
        );
    }

    #[test]
    fn parses_dxgi_shared_handle_from_base64_bytes() {
        let handle = 0x1234_5678_9abc_def0_u64;
        let command = json!({
            "shared_handle": base64::engine::general_purpose::STANDARD.encode(handle.to_le_bytes()),
            "shared_texture_platform": "d3d12",
            "shared_texture_handle_encoding": "base64",
            "shared_texture_handle_byte_length": 8
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 3840, 2160).unwrap();

        assert_eq!(descriptor.platform, "dxgi");
        assert_eq!(descriptor.dxgi_shared_handle().unwrap(), handle);
    }

    #[test]
    fn parses_dxgi_shared_handle_from_hex_bytes() {
        let command = json!({
            "shared_handle": "f0 de bc 9a 78 56 34 12",
            "shared_texture_platform": "d3d11",
            "shared_texture_handle_encoding": "hex",
            "shared_texture_handle_byte_length": 8
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert_eq!(
            descriptor.dxgi_shared_handle().unwrap(),
            0x1234_5678_9abc_def0
        );
    }

    #[test]
    fn rejects_short_dxgi_shared_handle_bytes() {
        let command = json!({
            "shared_handle": base64::engine::general_purpose::STANDARD.encode(42_u32.to_le_bytes()),
            "shared_texture_platform": "dxgi",
            "shared_texture_handle_encoding": "base64",
            "shared_texture_handle_byte_length": 4
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert!(
            descriptor
                .dxgi_shared_handle()
                .unwrap_err()
                .contains("8-byte HANDLE")
        );
    }

    #[test]
    fn rejects_iosurface_when_requesting_dxgi_shared_handle() {
        let command = json!({
            "shared_handle": "42",
            "shared_texture_platform": "iosurface",
            "shared_texture_handle_encoding": "integer"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert!(
            descriptor
                .dxgi_shared_handle()
                .unwrap_err()
                .contains("not DXGI")
        );
    }

    #[test]
    fn parses_nested_iosurface_handle_metadata() {
        let command = json!({
            "shared_texture": {
                "handle": "42",
                "platform": "Syphon",
                "format": "bgra8unorm",
                "encoding": "integer",
                "handle_byte_length": 4,
                "frame": 44,
                "senderName": "Syphon Camera"
            }
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 4096, 2160).unwrap();

        assert_eq!(descriptor.platform, "iosurface");
        assert_eq!(descriptor.handle, "42");
        assert_eq!(descriptor.format, "bgra8unorm");
        assert_eq!(descriptor.handle_encoding, "integer");
        assert_eq!(descriptor.handle_chars, 2);
        assert_eq!(descriptor.handle_byte_length, Some(4));
        assert_eq!(descriptor.frame, Some(44));
        assert_eq!(descriptor.sender_name.as_deref(), Some("Syphon Camera"));
        assert!(
            descriptor
                .unsupported_reason("metal")
                .contains("platform=iosurface")
        );
        assert!(
            descriptor
                .unsupported_reason("metal")
                .contains("sender=Syphon Camera")
        );
    }

    #[test]
    fn parses_camel_case_numeric_iosurface_handle_metadata() {
        let command = json!({
            "sharedHandle": 77,
            "sharedTexturePlatform": "iosurface",
            "sharedTextureFormat": "bgra8unorm",
            "handleEncoding": "integer",
            "handleByteLength": 4
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert_eq!(descriptor.platform, "iosurface");
        assert_eq!(descriptor.handle, "77");
        assert_eq!(descriptor.format, "bgra8unorm");
        assert_eq!(descriptor.handle_encoding, "integer");
        assert_eq!(descriptor.handle_chars, 2);
        assert_eq!(descriptor.handle_byte_length, Some(4));
        assert_eq!(descriptor.iosurface_id().unwrap(), 77);
    }

    #[test]
    fn parses_nested_numeric_iosurface_handle_metadata() {
        let command = json!({
            "shared_texture": {
                "handle": 91,
                "platform": "Syphon",
                "format": "rgba8unorm",
                "handleEncoding": "integer",
                "handleByteLength": 4
            }
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 640, 360).unwrap();

        assert_eq!(descriptor.platform, "iosurface");
        assert_eq!(descriptor.handle, "91");
        assert_eq!(descriptor.format, "rgba8unorm");
        assert_eq!(descriptor.handle_encoding, "integer");
        assert_eq!(descriptor.handle_byte_length, Some(4));
        assert_eq!(descriptor.iosurface_id().unwrap(), 91);
    }

    #[test]
    fn parses_iosurface_id_from_integer_handle() {
        let command = json!({
            "shared_handle": "42",
            "shared_texture_platform": "iosurface",
            "shared_texture_handle_encoding": "integer"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert_eq!(descriptor.iosurface_id().unwrap(), 42);
    }

    #[test]
    fn parses_iosurface_id_from_base64_handle() {
        let command = json!({
            "shared_handle": base64::engine::general_purpose::STANDARD.encode(42_u32.to_le_bytes()),
            "shared_texture_platform": "iosurface",
            "shared_texture_handle_encoding": "base64"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert_eq!(descriptor.iosurface_id().unwrap(), 42);
    }

    #[test]
    fn rejects_cross_process_iosurface_ref_pointer() {
        let command = json!({
            "shared_handle": base64::engine::general_purpose::STANDARD.encode(0x1234_u64.to_le_bytes()),
            "shared_texture_platform": "iosurface",
            "shared_texture_handle_encoding": "base64"
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1280, 720).unwrap();

        assert!(
            descriptor
                .iosurface_id()
                .unwrap_err()
                .contains("separate process")
        );
    }
}
