"""Test vision API call giống hệt main.py để kiểm tra key có hợp lệ với gRPC không."""
from dotenv import load_dotenv
load_dotenv(override=True)
import os, sys, asyncio
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
import google.generativeai as genai
from PIL import Image
from io import BytesIO

key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
print(f"Key: {key[:8]}...{key[-6:]}")
genai.configure(api_key=key)

async def test_vision():
    # Tạo ảnh test nhỏ có chữ
    img = Image.new("RGB", (200, 100), color=(10, 22, 40))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=90)
    img_bytes = buf.getvalue()
    
    model = genai.GenerativeModel(
        "gemini-3.6-flash",
        system_instruction="You classify images. Return valid JSON.",
        generation_config={"response_mime_type": "application/json"}
    )
    img_part = {"mime_type": "image/jpeg", "data": img_bytes}
    
    try:
        response = await model.generate_content_async(
            ["Describe this image and return JSON with domain field", img_part]
        )
        print("✅ Vision API THÀNH CÔNG!")
        print("Response:", response.text[:200])
    except Exception as e:
        print(f"❌ Vision API THẤT BẠI: {type(e).__name__}")
        print(f"Lỗi: {str(e)[:300]}")

asyncio.run(test_vision())
