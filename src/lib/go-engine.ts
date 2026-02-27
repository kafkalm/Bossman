export function getGoEngineURL(): string {
  return process.env.GO_ENGINE_URL ?? "http://localhost:8080";
}

