import gpxpy
import json
from datetime import datetime

from rdp import rdp

def parse_gpx(file_path, epsilon=0.0005):
    with open(file_path, 'r') as gpx_file:
        gpx = gpxpy.parse(gpx_file)

    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                points.append([
                    point.latitude,
                    point.longitude,
                    point.elevation or 0.0
                ])
    
    # Smooth the path using Ramer-Douglas-Peucker
    # epsilon=0.0001 is roughly 10 meters of tolerance
    smoothed = rdp(points, epsilon=epsilon)
    
    return [
        {"lat": p[0], "lon": p[1], "alt": p[2]} 
        for p in smoothed
    ]

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        data = parse_gpx(sys.argv[1])
        print(json.dumps(data, indent=2))
