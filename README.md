# DhakaFlix BDIX Plugin for Nuvio

A high-speed scraper plugin for Nuvio to stream Movies, TV Series, Anime, and Cartoons directly from the DhakaFlix BDIX FTP / HTTP server.

## Features

- **Full BDIX Server Coverage**:
  - `http://172.16.50.7/` — English Movies (720p), Kolkata Bangla Movies, Foreign Movies, 3D
  - `http://172.16.50.10/` — Anime & Cartoon TV Series
  - `http://172.16.50.12/` — Mainstream TV & Web Series
  - `http://172.16.50.14/` — English Movies (1080p), Animation Movies (720p & 1080p), Hindi & South Indian Movies, Korean Series
- **Franchise Disambiguation & Sequel Isolation**:
  - Distinguishes spinoffs, sequels, and numbered series (*Steins;Gate* vs. *Steins;Gate 0*).
  - Isolates live-action adaptations from animated series (*One Piece* TV anime vs. live-action).
  - Year-based release filtering (+/- 1 year tolerance) to avoid misattributed remakes.
- **Multi-Arc Anime & Continuous Episode Traversal**:
  - Resolves arc-named folders (*Demon Slayer: Mugen Train*, *Swordsmith Village*, *Bleach: Thousand-Year Blood War*).
  - Resolves continuous absolute episode numbering across split seasons (*Hunter x Hunter*, *Black Clover*).
  - Special handling for Romaji titles and dual-audio filenames (*K-ON!*, *JoJo's Bizarre Adventure*, *Spy x Family*).
- **Quality & Audio Stream Formatting**:
  - Detects advanced multi-audio combinations (e.g., DDP 5.1, TrueHD 7.1, DTS-HD, AAC multi-audio).
  - Structured stream cards showing resolution, audio codecs, and file sizes.
  - Zero-width character ranking tags for native quality sorting (2160p down to 480p).
- **Direct BDIX Streaming**:
  - Zero login or authentication required; direct byte-range streaming via Nuvio's internal MPV player.

## How to Install in Nuvio

### Method 1: GitHub (Recommended)
1. Copy the **Raw** URL to `manifest.json`:
   ```
   https://raw.githubusercontent.com/codeineXO/dhakaflix-plugin/main/manifest.json
   ```
2. Open Nuvio $\rightarrow$ **Settings** $\rightarrow$ **Plugins** $\rightarrow$ **Add Repository**.
3. Paste the URL and click **Add**.
4. Click **Refresh** anytime to receive updates pushed to `main`.

### Method 2: Local Network / Dev Server
1. Navigate to the repository directory in your terminal and serve it over HTTP:
   ```bash
   npx serve . -p 8080
   # or with Python:
   python -m http.server 8080
   ```
2. Open Nuvio $\rightarrow$ **Settings** $\rightarrow$ **Plugins** $\rightarrow$ **Add Repository**.
3. Paste the URL:
   - **Same device**: `http://localhost:8080/manifest.json`
   - **Local network (TV / Mobile / other devices)**: `http://<local-ip>:8080/manifest.json` (e.g., `http://192.168.1.100:8080/manifest.json`)

## Requirements
- **BDIX Connection**: DhakaFlix servers reside on internal BDIX routing (`172.16.50.x`). Users must be connected through an ISP with active BDIX peering in Bangladesh to stream files.
