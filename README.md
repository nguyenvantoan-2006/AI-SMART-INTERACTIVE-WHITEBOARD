# AI Smart Interactive Whiteboard 🎨🤖

Hệ thống Bảng vẽ tương tác thông minh tích hợp AI đa tác vụ (Multi-Agent) phục vụ giảng dạy và học tập trực quan:
- **Tương tác cử chỉ tay không chạm (Touchless Hand Gesture):** Sử dụng Google MediaPipe Hand Landmarker offline để vẽ, điều khiển và xóa bảng vẽ bằng cử chỉ ngón tay qua webcam.
- **Trợ lý thông minh giải toán, vẽ hình & mô phỏng hóa học:** Nhận diện chữ viết tay, hình vẽ bảng, giải thích từng bước và sinh mô phỏng hóa học 2D/3D tương tác theo thời gian thực với Google Gemini Vision.
- **Kiến trúc ứng dụng Web hiệu năng cao:** Backend FastAPI + WebSocket hai chiều, xử lý đa người dùng và độ trễ thấp.

---

## 🚀 Tính năng nổi bật

1. **Bảng vẽ thông minh (Smart Whiteboard):**
   - Đầy đủ công cụ vẽ bút, thước, tẩy, màu sắc, quản lý nhiều trang bảng vẽ (`page_manager.js`).
   - Nhận diện cử chỉ tay (`hand_gesture.js`) mượt mà qua webcam bằng MediaPipe WASM nội bộ không cần mạng.

2. **Multi-Agent AI Trợ Giảng:**
   - **Math & Science Solver:** Nhận diện và giải bài tập toán học, vật lý, phương trình trực tiếp từ ảnh chụp bảng vẽ.
   - **Chemistry Visualizer:** Nhận diện công thức hóa học và hiển thị mô phỏng phân tử, phản ứng tương tác trực quan (`chem_visuals.js`).

3. **Giao tiếp Real-time:**
   - Kết nối WebSocket truyền nhận nét vẽ và phản hồi AI tức thì.

---

## 🛠️ Hướng dẫn cài đặt & Khởi chạy

### 1. Yêu cầu hệ thống
- Python 3.10 trở lên
- Trình duyệt hiện đại (Chrome, Edge) hỗ trợ Webcam & WebAssembly

### 2. Cài đặt thư viện
```bash
pip install -r requirements.txt
```

### 3. Cấu hình biến môi trường
1. Sao chép file `.env.example` thành `.env`:
   ```bash
   cp .env.example .env     # Linux / Mac
   copy .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
   ```
2. Điền Google Gemini API Key của bạn vào file `.env`:
   ```env
   GEMINI_API_KEY="AIzaSy..."
   GEMINI_MODEL="gemini-2.0-flash"
   ```

### 4. Khởi chạy ứng dụng
```bash
python main.py
```
Mở trình duyệt và truy cập: **`http://localhost:8000`** (hoặc cổng được hiển thị trong terminal).

---

## 📁 Cấu trúc thư mục ứng dụng

```text
├── main.py                  # FastAPI server & WebSocket AI pipeline
├── requirements.txt         # Danh sách thư viện Python cần thiết
├── models.txt               # Danh sách mô hình AI hỗ trợ
├── .env.example             # Mẫu cấu hình API key
├── static/                  # Giao diện Web & Tài nguyên Client
│   ├── index.html           # Giao diện bảng vẽ
│   ├── style.css            # Định kiểu giao diện
│   ├── script.js            # Điều khiển Canvas & WebSocket
│   ├── page_manager.js      # Phân trang bảng vẽ
│   ├── hand_gesture.js      # Module nhận diện cử chỉ tay (MediaPipe)
│   ├── chem_visuals.js      # Trực quan hóa mô phỏng hóa học
│   └── mediapipe/           # Thư viện MediaPipe Vision & WASM offline
└── README.md                # Tài liệu dự án
```
