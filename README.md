# GPX to 3D Flyover Video

A cinematic 3D visualization and video export tool for GPX tracks. This application uses CesiumJS for high-fidelity 3D terrain and satellite imagery, providing a drone-like cinematic flyover of your GPX routes.

## Features

- **Cinematic Drone Camera:** Decoupled camera position and focus for smooth, sweeping aerial shots.
- **Multiple Camera Styles:** Steady Follow, Circular Orbit, and Pendulum Swing.
- **ProRes Export:** High-quality video export using macOS hardware acceleration (`prores_videotoolbox`).
- **Multi-Track Support:** Select specific tracks from a single GPX file to visualize or export.
- **Customizable Paths:** Adjust path color, thickness, and smoothing on the fly.
- **Start/End Padding:** Automated pauses and follow-through for professional video intros/outros.

---

## MacOS Build & Setup Instructions

### 1. Prerequisites

Ensure you have [Homebrew](https://brew.sh/) installed.

**Install System Dependencies:**
```bash
# Install Node.js (for the frontend)
brew install node

# Install Python (for the backend)
brew install python

# Install FFmpeg with Apple Silicon/Intel hardware acceleration
brew install ffmpeg
```

### 2. Configuration

1. **Cesium Ion Token:**
   - Sign up for a free account at [Cesium Ion](https://cesium.com/ion/).
   - Create a "Default Access Token".
   - Create a `.env` file in the `gpx_2_video` directory:
     ```env
     CESIUM_ION_TOKEN=your_cesium_ion_token_here
     ```

### 3. Installation

**Backend Setup:**
```bash
cd gpx_2_video
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Install Playwright browser for headless rendering (used by exporter.py)
playwright install chromium
```

**Frontend Setup:**
```bash
cd frontend
npm install
```

---

## Running the Application

To run the full interactive application, you need to start both the backend server and the frontend development server.

### Step 1: Start Backend (Port 8000)
```bash
cd gpx_2_video
source venv/bin/activate
python3 main.py
```

### Step 2: Start Frontend (Port 5173)
In a new terminal tab:
```bash
cd gpx_2_video/frontend
npm run dev
```

### Step 3: Open the App
Navigate to [http://localhost:5173](http://localhost:5173) in your browser.

---

## Usage Guide

1. **Upload:** Select a `.gpx` file. If it contains multiple tracks, use the checkboxes to select the ones you want to include.
2. **Customize:** 
   - Use the **Speed** slider to adjust how fast the camera moves (up to 3000 m/s).
   - Adjust **Altitude** and **Pitch** to find the perfect angle.
   - Change **Path Color** and **Width** for better visibility.
   - Choose a **Camera Style** (Steady, Orbit, or Pendulum).
3. **Preview:** Click **Start Flyover** to see a real-time 3D preview of the cinematic movement.
4. **Export:** Click **Export Video**. 
   - The app will render the route frame-by-frame for maximum quality.
   - The final video will be saved as `flyover_export.mov` in the `gpx_2_video` directory.
   - Temporary frames are automatically deleted after a successful export.

---

## Troubleshooting

- **FFmpeg Error:** If you get an error during video encoding, ensure your FFmpeg version supports `videotoolbox`. Run `ffmpeg -encoders | grep videotoolbox` to verify.
- **Port Conflict:** If port 8000 or 5173 is in use, the application may fail to start. You can change the ports in `main.py` and `vite.config.js` respectively.
- **Tile Rendering:** If tiles are not loading in the export, ensure your `CESIUM_ION_TOKEN` is valid and has "Cesium World Terrain" and "Bing Maps Aerial" assets added (default for new accounts).
