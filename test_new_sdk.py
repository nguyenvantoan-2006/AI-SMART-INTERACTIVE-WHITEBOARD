import os
from dotenv import load_dotenv
load_dotenv()

from google import genai

api_key = os.getenv("GEMINI_API_KEY")
print(f"Testing with key prefix: {api_key[:10]}... suffix: ...{api_key[-6:]}")

client = genai.Client(api_key=api_key)

try:
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents="Hi, answer in 3 words"
    )
    print("SUCCESS! Response:", response.text)
except Exception as e:
    print("ERROR:", type(e).__name__, str(e))
