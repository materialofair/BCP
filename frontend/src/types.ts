export type RiskLevel = "critical" | "high" | "medium" | "low" | "unknown";

export interface Site {
  id: number | string;
  supplier_id: number | string;
  name: string;
  supplier_name: string;
  city?: string | null;
  country?: string | null;
  longitude: number | null;
  latitude: number | null;
  materials?: string[] | string | null;
  risk_level?: string | null;
  risk_summary?: string | null;
  supplier_risk_level?: string | null;
  supplier_risk_summary?: string | null;
  last_scan?: string | null;
  site_type?: string | null;
  risk_scope?: string | null;
  verification?: string | null;
  is_demo?: boolean;
}

export interface News {
  id: number | string;
  title: string;
  source?: string | null;
  published_at?: string | null;
  risk_level?: string | null;
  supplier_name?: string | null;
  supplier_id?: number | string | null;
  site_id?: number | string | null;
  summary?: string | null;
  url?: string | null;
  verification?: string | null;
  category?: string | null;
  status?: string | null;
  match_reason?: string | null;
  matching_reason?: string | null;
  is_demo?: boolean;
}

export interface Dashboard {
  suppliers?: number;
  total_sites?: number;
  high_risk?: number;
  open_events?: number;
  last_scan?: string | null;
  status?: string | null;
  demo_mode?: boolean;
}

export interface Supplier {
  id: number | string;
  name: string;
  aliases?: string | null;
  website?: string | null;
  monitored?: boolean;
  is_demo?: boolean;
  site_count?: number;
  country?: string | null;
  materials?: string[] | string | null;
}

export interface ScanJob {
  id: number | string;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  error?: string | null;
  errors?: string | string[] | null;
  articles_found?: number | null;
  events_created?: number | null;
}

export type SourceStatus =
  | Record<string, unknown>
  | Array<{ name?: string; status?: string; last_success?: string | null }>;

export function normalizedRisk(level?: string | null): RiskLevel {
  const value = (level || "").trim().toLowerCase();
  if (["critical", "severe", "red", "严重", "极高"].includes(value))
    return "critical";
  if (["high", "orange", "较高", "高"].includes(value)) return "high";
  if (["medium", "moderate", "warning", "yellow", "关注", "中"].includes(value))
    return "medium";
  if (["low", "normal", "green", "低", "正常", "无风险"].includes(value))
    return "low";
  return "unknown";
}

export function hasCompanyRiskRing(
  site: Pick<Site, "risk_level" | "supplier_risk_level">,
): boolean {
  const company = normalizedRisk(site.supplier_risk_level);
  return company !== "unknown" && company !== normalizedRisk(site.risk_level);
}

export const riskMeta: Record<
  RiskLevel,
  { label: string; color: string; order: number }
> = {
  critical: { label: "严重风险", color: "#f26c73", order: 0 },
  high: { label: "较高风险", color: "#f7aa60", order: 1 },
  medium: { label: "需要关注", color: "#e6c56e", order: 2 },
  low: { label: "暂未发现", color: "#53c8a3", order: 3 },
  unknown: { label: "未评估", color: "#8095ab", order: 4 },
};

export function materialsText(value?: string[] | string | null): string {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || "未录入";
  return value || "未录入";
}

export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

export function safeHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
