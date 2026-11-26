//! Pairing token checks, the same rules as server/pairing.cjs.

use crate::js;

/// Crockford base32, as the desktop generates it.
const ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const TOKEN_LENGTH: usize = 16;
pub const PAIRING_QUERY_PARAM: &str = "pair";
pub const PAIRING_RESET_CLOSE_CODE: u16 = 4401;

/// `normalizePairingToken`: the canonical form of what someone presented, or
/// "" if it cannot be a token.
pub fn normalize(input: &str) -> String {
    if js::len16(input) > 64 {
        return String::new();
    }
    let token: String = input
        .to_uppercase()
        .chars()
        .filter(|&ch| !(js::is_js_space(ch) || ch == '-'))
        .map(|ch| match ch {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    if js::len16(&token) != TOKEN_LENGTH || !token.chars().all(|ch| ALPHABET.contains(ch)) {
        return String::new();
    }
    token
}

/// `tokensEqual`: constant time over the bytes, false for an empty secret.
pub fn tokens_equal(expected: Option<&str>, presented: Option<&str>) -> bool {
    let (Some(expected), Some(presented)) = (expected, presented) else {
        return false;
    };
    if expected.is_empty() {
        return false;
    }
    let a = expected.as_bytes();
    let b = presented.as_bytes();
    if a.len() != b.len() {
        // Same shape of work either way; the length is not the secret.
        let _ = constant_time_eq(a, a);
        return false;
    }
    constant_time_eq(a, b)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    std::hint::black_box(diff) == 0
}

/// `pairingTokenMatches`.
pub fn token_matches(expected: Option<&str>, presented: &str) -> bool {
    tokens_equal(expected, Some(&normalize(presented)))
}

/// `bearerToken`: the credentials of `Authorization: Bearer <token>`, or "".
/// The scheme is case-insensitive and only spaces and tabs separate it.
pub fn bearer_token(header: Option<&str>) -> String {
    let Some(header) = header else { return String::new() };
    let Some(prefix) = header.get(..6) else { return String::new() };
    if !prefix.eq_ignore_ascii_case("bearer") {
        return String::new();
    }
    let rest = &header[6..];
    let after_sep = rest.trim_start_matches([' ', '\t']);
    if after_sep.len() == rest.len() {
        return String::new();
    }
    let value = after_sep.trim_end_matches([' ', '\t']);
    if value.is_empty() || value.chars().any(js::is_js_space) {
        return String::new();
    }
    value.to_string()
}

/// `readCookie`: the first cookie of that name, trimmed.
pub fn read_cookie(header: Option<&str>, name: &str) -> String {
    let Some(header) = header else { return String::new() };
    if name.is_empty() {
        return String::new();
    }
    for part in header.split(';') {
        if let Some(eq) = part.find('=')
            && eq > 0 && part[..eq].trim_matches(js::is_js_space) == name {
                return part[eq + 1..].trim_matches(js::is_js_space).to_string();
            }
    }
    String::new()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Percent-decoding as URLSearchParams does it: `+` is a space, a `%` not
/// followed by two hex digits stays as it is, and the bytes are read as UTF-8.
fn form_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' => {
                if let (Some(h), Some(l)) = (
                    bytes.get(i + 1).copied().and_then(hex),
                    bytes.get(i + 2).copied().and_then(hex),
                ) {
                    out.push(h * 16 + l);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The query of a request target, as `new URL(target, base).search` has it.
pub fn query_of(target: &str) -> &str {
    let target = target.split('#').next().unwrap_or("");
    match target.find('?') {
        Some(at) => &target[at + 1..],
        None => "",
    }
}

/// `searchParams.get(name)`: the first value of that name.
pub fn query_param(target: &str, name: &str) -> Option<String> {
    for pair in query_of(target).split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if form_decode(key) == name {
            return Some(form_decode(value));
        }
    }
    None
}

/// `searchParams.has(name)`.
pub fn query_has(target: &str, name: &str) -> bool {
    query_of(target).split('&').any(|pair| !pair.is_empty() && form_decode(pair.split_once('=').map_or(pair, |(k, _)| k)) == name)
}

/// `presentedPairingToken`: the Authorization header, then `?pair=`, then,
/// only where `cookie_name` is given, that cookie.
pub fn presented_token(authorization: Option<&str>, target: &str, cookie: Option<&str>, cookie_name: Option<&str>) -> String {
    let from_header = bearer_token(authorization);
    if !from_header.is_empty() {
        return from_header;
    }
    let from_query = query_param(target, PAIRING_QUERY_PARAM).unwrap_or_default();
    if !from_query.is_empty() {
        return from_query;
    }
    match cookie_name {
        Some(name) => read_cookie(cookie, name),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "ABCD0EFGH1JKMN2P";

    #[test]
    fn normalizes_what_people_type() {
        assert_eq!(normalize("abcd-oefg-h1jk-mn2p"), TOKEN);
        assert_eq!(normalize(" ABCD OEFG HIJK MN2P "), TOKEN);
        assert_eq!(normalize("abcd0efgh1jkmn2"), "");
        assert_eq!(normalize("ABCD0EFGH1JKMN2U"), "");
        assert_eq!(normalize(&"A".repeat(65)), "");
        // Unicode upper-casing, as toUpperCase does it: dotless i is I is 1.
        assert_eq!(normalize("ABCD0EFGH\u{131}JKMN2P"), TOKEN);
    }

    #[test]
    fn compares_tokens() {
        assert!(tokens_equal(Some(TOKEN), Some(TOKEN)));
        assert!(!tokens_equal(Some(""), Some("")));
        assert!(!tokens_equal(None, Some(TOKEN)));
        assert!(!tokens_equal(Some(TOKEN), Some("ABCD")));
        assert!(token_matches(Some(TOKEN), "abcd0efgh1jkmn2p"));
        assert!(!token_matches(Some(TOKEN), ""));
    }

    #[test]
    fn finds_the_token_where_the_js_server_does() {
        assert_eq!(bearer_token(Some("Bearer abc")), "abc");
        assert_eq!(bearer_token(Some("bearer \t abc \t")), "abc");
        assert_eq!(bearer_token(Some("Bearerabc")), "");
        assert_eq!(bearer_token(Some("Bearer a b")), "");
        assert_eq!(bearer_token(Some("Basic abc")), "");
        assert_eq!(read_cookie(Some("a=1; ga_pair_9002= X ; ga_pair_9002=Y"), "ga_pair_9002"), "X");
        assert_eq!(read_cookie(Some("=x; b"), "b"), "");
        assert_eq!(query_param("/?pair=a%2Bb+c&pair=2", "pair").as_deref(), Some("a+b c"));
        assert_eq!(query_param("/x?a=1#pair=2", "pair"), None);
        assert_eq!(query_param("/x?pair", "pair").as_deref(), Some(""));
        assert_eq!(query_param("/x?pair=%ZZ", "pair").as_deref(), Some("%ZZ"));
        assert_eq!(presented_token(Some("Bearer H"), "/?pair=Q", Some("c=C"), Some("c")), "H");
        assert_eq!(presented_token(Some("Basic H"), "/?pair=Q", Some("c=C"), Some("c")), "Q");
        assert_eq!(presented_token(None, "/", Some("c=C"), Some("c")), "C");
        assert_eq!(presented_token(None, "/", Some("c=C"), None), "");
    }
}
