//! Admin token verification for WebSocket connections.
//!
//! Per ADR-004, admin permissions ride on the same WebSocket as
//! the player connection. The token is presented at upgrade time
//! via the `?token=...` query parameter; we verify on the upgrade
//! handler before promoting the connection to admin status. The
//! per-connection `is_admin` flag then gates `EntityMutation`
//! messages in the inbound router.
//!
//! Why query param and not Authorization header: browsers don't
//! attach custom headers to WebSocket upgrades from JavaScript.
//! Cookies would also work but the token would have to be set
//! out-of-band, which is awkward for the admin-bearer-token
//! workflow. Query string is the pragmatic choice; the URL is
//! transmitted over TLS in production so the token isn't
//! exposed on the wire.
use std::collections::HashMap;

/// Decide whether a given upgrade request should receive admin
/// permissions. Empty `expected` ⇒ admin is permanently disabled
/// (any token attempt fails). Constant-time comparison guards
/// against timing attacks on token discovery.
pub fn is_admin(query: &HashMap<String, String>, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let Some(presented) = query.get("token") else {
        return false;
    };
    constant_time_eq(presented.as_bytes(), expected.as_bytes())
}

/// Constant-time byte-string equality. Avoids the early-exit
/// behaviour of `==` that leaks password length / prefix info
/// to a timing attacker.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query_with(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn matching_token_is_admin() {
        let q = query_with(&[("token", "secret")]);
        assert!(is_admin(&q, "secret"));
    }

    #[test]
    fn mismatched_token_is_not_admin() {
        let q = query_with(&[("token", "wrong")]);
        assert!(!is_admin(&q, "secret"));
    }

    #[test]
    fn missing_token_is_not_admin() {
        let q = query_with(&[]);
        assert!(!is_admin(&q, "secret"));
    }

    #[test]
    fn empty_expected_token_disables_admin() {
        let q = query_with(&[("token", "anything")]);
        assert!(!is_admin(&q, ""));
    }

    #[test]
    fn constant_time_eq_handles_length_mismatch() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b"abc"));
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(constant_time_eq(b"", b""));
    }
}
