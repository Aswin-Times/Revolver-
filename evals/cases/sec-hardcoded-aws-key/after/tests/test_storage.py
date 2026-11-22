from unittest import mock

from app.storage import upload_report


def test_upload_report_uses_reports_bucket():
    with mock.patch("app.storage.boto3") as boto3:
        upload_report("r.csv")
    boto3.client.return_value.upload_file.assert_called_once_with("r.csv", "reports", "r.csv")
