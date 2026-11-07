# Wireshark capture and analysis

Use synthetic test files for packet inspection. Do not capture or transmit real biometric samples over plain HTTP on a shared network.

## Localhost capture on Linux

1. Start the receiver from the project root:

   ```bash
   npm start
   ```

2. Open Wireshark and select the **loopback (`lo`)** interface. Start the capture.
3. Enter this display filter:

   ```text
   tcp.port == 5000
   ```

4. In another terminal, send a synthetic file:

   ```bash
   node sender/client.js sender/sample.txt
   ```

5. Stop the capture after the receiver returns its JSON response.
6. Select a TCP packet and use **Follow → TCP Stream**. With this project's HTTP endpoint, request headers and payload framing may be visible in plaintext. Avoid taking screenshots that expose private file content.

## What to inspect

- The TCP connection setup (SYN, SYN/ACK, ACK) and connection teardown.
- HTTP `POST /api/biometric/upload` request and response.
- TCP sequence/acknowledgement numbers and advertised receive windows.
- Retransmissions, duplicate ACKs, or resets, if present.
- The relationship between request payload size and the number of TCP segments.

Do not claim that a retransmission occurred unless it is visible in the capture. A clean localhost test may show no retransmissions.

## Optional terminal capture

If `tshark` is installed, capture loopback traffic to a local file:

```bash
sudo tshark -i lo -f 'tcp port 5000' -w biometric-localhost-test.pcapng
```

Stop it with `Ctrl+C`, then inspect the capture with:

```bash
tshark -r biometric-localhost-test.pcapng -Y 'tcp.port == 5000'
```

Keep packet captures local. They can contain transmitted payload bytes and metadata.

## If the assignment requires two devices

Ask the instructor whether localhost evidence is accepted. If a physical LAN test is required, use only an approved isolated lab network, set the receiver's `HOST=0.0.0.0`, and set the sender's `SERVER_URL` to the receiver's LAN address. Restrict access with the lab's approved controls. HTTP does not encrypt biometric data; use only synthetic data unless the institution explicitly provides an approved secure transport and handling procedure.

## Evidence checklist

- Screenshot showing `lo` and the `tcp.port == 5000` display filter.
- Screenshot showing the HTTP POST and a corresponding receiver response.
- One paragraph describing the TCP handshake and observed transfer.
- Any retransmission/duplicate-ACK observation, or explicitly state that none was observed.
- Label the result **localhost/loopback**. Do not present localhost measurements as Wi-Fi/Ethernet performance.
