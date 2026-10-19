# -*- coding: utf-8 -*-
"""
chem_checker.py — Module Kiểm tra, Bắt lỗi và Cân bằng Phương trình Hóa học THPT
================================================================================
Kiến trúc Hybrid:
- Cân bằng nguyên tử/điện tích: Python thuần (Gaussian Elimination + fractions.Fraction),
  chính xác 100%, không dùng LLM.
- Hóa trị & Hợp chất tồn tại: Whitelist các chất THPT phổ biến + DB lỗi sai kinh điển.
  Chỉ báo "không tồn tại" khi chắc chắn; chất lạ báo mềm, không báo oan chất hợp lệ.
- Bắt lỗi sư phạm: Phân tích sai sản phẩm, sai điều kiện, lệch cân bằng từng nguyên tố.
"""

from fractions import Fraction
import re
from typing import Dict, List, Tuple, Optional, Any


# ==============================================================================
# 1. WHITELIST CÁC CHẤT HỢP LỆ ĐÃ BIẾT (THPT VIỆT NAM)
# ==============================================================================
KNOWN_VALID_COMPOUNDS = {
    # Đơn chất
    "H2", "O2", "N2", "CL2", "BR2", "I2", "F2", "P", "S", "C", "SI",
    "FE", "CU", "AL", "ZN", "MG", "CA", "NA", "K", "BA", "AG", "PB", "MN", "CR", "NI", "SN",
    # Oxit
    "H2O", "H2O2", "CO2", "CO", "SO2", "SO3", "NO", "NO2", "N2O", "N2O3", "N2O4", "N2O5",
    "P2O5", "P2O3", "SIO2", "NA2O", "NA2O2", "K2O", "KO2", "CAO", "BAO", "MGO",
    "AL2O3", "FE2O3", "FEO", "FE3O4", "CUO", "CU2O", "ZNO", "MNO", "MNO2", "MN2O7",
    "CRO", "CR2O3", "CRO3", "PBO", "PBO2",
    # Axit
    "HCL", "HBR", "HI", "HF", "H2S", "H2SO4", "H2SO3", "HNO3", "HNO2", "H3PO4",
    "H2CO3", "H2SIO3", "HCLO", "HCLO2", "HCLO3", "HCLO4",
    # Bazơ
    "NAOH", "KOH", "BA(OH)2", "CA(OH)2", "MG(OH)2", "AL(OH)3", "FE(OH)2", "FE(OH)3",
    "CU(OH)2", "ZN(OH)2", "NH3", "NH4OH", "PB(OH)2",
    # Muối clorua, bromua, iotua, florua
    "NACL", "KCL", "CACL2", "BACL2", "MGCL2", "ALCL3", "FECL2", "FECL3", "CUCL2", "ZNCL2", "AGCL", "NH4CL",
    "NABR", "KBR", "CABR2", "BABR2", "ALBR3", "FEBR2", "FEBR3", "CUBR2", "AGBR",
    "NAI", "KI", "CAI2", "AGI", "NAF", "KF",
    # Muối sunfat, sunfit, sunfua
    "NA2SO4", "K2SO4", "CASO4", "BASO4", "MGSO4", "ALSO4", "AL2(SO4)3", "FESO4", "FE2(SO4)3",
    "CUSO4", "ZNSO4", "AG2SO4", "(NH4)2SO4", "NA2S2O3", "K2S2O3",
    "NA2SO3", "K2SO3", "CASO3", "BASO3",
    "NA2S", "K2S", "CAS", "BAS", "MGS", "FES", "FE2S3", "FES2", "CUS", "CU2S", "ZNS", "AG2S", "PBS",
    # Muối nitrat, nitrit
    "NANO3", "KNO3", "CA(NO3)2", "BA(NO3)2", "MG(NO3)2", "AL(NO3)3", "FE(NO3)2", "FE(NO3)3",
    "CU(NO3)2", "ZN(NO3)2", "AGNO3", "NH4NO3", "PB(NO3)2",
    "NANO2", "KNO2", "NH4NO2",
    # Muối cacbonat, hidrocacbonat
    "NA2CO3", "K2CO3", "CACO3", "BACO3", "MGCO3", "FECO3", "CUCO3", "(NH4)2CO3",
    "NAHCO3", "KHCO3", "CA(HCO3)2", "BA(HCO3)2", "MG(HCO3)2", "NH4HCO3",
    # Muối photphat
    "NA3PO4", "K3PO4", "CA3(PO4)2", "BA3(PO4)2", "MG3(PO4)2",
    "NA2HPO4", "NAH2PO4", "CAHPO4", "CA(H2PO4)2",
    # Muối oxi axit khác (KMnO4, KClO3, K2Cr2O7...)
    "KMNO4", "K2MNO4", "KCLO", "KCLO3", "NACLO", "NACLO3", "K2CRO4", "K2CR2O7", "NA2CRO4", "NA2CR2O7",
    "NAALO2", "KALO2", "NA[AL(OH)4]", "K[AL(OH)4]", "NA2ZNO2",
    # Chất hữu cơ cơ bản THPT
    "CH4", "C2H6", "C3H8", "C4H10", "C2H4", "C3H6", "C2H2", "C3H4", "C4H6", "C6H6", "C7H8",
    "CH3OH", "C2H5OH", "C3H7OH", "C3H5(OH)3", "C2H4(OH)2",
    "HCHO", "CH3CHO", "HCOOH", "CH3COOH", "C2H5COOH",
    "HCOOCH3", "CH3COOCH3", "CH3COOC2H5", "HCOOC2H5",
    "CH3COONA", "HCOONA", "CH3COOK",
    "C6H12O6", "C12H22O11", "(C6H10O5)N", "C6H10O5",
    "CH3NH2", "C2H5NH2", "C6H5NH2", "H2NCH2COOH"
}

# CÁC LỖI SAI HÓA TRỊ / CHẤT KHÔNG TỒN TẠI KINH ĐIỂN (Chắc chắn 100%)
KNOWN_INVALID_COMPOUNDS = {
    "NASO4": {
        "reason": "Chất không tồn tại. Na hóa trị I, nhóm SO₄ hóa trị II.",
        "suggestion": "Na2SO4",
        "focus_part": "NaSO4"
    },
    "FECL": {
        "reason": "Chất không tồn tại. Sắt có hóa trị II hoặc III trong muối clorua (FeCl₂ hoặc FeCl₃).",
        "suggestion": "FeCl2",
        "focus_part": "FeCl"
    },
    "AL(OH)2": {
        "reason": "Chất không tồn tại. Nhôm có hóa trị III trong bazơ.",
        "suggestion": "Al(OH)3",
        "focus_part": "Al(OH)2"
    },
    "ALOH": {
        "reason": "Chất không tồn tại. Nhôm có hóa trị III trong bazơ.",
        "suggestion": "Al(OH)3",
        "focus_part": "AlOH"
    },
    "CAOH": {
        "reason": "Chất không tồn tại. Canxi có hóa trị II, công thức bazơ đúng là Ca(OH)₂.",
        "suggestion": "Ca(OH)2",
        "focus_part": "CaOH"
    },
    "BAOH": {
        "reason": "Chất không tồn tại. Bari có hóa trị II, công thức bazơ đúng là Ba(OH)₂.",
        "suggestion": "Ba(OH)2",
        "focus_part": "BaOH"
    },
    "MGCL": {
        "reason": "Chất không tồn tại. Magie có hóa trị II, công thức đúng là MgCl₂.",
        "suggestion": "MgCl2",
        "focus_part": "MgCl"
    },
    "KSO4": {
        "reason": "Chất không tồn tại. Kali hóa trị I, nhóm SO₄ hóa trị II.",
        "suggestion": "K2SO4",
        "focus_part": "KSO4"
    },
    "H3SO4": {
        "reason": "Chất không tồn tại. Axit sunfuric có công thức là H₂SO₄.",
        "suggestion": "H2SO4",
        "focus_part": "H3SO4"
    },
    "HCL2": {
        "reason": "Chất không tồn tại. Axit clohiđric có công thức là HCl.",
        "suggestion": "HCl",
        "focus_part": "HCl2"
    },
    "NA2CL": {
        "reason": "Chất không tồn tại. Muối natri clorua có công thức là NaCl.",
        "suggestion": "NaCl",
        "focus_part": "Na2Cl"
    },
}

# QUY TẮC PHẢN ỨNG ĐẶC TRÙNG (Kiểm tra sai sản phẩm / sai tính chất)
REACTION_RULES = [
    {
        # Fe + HCl / H2SO4 loãng -> FeCl2 / FeSO4, KHÔNG tạo muối sắt(III)
        "match": lambda r, p: ("FE" in r and "HCL" in r and "FECL3" in p),
        "error_type": "product_error",
        "wrong_substance": "FeCl3",
        "correct_substance": "FeCl2",
        "reason": "Axit HCl là axit không có tính oxi hóa mạnh (tính oxi hóa do H⁺), chỉ oxi hóa Fe lên Fe(II) tạo FeCl₂, không tạo được FeCl₃.",
        "correct_equation": "Fe + 2HCl → FeCl₂ + H₂↑"
    },
    {
        "match": lambda r, p: ("FE" in r and "H2SO4" in r and "FE2(SO4)3" in p and not any("HNO3" in x for x in r)),
        "error_type": "product_error",
        "wrong_substance": "Fe2(SO4)3",
        "correct_substance": "FeSO4",
        "reason": "H₂SO₄ loãng chỉ oxi hóa Fe lên Fe(II) tạo FeSO₄ và khí H₂. Chỉ khi dùng H₂SO₄ đặc, nóng mới tạo Fe₂(SO₄)₃.",
        "correct_equation": "Fe + H₂SO₄ → FeSO₄ + H₂↑"
    },
    {
        # Cu + HCl -> không phản ứng
        "match": lambda r, p: ("CU" in r and "HCL" in r and len(p) > 0),
        "error_type": "no_reaction",
        "reason": "Đồng (Cu) đứng sau hiđro trong dãy hoạt động hóa học nên KHÔNG phản ứng với dung dịch HCl.",
        "correct_equation": "Cu + HCl → không phản ứng"
    },
    {
        # KClO3 phân hủy: cần t° và thường dùng MnO2
        "match": lambda r, p: ("KCLO3" in r and "KCL" in p and "O2" in p),
        "check_conditions": True,
        "required_condition": "t°",
        "catalyst_note": "Cần đun nóng; thường dùng xúc tác MnO₂ để giảm nhiệt độ phản ứng.",
        "correct_equation": "2KClO₃ →(MnO₂, t°) 2KCl + 3O₂↑"
    },
    {
        # H2O2 phân hủy
        "match": lambda r, p: ("H2O2" in r and "H2O" in p and "O2" in p),
        "check_conditions": True,
        "catalyst_note": "Phản ứng phân hủy êm dịu hơn khi có mặt xúc tác MnO₂.",
        "correct_equation": "2H₂O₂ →(MnO₂) 2H₂O + O₂↑"
    },
    {
        # Thao tác nguy hiểm: Rót nước vào H2SO4 đặc
        "match": lambda r, p: ("H2SO4" in r and any("H2O" in x or "H3O" in x for x in r)),
        "error_type": "safety_error",
        "reason": "CẢNH BÁO NGUY HIỂM: Tuyệt đối KHÔNG ĐƯỢC RÓT NƯỚC VÀO AXIT H₂SO₄ ĐẶC! Nước nhẹ hơn axit nên sôi bạo liệt trên bề mặt bắn tung tóe axit gây bỏng nặng và mù mắt.",
        "wrong_substance": "H2O + H2SO4",
        "correct_equation": "Quy tắc an toàn: Rót từ từ axit H₂SO₄ đặc vào cốc nước và khuấy nhẹ."
    }
]


# ==============================================================================
# 2. PARSER CÔNG THỨC & PHƯƠNG TRÌNH HÓA HỌC
# ==============================================================================
def clean_substance(sub: str) -> str:
    """Làm sạch chất, bỏ trạng thái (s, l, g, aq) và mũi tên kết tủa/bay hơi."""
    if not sub:
        return ""
    s = sub.strip()
    s = re.sub(r'[\(（][sSlLgGaAqQ\sđặc|loãng|dặc|loang]+[\)）]', '', s)
    s = s.replace('↑', '').replace('↓', '').replace('^', '')
    return s.strip()


def parse_formula(formula: str) -> Dict[str, int]:
    """
    Phân tích công thức hóa học (kể cả có ngoặc đơn) thành dict nguyên tố -> số nguyên tử.
    Ví dụ: 'Ca(OH)2' -> {'Ca': 1, 'O': 2, 'H': 2}
           'Fe2(SO4)3' -> {'Fe': 2, 'S': 3, 'O': 12}
    """
    f = clean_substance(formula)
    # Bỏ hệ số đầu nếu có (vd: 2H2O -> H2O)
    m = re.match(r'^\d*\.?\d*\s*([A-Za-z0-9\(\)]+)$', f)
    if m:
        f = m.group(1)

    # Đệ quy giải quyết ngoặc đơn
    while '(' in f and ')' in f:
        match = re.search(r'\(([^()]+)\)(\d*)', f)
        if not match:
            break
        inner = match.group(1)
        mult = int(match.group(2)) if match.group(2) else 1
        inner_dict = parse_simple_formula(inner)
        expanded = "".join(f"{elem}{cnt * mult}" for elem, cnt in inner_dict.items())
        f = f[:match.start()] + expanded + f[match.end():]

    return parse_simple_formula(f)


def parse_simple_formula(simple_f: str) -> Dict[str, int]:
    """Phân tích công thức không còn ngoặc đơn."""
    tokens = re.findall(r'([A-Z][a-z]?)(\d*)', simple_f)
    res = {}
    for elem, count_str in tokens:
        c = int(count_str) if count_str else 1
        res[elem] = res.get(elem, 0) + c
    return res


def parse_equation_sides(eq_str: str) -> Tuple[List[Tuple[int, str]], List[Tuple[int, str]], str]:
    """
    Tách phương trình thành 2 vế chất tham gia và sản phẩm, kèm hệ số hiện tại.
    Trả về: (reactants_with_coeff, products_with_coeff, arrow_condition)
    Ví dụ: 'Fe + 2HCl -> FeCl2 + H2'
    -> ([(1, 'Fe'), (2, 'HCl')], [(1, 'FeCl2'), (1, 'H2')], '')
    """
    # Tìm điều kiện trên mũi tên (nếu có): -(MnO2, t°)-> hoặc ->(t°)
    arrow_match = re.search(r'[-=—]*\(([^)]+)\)[->—=]+|[-=—]*→\(([^)]+)\)|[->—=]+', eq_str)
    condition_text = ""
    if arrow_match:
        condition_text = arrow_match.group(1) or arrow_match.group(2) or ""

    # Tách vế
    parts = re.split(r'[-=—]*\([^)]+\)[->—=]+|[-=—]*→\([^)]+\)|[->—=⇌]+', eq_str)
    if len(parts) < 2:
        return [], [], ""

    left_str, right_str = parts[0], parts[1]

    def extract_terms(side_str: str) -> List[Tuple[int, str]]:
        terms = []
        for item in side_str.split('+'):
            item = item.strip()
            if not item:
                continue
            m = re.match(r'^(\d+)\s*(.*)$', item)
            if m:
                coeff = int(m.group(1))
                formula = clean_substance(m.group(2))
            else:
                coeff = 1
                formula = clean_substance(item)
            if formula:
                terms.append((coeff, formula))
        return terms

    return extract_terms(left_str), extract_terms(right_str), condition_text


# ==============================================================================
# 3. THUẬT TOÁN CÂN BẰNG MA TRẬN NGUYÊN TỬ (GAUSSIAN ELIMINATION VỚI FRACTIONS)
# ==============================================================================
def balance_equation_matrix(reactant_formulas: List[str], product_formulas: List[str]) -> Optional[List[int]]:
    """
    Cân bằng phương trình hóa học bằng thuật toán khử Gauss trên trường số hữu tỉ (fractions.Fraction).
    Đảm bảo chính xác 100%, không bị sai số làm tròn số thực.
    Trả về danh sách hệ số nguyên dương nhỏ nhất cho [reactants..., products...] hoặc None nếu vô nghiệm.
    """
    all_species = reactant_formulas + product_formulas
    num_species = len(all_species)
    if num_species < 2:
        return None

    # 1. Thu thập tất cả các nguyên tố duy nhất
    elements = set()
    species_dicts = []
    for formula in all_species:
        d = parse_formula(formula)
        species_dicts.append(d)
        elements.update(d.keys())

    elem_list = sorted(list(elements))
    num_elems = len(elem_list)

    # 2. Xây dựng ma trận bảo toàn nguyên tố
    # reactants mang dấu dương, products mang dấu âm: sum(a_i * coeff_i) = 0
    # Ma trận kích thước num_elems x num_species
    matrix = []
    for elem in elem_list:
        row = []
        for i, d in enumerate(species_dicts):
            count = d.get(elem, 0)
            if i >= len(reactant_formulas):
                count = -count
            row.append(Fraction(count, 1))
        matrix.append(row)

    # 3. Khử Gauss trên số hữu tỉ
    row_idx = 0
    col_idx = 0
    while row_idx < num_elems and col_idx < num_species:
        # Tìm phần tử trụ khác 0
        pivot_row = None
        for r in range(row_idx, num_elems):
            if matrix[r][col_idx] != 0:
                pivot_row = r
                break

        if pivot_row is None:
            col_idx += 1
            continue

        # Hoán đổi hàng trụ lên
        matrix[row_idx], matrix[pivot_row] = matrix[pivot_row], matrix[row_idx]

        # Chuẩn hóa hàng trụ
        pivot = matrix[row_idx][col_idx]
        matrix[row_idx] = [x / pivot for x in matrix[row_idx]]

        # Khử các hàng khác
        for r in range(num_elems):
            if r != row_idx and matrix[r][col_idx] != 0:
                factor = matrix[r][col_idx]
                matrix[r] = [matrix[r][c] - factor * matrix[row_idx][c] for c in range(num_species)]

        row_idx += 1
        col_idx += 1

    # 4. Tìm vector nghiệm trong không gian hạt nhân (Kernel)
    # Gán biến tự do cuối cùng (species cuối) = 1
    # Biểu diễn các biến còn lại theo biến tự do
    coeffs = [Fraction(0, 1)] * num_species
    coeffs[-1] = Fraction(1, 1)

    for r in range(row_idx - 1, -1, -1):
        lead_col = None
        for c in range(num_species - 1):
            if matrix[r][c] != 0:
                lead_col = c
                break
        if lead_col is not None:
            val = -matrix[r][-1] * coeffs[-1]
            coeffs[lead_col] = val

    # Kiểm tra nếu có hệ số âm hoặc bằng 0 -> vô nghiệm cân bằng hợp lệ
    if any(c <= 0 for c in coeffs):
        # Thử tìm biến tự do khác nếu hệ đa biến
        return None

    # 5. Quy đồng mẫu số để tìm bộ số nguyên dương nhỏ nhất
    import math
    lcm_val = 1
    for c in coeffs:
        lcm_val = (lcm_val * c.denominator) // math.gcd(lcm_val, c.denominator)

    int_coeffs = [int(c.numerator * (lcm_val // c.denominator)) for c in coeffs]

    # Rút gọn theo ước chung lớn nhất
    gcd_all = int_coeffs[0]
    for x in int_coeffs[1:]:
        gcd_all = math.gcd(gcd_all, x)

    return [x // gcd_all for x in int_coeffs]


def format_balanced_equation(reactants: List[str], products: List[str], coeffs: List[int], condition: str = "") -> str:
    """Ghép hệ số đã cân bằng thành chuỗi phương trình in đẹp chuẩn Unicode."""
    n_r = len(reactants)
    r_terms = []
    for i in range(n_r):
        c = coeffs[i]
        c_str = f"{c}" if c > 1 else ""
        r_terms.append(f"{c_str}{reactants[i]}")

    p_terms = []
    for j in range(len(products)):
        c = coeffs[n_r + j]
        c_str = f"{c}" if c > 1 else ""
        p_terms.append(f"{c_str}{products[j]}")

    cond_str = f"({condition})" if condition else ""
    arrow = f" →{cond_str} " if cond_str else " → "
    return " + ".join(r_terms) + arrow + " + ".join(p_terms)


# ==============================================================================
# 4. MODULE KIỂM TRA CHÍNH: HÓA TRỊ, CÂN BẰNG & BẮT LỖI SƯ PHẠM (KB1)
# ==============================================================================
def check_equation_pedagogy(raw_equation: str) -> Dict[str, Any]:
    """
    Phân tích toàn diện phương trình viết tay của học sinh theo KB1.
    Trả về dict chi tiết:
    {
        "is_correct": bool,
        "transcribed_text": str,
        "errors": [
            {"type": "product_error"|"valence_error"|"balance_error"|"condition_error",
             "message": str, "focus": str}
        ],
        "atom_discrepancies": {"H": (left_cnt, right_cnt), ...},
        "suggestion": str,
        "highlight_substances": ["FeCl3", "H2"]
    }
    """
    res = {
        "is_correct": True,
        "transcribed_text": raw_equation.strip(),
        "errors": [],
        "atom_discrepancies": {},
        "suggestion": "",
        "highlight_substances": []
    }

    reactants_tuples, products_tuples, condition = parse_equation_sides(raw_equation)
    if not reactants_tuples or not products_tuples:
        res["is_correct"] = False
        res["errors"].append({
            "type": "format_error",
            "message": "Không nhận diện được đủ 2 vế chất tham gia và sản phẩm của phương trình.",
            "focus": raw_equation
        })
        return res

    reactant_formulas = [f for _, f in reactants_tuples]
    product_formulas = [f for _, f in products_tuples]
    norm_reactants = [f.upper() for f in reactant_formulas]
    norm_products = [f.upper() for f in product_formulas]

    # --- KIỂM TRA 1: HÓA TRỊ & CHẤT KHÔNG TỒN TẠI (WHITELIST & INVALID LIST) ---
    all_substances = reactant_formulas + product_formulas
    for sub in all_substances:
        clean_sub = clean_substance(sub)
        sub_upper = clean_sub.upper()

        # Kiểm tra danh sách sai chắc chắn
        if sub_upper in KNOWN_INVALID_COMPOUNDS:
            info = KNOWN_INVALID_COMPOUNDS[sub_upper]
            res["is_correct"] = False
            res["errors"].append({
                "type": "valence_error",
                "message": f"Chất {clean_sub} không tồn tại: {info['reason']}",
                "focus": clean_sub
            })
            res["highlight_substances"].append(clean_sub)
            if not res["suggestion"]:
                res["suggestion"] = raw_equation.replace(clean_sub, info["suggestion"])

        # Kiểm tra nếu là chất lạ (không trong whitelist và không phải đơn chất)
        elif sub_upper not in KNOWN_VALID_COMPOUNDS:
            # Kiểm tra xem có cấu trúc hợp lệ không
            d = parse_formula(clean_sub)
            if not d:
                res["is_correct"] = False
                res["errors"].append({
                    "type": "unknown_compound",
                    "message": f"Công thức '{clean_sub}' có vẻ lạ, bạn hãy kiểm tra lại nhé.",
                    "focus": clean_sub
                })

    # --- KIỂM TRA 2: QUY TẮC PHẢN ỨNG / SAI SẢN PHẨM / ĐIỀU KIỆN ---
    for rule in REACTION_RULES:
        if rule["match"](norm_reactants, norm_products):
            if rule.get("error_type") == "product_error":
                res["is_correct"] = False
                res["errors"].append({
                    "type": "product_error",
                    "message": f"🔴 Sai sản phẩm: {rule['reason']}",
                    "focus": rule.get("wrong_substance", "")
                })
                if rule.get("wrong_substance"):
                    res["highlight_substances"].append(rule["wrong_substance"])
                if rule.get("correct_equation"):
                    res["suggestion"] = rule["correct_equation"]

            elif rule.get("error_type") == "no_reaction":
                res["is_correct"] = False
                res["errors"].append({
                    "type": "no_reaction",
                    "message": f"🔴 Không có phản ứng: {rule['reason']}",
                    "focus": raw_equation
                })
                res["suggestion"] = rule["correct_equation"]

            if rule.get("check_conditions"):
                req_cond = rule.get("required_condition", "")
                cat_note = rule.get("catalyst_note", "")
                has_t = "t°" in condition or "t0" in condition or "đun" in condition.lower() or "nhiệt" in condition.lower()
                if req_cond == "t°" and not has_t:
                    res["is_correct"] = False
                    res["errors"].append({
                        "type": "condition_error",
                        "message": f"🟡 Thiếu điều kiện: {cat_note}",
                        "focus": condition or "mũi tên"
                    })
                    if rule.get("correct_equation"):
                        res["suggestion"] = rule["correct_equation"]

    # --- KIỂM TRA 3: NGUYÊN TỐ CÓ KHỚP GIỮA 2 VẾ KHÔNG ---
    left_atoms = {}
    for coeff, formula in reactants_tuples:
        d = parse_formula(formula)
        for elem, cnt in d.items():
            left_atoms[elem] = left_atoms.get(elem, 0) + coeff * cnt

    right_atoms = {}
    for coeff, formula in products_tuples:
        d = parse_formula(formula)
        for elem, cnt in d.items():
            right_atoms[elem] = right_atoms.get(elem, 0) + coeff * cnt

    # Kiểm tra bảo toàn từng nguyên tố
    discrepancies = {}
    all_elems = set(left_atoms.keys()) | set(right_atoms.keys())
    for elem in all_elems:
        l_cnt = left_atoms.get(elem, 0)
        r_cnt = right_atoms.get(elem, 0)
        if l_cnt != r_cnt:
            discrepancies[elem] = (l_cnt, r_cnt)

    res["atom_discrepancies"] = discrepancies

    if discrepancies:
        res["is_correct"] = False
        discrepancy_details = []
        for elem, (l_cnt, r_cnt) in sorted(discrepancies.items()):
            discrepancy_details.append(f"{elem} (vế trái {l_cnt}, vế phải {r_cnt})")
        res["errors"].append({
            "type": "balance_error",
            "message": f"🟡 Chưa cân bằng: Lệch nguyên tố " + " và ".join(discrepancy_details) + ".",
            "focus": "hệ số cân bằng"
        })

    # --- TỰ ĐỘNG CÂN BẰNG & ĐƯA RA GỢI Ý CHUẨN NẾU CHƯA CÓ GỢI Ý ĐẶC THÙ ---
    if not res["suggestion"]:
        balanced_coeffs = balance_equation_matrix(reactant_formulas, product_formulas)
        if balanced_coeffs:
            balanced_str = format_balanced_equation(reactant_formulas, product_formulas, balanced_coeffs, condition)
            res["suggestion"] = balanced_str
            # Nếu chỉ chưa cân bằng mà sản phẩm đúng
            if not any(e["type"] in ("product_error", "valence_error") for e in res["errors"]):
                # Highlight các chất có hệ số cần bổ sung
                for i, c in enumerate(balanced_coeffs[:len(reactant_formulas)]):
                    if c != reactants_tuples[i][0]:
                        res["highlight_substances"].append(reactant_formulas[i])
                for j, c in enumerate(balanced_coeffs[len(reactant_formulas):]):
                    if c != products_tuples[j][0]:
                        res["highlight_substances"].append(product_formulas[j])

    # Khử trùng lặp danh sách highlight
    res["highlight_substances"] = list(dict.fromkeys(res["highlight_substances"]))

    if not res["errors"]:
        res["is_correct"] = True
        res["suggestion"] = raw_equation

    return res
