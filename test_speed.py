"""
Test tốc độ API Gemini — đo latency thực tế với model gemini-2.0-flash.
Chạy: python test_speed.py
"""
import time, asyncio, os, json
from dotenv import load_dotenv
load_dotenv()
import google.generativeai as genai

api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

SYSTEM = """Return STRICTLY valid JSON. For chemistry equations return domain='chemistry'.
CHEMISTRY OUTPUT: {"domain":"chemistry","equation":"<balanced>","reactants":["A"],"products":["B"],"catalyst":null,"conditions":[],"mol_variants":[],"explanation":"<Vietnamese>","pedagogy":{"mechanism":"","reaction_type_label":"","simulation":"","warnings":[],"theory":"","applications":"","student_note":"","fun_fact":""}}"""

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-flash-latest")

async def bench(n=3):
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=SYSTEM,
        generation_config={"response_mime_type": "application/json"}
    )
    times = []
    prompts = [
        "Fe + HCl → ?",
        "NaOH + CO2 → ?",
        "CuSO4 + NaOH → ?"
    ]
    for i, p in enumerate(prompts[:n]):
        t0 = time.perf_counter()
        resp = await model.generate_content_async(p)
        t1 = time.perf_counter()
        elapsed = t1 - t0
        times.append(elapsed)
        try:
            data = json.loads(resp.text)
            domain = data.get("domain", "?")
        except:
            domain = "parse_error"
        print(f"  [{i+1}] {elapsed:.2f}s  prompt='{p}'  domain={domain}")
    avg = sum(times)/len(times)
    print(f"\n📊 Kết quả: avg={avg:.2f}s  min={min(times):.2f}s  max={max(times):.2f}s  model={MODEL_NAME}")
    if avg < 3:
        print("✅ ĐẠT MỤC TIÊU < 3s")
    else:
        print(f"⚠️  Chưa đạt (avg={avg:.2f}s > 3s)")

import sys
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

print(f"Key: ***{api_key[-6:] if api_key else 'NONE'}")
print(f"Model: {MODEL_NAME}")
print("Do latency (3 cau hoi)...\n")
asyncio.run(bench())
