# -*- coding: utf-8 -*-
"""
test_chem_checker.py — Bộ kiểm thử cho Module Kiểm tra & Cân bằng Hóa học (KB1)
"""

import pytest
from chem_checker import (
    check_equation_pedagogy,
    balance_equation_matrix,
    parse_formula,
    clean_substance,
    KNOWN_VALID_COMPOUNDS
)


def to_ascii(s: str) -> str:
    """Chuyển ký tự chỉ số dưới unicode về ký tự số thường để dễ kiểm tra."""
    return s.translate(str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789"))


def test_kb1_case_fe_hcl_wrong_product_and_unbalanced():
    """
    Ca chính KB1: Fe + HCl -> FeCl3 + H2
    Yêu cầu:
    1. Bắt lỗi sai sản phẩm: HCl chỉ oxi hóa Fe lên Fe(II), tạo FeCl2, không tạo FeCl3.
    2. Bắt lỗi chưa cân bằng: Lệch cả H (trái 1, phải 2) và Cl (trái 1, phải 3).
    3. Gợi ý: Fe + 2HCl -> FeCl2 + H2↑.
    4. Highlight substances có chứa FeCl3.
    """
    eq = "Fe + HCl -> FeCl3 + H2"
    result = check_equation_pedagogy(eq)

    assert not result["is_correct"]
    error_types = [e["type"] for e in result["errors"]]
    assert "product_error" in error_types
    assert "balance_error" in error_types

    # Kiểm tra nội dung lỗi sản phẩm
    prod_err = next(e for e in result["errors"] if e["type"] == "product_error")
    assert "Fe(II)" in prod_err["message"]
    assert "FeCl2" in to_ascii(prod_err["message"])

    # Kiểm tra sai khác nguyên tử H và Cl
    disc = result["atom_discrepancies"]
    assert "H" in disc
    assert disc["H"] == (1, 2)
    assert "Cl" in disc
    assert disc["Cl"] == (1, 3)

    # Kiểm tra highlight
    assert "FeCl3" in result["highlight_substances"]

    # Kiểm tra gợi ý chuẩn
    sugg_ascii = to_ascii(result["suggestion"])
    assert "FeCl2" in sugg_ascii
    assert "2HCl" in sugg_ascii


def test_kb1_case_naso4_invalid_valence():
    """
    Biến thể 1b: NaSO4
    Báo lỗi Na hóa trị I, nhóm SO4 hóa trị II, gợi ý Na2SO4.
    """
    eq = "NaSO4 + BaCl2 -> BaSO4 + NaCl"
    result = check_equation_pedagogy(eq)

    assert not result["is_correct"]
    val_err = next((e for e in result["errors"] if e["type"] == "valence_error"), None)
    assert val_err is not None
    assert "Na" in val_err["message"] and "SO₄" in val_err["message"]
    assert "NaSO4" in result["highlight_substances"]
    assert "Na2SO4" in result["suggestion"]


def test_kb1_case_kclo3_missing_condition_and_unbalanced():
    """
    Biến thể 1c: KClO3 -> KCl + O2
    Báo thiếu điều kiện nhiệt độ t° và xúc tác MnO2 (không bắt buộc nhưng khuyên dùng).
    Báo chưa cân bằng.
    Gợi ý: 2KClO3 -(MnO2, t°)-> 2KCl + 3O2↑
    """
    eq = "KClO3 -> KCl + O2"
    result = check_equation_pedagogy(eq)

    assert not result["is_correct"]
    err_types = [e["type"] for e in result["errors"]]
    assert "condition_error" in err_types
    assert "balance_error" in err_types

    cond_err = next(e for e in result["errors"] if e["type"] == "condition_error")
    assert "đun nóng" in cond_err["message"] or "t°" in cond_err["message"]
    assert "MnO2" in cond_err["message"] or "MnO₂" in cond_err["message"]

    sugg_ascii = to_ascii(result["suggestion"])
    assert "2KClO3" in sugg_ascii
    assert "3O2" in sugg_ascii


def test_valid_whitelist_compounds_not_falsely_flagged():
    """
    Kiểm tra các chất đặc thù không bị báo oan (Fe3O4, H2O2, Na2S2O3, N2O, chất hữu cơ).
    """
    special_compounds = ["Fe3O4", "H2O2", "Na2S2O3", "N2O", "CH3COOH", "C2H5OH"]
    for comp in special_compounds:
        assert comp.upper() in KNOWN_VALID_COMPOUNDS

    # Test phương trình chứa Fe3O4 và H2SO4
    eq = "Fe3O4 + 8HCl -> FeCl2 + 2FeCl3 + 4H2O"
    result = check_equation_pedagogy(eq)
    # Phương trình này đã chuẩn cả sản phẩm lẫn cân bằng
    assert result["is_correct"]
    assert len(result["errors"]) == 0


def test_correct_balanced_equations():
    """
    Phương trình đúng chuẩn phải trả về is_correct: True, không có lỗi.
    """
    eq1 = "2H2 + O2 -> 2H2O"
    r1 = check_equation_pedagogy(eq1)
    assert r1["is_correct"]
    assert len(r1["errors"]) == 0

    eq2 = "Fe + 2HCl -> FeCl2 + H2"
    r2 = check_equation_pedagogy(eq2)
    assert r2["is_correct"]
    assert len(r2["errors"]) == 0


def test_gaussian_matrix_balancing():
    """
    Kiểm tra ma trận Gaussian Elimination cân bằng các phản ứng phức tạp.
    """
    # Cu + HNO3 -> Cu(NO3)2 + NO + H2O
    reactants = ["Cu", "HNO3"]
    products = ["Cu(NO3)2", "NO", "H2O"]
    coeffs = balance_equation_matrix(reactants, products)
    assert coeffs == [3, 8, 3, 2, 4]

    # KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O
    reactants2 = ["KMnO4", "HCl"]
    products2 = ["KCl", "MnCl2", "Cl2", "H2O"]
    coeffs2 = balance_equation_matrix(reactants2, products2)
    assert coeffs2 == [2, 16, 2, 2, 5, 8]
