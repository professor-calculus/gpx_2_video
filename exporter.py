import asyncio
import os
import shutil
import ffmpeg
from playwright.async_api import async_playwright
import json
import base64
import math

def calculate_heading(p1, p2):
    lat1, lon1 = math.radians(p1['lat']), math.radians(p1['lon'])
    lat2, lon2 = math.radians(p2['lat']), math.radians(p2['lon'])
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return math.atan2(y, x)

def calculate_distance(p1, p2):
    lat1, lat2 = math.radians(p1['lat']), math.radians(p2['lat'])
    dLat, dLon = lat2 - lat1, math.radians(p2['lon'] - p1['lon'])
    a = math.sin(dLat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dLon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_smoothed_point(points, index, window_size):
    half = window_size // 2
    lat, lon, alt, count = 0, 0, 0, 0
    for i in range(index - half, index + half + 1):
        if 0 <= i < len(points):
            lat += points[i]['lat']; lon += points[i]['lon']; alt += points[i]['alt']; count += 1
    return {'lat': lat / count, 'lon': lon / count, 'alt': alt / count}

def lerp(s, e, a): return (1 - a) * s + a * e
def lerp_angle(s, e, a):
    d = e - s
    while d < -math.pi: d += math.pi * 2
    while d > math.pi: d -= math.pi * 2
    return s + d * a

async def render_video(gpx_points, api_key, output_name="output.mov", fps=25, alt_offset=2000, pitch_deg=-30, speed_mps=100, smoothing_window=50, momentum_pct=80, fixed_bearing_deg=None, progress_callback=None):
    frames_dir = "temp_frames"
    if os.path.exists(frames_dir): shutil.rmtree(frames_dir)
    os.makedirs(frames_dir)

    smoothed_path = [get_smoothed_point(gpx_points, i, smoothing_window) for i in range(len(gpx_points))]
    total_dist = 0
    segments = []
    for i in range(len(smoothed_path) - 1):
        d = calculate_distance(smoothed_path[i], smoothed_path[i+1])
        segments.append({'p1': smoothed_path[i], 'p2': smoothed_path[i+1], 'start_dist': total_dist, 'dist': d})
        total_dist += d

    T_move = (total_dist / speed_mps) + 0.5
    total_frames = int((T_move + 1.0) * fps)
    
    catchup = 1.0 - (momentum_pct / 100)
    pitch = math.radians(pitch_deg)
    manual_bearing = math.radians(fixed_bearing_deg) if fixed_bearing_deg is not None else None
    dist_per_frame = speed_mps / fps

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 3840, 'height': 2160})
        await page.goto("http://localhost:5173")
        await page.evaluate(f"window.initCesium('{api_key}')")
        await asyncio.sleep(5)

        cam_lat, cam_lon, cam_alt, cam_heading = smoothed_path[0]['lat'], smoothed_path[0]['lon'], smoothed_path[0]['alt'] + alt_offset, 0
        
        traveled = 0
        for f in range(total_frames):
            if progress_callback: progress_callback(f, total_frames)
            
            elapsed = f / fps
            currentV = 0
            move_time = elapsed - 0.5
            if 0 < move_time < T_move:
                if move_time < 0.5: currentV = speed_mps * (move_time / 0.5)
                elif move_time > T_move - 0.5: currentV = speed_mps * ((T_move - move_time) / 0.5)
                else: currentV = speed_mps
            
            traveled += currentV * (1.0 / fps)
            traveled = min(traveled, total_dist)

            seg = next((s for s in segments if traveled >= s['start_dist'] and traveled <= s['start_dist'] + s['dist']), segments[-1])
            t = (traveled - seg['start_dist']) / (seg['dist'] if seg['dist'] > 0 else 1)
            
            target_lat = seg['p1']['lat'] + (seg['p2']['lat'] - seg['p1']['lat']) * t
            target_lon = seg['p1']['lon'] + (seg['p2']['lon'] - seg['p1']['lon']) * t
            target_alt = (seg['p1']['alt'] + (seg['p2']['alt'] - seg['p1']['alt']) * t) + alt_offset
            target_heading = manual_bearing if manual_bearing is not None else calculate_heading(seg['p1'], seg['p2'])

            cam_lat = lerp(cam_lat, target_lat, catchup)
            cam_lon = lerp(cam_lon, target_lon, catchup)
            cam_alt = lerp(cam_alt, target_alt, catchup)
            cam_heading = lerp_angle(cam_heading, target_heading, catchup)

            h_dist = alt_offset / math.tan(abs(pitch))
            off_lat = cam_lat - (h_dist / 111111) * math.cos(cam_heading)
            off_lon = cam_lon - (h_dist / (111111 * math.cos(math.radians(cam_lat)))) * math.sin(cam_heading)

            await page.evaluate(f"window.renderFrame({off_lat}, {off_lon}, {cam_alt}, {cam_heading}, {pitch})")
            
            base64_img = await page.evaluate("window.captureFrame()")
            img_data = base64.b64decode(base64_img.split(',')[1])
            with open(f"{frames_dir}/frame_{f:05d}.jpg", "wb") as f_img:
                f_img.write(img_data)
            
            if f % 10 == 0: print(f"Frame {f}/{total_frames}")

        await browser.close()

    print("Encoding video...")
    (
        ffmpeg
        .input(f"{frames_dir}/frame_%05d.jpg", framerate=fps)
        .output(output_name, vcodec='prores_videotoolbox', profile='hq', pix_fmt='yuv422p10le')
        .overwrite_output()
        .run()
    )
    if os.path.exists(frames_dir):
        shutil.rmtree(frames_dir)
    print(f"Video saved: {output_name}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2:
        with open(sys.argv[1], 'r') as f: points = json.load(f)
        asyncio.run(render_video(points, sys.argv[2]))
