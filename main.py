from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import shutil
from parser import parse_gpx
from dotenv import load_dotenv
import math

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global progress state
export_status = {"progress": 0, "status": "Idle", "is_running": False}

class ExportRequest(BaseModel):
    points: list
    speed: float
    smoothing: int
    momentum: int
    altitude: float
    pitch: float
    bearing: float = None

@app.post("/upload")
async def upload_gpx(file: UploadFile = File(...)):
    file_location = f"uploads/{file.filename}"
    os.makedirs("uploads", exist_ok=True)
    with open(file_location, "wb+") as f:
        shutil.copyfileobj(file.file, f)
    return {"points": parse_gpx(file_location)}

@app.get("/config")
async def get_config():
    return {"cesium_ion_token": os.getenv("CESIUM_ION_TOKEN", "")}

@app.get("/progress")
async def get_progress():
    return export_status

@app.post("/receive_frame/{frame_id}")
async def receive_frame(frame_id: int, request: Request):
    data = await request.body()
    os.makedirs("temp_frames", exist_ok=True)
    with open(f"temp_frames/frame_{frame_id:05d}.jpg", "wb") as f:
        f.write(data)
    return {"status": "ok"}

@app.post("/finalize_video")
async def finalize_video(fps: int = 25):
    import ffmpeg
    output_name = "flyover_export.mov"
    print("Encoding video with ProRes...")
    try:
        (
            ffmpeg
            .input("temp_frames/frame_%05d.jpg", framerate=fps)
            .output(output_name, vcodec='prores_videotoolbox', profile='hq', pix_fmt='yuv422p10le')
            .overwrite_output()
            .run()
        )
        if os.path.exists("temp_frames"):
            shutil.rmtree("temp_frames")
        return {"status": "Complete", "file": output_name}
    except Exception as e:
        return {"status": "Error", "message": str(e)}

@app.post("/update_progress")
async def update_progress_endpoint(progress: int, status: str):
    global export_status
    export_status["progress"] = progress
    export_status["status"] = status
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
