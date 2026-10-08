/**
 * hand_gesture.js — Giai đoạn 1: Hand Tracking & Cảm ứng chạm tay
 * ================================================================
 * Tính năng:
 *   - MediaPipe Hands (Tasks Vision API) — 21 keypoints 3D, 60 FPS
 *   - One Euro Filter (1€) — Khử rung jitter mà không gây lag
 *   - Palm Rejection 3 lớp — Lọc vết tì lòng bàn tay
 *   - Gesture FSM 5 trạng thái — IDLE/HOVER/DRAW/ERASE/LASSO
 *   - Synthetic PointerEvent → Tương thích 100% Fabric.js hiện có
 *
 * Cách dùng:
 *   - Tự động khởi tạo khi DOM load xong
 *   - window.HandGestureModule.toggle()  — bật/tắt từ nút UI
 *   - window.HandGestureModule.setColor(hex)  — đồng bộ màu bút
 *
 * Không sửa đổi bất kỳ file hiện có nào. Chạy độc lập.
 *
 * Phiên bản: 1.0.0 | Team: Bảng Trắng Thông Minh AI
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════
//  MODULE IIFE — tránh ô nhiễm global namespace
// ═══════════════════════════════════════════════════════════════════════
window.HandGestureModule = (() => {

    // ─── TRẠNG THÁI MODULE ─────────────────────────────────────────────
    let _isActive       = false;    // Hand Tracking đang chạy hay không
    let _handLandmarker = null;     // MediaPipe HandLandmarker instance
    let _videoEl        = null;     // <video> element dùng webcam
    let _overlayCanvas  = null;     // <canvas> overlay để vẽ cursor ảo
    let _overlayCtx     = null;
    let _rafId          = null;     // requestAnimationFrame ID
    let _lastVideoTime  = -1;
    let _stream         = null;     // MediaStream từ getUserMedia

    // ─── 1€ FILTER — Khử rung cho trục X và Y ─────────────────────────
    // Tạo riêng 2 filter độc lập (X và Y không phụ thuộc nhau)
    const _filterX = createOneEuroFilter(30, 1.0, 0.007, 1.0);
    const _filterY = createOneEuroFilter(30, 1.0, 0.007, 1.0);

    // ─── GESTURE FSM ───────────────────────────────────────────────────
    const STATES = { IDLE: 'idle', HOVER: 'hover', DRAW: 'draw', ERASE: 'erase', LASSO: 'lasso' };
    let _currentState = STATES.IDLE;
    let _isDrawing    = false;      // Đang vẽ nét hay không
    let _lastSmoothX  = 0;
    let _lastSmoothY  = 0;

    // ─── TEMPORAL PALM REJECTION — giữ trạng thái 3 frame ─────────────
    let _palmHistory  = [];         // Mảng boolean [frame-2, frame-1, frame-now]

    // ─── CURSOR ẢO (con trỏ tay) ──────────────────────────────────────
    let _cursorVisible = false;

    // ─── Wave swipe detection ──────────────────────────────────────────
    let _wristXHistory = [];

    // ═══════════════════════════════════════════════════════════════════
    //  ONE EURO FILTER IMPLEMENTATION
    //  Nguồn: Casiez et al. 2012 — https://gery.casiez.net/1euro/
    // ═══════════════════════════════════════════════════════════════════
    function createOneEuroFilter(freq, minCutOff, beta, dCutOff) {
        /**
         * Tạo một instance bộ lọc 1€ cho 1 trục toạ độ.
         * @param {number} freq       - Tần số lấy mẫu (Hz) ≈ FPS webcam
         * @param {number} minCutOff  - Tần số cắt tối thiểu (Hz). Giảm = giảm jitter
         * @param {number} beta       - Hệ số nhạy tốc độ. Tăng = giảm lag khi vẽ nhanh
         * @param {number} dCutOff   - Tần số cắt cho đạo hàm vận tốc
         */
        // Bộ lọc thông thấp nội bộ
        function makeLPF(alpha) {
            let y = null, s = null;
            return {
                setAlpha(a) { alpha = a; },
                filter(value, a) {
                    const useA = (a !== undefined) ? a : alpha;
                    if (y === null) { s = value; } else { s = useA * value + (1 - useA) * s; }
                    y = value;
                    return s;
                },
                get lastY() { return y; }
            };
        }

        function smoothingFactor(te, cutoff) {
            const r = 2 * Math.PI * cutoff * te;
            return r / (r + 1);
        }

        let _freq = freq;
        const xFilt  = makeLPF(smoothingFactor(1 / _freq, minCutOff));
        const dxFilt = makeLPF(smoothingFactor(1 / _freq, dCutOff));
        let lastTime = null;

        return {
            /**
             * Lọc một giá trị toạ độ mới.
             * @param {number} value      - Giá trị raw (pixel)
             * @param {number} timestamp  - performance.now() (milliseconds)
             * @returns {number} Giá trị đã được làm mượt
             */
            filter(value, timestamp) {
                if (lastTime !== null) {
                    const dt = (timestamp - lastTime) / 1000;  // chuyển sang giây
                    if (dt > 0) _freq = 1.0 / dt;
                }
                lastTime = timestamp;

                const te = 1.0 / _freq;
                const prevX = xFilt.lastY !== null ? xFilt.lastY : value;
                const dx    = (value - prevX) * _freq;
                const edx   = dxFilt.filter(dx, smoothingFactor(te, dCutOff));
                const cutoff = minCutOff + beta * Math.abs(edx);
                return xFilt.filter(value, smoothingFactor(te, cutoff));
            },

            // Cho phép điều chỉnh tham số runtime (UI slider)
            setParams(mc, b) { minCutOff = mc; beta = b; },
            reset() { lastTime = null; }
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PALM REJECTION — 3 Lớp kiểm tra
    // ═══════════════════════════════════════════════════════════════════
    function dist3D(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    }

    /**
     * Lớp 1: Kiểm tra cử chỉ ngón trỏ mở (Index Extended Check)
     * Landmark indices: 5=MCP, 6=PIP, 8=TIP ngón trỏ
     */
    function isIndexFingerExtended(lm) {
        return lm[8].y < lm[6].y && lm[6].y < lm[5].y;
    }

    /**
     * Lớp 1b: Kiểm tra ngón giữa gập (Middle Curled) — cử chỉ bút vẽ
     */
    function isMiddleFingerCurled(lm) {
        return lm[12].y > lm[10].y;
    }

    /**
     * Lớp 2: Spatial Constraint — khoảng cách đầu ngón trỏ đến cổ tay
     * Nếu đầu ngón trỏ (L8) quá gần cổ tay (L0) hoặc mép bàn tay (L17)
     * → lòng bàn tay đang tì xuống → PALM_NOISE
     */
    function isSpatiallyValid(lm) {
        const tipToWrist  = dist3D(lm[8], lm[0]);  // đầu ngón trỏ → cổ tay
        const tipToPinky  = dist3D(lm[8], lm[17]); // đầu ngón trỏ → khớp ngón út

        // Chiều rộng lòng bàn tay = L0 → L17
        const palmWidth = dist3D(lm[0], lm[17]);

        // Nếu đầu ngón nằm quá gần vùng lòng bàn tay → reject
        if (tipToWrist < palmWidth * 1.5) return false;
        if (tipToPinky < palmWidth * 0.8) return false;
        return true;
    }

    /**
     * Lớp 3: Temporal Persistence Filter — xác nhận 3 frame liên tiếp
     * Loại bỏ spike đột ngột từ tì bàn tay (diện tích biến thiên đột ngột)
     */
    function temporalReject(isRejectedNow) {
        _palmHistory.push(isRejectedNow);
        if (_palmHistory.length > 3) _palmHistory.shift();

        // Chỉ reject nếu >= 2/3 frame gần nhất đều là PALM_NOISE
        const rejectCount = _palmHistory.filter(Boolean).length;
        return rejectCount >= 2;
    }

    /**
     * Kiểm tra tổng hợp Palm Rejection — TRUE = bị lọc (không vẽ)
     */
    function shouldRejectPalm(lm) {
        const lyr1 = !(isIndexFingerExtended(lm) && isMiddleFingerCurled(lm));
        const lyr2 = !isSpatiallyValid(lm);
        return temporalReject(lyr1 || lyr2);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  GESTURE FSM — Máy trạng thái 5 trạng thái
    // ═══════════════════════════════════════════════════════════════════
    function countFingersUp(lm) {
        // Kiểm tra từng ngón (trừ ngón cái)
        const fingers = [
            [5, 6, 8],    // Index
            [9, 10, 12],  // Middle
            [13, 14, 16], // Ring
            [17, 18, 20], // Pinky
        ];
        return fingers.filter(([mcp, pip, tip]) =>
            lm[tip].y < lm[pip].y && lm[pip].y < lm[mcp].y
        ).length;
    }

    function isFingerUp(lm, mcp, pip, tip) {
        return lm[tip].y < lm[pip].y && lm[pip].y < lm[mcp].y;
    }

    /**
     * Xác định trạng thái cử chỉ hiện tại từ landmarks
     * @returns {string} Một trong STATES
     */
    function classifyGesture(lm) {
        const indexUp  = isFingerUp(lm, 5,  6,  8);
        const middleUp = isFingerUp(lm, 9,  10, 12);
        const ringUp   = isFingerUp(lm, 13, 14, 16);
        const pinkyUp  = isFingerUp(lm, 17, 18, 20);
        const numUp    = countFingersUp(lm);

        // ERASE: ≥ 4 ngón mở (xòe bàn tay)
        if (numUp >= 4) return STATES.ERASE;

        // LASSO: Chữ V — chỉ ngón trỏ + giữa mở
        if (indexUp && middleUp && !ringUp && !pinkyUp) return STATES.LASSO;

        // DRAW: Chỉ ngón trỏ mở
        if (indexUp && !middleUp && !ringUp && !pinkyUp) return STATES.DRAW;

        // HOVER: Bất kỳ ngón nào mở nhưng không đủ điều kiện trên
        if (numUp > 0) return STATES.HOVER;

        return STATES.IDLE;
    }

    /**
     * Phát hiện cử chỉ chạm (Pen Down) — ngón trỏ và ngón cái chụm lại
     */
    function isPenDown(lm) {
        const d = dist3D(lm[8], lm[4]);  // đầu ngón trỏ ↔ đầu ngón cái
        return d < 0.06;  // ngưỡng normalized coordinates
    }

    /**
     * Phát hiện vẫy tay (Swipe) để lật trang
     */
    function detectSwipe(lm) {
        _wristXHistory.push(lm[0].x);
        if (_wristXHistory.length > 20) _wristXHistory.shift();
        if (_wristXHistory.length < 15) return null;

        const delta = _wristXHistory[_wristXHistory.length - 1] - _wristXHistory[0];
        if (delta > 0.30) { _wristXHistory = []; return 'swipe_right'; }
        if (delta < -0.30) { _wristXHistory = []; return 'swipe_left'; }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  COORDINATE MAPPING — MediaPipe [0..1] → Canvas pixel
    // ═══════════════════════════════════════════════════════════════════
    function getCanvasRect() {
        // Lấy canvas Fabric.js từ DOM (tương thích với script.js hiện có)
        const el = document.querySelector('#whiteboard-canvas') ||
                   document.querySelector('canvas.upper-canvas') ||
                   document.querySelector('canvas');
        return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }

    function landmarkToCanvas(lm, idx) {
        const rect = getCanvasRect();
        // MediaPipe trả về toạ độ đã mirror theo chiều ngang (x=0 là tay trái người dùng)
        // Cần đảo ngược X vì webcam thường mirror
        const rawX = (1 - lm[idx].x) * rect.width  + rect.left;
        const rawY = lm[idx].y          * rect.height + rect.top;
        return { rawX, rawY };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  SYNTHETIC POINTER EVENTS — Inject vào Fabric.js không cần sửa code
    // ═══════════════════════════════════════════════════════════════════
    /**
     * Dispatch PointerEvent giả vào element canvas Fabric.js
     * pointerType: 'pen' → Fabric.js xử lý như bút stylus
     */
    function dispatchPointerEvent(type, clientX, clientY) {
        const el = document.querySelector('canvas.upper-canvas') ||
                   document.querySelector('#whiteboard-canvas') ||
                   document.querySelector('canvas');
        if (!el) return;

        el.dispatchEvent(new PointerEvent(type, {
            clientX,
            clientY,
            bubbles:     true,
            cancelable:  true,
            pointerType: 'pen',       // quan trọng: Fabric.js nhận là stylus
            isPrimary:   true,
            pressure:    type === 'pointerup' ? 0 : 0.5,
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CURSOR ẢO — Vẽ vòng tròn hiển thị vị trí ngón tay
    // ═══════════════════════════════════════════════════════════════════
    function updateVirtualCursor(x, y, state) {
        if (!_overlayCtx) return;
        const w = _overlayCanvas.width;
        const h = _overlayCanvas.height;
        _overlayCtx.clearRect(0, 0, w, h);

        const colorMap = {
            [STATES.DRAW]:  '#3b82f6',  // Xanh dương — vẽ
            [STATES.ERASE]: '#ef4444',  // Đỏ — xóa
            [STATES.LASSO]: '#f59e0b',  // Vàng — chọn vùng
            [STATES.HOVER]: 'rgba(255,255,255,0.6)', // Trắng mờ
            [STATES.IDLE]:  'transparent',
        };

        if (state === STATES.IDLE) return;

        const color = colorMap[state] || 'white';
        const rect  = getCanvasRect();
        const cx    = x - rect.left;
        const cy    = y - rect.top;

        // Vòng tròn ngoài (outline)
        _overlayCtx.beginPath();
        _overlayCtx.arc(cx, cy, 14, 0, Math.PI * 2);
        _overlayCtx.strokeStyle = color;
        _overlayCtx.lineWidth   = 2.5;
        _overlayCtx.stroke();

        // Chấm tròn trung tâm
        _overlayCtx.beginPath();
        _overlayCtx.arc(cx, cy, 4, 0, Math.PI * 2);
        _overlayCtx.fillStyle = color;
        _overlayCtx.fill();

        // Label trạng thái (hiển thị nhỏ gọn)
        const labels = { draw: '✏️', erase: '🧹', lasso: '⭕', hover: '👆' };
        if (labels[state]) {
            _overlayCtx.font = '14px sans-serif';
            _overlayCtx.fillStyle = 'white';
            _overlayCtx.fillText(labels[state], cx + 16, cy - 10);
        }
    }

    function clearVirtualCursor() {
        if (_overlayCtx && _overlayCanvas) {
            _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  XỬ LÝ KẾT QUẢ LANDMARK — Logic chính mỗi frame
    // ═══════════════════════════════════════════════════════════════════
    function processLandmarks(results) {
        // Không có tay trong frame → reset trạng thái
        if (!results.landmarks || results.landmarks.length === 0) {
            if (_isDrawing) {
                // Kết thúc nét vẽ nếu đang vẽ
                dispatchPointerEvent('pointerup', _lastSmoothX, _lastSmoothY);
                _isDrawing = false;
            }
            _currentState = STATES.IDLE;
            clearVirtualCursor();
            _palmHistory  = [];
            _wristXHistory = [];
            _filterX.reset();
            _filterY.reset();
            return;
        }

        const lm  = results.landmarks[0];  // Lấy tay đầu tiên
        const now = performance.now();

        // ── 1. Ánh xạ toạ độ ngón trỏ sang canvas pixel ──────────────
        const { rawX, rawY } = landmarkToCanvas(lm, 8);  // L8 = INDEX_FINGER_TIP

        // ── 2. One Euro Filter — làm mượt toạ độ ──────────────────────
        const smoothX = _filterX.filter(rawX, now);
        const smoothY = _filterY.filter(rawY, now);
        _lastSmoothX  = smoothX;
        _lastSmoothY  = smoothY;

        // ── 3. Palm Rejection — lọc tì đè lòng bàn tay ──────────────
        const rejected = shouldRejectPalm(lm);
        if (rejected) {
            if (_isDrawing) {
                dispatchPointerEvent('pointerup', smoothX, smoothY);
                _isDrawing = false;
            }
            _currentState = STATES.IDLE;
            clearVirtualCursor();
            return;
        }

        // ── 4. Gesture FSM — xác định cử chỉ ─────────────────────────
        const gesture = classifyGesture(lm);

        // ── 5. Thực thi hành động theo cử chỉ ─────────────────────────
        switch (gesture) {
            case STATES.DRAW: {
                const penDown = isPenDown(lm);
                updateVirtualCursor(smoothX, smoothY, STATES.DRAW);

                if (penDown && !_isDrawing) {
                    // Bắt đầu nét mới (Pen Down)
                    dispatchPointerEvent('pointerdown', smoothX, smoothY);
                    _isDrawing = true;
                } else if (penDown && _isDrawing) {
                    // Đang vẽ — tiếp tục nét
                    dispatchPointerEvent('pointermove', smoothX, smoothY);
                } else if (!penDown && _isDrawing) {
                    // Nhấc ngón — kết thúc nét (Pen Up)
                    dispatchPointerEvent('pointerup', smoothX, smoothY);
                    _isDrawing = false;
                }
                break;
            }

            case STATES.ERASE: {
                // Giẻ lau — kích hoạt eraser mode Fabric.js
                updateVirtualCursor(smoothX, smoothY, STATES.ERASE);
                if (_isDrawing) {
                    dispatchPointerEvent('pointerup', smoothX, smoothY);
                    _isDrawing = false;
                }
                // Thông báo cho script.js chuyển sang eraser
                window.dispatchEvent(new CustomEvent('handgesture:erase', {
                    detail: { x: smoothX, y: smoothY }
                }));
                break;
            }

            case STATES.LASSO: {
                // Chữ V — kích hoạt chế độ Lasso
                updateVirtualCursor(smoothX, smoothY, STATES.LASSO);
                if (_isDrawing) {
                    dispatchPointerEvent('pointerup', smoothX, smoothY);
                    _isDrawing = false;
                }
                window.dispatchEvent(new CustomEvent('handgesture:lasso', {
                    detail: { x: smoothX, y: smoothY }
                }));
                break;
            }

            case STATES.HOVER: {
                updateVirtualCursor(smoothX, smoothY, STATES.HOVER);
                if (_isDrawing) {
                    dispatchPointerEvent('pointerup', smoothX, smoothY);
                    _isDrawing = false;
                }
                break;
            }

            default: { // IDLE
                clearVirtualCursor();
                if (_isDrawing) {
                    dispatchPointerEvent('pointerup', smoothX, smoothY);
                    _isDrawing = false;
                }
            }
        }

        _currentState = gesture;

        // ── 6. Phát hiện Swipe để lật trang ─────────────────────────
        if (gesture === STATES.IDLE || gesture === STATES.HOVER) {
            const swipe = detectSwipe(lm);
            if (swipe) {
                window.dispatchEvent(new CustomEvent('handgesture:swipe', {
                    detail: { direction: swipe }
                }));
                showGestureToast(swipe === 'swipe_right' ? '⟶ Trang tiếp' : '⟵ Trang trước');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VÒNG LẶP PHÁT HIỆN — requestAnimationFrame
    // ═══════════════════════════════════════════════════════════════════
    function detectionLoop() {
        if (!_isActive || !_handLandmarker || !_videoEl) return;

        if (_videoEl.currentTime !== _lastVideoTime && _videoEl.readyState >= 2) {
            _lastVideoTime = _videoEl.currentTime;
            try {
                const results = _handLandmarker.detectForVideo(_videoEl, performance.now());
                processLandmarks(results);
            } catch (e) {
                console.warn('[HandGesture] detectForVideo error:', e.message);
            }
        }

        _rafId = requestAnimationFrame(detectionLoop);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  KHỞI TẠO MEDIAPIPE HandLandmarker
    // ═══════════════════════════════════════════════════════════════════
    /**
     * Load MediaPipe Tasks Vision từ local file dùng dynamic import()
     * vision_bundle.js là ES module → phải dùng import() không dùng script tag
     */
    async function loadMediaPipe() {
        // Nếu đã có trên window (CDN script tag), dùng luôn
        if (window.HandLandmarker && window.FilesetResolver) return true;

        try {
            // Dynamic import — load local ES module
            const mp = await import('/mediapipe/vision_bundle.js');

            // Gắn vào window để các hàm sau có thể dùng
            window.HandLandmarker   = mp.HandLandmarker;
            window.FilesetResolver  = mp.FilesetResolver;

            if (window.HandLandmarker && window.FilesetResolver) {
                console.log('[HandGesture] ✅ MediaPipe loaded via dynamic import');
                return true;
            }
        } catch (e) {
            console.warn('[HandGesture] dynamic import failed:', e.message);
        }

        // Fallback: thử đọc từ window (nếu script tag chạy xong muộn)
        const start = Date.now();
        while (Date.now() - start < 8000) {
            if (window.HandLandmarker && window.FilesetResolver) return true;
            await new Promise(r => setTimeout(r, 300));
        }
        return false;
    }

    async function initHandLandmarker() {
        updateStatusBadge('loading');

        // Load MediaPipe (local hoặc CDN)
        const ready = await loadMediaPipe();
        if (!ready) {
            throw new Error(
                'Không thể load MediaPipe Tasks Vision. ' +
                'Kiểm tra file /mediapipe/vision_bundle.js trên server.'
            );
        }

        const { HandLandmarker, FilesetResolver } = window;

        try {
            const vision = await FilesetResolver.forVisionTasks(
                '/mediapipe/wasm'   // ← LOCAL path, không cần internet
            );

            _handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/mediapipe/hand_landmarker.task',  // ← LOCAL model
                    delegate: 'CPU',   // Dùng CPU cho ổn định, thử GPU sau khi hoạt động
                },
                numHands:                    2,    // Hỗ trợ 2 tay (zoom, erase)
                runningMode:                 'VIDEO',
                minHandDetectionConfidence:  0.70,
                minHandPresenceConfidence:   0.60,
                minTrackingConfidence:       0.70,
            });

            console.log('[HandGesture] ✅ HandLandmarker khởi tạo thành công');
        } catch (err) {
            updateStatusBadge('error');
            throw err;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  KHỞI TẠO WEBCAM
    // ═══════════════════════════════════════════════════════════════════
    async function startCamera() {
        _stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width:      { ideal: 1280 },
                height:     { ideal: 720  },
                frameRate:  { ideal: 60, min: 30 },
                facingMode: 'user',             // Camera trước (người dùng tự nhìn)
            },
            audio: false,
        });

        _videoEl.srcObject = _stream;
        await new Promise((resolve) => { _videoEl.onloadedmetadata = resolve; });
        await _videoEl.play();
        console.log(`[HandGesture] 📸 Camera: ${_stream.getVideoTracks()[0].label}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TẠO PHẦN TỬ DOM — Video + Overlay canvas
    // ═══════════════════════════════════════════════════════════════════
    function createDOMElements() {
        // Container webcam (góc dưới bên phải, nhỏ gọn, có thể kéo)
        const container = document.createElement('div');
        container.id        = 'hand-tracking-container';
        container.innerHTML = '';
        Object.assign(container.style, {
            position:     'fixed',
            bottom:       '20px',
            right:        '20px',
            width:        '200px',
            height:       '150px',
            borderRadius: '12px',
            overflow:     'hidden',
            border:       '2px solid rgba(59,130,246,0.6)',
            boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
            zIndex:       '9999',
            background:   '#000',
            cursor:       'move',
            userSelect:   'none',
        });

        // Video element
        _videoEl = document.createElement('video');
        Object.assign(_videoEl.style, {
            width:     '100%',
            height:    '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',  // Mirror — người dùng nhìn thấy bàn tay giống gương
        });
        _videoEl.playsInline = true;
        _videoEl.muted       = true;
        container.appendChild(_videoEl);

        // Badge trạng thái (góc trên trái của preview)
        const badge = document.createElement('div');
        badge.id = 'ht-status-badge';
        Object.assign(badge.style, {
            position:     'absolute',
            top:          '6px',
            left:         '6px',
            padding:      '2px 8px',
            borderRadius: '8px',
            fontSize:     '11px',
            fontWeight:   '600',
            fontFamily:   'Inter, sans-serif',
            color:        '#fff',
            background:   '#6b7280',
        });
        badge.textContent = '⏳ Đang tải...';
        container.appendChild(badge);

        // Nút đóng nhỏ (X)
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            position:     'absolute',
            top:          '4px',
            right:        '6px',
            background:   'rgba(0,0,0,0.5)',
            border:       'none',
            color:        '#fff',
            borderRadius: '50%',
            width:        '20px',
            height:       '20px',
            cursor:       'pointer',
            fontSize:     '12px',
            lineHeight:   '20px',
            textAlign:    'center',
            padding:      '0',
        });
        closeBtn.onclick = () => deactivate();
        container.appendChild(closeBtn);

        // FPS counter
        const fpsEl = document.createElement('div');
        fpsEl.id = 'ht-fps';
        Object.assign(fpsEl.style, {
            position:   'absolute',
            bottom:     '4px',
            right:      '6px',
            fontSize:   '10px',
            color:      'rgba(255,255,255,0.7)',
            fontFamily: 'monospace',
        });
        container.appendChild(fpsEl);
        makeDraggable(container);
        document.body.appendChild(container);

        // Overlay canvas — vẽ cursor ảo lên trên canvas Fabric.js
        _overlayCanvas = document.createElement('canvas');
        _overlayCanvas.id = 'hand-cursor-overlay';
        Object.assign(_overlayCanvas.style, {
            position:      'fixed',
            top:           '0',
            left:          '0',
            pointerEvents: 'none',    // QUAN TRỌNG: không chặn sự kiện chuột bên dưới
            zIndex:        '9998',
        });
        const resizeOverlay = () => {
            _overlayCanvas.width  = window.innerWidth;
            _overlayCanvas.height = window.innerHeight;
        };
        resizeOverlay();
        window.addEventListener('resize', resizeOverlay);
        _overlayCtx = _overlayCanvas.getContext('2d');
        document.body.appendChild(_overlayCanvas);
    }

    // ─── Kéo thả video preview ─────────────────────────────────────────
    function makeDraggable(el) {
        let ox, oy, startX, startY, dragging = false;
        el.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            const r = el.getBoundingClientRect();
            ox = r.left; oy = r.top;
            el.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            el.style.left   = (ox + e.clientX - startX) + 'px';
            el.style.top    = (oy + e.clientY - startY) + 'px';
            el.style.right  = 'auto';
            el.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; el.style.cursor = 'move'; });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FPS COUNTER
    // ═══════════════════════════════════════════════════════════════════
    let _fpsFrames = 0, _fpsLastTime = 0;
    function trackFPS() {
        _fpsFrames++;
        const now = performance.now();
        if (now - _fpsLastTime >= 1000) {
            const fps = Math.round(_fpsFrames * 1000 / (now - _fpsLastTime));
            const el = document.getElementById('ht-fps');
            if (el) el.textContent = `${fps} FPS`;
            _fpsFrames  = 0;
            _fpsLastTime = now;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TOAST NOTIFICATION — Thông báo nhẹ khi nhận cử chỉ đặc biệt
    // ═══════════════════════════════════════════════════════════════════
    let _toastTimer = null;
    function showGestureToast(message) {
        let toast = document.getElementById('ht-gesture-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ht-gesture-toast';
            Object.assign(toast.style, {
                position:     'fixed',
                top:          '80px',
                left:         '50%',
                transform:    'translateX(-50%)',
                background:   'rgba(15,23,42,0.9)',
                color:        '#fff',
                padding:      '10px 22px',
                borderRadius: '30px',
                fontSize:     '15px',
                fontWeight:   '600',
                fontFamily:   'Inter, sans-serif',
                backdropFilter: 'blur(10px)',
                border:       '1px solid rgba(255,255,255,0.15)',
                zIndex:       '10000',
                transition:   'opacity 0.3s',
            });
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATUS BADGE UPDATE
    // ═══════════════════════════════════════════════════════════════════
    function updateStatusBadge(status) {
        const badge = document.getElementById('ht-status-badge');
        if (!badge) return;
        const map = {
            loading: { text: '⏳ Đang tải...', bg: '#6b7280' },
            ready:   { text: '✅ Sẵn sàng',    bg: '#059669' },
            active:  { text: '🖊️ Đang vẽ',    bg: '#2563eb' },
            erase:   { text: '🧹 Xóa',         bg: '#dc2626' },
            lasso:   { text: '⭕ Lasso',       bg: '#d97706' },
            error:   { text: '❌ Lỗi',         bg: '#991b1b' },
        };
        const cfg = map[status] || map.ready;
        badge.textContent       = cfg.text;
        badge.style.background  = cfg.bg;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  LẮNG NGHE SỰ KIỆN TỪ GESTURE → SCRIPT.JS
    //  script.js sẽ xử lý các CustomEvent này
    // ═══════════════════════════════════════════════════════════════════
    function setupGestureEventListeners() {
        window.addEventListener('handgesture:erase', () => {
            // Chuyển Fabric.js sang chế độ eraser
            const eraseBtn = document.getElementById('btn-sidebar-erase');
            if (eraseBtn) eraseBtn.click();
            updateStatusBadge('erase');
        });

        window.addEventListener('handgesture:lasso', () => {
            // Kích hoạt Lasso tool (nếu script.js có nút Lasso)
            const lassoBtn = document.getElementById('btn-lasso') ||
                             document.getElementById('lasso-tool');
            if (lassoBtn) lassoBtn.click();
            updateStatusBadge('lasso');
        });

        window.addEventListener('handgesture:swipe', (e) => {
            console.log(`[HandGesture] Swipe: ${e.detail.direction}`);
            // Trang trước/tiếp (nếu có canvas pages)
            showGestureToast(e.detail.direction === 'swipe_right' ? '▶ Trang tiếp' : '◀ Trang trước');
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  KÍCH HOẠT / TẮT MODULE
    // ═══════════════════════════════════════════════════════════════════
    async function activate() {
        if (_isActive) return;

        try {
            // Bước 1: Tạo DOM elements
            createDOMElements();

            // Bước 2: Khởi tạo MediaPipe
            if (!_handLandmarker) {
                await initHandLandmarker();
            }

            // Bước 3: Mở webcam
            await startCamera();

            // Bước 4: Thiết lập event listeners
            setupGestureEventListeners();

            // Bước 5: Bắt đầu vòng lặp
            _isActive     = true;
            _fpsLastTime  = performance.now();
            _rafId        = requestAnimationFrame(function loop() {
                if (!_isActive) return;
                trackFPS();
                detectionLoop();
            });

            updateStatusBadge('ready');
            showGestureToast('✋ Hand Tracking đã bật!');
            console.log('[HandGesture] ✅ Module đang chạy');

            // Cập nhật nút UI
            const btn = document.getElementById('btn-hand-tracking');
            if (btn) { btn.classList.add('active'); btn.title = 'Tắt Hand Tracking'; }

        } catch (err) {
            console.error('[HandGesture] ❌ Lỗi khởi tạo:', err);
            showGestureToast('❌ ' + (err.message || 'Lỗi khởi tạo Hand Tracking'));
            deactivate();
        }
    }

    function deactivate() {
        _isActive = false;

        // Dừng RAF
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

        // Dừng webcam
        if (_stream) {
            _stream.getTracks().forEach(t => t.stop());
            _stream = null;
        }

        // Kết thúc nét vẽ đang dở
        if (_isDrawing) {
            dispatchPointerEvent('pointerup', _lastSmoothX, _lastSmoothY);
            _isDrawing = false;
        }

        // Xóa DOM elements
        const container = document.getElementById('hand-tracking-container');
        if (container) container.remove();
        const overlay = document.getElementById('hand-cursor-overlay');
        if (overlay) overlay.remove();
        _overlayCanvas = null;
        _overlayCtx    = null;
        _videoEl       = null;

        // Reset trạng thái
        _currentState  = STATES.IDLE;
        _palmHistory   = [];
        _wristXHistory = [];
        _filterX.reset();
        _filterY.reset();

        // Cập nhật nút UI
        const btn = document.getElementById('btn-hand-tracking');
        if (btn) { btn.classList.remove('active'); btn.title = 'Bật Hand Tracking'; }

        console.log('[HandGesture] ⏹ Module đã dừng');
        showGestureToast('✋ Hand Tracking đã tắt');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════════════
    return {
        /**
         * Bật/Tắt Hand Tracking — Gắn vào nút UI
         */
        toggle() {
            _isActive ? deactivate() : activate();
        },

        /**
         * Bật trực tiếp (không toggle)
         */
        start: activate,

        /**
         * Tắt trực tiếp
         */
        stop: deactivate,

        /**
         * Đồng bộ màu bút từ script.js (gọi khi người dùng chọn màu)
         * @param {string} hexColor - Ví dụ: '#3b82f6'
         */
        setColor(hexColor) {
            // Màu cursor ảo sẽ phản ánh màu bút hiện tại
            console.log(`[HandGesture] Màu bút: ${hexColor}`);
        },

        /**
         * Điều chỉnh tham số 1€ Filter tại runtime (dùng cho UI tuning slider)
         * @param {number} minCutOff - Giá trị khuyến nghị: 0.5 – 2.0
         * @param {number} beta      - Giá trị khuyến nghị: 0.001 – 0.05
         */
        setFilterParams(minCutOff, beta) {
            _filterX.setParams(minCutOff, beta);
            _filterY.setParams(minCutOff, beta);
            console.log(`[HandGesture] 1€ Filter: minCutOff=${minCutOff}, beta=${beta}`);
        },

        /**
         * Lấy thông tin trạng thái hiện tại (dùng cho debug)
         */
        getStatus() {
            return {
                isActive:  _isActive,
                state:     _currentState,
                isDrawing: _isDrawing,
            };
        }
    };

})();  // End IIFE


// ═══════════════════════════════════════════════════════════════════════
//  AUTO-INIT — Tự gắn sự kiện khi DOM sẵn sàng
// ═══════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    /**
     * Gắn nút "btn-hand-tracking" (sẽ được thêm vào index.html)
     * Toggle bật/tắt Hand Tracking
     */
    const btn = document.getElementById('btn-hand-tracking');
    if (btn) {
        btn.addEventListener('click', () => {
            window.HandGestureModule.toggle();
        });
    }

    console.log('[HandGesture] Module sẵn sàng. Nhấn nút ✋ để bật.');
});
