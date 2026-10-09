import os
import sys

# Fix UnicodeEncodeError on Windows console (cp1252 → utf-8)
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from dotenv import load_dotenv
load_dotenv()
import base64
import json
import asyncio
from io import BytesIO
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
from PIL import Image

app = FastAPI(title="AI Smart Whiteboard Multi-Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================
# BẢO MẬT: API key được đọc từ file .env (không bao
# giờ hardcode trực tiếp vào code hay commit lên Git)
# Xem file .env.example để biết cách cài đặt.
# =====================================================
DEBUG_IMAGES = os.getenv("DEBUG_IMAGES", "false").lower() == "true"

def _load_api_key():
    """Reload API key từ .env mỗi lần gọi — không cần restart server khi đổi key."""
    load_dotenv(override=True)  # override=True để đọc lại file .env
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    return key

# Khởi động: check key lần đầu
_initial_key = _load_api_key()
_cached_key = _initial_key or ""  # Khởi tạo cached key ngay từ đầu
if _initial_key:
    genai.configure(api_key=_initial_key)
    print(f"[OK] Gemini API key loaded (***{_initial_key[-6:]})")
else:
    print("[ERROR] Không tìm thấy GEMINI_API_KEY!")
    print("[ERROR] Hãy tạo file .env và thêm: GEMINI_API_KEY=your_key_here")
    print("[ERROR] Key hợp lệ bắt đầu bằng AIzaSy... (lấy tại https://aistudio.google.com/app/apikey)")

# Model: config qua GEMINI_MODEL trong .env
# "gemini-2.0-flash" — fast vision model, hỗ trợ JSON mode
model_name = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

# ===== SPEED OPT: Cache model instance và API key ========
# Tạo model một lần, tái sử dụng — tránh khởi tạo lại 300-500ms mỗi request
_model_cache: dict = {}          # { model_name: GenerativeModel }

_cached_key_ts: float = 0        # timestamp lần đọc cuối


def _get_model(model_name_: str, system_instruction: str):
    """Lấy hoặc tạo model. Tái sử dụng instance cho cùng model_name."""
    import time
    global _cached_key, _cached_key_ts
    now = time.time()
    # Chỉ đọc lại .env mỗi 30 giây — tránh I/O overhead mỗi request
    if now - _cached_key_ts > 30:
        _cached_key = _load_api_key() or _cached_key
        _cached_key_ts = now
        if _cached_key:
            genai.configure(api_key=_cached_key)
    cache_key = f"{model_name_}|{hash(system_instruction)}"
    if cache_key not in _model_cache:
        _model_cache[cache_key] = genai.GenerativeModel(
            model_name=model_name_,
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"}
        )
    return _model_cache[cache_key]

DEFAULT_MODEL = "gemini-3.5-flash-lite"   # ~2s/phản ứng (đo 2026-10); bản flash thường hay 503 + chờ ~40s
# Chỉ giữ model nhanh; gemini-3.5-flash có "thinking" nên hay vượt 30s → không dùng làm dự phòng
FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"]

# SPEED OPT: "Chạy đua" các model — Google đôi khi treo 1 model hàng chục giây (đặc biệt với ảnh).
# Gọi model chính trước; sau LLM_HEDGE_DELAY giây chưa xong thì gọi thêm model dự phòng SONG SONG,
# model nào trả lời hợp lệ trước thì dùng, các lời gọi còn lại bị hủy.
LLM_HEDGE_DELAY       = 4.0               # giây — chờ bao lâu thì gọi thêm model dự phòng
LLM_TOTAL_TIMEOUT     = 35.0              # giây — tối đa cho cả lượt gọi
LLM_COOLDOWN_SECONDS  = 120.0             # model vừa lỗi/chậm → xếp xuống cuối trong 2 phút
_model_cooldown_until: dict = {}          # { model_name: timestamp hết cooldown }


class _ApiKeyInvalid(Exception):
    pass


_LLM_RESPONSE_CACHE: dict = {}

def _compute_prompt_hash(prompt: list, system_instruction: str) -> str:
    """Tạo mã băm nhanh từ prompt và system_instruction để phục vụ Smart Cache."""
    import hashlib
    hasher = hashlib.md5(system_instruction.encode('utf-8', errors='ignore'))
    for item in prompt:
        if isinstance(item, str):
            hasher.update(item.encode('utf-8', errors='ignore'))
        elif isinstance(item, dict) and "data" in item:
            data = item["data"]
            if isinstance(data, (bytes, bytearray)):
                hasher.update(data[:4096])
            elif isinstance(data, str):
                hasher.update(data[:4096].encode('utf-8', errors='ignore'))
    return hasher.hexdigest()


def _parse_llm_json(text: str, model_candidate: str) -> dict:
    """Parse JSON từ AI; JSON lỗi thì cố trích phương trình hóa học bằng regex."""
    text = text.strip()
    print(f"[LLM {model_candidate} RAW RESPONSE]: {text[:300]}")
    # Clean up markdown JSON blocks if present
    if text.startswith("```json"): text = text[7:]
    if text.startswith("```"): text = text[3:]
    if text.endswith("```"): text = text[:-3]
    try:
        parsed = json.loads(text.strip())
        print(f"[LLM PARSED ({model_candidate})]: domain={parsed.get('domain','?')}")
        return parsed
    except json.JSONDecodeError as je:
        print(f"[LLM JSON ERROR]: {je} | Raw: {text[:200]}")
        # Fallback regex extraction for chemistry if JSON is malformed
        if '"domain":"chemistry"' in text.replace(' ', ''):
            import re
            eq = re.search(r'"equation"\s*:\s*"([^"]+)"', text)
            eq_val = eq.group(1) if eq else ""
            reac = re.search(r'"reactants"\s*:\s*\[(.*?)\]', text)
            reac_val = [x.strip(' "') for x in reac.group(1).split(',')] if reac else []
            prod = re.search(r'"products"\s*:\s*\[(.*?)\]', text)
            prod_val = [x.strip(' "') for x in prod.group(1).split(',')] if prod else []
            return {"domain": "chemistry", "equation": eq_val, "reactants": reac_val, "products": prod_val, "explanation": "Phản ứng đã được nhận dạng."}
        return {"domain": "general", "explanation": "Lỗi định dạng AI: Hãy thử khoanh vùng lại một chút nhé!"}


async def _call_one_model(model_candidate: str, prompt: list, system_instruction: str) -> dict:
    model = _get_model(model_candidate, system_instruction)
    try:
        response = await model.generate_content_async(prompt)
    except Exception as e:
        err_msg = str(e)
        if "API_KEY_INVALID" in err_msg or "API key not valid" in err_msg:
            raise _ApiKeyInvalid() from e
        raise
    return _parse_llm_json(response.text, model_candidate)


async def call_llm(prompt: list, system_instruction: str) -> dict:
    # SPEED OPT 1: Kiểm tra Smart Cache trước khi gọi API
    cache_key = _compute_prompt_hash(prompt, system_instruction)
    if cache_key in _LLM_RESPONSE_CACHE:
        print(f"[CACHE HIT] Phản hồi tức thì (<50ms) từ bộ nhớ đệm [hash={cache_key[:8]}]")
        return _LLM_RESPONSE_CACHE[cache_key]

    # SPEED OPT 2: Dùng cached key — _get_model() đã refresh mỗi 30s, không cần load_dotenv mỗi call
    global _cached_key
    if not _cached_key:
        _cached_key = _load_api_key()
    current_key = _cached_key
    if not current_key:
        return {"domain": "general", "explanation": "❌ Chưa cấu hình GEMINI_API_KEY trong file .env!"}

    import time
    active_model_name = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
    models_to_try = [active_model_name] + [m for m in FALLBACK_MODELS if m != active_model_name]
    # Đẩy model đang cooldown (vừa lỗi/chậm) xuống cuối — vẫn giữ làm phương án cuối cùng
    now = time.time()
    models_to_try.sort(key=lambda m: _model_cooldown_until.get(m, 0) > now)

    started = time.time()
    running: dict = {}            # task -> model name
    next_idx = 0

    def launch_next():
        nonlocal next_idx
        m = models_to_try[next_idx]
        next_idx += 1
        print(f"[LLM] Gọi {m} ({time.time() - started:.1f}s)")
        running[asyncio.ensure_future(_call_one_model(m, prompt, system_instruction))] = m

    launch_next()
    try:
        while running:
            remaining = LLM_TOTAL_TIMEOUT - (time.time() - started)
            if remaining <= 0:
                break
            # Còn model dự phòng → chỉ chờ LLM_HEDGE_DELAY rồi gọi thêm model song song
            wait_for = min(LLM_HEDGE_DELAY, remaining) if next_idx < len(models_to_try) else remaining
            done, _ = await asyncio.wait(running.keys(), timeout=wait_for, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                m = running.pop(task)
                try:
                    parsed = task.result()
                except _ApiKeyInvalid:
                    print(f"[LLM] API KEY KHÔNG HỢP LỆ! Vui lòng lấy key mới.")
                    return {"domain": "general", "explanation": "API Key không hợp lệ! Vui lòng cập nhật GEMINI_API_KEY trong file .env."}
                except Exception as e:
                    print(f"[LLM ERROR with {m}]: {type(e).__name__}: {str(e)[:150]}", flush=True)
                    _model_cooldown_until[m] = time.time() + LLM_COOLDOWN_SECONDS
                    continue
                print(f"[LLM] ✅ {m} trả lời sau {time.time() - started:.1f}s")
                # Lưu vào cache để tái sử dụng ngay lập tức
                _LLM_RESPONSE_CACHE[cache_key] = parsed
                if len(_LLM_RESPONSE_CACHE) > 300:
                    _LLM_RESPONSE_CACHE.pop(next(iter(_LLM_RESPONSE_CACHE)))
                return parsed

            # Chưa có kết quả (chậm hoặc vừa lỗi) → gọi thêm model dự phòng
            if next_idx < len(models_to_try):
                if not done:
                    for m in running.values():
                        _model_cooldown_until[m] = time.time() + LLM_COOLDOWN_SECONDS
                launch_next()
    finally:
        for task in running:
            task.cancel()

    return {"domain": "general", "explanation": "Hệ thống AI tạm thời bận do chạm giới hạn lượt gọi. Vui lòng thử lại sau vài giây!"}


# --- AGENTS ---
# LƯU Ý KIẾN TRÚC: Toàn bộ pipeline nhận dạng hội tụ vào SuperAgent (single LLM call).
# Các agent bên dưới (OrchestratorAgent, VisionOCRAgent...) là thiết kế cũ đã được
# thay thế bởi SuperAgent để giảm latency. Không còn được sử dụng nữa.

# ============================================================
#  LAYER 1 — HARDCODED SAFETY DATABASE
#  Kiểm tra tức thì, KHÔNG cần AI, không thể bị bypass.
#  Cấu trúc: { frozenset({mol_A, mol_B}): (level, reason_vi) }
#  level: "danger" | "caution" | "toxic"
# ============================================================
_SAFETY_DB = {
    # ── NGUY HIỂM TUYỆT ĐỐI (level: danger) ──────────────────
    frozenset({"HCLO4", "HCL"}):    ("danger",  "Hỗn hợp axit perchloric + HCl tạo khí Cl₂ và hơi axit rất độc."),
    frozenset({"KMNO4", "HCL"}):    ("danger",  "KMnO₄ + HCl đặc tạo Cl₂ — khí độc gây hại hô hấp nghiêm trọng."),
    frozenset({"H2SO4", "KMNO4"}):  ("danger",  "H₂SO₄ đặc + KMnO₄ tạo Mn₂O₇ — chất lỏng nổ tự phát ở nhiệt độ thường."),
    frozenset({"NH4NO3", "H2SO4"}): ("danger",  "NH₄NO₃ + H₂SO₄ đặc có thể gây phân hủy nổ mạnh."),
    frozenset({"NH4NO3", "HNO3"}):  ("danger",  "Kết hợp này cực kỳ bất ổn định, nguy cơ nổ cao."),
    frozenset({"NA", "H2O"}):       ("danger",  "Na kim loại + H₂O phản ứng mãnh liệt, tỏa nhiệt lớn, bắn tia lửa H₂."),
    frozenset({"K", "H2O"}):        ("danger",  "K kim loại + H₂O phản ứng dữ dội hơn Na, H₂ bắt lửa tức thì."),
    frozenset({"LI", "H2O"}):       ("danger",  "Li kim loại + H₂O phản ứng mạnh, sinh H₂ và nhiệt lớn."),
    frozenset({"F2", "H2O"}):       ("danger",  "F₂ + H₂O phản ứng bạo lực tạo HF — axit cực mạnh, ăn mòn xương."),
    frozenset({"CL2", "NH3"}):      ("danger",  "Cl₂ + NH₃ tạo NCl₃ — chất nổ cực nhạy, cực độc."),
    frozenset({"H2SO4", "NA"}):     ("danger",  "Na kim loại + H₂SO₄ phản ứng mãnh liệt, có thể bắn axit ra ngoài."),
    frozenset({"HNO3", "NA"}):      ("danger",  "Na kim loại + HNO₃ đặc phản ứng bùng phát, nguy hiểm cao."),

    # ── ĐỘC HẠI (level: toxic) — tạo khí độc ────────────────
    frozenset({"NAOCL", "HCL"}):   ("toxic",   "Thuốc tẩy (NaOCl) + HCl tạo khí Cl₂ — độc, không được trộn."),
    frozenset({"NAOCL", "H2SO4"}): ("toxic",   "Thuốc tẩy + H₂SO₄ tạo HClO và Cl₂ — khí cực độc."),
    frozenset({"NAOCL", "NH3"}):   ("toxic",   "Thuốc tẩy + amoniac tạo khí cloramin — rất độc cho phổi."),
    frozenset({"PB", "H2SO4"}):    ("toxic",   "Pb + H₂SO₄ tạo PbSO₄ và PbO — hợp chất chì rất độc."),
    frozenset({"AS2O3", "H2SO4"}): ("toxic",   "Asen trioxide + H₂SO₄ tạo hơi As — cực độc, gây ung thư."),
    frozenset({"H2S", "O2"}):      ("toxic",   "H₂S là khí rất độc. Thực hiện trong tủ hút có hệ thống thoát khí."),
    frozenset({"HCN", "H2SO4"}):   ("toxic",   "HCN (axit prussic) cực kỳ độc. Không được thực hiện ngoài phòng lab chuyên dụng."),
    frozenset({"SO2", "H2O"}):     ("toxic",   "SO₂ là khí độc, kích ứng đường hô hấp. Thực hiện trong tủ hút."),
    frozenset({"CL2", "H2O"}):     ("toxic",   "Cl₂ là khí cực độc. Chỉ thực hiện trong tủ hút có lọc khí."),
    frozenset({"NO2", "H2O"}):     ("toxic",   "NO₂ là khí độc màu nâu đỏ. Thực hiện trong tủ hút."),
    frozenset({"NH3", "H2SO4"}):   ("toxic",   "Sinh nhiệt lớn và hơi NH₃ — kích ứng mắt, da, phổi mạnh."),

    # ── THẬN TRỌNG (level: caution) ─────────────────────────
    frozenset({"H2SO4", "H2O"}):    ("caution", "KHÔNG đổ nước vào H₂SO₄! Phải đổ từ từ H₂SO₄ vào nước khi pha loãng."),
    frozenset({"NA2CO3", "H2SO4"}): ("caution", "Phản ứng tạo CO₂ mạnh, bình có thể trào. Dùng nồng độ loãng và bình lớn."),
    frozenset({"CACO3", "HCL"}):    ("caution", "Phản ứng nhanh sinh CO₂. Dùng lượng nhỏ, tránh bình kín."),
    frozenset({"ZN", "HCL"}):       ("caution", "Sinh H₂ — dễ cháy. Tránh nguồn lửa gần khu vực thí nghiệm."),
    frozenset({"FE", "HCL"}):       ("caution", "Sinh H₂ — dễ cháy. Thực hiện thoáng khí, tránh nguồn nhiệt."),
    frozenset({"MG", "HCL"}):       ("caution", "Mg phản ứng rất mạnh với HCl, sinh H₂ và nhiệt lớn."),
    frozenset({"H2O2", "KMNO4"}):   ("caution", "H₂O₂ + KMnO₄ phân hủy mạnh, sinh O₂ rất nhanh."),
    frozenset({"CU", "HNO3"}):      ("caution", "Cu + HNO₃ đặc sinh NO₂ — khí độc màu nâu. Thực hiện trong tủ hút."),

    # ── BỔ SUNG: Nguy hiểm thêm (chương trình THPT VN) ──────
    frozenset({"NA2O", "H2O"}):     ("caution", "Na₂O + H₂O phản ứng tỏa nhiệt mạnh tạo NaOH đặc — gây bỏng kiềm."),
    frozenset({"K2O", "H2O"}):      ("caution", "K₂O + H₂O phản ứng tỏa nhiệt rất mạnh tạo KOH — nguy hiểm."),
    frozenset({"CA", "H2O"}):       ("caution", "Ca + H₂O sinh H₂ và Ca(OH)₂ — phản ứng tỏa nhiệt, không cho Ca vào nước lạnh lượng lớn."),
    frozenset({"NA2O2", "H2O"}):    ("danger",  "Na₂O₂ + H₂O tạo NaOH + H₂O₂ và tỏa nhiệt mạnh — H₂O₂ có thể phân hủy bùng cháy."),
    frozenset({"NA2O2", "CO2"}):    ("danger",  "Na₂O₂ + CO₂ sinh O₂ và tỏa nhiệt — có thể kích hoạt cháy nổ nếu có vật liệu dễ cháy."),
    frozenset({"P", "O2"}):         ("caution", "P trắng bốc cháy tự phát trong không khí ở nhiệt độ thường — cực kỳ nguy hiểm, bảo quản trong nước."),
    frozenset({"AL", "NAOH"}):      ("caution", "Al + NaOH + H₂O sinh H₂ — dễ cháy nổ nếu tích tụ trong không gian kín."),
    frozenset({"MG", "CO2"}):       ("danger",  "Mg cháy trong CO₂ — KHÔNG dùng CO₂ để dập cháy Mg. Phản ứng rất mãnh liệt."),
    frozenset({"MG", "H2O"}):       ("caution", "Mg cháy trong hơi nước ở nhiệt độ cao — sinh H₂ và tỏa nhiệt lớn."),
    frozenset({"BR2", "NH3"}):      ("danger",  "Br₂ + NH₃ tạo NBr₃ — chất nổ rất nhạy, cực kỳ nguy hiểm."),
    frozenset({"HF", "SIO2"}):      ("toxic",   "HF ăn mòn thủy tinh (SiO₂) — KHÔNG đựng HF trong bình thủy tinh. Gây bỏng sâu không đau."),
    frozenset({"C2H5OH", "K2CR2O7"}): ("toxic", "Ethanol + K₂Cr₂O₇/H₂SO₄ (hỗn hợp oxy hóa mạnh) — tạo hơi độc, thực hiện trong tủ hút."),
    frozenset({"ACETONE", "H2O2"}): ("danger",  "Acetone + H₂O₂ đặc tạo acetone peroxide — chất nổ sơ cấp cực nhạy, TUYỆT ĐỐI không pha trộn."),
    frozenset({"KMNO4", "C2H5OH"}): ("danger",  "KMnO₄ + ethanol phản ứng mãnh liệt, có thể bốc cháy tức thì."),
    frozenset({"KMNO4", "GLYCERIN"}): ("danger", "KMnO₄ + glycerin tự bốc cháy — phản ứng dùng để mồi lửa, rất nguy hiểm ngoài phòng lab."),
    frozenset({"FE3O4", "AL"}):     ("danger",  "Phản ứng nhiệt nhôm — tỏa nhiệt cực lớn (~3000°C), kim loại lỏng bắn ra. Chỉ thực hiện ngoài trời, cách xa người."),
    frozenset({"FE2O3", "AL"}):     ("danger",  "Phản ứng nhiệt nhôm — tỏa nhiệt cực lớn (~2500°C), nguy hiểm cao, phải có biện pháp bảo hộ đặc biệt."),
    frozenset({"CRO3", "C2H5OH"}):  ("danger",  "CrO₃ + ethanol bốc cháy tức thì — CrO₃ là chất oxy hóa cực mạnh, rất độc."),
    frozenset({"H2SO4", "SUGAR"}):  ("caution", "H₂SO₄ đặc + đường: phản ứng carbon hóa mạnh, tỏa nhiệt lớn và bắn axit."),
}

# ============================================================
#  CATALYST DATABASE — điều kiện phản ứng phổ biến THPT VN
#  Key: frozenset({chất tham gia đã chuẩn hóa HOA})
#  Value: {catalyst, conditions, note}
# ============================================================
CATALYST_DB: dict = {
    frozenset({"H2O2"}):              {"catalyst": "MnO₂", "conditions": ["MnO₂"]},
    frozenset({"KCLO3"}):             {"catalyst": "MnO₂", "conditions": ["MnO₂", "t°"]},
    frozenset({"N2", "H2"}):          {"catalyst": "Fe", "conditions": ["Fe", "450–500°C", "200 atm"]},
    frozenset({"SO2", "O2"}):         {"catalyst": "V₂O₅", "conditions": ["V₂O₅", "450°C"]},
    frozenset({"NH3", "O2"}):         {"catalyst": "Pt", "conditions": ["Pt", "850°C"]},
    frozenset({"C2H5OH", "CH3COOH"}): {"catalyst": "H₂SO₄ đặc", "conditions": ["H₂SO₄ đặc", "t°"]},
    frozenset({"CH3OH", "CH3COOH"}):  {"catalyst": "H₂SO₄ đặc", "conditions": ["H₂SO₄ đặc", "t°"]},
    frozenset({"C6H12O6"}):           {"catalyst": "enzym", "conditions": ["enzym", "30–35°C"]},
    frozenset({"CACO3"}):             {"catalyst": None, "conditions": ["t° > 900°C"]},
    frozenset({"CASO4"}):             {"catalyst": None, "conditions": ["t°"]},
    frozenset({"FE2O3", "H2"}):       {"catalyst": None, "conditions": ["t°"]},
    frozenset({"FE", "O2"}):          {"catalyst": None, "conditions": ["t°"]},
    frozenset({"C", "O2"}):           {"catalyst": None, "conditions": ["t°"]},
    frozenset({"S", "O2"}):           {"catalyst": None, "conditions": ["t°"]},
    frozenset({"CH4", "CL2"}):        {"catalyst": None, "conditions": ["ánh sáng"]},
    frozenset({"H2", "O2"}):          {"catalyst": None, "conditions": ["tia lửa điện / t°"]},
    frozenset({"H2", "CL2"}):         {"catalyst": None, "conditions": ["ánh sáng"]},
    frozenset({"C2H4", "H2"}):        {"catalyst": "Ni", "conditions": ["Ni", "t°"]},
    frozenset({"C2H2", "H2"}):        {"catalyst": "Pd/PbCO3", "conditions": ["Pd/PbCO₃", "t°"]},
    frozenset({"MNO2", "HCL"}):       {"catalyst": None, "conditions": ["t°"]},
    frozenset({"KMNO4"}):             {"catalyst": None, "conditions": ["t°"]},
    frozenset({"NA", "H2O"}):         {"catalyst": None, "conditions": ["nhiệt độ thường"]},
    frozenset({"NAOH", "CO2"}):       {"catalyst": None, "conditions": ["nhiệt độ thường"]},
}

# ============================================================
#  MOL RATIO VARIANTS — sản phẩm thay đổi theo tỉ lệ mol
#  Các phản ứng quan trọng nhất trong chương trình THPT VN
# ============================================================
MOL_RATIO_VARIANTS: dict = {
    frozenset({"C", "O2"}): [
        {
            "condition": "O₂ dư — đốt cháy hoàn toàn",
            "ratio_rule": "n(O₂)/n(C) ≥ 1",
            "equation": "C + O₂ → CO₂",
            "products": ["CO2"],
            "note": "Đốt cháy hoàn toàn. CO₂ là khí không màu, không độc."
        },
        {
            "condition": "O₂ thiếu — đốt cháy không hoàn toàn",
            "ratio_rule": "n(O₂)/n(C) < 1",
            "equation": "2C + O₂ → 2CO",
            "products": ["CO"],
            "note": "⚠️ CO là khí không màu, rất độc, gây ngạt."
        }
    ],
    frozenset({"CO2", "NAOH"}): [
        {
            "condition": "NaOH dư — n(NaOH)/n(CO₂) ≥ 2",
            "ratio_rule": "n(NaOH)/n(CO₂) ≥ 2",
            "equation": "CO₂ + 2NaOH → Na₂CO₃ + H₂O",
            "products": ["Na2CO3", "H2O"],
            "note": "Tạo muối trung tính Na₂CO₃."
        },
        {
            "condition": "NaOH vừa đủ — 1 < n(NaOH)/n(CO₂) < 2",
            "ratio_rule": "1 < n(NaOH)/n(CO₂) < 2",
            "equation": "CO₂ + NaOH → NaHCO₃ (và CO₂ + 2NaOH → Na₂CO₃ + H₂O)",
            "products": ["Na2CO3", "NaHCO3"],
            "note": "Tạo hỗn hợp 2 muối: Na₂CO₃ và NaHCO₃."
        },
        {
            "condition": "NaOH thiếu — n(NaOH)/n(CO₂) ≤ 1",
            "ratio_rule": "n(NaOH)/n(CO₂) ≤ 1",
            "equation": "CO₂ + NaOH → NaHCO₃",
            "products": ["NaHCO3"],
            "note": "Tạo muối axit NaHCO₃."
        }
    ],
    frozenset({"FE", "HNO3"}): [
        {
            "condition": "Fe thiếu / HNO₃ dư",
            "ratio_rule": "n(Fe)/n(HNO₃) nhỏ",
            "equation": "Fe + 4HNO₃ loãng → Fe(NO₃)₃ + NO↑ + 2H₂O",
            "products": ["Fe(NO3)3", "NO", "H2O"],
            "note": "Fe bị oxi hóa lên +3. Sản phẩm Fe(NO₃)₃ (màu vàng nâu)."
        },
        {
            "condition": "Fe dư / HNO₃ thiếu",
            "ratio_rule": "n(Fe)/n(HNO₃) lớn",
            "equation": "3Fe + 8HNO₃ loãng → 3Fe(NO₃)₂ + 2NO↑ + 4H₂O (Fe dư khử Fe³⁺ → Fe²⁺)",
            "products": ["Fe(NO3)2", "NO", "H2O"],
            "note": "Fe dư khử Fe³⁺ về Fe²⁺. Sản phẩm cuối là Fe(NO₃)₂."
        }
    ],
    frozenset({"NA", "O2"}): [
        {
            "condition": "O₂ vừa đủ / thiếu — điều kiện thường",
            "ratio_rule": "đốt Na trong không khí",
            "equation": "4Na + O₂ → 2Na₂O",
            "products": ["Na2O"],
            "note": "Tạo Na₂O — oxit bazơ, tan ngay trong nước."
        },
        {
            "condition": "O₂ dư — đốt Na trong oxi nguyên chất",
            "ratio_rule": "đốt trong bình O₂ dư",
            "equation": "2Na + O₂ → Na₂O₂",
            "products": ["Na2O2"],
            "note": "⚠️ Na₂O₂ (natri peroxit) phản ứng mãnh liệt với H₂O và CO₂."
        }
    ],
    frozenset({"FE", "HCL"}): [
        {
            "condition": "HCl loãng, điều kiện thường",
            "ratio_rule": "luôn tạo FeCl₂",
            "equation": "Fe + 2HCl → FeCl₂ + H₂↑",
            "products": ["FeCl2", "H2"],
            "note": "HCl loãng chỉ oxi hóa Fe lên +2, không lên +3."
        }
    ],
    frozenset({"AL", "NAOH"}): [
        {
            "condition": "NaOH dư — Al tan hết",
            "ratio_rule": "n(NaOH)/n(Al) ≥ 1",
            "equation": "2Al + 2NaOH + 2H₂O → 2NaAlO₂ + 3H₂↑",
            "products": ["NaAlO2", "H2"],
            "note": "Al tan hoàn toàn trong kiềm. H₂ sinh ra dễ bắt lửa."
        },
        {
            "condition": "Al dư / NaOH thiếu — tính theo NaOH",
            "ratio_rule": "n(NaOH)/n(Al) < 1",
            "equation": "2Al + 2NaOH + 2H₂O → 2NaAlO₂ + 3H₂↑ (NaOH hết trước, Al còn dư)",
            "products": ["NaAlO2", "H2"],
            "note": "Lượng sản phẩm tính theo NaOH (chất hết)."
        }
    ],
    frozenset({"CO2", "CA(OH)2"}): [
        {
            "condition": "Ca(OH)₂ dư — n(Ca(OH)₂)/n(CO₂) ≥ 1",
            "ratio_rule": "n(CO₂)/n(Ca(OH)₂) ≤ 1",
            "equation": "CO₂ + Ca(OH)₂ → CaCO₃↓ + H₂O",
            "products": ["CaCO3", "H2O"],
            "note": "Tạo kết tủa trắng CaCO₃."
        },
        {
            "condition": "CO₂ dư — n(CO₂)/n(Ca(OH)₂) > 1",
            "ratio_rule": "n(CO₂)/n(Ca(OH)₂) > 1",
            "equation": "CO₂ + Ca(OH)₂ → CaCO₃↓ + H₂O → (CO₂ dư) CaCO₃ + CO₂ + H₂O → Ca(HCO₃)₂",
            "products": ["Ca(HCO3)2"],
            "note": "Kết tủa CaCO₃ tan dần trong CO₂ dư, tạo Ca(HCO₃)₂ tan."
        }
    ],
    frozenset({"CU", "HNO3"}): [
        {
            "condition": "HNO₃ đặc — mọi tỉ lệ",
            "ratio_rule": "HNO₃ đặc",
            "equation": "Cu + 4HNO₃ đặc → Cu(NO₃)₂ + 2NO₂↑ + 2H₂O",
            "products": ["Cu(NO3)2", "NO2", "H2O"],
            "note": "⚠️ NO₂ là khí màu nâu đỏ, rất độc."
        },
        {
            "condition": "HNO₃ loãng — mọi tỉ lệ",
            "ratio_rule": "HNO₃ loãng",
            "equation": "3Cu + 8HNO₃ loãng → 3Cu(NO₃)₂ + 2NO↑ + 4H₂O",
            "products": ["Cu(NO3)2", "NO", "H2O"],
            "note": "NO là khí không màu, ít độc hơn NO₂."
        }
    ],
}

def _enrich_catalyst(reactants: list, ai_catalyst: str, ai_conditions: list) -> dict:
    """Bổ sung catalyst từ CATALYST_DB nếu AI bỏ sót."""
    key = frozenset(_normalize_formula(r) for r in reactants)
    db_entry = CATALYST_DB.get(key)
    # AI đôi khi trả chuỗi "null"/"none" thay vì null thật
    if isinstance(ai_catalyst, str) and ai_catalyst.strip().lower() in ("null", "none", ""):
        ai_catalyst = None
    catalyst   = ai_catalyst or (db_entry["catalyst"] if db_entry else None) or None
    conditions = ai_conditions or (db_entry["conditions"] if db_entry else []) or []
    return {"catalyst": catalyst, "conditions": conditions}

def _enrich_mol_variants(reactants: list, ai_variants: list) -> list:
    """Bổ sung mol_variants từ MOL_RATIO_VARIANTS nếu AI bỏ sót."""
    if ai_variants:  # AI đã trả về — ưu tiên dùng
        return ai_variants
    key = frozenset(_normalize_formula(r) for r in reactants)
    return MOL_RATIO_VARIANTS.get(key, [])

def _normalize_formula(formula: str) -> str:
    """Chuẩn hóa công thức hóa học để tra cứu Safety DB và tính toán tỉ lượng."""
    if not formula:
        return ""
    import re
    cleaned = (formula
        .upper()
        .replace(" ", "")
        .replace("↓", "").replace("↑", "")
        .replace("(AQ)", "").replace("(S)", "").replace("(L)", "").replace("(G)", "")
        .replace("(ĐẶC)", "").replace("(LOÃNG)", "")
    )
    # Loại bỏ hệ số đầu nếu còn sót (ví dụ "2H2O" -> "H2O")
    m = re.match(r'^\d*(.*)$', cleaned)
    return m.group(1) if m else cleaned


# Bảng khối lượng mol nguyên tử chuẩn SGK THPT (g/mol)
ATOMIC_MASS: dict = {
    "H": 1.0, "HE": 4.0, "LI": 7.0, "BE": 9.0, "B": 11.0, "C": 12.0, "N": 14.0, "O": 16.0,
    "F": 19.0, "NE": 20.0, "NA": 23.0, "MG": 24.0, "AL": 27.0, "SI": 28.0, "P": 31.0, "S": 32.0,
    "CL": 35.5, "AR": 40.0, "K": 39.0, "CA": 40.0, "SC": 45.0, "TI": 48.0, "V": 51.0, "CR": 52.0,
    "MN": 55.0, "FE": 56.0, "CO": 59.0, "NI": 58.7, "CU": 64.0, "ZN": 65.0, "GA": 70.0, "GE": 73.0,
    "AS": 75.0, "SE": 79.0, "BR": 80.0, "KR": 84.0, "RB": 85.5, "SR": 87.6, "AG": 108.0, "CD": 112.4,
    "SN": 119.0, "SB": 122.0, "I": 127.0, "BA": 137.0, "PT": 195.0, "AU": 197.0, "HG": 200.6, "PB": 207.0
}


def parse_molar_mass(formula: str) -> float:
    """Tính chính xác khối lượng mol (g/mol) có hỗ trợ nhóm ngoặc đơn như Ca(OH)2, Al2(SO4)3."""
    import re
    if not formula:
        return 0.0

    # Làm sạch cơ bản nhưng giữ nguyên hoa thường nếu có
    clean_f = formula.strip().replace(" ", "").replace("↓", "").replace("↑", "")
    for st in ["(aq)", "(AQ)", "(s)", "(S)", "(l)", "(L)", "(g)", "(G)", "(đặc)", "(loãng)", "(ĐẶC)", "(LOÃNG)"]:
        clean_f = clean_f.replace(st, "")

    # Bỏ hệ số đầu (vd "2AlCl3" -> "AlCl3")
    m_lead = re.match(r'^\d*(.*)$', clean_f)
    fm = m_lead.group(1) if m_lead else clean_f

    # Khử ngoặc đơn đệ quy từ trong ra ngoài: ví dụ (OH)2 -> O2H2; (SO4)3 -> S3O12
    safety_loop = 0
    while '(' in fm and ')' in fm and safety_loop < 10:
        safety_loop += 1
        match = re.search(r'\(([^()]+)\)(\d*)', fm)
        if not match:
            break
        inner, mult_str = match.group(1), match.group(2)
        mult = int(mult_str) if mult_str else 1
        # Tokenize phần bên trong ngoặc
        expanded = ""
        for elem, cnt in _tokenize_chemical_formula(inner):
            c = cnt * mult
            expanded += f"{elem}{c if c > 1 else ''}"
        fm = fm[:match.start()] + expanded + fm[match.end():]

    total = 0.0
    for elem, cnt in _tokenize_chemical_formula(fm):
        mass = ATOMIC_MASS.get(elem.upper(), 0.0)
        total += mass * cnt
    return round(total, 2) if total > 0 else 1.0


def _tokenize_chemical_formula(fm: str) -> list:
    """Bóc tách nguyên tố và số nguyên tử, nhận dạng chuẩn cả Casing và ALL-CAPS."""
    TWO_LETTER = {'HE', 'LI', 'BE', 'NE', 'NA', 'MG', 'AL', 'SI', 'CL', 'AR', 'CA', 'SC', 'TI', 'CR', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'GA', 'GE', 'AS', 'SE', 'BR', 'KR', 'RB', 'SR', 'AG', 'CD', 'SN', 'SB', 'BA', 'PT', 'AU', 'HG', 'PB'}
    ONE_LETTER = {'H', 'B', 'C', 'N', 'O', 'F', 'P', 'S', 'K', 'V', 'I', 'W', 'U'}
    tokens = []
    i = 0
    n = len(fm)
    while i < n:
        elem = None
        # Ưu tiên 1: Titlecase chuẩn (ví dụ Ca, Fe, Al, Cl, Ba)
        if i + 1 < n and fm[i].isupper() and fm[i+1].islower() and fm[i:i+2].upper() in TWO_LETTER:
            elem = fm[i:i+2].upper()
            i += 2
        # Ưu tiên 2: Cặp 2 ký tự hoa không gây nhập nhằng (NA, AL, CL, FE, CA, BA, CU, ZN, MG, MN, AG, PB, BR, LI)
        elif i + 1 < n and fm[i:i+2].upper() in {'NA', 'AL', 'CL', 'FE', 'CA', 'BA', 'CU', 'ZN', 'AG', 'PB', 'MG', 'MN', 'BR', 'LI'}:
            elem = fm[i:i+2].upper()
            i += 2
        # Ưu tiên 3: 1 ký tự đơn (H, C, N, O, P, S, K...)
        elif fm[i].upper() in ONE_LETTER:
            elem = fm[i].upper()
            i += 1
        # Ưu tiên 4: 2 ký tự hoa còn lại trong bảng tuần hoàn
        elif i + 1 < n and fm[i:i+2].upper() in TWO_LETTER:
            elem = fm[i:i+2].upper()
            i += 2
        else:
            i += 1
            continue

        count_str = ''
        while i < n and fm[i].isdigit():
            count_str += fm[i]
            i += 1
        cnt = int(count_str) if count_str else 1
        tokens.append((elem, cnt))
    return tokens


def _extract_equation_coeffs(equation: str) -> dict:
    """Bóc tách hệ số cân bằng tỉ lượng của các chất từ phương trình hóa học."""
    import re
    coeffs = {}
    if not equation:
        return coeffs
    # Chuẩn hóa mũi tên và bỏ chú thích nhiệt độ xúc tác trên mũi tên
    clean_eq = re.sub(r'→\([^)]*\)|->\([^)]*\)', '→', equation)
    parts = re.split(r'→|->|=', clean_eq)
    for part in parts:
        terms = part.split('+')
        for t in terms:
            t = t.strip()
            if not t:
                continue
            # Bóc tách hệ số phía trước (vd "2H2" -> 2.0, "H2"; "1/2O2" -> 0.5)
            m = re.match(r'^(\d+(?:\.\d+)?|\d+/\d+)?\s*([A-Za-z0-9\(\)↓↑\[\]\.]+)', t)
            if m:
                coeff_str, formula = m.group(1), m.group(2)
                coeff = 1.0
                if coeff_str:
                    if '/' in coeff_str:
                        num, den = coeff_str.split('/')
                        coeff = float(num) / float(den)
                    else:
                        coeff = float(coeff_str)
                norm_f = _normalize_formula(formula)
                if norm_f:
                    coeffs[norm_f] = coeff
    return coeffs


def _calculate_mol_products(reactants: list, products: list, mol_input: dict, equation: str = "") -> dict:
    """
    Tính toán chất dư/hết và khối lượng sản phẩm chuẩn xác theo tỉ lượng phương trình hóa học (Stoichiometry Engine).
    mol_input: {"H2": 2.0, "O2": 1.5}
    """
    result = {"excess": [], "depleted": [], "product_masses": {}, "limiting": None, "note": ""}
    if not mol_input:
        return result

    try:
        coeffs = _extract_equation_coeffs(equation)
        normalized_inputs = {_normalize_formula(k): float(v) for k, v in mol_input.items() if float(v) > 0}
        if not normalized_inputs:
            return result

        # Tính tỉ số mol / hệ số (n_i / a_i) để tìm chất phản ứng hết (limiting reagent)
        ratios = {}
        for r_norm, mol_val in normalized_inputs.items():
            coeff = coeffs.get(r_norm, 1.0)
            ratios[r_norm] = mol_val / coeff

        # Chất hết là chất có tỉ số n / a nhỏ nhất
        min_ratio = min(ratios.values())
        depleted_list = [r for r, val in ratios.items() if abs(val - min_ratio) < 1e-6]
        limiting_r = depleted_list[0]

        result["limiting"] = limiting_r
        result["depleted"] = depleted_list
        result["excess"] = [r for r in normalized_inputs if r not in depleted_list]

        # Tính số mol dư của các chất
        excess_details = {}
        for ex in result["excess"]:
            coeff_ex = coeffs.get(ex, 1.0)
            mol_remain = normalized_inputs[ex] - (min_ratio * coeff_ex)
            excess_details[ex] = round(max(0.0, mol_remain), 4)
        result["excess_details"] = excess_details

        # Tính sản phẩm theo tỉ lượng chất hết
        for p in products:
            p_norm = _normalize_formula(p)
            coeff_p = coeffs.get(p_norm, 1.0)
            mol_p = min_ratio * coeff_p
            m_mol = parse_molar_mass(p)
            mass_p = round(mol_p * m_mol, 2)
            result["product_masses"][p] = {
                "mol": round(mol_p, 4),
                "mass_g": mass_p,
                "molar_mass": m_mol
            }

        result["note"] = f"Phản ứng tính theo chất hết: {limiting_r} (tỉ số n/a = {round(min_ratio, 3)})"
    except Exception as e:
        result["note"] = f"Ước tính tỉ lượng: {str(e)[:50]}"

    return result

def check_safety(reactants: list, products: list) -> dict:
    """
    Lớp 1: Kiểm tra an toàn bằng Safety DB hardcoded.
    Trả về dict: {level, reason, pair, is_critical} hoặc {level: "safe"}
    """
    norms = [_normalize_formula(m) for m in reactants + products]

    # Kiểm tra tất cả cặp (reactants × reactants + reactants × products)
    all_mols = [_normalize_formula(m) for m in reactants]
    for i in range(len(all_mols)):
        for j in range(i + 1, len(all_mols)):
            pair = frozenset({all_mols[i], all_mols[j]})
            if pair in _SAFETY_DB:
                level, reason = _SAFETY_DB[pair]
                safe_alt = CRITICAL_SAFE_ALTERNATIVES.get(pair, None)
                return {
                    "level": level, 
                    "reason": reason, 
                    "pair": f"{all_mols[i]} + {all_mols[j]}",
                    "is_critical": (level == "danger"),
                    "critical_safe_alt": safe_alt
                }

    # Kiểm tra sản phẩm độc hại
    toxic_products = {"CL2", "HCN", "H2S", "NO2", "SO2", "NH3", "HOCL", "NCL3", "MN2O7"}
    for p in [_normalize_formula(m) for m in products]:
        if p in toxic_products:
            return {
                "level": "toxic",
                "reason": f"Sản phẩm {p} là chất độc hại. Thực hiện trong tủ hút có hệ thống thoát khí.",
                "pair": p,
                "is_critical": False,
                "critical_safe_alt": None
            }

    return {"level": "safe", "reason": "Phản ứng an toàn trong điều kiện phòng thí nghiệm thông thường.", "is_critical": False, "critical_safe_alt": None}

# ============================================================
#  OLFACTORY & CHEMICAL SOUND DATABASE (ĐA GIÁC QUAN)
# ============================================================
OLFACTORY_DB = {
    "H2S": {"smell": "Mùi trứng thối đặc trưng, kịch độc. Gây tê liệt khứu giác nhanh chóng!", "badge": "toxic", "icon": "🦨", "color": "#7e22ce"},
    "SO2": {"smell": "Mùi hắc nồng, gây cay rát cổ họng và ngạt thở.", "badge": "warning", "icon": "⚠️", "color": "#eab308"},
    "NH3": {"smell": "Mùi khai nồng nặc, làm xanh giấy quỳ tím ẩm.", "badge": "caution", "icon": "👃", "color": "#2563eb"},
    "CL2": {"smell": "Khí màu vàng lục, mùi hắc gắt gây ngạt, phá hủy niêm mạc hô hấp.", "badge": "toxic", "icon": "🧪", "color": "#84cc16"},
    "NO2": {"smell": "Khí màu nâu đỏ, mùi hắc gắt độc hại, kích ứng niêm mạc phổi.", "badge": "danger", "icon": "🔴", "color": "#ea580c"},
    "NO":  {"smell": "Khí không màu, nhanh chóng hóa nâu ngoài không khí thành NO₂ độc.", "badge": "caution", "icon": "💨", "color": "#f97316"},
    "CO":  {"smell": "Khí không màu, không mùi, CỰC KỲ NGUY HIỂM (gây ngạt vô hình).", "badge": "danger", "icon": "☠️", "color": "#dc2626"},
    "H2":  {"smell": "Khí không màu, không mùi, nhẹ nhất trong các khí, dễ bắt cháy nổ.", "badge": "safe", "icon": "💨", "color": "#06b6d4"},
    "O2":  {"smell": "Khí không màu, không mùi, duy trì sự sống và sự cháy.", "badge": "safe", "icon": "💨", "color": "#10b981"},
    "CO2": {"smell": "Khí không màu, không mùi, làm đục nước vôi trong Ca(OH)₂.", "badge": "safe", "icon": "💨", "color": "#64748b"},
    "N2":  {"smell": "Khí không màu, không mùi, trơ ở nhiệt độ thường.", "badge": "safe", "icon": "💨", "color": "#64748b"}
}

CRITICAL_SAFE_ALTERNATIVES = {
    frozenset({"H2SO4", "KMNO4"}): "Thay vì phản ứng tự nổ nguy hiểm này, minh họa tính oxi hóa mạnh của KMnO₄ trong môi trường axit loãng bằng phản ứng FeSO₄ + KMnO₄ + H₂SO₄ loãng (dung dịch mất màu tím, chuyển vàng nhạt an toàn).",
    frozenset({"NA", "H2O"}): "Minh họa kim loại tác dụng với nước an toàn bằng mẩu Canxi (Ca) nhỏ trong cốc nước lớn, hoặc dùng mẩu Na bé bằng hạt gạo có kính bảo vệ che chắn.",
    frozenset({"K", "H2O"}): "Thay bằng phản ứng Canxi (Ca) với nước hoặc quan sát thí nghiệm Kali qua video mô phỏng.",
    frozenset({"KMNO4", "HCL"}): "Thay vì điều chế Clo bằng HCl đặc sinh khí kịch độc, hãy điều chế lượng nhỏ trong tủ hút kín hoặc quan sát qua mô phỏng 3D.",
    frozenset({"FE2O3", "AL"}): "Thay thế phản ứng nhiệt nhôm nguy hiểm bằng phản ứng thế kim loại nhẹ nhàng: thanh nhôm Al nhúng vào dung dịch CuSO₄ (đồng đỏ bám ngoài thanh nhôm).",
    frozenset({"FE3O4", "AL"}): "Thay thế phản ứng nhiệt nhôm bằng phản ứng nhôm tác dụng với dung dịch đồng sunfat CuSO₄ an toàn.",
    frozenset({"ACETONE", "H2O2"}): "Tuyệt đối không pha trộn chất hữu cơ dễ cháy với chất oxi hóa mạnh dạng đậm đặc. Sử dụng mô hình phân tử 3D để học cấu trúc.",
    frozenset({"KMNO4", "GLYCERIN"}): "Quan sát phản ứng tự bốc cháy qua video tư liệu thực nghiệm tiêu chuẩn có bình chữa cháy dự phòng."
}

def _detect_sound_and_olfactory(reactants: list, products: list) -> dict:
    """Xác định hiệu ứng âm thanh (fizz / crackle / liquid_react) và thông tin khứu giác sản phẩm."""
    prod_norm = [_normalize_formula(p) for p in products]
    react_norm = [_normalize_formula(r) for r in reactants]
    
    sound_type = "liquid_react"
    gases = {"H2", "CO2", "SO2", "CL2", "O2", "NO2", "NO", "H2S", "NH3"}
    alkali_metals = {"NA", "K", "LI", "BA", "CA"}
    
    if any(m in react_norm for m in alkali_metals) and any(w in react_norm for w in ["H2O", "H2SO4", "HCL"]):
        sound_type = "crackle"  # Nổ lách tách / phản ứng mãnh liệt
    elif "AL" in react_norm and ("FE2O3" in react_norm or "FE3O4" in react_norm):
        sound_type = "crackle"  # Phản ứng nhiệt nhôm
    elif any(g in prod_norm for g in gases):
        sound_type = "fizz"     # Sủi bọt khí xèo xèo
    else:
        sound_type = "liquid_react"  # Phản ứng dung dịch / trung hòa axit bazơ / kết tủa
        
    olfactory_info = None
    for p in prod_norm:
        if p in OLFACTORY_DB:
            olfactory_info = OLFACTORY_DB[p].copy()
            olfactory_info["gas"] = p
            break
            
    return {"sound_type": sound_type, "olfactory": olfactory_info}



class SuperAgent:
    def preprocess_image(self, img: Image.Image) -> Image.Image:
        """Enhance image for AI recognition: invert dark bg → white bg, increase contrast.
        SPEED: Resize to max 1024px trước khi gửi Gemini — giảm payload ~60-80%.
        """
        from PIL import ImageOps, ImageEnhance, ImageFilter
        # Convert to RGB if needed
        img_rgb = img.convert("RGB")

        # SPEED OPT: Resize xuống tối đa 800px — giảm payload ~40% so với 1024px
        MAX_DIM = 800
        w, h = img_rgb.size
        if max(w, h) > MAX_DIM:
            scale = MAX_DIM / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img_rgb = img_rgb.resize((new_w, new_h), Image.BILINEAR)  # BILINEAR nhanh hơn LANCZOS
            print(f"[PREPROCESS] Resized {w}x{h} → {new_w}x{new_h}")

        # SPEED: Sample 5x5 grid thay vì getdata() toàn bộ ảnh → nhanh hơn ~100x
        w2, h2 = img_rgb.size
        sample_pixels = [
            img_rgb.getpixel((x * w2 // 6, y * h2 // 6))
            for x in range(1, 6) for y in range(1, 6)
        ]
        avg_brightness = sum((r + g + b) // 3 for r, g, b in sample_pixels) / len(sample_pixels)
        print(f"[PREPROCESS] Avg brightness: {avg_brightness:.1f}")

        if avg_brightness < 100:  # Dark background → invert
            img_rgb = ImageOps.invert(img_rgb)
            print("[PREPROCESS] Inverted (dark bg detected)")

        # Increase contrast strongly
        img_rgb = ImageEnhance.Contrast(img_rgb).enhance(2.5)
        # Sharpen
        img_rgb = img_rgb.filter(ImageFilter.SHARPEN)
        # Save debug (only when DEBUG_IMAGES=true in .env)
        if DEBUG_IMAGES:
            img_rgb.save("debug_preprocessed.jpg")
        return img_rgb

    async def process(self, img: Image.Image, send_log) -> dict:
        # Preprocess: invert if dark background, enhance contrast
        enhanced = self.preprocess_image(img)
        await send_log("AI", "Analyzing handwriting...")

        # ══════════════════════════════════════════════════════════════════
        # SPEED OPT: Single-pass prompt — gộp nhận dạng + sư phạm vào 1 lần
        # gọi LLM duy nhất thay vì 2 lần liên tiếp (tiết kiệm ~4-8s latency)
        # ══════════════════════════════════════════════════════════════════
        sys_instr = """You are an expert chemistry and math AI tutor for a Vietnamese whiteboard app. Read handwritten/digital content from the image. Return STRICTLY valid JSON only (no markdown, no backticks).

DOMAIN SELECTION:
- "chemistry_problem": A handwritten or printed chemistry word problem with quantities/units (gam, g, ml, lít, L, mol, M, %) or calculation questions (Tính, Tìm, Khối lượng, Thể tích, Nồng độ, Cho... tác dụng, Hòa tan...).
  Return:
  {
    "domain": "chemistry_problem",
    "transcribed_problem": "<Exact full Vietnamese text of the problem transcribed accurately from handwriting>",
    "topic": "<Problem topic, e.g. Kim loại tác dụng axit, CO₂ tác dụng kiềm>",
    "equation": "<Main chemical equation involved>",
    "reactants": ["A", "B"], "products": ["C", "D"]
  }
- "chemistry": element symbols (Fe,Na,Ca,Cu,Zn,Al,Mg,K,S,Cl,N,C,H,O,P,Ba,Ag,Mn,Br,I,F,Pb,Ni,Co,Cr,Si) + numbers/+/=/→. Convert H20→H2O, C02→CO2, H2S04→H2SO4.
- "math": y=..., f(x)=..., explicit functions
- "geometry": cube, sphere, cylinder, cone, pyramid
- "general": everything else. CRITICAL: letters+numbers+plus/equals = CHEMISTRY, not general.

CHEMISTRY OUTPUT (balance equation, fill all products):
{
  "domain":"chemistry",
  "equation":"<balanced with conditions on arrow, e.g.: 2H₂O₂ →(MnO₂) 2H₂O+O₂↑>",
  "reactants":["A","B"], "products":["C","D"],
  "catalyst":"<MnO₂|Fe|V₂O₅|Pt|Ni|H₂SO₄đặc|ánhsáng|null>",
  "conditions":["<t°>","<200atm>"],
  "pedagogy":{
    "warnings":["<short safety warning, only if the reaction is hazardous; otherwise empty list>"]
  }
}

CATALYST RULES: H₂O₂→MnO₂; KClO₃→MnO₂+t°; N₂+H₂→Fe,450°C,200atm; SO₂+O₂→V₂O₅,450°C; NH₃+O₂→Pt,850°C; CH₄+Cl₂→ánhsáng; H₂+Cl₂→ánhsáng; C₂H₄+H₂→Ni+t°; ester→H₂SO₄đặc+t°; Fe/C/S+O₂→t°.
HYDROXIDES: Cu(OH)₂, Fe(OH)₃, Fe(OH)₂, Al(OH)₃, Zn(OH)₂, Mg(OH)₂, Ca(OH)₂, Ba(OH)₂.
PRECIPITATES: BaSO₄↓(trắng), AgCl↓(trắng), CaCO₃↓(trắng), Cu(OH)₂↓(xanh lam), Fe(OH)₃↓(nâu đỏ), Al(OH)₃↓(trắng keo).
GASES: H₂↑(không màu), CO₂↑(không màu), Cl₂↑(vàng lục độc), SO₂↑(hắc độc), NH₃↑(khai).

MATH: {"domain":"math","core":{"expression":"<JS expr>"},"tutor":{"explanation":"<Vietnamese>"}}
GEOMETRY: {"domain":"geometry","core":{"name":"<shape>"},"tutor":{"explanation":"<Vietnamese>"}}
GENERAL / CONCEPT (Khi người dùng hỏi khái niệm, lý thuyết, giải thích câu hỏi khoa học):
{
  "domain":"concept",
  "title":"<Tên khái niệm chuẩn SGK, vd: Khái niệm Axit (Acid)>",
  "definition":"<Định nghĩa cốt lõi, chuẩn xác theo thuyết Arrhenius & Brønsted-Lowry>",
  "classification":["<Phân loại 1: Axit mạnh/yếu, có oxi/không oxi>","<Phân loại 2>"],
  "properties":["<Tính chất 1: Đổi màu quỳ tím, pH < 7>","<Tính chất 2: Tác dụng kim loại đứng trước H sinh H₂>","<Tính chất 3: Tác dụng bazơ, oxit bazơ, muối>"],
  "examples":["HCl, H₂SO₄, HNO₃ (axit mạnh)","CH₃COOH, H₂CO₃ (axit yếu)"],
  "applications":"<1-2 ứng dụng thực tiễn trong công nghiệp & đời sống>",
  "safety_note":"<Lưu ý an toàn / thực hành: cách pha loãng, bảo hộ>",
  "explanation":"<Tóm tắt súc tích, mạch lạc và sư phạm nhất>"
}
"""
        # SPEED OPT: quality=72 giảm payload ~50% so với q90, vẫn đủ rõ cho OCR
        img_buffer = BytesIO()
        enhanced.save(img_buffer, format="JPEG", quality=72)
        img_bytes_data = img_buffer.getvalue()
        img_part = {"mime_type": "image/jpeg", "data": img_bytes_data}
        result = await call_llm(
            ["This is a handwritten whiteboard image. Read the content carefully and classify it:", img_part],
            sys_instr
        )
        domain = result.get("domain", "general")
        await send_log("AI", f"Domain: {domain}")
        return result

async def solve_chemistry_problem(problem_text: str, send_log) -> dict:
    """
    NLP CHEMISTRY ENGINE — Giải toán hóa học THPT đa bước chuẩn sư phạm:
    NER -> Mol Conversion -> Tỉ lệ T/chất dư hết -> Phương trình -> Lời giải 4 bước + Đa giác quan
    """
    if not problem_text or not problem_text.strip():
        return {"type": "error", "message": "Vui lòng nhập mô tả bài toán!"}

    await send_log("NLPAgent", "🔍 Bóc tách thực thể và điều kiện hóa học...")

    nlp_sys_instr = """Bạn là chuyên gia Hóa học THPT Việt Nam kiêm NLP engine. Nhiệm vụ: phân tích văn bản mô tả bài toán hóa học và giải hoàn chỉnh từng bước.

QUY TRÌNH XỬ LÝ BẮT BUỘC:

BƯỚC 1 — TRÍCH XUẤT THỰC THỂ (NER):
Nhận diện từ văn bản:
- Chất hóa học: tên tiếng Việt (sắt→Fe, natri hiđroxit→NaOH, axit sunfuric→H₂SO₄, khí CO₂, nước vôi→Ca(OH)₂...)
- Số lượng + đơn vị: gam(g), mol, lít(L), mL, M (nồng độ mol/L), % (nồng độ phần trăm)
- Điều kiện: nhiệt độ cao, đun nóng, ánh sáng, xúc tác MnO₂/Fe/Pt/H₂SO₄ đặc, loãng, đặc (đặc/loãng)
- Câu hỏi: tìm khối lượng, thể tích (đktc hoặc 25°C), số mol, nồng độ dung dịch, hiệu suất

BƯỚC 2 — QUY ĐỔI VỀ MOL:
Công thức chuyển đổi:
- n = m/M (khối lượng/khối lượng mol)
- n = V(lít)/22.4 (khí ở đktc 0°C, 1atm)
- n = V(lít)/24.79 (khí ở 25°C, 1atm — ĐIỀU KIỆN TIÊU CHUẨN MỚI)
- n = C(M) × V(L) (dung dịch nồng độ mol)
- n = C%×m_dd/100/M (dung dịch nồng độ %)
Tính M mol từng chất: H=1,C=12,N=14,O=16,Na=23,Mg=24,Al=27,S=32,Cl=35.5,K=39,Ca=40,Fe=56,Cu=64,Zn=65,Ag=108,Ba=137

BƯỚC 3 — XÁC ĐỊNH TỈ LỆ MOL T VÀ CHỌN PHẢN ỨNG:
- CO₂ + NaOH: T = n(NaOH)/n(CO₂)
  + T ≥ 2: CO₂ + 2NaOH → Na₂CO₃ + H₂O
  + 1 < T < 2: tạo 2 muối (NaHCO₃ và Na₂CO₃), lập hệ phương trình
  + T ≤ 1: CO₂ + NaOH → NaHCO₃
- CO₂ + Ca(OH)₂: T = n(CO₂)/n(Ca(OH)₂)
  + T ≤ 1: CO₂ + Ca(OH)₂ → CaCO₃↓ + H₂O
  + T > 1: kết tủa tan một phần, CaCO₃ + CO₂ + H₂O → Ca(HCO₃)₂
- Fe + HNO₃ loãng: xét Fe dư/thiếu
  + Fe thiếu: Fe + 4HNO₃ loãng → Fe(NO₃)₃ + NO↑ + 2H₂O
  + Fe dư: Fe dư khử Fe³⁺ về Fe²⁺ → sản phẩm cuối là Fe(NO₃)₂
- C + O₂: O₂ dư → CO₂; O₂ thiếu → CO
- Na + O₂: thường → Na₂O; O₂ dư → Na₂O₂
- Cu + HNO₃: đặc → NO₂; loãng → NO

BƯỚC 4 — TÍNH TOÁN CHI TIẾT:
Với bài toán tạo 2 muối (1 < T < 2):
  Đặt x = số mol NaHCO₃, y = số mol Na₂CO₃
  → x + y = n(CO₂) ; x + 2y = n(NaOH)
  → Giải hệ: x = 2n(CO₂) - n(NaOH), y = n(NaOH) - n(CO₂)

BƯỚC 5 — KẾT QUẢ CUỐI:
Tính m(sản phẩm) = n × M, V(khí) = n × 22.4(đktc) hoặc × 24.79(25°C)
Xác định chất dư, chất hết.

TRẢ VỀ JSON (không markdown, không backtick):
{
  "entities": [
    {"name": "<tên chất tiếng Việt>", "formula": "<CTHH>", "amount": <số>, "unit": "<g|mol|L|mL|M>", "mol": <số mol đã quy đổi>, "molar_mass": <M g/mol>, "role": "<reactant|solvent|unknown>"}
  ],
  "conditions": ["<điều kiện 1>", "<điều kiện 2>"],
  "question_type": "<khoi_luong|the_tich|so_mol|nong_do|da_dang>",
  "ratio_analysis": {
    "T_name": "<tên tỉ lệ, vd: T = n(NaOH)/n(CO₂)>",
    "T_value": <giá trị số>,
    "T_rule": "<mô tả điều kiện tương ứng>",
    "case": "<TH1|TH2|TH3|...>"
  },
  "steps": [
    {"step": 1, "title": "<Tên bước>", "content": "<nội dung, công thức, phép tính chi tiết>", "result": "<kết quả bước này>"}
  ],
  "reactions": [
    {"equation": "<phương trình cân bằng>", "note": "<ghi chú>"}
  ],
  "final_answer": {
    "products": [
      {"name": "<tên sản phẩm>", "formula": "<CTHH>", "mol": <số mol>, "mass_g": <khối lượng g>, "volume_L_STP": <thể tích lít đktc hoặc null>, "state": "<↓|↑|dung dịch>"}
    ],
    "excess": {"formula": "<chất dư>", "mol": <mol còn dư>},
    "summary": "<kết luận bằng tiếng Việt, súc tích>"
  },
  "equation": "<phương trình chính đã cân bằng>",
  "reactants": ["<CTHH1>", "<CTHH2>"],
  "products_list": ["<CTHH sản phẩm1>", "<CTHH sản phẩm2>"],
  "catalyst": "<chất xúc tác hoặc null>",
  "conditions_arr": ["<điều kiện>"],
  "explanation": "<tóm tắt ngắn gọn bằng tiếng Việt>"
}
"""
    nlp_prompt = f"Phân tích và giải bài toán hóa học sau:\n\n{problem_text.strip()}"

    try:
        await send_log("NLPAgent", "⚙️ Quy đổi mol và xác định tỉ lệ phản ứng...")
        nlp_result = await asyncio.wait_for(
            call_llm([nlp_prompt], nlp_sys_instr),
            timeout=25.0
        )
        await send_log("NLPAgent", "📐 Tính toán chất dư và sản phẩm cuối...")

        reactants = nlp_result.get("reactants", [])
        products_list = nlp_result.get("products_list", [])
        catalyst_info = _enrich_catalyst(
            reactants,
            nlp_result.get("catalyst", None),
            nlp_result.get("conditions_arr", [])
        )
        mol_variants = _enrich_mol_variants(reactants, [])
        sensory = _detect_sound_and_olfactory(reactants, products_list)

        await send_log("NLPAgent", "✅ Giải toán hoàn tất!")
        return {
            "type":           "result_nlp_chemistry",
            "problem_text":   problem_text.strip(),
            "entities":       nlp_result.get("entities", []),
            "conditions":     nlp_result.get("conditions", []),
            "ratio_analysis": nlp_result.get("ratio_analysis", {}),
            "steps":          nlp_result.get("steps", []),
            "reactions":      nlp_result.get("reactions", []),
            "final_answer":   nlp_result.get("final_answer", {}),
            "equation":       nlp_result.get("equation", ""),
            "reactants":      reactants,
            "products":       products_list,
            "catalyst":       catalyst_info["catalyst"],
            "conditions_arr": catalyst_info["conditions"],
            "mol_variants":   mol_variants,
            "explanation":    nlp_result.get("explanation", ""),
            "sound_type":     sensory.get("sound_type", "none"),
            "olfactory":      sensory.get("olfactory", None),
        }
    except asyncio.TimeoutError:
        return {"type": "error", "message": "⏱️ AI xử lý quá lâu. Vui lòng thử lại!"}
    except Exception as e:
        print(f"[NLP ERROR]: {e}")
        return {"type": "error", "message": f"Lỗi phân tích: {str(e)[:100]}"}

class VoiceAssistantAgent:
    async def process(self, text: str, img: Image.Image, send_log) -> dict:
        await send_log("VoiceAgent", "Processing voice command...")
        sys_instr = """You are an AI Voice Assistant and Chemistry/Science Tutor for a smart whiteboard app. 
The user said something via microphone. Your job is to determine their intent.

1. BOARD CONTROL COMMANDS:
- Clear all: {"type": "command", "action": "clear_board", "reply": "Đã xóa toàn bộ bảng"}
- Erase specific part: {"type": "command", "action": "erase_region", "args": {"box": [ymin, xmin, ymax, xmax], "target_text": "..."}, "reply": "Đã xóa phần bạn yêu cầu"}
- Change color: {"type": "command", "action": "change_color", "args": {"color": "#ef4444", "target_type": "...", "target_text": "..."}, "reply": "Đã đổi màu"}
- Add text: {"type": "command", "action": "add_text", "args": {"text": "..."}, "reply": "Đã thêm chữ"}
- Beautify text: {"type": "command", "action": "beautify_text", "reply": "Đang làm đẹp chữ..."}
- Undo: {"type": "command", "action": "undo", "reply": "Đã hoàn tác"}
- Redo: {"type": "command", "action": "redo", "reply": "Đã làm lại"}
- Read aloud (TTS): {"type": "command", "action": "read_text", "reply": "Đang đọc văn bản"} (Use if they say "đọc bài này", "đọc lên")
- Analyze/Solve/Visualize: {"type": "command", "action": "analyze", "reply": "Đang xử lý..."}
- Change tools: {"type": "command", "action": "set_mode", "args": {"mode": "draw" | "lasso" | "erase"}, "reply": "Đã chuyển công cụ"}

2. SCIENCE & CHEMISTRY CONCEPT INQUIRIES (RẤT QUAN TRỌNG):
Khi người dùng hỏi hoặc yêu cầu: "nêu khái niệm...", "khái niệm... là gì", "định nghĩa...", "tính chất của...", "các chất phản ứng với...", "giải thích về...":
BẮT BUỘC trả về type "concept" chuẩn sư phạm THPT, trình bày chỉn chu, khoa học:
{
  "type": "concept",
  "title": "<Tên khái niệm chuẩn SGK, vd: Khái niệm Axit (Acid) / Các chất phản ứng với Axit>",
  "definition": "<Định nghĩa cốt lõi, chuẩn xác và sư phạm nhất>",
  "classification": ["<Phân loại 1>", "<Phân loại 2>"],
  "properties": ["<Tính chất/Đặc điểm 1>", "<Tính chất/Đặc điểm 2>", "<Tính chất/Đặc điểm 3>"],
  "examples": ["<Ví dụ 1 kèm công thức>", "<Ví dụ 2 kèm công thức>"],
  "applications": "<Ứng dụng thực tiễn trong đời sống và sản xuất>",
  "safety_note": "<Lưu ý an toàn thực nghiệm hoặc mẹo học sinh>",
  "reply": "<1 câu ngắn gọn 10-15 từ để AI phát âm thanh qua loa, vd: 'Đã mở bảng khái niệm chi tiết cho bạn trên màn hình.'>"
}

3. GENERAL QUESTIONS:
Nếu là câu hỏi thông thường khác:
{"type": "answer", "title": "<Tiêu đề câu hỏi>", "reply": "<Câu trả lời súc tích>", "explanation": "<Nội dung giải thích chi tiết, gạch đầu dòng rõ ràng>"}

Available colors: #ffffff (trắng), #ef4444 (đỏ), #10b981 (xanh lá), #3b82f6 (xanh dương), #f59e0b (vàng).
Respond STRICTLY in JSON format (without markdown backticks).
"""
        prompt = [f"User said: {text}"]
        if img:
            # FIX: Convert PIL Image sang bytes cho Gemini SDK
            img_buffer = BytesIO()
            img.save(img_buffer, format="JPEG", quality=90)
            img_part = {"mime_type": "image/jpeg", "data": img_buffer.getvalue()}
            prompt.append("Here is the current whiteboard image:")
            prompt.append(img_part)
            
        result = await call_llm(prompt, sys_instr)
        await send_log("VoiceAgent", "Command processed.")
        return result


# --- WORKFLOW ---

@app.on_event("startup")
async def _warmup_llm():
    """SPEED OPT: gọi AI một lần lúc khởi động để mở sẵn kết nối tới Google —
    lần trực quan hóa đầu tiên không phải chờ thêm ~1,5 s thiết lập kết nối."""
    async def run():
        import time
        t = time.time()
        try:
            await call_llm(["ping"], 'Return JSON: {"ok": true}')
            print(f"[WARMUP] Kết nối AI sẵn sàng ({time.time() - t:.1f}s)")
        except Exception as e:
            print(f"[WARMUP] Bỏ qua: {e}")
    asyncio.create_task(run())


@app.websocket("/ws/analyze")
@app.websocket("/ws")
async def websocket_analyze(websocket: WebSocket):
    await websocket.accept()
    
    async def send_log(agent: str, msg: str):
        await websocket.send_json({"type": "log", "agent": agent, "message": msg})
        
    try:
        data = await websocket.receive_text()
        req = json.loads(data)
        action = req.get("action", "auto_analyze")
        
        img = None
        if req.get("image"):
            base64_img = req.get("image", "").split(",")[-1]
            # FIX: Tính kích thước ảnh chính xác — base64 có padding '=' nên cần trừ đi
            MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB
            padding = base64_img.count('=')
            decoded_size = (len(base64_img) * 3) // 4 - padding
            if decoded_size > MAX_IMAGE_BYTES:
                await send_log("System", "Ảnh quá lớn (>10MB). Vui lòng zoom out hoặc dùng lasso để chọn vùng nhỏ hơn.")
                await websocket.close()
                return
            img_bytes = base64.b64decode(base64_img)
            img = Image.open(BytesIO(img_bytes))
            # DEBUG: Save image to see what Gemini sees (only when DEBUG_IMAGES=true in .env)
            if DEBUG_IMAGES:
                img.save("debug_received_image.jpg")
            
        if action == "beautify_text":
            await send_log("AI", "Đang nhận diện chữ viết tay để chuyển thành chữ in...")
            sys_instr = """You are an expert OCR AI specialized in transcribing handwritten Vietnamese and English text, mathematical formulas, chemical reactions, numbers, and notes from whiteboard images.
Read all handwritten strokes clearly and accurately.
Preserve exact line breaks, mathematical symbols, and chemical formulas as written.
Output strictly valid JSON (no markdown, no backticks):
{"text": "<transcribed_text>"}"""
            if img:
                enhanced = SuperAgent().preprocess_image(img)
                img_buffer = BytesIO()
                enhanced.save(img_buffer, format="JPEG", quality=92)
                img_part = {"mime_type": "image/jpeg", "data": img_buffer.getvalue()}
                prompt = ["Transcribe the handwritten text or formulas in this whiteboard image accurately into standard text:", img_part]
            else:
                prompt = ["Transcribe handwritten text."]
            result = await call_llm(prompt, sys_instr)
            text = result.get("text", "")
            if text:
                await send_log("AI", f"✅ Đã nhận diện chữ: {text[:30]}...")
                await websocket.send_json({"type": "result_beautify", "text": text})
            else:
                await websocket.send_json({"type": "result_general", "explanation": "Không nhận diện được chữ viết, vui lòng viết lại rõ hơn."})
                
        elif action == "auto_analyze":
            agent = SuperAgent()
            res = await agent.process(img, send_log)
            domain = res.get("domain", "general")
            core   = res.get("core", {})
            tutor  = res.get("tutor", {})
            
            if domain == "math":
                await websocket.send_json({
                    "type": "result_math",
                    "expression": core.get("expression", ""),
                    "explanation": tutor.get("explanation", "")
                })
            elif domain == "geometry":
                await websocket.send_json({
                    "type": "result_geometry",
                    "name": core.get("name", "cube"),
                    "explanation": tutor.get("explanation", "")
                })
            elif domain == "chemistry":
                reactants = res.get("reactants", [])
                products  = res.get("products",  [])

                # === LAYER 1: Hardcoded Safety DB — không cần AI, không thể bypass ===
                await send_log("SafetyAgent", "Kiểm tra an toàn hóa chất...")
                safety = check_safety(reactants, products)
                level  = safety.get("level", "safe")
                print(f"[SAFETY] Level={level} | Pair={safety.get('pair','N/A')} | {safety.get('reason','')}")

                # === LAYER CATALYST: Bổ sung catalyst/conditions từ hardcode DB ===
                catalyst_info = _enrich_catalyst(
                    reactants,
                    res.get("catalyst", None),
                    res.get("conditions", [])
                )
                catalyst   = catalyst_info["catalyst"]
                conditions = catalyst_info["conditions"]
                print(f"[CATALYST] {catalyst} | {conditions}")

                # === LAYER MOL VARIANTS: Sản phẩm theo tỉ lệ mol ===
                mol_variants = _enrich_mol_variants(reactants, res.get("mol_variants", []))
                print(f"[MOL_VARIANTS] {len(mol_variants)} variant(s)")

                # === LAYER MOL CALC: Tính toán nếu có mol_input từ client ===
                mol_input = req.get("mol_input", {})
                mol_calc = _calculate_mol_products(reactants, products, mol_input, equation=res.get("equation", "")) if mol_input else {}

                # ══════════════════════════════════════════════════════════
                # SPEED OPT: Dùng pedagogy inline từ SuperAgent (single-pass)
                # ══════════════════════════════════════════════════════════
                pedagogy = res.get("pedagogy", {})
                print(f"[PEDAGOGY] Inline fields: {list(pedagogy.keys())}")

                # === MULTI-SENSORY: Âm thanh sủi bọt/nổ và huy hiệu khứu giác ===
                sensory = _detect_sound_and_olfactory(reactants, products)

                # Gửi toàn bộ kết quả 1 lần duy nhất
                await websocket.send_json({
                    "type":         "result_chemistry",
                    "equation":     res.get("equation", ""),
                    "reactants":    reactants,
                    "products":     products,
                    "explanation":  res.get("explanation", ""),
                    "catalyst":     catalyst,
                    "conditions":   conditions,
                    "mol_variants": mol_variants,
                    "mol_calc":     mol_calc,
                    "sound_type":   sensory.get("sound_type", "none"),
                    "olfactory":    sensory.get("olfactory", None),
                    "safety": {
                        "level":               level,
                        "reason":              safety.get("reason", ""),
                        "pair":                safety.get("pair", ""),
                        "is_critical":         safety.get("is_critical", False),
                        "critical_safe_alt":   safety.get("critical_safe_alt", None) or pedagogy.get("safe_alternative", None),
                        "summary":             pedagogy.get("safety_summary", safety.get("reason", "")),
                        "mechanism":           pedagogy.get("mechanism",           ""),
                        "reaction_type_label": pedagogy.get("reaction_type_label", ""),
                        "simulation":          pedagogy.get("simulation",          ""),
                        "warnings":            pedagogy.get("warnings",            []),
                        "safe_alternative":    pedagogy.get("safe_alternative",    None) or safety.get("critical_safe_alt", None),
                        "theory":              pedagogy.get("theory",              ""),
                        "applications":        pedagogy.get("applications",        ""),
                        "student_note":        pedagogy.get("student_note",        ""),
                        "fun_fact":            pedagogy.get("fun_fact",            ""),
                        "_curriculum":         "high_school",
                        "_reaction_type":      pedagogy.get("reaction_type_label", "general"),
                        "_pedagogy_loading":   False,
                    }
                })
            elif domain == "chemistry_problem":
                transcribed = res.get("transcribed_problem") or res.get("text") or res.get("explanation", "")
                await send_log("NLPAgent", f"📝 Nhận diện đề bài viết tay: {transcribed[:60]}...")
                nlp_res = await solve_chemistry_problem(transcribed, send_log)
                nlp_res["is_handwritten"] = True
                await websocket.send_json(nlp_res)
            elif domain == "concept":
                await websocket.send_json({
                    "type": "result_concept",
                    "title": res.get("title", "Khái niệm Khoa học"),
                    "definition": res.get("definition", ""),
                    "classification": res.get("classification", []),
                    "properties": res.get("properties", []),
                    "examples": res.get("examples", []),
                    "applications": res.get("applications", ""),
                    "safety_note": res.get("safety_note", ""),
                    "explanation": res.get("explanation", "")
                })
            else:
                await websocket.send_json({
                    "type": "result_general",
                    "explanation": res.get("explanation", "Không nhận ra được nội dung. Hãy viết rõ hơn và thử lại.")
                })
                
        elif action == "voice_agent":
            text = req.get("text", "")
            agent = VoiceAssistantAgent()
            res = await agent.process(text, img, send_log)
            await websocket.send_json({"type": "result_voice_agent", "data": res})

        elif action == "text_chemistry":
            problem_text = req.get("text", "").strip()
            nlp_res = await solve_chemistry_problem(problem_text, send_log)
            nlp_res["is_handwritten"] = False
            await websocket.send_json(nlp_res)

        elif action == "quiz_generate":
            num_questions = req.get("num_questions", 5)
            await send_log("QuizAgent", f"🎯 Đang phân tích nội dung bảng và tạo {num_questions} câu hỏi chuyên sâu...")
            sys_instr = f"""Bạn là Giáo viên Hóa học THPT Việt Nam giàu kinh nghiệm. Nhiệm vụ: đọc ảnh bảng và tạo đề trắc nghiệm HÓA HỌC chuyên sâu, bám sát nội dung.

BƯỚC 1 — NHẬN DIỆN NỘI DUNG TRÊN BẢNG:
Xác định: phương trình hóa học, công thức các chất, điều kiện phản ứng (nhiệt độ, xúc tác),
ký hiệu kết tủa (↓), khí bay (↑), màu sắc, loại hóa chất (axit, bazơ, muối, oxit, kim loại...).

BƯỚC 2 — TẠO {num_questions} CÂU HỎI THEO CÁC DẠNG SAU:

① NHẬN BIẾT CHẤT: Hỏi tính chất vật lý/hóa học của CHẤT CỤ THỂ trên bảng
   Ví dụ: "HCl là axit mạnh. Khi nhỏ vào quỳ tím, hiện tượng gì xảy ra?"
   Ví dụ: "CuSO₄ khan có màu gì và khi ngậm nước có màu gì?"

② LOẠI PHẢN ỨNG: Phân loại phản ứng trên bảng
   Ví dụ: "Phản ứng Fe + CuSO₄ → FeSO₄ + Cu thuộc loại phản ứng nào?"
   (trao đổi ion, oxi hóa-khử, trung hòa, kết tủa, phân hủy, cộng, thế...)

③ SẢN PHẨM & HIỆN TƯỢNG: Hỏi về sản phẩm, màu sắc, trạng thái, hiện tượng
   Ví dụ: "Khi cho NaOH vào dung dịch CuSO₄, xuất hiện kết tủa màu gì?"
   Ví dụ: "Phản ứng nào tạo ra khí không màu mùi khai?"

④ CÂN BẰNG & TỈ LỆ MOL: Hỏi hệ số, tỉ lệ mol (nếu có phương trình trên bảng)
   Ví dụ: "Trong phản ứng 2KMnO₄ → K₂MnO₄ + MnO₂ + O₂↑, tỉ lệ KMnO₄ : O₂ là?"

⑤ ỨNG DỤNG THỰC TẾ: Hỏi ứng dụng của CHẤT hoặc PHẢN ỨNG trong đời sống/công nghiệp
   Ví dụ: "NaOH được ứng dụng trong công nghiệp nào sau đây?"

⑥ AN TOÀN THÍ NGHIỆM: Hỏi biện pháp an toàn khi làm thí nghiệm với hóa chất trên bảng
   Ví dụ: "Khi pha loãng H₂SO₄ đặc, cần tuân thủ quy tắc nào?"

QUY TẮC BẮT BUỘC:
- TUYỆT ĐỐI KHÔNG BỊA nội dung: nếu ảnh bảng trống, chỉ có nét vẽ nguệch ngoạc, hoặc KHÔNG đọc được công thức/phương trình/khái niệm hóa học rõ ràng → trả về đúng {{"topic": "", "questions": []}}
- Câu hỏi PHẢI nhắc tên chất hoặc phương trình CỤ THỂ trên bảng
- NẾU BẢNG CÓ PHƯƠNG TRÌNH → tối thiểu 3/5 câu phải hỏi về phương trình đó
- 3 đáp án sai phải là "bẫy thường gặp" của học sinh (không ngớ ngẩn)
- Giải thích đáp án: có thể trích dẫn công thức/phương trình liên quan
- Toàn bộ bằng tiếng Việt

Trả về JSON hợp lệ (không markdown, không backtick):
{{
  "topic": "<Tên chủ đề, ví dụ: Phản ứng oxi hóa khử – Fe + CuSO₄>",
  "questions": [
    {{
      "id": 1,
      "category": "<nhận_biết | loại_phản_ứng | sản_phẩm | cân_bằng | ứng_dụng | an_toàn>",
      "question": "<Câu hỏi, nhắc chất/phương trình cụ thể trên bảng>",
      "options": {{
        "A": "<Đáp án A>",
        "B": "<Đáp án B>",
        "C": "<Đáp án C>",
        "D": "<Đáp án D>"
      }},
      "answer": "<A, B, C hoặc D>",
      "explanation": "<Giải thích 1-2 câu, trích dẫn công thức nếu cần>"
    }}
  ]
}}
"""
            if img:
                img_buffer = BytesIO()
                enhanced = SuperAgent().preprocess_image(img)
                enhanced.save(img_buffer, format="JPEG", quality=90)
                img_bytes_data = img_buffer.getvalue()
                img_part = {"mime_type": "image/jpeg", "data": img_bytes_data}
                prompt = [
                    "Đây là ảnh bảng trắng học sinh. Đọc kỹ phương trình hóa học, công thức và chú thích. Tạo câu hỏi trắc nghiệm chuyên sâu HÓA HỌC bám sát nội dung trên bảng:",
                    img_part
                ]
            else:
                await websocket.send_json({"type": "error", "message": "Bảng trắng trống. Hãy viết phương trình hóa học trước khi tạo quiz!"})
                return

            try:
                result = await asyncio.wait_for(
                    call_llm(prompt, sys_instr),
                    timeout=25.0
                )
                questions = result.get("questions", [])
                topic = result.get("topic", "Hóa học")
                if not questions:
                    await websocket.send_json({"type": "error", "message": "Bảng trống hoặc chữ quá mờ. Hãy viết rõ phương trình hóa học và thử lại!"})
                else:
                    await send_log("QuizAgent", f"✅ Đã tạo {len(questions)} câu hỏi chuyên sâu về: {topic}")
                    await websocket.send_json({
                        "type": "result_quiz",
                        "topic": topic,
                        "questions": questions
                    })
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "error", "message": "Hết thời gian tạo quiz. Vui lòng thử lại!"})

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        await send_log("System", f"Error: {str(e)}")
        print(f"Error during WS: {e}")
        await websocket.close()

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    import webbrowser
    import threading

    # Tự động mở giao diện bảng thông minh trên trình duyệt sau 1.5s
    threading.Timer(1.5, lambda: webbrowser.open("http://127.0.0.1:8000")).start()

    print("🚀 Đang khởi động Bảng Trắng Thông Minh AI...")
    print("🌐 Trình duyệt sẽ tự động mở tại: http://127.0.0.1:8000")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
