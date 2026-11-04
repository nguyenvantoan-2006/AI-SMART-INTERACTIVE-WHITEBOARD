"""
So sánh độ trễ chế độ "Nhanh" (SuperAgent) và "Phân tích sâu" (agents.py) với Gemini thật.

Chạy:  venv\\Scripts\\python.exe benchmark_agents.py [--repeats 2] [--delay 8] [--ws ws://127.0.0.1:8765/ws/analyze]

- Ảnh: tạo bằng PIL (phương trình trên nền bảng tối) + mọi ảnh .png/.jpg trong benchmark_images/ nếu có.
- Xóa _LLM_RESPONSE_CACHE trước mỗi lượt để không đo nhầm cache (<50ms).
- Giãn các lượt bằng --delay giây để không vượt giới hạn API.
- Mặc định đo trong tiến trình (gọi thẳng SuperAgent / Orchestrator); --ws thì đo qua WebSocket của server đang chạy
  (khi đó server phải tự xóa cache — chỉ dùng để kiểm tra end-to-end, không dùng để lấy số liệu).
"""
import argparse
import asyncio
import base64
import json
import os
import statistics
import sys
import time
from io import BytesIO

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(HERE, "benchmark_images")

# (tên, chữ trên bảng, tình huống)
PIL_CASES = [
    ("pil_al_hcl", "Al + HCl -> AlCl3 + H2", "đủ 2 vế → Solver cân bằng bằng Python"),
    ("pil_fe_cuso4", "Fe + CuSO4 ->", "thiếu sản phẩm → Solver gọi AI"),
    ("pil_fe_hcl_sai", "Fe + HCl -> FeCl3 + H2", "sai sản phẩm → Verifier gửi lỗi lại Solver"),
]


def make_board_image(text: str) -> Image.Image:
    img = Image.new("RGB", (900, 260), (22, 32, 46))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 64)
    except OSError:
        font = ImageFont.load_default()
    draw.text((40, 90), text, fill=(240, 240, 240), font=font)
    return img


def load_cases():
    cases = [(name, make_board_image(text), note) for name, text, note in PIL_CASES]
    if os.path.isdir(IMG_DIR):
        for fn in sorted(os.listdir(IMG_DIR)):
            if fn.lower().endswith((".png", ".jpg", ".jpeg")):
                cases.append((f"viet_tay/{fn}", Image.open(os.path.join(IMG_DIR, fn)).convert("RGB"), "ảnh viết tay"))
    return cases


class Recorder:
    """Giả lập websocket: ghi lại thời điểm nhận từng loại message."""

    def __init__(self):
        self.t0 = time.perf_counter()
        self.events = {}
        self.final = None

    async def send_json(self, msg):
        self.events.setdefault(msg.get("type"), time.perf_counter() - self.t0)
        if msg.get("type") == "result_chemistry":
            self.final = msg
        if msg.get("type") == "agent_done":
            self.timing = msg.get("timing")

    async def send_log(self, agent, message):
        pass


async def run_fast(M, img):
    rec = Recorder()
    res = await M.SuperAgent().process(img, rec.send_log)
    t = time.perf_counter() - rec.t0
    return {"first": t, "total": t, "ai_calls": 1, "equation": res.get("equation") or res.get("domain")}


async def run_deep(M, img):
    from agents import Orchestrator
    rec = Recorder()
    orch = Orchestrator(rec.send_json, rec.send_log)
    res = await orch.run(img, {})
    total = time.perf_counter() - rec.t0
    if res is not None:   # không phải hóa học
        return {"first": total, "total": total, "ai_calls": 1, "equation": res.get("domain")}
    timing = getattr(rec, "timing", {}) or {}
    return {
        "first": rec.events.get("result_chemistry", total),
        "tutor": rec.events.get("result_agent_tutor"),
        "quiz": rec.events.get("result_agent_quiz"),
        "total": total,
        "ai_calls": timing.get("ai_calls", 0),
        "agents": {a["agent"]: a["ms"] for a in timing.get("agents", [])},
        "equation": (rec.final or {}).get("equation"),
        "verified": ((rec.final or {}).get("verification") or {}).get("ok"),
        "fix_rounds": ((rec.final or {}).get("verification") or {}).get("fix_rounds"),
    }


async def run_ws(url, img, mode):
    import websockets
    buf = BytesIO()
    img.save(buf, format="PNG")
    payload = {"action": "auto_analyze", "mode": mode,
               "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}
    t0 = time.perf_counter()
    events = {}
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps(payload))
        try:
            async for raw in ws:
                msg = json.loads(raw)
                if msg["type"] == "log":
                    print(f"      [{msg['agent']}] {msg['message']}")
                    continue
                events.setdefault(msg["type"], time.perf_counter() - t0)
                print(f"   ← {msg['type']} @ {events[msg['type']]:.2f}s")
                if mode == "fast" or msg["type"] in ("agent_done", "error") or not msg["type"].startswith(("result_chem", "result_agent")):
                    break
        except websockets.ConnectionClosed:
            pass
    return events


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--delay", type=float, default=8.0, help="giây nghỉ giữa các lượt (tránh giới hạn API)")
    ap.add_argument("--ws", default="", help="URL WebSocket để kiểm tra end-to-end thay vì đo trong tiến trình")
    args = ap.parse_args()

    cases = load_cases()
    print(f"📷 {len(cases)} ảnh: " + ", ".join(c[0] for c in cases))

    if args.ws:
        for name, img, _ in cases:
            for mode in ("fast", "deep"):
                print(f"\n▶ {name} [{mode}]")
                await run_ws(args.ws, img, mode)
                await asyncio.sleep(args.delay)
        return

    import main as M
    await M.call_llm(["ping"], 'Return JSON: {"ok": true}')   # mở sẵn kết nối, không tính
    rows = []
    for rep in range(args.repeats):
        for name, img, note in cases:
            # Đổi thứ tự chế độ mỗi vòng cho công bằng
            for mode in (("fast", "deep") if rep % 2 == 0 else ("deep", "fast")):
                M._LLM_RESPONSE_CACHE.clear()
                await asyncio.sleep(args.delay)
                print(f"\n▶ [{rep + 1}/{args.repeats}] {name} — {mode}")
                try:
                    r = await (run_fast(M, img) if mode == "fast" else run_deep(M, img))
                except Exception as e:
                    print(f"   ❌ lỗi: {e!r}")
                    continue
                r.update(case=name, mode=mode, note=note)
                rows.append(r)
                print(f"   → {r.get('equation')} | đợt 1 {r['first']:.2f}s | xong {r['total']:.2f}s | AI={r['ai_calls']}")

    # ── Tổng hợp ──
    def med(vals):
        vals = [v for v in vals if v is not None]
        return f"{statistics.median(vals):.2f}s" if vals else "—"

    print("\n" + "=" * 96)
    print(f"{'Ảnh':<28}{'Chế độ':<8}{'Có PT (median)':>16}{'Lời giảng':>12}{'Quiz':>10}{'Xong':>10}{'AI':>6}  Ghi chú")
    print("-" * 96)
    for name, _, note in cases:
        for mode in ("fast", "deep"):
            rs = [r for r in rows if r["case"] == name and r["mode"] == mode]
            if not rs:
                continue
            print(f"{name:<28}{mode:<8}{med(r['first'] for r in rs):>16}{med(r.get('tutor') for r in rs):>12}"
                  f"{med(r.get('quiz') for r in rs):>10}{med(r['total'] for r in rs):>10}"
                  f"{statistics.median(r['ai_calls'] for r in rs):>6.0f}  {note if mode == 'deep' else ''}")
    print("=" * 96)
    for mode in ("fast", "deep"):
        rs = [r for r in rows if r["mode"] == mode]
        if rs:
            print(f"TẤT CẢ [{mode}]: có phương trình {med(r['first'] for r in rs)} · hoàn tất {med(r['total'] for r in rs)}")
    deep_agents = {}
    for r in rows:
        for a, ms in (r.get("agents") or {}).items():
            deep_agents.setdefault(a, []).append(ms)
    if deep_agents:
        print("Thời gian từng agent (median, ms): " +
              ", ".join(f"{a}={statistics.median(v):.0f}" for a, v in deep_agents.items()))
    with open(os.path.join(HERE, "benchmark_agents_result.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    asyncio.run(main())
