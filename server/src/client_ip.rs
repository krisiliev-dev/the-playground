//! Real client IP resolution behind a reverse proxy.
//!
//! In production the server sits behind Caddy, so every socket
//! peer is the proxy (the Docker bridge gateway, `172.17.0.1`).
//! Without this, the per-IP connection cap in `AppState` would
//! treat every visitor as the same IP and cap the whole site at
//! `MAX_CONNECTIONS_PER_IP`.
//!
//! `X-Forwarded-For` is only honoured when the socket peer is a
//! trusted proxy (the `TRUSTED_PROXIES` env var, comma-separated
//! IPs). Otherwise any client could spoof the header and dodge
//! the rate limit. Caddy appends the address it saw to the
//! header, so we walk it right-to-left, skipping trusted hops,
//! and take the first untrusted entry as the client.

use std::net::IpAddr;

use axum::http::HeaderMap;
use tracing::warn;

/// Parse `TRUSTED_PROXIES` (comma-separated IPs). Unparseable
/// entries are logged and skipped. Unset or empty ⇒ trust no
/// one, so the socket peer is always the client IP.
pub fn trusted_proxies_from_env() -> Vec<IpAddr> {
    std::env::var("TRUSTED_PROXIES")
        .map(|raw| parse_ip_list(&raw))
        .unwrap_or_default()
}

fn parse_ip_list(raw: &str) -> Vec<IpAddr> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| match s.parse() {
            Ok(ip) => Some(ip),
            Err(_) => {
                warn!(entry = s, "ignoring unparseable TRUSTED_PROXIES entry");
                None
            }
        })
        .collect()
}

/// Resolve the client IP for a request whose socket peer is
/// `peer`. Falls back to `peer` when it isn't trusted, the header
/// is missing, or every header entry is trusted / unparseable.
pub fn resolve(peer: IpAddr, headers: &HeaderMap, trusted: &[IpAddr]) -> IpAddr {
    if !trusted.contains(&peer) {
        return peer;
    }
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter_map(|s| s.trim().parse::<IpAddr>().ok())
        .find(|ip| !trusted.contains(ip))
        .unwrap_or(peer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const PROXY: &str = "172.17.0.1";
    const CLIENT: &str = "203.0.113.7";

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn xff(values: &[&str]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for v in values {
            h.append("x-forwarded-for", HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn untrusted_peer_ignores_header() {
        let h = xff(&["198.51.100.1"]);
        assert_eq!(resolve(ip(CLIENT), &h, &[ip(PROXY)]), ip(CLIENT));
    }

    #[test]
    fn no_trusted_proxies_ignores_header() {
        let h = xff(&[CLIENT]);
        assert_eq!(resolve(ip(PROXY), &h, &[]), ip(PROXY));
    }

    #[test]
    fn trusted_peer_uses_forwarded_client() {
        let h = xff(&[CLIENT]);
        assert_eq!(resolve(ip(PROXY), &h, &[ip(PROXY)]), ip(CLIENT));
    }

    #[test]
    fn spoofed_leftmost_entry_is_ignored() {
        // Client sent its own XFF; Caddy appended the real address.
        let h = xff(&["1.2.3.4, 198.51.100.9"]);
        assert_eq!(resolve(ip(PROXY), &h, &[ip(PROXY)]), ip("198.51.100.9"));
    }

    #[test]
    fn trusted_hops_are_skipped_across_header_lines() {
        let h = xff(&[CLIENT, "10.0.0.2"]);
        let trusted = [ip(PROXY), ip("10.0.0.2")];
        assert_eq!(resolve(ip(PROXY), &h, &trusted), ip(CLIENT));
    }

    #[test]
    fn missing_or_garbage_header_falls_back_to_peer() {
        assert_eq!(
            resolve(ip(PROXY), &HeaderMap::new(), &[ip(PROXY)]),
            ip(PROXY)
        );
        let h = xff(&["not-an-ip"]);
        assert_eq!(resolve(ip(PROXY), &h, &[ip(PROXY)]), ip(PROXY));
    }

    #[test]
    fn ipv6_client_is_supported() {
        let h = xff(&["2001:db8::1"]);
        assert_eq!(resolve(ip(PROXY), &h, &[ip(PROXY)]), ip("2001:db8::1"));
    }

    #[test]
    fn parse_ip_list_skips_blanks_and_garbage() {
        assert_eq!(
            parse_ip_list(" 172.17.0.1 , ,nope,::1"),
            vec![ip("172.17.0.1"), ip("::1")]
        );
    }
}
