# FigOne

FigOne is a Windows desktop application for generating and editing academic figures. The repository contains the Tauri desktop shell, FastAPI engine, web interface, and the SAM3 integration used by the local image workflow.

## Project layout

```text
├── engine/                 FastAPI engine, image workflow, web UI, and SAM3 source
│   ├── server.py
│   ├── autofigure2.py
│   ├── web/
│   └── sam3-src/
└── src-tauri/              Tauri 2 Windows desktop shell
```

## Development

Run the desktop application in development mode:

```bash
npx @tauri-apps/cli dev --config src-tauri/tauri.conf.json
```

## Releases

Pushing a tag matching `v*` runs the GitHub Actions release workflow. It builds a Windows x64 NSIS installer with a bundled CPU Python runtime and publishes the installer in a GitHub Release.

The SAM3 model checkpoint is not included. Users import their own `sam3.pt` file after installing FigOne.
