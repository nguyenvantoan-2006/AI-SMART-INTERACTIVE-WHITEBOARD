# -*- coding: utf-8 -*-
"""
quiz_exporter.py — Mô-đun Xuất Đề Thi & Bảng Đáp Án Word (.docx) Chuẩn GDPT 2018
================================================================================
Tạo tệp Word (.docx) chuyên nghiệp cho giáo viên THPT:
- Header 2 cột: Tên Sở/Trường, Khóa học, Thời gian, Mã đề.
- Thông tin thí sinh & Bảng ma trận 4 mức độ nhận thức (Nhận biết, Thông hiểu, Vận dụng, Vận dụng cao).
- Nội dung câu hỏi trắc nghiệm & tự luận được định dạng chuẩn thi cử.
- Trang riêng cho Bảng đáp án nhanh (Answer Key Table) & Hướng dẫn giải chi tiết.
"""

import io
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls


def generate_quiz_docx(
    topic: str,
    questions: list,
    school_name: str = "SỞ GD&ĐT THÁI NGUYÊN",
    exam_title: str = "ĐỀ KIỂM TRA ĐÁNH GIÁ MÔN HÓA HỌC",
    exam_time: int = 15
) -> bytes:
    doc = docx.Document()
    
    # Thiết lập lề trang A4 (0.75 inch ≈ 1.9 cm)
    for s in doc.sections:
        s.top_margin = Inches(0.75)
        s.bottom_margin = Inches(0.75)
        s.left_margin = Inches(0.75)
        s.right_margin = Inches(0.75)
        
    # Định dạng phông chữ chuẩn văn bản giáo dục
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = RGBColor(0, 0, 0)
    
    # --- 1. TIÊU ĐỀ ĐỀ THI (HEADER TABLE 2 CỘT) ---
    tbl_header = doc.add_table(rows=1, cols=2)
    tbl_header.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_header.autofit = False
    tbl_header.columns[0].width = Inches(3.2)
    tbl_header.columns[1].width = Inches(3.8)
    
    # Cột trái: Tên Sở & Trường
    c_left = tbl_header.rows[0].cells[0]
    p_l1 = c_left.paragraphs[0]
    p_l1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_l1 = p_l1.add_run(school_name.upper() + "\n")
    r_l1.font.size = Pt(10)
    r_l1.font.bold = True
    r_l2 = p_l1.add_run("TRƯỜNG THPT CHUYÊN / THPT\n")
    r_l2.font.size = Pt(10)
    r_l2.font.bold = True
    r_l3 = p_l1.add_run("───── ★ ─────")
    r_l3.font.size = Pt(9)
    
    # Cột phải: Tên Kỳ thi, Năm học, Thời gian
    c_right = tbl_header.rows[0].cells[1]
    p_r1 = c_right.paragraphs[0]
    p_r1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_r1 = p_r1.add_run(exam_title.upper() + "\n")
    r_r1.font.size = Pt(11)
    r_r1.font.bold = True
    r_r2 = p_r1.add_run("NĂM HỌC 2025 – 2026 | CHƯƠNG TRÌNH GDPT 2018\n")
    r_r2.font.size = Pt(10)
    r_r2.font.italic = True
    r_r3 = p_r1.add_run(f"Chủ đề: {topic}\nThời gian: {exam_time} phút (Không kể phát đề)")
    r_r3.font.size = Pt(10)
    
    # Xóa viền bảng header
    for row in tbl_header.rows:
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            tcBorders = parse_xml(r'<w:tcBorders %s><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tcBorders>' % nsdecls('w'))
            tcPr.append(tcBorders)

    # Thông tin thí sinh
    p_cand = doc.add_paragraph()
    p_cand.paragraph_format.space_before = Pt(8)
    p_cand.paragraph_format.space_after = Pt(8)
    r_cand = p_cand.add_run("Họ và tên thí sinh: ............................................................................ Lớp: ................. SBD: ............ Mã đề: 101")
    r_cand.font.italic = True
    r_cand.font.bold = True
    
    # Đường kẻ phân cách
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(6)
    r_div = p_div.add_run("─" * 68)
    r_div.font.color.rgb = RGBColor(140, 140, 140)
    
    # --- 2. BẢNG MA TRẬN 4 MỨC ĐỘ NHẬN THỨC ---
    p_mat = doc.add_paragraph()
    p_mat.paragraph_format.space_before = Pt(4)
    p_mat.paragraph_format.space_after = Pt(4)
    r_mat = p_mat.add_run("I. MA TRẬN ĐẶC TẢ ĐỀ KIỂM TRA (CHUẨN ĐÁNH GIÁ NĂNG LỰC GDPT 2018)")
    r_mat.font.bold = True
    r_mat.font.size = Pt(10.5)
    
    # Đếm số lượng theo mức độ
    level_counts = {"nhận_biết": 0, "thông_hiểu": 0, "vận_dụng": 0, "vận_dụng_cao": 0}
    for q in questions:
        lv = q.get("level", "nhận_biết")
        if lv in level_counts:
            level_counts[lv] += 1
        else:
            level_counts["nhận_biết"] += 1
            
    total_q = len(questions) or 1
    
    tbl_matrix = doc.add_table(rows=2, cols=6)
    tbl_matrix.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_matrix.autofit = False
    
    headers = ["Mức độ nhận thức", "Nhận biết", "Thông hiểu", "Vận dụng", "Vận dụng cao", "Tổng cộng"]
    widths = [Inches(1.8), Inches(1.0), Inches(1.0), Inches(1.0), Inches(1.1), Inches(1.1)]
    
    for i, h in enumerate(headers):
        c = tbl_matrix.rows[0].cells[i]
        c.width = widths[i]
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = c.paragraphs[0].add_run(h)
        run.font.bold = True
        run.font.size = Pt(9.5)
        shd = parse_xml(r'<w:shd %s w:fill="E2E8F0"/>' % nsdecls('w'))
        c._tc.get_or_add_tcPr().append(shd)
        
    row_vals = [
        "Số câu (Tỉ lệ %)",
        f"{level_counts['nhận_biết']} ({level_counts['nhận_biết']*100//total_q}%)",
        f"{level_counts['thông_hiểu']} ({level_counts['thông_hiểu']*100//total_q}%)",
        f"{level_counts['vận_dụng']} ({level_counts['vận_dụng']*100//total_q}%)",
        f"{level_counts['vận_dụng_cao']} ({level_counts['vận_dụng_cao']*100//total_q}%)",
        f"{total_q} (100%)"
    ]
    for i, val in enumerate(row_vals):
        c = tbl_matrix.rows[1].cells[i]
        c.width = widths[i]
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = c.paragraphs[0].add_run(val)
        run.font.size = Pt(9.5)
        
    for row in tbl_matrix.rows:
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            tcBorders = parse_xml(r'<w:tcBorders %s><w:top w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/><w:left w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/><w:right w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/></w:tcBorders>' % nsdecls('w'))
            tcPr.append(tcBorders)

    # --- 3. NỘI DUNG CÂU HỎI TRẮC NGHIỆM ---
    p_sec2 = doc.add_paragraph()
    p_sec2.paragraph_format.space_before = Pt(12)
    p_sec2.paragraph_format.space_after = Pt(4)
    r_sec2 = p_sec2.add_run("II. NỘI DUNG CÂU HỎI")
    r_sec2.font.bold = True
    r_sec2.font.size = Pt(10.5)
    
    level_label_map = {
        "nhận_biết": "Nhận biết",
        "thông_hiểu": "Thông hiểu",
        "vận_dụng": "Vận dụng",
        "vận_dụng_cao": "Vận dụng cao"
    }

    for idx, q in enumerate(questions):
        p_q = doc.add_paragraph()
        p_q.paragraph_format.space_before = Pt(6)
        p_q.paragraph_format.space_after = Pt(2)
        
        lv_name = level_label_map.get(q.get("level", "nhận_biết"), "Nhận biết")
        r_num = p_q.add_run(f"Câu {idx + 1} [{lv_name}]: ")
        r_num.font.bold = True
        p_q.add_run(q.get("question", ""))
        
        options = q.get("options", {})
        if isinstance(options, dict) and options:
            opts_table = doc.add_table(rows=2, cols=2)
            opts_table.autofit = False
            opts_table.alignment = WD_TABLE_ALIGNMENT.CENTER
            opts_table.columns[0].width = Inches(3.5)
            opts_table.columns[1].width = Inches(3.5)
            
            cells_map = [
                (0, 0, "A"), (0, 1, "B"),
                (1, 0, "C"), (1, 1, "D")
            ]
            for row_idx, col_idx, key in cells_map:
                cell = opts_table.rows[row_idx].cells[col_idx]
                p_opt = cell.paragraphs[0]
                p_opt.paragraph_format.space_before = Pt(1)
                p_opt.paragraph_format.space_after = Pt(1)
                val = options.get(key, "")
                r_k = p_opt.add_run(f"{key}. ")
                r_k.font.bold = True
                p_opt.add_run(val)
                
                tcPr = cell._tc.get_or_add_tcPr()
                tcBorders = parse_xml(r'<w:tcBorders %s><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tcBorders>' % nsdecls('w'))
                tcPr.append(tcBorders)
        elif q.get("type") == "essay":
            p_essay = doc.add_paragraph()
            p_essay.paragraph_format.space_after = Pt(4)
            r_es = p_essay.add_run("(Thí sinh trình bày lời giải chi tiết vào bài làm)")
            r_es.font.italic = True
            r_es.font.color.rgb = RGBColor(100, 100, 100)

    # --- 4. TRANG BẢNG ĐÁP ÁN & HƯỚNG DẪN GIẢI CHI TIẾT ---
    doc.add_page_break()
    
    p_ans_title = doc.add_paragraph()
    p_ans_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_at = p_ans_title.add_run("BẢNG ĐÁP ÁN VÀ HƯỚNG DẪN GIẢI CHI TIẾT\n")
    r_at.font.bold = True
    r_at.font.size = Pt(13)
    r_at_sub = p_ans_title.add_run(f"(Kèm theo Đề kiểm tra chủ đề: {topic})")
    r_at_sub.font.italic = True
    r_at_sub.font.size = Pt(10)
    
    # 4.1 Bảng đáp án trắc nghiệm nhanh
    p_key_head = doc.add_paragraph()
    p_key_head.paragraph_format.space_before = Pt(8)
    p_key_head.paragraph_format.space_after = Pt(4)
    r_kh = p_key_head.add_run("1. BẢNG ĐÁP ÁN NHANH")
    r_kh.font.bold = True
    r_kh.font.size = Pt(11)
    
    cols_per_row = min(10, total_q)
    rows_needed = -(-total_q // cols_per_row) * 2
    
    tbl_key = doc.add_table(rows=rows_needed, cols=cols_per_row)
    tbl_key.alignment = WD_TABLE_ALIGNMENT.CENTER
    col_w = Inches(7.0 / cols_per_row)
    for col in tbl_key.columns:
        col.width = col_w
        
    for r_block in range(-(-total_q // cols_per_row)):
        row_q = tbl_key.rows[r_block * 2]
        row_a = tbl_key.rows[r_block * 2 + 1]
        for c in range(cols_per_row):
            q_idx = r_block * cols_per_row + c
            cell_q = row_q.cells[c]
            cell_a = row_a.cells[c]
            if q_idx < total_q:
                cell_q.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                r_q = cell_q.paragraphs[0].add_run(str(q_idx + 1))
                r_q.font.bold = True
                r_q.font.size = Pt(9.5)
                shd_q = parse_xml(r'<w:shd %s w:fill="F1F5F9"/>' % nsdecls('w'))
                cell_q._tc.get_or_add_tcPr().append(shd_q)
                
                cell_a.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                ans_str = str(questions[q_idx].get("answer", "-")).upper()
                r_a = cell_a.paragraphs[0].add_run(ans_str)
                r_a.font.bold = True
                r_a.font.size = Pt(10)
                r_a.font.color.rgb = RGBColor(16, 185, 129)
                
    for row in tbl_key.rows:
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            tcBorders = parse_xml(r'<w:tcBorders %s><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders>' % nsdecls('w'))
            tcPr.append(tcBorders)

    # 4.2 Hướng dẫn giải chi tiết
    p_exp_head = doc.add_paragraph()
    p_exp_head.paragraph_format.space_before = Pt(14)
    p_exp_head.paragraph_format.space_after = Pt(4)
    r_eh = p_exp_head.add_run("2. HƯỚNG DẪN GIẢI CHI TIẾT VÀ PHÂN TÍCH PHƯƠNG ÁN GÂY NHIỄU")
    r_eh.font.bold = True
    r_eh.font.size = Pt(11)

    for idx, q in enumerate(questions):
        p_item = doc.add_paragraph()
        p_item.paragraph_format.space_before = Pt(6)
        p_item.paragraph_format.space_after = Pt(2)
        
        r_item_title = p_item.add_run(f"Câu {idx + 1}: ")
        r_item_title.font.bold = True
        
        ans_key = str(q.get("answer", "")).upper()
        if ans_key and isinstance(q.get("options"), dict):
            r_ans_val = p_item.add_run(f"Đáp án {ans_key} — {q.get('options', {}).get(ans_key, '')}\n")
            r_ans_val.font.bold = True
            r_ans_val.font.color.rgb = RGBColor(5, 150, 105)
            
        exp_text = q.get("explanation") or q.get("solution") or "Đáp án chuẩn xác theo chương trình SGK."
        r_exp = p_item.add_run(f"💡 Hướng dẫn giải: {exp_text}")
        r_exp.font.italic = True
        r_exp.font.size = Pt(10)
        
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()

