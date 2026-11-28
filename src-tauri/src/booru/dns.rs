use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::ACCEPT;
use serde_json::Value;
use std::error::Error;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

type BoxError = Box<dyn Error + Send + Sync>;

const DOH_ENDPOINT: &str = "https://1.1.1.1/dns-query";

#[derive(Clone)]
pub(crate) struct SecureDns {
    client: reqwest::Client,
    endpoint: String,
}

impl SecureDns {
    pub(crate) fn new() -> Self {
        Self::with_endpoint(DOH_ENDPOINT.into())
    }

    fn with_endpoint(endpoint: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
            endpoint,
        }
    }

    async fn over_https(&self, host: &str) -> Result<Vec<SocketAddr>, reqwest::Error> {
        let answer: Value = self
            .client
            .get(&self.endpoint)
            .query(&[("name", host), ("type", "A")])
            .header(ACCEPT, "application/dns-json")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(answer["Answer"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|record| record["data"].as_str()?.parse::<IpAddr>().ok())
            .map(|ip| SocketAddr::new(ip, 0))
            .collect())
    }
}

async fn system_lookup(host: String) -> Result<Addrs, BoxError> {
    let addrs = tauri::async_runtime::spawn_blocking(move || (host.as_str(), 0).to_socket_addrs())
        .await??;
    Ok(Box::new(addrs))
}

impl Resolve for SecureDns {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.clone();
        let host = name.as_str().to_string();
        Box::pin(async move {
            match resolver.over_https(&host).await {
                Ok(addrs) if !addrs.is_empty() => Ok(Box::new(addrs.into_iter()) as Addrs),
                _ => system_lookup(host).await,
            }
        })
    }
}

pub(crate) fn describe(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !parts.iter().any(|part| part.contains(&text)) {
            parts.push(text);
        }
        source = cause.source();
    }
    let reason = if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "could not connect"
    } else {
        "failed"
    };
    format!("{reason}: {}", parts.join(": "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::str::FromStr;

    fn serve_once(body: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/dns-query", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 4096]).unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/dns-json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        url
    }

    #[test]
    fn resolves_a_records_from_dns_json() {
        let endpoint = serve_once(
            r#"{"Status":0,"Answer":[{"type":5,"data":"cdn.example.test."},{"type":1,"data":"203.0.113.7"}]}"#,
        );
        let resolver = SecureDns::with_endpoint(endpoint);
        let addrs: Vec<_> = tauri::async_runtime::block_on(
            resolver.resolve(Name::from_str("example.test").unwrap()),
        )
        .unwrap()
        .collect();
        assert_eq!(addrs, [SocketAddr::from(([203, 0, 113, 7], 0))]);
    }

    #[test]
    fn falls_back_to_system_dns_without_answers() {
        let endpoint = serve_once(r#"{"Status":3}"#);
        let resolver = SecureDns::with_endpoint(endpoint);
        let addrs: Vec<_> =
            tauri::async_runtime::block_on(resolver.resolve(Name::from_str("localhost").unwrap()))
                .unwrap()
                .collect();
        assert!(addrs.iter().any(|addr| addr.ip().is_loopback()));
    }

    #[test]
    fn describes_refused_connection_cause() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let error = reqwest::blocking::Client::new()
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .unwrap_err();
        let message = describe(error);
        assert!(message.starts_with("could not connect: error sending request: "));
        assert!(message.len() > "could not connect: error sending request: ".len());
    }
}
