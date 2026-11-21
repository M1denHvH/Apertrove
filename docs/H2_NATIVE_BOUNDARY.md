# EOS 2000D H2 native boundary

This bounded experiment extends the recorded H1 reads to exposure controls and EVF JPEG preview. It does not authorize capture, camera-file transfers, destination changes, callbacks, firmware or H3. The original H1 receipts remain unchanged, including the aggregate UNKNOWN and its separate signed GPU-module review.

## Narrow ABI evidence

The Canon API Reference 13.20.11 already identified in [HARDWARE_ABI_QUALIFICATION.md](HARDWARE_ABI_QUALIFICATION.md), SHA-256 `71c3686452af13e66ffe7bc95e40f84264d7a368288d5231ccd6999fe27bdc2b`, documents EVF image creation/download (§3.1.30–31, pp63–64), memory-stream creation with UInt64 capacity (§3.1.34, pp66–67), borrowed `void**` stream pointers (§3.1.36, pp67–68), and signed Int64 seek/UInt64 position and length outputs (§3.1.39–41, pp69–71). These match the existing Windows x64 Koffi bindings. UInt64 results must be checked for exact representability before conversion to Number.

EVF OutputDevice `0x500` and Mode `0x501` are four-byte UInt32 properties (§5.2.54–55, pp138–139); PC output is bit `2`. The labeled archived declarations cited in the H1 qualification corroborate AF command `0x102` with ON `1` / OFF `0`, and lens drive `0x103` with Near1 `1` / Far1 `0x8001`. Command `4` is a shutter command and is excluded, including its viewfinder AF half-press use.

An owned EVF image and memory stream must be released in that order. GetPointer returns borrowed memory: never release that pointer. Copy only synchronously from the current stream after a successful frame download, using a positive safe integer length no larger than 20 MiB or the current GetLength value, into an exact-size V8 Buffer. A subsequent download can invalidate the borrowed pointer. ObjectNotReady `0xa102` permits bounded EVF polling; BUSY must not cause a blind command retry.

## Controls without capture setup

The ordinary working connection registers camera event handlers and configures SaveTo/Capacity. It cannot be used for this experiment. An explicit controls-only connection permits exposure/EVF controls while capture, imports, destination setup and Canon callback registration remain disabled. Read-only diagnostics retain their original write prohibition.

The invocation fence admits writes only to ISO `0x402`, Av `0x405`, Tv `0x406`, and the two EVF properties. It records fresh values and descriptors, one supported alternative per exposure property, read-back, restoration and final read-back. White balance, Kelvin availability, mode dial and SaveTo are read-only. Missing original state prevents the corresponding mutation. Restoration failure stops the series and remains visible in the final report.

AF is limited to one already-live ON/OFF cycle and, when the current lens/AF guards permit it, one Near1/Far1 pair. The H1 FocusInfo size of 33720 is compatible with the newer reference capacity of 1053 points; size alone does not prove the legacy parser is wrong. Its selected/justFocus interpretation is insufficiently qualified for focus confirmation. Controls-only mode therefore does not use that parser to claim AF success. A successful command is reported separately from the unverified optical result.

## Evidence and limits

Use the existing production EVF stream, renderer JPEG decode/canvas and software RGB histogram, without another capture pipeline. Histogram sampling remains bounded to approximately 250 ms and 160×120 pixels. Record actual frame counts, dimensions, observation duration and available timestamps; wall-clock transport estimates are not optical or shutter latency measurements.

One isolated Electron/worker tree runs under independent Job supervision with source/runtime/addon pins and a bounded series deadline. A consumed manifest cannot be reused. Preserve raw codes, before/after state, stream ownership, DLL/COM receipts, process exits and module observations. Known signed GPU-driver observations are pinned and attributed to the GPU process; they do not authorize arbitrary DriverStore modules in the camera worker. Crash, UNKNOWN, unacknowledged refs, unexpected capture or failed restoration stop the series without an automatic hardware retry.
