# NHẬT KÝ THAY ĐỔI VÀ ĐIỀU CHỈNH BÁO CÁO CAPSTONE (SIC 2025–2026)
**Dự án:** Hệ thống Multi-Agent AI Hỗ trợ Mô phỏng & Thí nghiệm Môn Hóa học trong Giáo dục  
**Mã lớp / Nhóm:** SIC-2026-ICTU-AI-N03 | Nhóm N03  
**Giảng viên hướng dẫn:** TS. Hà Thị Thanh  
**Ngày thực hiện:** 28/10/2026  
**Trạng thái bàn giao:** Hoàn tất toàn diện 4 file tài liệu và bộ sơ đồ kỹ thuật trực quan  

---

## 1. ÁNH XẠ CHI TIẾT CÁC THAY ĐỔI THEO 6 GÓP Ý CỦA GIẢNG VIÊN

| STT | Góp ý của Giảng viên | Các thay đổi và giải pháp đã thực hiện trong Báo cáo v2, Slide v2, Action Plan v2 | Trạng thái |
|:---:|:---|:---|:---:|
| **1** | **Phần thiết kế hệ thống cần mô tả rõ hơn.** | • **Đưa Mục 2.1 "Thiết kế kiến trúc hệ thống" lên vị trí đầu tiên của Chương 2**.<br>• Phân tích sâu nguyên tắc thiết kế kiến trúc lai (Hybrid Architecture) gồm 4 tầng: Client Tier, Communication Tier, Core AI & Balancer Tier, Knowledge Base Tier.<br>• Bổ sung **Bảng 3: Các thành phần cấu trúc cốt lõi của Hệ thống Multi-Agent AI** chi tiết hóa đầu vào, đầu ra, công nghệ và vai trò của 9 thành phần.<br>• Mô tả chi tiết giao thức WebSocket song công `/ws/analyze`, cấu trúc gói tin Request/Response JSON.<br>• Trình bày chi tiết cơ chế chịu lỗi **Fallback Hedging** (`LLM_HEDGE_DELAY = 3.0s`), tối ưu hóa kích thước ảnh 800px (giảm 60% payload) và tầng Edge RegEx (< 25 ms). | **ĐÃ HOÀN TẤT 100%** |
| **2** | **Vẽ hình ảnh mô tả để nhìn trực quan được hệ thống.** | • **Tạo mới và chèn 7 hình ảnh sơ đồ kỹ thuật trực quan độ phân giải cao (300 DPI)** bằng tiếng Việt chuẩn, không còn dùng khung placeholder hộp nét đứt:<br>  - **Hình 1 (H1):** Sơ đồ kiến trúc phân tầng tổng thể Hệ thống Multi-Agent AI (khớp Bảng 3).<br>  - **Hình 2 (H4):** Lưu đồ quyết định định tuyến lệnh thông minh (Edge RegEx vs Cloud AI / KB1 / Gauss).<br>  - **Hình 3 (H3):** Pipeline Chemical-RAG 3 giai đoạn triệt tiêu ảo giác hóa học.<br>  - **Hình 4 (H2):** Sơ đồ trình tự và luồng dữ liệu thời gian thực (Sequence Diagram giữa Client - WebSocket - SuperAgent - KB1 - Phản hồi).<br>  - **Hình 5 (H5):** Quy trình vòng đời dữ liệu từ thu thập, EDA, tiền xử lý đến kiểm thử.<br>  - **Hình 6 (H6):** Biểu đồ EDA phân bố 520 mẫu lỗi học sinh THPT (Bar chart + Donut chart).<br>  - **Hình 7 (H7):** Biểu đồ kết quả benchmark thực nghiệm so với mục tiêu ban đầu.<br>• Đã cập nhật và bổ sung mục **"Danh mục hình ảnh"** vào trang mục lục. | **ĐÃ HOÀN TẤT 100%** |
| **3** | **Bộ dữ liệu 200 ca kiểm thử cần nói rõ hơn về bộ dữ liệu này.** | • Bổ sung mới hoàn toàn **Mục 2.2.4 "Bộ dữ liệu kiểm thử (Test Suite 200 ca)"**.<br>• Xây dựng **Bảng 6: Cơ cấu phân bổ và đặc tính của Bộ dữ liệu kiểm thử độc lập** phân rã chi tiết thành 4 nhóm tác vụ:<br>  1. *OCR chữ viết tay bảng phấn:* 50 ca (Đạt 94,6% Equation-level Accuracy).<br>  2. *Cân bằng phản ứng & Bảo toàn nguyên tử (Gauss):* 70 ca (Đạt 100,0% bảo toàn khối lượng/điện tích).<br>  3. *Bắt lỗi sư phạm Hóa học (KB1):* 50 ca (Đạt 100% phát hiện đúng lỗi, chất sai và gợi ý chuẩn).<br>  4. *Lệnh giọng nói Edge & An toàn phòng lab (KB7):* 30 ca (22 ms, khóa toàn màn hình cảnh báo Red Alert).<br>• Trình bày quy trình gán nhãn đáp án chuẩn đối chiếu SGK GDPT 2018 bởi giáo viên phản biện.<br>• Phân tích 3 ví dụ ca kiểm thử thực tế minh họa chi tiết.<br>• Khẳng định nguyên tắc **Hold-out**: 200 ca kiểm thử độc lập tuyệt đối với tập luật KB1 để tránh rò rỉ dữ liệu (Data Leakage). | **ĐÃ HOÀN TẤT 100%** |
| **4** | **Phần thiết kế và phương pháp huấn luyện trong mục triển khai nên trình bày kiến trúc thiết kế trước, sau đó mô tả phần hệ thống và phương pháp huấn luyện.** | • Tái cấu trúc toàn bộ Chương 2 theo đúng trình tự sư phạm:<br>  - **2.1. Thiết kế kiến trúc hệ thống** (trình bày trước, kèm Hình 1 và Bảng 3).<br>  - **2.2. Dữ liệu** (2.2.1 Thu thập $\rightarrow$ 2.2.2 EDA $\rightarrow$ 2.2.3 Tiền xử lý $\rightarrow$ 2.2.4 Bộ dữ liệu kiểm thử).<br>  - **2.3. Phương pháp xây dựng mô hình** (thay cho "Phương pháp huấn luyện", kèm Hình 2, Hình 3 và Bảng 7).<br>  - **2.4. Quy trình hoạt động của hệ thống** (kèm Hình 4 sơ đồ luồng dữ liệu sequence). | **ĐÃ HOÀN TẤT 100%** |
| **5** | **Phần dữ liệu và EDA cũng thế: giới thiệu cách thu thập bộ dữ liệu, sau đó EDA dữ liệu, tiền xử lý dữ liệu; trình bày bộ dữ liệu kiểm thử luôn trong phần này.** | • Đưa toàn bộ nội dung dữ liệu từ Chương 3 về **Mục 2.2** với cấu trúc 4 tiểu mục logic chuẩn mực:<br>  - **2.2.1. Thu thập dữ liệu:** Giữ Bảng 4 (1.250 phương trình, 520 mẫu lỗi, 380 phân tử 3D, 1.500 thuật ngữ), loại bỏ hoàn toàn chữ "huấn luyện".<br>  - **2.2.2. Phân tích dữ liệu khám phá (EDA):** Chuyển từ 3.2 cũ sang, phân tích 520 mẫu lỗi tại Bảng 5, minh chứng bằng biểu đồ Hình 6.<br>  - **2.2.3. Tiền xử lý dữ liệu:** Chuyển từ 3.1 cũ sang, mô tả chuẩn hóa Retina/4K, đảo màu nền bảng đen sang nền trắng tương phản cao (Inversion, Contrast, scale 800px) và chuẩn hóa chỉ số dưới hóa học.<br>  - **2.2.4. Bộ dữ liệu kiểm thử:** Trình bày bộ 200 ca kiểm thử ngay tại phần này, kèm Hình 5 (Vòng đời dữ liệu) và Bảng 6. | **ĐÃ HOÀN TẤT 100%** |
| **6** | **Về huấn luyện mô hình: có finetuning mô hình nào không; cụ thể dùng bộ dữ liệu nào, kỹ thuật gì (ví dụ LoRA). Cô nghĩ nhóm chỉ dùng RAG chứ không finetuning mô hình.** | • **Đổi tên mục thành "2.3. Phương pháp xây dựng mô hình"** (Prompting + Chemical-RAG + Giải thuật tất định).<br>• Bổ sung mục con riêng: **"Về vấn đề Fine-tuning mô hình (Làm rõ kỹ thuật theo góp ý của giảng viên)"**, khẳng định trung thực: **Hệ thống KHÔNG fine-tune LLM**.<br>• Giải trình 3 căn cứ khoa học xác đáng:<br>  1. *Bản chất bảo toàn toán học tuyệt đối:* Cân bằng phản ứng đòi hỏi 100% chính xác, LLM xác suất dù fine-tune vẫn có thể ảo giác số học. Khử Gauss trên số hữu tỉ `Fraction` ($O(N^3) < 0,05$s) triệt tiêu dứt điểm ảo giác.<br>  2. *Tối ưu tài nguyên và độ trễ:* Gọi API Gemini 3.5 Flash Lite + Hedged Requests (3s) chi phí thấp, phản hồi 1,1–1,4s.<br>  3. *Tính động của KB1:* Bổ sung luật sư phạm và chất mới có hiệu lực ngay lập tức, không tốn chi phí tái huấn luyện.<br>• Đưa định hướng nghiên cứu fine-tune mô hình thị giác mở (Qwen2.5-VL / Llama-3.2-Vision) bằng kỹ thuật **LoRA / QLoRA** trên tập dữ liệu KB1 vào **Mục 4.2 "Hướng cải tiến trong tương lai"** phục vụ phiên bản On-Premise. | **ĐÃ HOÀN TẤT 100%** |

---

## 2. BẢNG ĐỐI CHIẾU TÍNH NHẤT QUÁN SỐ LIỆU GIỮA 4 FILE

| Thông số / Chỉ số kỹ thuật | Báo cáo chính (Final_Report_VI_v2.docx) | Slide thuyết trình (Presentation_VI_v2.pptx) | Kế hoạch hành động (Action_Plan_VI_v2.docx) | Phân chia công việc (WBS_VI_v2.xlsx) | Đánh giá tính nhất quán |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Bộ kiểm thử độc lập (Test Suite)** | **200 ca** (Mục 2.2.4, Bảng 6, Bảng 8) | **200 ca** (Slide 8, 16) | **200 ca** (Mục Dữ liệu, KQ) | **200 ca** (Task 6.1) | **ĐỒNG BỘ 100%** |
| **Ngân hàng phương trình GDPT 2018** | **1.250 phương trình** (Bảng 4) | **1.250 phương trình** (Slide 8, 18) | **1.250 phương trình** (Mục Dữ liệu) | **1.250 phương trình** (Task 1.1) | **ĐỒNG BỘ 100%** |
| **Mẫu lỗi học sinh thực tế (EDA)** | **520 mẫu lỗi** (Bảng 4, Bảng 5) | **520 mẫu lỗi** (Slide 8, 18) | **520 mẫu lỗi** (Mục Dữ liệu) | **520 mẫu lỗi** (Task 3.2) | **ĐỒNG BỘ 100%** |
| **Tọa độ phân tử 3D CPK** | **380 cấu trúc** (Bảng 4) | **380 cấu trúc** (Slide 6, 8) | **380 cấu trúc** (Mục Dữ liệu) | **380 cấu trúc** (Task 4.1) | **ĐỒNG BỘ 100%** |
| **Thuật ngữ danh pháp GDPT 2018** | **1.500 thuật ngữ** (Bảng 4) | **1.500 thuật ngữ** (Slide 8) | **1.500 thuật ngữ** (Mục Dữ liệu) | **1.500 thuật ngữ** (Task 4.2) | **ĐỒNG BỘ 100%** |
| **Độ chính xác OCR viết tay bảng phấn** | **94,6%** (Bảng 8, Mục 3.1) | **94,6%** (Slide 8, 16) | **94,6%** (Mục KQ kỳ vọng) | **94,6%** (Task 2.2) | **ĐỒNG BỘ 100%** |
| **Độ chính xác Cân bằng Gauss** | **100,0%** (Bảng 7, Bảng 8) | **100,0%** (Slide 5, 8, 16) | **100,0%** (Mục Phương pháp) | **100,0%** (Task 3.1) | **ĐỒNG BỘ 100%** |
| **Độ trễ lệnh giọng nói Edge NLP** | **22 ms (< 25 ms)** (Bảng 8) | **< 25 ms** (Slide 5, 6, 16) | **< 25 ms** (Mục Phương pháp) | **< 25 ms** (Task 5.2) | **ĐỒNG BỘ 100%** |
| **Độ trễ phân tích AI WebSocket** | **1,1–1,4 s** (Bảng 8) | **1,1–1,4 s** (Slide 16) | **1,1–1,4 s** (Mục KQ kỳ vọng) | **1,1–1,4 s** (Task 6.2) | **ĐỒNG BỘ 100%** |
| **Mức độ hài lòng giáo viên THPT** | **95,2%** (Khảo sát 10 GV, Bảng 8) | **95,2%** (10 GV, Slide 16) | **95,2%** (10 GV, Mục KQ) | **95,2%** (10 GV, Task 6.1) | **ĐỒNG BỘ 100%** |
| **Mức sẵn sàng công nghệ** | **TRL 6** (Mục 4.2) | **TRL 6** (Slide 17) | **TRL 6** (Mục KQ kỳ vọng) | **TRL 6** (Task 6.2) | **ĐỒNG BỘ 100%** |

---

## 3. DANH SÁCH CÁC PLACEHOLDER CHỦ ĐÍCH CẦN NHÓM ĐIỀN

Tất cả các vị trí cần nhóm bổ sung đã được định dạng nổi bật với mã `[CẦN NHÓM BỔ SUNG: ...]` (tô vàng):
1. **Mục 2.1 (Trang 9):** `[CẦN NHÓM BỔ SUNG: Chụp ảnh giao diện thực tế của hệ thống (màn hình Canvas Studio, Thẻ bắt lỗi sư phạm, Modal trắc nghiệm) và dán vào đây để minh chứng trực quan]`.
2. **Mục 3.2 (Trang 15):** `[CẦN NHÓM BỔ SUNG: Chèn ảnh chụp thật giao diện Canvas Studio, Thẻ bắt lỗi Equation Error Card và Modal trắc nghiệm tại đây]`.
3. **Mục 3.3 (Trang 16):** `[CẦN NHÓM BỔ SUNG: Tên các trường THPT của 10 giáo viên khảo sát, ví dụ THPT Chuyên Thái Nguyên, THPT Lương Ngọc Quyến...]`.
4. **Mục 5 (Trang 17):** `[CẦN NHÓM BỔ SUNG: ĐÍNH KÈM ẢNH CHỤP TẬP THỂ NHÓM THỰC HIỆN DỰ ÁN TẠI ĐÂY]`.

---

## 4. DANH MỤC CÁC FILE ĐẦU RA BÀN GIAO
- **Báo cáo chính:** `e:\SIC\DUAN_MH\ban_chuan\VI\Final_Report_VI_v2.docx`
- **Slide thuyết trình:** `e:\SIC\DUAN_MH\ban_chuan\VI\Presentation_VI_v2.pptx`
- **Kế hoạch hành động:** `e:\SIC\DUAN_MH\ban_chuan\VI\Action_Plan_VI_v2.docx`
- **Cấu trúc phân chia công việc:** `e:\SIC\DUAN_MH\ban_chuan\VI\WBS_VI_v2.xlsx`
- **Bảng câu hỏi đối soát cho nhóm:** `e:\SIC\DUAN_MH\Cau_hoi_cho_nhom.md`
- **Nhật ký thay đổi này:** `e:\SIC\DUAN_MH\Nhat_ky_thay_doi.md`
- **Thư mục ảnh sơ đồ nguồn (PNG độ phân giải cao 300 DPI):**
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H1_Kien_truc_tong_the_he_thong.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H2_So_do_luong_du_lieu_sequence.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H3_Pipeline_Chemical_RAG.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H4_Luu_do_dinh_tuyen_thong_minh.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H5_Quy_trinh_vong_doi_du_lieu.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H6_Bieu_do_EDA_520_mau_loi.png`
  - `e:\SIC\DUAN_MH\ban_chuan\VI\hinh_anh_so_do\H7_Bieu_do_benchmark_thuc_nghiem.png`
