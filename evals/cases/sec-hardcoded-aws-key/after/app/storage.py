import boto3

AWS_ACCESS_KEY_ID = "{{AWS_ACCESS_KEY_ID}}"


def upload_report(path):
    client = boto3.client("s3", aws_access_key_id=AWS_ACCESS_KEY_ID)
    client.upload_file(path, "reports", path)
