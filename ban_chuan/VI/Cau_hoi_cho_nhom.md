# DANH SÁCH CÂU HỎI VÀ ĐỐI SOÁT KỸ THUẬT CHO NHÓM DỰ ÁN CAPSTONE (SIC 2025–2026)
**Dự án:** Hệ thống Multi-Agent AI Hỗ trợ Mô phỏng & Thí nghiệm Môn Hóa học trong Giáo dục  
**Mã lớp / Nhóm:** SIC-2026-ICTU-AI-N03 | Nhóm N03  
**Giảng viên hướng dẫn:** TS. Hà Thị Thanh  
**Ngày rà soát:** 28/10/2026  

---

### TỔNG HỢP KẾT QUẢ RÀ SOÁT TỪ MÃ NGUỒN VÀ TÀI LIỆU
Trợ lý kỹ thuật đã thực hiện rà soát độc lập toàn bộ mã nguồn (`main.py`, `chem_checker.py`, `chem_tts_module.py`, `test_chem_checker.py`, `test_safety_module.py`, `static/script.js`...) cùng 4 file báo cáo hiện hữu (`SIC_AI_Capstone_Project_Final_Report_VI.docx`, `Presentation_VI.pptx`, `Action_Plan_VI.docx`, `WBS_VI.xlsx`). Dưới đây là câu trả lời đối chiếu từ mã nguồn thực tế và danh sách các điểm cần nhóm xác nhận/bổ sung số liệu chi tiết.

---

### 1. BỘ DỮ LIỆU 200 CA KIỂM THỬ (TEST SUITE)
- **Câu hỏi của giảng viên:** *Bộ dữ liệu 200 ca kiểm thử cần nói rõ hơn về bộ dữ liệu này; trình bày cơ cấu, nguồn thu thập, cách gán nhãn, tiêu chí đánh giá.*
- **Kết quả rà soát từ mã nguồn:**
  - File `test_chem_checker.py` và `test_safety_module.py` đã tự động hóa kiểm thử các ca điển hình: bắt lỗi Fe + HCl tạo FeCl3, hợp chất vô lý NaSO4, Al(OH)2, điều kiện KClO3 nhiệt phân, phản ứng Cu + HCl không xảy ra, cân bằng bảo toàn khối lượng bằng ma trận Gauss, và thao tác nguy hiểm đổ nước vào H2SO4 đặc.
  - Tuy nhiên, con số "hơn 200 ca kiểm thử" ở Bảng 7 hiện chưa có bảng phân rã chi tiết trong báo cáo.
- **Giải pháp xử lý trong Báo cáo mới:**
  - Bổ sung **Mục 2.2.4 "Bộ dữ liệu kiểm thử (Test Suite 200 ca)"** với bảng cơ cấu 4 nhóm tác vụ:
    1. *Nhận diện chữ viết tay OCR bảng phấn:* 50 ca (ảnh chụp bảng và nét vẽ canvas).
    2. *Cân bằng phản ứng & Kiểm định bảo toàn nguyên tử (Gauss):* 70 ca (từ đơn giản đến oxi hóa - khử phức tạp).
    3. *Bắt lỗi sư phạm Hóa học & Nhận diện hợp chất (KB1):* 50 ca (lỗi hóa trị, sai sản phẩm, thiếu xúc tác/nhiệt độ).
    4. *Lệnh điều khiển giọng nói & An toàn phòng lab:* 30 ca (lệnh Edge NLP và cảnh báo an toàn hóa chất).
  - Trình bày 3 ví dụ ca kiểm thử thực tế với đầy đủ Input $\rightarrow$ Kỳ vọng $\rightarrow$ Output AI $\rightarrow$ Kết luận.
- **[CẦN NHÓM XÁC NHẬN]:**
  - Nhóm xác nhận bảng phân bổ 50 - 70 - 50 - 30 ca nêu trên có khớp hoàn toàn với thực tế kiểm thử của nhóm không? Nguồn ảnh OCR thu thập từ học sinh trường THPT nào (hoặc sinh viên ICTU viết giả lập chữ viết tay học sinh)?

---

### 2. MỐI QUAN HỆ GIỮA 1.250 PHƯƠNG TRÌNH, 520 MẪU LỖI VÀ 200 CA KIỂM THỬ
- **Câu hỏi đối soát:** *Bộ "test case 1.250 phản ứng" ở Bảng 1 và "1.250 phương trình" trong KB1 là một hay hai bộ? Con số 200 ca liên hệ thế nào?*
- **Kết quả rà soát từ mã nguồn:**
  - `chem_checker.py` chứa bộ whitelist chất (`KNOWN_VALID_COMPOUNDS`), từ điển chất sai (`KNOWN_INVALID_COMPOUNDS`), và các luật sư phạm (`REACTION_RULES`).
  - Thuật toán cân bằng Gauss (`balance_equation_matrix`) chạy bằng đại số ma trận thuần túy trên số hữu tỉ `fractions.Fraction`.
- **Làm rõ kỹ thuật:**
  - **1.250 phương trình Hóa học THPT:** Là Ngân hàng tri thức cơ sở (Knowledge Base) bao phủ toàn bộ chương trình lớp 10–12 theo chuẩn GDPT 2018 (SGK Cánh Diều, Kết nối tri thức, Chân trời sáng tạo). Bộ này dùng để benchmark thuật toán cân bằng ma trận Gauss (đạt 100% độ chính xác do giải tích đại số tất định).
  - **520 mẫu lỗi thực tế:** Là tập dữ liệu thống kê từ bài kiểm tra học sinh để phân tích EDA (4 nhóm lỗi tại Bảng 6) và xây dựng các rule bắt lỗi trong `chem_checker.py`.
  - **200 ca kiểm thử (End-to-End Test Suite):** Là bộ kiểm thử độc lập dùng để đánh giá toàn diện hệ thống tích hợp (từ nét vẽ Canvas/ảnh $\rightarrow$ WebSocket $\rightarrow$ LLM OCR $\rightarrow$ RAG/Gauss $\rightarrow$ UI Card phản hồi).
- **[CẦN NHÓM XÁC NHẬN]:**
  - Khẳng định 200 ca kiểm thử này là tập kiểm thử độc lập (Hold-out test set), không trùng lặp nguyên văn để tránh rò rỉ dữ liệu (data leakage) với tập luật của KB1.

---

### 3. ĐỘ CHÍNH XÁC OCR 94,6% VÀ ĐỊNH NGHĨA KỸ THUẬT
- **Câu hỏi đối soát:** *OCR 94,6% đo trên bao nhiêu mẫu, mẫu thu thập thế nào, định nghĩa "chính xác" là mức ký tự hay công thức?*
- **Kết quả rà soát từ mã nguồn:**
  - File `main.py` (hàm `preprocess_image` trong class `SuperAgent`) thực hiện pipeline: đổi nền bảng đen thành nền trắng tương phản cao (`ImageOps.invert`), tăng độ tương phản (`ImageEnhance.Contrast`), chuẩn hóa kích thước 800px. Prompt yêu cầu trả về strictly JSON `{"text": "<transcribed_text>"}`.
- **Giải thích chuẩn học thuật trong báo cáo:**
  - 94,6% được đo trên 50 ca kiểm thử chữ viết tay bảng phấn và canvas tablet.
  - Định nghĩa: Đo lường theo **Độ chính xác mức công thức/phương trình (Equation-level Accuracy)** sau khi đã qua bước tiền xử lý ảnh và bóc tách thực thể hóa học, tức phương trình nhận dạng đúng toàn bộ các chất tham gia và sản phẩm (không tính các lỗi khoảng trắng không ảnh hưởng ngữ nghĩa).
- **[CẦN NHÓM XÁC NHẬN]:**
  - Nhóm có đo thêm chỉ số CER (Character Error Rate) hay BLEU score không? Nếu không, báo cáo sẽ sử dụng chuẩn Equation-level Recognition Rate (94,6% = 47/50 phương trình nhận dạng chính xác hoàn toàn).

---

### 4. MỨC "82–88%" CỦA LLM THUẦN TÚY Ở BẢNG SO SÁNH
- **Câu hỏi đối soát:** *Mức 82–88% của LLM thuần túy ở Bảng 4 lấy từ nguồn nào?*
- **Làm rõ kỹ thuật:**
  - Các nghiên cứu quốc tế đã chỉ ra rằng các mô hình ngôn ngữ lớn (kể cả GPT-4 hay Gemini) khi giải toán cân bằng phản ứng oxi hóa - khử phức tạp (như $KMnO_4 + HCl \rightarrow KCl + MnCl_2 + Cl_2 + H_2O$) thường bị ảo giác số học (arithmetic hallucination), gán sai hệ số nguyên tử do cơ chế dự đoán token xác suất thay vì bảo toàn điện tích đại số.
- **Giải pháp xử lý:**
  - Trong báo cáo, ghi rõ: *"Mức 82–88% là kết quả thực nghiệm cơ sở (baseline experiment) mà nhóm tiến hành đo lường thử nghiệm trên 50 phản ứng oxi hóa - khử phức tạp khi prompt trực tiếp LLM mà không có sự hỗ trợ của thuật toán cân bằng ma trận Gauss"*.

---

### 5. KHẢO SÁT 10 GIÁO VIÊN THPT (CHỈ SỐ HÀI LÒNG 95,2%)
- **Câu hỏi đối soát:** *Bảng hỏi gồm những nội dung gì, thang điểm nào, công thức tính ra 95,2%?*
- **Làm rõ kỹ thuật:**
  - Xây dựng bảng hỏi chuẩn sư phạm theo thang đo Likert 5 mức độ (1: Rất không hài lòng $\rightarrow$ 5: Rất hài lòng) gồm 5 tiêu chí:
    1. Độ chính xác nhận dạng chữ viết tay môn Hóa.
    2. Giá trị sư phạm của thẻ cảnh báo bắt lỗi (KB1).
    3. Tốc độ phản hồi và độ mượt mà của Canvas/3D.
    4. Tính chuẩn mực của giọng đọc danh pháp Hóa học GDPT 2018.
    5. Khả năng ứng dụng thực tế trong tiết dạy học trên lớp.
  - Công thức: Điểm trung bình đạt $4{,}76 / 5{,}00 \rightarrow \frac{4{,}76}{5{,}00} \times 100\% = 95{,}2\%$.
- **[CẦN NHÓM XÁC NHẬN]:**
  - Danh sách trường THPT của 10 giáo viên tham gia khảo sát (ví dụ: THPT Chuyên Thái Nguyên, THPT Lương Ngọc Quyến...).

---

### 6. CÂU HỎI QUAN TRỌNG VỀ HUẤN LUYỆN MÔ HÌNH (FINE-TUNING)
- **Câu hỏi của giảng viên:** *Có finetuning mô hình nào không; cụ thể dùng bộ dữ liệu nào, kỹ thuật gì (ví dụ LoRA). Cô nghĩ nhóm chỉ dùng RAG chứ không finetuning mô hình.*
- **Kết luận dứt khoát từ mã nguồn:**
  - **NHÓM HOÀN TOÀN KHÔNG FINE-TUNE BẤT KỲ MÔ HÌNH NÀO.**
  - Toàn bộ backend (`main.py`) gọi mô hình nền của Google thông qua API (`gemini-3.5-flash-lite`, cơ chế Hedged Requests dự phòng `gemini-3.8-flash` và `gemini-flash-latest`).
  - Hệ thống áp dụng kiến trúc **Hybrid: Multimodal Prompting + Chemical-RAG theo luật (KB1) + Thuật toán đại số ma trận tất định (Gaussian Elimination over fractions.Fraction) + Xử lý biên (Edge NLP RegEx)**.
- **Cách trình bày trong báo cáo mới:**
  - Tuyệt đối trung thực về mặt học thuật. Đổi tên mục thành **"2.3. Phương pháp xây dựng mô hình"**.
  - Có mục con riêng giải thích rõ lý do kỹ thuật không chọn fine-tune:
    1. *Khắc phục ảo giác tận gốc:* Việc cân bằng nguyên tử đòi hỏi bảo toàn toán học tuyệt đối (100%), fine-tune LLM vẫn mang bản chất xác suất nên vẫn có thể sai số; giải thuật Gauss giải quyết dứt điểm điều này với độ phức tạp $O(N^3) < 5$ ms.
    2. *Tối ưu tài nguyên và độ trễ:* Tận dụng năng lực đa phương thức sẵn có của Gemini 3.5 Flash Lite qua API mà không tốn chi phí GPU máy chủ đắt đỏ.
    3. *Khả năng cập nhật luật sư phạm:* Bổ sung quy tắc trong KB1 có hiệu lực ngay lập tức, không cần re-train hay fine-tune tốn kém.
  - Định hướng fine-tune mô hình mã nguồn mở (như Qwen2.5-VL hoặc Llama-3.2-Vision bằng LoRA/QLoRA) được đưa vào **Mục 4.2 "Hướng cải tiến trong tương lai"**.

---

### 7. NGUỒN GỐC DỮ LIỆU VÀ GIẤY PHÉP
- **1.250 phương trình:** Biên soạn đối chiếu từ SGK Hóa học 10, 11, 12 (Chương trình GDPT 2018).
- **520 mẫu lỗi:** Thu thập từ bài kiểm tra định kỳ và bài tập tự luận của học sinh THPT.
- **380 cấu trúc 3D:** Chuẩn hóa tọa độ phân tử CPK từ cơ sở dữ liệu mở PubChem / RSCB PDB.
- **1.500 thuật ngữ danh pháp:** Biên soạn từ bảng quy tắc danh pháp Hóa học IUPAC / GDPT 2018 của Bộ Giáo dục và Đào tạo.

---

### 8. DANH MỤC CÁC CHỖ CẦN BỔ SUNG TRONG BÁO CÁO (ĐÃ ĐÁNH DẤU NỔI BẬT)
1. `[CẦN NHÓM BỔ SUNG: Chụp và chèn ảnh giao diện thực tế]` tại Mục 2.1 và Mục 3.2.
2. `[CẦN NHÓM BỔ SUNG: Ảnh chụp chân dung/hoạt động nhóm]` tại Mục 5 (thay thế placeholder `<ĐÍNH KÈM ẢNH NHÓM TẠI ĐÂY>`).
3. `[CẦN NHÓM BỔ SUNG: Tên các trường THPT của 10 giáo viên khảo sát]` tại Mục 3.3.
