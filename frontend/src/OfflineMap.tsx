import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { ScatterChart } from "echarts/charts";
import { GeoComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LocateFixed, Minus, Plus } from "lucide-react";
import {
  formatDate,
  hasCompanyRiskRing,
  materialsText,
  normalizedRisk,
  riskMeta,
  type Site,
} from "./types";

interface Props {
  sites: Site[];
  selectedSiteId: Site["id"] | null;
  onSelect: (site: Site) => void;
}

let mapReady: Promise<void> | null = null;
echarts.use([ScatterChart, GeoComponent, TooltipComponent, CanvasRenderer]);

function loadMap(): Promise<void> {
  if (!mapReady) {
    mapReady = fetch("/maps/world.geojson")
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`离线地图文件读取失败（${response.status}）`);
        const geojson: unknown = await response.json();
        if (
          !geojson ||
          typeof geojson !== "object" ||
          !("features" in geojson)
        ) {
          throw new Error("离线地图文件格式无效");
        }
        echarts.registerMap(
          "offline-world",
          geojson as Parameters<typeof echarts.registerMap>[1],
        );
      })
      .catch((error) => {
        mapReady = null;
        throw error;
      });
  }
  return mapReady;
}

export default function OfflineMap({ sites, selectedSiteId, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onSelectRef = useRef(onSelect);
  const sitesRef = useRef(sites);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.22);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

  useEffect(() => {
    let active = true;
    loadMap()
      .then(() => {
        if (!active || !hostRef.current) return;
        const chart = echarts.init(hostRef.current, undefined, {
          renderer: "canvas",
        });
        chartRef.current = chart;
        chart.on("click", (params) => {
          if (params.seriesType !== "scatter") return;
          const point = params.data as { id?: string | number } | undefined;
          const site = sitesRef.current.find(
            (item) => String(item.id) === String(point?.id),
          );
          if (site) onSelectRef.current(site);
        });
        const resize = new ResizeObserver(() => chart.resize());
        resize.observe(hostRef.current);
        (
          chart as echarts.ECharts & { __mapResize?: ResizeObserver }
        ).__mapResize = resize;
        setReady(true);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : "离线地图加载失败");
      });
    return () => {
      active = false;
      const chart = chartRef.current as
        (echarts.ECharts & { __mapResize?: ResizeObserver }) | null;
      chart?.__mapResize?.disconnect();
      chart?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const located = sites.filter(
      (site) =>
        Number.isFinite(site.longitude) && Number.isFinite(site.latitude),
    );
    const points = located.map((site) => {
      const risk = normalizedRisk(site.risk_level);
      const selected = String(site.id) === String(selectedSiteId);
      return {
        id: site.id,
        name: site.supplier_name || site.name,
        value: [
          Number(site.longitude),
          Number(site.latitude),
          selected ? 18 : 13,
        ],
        symbolSize: selected ? 20 : risk === "critical" ? 16 : 13,
        itemStyle: {
          color: riskMeta[risk].color,
          borderColor: "#102031",
          borderWidth: 2.5,
          shadowBlur: selected ? 20 : 12,
          shadowColor: riskMeta[risk].color,
        },
        site,
      };
    });
    const companyRings = located.filter(hasCompanyRiskRing).map((site) => {
      const selected = String(site.id) === String(selectedSiteId);
      const company = normalizedRisk(site.supplier_risk_level);
      return {
        id: site.id,
        name: site.supplier_name || site.name,
        value: [Number(site.longitude), Number(site.latitude)],
        symbolSize: selected ? 30 : 25,
        itemStyle: {
          color: "transparent",
          borderColor: riskMeta[company].color,
          borderWidth: 2.5,
          shadowBlur: 10,
          shadowColor: riskMeta[company].color,
        },
        site,
      };
    });
    chart.setOption(
      {
        animationDurationUpdate: 350,
        backgroundColor: "transparent",
        geo: {
          map: "offline-world",
          roam: true,
          zoom: selectedSiteId == null ? zoom : Math.max(zoom, 1.5),
          center:
            selectedSiteId == null
              ? [14, 18]
              : (() => {
                  const target = located.find(
                    (site) => String(site.id) === String(selectedSiteId),
                  );
                  return target
                    ? [Number(target.longitude), Number(target.latitude)]
                    : [14, 18];
                })(),
          scaleLimit: { min: 0.8, max: 8 },
          itemStyle: {
            areaColor: "#17354a",
            borderColor: "#46647a",
            borderWidth: 0.55,
          },
          emphasis: { disabled: true },
          select: { disabled: true },
          silent: false,
        },
        tooltip: {
          trigger: "item",
          renderMode: "richText",
          backgroundColor: "#112235",
          borderColor: "#35536b",
          borderWidth: 1,
          textStyle: { color: "#e9f2f6", fontSize: 12, lineHeight: 20 },
          formatter: (params: { data?: { site?: Site } }) => {
            const site = params.data?.site;
            if (!site) return "";
            const place = [site.city, site.country].filter(Boolean).join(" · ");
            return `${site.supplier_name || site.name}\n${place || site.name}\n供应材料：${materialsText(site.materials)}\n地点风险：${riskMeta[normalizedRisk(site.risk_level)].label}\n${site.risk_summary || "暂无地点级风险线索"}\n企业总体风险：${riskMeta[normalizedRisk(site.supplier_risk_level)].label}\n${site.supplier_risk_summary || "暂无企业风险线索"}\n企业线索不代表该地点已受影响\n最近扫描：${formatDate(site.last_scan, true)}\n点击查看证据详情`;
          },
        },
        series: [
          {
            name: "企业总体风险",
            type: "scatter",
            coordinateSystem: "geo",
            data: companyRings,
            z: 4,
            emphasis: { scale: 1.08 },
          },
          {
            name: "供货地点风险",
            type: "scatter",
            coordinateSystem: "geo",
            data: points,
            z: 5,
            emphasis: {
              scale: 1.22,
              itemStyle: { borderColor: "#fff", borderWidth: 2 },
            },
          },
        ],
      },
      true,
    );
  }, [sites, selectedSiteId, ready, zoom]);

  const changeZoom = (delta: number) =>
    setZoom((value) => Math.min(8, Math.max(0.8, +(value + delta).toFixed(2))));

  return (
    <div className="map-frame">
      <div className="map-grid" aria-hidden="true" />
      <div
        ref={hostRef}
        className="map-canvas"
        role="img"
        aria-label={`离线世界地图，显示 ${sites.filter((s) => Number.isFinite(s.longitude) && Number.isFinite(s.latitude)).length} 个供应地点`}
      />
      {error && (
        <div className="map-message" role="alert">
          <strong>离线地图暂不可用</strong>
          <span>{error}</span>
          <span>请检查本地地图文件 /maps/world.geojson。</span>
        </div>
      )}
      {!error && !ready && (
        <div className="map-message">
          <strong>正在加载离线地图…</strong>
        </div>
      )}
      {ready && sites.length === 0 && (
        <div className="map-empty">地图已就绪 · 导入供应商后显示供货地点</div>
      )}
      <div className="map-coordinate" aria-hidden="true">
        WORLDWIDE SUPPLIER COVERAGE <span>·</span> OFFLINE MAP
      </div>
      <div className="map-controls" aria-label="地图缩放">
        <button
          type="button"
          onClick={() => changeZoom(0.35)}
          title="放大地图"
          aria-label="放大地图"
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          onClick={() => changeZoom(-0.35)}
          title="缩小地图"
          aria-label="缩小地图"
        >
          <Minus size={17} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1.22)}
          title="重置地图缩放"
          aria-label="重置地图缩放"
        >
          <LocateFixed size={17} />
        </button>
      </div>
    </div>
  );
}
