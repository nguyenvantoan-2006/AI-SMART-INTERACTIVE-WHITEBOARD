// ============================================================
//  exercise_lib.js — KHO BÀI TẬP
//  Giáo viên tải file đề (Word .docx / PDF / ảnh) lên server, mở xem như trang
//  tài liệu, khoanh (cắt) đúng bài cần chữa rồi kéo thả ra bảng đen.
//  Ảnh đề trên bảng: kéo để di chuyển, lăn chuột trên ảnh để phóng to/thu nhỏ,
//  bấm chọn rồi nhấn Delete để xóa.
// ============================================================
(function () {
    const LIBS = {
        pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
        jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
        docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.0/dist/docx-preview.min.js',
        html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    };
    // Thư viện đọc PDF/Word chỉ tải khi cần → không làm chậm trang chính
    const _loading = {};
    function loadScript(url) {
        if (!_loading[url]) {
            _loading[url] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload = resolve;
                s.onerror = () => { delete _loading[url]; reject(new Error('Không tải được thư viện (kiểm tra kết nối mạng)')); };
                document.head.appendChild(s);
            });
        }
        return _loading[url];
    }

    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const extOf = (name) => (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const fileUrl = (name) => '/api/exercises/' + encodeURIComponent(name);
    const ICON = { '.pdf': 'fa-file-pdf', '.docx': 'fa-file-word' };

    // ── Khung Kho bài tập (gắn bên phải màn hình, vẫn nhìn thấy bảng bên trái) ──
    const panel = document.createElement('div');
    panel.id = 'exlib-panel';
    panel.className = 'exlib-panel hidden';
    panel.innerHTML = `
        <div class="exlib-header">
            <span class="exlib-title"><i class="fas fa-search"></i> Kho bài tập</span>
            <label class="exlib-upload-btn" title="Tải file đề: Word (.docx), PDF hoặc ảnh">
                <i class="fas fa-upload"></i> Tải đề lên
                <input type="file" id="exlib-file-input" accept=".docx,.pdf,.png,.jpg,.jpeg,.webp" multiple hidden>
            </label>
            <button class="exlib-close" id="exlib-close" title="Đóng (Esc)">✕</button>
        </div>
        <div class="exlib-body">
            <div class="exlib-list" id="exlib-list"></div>
            <div class="exlib-viewer-wrap">
                <div class="exlib-hint" id="exlib-hint">✂️ Kéo chuột khoanh quanh bài cần lấy, rồi kéo ảnh vừa cắt thả sang bảng đen</div>
                <div class="exlib-viewer" id="exlib-viewer"></div>
                <div class="exlib-clip hidden" id="exlib-clip">
                    <img id="exlib-clip-img" draggable="true" alt="Bài đã cắt" title="Kéo thả sang bảng đen">
                    <div class="exlib-clip-actions">
                        <span class="exlib-clip-tip">Kéo ảnh sang bảng, hoặc</span>
                        <button id="exlib-clip-place" class="exlib-btn-primary">📌 Đưa lên bảng</button>
                        <button id="exlib-clip-cancel" class="exlib-btn-ghost">✕</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(panel);

    const listEl = panel.querySelector('#exlib-list');
    const viewer = panel.querySelector('#exlib-viewer');
    const clipBox = panel.querySelector('#exlib-clip');
    const clipImg = panel.querySelector('#exlib-clip-img');
    let currentName = null;
    let currentClip = null;      // { url, w, h }: ảnh vùng vừa cắt + kích thước đang thấy (px)

    // ── Danh sách file đề ──
    async function refreshList(openName) {
        listEl.innerHTML = '<div class="exlib-empty">Đang tải...</div>';
        let items = [];
        try { items = await (await fetch('/api/exercises')).json(); }
        catch (e) { listEl.innerHTML = '<div class="exlib-empty">⚠️ Không kết nối được server</div>'; return; }
        if (!items.length) {
            listEl.innerHTML = '<div class="exlib-empty">Chưa có đề nào.<br>Bấm <b>Tải đề lên</b> để thêm file Word, PDF hoặc ảnh.</div>';
            viewer.innerHTML = '';
            currentName = null;
            return;
        }
        listEl.innerHTML = items.map(it => `
            <div class="exlib-item ${it.name === currentName ? 'active' : ''}" data-name="${esc(it.name)}" title="${esc(it.name)}">
                <i class="fas ${ICON[extOf(it.name)] || 'fa-file-image'}"></i>
                <span class="exlib-item-name">${esc(it.name)}</span>
                <button class="exlib-item-del" title="Xóa đề này">🗑</button>
            </div>`).join('');
        const target = openName || (currentName && items.some(i => i.name === currentName) ? currentName : items[0].name);
        if (target !== currentName || !viewer.childElementCount) openFile(target);
    }

    listEl.addEventListener('click', async (e) => {
        const item = e.target.closest('.exlib-item');
        if (!item) return;
        const name = item.dataset.name;
        if (e.target.closest('.exlib-item-del')) {
            if (!confirm(`Xóa đề "${name}" khỏi kho?`)) return;
            await fetch(fileUrl(name), { method: 'DELETE' });
            if (name === currentName) { currentName = null; viewer.innerHTML = ''; }
            refreshList();
            return;
        }
        openFile(name);
    });

    panel.querySelector('#exlib-file-input').addEventListener('change', async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        let last = null;
        for (const f of files) {
            listEl.insertAdjacentHTML('afterbegin', `<div class="exlib-empty">Đang tải lên ${esc(f.name)}...</div>`);
            const fd = new FormData();
            fd.append('file', f);
            const res = await fetch('/api/exercises', { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { alert(`Không tải lên được "${f.name}": ${data.detail || res.status}`); continue; }
            last = data.name;
        }
        refreshList(last);
    });

    // ── Mở & hiển thị file đề ──
    async function openFile(name) {
        currentName = name;
        listEl.querySelectorAll('.exlib-item').forEach(el => el.classList.toggle('active', el.dataset.name === name));
        hideClip();
        viewer.innerHTML = '<div class="exlib-empty">Đang mở đề...</div>';
        const ext = extOf(name);
        try {
            if (ext === '.pdf') await renderPdf(name);
            else if (ext === '.docx') await renderDocx(name);
            else renderImage(name);
        } catch (err) {
            viewer.innerHTML = `<div class="exlib-empty">⚠️ Không mở được file: ${esc(err.message || err)}</div>`;
        }
    }

    async function renderPdf(name) {
        await loadScript(LIBS.pdf);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        const doc = await window.pdfjsLib.getDocument(fileUrl(name)).promise;
        if (currentName !== name) return;
        viewer.innerHTML = '';
        const cssW = Math.max(300, viewer.clientWidth - 32);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const base = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
            const c = document.createElement('canvas');
            c.className = 'exlib-page';
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            c.style.width = cssW + 'px';
            viewer.appendChild(c);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            if (currentName !== name) return;
        }
    }

    async function renderDocx(name) {
        await loadScript(LIBS.jszip);
        await loadScript(LIBS.docx);
        const blob = await (await fetch(fileUrl(name))).blob();
        if (currentName !== name) return;
        viewer.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'exlib-docx';
        viewer.appendChild(box);
        // ignoreWidth: trang co theo bề rộng khung xem (không bị tràn, khoanh vùng được toàn trang)
        await window.docx.renderAsync(blob, box, null, { inWrapper: true, ignoreWidth: true, breakPages: true, ignoreLastRenderedPageBreak: true });
        box.querySelectorAll('section.docx').forEach(sec => sec.classList.add('exlib-page'));
    }

    function renderImage(name) {
        viewer.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'exlib-page';
        img.src = fileUrl(name);
        img.draggable = false;
        viewer.appendChild(img);
    }

    // ── Khoanh (cắt) vùng bài trên trang đề ──
    let sel = null;   // { page, rect, x0, y0, box }
    viewer.addEventListener('pointerdown', (e) => {
        const page = e.target.closest('.exlib-page');
        if (!page || e.button > 0) return;
        e.preventDefault();
        const rect = page.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'exlib-sel';
        document.body.appendChild(box);
        sel = { page, rect, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, box };
        drawSel();
    });
    document.addEventListener('pointermove', (e) => {
        if (!sel) return;
        sel.x1 = Math.max(sel.rect.left, Math.min(e.clientX, sel.rect.right));
        sel.y1 = Math.max(sel.rect.top, Math.min(e.clientY, sel.rect.bottom));
        drawSel();
    });
    document.addEventListener('pointerup', async () => {
        if (!sel) return;
        const s = sel; sel = null;
        s.box.remove();
        const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
        const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
        if (w < 12 || h < 12) return;
        // Tọa độ so với góc trên-trái của trang
        const pr = s.page.getBoundingClientRect();
        try {
            showClip({ url: await cropPage(s.page, { x: x - pr.left, y: y - pr.top, w, h }), w, h });
        } catch (err) {
            alert('Không cắt được vùng này: ' + (err.message || err));
        }
    });
    function drawSel() {
        const x = Math.min(sel.x0, sel.x1), y = Math.min(sel.y0, sel.y1);
        Object.assign(sel.box.style, { left: x + 'px', top: y + 'px', width: Math.abs(sel.x1 - sel.x0) + 'px', height: Math.abs(sel.y1 - sel.y0) + 'px' });
    }

    async function cropPage(page, r) {
        let src, scale;
        if (page.tagName === 'CANVAS') { src = page; scale = page.width / page.clientWidth; }
        else if (page.tagName === 'IMG') { src = page; scale = page.naturalWidth / page.clientWidth; }
        else {
            // Trang Word (HTML) → chụp thành ảnh một lần rồi cắt
            await loadScript(LIBS.html2canvas);
            if (!page._snapshot) page._snapshot = await window.html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false });
            src = page._snapshot;
            scale = src.width / page.offsetWidth;
        }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(r.w * scale));
        c.height = Math.max(1, Math.round(r.h * scale));
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(src, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
    }

    function showClip(clip) {
        currentClip = clip;
        clipImg.src = clip.url;
        clipBox.classList.remove('hidden');
    }
    function hideClip() {
        currentClip = null;
        clipBox.classList.add('hidden');
    }
    panel.querySelector('#exlib-clip-cancel').addEventListener('click', hideClip);
    panel.querySelector('#exlib-clip-place').addEventListener('click', () => {
        if (!currentClip) return;
        // Đặt giữa phần bảng đang nhìn thấy (bên trái khung Kho bài tập)
        const cs = document.getElementById('canvas-section');
        const r = cs.getBoundingClientRect();
        const visibleRight = Math.min(r.right, panel.getBoundingClientRect().left);
        addClipToBoard(currentClip, (r.left + visibleRight) / 2 - r.left, r.height / 2);
        hideClip();
    });

    // ── Kéo ảnh đã cắt thả sang bảng đen ──
    clipImg.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-wb-clip', '1');
        e.dataTransfer.effectAllowed = 'copy';
    });
    const isClipDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('application/x-wb-clip');
    document.addEventListener('dragover', (e) => {
        if (!isClipDrag(e) || !e.target.closest('.page-slot')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', async (e) => {
        if (!isClipDrag(e) || !currentClip) return;
        const slot = e.target.closest('.page-slot');
        if (!slot) return;
        e.preventDefault();
        const data = currentClip;
        // Thả vào trang khác (đang hiện một phần) → chuyển sang trang đó trước
        if (!slot.classList.contains('current') && typeof window.switchToPage === 'function') {
            await window.switchToPage(Number(slot.dataset.pageId));
        }
        const r = slot.getBoundingClientRect();
        addClipToBoard(data, e.clientX - r.left, e.clientY - r.top);
        hideClip();
    });

    // Thêm ảnh đề vào bảng: tâm ảnh tại (x, y) theo px của trang,
    // cỡ bằng lúc nhìn trong khung đề (thu nhỏ nếu quá to so với bảng)
    function addClipToBoard(clip, x, y) {
        fabric.Image.fromURL(clip.url, (img) => {
            const maxW = canvas.width * 0.6, maxH = canvas.height * 0.7;
            const s = Math.min(clip.w / img.width, maxW / img.width, maxH / img.height);
            const w = img.width * s, h = img.height * s;
            img.set({
                left: Math.max(0, Math.min(x - w / 2, canvas.width - w)),
                top: Math.max(0, Math.min(y - h / 2, canvas.height - h)),
                scaleX: s, scaleY: s,
                selectable: false, evented: false,
                data: { isClip: true }
            });
            canvas.add(img);
            canvas.renderAll();
            if (typeof saveState === 'function') saveState();
        });
    }

    // ── Ảnh đề trên bảng: lăn chuột để phóng to/thu nhỏ, Delete để xóa ──
    let _wheelSave = null;
    document.getElementById('canvas-section').addEventListener('wheel', (e) => {
        const p = canvas.getPointer(e);
        const objs = canvas.getObjects();
        for (let i = objs.length - 1; i >= 0; i--) {
            const o = objs[i];
            if (!(o.data && o.data.isClip)) continue;
            o.setCoords();
            if (!o.containsPoint(new fabric.Point(p.x, p.y))) continue;
            e.preventDefault();
            const k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
            const cx = o.left + o.getScaledWidth() / 2, cy = o.top + o.getScaledHeight() / 2;
            const ns = Math.max(0.05, Math.min(o.scaleX * k, 6));
            o.set({ scaleX: ns, scaleY: ns });
            o.set({ left: cx - o.getScaledWidth() / 2, top: cy - o.getScaledHeight() / 2 });
            o.setCoords();
            canvas.requestRenderAll();
            clearTimeout(_wheelSave);
            _wheelSave = setTimeout(() => { if (typeof saveState === 'function') saveState(); }, 300);
            return;
        }
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('hidden')) { closePanel(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
            const o = canvas.getActiveObject();
            if (o && o.data && o.data.isClip) {
                canvas.remove(o);
                canvas.discardActiveObject();
                canvas.renderAll();
                if (typeof saveState === 'function') saveState();
            }
        }
    });

    // ── Mở / đóng ──
    function openPanel() {
        panel.classList.remove('hidden');
        document.getElementById('btn-exlib')?.classList.add('active');
        refreshList();
    }
    function closePanel() {
        panel.classList.add('hidden');
        document.getElementById('btn-exlib')?.classList.remove('active');
        hideClip();
    }
    panel.querySelector('#exlib-close').addEventListener('click', closePanel);
    document.getElementById('btn-exlib')?.addEventListener('click', () => {
        panel.classList.contains('hidden') ? openPanel() : closePanel();
    });

    window.ExerciseLibrary = { open: openPanel, close: closePanel, addClipToBoard };
})();
