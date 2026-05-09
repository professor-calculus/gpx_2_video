import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

let viewer;
let gpxPoints = [];
let allTracks = [];
let manualBearing = null;
let flyoverRunning = false;

// 1. Initialization
window.initCesium = async (ionToken) => {
  if (viewer) return; 
  if (!ionToken || ionToken === "YOUR_TOKEN_HERE" || ionToken.trim() === "") {
    ionToken = prompt("Please enter your FREE Cesium Ion Access Token:");
  }
  if (!ionToken) return;
  Cesium.Ion.defaultAccessToken = ionToken.trim();

  try {
    viewer = new Cesium.Viewer('cesiumContainer', {
      animation: false, timeline: false, baseLayerPicker: true,
    });
    try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync(); } catch (e) {}
    setupEventListeners();
  } catch (error) { console.error(error); }
};

async function startApp() {
  let ionToken = "";
  try {
    const configResponse = await fetch('http://localhost:8000/config');
    const config = await configResponse.json();
    ionToken = config.cesium_ion_token;
  } catch (e) {}
  await window.initCesium(ionToken);
}

function setupEventListeners() {
  document.getElementById('gpxInput').addEventListener('change', handleFileUpload);
  document.getElementById('startFlyover').addEventListener('click', startFlyover);
  document.getElementById('stopFlyover').addEventListener('click', () => flyoverRunning = false);
  document.getElementById('exportVideo').addEventListener('click', fastInBrowserExport);
  document.getElementById('resetBearing').addEventListener('click', resetToTrackBearing);
  document.getElementById('selectAllTracks').addEventListener('click', () => {
    const allSelected = allTracks.every(t => t.selected);
    allTracks.forEach(t => t.selected = !allSelected);
    renderTrackList();
    renderSelectedTracks();
  });
  
  const saveSetting = (id, val) => localStorage.setItem('gpx_2_video_' + id, val);
  document.getElementById('flyoverSpeed').addEventListener('input', (e) => {
    document.getElementById('speedValue').innerText = e.target.value;
    saveSetting('speed', e.target.value);
  });
  document.getElementById('pathSmoothing').addEventListener('input', (e) => {
    document.getElementById('smoothingValue').innerText = e.target.value;
    saveSetting('smoothing', e.target.value);
  });
  document.getElementById('cameraMomentum').addEventListener('input', (e) => {
    document.getElementById('momentumValue').innerText = e.target.value;
    saveSetting('momentum', e.target.value);
  });
  document.getElementById('altitudeOffset').addEventListener('input', (e) => saveSetting('altitude', e.target.value));
  document.getElementById('cameraPitch').addEventListener('input', (e) => saveSetting('pitch', e.target.value));
  document.getElementById('pathColor').addEventListener('input', renderSelectedTracks);
  document.getElementById('pathWidth').addEventListener('input', renderSelectedTracks);
  document.getElementById('cameraBearing').addEventListener('input', (e) => {
    manualBearing = Cesium.Math.toRadians(parseFloat(e.target.value));
    document.getElementById('bearingValue').innerText = e.target.value;
  });

  const load = (id, key, defaultVal) => {
    const val = localStorage.getItem('gpx_2_video_' + key) || defaultVal;
    document.getElementById(id).value = val;
    const display = document.getElementById(key + 'Value');
    if (display) display.innerText = val;
  };
  load('flyoverSpeed', 'speed', '100');
  load('pathSmoothing', 'smoothing', '50');
  load('cameraMomentum', 'momentum', '80');
  load('altitudeOffset', 'altitude', '2000');
  load('cameraPitch', 'pitch', '-30');
}

// 2. Export Logic
async function fastInBrowserExport() {
  if (gpxPoints.length < 2) return;

  // Force 2.7K Resolution
  const container = document.getElementById('cesiumContainer');
  const originalWidth = container.style.width;
  const originalHeight = container.style.height;
  container.style.width = '2704px';
  container.style.height = '1520px';
  viewer.resize();

  flyoverRunning = true;
  const exportBtn = document.getElementById('exportVideo');
  exportBtn.disabled = true;
  document.getElementById('exportProgress').style.display = 'block';

  const altOffset = parseFloat(document.getElementById('altitudeOffset').value);
  const pitch = Cesium.Math.toRadians(parseFloat(document.getElementById('cameraPitch').value));
  const smoothingWindow = parseInt(document.getElementById('pathSmoothing').value);
  const speedMPS = parseFloat(document.getElementById('flyoverSpeed').value);
  const momentum = parseInt(document.getElementById('cameraMomentum').value) / 100;
  const cameraStyle = document.getElementById('cameraStyle').value;
  const catchup = 1.0 - momentum;
  const fps = 25;

  const smoothedPath = [];
  for (let i = 0; i < gpxPoints.length; i++) smoothedPath.push(getSmoothedPoint(i, smoothingWindow));

  let currentDist = 0;
  const segments = [];
  for (let i = 0; i < smoothedPath.length - 1; i++) {
    const dist = calculateDistance(smoothedPath[i], smoothedPath[i+1]);
    segments.push({ p1: smoothedPath[i], p2: smoothedPath[i+1], startDist: currentDist, dist: dist });
    currentDist += dist;
  }

  const T_move = (currentDist / speedMPS) + 0.5;
  const T_start_pause = 3.0;
  const T_end_extra = 3.0;
  const totalFrames = Math.floor((T_start_pause + T_move + T_end_extra) * fps);
  
  let camLat = smoothedPath[0].lat, camLon = smoothedPath[0].lon, camAlt = smoothedPath[0].alt + altOffset;
  let camHeading = manualBearing !== null ? manualBearing : calculateHeading(smoothedPath[0], smoothedPath[1]);
  let traveled = 0;
  
  // Drone-like position state
  const horizDistance = altOffset / Math.tan(Math.abs(pitch));
  let droneLat = camLat - (horizDistance / 111111) * Math.cos(camHeading);
  let droneLon = camLon - (horizDistance / (111111 * Math.cos(Cesium.Math.toRadians(camLat)))) * Math.sin(camHeading);
  let droneAlt = camAlt;

  for (let f = 0; f < totalFrames; f++) {
    if (!flyoverRunning) break;
    
    const elapsed = f / fps;
    let currentV = 0;
    
    // Movement Logic with start/end padding
    const moveTime = elapsed - T_start_pause - 0.5;
    if (0 < moveTime && moveTime < T_move) {
      if (moveTime < 0.5) currentV = speedMPS * (moveTime / 0.5);
      else if (moveTime > T_move - 0.5) currentV = speedMPS * ((T_move - moveTime) / 0.5);
      else currentV = speedMPS;
    }
    
    traveled += currentV * (1 / fps);
    traveled = Math.min(traveled, currentDist); 
    const isOvertime = (elapsed > T_start_pause + T_move);
    
    const seg = segments.find(s => traveled >= s.startDist && traveled <= s.startDist + s.dist) || segments[segments.length-1];
    const t = (traveled - seg.startDist) / (seg.dist || 1);
    
    let targetLat = seg.p1.lat + (seg.p2.lat - seg.p1.lat) * t;
    let targetLon = seg.p1.lon + (seg.p2.lon - seg.p1.lon) * t;
    let targetAlt = (seg.p1.alt + (seg.p2.alt - seg.p1.alt) * t) + altOffset;
    let trackHeading = manualBearing !== null ? manualBearing : calculateHeading(seg.p1, seg.p2);

    if (isOvertime) {
        // Continue drifting in the last direction
        const extraTime = elapsed - (T_start_pause + T_move);
        const driftDist = 0; // The drone's internal momentum handles the drift feel
        // We just keep the target at the end point, and the drone will naturally settle
    }
    
    // 1. Smoothly update the focus point (what we are looking at)
    camLat = lerp(camLat, targetLat, catchup);
    camLon = lerp(camLon, targetLon, catchup);
    camAlt = lerp(camAlt, targetAlt, catchup);
    camHeading = lerpAngle(camHeading, trackHeading, catchup);

    // 2. Apply Camera Style offsets
    let styleHeading = camHeading;
    if (cameraStyle === 'orbit') {
      styleHeading += (elapsed / (T_start_pause + T_move + T_end_extra)) * Math.PI * 2;
    } else if (cameraStyle === 'pendulum') {
      styleHeading += Math.sin(elapsed * 0.5) * 0.5;
    }

    // 3. Calculate ideal drone position relative to focus point
    const idealLat = camLat - (horizDistance / 111111) * Math.cos(styleHeading);
    const idealLon = camLon - (horizDistance / (111111 * Math.cos(Cesium.Math.toRadians(camLat)))) * Math.sin(styleHeading);
    const idealAlt = camAlt;

    // 4. Smoothly move the drone towards the ideal position
    const posCatchup = isOvertime ? catchup * 0.5 : Math.min(catchup * 1.5, 1.0);
    droneLat = lerp(droneLat, idealLat, posCatchup);
    droneLon = lerp(droneLon, idealLon, posCatchup);
    droneAlt = lerp(droneAlt, idealAlt, posCatchup);

    // 5. Update camera view
    const dronePos = Cesium.Cartesian3.fromDegrees(droneLon, droneLat, droneAlt);
    
    viewer.camera.setView({
      destination: dronePos,
      orientation: {
        heading: calculateHeading({lat: droneLat, lon: droneLon}, {lat: camLat, lon: camLon}),
        pitch: pitch,
        roll: 0
      }
    });
    
    viewer.scene.render();
    const blob = await new Promise(resolve => viewer.scene.canvas.toBlob(resolve, 'image/jpeg', 0.90));
    await fetch(`http://localhost:8000/receive_frame/${f}`, { method: 'POST', body: blob });

    const progress = Math.round((f / totalFrames) * 100);
    document.getElementById('progressBar').style.width = progress + "%";
    document.getElementById('progressStatus').innerText = `Exporting Frame ${f}/${totalFrames}...`;
  }

  document.getElementById('progressStatus').innerText = "Encoding Final Video...";
  const response = await fetch('http://localhost:8000/finalize_video', { method: 'POST' });
  
  if (response.ok) {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Try to get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'flyover_export.mov';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    alert("Export Complete! Your download should start shortly.");
  } else {
    const errorData = await response.json();
    alert("Export failed: " + (errorData.message || response.statusText));
  }

  // Restore original UI size
  container.style.width = originalWidth;
  container.style.height = originalHeight;
  viewer.resize();

  exportBtn.disabled = false;
}

// 3. Interactive Flyover Logic
async function startFlyover() {
  if (gpxPoints.length < 2) return;
  flyoverRunning = true;

  const altOffset = parseFloat(document.getElementById('altitudeOffset').value);
  const pitch = Cesium.Math.toRadians(parseFloat(document.getElementById('cameraPitch').value));
  const smoothingWindow = parseInt(document.getElementById('pathSmoothing').value);
  const speedMPS = parseFloat(document.getElementById('flyoverSpeed').value);
  const momentum = parseInt(document.getElementById('cameraMomentum').value) / 100;
  const cameraStyle = document.getElementById('cameraStyle').value;
  const catchup = 1.0 - momentum;
  const frameInterval = 40; // 25fps

  const smoothedPath = [];
  for (let i = 0; i < gpxPoints.length; i++) smoothedPath.push(getSmoothedPoint(i, smoothingWindow));

  let currentDist = 0;
  const segments = [];
  for (let i = 0; i < smoothedPath.length - 1; i++) {
    const dist = calculateDistance(smoothedPath[i], smoothedPath[i+1]);
    segments.push({ p1: smoothedPath[i], p2: smoothedPath[i+1], startDist: currentDist, dist: dist });
    currentDist += dist;
  }

  const T_move = (currentDist / speedMPS) + 0.5;
  const T_start_pause = 3.0;
  const T_end_extra = 3.0;
  const totalTime = T_start_pause + T_move + T_end_extra;
  let elapsed = 0, traveled = 0;
  
  let camLat = smoothedPath[0].lat, camLon = smoothedPath[0].lon, camAlt = smoothedPath[0].alt + altOffset;
  let camHeading = manualBearing !== null ? manualBearing : calculateHeading(smoothedPath[0], smoothedPath[1]);

  // Drone-like position state
  const horizDistance = altOffset / Math.tan(Math.abs(pitch));
  let droneLat = camLat - (horizDistance / 111111) * Math.cos(camHeading);
  let droneLon = camLon - (horizDistance / (111111 * Math.cos(Cesium.Math.toRadians(camLat)))) * Math.sin(camHeading);
  let droneAlt = camAlt;

  while (elapsed < totalTime && flyoverRunning) {
    let currentV = 0;
    const moveTime = elapsed - T_start_pause - 0.5;
    if (0 < moveTime && moveTime < T_move) {
      if (moveTime < 0.5) currentV = speedMPS * (moveTime / 0.5);
      else if (moveTime > T_move - 0.5) currentV = speedMPS * ((T_move - moveTime) / 0.5);
      else currentV = speedMPS;
    }
    
    traveled += currentV * (frameInterval / 1000);
    traveled = Math.min(traveled, currentDist);
    const isOvertime = (elapsed > T_start_pause + T_move);

    const seg = segments.find(s => traveled >= s.startDist && traveled <= s.startDist + s.dist) || segments[segments.length-1];
    const t = (traveled - seg.startDist) / (seg.dist || 1);
    
    const targetLat = seg.p1.lat + (seg.p2.lat - seg.p1.lat) * t;
    const targetLon = seg.p1.lon + (seg.p2.lon - seg.p1.lon) * t;
    const targetAlt = (seg.p1.alt + (seg.p2.alt - seg.p1.alt) * t) + altOffset;
    const trackHeading = manualBearing !== null ? manualBearing : calculateHeading(seg.p1, seg.p2);
    
    // Damping
    camLat = lerp(camLat, targetLat, catchup);
    camLon = lerp(camLon, targetLon, catchup);
    camAlt = lerp(camAlt, targetAlt, catchup);
    camHeading = lerpAngle(camHeading, trackHeading, catchup);

    // Style Offsets
    let styleHeading = camHeading;
    if (cameraStyle === 'orbit') {
      styleHeading += (elapsed / totalTime) * Math.PI * 2;
    } else if (cameraStyle === 'pendulum') {
      styleHeading += Math.sin(elapsed * 0.5) * 0.5;
    }

    const idealLat = camLat - (horizDistance / 111111) * Math.cos(styleHeading);
    const idealLon = camLon - (horizDistance / (111111 * Math.cos(Cesium.Math.toRadians(camLat)))) * Math.sin(styleHeading);
    const idealAlt = camAlt;

    const posCatchup = isOvertime ? catchup * 0.5 : Math.min(catchup * 1.5, 1.0);
    droneLat = lerp(droneLat, idealLat, posCatchup);
    droneLon = lerp(droneLon, idealLon, posCatchup);
    droneAlt = lerp(droneAlt, idealAlt, posCatchup);

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(droneLon, droneLat, droneAlt),
      orientation: {
        heading: calculateHeading({lat: droneLat, lon: droneLon}, {lat: camLat, lon: camLon}),
        pitch: pitch,
        roll: 0
      }
    });
    elapsed += (frameInterval / 1000);
    await new Promise(r => setTimeout(r, frameInterval));
  }
}

// 4. Shared Helpers
async function renderFrame(lat, lon, alt, heading, pitch) {
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt), orientation: { heading, pitch, roll: 0 } });
  if (viewer.scene.globe.tilesLoaded) return new Promise(r => setTimeout(r, 10));
  return new Promise(resolve => {
    const helper = new Cesium.EventHelper();
    let timeout = setTimeout(() => { helper.removeAll(); resolve(); }, 300); 
    helper.add(viewer.scene.globe.tileLoadProgressEvent, (count) => { 
        if (count <= 1) { clearTimeout(timeout); helper.removeAll(); setTimeout(resolve, 20); } 
    });
  });
}

function getSmoothedPoint(index, windowSize) {
  const half = Math.floor(windowSize / 2);
  let lat = 0, lon = 0, alt = 0, count = 0;
  for (let i = index - half; i <= index + half; i++) {
    if (i >= 0 && i < gpxPoints.length) {
      lat += gpxPoints[i].lat; lon += gpxPoints[i].lon; alt += gpxPoints[i].alt; count++;
    }
  }
  return { lat: lat / count, lon: lon / count, alt: alt / count };
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parser = new DOMParser();
  const gpx = parser.parseFromString(text, "text/xml");
  
  const trks = gpx.querySelectorAll("trk");
  allTracks = [];
  
  trks.forEach((trk, index) => {
    const name = trk.querySelector("name")?.textContent || `Track ${index + 1}`;
    const trkpts = trk.querySelectorAll("trkpt");
    const points = [];
    trkpts.forEach(pt => {
      points.push({ 
        lat: parseFloat(pt.getAttribute("lat")), 
        lon: parseFloat(pt.getAttribute("lon")), 
        alt: parseFloat(pt.querySelector("ele")?.textContent || 0) 
      });
    });
    if (points.length > 0) {
      allTracks.push({ name, points, selected: true });
    }
  });

  if (allTracks.length === 0) {
    // Fallback for files without <trk> (e.g. just <wpt> or flat <trkpt>)
    const trkpts = gpx.querySelectorAll("trkpt");
    const points = [];
    trkpts.forEach(pt => {
      points.push({ 
        lat: parseFloat(pt.getAttribute("lat")), 
        lon: parseFloat(pt.getAttribute("lon")), 
        alt: parseFloat(pt.querySelector("ele")?.textContent || 0) 
      });
    });
    if (points.length > 0) {
      allTracks.push({ name: "Default Track", points, selected: true });
    }
  }

  renderTrackList();
  renderSelectedTracks();
}

function renderTrackList() {
  const list = document.getElementById('trackList');
  list.innerHTML = '';
  
  if (allTracks.length <= 1) {
    document.getElementById('trackSelection').style.display = 'none';
    return;
  }
  
  document.getElementById('trackSelection').style.display = 'block';
  const allSelected = allTracks.every(t => t.selected);
  document.getElementById('selectAllTracks').innerText = allSelected ? 'None' : 'All';
  
  allTracks.forEach((track, index) => {
    const div = document.createElement('div');
    div.style.marginBottom = '3px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = track.selected;
    cb.id = `track-cb-${index}`;
    cb.addEventListener('change', (e) => {
      allTracks[index].selected = e.target.checked;
      renderSelectedTracks();
    });
    
    const label = document.createElement('label');
    label.htmlFor = `track-cb-${index}`;
    label.innerText = ` ${track.name} (${track.points.length} pts)`;
    label.style.fontSize = '12px';
    
    div.appendChild(cb);
    div.appendChild(label);
    list.appendChild(div);
  });
}

function renderSelectedTracks() {
  gpxPoints = allTracks
    .filter(t => t.selected)
    .flatMap(t => t.points);

  if (gpxPoints.length < 2) {
    document.getElementById('controls').style.display = 'none';
    viewer.entities.removeAll();
    return;
  }

  resetToTrackBearing();
  
  const positions = gpxPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
  const colorHex = document.getElementById('pathColor').value;
  const width = parseFloat(document.getElementById('pathWidth').value) || 3;
  
  viewer.entities.removeAll();
  const trackEntity = viewer.entities.add({ 
    polyline: { 
      positions, 
      width: width, 
      material: Cesium.Color.fromCssColorString(colorHex), 
      clampToGround: true 
    } 
  });
  
  document.getElementById('controls').style.display = 'block';
  
  // Auto-zoom to full track
  if (trackEntity) {
    viewer.zoomTo(trackEntity, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90)));
  }
}

function calculateDistance(p1, p2) {
  const lat1 = Cesium.Math.toRadians(p1.lat), lat2 = Cesium.Math.toRadians(p2.lat);
  const dLat = lat2 - lat1, dLon = Cesium.Math.toRadians(p2.lon - p1.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateHeading(p1, p2) {
  const lat1 = Cesium.Math.toRadians(p1.lat), lon1 = Cesium.Math.toRadians(p1.lon);
  const lat2 = Cesium.Math.toRadians(p2.lat), lon2 = Cesium.Math.toRadians(p2.lon);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return Math.atan2(y, x);
}

function lerp(s, e, a) { return (1 - a) * s + a * e; }
function lerpAngle(s, e, a) {
    let d = e - s;
    while (d < -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return s + d * a;
}

function resetToTrackBearing() {
  if (gpxPoints.length < 2) return;
  const initialHeading = calculateHeading(gpxPoints[0], gpxPoints[gpxPoints.length - 1]);
  manualBearing = initialHeading;
  const deg = Math.round(Cesium.Math.toDegrees(initialHeading));
  document.getElementById('cameraBearing').value = deg;
  document.getElementById('bearingValue').innerText = deg;
}

window.captureFrame = () => {
  viewer.scene.render();
  return viewer.scene.canvas.toDataURL('image/jpeg', 0.90);
};

startApp();
