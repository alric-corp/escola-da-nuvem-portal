# Valores avaliados pelo Terraform, sem parser HCL nos testes Node/Python.
mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = {
      partition  = "aws"
      dns_suffix = "amazonaws.com"
    }
  }
}
mock_provider "archive" {}

variables {
  manual_recovery_operator_arn = ""
  aws_account_id               = "123456789012"
  cognito_sender_email         = "portal@example.test"
  canvas_sync_enabled          = false
}

override_resource {
  target          = aws_apigatewayv2_api.portal
  override_during = plan
  values = {
    id            = "api-test"
    execution_arn = "arn:aws:execute-api:us-east-1:123456789012:api-test"
  }
}
override_resource {
  target          = aws_apigatewayv2_authorizer.portal
  override_during = plan
  values          = { id = "authorizer-test" }
}
override_resource {
  target          = aws_apigatewayv2_integration.identity
  override_during = plan
  values          = { id = "integration-test" }
}

run "openapi_routes" {
  command = plan

  assert {
    condition     = length(local.openapi_operations) == 35 && length(local.routes) == 35
    error_message = "A baseline API-1 contém exatamente 35 operações HTTP."
  }
  assert {
    condition = (
      length(local.portal_routes) == 34 && length(aws_apigatewayv2_route.portal) == 34
      && !contains(keys(aws_apigatewayv2_route.portal), "GET /me")
      && aws_apigatewayv2_route.me.route_key == local.routes["GET /me"].route_key
    )
    error_message = "GET /me mantém seu address; portal mantém as outras 34 instâncias."
  }
  assert {
    # Fingerprint das chaves ordenadas em c64921b (API-1); não é lista de provisionamento.
    condition = sha256(jsonencode(sort(concat(
      [aws_apigatewayv2_route.me.route_key], keys(aws_apigatewayv2_route.portal)
    )))) == "c30736ca652e8d28253caba8b0e986730812b3a3163ddd37666826f2471d1af6"
    error_message = "Método/path/placeholders divergem das chaves da API-1."
  }
  assert {
    condition = toset(concat([aws_apigatewayv2_route.me.route_key], keys(aws_apigatewayv2_route.portal))) == toset(flatten([
      for path, item in local.openapi_spec.paths : [
        for method, operation in item : "${upper(method)} ${path}"
        if contains(["get", "post", "put", "patch", "delete", "head", "options"], method)
      ]
    ]))
    error_message = "Recursos avaliados devem corresponder às operações; metadata não é rota."
  }
  assert {
    condition = alltrue(flatten([
      for path, item in local.openapi_spec.paths : [
        for method, operation in item : (
          merge({ "GET /me" = aws_apigatewayv2_route.me }, aws_apigatewayv2_route.portal)["${upper(method)} ${path}"].authorization_type
          == (length(try(operation.security, local.openapi_spec.security, [])) == 0 ? "NONE" : "JWT")
          && merge({ "GET /me" = aws_apigatewayv2_route.me }, aws_apigatewayv2_route.portal)["${upper(method)} ${path}"].authorization_scopes
          == toset(try(operation["x-portal-authorization-scopes"], []))
        ) if contains(["get", "post", "put", "patch", "delete", "head", "options"], method)
      ]
    ]))
    error_message = "JWT/scopes dos recursos avaliados devem vir da operação OpenAPI."
  }
  assert {
    condition = alltrue([for route in concat([aws_apigatewayv2_route.me], values(aws_apigatewayv2_route.portal)) :
      route.authorization_type == "JWT" && route.authorization_scopes == toset(["portal/access"])
      && route.authorizer_id == aws_apigatewayv2_authorizer.portal.id
      && route.api_id == aws_apigatewayv2_api.portal.id
      && route.target == "integrations/${aws_apigatewayv2_integration.identity.id}"
    ])
    error_message = "A baseline mantém JWT, portal/access e as referências de ambiente existentes."
  }
}
