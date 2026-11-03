"""
Bộ kiểm thử tính năng tạo bài tập trực tiếp từ chữ chọn trên bảng và độ ổn định đề 14 câu
"""
from main import QUIZ_LEVEL_RULES, QUIZ_TYPE_RULES, _quiz_plan, _quiz_chunks

def test_quiz_14_plan_and_chunks():
    plan = _quiz_plan(14, "mcq", "mixed")
    assert len(plan) == 14
    chunks = _quiz_chunks(plan)
    assert len(chunks) == 3
    total_in_chunks = sum(len(c["plan"]) for c in chunks)
    assert total_in_chunks == 14
