// ============================================================
//  SCRIPT.JS v3 — AI Handwriting Recognition + 3D Visualization
// ============================================================
// Prevent zooming via Ctrl + Mouse Wheel
document.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

// Prevent zooming via Keyboard (Ctrl + +, Ctrl + -, Ctrl + 0)
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === '=' || e.key === '-' || e.key === '0' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0')) {
        e.preventDefault();
    }
});

// ---- CANVAS SETUP ----
const canvasSection = document.getElementById('canvas-section');

const canvas = new fabric.Canvas('whiteboard-canvas', {
    isDrawingMode: true,
    width: canvasSection.clientWidth,
    height: canvasSection.clientHeight,
    backgroundColor: '#0a1628',
    selection: false
});

fabric.Object.prototype.selectable = false;
fabric.Object.prototype.evented = false;
canvas.freeDrawingBrush.color = '#ffffff';
canvas.freeDrawingBrush.width = 3;

// Hàm cập nhật kích thước Canvas chính xác khi phóng to/thu nhỏ hoặc vào Fullscreen (Tránh nhòe nét vẽ & lệch tọa độ chạm)
function resizeCanvas() {
    if (!canvas || !canvasSection) return;
    const newWidth = canvasSection.clientWidth || window.innerWidth;
    const newHeight = canvasSection.clientHeight || (window.innerHeight - 48);
    if (newWidth <= 0 || newHeight <= 0) return;

    // 1. Cập nhật kích thước nội tại (Backstore Buffer) & CSS hiển thị đồng bộ
    canvas.setDimensions({
        width: newWidth,
        height: newHeight
    }, { backstoreOnly: false, cssOnly: false });

    // 2. Tính toán lại offset màn hình để khi chạm tay/bút không bao giờ bị lệch vị trí
    canvas.calcOffset();

    // 3. Đảm bảo tỉ lệ 1:1 chuẩn xác, bảo toàn toàn bộ nét vẽ hiện có không bị méo/mờ
    if (canvas.setViewportTransform) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    }

    canvas.renderAll();
}



window.addEventListener('resize', resizeCanvas);
// Bắt cả sự kiện Fullscreen chuẩn và các vendor prefix trên Smart TV (LG webOS, Samsung Tizen, Android TV, Windows Touch)
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
    document.addEventListener(evt, () => {
        // Gọi liên tiếp 50ms, 150ms và 300ms để bắt trọn thời gian animation phóng to của TV
        setTimeout(resizeCanvas, 50);
        setTimeout(resizeCanvas, 150);
        setTimeout(resizeCanvas, 300);
    });
});

// Chống hiện menu chuột phải (Windows Touch Long-Press / Right-Click) khi tì bút hoặc ngón tay lên mặt kính
canvasSection.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
});

// Chống cử chỉ zoom 2 ngón của trình duyệt khi tì lòng bàn tay (Palm Rejection cơ bản cấp độ DOM)
canvasSection.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 1) {
        e.preventDefault(); // Ngăn zoom hoặc cuộn trang nếu chạm nhiều điểm cùng lúc
    }
}, { passive: false });

canvasSection.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// ---- UI REFS ----
const btnClear       = document.getElementById('btn-clear');
const colorBtns      = document.querySelectorAll('.color-btn');
const brushSize      = document.getElementById('brush-size');
const btnAnalyze     = document.getElementById('fab-analyze');
const btnBeautify    = document.getElementById('fab-beautify');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText    = document.getElementById('loading-text');

let currentColor = '#ffffff';
let currentMode  = 'draw';

// Lasso state — raw coordinates in CSS/logical pixels (not Fabric coords)
let lassoActive   = false;
let lassoStartX   = 0, lassoStartY = 0;
let lassoEndX     = 0, lassoEndY   = 0;
let lassoOverlay  = null;   // div used as visual rubber-band
let lastLassoCrop = null;   // saved dataURL of last crop

// ---- UNDO / REDO STATE ----
let undoStack = [];
let redoStack = [];
let isRedoing = false;
let saveStateTimeout = null;

function saveState() {
    if (isRedoing) return;
    clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(() => {
        const state = JSON.stringify(canvas);
        if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== state) {
            redoStack = [];
            undoStack.push(state);
            if (undoStack.length > 50) undoStack.shift();
        }
    }, 100);
}

canvas.on('object:added', saveState);
canvas.on('object:modified', saveState);
canvas.on('object:removed', saveState);
// Save initial state
saveState();

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

if (btnUndo) {
    btnUndo.addEventListener('click', () => {
        if (undoStack.length > 1) {
            isRedoing = true;
            redoStack.push(undoStack.pop());
            const state = undoStack[undoStack.length - 1];
            canvas.loadFromJSON(state, () => {
                canvas.renderAll();
                isRedoing = false;
            });
        }
    });
}

if (btnRedo) {
    btnRedo.addEventListener('click', () => {
        if (redoStack.length > 0) {
            isRedoing = true;
            const state = redoStack.pop();
            undoStack.push(state);
            canvas.loadFromJSON(state, () => {
                canvas.renderAll();
                isRedoing = false;
            });
        }
    });
}

// ---- TOOL BUTTONS ----
function getIntersectingCharIndices(obj, lassoLeft, lassoRight, lassoTop, lassoBottom) {
    if (!obj.text) return [];
    const indices = [];
    const bound = obj.getBoundingRect();
    
    // Use Fabric's internal character bounds for pixel-perfect accuracy
    if (obj.__charBounds && obj.__charBounds.length > 0) {
        const objWidth = Math.max(1, obj.width);
        const objHeight = Math.max(1, obj.height);
        
        if (typeof obj.get2DCursorLocation === 'function') {
            for (let i = 0; i < obj.text.length; i++) {
                const loc = obj.get2DCursorLocation(i);
                if (loc.lineIndex < obj.__charBounds.length && loc.charIndex < obj.__charBounds[loc.lineIndex].length) {
                    const charBound = obj.__charBounds[loc.lineIndex][loc.charIndex];
                    const lineTop = (loc.lineIndex / obj.__charBounds.length) * obj.height;
                    const lineHeight = obj.height / obj.__charBounds.length;
                    
                    const lineLeftOffset = (typeof obj._getLineLeftOffset === 'function') ? obj._getLineLeftOffset(loc.lineIndex) : 0;
                    const trueUnscaledLeft = lineLeftOffset + charBound.left;
                    const trueUnscaledRight = lineLeftOffset + charBound.left + charBound.width;
                    
                    const charAbsLeft = bound.left + (trueUnscaledLeft / objWidth) * bound.width;
                    const charAbsRight = bound.left + (trueUnscaledRight / objWidth) * bound.width;
                    const charAbsTop = bound.top + (lineTop / objHeight) * bound.height;
                    const charAbsBottom = bound.top + ((lineTop + lineHeight) / objHeight) * bound.height;
                    
                    const intersectLeft = Math.max(charAbsLeft, lassoLeft);
                    const intersectRight = Math.min(charAbsRight, lassoRight);
                    const intersectTop = Math.max(charAbsTop, lassoTop);
                    const intersectBottom = Math.min(charAbsBottom, lassoBottom);
                    
                    if (intersectLeft < intersectRight && intersectTop < intersectBottom) {
                        const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                        const charArea = Math.max(1, (charAbsRight - charAbsLeft) * (charAbsBottom - charAbsTop));
                        // 40% area overlap required for selection accuracy
                        if (intersectArea / charArea > 0.40) {
                            indices.push(i);
                        }
                    }
                }
            }
            return indices;
        }

        // Fallback for basic text without get2DCursorLocation
        let charIndexOffset = 0;
        for (let lineIndex = 0; lineIndex < obj.__charBounds.length; lineIndex++) {
            const lineBounds = obj.__charBounds[lineIndex];
            const lineTop = (lineIndex / obj.__charBounds.length) * obj.height;
            const lineHeight = obj.height / obj.__charBounds.length;
            const lineLeftOffset = (typeof obj._getLineLeftOffset === 'function') ? obj._getLineLeftOffset(lineIndex) : 0;

            for (let i = 0; i < lineBounds.length; i++) {
                const charBound = lineBounds[i];
                const trueUnscaledLeft = lineLeftOffset + charBound.left;
                const trueUnscaledRight = lineLeftOffset + charBound.left + charBound.width;
                
                const charAbsLeft = bound.left + (trueUnscaledLeft / objWidth) * bound.width;
                const charAbsRight = bound.left + (trueUnscaledRight / objWidth) * bound.width;
                const charAbsTop = bound.top + (lineTop / objHeight) * bound.height;
                const charAbsBottom = bound.top + ((lineTop + lineHeight) / objHeight) * bound.height;
                
                const intersectLeft = Math.max(charAbsLeft, lassoLeft);
                const intersectRight = Math.min(charAbsRight, lassoRight);
                const intersectTop = Math.max(charAbsTop, lassoTop);
                const intersectBottom = Math.min(charAbsBottom, lassoBottom);
                
                if (intersectLeft < intersectRight && intersectTop < intersectBottom) {
                    const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                    const charArea = Math.max(1, (charAbsRight - charAbsLeft) * (charAbsBottom - charAbsTop));
                    if (intersectArea / charArea > 0.40) {
                        indices.push(charIndexOffset + i);
                    }
                }
            }
            charIndexOffset += lineBounds.length + 1;
        }
        return indices;
    }

    // Fallback if __charBounds is missing
    const charW = bound.width / Math.max(1, obj.text.length);
    for (let i = 0; i < obj.text.length; i++) {
        const charAbsLeft = bound.left + i * charW;
        const charAbsRight = bound.left + (i + 1) * charW;
        
        const intersectLeft = Math.max(charAbsLeft, lassoLeft);
        const intersectRight = Math.min(charAbsRight, lassoRight);
        const intersectTop = Math.max(bound.top, lassoTop);
        const intersectBottom = Math.min(bound.top + bound.height, lassoBottom);
        
        if (intersectLeft < intersectRight && intersectTop < intersectBottom) {
            const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
            const charArea = Math.max(1, (charAbsRight - charAbsLeft) * bound.height);
            if (intersectArea / charArea > 0.25) {
                indices.push(i);
            }
        }
    }
    return indices;
}

function setMode(mode) {
    currentMode = mode;
    const allEraseBtns = [
        document.getElementById('btn-sidebar-erase'),
        document.getElementById('btn-top-erase')
    ].filter(Boolean);

    const allToolBtns = [
        document.getElementById('btn-tool-draw'),
        document.getElementById('btn-tool-move'),
        document.getElementById('btn-tool-text'),
        document.getElementById('fab-lasso'),
        ...allEraseBtns
    ].filter(Boolean);

    allToolBtns.forEach(b => b.classList.remove('active'));
    clearLasso();

    if (mode === 'draw') {
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.getObjects().forEach(obj => {
            obj.selectable = false;
            obj.evented = false;
        });
        canvas.freeDrawingBrush.color = currentColor;
        canvas.freeDrawingBrush.width = parseInt(brushSize.value);
        document.getElementById('btn-tool-draw')?.classList.add('active');
        canvas.defaultCursor = 'crosshair';
        canvas.renderAll();
    } else if (mode === 'move') {
        setMode('draw');
        return;
    } else if (mode === 'text') {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        addTextToCanvas("Công thức Hóa");
        setMode('draw');
    } else if (mode === 'lasso') {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        document.getElementById('fab-lasso')?.classList.add('active');
        canvas.defaultCursor = 'crosshair';
    } else if (mode === 'erase') {
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.freeDrawingBrush.color = '#0a1628';
        canvas.freeDrawingBrush.width = 24;
        allEraseBtns.forEach(b => b.classList.add('active'));
        canvas.defaultCursor = 'cell';
        canvas.renderAll();
    }
}

document.getElementById('btn-tool-draw')?.addEventListener('click', () => setMode('draw'));
document.getElementById('btn-tool-move')?.addEventListener('click', () => setMode('move'));
document.getElementById('btn-tool-text')?.addEventListener('click', () => setMode('text'));
// Khoanh vùng (nút tròn): bấm lần nữa khi đang khoanh vùng thì quay về bút
document.getElementById('fab-lasso')?.addEventListener('click', () => setMode(currentMode === 'lasso' ? 'draw' : 'lasso'));

const btnSidebarErase = document.getElementById('btn-sidebar-erase');
if (btnSidebarErase) {
    btnSidebarErase.addEventListener('click', () => {
        // Đang khoanh vùng → xóa nét trong vùng; không thì bật/tắt cục tẩy
        if (lastLassoCrop) { eraseLassoRegion(); return; }
        setMode(currentMode === 'erase' ? 'draw' : 'erase');
    });
}

const btnTopErase = document.getElementById('btn-top-erase');
if (btnTopErase) {
    btnTopErase.addEventListener('click', () => {
        setMode(currentMode === 'erase' ? 'draw' : 'erase');
    });
}

btnClear.addEventListener('click', () => {
    canvas.clear();
    canvas.backgroundColor = '#0a1628';
    canvas.renderAll();
    // Cleanup Three.js renderers trước khi remove widgets — tránh memory leak
    disposeAllRenderers();
    document.querySelectorAll('.smart-widget').forEach(w => w.remove());
    clearLasso();
    // Clear OCR objects for current page
    if (window.pageManager) {
        const curPage = window.pageManager.getCurrentPage();
        if (curPage) {
            curPage.ocrObjects = [];
            curPage.elements = [];
            curPage.canvasJSON = null;
        }
    }
});

// Cập nhật nút bảng màu 7 sắc + đánh dấu ô màu đang chọn
function updateColorIndicator(color) {
    const dot = document.getElementById('color-current-dot');
    if (dot) dot.style.background = color;
    const preview = document.getElementById('brush-preview');
    if (preview) preview.style.background = color;
    const custom = document.getElementById('color-custom-input');
    if (custom && /^#[0-9a-f]{6}$/i.test(color)) custom.value = color;
    document.querySelectorAll('.color-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === (color || '').toLowerCase()));
}

function applyPenColor(color) {
    currentColor = color;
    updateColorIndicator(color);
    if (currentMode === 'erase') {
        setMode('draw');
    } else {
        canvas.freeDrawingBrush.color = currentColor;
    }
    
    // If lasso is active, color the objects inside it
    if (lastLassoCrop) {
        const scaleX = canvas.width / canvasEl.clientWidth;
        const scaleY = canvas.height / canvasEl.clientHeight;
        const lx = lastLassoCrop.x * scaleX;
        const ly = lastLassoCrop.y * scaleY;
        const lw = lastLassoCrop.w * scaleX;
        const lh = lastLassoCrop.h * scaleY;
        
        const objects = canvas.getObjects();
        let changed = false;
        objects.forEach(obj => {
            const bound = obj.getBoundingRect();
            // Check if bounding box intersects with lasso region
            if (!(bound.left > lx + lw || 
                  bound.left + bound.width < lx || 
                  bound.top > ly + lh || 
                  bound.top + bound.height < ly)) {
                if (obj.type === 'path') {
                    obj.set({ stroke: currentColor });
                    changed = true;
                } else if (obj.type === 'textbox' || obj.type === 'text') {
                    const intersectLeft = Math.max(bound.left, lx);
                    const intersectRight = Math.min(bound.left + bound.width, lx + lw);
                    const intersectTop = Math.max(bound.top, ly);
                    const intersectBottom = Math.min(bound.top + bound.height, ly + lh);
                    const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                    const objArea = bound.width * bound.height;
                    
                    if (intersectArea / objArea > 0.8) {
                        obj.set({ fill: currentColor });
                        obj.styles = {}; // clear styles
                        changed = true;
                    } else {
                        const indices = getIntersectingCharIndices(obj, intersectLeft, intersectRight, intersectTop, intersectBottom);
                        if (indices.length > 0) {
                            if (!obj.styles) obj.styles = {};
                            indices.forEach(idx => {
                                obj.setSelectionStyles({ fill: currentColor }, idx, idx + 1);
                            });
                            changed = true;
                        }
                    }
                }
            }
        });
        
        if (changed) {
            canvas.renderAll();
            saveState();
            clearLasso(); // clear after applying color
            return; // stay in current mode
        }
    }
    
    setMode('draw');
}

// ---- BẢNG MÀU (nút 7 sắc → popup chọn màu) ----
const colorPaletteBtn = document.getElementById('color-palette-btn');
const colorPalettePop = document.getElementById('color-palette-pop');

function positionColorPalette() {
    const r = colorPaletteBtn.getBoundingClientRect();
    const popW = colorPalettePop.offsetWidth, popH = colorPalettePop.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - popW / 2, window.innerWidth - popW - 8));
    colorPalettePop.style.left = left + 'px';
    colorPalettePop.style.top  = Math.max(8, r.top - popH - 10) + 'px';
}

function toggleColorPalette(show) {
    const open = show ?? colorPalettePop.classList.contains('hidden');
    colorPalettePop.classList.toggle('hidden', !open);
    colorPaletteBtn.classList.toggle('open', open);
    if (open) positionColorPalette();
}

colorPaletteBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColorPalette();
});

colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        applyPenColor(btn.dataset.color);
        toggleColorPalette(false);
    });
});

// Màu tùy chọn: xem trước khi kéo, áp dụng khi chọn xong
const colorCustomInput = document.getElementById('color-custom-input');
colorCustomInput?.addEventListener('input', () => updateColorIndicator(colorCustomInput.value));
colorCustomInput?.addEventListener('change', () => {
    applyPenColor(colorCustomInput.value);
    toggleColorPalette(false);
});

// Bấm ra ngoài / Esc / đổi kích thước cửa sổ → đóng bảng màu
document.addEventListener('pointerdown', (e) => {
    if (!colorPalettePop || colorPalettePop.classList.contains('hidden')) return;
    if (e.target.closest('#color-palette-pop') || e.target.closest('#color-palette-btn')) return;
    toggleColorPalette(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleColorPalette(false); });
window.addEventListener('resize', () => toggleColorPalette(false));

// ---- CỠ NÉT: bấm 1 lần vào bút = chọn bút; bấm đúp = mở ô chọn cỡ nét ----
const penBtn = document.getElementById('btn-tool-draw');
const brushPop = document.getElementById('brush-size-pop');
function updateBrushPreview() {
    const size = parseInt(brushSize.value);
    const val = document.getElementById('brush-size-val');
    const dot = document.getElementById('brush-preview');
    if (val) val.textContent = size;
    if (dot) {
        const d = Math.max(3, size * 1.6);   // phóng to chút cho dễ nhìn
        dot.style.width = d + 'px';
        dot.style.height = d + 'px';
        dot.style.background = currentColor;
    }
}
function toggleBrushPop(show) {
    if (!brushPop || !penBtn) return;
    const open = show ?? brushPop.classList.contains('hidden');
    brushPop.classList.toggle('hidden', !open);
    penBtn.classList.toggle('pen-pop-open', open);
    if (!open) return;
    updateBrushPreview();
    const r = penBtn.getBoundingClientRect();
    const w = brushPop.offsetWidth, h = brushPop.offsetHeight;
    brushPop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    brushPop.style.top = Math.max(8, r.top - h - 10) + 'px';
}
// Tự nhận bấm đúp (chạy cả với chuột lẫn màn hình cảm ứng Smart TV)
let _penLastTap = 0;
penBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - _penLastTap < 400) { toggleBrushPop(); _penLastTap = 0; }
    else { _penLastTap = now; toggleBrushPop(false); }
});
document.addEventListener('pointerdown', (e) => {
    if (!brushPop || brushPop.classList.contains('hidden')) return;
    if (e.target.closest('#brush-size-pop') || e.target.closest('#btn-tool-draw')) return;
    toggleBrushPop(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleBrushPop(false); });
window.addEventListener('resize', () => toggleBrushPop(false));
brushSize.addEventListener('input', updateBrushPreview);

brushSize.addEventListener('input', () => {
    const val = parseInt(brushSize.value);
    canvas.freeDrawingBrush.width = val;
    
    if (lastLassoCrop) {
        const scaleX = canvas.width / canvasEl.clientWidth;
        const scaleY = canvas.height / canvasEl.clientHeight;
        const lx = lastLassoCrop.x * scaleX;
        const ly = lastLassoCrop.y * scaleY;
        const lw = lastLassoCrop.w * scaleX;
        const lh = lastLassoCrop.h * scaleY;
        
        const objects = canvas.getObjects();
        let changed = false;
        objects.forEach(obj => {
            const bound = obj.getBoundingRect();
            if (!(bound.left > lx + lw || 
                  bound.left + bound.width < lx || 
                  bound.top > ly + lh || 
                  bound.top + bound.height < ly)) {
                
                if (obj.type === 'path') {
                    obj.set({ strokeWidth: val });
                    changed = true;
                } else if (obj.type === 'textbox' || obj.type === 'text') {
                    // For text, we could adjust fontWeight, but standard brush size usually means stroke thickness.
                    // We can add a subtle stroke to text to make it "bolder"
                    if (val > 3) {
                        obj.set({ stroke: obj.fill, strokeWidth: val / 4 });
                    } else {
                        obj.set({ strokeWidth: 0 });
                    }
                    changed = true;
                }
            }
        });
        
        if (changed) {
            canvas.renderAll();
        }
    }
});

brushSize.addEventListener('change', () => {
    if (lastLassoCrop) {
        saveState();
    }
});

// ---- LASSO (Pure DOM mouse events — avoids all Fabric.js coordinate bugs) ----
const canvasEl = document.getElementById('canvas-section');

canvasEl.addEventListener('pointerdown', (e) => {
    if (currentMode !== 'lasso') return;
    if (e.target.closest('.smart-widget') || e.target.closest('.lasso-actions') || e.target.closest('.lasso-actions-pill') || e.target.closest('.floating-menu') || e.target.closest('.btn-analyze')) return;
    // Nhấn vào bên trong vùng đã khoanh → kéo di chuyển nội dung thay vì khoanh vùng mới
    if (lastLassoCrop && e.target.closest('.lasso-rect-overlay')) {
        startLassoMove(e);
        return;
    }
    clearLasso();

    const rect = canvasEl.getBoundingClientRect();
    lassoStartX = e.clientX - rect.left;
    lassoStartY = e.clientY - rect.top;
    lassoEndX   = lassoStartX;
    lassoEndY   = lassoStartY;
    lassoActive = true;

    // Create visual overlay div
    lassoOverlay = document.createElement('div');
    lassoOverlay.className = 'lasso-rect-overlay';
    updateLassoOverlay();
    canvasEl.appendChild(lassoOverlay);

    e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
    if (lassoMove) { moveLassoSelection(e); return; }
    if (!lassoActive) return;
    const rect = canvasEl.getBoundingClientRect();
    lassoEndX = Math.max(0, Math.min(e.clientX - rect.left, canvasEl.clientWidth));
    lassoEndY = Math.max(0, Math.min(e.clientY - rect.top,  canvasEl.clientHeight));
    updateLassoOverlay();
});

document.addEventListener('pointerup', (e) => {
    if (lassoMove) { endLassoMove(); return; }
    if (!lassoActive) return;
    lassoActive = false;
    lassoOverlay?.classList.add('movable');
    if (lassoOverlay) lassoOverlay.title = 'Nhấn giữ và kéo để di chuyển nội dung';

    let w = Math.abs(lassoEndX - lassoStartX);
    let h = Math.abs(lassoEndY - lassoStartY);

    if (w < 15 || h < 15) { clearLasso(); return; }

    let lx = Math.min(lassoStartX, lassoEndX);
    let ly = Math.min(lassoStartY, lassoEndY);

    // Thu gọn khung khoanh ôm sát nội dung bên trong (khoanh rộng cũng không sao)
    const content = getContentBounds(getObjectsInLasso({ x: lx, y: ly, w, h }));
    if (content) {
        const PAD = 10;
        lx = Math.max(0, content.x - PAD);
        ly = Math.max(0, content.y - PAD);
        w = Math.min(canvasEl.clientWidth,  content.x + content.w + PAD) - lx;
        h = Math.min(canvasEl.clientHeight, content.y + content.h + PAD) - ly;
        lassoStartX = lx; lassoEndX = lx + w;
        lassoStartY = ly; lassoEndY = ly + h;
        updateLassoOverlay();
    }

    // Lưu crop data phục vụ AI nếu cần
    const dataURL = cropCanvas(lx, ly, w, h);
    lastLassoCrop = { dataURL, x: lx, y: ly, w, h };

    // Không hiện thanh nút nổi: dùng ⚡/✏️ ở nút tròn để nhận dạng, nút Tẩy để xóa vùng, Esc hoặc bấm ra ngoài để hủy
});

// Esc → hủy vùng khoanh
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lastLassoCrop && !lassoMove) clearLasso();
});

// ---- KÉO DI CHUYỂN NỘI DUNG TRONG VÙNG KHOANH ----
let lassoMove = null;   // trạng thái đang kéo nội dung vùng khoanh (xem startLassoMove)

// Các nét/chữ có tâm nằm trong vùng khoanh (cùng tiêu chí với "Xóa vùng")
function getObjectsInLasso(crop) {
    const scaleX = canvas.width / canvasEl.clientWidth;
    const scaleY = canvas.height / canvasEl.clientHeight;
    const lx = crop.x * scaleX, ly = crop.y * scaleY;
    const lw = crop.w * scaleX, lh = crop.h * scaleY;
    return canvas.getObjects().filter(obj => {
        if (!obj.visible) return false;
        const b = obj.getBoundingRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        return cx >= lx && cx <= lx + lw && cy >= ly && cy <= ly + lh;
    });
}

// Khung bao (đơn vị px màn hình) của một nhóm nét/chữ
function getContentBounds(objs) {
    if (!objs || objs.length === 0) return null;
    const scaleX = canvas.width / canvasEl.clientWidth;
    const scaleY = canvas.height / canvasEl.clientHeight;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    objs.forEach(obj => {
        const b = obj.getBoundingRect();
        x1 = Math.min(x1, b.left); y1 = Math.min(y1, b.top);
        x2 = Math.max(x2, b.left + b.width); y2 = Math.max(y2, b.top + b.height);
    });
    return { x: x1 / scaleX, y: y1 / scaleY, w: (x2 - x1) / scaleX, h: (y2 - y1) / scaleY };
}

function startLassoMove(e) {
    const objs = getObjectsInLasso(lastLassoCrop);
    if (objs.length === 0) {
        showToast('Không có nét vẽ nào trong vùng chọn để di chuyển', 'warn');
        return;
    }
    e.preventDefault();
    const content = getContentBounds(objs);
    const pageRect = canvasEl.getBoundingClientRect();
    // Ảnh "bóng" của nội dung — hiện theo con trỏ khi kéo ra ngoài trang hiện tại
    const ghost = document.createElement('img');
    ghost.className = 'lasso-drag-ghost hidden';
    ghost.src = cropCanvas(content.x, content.y, content.w, content.h);
    ghost.style.width = content.w + 'px';
    ghost.style.height = content.h + 'px';
    document.body.appendChild(ghost);

    lassoMove = {
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        objs: objs.map(obj => ({ obj, left: obj.left, top: obj.top })),
        crop: { x: lastLassoCrop.x, y: lastLassoCrop.y },
        content,
        // Vị trí con trỏ so với góc trên-trái của phần chữ
        grabX: e.clientX - (pageRect.left + content.x),
        grabY: e.clientY - (pageRect.top + content.y),
        ghost,
        outside: false,
        autoScrollRaf: null
    };
    lassoOverlay?.classList.add('moving');
    lassoAutoScrollLoop();
}

// Trang (ô .page-slot) nằm dưới con trỏ, null nếu không trúng trang nào
function getPageSlotAt(clientX, clientY) {
    const el = document.elementsFromPoint(clientX, clientY).find(n => n.classList && n.classList.contains('page-slot'));
    return el || null;
}

function setLassoOutside(outside, m = lassoMove) {
    if (m.outside === outside) return;
    m.outside = outside;
    m.ghost.classList.toggle('hidden', !outside);
    m.objs.forEach(({ obj }) => obj.set({ visible: !outside }));
    lassoOverlay?.classList.toggle('drag-away', outside);
    canvas.requestRenderAll();
}

function moveLassoSelection(e) {
    const m = lassoMove;
    m.lastX = e.clientX; m.lastY = e.clientY;

    // Kéo ra khỏi trang hiện tại → hiện ảnh bóng theo con trỏ
    const slot = getPageSlotAt(e.clientX, e.clientY);
    const currentSlot = canvasEl.parentElement;
    setLassoOutside(slot !== currentSlot);
    m.ghost.style.left = (e.clientX - m.grabX) + 'px';
    m.ghost.style.top  = (e.clientY - m.grabY) + 'px';

    // Trong trang hiện tại: chỉ giữ phần CHỮ trong phạm vi trang (chữ kéo sát được tới mép)
    const pageRect = canvasEl.getBoundingClientRect();
    const c = m.content;
    const wantX = e.clientX - m.grabX - pageRect.left;
    const wantY = e.clientY - m.grabY - pageRect.top;
    const dx = Math.max(0, Math.min(wantX, canvasEl.clientWidth  - c.w)) - c.x;
    const dy = Math.max(0, Math.min(wantY, canvasEl.clientHeight - c.h)) - c.y;
    const scaleX = canvas.width / canvasEl.clientWidth;
    const scaleY = canvas.height / canvasEl.clientHeight;
    m.objs.forEach(({ obj, left, top }) => obj.set({ left: left + dx * scaleX, top: top + dy * scaleY }));
    canvas.requestRenderAll();

    lastLassoCrop.x = m.crop.x + dx;
    lastLassoCrop.y = m.crop.y + dy;
    lassoStartX = lastLassoCrop.x; lassoEndX = lastLassoCrop.x + lastLassoCrop.w;
    lassoStartY = lastLassoCrop.y; lassoEndY = lastLassoCrop.y + lastLassoCrop.h;
    updateLassoOverlay();
}

// Kéo tới gần mép trên/dưới khung cuộn → tự cuộn để tới các trang đang khuất
function lassoAutoScrollLoop() {
    const m = lassoMove;
    if (!m) return;
    const scroller = document.getElementById('page-scroller');
    if (scroller) {
        const r = scroller.getBoundingClientRect();
        const EDGE = 60;
        let v = 0;
        if (m.lastY < r.top + EDGE) v = -Math.ceil((r.top + EDGE - m.lastY) / 4);
        else if (m.lastY > r.bottom - EDGE) v = Math.ceil((m.lastY - (r.bottom - EDGE)) / 4);
        if (v !== 0) {
            scroller.scrollTop += v;
            moveLassoSelection({ clientX: m.lastX, clientY: m.lastY });
        }
    }
    m.autoScrollRaf = requestAnimationFrame(lassoAutoScrollLoop);
}

function endLassoMove() {
    const m = lassoMove;
    lassoMove = null;
    cancelAnimationFrame(m.autoScrollRaf);
    m.ghost.remove();
    lassoOverlay?.classList.remove('moving');

    // Thả lên một trang khác → chuyển nội dung sang trang đó
    const slot = getPageSlotAt(m.lastX, m.lastY);
    if (m.outside && slot && slot !== canvasEl.parentElement && typeof pageManager !== 'undefined') {
        const rect = slot.getBoundingClientRect();
        moveLassoContentToPage(m, Number(slot.dataset.pageId),
            m.lastX - m.grabX - rect.left, m.lastY - m.grabY - rect.top);
        return;
    }

    // Thả ngoài mọi trang → trả về vị trí trong trang hiện tại
    setLassoOutside(false, m);
    m.objs.forEach(({ obj }) => obj.setCoords());
    canvas.renderAll();
    if (lastLassoCrop.x !== m.crop.x || lastLassoCrop.y !== m.crop.y) {
        // Cập nhật lại vị trí chữ OCR đã lưu cho trang hiện tại
        if (typeof pageManager !== 'undefined') {
            (pageManager.getCurrentPage()?.ocrObjects || []).forEach(entry => {
                if (entry._fabricObj && m.objs.some(o => o.obj === entry._fabricObj)) {
                    entry.x = Math.round(entry._fabricObj.left);
                    entry.y = Math.round(entry._fabricObj.top);
                }
            });
        }
        lastLassoCrop.dataURL = cropCanvas(lastLassoCrop.x, lastLassoCrop.y, lastLassoCrop.w, lastLassoCrop.h);
        saveState();
    }
}

// Chuyển các nét/chữ đang kéo sang trang khác, đặt góc trên-trái phần chữ tại (destX, destY) px của trang đích
async function moveLassoContentToPage(m, targetPageId, destX, destY) {
    const c = m.content;
    destX = Math.max(0, Math.min(destX, canvasEl.clientWidth  - c.w));
    destY = Math.max(0, Math.min(destY, canvasEl.clientHeight - c.h));
    const scaleX = canvas.width / canvasEl.clientWidth;
    const scaleY = canvas.height / canvasEl.clientHeight;
    // Vị trí gốc (trước khi kéo) + độ lệch tới chỗ thả
    const offX = (destX - c.x) * scaleX, offY = (destY - c.y) * scaleY;

    const props = ['selectable', 'evented', 'data', 'id', 'hasControls', 'hasBorders',
                   'lockScalingX', 'lockScalingY', 'lockRotation', 'hoverCursor', 'moveCursor'];
    const jsons = m.objs.map(({ obj, left, top }) => {
        const o = obj.toObject(props);
        o.left = left + offX; o.top = top + offY; o.visible = true;
        return o;
    });

    // Gỡ khỏi trang hiện tại (kèm danh sách chữ OCR của trang)
    const srcPage = pageManager.getCurrentPage();
    const movedSet = new Set(m.objs.map(o => o.obj));
    const movedOcr = (srcPage.ocrObjects || []).filter(en => movedSet.has(en._fabricObj));
    srcPage.ocrObjects = (srcPage.ocrObjects || []).filter(en => !movedSet.has(en._fabricObj));
    m.objs.forEach(({ obj }) => canvas.remove(obj));
    clearLasso();
    canvas.renderAll();
    saveState();

    await window.switchToPage(targetPageId);

    fabric.util.enlivenObjects(jsons, (objs) => {
        const dstPage = pageManager.getCurrentPage();
        dstPage.ocrObjects = dstPage.ocrObjects || [];
        objs.forEach(obj => {
            canvas.add(obj);
            if (obj.data && obj.data.isOCR && typeof makeOCRTextDraggable === 'function') {
                const entry = movedOcr.find(en => en.id === obj.data.ocrId);
                makeOCRTextDraggable(obj, entry);
                if (entry) {
                    entry._fabricObj = obj;
                    entry.x = Math.round(obj.left);
                    entry.y = Math.round(obj.top);
                    dstPage.ocrObjects.push(entry);
                }
            }
        });
        canvas.renderAll();
        saveState();
        showToast(`Đã chuyển nội dung sang Trang ${pageManager.getPageIndex() + 1}`, 'info');
    });
}

function updateLassoOverlay() {
    if (!lassoOverlay) return;
    const x = Math.min(lassoStartX, lassoEndX);
    const y = Math.min(lassoStartY, lassoEndY);
    const w = Math.abs(lassoEndX - lassoStartX);
    const h = Math.abs(lassoEndY - lassoStartY);
    lassoOverlay.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
}

function clearLasso() {
    lassoActive = false;
    lassoMove = null;
    if (lassoOverlay) { lassoOverlay.remove(); lassoOverlay = null; }
    document.getElementById('lasso-actions-pill')?.remove();
    lastLassoCrop = null;
}

// ---- CROP: Pure DOM canvas — correctly handles devicePixelRatio ----
function cropCanvas(cssX, cssY, cssW, cssH) {
    const lower  = document.querySelector('#canvas-section .lower-canvas');
    // Physical pixels vs CSS pixels
    const scaleX = lower.width  / canvasEl.clientWidth;
    const scaleY = lower.height / canvasEl.clientHeight;

    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(cssW);
    offscreen.height = Math.round(cssH);
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Source in physical pixels → destination in CSS pixels
    ctx.drawImage(lower,
        cssX * scaleX, cssY * scaleY,
        cssW * scaleX, cssH * scaleY,
        0, 0,
        cssW, cssH
    );

    return offscreen.toDataURL('image/jpeg', 0.9);
}





// ---- Hàm dùng chung cho Voice Agent (thay thế duplicate code) ----
function sendVoiceToAI(fullText) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/analyze`);

    ws.onopen = () => {
        setLoading(true, 'AI đang xử lý lệnh giọng nói...');
        const imgData = getCanvasImageData();
        ws.send(JSON.stringify({ text: fullText, action: 'voice_agent', image: imgData }));
    };

    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'log') {
            if (data.message) setLoading(true, data.message);
            return;
        }
        setLoading(false);
        ws.close();
        if (data.type === 'result_voice_agent') {
            handleVoiceAgentResult(data.data);
        }
    };

    ws.onerror = () => {
        setLoading(false);
        showToast('Lỗi kết nối máy chủ.', 'error');
    };

    ws.onclose = () => setLoading(false);
}

// ============================================================
//  CAPTURE & SEND TO AI
// ============================================================
    // removed btnAnalyze event listener

// ---- Registry để cleanup Three.js renderers khi Clear Board ----
const _threeRenderers = new Map(); // widgetId -> renderer

function registerRenderer(widgetId, renderer) {
    _threeRenderers.set(widgetId, renderer);
}

function disposeAllRenderers() {
    _threeRenderers.forEach((renderer) => {
        try { renderer.dispose(); } catch(e) {}
    });
    _threeRenderers.clear();
    if (typeof window.disposeAllChemRenderers === 'function') {
        try { window.disposeAllChemRenderers(); } catch(e) {}
    }
}

// ============================================================
//  FLOATING DRAGGABLE WIDGET MOUNT CONTROLLER
// ============================================================
function openTvSplitPanel(widgetNode) {
    if (widgetNode && canvasSection) {
        canvasSection.appendChild(widgetNode);
        makeWidgetDraggable(widgetNode);
    }
}

function closeTvSplitPanel() {
    if (window.ChemicalSoundSynthesizer) {
        ChemicalSoundSynthesizer.stop();
    }
}

function getCanvasImageData(forceFull = false) {
    canvas.discardActiveObject();
    canvas.renderAll();
    
    const lower = document.querySelector('#canvas-section .lower-canvas');
    if (!lower) return null;

    const srcW = lower.width;
    const srcH = lower.height;

    // SPEED OPT (ROI Bounding-Box Crop): Chỉ crop vùng có nét chữ viết thay vì cả màn hình TV 4K
    const objects = canvas.getObjects ? canvas.getObjects() : [];
    if (!forceFull && objects.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        objects.forEach(obj => {
            if (obj.visible === false) return;
            const b = obj.getBoundingRect ? obj.getBoundingRect() : {
                left: obj.left, top: obj.top, width: (obj.width || 0) * (obj.scaleX || 1), height: (obj.height || 0) * (obj.scaleY || 1)
            };
            minX = Math.min(minX, b.left);
            minY = Math.min(minY, b.top);
            maxX = Math.max(maxX, b.left + b.width);
            maxY = Math.max(maxY, b.top + b.height);
        });

        if (minX < maxX && minY < maxY) {
            const PAD = 40; // Đệm viền an toàn
            const cropX = Math.max(0, Math.floor(minX - PAD));
            const cropY = Math.max(0, Math.floor(minY - PAD));
            const cropW = Math.min(srcW - cropX, Math.ceil(maxX - minX + PAD * 2));
            const cropH = Math.min(srcH - cropY, Math.ceil(maxY - minY + PAD * 2));

            if (cropW >= 50 && cropH >= 30) {
                const maxDim = 900;
                let targetW = cropW;
                let targetH = cropH;
                if (cropW > maxDim || cropH > maxDim) {
                    const sc = Math.min(maxDim / cropW, maxDim / cropH);
                    targetW = Math.round(cropW * sc);
                    targetH = Math.round(cropH * sc);
                }
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = targetW;
                cropCanvas.height = targetH;
                const cCtx = cropCanvas.getContext('2d');
                cCtx.fillStyle = '#0a1628';
                cCtx.fillRect(0, 0, targetW, targetH);
                cCtx.drawImage(lower, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
                console.log(`[ROI Bounding-Box] Đã crop vùng chữ viết: ${cropW}x${cropH} -> ${targetW}x${targetH} (Tiết kiệm >85% payload)`);
                return cropCanvas.toDataURL('image/jpeg', 0.85);
            }
        }
    }

    // Fallback: Full canvas resize về max 1024px
    const MAX_SIZE = 1024;
    let dstW = srcW;
    let dstH = srcH;
    if (srcW > MAX_SIZE || srcH > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / srcW, MAX_SIZE / srcH);
        dstW = Math.round(srcW * ratio);
        dstH = Math.round(srcH * ratio);
    }

    const offscreen = document.createElement('canvas');
    offscreen.width  = dstW;
    offscreen.height = dstH;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, dstW, dstH);
    ctx.drawImage(lower, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
    return offscreen.toDataURL('image/jpeg', 0.80);
}

function triggerBeautifyText() {
    if (!lastLassoCrop) {
        showToast('Vui lòng dùng công cụ khoanh vùng (Lasso) để chọn chữ cần làm đẹp trước!', 'warn');
        return;
    }
    setLoading(true, 'AI đang đọc chữ...');
    window._pendingBeautifyCrop = lastLassoCrop;
    sendToAI(lastLassoCrop.dataURL, 'beautify_text');
    clearLasso();
}

function captureAndAnalyze() {
    if (canvas.getObjects().length === 0) {
        showToast('Vui lòng viết gì đó lên bảng trước!', 'warn');
        return;
    }

    setLoading(true, 'AI đang nhận dạng chữ viết...');
    
    const imageData = getCanvasImageData();
    if (!imageData) {
        setLoading(false);
        showToast('Lỗi canvas. Hãy thử lại.', 'error');
        return;
    }
    
    const base64Size = imageData.length - imageData.indexOf(',') - 1;
    if (base64Size < 3000) {
        setLoading(false);
        showToast('Không chụp được bảng. Hãy thử vẽ rõ hơn rồi bấm lại.', 'error');
        return;
    }

    sendToAI(imageData);
}

function sendToAI(imageData, actionType = 'auto_analyze', textData = "") {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/analyze`);

    // SPEED OPT: Theo dõi widget hóa học hiện tại để patch pedagogy sau
    let lastChemWidgetId = null;

    ws.onopen = () => {
        setLoading(true, 'AI đang phân tích...');
        ws.send(JSON.stringify({ image: imageData, action: actionType, text: textData }));
    };

    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        if (data.type === 'log') {
            if (data.message) setLoading(true, data.message);
            return;
        }

        // ── Xử lý từng loại message ──────────────────────────────
        if (data.type === 'result_chemistry') {
            // Single-pass: pedagogy đã có sẵn trong cùng 1 message → đóng ws ngay
            ws.close();
            setLoading(false);
            lastChemWidgetId = buildChemWidget(data);

        } else if (data.type === 'result_chemistry_pedagogy') {
            // Legacy fallback: giữ lại phòng khi server cũ gửi 2 message
            ws.close();
            if (lastChemWidgetId) {
                _patchChemPedagogy(lastChemWidgetId, data.safety);
            }

        } else if (data.type === 'result_beautify') {
            ws.close();
            setLoading(false);
            replaceWithBeautifulText(data.text);

        } else if (data.type === 'result_math') {
            ws.close();
            setLoading(false);
            buildMathWidget(data);

        } else if (data.type === 'result_geometry') {
            ws.close();
            setLoading(false);
            buildGeoWidget(data);

        } else if (data.type === 'result_concept') {
            ws.close();
            setLoading(false);
            buildConceptWidget(data);

        } else if (data.type === 'result_analyze' || data.type === 'result_general') {
            ws.close();
            setLoading(false);
            buildGeneralWidget(data);

        } else if (data.type === 'result_voice_agent') {
            ws.close();
            setLoading(false);
            handleVoiceAgentResult(data.data);

        } else if (data.type === 'result_nlp_chemistry') {
            // NLP chemistry result — render trên bảng Smart TV hoặc qua popup
            if (window._nlpWs) { window._nlpWs = null; }
            ws.close();
            setLoading(false);
            if (data.is_handwritten) {
                buildNlpProblemWidget(data);
                showToast('Đã giải bài toán Hóa học viết tay!', 'success');
            } else {
                nlpRenderResult(data);
            }

        } else {
            ws.close();
            setLoading(false);
            showToast('Không nhận ra nội dung. Hãy viết rõ hơn và thử lại.', 'warn');
        }
    };

    ws.onerror = () => {
        setLoading(false);
        showToast('Lỗi kết nối máy chủ. Kiểm tra server đang chạy chưa.', 'error');
    };

    ws.onclose = () => setLoading(false);
}

/**
 * SPEED OPT: Patch safety banner của widget hóa học sau khi pedagogy sẵn sàng.
 * Thay thế nội dung trong widget đang hiển thị — không cần rebuild toàn bộ.
 */
function _patchChemPedagogy(widgetId, safety) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;

    // Xóa spinner loading
    const spinner = document.getElementById(`${widgetId}-ped-loading`);
    if (spinner) spinner.remove();

    const safetyBody = widget.querySelector('.safety-body');
    if (!safetyBody) return;

    // Helper: tạo/cập nhật element
    function patchEl(selector, html, insertAfter) {
        if (!html) return;
        let el = safetyBody.querySelector(selector);
        if (!el) {
            el = document.createElement('div');
            el.className = selector.replace('.', '');
            if (insertAfter) {
                const ref = safetyBody.querySelector(insertAfter);
                ref ? ref.after(el) : safetyBody.appendChild(el);
            } else {
                safetyBody.appendChild(el);
            }
        }
        el.innerHTML = html;
        el.style.animation = 'fadeInUp 0.4s ease';
    }

    // Patch từng phần pedagogy vào banner
    if (safety.reaction_type_label) {
        const badges = safetyBody.querySelector('.safety-badges');
        if (badges) {
            const existing = badges.querySelector('.safety-badge-tag');
            if (existing && !existing.classList.contains('safety-badge-curriculum')) {
                existing.textContent = safety.reaction_type_label;
            }
        }
    }

    const esc = escHtml || (s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));

    if (safety.summary) {
        const reason = safetyBody.querySelector('.safety-reason');
        if (reason) { reason.innerHTML = esc(safety.summary); reason.style.animation = 'fadeInUp 0.4s ease'; }
    }

    patchEl('.safety-mechanism',
        safety.mechanism ? `⚡ <b>Cơ chế:</b> ${esc(safety.mechanism)}` : '',
        '.safety-reason');

    // ── MÔ PHỎNG TRỰC QUAN — typewriter effect ─────────────
    if (safety.simulation) {
        let simEl = safetyBody.querySelector('.safety-simulation');
        if (!simEl) {
            simEl = document.createElement('div');
            simEl.className = 'safety-simulation';
            const ref = safetyBody.querySelector('.safety-mechanism');
            ref ? ref.after(simEl) : safetyBody.querySelector('.safety-reason')?.after(simEl);
        }
        simEl.innerHTML = `<span class="sim-icon">🎬</span> <b>Mô phỏng thí nghiệm:</b><br><span class="sim-text"></span><span class="sim-cursor">|</span>`;
        simEl.style.animation = 'fadeInUp 0.4s ease';

        // Typewriter effect
        const simTextEl = simEl.querySelector('.sim-text');
        const simText = safety.simulation;
        let i = 0;
        const TYPE_SPEED = 18; // ms per character
        function typeChar() {
            if (i < simText.length) {
                simTextEl.textContent += simText[i++];
                setTimeout(typeChar, TYPE_SPEED);
            } else {
                simEl.querySelector('.sim-cursor').style.display = 'none';
            }
        }
        setTimeout(typeChar, 300); // delay nhỏ trước khi bắt đầu gõ
    }

    if ((safety.warnings || []).length > 0) {
        patchEl('.safety-warnings-list',
            `<ul class="safety-warnings-list">${safety.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`,
            '.safety-simulation');
    }

    if (safety.safe_alternative && safety.safe_alternative !== 'null') {
        patchEl('.safety-alternative',
            `🔬 <b>Thay thế an toàn:</b> ${esc(safety.safe_alternative)}`, '.safety-warnings-list');
    }

    let eduGrid = safetyBody.querySelector('.safety-edu-grid');
    if (!eduGrid) {
        eduGrid = document.createElement('div');
        eduGrid.className = 'safety-edu-grid';
        safetyBody.appendChild(eduGrid);
    }
    if (safety.theory)       eduGrid.innerHTML += `<div class="safety-theory" style="animation:fadeInUp 0.4s ease">📚 <b>Lý thuyết:</b> ${esc(safety.theory)}</div>`;
    if (safety.applications) eduGrid.innerHTML += `<div class="safety-applications" style="animation:fadeInUp 0.4s ease">🏭 <b>Ứng dụng:</b> ${esc(safety.applications)}</div>`;

    patchEl('.safety-student-note',
        safety.student_note ? `📝 ${esc(safety.student_note)}` : '', '.safety-edu-grid');
    patchEl('.safety-funfact',
        safety.fun_fact ? `💡 ${esc(safety.fun_fact)}` : '', '.safety-student-note');
}

function handleVoiceAgentResult(res) {
    if (res.type === 'command') {
        const action = res.action;
        const args = res.args || {};
        
        if (action === 'clear_board' || action === 'clear') {
            canvas.clear();
            canvas.backgroundColor = '#0a1628';
            canvas.renderAll();
            // Cleanup Three.js renderers — tránh memory leak (đồng bộ với nút Clear thủ công)
            disposeAllRenderers();
            document.querySelectorAll('.smart-widget').forEach(w => w.remove());
            clearLasso();
        } else if (action === 'erase_region' && args.box) {
            // box from gemini: [ymin, xmin, ymax, xmax] in 0-1000 scale
            const [ymin, xmin, ymax, xmax] = args.box;
            const canvasW = canvas.width;
            const canvasH = canvas.height;
            
            // Convert to logical pixel coordinates
            const top = (ymin / 1000) * canvasH;
            const left = (xmin / 1000) * canvasW;
            const bottom = (ymax / 1000) * canvasH;
            const right = (xmax / 1000) * canvasW;
            
            const toRemove = [];
            let changed = false;
            canvas.getObjects().forEach(obj => {
                const bound = obj.getBoundingRect();
                const intersectLeft = Math.max(bound.left, left);
                const intersectRight = Math.min(bound.left + bound.width, right);
                const intersectTop = Math.max(bound.top, top);
                const intersectBottom = Math.min(bound.top + bound.height, bottom);

                if (intersectLeft < intersectRight && intersectTop < intersectBottom) {
                    const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                    const objArea = bound.width * bound.height;
                    
                    if (obj.type === 'textbox' || obj.type === 'text') {
                        if (intersectArea / objArea > 0.8) {
                            toRemove.push(obj);
                            changed = true;
                        } else {
                            const indices = getIntersectingCharIndices(obj, intersectLeft, intersectRight, intersectTop, intersectBottom);
                            if (indices.length > 0) {
                                let newText = "";
                                for (let i = 0; i < obj.text.length; i++) {
                                    if (!indices.includes(i)) newText += obj.text[i];
                                }
                                if (newText.trim() === "") {
                                    toRemove.push(obj);
                                } else {
                                    obj.set('text', newText);
                                    obj.styles = {}; // reset styles to avoid misalignment
                                }
                                changed = true;
                            }
                        }
                    } else {
                        if (intersectArea / objArea > 0.15) {
                            toRemove.push(obj);
                            changed = true;
                        }
                    }
                }
            });
            
            if (changed) {
                toRemove.forEach(obj => canvas.remove(obj));
                canvas.renderAll();
                if (typeof saveState === 'function') saveState();
                showToast(`Đã xóa phần bạn yêu cầu!`, 'success');
            } else {
                showToast('Không tìm thấy gì để xóa ở vị trí đó!', 'warn');
            }
        } else if (action === 'change_color' && args.color) {
            currentColor = args.color;
            canvas.freeDrawingBrush.color = currentColor;
            
            updateColorIndicator(currentColor);

            let changed = false;
            
            // 1. If lasso is active, prioritize coloring the lassoed region
            if (lastLassoCrop) {
                const scaleX = canvas.width / canvasEl.clientWidth;
                const scaleY = canvas.height / canvasEl.clientHeight;
                const lx = lastLassoCrop.x * scaleX;
                const ly = lastLassoCrop.y * scaleY;
                const lw = lastLassoCrop.w * scaleX;
                const lh = lastLassoCrop.h * scaleY;
                
                canvas.getObjects().forEach(obj => {
                    const bound = obj.getBoundingRect();
                    if (!(bound.left > lx + lw || bound.left + bound.width < lx || bound.top > ly + lh || bound.top + bound.height < ly)) {
                        if (obj.type === 'path') {
                            obj.set({ stroke: currentColor });
                            changed = true;
                        } else if (obj.type === 'textbox' || obj.type === 'text') {
                            const intersectLeft = Math.max(bound.left, lx);
                            const intersectRight = Math.min(bound.left + bound.width, lx + lw);
                            const intersectTop = Math.max(bound.top, ly);
                            const intersectBottom = Math.min(bound.top + bound.height, ly + lh);
                            const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                            const objArea = bound.width * bound.height;
                            
                            if (intersectArea / objArea > 0.8) {
                                obj.set({ fill: currentColor });
                                obj.styles = {}; 
                                changed = true;
                            } else {
                                const indices = getIntersectingCharIndices(obj, intersectLeft, intersectRight, intersectTop, intersectBottom);
                                if (indices.length > 0) {
                                    if (!obj.styles) obj.styles = {};
                                    indices.forEach(idx => obj.setSelectionStyles({ fill: currentColor }, idx, idx + 1));
                                    changed = true;
                                }
                            }
                        }
                    }
                });
                
                if (changed) clearLasso();
            }
            
            // 2. Fallback to target_text if no lasso was active or it didn't hit anything
            if (!changed && args.target_text) {
                // Change color of specific substring only
                const lowerTarget = args.target_text.toLowerCase();
                canvas.getObjects().forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'text') {
                        const textContent = obj.text.toLowerCase();
                        let startIndex = 0;
                        let index;
                        while ((index = textContent.indexOf(lowerTarget, startIndex)) > -1) {
                            obj.setSelectionStyles({ fill: currentColor }, index, index + lowerTarget.length);
                            startIndex = index + lowerTarget.length;
                            changed = true;
                        }
                    }
                });
            } else if (!changed && !lastLassoCrop) {
                // 3. Change color of all elements only if no specific text and no lasso
                canvas.getObjects().forEach(obj => {
                    if (obj.type === 'textbox' || obj.type === 'text') {
                        obj.set({ fill: currentColor });
                        obj.styles = {}; 
                        changed = true;
                    } else if (obj.type === 'path') {
                        obj.set({ stroke: currentColor });
                        changed = true;
                    }
                });
            }

            if (changed) {
                canvas.renderAll();
                if (typeof saveState === 'function') saveState();
                showToast('Đã đổi màu theo lệnh của bạn!', 'success');
            } else {
                showToast('Không có gì được đổi màu (thử khoanh lại vùng hoặc nói rõ chữ cần đổi).', 'warn');
            }

            setMode('draw');
        } else if (action === 'add_text' && args.text) {
            addTextToCanvas(args.text);
        } else if (action === 'beautify_text') {
            triggerBeautifyText();
        } else if (action === 'analyze') {
            captureAndAnalyze();
        } else if (action === 'set_mode' && args.mode) {
            setMode(args.mode);
        } else if (action === 'undo') {
            // Fix #5: Undo qua giọng nói ("hoàn tác")
            if (undoStack.length > 1) {
                isRedoing = true;
                redoStack.push(undoStack.pop());
                const state = undoStack[undoStack.length - 1];
                canvas.loadFromJSON(state, () => {
                    canvas.renderAll();
                    isRedoing = false;
                });
            } else {
                showToast('Không có gì để hoàn tác!', 'warn');
            }
        } else if (action === 'redo') {
            // Fix #5: Redo qua giọng nói ("làm lại")
            if (redoStack.length > 0) {
                isRedoing = true;
                const state = redoStack.pop();
                undoStack.push(state);
                canvas.loadFromJSON(state, () => {
                    canvas.renderAll();
                    isRedoing = false;
                });
            } else {
                showToast('Không có gì để làm lại!', 'warn');
            }
        } else if (action === 'read_text') {
            // Fix #4: Đọc toàn bộ văn bản trên bảng ("đọc bài này")
            const objects = canvas.getObjects();
            let textToRead = objects
                .filter(obj => obj.type === 'textbox' || obj.type === 'text')
                .map(obj => obj.text)
                .join('. ');
            if (textToRead.trim()) {
                playTTS(textToRead.trim());
            } else {
                showToast('Không có văn bản nào trên bảng để đọc!', 'warn');
            }
        }
    } else if (res.type === 'concept') {
        buildConceptWidget(res);
    } else if (res.type === 'answer') {
        if (res.definition || res.classification || res.properties || 
           (res.reply && (res.reply.toLowerCase().includes('khái niệm') || 
                          res.reply.toLowerCase().includes('là những hợp chất') || 
                          res.reply.toLowerCase().includes('là chất')))) {
            buildConceptWidget({
                title: res.title || 'Khái Niệm Khoa Học',
                definition: res.definition || res.reply || res.explanation,
                classification: res.classification || [],
                properties: res.properties || [],
                examples: res.examples || [],
                applications: res.applications || '',
                safety_note: res.safety_note || ''
            });
        } else {
            buildGeneralWidget({
                title: res.title || '🧠 Phân Tích & Giải Thích',
                explanation: res.explanation || res.reply || "Tôi không có câu trả lời."
            });
        }
    }
    
    if (res.reply) {
        playTTS(res.reply);
    }
}

function playTTS(text) {
    window.speechSynthesis.cancel();
    if (window._currentTTSAudio) {
        window._currentTTSAudio.pause();
    }
    
    const url = `/api/tts?text=${encodeURIComponent(text)}`;
    const audioEl = document.getElementById('tts-player');
    
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.src = url;
    
    audioEl.onerror = (e) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'vi-VN';
        window.speechSynthesis.speak(utterance);
    };
    
    audioEl.play().catch(err => {
        showToast('Không thể tự động phát! Trình duyệt của bạn đang chặn Autoplay.', 'warn');
    });
}

function replaceWithBeautifulText(text) {
    if (!window._pendingBeautifyCrop) return;
    const { x, y, w, h } = window._pendingBeautifyCrop;
    
    // Find all strokes that intersect with the lasso box (excluding existing OCR text)
    const objects = canvas.getObjects();
    const toRemove = [];
    let actualMinY = Infinity;
    let actualMaxY = -Infinity;
    let actualMinX = Infinity;
    let actualMaxX = -Infinity;

    objects.forEach(obj => {
        if (obj.data && obj.data.isOCR) return; // Do not delete existing OCR text objects!
        const bound = obj.getBoundingRect();
        if (bound.left < x + w && bound.left + bound.width > x &&
            bound.top < y + h && bound.top + bound.height > y) {
            toRemove.push(obj);
            if (bound.top < actualMinY) actualMinY = bound.top;
            if (bound.top + bound.height > actualMaxY) actualMaxY = bound.top + bound.height;
            if (bound.left < actualMinX) actualMinX = bound.left;
            if (bound.left + bound.width > actualMaxX) actualMaxX = bound.left + bound.width;
        }
    });
    
    let strokeHeight = h;
    let strokeWidth = w;
    let textX = x;
    let textY = y;
    
    if (actualMinY !== Infinity && actualMaxY !== -Infinity && actualMinX !== Infinity && actualMaxX !== -Infinity) {
        strokeHeight = actualMaxY - actualMinY;
        strokeWidth = actualMaxX - actualMinX;
        textX = actualMinX;
        textY = actualMinY;
    }
    
    window._pendingBeautifyCrop = null;

    if (window.addOCRTextObject) {
        window.addOCRTextObject(text, textX, textY, strokeWidth, strokeHeight, 0.96, toRemove);
    } else {
        toRemove.forEach(obj => canvas.remove(obj));
        const textLen = Math.max(1, text.length);
        let computedFontSize = Math.sqrt((strokeWidth * strokeHeight) / (0.5 * textLen)) * 0.8;
        computedFontSize = Math.min(computedFontSize, strokeHeight * 0.9);
        const textObj = new fabric.Textbox(text, {
            left: textX,
            top: textY,
            width: Math.max(50, strokeWidth),
            fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
            fontSize: Math.max(16, computedFontSize), 
            fill: currentColor,
            selectable: true,
            evented: true,
            padding: 14,
            hasControls: true,
            hasBorders: true,
            borderColor: '#3b82f6',
            borderScaleFactor: 2,
            cornerColor: '#3b82f6',
            cornerSize: 10,
            cornerStyle: 'circle',
            transparentCorners: false,
            hoverCursor: 'move',
            moveCursor: 'move'
        });
        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        canvas.renderAll();
        showToast('Đã nhận dạng chữ viết!', 'success');
    }
}

// ============================================================
//  CHEMISTRY WIDGET — Chuẩn hóa công thức hiển thị
// ============================================================

/**
 * Chuẩn hóa chuỗi công thức thô từ AI:
 *  - Xử lý số 0 bị nhầm với chữ O: chỉ thay thế '0' đứng sau chữ cái (Na20 → Na2O)
 *  - Giữ nguyên hệ số đầu (2NaOH, 3H2O...)
 *  - Loại bỏ ký hiệu trạng thái ↑↓
 */
function canonicalizeFormula(raw) {
    if (!raw) return '';
    return raw
        .replace(/[↓↑]/g, '')          // bỏ ký hiệu trạng thái
        .trim()
        // Chỉ thay '0' đứng sau chữ cái (Na20 → Na2O, nhưng 2H2O không đổi)
        .replace(/([A-Za-z])0(?=[A-Za-z)]|$)/g, '$1O');
}

/**
 * Render công thức thành HTML có subscript cho số và hệ số đậm:
 *  "Ca(OH)2" → "Ca(OH)<sub>2</sub>"
 *  "2NaOH"   → "<b>2</b>NaOH"
 */
function renderFormulaHtml(raw) {
    const f = canonicalizeFormula(raw);
    if (!f) return '';
    // Chỉ số dưới: số đứng ngay sau chữ cái hoặc ')' (H2O, Ca(OH)2).
    // Số đứng đầu / sau dấu cách, '+', '→' là hệ số (2NaOH) → giữ nguyên cỡ chữ.
    return f.replace(/\d+/g, (m, offset, str) =>
        /[A-Za-z)\]]/.test(str[offset - 1] || '') ? `<sub>${m}</sub>` : m);
}

/**
 * Chuẩn hóa phương trình đầy đủ (reactants → products):
 * Áp dụng canonicalizeFormula lên từng token trong phương trình.
 */
function canonicalizeEquation(eq) {
    if (!eq) return '';
    // Tách theo →, +, ký tự trạng thái rồi chuẩn hóa từng phần
    return eq
        .replace(/([A-Za-z(][A-Za-z0-9()]*)/g, (m) => canonicalizeFormula(m));
}

// ============================================================
//  CHEMISTRY WIDGET — Trạng thái vật lý (state detection)
// ============================================================
const STATE_CFG = {
    aqueous:     { label: 'Dung dịch', short: '(dd)', dot: '🔵',
                   glow: '0 0 18px rgba(59,130,246,0.7)',  border: 'rgba(59,130,246,0.75)',
                   bg: 'rgba(59,130,246,0.10)',   color: '#93c5fd', badgeCls: 'state-aq'   },
    solid:       { label: 'Chất rắn',   short: '(r)',   dot: '⚪',
                   glow: '0 0 14px rgba(148,163,184,0.55)', border: 'rgba(148,163,184,0.6)',
                   bg: 'rgba(100,116,139,0.15)',   color: '#cbd5e1', badgeCls: 'state-solid'},
    liquid:      { label: 'Chất lỏng', short: '(l)',   dot: '💧',
                   glow: '0 0 16px rgba(6,182,212,0.65)',  border: 'rgba(6,182,212,0.7)',
                   bg: 'rgba(6,182,212,0.12)',     color: '#7dd3fc', badgeCls: 'state-liq'  },
    gas:         { label: 'Khí ↑',    short: '(k)',   dot: '🟢',
                   glow: '0 0 20px rgba(16,185,129,0.7)',  border: 'rgba(16,185,129,0.8)',
                   bg: 'rgba(16,185,129,0.12)',    color: '#6ee7b7', badgeCls: 'state-gas'  },
    precipitate: { label: 'Kết tủa ↓', short: '(↓)',   dot: '🟡',
                   glow: '0 0 20px rgba(245,158,11,0.75)', border: 'rgba(245,158,11,0.85)',
                   bg: 'rgba(245,158,11,0.12)',    color: '#fcd34d', badgeCls: 'state-ppt'  },
};

/**
 * Nh???n d???ng tr???ng th??i v???t l?? c???a ph??n t??? d???a tr??n c??ng th???c v?? ph????ng tr??nh.
 * @param {string} formula - c??ng th???c ph??n t??? (c?? th??? c?? ???/???)
 * @param {string} equation - ph????ng tr??nh ?????y ????? (c?? d???u ???)
 * @param {boolean} isProduct - true n???u l?? s???n ph???m
 * @returns {'aqueous'|'solid'|'liquid'|'gas'|'precipitate'}
 */
function detectMolState(formula, equation, isProduct) {
    const raw = formula.trim();
    // Kiểm tra ký hiệu trạng thái rõ ràng trong công thức
    if (raw.includes('↓')) return 'precipitate';
    if (raw.includes('↑')) return 'gas';

    const f = raw
        .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)])   // SO₂ → SO2
        .toUpperCase()
        .replace(/[↓↑()\s]/g, '')
        .replace(/\(AQ\)/,'').replace(/\(S\)/,'').replace(/\(L\)/,'').replace(/\(G\)/,'')
        .replace(/\(LONG\)/,'').replace(/\(DAC\)/,'');

    // Kiểm tra trong chuỗi phương trình xem có ký hiệu ↓/↑ kèm theo công thức không
    if (isProduct && equation) {
        const after = equation.includes('→') ? equation.split('→').slice(1).join('→') : equation;
        const plain = raw.replace(/[↓↑]/g, '').trim();
        if (after.includes(plain + '↓') || after.includes(f + '↓')) return 'precipitate';
        if (after.includes(plain + '↑') || after.includes(f + '↑')) return 'gas';
    }

    // Water
    if (f === 'H2O') return 'liquid';
    // Bromine liquid
    if (f === 'BR2' || f === 'HG') return 'liquid';

    // Metals (solid at room temp)
    const METALS = new Set(['FE','CU','ZN','AL','MG','NA','K','LI','AG','AU','CA','BA',
                            'PB','NI','CR','MN','SN','W','TI','PT','CO','BI','IN','GA']);
    if (METALS.has(f)) return 'solid';

    // Other common solids
    const SOLIDS = new Set(['CACO3','CASO4','BASO4','AGCL','AGI','AGBR','CAO','MGO','AL2O3',
                            'FE2O3','FE3O4','ZNO','CUO','MNO2','SIO2','CASO42H2O','PBSO4',
                            'PBCL2','PBBR2','C','S','P','SI','NACL','KCL','CA3PO42',
                            'MG(OH)2','CA(OH)2','CACO3','SRCO3','BACO3','PBCO3','NI(OH)2','CO(OH)2']);
    if (SOLIDS.has(f)) return 'solid';

    // Common gases
    // (HCl không nằm đây: trong phòng thí nghiệm thường dùng dung dịch axit HCl)
    const GASES = new Set(['H2','O2','CL2','CO2','CO','SO2','SO3','NO','NO2','NH3',
                           'H2S','HF','HBR','HI','N2','F2','CH4','C2H4','C2H2',
                           'C2H6','N2O','NO','CLO2','O3','RADON']);
    if (GASES.has(f)) return 'gas';

    // Common acids (typically aqueous in lab)
    const ACIDS = new Set(['HCL','H2SO4','HNO3','H3PO4','CH3COOH','HCOOH','H2CO3',
                           'HCLO4','HCLO3','HCLO','H2CRO4','H2CR2O7','HMN04']);
    // (Note: HCL gas vs HCL aqueous ambiguity — default to aqueous in lab context)
    if (ACIDS.has(f)) return 'aqueous';

    // Common bases
    if (f.endsWith('OH') || f.includes('(OH)') || f.includes('OH)')) return 'aqueous';
    const BASES = new Set(['NAOH','KOH','BA(OH)2','CA(OH)2','LIOH','CSOH']);
    if (BASES.has(f)) return 'aqueous';

    // Soluble salts (aqueous in solution)
    const saltPrefixes = ['NANO','KNO','MGSO','ZNSO','CUSO','FESO','FE2SO','AGNO',
                          'NA2SO','K2SO','NA2CO','K2CO','MGCL','CACL','BACL','FECL',
                          'ALCL','ZNCL','NACLO','KMNO','K2CR','NAALO','NA2S','K2S',
                          'NA2SIO','NAHCO','KHCO','NH4','NA3PO','K3PO'];
    if (saltPrefixes.some(p => f.startsWith(p))) return 'aqueous';

    return 'aqueous'; // default: assume in solution
}

// ============================================================
//  WEB AUDIO CHEMICAL SOUND SYNTHESIZER (MODULE 2)
//  Tổng hợp âm thanh vật lý thời gian thực, không tải file MP3
// ============================================================
const ChemicalSoundSynthesizer = (function() {
    let audioCtx = null;
    let isMuted = false;
    let activeNodes = [];

    function getContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
                audioCtx = new AudioCtxClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // Tự động unlock AudioContext khi người dùng tương tác với bảng
    ['click', 'touchstart', 'pointerdown'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }, { once: true });
    });

    function toggleMute() {
        isMuted = !isMuted;
        if (isMuted) stop();
        return isMuted;
    }

    function stop() {
        activeNodes.forEach(node => {
            try {
                if (node.stop) node.stop();
                if (node.disconnect) node.disconnect();
            } catch (e) {}
        });
        activeNodes = [];
    }

    // 1. SỦI BỌT KHÍ XÈO XÈO (Fizzing / Bubbling Sound)
    // Tái tạo bằng White Noise Buffer qua BiquadFilter (Bandpass 600Hz-1500Hz) với Gain điều biến ngẫu nhiên
    function playFizz(duration = 2.5) {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;

        try {
            const bufferSize = ctx.sampleRate * duration;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            const whiteNoise = ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;

            // Bandpass filter 600Hz - 1500Hz
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(950, ctx.currentTime);
            filter.Q.setValueAtTime(3.2, ctx.currentTime);

            // Modulation Gain để tạo tiếng bọt khí lách tách trên mặt dung dịch
            const gainNode = ctx.createGain();
            const now = ctx.currentTime;
            gainNode.gain.setValueAtTime(0.01, now);
            gainNode.gain.linearRampToValueAtTime(0.35, now + 0.3);

            // Tạo các xung lách tách ngẫu nhiên
            for (let t = 0.3; t < duration - 0.4; t += 0.08) {
                const bubbleStrength = 0.15 + Math.random() * 0.3;
                gainNode.gain.setValueAtTime(bubbleStrength, now + t);
            }
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

            whiteNoise.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(ctx.destination);

            whiteNoise.start(now);
            whiteNoise.stop(now + duration);

            activeNodes.push(whiteNoise);
        } catch (err) {
            console.warn('[WebAudio Fizz Error]:', err);
        }
    }

    // 2. NỔ LÁCH TÁCH MÃNH LIỆT (Crackle / Violent Explosion Sound)
    // Kim loại kiềm Na, K phản ứng với nước hoặc phản ứng nhiệt nhôm
    function playCrackle(duration = 2.2) {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            
            // Xung trầm (Boom / Rumble)
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(45, now + 0.5);
            oscGain.gain.setValueAtTime(0.5, now);
            oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.6);
            activeNodes.push(osc);

            // Các hạt crackle lách tách liên tục
            const bufferSize = ctx.sampleRate * duration;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                // Tạo xung thưa sắc nhọn
                if (Math.random() < 0.04) {
                    output[i] = (Math.random() * 2 - 1) * 0.9;
                } else {
                    output[i] = 0;
                }
            }

            const crackleSource = ctx.createBufferSource();
            crackleSource.buffer = noiseBuffer;

            const crackleFilter = ctx.createBiquadFilter();
            crackleFilter.type = 'highpass';
            crackleFilter.frequency.setValueAtTime(1200, now);

            const crackleGain = ctx.createGain();
            crackleGain.gain.setValueAtTime(0.65, now);
            crackleGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

            crackleSource.connect(crackleFilter);
            crackleFilter.connect(crackleGain);
            crackleGain.connect(ctx.destination);

            crackleSource.start(now);
            crackleSource.stop(now + duration);
            activeNodes.push(crackleSource);
        } catch (err) {
            console.warn('[WebAudio Crackle Error]:', err);
        }
    }

    // 3. CÒI BÁO ĐỘNG NGUY HIỂM (Red Alert Alarm)
    // 2 hồi siren nhịp điệu cảnh báo nguy cấp cho lớp học
    function playWarningAlarm(duration = 2.0) {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.type = 'sawtooth';

            // Dao động 2 hồi tần số cao (650Hz <-> 950Hz)
            osc.frequency.setValueAtTime(650, now);
            osc.frequency.linearRampToValueAtTime(920, now + 0.4);
            osc.frequency.linearRampToValueAtTime(650, now + 0.8);
            osc.frequency.linearRampToValueAtTime(920, now + 1.2);
            osc.frequency.linearRampToValueAtTime(650, now + 1.6);
            osc.frequency.exponentialRampToValueAtTime(200, now + duration);

            gainNode.gain.setValueAtTime(0.28, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + duration);
            activeNodes.push(osc);
        } catch (err) {
            console.warn('[WebAudio Alarm Error]:', err);
        }
    }

    // 4. ÂM THANH DUNG DỊCH HÒA TRỘN / TRUNG HÒA / KẾT TỦA (Liquid Swirl & Effervescence)
    // Tái tạo tiếng xáo trộn dung dịch khi trung hòa (HCl + NaOH), trao đổi ion, kết tủa
    function playLiquidReaction(duration = 2.0) {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;

            // Lớp 1: Tiếng sục xáo trộn chất lỏng (Lowpass Noise Filter)
            const bufferSize = ctx.sampleRate * duration;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(450, now);
            filter.frequency.linearRampToValueAtTime(750, now + 0.6);
            filter.frequency.exponentialRampToValueAtTime(250, now + duration);

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.01, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 0.25);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noiseSource.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noiseSource.start(now);
            noiseSource.stop(now + duration);
            activeNodes.push(noiseSource);

            // Lớp 2: Các giọt vi bọt phản ứng (Bubble Pop Harmonics)
            const bubbleFreqs = [520, 680, 440, 590, 720, 480];
            bubbleFreqs.forEach((freq, idx) => {
                const bTime = now + 0.2 + idx * 0.18;
                if (bTime < now + duration - 0.2) {
                    const osc = ctx.createOscillator();
                    const bGain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, bTime);
                    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, bTime + 0.08);

                    bGain.gain.setValueAtTime(0.2, bTime);
                    bGain.gain.exponentialRampToValueAtTime(0.001, bTime + 0.08);

                    osc.connect(bGain);
                    bGain.connect(ctx.destination);
                    osc.start(bTime);
                    osc.stop(bTime + 0.08);
                    activeNodes.push(osc);
                }
            });
        } catch (err) {
            console.warn('[WebAudio LiquidReaction Error]:', err);
        }
    }

    // 5. ÂM TEST THỬ LOA KHI BẤM NÚT ÂM THANH
    function playTestChime() {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.08);
                gain.gain.setValueAtTime(0.25, now + i * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.08);
                osc.stop(now + i * 0.08 + 0.35);
                activeNodes.push(osc);
            });
        } catch (e) {}
    }

    return {
        init: getContext,
        toggleMute,
        isMuted: () => isMuted,
        playFizz,
        playCrackle,
        playWarningAlarm,
        playLiquidReaction,
        playTestChime,
        stop
    };
})();

// ============================================================
//  FULL-SCREEN RED ALERT SHIELD (MODULE 3)
// ============================================================
function showRedAlertShield(safetyData, equation) {
    const existing = document.getElementById('red-alert-shield');
    if (existing) existing.remove();

    ChemicalSoundSynthesizer.playWarningAlarm(2.5);

    const shield = document.createElement('div');
    shield.id = 'red-alert-shield';
    shield.className = 'red-alert-shield';

    const safeAlt = safetyData.critical_safe_alt || safetyData.safe_alternative;
    const safeAltHtml = safeAlt && safeAlt !== 'null' ? `
        <div class="red-alert-section">
            <div class="red-alert-safe-alt">
                <div class="safe-title">🔬 ĐỀ XUẤT THÍ NGHIỆM AN TOÀN THAY THẾ (CHUẨN SƯ PHẠM):</div>
                <div>${escHtml(safeAlt)}</div>
            </div>
        </div>
    ` : '';

    shield.innerHTML = `
        <div class="red-alert-modal">
            <div class="red-alert-header">
                <div class="red-alert-siren">🚨</div>
                <div class="red-alert-title-wrap">
                    <h2 class="red-alert-title">CẢNH BÁO NGUY HIỂM — KHÔNG THỰC HIỆN TRỰC TIẾP!</h2>
                    <p class="red-alert-subtitle">Hệ thống phòng vệ an toàn phòng lab tự động kích hoạt</p>
                </div>
            </div>

            <div class="red-alert-equation-box">
                <div class="red-alert-equation">${renderFormulaHtml(equation || safetyData.pair || '')}</div>
            </div>

            <div class="red-alert-section">
                <div class="red-alert-sec-title">⚠️ NGUY CƠ NGUY HIỂM:</div>
                <div class="red-alert-mechanism">${escHtml(safetyData.summary || safetyData.reason || 'Phản ứng có nguy cơ cháy nổ bạo liệt hoặc sinh khí kịch độc!')}</div>
            </div>

            ${safetyData.mechanism ? `
            <div class="red-alert-section">
                <div class="red-alert-sec-title">⚡ PHÂN TÍCH CƠ CHẾ NGUY HIỂM:</div>
                <div class="red-alert-mechanism">${escHtml(safetyData.mechanism)}</div>
            </div>` : ''}

            ${(safetyData.warnings || []).length > 0 ? `
            <div class="red-alert-section">
                <div class="red-alert-sec-title">🛑 CẢNH BÁO ĐẶC BIỆT:</div>
                <ul class="safety-warnings-list" style="color:#fee2e2;">
                    ${safetyData.warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}
                </ul>
            </div>` : ''}

            ${safeAltHtml}

            <div class="red-alert-actions">
                ${safeAlt ? `<button class="red-alert-btn-alt" id="red-alert-alt-btn"><i class="fas fa-check-circle"></i> Đã ghi nhận Thí nghiệm Thay thế</button>` : ''}
                <button class="red-alert-btn-close" id="red-alert-close-btn"><i class="fas fa-times"></i> Đã hiểu &amp; Đóng cảnh báo</button>
            </div>
        </div>
    `;

    document.body.appendChild(shield);

    const closeBtn = document.getElementById('red-alert-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            ChemicalSoundSynthesizer.stop();
            shield.remove();
        });
    }

    const altBtn = document.getElementById('red-alert-alt-btn');
    if (altBtn) {
        altBtn.addEventListener('click', () => {
            ChemicalSoundSynthesizer.stop();
            shield.remove();
            showToast('Đã chuyển sang định hướng thí nghiệm an toàn!', 'success');
        });
    }
}

// ============================================================
//  SMART TV HANDWRITING NLP PROBLEM WIDGET (MODULE 1)
// ============================================================
function buildNlpProblemWidget(data) {
    const wid = 'nlp_w' + Date.now();
    const widget = document.createElement('div');
    widget.className = 'smart-widget tv-nlp-widget';
    widget.id = wid;

    const W = Math.min(880, (canvasSection?.clientWidth || window.innerWidth) - 40);
    const maxH = Math.min(window.innerHeight - 70, 850);
    widget.style.cssText = `width:${W}px;max-height:${maxH}px;height:auto;left:30px;top:30px;min-height:300px;z-index:900;display:flex;flex-direction:column;overflow:hidden;`;

    const entities = data.entities || [];
    const steps = data.steps || [];
    const ratio = data.ratio_analysis || {};
    const finalAns = data.final_answer || {};
    const prods = finalAns.products || [];
    const problemText = data.problem_text || '';

    function cleanLatexEq(eq) {
        if (!eq) return '';
        return eq
            .replace(/\\rightarrow/g, '→')
            .replace(/\\downarrow/g, '↓')
            .replace(/\\uparrow/g, '↑')
            .replace(/\\xrightarrow\{[^}]*\}/g, '→')
            .replace(/\\cdot/g, '·')
            .replace(/\\Delta/g, 'Δ');
    }

    // Step 1: NER & Mol
    const entChipsHtml = entities.length > 0 ? `
        <div class="tv-nlp-entities-chips">
            ${entities.map(e => `
                <div class="tv-nlp-chip">
                    <strong>${escHtml(e.formula || e.name || '')}</strong>: 
                    ${e.amount != null ? `${e.amount} ${escHtml(e.unit || '')}` : ''}
                    ${e.mol != null ? ` ➔ <b>${e.mol} mol</b>` : ''}
                    ${e.molar_mass ? ` (M=${e.molar_mass})` : ''}
                </div>
            `).join('')}
        </div>
    ` : '';

    // Step 2: Ratio & Equations
    let ratioHtml = '';
    if (ratio.T_name) {
        ratioHtml = `
            <div style="margin-top:8px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:8px 14px;color:#bfdbfe;">
                <b>⚖️ Xét tỉ lệ:</b> <span style="font-family:'Fira Code',monospace;color:#fff;">${escHtml(cleanLatexEq(ratio.T_name))} = ${ratio.T_value ?? ''}</span>
                ${ratio.T_rule ? ` ➔ ${escHtml(cleanLatexEq(ratio.T_rule))}` : ''}
            </div>
        `;
    }
    const reactions = data.reactions || [];
    const reactionsHtml = reactions.length > 0 ? `
        <div style="margin-top:8px;">
            ${reactions.map(r => `<div style="font-family:'Fira Code',monospace;font-weight:700;color:#fef08a;font-size:1.15rem;margin-bottom:4px;">🧪 ${renderFormulaHtml(cleanLatexEq(r.equation || ''))}</div>${r.note ? `<div style="font-size:0.95rem;color:#cbd5e1;">${escHtml(r.note)}</div>` : ''}`).join('')}
        </div>
    ` : (data.equation ? `<div style="font-family:'Fira Code',monospace;font-weight:700;color:#fef08a;font-size:1.15rem;margin-top:8px;">🧪 ${renderFormulaHtml(cleanLatexEq(data.equation))}</div>` : '');

    // Step 3: Pedagogy Steps
    const stepsHtml = steps.length > 0 ? `
        <div class="tv-pedagogy-steps-list" style="display:flex;flex-direction:column;gap:10px;">
            ${steps.map(s => `
                <div class="tv-pedagogy-step-card">
                    <div class="tv-step-header">
                        <span class="tv-step-badge">Bước ${s.step}</span>
                        <span class="tv-step-title">${escHtml(s.title || '')}</span>
                    </div>
                    <div class="tv-step-content">${escHtml(cleanLatexEq(s.content || ''))}</div>
                    ${s.result ? `<div class="tv-step-result">🎯 Kết quả: ${escHtml(cleanLatexEq(s.result))}</div>` : ''}
                </div>
            `).join('')}
        </div>
    ` : '';

    // Step 4: Final Answer
    const finalProductsHtml = prods.length > 0 ? `
        <div class="tv-final-products">
            ${prods.map(p => `
                <div class="tv-final-card">
                    <div class="tv-final-formula">${escHtml(p.formula || p.name || '')} ${escHtml(p.state || '')}</div>
                    <div class="tv-final-vals">
                        ${p.mol != null ? `<span>n = <b>${p.mol}</b> mol</span><br>` : ''}
                        ${p.mass_g != null ? `<span>m = <b>${p.mass_g}</b> g</span><br>` : ''}
                        ${p.volume_L_STP != null ? `<span>V(đktc) = <b>${p.volume_L_STP}</b> L</span>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    ` : '';

    // (Đã bỏ nút Mở Thí Nghiệm Ảo 3D Đa Giác Quan theo yêu cầu người dùng)

    widget.innerHTML = `
        <div class="tv-nlp-header">
            <div class="tv-nlp-title">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Lời Giải Sư Phạm Bài Toán Hóa Học (Viết Tay)</span>
            </div>
            <button class="widget-close" onclick="this.closest('.smart-widget').remove()">✕</button>
        </div>

        <div class="tv-nlp-scroll-body">
            ${problemText ? `
            <div class="tv-nlp-problem-card">
                <div class="tv-nlp-problem-label">📝 Đề bài nhận diện từ nét chữ:</div>
                <div class="tv-nlp-problem-text">"${escHtml(problemText)}"</div>
            </div>` : ''}

            <div class="tv-nlp-table-grid">
                <!-- BƯỚC 1: TÓM TẮT & QUY ĐỔI MOL -->
                <div class="tv-pedagogy-step-card" style="border-left-color:#38bdf8;">
                    <div class="tv-step-header">
                        <span class="tv-step-badge" style="background:#0284c7;">Bước 1</span>
                        <span class="tv-step-title">Tóm tắt dữ kiện &amp; Quy đổi Mol</span>
                    </div>
                    ${entChipsHtml || '<div style="color:#94a3b8;">Đã chuyển đổi số liệu về số mol tiêu chuẩn.</div>'}
                </div>

                <!-- BƯỚC 2: PHƯƠNG TRÌNH & TỈ LỆ -->
                <div class="tv-pedagogy-step-card" style="border-left-color:#eab308;">
                    <div class="tv-step-header">
                        <span class="tv-step-badge" style="background:#ca8a04;">Bước 2</span>
                        <span class="tv-step-title">Phương trình Hóa học &amp; Phân tích Tỉ lệ</span>
                    </div>
                    ${reactionsHtml}
                    ${ratioHtml}
                </div>

                <!-- BƯỚC 3: LỜI GIẢI CHI TIẾT -->
                ${steps.length > 0 ? `
                <div style="margin-top:6px;">
                    <div style="font-size:1.1rem;font-weight:700;color:#93c5fd;margin-bottom:8px;">
                        <i class="fas fa-list-ol"></i> Các bước tính toán sư phạm chi tiết:
                    </div>
                    ${stepsHtml}
                </div>` : ''}
            </div>

            <!-- BƯỚC 4: KẾT QUẢ CUỐI -->
            <div class="tv-nlp-final-box">
                <div class="tv-final-title">
                    <i class="fas fa-award"></i>
                    <span>Bước 4: Đáp số &amp; Kết luận</span>
                </div>
                ${finalProductsHtml}
                ${finalAns.excess?.formula ? `
                    <div style="color:#fef08a;font-size:1.05rem;margin-top:6px;">
                        ⚠️ Chất dư: <b>${escHtml(finalAns.excess.formula)}</b>${finalAns.excess.mol != null ? ` (dư ${finalAns.excess.mol} mol)` : ''}
                    </div>
                ` : ''}
                ${finalAns.summary ? `
                    <div class="tv-final-summary" style="margin-top:8px;">
                        📌 ${escHtml(cleanLatexEq(finalAns.summary))}
                    </div>
                ` : ''}
            </div>


        </div>
    `;

    canvasSection.appendChild(widget);
    makeWidgetDraggable(widget);



    return wid;
}

// ============================================================
//  CHEMISTRY WIDGET — v3 với Safety Banner & Đa Giác Quan
// ============================================================
function buildChemWidget(data) {
    const reactants    = data.reactants    || [];
    const products     = data.products     || [];
    const equation     = data.equation     || '';
    const note         = data.explanation  || '';
    const safety       = data.safety       || { level: 'safe', reason: '', warnings: [], theory: '', student_note: '' };
    const catalyst     = data.catalyst     || null;   // chất xúc tác
    const conditions   = data.conditions   || [];     // điều kiện phản ứng
    const molVariants  = data.mol_variants || [];     // sản phẩm theo tỉ lệ mol
    const molCalc      = data.mol_calc     || {};     // kết quả tính from mol_input
    const olfactory    = data.olfactory    || null;   // Cảm quan khứu giác
    const soundType    = data.sound_type   || 'none'; // fizz | crackle | none

    if (reactants.length === 0) {
        buildGeneralWidget({ explanation: note || 'Không nhận ra phương trình hóa học.' });
        return;
    }

    // === MODULE 3: KÍCH HOẠT FULL-SCREEN RED ALERT SHIELD NẾU NGUY HIỂM / CẤM ===
    if (safety && (safety.is_critical || safety.level === 'danger')) {
        showRedAlertShield(safety, equation);
    }

    // ── Cấu hình Safety Banner theo level ─────────────────────
    const safetyConfig = {
        danger:  {
            icon: '☠️', label: 'NGUY HIỂM — KHÔNG THỰC HIỆN',
            bg: 'linear-gradient(135deg,#7f1d1d,#991b1b)',
            border: '#ef4444', badge: '#fee2e2', badgeText: '#7f1d1d',
            pulse: true
        },
        toxic:   {
            icon: '⚠️', label: 'ĐỘC HẠI — CHỈ THỰC HIỆN TRONG TỦ HÚT',
            bg: 'linear-gradient(135deg,#581c87,#7e22ce)',
            border: '#c026d3', badge: '#fae8ff', badgeText: '#581c87',
            pulse: true
        },
        caution: {
            icon: '🔶', label: 'THẬN TRỌNG',
            bg: 'linear-gradient(135deg,#78350f,#92400e)',
            border: '#f59e0b', badge: '#fef3c7', badgeText: '#78350f',
            pulse: false
        },
        safe:    {
            icon: '✅', label: 'AN TOÀN',
            bg: 'linear-gradient(135deg,#064e3b,#065f46)',
            border: '#10b981', badge: '#d1fae5', badgeText: '#064e3b',
            pulse: false
        }
    };
    const sc = safetyConfig[safety.level] || safetyConfig.safe;
    // ── Safety Banner: chỉ một thanh mức an toàn (AN TOÀN / THẬN TRỌNG / NGUY HIỂM) ──
    // Đã bỏ phần giải thích dài (cơ chế, lý thuyết, ứng dụng...) theo yêu cầu.
    // Phản ứng nguy hiểm vẫn có cảnh báo toàn màn hình (showRedAlertShield) ở trên.
    const safetyBannerHtml = `
        <div class="safety-banner safety-collapsed ${sc.pulse ? 'safety-pulse' : ''}"
             style="background:${sc.bg};border-left:4px solid ${sc.border};">
            <div class="safety-header" style="cursor:default;">
                <span class="safety-icon">${sc.icon}</span>
                <span class="safety-label">${sc.label}</span>
            </div>
        </div>
    `;

    const wid = 'w' + Date.now();
    const widget = document.createElement('div');
    widget.className = 'smart-widget';
    widget.id = wid;

    // Banner luôn hiển thị — học sinh cần biết phản ứng AN TOÀN hay không
    const cW = canvasSection.clientWidth || window.innerWidth || 1200;
    const W = Math.min(940, cW - 40);
    const leftPos = Math.max(20, Math.round((cW - W) / 2));
    widget.style.cssText = `width:${W}px;height:auto;left:${leftPos}px;top:40px;min-height:220px;`;

    // ── Equation info bar: hiển thị phương trình + khái niệm ─────
    // Áp dụng canonicalizeEquation trước khi render
    const cleanEquation = canonicalizeEquation(equation);
    const equationBarHtml = cleanEquation ? `
        <div class="cw-equation-bar">
            <div class="cw-eq-row">
                <span class="cw-eq-icon">🧪</span>
                <span class="cw-eq-formula">${renderFormulaHtml(cleanEquation)}</span>
            </div>
        </div>
    ` : '';

    // Huy hiệu cảm quan khứu giác (Mùi khí)
    const olfactoryHtml = olfactory ? `
        <div class="cw-olfactory-badge" style="border-left: 4px solid ${olfactory.color || '#3b82f6'}; background: ${olfactory.color || '#3b82f6'}15;">
            <div class="olfactory-icon-box">${olfactory.icon || '👃'}</div>
            <div class="olfactory-content">
                <div class="olfactory-header">
                    <span class="olfactory-label" style="color:${olfactory.color || '#3b82f6'};">Cảm quan Khứu giác (Mùi khí)</span>
                    <span class="olfactory-gas-tag">${escHtml(olfactory.gas || '')}</span>
                </div>
                <p class="olfactory-desc">${escHtml(olfactory.smell || '')}</p>
            </div>
        </div>
    ` : '';

    widget.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">⚗ Phản ứng Hóa học 3D</span>
            <div style="display:flex;align-items:center;gap:8px;">
                <button class="cw-expand-btn" id="cw-expand-${wid}" title="Phóng to để xem rõ phản ứng (Esc để thu nhỏ)">
                    <i class="fas fa-expand"></i> <span>Phóng to</span>
                </button>
                <button class="cw-sound-toggle-btn ${ChemicalSoundSynthesizer.isMuted() ? 'muted' : ''}" id="cw-sound-${wid}" title="Bật/Tắt âm thanh phản ứng">
                    <span class="sound-icon">${ChemicalSoundSynthesizer.isMuted() ? '🔇' : '🔊'}</span>
                    <span class="sound-txt">${ChemicalSoundSynthesizer.isMuted() ? 'Đã tắt' : 'Âm thanh'}</span>
                </button>
                <button class="widget-close" onclick="this.closest('.smart-widget').remove()">✕</button>
            </div>
        </div>
        ${(safety && (safety.level || safety.reason || safety.summary)) ? safetyBannerHtml : ''}
        ${equationBarHtml}
        ${olfactoryHtml}
        <div class="cw-body">
            <!-- LEFT: Reactants -->
            <div class="cw-side" id="cw-left-${wid}">
                <div class="cw-side-label">⬤ Chất tham gia</div>
                <div class="cw-mols-wrap" id="cw-rmols-${wid}">
                    ${reactants.map((r, i) => {
                        const st = STATE_CFG[detectMolState(r, equation, false)];
                        return `
                        <div class="cw-mol-card">
                            <div class="cw-mol-view" id="rv${i}${wid}" data-formula="${escHtml(r)}"
                                 style="box-shadow:${st.glow};border-color:${st.border};"></div>
                            <div class="cw-mol-tag">${renderFormulaHtml(r)}</div>
                            <div class="mol-state-badge ${st.badgeCls}">${st.dot} ${st.label}</div>
                        </div>
                        ${i < reactants.length-1 ? '<span class="cw-plus">+</span>' : ''}`;
                    }).join('')}
                </div>
            </div>

            <!-- CENTER: Controls -->
            <div class="cw-mid">
                <div class="cw-big-arrow" id="cw-arrow-${wid}">
                    <span class="cw-arrow-sym">→</span>
                    ${conditions.filter(c => c !== catalyst).length > 0 ? `<div class="cw-conditions-badge">${conditions.filter(c => c !== catalyst).map(c => `<span class="cw-cond-tag">${escHtml(c)}</span>`).join('')}</div>` : ''}
                    ${catalyst ? `<div class="cw-catalyst-label" title="Chất xúc tác"><span class="cw-cat-icon">⚡</span>Xúc tác: ${escHtml(catalyst)}</div>` : `<div class="cw-catalyst-label cw-no-catalyst">Không cần xúc tác</div>`}
                </div>
                <button class="cw-play-btn" id="cw-play-${wid}">▶ Xem phản ứng</button>
                <button class="cw-replay-btn hidden" id="cw-replay-${wid}">🔄 Làm lại</button>
            </div>

            <!-- RIGHT: Products -->
            <div class="cw-side cw-products" id="cw-right-${wid}">
                <div class="cw-side-label" style="color:var(--green);">● Sản phẩm</div>
                <div class="cw-mols-wrap">
                    ${products.map((p, i) => {
                        const st = STATE_CFG[detectMolState(p, equation, true)];
                        return `
                        <div class="cw-mol-card">
                            <div class="cw-mol-view cw-prod-view" id="pv${i}${wid}" data-formula="${escHtml(p)}"
                                 style="box-shadow:${st.glow};border-color:${st.border};"></div>
                            <div class="cw-mol-tag" style="color:var(--green);">${renderFormulaHtml(p)}</div>
                            <div class="mol-state-badge ${st.badgeCls}">${st.dot} ${st.label}</div>
                        </div>
                        ${i < products.length-1 ? '<span class="cw-plus">+</span>' : ''}`;
                    }).join('')}
                </div>
            </div>

            <!-- Flash overlay -->
            <div class="cw-flash-overlay" id="cw-flash-${wid}"></div>
        </div>
        <div class="cw-footer">
            <span class="cw-eq-text">${escHtml(equation)}</span>
            <span class="cw-note-text">${escHtml(note)}</span>
            <button class="cw-quiz-cta" onclick="quizOpenModal()">
                <i class="fas fa-question-circle"></i> 🎯 Tạo bài tập trắc nghiệm về phản ứng này
            </button>
        </div>


        <!-- === THÍ NGHIỆM ẢO: thay đổi lượng chất & xúc tác (virtual_lab.js) === -->
        <div class="cw-mol-panel cw-lab-panel" id="lab-${wid}">
            <div class="cmp-header">
                <span class="cmp-icon">🎛️</span>
                <span class="cmp-title">Thí nghiệm ảo — thay đổi lượng chất &amp; xúc tác</span>
                <button class="cmp-toggle" id="lab-toggle-${wid}">Mở rộng ▼</button>
            </div>
            <div class="lab-body hidden" id="lab-body-${wid}"></div>
        </div>
    `;

    canvasSection.appendChild(widget);
    makeWidgetDraggable(widget);
    if (typeof initVirtualLab === 'function') {
        initVirtualLab(wid, { equation: cleanEquation || equation, reactants, products, catalyst, conditions });
    }

    // Gắn sự kiện tính toán bằng addEventListener trực tiếp — Không bao giờ bị lỗi nháy kép HTML
    const calcBtn = document.getElementById(`mol-calc-btn-${wid}`);
    if (calcBtn) {
        calcBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            calcMolRatio(wid, cleanEquation || equation, reactants, products, molVariants);
        });
    }

    // Hide products initially
    const rightEl = document.getElementById(`cw-right-${wid}`);
    rightEl.style.opacity = '0.12';
    rightEl.style.filter = 'blur(5px)';
    rightEl.style.transition = 'all 1.4s ease';

    // Load 3D AFTER widget is in DOM (requestAnimationFrame ensures layout is done)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            reactants.forEach((mol, i) => renderChemVisual(mol, document.getElementById(`rv${i}${wid}`)));
            products.forEach((mol, i) => renderChemVisual(mol, document.getElementById(`pv${i}${wid}`)));
        });
    });

    // Sound toggle
    const soundBtn = document.getElementById(`cw-sound-${wid}`);
    if (soundBtn) {
        soundBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            ChemicalSoundSynthesizer.init();
            const muted = ChemicalSoundSynthesizer.toggleMute();
            soundBtn.classList.toggle('muted', muted);
            soundBtn.querySelector('.sound-icon').textContent = muted ? '🔇' : '🔊';
            soundBtn.querySelector('.sound-txt').textContent = muted ? 'Đã tắt' : 'Âm thanh';
            if (!muted) {
                ChemicalSoundSynthesizer.playTestChime();
            }
            showToast(muted ? 'Đã tắt âm thanh thí nghiệm' : 'Đã bật âm thanh thí nghiệm 🔊 (thử âm thành công)', 'info');
        });
    }

    // Play
    document.getElementById(`cw-play-${wid}`).addEventListener('click', () => {
        ChemicalSoundSynthesizer.init();
        document.getElementById(`cw-play-${wid}`).classList.add('hidden');
        playChemAnim(wid, soundType);
    });

    // Replay
    document.getElementById(`cw-replay-${wid}`).addEventListener('click', () => {
        ChemicalSoundSynthesizer.stop();
        ChemicalSoundSynthesizer.init();
        const leftEl = document.getElementById(`cw-left-${wid}`);
        document.getElementById(`cw-replay-${wid}`).classList.add('hidden');
        leftEl.style.transition = 'all 0.5s ease';
        leftEl.style.transform = '';
        leftEl.style.opacity = '1';
        rightEl.style.transition = 'all 0.5s ease';
        rightEl.style.opacity = '0.12';
        rightEl.style.filter = 'blur(5px)';
        document.getElementById(`cw-arrow-${wid}`).style.transform = '';
        document.getElementById(`cw-arrow-${wid}`).style.color = '';
        document.getElementById(`cw-flash-${wid}`).style.opacity = '0';
        setTimeout(() => document.getElementById(`cw-play-${wid}`)?.classList.remove('hidden'), 500);
    });

    // Phóng to / thu nhỏ để xem rõ phản ứng — vẽ lại mô hình 3D theo kích thước mới cho nét
    const expandBtn = document.getElementById(`cw-expand-${wid}`);
    // Vẽ lại theo công thức đang gắn trên từng ô (thẻ sản phẩm có thể đã đổi do Thí nghiệm ảo)
    const rerenderVisuals = () => {
        widget.querySelectorAll('.cw-mol-view[data-formula]').forEach(v => renderChemVisual(v.dataset.formula, v));
    };
    const sizeViews = (expanded) => {
        [`cw-left-${wid}`, `cw-right-${wid}`].forEach(sideId => {
            const side = document.getElementById(sideId);
            if (!side) return;
            const views = side.querySelectorAll('.cw-mol-view');
            let size = '';
            if (expanded && views.length) {
                const bodyH = side.clientHeight;
                const sideW = side.clientWidth - 60;
                size = Math.floor(Math.min(bodyH * 0.62, (sideW - (views.length - 1) * 95) / views.length, 380)) + 'px';
            }
            views.forEach(v => { v.style.width = size; v.style.height = size; });
        });
    };
    expandBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = !widget.classList.contains('cw-expanded');
        widget.classList.toggle('cw-expanded', expanded);
        expandBtn.querySelector('i').className = expanded ? 'fas fa-compress' : 'fas fa-expand';
        expandBtn.querySelector('span').textContent = expanded ? 'Thu nhỏ' : 'Phóng to';
        expandBtn.title = expanded ? 'Thu nhỏ lại (Esc)' : 'Phóng to để xem rõ phản ứng (Esc để thu nhỏ)';
        // Chờ layout cập nhật rồi mới đo & vẽ lại
        requestAnimationFrame(() => requestAnimationFrame(() => { sizeViews(expanded); rerenderVisuals(); }));
    });

    // Cleanup on close to prevent extreme lag
    widget.querySelector('.widget-close').addEventListener('click', () => {
        ChemicalSoundSynthesizer.stop();
        if (window.stopChemAnim) {
            reactants.forEach((_, i) => stopChemAnim(`rv${i}${wid}`));
            products.forEach((_, i) => stopChemAnim(`pv${i}${wid}`));
        }
    });

    // SPEED OPT: Trả về wid để sendToAI có thể patch pedagogy sau
    return wid;
}

// Dựng lại các thẻ sản phẩm (dùng khi sản phẩm đổi theo tỉ lệ mol trong Thí nghiệm ảo)
function renderProductCards(wid, products, equation) {
    const wrap = document.querySelector(`#cw-right-${wid} .cw-mols-wrap`);
    if (!wrap) return;
    wrap.querySelectorAll('.cw-mol-view').forEach(v => { if (window.stopChemAnim) stopChemAnim(v.id); });
    // Giữ kích thước ô khi bảng đang phóng to
    const sample = document.querySelector(`#cw-left-${wid} .cw-mol-view`);
    let size = sample && sample.style.width ? `width:${sample.style.width};height:${sample.style.height};` : '';
    // Nhiều sản phẩm ở cỡ thường → thu nhỏ thẻ cho vừa, không phải cuộn ngang
    if (!size && products.length >= 3) size = 'width:108px;height:108px;';
    wrap.innerHTML = products.map((p, i) => {
        const st = STATE_CFG[detectMolState(p, equation, true)];
        return `
        <div class="cw-mol-card">
            <div class="cw-mol-view cw-prod-view" id="pv${i}${wid}" data-formula="${escHtml(p)}"
                 style="box-shadow:${st.glow};border-color:${st.border};${size}"></div>
            <div class="cw-mol-tag" style="color:var(--green);">${renderFormulaHtml(p)}</div>
            <div class="mol-state-badge ${st.badgeCls}">${st.dot} ${st.label}</div>
        </div>
        ${i < products.length - 1 ? '<span class="cw-plus">+</span>' : ''}`;
    }).join('');
    // Bảng có thể đã bị đóng trước khung hình kế tiếp → bỏ qua ô không còn tồn tại
    requestAnimationFrame(() => products.forEach((p, i) => {
        const el = document.getElementById(`pv${i}${wid}`);
        if (el) renderChemVisual(p, el);
    }));
}

function playChemAnim(wid, soundType = 'none') {
    const leftEl  = document.getElementById(`cw-left-${wid}`);
    const rightEl = document.getElementById(`cw-right-${wid}`);
    const arrowEl = document.getElementById(`cw-arrow-${wid}`);
    // Target the arrow symbol specifically (div now contains conditions badge too)
    const arrowSym = arrowEl?.querySelector('.cw-arrow-sym') || arrowEl;
    const flashEl = document.getElementById(`cw-flash-${wid}`);

    // 1. Reactants pulse slightly
    leftEl.style.transition = 'all 0.5s ease';
    leftEl.style.transform = 'scale(1.05)';
    leftEl.style.opacity = '1';

    // 2. Arrow glows (0.5s)
    setTimeout(() => {
        if (arrowSym) {
            arrowSym.style.transition = 'all 0.4s ease';
            arrowSym.style.transform = 'scale(1.5)';
            arrowSym.style.color = '#fbbf24';
            arrowSym.style.textShadow = '0 0 20px #fbbf24';
        }
        // Also glow the catalyst label if present
        const catLabel = arrowEl?.querySelector('.cw-catalyst-label');
        if (catLabel) {
            catLabel.style.transition = 'all 0.4s ease';
            catLabel.style.textShadow = '0 0 12px #fbbf24';
            catLabel.style.color = '#fbbf24';
        }
    }, 500);

    // 3. Flash + Reactants return to normal + Sound Synthesis (1.2s)
    setTimeout(() => {
        leftEl.style.transform = 'scale(1)';
        flashEl.style.transition = 'none';
        flashEl.style.opacity = '1';
        flashEl.style.animation = 'cwFlash 0.9s ease-out forwards';

        // Phối hợp âm thanh đa giác quan
        if (soundType === 'crackle') {
            ChemicalSoundSynthesizer.playCrackle(2.2);
        } else if (soundType === 'fizz') {
            ChemicalSoundSynthesizer.playFizz(2.5);
        } else {
            // Mặc định phản ứng dung dịch / trung hòa axit-bazơ / kết tủa (ví dụ HCl + NaOH)
            ChemicalSoundSynthesizer.playLiquidReaction(2.2);
        }
    }, 1200);

    // 4. Products appear (1.8s)
    setTimeout(() => {
        rightEl.style.opacity = '1';
        rightEl.style.filter = 'blur(0)';
        rightEl.style.transform = 'scale(1.04)';

        setTimeout(() => { rightEl.style.transform = ''; rightEl.style.transition = 'all 0.4s ease'; }, 400);
    }, 1800);

    // 5. Replay button (2.8s)
    setTimeout(() => {
        document.getElementById(`cw-replay-${wid}`)?.classList.remove('hidden');
    }, 2800);
}

// ============================================================
//  MOL & STOICHIOMETRY CALCULATOR — Chuẩn THPT Việt Nam
// ============================================================
const _chemCalcMode = {}; // { wid: 'mol' | 'mass' }

function setCalcMode(wid, mode) {
    _chemCalcMode[wid] = mode;
    const btnMol = document.getElementById(`mode-mol-${wid}`);
    const btnMass = document.getElementById(`mode-mass-${wid}`);
    if (btnMol && btnMass) {
        btnMol.classList.toggle('active', mode === 'mol');
        btnMass.classList.toggle('active', mode === 'mass');
    }
    const unitEls = document.querySelectorAll(`[id^="unit-"][id$="-${wid}"]`);
    unitEls.forEach(el => {
        el.textContent = mode === 'mol' ? 'mol' : 'gam';
    });
}

const ATOMIC_WEIGHTS = {
    H: 1, He: 4, Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
    Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35.5, Ar: 40,
    K: 39, Ca: 40, Sc: 45, Ti: 48, V: 51, Cr: 52, Mn: 55, Fe: 56, Co: 59,
    Ni: 58.7, Cu: 64, Zn: 65, Ga: 70, Ge: 72.6, As: 75, Se: 79, Br: 80,
    Rb: 85.5, Sr: 87.6, Ag: 108, Cd: 112.4, Sn: 118.7, Sb: 121.8, I: 127,
    Cs: 133, Ba: 137, Pt: 195, Au: 197, Hg: 200.6, Pb: 207, Bi: 209
};

function calculateAccurateMolarMass(formula) {
    if (!formula) return 0;
    let s = formula.replace(/[↓↑\s]/g, '');
    if (s.includes('·') || s.includes('.')) {
        const parts = s.split(/[·.]/);
        let total = calculateAccurateMolarMass(parts[0]);
        for (let i = 1; i < parts.length; i++) {
            const m = parts[i].match(/^(\d+)?(.*)$/);
            const factor = m[1] ? parseInt(m[1]) : 1;
            total += factor * calculateAccurateMolarMass(m[2]);
        }
        return total;
    }
    const stack = [0];
    let i = 0;
    while (i < s.length) {
        if (s[i] === '(' || s[i] === '[') {
            stack.push(0);
            i++;
        } else if (s[i] === ')' || s[i] === ']') {
            i++;
            let numStr = '';
            while (i < s.length && /\d/.test(s[i])) {
                numStr += s[i];
                i++;
            }
            const mult = numStr ? parseInt(numStr) : 1;
            const groupMass = stack.pop() * mult;
            stack[stack.length - 1] += groupMass;
        } else if (/[A-Z]/.test(s[i])) {
            let el = s[i];
            i++;
            if (i < s.length && /[a-z]/.test(s[i])) {
                el += s[i];
                i++;
            }
            let numStr = '';
            while (i < s.length && /\d/.test(s[i])) {
                numStr += s[i];
                i++;
            }
            const count = numStr ? parseInt(numStr) : 1;
            const mass = (ATOMIC_WEIGHTS[el] || 0) * count;
            stack[stack.length - 1] += mass;
        } else {
            i++;
        }
    }
    return Math.round((stack[0] || 1) * 10) / 10;
}

function isGasMolecule(formula) {
    const GASES = new Set(['H2','O2','N2','CL2','F2','CO','CO2','SO2','SO3','NO','NO2','N2O','NH3','CH4','C2H4','C2H2','C2H6','C3H8','C4H10','H2S','HCL','CLO2','O3']);
    const norm = (formula || '').toUpperCase().replace(/[↓↑()]/g, '');
    return GASES.has(norm);
}

function parseEquationTerms(equation, fallbackReactants, fallbackProducts) {
    let eq = (equation || '').replace(/[=⇌]/g, '→').replace(/-->|->/g, '→');
    if (!eq.includes('→')) {
        return {
            reactants: (fallbackReactants || []).map(r => ({ formula: r, coeff: 1, M: calculateAccurateMolarMass(r), isGas: isGasMolecule(r) })),
            products: (fallbackProducts || []).map(p => ({ formula: p, coeff: 1, M: calculateAccurateMolarMass(p), isGas: isGasMolecule(p) }))
        };
    }

    const [leftPart, rightPart] = eq.split('→');
    
    function parseSide(sideStr, fallbackArr) {
        const terms = sideStr.split('+').map(s => s.trim()).filter(Boolean);
        const parsed = [];
        terms.forEach((term, idx) => {
            let clean = term.replace(/\((?:k|r|dd|l|aq|s|g|dktc)\)/i, '').trim();
            const m = clean.match(/^(\d+)?\s*([A-Za-z0-9()\[\]·•.]+)/);
            if (m) {
                const coeff = m[1] ? parseInt(m[1]) : 1;
                const formula = m[2].replace(/[↓↑]/g, '').trim();
                parsed.push({
                    formula: formula,
                    coeff: coeff,
                    M: calculateAccurateMolarMass(formula),
                    isGas: isGasMolecule(formula)
                });
            } else if (fallbackArr && fallbackArr[idx]) {
                parsed.push({
                    formula: fallbackArr[idx],
                    coeff: 1,
                    M: calculateAccurateMolarMass(fallbackArr[idx]),
                    isGas: isGasMolecule(fallbackArr[idx])
                });
            }
        });
        return parsed.length > 0 ? parsed : (fallbackArr || []).map(f => ({ formula: f, coeff: 1, M: calculateAccurateMolarMass(f), isGas: isGasMolecule(f) }));
    }

    return {
        reactants: parseSide(leftPart, fallbackReactants),
        products: parseSide(rightPart, fallbackProducts)
    };
}

function calcMolRatio(wid, equation, reactants, products, molVariants) {
    const resultEl = document.getElementById(`mol-result-${wid}`);
    if (!resultEl) return;

    const mode = _chemCalcMode[wid] || 'mol';
    const parsedEq = parseEquationTerms(equation, reactants, products);
    let parsedReactants = parsedEq.reactants;
    let parsedProducts = parsedEq.products;

    // Đảm bảo luôn có ít nhất các chất từ danh sách reactants gốc nếu parsedEq không tìm ra
    if (!parsedReactants || parsedReactants.length === 0) {
        parsedReactants = (reactants || []).map(r => ({
            formula: r,
            coeff: 1,
            M: calculateAccurateMolarMass(r),
            isGas: isGasMolecule(r)
        }));
    }
    if (!parsedProducts || parsedProducts.length === 0) {
        parsedProducts = (products || []).map(p => ({
            formula: p,
            coeff: 1,
            M: calculateAccurateMolarMass(p),
            isGas: isGasMolecule(p)
        }));
    }

    // Thu thập dữ liệu người dùng nhập: Quét trực tiếp các input trong widget container
    const inputData = {}; // { formula: { rawVal, mol, mass } }
    let hasAnyInput = false;

    // Quét toàn bộ thẻ input field bên trong widget này
    const container = document.getElementById(`mol-inputs-${wid}`);
    if (container) {
        const inputRows = container.querySelectorAll('.mol-input-row');
        inputRows.forEach((row, idx) => {
            const labelEl = row.querySelector('.mol-input-label');
            const inp = row.querySelector('.mol-input-field');
            const formulaName = labelEl ? labelEl.textContent.trim() : (reactants[idx] || `Chất ${idx+1}`);
            const val = inp ? parseFloat(inp.value) : NaN;

            if (!isNaN(val) && val > 0) {
                hasAnyInput = true;
                const mMass = calculateAccurateMolarMass(formulaName) || 1;
                if (mode === 'mass') {
                    inputData[formulaName] = { rawVal: val, mol: val / mMass, mass: val, M: mMass };
                } else {
                    inputData[formulaName] = { rawVal: val, mol: val, mass: val * mMass, M: mMass };
                }

                // Đồng bộ ngược lại parsedReactants để khớp formula
                const matchR = parsedReactants.find(r => 
                    r.formula === formulaName || 
                    r.formula.replace(/[₀-₉]/g, '') === formulaName.replace(/[₀-₉]/g, '')
                );
                if (matchR) {
                    matchR.formula = formulaName;
                    matchR.M = mMass;
                }
            }
        });
    }

    if (!hasAnyInput) {
        resultEl.innerHTML = `<div class="mol-res-warn" style="padding:10px;background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;color:#fca5a5;">⚠️ Vui lòng nhập số mol hoặc khối lượng của ít nhất một chất tham gia!</div>`;
        return;
    }

    // Xác định số mol phản ứng theo hệ số tỉ lượng: x = n_i / a_i
    let limitingReactant = null;
    let minX = Infinity;
    const inputEntries = Object.entries(inputData);

    inputEntries.forEach(([formula, d]) => {
        const rItem = parsedReactants.find(r => r.formula === formula);
        const coeff = rItem ? rItem.coeff : 1;
        const x = d.mol / coeff;
        if (x < minX) {
            minX = x;
            limitingReactant = formula;
        }
    });

    const reactionX = minX; // Số chu kỳ phản ứng (hệ số tỉ lượng chung)

    // Nếu người dùng chỉ nhập 1 chất, giả định các chất còn lại vừa đủ theo tỉ lệ phương trình
    parsedReactants.forEach(r => {
        if (!inputData[r.formula]) {
            const neededMol = r.coeff * reactionX;
            inputData[r.formula] = {
                rawVal: mode === 'mass' ? (neededMol * r.M) : neededMol,
                mol: neededMol,
                mass: neededMol * r.M,
                isAutoEstimated: true
            };
        }
    });

    // Tính toán bảng 3 dòng: Ban đầu (BĐ), Phản ứng (PƯ), Sau phản ứng (Sau)
    const tableCols = [...parsedReactants, ...parsedProducts];
    const initialMolRow = [];
    const reactMolRow = [];
    const afterMolRow = [];
    const afterMassRow = [];
    const gasVolumeRow = [];
    let hasGas = false;

    // Reactants
    parsedReactants.forEach(r => {
        const d = inputData[r.formula] || Object.values(inputData)[0] || { mol: 0, mass: 0 };
        const initMol = d.mol || 0;
        const usedMol = (r.coeff || 1) * reactionX;
        const remainMol = Math.max(0, initMol - usedMol);
        const remainMass = remainMol * (r.M || 1);

        initialMolRow.push(initMol.toFixed(3));
        reactMolRow.push(`-${usedMol.toFixed(3)}`);
        afterMolRow.push(remainMol > 0.0001 ? `${remainMol.toFixed(3)} mol` : '0 (Hết)');
        afterMassRow.push(remainMol > 0.0001 ? `${remainMass.toFixed(2)} g` : '0 g');
        gasVolumeRow.push('—');
    });

    // Products
    let totalProdMass = 0;
    parsedProducts.forEach(p => {
        const formedMol = p.coeff * reactionX;
        const formedMass = formedMol * p.M;
        totalProdMass += formedMass;

        initialMolRow.push('0');
        reactMolRow.push(`+${formedMol.toFixed(3)}`);
        afterMolRow.push(`${formedMol.toFixed(3)} mol`);
        afterMassRow.push(`${formedMass.toFixed(2)} g`);

        if (p.isGas) {
            hasGas = true;
            const vDKC = (formedMol * 24.79).toFixed(2);
            gasVolumeRow.push(`${vDKC} L (25°C)`);
        } else {
            gasVolumeRow.push('—');
        }
    });

    // Tỉ lệ mol giữa các chất tham gia nếu nhập >= 2 chất
    let ratioHtml = '';
    if (inputEntries.length >= 2) {
        const [k1, v1] = inputEntries[0];
        const [k2, v2] = inputEntries[1];
        const ratioVal = (v1.mol / v2.mol).toFixed(2);
        ratioHtml = `<div class="mol-res-ratio">Tỉ lệ mol ban đầu: n(${escHtml(k1)}) / n(${escHtml(k2)}) = <strong>${ratioVal}</strong></div>`;
    }

    // Render HTML Bảng tính và Summary Cards
    let html = `<div class="mol-res-box">`;

    // 1. Header & Ratio
    html += `<div class="mol-res-section">
        <div class="mol-res-title">📊 Bảng Tính Lượng Chất Chuẩn (3 Dòng)</div>
        ${ratioHtml}
    </div>`;

    // 2. Bảng 3 dòng
    html += `<div class="mol-calc-table-wrap">
        <table class="mol-calc-table">
            <thead>
                <tr>
                    <th class="table-row-label">Đại lượng</th>
                    ${tableCols.map((c, i) => `
                        <th>
                            ${c.coeff > 1 ? `<strong>${c.coeff}</strong> ` : ''}${renderFormulaHtml(c.formula)}
                            <br><span style="font-size:0.62rem;opacity:0.75;">(M=${c.M})</span>
                        </th>
                    `).join('')}
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="table-row-label">1. Ban đầu (n<sub>bđ</sub>)</td>
                    ${initialMolRow.map(v => `<td>${v} mol</td>`).join('')}
                </tr>
                <tr style="color:#fbbf24;">
                    <td class="table-row-label">2. Phản ứng (n<sub>pư</sub>)</td>
                    ${reactMolRow.map(v => `<td>${v} mol</td>`).join('')}
                </tr>
                <tr style="color:#6ee7b7;font-weight:700;">
                    <td class="table-row-label">3. Sau pư (n<sub>sau</sub>)</td>
                    ${afterMolRow.map(v => `<td>${v}</td>`).join('')}
                </tr>
                <tr style="color:#93c5fd;">
                    <td class="table-row-label">4. Khối lượng (m)</td>
                    ${afterMassRow.map(v => `<td>${v}</td>`).join('')}
                </tr>
                ${hasGas ? `
                <tr style="color:#a7f3d0;">
                    <td class="table-row-label">5. Thể tích khí (V<sub>đkc</sub>)</td>
                    ${gasVolumeRow.map(v => `<td>${v}</td>`).join('')}
                </tr>` : ''}
            </tbody>
        </table>
    </div>`;

    // 3. Summary Cards
    const excessList = parsedReactants.filter(r => {
        const initMol = inputData[r.formula].mol;
        const usedMol = r.coeff * reactionX;
        return (initMol - usedMol) > 0.0001;
    });

    html += `<div class="mol-summary-cards">
        <div class="mol-summary-card">
            <div class="mol-sc-header">
                <span>🔴 Chất hết</span>
                <span class="mol-badge-limiting">Giới hạn</span>
            </div>
            <div class="mol-sc-body">
                <strong>${escHtml(limitingReactant || parsedReactants[0]?.formula)}</strong>
                <div>Phản ứng vừa hết theo hệ số phương trình.</div>
            </div>
        </div>

        ${excessList.length > 0 ? `
        <div class="mol-summary-card">
            <div class="mol-sc-header">
                <span>🟢 Chất dư</span>
                <span class="mol-badge-excess">Dư</span>
            </div>
            <div class="mol-sc-body">
                ${excessList.map(ex => {
                    const initMol = inputData[ex.formula].mol;
                    const remMol = (initMol - ex.coeff * reactionX).toFixed(3);
                    const remMass = ((initMol - ex.coeff * reactionX) * ex.M).toFixed(2);
                    return `<div><strong>${escHtml(ex.formula)}</strong>: dư <span class="mol-sc-val">${remMol} mol</span> (~${remMass} g)</div>`;
                }).join('')}
            </div>
        </div>` : `
        <div class="mol-summary-card">
            <div class="mol-sc-header">
                <span>⚖️ Tỉ lệ vừa đủ</span>
                <span class="mol-badge-prod">Chuẩn</span>
            </div>
            <div class="mol-sc-body">Các chất tham gia phản ứng vừa hết, không có chất dư.</div>
        </div>`}

        <div class="mol-summary-card accent">
            <div class="mol-sc-header">
                <span>✨ Tổng sản phẩm</span>
                <span class="mol-badge-prod">${totalProdMass.toFixed(2)} g</span>
            </div>
            <div class="mol-sc-body">
                ${parsedProducts.map(p => {
                    const mol = (p.coeff * reactionX).toFixed(3);
                    const g = (p.coeff * reactionX * p.M).toFixed(2);
                    const vStr = p.isGas ? ` | ${(p.coeff * reactionX * 24.79).toFixed(2)} L khí` : '';
                    return `<div>• ${escHtml(p.formula)}: <strong>${g} g</strong> (${mol} mol${vStr})</div>`;
                }).join('')}
            </div>
        </div>
    </div>`;

    // 4. Nếu có biến thể (mol variants)
    if (molVariants && molVariants.length > 0 && inputEntries.length >= 2) {
        html += `<div class="mol-res-section" style="margin-top:8px;">
            <div class="mol-res-title">🔬 Chú ý theo quy tắc tỉ lệ mol</div>
            <div class="mol-res-note">Hệ thống đã nhận diện phản ứng này có sản phẩm thay đổi tùy theo tỉ lệ các chất ban đầu. Xem chi tiết ở danh sách các trường hợp bên trên.</div>
        </div>`;
    }

    html += `</div>`;
    resultEl.innerHTML = html;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('✅ Đã tính toán xong bảng lượng chất!', 'success');
}

function estimateMolarMass(formula) {
    return calculateAccurateMolarMass(formula);
}









// ============================================================
//  MATH WIDGET — function plot
// ============================================================
function buildMathWidget(data) {
    const expr = (data.expression || data.core?.expression || '').replace(/\^/g, '**');
    const note = data.explanation || data.tutor?.explanation || '';

    const wid = 'w' + Date.now();
    const widget = createWidget(wid, '📈 Đồ thị Hàm số', 400, 300, 20, 20);
    widget.querySelector('.widget-body').innerHTML = `
        <div class="math-body" id="plot${wid}"></div>
        <div class="widget-info"><div class="eq-note">${escHtml(note)}</div></div>
    `;

    try {
        functionPlot({ target: `#plot${wid}`, width: 370, height: 200,
            grid: true, data: [{ fn: expr, color: '#3b82f6' }] });
    } catch(e) {
        document.getElementById(`plot${wid}`).innerHTML = `<div style="color:#ef4444;padding:14px;">Không vẽ được: ${e.message}</div>`;
    }
}

// ============================================================
//  GEOMETRY WIDGET — Three.js
// ============================================================
function buildGeoWidget(data) {
    const name = (data.name || data.core?.name || 'cube').toLowerCase();
    const note = data.explanation || data.tutor?.explanation || '';

    const wid = 'w' + Date.now();
    const widget = createWidget(wid, '🔷 Hình học 3D: ' + name, 340, 300, 20, 20);
    widget.querySelector('.widget-body').innerHTML = `
        <div id="geo${wid}" style="flex:1;background:#04080f;"></div>
        <div class="widget-info"><div class="eq-note">${escHtml(note)}</div></div>
    `;

    const container = document.getElementById(`geo${wid}`);
    const W = 400, H = 280;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
    camera.position.set(2.5, 2, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x04080f);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.DirectionalLight(0xffffff, 1).position.set(5, 5, 5) && new THREE.DirectionalLight(0xffffff, 1));
    scene.add(new THREE.AmbientLight(0x334466, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5); scene.add(dirLight);

    let geo;
    if (name.includes('sphere'))   geo = new THREE.SphereGeometry(1.4, 32, 32);
    else if (name.includes('cylinder')) geo = new THREE.CylinderGeometry(1, 1, 2.2, 32);
    else if (name.includes('cone'))  geo = new THREE.ConeGeometry(1.2, 2.4, 32);
    else if (name.includes('torus')) geo = new THREE.TorusGeometry(1.1, 0.42, 20, 100);
    else                             geo = new THREE.BoxGeometry(2, 2, 2);

    const mat = new THREE.MeshPhongMaterial({ color: 0x3b82f6, shininess: 90 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    let animId;
    function tick() { animId = requestAnimationFrame(tick); mesh.rotation.x += 0.009; mesh.rotation.y += 0.013; renderer.render(scene, camera); }
    tick();

    // Đăng ký renderer để cleanup khi Clear Board (disposeAllRenderers)
    registerRenderer(wid, renderer);

    widget.querySelector('.widget-close').addEventListener('click', () => {
        cancelAnimationFrame(animId);
        renderer.dispose();
        _threeRenderers.delete(wid); // xóa khỏi registry khi widget đóng thủ công
    });
}

// ============================================================
//  CONCEPT & GENERAL KNOWLEDGE WIDGETS
// ============================================================
function buildConceptWidget(data) {
    // Dọn bớt các widget giải thích / khái niệm cũ để tránh xếp chồng đè lên nhau
    document.querySelectorAll('.concept-widget, .general-widget').forEach(w => w.remove());

    const wid = 'w' + Date.now();
    const title = data.title || '📘 Khái Niệm Khoa Học';
    const def = data.definition || data.explanation || '';
    const classifs = data.classification || [];
    const props = data.properties || [];
    const examples = data.examples || [];
    const apps = data.applications || '';
    const safety = data.safety_note || '';

    // Vị trí: Đặt giữa màn hình canvas thay vì góc 20px
    const cWidth = canvasSection.clientWidth || 900;
    const W = Math.min(600, cWidth - 40);
    const posX = Math.max(20, Math.round((cWidth - W) / 2));
    const posY = 50;

    const widget = document.createElement('div');
    widget.className = 'smart-widget concept-widget';
    widget.id = wid;
    widget.style.cssText = `width:${W}px;height:auto;left:${posX}px;top:${posY}px;`;

    widget.innerHTML = `
        <div class="widget-header">
            <div class="widget-title">
                <span style="font-size:1.15rem;">🎓</span>
                <span>${escHtml(title)}</span>
                <span class="concept-header-badge">THPT Chuẩn</span>
            </div>
            <div class="widget-actions" style="display:flex;align-items:center;gap:8px;">
                <button class="concept-head-btn" id="cw-tts-${wid}" title="Nghe đọc giảng bài">
                    <span>🔊</span><span>Nghe</span>
                </button>
                <button class="concept-head-btn" id="cw-canvas-${wid}" title="Chèn tóm tắt vào bảng trắng">
                    <span>📝</span><span>Lưu bảng</span>
                </button>
                <button class="widget-close" onclick="this.closest('.smart-widget').remove()">✕</button>
            </div>
        </div>
        <div class="widget-body">
            <div class="concept-body-scroll">
                <!-- 1. Định nghĩa cốt lõi -->
                ${def ? `
                <div class="concept-def-card">
                    <div class="concept-def-title">
                        <span>📌</span><span>Định nghĩa cốt lõi</span>
                    </div>
                    <div class="concept-def-text">${escHtml(def)}</div>
                </div>` : ''}

                <!-- 2. Tính chất & Đặc điểm nổi bật -->
                ${props.length > 0 ? `
                <div class="concept-props-box">
                    <div class="concept-props-title">
                        <span>🔬</span><span>Tính chất & Đặc điểm nổi bật</span>
                    </div>
                    <div class="concept-props-list">
                        ${props.map(p => `
                        <div class="concept-prop-item">
                            <span class="concept-prop-bullet">✦</span>
                            <span>${escHtml(p)}</span>
                        </div>`).join('')}
                    </div>
                </div>` : ''}

                <!-- 3. Phân loại & Ví dụ minh họa -->
                ${(classifs.length > 0 || examples.length > 0) ? `
                <div class="concept-grid-2col">
                    ${classifs.length > 0 ? `
                    <div class="concept-col-card" style="border-left: 3px solid #f59e0b; background: rgba(245,158,11,0.06);">
                        <div class="concept-col-title" style="color: #fbbf24;">
                            <span>📂</span><span>Phân loại</span>
                        </div>
                        <ul class="concept-col-list">
                            ${classifs.map(c => `<li>${escHtml(c)}</li>`).join('')}
                        </ul>
                    </div>` : ''}

                    ${examples.length > 0 ? `
                    <div class="concept-col-card" style="border-left: 3px solid #10b981; background: rgba(16,185,129,0.06);">
                        <div class="concept-col-title" style="color: #34d399;">
                            <span>💡</span><span>Ví dụ minh họa</span>
                        </div>
                        <ul class="concept-col-list">
                            ${examples.map(ex => `<li><strong>${escHtml(ex)}</strong></li>`).join('')}
                        </ul>
                    </div>` : ''}
                </div>` : ''}

                <!-- 4. Ứng dụng thực tế -->
                ${apps ? `
                <div class="concept-app-card">
                    <strong style="color: #6ee7b7; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                        <span>🌍</span> Ứng dụng thực tiễn:
                    </strong>
                    <div style="color: #e2e8f0; font-size: 0.9rem;">${escHtml(apps)}</div>
                </div>` : ''}

                <!-- 5. Lưu ý an toàn & Mẹo THPT -->
                ${safety ? `
                <div class="concept-safety-card">
                    <strong style="color: #f87171; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                        <span>⚠️</span> Lưu ý an toàn & Thực hành:
                    </strong>
                    <div style="color: #fca5a5; font-size: 0.9rem;">${escHtml(safety)}</div>
                </div>` : ''}
            </div>
        </div>
    `;

    canvasSection.appendChild(widget);
    makeWidgetDraggable(widget);

    // Kích hoạt nút đọc TTS
    document.getElementById(`cw-tts-${wid}`)?.addEventListener('click', () => {
        const textToSpeak = `${title}. ${def}`;
        playTTS(textToSpeak);
        showToast('Đang phát giọng đọc khái niệm...', 'info');
    });

    // Kích hoạt nút chèn vào bảng trắng
    document.getElementById(`cw-canvas-${wid}`)?.addEventListener('click', () => {
        const noteText = `[${title}]\n• Định nghĩa: ${def}\n${examples.length ? '• Ví dụ: ' + examples.join(', ') : ''}`;
        addTextToCanvas(noteText);
        showToast('Đã chèn nội dung vào bảng trắng!', 'success');
    });
}

function buildGeneralWidget(data) {
    // Dọn bớt widget giải thích cũ nếu có
    document.querySelectorAll('.general-widget').forEach(w => w.remove());

    const title = data.title || '🧠 Phân Tích & Giải Thích';
    const text = data.explanation || data.content || data.reply || 'Không phân tích được. Hãy viết rõ hơn.';
    const wid = 'w' + Date.now();
    
    const cWidth = canvasSection.clientWidth || 900;
    const W = Math.min(520, cWidth - 40);
    const posX = Math.max(30, Math.round((cWidth - W) / 2));
    const posY = 70;

    const widget = document.createElement('div');
    widget.className = 'smart-widget general-widget';
    widget.id = wid;
    widget.style.cssText = `width:${W}px;height:auto;left:${posX}px;top:${posY}px;`;
    
    // Tự động format xuống dòng và bullet points nếu có
    const formattedHtml = escHtml(text)
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>')
        .replace(/•/g, '&bull;');

    widget.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">${escHtml(title)}</span>
            <div class="widget-actions" style="display:flex;align-items:center;gap:8px;">
                <button class="concept-head-btn" id="gw-tts-${wid}" title="Nghe đọc nội dung">
                    <span>🔊</span><span>Nghe</span>
                </button>
                <button class="widget-close" onclick="this.closest('.smart-widget').remove()">✕</button>
            </div>
        </div>
        <div class="widget-body">
            <div class="general-body" style="padding: 16px 20px; font-size: 0.95rem; line-height: 1.7; color: #f1f5f9;">
                ${formattedHtml}
            </div>
        </div>
    `;
    canvasSection.appendChild(widget);
    makeWidgetDraggable(widget);

    document.getElementById(`gw-tts-${wid}`)?.addEventListener('click', () => {
        playTTS(text);
        showToast('Đang phát giọng đọc...', 'info');
    });
}

// ============================================================
//  HELPERS
// ============================================================
function createWidget(wid, title, w, h, left, top) {
    const existingCount = document.querySelectorAll('.smart-widget').length;
    const offsetLeft = left + (existingCount * 25);
    const offsetTop = top + (existingCount * 25);
    
    const wStr = typeof w === 'number' ? w + 'px' : w;
    const hStr = typeof h === 'number' ? h + 'px' : h;

    const widget = document.createElement('div');
    widget.className = 'smart-widget';
    widget.id = wid;
    widget.style.cssText = `width:${wStr};height:${hStr};left:${offsetLeft}px;top:${offsetTop}px;`;
    widget.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">${title}</span>
            <button class="widget-close" onclick="this.closest('.smart-widget').remove()">✕</button>
        </div>
        <div class="widget-body"></div>
    `;
    canvasSection.appendChild(widget);
    makeWidgetDraggable(widget);
    return widget;
}

// Đóng widget ngay khi nhấn xuống nút ✕ (capture phase) — không để canvas/kéo thả nuốt mất sự kiện click
document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest && e.target.closest('.smart-widget .widget-close');
    if (!btn || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
}, true);

// Phím Esc: đóng widget nằm trên cùng
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const expanded = document.querySelector('.smart-widget.cw-expanded .cw-expand-btn');
    if (expanded) { expanded.click(); return; }
    const widgets = [...document.querySelectorAll('.smart-widget')];
    if (widgets.length === 0) return;
    const top = widgets.reduce((a, b) =>
        (parseInt(getComputedStyle(b).zIndex) || 0) >= (parseInt(getComputedStyle(a).zIndex) || 0) ? b : a);
    const btn = top.querySelector('.widget-close');
    if (btn) btn.click(); else top.remove();
});

function makeWidgetDraggable(widget) {
    const header = widget.querySelector('.widget-header, .tv-nlp-header');
    if (!header) return;
    let startX, startY, initialLeft, initialTop;

    function bringToFront() {
        let maxZ = 900;
        document.querySelectorAll('.smart-widget').forEach(w => {
            const z = parseInt(w.style.zIndex) || 900;
            if (z > maxZ) maxZ = z;
        });
        widget.style.zIndex = (maxZ + 5) + '';
    }

    widget.addEventListener('pointerdown', bringToFront);

    function onMove(clientX, clientY) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        widget.style.left = (initialLeft + dx) + 'px';
        widget.style.top  = (initialTop + dy) + 'px';
    }

    function onMouseMove(e) {
        onMove(e.clientX, e.clientY);
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    header.addEventListener('mousedown', e => {
        if (e.target.closest('.widget-close') || e.target.closest('button')) return;
        bringToFront();
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseInt(widget.style.left) || widget.offsetLeft || 0;
        initialTop  = parseInt(widget.style.top)  || widget.offsetTop || 0;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    // Hỗ trợ cảm ứng vuốt kéo trên màn hình Smart TV
    function onTouchMove(e) {
        if (e.touches && e.touches[0]) {
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }

    function onTouchEnd() {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    }

    header.addEventListener('touchstart', e => {
        if (e.target.closest('.widget-close') || e.target.closest('button')) return;
        bringToFront();
        if (e.touches && e.touches[0]) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            initialLeft = parseInt(widget.style.left) || widget.offsetLeft || 0;
            initialTop  = parseInt(widget.style.top)  || widget.offsetTop || 0;
            document.addEventListener('touchmove', onTouchMove, { passive: true });
            document.addEventListener('touchend', onTouchEnd);
        }
    }, { passive: true });
}

function setLoading(visible, msg = '') {
    loadingOverlay.classList.toggle('hidden', !visible);
    if (msg) loadingText.textContent = msg;
}

function showToast(msg, type = 'info') {
    // Đã tắt toàn bộ thông báo nổi theo yêu cầu (chỉ ghi ra console để debug)
    console.log(`[toast:${type}] ${msg}`);
    return;
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:${type==='error'?'#ef4444':type==='warn'?'#f59e0b':'#3b82f6'};
        color:white;padding:12px 24px;border-radius:12px;font-weight:600;
        z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:'Inter',sans-serif;
        animation:pop-in 0.3s ease;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
//  FLOATING MENU (FAB) LOGIC
//  Dragging & viewport clamping are managed by page_manager.js (Req #1)
// ============================================================
const floatingMenu = document.getElementById('floating-menu');
const floatingMainBtn = document.getElementById('floating-main-btn');

// Wiring FAB actions — menu chỉ mở/đóng khi bấm nút (+), chọn chức năng con không tự thu menu lại

// Xóa các nét/chữ nằm trong vùng đang khoanh (dùng cho nút Tẩy khi có vùng chọn)
function eraseLassoRegion() {
    if (lastLassoCrop) {
        const scaleX = canvas.width / canvasEl.clientWidth;
        const scaleY = canvas.height / canvasEl.clientHeight;
        const x = lastLassoCrop.x * scaleX;
        const y = lastLassoCrop.y * scaleY;
        const w = lastLassoCrop.w * scaleX;
        const h = lastLassoCrop.h * scaleY;
        
        const objects = canvas.getObjects();
        const toRemove = [];
        let changed = false;
        objects.forEach(obj => {
            const bound = obj.getBoundingRect();
            const intersectLeft = Math.max(bound.left, x);
            const intersectRight = Math.min(bound.left + bound.width, x + w);
            const intersectTop = Math.max(bound.top, y);
            const intersectBottom = Math.min(bound.top + bound.height, y + h);

            if (intersectLeft < intersectRight && intersectTop < intersectBottom) {
                if (obj.type === 'textbox' || obj.type === 'text') {
                    const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
                    const objArea = bound.width * bound.height;
                    if (intersectArea / objArea > 0.8) {
                        toRemove.push(obj);
                        changed = true;
                    } else {
                        const indices = getIntersectingCharIndices(obj, intersectLeft, intersectRight, intersectTop, intersectBottom);
                        if (indices.length > 0) {
                            let newText = "";
                            for (let i = 0; i < obj.text.length; i++) {
                                if (!indices.includes(i)) newText += obj.text[i];
                            }
                            if (newText.trim() === "") {
                                toRemove.push(obj);
                            } else {
                                obj.set('text', newText);
                                obj.styles = {}; // reset styles
                            }
                            changed = true;
                        }
                    }
                } else {
                    toRemove.push(obj);
                    changed = true;
                }
            }
        });
        
        if (changed) {
            toRemove.forEach(obj => canvas.remove(obj));
            canvas.renderAll();
            if (typeof saveState === 'function') saveState();
        }
        clearLasso();
    }
}

document.getElementById('fab-analyze').addEventListener('click', () => {
    if (lastLassoCrop) {
        sendToAI(lastLassoCrop.dataURL, 'auto_analyze');
        clearLasso();
    } else {
        captureAndAnalyze();
    }
});

document.getElementById('fab-tts').addEventListener('click', () => {
    if (lastLassoCrop) {
        const scaleX = canvas.width / canvasEl.clientWidth;
        const scaleY = canvas.height / canvasEl.clientHeight;
        const x = lastLassoCrop.x * scaleX;
        const y = lastLassoCrop.y * scaleY;
        const w = lastLassoCrop.w * scaleX;
        const h = lastLassoCrop.h * scaleY;
        
        const objects = canvas.getObjects();
        let textToRead = "";
        
        objects.forEach(obj => {
            const bound = obj.getBoundingRect();
            if (bound.left < x + w && bound.left + bound.width > x &&
                bound.top < y + h && bound.top + bound.height > y) {
                
                if (obj.type === 'textbox' || obj.type === 'text') {
                    textToRead += obj.text + ". ";
                }
            }
        });
        
        if (textToRead.trim()) {
            window.speechSynthesis.cancel();
            if (window._currentTTSAudio) {
                window._currentTTSAudio.pause();
            }
            
            const text = textToRead.trim();
            const url = `/api/tts?text=${encodeURIComponent(text)}`;
            const audioEl = document.getElementById('tts-player');
            
            audioEl.onended = null;
            audioEl.onerror = null;
            audioEl.src = url;
            
            audioEl.onerror = (e) => {
                console.error("Audio block/error: ", e);
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'vi-VN';
                window.speechSynthesis.speak(utterance);
            };
            
            audioEl.play().catch(err => {
                console.error("Play prevented: ", err);
                showToast('Không thể tự động phát! Trình duyệt của bạn đang chặn Autoplay.', 'warn');
            });
            
            showToast('Đang tạo giọng đọc AI...', 'info');
        } else {
            showToast('Không tìm thấy chữ (text) nào trong vùng chọn!', 'warn');
        }
        
        clearLasso();
    } else {
        showToast('Vui lòng khoanh vùng văn bản trước!', 'warn');
    }
});

function triggerBeautifyText() {
    if (lastLassoCrop) {
        window._pendingBeautifyCrop = { ...lastLassoCrop };
        sendToAI(lastLassoCrop.dataURL, 'beautify_text');
        clearLasso();
    } else {
        if (canvas.getObjects().length === 0) {
            showToast('Bảng đang trống!', 'warn');
            return;
        }
        const dataURL = cropCanvas(0, 0, canvasEl.clientWidth, canvasEl.clientHeight);
        window._pendingBeautifyCrop = { 
            x: 0, y: 0, 
            w: canvasEl.clientWidth, 
            h: canvasEl.clientHeight 
        };
        sendToAI(dataURL, 'beautify_text');
    }
}

document.getElementById('fab-beautify').addEventListener('click', triggerBeautifyText);

// ============================================================
//  VOICE TO TEXT (Microphone Popup UI)
// ============================================================
const btnMic = document.getElementById('btn-mic');
const vrPopup = document.getElementById('voice-recorder-popup');
const vrTime = document.getElementById('vr-time');
const vrBtnDelete = document.getElementById('vr-btn-delete');
const vrBtnSend = document.getElementById('vr-btn-send');
const vrBtnAi = document.getElementById('vr-btn-ai');

let recognition;
let isRecording = false;
let vrTimerInterval;
let vrSeconds = 0;
let currentTranscript = "";
let silenceTimer = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN'; // Vietnamese
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        isRecording = true;
        btnMic.classList.add('mic-recording');
        vrPopup.classList.remove('hidden');
        currentTranscript = "";
        window._currentInterim = "";
        vrSeconds = 0;
        updateVrTime();
        
        vrTimerInterval = setInterval(() => {
            vrSeconds++;
            updateVrTime();
        }, 1000);
        
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (isRecording) recognition.stop();
        }, 4000); // 4 seconds initial wait if no speech at all
    };

    recognition.onresult = (event) => {
        let finalTrans = "";
        let interimTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTrans += event.results[i][0].transcript + " ";
            } else {
                interimTrans += event.results[i][0].transcript;
            }
        }
        if (finalTrans) {
            currentTranscript += finalTrans;
        }
        window._currentInterim = interimTrans;
        
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (isRecording) recognition.stop();
        }, 1500); // 1.5 seconds of silence stops recording
    };

    recognition.onerror = (event) => {
        showToast('Lỗi micro: ' + event.error, 'error');
        stopVr();
    };

    recognition.onend = () => {
        if (isRecording) {
            const fullText = (currentTranscript + " " + (window._currentInterim || "")).trim();
            if (fullText) {
                // Auto-send to AI on silence — dùng hàm chung sendVoiceToAI()
                sendVoiceToAI(fullText);
            }
            currentTranscript = "";
            window._currentInterim = "";
            stopVr();
        }
    };

    btnMic.addEventListener('click', () => {
        if (!isRecording) {
            try {
                recognition.start();
            } catch (e) {}
        }
    });
    
    vrBtnDelete.addEventListener('click', () => {
        currentTranscript = "";
        window._currentInterim = "";
        stopVr();
    });
    
    vrBtnSend.addEventListener('click', () => {
        const fullText = (currentTranscript + " " + (window._currentInterim || "")).trim();
        if (fullText) {
            addTextToCanvas(fullText);
            showToast('Đã thêm chữ vào bảng!', 'success');
        } else {
            showToast('Chưa nghe được gì (Có thể do bạn nói quá nhỏ hoặc trình duyệt chặn Mic)!', 'warn');
        }
        currentTranscript = "";
        window._currentInterim = "";
        stopVr();
    });

    if (vrBtnAi) {
        vrBtnAi.addEventListener('click', () => {
            const fullText = (currentTranscript + " " + (window._currentInterim || "")).trim();
            if (fullText) {
                sendVoiceToAI(fullText);
            } else {
                showToast('Chưa nghe được gì để hỏi AI!', 'warn');
            }
            currentTranscript = "";
            window._currentInterim = "";
            stopVr();
        });
    }

} else {
    btnMic.addEventListener('click', () => {
        showToast('Trình duyệt của bạn không hỗ trợ nhận diện giọng nói.', 'error');
    });
}

function updateVrTime() {
    const m = Math.floor(vrSeconds / 60).toString().padStart(2, '0');
    const s = (vrSeconds % 60).toString().padStart(2, '0');
    vrTime.textContent = `${m}:${s}`;
}

function stopVr() {
    isRecording = false;
    btnMic.classList.remove('mic-recording');
    vrPopup.classList.add('hidden');
    clearInterval(vrTimerInterval);
    clearTimeout(silenceTimer);
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }
}

function addTextToCanvas(text) {
    const maxWidth = Math.min(500, canvasEl.clientWidth * 0.8);
    const textFill = (typeof currentColor !== 'undefined' && currentColor && currentColor !== '#0a1628')
        ? currentColor
        : '#ffffff';

    const textObj = new fabric.Textbox(text, {
        left: canvasEl.clientWidth / 2,
        top: canvasEl.clientHeight / 2,
        originX: 'center',
        originY: 'center',
        fill: textFill,
        fontSize: 32,
        fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
        width: maxWidth,
        textAlign: 'center',
        selectable: true,
        evented: true,
        padding: 14,
        hasControls: true,
        hasBorders: true,
        borderColor: '#3b82f6',
        borderScaleFactor: 2,
        cornerColor: '#3b82f6',
        cornerSize: 10,
        cornerStyle: 'circle',
        transparentCorners: false,
        hoverCursor: 'move',
        moveCursor: 'move'
    });
    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    canvas.renderAll();
    saveState();
}

// ============================================================
//  QUIZ MODULE — Chế độ Quiz/Trắc nghiệm AI
// ============================================================

// ---- State ----
const quizState = {
    questions: [],
    topic: '',
    currentIdx: 0,
    answers: {},      // { qId: selectedOption }
    numQuestions: 5,
    answered: false,
};

// ---- DOM refs ----
const quizModal          = document.getElementById('quiz-modal');
const quizBackdrop       = document.getElementById('quiz-backdrop');
const quizSetupScreen    = document.getElementById('quiz-setup-screen');
const quizLoadingScreen  = document.getElementById('quiz-loading-screen');
const quizQuestionScreen = document.getElementById('quiz-question-screen');
const quizResultScreen   = document.getElementById('quiz-result-screen');
const quizLoadingLog     = document.getElementById('quiz-loading-log');

const quizTopicBadge     = document.getElementById('quiz-topic-badge');
const quizProgressFill   = document.getElementById('quiz-progress-fill');
const quizCounter        = document.getElementById('quiz-counter');
const quizCard           = document.getElementById('quiz-card');
const quizQuestionNum    = document.getElementById('quiz-question-num');
const quizQuestionText   = document.getElementById('quiz-question-text');
const quizOptionsEl      = document.getElementById('quiz-options');
const quizExplanation    = document.getElementById('quiz-explanation');
const quizExplanationTxt = document.getElementById('quiz-explanation-text');
const quizNextBtn        = document.getElementById('quiz-next-btn');
const quizFinishBtn      = document.getElementById('quiz-finish-btn');
const quizScoreNum       = document.getElementById('quiz-score-num');
const quizScoreTotal     = document.getElementById('quiz-score-total');
const quizScoreLabel     = document.getElementById('quiz-score-label');
const quizScoreCircle    = document.getElementById('quiz-score-circle');
const quizReview         = document.getElementById('quiz-review');

// ---- Helpers ----
function quizShowScreen(screenId) {
    [quizSetupScreen, quizLoadingScreen, quizQuestionScreen, quizResultScreen]
        .forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// Thông báo ngay trong cửa sổ Quiz (thông báo nổi đã tắt nên lỗi phải hiện tại đây)
function quizSetupMessage(msg) {
    const el = document.getElementById('quiz-setup-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

// Quiz chỉ tạo từ PHẦN ĐÃ KHOANH VÙNG: trả về lý do chưa tạo được, hoặc '' nếu sẵn sàng
function quizBlockReason() {
    if (!lastLassoCrop) {
        return '⭕ Hãy dùng nút Khoanh vùng (trong nút tròn) để khoanh phần nội dung cần tạo Quiz, rồi bấm Tạo Quiz.';
    }
    if (typeof getObjectsInLasso === 'function' && getObjectsInLasso(lastLassoCrop).length === 0) {
        return '✏️ Vùng khoanh đang trống — hãy khoanh đúng phần có phương trình hoặc nội dung hóa học.';
    }
    return '';
}

function quizOpenModal() {
    quizModal.classList.remove('hidden');
    quizShowScreen('quiz-setup-screen');
    const reason = quizBlockReason();
    document.getElementById('quiz-start-btn').disabled = !!reason;
    quizSetupMessage(reason);
}

function quizCloseModal() {
    quizModal.classList.add('hidden');
}

// ---- Num selector ----
document.querySelectorAll('.quiz-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quiz-num-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        quizState.numQuestions = parseInt(btn.dataset.num);
    });
});

// ---- FAB Buttons: Quiz & NLP ----
const fabQuiz = document.getElementById('fab-quiz');
if (fabQuiz) {
    fabQuiz.addEventListener('click', () => {
        quizOpenModal();
    });
}

const fabNlp = document.getElementById('fab-nlp');
if (fabNlp) {
    fabNlp.addEventListener('click', () => {
        nlpOpenModal();
    });
}

// ---- Start Quiz ----
document.getElementById('quiz-start-btn').addEventListener('click', () => {
    if (quizBlockReason()) { quizOpenModal(); return; }
    quizSetupMessage('');
    quizShowScreen('quiz-loading-screen');
    quizLoadingLog.textContent = '';
    quizState.answers = {};
    quizState.currentIdx = 0;
    quizState.answered = false;
    startQuizGeneration();
});

// ---- Close / Exit / Retry ----
document.getElementById('quiz-close-btn').addEventListener('click', quizCloseModal);
document.getElementById('quiz-exit-btn').addEventListener('click', quizCloseModal);
document.getElementById('quiz-backdrop').addEventListener('click', quizCloseModal);

document.getElementById('quiz-retry-btn').addEventListener('click', () => {
    quizState.answers = {};
    quizState.currentIdx = 0;
    quizState.answered = false;
    renderQuizQuestion();
    quizShowScreen('quiz-question-screen');
});

// ---- Navigation buttons ----
document.getElementById('quiz-next-btn').addEventListener('click', () => {
    quizState.currentIdx++;
    quizState.answered = false;
    renderQuizQuestion();
});

document.getElementById('quiz-finish-btn').addEventListener('click', () => {
    showQuizResult();
});

// ---- WebSocket: Generate Quiz ----
// Map category code → label hiển thị
const QUIZ_CATEGORY_LABELS = {
    'nhận_biết':      { label: '🔬 Nhận biết chất',   color: '#3b82f6' },
    'nhận_biết_chất': { label: '🔬 Nhận biết chất',   color: '#3b82f6' },
    'loại_phản_ứng': { label: '⚗️ Loại phản ứng',    color: '#8b5cf6' },
    'sản_phẩm':      { label: '🧪 Sản phẩm & Hiện tượng', color: '#0891b2' },
    'cân_bằng':      { label: '⚖️ Cân bằng phương trình', color: '#d97706' },
    'ứng_dụng':      { label: '🏭 Ứng dụng thực tế',  color: '#059669' },
    'an_toàn':       { label: '⚠️ An toàn thí nghiệm', color: '#dc2626' },
};

function startQuizGeneration() {
    // Chỉ gửi ảnh PHẦN ĐÃ KHOANH VÙNG (không dùng toàn bộ bảng)
    if (!lastLassoCrop || !lastLassoCrop.dataURL) { quizOpenModal(); return; }
    const imageData = lastLassoCrop.dataURL;

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/analyze`);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            action: 'quiz_generate',
            image: imageData,
            num_questions: quizState.numQuestions,
        }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'log') {
            quizLoadingLog.textContent = msg.message;
            return;
        }

        if (msg.type === 'result_quiz') {
            quizState.questions = msg.questions || [];
            quizState.topic = msg.topic || 'Trắc nghiệm';
            ws.close();

            if (quizState.questions.length === 0) {
                quizShowScreen('quiz-setup-screen');
                quizSetupMessage('⚠️ AI không tìm thấy nội dung hóa học rõ ràng trên bảng để tạo câu hỏi. Hãy viết rõ phương trình hoặc khoanh vùng nội dung rồi thử lại.');
                return;
            }

            // Start quiz
            renderQuizQuestion();
            quizShowScreen('quiz-question-screen');
            return;
        }

        if (msg.type === 'error') {
            ws.close();
            quizShowScreen('quiz-setup-screen');
            quizSetupMessage('⚠️ ' + (msg.message || 'Lỗi khi tạo Quiz, hãy thử lại.'));
        }
    };

    ws.onerror = () => {
        quizShowScreen('quiz-setup-screen');
        quizSetupMessage('⚠️ Không kết nối được tới server. Kiểm tra server đang chạy rồi thử lại.');
    };
}

// ---- Render Question ----
function renderQuizQuestion() {
    const q = quizState.questions[quizState.currentIdx];
    if (!q) return;

    const total = quizState.questions.length;
    const idx   = quizState.currentIdx;

    // Header
    quizTopicBadge.textContent  = '⚗️ ' + quizState.topic;
    quizCounter.textContent     = `Câu ${idx + 1} / ${total}`;
    quizProgressFill.style.width = `${((idx + 1) / total) * 100}%`;

    // Card content — re-trigger animation
    quizCard.style.animation = 'none';
    requestAnimationFrame(() => { quizCard.style.animation = ''; });

    // Category badge
    const catKey = (q.category || '').toLowerCase();
    const catInfo = QUIZ_CATEGORY_LABELS[catKey] || { label: '📝 Câu hỏi', color: '#6366f1' };
    let catBadge = quizCard.querySelector('.quiz-category-badge');
    if (!catBadge) {
        catBadge = document.createElement('div');
        catBadge.className = 'quiz-category-badge';
        quizQuestionNum.parentNode.insertBefore(catBadge, quizQuestionNum);
    }
    catBadge.textContent = catInfo.label;
    catBadge.style.cssText = `
        display:inline-block; font-size:11px; font-weight:700; letter-spacing:.5px;
        padding:3px 10px; border-radius:20px; margin-bottom:8px;
        background:${catInfo.color}22; color:${catInfo.color}; border:1px solid ${catInfo.color}44;
    `;

    quizQuestionNum.textContent  = `CÂU ${idx + 1}`;
    quizQuestionText.textContent = q.question;

    // Options
    quizOptionsEl.innerHTML = '';
    const optionKeys = ['A', 'B', 'C', 'D'];
    optionKeys.forEach(key => {
        if (!q.options[key]) return;
        const btn = document.createElement('button');
        btn.className = 'quiz-option';
        btn.dataset.key = key;
        btn.innerHTML = `<span class="quiz-option-key">${key}</span><span>${q.options[key]}</span>`;
        btn.addEventListener('click', () => selectAnswer(q, key));
        quizOptionsEl.appendChild(btn);
    });

    // Hide explanation
    quizExplanation.classList.add('hidden');
    quizExplanationTxt.textContent = '';

    // Nav buttons
    quizNextBtn.classList.add('hidden');
    quizFinishBtn.classList.add('hidden');

    // Restore previous answer if retry
    const prevAnswer = quizState.answers[q.id];
    if (prevAnswer !== undefined) {
        applyAnswerHighlight(q, prevAnswer);
        showExplanation(q.explanation);
        showNavButtons();
    }
}

// ---- Select Answer ----
function selectAnswer(q, chosenKey) {
    if (quizState.answers[q.id] !== undefined) return; // already answered

    quizState.answers[q.id] = chosenKey;
    applyAnswerHighlight(q, chosenKey);
    showExplanation(q.explanation);
    showNavButtons();
}

function applyAnswerHighlight(q, chosenKey) {
    const correctKey = (q.answer || '').toUpperCase();
    const optionBtns = quizOptionsEl.querySelectorAll('.quiz-option');

    optionBtns.forEach(btn => {
        btn.disabled = true;
        const k = btn.dataset.key;
        if (k === correctKey) {
            btn.classList.add('correct');
        } else if (k === chosenKey && k !== correctKey) {
            btn.classList.add('wrong');
        }
    });
}

function showExplanation(text) {
    quizExplanationTxt.textContent = text || '';
    quizExplanation.classList.remove('hidden');
}

function showNavButtons() {
    const isLast = quizState.currentIdx === quizState.questions.length - 1;
    if (isLast) {
        quizFinishBtn.classList.remove('hidden');
        quizNextBtn.classList.add('hidden');
    } else {
        quizNextBtn.classList.remove('hidden');
        quizFinishBtn.classList.add('hidden');
    }
}

// ---- Result Screen ----
function showQuizResult() {
    const questions = quizState.questions;
    const answers   = quizState.answers;
    const total     = questions.length;
    let correct     = 0;

    questions.forEach(q => {
        const chosen  = (answers[q.id] || '').toUpperCase();
        const rightKey = (q.answer || '').toUpperCase();
        if (chosen === rightKey) correct++;
    });

    // Score circle — update conic gradient
    const pct = total > 0 ? (correct / total) * 100 : 0;
    quizScoreCircle.style.background =
        `conic-gradient(#10b981 ${pct}%, rgba(255,255,255,0.05) ${pct}%)`;

    quizScoreNum.textContent   = correct;
    quizScoreTotal.textContent = `/${total}`;

    // Label
    const ratio = correct / total;
    let label = '';
    if (ratio >= 0.9)      label = 'Xuất sắc! 🏆';
    else if (ratio >= 0.7) label = 'Giỏi! 🌟';
    else if (ratio >= 0.5) label = 'Khá tốt! 👍';
    else                   label = 'Cần cố gắng thêm! 💪';
    quizScoreLabel.textContent = label;

    // Review list
    quizReview.innerHTML = '';
    questions.forEach((q, i) => {
        const chosen   = (answers[q.id] || '?').toUpperCase();
        const rightKey = (q.answer || '').toUpperCase();
        const isRight  = chosen === rightKey;
        const catKey   = (q.category || '').toLowerCase();
        const catInfo  = QUIZ_CATEGORY_LABELS[catKey] || { label: '📝', color: '#6366f1' };

        const item = document.createElement('div');
        item.className = `quiz-review-item ${isRight ? 'review-correct' : 'review-wrong'}`;
        item.innerHTML = `
            <div class="quiz-review-icon">${isRight ? '✅' : '❌'}</div>
            <div class="quiz-review-content">
                <div style="font-size:10px;color:${catInfo.color};font-weight:700;margin-bottom:4px;">${catInfo.label}</div>
                <div class="quiz-review-q"><strong>Câu ${i + 1}:</strong> ${q.question}</div>
                <div class="quiz-review-ans">
                    ${!isRight ? `<span class="your-ans">Bạn chọn: ${chosen} — ${q.options[chosen] || '?'}</span>` : ''}
                    <span class="correct-ans">✔ Đáp án: ${rightKey} — ${q.options[rightKey] || ''}</span>
                </div>
                ${q.explanation ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">💡 ${q.explanation}</div>` : ''}
            </div>
        `;
        quizReview.appendChild(item);
    });

    quizShowScreen('quiz-result-screen');
}

// ---- Top App Bar Actions (Luôn hiển thị trên cùng màn hình) ----
const btnTopQuiz = document.getElementById('btn-top-quiz');
if (btnTopQuiz) {
    btnTopQuiz.addEventListener('click', () => quizOpenModal());
}

const btnTopBeautify = document.getElementById('btn-top-beautify');
if (btnTopBeautify) {
    btnTopBeautify.addEventListener('click', triggerBeautifyText);
}

const btnTopAnalyze = document.getElementById('btn-top-analyze');
if (btnTopAnalyze) {
    btnTopAnalyze.addEventListener('click', () => {
        if (lastLassoCrop) {
            sendToAI(lastLassoCrop.dataURL, 'auto_analyze');
            clearLasso();
        } else {
            captureAndAnalyze();
        }
    });
}

const btnTopNlp = document.getElementById('btn-top-nlp');
if (btnTopNlp) {
    btnTopNlp.addEventListener('click', () => nlpOpenModal());
}

// ---- Top App Bar Toggle (Thu gọn / Mở rộng thanh đỉnh) ----
const topBar = document.getElementById('top-app-bar');
const topBarToggle = document.getElementById('top-bar-toggle');
if (topBarToggle && topBar) {
    topBarToggle.addEventListener('click', () => {
        topBar.classList.toggle('collapsed');
    });
}

// ---- SMART TV FULLSCREEN HANDLER ----
function toggleFullscreen() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!isFull) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
            docEl.requestFullscreen().catch(err => console.log('Fullscreen error:', err));
        } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
        } else if (docEl.msRequestFullscreen) {
            docEl.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.log('Exit fullscreen error:', err));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function updateFullscreenUI() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    const btnTopFs = document.getElementById('btn-top-fullscreen');
    const btnSideFs = document.getElementById('btn-fullscreen-sidebar');
    const txtTopFs = document.getElementById('txt-top-fullscreen');

    if (btnTopFs) {
        const icon = btnTopFs.querySelector('i');
        if (icon) {
            icon.className = isFull ? 'fas fa-compress' : 'fas fa-expand';
        }
        if (txtTopFs) {
            txtTopFs.textContent = isFull ? 'Thu nhỏ' : 'Toàn màn hình';
        }
        btnTopFs.classList.toggle('active', isFull);
    }

    if (btnSideFs) {
        const icon = btnSideFs.querySelector('i');
        if (icon) {
            icon.className = isFull ? 'fas fa-compress' : 'fas fa-expand';
        }
        btnSideFs.classList.toggle('active', isFull);
    }

    if (typeof showToast === 'function') {
        showToast(isFull ? '🖥️ Chế độ Toàn màn hình Smart TV đã bật' : 'Chế độ cửa sổ thông thường', 'info');
    }
}

document.addEventListener('fullscreenchange', updateFullscreenUI);
document.addEventListener('webkitfullscreenchange', updateFullscreenUI);
document.addEventListener('msfullscreenchange', updateFullscreenUI);

const btnTopFullscreen = document.getElementById('btn-top-fullscreen');
if (btnTopFullscreen) {
    btnTopFullscreen.addEventListener('click', toggleFullscreen);
}

const btnSidebarFullscreen = document.getElementById('btn-fullscreen-sidebar');
if (btnSidebarFullscreen) {
    btnSidebarFullscreen.addEventListener('click', toggleFullscreen);
}

// ============================================================
//  NLP CHEMISTRY MODULE
// ============================================================
const NLP_EXAMPLES = [
    "Hoa tan 4.48 lit khi CO2 (dktc) vao 300ml dung dich NaOH 1M. Tinh khoi luong cac muoi tao thanh.",
    "Cho 5.6 gam sat tac dung voi dung dich HNO3 loang du. Tinh the tich khi NO thoat ra (dktc).",
    "Phan huy 3.4 gam H2O2 voi xuc tac MnO2. Tinh the tich khi O2 thu duoc (dktc).",
    "Tong hop NH3 tu 14 gam N2 va 4 gam H2 (xuc tac Fe, 450C, hieu suat 25%). Tinh khoi luong NH3."
];

let _nlpCurrentResult = null;
let _nlpWs = null;
let nlpRecognition = null;
let isNlpRecording = false;
let nlpSilenceTimer = null;

function nlpOpenModal() {
    document.getElementById('nlp-modal').classList.remove('hidden');
    nlpShowScreen('nlp-input-screen');
    setTimeout(() => document.getElementById('nlp-text-input')?.focus(), 100);
}
function nlpCloseModal() {
    stopNlpVoiceInput();
    document.getElementById('nlp-modal').classList.add('hidden');
    if (_nlpWs && _nlpWs.readyState <= 1) _nlpWs.close();
    _nlpWs = null;
}
function nlpGoBack() { nlpShowScreen('nlp-input-screen'); }
function nlpShowScreen(id) {
    ['nlp-input-screen','nlp-loading-screen','nlp-result-screen'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.toggle('hidden', s !== id);
    });
}
function nlpFillExample(idx) {
    const ta = document.getElementById('nlp-text-input');
    if (ta) { ta.value = NLP_EXAMPLES[idx] || ''; ta.focus(); }
}

// ── GIỌNG NÓI: Nhận diện giọng nói giáo viên đọc đề bài vào ô nhập ──
function toggleNlpVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Trình duyệt của bạn không hỗ trợ nhận diện giọng nói (Web Speech API).', 'warn');
        return;
    }

    if (isNlpRecording) {
        stopNlpVoiceInput();
    } else {
        startNlpVoiceInput();
    }
}

function startNlpVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
        nlpRecognition = new SpeechRecognition();
        nlpRecognition.lang = 'vi-VN';
        nlpRecognition.continuous = true;
        nlpRecognition.interimResults = true;

        const ta = document.getElementById('nlp-text-input');
        const micBtn = document.getElementById('nlp-mic-btn');
        const innerMicBtn = document.getElementById('nlp-textarea-mic-btn');
        const statusBox = document.getElementById('nlp-voice-status');
        const statusText = document.getElementById('nlp-voice-status-text');
        const micBtnText = document.getElementById('nlp-mic-btn-text');

        let initialVal = ta ? ta.value.trim() : '';
        let recognizedText = "";

        nlpRecognition.onstart = () => {
            isNlpRecording = true;
            micBtn?.classList.add('recording');
            innerMicBtn?.classList.add('recording');
            statusBox?.classList.remove('hidden');
            if (micBtnText) micBtnText.textContent = 'Đang nghe... (Bấm để dừng)';
            if (statusText) statusText.textContent = '🔴 Đang lắng nghe giáo viên nói... Hãy đọc câu hỏi hoặc đề bài!';
            showToast('Micro đang bật! Hãy đọc đề bài hoặc câu hỏi...', 'info');

            clearTimeout(nlpSilenceTimer);
            nlpSilenceTimer = setTimeout(() => {
                if (isNlpRecording && !recognizedText) {
                    stopNlpVoiceInput();
                }
            }, 6000);
        };

        nlpRecognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    recognizedText += event.results[i][0].transcript + ' ';
                } else {
                    interim += event.results[i][0].transcript;
                }
            }

            if (ta) {
                const combined = (initialVal ? initialVal + ' ' : '') + recognizedText + interim;
                ta.value = combined;
                ta.scrollTop = ta.scrollHeight;
            }

            clearTimeout(nlpSilenceTimer);
            nlpSilenceTimer = setTimeout(() => {
                if (isNlpRecording) {
                    stopNlpVoiceInput();
                }
            }, 2000); // 2s yên lặng tự động dừng
        };

        nlpRecognition.onerror = (event) => {
            console.warn('[NLP Voice Error]:', event.error);
            if (event.error !== 'no-speech') {
                showToast('Lỗi micro: ' + event.error, 'error');
            }
            stopNlpVoiceInput();
        };

        nlpRecognition.onend = () => {
            stopNlpVoiceInput();
        };

        nlpRecognition.start();
    } catch (e) {
        console.error('[NLP Voice Start Error]:', e);
        showToast('Không thể kích hoạt micro: ' + e.message, 'error');
        stopNlpVoiceInput();
    }
}

function stopNlpVoiceInput() {
    isNlpRecording = false;
    clearTimeout(nlpSilenceTimer);
    try {
        if (nlpRecognition) {
            nlpRecognition.stop();
            nlpRecognition = null;
        }
    } catch (e) {}

    const micBtn = document.getElementById('nlp-mic-btn');
    const innerMicBtn = document.getElementById('nlp-textarea-mic-btn');
    const statusBox = document.getElementById('nlp-voice-status');
    const micBtnText = document.getElementById('nlp-mic-btn-text');

    micBtn?.classList.remove('recording');
    innerMicBtn?.classList.remove('recording');
    statusBox?.classList.add('hidden');
    if (micBtnText) micBtnText.textContent = 'Đọc bằng giọng nói (Mic)';

    const ta = document.getElementById('nlp-text-input');
    if (ta && ta.value.trim()) {
        showToast('Đã ghi nhận nội dung bằng giọng nói! Bấm "Phân tích và Giải" để xử lý.', 'success');
    }
}

function nlpSpeakTextPreview() {
    const text = document.getElementById('nlp-text-input')?.value?.trim();
    if (!text) {
        showToast('Chưa có nội dung để đọc!', 'warn');
        return;
    }
    playTTS(text);
    showToast('Đang phát giọng đọc...', 'info');
}
function nlpSubmitText() {
    const text = document.getElementById('nlp-text-input')?.value?.trim();
    if (!text) { showToast('Vui lòng nhập mô tả bài toán!', 'warn'); return; }
    nlpShowScreen('nlp-loading-screen');
    const logEl = document.getElementById('nlp-loading-log');
    if (logEl) logEl.textContent = 'Bóc tách thực thể hóa học...';
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/analyze`);
    _nlpWs = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action: 'text_chemistry', text }));
    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'log') { if (logEl) logEl.textContent = data.message || ''; return; }
        ws.close(); _nlpWs = null;
        if (data.type === 'result_nlp_chemistry') {
            nlpRenderResult(data);
        } else if (data.type === 'error') {
            nlpShowScreen('nlp-input-screen');
            showToast(data.message || 'Lỗi phân tích!', 'error');
        } else {
            nlpShowScreen('nlp-input-screen');
            showToast('Lỗi không xác định. Thử lại.', 'error');
        }
    };
    ws.onerror = (err) => {
        console.error('[NLP WS Error]:', err);
        _nlpWs = null;
        nlpShowScreen('nlp-input-screen');
        showToast('Lỗi kết nối server!', 'error');
    };
}
function nlpRenderResult(data) {
    _nlpCurrentResult = data;
    nlpShowScreen('nlp-result-screen');
    const entList = document.getElementById('nlp-entities-list');
    const entities = data.entities || [];
    if (entities.length > 0) {
        entList.innerHTML = entities.map(e => `<div class="nlp-ent-card"><span class="nlp-ent-formula">${escHtml(e.formula||e.name||'?')}</span><span class="nlp-ent-name">${escHtml(e.name||'')}</span>${e.amount!=null?`<span class="nlp-ent-amount">${e.amount} ${escHtml(e.unit||'')}</span>`:''} ${e.mol!=null?`<span class="nlp-ent-mol">= ${e.mol} mol</span>`:''} ${e.molar_mass?`<span class="nlp-ent-M">M=${e.molar_mass}</span>`:''}<span class="nlp-ent-role ${e.role==='reactant'?'role-reactant':'role-other'}">${e.role==='reactant'?'Chat TG':(e.role||'')}</span></div>`).join('');
        document.getElementById('nlp-entities-wrap')?.classList.remove('hidden');
    } else {
        document.getElementById('nlp-entities-wrap')?.classList.add('hidden');
    }
    const ratio = data.ratio_analysis || {};
    let ratioHtml = ratio.T_name ? `<div class="nlp-ratio-box"><span class="nlp-ratio-badge">Ti le mol</span><span class="nlp-ratio-formula">${escHtml(ratio.T_name)} = ${ratio.T_value??''}</span><span class="nlp-ratio-rule">${escHtml(ratio.T_rule||'')}</span></div>` : '';
    const steps = data.steps || [];
    document.getElementById('nlp-steps-wrap').innerHTML = steps.length > 0 ? `<div class="nlp-steps-title">Loi giai tung buoc</div>${ratioHtml}${steps.map(s=>`<div class="nlp-step"><div class="nlp-step-header"><span class="nlp-step-num">Buoc ${s.step}</span><span class="nlp-step-title">${escHtml(s.title||'')}</span></div><div class="nlp-step-content">${escHtml(s.content||'')}</div>${s.result?`<div class="nlp-step-result">${escHtml(s.result)}</div>`:''}</div>`).join('')}` : ratioHtml;
    const reactions = data.reactions || [];
    const reactionHtml = reactions.length > 0 ? `<div class="nlp-reactions"><div class="nlp-react-title">Phuong trinh xay ra</div>${reactions.map(r=>`<div class="nlp-react-eq">${escHtml(r.equation||'')}</div>${r.note?`<div class="nlp-react-note">${escHtml(r.note)}</div>`:''}`).join('')}</div>` : '';
    const ans = data.final_answer || {};
    const prods = ans.products || [];
    document.getElementById('nlp-answer-wrap').innerHTML = `<div class="nlp-answer-box"><div class="nlp-ans-title">Ket qua</div>${reactionHtml}${prods.length>0?`<div class="nlp-products-grid">${prods.map(p=>`<div class="nlp-product-card"><div class="nlp-prod-formula">${escHtml(p.formula||p.name||'?')} ${escHtml(p.state||'')}</div><div class="nlp-prod-name">${escHtml(p.name||'')}</div><div class="nlp-prod-values">${p.mol!=null?`<span class="nlp-val-tag">n=${p.mol} mol</span>`:''}${p.mass_g!=null?`<span class="nlp-val-tag">m=${p.mass_g} g</span>`:''}${p.volume_L_STP!=null?`<span class="nlp-val-tag">V=${p.volume_L_STP} L(dktc)</span>`:''}</div></div>`).join('')}</div>`:''} ${ans.excess?.formula?`<div class="nlp-excess-note">Chat du: <strong>${escHtml(ans.excess.formula)}</strong>${ans.excess.mol!=null?` (du ${ans.excess.mol} mol)`:''}</div>`:''} ${ans.summary?`<div class="nlp-summary">${escHtml(ans.summary)}</div>`:''}</div>`;
}
function nlpShowOnBoard() {
    if (!_nlpCurrentResult) return;
    nlpCloseModal();
    buildNlpProblemWidget(_nlpCurrentResult);
    showToast('Bảng lời giải sư phạm đã hiển thị lên bảng!', 'success');
}
document.getElementById('nlp-backdrop')?.addEventListener('click', nlpCloseModal);
document.getElementById('nlp-close-input')?.addEventListener('click', nlpCloseModal);
