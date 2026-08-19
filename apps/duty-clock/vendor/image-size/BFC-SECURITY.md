# BFC image-size security backport

This package is based on `image-size` 1.2.1 and preserves its CommonJS API for
Metro. Its package version is intentionally above the vulnerable upstream range
because it includes local fixes for:

- GHSA-w3rx-r6r6-pgpr / CVE-2025-71330: reject ICNS entries whose declared
  length is zero, smaller than an entry header, or outside the input bounds.
- GHSA-5p2g-fcmc-qvqq / CVE-2025-71329: reject JXL/HEIF boxes smaller than the
  eight-byte box header, ensuring every accepted box advances the parser.

The upstream project had not published a patched npm release as at 18 August
2026. `scripts/test-image-size-security.mjs` exercises both malicious buffer
patterns and is part of the release audit.
