// ============================================================
//  lesson_export.js — TẢI BÀI GIẢNG (PDF) CHO HỌC SINH
//  Mỗi trang bảng → 1 trang PDF, nền trắng chữ đậm cho dễ đọc / in.
//  Nét phấn trắng → đen, chỗ đã tẩy → trắng, nét màu giữ nguyên.
// ============================================================
(function () {
    const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    const BOARD_BG = '#0a1628';
    let _jspdfLoading = null;
    function loadJsPDF() {
        if (window.jspdf) return Promise.resolve();
        if (!_jspdfLoading) {
            _jspdfLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = JSPDF_URL;
                s.onload = resolve;
                s.onerror = () => { _jspdfLoading = null; reject(new Error('Không tải được thư viện PDF (kiểm tra kết nối mạng)')); };
                document.head.appendChild(s);
            });
        }
        return _jspdfLoading;
    }

    // ── Đổi màu cho nền trắng ──
    function parseColor(c) {
        if (!c || typeof c !== 'string' || c === 'transparent') return null;
        try { return new fabric.Color(c).getSource(); } catch (e) { return null; }   // [r, g, b, a]
    }
    function printColor(c) {
        const rgb = parseColor(c);
        if (!rgb) return c;
        const [r, g, b] = rgb;
        const bg = new fabric.Color(BOARD_BG).getSource();
        // Nét tẩy (vẽ bằng màu nền bảng) → trắng
        if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 24) return '#ffffff';
        // Màu rất sáng (phấn trắng, vàng nhạt...) → gần đen để đọc được trên giấy trắng
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (lum > 0.8) return '#111111';
        // Màu sáng (vàng, xanh nõn chuối...) → làm đậm hơn để đọc rõ trên nền trắng
        if (lum > 0.55) {
            const k = 0.55 / lum;
            return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
        }
        return c;
    }
    function recolor(o) {
        if (o.type === 'image') return;                       // ảnh đề giữ nguyên
        if (o.stroke) o.set('stroke', printColor(o.stroke));
        if (o.fill && typeof o.fill === 'string') o.set('fill', printColor(o.fill));
        // Màu riêng từng ký tự trong chữ (đã tô màu một phần)
        if (o.styles) Object.values(o.styles).forEach(line => Object.values(line).forEach(st => {
            if (st.fill) st.fill = printColor(st.fill);
            if (st.stroke) st.stroke = printColor(st.stroke);
        }));
        if (o._objects) o._objects.forEach(recolor);
    }

    // Vẽ một trang (JSON Fabric) ra ảnh nền trắng, kèm dòng chân trang
    function renderPage(json, w, h, footer) {
        return new Promise((resolve) => {
            const el = document.createElement('canvas');
            const sc = new fabric.StaticCanvas(el, { width: w, height: h, enableRetinaScaling: false });
            sc.loadFromJSON(json, () => {
                sc.backgroundColor = '#ffffff';
                sc.getObjects().forEach(recolor);
                sc.add(new fabric.Text(footer, {
                    left: w - 16, top: h - 14, originX: 'right', originY: 'bottom',
                    fontSize: 14, fill: '#94a3b8', fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
                }));
                sc.renderAll();
                const url = sc.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 2 });
                sc.dispose();
                resolve(url);
            });
        });
    }

    const pad = (n) => String(n).padStart(2, '0');

    // Tạo file PDF từ tất cả các trang có nội dung → { doc, fileName, pages }
    async function buildPdf() {
        if (typeof saveCurrentPageCanvas === 'function') saveCurrentPageCanvas();   // lưu trang đang mở
        const pages = (window.pageManager ? pageManager.pages : [])
            .filter(p => p.canvasJSON && JSON.parse(p.canvasJSON).objects?.length);
        if (!pages.length) return null;
        await loadJsPDF();
        const w = canvas.width, h = canvas.height;
        const now = new Date();
        const day = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
        const doc = new window.jspdf.jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'], compress: true });
        for (let i = 0; i < pages.length; i++) {
            const img = await renderPage(pages[i].canvasJSON, w, h, `Bài giảng ngày ${day} — Trang ${i + 1}/${pages.length}`);
            if (i > 0) doc.addPage([w, h], w >= h ? 'landscape' : 'portrait');
            doc.addImage(img, 'JPEG', 0, 0, w, h);
        }
        doc.setProperties({ title: `Bài giảng ngày ${day}` });
        const fileName = `Bai-giang-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.pdf`;
        return { doc, fileName, pages: pages.length };
    }

    // Thông báo nhỏ ngay cạnh nút (thông báo nổi của app đã tắt)
    function hint(btn, text) {
        let tip = document.getElementById('lesson-export-hint');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'lesson-export-hint';
            tip.className = 'lesson-export-hint';
            document.body.appendChild(tip);
        }
        tip.textContent = text;
        const r = btn.getBoundingClientRect();
        tip.style.left = Math.max(8, r.left + r.width / 2 - 140) + 'px';
        tip.style.top = (r.top - 52) + 'px';
        tip.classList.add('show');
        clearTimeout(tip._t);
        tip._t = setTimeout(() => tip.classList.remove('show'), 3500);
    }

    const btn = document.getElementById('btn-export-pdf');
    btn?.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const icon = btn.querySelector('i');
        const oldIcon = icon.className;
        icon.className = 'fas fa-spinner fa-spin';
        try {
            const res = await buildPdf();
            if (!res) { hint(btn, '✏️ Bảng đang trống — chưa có gì để tải về.'); return; }
            res.doc.save(res.fileName);
            hint(btn, `✅ Đã tải ${res.fileName} (${res.pages} trang)`);
        } catch (err) {
            hint(btn, '⚠️ ' + (err.message || 'Không tạo được file PDF'));
        } finally {
            icon.className = oldIcon;
            btn.disabled = false;
        }
    });

    window.LessonExport = { buildPdf };
})();
