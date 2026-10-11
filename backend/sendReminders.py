import os
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import boto3
from boto3.dynamodb.conditions import Attr

db = boto3.resource("dynamodb")
events = db.Table("Events")
bookings = db.Table("Bookings")
ses = boto3.client("ses")

SENDER = os.environ["SENDER_EMAIL"]
GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")
IST = timezone(timedelta(hours=5, minutes=30))


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
    event = event if isinstance(event, dict) else {}

    # Date to remind about: "YYYY-MM-DD". Default is tomorrow in India time.
    target = event.get("date") or (datetime.now(IST) + timedelta(days=1)).strftime("%Y-%m-%d")

    todays_events = events.scan(FilterExpression=Attr("date").begins_with(target))["Items"]
    sent, failed = 0, 0

    for ev in todays_events:
        rows = bookings.scan(FilterExpression=Attr("eventId").eq(ev["eventId"]))["Items"]
        emails = {r["userEmail"] for r in rows if "@" in r.get("userEmail", "")}

        for email in emails:
            ok = send_email(
                email,
                "Reminder: " + ev["title"] + " is tomorrow",
                "This is a reminder for your upcoming event.\n\n"
                "Event: " + ev["title"] + "\n"
                "Date: " + ev["date"] + "\n"
                "Venue: " + ev["venue"] + "\n",
            )
            if ok:
                sent += 1
            else:
                failed += 1

    result = {"date": target, "events": len(todays_events), "sent": sent, "failed": failed}
    print(result)
    return result
