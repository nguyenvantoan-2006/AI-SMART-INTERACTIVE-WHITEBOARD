"""
Bộ kiểm thử tính năng tạo đề thi trắc nghiệm GDPT 2018 và xuất Word (.docx)
"""
from quiz_exporter import generate_quiz_docx

def test_quiz_export():
    sample_questions = [
        {
            "id": 1,
            "type": "mcq",
            "level": "nhận_biết",
            "question": "Kim loại nào sau đây tác dụng được với dung dịch HCl?",
            "options": {"A": "Cu", "B": "Ag", "C": "Al", "D": "Au"},
            "answer": "C",
            "explanation": "Al đứng trước H trong dãy hoạt động hóa học."
        }
    ]
    docx_bytes = generate_quiz_docx("Al + HCl", sample_questions)
    assert docx_bytes.startswith(b"PK")
    assert len(docx_bytes) > 2000
