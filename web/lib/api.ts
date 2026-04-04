export function getApiBase(): string {
  const u = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:8000";
}

export async function apiFetch(
  path: string,
  token: string | null,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const body = init?.body;
  if (
    body &&
    !(body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}

export function parseApiError(data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((e) => (typeof e === "object" && e && "msg" in e ? String((e as { msg: unknown }).msg) : String(e)))
        .join(", ");
    }
  }
  return "Request failed";
}
