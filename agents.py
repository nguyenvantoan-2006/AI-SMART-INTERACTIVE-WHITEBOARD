"""
HỆ THỐNG NHIỀU AGENT — chế độ "Phân tích sâu" cho phương trình hóa học.

Luồng (Orchestrator điều phối bằng code, không tốn lượt gọi AI để định tuyến):

    VisionAgent (1 AI) ──► SolverAgent (0-1 AI) ──► VerifierAgent (0 AI)
                               ▲                         │ sai → gửi lỗi lại, tối đa 2 lần
                               └─────────────────────────┘
                                                         │ đúng → gửi phương trình + an toàn NGAY
                                                         ▼
                                  asyncio.gather( TutorAgent (1 AI + TTS), QuizAgent (1 AI) )

Chế độ "Nhanh" (SuperAgent trong main.py) giữ nguyên, không đi qua file này.
"""
import asyncio
import re
import time
from io import BytesIO


def _m():
    """Import main lúc chạy để dùng lại call_llm, check_safety... (tránh vòng import khi main import agents)."""
    import main
    return main


# ── Chuẩn hóa phương trình về ASCII để chem_checker phân tích được ─────────
_SUB_TO_DIGIT = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")


def to_ascii_equation(equation: str, conditions: list = None) -> str:
    """'2H₂O₂ →(MnO₂) 2H₂O + O₂↑' → '2H2O2 -(MnO2)-> 2H2O + O2' (dạng parse_equation_sides hiểu)."""
    eq = (equation or "").translate(_SUB_TO_DIGIT).replace("↑", "").replace("↓", "")
    m = re.search(r"(?:→|->|=+>?)\s*\(([^)]*)\)", eq)
    cond = m.group(1) if m else ", ".join(c for c in (conditions or []) if c)
    eq = re.sub(r"(?:→|->|=+>?)\s*\(([^)]*)\)", "→", eq)
    eq = re.sub(r"→|=+>?|⟶", "->", eq)
    if cond and "->" in eq:
        eq = eq.replace("->", f"-({cond})->", 1)
    return eq.strip()


def display_equation(reactants: list, products: list, coeffs: list, conditions: list) -> str:
    from chem_checker import format_balanced_equation
    return format_balanced_equation(reactants, products, coeffs, ", ".join(c for c in conditions if c))


class AgentTimer:
    """Đo thời gian từng agent, in bảng ra terminal khi xong."""

    def __init__(self):
        self.start = time.perf_counter()
        self.rows = []          # (agent, giây, số lần gọi AI, ghi chú)
        self.marks = {}         # mốc: thời điểm gửi từng đợt

    def add(self, agent: str, seconds: float, ai_calls: int, note: str = ""):
        self.rows.append((agent, seconds, ai_calls, note))
        print(f"[TIMING] {agent:<14} {seconds * 1000:7.0f} ms  | AI calls: {ai_calls} {note}")

    def mark(self, name: str):
        self.marks[name] = time.perf_counter() - self.start

    def summary(self) -> dict:
        total = time.perf_counter() - self.start
        print("┌─────────────── MULTI-AGENT TIMING ───────────────")
        for agent, s, calls, note in self.rows:
            print(f"│ {agent:<14} {s * 1000:7.0f} ms   AI={calls}  {note}")
        for name, s in self.marks.items():
            print(f"│ ⏱ {name:<24} {s * 1000:7.0f} ms")
        print(f"│ TỔNG             {total * 1000:7.0f} ms   AI={sum(r[2] for r in self.rows)}")
        print("└──────────────────────────────────────────────────")
        return {
            "agents": [{"agent": a, "ms": round(s * 1000), "ai_calls": c, "note": n} for a, s, c, n in self.rows],
            "marks": {k: round(v * 1000) for k, v in self.marks.items()},
            "total_ms": round(total * 1000),
            "ai_calls": sum(r[2] for r in self.rows),
        }


# ============================================================
#  VISION AGENT — đọc ảnh bảng (1 lần gọi Gemini)
# ============================================================
VISION_PROMPT = """You read a Vietnamese chemistry whiteboard image. Return STRICTLY valid JSON only (no markdown).

DOMAIN SELECTION:
- "chemistry": chemical formulas/equations (Fe,Na,Cu,Zn,Al,Mg,K,S,Cl,N,C,H,O,P,Ba,Ag,Mn...) + numbers/+/=/→. Fix OCR slips: H20→H2O, C02→CO2, H2S04→H2SO4.
  Transcribe what is WRITTEN. Do NOT balance, do NOT invent products. Use plain ASCII digits (H2SO4, not H₂SO₄).
  {"domain":"chemistry","equation":"<as written, e.g. Fe + HCl ->>","reactants":["Fe","HCl"],"products":["<only if written, else empty list>"],"conditions":["<written on arrow, e.g. t°, MnO2>"]}
- "chemistry_problem": a word problem with quantities/units (gam, ml, lít, mol, M, %) or questions (Tính, Tìm, Cho... tác dụng).
  {"domain":"chemistry_problem","transcribed_problem":"<exact Vietnamese text>","topic":"<topic>","equation":"<main equation>","reactants":[],"products":[]}
- "math": {"domain":"math","core":{"expression":"<JS expr>"},"tutor":{"explanation":"<Vietnamese>"}}
- "geometry": {"domain":"geometry","core":{"name":"<cube|sphere|cylinder|cone|pyramid>"},"tutor":{"explanation":"<Vietnamese>"}}
- "concept" (asks about a definition/theory): {"domain":"concept","title":"","definition":"","classification":[],"properties":[],"examples":[],"applications":"","safety_note":"","explanation":""}
- "general": {"domain":"general","explanation":"<Vietnamese>"}
CRITICAL: letters+numbers+plus/arrow = chemistry, not general."""


class VisionAgent:
    name = "VisionAgent"

    async def run(self, img, send_log, timer: AgentTimer) -> dict:
        M = _m()
        t = time.perf_counter()
        await send_log(self.name, "👁️ Đang đọc ảnh bảng (chép đúng như viết, chưa sửa)...")
        buf = BytesIO()
        M.SuperAgent().preprocess_image(img).save(buf, format="JPEG", quality=72)
        res = await M.call_llm(
            ["Whiteboard image. Transcribe and classify:", {"mime_type": "image/jpeg", "data": buf.getvalue()}],
            VISION_PROMPT,
        )
        res = res if isinstance(res, dict) else {"domain": "general"}
        domain = res.get("domain", "general")
        timer.add(self.name, time.perf_counter() - t, 1, f"domain={domain}")
        if domain == "chemistry":
            await send_log(self.name, f"📷 Đọc được: {res.get('equation', '')} → chuyển cho SolverAgent")
        else:
            await send_log(self.name, f"📷 Nội dung loại: {domain}")
        return res


# ============================================================
#  SOLVER AGENT — cân bằng, xác định sản phẩm, tính toán
#  Ưu tiên Python (0 AI); chỉ gọi Gemini khi thiếu sản phẩm hoặc bị Verifier trả lỗi.
# ============================================================
SOLVER_PROMPT = """You are a Vietnamese high-school chemistry solver (GDPT 2018).
Given reactants (and maybe a draft equation), give the correct, BALANCED main reaction taught in Vietnamese high school.
Use plain ASCII formulas (H2SO4, Fe2(SO4)3). Put conditions in "conditions", NOT inside the equation.
Return STRICTLY JSON:
{"equation":"<balanced, e.g. 2Al + 6HCl -> 2AlCl3 + 3H2>","reactants":["Al","HCl"],"products":["AlCl3","H2"],
 "conditions":["<t°|MnO2|ánh sáng|...; empty list if none>"],"catalyst":"<catalyst or null>"}"""


class SolverAgent:
    name = "SolverAgent"

    def _python_balance(self, reactants: list, products: list, conditions: list):
        from chem_checker import balance_equation_matrix
        if not reactants or not products:
            return None
        try:
            coeffs = balance_equation_matrix(reactants, products)
        except Exception:
            coeffs = None
        return display_equation(reactants, products, coeffs, conditions) if coeffs else None

    async def run(self, draft: dict, send_log, timer: AgentTimer, feedback: dict = None) -> dict:
        M = _m()
        t = time.perf_counter()
        reactants = [r for r in draft.get("reactants", []) if r]
        products = [p for p in draft.get("products", []) if p]
        conditions = [c for c in draft.get("conditions", []) if c]
        catalyst = draft.get("catalyst")
        ai_calls, source = 0, "python"

        equation = None if feedback else self._python_balance(reactants, products, conditions)
        if equation:
            await send_log(self.name, f"🧮 Cân bằng bằng ma trận Gauss (không gọi AI): {equation}")
        else:
            if feedback:
                errs = "; ".join(e.get("message", "") for e in feedback.get("errors", []))
                await send_log(self.name, f"🔧 Nhận lỗi từ VerifierAgent, đang sửa: {errs[:120]}")
                prompt = (f"Draft equation: {draft.get('equation', '')}\nReactants: {reactants}\n"
                          f"A rule-based checker found these errors: {errs}\n"
                          f"Checker suggestion (may be partial): {feedback.get('suggestion', '')}\n"
                          "Fix the equation (products and balance).")
            else:
                await send_log(self.name, "🤔 Chưa đủ sản phẩm → hỏi Gemini xác định sản phẩm...")
                prompt = f"Draft as written: {draft.get('equation', '')}\nReactants: {reactants}\nProducts written: {products}"
            res = await M.call_llm([prompt], SOLVER_PROMPT, hedge_delay=2.5, total_timeout=12.0)
            ai_calls, source = 1, "gemini"
            reactants = res.get("reactants") or reactants
            products = res.get("products") or products
            conditions = res.get("conditions") or conditions
            catalyst = res.get("catalyst") or catalyst
            # Kiểm chứng lại hệ số AI đưa ra bằng Python; AI sai hệ số thì dùng hệ số Python
            equation = self._python_balance(reactants, products, conditions) or res.get("equation", "")
            await send_log(self.name, f"✍️ Đề xuất: {equation} → gửi VerifierAgent kiểm tra")

        # Tính toán bằng các hàm có sẵn
        cat = M._enrich_catalyst(reactants, catalyst, conditions)
        molar_masses = {s: M.parse_molar_mass(s) for s in reactants + products}
        mol_input = draft.get("mol_input") or {}
        mol_calc = M._calculate_mol_products(reactants, products, mol_input, equation=to_ascii_equation(equation)) if mol_input else {}

        timer.add(self.name, time.perf_counter() - t, ai_calls, f"({source}{', sửa lỗi' if feedback else ''})")
        return {
            "equation": equation, "reactants": reactants, "products": products,
            "catalyst": cat["catalyst"], "conditions": cat["conditions"],
            "molar_masses": molar_masses, "mol_calc": mol_calc,
            "mol_variants": M._enrich_mol_variants(reactants, []),
        }


# ============================================================
#  VERIFIER AGENT — KHÔNG gọi AI: check_equation_pedagogy + check_safety
# ============================================================
class VerifierAgent:
    name = "VerifierAgent"

    async def run(self, sol: dict, send_log, timer: AgentTimer) -> dict:
        from chem_checker import check_equation_pedagogy
        M = _m()
        t = time.perf_counter()
        ascii_eq = to_ascii_equation(sol["equation"], sol.get("conditions"))
        check = check_equation_pedagogy(ascii_eq)
        safety = M.check_safety(sol["reactants"], sol["products"], equation=ascii_eq)
        timer.add(self.name, time.perf_counter() - t, 0, "ĐÚNG" if check["is_correct"] else "SAI")
        if check["is_correct"]:
            await send_log(self.name, f"✅ Phương trình hợp lệ, nguyên tố cân bằng. An toàn: {safety.get('level')}")
        else:
            msgs = " | ".join(e["message"] for e in check["errors"])
            await send_log(f"{self.name} → SolverAgent", f"❌ {msgs[:160]}")
        return {"ok": check["is_correct"], "check": check, "safety": safety}


# ============================================================
#  TUTOR AGENT — lời giảng (1 AI) + kịch bản đọc TTS
# ============================================================
TUTOR_PROMPT = """Bạn là giáo viên Hóa THPT Việt Nam. Viết lời giảng NGẮN cho phương trình đã được kiểm chứng.
Không đổi phương trình. Tiếng Việt, chỉ số Unicode (H₂SO₄). Trả về JSON:
{"reaction_type_label":"<loại phản ứng>","mechanism":"<1 câu bản chất>","theory":"<1-2 câu lý thuyết>",
 "phenomenon":"<hiện tượng quan sát>","applications":"<1 câu ứng dụng>","student_note":"<1 câu lưu ý dễ sai>",
 "warnings":["<chỉ khi nguy hiểm>"],"lecture":"<lời giảng 3-5 câu, giọng nói tự nhiên>"}"""


class TutorAgent:
    name = "TutorAgent"

    async def run(self, sol: dict, safety: dict, send_json, send_log, timer: AgentTimer):
        M = _m()
        t = time.perf_counter()
        await send_log(self.name, "📚 Đang soạn lời giảng...")
        prompt = (f"Phương trình: {sol['equation']}\nĐiều kiện: {', '.join(sol.get('conditions') or []) or 'không'}\n"
                  f"Mức an toàn: {safety.get('level')} — {safety.get('reason', '')}")
        ped = await M.call_llm([prompt], TUTOR_PROMPT, hedge_delay=2.5, total_timeout=12.0)
        t_lecture = time.perf_counter() - t
        await send_json({"type": "result_agent_tutor", "pedagogy": ped})
        await send_log(self.name, "✅ Đã gửi lời giảng → đang tạo giọng đọc")

        t2 = time.perf_counter()
        speech = ""
        try:
            from chem_tts_module import generate_speech_script
            speech = await generate_speech_script(ped.get("lecture", ""))
        except Exception as e:
            print(f"[TutorAgent] TTS lỗi: {e}")
        t_tts = time.perf_counter() - t2
        await send_json({"type": "result_agent_tts", "speech_script": speech})
        timer.add(self.name, t_lecture, 1, "(lời giảng)")
        timer.add("TutorAgent.TTS", t_tts, 1 if speech else 0, "(generate_speech_script)")


# ============================================================
#  QUIZ AGENT — 3 câu trắc nghiệm theo phương trình (1 AI)
# ============================================================
class QuizAgent:
    name = "QuizAgent"
    NUM = 3

    async def run(self, sol: dict, send_json, send_log, timer: AgentTimer):
        M = _m()
        t = time.perf_counter()
        await send_log(self.name, f"🎯 Đang ra {self.NUM} câu trắc nghiệm...")
        plan = M._quiz_plan(self.NUM, "mcq", "mixed")
        lines = "\n".join(f'- Câu {k + 1}: TRẮC NGHIỆM ("type": "mcq"), mức {M.QUIZ_LEVEL_LABEL[lv]} ("level": "{lv}")'
                          for k, (_, lv) in enumerate(plan))
        prompt = (f"Nội dung giáo viên viết trên bảng (đã kiểm chứng, thay cho ảnh): {sol['equation']}\n"
                  f"Tạo ĐÚNG {self.NUM} câu theo bảng sau:\n{lines}")
        res = await M.call_llm([prompt], M.QUIZ_SYSTEM_PROMPT, hedge_delay=3.0, total_timeout=14.0)
        questions = []
        for q in (res.get("questions") or []):
            opts = q.get("options") if isinstance(q, dict) else None
            if isinstance(opts, dict) and len(opts) >= 2 and str(q.get("answer", "")).upper() in opts and q.get("question"):
                q.update(type="mcq", answer=str(q["answer"]).upper(), id=len(questions) + 1)
                questions.append(q)
        await send_json({"type": "result_agent_quiz", "topic": res.get("topic") or "Hóa học", "questions": questions})
        await send_log(self.name, f"✅ Đã gửi {len(questions)} câu hỏi")
        timer.add(self.name, time.perf_counter() - t, 1)


# ============================================================
#  ORCHESTRATOR — điều phối bằng code
# ============================================================
class Orchestrator:
    MAX_FIX_ROUNDS = 2

    def __init__(self, send_json, send_log):
        self.send_json = send_json
        self.send_log = send_log
        self.timer = AgentTimer()

    async def run(self, img, req: dict):
        """Domain hóa học: tự xử lý và gửi kết quả, trả về None.
        Domain khác: trả kết quả VisionAgent để main.py dùng lại luồng hiển thị cũ."""
        M = _m()
        log = self.send_log
        await log("Orchestrator", "🧭 Chế độ Phân tích sâu: Vision → Solver ⇄ Verifier → Tutor ‖ Quiz")

        vision = await VisionAgent().run(img, log, self.timer)
        if vision.get("domain") != "chemistry" or not vision.get("reactants"):
            self.timer.summary()
            return vision

        draft = dict(vision, mol_input=req.get("mol_input") or {})
        solver, verifier = SolverAgent(), VerifierAgent()
        sol = await solver.run(draft, log, self.timer)
        ver = await verifier.run(sol, log, self.timer)
        rounds = 0
        while not ver["ok"] and rounds < self.MAX_FIX_ROUNDS:
            rounds += 1
            await log("Orchestrator", f"🔁 Vòng sửa {rounds}/{self.MAX_FIX_ROUNDS}")
            sol = await solver.run(dict(draft, equation=sol["equation"], reactants=sol["reactants"],
                                        products=sol["products"]), log, self.timer, feedback=ver["check"])
            ver = await verifier.run(sol, log, self.timer)
        if not ver["ok"]:
            await log("Orchestrator", "⚠️ Hết lượt sửa — hiển thị kết quả tốt nhất, kèm cảnh báo của VerifierAgent")

        # ── ĐỢT 1: phương trình + an toàn, gửi ngay ──
        safety = ver["safety"]
        sensory = M._detect_sound_and_olfactory(sol["reactants"], sol["products"])
        await self.send_json({
            "type": "result_chemistry",
            "deep_mode": True,
            "equation": sol["equation"],
            "reactants": sol["reactants"],
            "products": sol["products"],
            "explanation": "",
            "catalyst": sol["catalyst"],
            "conditions": sol["conditions"],
            "mol_variants": sol["mol_variants"],
            "mol_calc": sol["mol_calc"],
            "molar_masses": sol["molar_masses"],
            "sound_type": sensory.get("sound_type", "none"),
            "olfactory": sensory.get("olfactory"),
            "verification": {"ok": ver["ok"], "fix_rounds": rounds, "written": vision.get("equation", ""),
                             "errors": [e["message"] for e in ver["check"]["errors"]]},
            "safety": {
                "level": safety.get("level", "safe"),
                "reason": safety.get("reason", ""),
                "pair": safety.get("pair", ""),
                "is_critical": safety.get("is_critical", False),
                "critical_safe_alt": safety.get("critical_safe_alt"),
                "safe_alternative": safety.get("critical_safe_alt"),
                "summary": safety.get("reason", ""),
                "warnings": [],
                "_curriculum": "high_school",
                "_pedagogy_loading": True,
            },
        })
        self.timer.mark("Đợt 1 (phương trình)")
        await log("Orchestrator", "📤 Đã gửi phương trình + an toàn → chạy song song TutorAgent ‖ QuizAgent")

        # ── ĐỢT 2: lời giảng + quiz song song ──
        results = await asyncio.gather(
            TutorAgent().run(sol, safety, self.send_json, log, self.timer),
            QuizAgent().run(sol, self.send_json, log, self.timer),
            return_exceptions=True,
        )
        for name, r in zip(("TutorAgent", "QuizAgent"), results):
            if isinstance(r, Exception):
                print(f"[Orchestrator] {name} lỗi: {r!r}")
                await log(name, "⚠️ Lỗi, bỏ qua phần này")
        self.timer.mark("Hoàn tất")
        await self.send_json({"type": "agent_done", "timing": self.timer.summary()})
        return None
