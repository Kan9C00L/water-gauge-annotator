import json
import os
import glob
import sys

def convert(json_path, output_dir):
    """将 LabelMe JSON 转换为 YOLO 检测格式 (txt)"""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    img_w = data.get('imageWidth', 1920)
    img_h = data.get('imageHeight', 1080)
    
    lines = []
    for shape in data['shapes']:
        points = shape['points']
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        
        # 转换为 YOLO 的 cx, cy, w, h
        cx = (x_min + x_max) / 2.0 / img_w
        cy = (y_min + y_max) / 2.0 / img_h
        w = (x_max - x_min) / img_w
        h = (y_max - y_min) / img_h
        
        lines.append(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
        
    txt_name = os.path.basename(json_path).replace('.json', '.txt')
    with open(os.path.join(output_dir, txt_name), 'w') as f:
        f.write('\n'.join(lines))

if __name__ == "__main__":
    if len(sys.argv) == 3:
        json_dir, out_dir = sys.argv[1], sys.argv[2]
        os.makedirs(out_dir, exist_ok=True)
        for f in glob.glob(os.path.join(json_dir, "*.json")):
            convert(f, out_dir)
