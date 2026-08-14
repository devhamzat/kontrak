# Installing Kontrak

The CLI is the primary distribution. The Chrome DevTools extension is an optional
companion distributed through GitHub Releases until Chrome Web Store distribution
is practical.

## CLI

After the first npm release:

```sh
npm install --global @kontrak/cli
kontrak --help
```

Every GitHub Release also contains a CLI `.tgz`. Install it without npm registry
publication:

```sh
npm install --global ./kontrak-cli-0.1.0.tgz
```

Node.js 20.19 or newer is required.

## Chrome DevTools extension

1. Download `kontrak-extension-vX.Y.Z.zip` from the project's GitHub Release.
2. Verify its SHA-256 digest against `SHA256SUMS.txt` when possible.
3. Extract the ZIP to a permanent local folder. Do not delete that folder while
   the extension is installed.
4. Open `chrome://extensions`.
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the extracted folder containing
   `manifest.json`.
7. Open DevTools on a page and select the **Kontrak** panel.

Chrome does not automatically update manually installed extensions. Download and
load each new release from the same folder, then select the extension's reload
button on `chrome://extensions`.

## Building locally

```sh
npm ci
npm run check
npm run build
```

Load the generated root `dist` folder as an unpacked extension. Build and pack the
standalone CLI with:

```sh
npm run build --workspace @kontrak/cli
npm pack --workspace @kontrak/cli
```

## Security and privacy

Install only artifacts from the official repository release page. Kontrak validates
locally by default. Optional cloud synchronization excludes request/response
bodies, headers, query strings, and diagnostic prose.
