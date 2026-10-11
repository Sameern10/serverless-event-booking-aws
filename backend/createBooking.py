import json
import os
import uuid

import boto3

db = boto3.resource("dynamodb")
events = db.Table("Events")
bookings = db.Table("Bookings")
sqs = boto3.client("sqs")
QUEUE_URL = os.environ["QUEUE_URL"]


def lambda_handler(event, context):
    data = json.loads(event["body"])
    event_id = data["eventId"]

    # The email comes from the verified Cognito token, not from the request body
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_email = claims.get("email") or data.get("userEmail", "guest")

    # Reduce the seat count only if seats are left (atomic, so no overbooking)
    try:
        resp = events.update_item(
            Key={"eventId": event_id},
            UpdateExpression="SET seatsLeft = seatsLeft - :one",
            ConditionExpression="seatsLeft > :zero",
            ExpressionAttributeValues={":one": 1, ":zero": 0},
            ReturnValues="ALL_NEW",
        )
    except db.meta.client.exceptions.ConditionalCheckFailedException:
        return {"statusCode": 400, "body": json.dumps({"message": "Sold out"})}

    ev = resp["Attributes"]
    booking_id = str(uuid.uuid4())
    bookings.put_item(Item={"bookingId": booking_id, "eventId": event_id, "userEmail": user_email})

    # Put the email job in the queue and return straight away
    queued = True
    try:
        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps({
                "to": user_email,
                "subject": "Booking confirmed: " + ev["title"],
                "body": (
                    "Your booking is confirmed.\n\n"
                    "Event: " + ev["title"] + "\n"
                    "Date: " + ev["date"] + "\n"
                    "Venue: " + ev["venue"] + "\n"
                    "Booking ID: " + booking_id + "\n"
                ),
            }),
        )
    except Exception as e:
        print("Queue failed:", e)
        queued = False

    return {"statusCode": 200, "body": json.dumps({"bookingId": booking_id, "emailSent": queued})}
