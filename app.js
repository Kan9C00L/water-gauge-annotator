const state = {
  items: [],
  activeIndex: -1,
  outputDir: null,
  selectedShape: -1,
  selectedShapes: [],
  selectionAnchor: -1,
  selectedPoint: null,
  clipboardShape: null,
  dragging: null,
  showOverlay: true,
  mode: "select",
  draftPoints: [],
  draftLabel: "unknown",
  freehandPoints: [],
  smearPoints: [],
  smearCursor: null,
  followPoints: [],
  samPoint: null,
  samPoints: [],
  samPreview: null,
  samPreviews: [],
  samBox: null,
  samBoxStart: null,
  samTool: "point",
  pendingSamShapeIndexes: [],
  isFreehandDrawing: false,
  isSmearing: false,
  isFollowDrawing: false,
  isSamRunning: false,
  isWaterGaugeRunning: false,
  waterGaugePanelOpen: false,
  waterGaugeClickMode: false,
  isBatchRunning: false,
  isBatchPaused: false,
  batchResume: null,
  isPanning: false,
  panStart: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  labelHistory: [],
  lastLabel: "unknown",
  pendingLabelShapeIndex: -1,
  history: [],
  redo: [],
  view: { scale: 1, fitScale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 }
};

const $ = (id) => document.getElementById(id);
const imageCanvas = $("imageCanvas");
const overlayCanvas = $("overlayCanvas");
const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
const overlayCtx = overlayCanvas.getContext("2d");

const controls = {
  qualitySensitivity: $("qualitySensitivity"),
  edgeFocus: $("edgeFocus"),
  minArea: $("minArea"),
  simplify: $("simplify"),
  maxPoints: $("maxPoints"),
  brushSize: $("brushSize"),
  brushWheelSensitivity: $("brushWheelSensitivity"),
  opacity: $("opacity")
};

const controlOutputs = {
  qualitySensitivity: $("qualitySensitivityValue"),
  edgeFocus: $("edgeFocusValue"),
  minArea: $("minAreaValue"),
  simplify: $("simplifyValue"),
  maxPoints: $("maxPointsValue"),
  brushSize: $("brushSizeValue"),
  brushWheelSensitivity: $("brushWheelSensitivityValue"),
  opacity: $("opacityValue")
};

const defaultParams = {
  qualitySensitivity: 0.50,
  edgeFocus: 0.16,
  minArea: 0.014,
  simplify: 2,
  maxPoints: 20,
  brushSize: 36,
  brushWheelSensitivity: 8,
  opacity: 0.32
};

const WATER_GAUGE_SERVICE = "http://127.0.0.1:8010";

const folderMemory = {
  dbName: "unknownAnnotatorStorage",
  storeName: "settings",
  key: "lastImportFolder",
  pickerId: "unknownAnnotatorImport"
};

function openFolderMemory() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(folderMemory.dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(folderMemory.storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRememberedFolder(directoryHandle) {
  try {
    const db = await openFolderMemory();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(folderMemory.storeName, "readwrite");
      transaction.objectStore(folderMemory.storeName).put(directoryHandle, folderMemory.key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    localStorage.setItem("unknownAnnotatorLastFolderName", directoryHandle.name);
  } catch (_) {
    // Folder selection still works if this browser cannot persist directory handles.
  }
}

async function loadRememberedFolder() {
  try {
    const db = await openFolderMemory();
    const handle = await new Promise((resolve, reject) => {
      const transaction = db.transaction(folderMemory.storeName, "readonly");
      const request = transaction.objectStore(folderMemory.storeName).get(folderMemory.key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch (_) {
    return null;
  }
}

function resetControlDefaults() {
  for (const [key, value] of Object.entries(defaultParams)) {
    if (controls[key]) controls[key].value = String(value);
  }
}

function activeItem() {
  return state.items[state.activeIndex] || null;
}

function selectedShapeIndexes(item = activeItem()) {
  if (!item) return [];
  return [...new Set(state.selectedShapes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < item.shapes.length)
    .sort((a, b) => a - b);
}

function setShapeSelection(indexes, primaryIndex = indexes[indexes.length - 1], anchorIndex = primaryIndex) {
  const item = activeItem();
  const valid = item
    ? [...new Set(indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < item.shapes.length).sort((a, b) => a - b)
    : [];
  state.selectedShapes = valid;
  state.selectedShape = valid.includes(primaryIndex) ? primaryIndex : (valid[valid.length - 1] ?? -1);
  state.selectionAnchor = state.selectedShape >= 0
    ? (valid.includes(anchorIndex) ? anchorIndex : state.selectedShape)
    : -1;
  state.selectedPoint = null;
}

function selectShapeIndex(index, extend = false) {
  const item = activeItem();
  if (!item || index < 0 || index >= item.shapes.length) return;
  if (extend && state.selectionAnchor >= 0 && state.selectionAnchor < item.shapes.length) {
    const first = Math.min(state.selectionAnchor, index);
    const last = Math.max(state.selectionAnchor, index);
    const range = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
    setShapeSelection(range, index, state.selectionAnchor);
    return;
  }
  setShapeSelection([index], index, index);
}

function clearShapeSelection() {
  setShapeSelection([]);
}

function currentLabel() {
  const value = $("labelName").value.trim();
  return value || "unknown";
}

function loadLabelMemory() {
  try {
    const history = JSON.parse(localStorage.getItem("unknownAnnotatorLabelHistory") || "[]");
    state.labelHistory = Array.isArray(history) && history.length ? history : ["unknown"];
    state.lastLabel = localStorage.getItem("unknownAnnotatorLastLabel") || state.labelHistory[0] || "unknown";
  } catch (_) {
    state.labelHistory = ["unknown"];
    state.lastLabel = "unknown";
  }
  if (!state.labelHistory.includes("unknown")) state.labelHistory.push("unknown");
  $("labelName").value = state.lastLabel;
  renderLabelHistory();
}

function rememberLabel(label) {
  const clean = (label || "unknown").trim() || "unknown";
  state.lastLabel = clean;
  state.labelHistory = [clean, ...state.labelHistory.filter((item) => item !== clean)].slice(0, 24);
  if (!state.labelHistory.includes("unknown")) state.labelHistory.push("unknown");
  try {
    localStorage.setItem("unknownAnnotatorLabelHistory", JSON.stringify(state.labelHistory));
    localStorage.setItem("unknownAnnotatorLastLabel", state.lastLabel);
  } catch (_) {
    // Local files can run in stricter browser contexts; labels still work for this session.
  }
  $("labelName").value = clean;
  renderLabelHistory();
}

function renderLabelHistory() {
  const select = $("labelHistorySelect");
  const chips = $("labelHistoryChips");
  if (!select || !chips) return;
  select.innerHTML = "";
  chips.innerHTML = "";
  for (const label of state.labelHistory) {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    select.appendChild(option);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `label-chip${label === state.lastLabel ? " active" : ""}`;
    chip.textContent = label;
    const color = labelColor(label);
    chip.style.borderColor = color.stroke;
    chip.style.background = color.soft;
    chip.style.color = color.stroke;
    chip.addEventListener("click", () => {
      $("modalLabelName").value = label;
      select.value = label;
    });
    chips.appendChild(chip);
  }
  select.value = state.lastLabel;
}

function positionLabelModal(anchorPoint) {
  const modal = $("labelModal");
  const dialog = modal.querySelector(".label-modal");
  modal.classList.remove("at-annotation");
  dialog.style.left = "";
  dialog.style.top = "";
  if (!anchorPoint) return;

  const point = toScreen(anchorPoint);
  const canvasRect = overlayCanvas.getBoundingClientRect();
  modal.classList.add("at-annotation");
  requestAnimationFrame(() => {
    const dialogRect = dialog.getBoundingClientRect();
    const preferredLeft = canvasRect.left + point.x + 14;
    const preferredTop = canvasRect.top + point.y + 14;
    const left = clamp(preferredLeft, 12, Math.max(12, window.innerWidth - dialogRect.width - 12));
    const topAbove = canvasRect.top + point.y - dialogRect.height - 14;
    const top = preferredTop + dialogRect.height <= window.innerHeight - 12
      ? preferredTop
      : clamp(topAbove, 12, Math.max(12, window.innerHeight - dialogRect.height - 12));
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  });
}

function openLabelModal(shapeIndex, anchorPoint = null) {
  const item = activeItem();
  const shape = item && shapeIndex >= 0 ? item.shapes[shapeIndex] : null;
  if (!shape) return;
  state.pendingLabelShapeIndex = shapeIndex;
  renderLabelHistory();
  $("modalLabelName").value = shape.label || state.lastLabel || "unknown";
  $("labelHistorySelect").value = $("modalLabelName").value;
  $("labelModal").hidden = false;
  positionLabelModal(anchorPoint);
  setTimeout(() => $("modalLabelName").focus(), 0);
}

function closeLabelModal() {
  $("labelModal").hidden = true;
  $("labelModal").classList.remove("at-annotation");
  const dialog = $("labelModal").querySelector(".label-modal");
  dialog.style.left = "";
  dialog.style.top = "";
  state.pendingLabelShapeIndex = -1;
  state.pendingSamShapeIndexes = [];
}

function confirmLabelModal() {
  const item = activeItem();
  const shape = item && state.pendingLabelShapeIndex >= 0 ? item.shapes[state.pendingLabelShapeIndex] : null;
  if (!shape) {
    closeLabelModal();
    return;
  }
  const label = $("modalLabelName").value.trim() || "unknown";
  const samIndexes = state.pendingSamShapeIndexes.filter((index) => item.shapes[index]);
  if (samIndexes.length) {
    for (const index of samIndexes) {
      item.shapes[index].label = label;
      item.shapes[index].source = "sam2.1";
    }
    state.selectedShape = samIndexes[samIndexes.length - 1];
    setShapeSelection([state.selectedShape], state.selectedShape);
  } else {
    shape.label = label;
    shape.source = "manual";
    setShapeSelection([state.pendingLabelShapeIndex], state.pendingLabelShapeIndex);
  }
  rememberLabel(label);
  closeLabelModal();
  draw();
  queueAutoSave(item);
  setStatus(`标注名称已设为 ${label}`);
}

function params() {
  return {
    qualitySensitivity: Number(controls.qualitySensitivity.value),
    edgeFocus: Number(controls.edgeFocus.value),
    minArea: Number(controls.minArea.value),
    simplify: Number(controls.simplify.value),
    maxPoints: Number(controls.maxPoints.value),
    brushSize: Number(controls.brushSize.value),
    brushWheelSensitivity: Number(controls.brushWheelSensitivity.value),
    opacity: Number(controls.opacity.value)
  };
}

function updateOutputs() {
  const p = params();
  controlOutputs.qualitySensitivity.value = p.qualitySensitivity.toFixed(2);
  controlOutputs.edgeFocus.value = p.edgeFocus.toFixed(2);
  controlOutputs.minArea.value = `${(p.minArea * 100).toFixed(1)}%`;
  controlOutputs.simplify.value = String(p.simplify);
  controlOutputs.maxPoints.value = String(p.maxPoints);
  controlOutputs.brushSize.value = String(p.brushSize);
  controlOutputs.brushWheelSensitivity.value = String(p.brushWheelSensitivity);
  controlOutputs.opacity.value = p.opacity.toFixed(2);
}

function setStatus(text) {
  $("status").textContent = text;
}

function setMode(mode) {
  state.mode = mode;
  state.waterGaugeClickMode = false;
  if (mode !== "select") state.selectedPoint = null;
  if (mode !== "pen") state.draftPoints = [];
  if (mode !== "freehand") {
    state.freehandPoints = [];
    state.isFreehandDrawing = false;
  }
  if (mode !== "smear") {
    state.smearPoints = [];
    state.smearCursor = null;
    state.isSmearing = false;
  }
  if (mode !== "follow") {
    state.followPoints = [];
    state.isFollowDrawing = false;
  }
  if (mode !== "sam") {
    state.samPoint = null;
    state.samPoints = [];
    state.samPreview = null;
    state.samPreviews = [];
    state.samBox = null;
    state.samBoxStart = null;
  }
  updateButtons();
  draw();
  const names = { select: "选择", pen: "多边形笔", freehand: "自由笔", smear: "涂抹笔", follow: "跟随笔", sam: "SAM2.1 辅助分割", eraser: "橡皮擦" };
  setStatus(`当前模式：${names[mode]}`);
}

function setSamTool(tool) {
  if (tool !== "point" && tool !== "box") return;
  state.samTool = tool;
  state.samPoint = null;
  state.samPoints = [];
  state.samPreview = null;
  state.samPreviews = [];
  state.samBox = null;
  state.samBoxStart = null;
  updateButtons();
  draw();
  setStatus(tool === "point" ? "SAM2.1 提示点：可连续点击多个点" : "SAM2.1 矩形框：拖动图片框选区域");
}

function undoSamPrompt() {
  if (state.isSamRunning) {
    setStatus("SAM2.1 正在识别，请等待当前预览完成后再撤销");
    return;
  }
  if (state.samTool === "point" && state.samPoints.length) {
    state.samPoints.pop();
    state.samPoint = state.samPoints[state.samPoints.length - 1] || null;
    state.samPreviews = state.samPreviews.filter((preview) => preview.pointIndex < state.samPoints.length);
    state.samPreview = state.samPoint ? combineSamPointPreviews(activeItem()) : null;
    draw();
    setStatus("已撤销最后一个 SAM2.1 提示点");
    return;
  }
  if (state.samTool === "box" && (state.samBox || state.samBoxStart || state.samPoint)) {
    state.samPoint = null;
    state.samPreview = null;
    state.samBox = null;
    state.samBoxStart = null;
    draw();
    setStatus("已撤销 SAM2.1 矩形框");
  }
}

function snapshotShapes() {
  const item = activeItem();
  if (!item) return null;
  return JSON.stringify(item.shapes);
}

function restoreShapes(snapshot) {
  const item = activeItem();
  if (!item || snapshot === null) return;
  item.shapes = JSON.parse(snapshot);
  const selectedIndex = item.shapes.length ? Math.min(Math.max(state.selectedShape, 0), item.shapes.length - 1) : -1;
  setShapeSelection(selectedIndex >= 0 ? [selectedIndex] : [], selectedIndex);
  renderFileList();
  draw();
  updateAnnotationPanel();
  queueAutoSave(item);
}

function pushHistory() {
  const snapshot = snapshotShapes();
  if (snapshot === null) return;
  state.history.push(snapshot);
  if (state.history.length > 80) state.history.shift();
  state.redo = [];
  updateButtons();
}

function undo() {
  if (undoActiveDrawing()) return;
  const current = snapshotShapes();
  if (current === null || !state.history.length) return;
  state.redo.push(current);
  restoreShapes(state.history.pop());
}

function redo() {
  const current = snapshotShapes();
  if (current === null || !state.redo.length) return;
  state.history.push(current);
  restoreShapes(state.redo.pop());
}

function undoActiveDrawing() {
  if (state.isFollowDrawing) {
    state.followPoints = [];
    state.isFollowDrawing = false;
    draw();
    updateButtons();
    setStatus("已撤销当前描边，可重新开始");
    return true;
  }
  if (state.isFreehandDrawing) {
    state.freehandPoints = [];
    state.isFreehandDrawing = false;
    draw();
    updateButtons();
    setStatus("已撤销当前自由笔，可重新开始");
    return true;
  }
  if (state.draftPoints.length) {
    state.draftPoints.pop();
    draw();
    updateButtons();
    setStatus(state.draftPoints.length ? "已撤销最后一个多边形点" : "已撤销当前多边形");
    return true;
  }
  return false;
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, "");
}

function jsonName(name) {
  return `${baseName(name)}.json`;
}

function resizeCanvases() {
  const rect = imageCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [imageCanvas, overlayCanvas]) {
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }
  imageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function resetView() {
  clearViewTransform();
  draw();
}

function clearViewTransform() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
}

function setActualSize() {
  const item = activeItem();
  const rect = imageCanvas.parentElement.getBoundingClientRect();
  if (!item || !rect.width || !rect.height) return;
  const fitScale = Math.min(rect.width / item.img.naturalWidth, rect.height / item.img.naturalHeight);
  state.zoom = clamp(1 / fitScale, 0.25, 12);
  state.panX = 0;
  state.panY = 0;
  draw();
}

function zoomAt(screenX, screenY, factor) {
  const item = activeItem();
  const rect = imageCanvas.parentElement.getBoundingClientRect();
  if (!item || !rect.width || !rect.height) return;
  const before = toImagePoint(screenX, screenY);
  state.zoom = clamp(state.zoom * factor, 0.25, 12);
  const scale = state.view.fitScale * state.zoom;
  const centeredX = (rect.width - item.img.naturalWidth * scale) / 2;
  const centeredY = (rect.height - item.img.naturalHeight * scale) / 2;
  state.panX = screenX - centeredX - before.x * scale;
  state.panY = screenY - centeredY - before.y * scale;
  draw();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function readImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return { img, url };
}

function clearImportedItems() {
  for (const item of state.items) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
  state.items = [];
  state.activeIndex = -1;
  clearShapeSelection();
  state.clipboardShape = null;
  state.history = [];
  state.redo = [];
  state.draftPoints = [];
  state.freehandPoints = [];
  state.smearPoints = [];
  state.smearCursor = null;
  state.followPoints = [];
  state.isFreehandDrawing = false;
  state.isSmearing = false;
  state.isFollowDrawing = false;
}

async function handleFiles(files, { replace = false, preserveOrder = false } = {}) {
  const entries = [...files]
    .map((entry) => entry && entry.file ? entry : { file: entry, outputDir: null })
  const annotationsByPath = new Map(
    entries
      .filter((entry) => isJsonFile(entry.file))
      .map((entry) => [entry.file.webkitRelativePath || entry.file.name, entry.file])
  );
  const imageEntries = entries
    .filter((entry) => isImageFile(entry.file))
    .map((entry) => ({
      ...entry,
      annotationFile: entry.annotationFile || annotationsByPath.get(annotationPathForImage(entry.file)) || null
    }));
  if (!preserveOrder) {
    imageEntries.sort((a, b) => displayName(a.file).localeCompare(displayName(b.file), "zh-CN", { numeric: true }));
  }
  if (!imageEntries.length) return;
  if (replace) clearImportedItems();
  setStatus(`正在读取 ${imageEntries.length} 张图片`);
  const loaded = [];
  let restoredCount = 0;
  for (const entry of imageEntries) {
    const { file } = entry;
    const { img, url } = await readImage(file);
    const shapes = await loadAnnotationShapes(entry.annotationFile, img);
    if (shapes.length) restoredCount++;
    loaded.push({
      file,
      img,
      url,
      shapes,
      annotated: shapes.length > 0,
      outputDir: entry.outputDir || null,
      saveChain: Promise.resolve()
    });
  }
  state.items.push(...loaded);
  if (state.activeIndex === -1) state.activeIndex = 0;
  state.history = [];
  state.redo = [];
  renderFileList();
  draw();
  setStatus(`已载入 ${state.items.length} 张图片${restoredCount ? `，已恢复 ${restoredCount} 张图片的 JSON 标注` : ""}`);
}

async function readDirectoryImages(directoryHandle) {
  const entries = [];
  for await (const handle of directoryHandle.values()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      if (isImageFile(file)) {
        let annotationFile = null;
        try {
          const annotationHandle = await directoryHandle.getFileHandle(jsonName(file.name));
          annotationFile = await annotationHandle.getFile();
        } catch (_) {
          // No sibling JSON is normal for an unannotated image.
        }
        entries.push({ file, outputDir: directoryHandle, annotationFile });
      }
      continue;
    }
    if (handle.kind === "directory") entries.push(...await readDirectoryImages(handle));
  }
  return entries;
}

async function importFolderWithAutoSave() {
  if (!window.showDirectoryPicker) {
    $("folderInput").click();
    return;
  }
  try {
    const lastFolder = await loadRememberedFolder();
    let directory;
    try {
      directory = await window.showDirectoryPicker({
        mode: "readwrite",
        id: folderMemory.pickerId,
        ...(lastFolder ? { startIn: lastFolder } : {})
      });
    } catch (error) {
      if (!lastFolder || (error && error.name === "AbortError")) throw error;
      directory = await window.showDirectoryPicker({ mode: "readwrite", id: folderMemory.pickerId });
    }
    await importDirectoryHandle(directory, true);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("已取消导入文件夹");
      return;
    }
    setStatus("无法获得文件夹写入权限，将使用浏览器下载模式");
  }
}

async function importDirectoryHandle(directory, remember = false) {
  const entries = await readDirectoryImages(directory);
  if (!entries.length) {
    setStatus("该文件夹中没有可导入的图片");
    return;
  }
  state.outputDir = directory;
  $("outputPath").textContent = `自动保存到导入文件夹：${directory.name}`;
  if (remember) await saveRememberedFolder(directory);
  await handleFiles(entries, { replace: true, preserveOrder: true });
  setStatus(`已导入 ${entries.length} 张图片，后续标注会自动保存 JSON`);
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(jpe?g|png|bmp|gif|webp|tif?f)$/i.test(file.name);
}

function isJsonFile(file) {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

function annotationPathForImage(file) {
  const path = file.webkitRelativePath || file.name;
  return path.replace(/\.[^.]+$/, ".json");
}

async function loadAnnotationShapes(annotationFile, image) {
  if (!annotationFile) return [];
  try {
    const parsed = JSON.parse(await annotationFile.text());
    if (!Array.isArray(parsed.shapes)) return [];
    return parsed.shapes
      .map((shape) => {
        const points = (shape.points || [])
          .map((point) => {
            const x = Array.isArray(point) ? Number(point[0]) : Number(point.x);
            const y = Array.isArray(point) ? Number(point[1]) : Number(point.y);
            return {
              x: clamp(x, 0, image.naturalWidth),
              y: clamp(y, 0, image.naturalHeight)
            };
          })
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        return {
          label: typeof shape.label === "string" && shape.label.trim() ? shape.label.trim() : "unknown",
          points,
          source: "manual"
        };
      })
      .filter((shape) => shape.points.length >= 3);
  } catch (_) {
    return [];
  }
}

function renderFileList() {
  const list = $("fileList");
  const scrollTop = list.scrollTop;
  const scrollLeft = list.scrollLeft;
  list.className = state.items.length ? "file-list" : "file-list empty";
  list.innerHTML = "";
  $("queueCount").textContent = `${state.items.length} 张`;
  if (!state.items.length) {
    list.textContent = "还没有图片";
    updateImageCounter();
    return;
  }
  state.items.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `file-item ${item.shapes.length ? "annotated" : "unannotated"}${index === state.activeIndex ? " active" : ""}`;
    row.dataset.index = String(index);
    const fileState = item.shapes.length ? "已标注" : "未标注";
    row.innerHTML = `<div class="file-name">${index + 1}. ${escapeHtml(displayName(item.file))}</div><div class="file-meta">${item.img.naturalWidth} x ${item.img.naturalHeight} · ${item.shapes.length} 个区域 · ${fileState}</div>`;
    row.addEventListener("click", () => {
      selectImage(index);
    });
    list.appendChild(row);
  });
  list.scrollTop = scrollTop;
  list.scrollLeft = scrollLeft;
  scrollActiveFileIntoView();
  updateImageCounter();
}

function draw() {
  const item = activeItem();
  const rect = imageCanvas.parentElement.getBoundingClientRect();
  imageCtx.clearRect(0, 0, rect.width, rect.height);
  overlayCtx.clearRect(0, 0, rect.width, rect.height);
  $("emptyState").style.display = item ? "none" : "grid";
  if (!item) {
    $("jsonPreview").value = "";
    updateImageCounter();
    updateAnnotationPanel();
    renderShapeList();
    $("zoomInfo").textContent = "100%";
    return;
  }

  const iw = item.img.naturalWidth;
  const ih = item.img.naturalHeight;
  const fitScale = Math.min(rect.width / iw, rect.height / ih);
  const scale = fitScale * state.zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const ox = (rect.width - dw) / 2 + state.panX;
  const oy = (rect.height - dh) / 2 + state.panY;
  state.view = { scale, fitScale, offsetX: ox, offsetY: oy, width: dw, height: dh };

  imageCtx.drawImage(item.img, ox, oy, dw, dh);
  if (state.showOverlay) drawShapes(item);
  else {
    drawDraft();
    drawFreehandDraft();
    drawSmearDraft();
    drawFollowDraft();
  }
  drawSamPrompt();
  $("jsonPreview").value = JSON.stringify(buildJson(item), null, 2);
  updateButtons();
  updateImageCounter();
  updateAnnotationPanel();
  renderShapeList();
  $("zoomInfo").textContent = `${Math.round(scale * 100)}%`;
}

function displayName(file) {
  return file.webkitRelativePath || file.name;
}

function selectImage(index) {
  if (!state.items.length) return;
  state.activeIndex = Math.max(0, Math.min(state.items.length - 1, index));
  const item = activeItem();
  const firstShape = item && item.shapes.length ? 0 : -1;
  setShapeSelection(firstShape >= 0 ? [firstShape] : [], firstShape);
  state.draftPoints = [];
  state.freehandPoints = [];
  state.smearPoints = [];
  state.smearCursor = null;
  state.followPoints = [];
  state.isFreehandDrawing = false;
  state.isSmearing = false;
  state.isFollowDrawing = false;
  state.history = [];
  state.redo = [];
  renderFileList();
  draw();
  setStatus(`当前 ${state.activeIndex + 1}/${state.items.length}: ${item.file.name}`);
}

function scrollActiveFileIntoView() {
  const list = $("fileList");
  const activeRow = list.querySelector(".file-item.active");
  if (!activeRow) return;
  if (state.activeIndex >= state.items.length - 1) {
    list.scrollTop = list.scrollHeight;
    return;
  }
  activeRow.scrollIntoView({ block: "center" });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateImageCounter() {
  const total = state.items.length;
  if (!total || state.activeIndex < 0) {
    $("currentImageInfo").textContent = "第 0 / 0 张";
    return;
  }
  const item = activeItem();
  $("currentImageInfo").textContent = `第 ${state.activeIndex + 1} / ${total} 张 · ${item ? item.shapes.length : 0} 个区域`;
}

function updateAnnotationPanel() {
  const item = activeItem();
  const selectedIndexes = selectedShapeIndexes(item);
  const primaryIndex = selectedIndexes.includes(state.selectedShape) ? state.selectedShape : -1;
  const shape = item && primaryIndex >= 0 ? item.shapes[primaryIndex] : null;
  if (!shape) {
    $("activeShapeInfo").textContent = "当前未选择区域";
    $("applyLabel").disabled = true;
    $("useSelectedLabel").disabled = true;
    $("appendToSelected").disabled = true;
    return;
  }
  if (selectedIndexes.length > 1) {
    $("activeShapeInfo").textContent = `已选择 ${selectedIndexes.length} 个区域 · 输入名称后点击“应用名称”或按 Ctrl + E 批量修改`;
    $("applyLabel").disabled = false;
    $("useSelectedLabel").disabled = true;
    $("appendToSelected").disabled = true;
    $("appendToSelected").checked = false;
    return;
  }
  const pointInfo = state.selectedPoint && state.selectedPoint.shapeIndex === state.selectedShape
    ? ` · 当前点 ${state.selectedPoint.pointIndex + 1} / ${shape.points.length}`
    : "";
  $("activeShapeInfo").textContent = `当前区域：${state.selectedShape + 1} / ${item.shapes.length} · 名称 ${shape.label || "unknown"} · ${shape.points.length} 个点${pointInfo}`;
  $("applyLabel").disabled = false;
  $("useSelectedLabel").disabled = false;
  $("appendToSelected").disabled = false;
}

function renderShapeList() {
  const list = $("shapeList");
  const item = activeItem();
  const shapes = item ? item.shapes : [];
  $("shapeCount").textContent = `${shapes.length} 个`;
  list.innerHTML = "";
  list.className = shapes.length ? "shape-list" : "shape-list empty";
  if (!shapes.length) {
    list.textContent = "当前图片还没有区域";
    return;
  }
  shapes.forEach((shape, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `shape-item${selectedShapeIndexes(item).includes(index) ? " active" : ""}`;
    const color = labelColor(shape.label || "unknown");
    row.style.setProperty("--shape-color", color.stroke);
    row.innerHTML = `<div class="shape-title"><span class="shape-swatch"></span><span class="shape-name">${index + 1}. ${escapeHtml(shape.label || "unknown")}</span></div><div class="shape-meta">${shape.points.length} 个点 · ${Math.round(polygonArea(shape.points))} px²</div>`;
    row.addEventListener("click", (event) => {
      selectShapeIndex(index, event.shiftKey);
      if (!event.shiftKey) $("labelName").value = shape.label || "unknown";
      draw();
      const selectedCount = selectedShapeIndexes(item).length;
      setStatus(selectedCount > 1 ? `已连续选择 ${selectedCount} 个区域，可按 Ctrl + E 批量改名` : `已选择区域 ${index + 1}: ${shape.label || "unknown"}`);
    });
    list.appendChild(row);
  });
  const active = list.querySelector(".shape-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2);
}

function applyCurrentLabel() {
  const item = activeItem();
  const selectedIndexes = selectedShapeIndexes(item);
  if (!item || !selectedIndexes.length) return;
  pushHistory();
  for (const index of selectedIndexes) {
    item.shapes[index].label = currentLabel();
    item.shapes[index].source = "manual";
  }
  draw();
  queueAutoSave(item);
  setStatus(selectedIndexes.length > 1
    ? `已将 ${selectedIndexes.length} 个区域批量改名为 ${currentLabel()}`
    : `当前区域已改名为 ${currentLabel()}`);
}

function useSelectedLabel() {
  const item = activeItem();
  if (!item || state.selectedShape < 0 || !item.shapes[state.selectedShape]) return;
  $("labelName").value = item.shapes[state.selectedShape].label || "unknown";
  setStatus(`画笔将沿用名称：${$("labelName").value}`);
}

function stepImage(delta) {
  if (!state.items.length) return;
  const nextIndex = state.activeIndex + delta;
  if (nextIndex < 0) {
    setStatus("已经是第一张图片");
    updateButtons();
    return;
  }
  if (nextIndex >= state.items.length) {
    setStatus("已经是最后一张图片");
    updateButtons();
    return;
  }
  selectImage(nextIndex);
}

function stepShape(delta) {
  const item = activeItem();
  if (!item || !item.shapes.length) return;
  const current = state.selectedShape < 0 ? 0 : state.selectedShape;
  const next = clamp(current + delta, 0, item.shapes.length - 1);
  setShapeSelection([next], next);
  $("labelName").value = item.shapes[next].label || "unknown";
  draw();
  setStatus(`已选择区域 ${next + 1}/${item.shapes.length}`);
}

function updateButtons() {
  const hasItems = state.items.length > 0;
  const batchButton = $("autoAll");
  $("toggleOverlay").textContent = state.showOverlay ? "原图" : "标注";
  batchButton.disabled = !hasItems;
  batchButton.textContent = state.isBatchRunning
    ? (state.isBatchPaused ? "继续标注" : "暂停标注")
    : "批量标注";
  batchButton.title = state.isBatchRunning
    ? (state.isBatchPaused ? "继续剩余图片的批量标注" : "当前图片完成后暂停批量标注")
    : "从当前图片开始批量标注";
  $("prevImage").disabled = !hasItems || state.activeIndex <= 0;
  $("nextImage").disabled = !hasItems || state.activeIndex >= state.items.length - 1;
  $("toggleOverlay").disabled = !hasItems;
  $("selectMode").classList.toggle("mode-active", state.mode === "select");
  $("penMode").classList.toggle("mode-active", state.mode === "pen");
  $("freehandMode").classList.toggle("mode-active", state.mode === "freehand");
  $("smearMode").classList.toggle("mode-active", state.mode === "smear");
  $("followPenMode").classList.toggle("mode-active", state.mode === "follow");
  $("samMode").classList.toggle("mode-active", state.mode === "sam");
  $("samPointMode").hidden = state.mode !== "sam";
  $("samBoxMode").hidden = state.mode !== "sam";
  $("samPointMode").classList.toggle("mode-active", state.mode === "sam" && state.samTool === "point");
  $("samBoxMode").classList.toggle("mode-active", state.mode === "sam" && state.samTool === "box");
  $("eraserMode").classList.toggle("mode-active", state.mode === "eraser");
  $("samMode").disabled = !hasItems || state.isSamRunning;
  $("samPointMode").disabled = !hasItems || state.isSamRunning;
  $("samBoxMode").disabled = !hasItems || state.isSamRunning;
  $("waterGaugeActions").hidden = !state.waterGaugePanelOpen;
  $("waterGaugeMode").classList.toggle("mode-active", state.waterGaugePanelOpen);
  $("waterGaugeClick").classList.toggle("mode-active", state.waterGaugeClickMode);
  $("waterGaugeMode").disabled = state.isWaterGaugeRunning;
  $("waterGaugeAuto").disabled = !hasItems || state.isWaterGaugeRunning;
  $("waterGaugeClick").disabled = !hasItems || state.isWaterGaugeRunning;
  $("zoomIn").disabled = !hasItems;
  $("zoomOut").disabled = !hasItems;
  $("fitView").disabled = !hasItems;
  $("actualSize").disabled = !hasItems;
  const hasActiveDraft = state.isFollowDrawing || state.isFreehandDrawing || state.isSmearing || state.draftPoints.length > 0 || state.smearPoints.length > 0;
  $("undoAction").disabled = !hasItems || (!state.history.length && !hasActiveDraft);
  $("redoAction").disabled = !hasItems || !state.redo.length;
  $("copyShape").disabled = !hasItems || !selectedShapeIndexes().length;
  $("pasteNext").disabled = !hasItems || !state.clipboardShape;
  imageCanvas.parentElement.classList.toggle("pen-cursor", state.mode === "pen");
  imageCanvas.parentElement.classList.toggle("freehand-cursor", state.mode === "freehand");
  imageCanvas.parentElement.classList.toggle("smear-cursor", state.mode === "smear");
  imageCanvas.parentElement.classList.toggle("follow-cursor", state.mode === "follow");
  imageCanvas.parentElement.classList.toggle("sam-cursor", state.mode === "sam");
  imageCanvas.parentElement.classList.toggle("water-gauge-cursor", state.waterGaugeClickMode);
  imageCanvas.parentElement.classList.toggle("eraser-cursor", state.mode === "eraser");
  imageCanvas.parentElement.classList.toggle("pan-cursor", state.isPanning);
}


const labelPalette = [
  "#f2a20c", "#1769d2", "#14a06f", "#d94b7d", "#7c4dff",
  "#0f9bb8", "#dc6b19", "#5b8c00", "#bd3ec7", "#52627a"
];

function hashLabel(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return hash;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function labelColor(label) {
  const key = label || "unknown";
  const stroke = labelPalette[hashLabel(key) % labelPalette.length];
  return {
    stroke,
    fill: stroke,
    soft: rgba(stroke, 0.14),
    wash: rgba(stroke, params().opacity)
  };
}
function toScreen(point) {
  return {
    x: state.view.offsetX + point.x * state.view.scale,
    y: state.view.offsetY + point.y * state.view.scale
  };
}

function toImagePoint(x, y) {
  return {
    x: (x - state.view.offsetX) / state.view.scale,
    y: (y - state.view.offsetY) / state.view.scale
  };
}

function drawShapes(item) {
  const p = params();
  const selectedIndexes = new Set(selectedShapeIndexes(item));
  overlayCtx.lineJoin = "round";
  overlayCtx.lineCap = "round";
  item.shapes.forEach((shape, index) => {
    if (shape.points.length < 3) return;
    const color = labelColor(shape.label || "unknown");
    overlayCtx.beginPath();
    shape.points.forEach((pt, i) => {
      const sp = toScreen(pt);
      if (i === 0) overlayCtx.moveTo(sp.x, sp.y);
      else overlayCtx.lineTo(sp.x, sp.y);
    });
    overlayCtx.closePath();
    overlayCtx.fillStyle = rgba(color.stroke, p.opacity);
    overlayCtx.strokeStyle = color.stroke;
    overlayCtx.lineWidth = selectedIndexes.has(index) ? 3.5 : 2.25;
    overlayCtx.fill();
    overlayCtx.stroke();

    if (selectedIndexes.has(index)) {
      overlayCtx.save();
      overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.88)";
      overlayCtx.lineWidth = 1.2;
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    const labelText = shape.label || "unknown";
    const label = toScreen(shape.points[0]);
    overlayCtx.font = "12px Microsoft YaHei, Arial";
    const labelWidth = Math.max(58, overlayCtx.measureText(labelText).width + 14);
    overlayCtx.fillStyle = color.stroke;
    roundRect(overlayCtx, label.x + 2, label.y + 2, labelWidth, 20, 5);
    overlayCtx.fill();
    overlayCtx.fillStyle = "#ffffff";
    overlayCtx.fillText(labelText, label.x + 9, label.y + 16);

    if (index === state.selectedShape) {
      for (const [pointIndex, pt] of shape.points.entries()) {
        const sp = toScreen(pt);
        const isSelectedPoint = state.selectedPoint &&
          state.selectedPoint.shapeIndex === index &&
          state.selectedPoint.pointIndex === pointIndex;
        overlayCtx.beginPath();
        overlayCtx.arc(sp.x, sp.y, isSelectedPoint ? 8 : 5, 0, Math.PI * 2);
        overlayCtx.fillStyle = isSelectedPoint ? "#ffffff" : color.stroke;
        overlayCtx.fill();
        overlayCtx.strokeStyle = isSelectedPoint ? color.stroke : "#ffffff";
        overlayCtx.lineWidth = isSelectedPoint ? 3 : 1.5;
        overlayCtx.stroke();
      }
    }
  });
  drawDraft();
  drawFreehandDraft();
  drawSmearDraft();
  drawFollowDraft();
}

function drawSmearDraft() {
  if (state.mode !== "smear") return;
  const radius = Math.max(4, params().brushSize / 2);
  overlayCtx.save();
  if (state.smearPoints.length) {
    overlayCtx.beginPath();
    state.smearPoints.forEach((pt, index) => {
      const sp = toScreen(pt);
      if (index === 0) overlayCtx.moveTo(sp.x, sp.y);
      else overlayCtx.lineTo(sp.x, sp.y);
    });
    overlayCtx.strokeStyle = "rgba(242, 162, 12, 0.72)";
    overlayCtx.lineWidth = Math.max(2, params().brushSize);
    overlayCtx.lineCap = "round";
    overlayCtx.lineJoin = "round";
    overlayCtx.stroke();
  }
  if (state.smearCursor) {
    const sp = toScreen(state.smearCursor);
    overlayCtx.beginPath();
    overlayCtx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
    overlayCtx.fillStyle = "rgba(242, 162, 12, 0.12)";
    overlayCtx.fill();
    overlayCtx.strokeStyle = "#f2a20c";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 4]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  }
  overlayCtx.restore();
}

function normalizeSamBox(start, end) {
  return {
    x1: Math.min(start.x, end.x),
    y1: Math.min(start.y, end.y),
    x2: Math.max(start.x, end.x),
    y2: Math.max(start.y, end.y)
  };
}

function clipSamPolygon(points, box) {
  const clip = (input, inside, intersect) => {
    if (!input.length) return [];
    const output = [];
    let previous = input[input.length - 1];
    let previousInside = inside(previous);
    for (const current of input) {
      const currentInside = inside(current);
      if (currentInside !== previousInside) output.push(intersect(previous, current));
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
    return output;
  };
  let result = clip(points, (p) => p.x >= box.x1, (a, b) => ({ x: box.x1, y: a.y + (b.y - a.y) * (box.x1 - a.x) / (b.x - a.x) }));
  result = clip(result, (p) => p.x <= box.x2, (a, b) => ({ x: box.x2, y: a.y + (b.y - a.y) * (box.x2 - a.x) / (b.x - a.x) }));
  result = clip(result, (p) => p.y >= box.y1, (a, b) => ({ x: a.x + (b.x - a.x) * (box.y1 - a.y) / (b.y - a.y), y: box.y1 }));
  return clip(result, (p) => p.y <= box.y2, (a, b) => ({ x: a.x + (b.x - a.x) * (box.y2 - a.y) / (b.y - a.y), y: box.y2 }));
}

function combineSamPointPreviews(item) {
  if (!state.samPreviews.length) return null;
  if (state.samPreviews.length === 1) return { ...state.samPreviews[0], points: state.samPreviews[0].points.map((point) => ({ ...point })) };

  const p = params();
  const scale = Math.min(1, 560 / Math.max(item.img.naturalWidth, item.img.naturalHeight));
  const w = Math.max(1, Math.round(item.img.naturalWidth * scale));
  const h = Math.max(1, Math.round(item.img.naturalHeight * scale));
  const mask = buildProtectedMask(item, state.samPreviews, w, h);
  closeMask(mask, w, h);
  const components = findComponents(mask, w, h, 1);
  let points;
  if (components.length === 1) {
    points = componentToPolygon(components[0], mask, w, h, item.img.naturalWidth / w, item.img.naturalHeight / h, p);
  } else {
    points = convexHull(state.samPreviews.flatMap((preview) => preview.points));
    points = rdpClosed(points, Math.max(1, p.simplify * 0.8));
    const maxPoints = Math.max(3, Math.round(p.maxPoints || 0));
    while (points.length > maxPoints) points = decimate(points);
    points = points.map((point) => ({ x: Number(point.x.toFixed(1)), y: Number(point.y.toFixed(1)) }));
  }
  return points.length >= 3
    ? { points, score: Math.max(...state.samPreviews.map((preview) => Number(preview.score) || 0)) }
    : null;
}

function drawSamPrompt() {
  overlayCtx.save();
  if (state.samBox) {
    const topLeft = toScreen({ x: state.samBox.x1, y: state.samBox.y1 });
    const bottomRight = toScreen({ x: state.samBox.x2, y: state.samBox.y2 });
    overlayCtx.strokeStyle = "#1469c7";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    overlayCtx.setLineDash([]);
  }
  const previews = state.samPreview ? [state.samPreview] : [];
  previews.forEach((preview) => {
    if (preview.points.length < 3) return;
    overlayCtx.beginPath();
    preview.points.forEach((pt, index) => {
      const screenPoint = toScreen(pt);
      if (index === 0) overlayCtx.moveTo(screenPoint.x, screenPoint.y);
      else overlayCtx.lineTo(screenPoint.x, screenPoint.y);
    });
    overlayCtx.closePath();
    overlayCtx.fillStyle = "rgba(20, 105, 199, 0.18)";
    overlayCtx.strokeStyle = "#1469c7";
    overlayCtx.lineWidth = 2.5;
    overlayCtx.setLineDash([7, 5]);
    overlayCtx.fill();
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  });
  const prompts = state.samTool === "point" ? state.samPoints : (state.samPoint ? [state.samPoint] : []);
  prompts.forEach((prompt, index) => {
    const point = toScreen(prompt);
    const isLast = index === prompts.length - 1;
    overlayCtx.beginPath();
    overlayCtx.arc(point.x, point.y, isLast ? 11 : 8, 0, Math.PI * 2);
    overlayCtx.fillStyle = isLast ? "rgba(20, 105, 199, 0.24)" : "rgba(20, 105, 199, 0.14)";
    overlayCtx.fill();
    overlayCtx.beginPath();
    overlayCtx.arc(point.x, point.y, isLast ? 5 : 4, 0, Math.PI * 2);
    overlayCtx.fillStyle = "#1469c7";
    overlayCtx.fill();
    overlayCtx.strokeStyle = "#ffffff";
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
  });
  overlayCtx.restore();
}

async function runSamSegmentation() {
  const item = activeItem();
  if (!item) {
    setStatus("请先选择图片后再使用 SAM2.1");
    return;
  }
  if (!state.samPoint) {
    setStatus("请先点击图片选择 SAM2.1 提示点");
    return;
  }
  if (state.isSamRunning) return;

  const samPoint = { ...state.samPoint };
  const samPointIndex = state.samPoints.length - 1;
  const samBox = state.samBox ? { ...state.samBox } : null;

  state.isSamRunning = true;
  updateButtons();
  setStatus(state.samTool === "point" ? `SAM2.1 正在识别第 ${state.samPoints.length} 个提示点，请稍候...` : "SAM2.1 正在识别矩形框，请稍候...");
  try {
    const formData = new FormData();
    formData.append("image", item.file);
    formData.append("x", samPoint.x);
    formData.append("y", samPoint.y);
    formData.append("label", "1");
    if (samBox) {
      formData.append("box_x1", samBox.x1);
      formData.append("box_y1", samBox.y1);
      formData.append("box_x2", samBox.x2);
      formData.append("box_y2", samBox.y2);
    }
    const response = await fetch(`${WATER_GAUGE_SERVICE}/segment`, { method: "POST", body: formData });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    const data = await response.json();
    if (!data || data.success === false) throw new Error(data && data.message ? data.message : "服务没有返回有效结果");
    if (!Array.isArray(data.polygon) || data.polygon.length < 3) throw new Error("服务未返回有效多边形");

    let points = data.polygon.map((p) => ({
      x: Number(clamp(Number(p.x), 0, item.img.naturalWidth).toFixed(1)),
      y: Number(clamp(Number(p.y), 0, item.img.naturalHeight).toFixed(1))
    }));
    if (samBox) points = clipSamPolygon(points, samBox);
    if (points.length < 3) throw new Error("矩形框内没有可用的分割轮廓");
    const maxPoints = Math.max(3, Math.round(params().maxPoints || 0));
    while (points.length > maxPoints) points = decimate(points);
    if (state.samTool === "point") {
      state.samPreviews.push({ points, score: data.score, pointIndex: samPointIndex });
      state.samPreview = combineSamPointPreviews(item);
    } else {
      state.samPreview = { points, score: data.score };
    }
    draw();
    setStatus(state.samTool === "point"
      ? `SAM2.1 已更新 ${state.samPreviews.length} 个提示点的联合预览，score=${data.score}；按 F 确认`
      : `SAM2.1 矩形预览已更新，score=${data.score}；按 F 确认`);
  } catch (error) {
    const detail = error instanceof TypeError
      ? `无法连接 SAM2.1 服务，请确认 ${WATER_GAUGE_SERVICE} 已启动`
      : (error && error.message ? error.message : "未知错误");
    setStatus(`SAM2.1 分割失败：${detail}`);
  } finally {
    state.isSamRunning = false;
    updateButtons();
  }
}

function finishSamSegmentation() {
  const item = activeItem();
  if (!item) return;
  if (state.isSamRunning) {
    setStatus("SAM2.1 正在识别当前提示点，请等待预览完成后再按 F");
    return;
  }
  const preview = state.samPreview;
  if (!preview || preview.points.length < 3) {
    setStatus("请先点击图片生成 SAM2.1 预览后再按 F");
    return;
  }
  const modalAnchor = state.samPoint || preview.points[preview.points.length - 1];
  pushHistory();
  item.shapes.push({
    label: currentLabel(),
    points: preview.points.map((point) => ({ ...point })),
    source: "sam2.1"
  });
  state.pendingSamShapeIndexes = [item.shapes.length - 1];
  state.selectedShape = item.shapes.length - 1;
  setShapeSelection([state.selectedShape], state.selectedShape);
  state.samPoint = null;
  state.samPoints = [];
  state.samPreview = null;
  state.samPreviews = [];
  state.samBox = null;
  state.samBoxStart = null;
  renderFileList();
  draw();
  queueAutoSave(item);
  openLabelModal(state.selectedShape, modalAnchor);
  setStatus("SAM2.1 分割已确认，请输入标注名称");
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawDraft() {
  if (state.mode !== "pen" || !state.draftPoints.length) return;
  const item = activeItem();
  const appendShape = item && $("appendToSelected").checked ? item.shapes[state.selectedShape] : null;
  overlayCtx.beginPath();
  const points = appendShape && appendShape.points.length
    ? [appendShape.points[appendShape.points.length - 1], ...state.draftPoints]
    : state.draftPoints;
  points.forEach((pt, index) => {
    const sp = toScreen(pt);
    if (index === 0) overlayCtx.moveTo(sp.x, sp.y);
    else overlayCtx.lineTo(sp.x, sp.y);
  });
  overlayCtx.strokeStyle = "#13b46e";
  overlayCtx.lineWidth = 2.5;
  overlayCtx.setLineDash([6, 5]);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
  for (const pt of state.draftPoints) {
    const sp = toScreen(pt);
    overlayCtx.beginPath();
    overlayCtx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
    overlayCtx.fillStyle = "#13b46e";
    overlayCtx.fill();
    overlayCtx.strokeStyle = "#086f43";
    overlayCtx.lineWidth = 1.5;
    overlayCtx.stroke();
  }
}

function drawFreehandDraft() {
  if (state.mode !== "freehand" || state.freehandPoints.length < 2) return;
  overlayCtx.beginPath();
  state.freehandPoints.forEach((pt, index) => {
    const sp = toScreen(pt);
    if (index === 0) overlayCtx.moveTo(sp.x, sp.y);
    else overlayCtx.lineTo(sp.x, sp.y);
  });
  overlayCtx.strokeStyle = "#16a1d8";
  overlayCtx.lineWidth = 2.5;
  overlayCtx.setLineDash([4, 4]);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
}

function drawFollowDraft() {
  if (state.mode !== "follow" || state.followPoints.length < 1) return;
  overlayCtx.beginPath();
  state.followPoints.forEach((pt, index) => {
    const sp = toScreen(pt);
    if (index === 0) overlayCtx.moveTo(sp.x, sp.y);
    else overlayCtx.lineTo(sp.x, sp.y);
  });
  overlayCtx.strokeStyle = "#7c4dff";
  overlayCtx.lineWidth = 2.5;
  overlayCtx.stroke();
  if (state.followPoints.length >= 3) {
    const first = toScreen(state.followPoints[0]);
    const last = toScreen(state.followPoints[state.followPoints.length - 1]);
    overlayCtx.beginPath();
    overlayCtx.moveTo(last.x, last.y);
    overlayCtx.lineTo(first.x, first.y);
    overlayCtx.setLineDash([6, 5]);
    overlayCtx.strokeStyle = "#7c4dff";
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  }
  const start = toScreen(state.followPoints[0]);
  overlayCtx.beginPath();
  overlayCtx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  overlayCtx.fillStyle = "#7c4dff";
  overlayCtx.fill();
  overlayCtx.strokeStyle = "#ffffff";
  overlayCtx.lineWidth = 1.5;
  overlayCtx.stroke();
}

function addFreehandPoint(point) {
  const item = activeItem();
  if (!item) return;
  const pt = {
    x: clamp(point.x, 0, item.img.naturalWidth),
    y: clamp(point.y, 0, item.img.naturalHeight)
  };
  const last = state.freehandPoints[state.freehandPoints.length - 1];
  if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) >= Math.max(1.5, 3 / state.view.scale)) {
    state.freehandPoints.push(pt);
  }
}

function addSmearPoint(point) {
  const item = activeItem();
  if (!item) return;
  const pt = {
    x: point.x,
    y: point.y
  };
  state.smearCursor = pt;
  const brushImageSize = Math.max(1, params().brushSize / Math.max(0.001, state.view.scale));
  const last = state.smearPoints[state.smearPoints.length - 1];
  if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) >= Math.max(1, brushImageSize * 0.18)) {
    state.smearPoints.push(pt);
  }
}

function addFollowPoint(point) {
  const item = activeItem();
  if (!item || !state.isFollowDrawing) return;
  const pt = {
    x: clamp(point.x, 0, item.img.naturalWidth),
    y: clamp(point.y, 0, item.img.naturalHeight)
  };
  const last = state.followPoints[state.followPoints.length - 1];
  if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) >= Math.max(1.2, 2.5 / state.view.scale)) {
    state.followPoints.push(pt);
  }
}

function createSmearMaskData(item) {
  if (!item || !state.smearPoints.length) return [];
  const p = params();
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(item.img.naturalWidth, item.img.naturalHeight));
  const w = Math.max(1, Math.round(item.img.naturalWidth * scale));
  const h = Math.max(1, Math.round(item.img.naturalHeight * scale));
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  const brushImageSize = Math.max(1, p.brushSize / Math.max(0.001, state.view.scale));
  const lineWidth = Math.max(1, brushImageSize * scale);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  state.smearPoints.forEach((pt, index) => {
    const x = pt.x * scale;
    const y = pt.y * scale;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (state.smearPoints.length > 1) ctx.stroke();
  for (const pt of state.smearPoints) {
    ctx.beginPath();
    ctx.arc(pt.x * scale, pt.y * scale, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let index = 0; index < mask.length; index++) {
    if (pixels[index * 4 + 3] > 0) mask[index] = 1;
  }
  closeMask(mask, w, h);
  const minPixels = Math.max(8, Math.round((lineWidth * lineWidth) * 0.18));
  return {
    mask,
    w,
    h,
    sx: item.img.naturalWidth / w,
    sy: item.img.naturalHeight / h,
    minPixels,
    params: p
  };
}

function polygonFromMaskData(maskData) {
  if (!maskData || !maskData.mask) return [];
  const { mask, w, h, sx, sy, minPixels } = maskData;
  const components = findComponents(mask, w, h, minPixels);
  if (!components.length) return [];
  const component = components.sort((a, b) => b.length - a.length)[0];
  return componentToPolygon(component, mask, w, h, sx, sy, maskData.params);
}

function smearPointsToPolygon(item) {
  return polygonFromMaskData(createSmearMaskData(item));
}

function drawShapeToMaskContext(ctx, shape, sx, sy, w, h) {
  if (!shape || !Array.isArray(shape.points) || shape.points.length < 3) return;
  ctx.beginPath();
  shape.points.forEach((point, index) => {
    const x = clamp(point.x * sx, 0, w);
    const y = clamp(point.y * sy, 0, h);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function shapeToMask(shape, maskData) {
  const { w, h, sx, sy } = maskData;
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  drawShapeToMaskContext(ctx, shape, 1 / sx, 1 / sy, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let index = 0; index < mask.length; index++) {
    if (pixels[index * 4 + 3] > 0) mask[index] = 1;
  }
  return mask;
}

function masksOverlap(a, b) {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] && b[index]) return true;
  }
  return false;
}

function mergeSmearWithOverlappingShapes(item, smearMaskData) {
  if (!item || !smearMaskData || !smearMaskData.mask) return null;
  const shapeMasks = [];
  const overlappingIndexes = [];
  item.shapes.forEach((shape, index) => {
    if (!shape || !Array.isArray(shape.points) || shape.points.length < 3) return;
    const mask = shapeToMask(shape, smearMaskData);
    if (!masksOverlap(smearMaskData.mask, mask)) return;
    overlappingIndexes.push(index);
    shapeMasks.push(mask);
  });
  if (!overlappingIndexes.length) return null;

  const unionMask = smearMaskData.mask.slice();
  for (const mask of shapeMasks) {
    for (let index = 0; index < unionMask.length; index++) {
      if (mask[index]) unionMask[index] = 1;
    }
  }
  closeMask(unionMask, smearMaskData.w, smearMaskData.h);
  const unionData = { ...smearMaskData, mask: unionMask };
  const points = polygonFromMaskData(unionData);
  if (points.length < 3) return null;
  return { points, overlappingIndexes };
}

function commitManualShape(points, fallbackLabel) {
  const item = activeItem();
  if (!item || !points.length) return -1;
  const selectedShape = item.shapes[state.selectedShape];
  if ($("appendToSelected").checked && selectedShape) {
    selectedShape.points.push(...points);
    selectedShape.label = selectedShape.label || fallbackLabel || "unknown";
    selectedShape.source = "manual";
    queueAutoSave(item);
    return state.selectedShape;
  }
  item.shapes.push({
    label: fallbackLabel || "unknown",
    points,
    source: "manual"
  });
  setShapeSelection([item.shapes.length - 1], item.shapes.length - 1);
  queueAutoSave(item);
  return state.selectedShape;
}

function finishFollowPen() {
  const item = activeItem();
  if (!item || state.followPoints.length < 3) {
    state.followPoints = [];
    state.isFollowDrawing = false;
    draw();
    return;
  }
  pushHistory();
  let points = rdpClosed(state.followPoints, Math.max(0.8, 1.8 / state.view.scale));
  points = smoothClosed(points, params().simplify <= 2 ? 0 : 1);
  const maxManualPoints = Math.max(3, Math.round(params().maxPoints || 0));
  while (points.length > maxManualPoints) points = decimate(points);
  points = points.map((pt) => ({ x: Number(pt.x.toFixed(1)), y: Number(pt.y.toFixed(1)) }));
  const shapeIndex = commitManualShape(points, state.lastLabel || currentLabel());
  state.followPoints = [];
  state.isFollowDrawing = false;
  renderFileList();
  draw();
  openLabelModal(shapeIndex, points[points.length - 1]);
  setStatus("跟随笔已自动闭合，请确认标注名称");
}

function finishFreehand() {
  const item = activeItem();
  if (!item || state.freehandPoints.length < 3) {
    state.freehandPoints = [];
    state.isFreehandDrawing = false;
    draw();
    return;
  }
  pushHistory();
  let points = rdpClosed(state.freehandPoints, Math.max(1, 2 / state.view.scale));
  points = smoothClosed(points, 1);
  const maxManualPoints = Math.max(3, Math.round(params().maxPoints || 0));
  while (points.length > maxManualPoints) points = decimate(points);
  points = points.map((pt) => ({ x: Number(pt.x.toFixed(1)), y: Number(pt.y.toFixed(1)) }));
  const shapeIndex = commitManualShape(points, state.lastLabel || currentLabel());
  state.freehandPoints = [];
  state.isFreehandDrawing = false;
  renderFileList();
  draw();
  openLabelModal(shapeIndex, points[points.length - 1]);
  setStatus("自由笔已自动闭合，请确认标注名称");
}

function finishSmear() {
  const item = activeItem();
  if (!item || !state.smearPoints.length) {
    state.smearPoints = [];
    state.smearCursor = null;
    state.isSmearing = false;
    draw();
    return;
  }
  const modalAnchor = state.smearCursor || state.smearPoints[state.smearPoints.length - 1];
  const smearMaskData = createSmearMaskData(item);
  let points = polygonFromMaskData(smearMaskData);
  if (points.length < 3) {
    state.smearPoints = [];
    state.smearCursor = null;
    state.isSmearing = false;
    draw();
    setStatus("涂抹区域太小，请涂大一点再生成标注");
    return;
  }
  pushHistory();
  const mergeResult = mergeSmearWithOverlappingShapes(item, smearMaskData);
  let shapeIndex = -1;
  let statusText = "涂抹区域已自动闭合，请确认标注名称";
  if (mergeResult) {
    const labelSourceIndex = mergeResult.overlappingIndexes[mergeResult.overlappingIndexes.length - 1];
    const labelSource = item.shapes[labelSourceIndex];
    const mergedShape = {
      label: (labelSource && labelSource.label) || state.lastLabel || currentLabel(),
      points: mergeResult.points,
      source: "manual"
    };
    [...mergeResult.overlappingIndexes].sort((a, b) => b - a).forEach((index) => item.shapes.splice(index, 1));
    item.shapes.push(mergedShape);
    shapeIndex = item.shapes.length - 1;
    setShapeSelection([shapeIndex], shapeIndex);
    queueAutoSave(item);
    points = mergeResult.points;
    statusText = `涂抹区域已与 ${mergeResult.overlappingIndexes.length} 个已有标注合并，请确认标注名称`;
  } else {
    shapeIndex = commitManualShape(points, state.lastLabel || currentLabel());
  }
  state.smearPoints = [];
  state.smearCursor = null;
  state.isSmearing = false;
  renderFileList();
  draw();
  openLabelModal(shapeIndex, modalAnchor);
  setStatus(statusText);
}

function finishDraft() {
  const item = activeItem();
  if (!item || state.draftPoints.length < 3) return;
  pushHistory();
  const points = state.draftPoints.map((pt) => ({ x: Number(pt.x.toFixed(1)), y: Number(pt.y.toFixed(1)) }));
  const shapeIndex = commitManualShape(points, state.lastLabel || currentLabel());
  state.draftPoints = [];
  renderFileList();
  draw();
  openLabelModal(shapeIndex, points[points.length - 1]);
  setStatus("多边形笔已自动闭合，请确认标注名称");
}

function cancelDraft() {
  if (!state.draftPoints.length && !state.freehandPoints.length && !state.smearPoints.length && !state.followPoints.length) return;
  state.draftPoints = [];
  state.freehandPoints = [];
  state.smearPoints = [];
  state.smearCursor = null;
  state.followPoints = [];
  state.isFreehandDrawing = false;
  state.isSmearing = false;
  state.isFollowDrawing = false;
  draw();
  setStatus("已取消当前绘制");
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function shapeAtPoint(point) {
  const item = activeItem();
  if (!item) return -1;
  for (let i = item.shapes.length - 1; i >= 0; i--) {
    if (pointInPolygon(point, item.shapes[i].points)) return i;
  }
  return -1;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function protectedShapesForAuto(item) {
  return item.shapes.filter((shape) => (
    shape.source !== "auto" &&
    Array.isArray(shape.points) &&
    shape.points.length >= 3
  ));
}

function buildProtectedMask(item, shapes, w, h) {
  const mask = new Uint8Array(w * h);
  if (!shapes.length) return mask;
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  const sx = w / item.img.naturalWidth;
  const sy = h / item.img.naturalHeight;
  ctx.fillStyle = "#000";
  for (const shape of shapes) {
    ctx.beginPath();
    shape.points.forEach((point, index) => {
      const x = clamp(point.x * sx, 0, w);
      const y = clamp(point.y * sy, 0, h);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  const pixels = ctx.getImageData(0, 0, w, h).data;
  for (let index = 0; index < mask.length; index++) {
    if (pixels[index * 4 + 3] > 0) mask[index] = 1;
  }
  return mask;
}

function removeProtectedPixels(mask, protectedMask) {
  for (let index = 0; index < mask.length; index++) {
    if (protectedMask[index]) mask[index] = 0;
  }
}

function isCornerPixel(x, y, w, h, radius) {
  return (
    Math.hypot(x, y) <= radius ||
    Math.hypot(w - 1 - x, y) <= radius ||
    Math.hypot(x, h - 1 - y) <= radius ||
    Math.hypot(w - 1 - x, h - 1 - y) <= radius
  );
}

function findUnknownComponents(mask, w, h, minPixels, cornerRadius) {
  const cornerMinPixels = Math.max(16, Math.round(minPixels * 0.35));
  return findComponents(mask, w, h, cornerMinPixels).filter((component) => (
    component.length >= minPixels || component.some((index) => {
      const x = index % w;
      const y = Math.floor(index / w);
      return isCornerPixel(x, y, w, h, cornerRadius);
    })
  ));
}

function autoAnnotateItem(item) {
  const p = params();
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(item.img.naturalWidth, item.img.naturalHeight));
  const w = Math.max(1, Math.round(item.img.naturalWidth * scale));
  const h = Math.max(1, Math.round(item.img.naturalHeight * scale));
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(item.img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  const saturation = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      lum[y * w + x] = r * 0.299 + g * 0.587 + b * 0.114;
      saturation[y * w + x] = max === 0 ? 0 : (max - min) / max;
    }
  }

  const mask = new Uint8Array(w * h);
  const maxEdgeDistance = Math.max(8, Math.min(w, h) * 0.28);
  const cornerRadius = Math.max(10, Math.min(w, h) * 0.16);
  const sensitivity = clamp((p.qualitySensitivity - 0.50) / 0.08, -1, 1);
  const darkLimit = 82 + sensitivity * 22;
  const detailLimit = 15 + sensitivity * 5;
  const scoreCut = 0.52 - sensitivity * 0.05;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const l = lum[idx];
      const contrast = (
        Math.abs(l - lum[idx - 1]) +
        Math.abs(l - lum[idx + 1]) +
        Math.abs(l - lum[idx - w]) +
        Math.abs(l - lum[idx + w])
      ) / 4;
      const darkRisk = 1 - smoothstep(darkLimit * 0.55, darkLimit, l);
      const detailRisk = 1 - smoothstep(detailLimit * 0.45, detailLimit, contrast);
      const hazeRisk = (1 - Math.min(1, saturation[idx] * 4.2)) * (1 - smoothstep(95, 170, l));
      const edgeDistance = Math.min(x, y, w - 1 - x, h - 1 - y);
      const edgeRisk = 1 - Math.min(1, edgeDistance / maxEdgeDistance);
      const cornerDistance = Math.min(
        Math.hypot(x, y),
        Math.hypot(w - 1 - x, y),
        Math.hypot(x, h - 1 - y),
        Math.hypot(w - 1 - x, h - 1 - y)
      );
      const cornerRisk = 1 - Math.min(1, cornerDistance / cornerRadius);
      const lowDetailDarkRisk = detailRisk * darkRisk;
      const edgeDarkRisk = edgeRisk * darkRisk;
      const cornerDarkRisk = cornerRisk * darkRisk;
      const score = darkRisk * 0.62 + lowDetailDarkRisk * 0.18 + hazeRisk * 0.06 + edgeDarkRisk * (0.12 + p.edgeFocus * 0.74) + cornerDarkRisk * 0.18;
      if (score >= scoreCut && (darkRisk > 0.34 || edgeDarkRisk > 0.42 || cornerDarkRisk > 0.42)) mask[idx] = 1;
    }
  }

  closeMask(mask, w, h);
  closeMask(mask, w, h);
  const protectedShapes = protectedShapesForAuto(item);
  const protectedMask = buildProtectedMask(item, protectedShapes, w, h);
  const rawMask = mask.slice();
  removeProtectedPixels(mask, protectedMask);
  const minPixels = Math.round(w * h * p.minArea);
  const rawComponents = findUnknownComponents(rawMask, w, h, minPixels, cornerRadius);
  const rawComponentIds = new Int32Array(rawMask.length).fill(-1);
  const rawTouchesManual = rawComponents.map((component, componentIndex) => {
    let touchesManual = false;
    for (const index of component) {
      rawComponentIds[index] = componentIndex;
      if (protectedMask[index]) touchesManual = true;
    }
    return touchesManual;
  });
  const protectedComponents = findUnknownComponents(mask, w, h, minPixels, cornerRadius);
  // Use one contour per original dark component: protect where possible, fall back only when it touches a manual region.
  const components = [
    ...protectedComponents
      .filter((component) => !rawTouchesManual[rawComponentIds[component[0]]])
      .map((component) => ({ component, sourceMask: mask })),
    ...rawComponents
      .filter((_, componentIndex) => rawTouchesManual[componentIndex])
      .map((component) => ({ component, sourceMask: rawMask }))
  ];
  const sx = item.img.naturalWidth / w;
  const sy = item.img.naturalHeight / h;
  const shapes = components
    .map(({ component, sourceMask }) => componentToPolygon(component, sourceMask, w, h, sx, sy, p))
    .filter((points) => points.length >= 3)
    .map((points) => ({ label: "unknown", points, source: "auto" }));
  item.shapes = [...protectedShapes, ...shapes];
  item.annotated = true;
  return shapes.length;
}
function closeMask(mask, w, h) {
  const copy = mask.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      let count = 0;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) count += copy[idx + yy * w + xx];
      }
      mask[idx] = count >= 4 ? 1 : 0;
    }
  }
}

function findComponents(mask, w, h, minPixels) {
  const seen = new Uint8Array(w * h);
  const components = [];
  const queue = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      const comp = [];
      queue.length = 0;
      queue.push(start);
      seen[start] = 1;
      while (queue.length) {
        const idx = queue.pop();
        comp.push(idx);
        const cx = idx % w;
        const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
        for (const next of neighbors) {
          const nx = next % w;
          if (next < 0 || next >= mask.length || Math.abs(nx - cx) > 1) continue;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
      if (comp.length >= minPixels) components.push(comp);
    }
  }
  return components;
}

function componentToPolygon(comp, mask, w, h, sx, sy, p) {
  let contour = traceComponentContour(comp, mask, w, h);
  if (contour.length < 3) {
    const boundary = [];
    for (const idx of comp) {
      const x = idx % w;
      const y = Math.floor(idx / w);
      if (
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w]
      ) {
        boundary.push({ x, y });
      }
    }
    contour = convexHull(boundary);
  }
  let outline = contour.map((pt) => ({
    x: snapEdge(pt.x, w) * sx,
    y: snapEdge(pt.y, h) * sy
  }));
  const scaleUnit = Math.max(sx, sy);
  const maxPointCount = Math.max(3, Math.round(p.maxPoints || 0));
  const simpleBias = Math.max(0, 20 - Math.min(maxPointCount, 20)) * 0.08;
  const simplifyEpsilon = Math.max(0.8, 0.65 + p.simplify * 0.42 + simpleBias) * scaleUnit;
  outline = dedupeClosePoints(outline, 0.85 * scaleUnit);
  outline = rdpClosed(outline, simplifyEpsilon);
  outline = simplifyStraightRuns(outline, Math.max(1.8 * scaleUnit, 2.4));
  outline = smoothClosed(outline, p.simplify >= 4 ? 1 : 0);
  outline = snapImageEdges(outline, w * sx, h * sy, 2.5 * scaleUnit);
  outline = simplifyStraightRuns(outline, Math.max(2.2 * scaleUnit, 3));
  while (outline.length > maxPointCount) outline = decimate(outline);
  outline = simplifyStraightRuns(outline, Math.max(2.2 * scaleUnit, 3));

  return outline.map((pt) => ({
    x: Number(pt.x.toFixed(1)),
    y: Number(pt.y.toFixed(1))
  }));
}

function closedPathLength(points) {
  if (points.length < 2) return 0;
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function resampleClosedPath(points, targetCount) {
  if (points.length < 3 || targetCount <= 0) return points;
  const perimeter = closedPathLength(points);
  if (!perimeter) return points;
  const result = [];
  const step = perimeter / targetCount;
  let edgeIndex = 0;
  let edgeStartDistance = 0;
  for (let sample = 0; sample < targetCount; sample++) {
    const distance = sample * step;
    while (edgeIndex < points.length) {
      const a = points[edgeIndex];
      const b = points[(edgeIndex + 1) % points.length];
      const edgeLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (edgeStartDistance + edgeLength >= distance || edgeLength === 0) {
        const t = edgeLength === 0 ? 0 : (distance - edgeStartDistance) / edgeLength;
        result.push({
          x: a.x + (b.x - a.x) * clamp(t, 0, 1),
          y: a.y + (b.y - a.y) * clamp(t, 0, 1)
        });
        break;
      }
      edgeStartDistance += edgeLength;
      edgeIndex++;
    }
  }
  return result.length >= 3 ? result : points;
}

function traceComponentContour(comp, mask, w, h) {
  const starts = new Map();
  const edges = [];
  const addEdge = (x1, y1, x2, y2) => {
    const edge = { x1, y1, x2, y2, used: false };
    edges.push(edge);
    const key = `${x1},${y1}`;
    if (!starts.has(key)) starts.set(key, []);
    starts.get(key).push(edge);
  };
  for (const idx of comp) {
    const x = idx % w;
    const y = Math.floor(idx / w);
    if (y === 0 || !mask[idx - w]) addEdge(x, y, x + 1, y);
    if (x === w - 1 || !mask[idx + 1]) addEdge(x + 1, y, x + 1, y + 1);
    if (y === h - 1 || !mask[idx + w]) addEdge(x + 1, y + 1, x, y + 1);
    if (x === 0 || !mask[idx - 1]) addEdge(x, y + 1, x, y);
  }
  let best = [];
  for (const edge of edges) {
    if (edge.used) continue;
    const points = [{ x: edge.x1, y: edge.y1 }];
    let current = edge;
    let guard = 0;
    while (current && !current.used && guard++ < edges.length + 4) {
      current.used = true;
      points.push({ x: current.x2, y: current.y2 });
      const nextKey = `${current.x2},${current.y2}`;
      const options = starts.get(nextKey) || [];
      current = options.find((candidate) => !candidate.used);
    }
    if (points.length > best.length) best = points;
  }
  if (best.length > 1) best.pop();
  return best;
}

function dedupeClosePoints(points, minDistance) {
  if (points.length <= 3) return points;
  const result = [];
  for (const pt of points) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) >= minDistance) result.push(pt);
  }
  return result.length >= 3 ? result : points;
}

function simplifyStraightRuns(points, tolerance) {
  if (points.length <= 3) return points;
  let result = points;
  for (let pass = 0; pass < 6; pass++) {
    if (result.length <= 3) break;
    const simplified = [];
    let changed = false;
    let removed = 0;
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const curr = result[i];
      const next = result[(i + 1) % result.length];
      const prevLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const nextLen = Math.hypot(next.x - curr.x, next.y - curr.y);
      const spanLen = Math.hypot(next.x - prev.x, next.y - prev.y);
      const bend = pointLineDistance(curr, prev, next);
      const nearlyBetween = prevLen + nextLen - spanLen <= tolerance * 2.4;
      if (bend <= tolerance && nearlyBetween && result.length - removed > 3) {
        changed = true;
        removed++;
        continue;
      }
      simplified.push(curr);
    }
    result = simplified.length >= 3 ? simplified : result;
    if (!changed) break;
  }
  return result;
}

function densifyLongSegments(points, maxLength) {
  if (points.length < 2) return points;
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    result.push(a);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.floor(distance / maxLength);
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1);
      result.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      });
    }
  }
  return result;
}
function snapImageEdges(points, imageWidth, imageHeight, tolerance) {
  return points.map((pt) => ({
    x: pt.x <= tolerance ? 0 : pt.x >= imageWidth - tolerance ? imageWidth : pt.x,
    y: pt.y <= tolerance ? 0 : pt.y >= imageHeight - tolerance ? imageHeight : pt.y
  }));
}

function boundaryContour(boundary, componentPixels, w, h, targetBins) {
  const centroid = boundary.reduce((acc, pt) => {
    acc.x += pt.x;
    acc.y += pt.y;
    return acc;
  }, { x: 0, y: 0 });
  centroid.x /= boundary.length;
  centroid.y /= boundary.length;

  const bins = Array.from({ length: targetBins }, () => null);
  for (const pt of boundary) {
    const angle = Math.atan2(pt.y - centroid.y, pt.x - centroid.x);
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
    const binIndex = Math.min(targetBins - 1, Math.floor((normalized / (Math.PI * 2)) * targetBins));
    const dist = Math.hypot(pt.x - centroid.x, pt.y - centroid.y);
    if (!bins[binIndex] || dist > bins[binIndex].dist) bins[binIndex] = { ...pt, dist };
  }

  let contour = bins.filter(Boolean).map(({ x, y }) => ({ x, y }));
  contour = removeLongInteriorJumps(contour, componentPixels, w);
  return contour.length >= 3 ? contour : [];
}

function removeLongInteriorJumps(points, componentPixels, w) {
  if (points.length < 4) return points;
  const cleaned = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    cleaned.push(current);
    const distance = Math.hypot(next.x - current.x, next.y - current.y);
    if (distance < 10) continue;
    const samples = Math.min(18, Math.floor(distance / 6));
    let insideCount = 0;
    for (let s = 1; s < samples; s++) {
      const x = Math.round(current.x + ((next.x - current.x) * s) / samples);
      const y = Math.round(current.y + ((next.y - current.y) * s) / samples);
      if (componentPixels.has(y * w + x)) insideCount++;
    }
    if (samples > 2 && insideCount < samples * 0.35) cleaned.pop();
  }
  return cleaned.length >= 3 ? cleaned : points;
}

function smoothClosed(points, iterations) {
  let result = points;
  for (let pass = 0; pass < iterations; pass++) {
    const smoothed = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      smoothed.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25
      });
      smoothed.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75
      });
    }
    result = smoothed;
  }
  return result;
}

function snapEdge(value, limit) {
  if (value <= 2) return 0;
  if (value >= limit - 3) return limit - 1;
  return value;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const pt of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const pt = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function rdpClosed(points, epsilon) {
  if (points.length <= 3 || epsilon <= 0) return points;
  const open = [...points, points[0]];
  const reduced = rdp(open, epsilon);
  reduced.pop();
  return reduced.length >= 3 ? reduced : points;
}

function rdp(points, epsilon) {
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pointLineDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    return rdp(points.slice(0, index + 1), epsilon).slice(0, -1).concat(rdp(points.slice(index), epsilon));
  }
  return [points[0], points[end]];
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function decimate(points) {
  if (points.length <= 3) return points;
  let removeIndex = 0;
  let smallest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const area = Math.abs((prev.x * (curr.y - next.y) + curr.x * (next.y - prev.y) + next.x * (prev.y - curr.y)) / 2);
    if (area < smallest) {
      smallest = area;
      removeIndex = i;
    }
  }
  return points.filter((_, i) => i !== removeIndex);
}

function buildJson(item) {
  if (!item) return {};
  return {
    version: "unknown-annotator-1.0",
    flags: {},
    shapes: item.shapes.map((shape) => ({
      label: shape.label || "unknown",
      points: shape.points.map((pt) => [Number(pt.x.toFixed(1)), Number(pt.y.toFixed(1))]),
      group_id: null,
      description: "",
      shape_type: "polygon",
      flags: {}
    })),
    imagePath: item.file.name,
    imageData: null,
    imageHeight: item.img.naturalHeight,
    imageWidth: item.img.naturalWidth
  };
}

async function saveTextFile(name, text, directoryHandle = state.outputDir) {
  if (directoryHandle) {
    const handle = await directoryHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportItem(item) {
  await saveTextFile(jsonName(item.file.name), JSON.stringify(buildJson(item), null, 2), item.outputDir || state.outputDir);
}

function queueAutoSave(item) {
  if (!item || !item.outputDir) return;
  const name = jsonName(item.file.name);
  const text = JSON.stringify(buildJson(item), null, 2);
  item.saveChain = (item.saveChain || Promise.resolve())
    .catch(() => {})
    .then(() => saveTextFile(name, text, item.outputDir))
    .catch(() => setStatus(`自动保存失败：${name}`));
}

async function autoSaveNow(item) {
  if (!item || !item.outputDir) return false;
  await (item.saveChain || Promise.resolve()).catch(() => {});
  await exportItem(item);
  return true;
}

function nearestHandle(x, y) {
  const item = activeItem();
  if (!item) return null;
  let best = null;
  let bestDist = 12;
  item.shapes.forEach((shape, shapeIndex) => {
    shape.points.forEach((pt, pointIndex) => {
      const sp = toScreen(pt);
      const dist = Math.hypot(sp.x - x, sp.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { shapeIndex, pointIndex };
      }
    });
  });
  return best;
}

function deleteSelectedPoint() {
  const item = activeItem();
  const selection = state.selectedPoint;
  if (!item || !selection || !item.shapes[selection.shapeIndex]) return false;
  const shape = item.shapes[selection.shapeIndex];
  if (shape.points.length <= 3) {
    setStatus("闭合区域至少需要 3 个点，不能再删除");
    return true;
  }
  pushHistory();
  shape.points.splice(selection.pointIndex, 1);
  shape.source = "manual";
  setShapeSelection([selection.shapeIndex], selection.shapeIndex);
  renderFileList();
  draw();
  queueAutoSave(item);
  setStatus("已删除当前控制点");
  return true;
}

function deleteSelectedShape() {
  const item = activeItem();
  const selectedIndexes = selectedShapeIndexes(item);
  if (!item || !selectedIndexes.length) return;
  pushHistory();
  const firstDeletedIndex = selectedIndexes[0];
  for (const index of [...selectedIndexes].reverse()) item.shapes.splice(index, 1);
  const nextIndex = item.shapes.length ? Math.min(firstDeletedIndex, item.shapes.length - 1) : -1;
  setShapeSelection(nextIndex >= 0 ? [nextIndex] : [], nextIndex);
  renderFileList();
  draw();
  queueAutoSave(item);
  setStatus(selectedIndexes.length > 1 ? `已批量删除 ${selectedIndexes.length} 个闭合区域` : "已删除当前闭合区域");
}

function deleteCurrentSelection() {
  if (deleteSelectedPoint()) return;
  deleteSelectedShape();
}

function copySelectedShape() {
  const item = activeItem();
  const shape = item && state.selectedShape >= 0 ? item.shapes[state.selectedShape] : null;
  if (!item || !shape || shape.points.length < 3) return;
  state.clipboardShape = {
    label: shape.label || "unknown",
    points: shape.points.map((point) => ({
      x: point.x / item.img.naturalWidth,
      y: point.y / item.img.naturalHeight
    }))
  };
  updateButtons();
  setStatus(`已复制区域“${state.clipboardShape.label}”，可粘贴到当前打开的图片`);
}

function pasteShapeToCurrentImage() {
  if (!state.clipboardShape) {
    setStatus("没有可粘贴的区域，请先选择标注后按 Ctrl + C");
    return;
  }
  const item = activeItem();
  if (!item) {
    setStatus("请先打开一张图片再粘贴");
    return;
  }
  pushHistory();
  item.shapes.push({
    label: state.clipboardShape.label,
    points: state.clipboardShape.points.map((point) => ({
      x: Number(clamp(point.x * item.img.naturalWidth, 0, item.img.naturalWidth).toFixed(1)),
      y: Number(clamp(point.y * item.img.naturalHeight, 0, item.img.naturalHeight).toFixed(1))
    })),
    source: "manual"
  });
  setShapeSelection([item.shapes.length - 1], item.shapes.length - 1);
  renderFileList();
  draw();
  queueAutoSave(item);
  setStatus(`已粘贴“${state.clipboardShape.label}”到当前图片`);
}

function nearestSegment(x, y) {
  const item = activeItem();
  if (!item) return null;
  let best = null;
  let bestDist = 10;
  item.shapes.forEach((shape, shapeIndex) => {
    shape.points.forEach((pt, pointIndex) => {
      const a = toScreen(pt);
      const b = toScreen(shape.points[(pointIndex + 1) % shape.points.length]);
      const dist = pointLineDistance({ x, y }, a, b);
      if (dist < bestDist) {
        bestDist = dist;
        best = { shapeIndex, pointIndex };
      }
    });
  });
  return best;
}

function translatePointsWithinBounds(points, dx, dy, width, height) {
  if (!points.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const safeDx = clamp(dx, -minX, width - maxX);
  const safeDy = clamp(dy, -minY, height - maxY);
  return points.map((point) => ({ x: point.x + safeDx, y: point.y + safeDy }));
}

function waterGaugeMaxPoints() {
  return Math.max(3, Math.round(params().maxPoints || 0));
}

function normalizeWaterGaugePolygon(rawPolygon, item) {
  if (!Array.isArray(rawPolygon)) return [];
  let points = rawPolygon
    .map((point) => {
      const x = Array.isArray(point) ? Number(point[0]) : Number(point.x);
      const y = Array.isArray(point) ? Number(point[1]) : Number(point.y);
      return {
        x: Number(clamp(x, 0, item.img.naturalWidth).toFixed(1)),
        y: Number(clamp(y, 0, item.img.naturalHeight).toFixed(1))
      };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  points = dedupeClosePoints(points, 0.8);
  while (points.length > waterGaugeMaxPoints()) points = decimate(points);
  return points.length >= 3 ? points : [];
}

function waterGaugeShapeFromItem(result, item) {
  const points = normalizeWaterGaugePolygon(result && result.polygon, item);
  if (points.length < 3) return null;
  return {
    label: String((result && result.label) || "unknown"),
    points,
    source: "water-gauge"
  };
}

async function requestWaterGaugeAuto(item) {
  const formData = new FormData();
  formData.append("file", item.file);
  formData.append("max_points", String(waterGaugeMaxPoints()));
  const response = await fetch(`${WATER_GAUGE_SERVICE}/api/auto_annotate`, {
    method: "POST",
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `服务返回 ${response.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

async function requestWaterGaugeClick(item, point) {
  const formData = new FormData();
  formData.append("file", item.file);
  formData.append("x", String(point.x));
  formData.append("y", String(point.y));
  formData.append("max_points", String(waterGaugeMaxPoints()));
  const response = await fetch(`${WATER_GAUGE_SERVICE}/api/click_segment`, {
    method: "POST",
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `服务返回 ${response.status}`);
  return data.item || null;
}

function clearWaterGaugeState() {
  state.waterGaugeClickMode = false;
}

async function runWaterGaugeAuto() {
  const item = activeItem();
  if (!item || state.isWaterGaugeRunning) return;
  state.isWaterGaugeRunning = true;
  updateButtons();
  setStatus("水尺全自动标注中：YOLO 检测字符，SAM 生成区域...");
  try {
    const results = await requestWaterGaugeAuto(item);
    const shapes = results
      .map((result) => waterGaugeShapeFromItem(result, item))
      .filter(Boolean);
    pushHistory();
    const keep = item.shapes.filter((shape) => shape.source !== "water-gauge");
    item.shapes = [...keep, ...shapes];
    item.annotated = item.shapes.length > 0;
    const firstIndex = shapes.length ? keep.length : (item.shapes.length ? 0 : -1);
    setShapeSelection(firstIndex >= 0 ? [firstIndex] : [], firstIndex);
    renderFileList();
    draw();
    queueAutoSave(item);
    setStatus(`水尺全自动标注完成：${shapes.length} 个字符区域，最大点数 ${waterGaugeMaxPoints()}`);
  } catch (error) {
    const detail = error instanceof TypeError
      ? `无法连接水尺标注服务，请确认 ${WATER_GAUGE_SERVICE} 已启动`
      : (error && error.message ? error.message : "未知错误");
    setStatus(`水尺全自动标注失败：${detail}`);
  } finally {
    state.isWaterGaugeRunning = false;
    updateButtons();
  }
}

async function runWaterGaugeClick(point) {
  const item = activeItem();
  if (!item || state.isWaterGaugeRunning) return;
  state.isWaterGaugeRunning = true;
  updateButtons();
  setStatus("水尺点击识别中：SAM 分割字符，YOLO 识别名称...");
  try {
    const result = await requestWaterGaugeClick(item, point);
    const shape = waterGaugeShapeFromItem(result, item);
    if (!shape) throw new Error("服务没有返回有效水尺字符区域");
    pushHistory();
    item.shapes.push(shape);
    item.annotated = true;
    const shapeIndex = item.shapes.length - 1;
    setShapeSelection([shapeIndex], shapeIndex);
    $("labelName").value = shape.label;
    rememberLabel(shape.label);
    renderFileList();
    draw();
    queueAutoSave(item);
    setStatus(`已点击识别并标注水尺字符：${shape.label}，${shape.points.length} 个点`);
  } catch (error) {
    const detail = error instanceof TypeError
      ? `无法连接水尺标注服务，请确认 ${WATER_GAUGE_SERVICE} 已启动`
      : (error && error.message ? error.message : "未知错误");
    setStatus(`点击自动识别水尺失败：${detail}`);
  } finally {
    state.isWaterGaugeRunning = false;
    updateButtons();
  }
}

overlayCanvas.addEventListener("pointerdown", (event) => {
  const item = activeItem();
  if (!item) return;
  if (event.button === 1 || event.button === 2) {
    state.isPanning = true;
    state.panStart = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
    overlayCanvas.setPointerCapture(event.pointerId);
    updateButtons();
    event.preventDefault();
    return;
  }
  const canDrawWithoutOverlay = state.waterGaugeClickMode || state.mode === "follow" || state.mode === "freehand" || state.mode === "smear" || state.mode === "pen" || state.mode === "sam";
  if (!state.showOverlay && !canDrawWithoutOverlay) return;
  const imagePoint = toImagePoint(event.offsetX, event.offsetY);
  if (state.waterGaugeClickMode) {
    const point = {
      x: clamp(imagePoint.x, 0, item.img.naturalWidth),
      y: clamp(imagePoint.y, 0, item.img.naturalHeight)
    };
    runWaterGaugeClick(point);
    return;
  }
  if (state.mode === "sam") {
    if (state.isSamRunning) {
      setStatus("SAM2.1 正在识别，请等待当前预览完成后再选择提示点");
      return;
    }
    const samPoint = {
      x: Math.max(0, Math.min(item.img.naturalWidth, imagePoint.x)),
      y: Math.max(0, Math.min(item.img.naturalHeight, imagePoint.y))
    };
    if (state.samTool === "point") {
      state.samPoints.push(samPoint);
      state.samPoint = samPoint;
      state.samPreview = null;
      draw();
      runSamSegmentation();
      return;
    }
    state.samPoint = samPoint;
    state.samBoxStart = { ...state.samPoint };
    state.samBox = null;
    state.samPreview = null;
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    setStatus("SAM2.1：单击选择提示点，拖动可框选区域");
    return;
  }
  if (state.mode === "follow") {
    if (!state.isFollowDrawing) {
      state.followPoints = [];
      state.isFollowDrawing = true;
      addFollowPoint(imagePoint);
      draw();
      setStatus("跟随笔已开始，移动鼠标描边，再次点击或按 Enter 自动闭合");
      return;
    }
    finishFollowPen();
    return;
  }
  if (state.mode === "freehand") {
    state.freehandPoints = [];
    state.isFreehandDrawing = true;
    addFreehandPoint(imagePoint);
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    return;
  }
  if (state.mode === "smear") {
    state.smearPoints = [];
    state.isSmearing = true;
    addSmearPoint(imagePoint);
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    setStatus("正在涂抹 unknown 区域，松开鼠标后自动生成闭合标注");
    return;
  }
  if (state.mode === "pen") {
    if (
      state.draftPoints.length >= 3 &&
      Math.hypot(toScreen(state.draftPoints[0]).x - event.offsetX, toScreen(state.draftPoints[0]).y - event.offsetY) < 12
    ) {
      finishDraft();
      return;
    }
    state.draftPoints.push({
      x: Math.max(0, Math.min(item.img.naturalWidth, imagePoint.x)),
      y: Math.max(0, Math.min(item.img.naturalHeight, imagePoint.y))
    });
    draw();
    return;
  }
  if (state.mode === "eraser") {
    const shapeIndex = shapeAtPoint(imagePoint);
    if (shapeIndex >= 0) {
      pushHistory();
      item.shapes.splice(shapeIndex, 1);
      const nextIndex = item.shapes.length ? Math.min(shapeIndex, item.shapes.length - 1) : -1;
      setShapeSelection(nextIndex >= 0 ? [nextIndex] : [], nextIndex);
      renderFileList();
      draw();
      queueAutoSave(item);
      setStatus("已删除 unknown 区域");
    }
    return;
  }
  const handle = nearestHandle(event.offsetX, event.offsetY);
  if (handle) {
    pushHistory();
    setShapeSelection([handle.shapeIndex], handle.shapeIndex);
    state.selectedPoint = handle;
    item.shapes[handle.shapeIndex].source = "manual";
    state.dragging = { type: "point", ...handle };
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    return;
  }
  const seg = nearestSegment(event.offsetX, event.offsetY);
  if (seg) {
    pushHistory();
    const pt = {
      x: Math.max(0, Math.min(item.img.naturalWidth, imagePoint.x)),
      y: Math.max(0, Math.min(item.img.naturalHeight, imagePoint.y))
    };
    item.shapes[seg.shapeIndex].points.splice(seg.pointIndex + 1, 0, pt);
    item.shapes[seg.shapeIndex].source = "manual";
    setShapeSelection([seg.shapeIndex], seg.shapeIndex);
    state.selectedPoint = { shapeIndex: seg.shapeIndex, pointIndex: seg.pointIndex + 1 };
    state.dragging = { type: "point", ...state.selectedPoint };
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    updateAnnotationPanel();
    setStatus("已在线条上添加控制点，拖动即可调整边界");
    return;
  }
  const shapeIndex = shapeAtPoint(imagePoint);
  if (shapeIndex >= 0) {
    pushHistory();
    setShapeSelection([shapeIndex], shapeIndex);
    state.dragging = {
      type: "shape",
      shapeIndex,
      startPoint: imagePoint,
      originalPoints: item.shapes[shapeIndex].points.map((point) => ({ ...point }))
    };
    overlayCanvas.setPointerCapture(event.pointerId);
    draw();
    updateAnnotationPanel();
    setStatus("已选择闭合区域，拖动可整体移动；Ctrl + C 可复制");
  }
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (state.isPanning && state.panStart) {
    state.panX = state.panStart.panX + event.clientX - state.panStart.x;
    state.panY = state.panStart.panY + event.clientY - state.panStart.y;
    draw();
    return;
  }
  const item = activeItem();
  if (item && state.mode === "sam" && state.samTool === "box" && state.samBoxStart) {
    const point = toImagePoint(event.offsetX, event.offsetY);
    const endPoint = {
      x: Math.max(0, Math.min(item.img.naturalWidth, point.x)),
      y: Math.max(0, Math.min(item.img.naturalHeight, point.y))
    };
    state.samBox = normalizeSamBox(state.samBoxStart, endPoint);
    draw();
    return;
  }
  if (item && state.isFollowDrawing) {
    addFollowPoint(toImagePoint(event.offsetX, event.offsetY));
    draw();
    return;
  }
  if (item && state.isFreehandDrawing) {
    addFreehandPoint(toImagePoint(event.offsetX, event.offsetY));
    draw();
    return;
  }
  if (item && state.mode === "smear") {
    const point = toImagePoint(event.offsetX, event.offsetY);
    state.smearCursor = {
      x: point.x,
      y: point.y
    };
    if (state.isSmearing) addSmearPoint(point);
    draw();
    if (state.isSmearing) return;
  }
  if (!state.showOverlay) return;
  if (!item || !state.dragging) return;
  const pt = toImagePoint(event.offsetX, event.offsetY);
  pt.x = Math.max(0, Math.min(item.img.naturalWidth, pt.x));
  pt.y = Math.max(0, Math.min(item.img.naturalHeight, pt.y));
  const shape = item.shapes[state.dragging.shapeIndex];
  if (!shape) return;
  if (state.dragging.type === "shape") {
    const dx = pt.x - state.dragging.startPoint.x;
    const dy = pt.y - state.dragging.startPoint.y;
    shape.points = translatePointsWithinBounds(
      state.dragging.originalPoints,
      dx,
      dy,
      item.img.naturalWidth,
      item.img.naturalHeight
    );
  } else {
    shape.points[state.dragging.pointIndex] = pt;
  }
  shape.source = "manual";
  draw();
});

overlayCanvas.addEventListener("pointerup", (event) => {
  if (state.isPanning) {
    state.isPanning = false;
    state.panStart = null;
    updateButtons();
    return;
  }
  const item = activeItem();
  if (item && state.mode === "sam" && state.samTool === "box" && state.samBoxStart) {
    const point = toImagePoint(event.offsetX, event.offsetY);
    const endPoint = {
      x: Math.max(0, Math.min(item.img.naturalWidth, point.x)),
      y: Math.max(0, Math.min(item.img.naturalHeight, point.y))
    };
    const box = normalizeSamBox(state.samBoxStart, endPoint);
    const minBoxSize = 8 / state.view.scale;
    if (box.x2 - box.x1 >= minBoxSize && box.y2 - box.y1 >= minBoxSize) {
      state.samBox = box;
      state.samPoint = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
    } else {
      state.samBox = null;
      state.samPoint = { ...state.samBoxStart };
    }
    state.samBoxStart = null;
    draw();
    runSamSegmentation();
    return;
  }
  if (state.isFreehandDrawing) {
    finishFreehand();
    return;
  }
  if (state.isSmearing) {
    finishSmear();
    return;
  }
  if (state.dragging) queueAutoSave(activeItem());
  state.dragging = null;
});

overlayCanvas.addEventListener("pointercancel", () => {
  state.isPanning = false;
  state.panStart = null;
  state.dragging = null;
  state.isFreehandDrawing = false;
  state.isSmearing = false;
  state.smearPoints = [];
  state.smearCursor = null;
  state.isFollowDrawing = false;
  state.samBoxStart = null;
  state.samBox = null;
  updateButtons();
});

overlayCanvas.addEventListener("pointerleave", () => {
  if (state.mode === "smear" && !state.isSmearing && state.smearCursor) {
    state.smearCursor = null;
    draw();
  }
});

overlayCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

overlayCanvas.addEventListener("wheel", (event) => {
  if (!activeItem()) return;
  if (state.mode === "smear" && !event.ctrlKey) {
    event.preventDefault();
    const p = params();
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = Math.max(1, Math.round(p.brushWheelSensitivity || 1));
    const current = Number(controls.brushSize.value) || defaultParams.brushSize;
    const next = clamp(current + direction * step, 8, 500);
    controls.brushSize.value = String(next);
    controlOutputs.brushSize.value = String(next);
    state.smearCursor = toImagePoint(event.offsetX, event.offsetY);
    updateOutputs();
    draw();
    setStatus(`涂抹直径：${next}`);
    return;
  }
  if (!event.ctrlKey) return;
  event.preventDefault();
  zoomAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

overlayCanvas.addEventListener("dblclick", (event) => {
  event.preventDefault();
});

$("imageInput").addEventListener("change", (event) => handleFiles(event.target.files));
$("folderImport").addEventListener("click", importFolderWithAutoSave);
$("folderInput").addEventListener("change", async (event) => {
  await handleFiles(event.target.files, { replace: true, preserveOrder: true });
  event.target.value = "";
  setStatus("已导入文件夹；当前浏览器无法授权原目录写入，保存时将使用下载模式");
});

$("selectMode").addEventListener("click", () => setMode("select"));
$("penMode").addEventListener("click", () => setMode("pen"));
$("freehandMode").addEventListener("click", () => setMode("freehand"));
$("smearMode").addEventListener("click", () => setMode("smear"));
$("followPenMode").addEventListener("click", () => setMode("follow"));
$("samMode").addEventListener("click", () => {
  setMode("sam");
  setSamTool("point");
});
$("samPointMode").addEventListener("click", () => setSamTool("point"));
$("samBoxMode").addEventListener("click", () => setSamTool("box"));
$("eraserMode").addEventListener("click", () => setMode("eraser"));
$("waterGaugeMode").addEventListener("click", () => {
  state.waterGaugePanelOpen = !state.waterGaugePanelOpen;
  if (!state.waterGaugePanelOpen) state.waterGaugeClickMode = false;
  updateButtons();
  draw();
  setStatus(state.waterGaugePanelOpen ? "已打开水尺标注功能" : "已收起水尺标注功能");
});
$("waterGaugeAuto").addEventListener("click", () => {
  clearWaterGaugeState();
  updateButtons();
  runWaterGaugeAuto();
});
$("waterGaugeClick").addEventListener("click", () => {
  const item = activeItem();
  if (!item) {
    setStatus("请先导入图片后再使用水尺点击标注");
    return;
  }
  const next = !state.waterGaugeClickMode;
  setMode("select");
  state.waterGaugePanelOpen = true;
  state.waterGaugeClickMode = next;
  updateButtons();
  draw();
  setStatus(next ? "水尺点击标注已开启：点击图片中的字符即可自动识别并标注" : "水尺点击标注已关闭");
});
$("applyLabel").addEventListener("click", applyCurrentLabel);
$("useSelectedLabel").addEventListener("click", useSelectedLabel);
$("undoAction").addEventListener("click", undo);
$("redoAction").addEventListener("click", redo);
$("shortcutHelp").addEventListener("click", openShortcuts);
$("closeShortcuts").addEventListener("click", closeShortcuts);
$("shortcutModal").addEventListener("click", (event) => {
  if (event.target === $("shortcutModal")) closeShortcuts();
});
$("confirmLabel").addEventListener("click", confirmLabelModal);
$("cancelLabel").addEventListener("click", closeLabelModal);
$("labelModal").addEventListener("click", (event) => {
  if (event.target === $("labelModal")) closeLabelModal();
});
$("labelHistorySelect").addEventListener("change", (event) => {
  $("modalLabelName").value = event.target.value;
});
$("modalLabelName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    confirmLabelModal();
  }
});

$("chooseOutput").addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    setStatus("当前浏览器不支持直接选择文件夹，将使用下载模式");
    return;
  }
  state.outputDir = await window.showDirectoryPicker({ mode: "readwrite" });
  $("outputPath").textContent = `已选择：${state.outputDir.name}`;
});

$("autoCurrent").addEventListener("click", async () => {
  const item = activeItem();
  if (!item) return;
  const protectedCount = protectedShapesForAuto(item).length;
  pushHistory();
  const count = autoAnnotateItem(item);
  const selectedIndex = count ? item.shapes.length - count : (item.shapes.length ? 0 : -1);
  setShapeSelection(selectedIndex >= 0 ? [selectedIndex] : [], selectedIndex);
  renderFileList();
  draw();
  const saved = await autoSaveNow(item);
  setStatus(`自动标注完成：${count} 个 unknown 区域，已参考 ${protectedCount} 个手动区域${saved ? "，JSON 已自动保存" : ""}`);
});

$("toggleOverlay").addEventListener("click", () => {
  state.showOverlay = !state.showOverlay;
  draw();
});

$("prevImage").addEventListener("click", () => stepImage(-1));
$("nextImage").addEventListener("click", () => stepImage(1));
$("zoomIn").addEventListener("click", () => {
  const rect = overlayCanvas.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, 1.18);
});
$("zoomOut").addEventListener("click", () => {
  const rect = overlayCanvas.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, 0.85);
});
$("fitView").addEventListener("click", resetView);
$("actualSize").addEventListener("click", setActualSize);

function waitForBatchResume() {
  if (!state.isBatchPaused) return Promise.resolve();
  return new Promise((resolve) => {
    state.batchResume = resolve;
  });
}

async function runBatchAnnotation() {
  if (!state.items.length || state.isBatchRunning) return;
  const startIndex = Math.max(0, state.activeIndex);
  let total = 0;
  let protectedTotal = 0;
  let savedCount = 0;
  state.isBatchRunning = true;
  state.isBatchPaused = false;
  updateButtons();
  try {
    for (let i = startIndex; i < state.items.length; i++) {
      if (state.isBatchPaused) {
        setStatus(`批量标注已暂停在第 ${i + 1} 张，点击“继续标注”后继续`);
        await waitForBatchResume();
      }
      state.activeIndex = i;
      state.history = [];
      state.redo = [];
      const currentItem = state.items[i];
      protectedTotal += protectedShapesForAuto(currentItem).length;
      const count = autoAnnotateItem(currentItem);
      total += count;
      const selectedIndex = count ? currentItem.shapes.length - count : (currentItem.shapes.length ? 0 : -1);
      setShapeSelection(selectedIndex >= 0 ? [selectedIndex] : [], selectedIndex);
      renderFileList();
      draw();
      if (await autoSaveNow(currentItem)) savedCount++;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setStatus(`批量标注完成：第 ${startIndex + 1} 至 ${state.items.length} 张，共 ${total} 个 unknown 区域，已参考 ${protectedTotal} 个手动区域${savedCount ? `，已自动保存 ${savedCount} 个 JSON` : ""}`);
  } finally {
    state.isBatchRunning = false;
    state.isBatchPaused = false;
    state.batchResume = null;
    updateButtons();
  }
}

function toggleBatchAnnotation() {
  if (!state.isBatchRunning) {
    runBatchAnnotation();
    return;
  }
  if (state.isBatchPaused) {
    state.isBatchPaused = false;
    const resume = state.batchResume;
    state.batchResume = null;
    if (resume) resume();
    setStatus("批量标注已继续");
  } else {
    state.isBatchPaused = true;
    setStatus("将在当前图片处理完成后暂停批量标注");
  }
  updateButtons();
}

$("autoAll").addEventListener("click", toggleBatchAnnotation);

$("exportCurrent").addEventListener("click", async () => {
  const item = activeItem();
  if (!item) return;
  await exportItem(item);
  setStatus(`已导出 ${jsonName(item.file.name)}`);
});

$("exportAll").addEventListener("click", async () => {
  for (const item of state.items) await exportItem(item);
  setStatus(`已导出 ${state.items.length} 个 JSON`);
});

$("deleteShape").addEventListener("click", deleteCurrentSelection);
$("copyShape").addEventListener("click", copySelectedShape);
$("pasteNext").addEventListener("click", pasteShapeToCurrentImage);

$("clearShapes").addEventListener("click", () => {
  const item = activeItem();
  if (!item) return;
  pushHistory();
  item.shapes = [];
  clearShapeSelection();
  renderFileList();
  draw();
  queueAutoSave(item);
});

function openShortcuts() {
  $("shortcutModal").hidden = false;
}

function closeShortcuts() {
  $("shortcutModal").hidden = true;
}

for (const control of Object.values(controls)) {
  control.addEventListener("input", () => {
    updateOutputs();
    draw();
  });
}

function applyMaxPointsInput(value) {
  if (value === "") return;
  const next = clamp(Math.round(Number(value) || 0), 0, 100);
  controls.maxPoints.value = String(next);
  controlOutputs.maxPoints.value = String(next);
  updateOutputs();
  draw();
}

controlOutputs.maxPoints.addEventListener("input", (event) => {
  applyMaxPointsInput(event.target.value);
});

controlOutputs.maxPoints.addEventListener("change", (event) => {
  applyMaxPointsInput(event.target.value);
});

function applyBrushSizeInput(value) {
  if (value === "") return;
  const next = clamp(Math.round(Number(value) || 36), 8, 500);
  controls.brushSize.value = String(next);
  controlOutputs.brushSize.value = String(next);
  updateOutputs();
  draw();
}

controlOutputs.brushSize.addEventListener("input", (event) => {
  applyBrushSizeInput(event.target.value);
});

controlOutputs.brushSize.addEventListener("change", (event) => {
  applyBrushSizeInput(event.target.value);
});

window.addEventListener("resize", resizeCanvases);
window.addEventListener("keydown", (event) => {
  const target = event.target;
  const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
  const inField = tag === "input" || tag === "textarea" || tag === "select";
  const key = event.key.toLowerCase();
  if (key === "escape" && !$("shortcutModal").hidden) {
    event.preventDefault();
    closeShortcuts();
    return;
  }
  if (key === "escape" && !$("labelModal").hidden) {
    event.preventDefault();
    closeLabelModal();
    return;
  }
  if (inField && ["z", "y", "c", "v"].includes(key) && (event.ctrlKey || event.metaKey)) return;
  if (event.ctrlKey || event.metaKey) {
    if (key === "o" && event.shiftKey) {
      event.preventDefault();
      importFolderWithAutoSave();
      return;
    }
    if (key === "o") {
      event.preventDefault();
      $("imageInput").click();
      return;
    }
    if (key === "s" && event.shiftKey) {
      event.preventDefault();
      $("exportAll").click();
      return;
    }
    if (key === "s") {
      event.preventDefault();
      $("exportCurrent").click();
      return;
    }
    if (key === "e") {
      event.preventDefault();
      applyCurrentLabel();
      return;
    }
    if (key === "c") {
      event.preventDefault();
      copySelectedShape();
      return;
    }
    if (key === "v") {
      event.preventDefault();
      pasteShapeToCurrentImage();
      return;
    }
    if (key === "z") {
      event.preventDefault();
      if (state.mode === "sam" && (state.samPoints.length || state.samBox || state.samBoxStart || state.samPoint)) undoSamPrompt();
      else if (state.mode === "smear" && state.smearPoints.length) cancelDraft();
      else undo();
      return;
    }
    if (key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (key === "0") {
      event.preventDefault();
      resetView();
      return;
    }
    if (key === "1") {
      event.preventDefault();
      setActualSize();
      return;
    }
    if (key === "=" || key === "+") {
      event.preventDefault();
      const rect = overlayCanvas.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, 1.18);
      return;
    }
    if (key === "-") {
      event.preventDefault();
      const rect = overlayCanvas.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, 0.85);
      return;
    }
  }
  if (inField || event.altKey) return;
  if (key === "f1" || key === "?" || key === "h") {
    event.preventDefault();
    openShortcuts();
  }
  if (key === "r") {
    event.preventDefault();
    if (event.shiftKey) $("autoAll").click();
    else $("autoCurrent").click();
  }
  if (key === "f") {
    event.preventDefault();
    if (state.mode === "sam") finishSamSegmentation();
    else resetView();
  }
  if (key === "=" || key === "+") {
    event.preventDefault();
    const rect = overlayCanvas.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, 1.18);
  }
  if (key === "-") {
    event.preventDefault();
    const rect = overlayCanvas.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, 0.85);
  }
  if (key === "l") {
    event.preventDefault();
    if (state.selectedShape >= 0) openLabelModal(state.selectedShape);
  }
  if (key === "[") {
    event.preventDefault();
    stepShape(-1);
  }
  if (key === "]") {
    event.preventDefault();
    stepShape(1);
  }
  if (key === "a" || key === "arrowleft") {
    event.preventDefault();
    stepImage(-1);
  }
  if (key === "d" || key === "arrowright") {
    event.preventDefault();
    stepImage(1);
  }
  if (key === " ") {
    event.preventDefault();
    state.showOverlay = !state.showOverlay;
    draw();
  }
  if (key === "v") setMode("select");
  if (key === "p") setMode("pen");
  if (key === "b") setMode("freehand");
  if (key === "m") setMode("smear");
  if (key === "g") setMode("follow");
  if (key === "s") setMode("sam");
  if (key === "e") setMode("eraser");
  if (key === "enter") {
    event.preventDefault();
    if (state.mode === "sam") setStatus("SAM2.1 可继续点击更新预览，按 F 确认当前分割");
    else if (state.isFollowDrawing) finishFollowPen();
    else finishDraft();
  }
  if (key === "escape") {
    event.preventDefault();
    if (state.mode === "sam") {
      state.samPoint = null;
      state.samPoints = [];
      state.samPreview = null;
      state.samPreviews = [];
      state.samBox = null;
      state.samBoxStart = null;
      draw();
      setStatus("已取消 SAM2.1 预览");
      return;
    }
    cancelDraft();
  }
  if (key === "delete" || key === "backspace") {
    event.preventDefault();
    deleteCurrentSelection();
  }
});
resetControlDefaults();
loadLabelMemory();
updateOutputs();
resizeCanvases();
updateButtons();
updateImageCounter();
updateAnnotationPanel();
