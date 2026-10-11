import json
import os
import smtplib
import ssl
from email.message import EmailMessage

import boto3

ses = boto3.client("ses")
SENDER = os.environ["SENDER_EMAIL"]
GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")


def send_email(to, subject, body):
    """Try Gmail first (works for any recipient), then fall back to SES."""
    if GMAIL_USER and GMAIL_APP_PASSWORD:
        try:
            msg = EmailMessage()
            msg["From"] = "EventBook <" + GMAIL_USER + ">"
            msg["To"] = to
            msg["Subject"] = subject
            msg.set_content(body)
            with smtplib.SMTP_SSL("smtp.gmail.com", 465,
                                  context=ssl.create_default_context(), timeout=10) as server:
                server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
                server.send_message(msg)
            return True
        except Exception as e:
            print("Gmail failed:", e)
    else:
        print("Gmail skipped: GMAIL_USER or GMAIL_APP_PASSWORD is not set")
    try:
        ses.send_email(
            Source=SENDER,
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
        )
        return True
    except Exception as e:
        print("SES failed:", e)
        return False


def lambda_handler(event, context):
    # Works for SQS messages (Records) and for direct calls from Step Functions
    if "Records" in event:
        messages = [json.loads(r["body"]) for r in event["Records"]]
    else:
        messages = [event]

    for m in messages:
        if "@" not in m.get("to", ""):
            continue
        if not send_email(m["to"], m["subject"], m["body"]):
            # Raising an error makes SQS or Step Functions retry
            raise RuntimeError("Could not send email to " + m["to"])
    return {"ok": True}
