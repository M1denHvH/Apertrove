# Security

Do not post access keys, active QR codes, photographs, serial numbers or unredacted logs in public issues.

The LAN remote uses a random bearer key and a restricted command allowlist. It uses HTTP/WebSocket on the selected private interface, without TLS. Use it on a trusted LAN. The app does not configure router forwarding or publish an Internet service. Stopping/restarting the server invalidates the previous key.

For a vulnerability, use **Security → Report a vulnerability** to send a private report if the repository has enabled it. If the option is unavailable, ask for a private channel in an issue and keep the technical details out of the issue.

Camera support depends on a separately installed proprietary Canon EDSDK. Keep that installation up to date through Canon. Packaged Windows builds are currently unsigned.
