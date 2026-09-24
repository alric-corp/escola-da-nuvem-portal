import json
import unittest

from identity import handler


def event(**claims):
    return {
        "routeKey": "GET /me",
        "requestContext": {"authorizer": {"jwt": {"claims": {
            "sub": "user-123", "token_use": "access", "scope": "openid portal/access", **claims,
        }}}},
    }


class IdentityTests(unittest.TestCase):
    def test_no_authorizer_is_denied(self):
        self.assertEqual(handler({"routeKey": "GET /me"}, None)["statusCode"], 401)

    def test_identity_token_is_denied(self):
        self.assertEqual(handler(event(token_use="id"), None)["statusCode"], 401)

    def test_missing_scope_is_denied(self):
        self.assertEqual(handler(event(scope="openid"), None)["statusCode"], 403)

    def test_institutional_email_grants_no_role(self):
        result = handler(event(email="pessoa@escoladanuvem.org"), None)
        self.assertEqual(json.loads(result["body"])["roles"], [])

    def test_query_and_body_cannot_select_identity_or_role(self):
        request = event()
        request.update(queryStringParameters={"sub": "other", "role": "admin"}, body='{"role":"admin"}')
        result = handler(request, None)
        self.assertEqual(json.loads(result["body"]), {"userId": "user-123", "roles": []})
        self.assertEqual(result["headers"]["Cache-Control"], "no-store")

    def test_known_roles_from_authorizer_only(self):
        for groups in (["instructor", "unknown"], '["instructor", "unknown"]', '[instructor unknown]'):
            with self.subTest(groups=groups):
                result = handler(event(**{"cognito:groups": groups}), None)
                self.assertEqual(json.loads(result["body"])["roles"], ["instructor"])

    def test_unknown_route_is_denied(self):
        request = event()
        request["routeKey"] = "GET /students"
        self.assertEqual(handler(request, None)["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
