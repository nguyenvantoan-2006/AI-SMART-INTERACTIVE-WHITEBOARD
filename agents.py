"""
HỆ THỐNG NHIỀU AGENT cho Trực quan hóa phương trình hóa học.

    VisionAgent (1 AI) ──► SolverAgent (0-3 AI, tự chọn công cụ) ──► VerifierAgent (0 AI) ──► gửi kết quả
                               ▲                                          │ sai → gửi lỗi lại
                               └──────────────────────────────────────────┘

SolverAgent: phương trình đã đủ 2 vế thì cân bằng bằng Python, không gọi AI. Các trường hợp còn lại
chạy vòng lặp agent: AI chọn công cụ → code chạy công cụ → AI xem kết quả rồi quyết định bước tiếp.
Đáp án AI nộp được luật hóa học kiểm tra ngay; đạt thì dừng, không tốn thêm lượt.
Orchestrator giữ giới hạn cứng về số bước AI và thời gian; cảnh báo an toàn luôn do code quyết định.

AI bận / quá thời gian trước khi có phương trình → ném AgentFailure, main.py chạy lại bằng SuperAgent.
Hết lượt API → ApiQuotaExceeded đi thẳng ra main.py để báo giáo viên.
Nhật ký agent chỉ in ra terminal, không gửi lên giao diện.
TutorAgent, QuizAgent: Orchestrator không còn chạy để tiết kiệm lượt API.
"""
import asyncio
import json
import re
import time
from io import BytesIO


class AgentFailure(Exception):
    """Chế độ sâu không ra được phương trình → main.py chuyển sang SuperAgent."""


async def print_agent_log(agent: str, message: str):
    """Nhật ký agent: in ra terminal để theo dõi, không gửi lên giao diện."""
    print(f"[AGENT] {agent}: {message}", flush=True)


def _brief(value, limit: int = 110) -> str:
    """Rút gọn tham số/kết quả công cụ để in nhật ký."""
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + "…"


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


class AgentBudget:
    """Giới hạn cứng cho một lần bấm: số bước AI và thời gian còn lại. Agent không tự vượt được."""

    def __init__(self, max_ai_steps: int, seconds: float):
        self.ai_left = max_ai_steps
        self.deadline = time.perf_counter() + seconds

    def seconds_left(self) -> float:
        return self.deadline - time.perf_counter()

    def can_call_ai(self) -> bool:
        return self.ai_left > 0 and self.seconds_left() > 1.0


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
        if res.get("_llm_error"):
            raise AgentFailure(f"VisionAgent: {res.get('explanation', 'AI không phản hồi')}")
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
SOLVER_PROMPT = """You are SolverAgent, a Vietnamese high-school chemistry solver (GDPT 2018).
Goal: the correct main reaction taught in Vietnamese high school for the given reactants. You decide what to do by calling tools.

TOOLS:
- submit_equation: your final answer. Code balances it and checks it against chemistry rules. If it passes you are done; if not you get the errors and must fix them.
- declare_no_reaction: final answer when NO reaction occurs under standard high-school conditions (e.g. H2 + H2SO4, Cu + HCl, Cu + H2SO4 loãng, Ag + HCl, NaCl + KNO3, BaSO4 + HCl).
- balance_equation, check_equation: only when you are unsure and want to test a candidate first.

Each step costs the teacher waiting time: when you are confident, go straight to a final answer.
A rule-based checker's errors are authoritative: never resubmit what it rejected.
Use plain ASCII formulas (H2SO4, Fe2(SO4)3). No coefficients in reactants or products. Put conditions (t°, MnO2, ánh sáng...) in "conditions", not in formulas.
Write the no_reaction reason in Vietnamese."""

_STR_LIST = {"type": "ARRAY", "items": {"type": "STRING"}}
SOLVER_TOOLS = [{"function_declarations": [
    {"name": "balance_equation", "description": "Cân bằng thử bằng ma trận. Trả về phương trình đã cân bằng hoặc báo không cân bằng được.",
     "parameters": {"type": "OBJECT", "properties": {"reactants": _STR_LIST, "products": _STR_LIST}, "required": ["reactants", "products"]}},
    {"name": "check_equation", "description": "Kiểm tra phương trình bằng luật hóa học: sản phẩm, hóa trị, điều kiện, bảo toàn nguyên tố.",
     "parameters": {"type": "OBJECT", "properties": {"equation": {"type": "STRING", "description": "Ví dụ: 2Al + 6HCl -> 2AlCl3 + 3H2"}}, "required": ["equation"]}},
    {"name": "submit_equation", "description": "Nộp đáp án cuối: chất tham gia, sản phẩm, điều kiện, xúc tác.",
     "parameters": {"type": "OBJECT", "properties": {"reactants": _STR_LIST, "products": _STR_LIST, "conditions": _STR_LIST,
                                                     "catalyst": {"type": "STRING"}}, "required": ["reactants", "products"]}},
    {"name": "declare_no_reaction", "description": "Nộp kết luận cuối: các chất không phản ứng với nhau.",
     "parameters": {"type": "OBJECT", "properties": {"reason": {"type": "STRING", "description": "Lý do ngắn bằng tiếng Việt"}}, "required": ["reason"]}},
]}]
_SOLVER_FINAL_TOOLS = ["submit_equation", "declare_no_reaction"]


def _same_substances(reactants: list, products: list) -> bool:
    return set(r.upper() for r in reactants) == set(p.upper() for p in products)


def _str_list(value) -> list:
    return [str(x).strip() for x in value if str(x).strip()] if isinstance(value, list) else []


class SolverAgent:
    name = "SolverAgent"
    STEP_TIMEOUT = 12.0   # giây — tối đa cho mỗi bước AI

    def _python_balance(self, reactants: list, products: list, conditions: list):
        from chem_checker import balance_equation_matrix
        if not reactants or not products or _same_substances(reactants, products):
            return None
        try:
            coeffs = balance_equation_matrix(reactants, products)
        except Exception:
            coeffs = None
        return display_equation(reactants, products, coeffs, conditions) if coeffs else None

    def _no_reaction(self, reactants: list, reason: str) -> dict:
        return {
            "equation": f"{' + '.join(reactants)} → không phản ứng", "reactants": reactants, "products": [],
            "catalyst": None, "conditions": [],
            "molar_masses": {s: _m().parse_molar_mass(s) for s in reactants},
            "mol_calc": {}, "mol_variants": [],
            "no_reaction": True, "no_reaction_reason": reason,
        }

    def _solution(self, draft: dict, equation: str, reactants: list, products: list, conditions: list, catalyst) -> dict:
        """Tính toán bằng các hàm có sẵn, không gọi AI."""
        M = _m()
        cat = M._enrich_catalyst(reactants, catalyst, conditions)
        mol_input = draft.get("mol_input") or {}
        return {
            "equation": equation, "reactants": reactants, "products": products,
            "catalyst": cat["catalyst"], "conditions": cat["conditions"],
            "molar_masses": {s: M.parse_molar_mass(s) for s in reactants + products},
            "mol_calc": M._calculate_mol_products(reactants, products, mol_input, equation=to_ascii_equation(equation)) if mol_input else {},
            "mol_variants": M._enrich_mol_variants(reactants, []),
        }

    # ── Công cụ cho AI. Mỗi công cụ trả (kết quả gửi lại AI, đáp án cuối hoặc None) ──
    def _tool_balance(self, args: dict, state: dict):
        equation = self._python_balance(_str_list(args.get("reactants")), _str_list(args.get("products")), [])
        if not equation:
            return {"ok": False, "error": "Không cân bằng được: kiểm tra lại công thức hoặc sản phẩm."}, None
        return {"ok": True, "equation": equation}, None

    def _tool_check(self, args: dict, state: dict):
        from chem_checker import check_equation_pedagogy
        check = check_equation_pedagogy(to_ascii_equation(str(args.get("equation", ""))))
        return {"ok": check["is_correct"], "errors": [e["message"] for e in check["errors"]],
                "no_reaction": check.get("no_reaction", False), "suggestion": check.get("suggestion", "")}, None

    def _tool_submit(self, args: dict, state: dict):
        from chem_checker import check_equation_pedagogy
        reactants = _str_list(args.get("reactants")) or state["reactants"]
        products = _str_list(args.get("products"))
        conditions = _str_list(args.get("conditions")) or state["conditions"]
        catalyst = args.get("catalyst") or state["catalyst"]
        if not products:
            return {"ok": False, "error": "Thiếu sản phẩm. Nếu không phản ứng, hãy gọi declare_no_reaction."}, None
        if _same_substances(reactants, products):
            return {"ok": True}, self._no_reaction(reactants, "Các chất sau phản ứng trùng với chất tham gia ban đầu, không tạo thành chất mới.")
        equation = self._python_balance(reactants, products, conditions)
        if not equation:
            return {"ok": False, "error": "Không cân bằng được 2 vế: kiểm tra lại công thức hoặc sản phẩm."}, None
        check = check_equation_pedagogy(to_ascii_equation(equation, conditions))
        sol = self._solution(state["draft"], equation, reactants, products, conditions, catalyst)
        if check["is_correct"]:
            return {"ok": True}, sol
        state["best"] = sol   # hết lượt mà chưa đạt thì vẫn có kết quả để hiển thị kèm cảnh báo
        return {"ok": False, "errors": [e["message"] for e in check["errors"]],
                "no_reaction": check.get("no_reaction", False), "suggestion": check.get("suggestion", "")}, None

    def _tool_no_reaction(self, args: dict, state: dict):
        reason = str(args.get("reason") or "Các chất không phản ứng với nhau ở điều kiện thông thường.")
        return {"ok": True}, self._no_reaction(state["reactants"], reason)

    async def _agent_loop(self, draft: dict, feedback, send_log, budget: AgentBudget):
        """Vòng lặp agent. Trả (đáp án hoặc None, số bước AI)."""
        M = _m()
        tools = {"balance_equation": self._tool_balance, "check_equation": self._tool_check,
                 "submit_equation": self._tool_submit, "declare_no_reaction": self._tool_no_reaction}
        state = {"draft": draft, "reactants": [r for r in draft.get("reactants", []) if r],
                 "conditions": [c for c in draft.get("conditions", []) if c], "catalyst": draft.get("catalyst"), "best": None}
        context = (f"Draft as written on the board: {draft.get('equation', '')}\nReactants: {state['reactants']}\n"
                   f"Products written: {[p for p in draft.get('products', []) if p]}")
        if feedback:
            errs = "; ".join(e.get("message", "") for e in feedback.get("errors", []))
            context += f"\nVerifierAgent rejected the previous answer: {errs}\nChecker suggestion (may be partial): {feedback.get('suggestion', '')}"
        history, steps = [], 0
        while budget.can_call_ai():
            last_step = budget.ai_left == 1
            prompt = context + ("\n\nSteps so far:\n" + "\n".join(history) if history else "")
            if last_step:
                prompt += "\n\nThis is your last step: give a final answer now."
            budget.ai_left -= 1
            steps += 1
            res = await M.call_llm_tools([prompt], SOLVER_PROMPT, SOLVER_TOOLS,
                                         allowed=_SOLVER_FINAL_TOOLS if last_step else None,
                                         total_timeout=min(self.STEP_TIMEOUT, budget.seconds_left()))
            if res.get("_llm_error"):
                raise AgentFailure(f"SolverAgent: {res.get('explanation', 'AI không phản hồi')}")
            for call in res["calls"]:
                name, args = call["name"], call["args"]
                tool = tools.get(name)
                result, final = tool(args, state) if tool else ({"ok": False, "error": f"Không có công cụ {name}"}, None)
                await send_log(self.name, f"🧠 Bước {steps}: AI chọn {name}({_brief(args)}) → {_brief(result)}")
                if final:
                    return final, steps
                history.append(f"{len(history) + 1}. {name}({json.dumps(args, ensure_ascii=False)}) -> {json.dumps(result, ensure_ascii=False)}")
        await send_log(self.name, "⚠️ Hết lượt cho phép, chưa có đáp án đạt luật")
        return state["best"], steps

    def _from_checker_suggestion(self, draft: dict, feedback: dict):
        """AI không kịp sửa: dùng phương trình đúng mà luật hóa học gợi ý, nếu nó tự qua được kiểm tra."""
        from chem_checker import check_equation_pedagogy, parse_equation_sides
        ascii_eq = to_ascii_equation((feedback or {}).get("suggestion") or "")
        if not ascii_eq or not check_equation_pedagogy(ascii_eq)["is_correct"]:
            return None
        left, right, _ = parse_equation_sides(ascii_eq)
        reactants, products = [f for _, f in left], [f for _, f in right]
        conditions = [c for c in draft.get("conditions", []) if c]
        equation = self._python_balance(reactants, products, conditions)
        return self._solution(draft, equation, reactants, products, conditions, draft.get("catalyst")) if equation else None

    async def run(self, draft: dict, send_log, timer: AgentTimer, budget: AgentBudget, feedback: dict = None) -> dict:
        t = time.perf_counter()
        reactants = [r for r in draft.get("reactants", []) if r]
        products = [p for p in draft.get("products", []) if p]
        conditions = [c for c in draft.get("conditions", []) if c]

        if feedback and (feedback.get("no_reaction") or any(e.get("type") == "no_reaction" for e in feedback.get("errors", []))):
            reason = feedback.get("errors", [{}])[0].get("message", "Không có phản ứng hóa học xảy ra.")
            await send_log(self.name, f"ℹ️ Xác nhận không phản ứng: {' + '.join(reactants)}")
            timer.add(self.name, time.perf_counter() - t, 0, "(không phản ứng)")
            return self._no_reaction(reactants, reason)

        # Đề đã đủ 2 vế: Python cân bằng, không tốn lượt AI; sai thì VerifierAgent sẽ trả về
        equation = None if feedback else self._python_balance(reactants, products, conditions)
        if equation:
            await send_log(self.name, f"🧮 Cân bằng bằng ma trận Gauss (không gọi AI): {equation}")
            timer.add(self.name, time.perf_counter() - t, 0, "(python)")
            return self._solution(draft, equation, reactants, products, conditions, draft.get("catalyst"))

        await send_log(self.name, f"🤖 Tự xử lý{' lỗi từ VerifierAgent' if feedback else ''}: còn tối đa {budget.ai_left} bước AI")
        steps_before = budget.ai_left
        try:
            sol, _ = await self._agent_loop(draft, feedback, send_log, budget)
        except AgentFailure:
            sol = self._from_checker_suggestion(draft, feedback)
            if not sol:
                raise
            await send_log(self.name, f"🛟 AI không kịp trả lời → dùng gợi ý của luật hóa học: {sol['equation']}")
        timer.add(self.name, time.perf_counter() - t, steps_before - budget.ai_left, f"(agent{', sửa lỗi' if feedback else ''})")
        if not sol:
            raise AgentFailure("SolverAgent: hết lượt cho phép mà chưa có phương trình")
        return sol


# ============================================================
#  VERIFIER AGENT — KHÔNG gọi AI: check_equation_pedagogy + check_safety
# ============================================================
class VerifierAgent:
    name = "VerifierAgent"

    async def run(self, sol: dict, send_log, timer: AgentTimer) -> dict:
        from chem_checker import check_equation_pedagogy
        M = _m()
        t = time.perf_counter()
        if sol.get("no_reaction"):
            timer.add(self.name, time.perf_counter() - t, 0, "KHÔNG PHẢN ỨNG")
            await send_log(self.name, f"✅ Xác nhận: {sol.get('no_reaction_reason', 'Không có phản ứng hóa học xảy ra.')}")
            return {
                "ok": True, "no_reaction": True,
                "check": {
                    "is_correct": False, "no_reaction": True,
                    "errors": [{"type": "no_reaction", "message": sol.get("no_reaction_reason", "Không xảy ra phản ứng")}],
                    "suggestion": sol["equation"]
                },
                "safety": {"level": "safe", "reason": "Các chất bền vững, không phản ứng hóa học ở điều kiện thông thường."}
            }
        ascii_eq = to_ascii_equation(sol["equation"], sol.get("conditions"))
        check = check_equation_pedagogy(ascii_eq)
        safety = M.check_safety(sol["reactants"], sol["products"], equation=ascii_eq)
        timer.add(self.name, time.perf_counter() - t, 0, "ĐÚNG" if check["is_correct"] else "SAI")
        if check["is_correct"]:
            await send_log(self.name, f"✅ Phương trình hợp lệ, nguyên tố cân bằng. An toàn: {safety.get('level')}")
        else:
            msgs = " | ".join(e["message"] for e in check["errors"])
            await send_log(f"{self.name} → SolverAgent", f"❌ {msgs[:160]}")
        return {"ok": check["is_correct"], "check": check, "safety": safety, "no_reaction": check.get("no_reaction", False)}


# ============================================================
#  TUTOR AGENT — lời giảng (1 AI) + kịch bản đọc TTS
# ============================================================
TUTOR_PROMPT = """Bạn là giáo viên Hóa THPT Việt Nam. Viết lời giảng NGẮN cho phương trình hoặc hiện tượng đã được kiểm chứng.
Nếu phương trình ghi "không phản ứng", hãy giải thích sư phạm tại sao các chất này không phản ứng với nhau ở điều kiện thông thường (dựa vào dãy hoạt động hóa học, tính oxi hóa - khử, hoặc điều kiện phản ứng trao đổi).
Không đổi phương trình. Tiếng Việt, chỉ số Unicode (H₂SO₄). Trả về JSON:
{"reaction_type_label":"<loại phản ứng>","mechanism":"<1 câu bản chất>","theory":"<1-2 câu lý thuyết>",
 "phenomenon":"<hiện tượng quan sát>","applications":"<1 câu ứng dụng>","student_note":"<1 câu lưu ý dễ sai>",
 "warnings":["<chỉ khi nguy hiểm>"],"lecture":"<lời giảng 3-5 câu, giọng nói tự nhiên>"}"""


class TutorAgent:
    name = "TutorAgent"
    TTS_TIMEOUT = 10.0   # generate_speech_script tự gọi lại tối đa 3 lần — chặn để không treo agent_done

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
            speech = await asyncio.wait_for(generate_speech_script(ped.get("lecture", "")), timeout=self.TTS_TIMEOUT)
        except asyncio.TimeoutError:
            print(f"[TutorAgent] TTS quá {self.TTS_TIMEOUT:.0f}s → đọc thẳng lời giảng")
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
    MAX_AI_STEPS = 4        # tổng số bước AI cho một lần bấm, gồm cả VisionAgent
    PHASE1_TIMEOUT = 20.0   # giây — quá mức này chưa có phương trình thì lùi về SuperAgent

    def __init__(self, send_json):
        self.send_json = send_json
        self.send_log = print_agent_log
        self.timer = AgentTimer()

    async def run(self, img, req: dict):
        """Domain hóa học: tự xử lý và gửi kết quả, trả về None.
        Domain khác: trả kết quả VisionAgent để main.py dùng lại luồng hiển thị cũ.
        Lỗi trước khi có phương trình → AgentFailure."""
        M = _m()
        log = self.send_log
        await log("Orchestrator", f"🧭 Vision → Solver ⇄ Verifier (tối đa {self.MAX_AI_STEPS} bước AI, {self.PHASE1_TIMEOUT:.0f}s)")

        try:
            vision, sol, ver, rounds = await asyncio.wait_for(self._solve(img, req), timeout=self.PHASE1_TIMEOUT)
        except M.ApiQuotaExceeded:
            self.timer.summary()
            raise
        except asyncio.TimeoutError:
            self.timer.summary()
            raise AgentFailure(f"quá {self.PHASE1_TIMEOUT:.0f}s chưa có phương trình")
        except AgentFailure:
            self.timer.summary()
            raise
        if sol is None:
            self.timer.summary()
            return vision
        await self._send_results(M, vision, sol, ver, rounds)
        return None

    async def _solve(self, img, req: dict):
        """Đợt 1: Vision → Solver ⇄ Verifier. Trả (vision, None, None, 0) nếu không phải phương trình hóa học."""
        log = self.send_log
        # Chừa 1 giây để gửi kết quả tốt nhất trước khi Orchestrator cắt ở PHASE1_TIMEOUT
        budget = AgentBudget(self.MAX_AI_STEPS, self.PHASE1_TIMEOUT - 1.0)
        vision = await VisionAgent().run(img, log, self.timer)
        budget.ai_left -= 1
        if vision.get("domain") != "chemistry" or not vision.get("reactants"):
            return vision, None, None, 0

        draft = dict(vision, mol_input=req.get("mol_input") or {})
        solver, verifier = SolverAgent(), VerifierAgent()
        sol = await solver.run(draft, log, self.timer, budget)
        ver = await verifier.run(sol, log, self.timer)
        rounds = 0
        while not ver["ok"] and rounds < self.MAX_FIX_ROUNDS and (budget.can_call_ai() or ver.get("no_reaction")):
            rounds += 1
            await log("Orchestrator", f"🔁 Vòng sửa {rounds}/{self.MAX_FIX_ROUNDS}")
            sol = await solver.run(dict(draft, equation=sol["equation"], reactants=sol["reactants"],
                                        products=sol["products"]), log, self.timer, budget, feedback=ver["check"])
            ver = await verifier.run(sol, log, self.timer)
        if not ver["ok"]:
            if any(e["type"] == "format_error" for e in ver["check"]["errors"]):
                raise AgentFailure("VerifierAgent: phương trình không đọc được sau khi sửa")
            await log("Orchestrator", "⚠️ Hết lượt sửa — hiển thị kết quả tốt nhất, kèm cảnh báo của VerifierAgent")
        return vision, sol, ver, rounds

    async def _send_results(self, M, vision, sol, ver, rounds):
        safety = ver["safety"]
        sensory = M._detect_sound_and_olfactory(sol["reactants"], sol["products"])
        self.timer.mark("Có phương trình")
        # Client đóng kết nối ngay khi nhận message này, nên đây phải là message cuối (kèm luôn số đo thời gian)
        await self.send_json({
            "type": "result_chemistry",
            "equation": sol["equation"],
            "reactants": sol["reactants"],
            "products": sol["products"],
            "no_reaction": sol.get("no_reaction", False) or ver.get("no_reaction", False),
            "no_reaction_reason": sol.get("no_reaction_reason", "") or (ver.get("check", {}).get("errors", [{}])[0].get("message") if ver.get("no_reaction") else ""),
            "explanation": "",
            "catalyst": sol["catalyst"],
            "conditions": sol["conditions"],
            "mol_variants": sol["mol_variants"],
            "mol_calc": sol["mol_calc"],
            "molar_masses": sol["molar_masses"],
            "sound_type": sensory.get("sound_type", "none"),
            "olfactory": sensory.get("olfactory"),
            "timing": self.timer.summary(),
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
                "_pedagogy_loading": False,
            },
        })
