# -*- coding: utf-8 -*-
"""
test_safety_module.py — Bộ kiểm thử tự động cho Module Cảnh báo An toàn & Lớp luật hành động (KB7)
"""

import pytest
from main import check_safety, _normalize_formula


def test_safety_pour_water_into_concentrated_acid():
    """
    Kiểm tra Lớp luật hành động: Rót nước vào H2SO4 đặc (hoặc cặp H2O + H2SO4)
    BẮT BUỘC trả về level 'danger', is_critical=True, tuyệt đối không được báo 'safe'.
    """
    # Viết xuôi: H2O + H2SO4
    res1 = check_safety(["H2O", "H2SO4"], ["H3O+", "HSO4-"])
    assert res1["level"] == "danger"
    assert res1["is_critical"] is True
    assert "KHÔNG ĐƯỢC RÓT NƯỚC VÀO AXIT" in res1["reason"]
    assert "Rót từ từ axit" in res1["critical_safe_alt"]

    # Có ghi chú đặc: H2O + H2SO4 đặc
    res2 = check_safety(["H2O", "H2SO4 đặc"], [])
    assert res2["level"] == "danger"
    assert res2["is_critical"] is True

    # Viết ngược: H2SO4 + H2O
    res3 = check_safety(["H2SO4", "H2O"], [])
    assert res3["level"] == "danger"
    assert res3["is_critical"] is True


def test_safety_kmno4_h2so4_concentrated_explosion():
    """
    Kiểm tra ca tự nổ: KMnO4 + H2SO4 đặc tạo Mn2O7
    BẮT BUỘC có thí nghiệm thay thế an toàn chuẩn SGK: 10FeSO4 + 2KMnO4 + 8H2SO4(loãng)
    """
    res = check_safety(["KMnO4", "H2SO4 đặc"], [])
    assert res["level"] == "danger"
    assert res["is_critical"] is True
    assert "Mn₂O₇" in res["reason"]
    assert "10FeSO₄" in res["critical_safe_alt"]


def test_safety_nh3_bleach_chloramine():
    """
    Kiểm tra tai nạn tẩy rửa gia dụng: Thuốc tẩy (NaOCl) + NH3 tạo khí cloramin kịch độc
    """
    res = check_safety(["NaOCl", "NH3"], [])
    assert res["level"] == "danger"
    assert "cloramin" in res["reason"].lower()


def test_safety_alkali_metal_water():
    """
    Kiểm tra kim loại kiềm (Na, K) tác dụng với nước: nguy cơ nổ khí H2
    """
    res_na = check_safety(["Na", "H2O"], ["NaOH", "H2"])
    assert res_na["level"] == "danger"
    assert res_na["is_critical"] is True
    assert "hạt gạo" in res_na["critical_safe_alt"]

    res_k = check_safety(["K", "H2O"], [])
    assert res_k["level"] == "danger"
    assert res_k["is_critical"] is True


def test_safety_normal_safe_reactions():
    """
    Phản ứng an toàn thông thường phải trả về level 'safe', is_critical=False
    """
    res = check_safety(["NaOH", "HCl"], ["NaCl", "H2O"])
    assert res["level"] == "safe"
    assert res["is_critical"] is False


def test_formula_normalization_cleaning():
    """
    Kiểm tra bộ lọc chuẩn hóa công thức _normalize_formula bóc tách sạch sẽ các trạng thái
    """
    assert _normalize_formula("H2SO4 đặc") == "H2SO4"
    assert _normalize_formula("H2SO4 (đặc)") == "H2SO4"
    assert _normalize_formula("HCl loãng") == "HCL"
    assert _normalize_formula("Ba(OH)2 (aq)") == "BA(OH)2"
    assert _normalize_formula("CuSO4 dung dịch") == "CUSO4"
    assert _normalize_formula("H3O+") == "H3O"
    assert _normalize_formula("HSO4-") == "HSO4"
