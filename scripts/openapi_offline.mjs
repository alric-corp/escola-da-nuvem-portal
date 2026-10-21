// Loaded only in the development-time Redocly subprocess, never in the portal runtime.
import net from "node:net";

function denyNetwork() {
  throw new Error("Referências de rede não são permitidas no bundle OpenAPI; utilize somente arquivos locais.");
}

globalThis.fetch = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
