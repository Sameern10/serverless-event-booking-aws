import os

import boto3

sfn = boto3.client("stepfunctions")
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]


def lambda_handler(event, context):
    # Each SQS message body is {"to": ..., "subject": ..., "body": ...}
    for record in event["Records"]:
        sfn.start_execution(stateMachineArn=STATE_MACHINE_ARN, input=record["body"])
    return {"started": len(event["Records"])}
