from app.loader import load_settings


def test_load_settings_reads_json(tmp_path):
    path = tmp_path / "s.json"
    path.write_text('{"debug": true}')
    assert load_settings(path) == {"debug": True}
