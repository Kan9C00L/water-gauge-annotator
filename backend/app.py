import os
import time
import random
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="Water Gauge Auto-Annotation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 真实业务逻辑说明 (面试时可讲解)
# 1. 接收前端图片，保存至临时目录
# 2. 调用 YOLO11 进行推理，得到 bounding boxes
# 3. 将 boxes 作为 prompts 传入 SAM2.1 获取 masks
# 4. 将 masks 转换为 polygon 坐标点返回
# ==========================================

@app.post("/segment")
async def segment(
    image: UploadFile = File(...), 
    x: float = Form(...), 
    y: float = Form(...),
    box_x1: float = Form(None), 
    box_y1: float = Form(None), 
    box_x2: float = Form(None), 
    box_y2: float = Form(None)
):
    """SAM2.1 提示点/框分割接口"""
    # 模拟 SAM 处理耗时
    time.sleep(0.1) 
    
    # 生成一个围绕 (x,y) 的假多边形 (实际中为 SAM 输出的 mask 轮廓)
    polygon = [
        {"x": x - 15, "y": y - 15},
        {"x": x + 15, "y": y - 15},
        {"x": x + 15, "y": y + 15},
        {"x": x - 15, "y": y + 15}
    ]
    return {"success": True, "polygon": polygon, "score": 0.95}


@app.post("/api/auto_annotate")
async def auto_annotate(file: UploadFile = File(...), max_points: int = Form(20)):
    """全自动标注：YOLO 检测 -> SAM 分割"""
    time.sleep(0.5) # 模拟推理耗时
    
    # 模拟 YOLO 检测到的 3 个水尺字符框
    mock_detections = [
        {"label": "2", "bbox": [100, 100, 50, 60]},
        {"label": "1", "bbox": [100, 200, 40, 60]},
        {"label": "M", "bbox": [100, 300, 50, 60]}
    ]
    
    items = []
    for det in mock_detections:
        x, y, w, h = det["bbox"]
        # 模拟 SAM 根据 bbox 生成的多边形
        polygon = [
            {"x": x, "y": y},
            {"x": x + w, "y": y},
            {"x": x + w, "y": y + h},
            {"x": x, "y": y + h}
        ]
        items.append({
            "label": det["label"],
            "polygon": polygon,
            "score": 0.88
        })
        
    return {"items": items}


@app.post("/api/click_segment")
async def click_segment(file: UploadFile = File(...), x: float = Form(...), y: float = Form(...), max_points: int = Form(20)):
    """点击自动识别：点击 -> SAM 分割 -> YOLO 分类"""
    time.sleep(0.2)
    
    # 模拟识别出的字符
    item = {
        "label": "unknown_char",
        "polygon": [
            {"x": x - 20, "y": y - 20},
            {"x": x + 20, "y": y - 20},
            {"x": x + 20, "y": y + 20},
            {"x": x - 20, "y": y + 20}
        ],
        "score": 0.92
    }
    return {"item": item}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010)
