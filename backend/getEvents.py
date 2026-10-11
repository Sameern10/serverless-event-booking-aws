import json
from decimal import Decimal

import boto3

table = boto3.resource("dynamodb").Table("Events")


def to_json(o):
    if isinstance(o, Decimal):
        return int(o) if o % 1 == 0 else float(o)
    raise TypeError


def lambda_handler(event, context):
    items = table.scan()["Items"]
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(items, default=to_json),
    }
