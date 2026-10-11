# EventBook: Serverless Event Booking on AWS

A fully serverless web application where users create an account, browse upcoming events, and book a seat. Each booking sends a confirmation email, alerts the admin, and a nightly job emails reminders for the next day's events.

Built by **Sameer Naik** ([@Sameern10](https://github.com/Sameern10)) as an AWS course project. Everything was set up in the AWS Management Console, with no servers to manage and no DevOps tooling (CI/CD or Infrastructure as Code) in scope.

**Live demo:** d3o08tjopv06x.cloudfront.net

## Architecture

!\[Architecture diagram](docs/architecture.svg)

### How a booking works

1. The user logs in through **Amazon Cognito** on the website (hosted on **S3 + CloudFront**).
2. Clicking **Book now** calls **API Gateway**, which checks the user's Cognito token (JWT authorizer) and runs the `createBooking` **Lambda**.
3. `createBooking` reduces the seat count in **DynamoDB** (only if seats are left, so the event can't be overbooked), saves the booking, and puts an email job in an **SQS** queue. The user gets a response straight away.
4. `startBookingWorkflow` reads the queue and starts an **AWS Step Functions** workflow.
5. The workflow calls `sendBookingEmail` (with up to 3 retries), then publishes an **SNS** alert to the admin. If the email still fails, the admin gets a failure alert instead.
6. Every evening, **EventBridge** triggers `sendReminders`, which emails everyone who booked an event happening the next day.
7. **CloudWatch** collects logs for every Lambda, and **IAM** controls what each service can do.

## AWS services used

|Service|Purpose|
|-|-|
|S3 + CloudFront|Hosts the website (private bucket, served through CloudFront)|
|Cognito|Sign up, email verification, login, and JWT tokens|
|API Gateway (HTTP API)|`GET /events` (public) and `POST /bookings` (protected)|
|Lambda|All backend logic (Python)|
|DynamoDB|`Events` and `Bookings` tables (on-demand capacity)|
|SQS (+ dead-letter queue)|Buffers email jobs so a slow email never slows a booking|
|Step Functions|Booking workflow with retries and error handling|
|SNS|Email alerts to the admin|
|EventBridge Scheduler|Nightly reminder job|
|SES|Fallback email sender|
|CloudWatch, IAM|Logging and permissions|

## Screenshots

**Website: events with category filters and search**

!\[Website](docs/screenshots/01-website.png)

**Create account and log in (Cognito)**

|Create account|Log in|
|-|-|
|!\[Create account](docs/screenshots/02-create-account-page.png)|!\[Log in](docs/screenshots/02-login-page.png)|

**Booking confirmation email**

!\[Confirmation email](docs/screenshots/03-confirmation-email.png)

**Step Functions: booking workflow definition and graph**

!\[Step Functions workflow](docs/screenshots/04-stepfunctions-graph.png)

**Step Functions: a successful execution**

!\[Step Functions execution](docs/screenshots/05-stepfunctions-executions.png)

**SQS: booking-emails queue monitoring**

!\[SQS monitoring](docs/screenshots/06-sqs-monitoring.png)

**DynamoDB: Bookings table**

!\[DynamoDB Bookings](docs/screenshots/07-dynamodb-bookings.png)

**EventBridge: nightly reminder schedule**

!\[EventBridge schedule](docs/screenshots/08-eventbridge-schedule.png)

**Cognito: user pool**

!\[Cognito user pool](docs/screenshots/09-cognito-users.png)

## Project structure

```
serverless-event-booking-aws/
├── frontend/        Website: index.html, style.css, app.js, images/
├── backend/         Lambda functions (Python)
│   ├── getEvents.py
│   ├── createBooking.py
│   ├── startBookingWorkflow.py
│   ├── sendBookingEmail.py
│   └── sendReminders.py
├── workflow/        Step Functions definition (booking-workflow.asl.json)
├── data/            Sample events for DynamoDB (sample-events.json)
└── docs/            Architecture diagram, screenshots, project report (PDF)
```

## Setup (AWS Console, region us-east-2)

1. **DynamoDB:** create `Events` (partition key `eventId`, String) and `Bookings` (partition key `bookingId`, String), both on-demand. Load the sample data:
`aws dynamodb batch-write-item --region us-east-2 --request-items file://data/sample-events.json`
2. **Cognito:** create a user pool (email sign-in) with a public app client (no secret) and enable the `ALLOW\_USER\_PASSWORD\_AUTH` flow.
3. **Lambda:** create the five functions from `backend/` (Python). Give them a role with DynamoDB, SQS, Step Functions, SNS, SES and basic logging permissions. Set the environment variables listed below, and raise the timeout to 15 to 30 seconds on the email functions.
4. **API Gateway:** create an HTTP API with `GET /events` → `getEvents` and `POST /bookings` → `createBooking`. Add a JWT authorizer (issuer `https://cognito-idp.us-east-2.amazonaws.com/<USER\_POOL\_ID>`, audience = app client ID) to `POST /bookings` only, and enable CORS (origins `\*`, headers `content-type` and `authorization`, methods `GET, POST, OPTIONS`).
5. **SQS:** create the queue `booking-emails` with a dead-letter queue (`booking-emails-dlq`, max receives 3) and add it as the trigger for `startBookingWorkflow`.
6. **SNS:** create a Standard topic `booking-alerts` and subscribe your email.
7. **Step Functions:** create a Standard state machine from `workflow/booking-workflow.asl.json` (replace `ACCOUNT\_ID` with your AWS account ID).
8. **EventBridge Scheduler:** create a daily cron schedule that invokes `sendReminders`.
9. **Frontend:** set `API` and `CLIENT\_ID` at the top of `frontend/app.js`, upload `frontend/` to a private S3 bucket, and serve it with a CloudFront distribution (origin access control, default root object `index.html`).

### Lambda environment variables

|Variable|Used by|Value|
|-|-|-|
|`QUEUE\_URL`|createBooking|URL of the `booking-emails` queue|
|`STATE\_MACHINE\_ARN`|startBookingWorkflow|ARN of the `booking-workflow` state machine|
|`SENDER\_EMAIL`|sendBookingEmail, sendReminders|A sender address verified in SES|
|`GMAIL\_USER`|sendBookingEmail, sendReminders|The Gmail address used to send mail|
|`GMAIL\_APP\_PASSWORD`|sendBookingEmail, sendReminders|A Gmail app password (**never commit this**)|

## About the email setup

New AWS accounts start in the **SES sandbox**, where SES only sends to addresses you have verified one by one. To let any registered user receive a confirmation, the Lambda sends through **Gmail SMTP** (using an app password stored as an environment variable) and falls back to **SES** if Gmail fails. A production system would instead use SES in production mode with a verified domain.

## Limitations and ideas for improvement

* Move the Gmail credentials into AWS Secrets Manager (or SSM Parameter Store) instead of environment variables.
* Use SES in production mode with a verified domain and DKIM, and drop Gmail.
* Add a **forgot password** flow (Cognito supports reset codes).
* Add a **My bookings** page and an **admin** page for creating events and uploading posters to S3.
* The reminder job scans the tables, which is fine at this size. A global secondary index on the event date would scale better.
* Add API throttling and a budget alert, and restrict the CORS origin to the CloudFront domain.
* Define the infrastructure as code (for example AWS SAM or Terraform) once DevOps is in scope.

## Author

**Sameer Naik**: [github.com/Sameern10](https://github.com/Sameern10)

