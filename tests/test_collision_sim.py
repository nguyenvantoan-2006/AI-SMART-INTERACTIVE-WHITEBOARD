"""
Bộ kiểm thử tích hợp mô phỏng 3D Thuyết va chạm phân tử và động học hóa học
"""
def test_collision_sim_assets():
    with open("static/collision_sim.js", "r", encoding="utf-8") as f:
        code = f.read()
    assert "openCollisionSimulator" in code
    assert "closeCollisionSimulator" in code
    assert "drawEnergyCurve" in code
    assert "updateParticleVelocities" in code
