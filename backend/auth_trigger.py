"""Gatilho Cognito "pre token generation" (evento V2_0).

Inclui email e email_verified no access token para que o backend (portal.py:authenticate)
não precise chamar /oauth2/userInfo em toda requisição. Não toca no id_token nem em nenhum
outro dado da conta; é chamado pelo próprio Cognito, nunca pela API do portal.
"""


def handler(event, context):
    attributes = event.get("request", {}).get("userAttributes", {})
    event["response"] = {
        "claimsAndScopeOverrideDetails": {
            "accessTokenGeneration": {
                "claimsToAddOrOverride": {
                    "email": attributes.get("email", ""),
                    "email_verified": attributes.get("email_verified", "false"),
                }
            }
        }
    }
    return event
