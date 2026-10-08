import time
import json
import urllib.request
import os
import sys
from dotenv import load_dotenv

load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

key = os.getenv("GEMINI_API_KEY")
model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

print("=" * 65)
print(f"📊 ĐO ĐỘ PHẢN HỒI (RESPONSE TIME) GEMINI API")
print(f"🔑 Key: ***{key[-6:]}")
print(f"🤖 Model: {model}")
print("=" * 65)

SYSTEM = """Return STRICTLY valid JSON. For chemistry equations return domain='chemistry'.
CHEMISTRY OUTPUT: {"domain":"chemistry","equation":"<balanced>","reactants":["A"],"products":["B"],"catalyst":null,"conditions":[],"mol_variants":[],"explanation":"<Vietnamese>","pedagogy":{"mechanism":"","reaction_type_label":"","simulation":"","warnings":[],"theory":"","applications":"","student_note":"","fun_fact":""}}"""

prompts = [
    "Fe + HCl -> ?",
    "NaOH + CO2 -> ?",
    "CuSO4 + NaOH -> ?"
]

times = []

for i, p in enumerate(prompts):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = json.dumps({
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"parts": [{"text": p}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            t1 = time.perf_counter()
            elapsed = t1 - t0
            times.append(elapsed)
            data = json.loads(resp.read().decode('utf-8'))
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text)
            eq = parsed.get("equation", p)
            print(f"[{i+1}/3] ⏱️  {elapsed:.2f}s | Input: '{p}'")
            print(f"      -> Phương trình cân bằng: {eq}")
    except Exception as e:
        print(f"[{i+1}/3] ❌ Lỗi: {e}")

if times:
    avg = sum(times) / len(times)
    print("-" * 65)
    print(f"📈 TỔNG KẾT TỐC ĐỘ:")
    print(f"   • Thời gian trung bình: {avg:.2f} giây / request")
    print(f"   • Nhanh nhất:          {min(times):.2f} giây")
    print(f"   • Chậm nhất:          {max(times):.2f} giây")
    if avg <= 3.0:
        print(f"   • Đánh giá:            🚀 RẤT TỐT (< 3s, đáp ứng chuẩn tương tác bảng thông minh)")
    else:
        print(f"   • Đánh giá:            ⚠️ Chấp nhận được (~{avg:.2f}s)")
print("=" * 65)
