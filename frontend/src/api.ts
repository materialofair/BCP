import type {
  Dashboard,
  News,
  ScanJob,
  Site,
  SourceStatus,
  Supplier,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `服务返回 ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function list<T>(data: T[] | { items?: T[]; results?: T[] }): T[] {
  if (Array.isArray(data)) return data;
  return data.items || data.results || [];
}

export const api = {
  dashboard: () => request<Dashboard>("/api/dashboard"),
  sites: async () =>
    list(await request<Site[] | { items: Site[] }>("/api/sites")),
  news: async () =>
    list(await request<News[] | { items: News[] }>("/api/news")),
  events: async () =>
    list(await request<News[] | { items: News[] }>("/api/events")),
  suppliers: async () =>
    list(await request<Supplier[] | { items: Supplier[] }>("/api/suppliers")),
  scanJobs: async () =>
    list(await request<ScanJob[] | { items: ScanJob[] }>("/api/scan-jobs")),
  sourceStatus: () => request<SourceStatus>("/api/source-status"),
  updateSupplier: (
    id: number | string,
    data: Partial<Pick<Supplier, "name" | "aliases" | "website" | "monitored">>,
  ) =>
    request<Supplier>(`/api/suppliers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateSite: (
    id: number | string,
    data: Partial<
      Pick<
        Site,
        "name" | "city" | "country" | "latitude" | "longitude" | "site_type"
      >
    > & { materials?: string },
  ) =>
    request<Site>(`/api/sites/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  reviewEvent: (
    id: number | string,
    status: string,
    reason: string,
    riskLevel?: string,
  ) =>
    request<News>(`/api/events/${encodeURIComponent(id)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        reason,
        ...(riskLevel ? { risk_level: riskLevel } : {}),
      }),
    }),
  startScan: () => request<ScanJob>("/api/scan-jobs", { method: "POST" }),
  importSuppliers: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Record<string, unknown>>("/api/suppliers/import", {
      method: "POST",
      body: form,
    });
  },
};
