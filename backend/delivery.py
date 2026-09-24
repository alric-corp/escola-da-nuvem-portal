"""Eventos SES recebidos exclusivamente pelo tópico SNS autorizado na Lambda."""
import json
import os

from repository import Conflict, Repository

STATES = {"DeliveryDelay": "delayed", "Delivery": "delivered", "Reject": "rejected",
          "Bounce": "bounced", "Complaint": "complained"}
PRIORITY = {"delayed": 1, "delivered": 2, "rejected": 3, "bounced": 4, "complained": 5}


def record_event(repo, event):
    state = STATES.get(event.get("eventType"))
    message_id = event.get("mail", {}).get("messageId")
    if not state or not isinstance(message_id, str) or not message_id or len(message_id) > 200:
        return
    pk = "EMAIL#" + message_id
    # Eventos duplicados e fora de ordem não fazem uma falha virar sucesso.
    for _ in range(3):
        previous = repo.get(pk, "DELIVERY")
        if previous and PRIORITY.get(previous["status"], 0) >= PRIORITY[state]:
            return
        timestamp = event.get(event["eventType"][0].lower() + event["eventType"][1:], {}).get("timestamp")
        record = {"status": state, "eventAt": timestamp or event.get("mail", {}).get("timestamp")}
        try:
            repo.transaction([(pk, "DELIVERY", record, previous)])
            return
        except Conflict:
            continue
    raise Conflict()


def handler(event, context):
    repo = Repository()
    for record in event.get("Records", []):
        sns = record.get("Sns", {})
        if record.get("EventSource") != "aws:sns" or sns.get("TopicArn") != os.environ["REMINDER_EVENTS_TOPIC"]:
            raise ValueError("Origem de evento não autorizada")
        record_event(repo, json.loads(sns["Message"]))
