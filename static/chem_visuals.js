// ============================================================
//  chem_visuals.js — Real-World 3D Metaphor Renderers (Three.js)
// ============================================================

const _chemAnimIds = new Map(); // containerId -> animationFrameId
const _chemRenderers = new Map(); // containerId -> { renderer, scene, animId }

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
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose && m.dispose());
            } else if (obj.material.dispose) {
                obj.material.dispose();
            }
        } catch(e) {}
    }
}

function stopChemAnim(containerId) {
    if (!containerId) return;
    if (_chemRenderers.has(containerId)) {
        const item = _chemRenderers.get(containerId);
        if (item.animId) cancelAnimationFrame(item.animId);
        if (item.scene) _disposeThreeHierarchy(item.scene);
        if (item.renderer) {
            try {
                item.renderer.dispose();
                item.renderer.forceContextLoss();
                if (item.renderer.domElement && item.renderer.domElement.parentNode) {
                    item.renderer.domElement.parentNode.removeChild(item.renderer.domElement);
                }
            } catch(e) {}
        }
        _chemRenderers.delete(containerId);
    }
    if (_chemAnimIds.has(containerId)) {
        cancelAnimationFrame(_chemAnimIds.get(containerId));
        _chemAnimIds.delete(containerId);
    }
}

window.disposeAllChemRenderers = function() {
    for (const id of Array.from(_chemRenderers.keys())) {
        stopChemAnim(id);
    }
    for (const id of Array.from(_chemAnimIds.keys())) {
        stopChemAnim(id);
    }
};

// Main dispatcher — supports 70+ compounds
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

    const map = {
        'H2O':   drawWater,
        'H3O':   drawWater,
        'H3O+':  drawWater,
        'H+':    drawAcidBottle,
        'OH-':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'CL-':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'SO42-': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NO3-':  (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'HSO4-': drawAcidBottle,
        'CO32-': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'HCO3-': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'CO2':   drawCO2Tank,
        'H2CO3': drawFlask,
        'O2':    drawO2Bubbles,
        'H2':    drawH2Bubbles,
        'NACL':  (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'KCL':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'CACL2': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'BACL2': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NA2SO4':(c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'K2SO4': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NANO3': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'KNO3':  (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NA2CO3':(c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'K2CO3': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NAOH':  (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'KOH':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'HCL':   drawAcidBottle,
        'H2SO4': drawAcidBottle,
        'HNO3':  drawAcidBottle,
        'H3PO4': drawAcidBottle,
        'CH3COOH': drawAcidBottle,
        'FE':    drawIronBlock,
        'FE2O3': drawRustedIron,
        'FE3O4': drawRustedIron,
        'NA':    drawSodiumMetal,
        'K':     drawSodiumMetal,
        'LI':    drawSodiumMetal,
        'AG':    drawSodiumMetal,
        'AU':    drawCopperBlock,
        'CH4':   drawGasCloud,
        'C':     drawCoalChunk,
        'CA':    drawMetalBlock,
        'MG':    drawMetalBlock,
        'AL':    drawMetalBlock,
        'ZN':    drawMetalBlock,
        'BA':    drawMetalBlock,
        'MN':    drawMetalBlock,
        'NI':    drawMetalBlock,
        'SN':    drawMetalBlock,
        'PB':    drawIronBlock,
        'CR':    drawMetalBlock,
        'CU':    drawCopperBlock,
        'CACO3': drawLimestone,
        'CASO4': drawCrystalBlock,
        'CAO':   drawWhitePellets,
        'S':     drawCrystalBlock,

        // ── KẾT TỦA (PRECIPITATES) ──────────────────────────────
        'CU(OH)2': (c,f) => drawPrecipitate(c, f, 0x1565c0),  // xanh lam
        'CUOH2':   (c,f) => drawPrecipitate(c, f, 0x1565c0),
        'FE(OH)3': (c,f) => drawPrecipitate(c, f, 0x8d2800),  // nâu đỏ
        'FEOH3':   (c,f) => drawPrecipitate(c, f, 0x8d2800),
        'FE(OH)2': (c,f) => drawPrecipitate(c, f, 0x4a7c59),  // xanh trắng
        'FEOH2':   (c,f) => drawPrecipitate(c, f, 0x4a7c59),
        'AL(OH)3': (c,f) => drawPrecipitate(c, f, 0xe0e0e0),  // trắng keo
        'ALOH3':   (c,f) => drawPrecipitate(c, f, 0xe0e0e0),
        'ZN(OH)2': (c,f) => drawPrecipitate(c, f, 0xd0d0d0),  // trắng
        'ZNOH2':   (c,f) => drawPrecipitate(c, f, 0xd0d0d0),
        'MG(OH)2': (c,f) => drawPrecipitate(c, f, 0xf0f0f0),  // trắng
        'MGOH2':   (c,f) => drawPrecipitate(c, f, 0xf0f0f0),
        'CA(OH)2': (c,f) => drawWhitePellets(c, f),            // vôi tôi
        'CAOH2':   (c,f) => drawWhitePellets(c, f),
        'BA(OH)2': (c,f) => drawWhitePellets(c, f),
        'BAOH2':   (c,f) => drawWhitePellets(c, f),
        'CR(OH)3': (c,f) => drawPrecipitate(c, f, 0x5a7a5a),  // xanh xám
        'CROH3':   (c,f) => drawPrecipitate(c, f, 0x5a7a5a),
        'NI(OH)2': (c,f) => drawPrecipitate(c, f, 0x66bb66),  // xanh nhạt
        'NIOH2':   (c,f) => drawPrecipitate(c, f, 0x66bb66),
        'CO(OH)2': (c,f) => drawPrecipitate(c, f, 0xee5599),  // hồng
        'COOH2':   (c,f) => drawPrecipitate(c, f, 0xee5599),
        'MN(OH)2': (c,f) => drawPrecipitate(c, f, 0xffbbaa),  // trắng hồng
        'MNOH2':   (c,f) => drawPrecipitate(c, f, 0xffbbaa),
        'AGCL':    (c,f) => drawPrecipitate(c, f, 0xf0f0f0),  // trắng
        'AGBR':    (c,f) => drawPrecipitate(c, f, 0xe0d070),  // vàng nhạt
        'AGI':     (c,f) => drawPrecipitate(c, f, 0xd4b800),  // vàng
        'AG2S':    (c,f) => drawPrecipitate(c, f, 0x111111),  // đen
        'BASO4':   (c,f) => drawPrecipitate(c, f, 0xf8f8f8),  // trắng
        'BACO3':   (c,f) => drawPrecipitate(c, f, 0xf5f5f5),  // trắng
        'PBSO4':   (c,f) => drawPrecipitate(c, f, 0xfafafa),  // trắng
        'PBCL2':   (c,f) => drawPrecipitate(c, f, 0xfafafa),  // trắng
        'PBCRO4':  (c,f) => drawPrecipitate(c, f, 0xffcc00),  // vàng
        'PBS':     (c,f) => drawPrecipitate(c, f, 0x111111),  // đen
        'CUS':     (c,f) => drawPrecipitate(c, f, 0x111111),  // đen
        'FES':     (c,f) => drawPrecipitate(c, f, 0x111111),  // đen
        'ZNS':     (c,f) => drawPrecipitate(c, f, 0xfafafa),  // trắng
        'NIS':     (c,f) => drawPrecipitate(c, f, 0x111111),  // đen
        'MNO2':    (c,f) => drawPrecipitate(c, f, 0x1a1a1a),  // đen
        'CU2O':    (c,f) => drawPrecipitate(c, f, 0xcc3300),  // đỏ gạch

        // ── KHÍ (GASES) ─────────────────────────────────────────
        'CL2': (c,f) => drawGas(c, f, 0x7cb800, 0.82),  // vàng lục đặc trưng
        'NO2': (c,f) => drawGas(c, f, 0xb05000, 0.88),  // nâu đỏ
        'SO2': (c,f) => drawGas(c, f, 0xd4d460, 0.56),  // vàng nhạt
        'SO3': (c,f) => drawGas(c, f, 0xddddbb, 0.48),  // không màu
        'NH3': (c,f) => drawGas(c, f, 0x8888ee, 0.42),  // xanh nhạt
        'NO':  (c,f) => drawGas(c, f, 0xaaaaaa, 0.38),  // không màu
        'CO':  (c,f) => drawGas(c, f, 0x999999, 0.38),  // không màu
        'H2S': (c,f) => drawGas(c, f, 0xcccc88, 0.42),  // vàng nhạt
        'F2':  (c,f) => drawGas(c, f, 0xddee20, 0.62),  // vàng
        'BR2': (c,f) => drawGas(c, f, 0x991100, 0.78),  // đỏ nâu
        'I2':  (c,f) => drawGas(c, f, 0x550088, 0.65),  // tím
        'HCL(G)': (c,f) => drawGas(c, f, 0xcccccc, 0.40),  // khí hidro clorua

        // ── DUNG DỊCH MÀU & MUỐI TAN (SOLUTIONS) ──────────────────
        'CUSO4':     (c,f) => drawColoredSolution(c, f, 0x0044cc),  // xanh lam đậm
        'CU(NO3)2':  (c,f) => drawColoredSolution(c, f, 0x1199cc),  // xanh lam
        'CUNO32':    (c,f) => drawColoredSolution(c, f, 0x1199cc),
        'CUCL2':     (c,f) => drawColoredSolution(c, f, 0x1199cc),  // xanh
        'KMNO4':     (c,f) => drawColoredSolution(c, f, 0x7700bb),  // tím
        'K2CR2O7':   (c,f) => drawColoredSolution(c, f, 0xff5500),  // da cam
        'K2CRO4':    (c,f) => drawColoredSolution(c, f, 0xddcc00),  // vàng
        'FECL3':     (c,f) => drawColoredSolution(c, f, 0xbb7700),  // nâu vàng
        'FE2(SO4)3': (c,f) => drawColoredSolution(c, f, 0xbb7700),  // nâu vàng
        'FE2SO43':   (c,f) => drawColoredSolution(c, f, 0xbb7700),
        'FE(NO3)3':  (c,f) => drawColoredSolution(c, f, 0xbb7700),
        'FENO33':    (c,f) => drawColoredSolution(c, f, 0xbb7700),
        'FECL2':     (c,f) => drawColoredSolution(c, f, 0x66aa55),  // xanh nhạt
        'FESO4':     (c,f) => drawColoredSolution(c, f, 0x55aa44),  // xanh nhạt
        'FE(NO3)2':  (c,f) => drawColoredSolution(c, f, 0x66aa55),
        'FENO32':    (c,f) => drawColoredSolution(c, f, 0x66aa55),
        'AL2(SO4)3': (c,f) => drawColoredSolution(c, f, 0xeeeeff),  // không màu
        'AL2SO43':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'ALCL3':     (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'AL(NO3)3':  (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'ALNO33':    (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'MGSO4':     (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'MGCL2':     (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'ZNCL2':     (c,f) => drawColoredSolution(c, f, 0xddeeff),
        'ZNSO4':     (c,f) => drawColoredSolution(c, f, 0xddeeff),
        'AGNO3':     (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NH4CL':     (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        '(NH4)2SO4': (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NH42SO4':   (c,f) => drawColoredSolution(c, f, 0xeeeeff),
        'NISO4':     (c,f) => drawColoredSolution(c, f, 0x44bb33),  // xanh lá
        'NICL2':     (c,f) => drawColoredSolution(c, f, 0x44bb33),
        'COCL2':     (c,f) => drawColoredSolution(c, f, 0xdd3388),  // hồng đỏ
        'COSO4':     (c,f) => drawColoredSolution(c, f, 0xdd3388),
        'MNCL2':     (c,f) => drawColoredSolution(c, f, 0xffaaaa),  // hồng nhạt
        'MNSO4':     (c,f) => drawColoredSolution(c, f, 0xffbbaa),
        'CRCL3':     (c,f) => drawColoredSolution(c, f, 0x228833),  // xanh lá tối
    };

    (map[norm] || map[normNP] || drawGenericBottle)(container, formula);
}

// ---- SCENE SETUP HELPER ----
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

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
    camera.position.set(0, 0.1, 3.7);
    camera.lookAt(0, 0.1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    // TV OPT: Giới hạn pixelRatio = 1.0 trên màn hình lớn để chống quá tải GPU của TV
    const isLargeScreen = (window.innerWidth >= 1600) || /SmartTV|Tizen|Web0S|BRAVIA|Android TV/i.test(navigator.userAgent);
    renderer.setPixelRatio(isLargeScreen ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(W, H);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting rig (Brightened for dark background)
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    
    const key = new THREE.DirectionalLight(0xffffff, 4.0);
    key.position.set(5, 5, 5); scene.add(key);
    
    const fill = new THREE.DirectionalLight(0x88bbff, 2.0);
    fill.position.set(-5, 3, -5); scene.add(fill);
    
    const topLight = new THREE.PointLight(0xffffff, 3.0, 20);
    topLight.position.set(0, 4, 0); scene.add(topLight);

    _chemRenderers.set(container.id, { renderer, scene, animId: null });

    return { scene, camera, renderer, W, H };
}

function _animate(containerId, renderer, scene, camera, group, extra) {
    function tick() {
        const id = requestAnimationFrame(tick);
        _chemAnimIds.set(containerId, id);
        if (_chemRenderers.has(containerId)) {
            _chemRenderers.get(containerId).animId = id;
        }
        if (group) group.rotation.y += 0.010;
        if (extra) extra(tick);
        renderer.render(scene, camera);
    }
    tick();
}

// ---- HELPER: Draw Beaker with optional bubbles ----
function drawBeakerHelper(container, formula, liqColor, hasBubbles) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    // Beaker Glass (Cylinder) - Brighter
    const glassGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.0, 32, 1, true);
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xccf0ff, transparent: true, opacity: 0.25,
        roughness: 0.05, metalness: 0.1, transmission: 0.5, ior: 1.5, 
        side: THREE.DoubleSide, depthWrite: false // CRITICAL: Allows liquid inside to be visible
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    group.add(glass);

    // Beaker Bottom
    const bottomGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.1, 32);
    const bottom = new THREE.Mesh(bottomGeo, glassMat);
    bottom.position.y = -1.05;
    group.add(bottom);

    // Beaker Lip
    const lipGeo = new THREE.TorusGeometry(0.8, 0.05, 16, 32);
    const lipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.6 });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.position.y = 1.0;
    lip.rotation.x = Math.PI / 2;
    group.add(lip);

    // Liquid
    const liqHeight = 1.2;
    const liqGeo = new THREE.CylinderGeometry(0.77, 0.77, liqHeight, 32);
    const liqMat = new THREE.MeshStandardMaterial({
        color: liqColor, transparent: true, opacity: 0.85, 
        roughness: 0.1, emissive: liqColor, emissiveIntensity: 0.2, depthWrite: false
    });
    const liq = new THREE.Mesh(liqGeo, liqMat);
    liq.position.y = -1.0 + liqHeight/2;
    group.add(liq);

    // Liquid Surface (Top)
    const surfGeo = new THREE.CircleGeometry(0.77, 32);
    const surfMat = new THREE.MeshStandardMaterial({
        color: liqColor, transparent: true, opacity: 0.9, roughness: 0.1,
        emissive: liqColor, emissiveIntensity: 0.3, depthWrite: false
    });
    const surf = new THREE.Mesh(surfGeo, surfMat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = -1.0 + liqHeight + 0.01;
    group.add(surf);

    const bubbles = [];
    if (hasBubbles) {
        for (let i = 0; i < 120; i++) {
            const r = 0.02 + Math.random() * 0.04;
            const b = new THREE.Mesh(
                new THREE.SphereGeometry(r, 8, 8),
                new THREE.MeshStandardMaterial({ 
                    color: 0xffffff, roughness: 0.1,
                    emissive: 0xffffff, emissiveIntensity: 1.0 
                })
            );
            const theta = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.65; // Stay well inside liquid radius 0.77
            b.userData.baseX = Math.cos(theta) * radius;
            b.userData.baseZ = Math.sin(theta) * radius;
            b.position.set(b.userData.baseX, -1.0 + Math.random()*liqHeight, b.userData.baseZ);
            
            b.userData.vy = 0.03 + Math.random()*0.04; 
            b.userData.t = Math.random() * Math.PI * 2;
            group.add(b);
            bubbles.push(b);
        }
    }

    _animate(container.id, renderer, scene, camera, group, () => {
        if (hasBubbles) {
            bubbles.forEach(b => {
                b.userData.t += 0.1;
                b.position.y += b.userData.vy;
                b.position.x = b.userData.baseX + Math.sin(b.userData.t) * 0.03; // Sway around base position
                if (b.position.y > -1.0 + liqHeight) { 
                    b.position.y = -1.0; 
                }
            });
        }
    });
}

// ---- H2O: Beaker of Water ----
function drawWater(container, formula) {
    drawBeakerHelper(container, formula, 0x0033cc, false); // Deep blue water
}

// ---- H2CO3: Beaker with Bubbling Carbonic Acid ----
function drawFlask(container, formula) {
    drawBeakerHelper(container, formula, 0x0033cc, true); // Deep blue bubbling water
}

// ---- CO2: Rising Bubbles ----
function drawCO2Tank(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    for (let i = 0; i < 40; i++) {
        const r = 0.08 + Math.random() * 0.15;
        const b = new THREE.Mesh(
            new THREE.SphereGeometry(r, 16, 16),
            new THREE.MeshStandardMaterial({
                color: 0xffffff, transparent: true, opacity: 0.8,
                roughness: 0.1, emissive: 0xaaddff, emissiveIntensity: 0.6
            })
        );
        b.position.set((Math.random()-0.5)*1.8, (Math.random()-0.5)*2.5, (Math.random()-0.5)*1.2);
        b.userData.vy = 0.015 + Math.random()*0.02;
        b.userData.t = Math.random()*Math.PI*2;
        group.add(b);
    }

    _animate(container.id, renderer, scene, camera, group, () => {
        group.children.forEach(b => {
            b.userData.t += 0.04;
            b.position.y += b.userData.vy;
            b.position.x += Math.sin(b.userData.t)*0.008;
            if (b.position.y > 2.0) b.position.y = -2.0;
        });
    });
}

// ---- O2: Cyan Bubbles ----
function drawO2Bubbles(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    for (let i = 0; i < 18; i++) {
        const r = 0.12 + Math.random() * 0.22;
        const b = new THREE.Mesh(
            new THREE.SphereGeometry(r, 16, 16),
            new THREE.MeshPhysicalMaterial({
                color: 0x44ddff, transparent: true, opacity: 0.35 + Math.random()*0.3,
                roughness: 0.05, transmission: 0.6, thickness: 0.3
            })
        );
        b.position.set((Math.random()-0.5)*2.4, (Math.random()-0.5)*2.4, (Math.random()-0.5)*1.2);
        b.userData.vy = 0.008 + Math.random()*0.01;
        b.userData.t = Math.random()*Math.PI*2;
        group.add(b);
    }

    _animate(container.id, renderer, scene, camera, group, () => {
        group.children.forEach(b => {
            b.userData.t += 0.02;
            b.position.y += b.userData.vy;
            b.position.x += Math.sin(b.userData.t)*0.003;
            if (b.position.y > 1.8) b.position.y = -1.8;
        });
    });
}

// ---- H2 / CH4: Gas Cloud ----
function drawH2Bubbles(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    for (let i = 0; i < 22; i++) {
        const r = 0.08 + Math.random() * 0.18;
        const b = new THREE.Mesh(
            new THREE.SphereGeometry(r, 12, 12),
            new THREE.MeshPhysicalMaterial({
                color: 0xeeeeff, transparent: true, opacity: 0.2 + Math.random()*0.35,
                roughness: 0.1, transmission: 0.5
            })
        );
        b.position.set((Math.random()-0.5)*2.5, (Math.random()-0.5)*2.5, (Math.random()-0.5)*1);
        b.userData.vy = 0.01 + Math.random()*0.012;
        b.userData.t = Math.random()*Math.PI*2;
        group.add(b);
    }

    _animate(container.id, renderer, scene, camera, group, () => {
        group.children.forEach(b => {
            b.userData.t += 0.025;
            b.position.y += b.userData.vy;
            b.position.x += Math.sin(b.userData.t)*0.005;
            if (b.position.y > 2.0) b.position.y = -2.0;
        });
    });
}
drawGasCloud = drawH2Bubbles;

// ---- NaCl: Salt Crystals ----
function drawSaltCrystals(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.15, metalness: 0,
        transparent: true, opacity: 0.75, transmission: 0.3
    });

    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const s = 0.28 + Math.random()*0.08;
                const cube = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
                cube.position.set(x*0.45, y*0.45, z*0.45);
                cube.rotation.set(Math.random(), Math.random(), Math.random());
                group.add(cube);
            }
        }
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- NaOH: White Pellets ----
function drawWhitePellets(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const mat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0 });

    for (let i = 0; i < 28; i++) {
        const r = 0.14 + Math.random()*0.1;
        const p = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), mat);
        p.position.set((Math.random()-0.5)*2.2, (Math.random()-0.5)*1.6, (Math.random()-0.5)*1.5);
        group.add(p);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- HCl / H2SO4: Acid Bottle ----
function drawAcidBottle(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const isHSO = formula.toUpperCase().includes('SO');
    const liqColor = isHSO ? 0xddcc44 : 0x88ff88;

    // Bottle shape
    const pts = [
        [0.06,1.8],[0.08,1.4],[0.1,1.1],[0.35,0.7],
        [0.55,0.2],[0.6,-0.4],[0.6,-1.2],[0.0,-1.2]
    ].map(([x,y])=>new THREE.Vector2(x,y));

    group.add(new THREE.Mesh(
        new THREE.LatheGeometry(pts, 36),
        new THREE.MeshPhysicalMaterial({
            color: 0xaabbdd, transparent: true, opacity: 0.28,
            roughness: 0.05, transmission: 0.7, thickness: 0.4
        })
    ));

    // Liquid
    const liqPts = [
        [0.0,-1.15],[0.5,-1.15],[0.52,-0.2],[0.28,0.5],[0.0,0.55]
    ].map(([x,y])=>new THREE.Vector2(x,y));
    group.add(new THREE.Mesh(
        new THREE.LatheGeometry(liqPts, 32),
        new THREE.MeshStandardMaterial({ color: liqColor, transparent: true, opacity: 0.6, roughness: 0.1 })
    ));

    // Cap
    const capMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.1, 0.25, 20),
        new THREE.MeshStandardMaterial({ color: 0xff3300, roughness: 0.5 })
    );
    capMesh.position.set(0, 1.9, 0);
    group.add(capMesh);

    // Label
    const labelMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.605, 0.605, 0.7, 36, 1, true),
        new THREE.MeshStandardMaterial({ color: isHSO ? 0xaa0000 : 0x00aa44, roughness: 0.9, side: THREE.FrontSide })
    );
    labelMesh.position.set(0, -0.1, 0);
    group.add(labelMesh);

    _animate(container.id, renderer, scene, camera, group);
}

// ---- Fe: Iron Block ----
function drawIronBlock(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const mat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9, roughness: 0.4 });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), mat));

    // Some bolt holes
    for (let i = -1; i <= 1; i += 2) {
        const bolt = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16),
            new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 1, roughness: 0.3 })
        );
        bolt.rotation.z = Math.PI/2;
        bolt.position.set(i*0.55, 0.3, 0.45);
        group.add(bolt);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Fe2O3: Rusted Iron ----
function drawRustedIron(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.0, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x8B3A0F, metalness: 0.2, roughness: 0.9 })
    ));
    // Rust patches
    for (let i = 0; i < 12; i++) {
        const patch = new THREE.Mesh(
            new THREE.SphereGeometry(0.12 + Math.random()*0.12, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0xcc5500, roughness: 1, metalness: 0 })
        );
        patch.position.set((Math.random()-0.5)*1.4, (Math.random()-0.5)*0.8, 0.45);
        patch.scale.z = 0.2;
        group.add(patch);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Na: Shiny Silver Metal ----
function drawSodiumMetal(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const mat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.95, roughness: 0.08 });
    // Irregular chunk: multiple spheres merged visually
    const positions = [[0,0,0],[0.4,0.2,0.1],[-0.3,0.15,-0.15],[0.1,-0.3,0.2],[-0.15,0.3,0.3]];
    positions.forEach(([x,y,z]) => {
        const r = 0.45 + Math.random()*0.2;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 20), mat);
        m.position.set(x, y, z);
        group.add(m);
    });
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Generic metal block (Ca, Mg, Al, Zn) ----
function drawMetalBlock(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);
    const colors = { CA: 0xc0b0a0, MG: 0xaaaaaa, AL: 0xc8d0d8, ZN: 0xaabbaa };
    const norm = formula.toUpperCase();
    const color = colors[norm] || 0xaaaaaa;
    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.4, 0.7),
        new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.22 })
    ));
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Cu: Copper Block ----
function drawCopperBlock(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);
    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.4, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xB87333, metalness: 0.9, roughness: 0.18 })
    ));
    _animate(container.id, renderer, scene, camera, group);
}

// ---- CaCO3: Limestone ----
function drawLimestone(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);
    const mat = new THREE.MeshStandardMaterial({ color: 0xddd8cc, roughness: 0.85, metalness: 0 });
    for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + Math.random()*0.2), mat);
        s.position.set((Math.random()-0.5)*1.8,(Math.random()-0.5)*1.2,(Math.random()-0.5)*1.2);
        s.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
        group.add(s);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- CaSO4: Crystal ----
function drawCrystalBlock(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xeef0ff, roughness: 0.08, metalness: 0,
        transparent: true, opacity: 0.7, transmission: 0.5
    });
    for (let i = 0; i < 5; i++) {
        const h = 0.6 + Math.random()*0.8;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, h, 8), mat);
        c.position.set((Math.random()-0.5)*1.6,(Math.random()-0.5)*0.8,(Math.random()-0.5)*0.8);
        c.rotation.set(Math.random()*0.3, 0, Math.random()*0.3);
        group.add(c);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Coal chunk ----
function drawCoalChunk(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.15 });
    for (let i = 0; i < 7; i++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + Math.random()*0.22), mat);
        s.position.set((Math.random()-0.5)*1.6,(Math.random()-0.5)*1.2,(Math.random()-0.5)*1.0);
        group.add(s);
    }
    _animate(container.id, renderer, scene, camera, group);
}

// ---- Generic bottle fallback ----
function drawGenericBottle(container, formula) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group(); scene.add(group);

    const pts = [
        [0.06,1.6],[0.08,1.3],[0.1,1.05],[0.4,0.6],[0.6,0.0],[0.62,-0.8],[0.62,-1.3],[0.0,-1.3]
    ].map(([x,y])=>new THREE.Vector2(x,y));

    group.add(new THREE.Mesh(
        new THREE.LatheGeometry(pts, 36),
        new THREE.MeshPhysicalMaterial({
            color: 0x88aacc, transparent: true, opacity: 0.35,
            roughness: 0.05, transmission: 0.65, thickness: 0.4
        })
    ));

    // Liquid (random hue from formula hash)
    let hash = 0; for (const c of formula) hash += c.charCodeAt(0);
    const hue = (hash * 137) % 360;
    const liqPts = [
        [0.0,-1.25],[0.52,-1.25],[0.54,-0.2],[0.32,0.4],[0.0,0.45]
    ].map(([x,y])=>new THREE.Vector2(x,y));
    group.add(new THREE.Mesh(
        new THREE.LatheGeometry(liqPts,32),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue},60%,55%)`), transparent:true, opacity:0.55 })
    ));

    _animate(container.id, renderer, scene, camera, group);
}

// ── KẾT TỦA (PRECIPITATE) — hạt màu lắng xuống đáy bình ─────────────
function drawPrecipitate(container, formula, hexColor) {
    const { scene, camera, renderer } = _setupScene(container);
    const group = new THREE.Group();
    scene.add(group);

    // Glass beaker — open-top translucent cylinder
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xd0f0ff, transparent: true, opacity: 0.18,
        roughness: 0.05, metalness: 0.0, transmission: 0.55, ior: 1.5,
        side: THREE.DoubleSide, depthWrite: false
    });
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.80, 2.2, 32, 1, true), glassMat));

    // Beaker bottom
    const botMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.80, 0.80, 0.08, 32), glassMat);
    botMesh.position.y = -1.14;
    group.add(botMesh);

    // Beaker rim
    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.04, 12, 32),
        new THREE.MeshStandardMaterial({ color: 0xbbddff, transparent: true, opacity: 0.55, roughness: 0.08 })
    );
    rim.position.y = 1.1; rim.rotation.x = Math.PI / 2;
    group.add(rim);

    // Water — semi-transparent blue fill
    const waterH    = 1.6;
    const waterBotY = -1.14 + 0.08;
    const waterMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.77, 0.77, waterH, 32),
        new THREE.MeshStandardMaterial({ color: 0x1a3a6a, transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false })
    );
    waterMesh.position.y = waterBotY + waterH / 2;
    group.add(waterMesh);

    // Water surface
    const surfMesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.77, 32),
        new THREE.MeshStandardMaterial({ color: 0x2255aa, transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false })
    );
    surfMesh.rotation.x = -Math.PI / 2;
    surfMesh.position.y = waterBotY + waterH;
    group.add(surfMesh);

    // Precipitate sediment layer at bottom
    const pHeight = 0.35;
    const pBotY   = waterBotY;
    const pLayer  = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, pHeight, 32),
        new THREE.MeshStandardMaterial({
            color: hexColor, roughness: 0.80, metalness: 0.05,
            emissive: hexColor, emissiveIntensity: 0.25
        })
    );
    pLayer.position.y = pBotY + pHeight / 2;
    group.add(pLayer);

    // Falling precipitate particles
    const topY  = waterBotY + waterH - 0.1;
    const landY = pBotY + pHeight;
    const pMat  = new THREE.MeshStandardMaterial({
        color: hexColor, roughness: 0.35, metalness: 0.08,
        emissive: hexColor, emissiveIntensity: 0.55,
        transparent: true, opacity: 0.88, depthWrite: false
    });
    const particles = [];
    for (let i = 0; i < 72; i++) {
        const r = 0.022 + Math.random() * 0.042;
        const p = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 7), pMat);
        const theta = Math.random() * Math.PI * 2;
        const rad   = Math.random() * 0.68;
        p.position.set(Math.cos(theta)*rad, landY + Math.random()*(topY-landY), Math.sin(theta)*rad);
        p.userData.vy = -(0.006 + Math.random() * 0.009);
        p.userData.t  = Math.random() * Math.PI * 2;
        group.add(p);
        particles.push(p);
    }

    _animate(container.id, renderer, scene, camera, null, () => {
        group.rotation.y += 0.006;
        particles.forEach(p => {
            p.userData.t += 0.022;
            p.position.y += p.userData.vy;
            p.position.x += Math.sin(p.userData.t) * 0.003;
            if (p.position.y < landY) {
                p.position.y = topY - Math.random() * 0.3;
                const theta = Math.random() * Math.PI * 2;
                const rad   = Math.random() * 0.68;
                p.position.x = Math.cos(theta) * rad;
                p.position.z = Math.sin(theta) * rad;
            }
        });
    });
}

// ── KHÍ BAY HƠI (GAS) — đám mây màu bốc lên ─────────────────────────
function drawGas(container, formula, hexColor, opacityScale) {
    const { scene, camera, renderer } = _setupScene(container);

    // Glowing source disc on floor
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(1.2, 32),
        new THREE.MeshStandardMaterial({
            color: hexColor, transparent: true, opacity: 0.18,
            emissive: hexColor, emissiveIntensity: 0.65, depthWrite: false
        })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.2;
    scene.add(floor);

    const particles = [];
    for (let i = 0; i < 55; i++) {
        const r = 0.09 + Math.random() * 0.28;
        const baseOpacity = (0.22 + Math.random() * 0.55) * opacityScale;
        const mat = new THREE.MeshStandardMaterial({
            color: hexColor, transparent: true, opacity: baseOpacity,
            roughness: 0.95, emissive: hexColor, emissiveIntensity: 0.32, depthWrite: false
        });
        const p = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
        p.position.set((Math.random()-0.5)*2.6, -2.2+Math.random()*4.5, (Math.random()-0.5)*1.5);
        p.userData.vy  = 0.012 + Math.random() * 0.018;
        p.userData.t   = Math.random() * Math.PI * 2;
        p.userData.baseOpacity = baseOpacity;
        p.userData.mat = mat;
        scene.add(p);
        particles.push(p);
    }

    function tick() {
        const id = requestAnimationFrame(tick);
        _chemAnimIds.set(container.id, id);
        particles.forEach(p => {
            p.userData.t += 0.022;
            p.position.y += p.userData.vy;
            p.position.x += Math.sin(p.userData.t) * 0.009;
            p.position.z += Math.cos(p.userData.t * 0.65) * 0.006;
            // Fade out in upper region
            const fadeRatio = Math.max(0, 1 - (p.position.y - 0.6) / 2.4);
            p.userData.mat.opacity = p.userData.baseOpacity * fadeRatio;
            // Respawn at bottom
            if (p.position.y > 2.6) {
                p.position.y = -2.2 + Math.random() * 0.6;
                p.position.x = (Math.random()-0.5) * 2.0;
                p.position.z = (Math.random()-0.5) * 1.2;
                p.userData.mat.opacity = p.userData.baseOpacity;
            }
        });
        renderer.render(scene, camera);
    }
    tick();
}

// ── DUNG DỊCH MÀU (COLORED SOLUTION) — cốc thủy tinh dung dịch màu ──
function drawColoredSolution(container, formula, hexColor) {
    drawBeakerHelper(container, formula, hexColor, false);
}

// ---- Text fallback if Three.js not loaded ----
function renderFallbackText(formula, container) {
    container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:4px;">
            <div style="font-size:1.8rem;font-weight:900;color:#3b82f6;font-family:'Fira Code',monospace;
                 text-shadow:0 0 16px rgba(59,130,246,0.7);">${formula}</div>
        </div>`;
}
