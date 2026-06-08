<div align="center">

# Brassworks Launcher

The official launcher for the Brassworks SMP. Built with Rust and Tauri under the hood, plus a Next.js frontend, it makes installing, managing, and launching our custom modpack as simple as possible.

---

## Technical Architecture

To keep the launcher fast and reliable, it builds on existing open-source projects while making significant changes and improvements behind the scenes.

- Built on top of [portablemc](https://github.com/theorzr/portablemc).
- Includes a rewrite of the [packwiz](https://github.com/packwiz/packwiz) installer logic implemented in Rust.

---

## Screenshots

<p align="center">
  <img src="assets/img_2.png" alt="Main Menu" width="60%">
</p>

<p align="center">
  <img src="assets/img.png" alt="Add Content" width="60%">
</p>

<p align="center">
  <img src="assets/img_1.png" alt="Settings" width="60%">
</p>

</div>

---

## Development

The project is a Cargo workspace (Rust crates in `crates/` plus the Tauri shell in `frontend/src-tauri/`) with a Next.js frontend in `frontend/`.

### Prerequisites

- **Rust** 1.88 or newer
- **Node.js** 20 or newer
- **pnpm**

On Linux you also need the Tauri/WebKitGTK system libraries - `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf`.

### To run the app

```bash
cd frontend
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the Next.js dev server and the Tauri window together; it rebuilds on changes to both the Rust and frontend code.

### Build installers

```bash
cd frontend
pnpm tauri build
```

The output is written to `target/release/bundle/`

### Quick checks

```bash
cargo check --workspace
node node_modules/next/dist/bin/next build
```

The frontend is built via `node …/next build` rather than `pnpm build` to sidestep a pnpm script-runner quirk that re-runs `install` and fails.