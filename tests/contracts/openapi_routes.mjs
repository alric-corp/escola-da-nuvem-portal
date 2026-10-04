// JSON bridge for the Python contract test; reuse the existing YAML adapter.
import { parseContract, operations } from "./openapi.mjs";

process.stdout.write(JSON.stringify(operations(parseContract()).map(({ method, path, operation }) => ({
  method: method.toUpperCase(),
  path,
  handler: operation["x-portal-backend-operation"],
}))));
