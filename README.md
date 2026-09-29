# 封装材料供应链风险平台

在离线世界地图上查看封装材料供应商、供货地点和新闻风险。地图及界面资源随程序提供；采集程序通过受控代理访问已批准的公开来源。Windows、macOS 可在本地启动，Linux 可作为内网服务器运行。无需 Docker。

## 页面与数据

- 地图圆点代表供货地点：点心表示该地点的风险，外圈表示供应商总体风险。红、橙、黄、绿、灰分别表示严重、较高、关注、暂未发现、未评估；企业级新闻不会直接判定每个地点都受影响。
- 悬浮显示地点与企业风险，点击查看相关新闻、证据、关联理由和核实状态。未完成该企业的有效搜索时，不能把没有线索解释成安全。
- 顶部轮播重点新闻，列表和地图可联动筛选。
- 首次运行会加载明确标注为**虚构演示**的供应商和事件，帮助检查界面。请先导入真实供应商资料，再用于实际监测。
- 新闻搜索基线为 [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) 和 Google 新闻 RSS 搜索；可在 `.env` 中增加获准的 RSS/Atom 来源。这些来源不代表全网完整覆盖，界面显示来源与任务状态。
- 标题或摘要匹配形成的线索默认待核实；没有充分证据时不会宣称供应中断已确认。

当前首版只处理搜索结果及 RSS 提供的标题、摘要，不抓取新闻正文，也不调用外部大模型；不同网址报道同一事件时仍可能出现多条线索，需要分析员核实。来源不可用、企业未被本轮完整扫描或关闭监测时，无事件地点显示为未评估。

## 源码首次构建

仓库已包含前端构建产物 `frontend/dist/`，克隆后运行不需要 Node.js。修改前端源码后，在可以安装依赖的构建机上重新构建：

```sh
cd frontend
npm ci
npm run build
```

运行发布包只需要构建好的 `frontend/dist/`、Python 依赖和本地地图，不需要 Node.js。构建产物、Python 虚拟环境和 `data/` 不跨操作系统复制；Windows、macOS、Linux 各自安装 Python 依赖。完全离线安装时需预先按目标系统与 CPU 架构准备 `wheelhouse/<platform>/`，脚本会使用本地包。

## macOS 本地运行

安装 Python 3.11 或更高版本。首次执行：

```sh
bash deploy/setup-macos.sh
```

之后双击 `deploy/start-macos.command`，浏览器将打开 `http://127.0.0.1:8000`。双击 `deploy/stop-macos.command` 结束 API 与采集进程。脚本仅监听本机地址。Apple Silicon 和 Intel Mac 需要分别安装与其架构匹配的 Python 依赖。

## Windows 本地运行

安装 Python 3.11 或更高版本，并启用 `py` 启动器。双击 `deploy\setup-windows.bat` 完成首次安装，然后双击 `deploy\start-windows.bat`；停止使用 `deploy\stop-windows.bat`。默认地址为 `http://127.0.0.1:8000`，数据库为本机 `data\bcp.sqlite3`。

## Linux 服务器运行

在 Linux 上安装 Python 3.11+ 和 PostgreSQL，配置好数据库连接后运行：

```sh
bash deploy/setup-linux.sh
cp .env.example .env
# 编辑 .env 中的 DATABASE_URL（PostgreSQL）、代理和来源白名单
# 将 BCP_AUTH_REQUIRED 设置为 true，并创建至少一个管理员账户
.venv/bin/python -m backend.app.auth set-user admin admin
bash deploy/install-linux-services.sh
```

安装脚本生成并检查 systemd 服务单元，然后在明确运行该脚本时安装 API 和采集 Worker 服务。应用路径不要包含空格。用 `deploy/nginx/bcp.conf.template` 配置 Nginx 内网域名和 TLS 证书，反向代理至 `127.0.0.1:8000`；Windows/macOS 客户端使用浏览器打开内网地址即可。服务日志：`journalctl -u bcp-api -u bcp-worker -f`。内置账户有只读、分析员和管理员角色。

## 受控代理与采集

复制 `.env.example` 为 `.env` 后设置获准的代理、来源域名及采集间隔。若配置了代理，代理本身还需允许访问启用的搜索接口和 RSS 来源；被阻断的来源会显示为未覆盖或证据不足。`OUTBOUND_ALLOWLIST` 只填写批准的域名，不应加入内部地址。公网模型不属于首版运行条件。

采集预算由 `SCAN_REQUEST_BUDGET` 限制，来源请求间隔由 `SCAN_REQUEST_DELAY_SECONDS` 控制。一个来源被限流或代理阻断时，其他获准来源继续运行，失败会写入任务与来源状态。当前开发机上 GDELT 曾返回 HTTP 429；实际覆盖需在目标网络中验证。

本地电脑关机或休眠时无法采集；再次启动后采集程序继续运行。需要持续监测时使用 Linux 服务器。外部新闻标题、摘要和页面内容都是不可信输入，系统只把它们作为证据候选。

## 导入供应商

供应商资料以 Excel `.xlsx` 导入。在“供应商台账”下载中文列名的 Excel 模板，填写后点击“导入 Excel”；每行对应一个供货地点，同一供应商有多个地点时重复填写供应商名称。模板列为“供应商名称、别名、官网、供货地点、城市、国家/地区、纬度、经度、供应材料、地点类型”。缺少坐标的地点仍保留在台账中，但不会被错误放到国家中心点。原有英文字段的 `.xlsx` 和 UTF-8 CSV 仍可通过接口导入。

可在“供应商台账”编辑企业名称、别名、官网、监测开关，以及地点名称、位置、材料和类型。多个别名可用逗号、中文逗号或 `|` 分隔；中文名称和英文别名会分别参与搜索。风险列表可按等级、类型、状态和发布时间筛选。

需要把本地数据迁到 Linux 时，在停止采集后使用：

```sh
# 本地源机器
.venv/bin/python -m backend.app.transfer export bcp-backup.json
# Linux 目标机器：先配置好 PostgreSQL 的 DATABASE_URL，再导入到空数据库
.venv/bin/python -m backend.app.transfer import bcp-backup.json
```

Windows 将上例中的 `.venv/bin/python` 换为 `.venv\Scripts\python.exe`。导入工具会检查数据包 SHA-256、记录数量和关联，并保留原始 ID。账户文件 `data/users.json` 单独备份；数据包包含企业与风险资料，应通过企业批准的文件通道传输。

## 开发和验证

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn app.main:app --app-dir backend --reload
.venv/bin/python -m collector.worker
cd frontend && npm run dev
```

验证：`cd frontend && npm run lint && npm run typecheck && npm run test && npm run build`；后端运行 `.venv/bin/python -m pytest backend/tests collector/tests`。macOS 可在本机实测；Windows、Intel Mac 与 Linux 的原生启动和离线依赖仍需在对应环境执行后才能视为通过。

地图数据来自 [Natural Earth 1:110m 行政区 GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson)，其[使用条款](https://www.naturalearthdata.com/about/)说明数据为公共领域。实际边界展示请按企业使用要求核对。
