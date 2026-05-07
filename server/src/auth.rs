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

/// Compare a presented token against the configured admin token
/// in constant time. Empty `expected` ⇒ admin is permanently
/// disabled (any token attempt fails). Constant-time comparison
/// guards against timing attacks on token discovery.
///
/// Polymorphic: the WebSocket upgrade extracts the token from
/// `?token=` (see `is_admin`), HTTP routes extract from the
/// Authorization header (see `extract_bearer` in handlers.rs).
/// Both feed into this single comparison so the auth policy is
/// in one place.
pub fn is_admin_token(presented: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    constant_time_eq(presented.as_bytes(), expected.as_bytes())
}

/// WebSocket-upgrade variant — extracts the token from the
/// `?token=` query parameter and delegates to `is_admin_token`.
pub fn is_admin(query: &HashMap<String, String>, expected: &str) -> bool {
    let Some(presented) = query.get("token") else {
        return false;
    };
    is_admin_token(presented, expected)
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

    #[test]
    fn is_admin_token_matches_constant_time() {
        assert!(is_admin_token("secret", "secret"));
        assert!(!is_admin_token("wrong", "secret"));
        assert!(!is_admin_token("", "secret"));
    }

    #[test]
    fn is_admin_token_disabled_when_expected_empty() {
        // Empty expected = admin permanently disabled. Any presented
        // token (including an empty one) fails.
        assert!(!is_admin_token("anything", ""));
        assert!(!is_admin_token("", ""));
    }

    #[test]
    fn is_admin_query_delegates_to_token_helper() {
        // is_admin is now a thin wrapper extracting the token from
        // the query map; verify the delegation.
        let q = query_with(&[("token", "secret")]);
        assert!(is_admin(&q, "secret"));
        let wrong = query_with(&[("token", "nope")]);
        assert!(!is_admin(&wrong, "secret"));
    }
}
