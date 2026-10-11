# DhakaFlix BDIX Plugin for Nuvio

A high-speed scraper plugin for Nuvio to stream Movies, TV Series, Anime, and Cartoons directly from the DhakaFlix BDIX FTP / HTTP server.

## Features
- **All Servers Covered**:
  - `http://172.16.50.7/` — English Movies (720p), Kolkata Bangla Movies, Foreign Movies, 3D
  - `http://172.16.50.10/` — Anime & Cartoon TV Series, Documentaries, WWE
  - `http://172.16.50.12/` — Mainstream TV & Web Series
  - `http://172.16.50.14/` — English Movies (1080p), Animation Movies (720p & 1080p), Hindi & South Indian Movies, Korean Series
- **Dual & Multi-Audio Detection**: Correctly identifies Hindi, English, Japanese, and Bangla audio tracks.
- **Two-Stage Traversal**: Resolves anime with Romaji filenames and season directories automatically.
- **Zero Authentication**: Works directly with BDIX byte-range streaming in Nuvio's native MPV player.

## How to Install in Nuvio

### Method 1: Host on GitHub / Codeberg (Recommended)
1. Push this folder to a GitHub or Codeberg repository.
2. Get the raw link to `manifest.json` (e.g., `https://raw.githubusercontent.com/<username>/dhakaflix-plugin/main/manifest.json`).
3. Open Nuvio $\rightarrow$ **Settings** $\rightarrow$ **Plugins** $\rightarrow$ **Add Repository** and paste the raw manifest URL.

### Method 2: Local Host (Instant testing)
1. In a terminal, run:
   ```powershell
   npx serve e:\Github\dhakaflix-plugin -p 8080
   ```
2. Open Nuvio $\rightarrow$ **Settings** $\rightarrow$ **Plugins** $\rightarrow$ **Add Repository**.
3. Paste: `http://localhost:8080/manifest.json`
