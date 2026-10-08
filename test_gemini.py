import os
from dotenv import load_dotenv
import asyncio
import google.generativeai as genai

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

async def test():
    model = genai.GenerativeModel(model_name="gemini-flash-lite-latest")
    try:
        response = await model.generate_content_async("Hello")
        print("Success:", response.text)
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
