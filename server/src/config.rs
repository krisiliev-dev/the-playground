//! Server configuration.
//!
//! All config values come from environment variables with sensible defaults.
//! This keeps the server 12-factor compliant and easy to configure per environment.

/// Server configuration.
#[allow(dead_code)]
pub struct Config {
    /// Port to listen on (default: 8080).
    pub port: u16,

    /// Allowed CORS origins (comma-separated, default: "*").
    pub allowed_origins: String,

    /// Maximum WebSocket connections total.
    pub max_connections: usize,

    /// Maximum WebSocket connections per IP.
    pub max_connections_per_ip: usize,
}

impl Config {
    /// Load configuration from environment variables.
    #[allow(dead_code)]
    pub fn from_env() -> Self {
        Self {
            port: env_var_or("PORT", "8080").parse().unwrap_or(8080),
            allowed_origins: env_var_or("ALLOWED_ORIGINS", "*"),
            max_connections: env_var_or("MAX_CONNECTIONS", "100").parse().unwrap_or(100),
            max_connections_per_ip: env_var_or("MAX_CONNECTIONS_PER_IP", "5")
                .parse()
                .unwrap_or(5),
        }
    }
}

/// Read an environment variable or return the default.
#[allow(dead_code)]
fn env_var_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
