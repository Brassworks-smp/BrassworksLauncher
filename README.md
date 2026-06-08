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

To build and run the launcher locally, clone the repository and follow the setup steps below. Make sure you have Rust (1.88 or newer), Node.js 20+, pnpm, and a JDK installed before getting started.

```bash
cd frontend
pnpm install
pnpm tauri dev
pnpm tauri build
```

Useful checks:

```bash
cargo check --workspace
node node_modules/next/dist/bin/next build
```
