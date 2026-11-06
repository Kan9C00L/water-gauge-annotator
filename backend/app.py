from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="Water Gauge Auto-Annotation API")

# 允许跨域请求，确保前端网页能调通
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# TODO: 实际使用时，在此处加载你的 YOLO 和 SAM2.1 模型
# from ultralytics import YOLO
# yolo_model = YOLO("../weights/yolo11_water_gauge.pt")

@app.post("/segment")
async def segment(image: UploadFile = File(...), x: float = Form(...), y: float = Form(...)):
    """SAM2.1 提示点/框分割接口"""
    # 核心逻辑：接收点坐标，调用 SAM 生成 polygon 返回
    return {"success": True, "polygon": [{"x": x-10, "y": y-10}, {"x": x+10, "y": y+10}], "score": 0.95}

@app.post("/api/auto_annotate")
async def auto_annotate(file: UploadFile = File(...), max_points: int = Form(20)):
    """全自动标注：YOLO 检测框 -> SAM 生成多边形"""
    # 核心逻辑：调用 YOLO，遍历检测框，喂给 SAM
    return {"items": []}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010)
