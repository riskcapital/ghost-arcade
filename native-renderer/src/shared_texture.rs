use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SharedTextureSourceFrameDescriptor {
    pub platform: String,
    pub format: String,
    pub handle_encoding: String,
    pub handle_chars: usize,
    pub handle_byte_length: Option<u64>,
    pub width: u32,
    pub height: u32,
}

impl SharedTextureSourceFrameDescriptor {
    pub fn from_command(command: &Value, width: usize, height: usize) -> Option<Self> {
        let shared_texture = command.get("shared_texture");
        let handle = string_at(command, "shared_handle")
            .or_else(|| string_at(command, "handle"))
            .or_else(|| nested_string_at(shared_texture, "handle"))
            .or_else(|| shared_texture.and_then(Value::as_str))?;

        Some(Self {
            platform: normalize_platform(
                string_at(command, "shared_texture_platform")
                    .or_else(|| string_at(command, "platform"))
                    .or_else(|| nested_string_at(shared_texture, "platform"))
                    .unwrap_or("unknown"),
            ),
            format: string_or_number_at(command, "shared_texture_format")
                .or_else(|| string_or_number_at(command, "format"))
                .or_else(|| nested_string_or_number_at(shared_texture, "format"))
                .unwrap_or_else(|| "unknown".to_string()),
            handle_encoding: normalize_handle_encoding(
                string_at(command, "shared_texture_handle_encoding")
                    .or_else(|| string_at(command, "handle_encoding"))
                    .or_else(|| nested_string_at(shared_texture, "handle_encoding"))
                    .or_else(|| nested_string_at(shared_texture, "encoding"))
                    .unwrap_or("opaque"),
            ),
            handle_chars: handle.len(),
            handle_byte_length: number_at(command, "shared_texture_handle_byte_length")
                .or_else(|| number_at(command, "handle_byte_length"))
                .or_else(|| nested_number_at(shared_texture, "handle_byte_length")),
            width: width.min(u32::MAX as usize) as u32,
            height: height.min(u32::MAX as usize) as u32,
        })
    }

    pub fn unsupported_reason(&self, backend: &str) -> String {
        format!(
            "shared texture source-frame upload is not implemented yet \
             (backend={backend}, platform={}, format={}, size={}x{}, handle_encoding={}, handle_chars={}, declared_bytes={})",
            self.platform,
            self.format,
            self.width,
            self.height,
            self.handle_encoding,
            self.handle_chars,
            self.handle_byte_length
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        )
    }
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
            "shared_texture_handle_byte_length": 8
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 1920, 1080).unwrap();

        assert_eq!(descriptor.platform, "dxgi");
        assert_eq!(descriptor.format, "87");
        assert_eq!(descriptor.handle_encoding, "base64");
        assert_eq!(descriptor.handle_chars, 8);
        assert_eq!(descriptor.handle_byte_length, Some(8));
        assert_eq!(descriptor.width, 1920);
        assert_eq!(descriptor.height, 1080);
    }

    #[test]
    fn parses_nested_iosurface_handle_metadata() {
        let command = json!({
            "shared_texture": {
                "handle": "42",
                "platform": "Syphon",
                "format": "bgra8unorm",
                "encoding": "integer",
                "handle_byte_length": 4
            }
        });

        let descriptor =
            SharedTextureSourceFrameDescriptor::from_command(&command, 4096, 2160).unwrap();

        assert_eq!(descriptor.platform, "iosurface");
        assert_eq!(descriptor.format, "bgra8unorm");
        assert_eq!(descriptor.handle_encoding, "integer");
        assert_eq!(descriptor.handle_chars, 2);
        assert_eq!(descriptor.handle_byte_length, Some(4));
        assert!(
            descriptor
                .unsupported_reason("metal")
                .contains("platform=iosurface")
        );
    }
}
