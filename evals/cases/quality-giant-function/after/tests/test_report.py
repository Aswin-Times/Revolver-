from app.report import build_report


def test_build_report_sums_amounts():
    rows = [{"amount": 1}] * 200
    assert build_report(rows) == 149
