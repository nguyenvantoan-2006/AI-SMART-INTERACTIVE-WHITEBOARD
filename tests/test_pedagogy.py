"""
Bộ kiểm thử tính năng Xử lý phản ứng không xảy ra & Chuẩn hóa sư phạm
Kiểm tra các trường hợp không xảy ra phản ứng và bắt lỗi sản phẩm sai.
"""
from chem_checker import check_equation_pedagogy

def test_no_reaction_h2_h2so4():
    res = check_equation_pedagogy("H2 + H2SO4 -> H2SO4 + H2")
    assert res.get("no_reaction") is True

def test_no_reaction_cu_hcl():
    res = check_equation_pedagogy("Cu + HCl -> CuCl2 + H2")
    assert res.get("no_reaction") is True

def test_valid_al_hcl():
    res = check_equation_pedagogy("2Al + 6HCl -> 2AlCl3 + 3H2")
    assert res.get("is_correct") is True
