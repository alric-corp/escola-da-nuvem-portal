"""SES contract tests with botocore Stubber: never contacts AWS or sends email."""
import os
import pathlib
import sys
import unittest
from unittest.mock import patch
from botocore.stub import Stubber

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from reminders import SESMailer, SendFailure


class SESContractTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "testing",
            "AWS_SECRET_ACCESS_KEY": "testing", "REMINDER_CONFIGURATION_SET": "test-reminders"})
        env.start()
        self.addCleanup(env.stop)
        self.mailer = SESMailer()
        self.stub = Stubber(self.mailer.client)
        self.stub.activate()
        self.addCleanup(self.stub.deactivate)
        self.message = {"to": "student@example.test", "replyTo": "teacher@example.test", "subject": "Olá",
            "text": "Precisa de auxílio?", "from": "teacher@example.test"}
        self.params = {"FromEmailAddress": "teacher@example.test", "Destination": {"ToAddresses": ["student@example.test"]},
            "ReplyToAddresses": ["teacher@example.test"], "ConfigurationSetName": "test-reminders",
            "Content": {"Simple": {"Subject": {"Data": "Olá", "Charset": "UTF-8"}, "Body": {"Text": {"Data": "Precisa de auxílio?", "Charset": "UTF-8"}}}}}

    def test_sandbox_unverified_and_suspended_accounts_block_sending(self):
        for production, verified, enabled in ((False, True, True), (True, False, True), (True, True, False), (True, True, True)):
            self.stub.add_response("get_account", {"ProductionAccessEnabled": production, "SendingEnabled": enabled}, {})
            self.stub.add_response("get_email_identity", {"IdentityType": "EMAIL_ADDRESS", "VerifiedForSendingStatus": verified}, {"EmailIdentity": "teacher@example.test"})
            self.assertEqual(self.mailer.readiness("teacher@example.test")["ready"], production and verified and enabled)
        self.stub.assert_no_pending_responses()

    def test_ensure_identity_creates_only_when_missing(self):
        self.stub.add_response("get_email_identity", {"IdentityType": "EMAIL_ADDRESS", "VerifiedForSendingStatus": True}, {"EmailIdentity": "teacher@example.test"})
        self.mailer.ensure_identity("teacher@example.test")
        self.stub.assert_no_pending_responses()
        self.stub.add_client_error("get_email_identity", service_error_code="NotFoundException", http_status_code=404,
            expected_params={"EmailIdentity": "new@example.test"})
        self.stub.add_response("create_email_identity", {"IdentityType": "EMAIL_ADDRESS", "VerifiedForSendingStatus": False}, {"EmailIdentity": "new@example.test"})
        self.mailer.ensure_identity("new@example.test")
        self.stub.assert_no_pending_responses()

    def test_sends_to_one_recipient_with_reply_to_and_utf8(self):
        self.stub.add_response("send_email", {"MessageId": "test-id"}, self.params)
        self.assertEqual(self.mailer.send(self.message), "test-id")
        self.assertEqual(self.mailer.client.meta.config.retries["total_max_attempts"], 1)
        self.stub.assert_no_pending_responses()

    def test_rejection_and_uncertain_errors_are_distinguished(self):
        for code, status, uncertain in (("MessageRejected", 400, False), ("TooManyRequestsException", 429, False), ("InternalServiceError", 500, True)):
            self.stub.add_client_error("send_email", service_error_code=code, http_status_code=status, expected_params=self.params)
            with self.assertRaises(SendFailure) as err: self.mailer.send(self.message)
            self.assertEqual(err.exception.uncertain, uncertain)
        self.stub.assert_no_pending_responses()
