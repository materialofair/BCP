import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "./api";
import { materialsText, type Site, type Supplier } from "./types";

export type EditTarget =
  { kind: "supplier"; record: Supplier } | { kind: "site"; record: Site };

interface Props {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export default function EditRecordForm({ target, onClose, onSaved }: Props) {
  const record = target.record;
  const [name, setName] = useState(record.name);
  const [aliases, setAliases] = useState(
    target.kind === "supplier" ? target.record.aliases || "" : "",
  );
  const [website, setWebsite] = useState(
    target.kind === "supplier" ? target.record.website || "" : "",
  );
  const [monitored, setMonitored] = useState(
    target.kind === "supplier" ? target.record.monitored !== false : true,
  );
  const [city, setCity] = useState(
    target.kind === "site" ? target.record.city || "" : "",
  );
  const [country, setCountry] = useState(
    target.kind === "site" ? target.record.country || "" : "",
  );
  const [latitude, setLatitude] = useState(
    target.kind === "site" ? String(target.record.latitude ?? "") : "",
  );
  const [longitude, setLongitude] = useState(
    target.kind === "site" ? String(target.record.longitude ?? "") : "",
  );
  const [materials, setMaterials] = useState(
    target.kind === "site"
      ? materialsText(target.record.materials).replace("未录入", "")
      : "",
  );
  const [siteType, setSiteType] = useState(
    target.kind === "site" ? target.record.site_type || "工厂" : "工厂",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("名称不能为空。");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (target.kind === "supplier") {
        await api.updateSupplier(target.record.id, {
          name: name.trim(),
          aliases: aliases.trim(),
          website: website.trim(),
          monitored,
        });
      } else {
        const lat = latitude.trim() ? Number(latitude) : null;
        const lon = longitude.trim() ? Number(longitude) : null;
        if (
          (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
          (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180))
        ) {
          setError("纬度需在 -90 至 90、经度需在 -180 至 180 之间。");
          return;
        }
        await api.updateSite(target.record.id, {
          name: name.trim(),
          city: city.trim(),
          country: country.trim(),
          latitude: lat,
          longitude: lon,
          materials: materials.trim(),
          site_type: siteType.trim() || "工厂",
        });
      }
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "保存失败，请稍后重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-overlay" onMouseDown={onClose}>
      <section
        className="edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={target.kind === "supplier" ? "编辑供应商" : "编辑供货地点"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="edit-heading">
          <div>
            <span className="eyebrow">SUPPLIER RECORD / 台账维护</span>
            <h2>
              {target.kind === "supplier" ? "编辑供应商" : "编辑供货地点"}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭编辑">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)} className="edit-form">
          <label>
            名称
            <input
              autoFocus
              maxLength={240}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {target.kind === "supplier" ? (
            <>
              <label>
                别名（多个用逗号分隔）
                <input
                  value={aliases}
                  onChange={(event) => setAliases(event.target.value)}
                />
              </label>
              <label>
                官方网站
                <input
                  type="url"
                  placeholder="https://"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </label>
              <label className="edit-checkbox">
                <input
                  type="checkbox"
                  checked={monitored}
                  onChange={(event) => setMonitored(event.target.checked)}
                />
                <span>持续监测此供应商</span>
              </label>
            </>
          ) : (
            <>
              <div className="edit-two-cols">
                <label>
                  城市
                  <input
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                  />
                </label>
                <label>
                  国家 / 地区
                  <input
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                  />
                </label>
              </div>
              <div className="edit-two-cols">
                <label>
                  纬度
                  <input
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                  />
                </label>
                <label>
                  经度
                  <input
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                  />
                </label>
              </div>
              <label>
                供应材料（多个用逗号分隔）
                <input
                  value={materials}
                  onChange={(event) => setMaterials(event.target.value)}
                />
              </label>
              <label>
                地点类型
                <input
                  value={siteType}
                  onChange={(event) => setSiteType(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="edit-error" role="alert">
              {error}
            </p>
          )}
          <div className="edit-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={saving}
            >
              {saving ? "保存中…" : "保存更改"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
