# Third-party notices and source references

The Windows x64 bundle includes Sharp 0.35.5 and its dynamically loaded libvips 8.18.7 DLLs from `@img/sharp-win32-x64@0.35.5`. See [the package’s notices](sharp-win32-x64-notices.md), [its version inventory](sharp-win32-x64-versions.json), and [the upstream libvips packaging notices](libvips-notices.md). The relevant license texts are [LGPL 3.0](LGPL-3.0.txt) and [GPL 3.0](GPL-3.0.txt).

- [Sharp source v0.35.5](https://github.com/lovell/sharp/tree/v0.35.5)
- [Sharp libvips packaging v1.3.4](https://github.com/lovell/sharp-libvips/tree/v1.3.4) and its [exact dependency versions](https://github.com/lovell/sharp-libvips/blob/v1.3.4/versions.properties)
- [Windows libvips build v8.18.7](https://github.com/libvips/build-win64-mxe/tree/v8.18.7) with the input sources and patches for this build
- [libvips 8.18.7 source archives](https://github.com/libvips/libvips/releases/tag/v8.18.7)

The application loads the libraries from the unpacked native Sharp package. The applicable licenses govern replacing the LGPL libraries with compatible builds and debugging modifications to them. Preserve the corresponding source access and build materials when redistributing this bundle.
