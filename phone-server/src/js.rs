//! The few JavaScript rules the remote server's checks depend on, so a value
//! the JS server accepts or refuses is accepted or refused here too: string
//! length in UTF-16 units, `===`, truthiness, `Number.isInteger`, `\s`, and
//! what a property read or write on `null` or a primitive does in strict mode.

use serde_json::{Map, Value};

/// `str.length`.
pub fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The first `n` UTF-16 units of `s` (`str.slice(0, n)`), never splitting a
/// character in two (a lone half would not survive as UTF-8).
pub fn slice16(s: &str, n: usize) -> String {
    let mut out = String::new();
    let mut used = 0;
    for ch in s.chars() {
        let w = ch.len_utf16();
        if used + w > n {
            break;
        }
        used += w;
        out.push(ch);
    }
    out
}

/// JavaScript `\s`: WhiteSpace plus LineTerminator. Not Rust's
/// `char::is_whitespace`, which adds U+0085 and leaves out U+FEFF.
pub fn is_js_space(ch: char) -> bool {
    matches!(
        ch,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// `\w` in a JavaScript regular expression without the `u` flag.
pub fn is_word(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

/// `!!value`, with `None` standing for `undefined`.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `a === b` for two values that were parsed separately (so two objects are
/// never the same object).
pub fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        _ => false,
    }
}

/// `Number.isInteger(v) ? v : undefined`.
pub fn integer(v: Option<&Value>) -> Option<f64> {
    let f = v?.as_f64()?;
    (f.is_finite() && f.fract() == 0.0).then_some(f)
}

pub fn string(v: Option<&Value>) -> Option<&str> {
    v?.as_str()
}

/// `typeof v === 'object' && v !== null && !Array.isArray(v)`.
pub fn plain_object(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v?.as_object()
}

/// A TypeError the JS server would have thrown (and so stopped handling the
/// message) reading or writing a property of `null` or `undefined`, or
/// writing one on a primitive in strict mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypeError;

/// `v.key`: a TypeError on `null`/`undefined`, `undefined` on a primitive.
pub fn get<'a>(v: Option<&'a Value>, key: &str) -> Result<Option<&'a Value>, TypeError> {
    match v {
        None | Some(Value::Null) => Err(TypeError),
        Some(Value::Object(map)) => Ok(map.get(key)),
        Some(_) => Ok(None),
    }
}

/// `v.key = value` (or `delete`-like removal when `value` is `undefined`,
/// which JSON.stringify leaves out the same way).
pub fn set(v: &mut Value, key: &str, value: Option<Value>) -> Result<(), TypeError> {
    match v {
        Value::Object(map) => {
            match value {
                Some(value) => {
                    map.insert(key.to_string(), value);
                }
                None => {
                    // An own property set to undefined keeps its place but is
                    // not serialized; removing it serializes the same.
                    map.shift_remove(key);
                }
            }
            Ok(())
        }
        // A named property on an array is real but JSON.stringify drops it.
        Value::Array(_) => Ok(()),
        _ => Err(TypeError),
    }
}

/// `{ ...v }` for whatever `v` is.
pub fn spread(v: Option<&Value>) -> Map<String, Value> {
    let mut out = Map::new();
    match v {
        Some(Value::Object(map)) => {
            for (k, val) in map {
                out.insert(k.clone(), val.clone());
            }
        }
        Some(Value::Array(items)) => {
            for (i, val) in items.iter().enumerate() {
                out.insert(i.to_string(), val.clone());
            }
        }
        Some(Value::String(s)) => {
            for (i, unit) in s.encode_utf16().enumerate() {
                out.insert(i.to_string(), Value::String(String::from_utf16_lossy(&[unit])));
            }
        }
        _ => {}
    }
    out
}

/// `value.length` compared with `> 0`, as the greeting does for the caches.
pub fn has_length(v: &Value) -> bool {
    match v {
        Value::Array(items) => !items.is_empty(),
        Value::String(s) => !s.is_empty(),
        Value::Object(map) => match map.get("length") {
            Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f > 0.0),
            Some(Value::String(s)) => s.trim().parse::<f64>().is_ok_and(|f| f > 0.0),
            Some(Value::Bool(true)) => true,
            _ => false,
        },
        _ => false,
    }
}

/// `String(n)` for a JSON number.
pub fn number_to_string(n: &serde_json::Number) -> String {
    if n.is_i64() || n.is_u64() {
        return n.to_string();
    }
    let f = n.as_f64().unwrap_or(0.0);
    if f == 0.0 {
        return "0".into();
    }
    let abs = f.abs();
    if (1e-6..1e21).contains(&abs) {
        // Rust's Display is the shortest round-trip form without an
        // exponent, which is what JavaScript prints in this range.
        let s = format!("{f}");
        return s;
    }
    // Exponent form: JavaScript writes 1e+21 and 1e-7.
    let s = format!("{f:e}");
    match s.split_once('e') {
        Some((mantissa, exp)) if !exp.starts_with('-') => format!("{mantissa}e+{exp}"),
        _ => s,
    }
}

/// `String(v)`.
pub fn to_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => number_to_string(n),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => to_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// `str.replace(/[^allowed]/g, '_')` applied per UTF-16 unit, as JavaScript
/// does: a character outside the BMP becomes two underscores.
pub fn replace_units(s: &str, allowed: impl Fn(char) -> bool, with: char) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if allowed(ch) {
            out.push(ch);
        } else {
            for _ in 0..ch.len_utf16() {
                out.push(with);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lengths_are_utf16() {
        assert_eq!(len16("a\u{1F600}"), 3);
        assert_eq!(slice16("ab\u{1F600}c", 3), "ab");
    }

    #[test]
    fn whitespace_matches_javascript() {
        assert!(is_js_space('\u{FEFF}'));
        assert!(!is_js_space('\u{85}'));
    }

    #[test]
    fn numbers_print_like_javascript() {
        let n = |v: Value| number_to_string(v.as_number().unwrap());
        assert_eq!(n(json!(1.5)), "1.5");
        assert_eq!(n(json!(2)), "2");
        assert_eq!(n(json!(1e21)), "1e+21");
        assert_eq!(n(json!(1e-7)), "1e-7");
        assert_eq!(to_string(Some(&json!([1, null, "a"]))), "1,,a");
    }

    #[test]
    fn property_access_follows_strict_mode() {
        assert_eq!(get(Some(&Value::Null), "x"), Err(TypeError));
        assert_eq!(get(Some(&json!(5)), "x"), Ok(None));
        let mut v = json!(5);
        assert_eq!(set(&mut v, "x", Some(json!(1))), Err(TypeError));
        assert!(strict_eq(None, None));
        assert!(strict_eq(Some(&json!(1)), Some(&json!(1.0))));
        assert!(!strict_eq(Some(&json!({})), Some(&json!({}))));
        assert_eq!(integer(Some(&json!(2.0))), Some(2.0));
        assert_eq!(integer(Some(&json!(2.5))), None);
    }
}
