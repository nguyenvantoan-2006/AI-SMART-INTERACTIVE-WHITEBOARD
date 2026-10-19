"""
chem_tts_module.py — TTS Module cho Bảng Trắng Thông Minh AI Hóa Học
=====================================================================
Backend: FastAPI + edge-tts (Microsoft Neural Voice, miễn phí)

Cách tích hợp vào main.py:
  1. pip install edge-tts
  2. Copy file này vào thư mục dự án (cùng cấp main.py)
  3. Trong main.py, thêm TRƯỚC dòng app.mount("/", ...):
     from chem_tts_module import _register_tts_routes
     _register_tts_routes(app)
"""

import re
import asyncio
import hashlib
from collections import OrderedDict
from typing import AsyncGenerator

# ================================================================
# PHẦN 1: CHUẨN HÓA VĂN BẢN HÓA HỌC (ChemTextNormalizer)
# ================================================================

class ChemTextNormalizer:
    """
    Chuyển văn bản hóa học thô -> văn bản đọc tự nhiên tiếng Việt.
    VD: "H2SO4 + Fe -> FeSO4 + H2 up" 
     -> "axit sunfuric cộng với Fe tạo thành Fe S O bốn và khí hiđrô bay lên"
    """

    # ---- Công thức phổ biến -> tên thông dụng ----
    COMMON_FORMULAS = {
        r'\bH2O\b': 'nước',
        r'\bCO2\b': 'khí cacbonic',
        r'\bO2\b': 'khí oxi',
        r'\bH2\b': 'khí hiđrô',
        r'\bN2\b': 'khí nitơ',
        r'\bCl2\b': 'khí clo',
        r'\bHCl\b': 'axit clohiđric',
        r'\bH2SO4\b': 'axit sunfuric',
        r'\bHNO3\b': 'axit nitric',
        r'\bH3PO4\b': 'axit photphoric',
        r'\bNaOH\b': 'natri hiđroxit',
        r'\bKOH\b': 'kali hiđroxit',
        r'\bCa\(OH\)2\b': 'canxi hiđroxit',
        r'\bNaCl\b': 'natri clorua',
        r'\bCaCO3\b': 'canxi cacbonat',
        r'\bNH3\b': 'amoniac',
        r'\bSO2\b': 'khí sunfurơ',
        r'\bSO3\b': 'lưu huỳnh trioxit',
        r'\bFe2O3\b': 'sắt ba oxit',
        r'\bAl2O3\b': 'nhôm oxit',
        r'\bCuO\b': 'đồng hai oxit',
        r'\bFeO\b': 'sắt hai oxit',
        r'\bMgO\b': 'magie oxit',
        r'\bZnO\b': 'kẽm oxit',
        r'\bAgNO3\b': 'bạc nitrat',
        r'\bBaSO4\b': 'bari sunfat',
        r'\bCuSO4\b': 'đồng hai sunfat',
        r'\bFeCl2\b': 'sắt hai clorua',
        r'\bFeCl3\b': 'sắt ba clorua',
        r'\bFeSO4\b': 'sắt hai sunfat',
        r'\bFe2\(SO4\)3\b': 'sắt ba sunfat',
        r'\bAlCl3\b': 'nhôm clorua',
        r'\bCaCl2\b': 'canxi clorua',
        r'\bNa2SO4\b': 'natri sunfat',
        r'\bNa2CO3\b': 'natri cacbonat',
        r'\bNaHCO3\b': 'natri hiđrocacbonat',
        r'\bKMnO4\b': 'kali pemanganat',
        r'\bMnO2\b': 'mangan đioxit',
    }

    # ---- Ion ----
    ION_PATTERNS = [
        (r'Cu2?\+', 'ion đồng hai dương'),
        (r'Fe3\+', 'ion sắt ba dương'),
        (r'Fe2\+', 'ion sắt hai dương'),
        (r'Zn2?\+', 'ion kẽm hai dương'),
        (r'Al3\+', 'ion nhôm ba dương'),
        (r'Ca2?\+', 'ion canxi hai dương'),
        (r'Mg2?\+', 'ion magie hai dương'),
        (r'Na\+', 'ion natri dương'),
        (r'K\+', 'ion kali dương'),
        (r'Ba2?\+', 'ion bari hai dương'),
        (r'H\+', 'ion hiđrô dương'),
        (r'NH4\+', 'ion amoni dương'),
        (r'Ag\+', 'ion bạc dương'),
        (r'SO4[2²]?[-\u2212]', 'ion sunfat âm'),
        (r'NO3[-\u2212]', 'ion nitrat âm'),
        (r'Cl[-\u2212]', 'ion clorua âm'),
        (r'OH[-\u2212]', 'ion hiđroxit âm'),
        (r'CO3[2²]?[-\u2212]', 'ion cacbonat âm'),
        (r'HCO3[-\u2212]', 'ion hiđrocacbonat âm'),
        (r'PO4[3³]?[-\u2212]', 'ion photphat âm'),
        (r'S[2²]?[-\u2212]', 'ion sunfua âm'),
        (r'Br[-\u2212]', 'ion bromua âm'),
    ]

    # ---- Ký hiệu phương trình ----
    EQUATION_SYMBOLS = [
        (r'[→\-\->]+', ' tạo thành '),
        (r'[⇌⇆]|<->', ' phản ứng thuận nghịch tạo thành '),
        (r'↑', ' bay lên'),
        (r'↓', ' kết tủa'),
    ]

    # ---- Điều kiện phản ứng ----
    REACTION_CONDITIONS = [
        (r'\bxt\b', 'xúc tác'),
        (r'\bt[o°]\b', 'đun nóng'),
        (r'\bxt,\s*to\b', 'có xúc tác và đun nóng'),
        (r'\bP\s*cao\b', 'áp suất cao'),
        (r'\bAS\b|\bás\b', 'ánh sáng'),
        (r'\bđp\b|\bĐP\b', 'điện phân'),
        (r'\bđpnc\b', 'điện phân nóng chảy'),
        (r'\bđpdd\b', 'điện phân dung dịch'),
    ]

    # ---- Đơn vị và số liệu ----
    UNITS = [
        (r'\bmol/l\b', 'mol trên lít'),
        (r'\bg/mol\b', 'gam trên mol'),
        (r'\bml\b', 'mililít'),
        (r'\bkJ/mol\b', 'kilo jun trên mol'),
        (r'°C', ' độ C'),
        (r'\batm\b', 'át mốt phe'),
        (r'\bn\s*=', 'số mol n bằng'),
        (r'\bm\s*=', 'khối lượng bằng'),
        (r'\bV\s*=', 'thể tích bằng'),
        (r'\bC%\b', 'nồng độ phần trăm'),
        (r'\bCM\b', 'nồng độ mol'),
        (r'\bdd\b|\bDd\b', 'dung dịch'),
    ]

    # Subscript unicode -> ASCII
    SUBSCRIPT_MAP = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')
    SUPERSCRIPT_MAP = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻', '0123456789+-')

    NUMBER_WORDS = {
        '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn', '5': 'năm',
        '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín', '10': 'mười'
    }

    def __init__(self, use_common_names: bool = True):
        self.use_common_names = use_common_names
        self._compile()

    def _compile(self):
        self._ions = [(re.compile(p), r) for p, r in self.ION_PATTERNS]
        self._eq = [(re.compile(p), r) for p, r in self.EQUATION_SYMBOLS]
        self._cond = [(re.compile(p), r) for p, r in self.REACTION_CONDITIONS]
        self._units = [(re.compile(p), r) for p, r in self.UNITS]
        if self.use_common_names:
            self._common = [(re.compile(p), r) for p, r in self.COMMON_FORMULAS.items()]

    def normalize(self, text: str) -> str:
        if not text or not text.strip():
            return text

        # 0. Unicode subscript/superscript -> ASCII
        text = text.translate(self.SUBSCRIPT_MAP).translate(self.SUPERSCRIPT_MAP)

        # 1. Ion (trước công thức để tránh conflict)
        for p, r in self._ions:
            text = p.sub(r, text)

        # 2. Điều kiện phản ứng
        for p, r in self._cond:
            text = p.sub(r, text)

        # 3. Công thức phổ biến -> tên thông dụng
        if self.use_common_names:
            for p, r in self._common:
                text = p.sub(r, text)

        # 4. Ký hiệu phương trình
        for p, r in self._eq:
            text = p.sub(r, text)

        # 5. Đơn vị
        for p, r in self._units:
            text = p.sub(r, text)

        # 6. Công thức còn lại: subscript số -> tên số tiếng Việt
        text = self._expand_subscripts(text)

        # 7. Dọn dẹp
        text = re.sub(r'\s{2,}', ' ', text)
        text = re.sub(r',\s*,', ',', text)
        text = re.sub(r'\s+([,.])', r'\1', text)
        return text.strip()

    def _expand_subscripts(self, text: str) -> str:
        """Fe2O3 -> Fe hai O ba"""
        def replacer(m):
            s = m.group(0)
            result = ''
            i = 0
            while i < len(s):
                c = s[i]
                if c.isdigit():
                    num = ''
                    while i < len(s) and s[i].isdigit():
                        num += s[i]; i += 1
                    result += ' ' + self.NUMBER_WORDS.get(num, num)
                else:
                    result += c; i += 1
            return result
        # Chỉ match pattern giống công thức hóa học
        return re.compile(r'[A-Z][a-z]?\d+(?:\([A-Z][a-z\d]+\)\d*)*').sub(replacer, text)


# ================================================================
# PHẦN 2: TÁCH CÂU (SentenceChunker)
# ================================================================

class SentenceChunker:
    def __init__(self, max_chunk_chars: int = 200):
        self.max_chunk_chars = max_chunk_chars

    def chunk(self, text: str) -> list:
        if not text:
            return []

        # Tách câu tại . ! ? ; :
        parts = re.split(r'(?<=[.!?;:])\s+', text)

        chunks = []
        buf = ''
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if len(buf) + len(part) < self.max_chunk_chars:
                buf += (' ' if buf else '') + part
            else:
                if buf:
                    chunks.append(self._make_chunk(buf))
                buf = part
        if buf:
            chunks.append(self._make_chunk(buf))
        return chunks

    def _make_chunk(self, text: str) -> dict:
        is_equation = bool(re.search(r'tạo thành|phản ứng|cộng với|bay lên|kết tủa', text))
        pause = 600 if is_equation else (800 if text[-1:] in '.!?' else 400)
        return {'text': text, 'pause_after_ms': pause, 'is_equation': is_equation}


# ================================================================
# PHẦN 3: CACHE + TTS ENGINE
# ================================================================

class AudioLRUCache:
    def __init__(self, max_size: int = 50):
        self.max_size = max_size
        self._cache: OrderedDict = OrderedDict()

    def _key(self, text: str, voice: str) -> str:
        return hashlib.md5(f"{voice}:{text}".encode()).hexdigest()

    def get(self, text: str, voice: str):
        k = self._key(text, voice)
        if k in self._cache:
            self._cache.move_to_end(k)
            return self._cache[k]
        return None

    def put(self, text: str, voice: str, audio: bytes):
        k = self._key(text, voice)
        if k not in self._cache and len(self._cache) >= self.max_size:
            self._cache.popitem(last=False)
        self._cache[k] = audio
        self._cache.move_to_end(k)


class EdgeTTSEngine:
    VOICES = {
        'female': 'vi-VN-HoaiMyNeural',
        'male':   'vi-VN-NamMinhNeural',
    }

    def __init__(self, voice: str = 'female', rate: str = '-10%'):
        try:
            import edge_tts
            self._edge_tts = edge_tts
        except ImportError:
            raise ImportError("Chạy: pip install edge-tts")
        self.voice_name = self.VOICES.get(voice, self.VOICES['female'])
        self.rate = rate
        self._cache = AudioLRUCache(50)

    async def synthesize(self, text: str) -> bytes:
        cached = self._cache.get(text, self.voice_name)
        if cached:
            return cached

        # Microsoft Edge TTS không chấp nhận ký tự xuống dòng \n thô
        clean_text = " ".join(line.strip() for line in text.splitlines() if line.strip())
        if not clean_text:
            return b""

        for attempt in range(2):
            try:
                comm = self._edge_tts.Communicate(clean_text, self.voice_name, rate=self.rate)
                chunks = []
                async for chunk in comm.stream():
                    if chunk['type'] == 'audio':
                        chunks.append(chunk['data'])
                audio = b''.join(chunks)
                if audio:
                    self._cache.put(text, self.voice_name, audio)
                    return audio
            except Exception as e:
                if attempt == 0:
                    # Dự phòng đổi giọng khác nếu giọng chính bị Microsoft tạm ngắt
                    fallback_voice = self.VOICES['male'] if self.voice_name == self.VOICES['female'] else self.VOICES['female']
                    try:
                        comm = self._edge_tts.Communicate(clean_text, fallback_voice)
                        chunks = []
                        async for chunk in comm.stream():
                            if chunk['type'] == 'audio':
                                chunks.append(chunk['data'])
                        audio = b''.join(chunks)
                        if audio:
                            return audio
                    except Exception:
                        pass
                    await asyncio.sleep(0.2)
                else:
                    raise e
        return b""

    async def synthesize_stream(self, text: str) -> AsyncGenerator:
        clean_text = " ".join(line.strip() for line in text.splitlines() if line.strip())
        comm = self._edge_tts.Communicate(clean_text, self.voice_name, rate=self.rate)
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                yield chunk['data']


# ================================================================
# PHẦN 4: ĐĂNG KÝ ROUTES VÀO FASTAPI APP
# ================================================================

_normalizer = ChemTextNormalizer(use_common_names=True)
_chunker    = SentenceChunker(max_chunk_chars=200)
_engine     = None


def _get_engine():
    global _engine
    if _engine is None:
        try:
            _engine = EdgeTTSEngine(voice='female', rate='-10%')
            print('[TTS] edge-tts sẵn sàng (vi-VN-HoaiMyNeural)')
        except ImportError as e:
            print(f'[TTS] {e}')
    return _engine


def register_tts_routes(app):
    """
    Gọi trong main.py TRƯỚC dòng app.mount('/'):
        from chem_tts_module import register_tts_routes
        register_tts_routes(app)
    """
    from fastapi import Query
    from fastapi.responses import StreamingResponse, Response
    from fastapi import HTTPException

    @app.get('/api/tts')
    async def tts_endpoint(
        text:      str  = Query(...),
        voice:     str  = Query('female'),
        normalize: bool = Query(True),
        smart:     bool = Query(False),
        context:   str  = Query('general'),
    ):
        """Text-to-Speech (edge-tts Neural Voice). Returns audio/mpeg."""
        if not text or not text.strip():
            raise HTTPException(400, 'text rỗng')
        text = text[:2000]

        # Chỉ kích hoạt smart khi normalize=True VÀ smart=True (tránh làm chậm ping healthcheck)
        if smart and normalize:
            processed = await generate_speech_script(text)
        elif normalize:
            processed = _normalizer.normalize(text)
        else:
            processed = text

        engine = _get_engine()
        if engine is None:
            raise HTTPException(503, 'Chạy: pip install edge-tts')

        if voice == 'male':
            engine.voice_name = EdgeTTSEngine.VOICES['male']
        else:
            engine.voice_name = EdgeTTSEngine.VOICES['female']

        try:
            audio = await engine.synthesize(processed)
            if not audio:
                raise HTTPException(500, 'TTS trả về rỗng')
            return Response(
                content=audio,
                media_type='audio/mpeg',
                headers={
                    'Content-Length': str(len(audio)),
                    'Cache-Control': 'public, max-age=3600',
                    'X-Normalized-Text': processed[:120],
                }
            )
        except Exception as e:
            print(f'[TTS ERROR] {e}')
            raise HTTPException(500, str(e)[:200])

    @app.get('/api/tts/stream')
    async def tts_stream(
        text:      str  = Query(...),
        normalize: bool = Query(True),
        smart:     bool = Query(True),
    ):
        """Streaming TTS (latency thấp hơn cho văn bản dài)."""
        text = text[:3000]
        if smart:
            processed = await generate_speech_script(text)
        elif normalize:
            processed = _normalizer.normalize(text)
        else:
            processed = text

        engine = _get_engine()
        if engine is None:
            raise HTTPException(503, 'Chạy: pip install edge-tts')

        async def gen():
            async for chunk in engine.synthesize_stream(processed):
                yield chunk

        return StreamingResponse(gen(), media_type='audio/mpeg')

    @app.get('/api/tts/script')
    async def tts_script(text: str = Query(...)):
        """Tạo kịch bản lời giảng sư phạm Hóa học từng dòng qua Gemini SPEECH_PROMPT."""
        script = await generate_speech_script(text)
        lines = [line.strip() for line in script.splitlines() if line.strip()]
        return {
            'original': text,
            'script':   script,
            'lines':    lines,
            'count':    len(lines),
        }

    @app.get('/api/tts/preview')
    async def tts_preview(text: str = Query(...)):
        """Debug: xem kết quả normalize và chunking (không tạo audio)."""
        normalized = _normalizer.normalize(text)
        chunks = _chunker.chunk(normalized)
        return {
            'original':   text,
            'normalized': normalized,
            'chunks':     chunks,
        }

    print('[TTS] Đã đăng ký: /api/tts | /api/tts/stream | /api/tts/preview | /api/tts/script')


# ================================================================
# PHẦN 5: GEMINI SPEECH-SCRIPT GENERATOR
# ================================================================

SPEECH_PROMPT = """Bạn là một giáo viên Hóa học giàu kinh nghiệm, đang giảng cho học sinh THPT trên bảng trắng.
Nhiệm vụ: Chuyển nội dung được cung cấp thành LỜI NÓI để đọc to bằng giọng đọc tự nhiên (Text-to-Speech), không phải văn bản viết.

CÁC QUY TẮC BẮT BUỘC:
1. QUY TẮC CỨNG VỀ KÝ HIỆU HÓA HỌC:
   Tuyệt đối không để ký hiệu hóa học (Al, HCl, H2SO4, Fe2O3, Cu, Na, Cl2...) trong lời nói.
   Luôn đọc bằng tên chất theo SGK GDPT 2018 (nhôm, axit clohiđric, axit sunfuric, sắt ba oxit, khí hiđro...).
   Nếu chưa có tên thông dụng thì đọc từng chữ cái và chỉ số (ví dụ: F e hai O ba).

2. PHƯƠNG TRÌNH PHẢN ỨNG:
   Phương trình phản ứng đọc theo tỉ lệ mol (hai mol A tác dụng với ba mol B tạo thành...), không đọc theo kiểu nguyên tử hay phân tử.
   Ký hiệu phản ứng: "→" đọc là "tạo thành", "⇌" đọc là "cân bằng với" hoặc "phản ứng thuận nghịch tạo thành", "↑" đọc là "thoát ra" hoặc "bay lên", "↓" đọc là "kết tủa".

3. SỐ LIỆU VÀ ĐẠI LƯỢNG:
   Quy đổi toàn bộ số liệu sang chữ đọc tiếng Việt tự nhiên (2,7 -> "hai phẩy bảy"; 22,4 -> "hai mươi hai phẩy bốn"; 0,1 -> "không phẩy một").
   Đọc đầy đủ đơn vị: mol/l -> "mol trên lít", g/mol -> "gam trên mol", °C -> "độ C", ml -> "mi li lít", g -> "gam", l -> "lít".
   Giữ nguyên 100% tính chính xác của số liệu, không làm tròn sai hoặc bỏ sót số liệu.

4. NHỊP ĐIỆU VÀ PHONG CÁCH SƯ PHẠM:
   Viết như đang nói chuyện trực tiếp với học sinh: câu ngắn đến vừa (8-20 từ), dùng từ nối tự nhiên ("Các em để ý nhé", "Bây giờ", "Như vậy", "Tại sao vậy?", "Các em nhớ nhé...").
   Mỗi câu diễn đạt một ý rõ ràng. Có câu hỏi gợi mở, nhấn mạnh ý chính và chốt kết luận rõ ràng.
   Với đáp án câu hỏi trắc nghiệm/quiz: nói đáp án đúng trước, giải thích ngắn gọn, nhắc nhở lỗi hay gặp.
   Với cảnh báo an toàn thí nghiệm: giọng chậm rãi, nghiêm túc, dứt khoát, rõ ràng.

5. ĐỊNH DẠNG ĐẦU RA:
   Xuất ra DUY NHẤT lời nói, mỗi câu nằm trên một dòng riêng biệt.
   Tuyệt đối không dùng gạch đầu dòng, dấu sao, ngoặc đơn, ngoặc vuông, ký hiệu đặc biệt, không định dạng markdown.
   Không thêm lời chào đầu/kết kiểu tiêu đề hay văn bản giải thích ngoài lề.

VÍ DỤ MẪU (FEW-SHOT):

Ví dụ 1 (Bài toán tính mol):
Đầu vào: Cho 2,7g Al tác dụng vừa đủ với dung dịch HCl. Tính thể tích H2 thoát ra (đktc). 2Al + 6HCl → 2AlCl3 + 3H2↑.
Đầu ra:
Các em để ý bài toán trên bảng nhé.
Chúng ta có hai phẩy bảy gam nhôm, tác dụng vừa đủ với dung dịch axit clohiđric.
Em nào cho thầy biết, đề bài yêu cầu tính đại lượng nào?
Đúng rồi, thể tích khí hiđro thoát ra ở điều kiện tiêu chuẩn.
Trước hết, các em viết phương trình phản ứng nhé.
Hai mol nhôm tác dụng với sáu mol axit clohiđric, tạo thành hai mol nhôm clorua và ba mol khí hiđro thoát ra.
Bây giờ chúng ta tính số mol nhôm.
Lấy khối lượng chia cho khối lượng mol, hai phẩy bảy chia hai mươi bảy, được không phẩy một mol.
Dựa vào phương trình, cứ hai mol nhôm phản ứng thì sinh ra ba mol khí hiđro.
Vậy không phẩy một mol nhôm sẽ sinh ra bao nhiêu mol khí hiđro nào?
Là không phẩy mười lăm mol, các em nhớ chưa?
Cuối cùng, nhân với hai mươi hai phẩy bốn, ta được thể tích là ba phẩy ba mươi sáu lít.
Vậy đáp số là ba phẩy ba mươi sáu lít khí hiđro.

Ví dụ 2 (Câu hỏi quiz trắc nghiệm có đáp án):
Đầu vào: Câu hỏi: Dung dịch nào sau đây làm quỳ tím hóa đỏ? A. NaOH, B. NaCl, C. HCl, D. H2O. Đáp án đúng: C. Giải thích: HCl có tính axit làm quỳ tím hóa đỏ, NaOH làm quỳ hóa xanh.
Đầu ra:
Với câu hỏi trắc nghiệm này, đáp án chính xác là C các em nhé.
Dung dịch axit clohiđric có môi trường axit nên sẽ làm giấy quỳ tím chuyển sang màu đỏ.
Các em lưu ý đừng chọn nhầm sang đáp án A là natri hiđroxit nhé.
Natri hiđroxit là một bazơ mạnh nên sẽ làm quỳ tím hóa xanh chứ không phải hóa đỏ.

Ví dụ 3 (Cảnh báo an toàn thí nghiệm):
Đầu vào: Cảnh báo an toàn: Khi pha loãng axit sunfuric đặc H2SO4, tuyệt đối không được rót nước vào axit vì sẽ gây nổ và bắn axit. Phải rót từ từ axit vào nước và khuấy đều.
Đầu ra:
Các em dừng tay và chú ý quy tắc an toàn quan trọng này nhé.
Axit sunfuric đặc rất háo nước và tỏa ra một lượng nhiệt cực kỳ lớn.
Tuyệt đối không bao giờ được rót nước vào cốc đựng axit sunfuric đặc.
Nước gặp axit sẽ sôi đột ngột và bắn axit ra ngoài gây bỏng rất nguy hiểm.
Quy tắc an toàn bắt buộc là phải rót từ từ axit sunfuric vào nước rồi khuấy nhẹ đều tay.
Các em phải luôn ghi nhớ kỹ điều này khi thực hành thí nghiệm nhé.
"""


def _clean_and_split_speech_lines(raw_text: str) -> list[str]:
    """
    (a) Tách theo dòng, mỗi dòng là một câu.
    (b) Loại bỏ markdown, bullet points, ngoặc đơn/vuông, ký hiệu đặc biệt còn sót.
    """
    if not raw_text:
        return []

    lines = []
    text_clean = re.sub(r'```.*?```', '', raw_text, flags=re.DOTALL)

    for raw_line in text_clean.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r'^(?:đầu ra|lời nói|giáo viên|thầy|cô|bài giảng|kịch bản|transcript)\s*:\s*', '', line, flags=re.IGNORECASE)
        if re.match(r'^(?:đầu ra|lời nói|giáo viên|thầy|cô|bài giảng|kịch bản|transcript|ví dụ\s*\d*)\s*:?$', line, flags=re.IGNORECASE):
            continue
        line = re.sub(r'^(?:[-*•#]+|\d+[\.)])\s+', '', line)
        line = re.sub(r'[*_`~#]', '', line)
        line = re.sub(r'\[.*?\]', '', line)
        line = re.sub(r'\(.*?\)', '', line)
        line = re.sub(r'\s+', ' ', line).strip()
        if not line:
            continue

        # Nếu một dòng chứa nhiều câu, tách tiếp thành từng dòng riêng
        sub_sentences = re.split(r'(?<=[.!?])\s+', line)
        for s in sub_sentences:
            s = s.strip().strip('-–—•')
            if s:
                lines.append(s)

    return lines


_DIGIT_WORDS = {
    '0': 'không', '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn',
    '5': 'năm', '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín'
}


def _int_to_vietnamese(s: str) -> str:
    """Chuyển số nguyên nhỏ sang chữ tiếng Việt cơ bản."""
    try:
        val = int(s)
    except ValueError:
        return " ".join(_DIGIT_WORDS.get(c, c) for c in s)

    if val == 0:
        return 'không'
    if val < 10:
        return _DIGIT_WORDS[str(val)]
    if val == 10:
        return 'mười'
    if val < 20:
        last = 'lăm' if val == 15 else _DIGIT_WORDS[str(val % 10)]
        return f"mười {last}"
    if val < 100:
        chuc = _DIGIT_WORDS[str(val // 10)]
        donvi = val % 10
        if donvi == 0:
            return f"{chuc} mươi"
        elif donvi == 1:
            return f"{chuc} mươi mốt"
        elif donvi == 4:
            return f"{chuc} mươi tư"
        elif donvi == 5:
            return f"{chuc} mươi lăm"
        else:
            return f"{chuc} mươi {_DIGIT_WORDS[str(donvi)]}"
    if val < 1000:
        tram = _DIGIT_WORDS[str(val // 100)]
        du = val % 100
        if du == 0:
            return f"{tram} trăm"
        return f"{tram} trăm {_int_to_vietnamese(str(du))}"
    return str(val)


def _number_to_vietnamese_phrases(num_str: str) -> list[str]:
    """Chuyển một số (vd: '2.7', '22.4', '0.15') thành các biến thể đọc bằng chữ tiếng Việt."""
    normalized_num = num_str.replace(',', '.')
    phrases = [num_str, normalized_num, num_str.replace('.', ',')]

    if '.' in normalized_num:
        parts = normalized_num.split('.', 1)
        int_p, dec_p = parts[0], parts[1]
        int_words = _int_to_vietnamese(int_p)
        dec_digits = " ".join(_DIGIT_WORDS.get(d, d) for d in dec_p)
        phrases.append(f"{int_words} phẩy {dec_digits}".strip())
        
        if len(dec_p) == 2:
            dec_int_words = _int_to_vietnamese(dec_p)
            phrases.append(f"{int_words} phẩy {dec_int_words}".strip())
            if dec_p == '15':
                phrases.append(f"{int_words} phẩy một năm".strip())
                phrases.append(f"{int_words} phẩy mười lăm".strip())
    else:
        phrases.append(_int_to_vietnamese(normalized_num))

    return [p.lower() for p in phrases if p]


def _validate_speech_script(input_text: str, script_lines: list[str]) -> tuple[bool, str]:
    """
    (c) So khớp con số trong đầu vào và lời nói (đã quy đổi sang chữ) để phát hiện số bị sai hoặc thiếu.
    Đồng thời phát hiện các ký hiệu hóa học viết tắt còn sót.
    """
    if not script_lines:
        return False, "Không có câu lời nói nào được tạo ra."

    full_script = " ".join(script_lines).lower()

    # Kiểm tra ký hiệu hóa học còn sót
    raw_symbols = re.findall(r'\b(?:[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*|[A-Z][a-z]?)\b', " ".join(script_lines))
    known_chems = {
        'al', 'hcl', 'h2so4', 'hno3', 'naoh', 'koh', 'fe', 'fe2o3', 'alcl3', 'cu', 'cuo', 
        'agno3', 'baso4', 'nacl', 'caco3', 'h2o', 'co2', 'o2', 'h2', 'n2', 'cl2', 'nh3',
        'so2', 'so3', 'mg', 'mgo', 'zn', 'zno', 'fecl2', 'fecl3', 'feso4', 'fe2(so4)3'
    }
    lingering_chems = [sym for sym in raw_symbols if sym.lower() in known_chems]
    if lingering_chems:
        return False, f"Còn sót ký hiệu hóa học chưa chuyển thành tên chất: {', '.join(set(lingering_chems))}."

    # So khớp các con số độc lập từ đầu vào (nhận diện cả số dính với đơn vị như 2,7g, 22,4l)
    input_numbers = re.findall(r'(?<![A-Za-z])\d+(?:[.,]\d+)?', input_text)
    missing_numbers = []
    for num in input_numbers:
        if '.' in num or ',' in num or (num.isdigit() and int(num) > 2):
            phrases = _number_to_vietnamese_phrases(num)
            found = any(p in full_script for p in phrases)
            if not found:
                missing_numbers.append(num)

    if missing_numbers:
        return False, f"Thiếu hoặc chưa đọc đúng số liệu quan trọng: {', '.join(missing_numbers)}."

    return True, ""


async def generate_speech_script(
    text: str, 
    gemini_model_name: str = 'gemini-flash-lite-latest',
    max_retries: int = 2
) -> str:
    """
    Dùng Gemini tạo kịch bản đọc to tự nhiên cho bài giảng Hóa học.
    - Tách theo dòng, mỗi dòng là một câu (không markdown, không ký hiệu thừa).
    - So khớp số liệu và ký hiệu hóa học.
    - Tự động gọi lại LLM tối đa 2 lần nếu phát hiện lỗi.
    """
    if not text or not text.strip():
        return ""

    try:
        import google.generativeai as genai
        model = genai.GenerativeModel(
            model_name=gemini_model_name,
            system_instruction=SPEECH_PROMPT,
        )

        current_prompt = text
        lines = []

        for attempt in range(max_retries + 1):
            try:
                response = await asyncio.to_thread(model.generate_content, current_prompt)
                raw_script = response.text.strip() if response and response.text else ""
            except Exception as call_err:
                print(f"[SpeechScript] Lỗi gọi Gemini (lần {attempt + 1}): {call_err}")
                break

            lines = _clean_and_split_speech_lines(raw_script)
            is_valid, error_msg = _validate_speech_script(text, lines)

            if is_valid:
                return "\n".join(lines)

            if attempt < max_retries:
                print(f"[SpeechScript] Phát hiện lỗi ở lần {attempt + 1}: {error_msg}. Đang gọi lại LLM...")
                current_prompt = (
                    f"{text}\n\n"
                    f"[YÊU CẦU SỬA LỖI]: Lần trả lời trước bị lỗi: {error_msg}\n"
                    f"Hãy sửa lại: mỗi câu trên 1 dòng riêng, tuyệt đối không dùng ký hiệu hóa học viết tắt "
                    f"(hãy đọc tên chất tiếng Việt), đọc đầy đủ mọi số liệu bằng chữ tiếng Việt, không markdown."
                )

        print("[SpeechScript] Hết lượt thử lại, áp dụng chuẩn hóa cứu cánh.")
        if lines:
            fallback_lines = [_normalizer.normalize(line) for line in lines]
            return "\n".join(fallback_lines)
        return _normalizer.normalize(text)

    except Exception as e:
        print(f'[SpeechScript] Gemini lỗi ngoài dự kiến, dùng normalizer: {e}')
        return _normalizer.normalize(text)


# ================================================================
# UNIT TESTS
# ================================================================

if __name__ == '__main__':
    norm = ChemTextNormalizer(use_common_names=True)
    tests = [
        ('H2O là dung môi phổ biến',          'nước'),
        ('H2SO4 là axit mạnh',                'axit sunfuric'),
        ('Fe + 2HCl → FeCl2 + H2↑',          'tạo thành'),
        ('nồng độ 0.5 mol/l',                 'mol trên lít'),
        ('nhiệt độ phản ứng 80°C',            'độ C'),
        ('xt: MnO2, to: 500°C',               'xúc tác'),
        ('Cu2+ phản ứng với OH-',             'ion đồng hai dương'),
        ('N2 + 3H2 ⇌ 2NH3',                  'phản ứng thuận nghịch'),
        ('khối lượng mol 98 g/mol',           'gam trên mol'),
        ('Fe2(SO4)3 là sắt ba sunfat',        'sắt ba sunfat'),
    ]
    ok = 0
    for inp, exp in tests:
        out = norm.normalize(inp)
        passed = exp.lower() in out.lower()
        print(f"{'OK' if passed else 'FAIL':4} | {inp:<35} | {out[:60]}")
        ok += passed
    print(f'\n{ok}/{len(tests)} tests passed')
