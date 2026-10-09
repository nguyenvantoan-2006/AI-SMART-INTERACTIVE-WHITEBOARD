// ============================================================
//  chem_visuals.js — Mô hình 3D dụng cụ & hóa chất (Three.js r134)
//  Phong cách thống nhất: ánh sáng studio + phản chiếu môi trường,
//  dụng cụ thí nghiệm thật (cốc, chai thuốc thử, bình khí, mặt kính đồng hồ),
//  camera tự canh khung, bóng đổ mềm, lắc nhẹ để nhãn luôn hướng về người xem.
// ============================================================

const _chemAnimIds = new Map(); // containerId -> animationFrameId
const _chemRenderers = new Map(); // containerId -> { scene, animId, view, setAmount }

function _disposeThreeHierarchy(obj) {
    if (!obj) return;
    for (let i = obj.children.length - 1; i >= 0; i--) {
        _disposeThreeHierarchy(obj.children[i]);
    }
    if (obj.geometry) {
        try { obj.geometry.dispose(); } catch(e) {}
    }
    if (obj.material) {
        try {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
                if (m.map) m.map.dispose();
                if (m.dispose) m.dispose();
            });
        } catch(e) {}
    }
}

function stopChemAnim(containerId) {
    if (!containerId) return;
    if (_chemRenderers.has(containerId)) {
        const item = _chemRenderers.get(containerId);
        if (item.animId) cancelAnimationFrame(item.animId);
        if (item.scene) _disposeThreeHierarchy(item.scene);
        if (item.view && item.view.canvas.parentNode) item.view.canvas.parentNode.removeChild(item.view.canvas);
        _chemRenderers.delete(containerId);
    }
    if (_chemAnimIds.has(containerId)) {
        cancelAnimationFrame(_chemAnimIds.get(containerId));
        _chemAnimIds.delete(containerId);
    }
}

// Mức lượng chất của từng ô mô hình: 1 = như mặc định, 0 = không có chất, >1 = nhiều hơn.
// Lưu lại để khi ô được vẽ lại (phóng to/thu nhỏ) vẫn giữ đúng mức.
const _chemAmountTargets = new Map(); // containerId -> mức
window.setChemAmount = function(containerId, level) {
    _chemAmountTargets.set(containerId, level);
    const item = _chemRenderers.get(containerId);
    if (item && item.setAmount) item.setAmount(level);
};
window.clearChemAmount = function(containerId) {
    _chemAmountTargets.delete(containerId);
    const item = _chemRenderers.get(containerId);
    if (item && item.setAmount) item.setAmount(1);
};

window.disposeAllChemRenderers = function() {
    for (const id of Array.from(_chemRenderers.keys())) {
        stopChemAnim(id);
    }
    for (const id of Array.from(_chemAnimIds.keys())) {
        stopChemAnim(id);
    }
};

// ============================================================
//  DISPATCHER — công thức → kiểu mô hình
// ============================================================
const _ACID_NAMES = {
    'HCL': 'Axit clohiđric', 'H2SO4': 'Axit sunfuric', 'HNO3': 'Axit nitric',
    'H3PO4': 'Axit photphoric', 'CH3COOH': 'Axit axetic', 'HSO4-': 'Hiđrosunfat', 'H+': 'Axit'
};

function renderChemVisual(formula, container) {
    if (!window.THREE) { renderFallbackText(formula, container); return; }

    // Normalize: strip unicode subscripts, uppercase, no spaces, remove state symbols
    const norm = formula
        .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)])
        .toUpperCase()
        .replace(/0/g, 'O') // Fix AI confusing zero for oxygen
        .replace(/\s+/g, '')
        .replace(/[↓↑]/g, '')
        .replace(/\(AQ\)/g, '')
        .replace(/\(S\)/g, '')
        .replace(/\(L\)/g, '')
        .replace(/\(G\)/g, '')
        .replace(/\(ĐẶC\)/g, '')
        .replace(/\(LOÃNG\)/g, '');
    // Also try without parentheses (AI may output Cu(OH)2 or CuOH2)
    const normNP = norm.replace(/[()]/g, '');

    const sol    = (hex) => (c, f) => drawBeaker(c, f, { liquid: hex });
    const acid   = (c, f) => drawReagentBottle(c, f, { acid: true });
    const ppt    = (hex) => (c, f) => drawBeaker(c, f, { liquid: 0x9cc8f0, precipitate: hex });
    const gas    = (hex, density) => (c, f) => drawGasJar(c, f, { color: hex, density });
    const metal  = (opts) => (c, f) => drawMetal(c, f, opts);
    const solid  = (opts) => (c, f) => drawSolidOnDish(c, f, opts);

    const map = {
        'H2O':   (c, f) => drawBeaker(c, f, { liquid: 0x1f74e8, water: true }),
        'H3O':   (c, f) => drawBeaker(c, f, { liquid: 0x1f74e8, water: true }),
        'H3O+':  (c, f) => drawBeaker(c, f, { liquid: 0x1f74e8, water: true }),
        'H+':    acid,
        'OH-':   sol(0xe8f2ff),
        'CL-':   sol(0xe8f2ff),
        'SO42-': sol(0xe8f2ff),
        'NO3-':  sol(0xe8f2ff),
        'HSO4-': acid,
        'CO32-': sol(0xe8f2ff),
        'HCO3-': sol(0xe8f2ff),
        'CO2':   gas(0xffffff, 0.25),
        'H2CO3': (c, f) => drawBeaker(c, f, { liquid: 0x1f74e8, bubbles: true }),
        'O2':    gas(0xcfefff, 0.22),
        'H2':    gas(0xffffff, 0.18),
        'NACL':  sol(0xe8f2ff),
        'KCL':   sol(0xe8f2ff),
        'CACL2': sol(0xe8f2ff),
        'BACL2': sol(0xe8f2ff),
        'NA2SO4':sol(0xe8f2ff),
        'K2SO4': sol(0xe8f2ff),
        'NANO3': sol(0xe8f2ff),
        'KNO3':  sol(0xe8f2ff),
        'NA2CO3':sol(0xe8f2ff),
        'K2CO3': sol(0xe8f2ff),
        'NAOH':  sol(0xeef0ff),
        // Muối sinh ra theo tỉ lệ mol (Thí nghiệm ảo): CO₂/SO₂ + kiềm
        'NAHCO3':    sol(0xe8f2ff),
        'NAHSO4':    sol(0xe8f2ff),
        'KHSO4':     sol(0xe8f2ff),
        'KHCO3':     sol(0xe8f2ff),
        'NA2SO3':    sol(0xe8f2ff),
        'NAHSO3':    sol(0xe8f2ff),
        'K2SO3':     sol(0xe8f2ff),
        'KHSO3':     sol(0xe8f2ff),
        'CA(HCO3)2': sol(0xe8f2ff),
        'CAHCO32':   sol(0xe8f2ff),
        'BA(HCO3)2': sol(0xe8f2ff),
        'BAHCO32':   sol(0xe8f2ff),
        'CA(HSO3)2': sol(0xe8f2ff),
        'CAHSO32':   sol(0xe8f2ff),
        'BA(HSO3)2': sol(0xe8f2ff),
        'BAHSO32':   sol(0xe8f2ff),
        'CASO3':     ppt(0xf6f6f6),  // kết tủa trắng
        'BASO3':     ppt(0xf6f6f6),
        'KOH':   sol(0xeef0ff),
        'HCL':   acid,
        'H2SO4': acid,
        'HNO3':  acid,
        'H3PO4': acid,
        'CH3COOH': acid,
        'FE':    metal({ kind: 'nails' }),
        'FE2O3': solid({ kind: 'powder', color: 0x8a2c12 }),
        'FE3O4': solid({ kind: 'powder', color: 0x2a2a2e }),
        'NA':    metal({ kind: 'chunk', color: 0xd8dde3 }),
        'K':     metal({ kind: 'chunk', color: 0xd0d6dc }),
        'LI':    metal({ kind: 'chunk', color: 0xc8ccd0 }),
        'AG':    metal({ kind: 'ingot', color: 0xe6e8ea, roughness: 0.15 }),
        'AU':    metal({ kind: 'ingot', color: 0xf2c14e, roughness: 0.18 }),
        'CH4':   gas(0xffffff, 0.2),
        'C':     solid({ kind: 'rocks', color: 0x1c1c1f, roughness: 0.65, metalness: 0.2 }),
        'CA':    metal({ kind: 'granules', color: 0xd9d4c8 }),
        'MG':    metal({ kind: 'ribbon', color: 0xc9ced4 }),
        'AL':    metal({ kind: 'ingot', color: 0xd4dae0, roughness: 0.3 }),
        'ZN':    metal({ kind: 'granules', color: 0xa9b3bb }),
        'BA':    metal({ kind: 'granules', color: 0xc8c4b8 }),
        'MN':    metal({ kind: 'ingot', color: 0xb9b2aa }),
        'NI':    metal({ kind: 'ingot', color: 0xc9c3b4 }),
        'SN':    metal({ kind: 'granules', color: 0xd6d9dc }),
        'PB':    metal({ kind: 'ingot', color: 0x6e737a, roughness: 0.45 }),
        'CR':    metal({ kind: 'ingot', color: 0xd9dee4, roughness: 0.12 }),
        'CU':    metal({ kind: 'wire', color: 0xc8743c }),
        'CACO3': solid({ kind: 'rocks', color: 0xe6e0d2, roughness: 0.9 }),
        'CASO4': solid({ kind: 'crystals', color: 0xf2f4f8 }),
        'CAO':   solid({ kind: 'pellets', color: 0xf3f1ea }),
        'S':     solid({ kind: 'powder', color: 0xf2d22e }),

        // ── KẾT TỦA (PRECIPITATES) ──────────────────────────────
        'CU(OH)2': ppt(0x2f7fe0),  // xanh lam
        'CUOH2':   ppt(0x2f7fe0),
        'FE(OH)3': ppt(0x9a3412),  // nâu đỏ
        'FEOH3':   ppt(0x9a3412),
        'FE(OH)2': ppt(0x6f9a7a),  // trắng xanh
        'FEOH2':   ppt(0x6f9a7a),
        'AL(OH)3': ppt(0xf4f4f4),  // trắng keo
        'ALOH3':   ppt(0xf4f4f4),
        'ZN(OH)2': ppt(0xeeeeee),  // trắng
        'ZNOH2':   ppt(0xeeeeee),
        'MG(OH)2': ppt(0xf6f6f6),  // trắng
        'MGOH2':   ppt(0xf6f6f6),
        'CA(OH)2': solid({ kind: 'powder', color: 0xf5f5f0 }),   // vôi tôi
        'CAOH2':   solid({ kind: 'powder', color: 0xf5f5f0 }),
        'BA(OH)2': solid({ kind: 'pellets', color: 0xf5f5f0 }),
        'BAOH2':   solid({ kind: 'pellets', color: 0xf5f5f0 }),
        'CR(OH)3': ppt(0x5f7f63),  // xanh xám
        'CROH3':   ppt(0x5f7f63),
        'NI(OH)2': ppt(0x6cc070),  // xanh lục nhạt
        'NIOH2':   ppt(0x6cc070),
        'CO(OH)2': ppt(0xe0609a),  // hồng
        'COOH2':   ppt(0xe0609a),
        'MN(OH)2': ppt(0xf3c4b5),  // trắng hồng
        'MNOH2':   ppt(0xf3c4b5),
        'AGCL':    ppt(0xf6f6f6),  // trắng
        'AGBR':    ppt(0xe8d98a),  // vàng nhạt
        'AGI':     ppt(0xe0c020),  // vàng
        'AG2S':    ppt(0x1a1a1a),  // đen
        'BASO4':   ppt(0xfafafa),  // trắng
        'BACO3':   ppt(0xf6f6f6),  // trắng
        'PBSO4':   ppt(0xfafafa),  // trắng
        'PBCL2':   ppt(0xfafafa),  // trắng
        'PBCRO4':  ppt(0xffc400),  // vàng
        'PBS':     ppt(0x1a1a1a),  // đen
        'CUS':     ppt(0x1a1a1a),  // đen
        'FES':     ppt(0x1a1a1a),  // đen
        'ZNS':     ppt(0xfafafa),  // trắng
        'NIS':     ppt(0x1a1a1a),  // đen
        'MNO2':    solid({ kind: 'powder', color: 0x1e1e20 }),  // bột đen
        'CU2O':    ppt(0xc0391b),  // đỏ gạch

        // ── KHÍ (GASES) ─────────────────────────────────────────
        'CL2': gas(0x9ccc1a, 0.9),   // vàng lục đặc trưng
        'NO2': gas(0xb4501a, 0.95),  // nâu đỏ
        'SO2': gas(0xf0f0d0, 0.3),   // không màu, mùi hắc
        'SO3': gas(0xf4f4ee, 0.3),
        'NH3': gas(0xffffff, 0.22),  // không màu, mùi khai
        'NO':  gas(0xffffff, 0.2),
        'CO':  gas(0xffffff, 0.2),
        'H2S': gas(0xf4f4dc, 0.25),
        'F2':  gas(0xe6ee58, 0.6),   // vàng lục nhạt
        'BR2': gas(0xa0300c, 0.9),   // đỏ nâu
        'I2':  gas(0x7a1fa8, 0.85),  // tím
        'HCL(G)': gas(0xffffff, 0.22),

        // ── DUNG DỊCH MÀU & MUỐI TAN (SOLUTIONS) ──────────────────
        'CUSO4':     sol(0x1e6fe0),  // xanh lam
        'CU(NO3)2':  sol(0x2a8fd8),
        'CUNO32':    sol(0x2a8fd8),
        'CUCL2':     sol(0x22a0c8),  // xanh lục lam
        'KMNO4':     sol(0x8a1fbf),  // tím
        'K2CR2O7':   sol(0xff6a10),  // da cam
        'K2CRO4':    sol(0xf2d20c),  // vàng
        'FECL3':     sol(0xc98a12),  // vàng nâu
        'FE2(SO4)3': sol(0xc98a12),
        'FE2SO43':   sol(0xc98a12),
        'FE(NO3)3':  sol(0xc98a12),
        'FENO33':    sol(0xc98a12),
        'FECL2':     sol(0x8fcf7a),  // lục nhạt
        'FESO4':     sol(0x8fcf7a),
        'FE(NO3)2':  sol(0x8fcf7a),
        'FENO32':    sol(0x8fcf7a),
        'AL2(SO4)3': sol(0xe8f2ff),  // không màu
        'AL2SO43':   sol(0xe8f2ff),
        'ALCL3':     sol(0xe8f2ff),
        'AL(NO3)3':  sol(0xe8f2ff),
        'ALNO33':    sol(0xe8f2ff),
        'MGSO4':     sol(0xe8f2ff),
        'MGCL2':     sol(0xe8f2ff),
        'ZNCL2':     sol(0xe8f2ff),
        'ZNSO4':     sol(0xe8f2ff),
        'AGNO3':     sol(0xe8f2ff),
        'NH4CL':     sol(0xe8f2ff),
        '(NH4)2SO4': sol(0xe8f2ff),
        'NH42SO4':   sol(0xe8f2ff),
        'NISO4':     sol(0x3fbf4a),  // xanh lục
        'NICL2':     sol(0x3fbf4a),
        'COCL2':     sol(0xe0457f),  // hồng đỏ
        'COSO4':     sol(0xe0457f),
        'MNCL2':     sol(0xf6b8b8),  // hồng nhạt
        'MNSO4':     sol(0xf6c2b6),
        'CRCL3':     sol(0x2e8a45),  // lục tối
    };

    (map[norm] || map[normNP] || ((c, f) => drawReagentBottle(c, f, {})))(container, formula);
}

// ============================================================
//  SCENE: renderer, môi trường studio, camera tự canh khung
// ============================================================

// Môi trường "studio" dựng bằng vài tấm sáng — cho kính & kim loại có phản chiếu đẹp
function _buildStudioEnvironment(renderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(
        new THREE.BoxGeometry(20, 12, 20),
        new THREE.MeshBasicMaterial({ color: 0x2a3140, side: THREE.BackSide })
    );
    env.add(room);
    const panel = (w, h, color, k, pos, rot) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
        m.position.set(...pos); if (rot) m.rotation.set(...rot);
        env.add(m);
    };
    panel(10, 6, 0xffffff, 5.0, [0, 5.9, 0], [Math.PI / 2, 0, 0]);          // softbox trên đầu
    panel(3, 8, 0xdbe9ff, 3.0, [-9.9, 1, 1], [0, Math.PI / 2, 0]);          // dải sáng lạnh bên trái
    panel(3, 8, 0xfff0dc, 2.4, [9.9, 1, -1], [0, -Math.PI / 2, 0]);         // dải sáng ấm bên phải
    panel(8, 3, 0xffffff, 1.2, [0, 0, 9.9], [0, Math.PI, 0]);               // đèn hắt phía trước
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    _disposeThreeHierarchy(env);
    return tex;
}

// ── BỘ VẼ DÙNG CHUNG ─────────────────────────────────────────────────
// SPEED OPT: trước đây mỗi ô mô hình tạo một WebGLRenderer riêng → mỗi lần mở bảng
// phải biên dịch lại shader + tạo lại môi trường phản chiếu cho TỪNG ô (0,8–2,5 s đứng hình).
// Giờ chỉ có MỘT renderer: shader biên dịch một lần, mỗi ô vẽ vào vùng riêng rồi
// chép sang canvas 2D của ô. Cũng tránh giới hạn ~16 WebGL context của trình duyệt.
let _sharedGL = null;
function _getSharedRenderer() {
    if (_sharedGL) return _sharedGL;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    // TV OPT: Giới hạn pixelRatio trên màn hình lớn để chống quá tải GPU của TV
    const isLargeScreen = (window.innerWidth >= 1600) || /SmartTV|Tizen|Web0S|BRAVIA|Android TV/i.test(navigator.userAgent);
    const pr = isLargeScreen ? 1.25 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(256, 256, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    _sharedGL = { renderer, pr, w: 256, h: 256, envTex: _buildStudioEnvironment(renderer) };
    return _sharedGL;
}

// Vẽ một cảnh vào góc dưới-trái của renderer chung rồi chép sang canvas 2D của ô
function _renderView(scene, camera, view) {
    const g = _getSharedRenderer();
    if (view.W > g.w || view.H > g.h) {
        g.w = Math.max(g.w, view.W); g.h = Math.max(g.h, view.H);
        g.renderer.setSize(g.w, g.h, false);
    }
    const r = g.renderer;
    // Xóa TOÀN BỘ canvas chung (không dùng scissor) để không sót viền 1px của ô vẽ trước
    r.setScissorTest(false);
    r.setViewport(0, 0, view.W, view.H);
    r.render(scene, camera);
    const src = r.domElement;
    const pw = view.canvas.width, ph = view.canvas.height;
    view.ctx.clearRect(0, 0, pw, ph);
    view.ctx.drawImage(src, 0, src.height - ph, pw, ph, 0, 0, pw, ph);
}

function _setupScene(container) {
    if (!container.id) {
        container.id = 'chem-vis-' + Math.random().toString(36).substr(2, 9);
    }
    // Cleanup any existing renderer in this container
    stopChemAnim(container.id);

    const rect = container.getBoundingClientRect();
    const W = Math.round(rect.width) || container.clientWidth || container.offsetWidth || 140;
    const H = Math.round(rect.height) || container.clientHeight || container.offsetHeight || 140;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);

    const g = _getSharedRenderer();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * g.pr);
    canvas.height = Math.round(H * g.pr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(canvas);
    const view = { canvas, ctx: canvas.getContext('2d'), W, H };

    scene.environment = g.envTex;

    // Đèn bổ sung (môi trường đã lo phần lớn ánh sáng)
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1f2a, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc4ff, 0.9);
    rim.position.set(-4, 2, -3); scene.add(rim);

    _chemRenderers.set(container.id, { scene, animId: null, view });
    // Giữ nguyên giao diện cũ cho các hàm vẽ: renderer.render(scene, camera)
    const renderer = { render: (sc, cam) => _renderView(sc, cam, view) };
    return { scene, camera, renderer, W, H };
}

// Khởi động sẵn lúc trình duyệt rảnh: tạo bộ vẽ chung + biên dịch shader các kiểu mô hình
// → lần trực quan hóa đầu tiên không phải chờ.
const _warmScenes = [];   // giữ vật liệu khởi động sẵn để shader không bị giải phóng
function _warmUpChemVisuals() {
    if (!window.THREE) return;
    try {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:-10000px;top:0;width:140px;height:140px;';
        document.body.appendChild(box);
        ['CuSO4', 'H2SO4', 'CO2', 'Fe', 'CaCO3', 'Cu(OH)2', 'H2CO3'].forEach((f, i) => {
            const v = document.createElement('div');
            v.id = 'chem-warmup-' + i;
            v.style.cssText = 'width:140px;height:140px;';
            box.appendChild(v);
            renderChemVisual(f, v);
        });
        // Đã vẽ xong khung đầu → dừng hoạt ảnh nhưng KHÔNG hủy vật liệu:
        // Three.js giải phóng shader khi vật liệu cuối cùng dùng nó bị hủy, giữ lại để
        // các bảng phản ứng sau dùng lại shader đã biên dịch.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            box.querySelectorAll('[id^="chem-warmup-"]').forEach(v => {
                const item = _chemRenderers.get(v.id);
                if (item && item.animId) cancelAnimationFrame(item.animId);
                if (_chemAnimIds.has(v.id)) cancelAnimationFrame(_chemAnimIds.get(v.id));
                _chemAnimIds.delete(v.id);
                if (item) _warmScenes.push(item.scene);
                _chemRenderers.delete(v.id);
            });
            box.remove();
        }));
    } catch (e) { console.warn('[chem_visuals] warm-up lỗi:', e); }
}
if (document.readyState === 'complete') setTimeout(_warmUpChemVisuals, 800);
else window.addEventListener('load', () => {
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(_warmUpChemVisuals, { timeout: 3000 });
});

// Canh camera để vật thể nằm trọn trong khung, nhìn hơi từ trên xuống
function _fitCamera(camera, object, margin = 1.18) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Vật lắc/quay quanh trục Y → bề ngang tối đa là đường chéo mặt XZ
    const width = Math.hypot(size.x, size.z);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distV = (size.y / 2) / tanHalf;
    const distH = (width / 2) / (tanHalf * camera.aspect);
    const dist = Math.max(distV, distH) * margin + Math.max(size.x, size.z) * 0.35;
    const elev = 0.32; // góc nhìn xuống ~18°
    camera.position.set(center.x, center.y + dist * elev, dist);
    camera.lookAt(center.x, center.y - size.y * 0.04, center.z);
    camera.near = Math.max(0.01, dist / 50);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    return box;
}

// Bóng đổ mềm dưới đáy vật (texture gradient — rẻ hơn shadow map)
let _shadowCanvas = null;
function _addContactShadow(scene, box, strength = 0.55) {
    if (!_shadowCanvas) {
        _shadowCanvas = document.createElement('canvas');
        _shadowCanvas.width = _shadowCanvas.height = 128;
        const g = _shadowCanvas.getContext('2d');
        const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grd.addColorStop(0, 'rgba(0,0,0,1)');
        grd.addColorStop(0.45, 'rgba(0,0,0,0.55)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    }
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.85;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(r * 2, r * 2),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(_shadowCanvas), transparent: true, opacity: strength, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, box.min.y + 0.002, 0);
    mesh.renderOrder = -1;
    scene.add(mesh);
}

// Hoàn tất cảnh: canh camera, bóng đổ, chạy hoạt ảnh (lắc nhẹ thay vì quay tròn)
function _finishScene(container, ctx, group, update, opts = {}) {
    const { scene, camera, renderer } = ctx;
    const box = _fitCamera(camera, group, opts.margin);
    if (!opts.noShadow) _addContactShadow(scene, box, opts.shadow);
    const clock = new THREE.Clock();
    const swayAmp = opts.sway ?? 0.55;
    // Mức lượng chất: đổi mượt từ mức hiện tại tới mức đích
    const amt = { cur: 1, target: 1 };
    if (opts.amount) {
        if (_chemAmountTargets.has(container.id)) amt.cur = amt.target = _chemAmountTargets.get(container.id);
        opts.amount(amt.cur);
        const item = _chemRenderers.get(container.id);
        if (item) item.setAmount = (level) => { amt.target = level; };
    }
    const phase = Math.random() * Math.PI * 2;
    function tick() {
        const id = requestAnimationFrame(tick);
        _chemAnimIds.set(container.id, id);
        if (_chemRenderers.has(container.id)) _chemRenderers.get(container.id).animId = id;
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;
        if (opts.amount && Math.abs(amt.cur - amt.target) > 1e-3) {
            amt.cur += (amt.target - amt.cur) * Math.min(1, dt * 6);
            opts.amount(amt.cur);
        }
        if (opts.spin) group.rotation.y += dt * opts.spin;
        else group.rotation.y = Math.sin(t * 0.55 + phase) * swayAmp;
        if (update) update(dt, t);
        renderer.render(scene, camera);
    }
    tick();
}

// ============================================================
//  VẬT LIỆU & TEXTURE DÙNG CHUNG
// ============================================================
// Mã màu hex là sRGB; renderer xuất sRGB nên phải đổi sang linear, nếu không màu bị nhạt
function _lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

function _glassMat(opts = {}) {
    return new THREE.MeshPhysicalMaterial({
        color: _lin(opts.color ?? 0xf4fbff),
        metalness: 0, roughness: opts.roughness ?? 0.04,
        transparent: true, opacity: opts.opacity ?? 0.08,
        clearcoat: 1, clearcoatRoughness: 0.03,
        envMapIntensity: 1.7, side: THREE.DoubleSide, depthWrite: false
    });
}

function _liquidMat(hex, opts = {}) {
    const c = _lin(hex);
    return new THREE.MeshPhysicalMaterial({
        color: c, metalness: 0, roughness: 0.08,
        transparent: true, opacity: opts.opacity ?? 0.82,
        clearcoat: 0.4, clearcoatRoughness: 0.1, envMapIntensity: 0.55,
        emissive: c.clone().multiplyScalar(opts.glow ?? 0.12), depthWrite: false
    });
}

function _lathe(points, segs = 56) {
    return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// Viết công thức hóa học lên canvas với chỉ số dưới / điện tích trên
function _drawFormula(g, formula, cx, cy, size, color) {
    const pretty = String(formula)
        .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)]);
    const runs = [];
    for (let i = 0; i < pretty.length; i++) {
        const ch = pretty[i], prev = pretty[i - 1] || '';
        if (/[0-9]/.test(ch) && /[A-Za-z)\]0-9]/.test(prev) && i > 0) runs.push({ ch, kind: 'sub' });
        else if (/[+\-]/.test(ch) && i === pretty.length - 1 || (/[+\-]/.test(ch) && /[0-9]/.test(prev) && i === pretty.length - 1)) runs.push({ ch, kind: 'sup' });
        else runs.push({ ch, kind: 'base' });
    }
    const font = (k) => `${k === 'base' ? 800 : 700} ${Math.round(k === 'base' ? size : size * 0.62)}px "Segoe UI", Arial, sans-serif`;
    let total = 0;
    runs.forEach(r => { g.font = font(r.kind); r.w = g.measureText(r.ch).width; total += r.w; });
    let x = cx - total / 2;
    g.fillStyle = color; g.textBaseline = 'alphabetic';
    runs.forEach(r => {
        g.font = font(r.kind);
        const dy = r.kind === 'sub' ? size * 0.22 : r.kind === 'sup' ? -size * 0.42 : 0;
        g.fillText(r.ch, x, cy + dy);
        x += r.w;
    });
}

// Nhãn giấy: dải màu trên đầu + công thức lớn + tên chất + biểu tượng cảnh báo ăn mòn
function _labelTexture(formula, opts = {}) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = opts.band || '#1f6feb'; g.fillRect(0, 0, 512, 46);
    g.fillStyle = '#ffffff'; g.font = '700 26px "Segoe UI", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText(opts.title || 'HÓA CHẤT', 18, 32);
    g.textAlign = 'left';
    const hasHazard = !!opts.hazard;
    _drawFormula(g, formula, hasHazard ? 200 : 256, 158, opts.formulaSize || 92, '#111827');
    if (opts.name) {
        g.fillStyle = '#4b5563'; g.font = '600 26px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center';
        g.fillText(opts.name, hasHazard ? 200 : 256, 222);
    }
    if (hasHazard) {
        // Hình thoi viền đỏ (chuẩn GHS) + giọt ăn mòn
        g.save(); g.translate(420, 150); g.rotate(Math.PI / 4);
        g.fillStyle = '#ffffff'; g.fillRect(-52, -52, 104, 104);
        g.lineWidth = 12; g.strokeStyle = '#dc2626'; g.strokeRect(-52, -52, 104, 104);
        g.restore();
        g.fillStyle = '#111'; g.font = '900 64px Arial'; g.textAlign = 'center';
        g.fillText('!', 420, 174);
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 4; g.strokeRect(2, 2, 508, 252);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
}

// Vạch chia thể tích trên cốc (texture trong suốt)
function _graduationTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '600 30px Arial'; g.textAlign = 'left';
    for (let i = 0; i <= 10; i++) {
        const y = 470 - i * 40;
        const major = i % 2 === 0;
        g.lineWidth = major ? 5 : 3;
        g.beginPath(); g.moveTo(40, y); g.lineTo(major ? 120 : 90, y); g.stroke();
        if (major && i > 0) g.fillText(String(i * 25), 130, y + 10);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

// Đốm mềm cho khí / bọt / hạt (sprite)
let _softDotCanvas = null;
function _softDotTexture() {
    if (!_softDotCanvas) {
        _softDotCanvas = document.createElement('canvas');
        _softDotCanvas.width = _softDotCanvas.height = 64;
        const g = _softDotCanvas.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(_softDotCanvas);
}

// Bọt khí: vòng sáng viền, ruột trong (giống bọt thật dưới ánh đèn)
let _bubbleCanvas = null;
function _bubbleTexture() {
    if (!_bubbleCanvas) {
        _bubbleCanvas = document.createElement('canvas');
        _bubbleCanvas.width = _bubbleCanvas.height = 64;
        const g = _bubbleCanvas.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 14, 32, 32, 31);
        grd.addColorStop(0, 'rgba(255,255,255,0.05)');
        grd.addColorStop(0.75, 'rgba(255,255,255,0.35)');
        grd.addColorStop(0.92, 'rgba(255,255,255,0.95)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(23, 22, 5, 0, Math.PI * 2); g.fill();
    }
    return new THREE.CanvasTexture(_bubbleCanvas);
}

// Nhiễu giả ngẫu nhiên theo vị trí (để các đỉnh trùng nhau dịch chuyển giống nhau)
function _hashNoise(x, y, z) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return s - Math.floor(s);
}

function _rockGeometry(radius, rough = 0.28, detail = 1) {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const seed = Math.random() * 100;
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = _hashNoise(v.x * 3 + seed, v.y * 3, v.z * 3);
        v.multiplyScalar(1 + (n - 0.5) * rough);
        v.y *= 0.78;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

// ============================================================
//  1. CỐC THỦY TINH (dung dịch, nước, kết tủa, sủi bọt)
// ============================================================
function drawBeaker(container, formula, opts = {}) {
    const ctx = _setupScene(container);
    const group = new THREE.Group(); ctx.scene.add(group);

    const R = 0.78, H = 1.9, wall = 0.035, yb = -H / 2;
    // Thành cốc dày: ngoài → miệng loe → trong (nhìn thấy độ dày kính ở mép)
    const glass = new THREE.Mesh(_lathe([
        [0, yb], [R - 0.06, yb], [R, yb + 0.06], [R, H / 2 - 0.02],
        [R + 0.035, H / 2 + 0.03], [R + 0.01, H / 2 + 0.05], [R - wall, H / 2],
        [R - wall, yb + wall + 0.05], [R - wall - 0.05, yb + wall], [0, yb + wall]
    ]), _glassMat());
    glass.renderOrder = 10;
    group.add(glass);

    // Vạch chia thể tích (nửa trước của cốc)
    const grad = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.004, R + 0.004, H * 0.62, 40, 1, true, -Math.PI * 0.18, Math.PI * 0.36),
        new THREE.MeshBasicMaterial({ map: _graduationTexture(), transparent: true, depthWrite: false, opacity: 0.8 })
    );
    grad.position.y = yb + H * 0.36;
    grad.renderOrder = 11;
    group.add(grad);

    // Chất lỏng: thân + mặt khum (meniscus)
    const fill = opts.fill ?? 0.62;
    const ri = R - wall - 0.008, y0 = yb + wall + 0.005, y1 = yb + H * fill;
    const liquidHex = opts.liquid ?? 0xe8f2ff;
    const isClear = !opts.precipitate && new THREE.Color(liquidHex).getHSL({}).l > 0.85;
    const liq = new THREE.Mesh(_lathe([
        [0, y0], [ri - 0.04, y0], [ri, y0 + 0.04], [ri, y1 + 0.035], [ri * 0.93, y1 + 0.005], [0, y1]
    ]), _liquidMat(opts.precipitate ? 0xbcd9f2 : liquidHex, {
        opacity: opts.precipitate ? 0.5 : (isClear ? 0.4 : 0.93),
        glow: isClear ? 0.05 : 0.24
    }));
    liq.renderOrder = 5;
    // Đặt gốc hình ở đáy chất lỏng để co giãn chiều cao theo lượng chất
    liq.geometry.translate(0, -y0, 0);
    liq.position.y = y0;
    group.add(liq);
    let yTop = y1;           // mặt chất lỏng hiện tại (đổi theo lượng chất)
    let activeFrac = 1;      // tỉ lệ bọt / hạt đang hiện

    // Nhãn băng dính ghi công thức (trừ nước)
    if (!opts.water) {
        const label = new THREE.Mesh(
            new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.42, 40, 1, true, -Math.PI * 0.21, Math.PI * 0.42),
            new THREE.MeshStandardMaterial({ map: _labelTexture(formula, { band: '#0f766e', title: 'DUNG DỊCH', formulaSize: 104 }), roughness: 0.75, transparent: true, side: THREE.FrontSide })
        );
        label.position.y = yb + H * 0.8;
        label.renderOrder = 12;
        group.add(label);
    }

    const updates = [];
    let sedMesh = null, flakeList = null, bubbleList = null, sprayList = null;

    // Kết tủa: lớp lắng dưới đáy + hạt lơ lửng rơi xuống
    if (opts.precipitate) {
        const pc = _lin(opts.precipitate);
        const sedH = 0.26;
        const sed = new THREE.Mesh(_lathe([
            [0, y0], [ri - 0.03, y0], [ri, y0 + 0.04], [ri, y0 + sedH * 0.7], [ri * 0.6, y0 + sedH], [0, y0 + sedH * 1.05]
        ]), new THREE.MeshStandardMaterial({ color: pc, roughness: 0.95, envMapIntensity: 0.6 }));
        sed.renderOrder = 4;
        sed.geometry.translate(0, -y0, 0);
        sed.position.y = y0;
        group.add(sed);
        sedMesh = sed;
        const tex = _softDotTexture();
        const flakes = [];
        for (let i = 0; i < 70; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: pc, transparent: true, opacity: 0.85, depthWrite: false }));
            const sc = 0.05 + Math.random() * 0.07;
            s.scale.set(sc, sc, sc);
            const th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (ri - 0.08);
            s.position.set(Math.cos(th) * rr, y0 + sedH + Math.random() * (y1 - y0 - sedH), Math.sin(th) * rr);
            s.userData = { vy: 0.08 + Math.random() * 0.12, ph: Math.random() * 6 };
            s.renderOrder = 6;
            group.add(s); flakes.push(s);
        }
        flakeList = flakes;
        updates.push((dt, t) => flakes.forEach((s, i) => {
            s.visible = i < flakes.length * activeFrac;
            s.position.y -= s.userData.vy * dt;
            s.position.x += Math.sin(t * 1.3 + s.userData.ph) * 0.002;
            if (s.position.y < y0 + sedH) s.position.y = y1 - 0.05;
        }));
    }

    // Sủi bọt khí mạnh (H₂CO₃ ...): bọt to nổi lên + tia sủi lách tách trên mặt nước
    if (opts.bubbles) {
        const tex = _bubbleTexture();
        const bubbles = [];
        const resetBubble = (s, anywhere) => {
            const th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (ri - 0.12);
            s.userData.bx = Math.cos(th) * rr;
            s.position.set(s.userData.bx, anywhere ? y0 + Math.random() * (yTop - y0) : y0 + 0.03, Math.sin(th) * rr);
            s.userData.vy = 0.55 + Math.random() * 0.7;
            const sc = 0.07 + Math.random() * 0.1;
            s.scale.set(sc, sc, sc);
        };
        for (let i = 0; i < 80; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false }));
            s.userData = { ph: Math.random() * 6 };
            resetBubble(s, true);
            s.renderOrder = 6;
            group.add(s); bubbles.push(s);
        }
        // Tia sủi bắn lên khỏi mặt nước rồi rơi lại
        const spray = [];
        const dot = _softDotTexture();
        const resetSpray = (s) => {
            const th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (ri - 0.1);
            s.position.set(Math.cos(th) * rr, yTop + 0.02, Math.sin(th) * rr);
            s.userData.vy = 0.6 + Math.random() * 0.9;
            s.userData.vx = (Math.random() - 0.5) * 0.4;
            s.userData.age = 0;
        };
        for (let i = 0; i < 30; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, opacity: 0.9, depthWrite: false }));
            const sc = 0.035 + Math.random() * 0.04;
            s.scale.set(sc, sc, sc);
            s.userData = {};
            resetSpray(s);
            s.userData.age = Math.random() * 0.6;
            s.renderOrder = 13;
            group.add(s); spray.push(s);
        }
        updates.push((dt, t) => {
            bubbles.forEach((s, i) => {
                s.visible = i < bubbles.length * activeFrac;
                s.position.y += s.userData.vy * dt;
                s.position.x = s.userData.bx + Math.sin(t * 5 + s.userData.ph) * 0.025;
                if (s.position.y > yTop - 0.02) resetBubble(s, false);
            });
            spray.forEach((s, i) => {
                s.visible = i < spray.length * activeFrac;
                const u = s.userData;
                u.age += dt;
                u.vy -= 4.5 * dt;                      // trọng lực
                s.position.y += u.vy * dt;
                s.position.x += u.vx * dt;
                s.material.opacity = Math.max(0, 0.9 - u.age * 1.2);
                if (s.position.y < yTop) resetSpray(s);
            });
        });
    }

    // Lượng chất → hình: dung dịch thì mực chất lỏng; kết tủa thì độ dày lớp lắng & số hạt
    const applyAmount = (v) => {
        v = Math.max(0, v);
        if (opts.precipitate) {
            const k = Math.min(v, 1.8);
            sedMesh.scale.y = Math.max(k, 0.001);
            sedMesh.visible = k > 0.01;
            activeFrac = Math.min(1, v);
        } else {
            const k = Math.min(v, 1.4);
            liq.scale.y = Math.max(k, 0.001);
            liq.visible = k > 0.01;
            yTop = y0 + (y1 - y0) * k;
            activeFrac = Math.min(1, v);
        }
    };
    _finishScene(container, ctx, group, (dt, t) => updates.forEach(u => u(dt, t)), { amount: applyAmount });
}

// ============================================================
//  2. CHAI THUỐC THỬ (axit, chất chưa có mô hình riêng)
// ============================================================
function drawReagentBottle(container, formula, opts = {}) {
    const ctx = _setupScene(container);
    const group = new THREE.Group(); ctx.scene.add(group);

    const key = formula.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)]).toUpperCase().replace(/\s+/g, '');
    // Chai thủy tinh nâu cho axit nitric (tránh ánh sáng), còn lại chai trong
    const amber = key.includes('HNO3');
    const R = 0.62, yb = -1.1;
    const body = new THREE.Mesh(_lathe([
        [0, yb], [R - 0.08, yb], [R, yb + 0.08], [R, 0.35], [R - 0.06, 0.52], [0.3, 0.72],
        [0.2, 0.8], [0.2, 1.02], [0.17, 1.02], [0.17, 0.82], [R - 0.1, 0.48], [R - 0.04, 0.33],
        [R - 0.04, yb + 0.1], [0, yb + 0.06]
    ]), _glassMat(amber ? { color: 0x9a4a10, opacity: 0.5 } : { opacity: 0.14 }));
    body.renderOrder = 10;
    group.add(body);

    // Dung dịch bên trong (axit đặc gần như không màu, ánh vàng nhẹ)
    let liquidHex = opts.liquid;
    if (liquidHex == null) {
        if (key.includes('H2SO4')) liquidHex = 0xf3ecc8;
        else if (key.includes('HNO3')) liquidHex = 0xf5d76e;
        else if (key.includes('HCL')) liquidHex = 0xe9f6ea;
        else {
            let hash = 0; for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
            liquidHex = new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.6).getHex();
        }
    }
    const liq = new THREE.Mesh(_lathe([
        [0, yb + 0.07], [R - 0.06, yb + 0.07], [R - 0.06, 0.16], [R - 0.08, 0.2], [0, 0.2]
    ]), _liquidMat(liquidHex, { opacity: 0.6, glow: 0.08 }));
    liq.renderOrder = 5;
    liq.geometry.translate(0, -(yb + 0.07), 0);
    liq.position.y = yb + 0.07;
    group.add(liq);

    // Nắp vặn có rãnh
    const capMat = new THREE.MeshStandardMaterial({ color: _lin(opts.acid ? 0xc62828 : 0x1f2937), roughness: 0.45, metalness: 0.05 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.3, 40), capMat);
    cap.position.y = 1.15;
    group.add(cap);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.235, 0.05, 40), capMat);
    capTop.position.y = 1.32;
    group.add(capTop);
    for (let i = 0; i < 18; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.03), capMat);
        const a = (i / 18) * Math.PI * 2;
        rib.position.set(Math.cos(a) * 0.238, 1.15, Math.sin(a) * 0.238);
        rib.rotation.y = -a;
        group.add(rib);
    }

    // Nhãn giấy quấn quanh thân chai
    const label = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.86, 48, 1, true, -Math.PI * 0.55, Math.PI * 1.1),
        new THREE.MeshStandardMaterial({
            map: _labelTexture(formula, {
                band: opts.acid ? '#b91c1c' : '#1d4ed8',
                title: opts.acid ? 'AXIT — ĂN MÒN' : 'THUỐC THỬ',
                name: _ACID_NAMES[key] || '',
                hazard: !!opts.acid,
                formulaSize: key.length > 6 ? 70 : 90
            }),
            roughness: 0.8
        })
    );
    label.position.y = -0.38;
    label.renderOrder = 12;
    group.add(label);

    _finishScene(container, ctx, group, null, {
        amount: (v) => { const k = Math.min(Math.max(v, 0), 1.25); liq.scale.y = Math.max(k, 0.001); liq.visible = k > 0.01; }
    });
}

// ============================================================
//  3. KHÍ — bình tam giác phun cột khói mạnh (khí màu giữ đúng màu)
// ============================================================
// Đám khói dạng "bông": nhiều vầng tròn mềm chồng lên nhau → trông như khói cuộn
let _smokeCanvas = null;
function _smokeTexture() {
    if (!_smokeCanvas) {
        _smokeCanvas = document.createElement('canvas');
        _smokeCanvas.width = _smokeCanvas.height = 128;
        const g = _smokeCanvas.getContext('2d');
        const blob = (x, y, r, a) => {
            const grd = g.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, `rgba(255,255,255,${a})`);
            grd.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        };
        blob(64, 64, 52, 0.75);
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            blob(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26, 28 + (i % 3) * 5, 0.5);
        }
    }
    return new THREE.CanvasTexture(_smokeCanvas);
}

function drawGasJar(container, formula, opts = {}) {
    const ctx = _setupScene(container);
    const group = new THREE.Group(); ctx.scene.add(group);

    const gasHex = opts.color ?? 0xffffff;
    const colored = (opts.density ?? 0.3) > 0.5;
    // Khí không màu vẫn vẽ khói trắng sáng để nhìn xa cũng thấy
    const smokeColor = _lin(colored ? gasHex : 0xf4f8fc);

    // Bình tam giác (erlen) — nơi khí thoát ra
    const yb = -0.75, neckY = 0.7;
    const flask = new THREE.Mesh(_lathe([
        [0, yb], [0.66, yb], [0.72, yb + 0.07], [0.7, yb + 0.16], [0.22, 0.42], [0.19, 0.5],
        [0.19, neckY], [0.23, neckY + 0.04], [0.21, neckY + 0.07], [0.16, neckY + 0.05],
        [0.16, 0.5], [0.19, 0.42], [0.66, yb + 0.15], [0.62, yb + 0.06], [0, yb + 0.05]
    ]), _glassMat({ opacity: 0.16 }));
    flask.renderOrder = 10;
    group.add(flask);

    // Khí đầy trong bình
    const fillGas = new THREE.Mesh(_lathe([
        [0, yb + 0.06], [0.6, yb + 0.06], [0.63, yb + 0.15], [0.18, 0.43], [0.15, 0.52], [0, 0.52]
    ]), new THREE.MeshBasicMaterial({ color: smokeColor, transparent: true, opacity: colored ? 0.55 : 0.28, depthWrite: false }));
    fillGas.renderOrder = 5;
    group.add(fillGas);

    // Khoảng không gian dành cho cột khói (để camera canh khung bao trọn)
    const plumeH = 2.0;
    const bounds = new THREE.Mesh(new THREE.BoxGeometry(2.2, plumeH + 1.5, 0.6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    bounds.position.y = yb + (plumeH + 1.5) / 2;
    group.add(bounds);

    // Cột khói: các bông khói phun lên từ miệng bình, nở to dần rồi tan
    const tex = _smokeTexture();
    const puffs = [];
    const N = 90;
    const spawn = (p, age) => {
        p.userData.age = age;
        p.userData.life = 1.5 + Math.random() * 0.9;
        p.userData.vx = (Math.random() - 0.5) * 0.7;
        p.userData.vz = (Math.random() - 0.5) * 0.5;
        p.userData.vy = 1.6 + Math.random() * 0.8;
        p.userData.spin = (Math.random() - 0.5) * 1.2;
        p.userData.maxScale = 1.3 + Math.random() * 0.9;
        p.position.set((Math.random() - 0.5) * 0.08, neckY + 0.05, (Math.random() - 0.5) * 0.08);
    };
    for (let i = 0; i < N; i++) {
        const p = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, color: smokeColor, transparent: true, depthWrite: false, opacity: 0
        }));
        p.material.rotation = Math.random() * Math.PI * 2;
        p.renderOrder = 20;
        spawn(p, 0);
        // Rải tuổi ban đầu để cột khói đầy ngay từ khung hình đầu tiên
        const pre = Math.random() * p.userData.life;
        p.userData.age = pre;
        p.position.x += p.userData.vx * pre; p.position.z += p.userData.vz * pre;
        p.position.y += p.userData.vy * pre * (1 - 0.25 * pre / p.userData.life);
        group.add(p); puffs.push(p);
    }
    const peak = colored ? 0.9 : 0.8;
    let gasLevel = 1;   // lượng khí: 0 = không có khói, >1 = khói dày hơn
    const fillOpacity = fillGas.material.opacity;

    _finishScene(container, ctx, group, (dt, t) => puffs.forEach(p => {
        const u = p.userData;
        u.age += dt;
        if (u.age >= u.life) { spawn(p, 0); }
        const k = u.age / u.life;                       // 0 → 1 trong vòng đời
        // Phun mạnh rồi chậm dần, tỏa rộng ra hai bên
        p.position.y += u.vy * dt * (1 - 0.6 * k);
        p.position.x += u.vx * dt * (0.6 + 1.6 * k);
        p.position.z += u.vz * dt * (0.6 + 1.6 * k);
        p.position.x += Math.sin(t * 2.2 + u.maxScale * 9) * 0.004;  // xoáy nhẹ
        const s = (0.3 + u.maxScale * Math.pow(k, 0.5)) * (0.55 + 0.45 * Math.min(gasLevel, 1.5));
        p.scale.set(s, s, s);
        p.material.rotation += u.spin * dt;
        // Hiện nhanh ở miệng bình, mờ dần khi lên cao
        p.material.opacity = peak * Math.min(1, gasLevel) * Math.min(1, k * 6) * Math.pow(1 - k, 1.3);
    }), {
        sway: 0.25, margin: 1.02,
        amount: (v) => { gasLevel = Math.max(0, v); fillGas.material.opacity = fillOpacity * Math.min(1, gasLevel); }
    });
}

// ============================================================
//  4. KIM LOẠI (đinh sắt, dây đồng, băng Mg, mẩu Na, viên Zn, thỏi)
// ============================================================
function _metalMat(hex, roughness = 0.25) {
    return new THREE.MeshStandardMaterial({ color: _lin(hex), metalness: 1, roughness, envMapIntensity: 1.6 });
}

class _HelixCurve extends THREE.Curve {
    constructor(radius, height, turns) { super(); this.r = radius; this.h = height; this.turns = turns; }
    getPoint(t, target = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * this.turns;
        return target.set(Math.cos(a) * this.r, (t - 0.5) * this.h, Math.sin(a) * this.r);
    }
}

function drawMetal(container, formula, opts = {}) {
    const ctx = _setupScene(container);
    const group = new THREE.Group(); ctx.scene.add(group);
    const kind = opts.kind || 'ingot';

    if (kind === 'nails') {
        // Ba chiếc đinh sắt (vật quen thuộc trong thí nghiệm Fe + CuSO₄)
        const mat = _metalMat(0x8a8f96, 0.32);
        [[-0.28, 0.12, 0.05], [0.05, -0.05, -0.1], [0.3, 0.08, 0.12]].forEach(([x, z, tilt], i) => {
            const nail = new THREE.Group();
            const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.7, 20), mat);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 20), mat);
            tip.position.y = -0.96; tip.rotation.x = Math.PI;
            const head = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.07, 28), mat);
            head.position.y = 0.88;
            nail.add(shank, tip, head);
            nail.position.set(x, 0, z);
            nail.rotation.z = tilt + (i - 1) * 0.12;
            group.add(nail);
        });
    } else if (kind === 'wire') {
        // Cuộn dây đồng
        const coil = new THREE.Mesh(new THREE.TubeGeometry(new _HelixCurve(0.45, 1.3, 7), 420, 0.055, 14), _metalMat(opts.color ?? 0xc8743c, 0.22));
        group.add(coil);
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.7, 14), _metalMat(opts.color ?? 0xc8743c, 0.22));
        tail.position.set(0.45, 0.95, 0); tail.rotation.z = -0.35;
        group.add(tail);
    } else if (kind === 'ribbon') {
        // Băng magie cuộn tròn
        const shape = new THREE.Shape();
        shape.moveTo(-0.11, -0.012); shape.lineTo(0.11, -0.012); shape.lineTo(0.11, 0.012); shape.lineTo(-0.11, 0.012); shape.closePath();
        const ribbon = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { steps: 360, extrudePath: new _HelixCurve(0.5, 0.9, 3.2), bevelEnabled: false }),
            _metalMat(opts.color ?? 0xc9ced4, 0.2)
        );
        group.add(ribbon);
    } else if (kind === 'chunk') {
        // Mẩu kim loại kiềm: mặt cắt sáng bóng, phần vỏ xỉn do oxi hóa
        const dull = new THREE.MeshStandardMaterial({ color: _lin(0x8f969d), metalness: 0.55, roughness: 0.7 });
        const sq = new THREE.Shape();
        sq.moveTo(-0.6, -0.42); sq.lineTo(0.6, -0.42); sq.lineTo(0.55, 0.42); sq.lineTo(-0.62, 0.38); sq.closePath();
        const bgeo = new THREE.ExtrudeGeometry(sq, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3 });
        bgeo.center();
        group.add(new THREE.Mesh(bgeo, dull));
        // Mặt vừa cắt bằng dao: sáng bóng như bạc
        const cutShape = new THREE.Shape();
        cutShape.moveTo(-0.52, -0.34); cutShape.lineTo(0.52, -0.34); cutShape.lineTo(0.47, 0.34); cutShape.lineTo(-0.54, 0.3); cutShape.closePath();
        const cut = new THREE.Mesh(new THREE.ShapeGeometry(cutShape), _metalMat(opts.color ?? 0xd8dde3, 0.05));
        cut.position.z = 0.485;
        group.add(cut);
    } else if (kind === 'granules') {
        // Viên kim loại (kẽm hạt...) chất thành đống nhỏ
        const mat = _metalMat(opts.color ?? 0xa9b3bb, 0.35);
        for (let i = 0; i < 16; i++) {
            const g = new THREE.Mesh(_rockGeometry(0.22 + Math.random() * 0.1, 0.5, 1), mat);
            const a = Math.random() * Math.PI * 2, r = Math.random() * 0.55;
            g.position.set(Math.cos(a) * r, 0.12 + (0.55 - r) * 0.5 * Math.random(), Math.sin(a) * r);
            g.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            group.add(g);
        }
    } else {
        // Thỏi kim loại hình thang, vát cạnh
        const shape = new THREE.Shape();
        shape.moveTo(-0.85, -0.3); shape.lineTo(0.85, -0.3); shape.lineTo(0.68, 0.3); shape.lineTo(-0.68, 0.3); shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4 });
        geo.center();
        group.add(new THREE.Mesh(geo, _metalMat(opts.color ?? 0xbfc5cc, opts.roughness ?? 0.22)));
    }

    _finishScene(container, ctx, group, null, {
        sway: 0.7,
        amount: (v) => {
            const k = v <= 0.01 ? 0 : Math.min(Math.max(Math.cbrt(v), 0.4), 1.25);
            group.scale.setScalar(Math.max(k, 0.001));
            group.visible = k > 0;
        }
    });
}

// ============================================================
//  5. CHẤT RẮN TRÊN MẶT KÍNH ĐỒNG HỒ (bột, viên, đá, tinh thể)
// ============================================================
function drawSolidOnDish(container, formula, opts = {}) {
    const ctx = _setupScene(container);
    const group = new THREE.Group(); ctx.scene.add(group);
    const kind = opts.kind || 'powder';
    const color = _lin(opts.color ?? 0xf0f0f0);

    // Mặt kính đồng hồ (chỏm cầu nông)
    const dishPts = [];
    for (let i = 0; i <= 16; i++) {
        const r = (i / 16) * 0.92;
        dishPts.push([r, 0.14 * (r / 0.92) ** 2 - 0.02]);
    }
    for (let i = 16; i >= 0; i--) {
        const r = (i / 16) * 0.88;
        dishPts.push([r, 0.14 * (r / 0.88) ** 2 + 0.01]);
    }
    const dish = new THREE.Mesh(_lathe(dishPts), _glassMat({ opacity: 0.35, color: 0xdfeaf5 }));
    dish.renderOrder = 10;
    group.add(dish);
    // Phần chất rắn (co giãn theo lượng chất), tách khỏi mặt kính
    const content = new THREE.Group();
    group.add(content);

    const matte = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.92, metalness: opts.metalness ?? 0 });

    if (kind === 'powder') {
        // Đống bột hình nón thấp, bề mặt gồ ghề
        // Profile từ mép ngoài lên đỉnh (để pháp tuyến hướng ra ngoài)
        const pts = [];
        for (let i = 20; i >= 0; i--) {
            const r = (i / 20) * 0.72;
            pts.push([r, 0.03 + 0.62 * Math.pow(1 - r / 0.72, 1.35)]);
        }
        const geo = _lathe(pts, 64);
        const pos = geo.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            if (v.y > 0.05) v.y += (_hashNoise(Math.round(v.x * 40), 0, Math.round(v.z * 40)) - 0.5) * 0.05;
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        geo.computeVertexNormals();
        content.add(new THREE.Mesh(geo, matte));
        // Vài hạt rơi vãi xung quanh
        for (let i = 0; i < 26; i++) {
            const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.025 + Math.random() * 0.02, 0), matte);
            const a = Math.random() * Math.PI * 2, r = 0.7 + Math.random() * 0.12;
            p.position.set(Math.cos(a) * r, 0.03 + 0.14 * (r / 0.88) ** 2, Math.sin(a) * r);
            content.add(p);
        }
    } else if (kind === 'pellets') {
        const geo = new THREE.SphereGeometry(0.13, 20, 14);
        for (let i = 0; i < 34; i++) {
            const p = new THREE.Mesh(geo, matte);
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.6;
            // xếp thành đống: càng gần tâm càng cao
            p.position.set(Math.cos(a) * r, 0.1 + (0.6 - r) * 0.7 * Math.random() + 0.14 * (r / 0.88) ** 2, Math.sin(a) * r);
            p.scale.set(1, 0.62, 1);
            p.rotation.set(Math.random(), Math.random(), Math.random());
            content.add(p);
        }
    } else if (kind === 'rocks') {
        const rockMat = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0, flatShading: true });
        [[0, 0.36, 0, 0.46], [-0.45, 0.22, 0.2, 0.3], [0.44, 0.2, -0.16, 0.29], [0.16, 0.16, 0.48, 0.22], [-0.28, 0.16, -0.45, 0.21]]
            .forEach(([x, y, z, r]) => {
                const m = new THREE.Mesh(_rockGeometry(r, 0.45, 1), rockMat);
                m.position.set(x, y, z);
                m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
                content.add(m);
            });
    } else if (kind === 'crystals') {
        const crystalMat = new THREE.MeshPhysicalMaterial({
            color, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85,
            clearcoat: 1, envMapIntensity: 2, flatShading: true
        });
        for (let i = 0; i < 9; i++) {
            const h = 0.55 + Math.random() * 0.75;
            const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), crystalMat);
            c.scale.set(1, h / 0.4, 1);
            const a = (i / 9) * Math.PI * 2, r = i === 0 ? 0 : 0.2 + Math.random() * 0.3;
            c.position.set(Math.cos(a) * r, 0.05 + h * 0.45, Math.sin(a) * r);
            c.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 3, (Math.random() - 0.5) * 0.7);
            content.add(c);
        }
    }

    _finishScene(container, ctx, group, null, {
        sway: 0.8, margin: 0.88,
        amount: (v) => {
            const k = v <= 0.01 ? 0 : Math.min(Math.max(Math.cbrt(v), 0.35), 1.3);
            content.scale.setScalar(Math.max(k, 0.001));
            content.visible = k > 0;
        }
    });
}

// ── Tương thích ngược: tên hàm cũ vẫn dùng được ──────────────────────
function drawColoredSolution(container, formula, hexColor) { drawBeaker(container, formula, { liquid: hexColor }); }
function drawPrecipitate(container, formula, hexColor) { drawBeaker(container, formula, { liquid: 0x9cc8f0, precipitate: hexColor }); }
function drawGas(container, formula, hexColor, opacityScale) { drawGasJar(container, formula, { color: hexColor, density: opacityScale }); }
function drawAcidBottle(container, formula) { drawReagentBottle(container, formula, { acid: true }); }
function drawGenericBottle(container, formula) { drawReagentBottle(container, formula, {}); }
var drawGasCloud = (container, formula) => drawGasJar(container, formula, { color: 0xffffff, density: 0.2 });

// ---- Text fallback if Three.js not loaded ----
function renderFallbackText(formula, container) {
    container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:4px;">
            <div style="font-size:1.8rem;font-weight:900;color:#3b82f6;font-family:'Fira Code',monospace;
                 text-shadow:0 0 16px rgba(59,130,246,0.7);">${formula}</div>
        </div>`;
}
