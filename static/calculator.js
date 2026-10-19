// ============================================================
//  calculator.js — MÁY TÍNH KHOA HỌC (mô phỏng fx-580VN X)
//  • Bố cục phím, SHIFT/ALPHA, phím tròn REPLAY, MENU, SETUP, OPTN như máy thật
//  • Hiển thị tự nhiên (MathI/MathO): phân số, căn, mũ, log cơ số, ∫, d/dx, Σ
//  • Kết quả chính xác: phân số, k√n, kπ/n — S⇔D đổi sang thập phân
//  • CALC, SOLVE, Phương trình/HPT, Bảng giá trị, Bất phương trình, Tỉ lệ
//  Kéo thân máy để di chuyển khắp bảng. Không dùng eval.
// ============================================================
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════
    //  1. MÔ HÌNH BIỂU THỨC (cây) & CON TRỎ
    // ════════════════════════════════════════════════════════════
    // Row = mảng node. Node lá: {k:'ch', v, d}. Node cấu trúc: {k:'frac', num:[], den:[]} ...
    const SLOTS = {
        frac: ['num', 'den'], mixed: ['whole', 'num', 'den'], sqrt: ['arg'], root: ['idx', 'arg'],
        pow: ['exp'], logb: ['base', 'arg'], abs: ['arg'], epow: ['exp'], tpow: ['exp'], e10: ['exp'],
        int: ['lo', 'hi', 'f'], der: ['f', 'at'], sum: ['lo', 'hi', 'f'],
    };
    const ch = (v, d) => ({ k: 'ch', v, d: d ?? v });
    function mk(kind, init = {}) {
        const n = { k: kind };
        SLOTS[kind].forEach(s => { n[s] = init[s] ? init[s].slice() : []; });
        return n;
    }

    // Duyệt toàn bộ vị trí con trỏ theo thứ tự đọc (trái → phải, vào trong cấu trúc)
    function positions(row, out = [], parent = null) {
        for (let i = 0; i <= row.length; i++) {
            out.push({ row, idx: i, parent });
            const n = row[i];
            if (i < row.length && SLOTS[n.k]) SLOTS[n.k].forEach(s => positions(n[s], out, { node: n, slot: s, row, i }));
        }
        return out;
    }

    // ════════════════════════════════════════════════════════════
    //  2. HIỂN THỊ (HTML)
    // ════════════════════════════════════════════════════════════
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    function renderRow(row, cur, opt = {}) {
        let html = '';
        const caret = '<span class="cx-caret"></span>';
        for (let i = 0; i <= row.length; i++) {
            if (cur && cur.row === row && cur.idx === i) html += caret;
            if (i === row.length) break;
            html += renderNode(row[i], cur);
        }
        if (!row.length && !(cur && cur.row === row)) html += opt.noBox ? '' : '<span class="cx-box"></span>';
        return html;
    }
    function slot(row, cur, cls = '') { return `<span class="cx-slot ${cls}">${renderRow(row, cur)}</span>`; }
    function renderNode(n, cur) {
        switch (n.k) {
            case 'ch': return `<span class="cx-ch">${esc(n.d)}</span>`;
            case 'frac': return `<span class="cx-frac">${slot(n.num, cur, 'cx-num')}${slot(n.den, cur, 'cx-den')}</span>`;
            case 'mixed': return `${slot(n.whole, cur)}<span class="cx-frac">${slot(n.num, cur, 'cx-num')}${slot(n.den, cur, 'cx-den')}</span>`;
            case 'sqrt': return `<span class="cx-sqrt"><span class="cx-rad">√</span>${slot(n.arg, cur, 'cx-under')}</span>`;
            case 'root': return `<span class="cx-sqrt"><sup class="cx-idx">${renderRow(n.idx, cur)}</sup><span class="cx-rad">√</span>${slot(n.arg, cur, 'cx-under')}</span>`;
            case 'pow': return `<sup class="cx-sup">${renderRow(n.exp, cur)}</sup>`;
            case 'epow': return `<span class="cx-ch">e</span><sup class="cx-sup">${renderRow(n.exp, cur)}</sup>`;
            case 'tpow': return `<span class="cx-ch">10</span><sup class="cx-sup">${renderRow(n.exp, cur)}</sup>`;
            case 'e10': return `<span class="cx-ch">×10</span><sup class="cx-sup">${renderRow(n.exp, cur)}</sup>`;
            case 'logb': return `<span class="cx-ch">log</span><sub class="cx-sub">${renderRow(n.base, cur)}</sub><span class="cx-ch">(</span>${renderRow(n.arg, cur)}<span class="cx-ch">)</span>`;
            case 'abs': return `<span class="cx-abs">${slot(n.arg, cur)}</span>`;
            case 'int': return `<span class="cx-bigop"><span class="cx-lim">${renderRow(n.hi, cur)}</span><span class="cx-sym">∫</span><span class="cx-lim">${renderRow(n.lo, cur)}</span></span>${slot(n.f, cur)}<span class="cx-ch">dx</span>`;
            case 'sum': return `<span class="cx-bigop"><span class="cx-lim">${renderRow(n.hi, cur)}</span><span class="cx-sym">Σ</span><span class="cx-lim">x=${renderRow(n.lo, cur)}</span></span><span class="cx-ch">(</span>${slot(n.f, cur)}<span class="cx-ch">)</span>`;
            case 'der': return `<span class="cx-frac cx-dd"><span class="cx-num">d</span><span class="cx-den">dx</span></span><span class="cx-ch">(</span>${slot(n.f, cur)}<span class="cx-ch">)</span><span class="cx-at">|<sub>x=${renderRow(n.at, cur)}</sub></span>`;
        }
        return '';
    }

    // ════════════════════════════════════════════════════════════
    //  3. TÍNH TOÁN — bộ phân tích đệ quy trên cây biểu thức
    // ════════════════════════════════════════════════════════════
    const S = {               // trạng thái máy
        angle: 'D',           // D | R | G
        mathOut: true,        // MathO (kết quả chính xác) | thập phân
        fix: null,            // null = Norm, 0..9 = Fix
        mem: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 },
        ans: 0,
    };
    class CalcError extends Error {}
    const MathErr = () => { throw new CalcError('Math'); };
    const SynErr = () => { throw new CalcError('Syntax'); };

    const toRad = (x) => S.angle === 'D' ? x * Math.PI / 180 : S.angle === 'G' ? x * Math.PI / 200 : x;
    const fromRad = (x) => S.angle === 'D' ? x * 180 / Math.PI : S.angle === 'G' ? x * 200 / Math.PI : x;
    const clean = (x) => (Math.abs(x) < 1e-13 ? 0 : x);
    const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
    const isInt = (x) => Math.abs(x - Math.round(x)) < 1e-9;
    function fact(n) { if (n < 0 || !isInt(n) || n > 69) MathErr(); let f = 1; for (let k = 2; k <= n; k++) f *= k; return f; }
    const FN = {
        sin: (x) => clean(Math.sin(toRad(x))), cos: (x) => clean(Math.cos(toRad(x))),
        tan: (x) => { if (Math.abs(Math.cos(toRad(x))) < 1e-13) MathErr(); return clean(Math.tan(toRad(x))); },
        asin: (x) => { if (Math.abs(x) > 1) MathErr(); return fromRad(Math.asin(x)); },
        acos: (x) => { if (Math.abs(x) > 1) MathErr(); return fromRad(Math.acos(x)); },
        atan: (x) => fromRad(Math.atan(x)),
        sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh,
        acosh: (x) => { if (x < 1) MathErr(); return Math.acosh(x); }, atanh: (x) => { if (Math.abs(x) >= 1) MathErr(); return Math.atanh(x); },
        ln: (x) => { if (x <= 0) MathErr(); return Math.log(x); },
        log: (x) => { if (x <= 0) MathErr(); return Math.log10(x); },
        Int: (x) => Math.trunc(x), Intg: (x) => Math.floor(x),
        GCD: (a, b) => { if (!isInt(a) || !isInt(b)) MathErr(); return gcd(Math.round(a), Math.round(b)); },
        LCM: (a, b) => { if (!isInt(a) || !isInt(b)) MathErr(); a = Math.round(a); b = Math.round(b); return a && b ? Math.abs(a * b) / gcd(a, b) : 0; },
        RanInt: (a, b) => { if (!isInt(a) || !isInt(b) || a > b) MathErr(); return Math.floor(Math.random() * (b - a + 1)) + Math.round(a); },
    };
    const TWO_ARG = new Set(['GCD', 'LCM', 'RanInt']);

    // Chuyển cây → dãy token cho bộ phân tích
    function tokenize(row) {
        return row.map(n => {
            if (n.k !== 'ch') return { t: 'struct', n };
            const v = n.v;
            if (/^[0-9.]$/.test(v)) return { t: 'digit', v };
            if (['+', '−', '×', '÷'].includes(v)) return { t: 'op', v };
            if (v === 'nCr' || v === 'nPr') return { t: 'comb', v };
            if (v === '(') return { t: 'lp' };
            if (v === ')') return { t: 'rp' };
            if (v === ',') return { t: 'comma' };
            if (v === '=') return { t: 'eq' };
            if (v === 'neg') return { t: 'neg' };
            if (v === 'π' || v === 'e') return { t: 'const', v };
            if (v === 'Ans') return { t: 'ans' };
            if (v === 'Ran#') return { t: 'ran' };
            if (/^[A-FXYM]$/.test(v)) return { t: 'var', v };
            if (['!', '%', 'deg', 'rad', 'grad'].includes(v)) return { t: 'post', v };
            if (v.endsWith('(')) return { t: 'fn', v: v.slice(0, -1) };
            return { t: 'bad' };
        });
    }
    const FN_ALIAS = { 'sin⁻¹': 'asin', 'cos⁻¹': 'acos', 'tan⁻¹': 'atan', 'sinh⁻¹': 'asinh', 'cosh⁻¹': 'acosh', 'tanh⁻¹': 'atanh', 'RanInt#': 'RanInt' };

    function evalRow(row, env = {}) {
        const toks = tokenize(row);
        let i = 0;
        const peek = () => toks[i];
        const startsPrimary = (t) => t && ['digit', 'const', 'var', 'ans', 'fn', 'lp', 'ran'].includes(t.t) ||
            (t && t.t === 'struct' && !['pow', 'e10'].includes(t.n.k));
        const getVar = (v) => (v in env ? env[v] : S.mem[v]);

        function number() {
            let s = '';
            while (peek() && peek().t === 'digit') s += toks[i++].v;
            if (s === '.' || (s.match(/\./g) || []).length > 1) SynErr();
            return parseFloat(s);
        }
        function structVal(n) {
            const ev = (r, e = env) => { if (!r.length) SynErr(); return evalRow(r, e); };
            switch (n.k) {
                case 'frac': { const d = ev(n.den); if (d === 0) MathErr(); return ev(n.num) / d; }
                case 'mixed': { const w = ev(n.whole), d = ev(n.den); if (d === 0) MathErr(); const f = ev(n.num) / d; return w < 0 ? w - f : w + f; }
                case 'sqrt': { const a = ev(n.arg); if (a < 0) MathErr(); return Math.sqrt(a); }
                case 'root': {
                    const k = ev(n.idx), a = ev(n.arg);
                    if (k === 0) MathErr();
                    if (a < 0) { if (isInt(k) && Math.round(k) % 2 !== 0) return -Math.pow(-a, 1 / k); MathErr(); }
                    return Math.pow(a, 1 / k);
                }
                case 'logb': { const b = ev(n.base), a = ev(n.arg); if (a <= 0 || b <= 0 || b === 1) MathErr(); return Math.log(a) / Math.log(b); }
                case 'abs': return Math.abs(ev(n.arg));
                case 'epow': return Math.exp(ev(n.exp));
                case 'tpow': return Math.pow(10, ev(n.exp));
                case 'int': return integrate(n, env);
                case 'der': return derivative(n, env);
                case 'sum': return summation(n, env);
            }
            SynErr();
        }
        function primary() {
            const t = peek();
            if (!t) SynErr();
            if (t.t === 'digit') return number();
            if (t.t === 'const') { i++; return t.v === 'π' ? Math.PI : Math.E; }
            if (t.t === 'var') { i++; return getVar(t.v); }
            if (t.t === 'ans') { i++; return S.ans; }
            if (t.t === 'ran') { i++; return Math.round(Math.random() * 1000) / 1000; }
            if (t.t === 'struct') { i++; return structVal(t.n); }
            if (t.t === 'lp' || t.t === 'fn') {
                i++;
                const a = expr();
                let b;
                const name = t.t === 'fn' ? (FN_ALIAS[t.v] || t.v) : null;
                if (name && TWO_ARG.has(name)) { if (!peek() || peek().t !== 'comma') SynErr(); i++; b = expr(); }
                if (peek() && peek().t === 'rp') i++;        // thiếu ")" ở cuối vẫn được, như máy thật
                else if (peek() && peek().t !== 'eq') SynErr();
                if (!name) return a;
                if (!FN[name]) SynErr();
                return b === undefined ? FN[name](a) : FN[name](a, b);
            }
            SynErr();
        }
        function postfix() {
            let v = primary();
            for (;;) {
                const t = peek();
                if (t && t.t === 'post') {
                    i++;
                    if (t.v === '!') v = fact(v);
                    else if (t.v === '%') v = v / 100;
                    else if (t.v === 'deg') v = S.angle === 'D' ? v : S.angle === 'R' ? v * Math.PI / 180 : v * 200 / 180;
                    else if (t.v === 'rad') v = S.angle === 'R' ? v : S.angle === 'D' ? v * 180 / Math.PI : v * 200 / Math.PI;
                    else if (t.v === 'grad') v = S.angle === 'G' ? v : S.angle === 'D' ? v * 180 / 200 : v * Math.PI / 200;
                } else if (t && t.t === 'struct' && t.n.k === 'pow') {
                    i++;
                    const e = evalRow(t.n.exp, env);
                    if (v < 0 && !isInt(e)) {
                        // căn bậc lẻ của số âm, vd (−8)^(1/3)
                        const inv = 1 / e;
                        if (isInt(inv) && Math.round(inv) % 2 !== 0) { v = -Math.pow(-v, e); continue; }
                        MathErr();
                    }
                    if (v === 0 && e < 0) MathErr();
                    v = Math.pow(v, e);
                } else if (t && t.t === 'struct' && t.n.k === 'e10') {
                    i++;
                    v = v * Math.pow(10, evalRow(t.n.exp, env));
                } else break;
            }
            return v;
        }
        function unary() {
            if (peek() && peek().t === 'neg') { i++; return -unary(); }
            if (peek() && peek().t === 'struct' && peek().n.k === 'e10') { i++; return Math.pow(10, evalRow(toks[i - 1].n.exp, env)); }
            return postfix();
        }
        function comb() {
            let v = unary();
            while (peek() && peek().t === 'comb') {
                const op = toks[i++].v;
                const r = unary();
                if (!isInt(v) || !isInt(r) || v < 0 || r < 0 || r > v) MathErr();
                const n = Math.round(v), k = Math.round(r);
                let res = 1;
                for (let j = 0; j < k; j++) res *= (n - j);
                v = op === 'nPr' ? res : res / fact(k);
            }
            return v;
        }
        function term() {
            let v = comb();
            for (;;) {
                const t = peek();
                if (t && t.t === 'op' && (t.v === '×' || t.v === '÷')) {
                    i++;
                    const r = comb();
                    if (t.v === '÷' && r === 0) MathErr();
                    v = t.v === '×' ? v * r : v / r;
                } else if (startsPrimary(t)) v *= comb();          // nhân ngầm: 2π, 3(4), 2sin(30)
                else break;
            }
            return v;
        }
        function expr() {
            let v = term();
            while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '−')) {
                const op = toks[i++].v;
                const r = term();
                v = op === '+' ? v + r : v - r;
            }
            return v;
        }
        if (!toks.length) SynErr();
        if (toks.some(t => t.t === 'bad')) SynErr();
        let v = expr();
        if (peek() && peek().t === 'eq') {                     // "A = B" → A − B (dùng cho SOLVE)
            i++;
            v = v - expr();
        }
        if (i < toks.length) SynErr();
        if (!isFinite(v) || isNaN(v)) MathErr();
        return v;
    }

    // ∫ (Gauss–Kronrod thích nghi), d/dx (sai phân trung tâm + Richardson), Σ
    function integrate(n, env) {
        const a = evalRow(n.lo, env), b = evalRow(n.hi, env);
        const f = (x) => evalRow(n.f, { ...env, X: x });
        const simpson = (a, b, fa, fm, fb) => (b - a) / 6 * (fa + 4 * fm + fb);
        function rec(a, b, fa, fm, fb, whole, depth) {
            const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
            const flm = f(lm), frm = f(rm);
            const left = simpson(a, m, fa, flm, fm), right = simpson(m, b, fm, frm, fb);
            if (depth > 18 || Math.abs(left + right - whole) < 1e-11 * Math.max(1, Math.abs(whole))) return left + right + (left + right - whole) / 15;
            return rec(a, m, fa, flm, fm, left, depth + 1) + rec(m, b, fm, frm, fb, right, depth + 1);
        }
        const fa = f(a), fb = f(b), fm = f((a + b) / 2);
        return clean(rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), 0));
    }
    function derivative(n, env) {
        const x0 = evalRow(n.at, env);
        const f = (x) => evalRow(n.f, { ...env, X: x });
        const d = (h) => (f(x0 + h) - f(x0 - h)) / (2 * h);
        const h = 1e-3 * Math.max(1, Math.abs(x0));
        return clean((4 * d(h / 2) - d(h)) / 3);
    }
    function summation(n, env) {
        const a = evalRow(n.lo, env), b = evalRow(n.hi, env);
        if (!isInt(a) || !isInt(b) || b < a || b - a > 1e5) MathErr();
        let s = 0;
        for (let x = Math.round(a); x <= Math.round(b); x++) s += evalRow(n.f, { ...env, X: x });
        return s;
    }

    // ════════════════════════════════════════════════════════════
    //  4. ĐỊNH DẠNG KẾT QUẢ (MathO: phân số, k√n, kπ — hoặc thập phân)
    // ════════════════════════════════════════════════════════════
    const fracHtml = (n, d) => `<span class="cx-frac"><span class="cx-num">${n}</span><span class="cx-den">${d}</span></span>`;
    function toFraction(x, maxDen = 9999) {
        if (!isFinite(x)) return null;
        if (isInt(x)) return [Math.round(x), 1];
        let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
        for (let it = 0; it < 40; it++) {
            const a = Math.floor(b);
            [h1, h0] = [a * h1 + h0, h1];
            [k1, k0] = [a * k1 + k0, k1];
            if (k1 > maxDen) return null;
            if (Math.abs(x - h1 / k1) < 1e-11 * Math.max(1, Math.abs(x))) return [h1, k1];
            const r = b - a;
            if (r < 1e-15) break;
            b = 1 / r;
        }
        return null;
    }
    function fmtDecimal(x) {
        if (Object.is(x, -0)) x = 0;
        if (S.fix !== null) {
            const s = x.toFixed(S.fix);
            if (Math.abs(x) < 1e10) return s.replace('-', '−');
        }
        const ax = Math.abs(x);
        if (ax !== 0 && (ax >= 1e10 || ax < 1e-9)) {
            const [m, e] = x.toExponential(9).split('e');
            return `${String(Number(m)).replace('-', '−')}×10<sup>${Number(e)}</sup>`;
        }
        const s = String(Number(x.toPrecision(10)));
        return (s.includes('e') ? fmtDecimal(Number(s)) : s).replace('-', '−');
    }
    // Rút gọn √N = m√n
    function splitSqrt(N) {
        let m = 1, n = N;
        for (let k = Math.floor(Math.sqrt(n)); k > 1; k--) if (n % (k * k) === 0) { m *= k; n /= k * k; break; }
        return [m, n];
    }
    // Dạng chính xác giống MathO; trả về null nếu không tìm được
    function exactHtml(v) {
        if (!isFinite(v)) return null;
        const sign = v < 0 ? '−' : '';
        const av = Math.abs(v);
        if (isInt(v) && av < 1e10) return null;                         // số nguyên: hiển thị thường
        let f = toFraction(av);
        if (f && f[1] > 1) return sign + fracHtml(f[0], f[1]);
        // kπ/n
        f = toFraction(av / Math.PI, 1000);
        if (f && f[0] <= 1000 && f[0] > 0) {
            const num = (f[0] === 1 ? '' : f[0]) + 'π';
            return sign + (f[1] === 1 ? num : fracHtml(num, f[1]));
        }
        // m√n / q
        f = toFraction(av * av, 1000);
        if (f && f[0] <= 1e6 && f[0] > 0) {
            let [m, n] = splitSqrt(Math.round(f[0] * f[1]));
            let q = f[1];
            if (n > 1) {
                const g = gcd(m, q); m /= g; q /= g;
                const num = (m === 1 ? '' : m) + `<span class="cx-sqrt"><span class="cx-rad">√</span><span class="cx-under">${n}</span></span>`;
                return sign + (q === 1 ? num : fracHtml(num, q));
            }
        }
        return null;
    }
    function fmtValue(v, exactWanted = S.mathOut) {
        if (exactWanted && S.fix === null) { const e = exactHtml(v); if (e) return e; }
        return fmtDecimal(v);
    }
    // Độ–phút–giây
    function dmsHtml(v) {
        const s = v < 0 ? '−' : ''; let a = Math.abs(v);
        const d = Math.floor(a); a = (a - d) * 60;
        const m = Math.floor(a + 1e-9); const sec = Math.round((a - m) * 60 * 100) / 100;
        return `${s}${d}°${m}°${sec}°`;
    }
    function engHtml(v) {
        if (v === 0) return '0';
        let e = Math.floor(Math.log10(Math.abs(v)));
        e -= ((e % 3) + 3) % 3;
        return `${String(Number((v / Math.pow(10, e)).toPrecision(10))).replace('-', '−')}×10<sup>${e}</sup>`;
    }

    // ════════════════════════════════════════════════════════════
    //  5. GIẢI: SOLVE, phương trình đa thức, hệ PT, bất PT
    // ════════════════════════════════════════════════════════════
    function solveNumeric(row, guess) {
        const f = (x) => evalRow(row, { X: x });
        const tryNewton = (x) => {
            for (let k = 0; k < 100; k++) {
                const fx = f(x);
                if (Math.abs(fx) < 1e-13) return x;
                const h = 1e-6 * Math.max(1, Math.abs(x));
                const d = (f(x + h) - f(x - h)) / (2 * h);
                if (!isFinite(d) || d === 0) return null;
                const nx = x - fx / d;
                if (!isFinite(nx)) return null;
                if (Math.abs(nx - x) < 1e-13 * Math.max(1, Math.abs(x))) return nx;
                x = nx;
            }
            return Math.abs(f(x)) < 1e-9 ? x : null;
        };
        const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
        let r = safe(() => tryNewton(guess));
        if (r === null) {
            // quét tìm khoảng đổi dấu quanh giá trị đầu
            for (const span of [1, 10, 100, 1e3, 1e4]) {
                const N = 400;
                let px = guess - span, pf = safe(() => f(px));
                for (let k = 1; k <= N && r === null; k++) {
                    const x = guess - span + (2 * span * k) / N, fx = safe(() => f(x));
                    if (pf !== null && fx !== null && pf * fx <= 0) {
                        let lo = px, hi = x, flo = pf;
                        for (let it = 0; it < 200; it++) {
                            const mid = (lo + hi) / 2, fm = f(mid);
                            if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
                        }
                        r = safe(() => tryNewton((lo + hi) / 2)) ?? (lo + hi) / 2;
                    }
                    px = x; pf = fx;
                }
                if (r !== null) break;
            }
        }
        if (r === null) throw new CalcError('Can\'t Solve');
        return { x: clean(r), lr: clean(f(r)) };
    }

    // Nghiệm đa thức (hệ số từ bậc cao → thấp) — Durand–Kerner, trả về số phức {re, im}
    function polyRoots(c) {
        while (c.length > 1 && Math.abs(c[0]) < 1e-14) c = c.slice(1);
        const n = c.length - 1;
        if (n < 1) return [];
        if (n === 1) return [{ re: -c[1] / c[0], im: 0 }];
        if (n === 2) {
            const [a, b, cc] = c, D = b * b - 4 * a * cc;
            if (D >= 0) { const s = Math.sqrt(D); return [{ re: (-b + s) / (2 * a), im: 0 }, { re: (-b - s) / (2 * a), im: 0 }]; }
            const s = Math.sqrt(-D); return [{ re: -b / (2 * a), im: s / (2 * a) }, { re: -b / (2 * a), im: -s / (2 * a) }];
        }
        const a = c.map(x => x / c[0]);
        let z = Array.from({ length: n }, (_, k) => ({ re: Math.cos(2 * Math.PI * k / n + 0.4) * 0.9, im: Math.sin(2 * Math.PI * k / n + 0.4) * 0.9 }));
        const mul = (p, q) => ({ re: p.re * q.re - p.im * q.im, im: p.re * q.im + p.im * q.re });
        const div = (p, q) => { const d = q.re * q.re + q.im * q.im; return { re: (p.re * q.re + p.im * q.im) / d, im: (p.im * q.re - p.re * q.im) / d }; };
        const evalP = (x) => a.reduce((acc, co) => { const m = mul(acc, x); return { re: m.re + co, im: m.im }; }, { re: 0, im: 0 });
        for (let it = 0; it < 500; it++) {
            let delta = 0;
            z = z.map((zi, i) => {
                let den = { re: 1, im: 0 };
                z.forEach((zj, j) => { if (j !== i) den = mul(den, { re: zi.re - zj.re, im: zi.im - zj.im }); });
                const step = div(evalP(zi), den);
                delta = Math.max(delta, Math.hypot(step.re, step.im));
                return { re: zi.re - step.re, im: zi.im - step.im };
            });
            if (delta < 1e-14) break;
        }
        return z.map(r => ({ re: clean(Math.abs(r.re) < 1e-10 ? 0 : r.re), im: Math.abs(r.im) < 1e-9 ? 0 : r.im }))
                .sort((p, q) => (p.im === 0 ? 0 : 1) - (q.im === 0 ? 0 : 1) || q.re - p.re);
    }
    function complexHtml(r) {
        if (r.im === 0) return fmtValue(r.re);
        const re = Math.abs(r.re) < 1e-12 ? '' : fmtValue(r.re);
        const im = Math.abs(r.im);
        const imS = isInt(im) && Math.round(im) === 1 ? '' : fmtValue(im);
        return `${re}${r.im < 0 ? '−' : (re ? '+' : '')}${imS}<i>i</i>`;
    }
    // Hệ phương trình tuyến tính (Gauss)
    function solveLinear(M) {
        const n = M.length, A = M.map(r => r.slice());
        for (let col = 0; col < n; col++) {
            let piv = col;
            for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
            if (Math.abs(A[piv][col]) < 1e-12) {
                // kiểm tra vô nghiệm hay vô số nghiệm
                const rank = (B) => {
                    const C = B.map(r => r.slice()); let rk = 0;
                    for (let c = 0; c < C[0].length && rk < C.length; c++) {
                        let p = rk; for (let r = rk + 1; r < C.length; r++) if (Math.abs(C[r][c]) > Math.abs(C[p][c])) p = r;
                        if (Math.abs(C[p][c]) < 1e-10) continue;
                        [C[rk], C[p]] = [C[p], C[rk]];
                        for (let r = 0; r < C.length; r++) if (r !== rk) { const f = C[r][c] / C[rk][c]; for (let k = c; k < C[0].length; k++) C[r][k] -= f * C[rk][k]; }
                        rk++;
                    }
                    return rk;
                };
                return rank(M.map(r => r.slice(0, n))) < rank(M) ? 'none' : 'inf';
            }
            [A[col], A[piv]] = [A[piv], A[col]];
            for (let r = 0; r < n; r++) if (r !== col) {
                const f = A[r][col] / A[col][col];
                for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
            }
        }
        return A.map((r, i) => clean(r[n] / r[i]));
    }
    // Bất phương trình đa thức: rel ∈ '>', '<', '≥', '≤'
    function solveInequality(c, rel) {
        const roots = [...new Set(polyRoots(c).filter(r => r.im === 0).map(r => Number(r.re.toPrecision(12))))].sort((a, b) => a - b);
        const P = (x) => c.reduce((acc, co) => acc * x + co, 0);
        const ok = (x) => { const v = P(x); return rel === '>' ? v > 1e-12 : rel === '<' ? v < -1e-12 : rel === '≥' ? v > -1e-12 : v < 1e-12; };
        const strict = rel === '>' || rel === '<';
        const pts = [-Infinity, ...roots, Infinity];
        const parts = [];
        for (let k = 0; k < pts.length - 1; k++) {
            const lo = pts[k], hi = pts[k + 1];
            const mid = lo === -Infinity ? (hi === Infinity ? 0 : hi - 1) : hi === Infinity ? lo + 1 : (lo + hi) / 2;
            if (ok(mid)) parts.push([lo, hi]);
        }
        // nối các khoảng liền nhau qua nghiệm (khi ≥/≤)
        const merged = [];
        parts.forEach(p => { const last = merged[merged.length - 1]; if (last && !strict && last[1] === p[0]) last[1] = p[1]; else merged.push(p.slice()); });
        if (!strict) roots.forEach(r => { if (!merged.some(([a, b]) => r >= a && r <= b)) merged.push([r, r]); });
        merged.sort((p, q) => p[0] - q[0]);
        if (!merged.length) return ['Không có nghiệm'];
        if (merged.length === 1 && merged[0][0] === -Infinity && merged[0][1] === Infinity) return ['Mọi số thực'];
        const lt = strict ? '&lt;' : '≤';
        return merged.map(([a, b]) => {
            if (a === b) return `x=${fmtValue(a)}`;
            if (a === -Infinity) return `x${lt}${fmtValue(b)}`;
            if (b === Infinity) return `${fmtValue(a)}${lt}x`;
            return `${fmtValue(a)}${lt}x${lt}${fmtValue(b)}`;
        });
    }

    // ════════════════════════════════════════════════════════════
    //  6. GIAO DIỆN MÁY
    // ════════════════════════════════════════════════════════════
    // Mỗi phím: id, nhãn chính, chức năng SHIFT (vàng), ALPHA (đỏ)
    const KEYS = {
        OPTN: { l: 'OPTN' }, CALC: { l: 'CALC', s: 'SOLVE', a: '=' }, INT: { l: '∫▫', s: 'd/dx▫' }, XVAR: { l: 'x', s: 'Σ▫' },
        FRAC: { l: '▫/▫', s: '▫▫/▫' }, SQRT: { l: '√▫', s: '∛▫' }, SQ: { l: 'x²', s: 'x³' }, POW: { l: 'x▫', s: '▫√▫' },
        LOGB: { l: 'log▫▫', s: '10▫' }, LN: { l: 'ln', s: 'e▫' },
        NEG: { l: '(−)', a: 'A' }, DMS: { l: '°\'"', s: '←', a: 'B' }, INV: { l: 'x⁻¹', s: 'x!', a: 'C' },
        SIN: { l: 'sin', s: 'sin⁻¹', a: 'D' }, COS: { l: 'cos', s: 'cos⁻¹', a: 'E' }, TAN: { l: 'tan', s: 'tan⁻¹', a: 'F' },
        STO: { l: 'STO', s: 'RCL' }, ENG: { l: 'ENG', s: '←' }, LP: { l: '(', s: '%', a: 'X' }, RP: { l: ')', s: ',', a: 'Y' },
        SD: { l: 'S⇔D', s: 'ab/c⇔d/c' }, MPLUS: { l: 'M+', s: 'M−', a: 'M' },
    };
    const NUMKEYS = [
        [['7'], ['8'], ['9'], ['DEL', '', 'INS'], ['AC', '', 'OFF']],
        [['4'], ['5'], ['6'], ['×', '', 'nPr'], ['÷', '', 'nCr']],
        [['1'], ['2'], ['3'], ['+'], ['−']],
        [['0'], ['.', '', 'Ran#'], ['×10ˣ', '', 'π', 'e'], ['Ans'], ['=', '', '≈']],
    ];
    const el = document.createElement('div');
    el.id = 'calc580';
    el.className = 'calc580 hidden';
    el.tabIndex = 0;
    const fkey = (id) => {
        const k = KEYS[id];
        return `<button class="ck ck-fn" data-k="${id}"><span class="ck-sub">${k.s ? `<i class="ck-s">${k.s}</i>` : '<i></i>'}${k.a ? `<i class="ck-a">${k.a}</i>` : ''}</span>${k.l}</button>`;
    };
    el.innerHTML = `
        <div class="calc-top">
            <div class="calc-brand"><span class="calc-model">fx-580VN X</span><span class="calc-series">MÁY TÍNH KHOA HỌC</span></div>
            <div class="calc-solar"></div>
            <button class="calc-close" title="Đóng máy tính">✕</button>
        </div>
        <div class="calc-lcd"><div class="calc-ind" id="cx-ind"></div><div class="calc-screen" id="cx-screen"></div></div>
        <div class="calc-upper">
            <div class="calc-side">
                <button class="ck ck-pill ck-shift" data-k="SHIFT">SHIFT</button>
                <button class="ck ck-pill ck-alpha" data-k="ALPHA">ALPHA</button>
                ${fkey('OPTN')}${fkey('CALC')}
            </div>
            <div class="calc-pad">
                <button class="ck ck-dir up" data-k="UP">▲</button>
                <button class="ck ck-dir left" data-k="LEFT">◀</button>
                <button class="ck ck-dir right" data-k="RIGHT">▶</button>
                <button class="ck ck-dir down" data-k="DOWN">▼</button>
                <span class="calc-pad-label">REPLAY</span>
            </div>
            <div class="calc-side">
                <button class="ck ck-pill" data-k="MENU"><span class="ck-sub"><i class="ck-s">SETUP</i></span>MENU</button>
                <button class="ck ck-pill" data-k="ON">ON</button>
                ${fkey('INT')}${fkey('XVAR')}
            </div>
        </div>
        <div class="calc-fn">${['FRAC', 'SQRT', 'SQ', 'POW', 'LOGB', 'LN', 'NEG', 'DMS', 'INV', 'SIN', 'COS', 'TAN', 'STO', 'ENG', 'LP', 'RP', 'SD', 'MPLUS'].map(fkey).join('')}</div>
        <div class="calc-num">${NUMKEYS.map(r => r.map(([l, , s, a]) => `<button class="ck ck-num ${/DEL|AC/.test(l) ? 'ck-blue' : ''}" data-k="${l}"><span class="ck-sub">${s ? `<i class="ck-s">${s}</i>` : '<i></i>'}${a ? `<i class="ck-a">${a}</i>` : ''}</span>${l}</button>`).join('')).join('')}</div>`;
    document.body.appendChild(el);
    const screenEl = el.querySelector('#cx-screen');
    const indEl = el.querySelector('#cx-ind');

    // ════════════════════════════════════════════════════════════
    //  7. TRẠNG THÁI GIAO DIỆN & CHẾ ĐỘ
    // ════════════════════════════════════════════════════════════
    const MODES = [
        ['1', 'Tính toán', 'calc'], ['2', 'Số phức', null], ['3', 'Cơ số N', null], ['4', 'Ma trận', null],
        ['5', 'Vectơ', null], ['6', 'Thống kê', null], ['7', 'Phân phối', null], ['8', 'Bảng tính', null],
        ['9', 'Bảng giá trị', 'table'], ['A', 'Phương trình', 'equation'], ['B', 'Bất PT', 'ineq'], ['C', 'Tỉ lệ', 'ratio'],
    ];
    const U = {
        mode: 'calc', screen: 'edit',  // edit | result | menu | setup | optn | list | grid | prompt | solved | table
        shift: false, alpha: false, sto: false, rcl: false,
        input: [], cur: null, history: [], histIdx: -1,
        result: null,             // { v, view: 'exact' | 'dec' | 'dms' | 'eng', html? }
        menuSel: 0, list: null, grid: null, prompt: null, solved: null, table: null, msg: null,
    };
    U.cur = { row: U.input, idx: 0 };
    const setInput = (row) => { U.input = row; U.cur = { row, idx: row.length }; };

    // ── Vẽ màn hình ──
    function render() {
        indEl.innerHTML = [
            U.shift ? '<b>S</b>' : '<b class="off">S</b>', (U.alpha || U.sto || U.rcl) ? '<b>A</b>' : '<b class="off">A</b>',
            U.sto ? '<b>STO</b>' : '', S.mem.M ? '<b>M</b>' : '', '<span class="sp"></span>',
            S.fix !== null ? `<b>FIX</b>` : '', `<b>${S.angle}</b>`, S.mathOut ? '<b>Math▲</b>' : '',
        ].join('');
        el.classList.toggle('calc-shift-on', U.shift);
        el.classList.toggle('calc-alpha-on', U.alpha || U.sto);
        screenEl.innerHTML = drawScreen();
        const ex = screenEl.querySelector('.cx-expr');
        if (ex) ex.scrollLeft = ex.scrollWidth;
    }
    const exprLine = (row, cur) => `<div class="cx-expr">${renderRow(row, cur, { noBox: true }) || (cur ? '' : '')}</div>`;
    function drawScreen() {
        if (U.msg) return `<div class="cx-msg">${U.msg}</div>`;
        switch (U.screen) {
            case 'menu':
                return `<div class="cx-menu">${MODES.map(([k, name], i) => `<div class="cx-mi ${i === U.menuSel ? 'sel' : ''}"><b>${k}</b><span>${name}</span></div>`).join('')}</div>`;
            case 'list':
                return `<div class="cx-list"><div class="cx-list-t">${esc(U.list.title)}</div>${U.list.items.map((it, i) => `<div class="cx-li ${i === U.list.sel ? 'sel' : ''}">${i + 1}:${esc(it[0])}</div>`).join('')}</div>`;
            case 'grid': return drawGrid();
            case 'prompt': {
                const p = U.prompt;
                return `<div class="cx-prompt-t">${p.title || ''}</div><div class="cx-prompt"><span>${p.label}=</span>${exprLine(p.row, { row: p.row, idx: p.row.length })}</div>`;
            }
            case 'solved': {
                const sv = U.solved, item = sv.items[sv.idx];
                return `<div class="cx-solved-t">${sv.title || ''}</div><div class="cx-solved"><span class="cx-lab">${item[0]}</span><span class="cx-val">${item[1]}</span></div>${sv.items.length > 1 ? `<div class="cx-more">${sv.idx > 0 ? '▲' : ''}${sv.idx < sv.items.length - 1 ? '▼' : ''}</div>` : ''}`;
            }
            case 'table': {
                const t = U.table;
                const rows = t.rows.slice(t.top, t.top + 4);
                return `<table class="cx-table"><tr><th></th><th>x</th><th>f(x)</th></tr>${rows.map((r, i) => `<tr class="${t.top + i === t.sel ? 'sel' : ''}"><td>${t.top + i + 1}</td><td>${fmtDecimal(r[0])}</td><td>${r[1] === null ? 'ERROR' : fmtDecimal(r[1])}</td></tr>`).join('')}</table>`;
            }
            case 'result': {
                const r = U.result;
                return `${exprLine(U.input, null)}<div class="cx-res ${r.err ? 'cx-err' : ''}">${r.html}</div>`;
            }
            default: {
                const hint = U.mode === 'table' ? '<div class="cx-hint">f(x)=</div>' : '';
                return `${hint}${exprLine(U.input, U.cur)}<div class="cx-res"></div>`;
            }
        }
    }
    function drawGrid() {
        const g = U.grid;
        const cell = (r, c) => {
            const isSel = g.r === r && g.c === c;
            const val = g.editing && isSel ? renderRow(g.edit, { row: g.edit, idx: g.edit.length }, { noBox: true }) : fmtValue(g.cells[r][c], true);
            return `<td class="${isSel ? 'sel' : ''}">${val}</td>`;
        };
        return `<div class="cx-grid-t">${esc(g.title)}</div><table class="cx-grid"><tr>${g.heads.map(h => `<th>${h}</th>`).join('')}</tr>${g.cells.map((row, r) => `<tr>${row.map((_, c) => cell(r, c)).join('')}</tr>`).join('')}</table>`;
    }

    // ── Thao tác chung ──
    function clearShift() { U.shift = false; U.alpha = false; }
    function flash(msg, then) { U.msg = msg; render(); setTimeout(() => { U.msg = null; if (then) then(); render(); }, 1300); }
    function showError(kind) {
        const text = kind === 'Math' ? 'Math ERROR' : kind === 'Syntax' ? 'Syntax ERROR' : kind;
        U.result = { err: true, html: `<span class="cx-errt">${text}</span><div class="cx-errh">[AC] :Hủy<br>[◀][▶] :Sửa</div>` };
        U.screen = 'result';
    }

    // ── Nhập vào biểu thức ──
    function insertNode(node) {
        if (U.screen === 'result') startNewInput(node.k === 'pow' || node.k === 'e10' || (node.k === 'ch' && (['+', '−', '×', '÷', '!', '%', 'nCr', 'nPr'].includes(node.v))));
        const { row, idx } = U.cur;
        if (node.k === 'frac') {
            // Lấy số đứng ngay trước con trỏ làm tử số (như máy thật)
            let j = idx;
            while (j > 0 && row[j - 1].k === 'ch' && /^[0-9.]$/.test(row[j - 1].v)) j--;
            if (j < idx) { node.num = row.splice(j, idx - j); row.splice(j, 0, node); U.cur = { row: node.den, idx: 0 }; return; }
        }
        row.splice(idx, 0, node);
        const first = SLOTS[node.k] && SLOTS[node.k][0];
        if (first && !(node.k === 'pow' && node.exp.length)) U.cur = { row: node[first], idx: node[first].length };
        else U.cur = { row, idx: idx + 1 };
    }
    function insertText(v, d) { insertNode(ch(v, d)); }
    function startNewInput(continueAns) {
        U.screen = 'edit';
        const row = continueAns ? [ch('Ans')] : [];
        setInput(row);
    }

    function moveCursor(dir) {
        if (U.screen === 'result') { U.screen = 'edit'; const ps = positions(U.input); U.cur = dir < 0 ? ps[ps.length - 1] : ps[0]; return; }
        const ps = positions(U.input);
        const k = ps.findIndex(p => p.row === U.cur.row && p.idx === U.cur.idx);
        const nk = (k + dir + ps.length) % ps.length;
        U.cur = { row: ps[nk].row, idx: ps[nk].idx };
    }
    function moveVertical(dir) {
        // Trong phân số: tử ↔ mẫu; ngoài: gọi lại biểu thức cũ (REPLAY)
        const ps = positions(U.input);
        const here = ps.find(p => p.row === U.cur.row && p.idx === U.cur.idx);
        const par = here && here.parent;
        if (par && ['frac', 'mixed'].includes(par.node.k)) {
            const slots = SLOTS[par.node.k], k = slots.indexOf(par.slot);
            const nk = Math.max(0, Math.min(slots.length - 1, k + (dir > 0 ? 1 : -1)));
            const target = par.node[slots[nk]];
            U.cur = { row: target, idx: Math.min(U.cur.idx, target.length) };
            return;
        }
        if (dir < 0 && U.history.length) {
            U.histIdx = U.histIdx < 0 ? U.history.length - 1 : Math.max(0, U.histIdx - 1);
            setInput(JSON.parse(U.history[U.histIdx]));
            U.screen = 'edit';
        } else if (dir > 0 && U.histIdx >= 0) {
            U.histIdx = Math.min(U.history.length - 1, U.histIdx + 1);
            setInput(JSON.parse(U.history[U.histIdx]));
            U.screen = 'edit';
        }
    }
    function del() {
        if (U.screen === 'result') { U.screen = 'edit'; U.cur = { row: U.input, idx: U.input.length }; }
        const { row, idx } = U.cur;
        if (idx > 0) {
            const n = row[idx - 1];
            if (SLOTS[n.k] && SLOTS[n.k].some(s => n[s].length)) { const s = SLOTS[n.k][SLOTS[n.k].length - 1]; U.cur = { row: n[s], idx: n[s].length }; return; }
            row.splice(idx - 1, 1); U.cur = { row, idx: idx - 1 };
            return;
        }
        // Ở đầu một ô của cấu trúc: thoát ra; nếu cấu trúc rỗng thì xóa
        const here = positions(U.input).find(p => p.row === row && p.idx === idx);
        if (here && here.parent) {
            const { node, row: prow, i } = here.parent;
            if (SLOTS[node.k].every(s => !node[s].length)) { prow.splice(i, 1); U.cur = { row: prow, idx: i }; }
            else U.cur = { row: prow, idx: i };
        }
    }

    // ── Tính & hiển thị kết quả ──
    function rememberInput() {
        const snap = JSON.stringify(U.input);
        if (U.history[U.history.length - 1] !== snap) U.history.push(snap);
        if (U.history.length > 30) U.history.shift();
        U.histIdx = -1;
    }
    function computeAndShow(decimal = false) {
        if (!U.input.length) return;
        rememberInput();
        try {
            const v = evalRow(U.input);
            S.ans = v;
            U.result = { v, view: decimal ? 'dec' : 'exact' };
            U.result.html = resultHtml();
            U.screen = 'result';
        } catch (e) { showError(e instanceof CalcError ? e.message : 'Math'); }
    }
    function resultHtml() {
        const r = U.result;
        if (r.view === 'dms') return dmsHtml(r.v);
        if (r.view === 'eng') return engHtml(r.v);
        return fmtValue(r.v, r.view === 'exact');
    }

    // ════════════════════════════════════════════════════════════
    //  8. CÁC CHẾ ĐỘ: CALC, SOLVE, PT/HPT, BẢNG, BẤT PT, TỈ LỆ
    // ════════════════════════════════════════════════════════════
    // Dãy ô nhập số (prompt) dùng chung: CALC, SOLVE, bảng giá trị
    function askValues(title, labels, defaults, done) {
        let k = 0;
        const values = [];
        const next = () => {
            if (k >= labels.length) { done(values); return; }
            const def = defaults[k];
            U.prompt = { title, label: labels[k], row: [], placeholder: def, submit: (v) => { values.push(v); k++; next(); } };
            U.screen = 'prompt';
            render();
        };
        next();
    }
    function promptSubmit() {
        const p = U.prompt;
        let v;
        if (!p.row.length) v = p.placeholder ?? 0;
        else { try { v = evalRow(p.row); } catch (e) { flash(e.message === 'Math' ? 'Math ERROR' : 'Syntax ERROR'); return; } }
        p.submit(v);
    }
    // Biến xuất hiện trong biểu thức (theo thứ tự)
    function varsIn(row, out = []) {
        row.forEach(n => {
            if (n.k === 'ch' && /^[A-FXYM]$/.test(n.v) && !out.includes(n.v)) out.push(n.v);
            if (SLOTS[n.k] && !['int', 'der', 'sum'].includes(n.k)) SLOTS[n.k].forEach(s => varsIn(n[s], out));
            if (['int', 'sum'].includes(n.k)) { varsIn(n.lo, out); varsIn(n.hi, out); }
            if (n.k === 'der') varsIn(n.at, out);
        });
        return out;
    }
    function doCALC() {
        const vars = varsIn(U.input);
        if (!U.input.length) return;
        const exprSnap = JSON.stringify(U.input);
        askValues('CALC', vars, vars.map(v => S.mem[v]), (vals) => {
            vars.forEach((v, i) => { S.mem[v] = vals[i]; });
            setInput(JSON.parse(exprSnap));
            computeAndShow();
            render();
        });
    }
    function doSOLVE() {
        if (!U.input.length) return;
        if (!varsIn(U.input).includes('X')) { flash('Biểu thức cần có biến X'); return; }
        const exprSnap = JSON.stringify(U.input);
        const others = varsIn(U.input).filter(v => v !== 'X');
        askValues('Giải theo X', [...others, 'X (giá trị đầu)'], [...others.map(v => S.mem[v]), S.mem.X], (vals) => {
            others.forEach((v, i) => { S.mem[v] = vals[i]; });
            const row = JSON.parse(exprSnap);
            setInput(row);
            try {
                const { x, lr } = solveNumeric(row, vals[vals.length - 1]);
                S.mem.X = x; S.ans = x;
                U.solved = { title: 'SOLVE', items: [['X=', fmtValue(x)], ['L−R=', fmtDecimal(lr)]], idx: 0, back: 'edit' };
                U.screen = 'solved';
            } catch (e) { showError(e.message === 'Can\'t Solve' ? 'Không giải được' : e.message); }
            render();
        });
    }

    // Ô hệ số (grid) cho PT/HPT, bất PT, tỉ lệ
    function openGrid(title, heads, rows, onSolve) {
        U.grid = { title, heads, cells: Array.from({ length: rows }, () => heads.map(() => 0)), r: 0, c: 0, editing: false, edit: [], onSolve };
        U.screen = 'grid';
    }
    function gridCommit() {
        const g = U.grid;
        if (g.editing && g.edit.length) {
            try { g.cells[g.r][g.c] = evalRow(g.edit); } catch (e) { flash(e.message === 'Math' ? 'Math ERROR' : 'Syntax ERROR'); return false; }
        }
        g.editing = false; g.edit = [];
        return true;
    }
    function gridMove(dr, dc) {
        const g = U.grid;
        if (!gridCommit()) return;
        g.c += dc; g.r += dr;
        if (g.c >= g.heads.length) { g.c = 0; g.r++; }
        if (g.c < 0) { g.c = g.heads.length - 1; g.r--; }
        g.r = Math.max(0, Math.min(g.cells.length - 1, g.r));
        g.c = Math.max(0, Math.min(g.heads.length - 1, g.c));
    }
    function gridEquals() {
        const g = U.grid;
        const wasEditing = g.editing && g.edit.length;
        if (!gridCommit()) return;
        const last = g.r === g.cells.length - 1 && g.c === g.heads.length - 1;
        if (wasEditing && !last) { gridMove(0, 1); return; }
        try { g.onSolve(g.cells); }
        catch (e) { flash(e.message === 'Syntax' ? 'Syntax ERROR' : 'Math ERROR'); }
    }
    function showSolved(title, items, back = 'grid') { U.solved = { title, items, idx: 0, back }; U.screen = 'solved'; }

    function enterMode(key) {
        const m = MODES.find(x => x[0] === key);
        if (!m) return;
        if (!m[2]) { flash(`Chế độ "${m[1]}"<br>đang được phát triển`, () => { U.screen = 'menu'; }); return; }
        U.mode = m[2];
        clearShift();
        if (U.mode === 'calc' || U.mode === 'table') { setInput([]); U.screen = 'edit'; return; }
        if (U.mode === 'equation') {
            U.list = { title: 'Phương trình/HPT', sel: 0, items: [['Hệ phương trình', () => listSystem()], ['Phương trình đa thức', () => listPoly()]] };
            U.screen = 'list';
        }
        if (U.mode === 'ineq') {
            U.list = { title: 'Bất phương trình', sel: 0, items: [['aX²+bX+c', () => ineqPick(2)], ['aX³+bX²+cX+d', () => ineqPick(3)]] };
            U.screen = 'list';
        }
        if (U.mode === 'ratio') {
            U.list = { title: 'Tỉ lệ', sel: 0, items: [['A:B=X:D', () => ratioGrid(1)], ['A:B=C:X', () => ratioGrid(2)]] };
            U.screen = 'list';
        }
    }
    function listSystem() {
        U.list = { title: 'Số ẩn?', sel: 0, items: [2, 3, 4].map(n => [`${n} ẩn`, () => systemGrid(n)]) };
    }
    function systemGrid(n) {
        const names = ['x', 'y', 'z', 't'].slice(0, n);
        openGrid(`Hệ ${n} ẩn (hệ số ${names.join(', ')} | vế phải)`, [...names, '='], n, (cells) => {
            const sol = solveLinear(cells);
            if (sol === 'none') { showSolved('Kết quả', [['', 'Hệ vô nghiệm']]); return; }
            if (sol === 'inf') { showSolved('Kết quả', [['', 'Vô số nghiệm']]); return; }
            showSolved('Nghiệm', sol.map((v, i) => [`${names[i]}=`, fmtValue(v)]));
        });
    }
    function listPoly() {
        U.list = { title: 'Bậc?', sel: 0, items: [2, 3, 4].map(n => [['', '', 'aX²+bX+c', 'aX³+bX²+cX+d', 'aX⁴+bX³+cX²+dX+e'][n], () => polyGrid(n)]) };
    }
    function polyGrid(n) {
        const heads = 'abcde'.slice(0, n + 1).split('');
        openGrid(['', '', 'aX²+bX+c=0', 'aX³+bX²+cX+d=0', 'aX⁴+bX³+cX²+dX+e=0'][n], heads, 1, (cells) => {
            const c = cells[0];
            if (c[0] === 0) MathErr();
            const roots = polyRoots(c.slice());
            const items = [];
            const exactQuad = n === 2 ? quadExact(c) : null;
            roots.forEach((r, i) => items.push([`x${roots.length > 1 ? sub(i + 1) : ''}=`, exactQuad ? exactQuad[i] : complexHtml(r)]));
            if (n === 2) {
                const xv = -c[1] / (2 * c[0]), yv = c[2] - c[1] * c[1] / (4 * c[0]);
                const kind = c[0] > 0 ? 'nhỏ nhất' : 'lớn nhất';
                items.push([`x để y ${kind}=`, fmtValue(xv)], [`y ${kind}=`, fmtValue(yv)]);
            }
            showSolved('Nghiệm', items);
        });
    }
    const sub = (k) => String(k).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
    // Nghiệm bậc 2 dạng chính xác (−b ± m√n)/(2a) khi hệ số hữu tỉ
    function quadExact(c) {
        if (!c.every(x => toFraction(x, 1000))) return null;
        let [a, b, cc] = c;
        const D = b * b - 4 * a * cc;
        if (D < 0) {
            const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * a);
            const imHtml = fmtValue(Math.abs(im));
            return [`${fmtValue(re)}+${imHtml}<i>i</i>`.replace(/^0\+/, ''), `${fmtValue(re)}−${imHtml}<i>i</i>`.replace(/^0−/, '−')];
        }
        const r1 = (-b + Math.sqrt(D)) / (2 * a), r2 = (-b - Math.sqrt(D)) / (2 * a);
        if (toFraction(r1, 9999) || D === 0) return [fmtValue(r1), fmtValue(r2)];
        // Đưa về số nguyên: nhân các hệ số với mẫu chung
        const den = [a, b, cc].map(x => toFraction(x, 1000)[1]).reduce((p, q) => p * q / gcd(p, q));
        a *= den; b *= den; cc *= den;
        const DD = Math.round(b * b - 4 * a * cc);
        let [m, nn] = splitSqrt(DD);
        let p = -Math.round(b), q = Math.round(2 * a);
        const g = gcd(gcd(p, m), q) || 1;
        p /= g; m /= g; q /= g;
        if (q < 0) { p = -p; m = -m; q = -q; }
        const rad = `${Math.abs(m) === 1 ? '' : Math.abs(m)}<span class="cx-sqrt"><span class="cx-rad">√</span><span class="cx-under">${nn}</span></span>`;
        const numer = (sgn) => `${p ? fmtDecimal(p) : ''}${sgn > 0 ? (p ? '+' : '') : '−'}${rad}`;
        const make = (sgn) => (q === 1 ? numer(sgn) : fracHtml(numer(sgn), q));
        return m > 0 ? [make(1), make(-1)] : [make(-1), make(1)];
    }
    function ineqPick(n) {
        U.list = { title: 'Chọn dạng', sel: 0, items: ['>', '<', '≥', '≤'].map(rel => [`${n === 2 ? 'aX²+bX+c' : 'aX³+bX²+cX+d'}${rel}0`, () => ineqGrid(n, rel)]) };
    }
    function ineqGrid(n, rel) {
        openGrid(`${n === 2 ? 'aX²+bX+c' : 'aX³+bX²+cX+d'}${rel}0`, 'abcd'.slice(0, n + 1).split(''), 1, (cells) => {
            if (cells[0][0] === 0) MathErr();
            showSolved('Nghiệm', solveInequality(cells[0].slice(), rel).map(t => ['', t]));
        });
    }
    function ratioGrid(kind) {
        const heads = kind === 1 ? ['A', 'B', 'D'] : ['A', 'B', 'C'];
        openGrid(kind === 1 ? 'A:B=X:D' : 'A:B=C:X', heads, 1, (cells) => {
            const [A, B, Z] = cells[0];
            if (kind === 1) { if (B === 0) MathErr(); showSolved('Kết quả', [['X=', fmtValue(A * Z / B)]]); }
            else { if (A === 0) MathErr(); showSolved('Kết quả', [['X=', fmtValue(B * Z / A)]]); }
        });
    }
    // Bảng giá trị: f(x) → Start/End/Step
    function makeTable() {
        if (!U.input.length) return;
        const fSnap = JSON.stringify(U.input);
        askValues('Bảng giá trị', ['Bắt đầu', 'Kết thúc', 'Bước'], [1, 5, 1], ([a, b, st]) => {
            const f = JSON.parse(fSnap);
            setInput(f);
            if (st <= 0 || (b - a) / st > 44) { flash('Bảng tối đa 45 dòng'); U.screen = 'edit'; return; }
            const rows = [];
            for (let x = a; x <= b + 1e-9; x += st) { let y = null; try { y = evalRow(f, { X: x }); } catch (e) { y = null; } rows.push([clean(x), y]); }
            U.table = { rows, top: 0, sel: 0 };
            U.screen = 'table';
            render();
        });
    }

    // Danh sách SETUP / OPTN
    function openSetup() {
        U.list = { title: 'SETUP', sel: 0, items: [
            ['Kết quả: chính xác (MathO)', () => { S.mathOut = true; backToWork(); }],
            ['Kết quả: thập phân', () => { S.mathOut = false; backToWork(); }],
            ['Góc: Độ (D)', () => { S.angle = 'D'; backToWork(); }],
            ['Góc: Radian (R)', () => { S.angle = 'R'; backToWork(); }],
            ['Góc: Grad (G)', () => { S.angle = 'G'; backToWork(); }],
            ['Số: Norm', () => { S.fix = null; backToWork(); }],
            ['Số: Fix (0~9)', () => { U.list = { title: 'Fix: số chữ số thập phân?', sel: 0, items: Array.from({ length: 10 }, (_, k) => [`${k}`, () => { S.fix = k; backToWork(); }]) }; }],
        ] };
        U.screen = 'list';
    }
    function openOptn() {
        const ins = (v, d) => () => { backToWork(); insertText(v, d); };
        U.list = { title: 'OPTN', sel: 0, items: [
            ['Hàm Hyperbolic', () => { U.list = { title: 'Hyperbolic', sel: 0, items: ['sinh', 'cosh', 'tanh', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹'].map(f => [f, ins(`${f}(`)]) }; }],
            ['Đơn vị góc', () => { U.list = { title: 'Đơn vị góc', sel: 0, items: [['°', ins('deg', '°')], ['ʳ', ins('rad', 'ʳ')], ['ᵍ', ins('grad', 'ᵍ')]] }; }],
            ['Tính số học', () => { U.list = { title: 'Tính số học', sel: 0, items: [['GCD(', ins('GCD(')], ['LCM(', ins('LCM(')], ['Int(', ins('Int(')], ['Intg(', ins('Intg(')], ['RanInt#(', ins('RanInt#(')], ['Ran#', ins('Ran#')]] }; }],
        ] };
        U.screen = 'list';
    }
    function backToWork() {
        U.list = null;
        U.screen = (U.mode === 'calc' || U.mode === 'table') ? 'edit' : U.screen;
        if (U.screen === 'list') U.screen = 'edit';
        U.cur = U.cur && U.cur.row ? U.cur : { row: U.input, idx: U.input.length };
    }

    // ════════════════════════════════════════════════════════════
    //  9. XỬ LÝ PHÍM
    // ════════════════════════════════════════════════════════════
    const LETTER_KEYS = { NEG: 'A', DMS: 'B', INV: 'C', SIN: 'D', COS: 'E', TAN: 'F', LP: 'X', RP: 'Y', MPLUS: 'M' };
    function press(k) {
        const sh = U.shift, al = U.alpha;
        if (U.msg) return;

        // ── Phím chung mọi màn hình ──
        if (k === 'SHIFT') { U.shift = !U.shift; U.alpha = false; return render(); }
        if (k === 'ALPHA') { U.alpha = !U.alpha; U.shift = false; return render(); }
        if (k === 'ON') { resetScreen(); return render(); }
        if (k === 'AC' && sh) { close(); return; }                  // SHIFT AC = OFF
        if (k === 'MENU') {
            clearShift();
            if (sh) openSetup();
            else { U.screen = 'menu'; U.menuSel = MODES.findIndex(m => m[2] === U.mode); }
            return render();
        }

        // ── STO / RCL: chờ chọn biến ──
        if ((U.sto || U.rcl) && LETTER_KEYS[k]) {
            const L = LETTER_KEYS[k];
            if (U.sto) {
                let v = S.ans;
                if (U.screen === 'edit' && U.input.length) { try { v = evalRow(U.input); } catch (e) { /* lưu Ans */ } }
                S.mem[L] = v; S.ans = v;
                U.result = { v, view: 'exact', html: `${L} ← ${fmtValue(v)}` };
                U.screen = 'result';
            } else {
                U.result = { v: S.mem[L], view: 'exact' };
                U.result.html = `${L} = ${fmtValue(S.mem[L])}`;
                U.screen = 'result';
            }
            U.sto = U.rcl = false; clearShift();
            return render();
        }

        // ── Màn hình MENU ──
        if (U.screen === 'menu') {
            const keyToMode = { NEG: 'A', DMS: 'B', INV: 'C' };
            if (/^[1-9]$/.test(k)) enterMode(k);
            else if (keyToMode[k]) enterMode(keyToMode[k]);
            else if (k === 'RIGHT') U.menuSel = (U.menuSel + 1) % MODES.length;
            else if (k === 'LEFT') U.menuSel = (U.menuSel + MODES.length - 1) % MODES.length;
            else if (k === 'DOWN') U.menuSel = (U.menuSel + 4) % MODES.length;
            else if (k === 'UP') U.menuSel = (U.menuSel + MODES.length - 4) % MODES.length;
            else if (k === '=') enterMode(MODES[U.menuSel][0]);
            else if (k === 'AC') { U.screen = U.mode === 'calc' || U.mode === 'table' ? 'edit' : 'menu'; }
            clearShift();
            return render();
        }
        // ── Danh sách lựa chọn (SETUP, OPTN, chọn số ẩn...) ──
        if (U.screen === 'list') {
            const L = U.list;
            const n = parseInt(k, 10);
            if (n >= 1 && n <= L.items.length) L.items[n - 1][1]();
            else if (k === 'DOWN') L.sel = (L.sel + 1) % L.items.length;
            else if (k === 'UP') L.sel = (L.sel + L.items.length - 1) % L.items.length;
            else if (k === '=') L.items[L.sel][1]();
            else if (k === 'AC') { if (U.mode === 'calc' || U.mode === 'table') backToWork(); else U.screen = 'menu'; }
            clearShift();
            return render();
        }
        // ── Ô nhập giá trị (CALC/SOLVE/bảng) ──
        if (U.screen === 'prompt') {
            const row = U.prompt.row;
            if (k === '=') { promptSubmit(); clearShift(); return render(); }
            if (k === 'AC') { U.screen = 'edit'; U.cur = { row: U.input, idx: U.input.length }; clearShift(); return render(); }
            if (k === 'DEL') row.pop();
            else if (/^[0-9.]$/.test(k)) row.push(ch(k));
            else if (k === 'NEG') row.push(ch('neg', '−'));
            else if (['+', '−', '×', '÷'].includes(k)) row.push(ch(k));
            else if (k === 'FRAC') row.push(ch('÷'));
            clearShift();
            return render();
        }
        // ── Bảng hệ số ──
        if (U.screen === 'grid') {
            const g = U.grid;
            if (k === '=') { gridEquals(); clearShift(); return render(); }
            if (k === 'AC') { if (g.editing) { g.editing = false; g.edit = []; } else { g.cells = g.cells.map(r => r.map(() => 0)); g.r = g.c = 0; } clearShift(); return render(); }
            if (k === 'LEFT') gridMove(0, -1);
            else if (k === 'RIGHT') gridMove(0, 1);
            else if (k === 'UP') gridMove(-1, 0);
            else if (k === 'DOWN') gridMove(1, 0);
            else if (k === 'DEL') { if (g.editing) g.edit.pop(); }
            else {
                const piece = /^[0-9.]$/.test(k) ? ch(k) : k === 'NEG' ? ch('neg', '−') : ['+', '−', '×', '÷'].includes(k) ? ch(k)
                    : k === 'FRAC' ? ch('÷') : k === 'LP' ? ch('(') : k === 'RP' ? ch(')') : null;
                if (piece) { if (!g.editing) { g.editing = true; g.edit = []; } g.edit.push(piece); }
            }
            clearShift();
            return render();
        }
        // ── Kết quả giải (PT, SOLVE...) ──
        if (U.screen === 'solved') {
            const sv = U.solved;
            if (k === 'DOWN' || k === '=') { if (sv.idx < sv.items.length - 1) sv.idx++; else if (k === '=' && sv.back === 'grid') U.screen = 'grid'; }
            else if (k === 'UP') { if (sv.idx > 0) sv.idx--; }
            else if (k === 'AC') { U.screen = sv.back === 'grid' ? 'grid' : 'edit'; U.cur = { row: U.input, idx: U.input.length }; }
            else if (sv.back === 'edit') { U.screen = 'edit'; return press(k); }
            clearShift();
            return render();
        }
        // ── Bảng giá trị ──
        if (U.screen === 'table') {
            const t = U.table;
            if (k === 'DOWN') { t.sel = Math.min(t.rows.length - 1, t.sel + 1); if (t.sel >= t.top + 4) t.top++; }
            else if (k === 'UP') { t.sel = Math.max(0, t.sel - 1); if (t.sel < t.top) t.top--; }
            else if (k === 'AC') { U.screen = 'edit'; U.cur = { row: U.input, idx: U.input.length }; }
            clearShift();
            return render();
        }

        // ── Soạn biểu thức (Tính toán / f(x) của bảng) ──
        if (U.screen === 'result' && U.result.err) {
            if (k === 'AC') { resetScreen(); return render(); }
            if (k === 'LEFT' || k === 'RIGHT') { U.screen = 'edit'; U.cur = { row: U.input, idx: U.input.length }; return render(); }
            return;
        }
        if (al && LETTER_KEYS[k]) { insertText(LETTER_KEYS[k]); clearShift(); return render(); }
        if (al && k === 'CALC') { insertText('=', '='); clearShift(); return render(); }
        if (al && k === '×10ˣ') { insertText('e'); clearShift(); return render(); }

        switch (k) {
            case 'AC': resetScreen(); break;
            case 'DEL': del(); break;
            case 'LEFT': moveCursor(-1); break;
            case 'RIGHT': moveCursor(1); break;
            case 'UP': moveVertical(-1); break;
            case 'DOWN': moveVertical(1); break;
            case '=':
                if (U.mode === 'table') { makeTable(); break; }
                computeAndShow(sh);                                     // SHIFT = : ≈ (thập phân)
                break;
            case 'CALC': if (sh) doSOLVE(); else doCALC(); break;
            case 'OPTN': openOptn(); break;
            case 'STO': if (sh) U.rcl = true; else U.sto = true; break;
            case 'SD':
                if (U.screen === 'result' && !U.result.err) {
                    U.result.view = U.result.view === 'exact' ? 'dec' : 'exact';
                    U.result.html = resultHtml();
                }
                break;
            case 'ENG':
                if (U.screen === 'result' && !U.result.err) { U.result.view = 'eng'; U.result.html = resultHtml(); }
                break;
            case 'DMS':
                if (U.screen === 'result' && !U.result.err) { U.result.view = U.result.view === 'dms' ? 'exact' : 'dms'; U.result.html = resultHtml(); }
                else insertText('deg', '°');
                break;
            case 'MPLUS': {
                let v = S.ans;
                if (U.screen === 'edit' && U.input.length) { try { v = evalRow(U.input); rememberInput(); } catch (e) { showError(e.message); break; } }
                S.mem.M += sh ? -v : v; S.ans = v;
                U.result = { v, view: 'exact' }; U.result.html = `${fmtValue(v)} <small>${sh ? 'M−' : 'M+'}</small>`;
                U.screen = 'result';
                break;
            }
            case 'FRAC': insertNode(sh ? mk('mixed') : mk('frac')); break;
            case 'SQRT': insertNode(sh ? mk('root', { idx: [ch('3')] }) : mk('sqrt')); break;
            case 'SQ': insertNode(mk('pow', { exp: [ch(sh ? '3' : '2')] })); break;
            case 'POW': insertNode(sh ? mk('root') : mk('pow')); break;
            case 'LOGB': insertNode(sh ? mk('tpow') : mk('logb')); break;
            case 'LN': if (sh) insertNode(mk('epow')); else insertText('ln('); break;
            case 'NEG': insertText('neg', '−'); break;
            case 'INV': if (sh) insertText('!'); else insertNode(mk('pow', { exp: [ch('neg', '−'), ch('1')] })); break;
            case 'SIN': insertText(sh ? 'sin⁻¹(' : 'sin('); break;
            case 'COS': insertText(sh ? 'cos⁻¹(' : 'cos('); break;
            case 'TAN': insertText(sh ? 'tan⁻¹(' : 'tan('); break;
            case 'LP': insertText(sh ? '%' : '('); break;
            case 'RP': insertText(sh ? ',' : ')'); break;
            case 'INT': insertNode(sh ? mk('der') : mk('int')); break;
            case 'XVAR': if (sh) insertNode(mk('sum')); else insertText('X', 'x'); break;
            case '×10ˣ': if (sh) insertText('π'); else insertNode(mk('e10')); break;
            case '.': if (sh) insertText('Ran#'); else insertText('.'); break;
            case 'Ans': insertText('Ans'); break;
            case '×': insertText(sh ? 'nPr' : '×', sh ? 'P' : '×'); break;
            case '÷': insertText(sh ? 'nCr' : '÷', sh ? 'C' : '÷'); break;
            case '+': case '−': insertText(k); break;
            default: if (/^[0-9]$/.test(k)) insertText(k);
        }
        clearShift();
        render();
    }
    function resetScreen() {
        U.msg = null; U.sto = U.rcl = false; clearShift();
        if (U.mode === 'calc' || U.mode === 'table') { setInput([]); U.screen = 'edit'; }
        else if (U.screen === 'solved' || U.screen === 'grid') { U.screen = 'grid'; }
        else U.screen = 'menu';
    }

    // ── Sự kiện chuột / chạm ──
    el.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.ck');
        if (!b) return;
        e.preventDefault();
        el.focus({ preventScroll: true });
        b.classList.add('ck-down');
        setTimeout(() => b.classList.remove('ck-down'), 110);
        try { press(b.dataset.k); } catch (err) { console.error(err); showError('Math'); render(); }
    });
    // Bàn phím máy tính
    el.addEventListener('keydown', (e) => {
        const map = { '*': '×', '/': '÷', '-': '−', '+': '+', 'Enter': '=', '=': '=', 'Backspace': 'DEL', 'Delete': 'AC', 'Escape': 'AC',
                      'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT', 'ArrowUp': 'UP', 'ArrowDown': 'DOWN', '(': 'LP', ')': 'RP', '^': 'POW', '.': '.', ',': '.', 'x': 'XVAR', 'X': 'XVAR', '!': null };
        let k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
        if (e.key === '!') { U.shift = true; k = 'INV'; }
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        try { press(k); } catch (err) { console.error(err); }
    });

    // ── Kéo thân máy để di chuyển ──
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.ck, .calc-close')) return;
        const r = el.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        el.setPointerCapture(e.pointerId);
        el.classList.add('calc-dragging');
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        el.style.left = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - el.offsetWidth)) + 'px';
        el.style.top = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - el.offsetHeight)) + 'px';
    });
    const endDrag = () => { drag = null; el.classList.remove('calc-dragging'); };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    // ── Mở / đóng ──
    function open() {
        el.classList.remove('hidden');
        if (!el.style.left) {
            el.style.left = Math.max(10, window.innerWidth - el.offsetWidth - 120) + 'px';
            el.style.top = Math.max(10, (window.innerHeight - 48 - el.offsetHeight) / 2) + 'px';
        }
        document.getElementById('btn-calc')?.classList.add('active');
        el.focus({ preventScroll: true });
        render();
    }
    function close() {
        el.classList.add('hidden');
        document.getElementById('btn-calc')?.classList.remove('active');
    }
    el.querySelector('.calc-close').addEventListener('click', close);
    document.getElementById('btn-calc')?.addEventListener('click', () => (el.classList.contains('hidden') ? open() : close()));

    render();
    window.Calculator580 = { open, close, press, _evalRow: evalRow, _state: S };
})();
