// ============================================================
//  collision_sim.js — Mô phỏng Thuyết Va Chạm Phân Tử 3D
//  Chương trình Hóa học THPT 2018 (Hóa 10 — Chương 6: Tốc độ phản ứng)
//  Tái hiện trực quan: Va chạm hiệu quả vs Va chạm đàn hồi,
//  Năng lượng hoạt hóa (Ea), ảnh hưởng của Nhiệt độ, Nồng độ & Xúc tác.
// ============================================================

(function(window) {
    'use strict';

    let simActive = false;
    let animId = null;
    let scene, camera, renderer, controls;
    let particles = [];
    let sparkles = [];
    let ripples = [];

    // Tham số mô phỏng
    const BOX_SIZE = 14; // Hộp phản ứng [-7, 7]
    let currentTemp = 300; // Kelvin (300K - 800K)
    let currentDensity = 24; // Số lượng hạt
    let catalystActive = false;
    let isNoReactionMode = false;
    let baseEa = 4.2; // Rào cản năng lượng hoạt hóa mặc định

    // Thống kê
    let totalCollisions = 0;
    let effectiveCollisions = 0;
    let elasticCollisions = 0;

    // Phân tử chất tham gia & sản phẩm
    let currentContext = {
        equation: '2Al + 6HCl → 2AlCl3 + 3H2',
        reactants: ['Al', 'HCl'],
        products: ['AlCl3', 'H2'],
        isNoReaction: false,
        reason: ''
    };

    // Web Audio Synthesizer cho va chạm
    const SimAudio = {
        ctx: null,
        init() {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (AC) this.ctx = new AC();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        },
        playClink() { // Va chạm đàn hồi (ping thủy tinh nhẹ)
            if (!this.ctx) return;
            try {
                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1400 + Math.random() * 300, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.06);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.07);
            } catch (e) {}
        },
        playReaction() { // Va chạm hiệu quả (lóe sáng năng lượng + zap/pop)
            if (!this.ctx) return;
            try {
                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(450, now);
                osc.frequency.exponentialRampToValueAtTime(1100, now + 0.12);
                gain.gain.setValueAtTime(0.22, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.22);
            } catch (e) {}
        }
    };

    function createParticleMesh(type, radius, colorHex, glowHex) {
        const group = new THREE.Group();
        // Lõi cầu
        const geo = new THREE.SphereGeometry(radius, 20, 20);
        const mat = new THREE.MeshStandardMaterial({
            color: colorHex,
            roughness: 0.2,
            metalness: 0.6,
            emissive: glowHex,
            emissiveIntensity: 0.35
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

        // Vỏ hào quang phát sáng
        const haloGeo = new THREE.SphereGeometry(radius * 1.25, 14, 14);
        const haloMat = new THREE.MeshBasicMaterial({
            color: glowHex,
            transparent: true,
            opacity: 0.22,
            wireframe: false
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        group.add(halo);

        return group;
    }

    function initSimulatorDOM() {
        if (document.getElementById('collision-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'collision-modal';
        modal.className = 'collision-modal hidden';
        modal.innerHTML = `
            <div class="collision-backdrop" id="collision-backdrop"></div>
            <div class="collision-container">
                <div class="collision-header">
                    <div class="collision-title-wrap">
                        <span class="collision-icon">⚛️</span>
                        <div>
                            <h2 class="collision-title">Mô Phỏng Thuyết Va Chạm Phân Tử 3D</h2>
                            <p class="collision-subtitle" id="collision-eq-text">2Al + 6HCl → 2AlCl3 + 3H2</p>
                        </div>
                    </div>
                    <button class="collision-close-btn" id="collision-close-btn" title="Đóng (Esc)">✕</button>
                </div>

                <div class="collision-body">
                    <!-- Khung mô phỏng 3D -->
                    <div class="collision-canvas-wrap" id="collision-canvas-wrap">
                        <div class="collision-overlay-badge" id="collision-status-tag">
                            <span class="dot pulse"></span> <span>Đang mô phỏng động học...</span>
                        </div>
                        <div class="collision-legend">
                            <span class="legend-item"><b style="background:#38bdf8;"></b> Chất tham gia A</span>
                            <span class="legend-item"><b style="background:#fb923c;"></b> Chất tham gia B</span>
                            <span class="legend-item"><b style="background:#10b981;"></b> Sản phẩm phản ứng</span>
                        </div>
                    </div>

                    <!-- Bảng điều khiển & Phân tích sư phạm -->
                    <div class="collision-dashboard">
                        <!-- Năng lượng hoạt hóa Ea Maxwell-Boltzmann -->
                        <div class="col-card">
                            <div class="col-card-title">📈 Phân Bố Năng Lượng & Rào Cản Ea</div>
                            <canvas id="collision-curve-canvas" width="300" height="110"></canvas>
                            <div class="curve-legend">
                                <span><i style="color:#ef4444;">―</i> Rào cản Ea</span>
                                <span><i style="color:#10b981;">■</i> Hạt đủ năng lượng phản ứng</span>
                            </div>
                        </div>

                        <!-- Thống kê va chạm -->
                        <div class="col-stats-grid">
                            <div class="col-stat-box">
                                <span class="stat-num" id="stat-total">0</span>
                                <span class="stat-lbl">Tổng va chạm</span>
                            </div>
                            <div class="col-stat-box eff-box">
                                <span class="stat-num" id="stat-effective">0</span>
                                <span class="stat-lbl">Va chạm hiệu quả</span>
                            </div>
                            <div class="col-stat-box">
                                <span class="stat-num" id="stat-rate">0%</span>
                                <span class="stat-lbl">Tỉ lệ sinh sản phẩm</span>
                            </div>
                        </div>

                        <!-- Thanh điều khiển tham số -->
                        <div class="col-controls">
                            <!-- Nhiệt độ -->
                            <div class="col-control-row">
                                <div class="col-ctrl-label">
                                    <span>🌡️ Nhiệt độ (T)</span>
                                    <b id="val-temp">300 K (27°C)</b>
                                </div>
                                <input type="range" id="slider-temp" min="250" max="850" step="10" value="300">
                            </div>

                            <!-- Nồng độ -->
                            <div class="col-control-row">
                                <div class="col-ctrl-label">
                                    <span>🧪 Nồng độ / Số hạt</span>
                                    <b id="val-density">24 hạt</b>
                                </div>
                                <input type="range" id="slider-density" min="12" max="48" step="4" value="24">
                            </div>

                            <!-- Xúc tác & Gia nhiệt -->
                            <div class="col-btn-row">
                                <button class="col-action-btn" id="btn-catalyst">
                                    <span class="btn-icon">⚡</span> <span>Chất xúc tác: TẮT</span>
                                </button>
                                <button class="col-action-btn heat-btn" id="btn-heat-pulse">
                                    <span class="btn-icon">🔥</span> <span>Gia nhiệt nhanh</span>
                                </button>
                                <button class="col-action-btn reset-btn" id="btn-sim-reset">
                                    <span class="btn-icon">🔄</span> <span>Đặt lại</span>
                                </button>
                            </div>
                        </div>

                        <!-- Lời giảng sư phạm GDPT 2018 -->
                        <div class="col-pedagogy-box" id="col-pedagogy-box">
                            <div class="ped-title">📘 Nguyên lý Hóa học 10 (Chương 6):</div>
                            <div class="ped-desc" id="col-pedagogy-text">
                                Chỉ những va chạm có <b>năng lượng ≥ Ea</b> và <b>định hướng không gian đúng</b> mới phá vỡ được liên kết cũ để tạo sản phẩm.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Bind events
        document.getElementById('collision-close-btn').addEventListener('click', closeSimulator);
        document.getElementById('collision-backdrop').addEventListener('click', closeSimulator);

        document.getElementById('slider-temp').addEventListener('input', (e) => {
            currentTemp = parseInt(e.target.value, 10);
            const celsius = currentTemp - 273;
            document.getElementById('val-temp').textContent = `${currentTemp} K (${celsius}°C)`;
            updateParticleVelocities();
            drawEnergyCurve();
        });

        document.getElementById('slider-density').addEventListener('input', (e) => {
            currentDensity = parseInt(e.target.value, 10);
            document.getElementById('val-density').textContent = `${currentDensity} hạt`;
            resetParticles();
        });

        document.getElementById('btn-catalyst').addEventListener('click', () => {
            catalystActive = !catalystActive;
            const btn = document.getElementById('btn-catalyst');
            btn.classList.toggle('active', catalystActive);
            btn.querySelector('span:last-child').textContent = `Chất xúc tác: ${catalystActive ? 'ĐANG BẬT ⚡' : 'TẮT'}`;
            drawEnergyCurve();
            updatePedagogyText();
        });

        document.getElementById('btn-heat-pulse').addEventListener('click', () => {
            // Tăng nhiệt tức thời mô phỏng đun nóng bùng nổ
            particles.forEach(p => {
                p.vx *= 1.8; p.vy *= 1.8; p.vz *= 1.8;
            });
            SimAudio.playReaction();
            const tag = document.getElementById('collision-status-tag');
            if (tag) {
                tag.style.background = 'rgba(239,68,68,0.3)';
                tag.innerHTML = '<span class="dot pulse" style="background:#ef4444;"></span> <span>Đang truyền xung nhiệt lượng lớn 🔥</span>';
                setTimeout(() => {
                    tag.style.background = '';
                    tag.innerHTML = '<span class="dot pulse"></span> <span>Đang mô phỏng động học...</span>';
                }, 1500);
            }
        });

        document.getElementById('btn-sim-reset').addEventListener('click', () => {
            totalCollisions = 0;
            effectiveCollisions = 0;
            elasticCollisions = 0;
            updateStatsUI();
            resetParticles();
        });
    }

    function initThreeScene() {
        const container = document.getElementById('collision-canvas-wrap');
        const w = container.clientWidth || 560;
        const h = container.clientHeight || 480;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x060d1a);

        camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.set(0, 5, 26);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.appendChild(renderer.domElement);

        if (window.THREE.OrbitControls) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.maxDistance = 45;
            controls.minDistance = 10;
        }

        // Ánh sáng đa hướng
        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambient);

        const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 1.2);
        dirLight1.position.set(10, 15, 10);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xfb923c, 0.9);
        dirLight2.position.set(-10, -10, -10);
        scene.add(dirLight2);

        // Hộp phản ứng trong suốt có khung neon
        const half = BOX_SIZE / 2;
        const boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
        const wireGeo = new THREE.EdgesGeometry(boxGeo);
        const wireMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45 });
        const wireBox = new THREE.LineSegments(wireGeo, wireMat);
        scene.add(wireBox);

        // Mặt lưới sàn đáy
        const grid = new THREE.GridHelper(BOX_SIZE, 14, 0x1e293b, 0x0f172a);
        grid.position.y = -half;
        scene.add(grid);
    }

    function resetParticles() {
        if (!scene) return;
        // Xóa hạt cũ
        particles.forEach(p => scene.remove(p.mesh));
        particles = [];
        sparkles.forEach(s => scene.remove(s.mesh));
        sparkles = [];
        ripples.forEach(r => scene.remove(r.mesh));
        ripples = [];

        const half = (BOX_SIZE / 2) - 1.2;
        const baseSpeed = Math.sqrt(currentTemp / 300) * 0.08;

        for (let i = 0; i < currentDensity; i++) {
            const isA = (i % 2 === 0);
            const radius = isA ? 0.65 : 0.85;
            const colorHex = isA ? 0x38bdf8 : 0xfb923c;
            const glowHex = isA ? 0x0284c7 : 0xea580c;

            const mesh = createParticleMesh(isA ? 'A' : 'B', radius, colorHex, glowHex);
            mesh.position.set(
                (Math.random() - 0.5) * 2 * half,
                (Math.random() - 0.5) * 2 * half,
                (Math.random() - 0.5) * 2 * half
            );
            scene.add(mesh);

            // Vận tốc ngẫu nhiên 3D
            const theta = Math.random() * Math.PI * 2;
            const phi = (Math.random() - 0.5) * Math.PI;
            particles.push({
                id: i,
                type: isA ? 'A' : 'B',
                role: 'reactant',
                radius: radius,
                mesh: mesh,
                vx: Math.cos(theta) * Math.cos(phi) * baseSpeed,
                vy: Math.sin(phi) * baseSpeed,
                vz: Math.sin(theta) * Math.cos(phi) * baseSpeed,
                mass: isA ? 1.0 : 1.6
            });
        }
    }

    function updateParticleVelocities() {
        const factor = Math.sqrt(currentTemp / 300);
        particles.forEach(p => {
            const currentSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 0.001;
            const targetSpeed = 0.08 * factor * (1 / Math.sqrt(p.mass));
            p.vx = (p.vx / currentSpeed) * targetSpeed;
            p.vy = (p.vy / currentSpeed) * targetSpeed;
            p.vz = (p.vz / currentSpeed) * targetSpeed;
        });
    }

    function addSparkleBurst(pos) {
        for (let i = 0; i < 8; i++) {
            const geo = new THREE.SphereGeometry(0.18, 8, 8);
            const mat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 1 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            scene.add(mesh);
            sparkles.push({
                mesh: mesh,
                vx: (Math.random() - 0.5) * 0.25,
                vy: (Math.random() - 0.5) * 0.25,
                vz: (Math.random() - 0.5) * 0.25,
                life: 1.0
            });
        }
    }

    function addRippleRing(pos) {
        const geo = new THREE.RingGeometry(0.3, 0.45, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.lookAt(camera.position);
        scene.add(mesh);
        ripples.push({ mesh: mesh, scale: 1, opacity: 0.8 });
    }

    function updateStatsUI() {
        document.getElementById('stat-total').textContent = totalCollisions;
        document.getElementById('stat-effective').textContent = effectiveCollisions;
        const rate = totalCollisions > 0 ? Math.round((effectiveCollisions / totalCollisions) * 100) : 0;
        document.getElementById('stat-rate').textContent = `${rate}%`;
    }

    function drawEnergyCurve() {
        const canvas = document.getElementById('collision-curve-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Vẽ trục tọa độ
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(25, H - 20); ctx.lineTo(W - 10, H - 20);
        ctx.moveTo(25, H - 20); ctx.lineTo(25, 10);
        ctx.stroke();

        // Đường cong phân bố Maxwell-Boltzmann theo nhiệt độ
        const T_norm = currentTemp / 300;
        const peakE = 2.0 * T_norm;
        const points = [];
        for (let x = 25; x < W - 10; x += 3) {
            const E = (x - 25) / 25;
            // f(E) ~ sqrt(E) * exp(-E/kT)
            const yVal = Math.sqrt(E) * Math.exp(-E / peakE) * (H * 1.6);
            points.push({ x: x, y: Math.max(H - 20 - yVal, 15) });
        }

        // Vẽ diện tích dưới đường cong
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.lineTo(W - 10, H - 20);
        ctx.lineTo(25, H - 20);
        ctx.closePath();
        ctx.fillStyle = 'rgba(56,189,248,0.12)';
        ctx.fill();

        // Vẽ đường cong
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();

        // Vị trí Ea
        const effectiveEa = isNoReactionMode ? 999 : (catalystActive ? baseEa * 0.6 : baseEa);
        const eaX = 25 + (effectiveEa * 25);

        if (eaX < W - 10) {
            // Tô sáng phần năng lượng E >= Ea (va chạm hiệu quả)
            ctx.beginPath();
            let start = false;
            for (let pt of points) {
                if (pt.x >= eaX) {
                    if (!start) { ctx.moveTo(pt.x, H - 20); start = true; }
                    ctx.lineTo(pt.x, pt.y);
                }
            }
            if (start) {
                ctx.lineTo(W - 10, H - 20);
                ctx.closePath();
                ctx.fillStyle = 'rgba(16,185,129,0.35)';
                ctx.fill();
            }

            // Vạch Ea đỏ
            ctx.strokeStyle = catalystActive ? '#10b981' : '#ef4444';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(eaX, H - 20);
            ctx.lineTo(eaX, 12);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = catalystActive ? '#10b981' : '#ef4444';
            ctx.font = 'bold 9px Inter, sans-serif';
            ctx.fillText(catalystActive ? 'Ea (có xúc tác)' : 'Ea chuẩn', eaX - 24, 10);
        } else {
            // Không phản ứng: Ea nằm ngoài khoảng biểu đồ
            ctx.fillStyle = '#f87171';
            ctx.font = 'italic 10px Inter, sans-serif';
            ctx.fillText('Rào cản Ea quá lớn (Không phản ứng) ⇸', 45, 30);
        }
    }

    function updatePedagogyText() {
        const textEl = document.getElementById('col-pedagogy-text');
        if (!textEl) return;
        if (isNoReactionMode) {
            textEl.innerHTML = `⚠️ <b>Hệ chất trơ / Không phản ứng:</b> Giữa các chất này, rào cản năng lượng hoạt hóa <i>Ea</i> quá lớn ở điều kiện thường. 100% các phân tử va chạm đàn hồi và dội ngược ra, liên kết cũ không bị đứt gãy nên không tạo sản phẩm.`;
        } else if (catalystActive) {
            textEl.innerHTML = `⚡ <b>Hiệu ứng chất xúc tác:</b> Xúc tác mở ra con đường phản ứng mới với <b>Ea thấp hơn</b>. Nhờ đó, số phân tử có đủ năng lượng vượt qua rào cản tăng mạnh mà không cần tăng nhiệt độ!`;
        } else {
            textEl.innerHTML = `📘 <b>Thuyết va chạm (GDPT 2018):</b> Tăng nhiệt độ (T) làm tăng động năng hạt $\\rightarrow$ số va chạm có $E \\ge Ea$ tăng vọt. Nồng độ tăng làm tăng tần số va chạm trên đơn vị thời gian.`;
        }
    }

    function animate() {
        if (!simActive) return;
        animId = requestAnimationFrame(animate);

        const half = (BOX_SIZE / 2) - 0.7;

        // Cập nhật vị trí hạt và kiểm tra va chạm tường
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.mesh.position.x += p.vx;
            p.mesh.position.y += p.vy;
            p.mesh.position.z += p.vz;

            // Bật nảy tường hộp
            if (p.mesh.position.x > half)  { p.mesh.position.x = half;  p.vx *= -1; }
            if (p.mesh.position.x < -half) { p.mesh.position.x = -half; p.vx *= -1; }
            if (p.mesh.position.y > half)  { p.mesh.position.y = half;  p.vy *= -1; }
            if (p.mesh.position.y < -half) { p.mesh.position.y = -half; p.vy *= -1; }
            if (p.mesh.position.z > half)  { p.mesh.position.z = half;  p.vz *= -1; }
            if (p.mesh.position.z < -half) { p.mesh.position.z = -half; p.vz *= -1; }
        }

        // Kiểm tra va chạm giữa các hạt
        const effectiveEa = isNoReactionMode ? 999 : (catalystActive ? baseEa * 0.6 : baseEa);

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const p1 = particles[i];
                const p2 = particles[j];

                const dx = p2.mesh.position.x - p1.mesh.position.x;
                const dy = p2.mesh.position.y - p1.mesh.position.y;
                const dz = p2.mesh.position.z - p1.mesh.position.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                const minDist = p1.radius + p2.radius;

                if (distSq < minDist * minDist) {
                    const dist = Math.sqrt(distSq) || 0.001;
                    totalCollisions++;

                    // Động năng tương đối của va chạm
                    const relVx = p1.vx - p2.vx;
                    const relVy = p1.vy - p2.vy;
                    const relVz = p1.vz - p2.vz;
                    const relEnergy = 0.5 * (relVx * relVx + relVy * relVy + relVz * relVz) * 120;

                    const isDifferentReactants = (p1.type !== p2.type) && (p1.role === 'reactant' && p2.role === 'reactant');

                    if (!isNoReactionMode && isDifferentReactants && relEnergy >= effectiveEa) {
                        // VA CHẠM HIỆU QUẢ!
                        effectiveCollisions++;
                        SimAudio.playReaction();
                        const midPos = p1.mesh.position.clone().add(p2.mesh.position).multiplyScalar(0.5);
                        addSparkleBurst(midPos);

                        // Biến hạt p1 thành hạt sản phẩm (xanh ngọc)
                        p1.role = 'product';
                        p1.type = 'Product';
                        p1.mesh.children[0].material.color.setHex(0x10b981);
                        p1.mesh.children[0].material.emissive.setHex(0x059669);
                        p1.mesh.children[1].material.color.setHex(0x34d399);

                        // Đổi vận tốc sau giải phóng năng lượng
                        p1.vx = -p1.vx * 1.1;
                        p2.vx = -p2.vx * 1.1;
                    } else {
                        // VA CHẠM ĐÀN HỒI (Không đủ năng lượng hoặc cùng loại hạt)
                        elasticCollisions++;
                        if (Math.random() < 0.25) SimAudio.playClink();
                        const midPos = p1.mesh.position.clone().add(p2.mesh.position).multiplyScalar(0.5);
                        addRippleRing(midPos);

                        // Đổi hướng theo phương va chạm (Định luật bảo toàn động lượng)
                        const nx = dx / dist;
                        const ny = dy / dist;
                        const nz = dz / dist;
                        const kx = p1.vx - p2.vx;
                        const ky = p1.vy - p2.vy;
                        const kz = p1.vz - p2.vz;
                        const p = 2 * (nx * kx + ny * ky + nz * kz) / (p1.mass + p2.mass);

                        p1.vx -= p * p2.mass * nx;
                        p1.vy -= p * p2.mass * ny;
                        p1.vz -= p * p2.mass * nz;
                        p2.vx += p * p1.mass * nx;
                        p2.vy += p * p1.mass * ny;
                        p2.vz += p * p1.mass * nz;
                    }
                    updateStatsUI();
                }
            }
        }

        // Cập nhật tia năng lượng (sparkles)
        for (let i = sparkles.length - 1; i >= 0; i--) {
            const s = sparkles[i];
            s.mesh.position.x += s.vx;
            s.mesh.position.y += s.vy;
            s.mesh.position.z += s.vz;
            s.life -= 0.05;
            s.mesh.material.opacity = s.life;
            if (s.life <= 0) {
                scene.remove(s.mesh);
                sparkles.splice(i, 1);
            }
        }

        // Cập nhật vòng ripple
        for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i];
            r.scale += 0.08;
            r.opacity -= 0.04;
            r.mesh.scale.set(r.scale, r.scale, r.scale);
            r.mesh.material.opacity = Math.max(0, r.opacity);
            if (r.opacity <= 0) {
                scene.remove(r.mesh);
                ripples.splice(i, 1);
            }
        }

        if (controls) controls.update();
        renderer.render(scene, camera);
    }

    function openSimulator(ctx) {
        initSimulatorDOM();
        SimAudio.init();

        currentContext = Object.assign(currentContext, ctx || {});
        isNoReactionMode = Boolean(currentContext.isNoReaction);

        document.getElementById('collision-eq-text').textContent = currentContext.equation || 'Phản ứng Hóa học 3D';
        document.getElementById('collision-modal').classList.remove('hidden');

        totalCollisions = 0;
        effectiveCollisions = 0;
        elasticCollisions = 0;
        catalystActive = false;
        document.getElementById('btn-catalyst').classList.remove('active');
        document.getElementById('btn-catalyst').querySelector('span:last-child').textContent = 'Chất xúc tác: TẮT';

        if (!renderer) {
            initThreeScene();
        }

        updatePedagogyText();
        resetParticles();
        drawEnergyCurve();
        updateStatsUI();

        simActive = true;
        animate();
    }

    function closeSimulator() {
        simActive = false;
        if (animId) cancelAnimationFrame(animId);
        const modal = document.getElementById('collision-modal');
        if (modal) modal.classList.add('hidden');
    }

    // Expose global
    window.openCollisionSimulator = openSimulator;
    window.closeCollisionSimulator = closeSimulator;

})(window);

