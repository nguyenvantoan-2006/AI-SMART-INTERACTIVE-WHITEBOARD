// ============================================================
//  virtual_lab.js — "Thí nghiệm ảo" trong bảng phản ứng hóa học
//  Kéo thanh trượt lượng từng chất → xem ngay chất hết / chất dư,
//  khối lượng sản phẩm, thể tích khí; sản phẩm đổi theo tỉ lệ mol
//  (CO₂ + NaOH, CO₂ + Ca(OH)₂, C + O₂ ...); bật/tắt xúc tác để thấy tốc độ.
//  Dùng các hàm có sẵn trong script.js: calculateAccurateMolarMass,
//  isGasMolecule, renderFormulaHtml, escHtml.
// ============================================================

const LAB_GAS_MOLAR_VOLUME = 24.79; // L/mol ở đkc (25 °C, 1 bar) — SGK mới

function _labNorm(f) {
    return String(f || '')
        .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)])
        .replace(/[↓↑\s]/g, '');
}

function _labKey(f) { return _labNorm(f).toUpperCase(); }

function _labFmt(x, digits = 2) {
    if (!isFinite(x)) return '0';
    return x.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

// Tách phương trình → [{formula, coeff}] cho từng vế (bỏ điều kiện ghi trên mũi tên)
function _labParseEquation(equation, reactants, products) {
    let eq = _labNorm(equation)
        .replace(/⇌|⇄|=|-->|->/g, '→')
        .replace(/→\s*\([^)]*\)/g, '→')     // →(MnO2), →(t°)
        .replace(/\((k|r|dd|l|aq|s|g|đặc|loãng|dac|loang)\)/gi, '');
    const side = (str, fallback) => {
        const terms = (str || '').split('+').map(s => s.trim()).filter(Boolean);
        const out = [];
        terms.forEach(t => {
            const m = t.match(/^(\d+)?([A-Z][A-Za-z0-9()[\]]*)/);
            if (m) out.push({ formula: m[2], coeff: m[1] ? parseInt(m[1]) : 1 });
        });
        return out.length ? out : (fallback || []).map(f => ({ formula: _labNorm(f), coeff: 1 }));
    };
    if (!eq.includes('→')) return { reactants: side('', reactants), products: side('', products) };
    const [l, r] = eq.split('→');
    return { reactants: side(l, reactants), products: side(r, products) };
}

// ── Phản ứng có sản phẩm thay đổi theo tỉ lệ mol ─────────────────────
// Mỗi luật: nhận diện cặp chất, tính T và trả về các chất sau phản ứng (mol)
const LAB_RATIO_RULES = [
    {   // H₂SO₄ + kiềm 1 hóa trị: tạo muối trung hòa hoặc muối axit tùy tỉ lệ
        match: (keys) => {
            const acid = keys.find(k => k === 'H2SO4');
            const base = keys.find(k => k === 'NAOH' || k === 'KOH');
            return acid && base ? { acid, base } : null;
        },
        solve: ({ acid, base }, n) => {
            const a = n[acid], b = n[base], T = b / a;
            const Mt = base === 'NAOH' ? 'Na' : 'K';
            const neutral = `${Mt}2SO4`, acidSalt = `${Mt}HSO4`;
            const tName = `T = n(${base === 'NAOH' ? 'NaOH' : 'KOH'}) / n(H2SO4)`;
            if (T >= 2) return { T, tName, case: `T ≥ 2 → ${neutral}`, after: { [neutral]: a, H2O: 2 * a, [base]: b - 2 * a } };
            if (T > 1) return { T, tName, case: `1 < T < 2 → ${acidSalt} + ${neutral}`, after: { [acidSalt]: 2 * a - b, [neutral]: b - a, H2O: b } };
            return { T, tName, case: `T ≤ 1 → ${acidSalt}`, after: { [acidSalt]: b, H2O: b, [acid]: a - b } };
        }
    },
    {   // CO₂/SO₂ + kiềm 1 hóa trị (NaOH, KOH)
        match: (keys) => {
            const oxide = keys.find(k => k === 'CO2' || k === 'SO2');
            const base = keys.find(k => k === 'NAOH' || k === 'KOH');
            return oxide && base ? { oxide, base } : null;
        },
        solve: ({ oxide, base }, n) => {
            const a = n[oxide], b = n[base], T = b / a;
            const M = base === 'NAOH' ? 'Na' : 'K';
            const X = oxide === 'CO2' ? 'C' : 'S';
            const neutral = `${M}2${X}O3`, acidSalt = `${M}H${X}O3`;
            const tName = `T = n(${base === 'NAOH' ? 'NaOH' : 'KOH'}) / n(${oxide})`;
            if (T >= 2) return { T, tName, case: `T ≥ 2 → ${neutral}`, after: { [neutral]: a, H2O: a, [base]: b - 2 * a } };
            if (T > 1) return { T, tName, case: `1 < T < 2 → ${acidSalt} + ${neutral}`, after: { [acidSalt]: 2 * a - b, [neutral]: b - a, H2O: b - a } };
            return { T, tName, case: `T ≤ 1 → ${acidSalt}`, after: { [acidSalt]: b, [oxide]: a - b } };
        }
    },
    {   // CO₂/SO₂ + kiềm 2 hóa trị (Ca(OH)₂, Ba(OH)₂)
        match: (keys) => {
            const oxide = keys.find(k => k === 'CO2' || k === 'SO2');
            const base = keys.find(k => k === 'CA(OH)2' || k === 'BA(OH)2');
            return oxide && base ? { oxide, base } : null;
        },
        solve: ({ oxide, base }, n) => {
            const a = n[oxide], b = n[base], T = a / b;
            const M = base.startsWith('CA') ? 'Ca' : 'Ba';
            const X = oxide === 'CO2' ? 'C' : 'S';
            const ppt = `${M}${X}O3`, soluble = `${M}(H${X}O3)2`;
            const tName = `T = n(${oxide}) / n(${M}(OH)2)`;
            if (T <= 1) return { T, tName, case: `T ≤ 1 → ${ppt}↓ trắng`, after: { [ppt]: a, H2O: a, [base]: b - a } };
            if (T < 2) return { T, tName, case: `1 < T < 2 → ${ppt}↓ tan một phần`, after: { [ppt]: 2 * b - a, [soluble]: a - b, H2O: 2 * b - a } };
            return { T, tName, case: `T ≥ 2 → ${soluble} (kết tủa tan hết)`, after: { [soluble]: b, [oxide]: a - 2 * b } };
        }
    },
    {   // C + O₂: đủ/dư oxi → CO₂, thiếu oxi → CO
        match: (keys) => keys.includes('C') && keys.includes('O2') ? { c: 'C', o: 'O2' } : null,
        solve: (_, n) => {
            const a = n.C, b = n.O2, T = b / a;
            const tName = 'T = n(O2) / n(C)';
            if (T >= 1) return { T, tName, case: 'T ≥ 1 → CO2', after: { CO2: a, O2: b - a } };
            if (T > 0.5) return { T, tName, case: '0,5 < T < 1 → CO2 + CO (độc)', after: { CO2: 2 * b - a, CO: 2 * a - 2 * b } };
            return { T, tName, case: 'T ≤ 0,5 → CO (độc)', after: { CO: 2 * b, C: a - 2 * b } };
        }
    }
];

// Tính trạng thái sau phản ứng theo phương trình (chất hết / dư / sản phẩm)
function _labCompute(parsed, nInit) {
    const keys = parsed.reactants.map(r => _labKey(r.formula));
    for (const rule of LAB_RATIO_RULES) {
        const m = rule.match(keys);
        if (!m) continue;
        const nByKey = {};
        parsed.reactants.forEach(r => { nByKey[_labKey(r.formula)] = nInit[r.formula] || 0; });
        if (Object.values(nByKey).some(v => v <= 0)) break;
        const res = rule.solve(m, nByKey);
        // Đưa về tên công thức gốc cho chất tham gia
        const after = {};
        Object.entries(res.after).forEach(([f, mol]) => {
            const orig = parsed.reactants.find(r => _labKey(r.formula) === _labKey(f));
            after[orig ? orig.formula : f] = Math.max(0, mol);
        });
        return { after, ratio: res };
    }
    // Tỉ lượng thông thường: x = min(n_i / a_i)
    let x = Infinity;
    parsed.reactants.forEach(r => { x = Math.min(x, (nInit[r.formula] || 0) / r.coeff); });
    if (!isFinite(x)) x = 0;
    const after = {};
    parsed.reactants.forEach(r => { after[r.formula] = Math.max(0, (nInit[r.formula] || 0) - r.coeff * x); });
    parsed.products.forEach(p => { after[p.formula] = (after[p.formula] || 0) + p.coeff * x; });
    return { after, ratio: null };
}

// ── CƠ SỞ DỮ LIỆU XÚC TÁC (chương trình Hóa THPT) ─────────────────────
// speed: 5 rất nhanh · 4 nhanh · 3 vừa · 2 chậm · 1 rất chậm · 0 gần như không xảy ra
// equation (tùy chọn): xúc tác CHỌN LỌC → đổi xúc tác thì đổi sản phẩm
const LAB_CATALYST_DB = [
    {
        match: [['H2O2']],
        none: { speed: 1, note: 'H₂O₂ tự phân hủy rất chậm' },
        options: [
            { name: 'MnO₂', speed: 5, cond: 'nhiệt độ thường', note: 'Xúc tác quen thuộc trong SGK, sủi bọt O₂ mạnh' },
            { name: 'KI', speed: 5, cond: 'nhiệt độ thường', note: 'Ion I⁻ xúc tác rất mạnh (thí nghiệm "kem đánh răng voi")' },
            { name: 'Enzym catalaza', speed: 5, cond: '≈ 37 °C', note: 'Xúc tác sinh học có trong gan, khoai tây' },
            { name: 'Pt', speed: 4, cond: 'nhiệt độ thường', note: 'Bạch kim xúc tác tốt nhưng đắt' },
            { name: 'FeCl₃', speed: 3, cond: 'nhiệt độ thường', note: 'Ion Fe³⁺ xúc tác vừa phải' },
        ]
    },
    {
        match: [['KCLO3']],
        none: { speed: 1, note: 'Phải đun nóng mạnh (> 400 °C) mới phân hủy, rất chậm' },
        options: [
            { name: 'MnO₂', speed: 5, cond: 't° ≈ 200 °C', note: 'Xúc tác chuẩn trong SGK để điều chế O₂' },
            { name: 'Fe₂O₃', speed: 3, cond: 't°', note: 'Xúc tác được nhưng kém MnO₂' },
            { name: 'CuO', speed: 3, cond: 't°', note: 'Xúc tác được nhưng kém MnO₂' },
        ]
    },
    {
        match: [['N2', 'H2']],
        none: { speed: 0, note: 'Liên kết N≡N rất bền, gần như không phản ứng' },
        options: [
            { name: 'Fe', speed: 4, cond: '450–500 °C, 200 atm', note: 'Sắt (thêm K₂O, Al₂O₃): xúc tác chuẩn của quá trình Haber' },
            { name: 'Ru', speed: 5, cond: '≈ 400 °C', note: 'Rutheni hoạt tính cao hơn nhưng rất đắt' },
        ]
    },
    {
        match: [['SO2', 'O2']],
        none: { speed: 0, note: 'Gần như không xảy ra dù đun nóng' },
        options: [
            { name: 'V₂O₅', speed: 4, cond: '450 °C', note: 'Xúc tác chuẩn sản xuất H₂SO₄: rẻ, bền, không bị nhiễm độc' },
            { name: 'Pt', speed: 5, cond: '≈ 400 °C', note: 'Rất mạnh nhưng đắt, dễ bị asen làm "nhiễm độc"' },
            { name: 'Fe₂O₃', speed: 2, cond: '> 600 °C', note: 'Hoạt tính thấp, cần nhiệt độ cao hơn' },
        ]
    },
    {
        match: [['NH3', 'O2']],
        none: { speed: 3, note: 'Không có Pt: NH₃ cháy trong O₂ tạo N₂, không tạo NO', equation: '4NH3 + 3O2 → 2N2 + 6H2O' },
        options: [
            { name: 'Pt–Rh', speed: 5, cond: '850–900 °C', note: 'Oxi hóa NH₃ thành NO (sản xuất HNO₃)', equation: '4NH3 + 5O2 → 4NO + 6H2O' },
            { name: 'Cr₂O₃', speed: 3, cond: '≈ 800 °C', note: 'Cũng tạo NO nhưng hiệu suất thấp hơn Pt', equation: '4NH3 + 5O2 → 4NO + 6H2O' },
        ]
    },
    {
        match: [['CH3COOH', 'C2H5OH'], ['CH3COOH', 'CH3OH'], ['HCOOH', 'C2H5OH'], ['HCOOH', 'CH3OH']],
        none: { speed: 1, note: 'Este hóa xảy ra rất chậm' },
        options: [
            { name: 'H₂SO₄ đặc', speed: 4, cond: 't°', note: 'Vừa xúc tác vừa hút nước nên tăng hiệu suất este' },
            { name: 'HCl', speed: 3, cond: 't°', note: 'Axit mạnh cũng xúc tác nhưng không hút nước' },
        ]
    },
    {
        match: [['C2H4', 'H2'], ['C3H6', 'H2']],
        none: { speed: 0, note: 'Không xảy ra nếu không có xúc tác' },
        options: [
            { name: 'Ni', speed: 4, cond: 't°', note: 'Xúc tác phổ biến trong SGK' },
            { name: 'Pd', speed: 5, cond: 't°', note: 'Mạnh nhưng đắt' },
            { name: 'Pt', speed: 5, cond: 'nhiệt độ thường', note: 'Mạnh nhưng đắt' },
        ]
    },
    {
        match: [['C2H2', 'H2']],
        none: { speed: 0, note: 'Không xảy ra nếu không có xúc tác' },
        options: [
            { name: 'Ni', speed: 4, cond: 't°', note: 'Cộng H₂ đến cùng, tạo C₂H₆', equation: 'C2H2 + 2H2 → C2H6' },
            { name: 'Pd/PbCO₃', speed: 4, cond: 't°', note: 'Xúc tác "bị đầu độc": chỉ cộng 1 lần, dừng ở C₂H₄', equation: 'C2H2 + H2 → C2H4' },
        ]
    },
    {
        match: [['C6H12O6']],
        none: { speed: 0, note: 'Không lên men nếu không có enzym' },
        options: [
            { name: 'Enzym (men rượu)', speed: 3, cond: '30–35 °C', note: 'Nấm men chuyển glucozơ thành ancol etylic', equation: 'C6H12O6 → 2C2H5OH + 2CO2' },
        ]
    },
    {
        match: [['H2', 'O2']],
        none: { speed: 0, note: 'Ở nhiệt độ thường không phản ứng, cần tia lửa hoặc đốt nóng' },
        options: [
            { name: 'Pt', speed: 4, cond: 'nhiệt độ thường', note: 'Bột Pt làm H₂ cháy ngay ở nhiệt độ thường (đèn Döbereiner)' },
        ]
    },
    {
        match: [['C6H6', 'BR2']],
        none: { speed: 0, note: 'Benzen không phản ứng thế với Br₂ khi không có xúc tác' },
        options: [
            { name: 'Fe (bột)', speed: 4, cond: 't°', note: 'Fe tạo FeBr₃ xúc tác thế Br vào vòng benzen', equation: 'C6H6 + Br2 → C6H5Br + HBr' },
            { name: 'FeBr₃', speed: 4, cond: 't°', note: 'Xúc tác thế vào vòng benzen', equation: 'C6H6 + Br2 → C6H5Br + HBr' },
        ]
    },
    // Ánh sáng là ĐIỀU KIỆN khơi mào, không phải xúc tác
    { match: [['CH4', 'CL2'], ['C2H6', 'CL2']], light: 'Cần ánh sáng khơi mào (thế gốc). Ánh sáng là điều kiện, không phải xúc tác.' },
    { match: [['H2', 'CL2']], light: 'Cần ánh sáng hoặc đốt nóng. Ánh sáng là điều kiện, không phải xúc tác.' },
];

// Vài xúc tác quen thuộc — dùng để học sinh thấy tính CHỌN LỌC (không phải chất nào cũng xúc tác được)
const LAB_COMMON_CATALYSTS = ['MnO₂', 'Fe', 'Ni', 'Pt', 'V₂O₅', 'H₂SO₄ đặc'];
const LAB_SPEED_LABEL = ['gần như không xảy ra', 'rất chậm', 'chậm', 'vừa', 'nhanh', 'rất nhanh'];
const LAB_SPEED_TIME = [0, 8, 5, 3, 1.5, 0.8];   // giây chạy thanh tiến trình

const _labCatKey = (s) => String(s || '').replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)])
    .toLowerCase().replace(/[\s–\-(),]/g, '');

// Danh sách lựa chọn xúc tác cho một phản ứng: [{id, name, speed, cond, note, equation, effect}]
function _labCatalystChoices(reactantKeys, aiCatalyst, conditions) {
    const set = [...reactantKeys].sort().join('+');
    const entry = LAB_CATALYST_DB.find(e => e.match.some(m => [...m].sort().join('+') === set));
    const hasHeat = (conditions || []).some(c => /t°|°C|đun|nung/i.test(c));
    const choices = [];

    if (entry && entry.light) {
        choices.push({ id: 'none', name: 'Không dùng xúc tác', speed: 4, note: entry.light, isDefault: true });
        LAB_COMMON_CATALYSTS.forEach(n => choices.push({ id: 'x' + n, name: n, speed: 4, invalid: true,
            note: `${n} không phải xúc tác của phản ứng này. ${entry.light}` }));
        return choices;
    }
    if (entry) {
        choices.push({ id: 'none', name: 'Không dùng xúc tác', speed: entry.none.speed, note: entry.none.note, equation: entry.none.equation });
        entry.options.forEach((o, i) => choices.push({ id: 'c' + i, ...o, valid: true }));
        // Xúc tác AI đưa ra mà chưa có trong bảng → vẫn cho chọn, ghi rõ nguồn
        if (aiCatalyst && !entry.options.some(o => _labCatKey(o.name).includes(_labCatKey(aiCatalyst)) || _labCatKey(aiCatalyst).includes(_labCatKey(o.name)))) {
            choices.push({ id: 'ai', name: aiCatalyst, speed: 4, valid: true, note: 'Xúc tác theo đề bài / AI đề xuất' });
        }
        // "Pt" trùng với "Pt–Rh", "Fe" trùng với "Fe (bột)" — nhưng "Fe" KHÔNG trùng "Fe₂O₃"
        const sameCatalyst = (optName, n) => _labCatKey(optName) === _labCatKey(n)
            || String(optName).split(/[\s–\-/()]+/).some(t => _labCatKey(t) === _labCatKey(n));
        LAB_COMMON_CATALYSTS.filter(n => !entry.options.some(o => sameCatalyst(o.name, n)))
            .forEach(n => choices.push({ id: 'x' + n, name: n, speed: entry.none.speed, invalid: true,
                equation: entry.none.equation,
                note: `${n} không phải xúc tác của phản ứng này (xúc tác có tính chọn lọc), nên phản ứng diễn ra như khi không có xúc tác` }));
        // Mặc định: xúc tác khớp với đề bài, nếu không thì xúc tác chuẩn (đầu bảng)
        const pre = choices.find(c => c.valid && aiCatalyst && (_labCatKey(c.name).includes(_labCatKey(aiCatalyst)) || _labCatKey(aiCatalyst).includes(_labCatKey(c.name))))
            || choices.find(c => c.valid);
        if (pre) pre.isDefault = true;
        return choices;
    }
    if (aiCatalyst) {
        // Phản ứng chưa có trong bảng nhưng đề bài có xúc tác
        choices.push({ id: 'none', name: 'Không dùng xúc tác', speed: 1, note: 'Thiếu xúc tác phản ứng xảy ra rất chậm' });
        choices.push({ id: 'ai', name: aiCatalyst, speed: 4, valid: true, isDefault: true, note: 'Xúc tác theo đề bài' });
        return choices;
    }
    // Phản ứng không cần xúc tác (trung hòa, kết tủa, cháy, kim loại + axit...)
    const why = hasHeat ? 'Phản ứng chỉ cần đun nóng, không cần xúc tác'
        : 'Phản ứng xảy ra ngay khi các chất tiếp xúc, không cần xúc tác';
    choices.push({ id: 'none', name: 'Không dùng xúc tác', speed: hasHeat ? 4 : 5, note: why, isDefault: true });
    LAB_COMMON_CATALYSTS.forEach(n => choices.push({ id: 'x' + n, name: n, speed: hasHeat ? 4 : 5, invalid: true,
        note: `Thêm ${n} không làm thay đổi phản ứng. ${why}` }));
    return choices;
}

function initVirtualLab(wid, ctx) {
    const panel = document.getElementById(`lab-${wid}`);
    const body = document.getElementById(`lab-body-${wid}`);
    const toggle = document.getElementById(`lab-toggle-${wid}`);
    if (!panel || !body || !toggle) return;

    const baseParsed = _labParseEquation(ctx.equation, ctx.reactants, ctx.products);
    let parsed = baseParsed;
    const M = (f) => calculateAccurateMolarMass(_labNorm(f)) || 1;
    // Mặc định: 0,1 mol × hệ số (đúng tỉ lệ phương trình — giống phần hiển thị ban đầu)
    const nInit = {};
    parsed.reactants.forEach(r => { nInit[r.formula] = 0.1 * r.coeff; });
    let unit = 'g';
    let built = false;

    // Nước là chất tham gia cùng chất khác → thực tế luôn dư rất nhiều (dung môi)
    const isWater = (f) => _labKey(f) === 'H2O';
    const waterReactant = parsed.reactants.length > 1 ? parsed.reactants.find(r => isWater(r.formula)) : null;
    let waterExcess = !!waterReactant;
    const WATER_EXCESS_MOL = 1e6;
    // Nước sinh ra "hòa vào dung dịch" khi phản ứng xảy ra trong dung dịch (không phải đốt cháy khí)
    const aqueous = !parsed.reactants.every(r => isGasMolecule(r.formula));
    // Phản ứng thuận nghịch: số liệu tính được chỉ là lượng tối đa theo lý thuyết
    const reversible = /⇌|⇄|<=>|<->/.test(String(ctx.equation || ''));
    const reversibleShort = (() => {
        const keys = parsed.reactants.map(r => _labKey(r.formula)).sort().join('+');
        if (keys === 'CO2+H2O') return 'thực tế chỉ ~0,2% CO₂ chuyển thành H₂CO₃';
        if (keys === 'H2O+SO2') return 'thực tế chỉ một phần nhỏ SO₂ chuyển thành H₂SO₃';
        if (keys === 'H2+N2') return 'hiệu suất công nghiệp chỉ ~20–25%';
        return 'thực tế chỉ chuyển hóa một phần';
    })();
    // Thẻ sản phẩm đang hiển thị (đổi khi sản phẩm phụ thuộc tỉ lệ mol, vd CO₂ + NaOH)
    let shownProducts = [...(ctx.products || [])];
    // Lượng "mặc định" của mỗi chất (0,1 mol × hệ số) — mốc 100% cho mô hình 3D
    const defaultMol = (f) => {
        const r = parsed.reactants.find(x => _labKey(x.formula) === _labKey(f));
        if (r) return 0.1 * r.coeff;
        const pr = parsed.products.find(x => _labKey(x.formula) === _labKey(f));
        return 0.1 * (pr ? pr.coeff : 1);
    };

    // Lượng mol dùng để tính: nước dung môi coi như rất lớn
    const nEff = () => {
        const n = { ...nInit };
        if (waterExcess) n[waterReactant.formula] = WATER_EXCESS_MOL;
        return n;
    };
    const catalyst = ctx.catalyst && !/^(null|none|không)$/i.test(String(ctx.catalyst).trim()) ? ctx.catalyst : null;

    // ── Chọn chất xúc tác ──
    const catChoices = _labCatalystChoices(baseParsed.reactants.map(r => _labKey(r.formula)), catalyst, ctx.conditions);
    let catChoice = catChoices.find(c => c.isDefault) || catChoices[0];
    const arrowLabel = document.querySelector(`#${wid} .cw-catalyst-label`);
    const arrowOriginal = arrowLabel ? { html: arrowLabel.innerHTML, cls: arrowLabel.className } : null;
    function applyCatalyst() {
        // Xúc tác chọn lọc: dùng phương trình tương ứng (vd NH₃ + O₂ có/không có Pt)
        parsed = catChoice.equation ? _labParseEquation(catChoice.equation, ctx.reactants, ctx.products) : baseParsed;
        parsed.reactants.forEach(r => { if (nInit[r.formula] == null) nInit[r.formula] = 0.1 * r.coeff; });
        if (arrowLabel) {
            const used = catChoice.valid;
            arrowLabel.className = 'cw-catalyst-label' + (used ? '' : ' cw-no-catalyst');
            arrowLabel.innerHTML = used ? `<span class="cw-cat-icon">⚡</span>Xúc tác: ${escHtml(catChoice.name)}` : 'Không dùng xúc tác';
        }
    }

    function build() {
        const sliders = parsed.reactants.map((r, i) => (waterExcess && r === waterReactant) ? `
            <div class="lab-slider-row lab-water-row">
                <span class="lab-formula">${r.coeff > 1 ? `<b class="lab-coef">${r.coeff}</b>` : ''}<span>${renderFormulaHtml(r.formula)}</span></span>
                <span class="lab-water-note" title="Phản ứng tiến hành trong lượng nước rất lớn, nên lượng sản phẩm do chất còn lại quyết định">💧 Dư (dung môi)</span>
            </div>` : `
            <div class="lab-slider-row" title="M = ${_labFmt(M(r.formula), 1)} g/mol">
                <span class="lab-formula">${r.coeff > 1 ? `<b class="lab-coef">${r.coeff}</b>` : ''}<span>${renderFormulaHtml(r.formula)}</span></span>
                <input type="range" class="lab-range" data-i="${i}" min="0" max="1000" step="1">
                <input type="number" class="lab-num" data-i="${i}" min="0" step="any">
                <span class="lab-unit">${unit}</span>
            </div>`).join('');
        const cond = (ctx.conditions || []).filter(c => c !== catalyst);
        body.innerHTML = `
            <div class="lab-topline">
                <span class="lab-cat-icon">⚡</span><span>Xúc tác</span>
                <select class="lab-cat-select" id="lab-cat-sel-${wid}">
                    ${[['Dùng được cho phản ứng này', c => c.valid], ['', c => c.id === 'none'], ['Không phải xúc tác của phản ứng này', c => c.invalid]]
                        .map(([label, fn]) => {
                            const opts = catChoices.filter(fn).map(c => `<option value="${c.id}" ${c === catChoice ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
                            return opts ? (label ? `<optgroup label="${label}">${opts}</optgroup>` : opts) : '';
                        }).join('')}
                </select>
                <div class="lab-rate"><div class="lab-rate-fill" id="lab-rate-${wid}"></div></div>
                <span class="lab-speed" id="lab-speed-${wid}"></span>
                ${catChoice.valid && catChoice.cond ? `<span class="lab-chip">${escHtml(catChoice.cond)}</span>`
                    : (cond.length ? `<span class="lab-cond">${cond.map(c => `<span class="lab-chip">${escHtml(c)}</span>`).join(' ')}</span>` : '')}
                <span class="lab-unit-switch">
                    <button class="lab-unit-btn ${unit === 'g' ? 'active' : ''}" data-unit="g">gam</button>
                    <button class="lab-unit-btn ${unit === 'mol' ? 'active' : ''}" data-unit="mol">mol</button>
                    <button class="lab-reset-btn" id="lab-reset-${wid}" title="Về tỉ lệ đúng phương trình">↺</button>
                </span>
            </div>
            <div class="lab-cat-note" id="lab-cat-note-${wid}"></div>
            <div class="lab-sliders">
                ${sliders}
                ${waterReactant ? `<label class="lab-water-custom"><input type="checkbox" id="lab-water-custom-${wid}" ${waterExcess ? '' : 'checked'}> Nhập lượng nước</label>` : ''}
            </div>
            <div class="lab-ratio" id="lab-ratio-${wid}"></div>
            <div class="lab-bars" id="lab-bars-${wid}"></div>
            <div class="lab-reversible" id="lab-rev-${wid}" style="display:none"></div>`;

        // Thanh trượt: dải 0 → 5 lần lượng mặc định (đơn vị đang chọn)
        const maxOf = (r) => 0.5 * r.coeff * (unit === 'g' ? M(r.formula) : 1);
        const toUnit = (r, mol) => unit === 'g' ? mol * M(r.formula) : mol;
        const fromUnit = (r, v) => unit === 'g' ? v / M(r.formula) : v;
        body.querySelectorAll('.lab-range').forEach(el => {
            const r = parsed.reactants[+el.dataset.i];
            el.value = Math.round(toUnit(r, nInit[r.formula]) / maxOf(r) * 1000);
            el.addEventListener('input', () => {
                nInit[r.formula] = fromUnit(r, (+el.value / 1000) * maxOf(r));
                syncNumbers(); update();
            });
        });
        body.querySelectorAll('.lab-num').forEach(el => {
            const r = parsed.reactants[+el.dataset.i];
            el.addEventListener('input', () => {
                const v = parseFloat(el.value);
                if (!isNaN(v) && v >= 0) {
                    nInit[r.formula] = fromUnit(r, v);
                    const range = body.querySelector(`.lab-range[data-i="${el.dataset.i}"]`);
                    range.value = Math.min(1000, Math.round(v / maxOf(r) * 1000));
                    update();
                }
            });
        });
        function syncNumbers() {
            body.querySelectorAll('.lab-num').forEach(el => {
                const r = parsed.reactants[+el.dataset.i];
                el.value = +toUnit(r, nInit[r.formula]).toFixed(unit === 'g' ? 2 : 3);
            });
        }
        body.querySelectorAll('.lab-unit-btn').forEach(b => b.addEventListener('click', () => {
            unit = b.dataset.unit; build(); update();
        }));
        document.getElementById(`lab-reset-${wid}`).addEventListener('click', () => {
            parsed.reactants.forEach(r => { nInit[r.formula] = 0.1 * r.coeff; });
            waterExcess = !!waterReactant;
            catChoice = catChoices.find(c => c.isDefault) || catChoices[0];
            applyCatalyst();
            build(); update();
        });
        document.getElementById(`lab-water-custom-${wid}`)?.addEventListener('change', (e) => {
            waterExcess = !e.target.checked;
            build(); update();
        });
        wireCatalyst();
        syncNumbers();
    }

    // Xúc tác: chọn → thanh tốc độ chạy nhanh/chậm + ghi chú đúng bản chất
    function wireCatalyst() {
        const sel = document.getElementById(`lab-cat-sel-${wid}`);
        const fill = document.getElementById(`lab-rate-${wid}`);
        const speedEl = document.getElementById(`lab-speed-${wid}`);
        const note = document.getElementById(`lab-cat-note-${wid}`);
        const selective = catChoices.some(c => c.equation);
        const sp = catChoice.speed;
        speedEl.textContent = LAB_SPEED_LABEL[sp];
        speedEl.className = 'lab-speed lab-speed-' + sp;
        let extra = '';
        if (catChoice.valid && selective) extra = ' · Xúc tác chọn lọc: đổi xúc tác thì đổi sản phẩm';
        else if (catChoice.valid) extra = ' · Xúc tác chỉ làm phản ứng nhanh hơn, không làm thay đổi lượng sản phẩm';
        note.innerHTML = `${catChoice.invalid ? '❌ ' : catChoice.valid ? '✅ ' : ''}${escHtml(catChoice.note || '')}${extra}`;
        // Thanh tốc độ: 0 = gần như đứng yên
        fill.style.transition = 'none'; fill.style.width = '0%';
        void fill.offsetWidth;
        fill.classList.toggle('slow', sp <= 2);
        fill.style.transition = sp === 0 ? 'width 3s ease-out' : `width ${LAB_SPEED_TIME[sp]}s linear`;
        fill.style.width = sp === 0 ? '6%' : '100%';
        sel.addEventListener('change', () => {
            catChoice = catChoices.find(c => c.id === sel.value) || catChoice;
            applyCatalyst();
            build(); update();
        });
    }

    // Gắn nhãn lượng chất lên các thẻ mô hình 3D
    function setCardBadges(after) {
        const put = (viewId, html, cls) => {
            const card = document.getElementById(viewId)?.closest('.cw-mol-card');
            if (!card) return;
            let b = card.querySelector('.lab-amount');
            if (!b) { b = document.createElement('div'); b.className = 'lab-amount'; card.appendChild(b); }
            b.className = 'lab-amount ' + (cls || '');
            b.innerHTML = html;
        };
        (ctx.reactants || []).forEach((f, i) => {
            const r = parsed.reactants.find(x => _labKey(x.formula) === _labKey(f));
            if (!r) return;
            // Mô hình 3D chất tham gia: to/nhỏ theo lượng ban đầu (nước dung môi giữ nguyên)
            if (window.setChemAmount) setChemAmount(`rv${i}${wid}`, (waterExcess && r === waterReactant) ? 1 : (nInit[r.formula] || 0) / defaultMol(r.formula));
            if (waterExcess && r === waterReactant) { put(`rv${i}${wid}`, '<span class="lab-tag-excess">Dư</span>'); return; }
            const init = nInit[r.formula] || 0, left = after[r.formula] || 0;
            const state = left < 1e-6 ? '<span class="lab-tag-out">Hết</span>' : `<span class="lab-tag-excess">Dư ${_labFmt(left * M(r.formula), 1)} g</span>`;
            put(`rv${i}${wid}`, `${_labFmt(init * M(r.formula), 1)} g ${state}`);
        });
        shownProducts.forEach((f, i) => {
            const key = Object.keys(after).find(k => _labKey(k) === _labKey(f));
            const mol = key ? after[key] : 0;
            // Mô hình 3D sản phẩm: lượng tạo thành (0 → cốc rỗng / không có khói)
            if (window.setChemAmount) setChemAmount(`pv${i}${wid}`, mol / defaultMol(f));
            put(`pv${i}${wid}`, mol > 1e-6 ? `${reversible ? '≤ ' : '+'}${_labFmt(mol * M(f), 1)} g` : '0 g',
                mol > 1e-6 ? 'lab-amount-prod' : 'lab-amount-none');
        });
    }

    function update() {
        const n0 = nEff();
        let { after, ratio } = _labCompute(parsed, n0);
        if (catChoice.speed === 0) {
            // Gần như không xảy ra: chất tham gia giữ nguyên, không tạo sản phẩm
            after = {};
            parsed.reactants.forEach(r => { after[r.formula] = n0[r.formula] || 0; });
            parsed.products.forEach(pr => { after[pr.formula] = 0; });
            ratio = null;
        }
        // Danh sách chất: tham gia (ban đầu → còn lại) + sản phẩm (tạo thành)
        const rows = [];
        parsed.reactants.forEach(r => {
            const solvent = waterExcess && r === waterReactant;
            rows.push({ f: r.formula, before: solvent ? 0 : (nInit[r.formula] || 0), after: solvent ? 0 : (after[r.formula] || 0),
                        used: (n0[r.formula] || 0) - (after[r.formula] || 0), role: 'r', solvent });
        });
        Object.keys(after).forEach(f => {
            if (rows.some(x => x.f === f)) return;
            rows.push({ f, before: 0, after: after[f], role: 'p' });
        });
        const massOf = (f, mol) => mol * M(f);
        const maxMass = Math.max(1e-9, ...rows.map(x => Math.max(massOf(x.f, x.before), massOf(x.f, x.after))));

        document.getElementById(`lab-bars-${wid}`).innerHTML = rows.map(x => {
            const mb = massOf(x.f, x.before), ma = massOf(x.f, x.after);
            if (x.solvent) {
                return `
                <div class="lab-bar-row" title="Nước là dung môi, luôn dư; chỉ ${_labFmt(massOf(x.f, x.used))} g tham gia phản ứng">
                    <div class="lab-bar-label"><span>${renderFormulaHtml(x.f)}</span><span class="lab-tag-excess">DƯ</span></div>
                    <div class="lab-bar-track lab-bar-solvent"></div>
                    <div class="lab-bar-val">dung môi</div>
                </div>`;
            }
            let tag = '';
            if (x.role === 'r') tag = x.after < 1e-6 ? '<span class="lab-tag-out">HẾT</span>' : '<span class="lab-tag-excess">DƯ</span>';
            const gas = isGasMolecule(x.f) && x.after > 1e-6 ? ` <span class="lab-mol">${_labFmt(x.after * LAB_GAS_MOLAR_VOLUME)} L</span>` : '';
            const val = x.role === 'r'
                ? `${_labFmt(mb, 1)} → <b>${_labFmt(ma, 1)} g</b>`
                : `<b>${reversible ? '≤ ' : '+'}${_labFmt(ma, 1)} g</b>`;
            return `
                <div class="lab-bar-row" title="${_labFmt(x.after, 3)} mol${isWater(x.f) && x.role === 'p' && aqueous ? ' — hòa vào dung dịch' : ''}">
                    <div class="lab-bar-label"><span>${renderFormulaHtml(x.f)}</span>${tag}</div>
                    <div class="lab-bar-track">
                        ${x.role === 'r' ? `<div class="lab-bar before" style="width:${mb / maxMass * 100}%"></div>` : ''}
                        <div class="lab-bar after ${x.role === 'p' ? 'prod' : ''}" style="width:${ma / maxMass * 100}%"></div>
                    </div>
                    <div class="lab-bar-val">${val}${gas}</div>
                </div>`;
        }).join('');

        // Tỉ lệ mol quyết định sản phẩm (chỉ hiện khi có)
        const ratioEl = document.getElementById(`lab-ratio-${wid}`);
        ratioEl.innerHTML = ratio ? `📌 ${escHtml(ratio.tName.replace(/^T = /, 'T = '))} = <b>${_labFmt(ratio.T, 2)}</b> → ${escHtml(ratio.case.replace(/^.*?→\s*/, ''))}` : '';
        ratioEl.style.display = ratio ? '' : 'none';

        // Phản ứng thuận nghịch: một dòng ngắn
        const revEl = document.getElementById(`lab-rev-${wid}`);
        revEl.style.display = reversible ? '' : 'none';
        revEl.innerHTML = reversible ? `⇌ Lượng tối đa theo lý thuyết — ${escHtml(reversibleShort)}` : '';

        const actualProducts = rows.filter(x => x.role === 'p' && x.after > 1e-6).map(x => x.f);
        const sameSet = (a, b) => a.length === b.length && a.every(f => b.some(g => _labKey(g) === _labKey(f)));
        if (actualProducts.length && !sameSet(actualProducts, shownProducts) && typeof renderProductCards === 'function') {
            shownProducts = actualProducts;
            renderProductCards(wid, shownProducts, ctx.equation);
        }
        setCardBadges(after);
    }

    function clearCardBadges() {
        const w = document.getElementById(wid);
        w?.querySelectorAll('.lab-amount').forEach(b => b.remove());
        w?.querySelectorAll('.cw-mol-view').forEach(v => { if (window.clearChemAmount) clearChemAmount(v.id); });
        const original = ctx.products || [];
        const same = original.length === shownProducts.length && original.every((f, i) => _labKey(f) === _labKey(shownProducts[i]));
        if (!same && typeof renderProductCards === 'function') {
            shownProducts = [...original];
            renderProductCards(wid, shownProducts, ctx.equation);
        }
    }

    toggle.addEventListener('click', () => {
        const open = body.classList.toggle('hidden') === false;
        toggle.textContent = open ? 'Thu gọn ▲' : 'Mở rộng ▼';
        // Mở thí nghiệm ảo: cả bảng cuộn được, không ép nhỏ phần mô hình 3D
        document.getElementById(wid)?.classList.toggle('cw-lab-open', open);
        if (open) {
            applyCatalyst();
            if (!built) { build(); built = true; }
            update();
        } else {
            clearCardBadges();
            if (arrowLabel && arrowOriginal) { arrowLabel.innerHTML = arrowOriginal.html; arrowLabel.className = arrowOriginal.cls; }
        }
    });
}
