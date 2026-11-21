# What has changed

## Current development source

The source still identifies itself as **0.10.3**. These changes follow the published archive and are not a new downloadable release:

- Live View uses one small histogram icon; the existing graph opens only when requested.
- One AF control combines One Shot and AI Servo. Shutter requests can proceed with active Servo and wait for a short mode transition when needed.
- Preview orientation follows current EVF camera data on supported combinations, with manual 90° rotation and a return to automatic orientation.
- Camera arrivals keep their session context. Ambiguous delayed transfers can be assigned in Library without moving originals.
- The public guides and demo screenshot gallery describe the current workspace.

Camera behavior also has automated fake-provider coverage. This proves application paths and error handling, not physical behavior on every camera. See [Camera support](COMPATIBILITY.md). Mechanical flash pop-up and dedicated BULB remain unavailable.

## Published 0.10.3

The [Windows portable release dated 14 November 2026](https://github.com/M1denHvH/Apertrove/releases/tag/Release) is a separate snapshot with the desktop workspace, sessions, Library, Live View tools, Shot Inspector, Lighting Studio and LAN remote.

Download its Windows x64 ZIP and accompanying checksum file together. Extract the whole folder and install Canon components separately. [Installation](INSTALLATION.md)

[Documentation](README.md) · [Project overview](../README.md)
