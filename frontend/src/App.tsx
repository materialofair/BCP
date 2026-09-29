import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  FileUp,
  Globe2,
  Layers3,
  ListFilter,
  MapPin,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import OfflineMap from "./OfflineMap";
import EditRecordForm, { type EditTarget } from "./EditRecordForm";
import { api } from "./api";
import {
  formatDate,
  materialsText,
  normalizedRisk,
  riskMeta,
  safeHttpUrl,
  type Dashboard,
  type News,
  type RiskLevel,
  type ScanJob,
  type Site,
  type SourceStatus,
  type Supplier,
} from "./types";

type Detail =
  { kind: "site"; site: Site } | { kind: "news"; news: News } | null;
type Tab = "overview" | "suppliers" | "jobs";

const riskFilters: Array<{ value: RiskLevel | "all"; label: string }> = [
  { value: "all", label: "全部风险" },
  { value: "critical", label: "严重风险" },
  { value: "high", label: "较高风险" },
  { value: "medium", label: "需要关注" },
  { value: "low", label: "暂未发现" },
  { value: "unknown", label: "未评估" },
];

function RiskPill({
  level,
  small = false,
}: {
  level?: string | null;
  small?: boolean;
}) {
  const risk = normalizedRisk(level);
  return (
    <span className={`risk-pill risk-${risk}${small ? " risk-pill-sm" : ""}`}>
      <span className="risk-dot" />
      {riskMeta[risk].label}
    </span>
  );
}

function statusLabel(value?: string | null) {
  switch ((value || "").toLowerCase()) {
    case "completed":
    case "success":
      return "已完成";
    case "running":
    case "in_progress":
      return "采集中";
    case "pending":
    case "queued":
      return "等待中";
    case "failed":
    case "error":
      return "失败";
    case "partial":
      return "部分完成";
    case "no_sources":
      return "暂无可扫描企业/来源";
    case "not_scanned":
      return "尚未扫描";
    case "rate_limited":
      return "来源限流";
    case "open":
      return "待处理";
    case "reviewing":
      return "核实中";
    case "confirmed":
      return "已确认";
    case "false_positive":
      return "误报";
    case "resolved":
      return "已解除";
    default:
      return value || "未知";
  }
}

function getSourceSummary(sourceStatus: SourceStatus | null): string {
  if (!sourceStatus) return "来源状态暂不可用";
  if (Array.isArray(sourceStatus)) {
    const ok = sourceStatus.filter((s) =>
      ["active", "ok", "healthy", "connected", "success"].includes(
        (s.status || "").toLowerCase(),
      ),
    ).length;
    return `${ok}/${sourceStatus.length} 个来源可用`;
  }
  if (typeof sourceStatus.message === "string") return sourceStatus.message;
  if (typeof sourceStatus.status === "string")
    return `来源状态：${statusLabel(sourceStatus.status)}`;
  if (Array.isArray(sourceStatus.sources)) {
    const sources = sourceStatus.sources as Array<{ status?: string }>;
    const ok = sources.filter((s) =>
      ["active", "ok", "healthy", "connected"].includes(
        (s.status || "").toLowerCase(),
      ),
    ).length;
    return `${ok}/${sources.length} 个来源可用`;
  }
  return "已连接来源状态接口";
}

function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [events, setEvents] = useState<News[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [failedApis, setFailedApis] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<Detail>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [materialFilter, setMaterialFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [eventStatusFilter, setEventStatusFilter] = useState("active");
  const [timeFilter, setTimeFilter] = useState("all");
  const [activeNews, setActiveNews] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const calls = [
      api.dashboard(),
      api.sites(),
      api.news(),
      api.events(),
      api.suppliers(),
      api.scanJobs(),
      api.sourceStatus(),
    ];
    const results = await Promise.allSettled(calls);
    const names = [
      "看板",
      "地点",
      "新闻",
      "事件",
      "供应商",
      "采集任务",
      "来源状态",
    ];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.push(names[index]);
        return;
      }
      switch (index) {
        case 0:
          setDashboard(result.value as Dashboard);
          break;
        case 1:
          setSites(result.value as Site[]);
          break;
        case 2:
          setNews(result.value as News[]);
          break;
        case 3:
          setEvents(result.value as News[]);
          break;
        case 4:
          setSuppliers(result.value as Supplier[]);
          break;
        case 5:
          setJobs(result.value as ScanJob[]);
          break;
        case 6:
          setSourceStatus(result.value as SourceStatus);
          break;
      }
    });
    setFailedApis(failed);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (carouselPaused || news.length < 2) return;
    const timer = window.setInterval(
      () => setActiveNews((value) => (value + 1) % news.length),
      8000,
    );
    return () => window.clearInterval(timer);
  }, [carouselPaused, news.length]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (
      selectedSupplierId &&
      !suppliers.some((supplier) => String(supplier.id) === selectedSupplierId)
    ) {
      setSelectedSupplierId("");
    }
  }, [selectedSupplierId, suppliers]);

  const materials = useMemo(
    () =>
      [
        ...new Set(
          sites
            .flatMap((site) =>
              Array.isArray(site.materials)
                ? site.materials
                : site.materials
                  ? site.materials.split(/[,，、]/)
                  : [],
            )
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [sites],
  );
  const countries = useMemo(
    () =>
      [
        ...new Set(
          sites
            .map((site) => site.country)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    [sites],
  );

  const filteredSites = useMemo(
    () =>
      sites.filter((site) => {
        const query = search.trim().toLocaleLowerCase();
        const searchMatch =
          !query ||
          [
            site.supplier_name,
            site.name,
            site.city,
            site.country,
            materialsText(site.materials),
          ].some((x) => (x || "").toLocaleLowerCase().includes(query));
        const riskMatch =
          riskFilter === "all" ||
          normalizedRisk(site.risk_level) === riskFilter ||
          normalizedRisk(site.supplier_risk_level) === riskFilter;
        const materialMatch =
          materialFilter === "all" ||
          materialsText(site.materials).includes(materialFilter);
        const countryMatch =
          countryFilter === "all" || site.country === countryFilter;
        return searchMatch && riskMatch && materialMatch && countryMatch;
      }),
    [sites, search, riskFilter, materialFilter, countryFilter],
  );

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        const riskDiff =
          riskMeta[normalizedRisk(a.risk_level)].order -
          riskMeta[normalizedRisk(b.risk_level)].order;
        return (
          riskDiff ||
          (Date.parse(b.published_at || "") || 0) -
            (Date.parse(a.published_at || "") || 0)
        );
      }),
    [events],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(
          events
            .map((event) => event.category)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    [events],
  );
  const headlineItems = useMemo(
    () =>
      [...news].sort((a, b) => {
        const riskDiff =
          riskMeta[normalizedRisk(a.risk_level)].order -
          riskMeta[normalizedRisk(b.risk_level)].order;
        return (
          riskDiff ||
          (Date.parse(b.published_at || "") || 0) -
            (Date.parse(a.published_at || "") || 0)
        );
      }),
    [news],
  );
  const visibleEvents = sortedEvents.filter((event) => {
    if (riskFilter !== "all" && normalizedRisk(event.risk_level) !== riskFilter)
      return false;
    if (categoryFilter !== "all" && event.category !== categoryFilter)
      return false;
    if (
      eventStatusFilter === "active" &&
      !["open", "reviewing", "confirmed"].includes(event.status || "open")
    )
      return false;
    if (
      eventStatusFilter !== "all" &&
      eventStatusFilter !== "active" &&
      event.status !== eventStatusFilter
    )
      return false;
    if (timeFilter !== "all") {
      const published = Date.parse(event.published_at || "");
      if (
        !Number.isFinite(published) ||
        published < Date.now() - Number(timeFilter) * 86_400_000
      )
        return false;
    }
    const query = search.trim().toLocaleLowerCase();
    return (
      !query ||
      [event.title, event.supplier_name, event.summary].some((x) =>
        (x || "").toLocaleLowerCase().includes(query),
      )
    );
  });
  const headline =
    headlineItems[activeNews % Math.max(headlineItems.length, 1)];
  const locatedCount = sites.filter(
    (site) => Number.isFinite(site.latitude) && Number.isFinite(site.longitude),
  ).length;
  const scanning = jobs.some((job) =>
    ["running", "in_progress", "pending", "queued"].includes(
      (job.status || "").toLowerCase(),
    ),
  );
  const demo = Boolean(
    dashboard?.demo_mode || sites.some((site) => site.is_demo),
  );

  async function startScan() {
    setBusy(true);
    try {
      await api.startScan();
      setToast("已创建扫描任务，结果将自动更新。");
      await refresh();
    } catch (error) {
      setToast(
        `启动扫描失败：${error instanceof Error ? error.message : "请检查服务状态"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const result = await api.importSuppliers(file);
      const created =
        typeof result.created === "number" ? result.created : null;
      const updated =
        typeof result.updated === "number" ? result.updated : null;
      const errors = Array.isArray(result.errors) ? result.errors.length : 0;
      setToast(
        created === null
          ? "导入已完成。"
          : `新增 ${created} 条，更新 ${updated ?? 0} 条${errors ? `，${errors} 条有误` : ""}。`,
      );
      await refresh();
    } catch (error) {
      setToast(
        `导入失败：${error instanceof Error ? error.message : "请检查文件格式"}`,
      );
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function openNews(item: News) {
    setDetail({ kind: "news", news: item });
  }

  function downloadTemplate() {
    const anchor = document.createElement("a");
    anchor.href = "/api/supplier-import-template.xlsx";
    anchor.download = "供应商导入模板.xlsx";
    anchor.click();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Layers3 size={22} strokeWidth={2} />
          </div>
          <div>
            <span className="brand-title">
              封装材料<span>风险雷达</span>
            </span>
            <span className="brand-subtitle">SUPPLY CHAIN INTELLIGENCE</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
            type="button"
          >
            <Globe2 size={16} />
            风险总览
          </button>
          <button
            className={tab === "suppliers" ? "active" : ""}
            onClick={() => setTab("suppliers")}
            type="button"
          >
            <Database size={16} />
            供应商台账
          </button>
          <button
            className={tab === "jobs" ? "active" : ""}
            onClick={() => setTab("jobs")}
            type="button"
          >
            <Activity size={16} />
            采集任务
          </button>
        </nav>
        <div className="topbar-right">
          <span
            className={`connection-indicator ${failedApis.length ? "connection-warning" : ""}`}
          >
            <span />
            {failedApis.length ? "服务异常" : "本地数据服务"}
          </span>
          <button
            type="button"
            className="icon-button refresh-button"
            onClick={() => void refresh()}
            title="刷新数据"
            aria-label="刷新数据"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <main>
        <div className="page-intro">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> GLOBAL SUPPLY NETWORK /
              全球供应网络
            </div>
            <h1>
              {tab === "overview"
                ? "供应链风险态势"
                : tab === "suppliers"
                  ? "供应商台账"
                  : "采集任务与来源"}
            </h1>
            <p>
              {tab === "overview"
                ? "追踪封装材料供应地点，及时识别可能影响交付的外部事件。"
                : tab === "suppliers"
                  ? "管理供应商及供货地点，确保地图位置与材料信息准确。"
                  : "查看新闻采集进度、运行记录和来源覆盖情况。"}
            </p>
          </div>
          <div className="intro-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <FileUp size={17} />
              导入 Excel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void startScan()}
              disabled={busy || scanning}
            >
              <Radar size={17} />
              {scanning ? "扫描进行中" : "立即扫描"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
              }}
              aria-label="选择供应商 Excel（.xlsx）文件"
            />
          </div>
        </div>

        {failedApis.length > 0 && (
          <div className="notice notice-warning" role="alert">
            <AlertCircle size={17} />
            <span>
              部分数据暂不可用：{failedApis.join("、")}
              。页面保留上次成功获取的内容。
            </span>
            <button type="button" onClick={() => void refresh()}>
              重试 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {demo && (
          <div className="notice notice-demo">
            <AlertCircle size={17} />
            <span>
              当前为演示数据，供应商和新闻均为虚构示例，不能用于实际风险决策。
            </span>
          </div>
        )}

        {tab === "overview" && (
          <>
            <section
              className="headline-panel"
              aria-label="重点新闻"
              onMouseEnter={() => setCarouselPaused(true)}
              onMouseLeave={() => setCarouselPaused(false)}
              onFocus={() => setCarouselPaused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setCarouselPaused(false);
              }}
            >
              <div className="headline-icon">
                <Bell size={20} />
              </div>
              <div className="headline-label">
                <span>重点情报</span>
                <small>TOP SIGNALS</small>
              </div>
              <div className="headline-content">
                {headline ? (
                  <button type="button" onClick={() => openNews(headline)}>
                    <RiskPill level={headline.risk_level} small />
                    <strong>{headline.title}</strong>
                    <span className="headline-meta">
                      {headline.supplier_name || "待关联供应商"} ·{" "}
                      {formatDate(headline.published_at)}
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ) : (
                  <div className="headline-empty">
                    暂无重点新闻。完成首次扫描后，相关动态将在这里显示。
                  </div>
                )}
              </div>
              <div className="headline-controls">
                <span>
                  {news.length ? String(activeNews + 1).padStart(2, "0") : "00"}{" "}
                  <i>/</i> {String(news.length).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActiveNews((x) => (x - 1 + news.length) % news.length)
                  }
                  disabled={news.length < 2}
                  aria-label="上一条新闻"
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setCarouselPaused((x) => !x)}
                  disabled={news.length < 2}
                  aria-label={carouselPaused ? "播放新闻轮播" : "暂停新闻轮播"}
                >
                  {carouselPaused ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveNews((x) => (x + 1) % news.length)}
                  disabled={news.length < 2}
                  aria-label="下一条新闻"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>

            <section className="metrics-grid" aria-label="风险概览">
              <Metric
                icon={<Database size={20} />}
                label="监测供应商"
                value={dashboard?.suppliers ?? suppliers.length}
                foot={`${dashboard?.total_sites ?? sites.length} 个供货地点`}
                tone="blue"
              />
              <Metric
                icon={<ShieldAlert size={20} />}
                label="高风险供应商"
                value={
                  dashboard?.high_risk ??
                  new Set(
                    sites
                      .filter((site) =>
                        ["critical", "high"].includes(
                          normalizedRisk(
                            site.supplier_risk_level || site.risk_level,
                          ),
                        ),
                      )
                      .map((site) => site.supplier_id),
                  ).size
                }
                foot="需优先关注"
                tone="red"
              />
              <Metric
                icon={<Newspaper size={20} />}
                label="待处理风险事件"
                value={dashboard?.open_events ?? events.length}
                foot="查看证据与影响"
                tone="amber"
              />
              <Metric
                icon={<Clock3 size={20} />}
                label="最近一次扫描"
                value={
                  dashboard?.last_scan
                    ? formatDate(dashboard.last_scan, true)
                    : "尚未扫描"
                }
                foot={
                  dashboard?.status
                    ? `任务状态：${statusLabel(dashboard.status)}`
                    : "等待首次采集"
                }
                tone="green"
                compact
              />
            </section>

            <section className="workspace">
              <aside className="filter-panel panel">
                <div className="panel-title">
                  <div>
                    <SlidersHorizontal size={17} />
                    <h2>筛选条件</h2>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSearch("");
                      setRiskFilter("all");
                      setMaterialFilter("all");
                      setCountryFilter("all");
                      setCategoryFilter("all");
                      setEventStatusFilter("active");
                      setTimeFilter("all");
                    }}
                  >
                    重置
                  </button>
                </div>
                <label className="search-box">
                  <Search size={17} />
                  <input
                    type="search"
                    placeholder="搜索企业、地点或材料"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="搜索企业、地点或材料"
                  />
                </label>
                <div className="filter-group">
                  <span className="field-label">风险等级</span>
                  <div className="filter-options">
                    {riskFilters.map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        className={riskFilter === item.value ? "selected" : ""}
                        onClick={() => setRiskFilter(item.value)}
                      >
                        <span className={`filter-dot ${item.value}`} />
                        {item.label}
                        {riskFilter === item.value && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filter-group">
                  <label className="field-label" htmlFor="material-filter">
                    材料类别
                  </label>
                  <select
                    id="material-filter"
                    value={materialFilter}
                    onChange={(event) => setMaterialFilter(event.target.value)}
                  >
                    <option value="all">全部材料</option>
                    {materials.map((material) => (
                      <option key={material}>{material}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="field-label" htmlFor="country-filter">
                    国家 / 地区
                  </label>
                  <select
                    id="country-filter"
                    value={countryFilter}
                    onChange={(event) => setCountryFilter(event.target.value)}
                  >
                    <option value="all">全部地区</option>
                    {countries.map((country) => (
                      <option key={country}>{country}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="field-label" htmlFor="category-filter">
                    风险类型（事件）
                  </label>
                  <select
                    id="category-filter"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value="all">全部类型</option>
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="field-label" htmlFor="status-filter">
                    事件状态
                  </label>
                  <select
                    id="status-filter"
                    value={eventStatusFilter}
                    onChange={(event) =>
                      setEventStatusFilter(event.target.value)
                    }
                  >
                    <option value="active">当前风险</option>
                    <option value="all">全部状态</option>
                    {[
                      "open",
                      "reviewing",
                      "confirmed",
                      "false_positive",
                      "resolved",
                    ].map((status) => (
                      <option value={status} key={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="field-label" htmlFor="time-filter">
                    发布时间
                  </label>
                  <select
                    id="time-filter"
                    value={timeFilter}
                    onChange={(event) => setTimeFilter(event.target.value)}
                  >
                    <option value="all">全部时间</option>
                    <option value="1">近 24 小时</option>
                    <option value="7">近 7 天</option>
                    <option value="30">近 30 天</option>
                    <option value="90">近 90 天</option>
                  </select>
                </div>
                <div className="filter-summary">
                  <MapPin size={15} />
                  <span>
                    匹配 <strong>{filteredSites.length}</strong> 个地点
                  </span>
                </div>
              </aside>

              <div className="map-panel panel">
                <div className="panel-title map-panel-title">
                  <div>
                    <Globe2 size={18} />
                    <h2>全球供应地点</h2>
                    <span className="section-count">
                      {filteredSites.length} SITES
                    </span>
                  </div>
                  <span className="map-live">
                    <span />
                    本地离线地图
                  </span>
                </div>
                <OfflineMap
                  sites={filteredSites}
                  selectedSiteId={
                    detail?.kind === "site"
                      ? detail.site.id
                      : detail?.kind === "news"
                        ? (detail.news.site_id ??
                          sites.find(
                            (site) =>
                              String(site.supplier_id) ===
                              String(detail.news.supplier_id),
                          )?.id ??
                          null)
                        : null
                  }
                  onSelect={(site) => setDetail({ kind: "site", site })}
                />
                <div className="map-footer">
                  <div className="map-legend">
                    {(Object.keys(riskMeta) as RiskLevel[]).map((level) => (
                      <span key={level}>
                        <i style={{ background: riskMeta[level].color }} />
                        {riskMeta[level].label}
                      </span>
                    ))}
                  </div>
                  <span className="legend-explainer">
                    点心：地点风险 · 外圈：企业总体风险
                  </span>
                  <span className="map-coverage">
                    已定位 {locatedCount}/{sites.length} · 缺少坐标{" "}
                    {sites.length - locatedCount}
                  </span>
                </div>
              </div>

              <aside className="risk-panel panel">
                <div className="panel-title">
                  <div>
                    <ListFilter size={17} />
                    <h2>重点风险</h2>
                    <span className="section-count">
                      {visibleEvents.length}
                    </span>
                  </div>
                </div>
                <div className="risk-list">
                  {visibleEvents.length ? (
                    visibleEvents.slice(0, 12).map((event) => (
                      <button
                        className="risk-item"
                        type="button"
                        key={event.id}
                        onClick={() => openNews(event)}
                      >
                        <div className="risk-item-top">
                          <RiskPill level={event.risk_level} small />
                          <span>{formatDate(event.published_at)}</span>
                        </div>
                        <strong>{event.title}</strong>
                        <span className="risk-item-supplier">
                          <MapPin size={13} />
                          {event.supplier_name || "关联对象待核实"}
                        </span>
                        <span className="risk-item-footer">
                          {event.category || event.source || "风险事件"}
                          <ArrowUpRight size={15} />
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-panel">
                      <ShieldCheck size={28} />
                      <strong>
                        {sites.length
                          ? "当前筛选条件下暂无事件"
                          : "尚无风险事件"}
                      </strong>
                      <span>
                        {sites.length
                          ? "可调整筛选条件查看其他地点。"
                          : "导入供应商并运行扫描后，这里会显示关联证据。"}
                      </span>
                    </div>
                  )}
                </div>
              </aside>
            </section>
          </>
        )}

        {tab === "suppliers" && (
          <section className="table-panel panel">
            <div className="panel-title">
              <div>
                <Database size={18} />
                <h2>供应商及供货地点</h2>
                <span className="section-count">{sites.length} SITES</span>
              </div>
              <span className="muted">
                地点坐标用于地图定位，请核对实际供货地址。
              </span>
            </div>
            <div className="table-toolbar">
              <label className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="搜索供应商、地点、材料"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="table-actions">
                <span>共 {suppliers.length} 家供应商</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={downloadTemplate}
                >
                  下载 Excel 模板 <ArrowDownRight size={14} />
                </button>
              </div>
            </div>
            {suppliers.length > 0 && (
              <div className="supplier-manager">
                <label htmlFor="manage-supplier">供应商设置</label>
                <select
                  id="manage-supplier"
                  value={selectedSupplierId}
                  onChange={(event) =>
                    setSelectedSupplierId(event.target.value)
                  }
                >
                  <option value="">选择供应商</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={String(supplier.id)}>
                      {supplier.name}
                      {supplier.monitored === false ? "（已暂停监测）" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!selectedSupplierId}
                  onClick={() => {
                    const record = suppliers.find(
                      (supplier) => String(supplier.id) === selectedSupplierId,
                    );
                    if (record) setEditTarget({ kind: "supplier", record });
                  }}
                >
                  <Pencil size={15} />
                  编辑企业与监测设置
                </button>
              </div>
            )}
            {sites.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>供应商</th>
                      <th>供货地点</th>
                      <th>国家 / 地区</th>
                      <th>材料</th>
                      <th>风险</th>
                      <th>最近扫描</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map((site) => (
                      <tr key={site.id}>
                        <td className="table-strong">
                          {site.supplier_name || "未命名企业"}
                          {site.is_demo && (
                            <span className="table-demo">演示</span>
                          )}
                        </td>
                        <td>{site.name}</td>
                        <td>
                          {[site.city, site.country]
                            .filter(Boolean)
                            .join("，") || "未填写"}
                        </td>
                        <td>{materialsText(site.materials)}</td>
                        <td>
                          <div className="table-risk">
                            <RiskPill level={site.risk_level} small />
                            {normalizedRisk(site.supplier_risk_level) !==
                              normalizedRisk(site.risk_level) && (
                              <span>
                                企业：
                                {
                                  riskMeta[
                                    normalizedRisk(site.supplier_risk_level)
                                  ].label
                                }
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{formatDate(site.last_scan)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="row-action"
                              onClick={() =>
                                setEditTarget({ kind: "site", record: site })
                              }
                              aria-label={`编辑 ${site.name}`}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => setDetail({ kind: "site", site })}
                              aria-label={`查看 ${site.name} 详情`}
                            >
                              <ArrowRight size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="large-empty">
                <Database size={34} />
                <h3>尚未导入供应商</h3>
                <p>
                  下载模板填写企业名称、供货地点和坐标，再导入 Excel（.xlsx）文件。
                </p>
                <div className="empty-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileUp size={16} />
                    导入 Excel
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={downloadTemplate}
                  >
                    下载 Excel 模板
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "jobs" && (
          <div className="jobs-grid">
            <section className="panel jobs-panel">
              <div className="panel-title">
                <div>
                  <Activity size={18} />
                  <h2>采集任务</h2>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
              {jobs.length ? (
                <div className="job-list">
                  {jobs.slice(0, 20).map((job) => (
                    <div className="job-row" key={job.id}>
                      <span
                        className={`job-status job-${(job.status || "").toLowerCase()}`}
                      >
                        <span />
                        {statusLabel(job.status)}
                      </span>
                      <div>
                        <strong>扫描任务 #{job.id}</strong>
                        <small>
                          {formatDate(job.started_at || job.created_at, true)} ·{" "}
                          {job.articles_found ?? 0} 篇新闻 ·{" "}
                          {job.events_created ?? 0} 条事件
                        </small>
                        {(job.error || job.errors) && (
                          <small className="job-error">
                            {Array.isArray(job.errors)
                              ? job.errors.join("；")
                              : job.errors || job.error}
                          </small>
                        )}
                      </div>
                      <span className="job-time">
                        {job.finished_at || job.completed_at
                          ? formatDate(
                              job.finished_at || job.completed_at,
                              true,
                            )
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="large-empty">
                  <Radar size={33} />
                  <h3>尚无扫描任务</h3>
                  <p>创建首次任务后，可在此查看采集进度和失败原因。</p>
                </div>
              )}
            </section>
            <aside className="panel source-panel">
              <div className="panel-title">
                <div>
                  <Globe2 size={18} />
                  <h2>来源与覆盖</h2>
                </div>
              </div>
              <div className="source-main">
                <div className="source-icon">
                  <Globe2 size={26} />
                </div>
                <strong>{getSourceSummary(sourceStatus)}</strong>
                <p>
                  新闻采集通过服务端配置的受控代理运行。页面展示已入库内容，来源不可达时仍保留历史风险。
                </p>
              </div>
              <div className="source-facts">
                <div>
                  <span>最近扫描</span>
                  <strong>{formatDate(dashboard?.last_scan, true)}</strong>
                </div>
                <div>
                  <span>已录入地点</span>
                  <strong>{sites.length}</strong>
                </div>
                <div>
                  <span>地图已定位</span>
                  <strong>{locatedCount}</strong>
                </div>
                <div>
                  <span>页面更新</span>
                  <strong>
                    {lastRefresh
                      ? formatDate(lastRefresh.toISOString(), true)
                      : "—"}
                  </strong>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {detail && (
        <>
          <div className="drawer-backdrop" onClick={() => setDetail(null)} />
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="风险详情"
          >
            <div className="drawer-header">
              <span className="eyebrow">RISK INTELLIGENCE / 风险详情</span>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="关闭详情"
              >
                <X size={20} />
              </button>
            </div>
            {detail.kind === "site" ? (
              <SiteDetail
                site={detail.site}
                news={[...events, ...news].filter(
                  (item, index, all) =>
                    (String(item.site_id) === String(detail.site.id) ||
                      (item.site_id == null &&
                        String(item.supplier_id) ===
                          String(detail.site.supplier_id))) &&
                    all.findIndex(
                      (candidate) => String(candidate.id) === String(item.id),
                    ) === index,
                )}
                onNews={(item) => setDetail({ kind: "news", news: item })}
              />
            ) : (
              <NewsDetail
                key={detail.news.id}
                news={detail.news}
                site={sites.find(
                  (site) => String(site.id) === String(detail.news.site_id),
                )}
                onSite={(site) => setDetail({ kind: "site", site })}
                onReview={async (status, reason, riskLevel) => {
                  const updated = await api.reviewEvent(
                    detail.news.id,
                    status,
                    reason,
                    riskLevel,
                  );
                  setDetail({ kind: "news", news: updated });
                  await refresh();
                  setToast("人工核实记录已保存。");
                }}
              />
            )}
          </aside>
        </>
      )}
      {editTarget && (
        <EditRecordForm
          key={`${editTarget.kind}-${editTarget.record.id}`}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            await refresh();
            setEditTarget(null);
            setToast("台账已更新。");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          {toast}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="关闭消息"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {loading && (
        <div className="loading-indicator" role="status">
          <RefreshCw size={16} />
          正在读取数据…
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  foot,
  tone,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  foot: string;
  tone: string;
  compact?: boolean;
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <div className="metric-icon">{icon}</div>
      </div>
      <strong
        className={
          compact ? "metric-value metric-value-compact" : "metric-value"
        }
      >
        {value}
      </strong>
      <span className="metric-foot">
        {foot}
        {tone === "red" ? (
          <ArrowUpRight size={14} />
        ) : tone === "green" ? (
          <Check size={14} />
        ) : (
          <ArrowDownRight size={14} />
        )}
      </span>
    </div>
  );
}

function SiteDetail({
  site,
  news,
  onNews,
}: {
  site: Site;
  news: News[];
  onNews: (news: News) => void;
}) {
  return (
    <div className="drawer-body">
      <div className="detail-type">供货地点 / SUPPLY SITE</div>
      <h2>
        {site.supplier_name || site.name}
        {site.is_demo && <span className="demo-tag">虚构演示</span>}
      </h2>
      <p className="detail-subtitle">
        <MapPin size={16} />
        {site.name} ·{" "}
        {[site.city, site.country].filter(Boolean).join("，") || "地点待补全"}
      </p>
      <div className="detail-risk-card">
        <div className="risk-scope-row">
          <span>地点风险</span>
          <RiskPill level={site.risk_level} />
        </div>
        <strong>{site.risk_summary || "暂无地点级风险线索"}</strong>
        <div className="risk-scope-divider" />
        <div className="risk-scope-row">
          <span>企业总体风险</span>
          <RiskPill level={site.supplier_risk_level} />
        </div>
        <strong>{site.supplier_risk_summary || "暂无企业风险线索"}</strong>
        <span>企业级或其他地点线索不能证明当前地点实际受影响。</span>
        <span>最近扫描：{formatDate(site.last_scan, true)}</span>
      </div>
      <div className="detail-section">
        <h3>地点与材料</h3>
        <div className="detail-facts">
          <div>
            <span>所属供应商</span>
            <strong>{site.supplier_name || "未录入"}</strong>
          </div>
          <div>
            <span>供货地点</span>
            <strong>{site.name}</strong>
          </div>
          <div>
            <span>供应材料</span>
            <strong>{materialsText(site.materials)}</strong>
          </div>
          <div>
            <span>地图坐标</span>
            <strong>
              {Number.isFinite(site.longitude) && Number.isFinite(site.latitude)
                ? `${Number(site.latitude).toFixed(3)}°, ${Number(site.longitude).toFixed(3)}°`
                : "待定位"}
            </strong>
          </div>
        </div>
      </div>
      <div className="detail-section">
        <h3>
          关联事件与新闻 <span>{news.length}</span>
        </h3>
        {news.length ? (
          news.map((item) => (
            <button
              type="button"
              key={item.id}
              className="detail-news"
              onClick={() => onNews(item)}
            >
              <RiskPill level={item.risk_level} small />
              <strong>{item.title}</strong>
              {item.site_id == null && (
                <em>企业级线索 · 该地点受影响情况待核实</em>
              )}
              <span>
                {item.source || "来源未标注"} · {formatDate(item.published_at)}{" "}
                <ArrowRight size={14} />
              </span>
            </button>
          ))
        ) : (
          <p className="detail-empty">
            暂无关联证据。未发现新闻不能证明供应安全，请结合扫描时间判断。
          </p>
        )}
      </div>
    </div>
  );
}

function NewsDetail({
  news,
  site,
  onSite,
  onReview,
}: {
  news: News;
  site?: Site;
  onSite: (site: Site) => void;
  onReview: (
    status: string,
    reason: string,
    riskLevel?: string,
  ) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("confirmed");
  const [reviewRisk, setReviewRisk] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const url = safeHttpUrl(news.url);
  async function submitReview() {
    if (reason.trim().length < 2) {
      setReviewError("请填写至少两个字的核实理由。");
      return;
    }
    setSubmitting(true);
    setReviewError(null);
    try {
      await onReview(
        decision,
        reason.trim(),
        decision === "confirmed" ? reviewRisk || undefined : undefined,
      );
      setReason("");
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "保存失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="drawer-body">
      <div className="detail-type">外部信息 / SOURCE EVIDENCE</div>
      <h2>
        {news.title}
        {news.is_demo && <span className="demo-tag">虚构演示</span>}
      </h2>
      <div className="news-detail-meta">
        <RiskPill level={news.risk_level} />
        <span>{news.source || "来源未标注"}</span>
        <span>{formatDate(news.published_at, true)}</span>
      </div>
      <div className="detail-section">
        <h3>事件摘要</h3>
        <p className="detail-paragraph">
          {news.summary || "暂无详细摘要，请查看原始来源并人工核实。"}
        </p>
      </div>
      <div className="detail-section">
        <h3>关联判断</h3>
        <div className="detail-facts">
          <div>
            <span>关联供应商</span>
            <strong>{news.supplier_name || "待核实"}</strong>
          </div>
          <div>
            <span>风险类型</span>
            <strong>{news.category || "未分类"}</strong>
          </div>
          <div>
            <span>核实状态</span>
            <strong>{news.verification || news.status || "待核实"}</strong>
          </div>
          {(news.matching_reason || news.match_reason) && (
            <div>
              <span>匹配依据</span>
              <strong>{news.matching_reason || news.match_reason}</strong>
            </div>
          )}
          {news.site_id == null && (
            <div>
              <span>关联范围</span>
              <strong>企业级，尚未确认具体供货地点</strong>
            </div>
          )}
        </div>
      </div>
      {site && (
        <button
          type="button"
          className="related-site"
          onClick={() => onSite(site)}
        >
          <MapPin size={17} />
          <span>
            查看关联地点<strong>{site.name}</strong>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {url && (
        <a
          className="source-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={16} />
          打开原始来源
          <ArrowUpRight size={16} />
        </a>
      )}
      <div className="detail-section review-section">
        <h3>人工核实</h3>
        <p>选择处理结果并记录依据。每次处理都会留存审计记录。</p>
        <div className="review-choices">
          <label>
            <input
              type="radio"
              name={`review-${news.id}`}
              checked={decision === "confirmed"}
              onChange={() => setDecision("confirmed")}
            />
            确认风险
          </label>
          <label>
            <input
              type="radio"
              name={`review-${news.id}`}
              checked={decision === "false_positive"}
              onChange={() => setDecision("false_positive")}
            />
            标记误报
          </label>
          <label>
            <input
              type="radio"
              name={`review-${news.id}`}
              checked={decision === "resolved"}
              onChange={() => setDecision("resolved")}
            />
            风险解除
          </label>
        </div>
        {decision === "confirmed" && (
          <label className="review-label">
            核实后的风险等级
            <select
              value={reviewRisk}
              onChange={(event) => setReviewRisk(event.target.value)}
            >
              <option value="">保持当前等级</option>
              <option value="red">严重风险</option>
              <option value="orange">较高风险</option>
              <option value="yellow">需要关注</option>
              <option value="green">暂未发现</option>
            </select>
          </label>
        )}
        <label className="review-label">
          核实依据
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="填写证据、沟通结果或误报原因"
            rows={3}
          />
        </label>
        {reviewError && (
          <span className="review-error" role="alert">
            {reviewError}
          </span>
        )}
        <button
          type="button"
          className="button button-primary review-submit"
          disabled={submitting}
          onClick={() => void submitReview()}
        >
          {submitting ? "正在保存…" : "保存核实记录"}
        </button>
      </div>
      <div className="evidence-note">
        <AlertCircle size={16} />
        <span>
          外部新闻是风险线索。实际供货影响需结合地点、材料和人工核实结果判断。
        </span>
      </div>
    </div>
  );
}

export default App;
