# Security Policy

## Scope

m-dashboard is designed to run locally. The Chat Server binds to `127.0.0.1` by default and protects API routes with a per-process token. Do not expose it on a network interface unless you add network-level access controls and use a strong, private token.

The full-access shell mode, MCP commands, browser automation, and configured model providers can access external resources by design. Treat workspace data, API keys, and imported conversation archives as sensitive local data.

## Reporting a vulnerability

Please do not disclose credentials or an exploitable vulnerability in a public issue. Use GitHub's private vulnerability reporting for this repository when available. Include the affected version, reproduction steps, impact, and any relevant logs with secrets removed.

For ordinary bugs and hardening suggestions that do not expose a vulnerability, open a regular issue with the smallest reproducible example.
