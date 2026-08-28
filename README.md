# 羽毛球场馆空场查询

输入日期，查询羽毛球场地的可预订时段。脚本只使用 Python 3 标准库，无需安装依赖。

## 十环

```bash
python3 shihuan_availability.py 2026-08-29
```

该接口是匿名查询：脚本不读取、不保存、也不发送 `appId`、`memberId`、`token` 或 `openid`。输出会同时显示每小时价格和整场合计价格。其他视图：

```bash
python3 shihuan_availability.py 2026-08-29 --view court
python3 shihuan_availability.py 2026-08-29 --view json
python3 shihuan_availability.py 2026-08-29 --har "/path/to/capture.har" --offline
```

`--har` 只用于离线回放抓包中的结果，实时查询无需 HAR。

## 梅子

```bash
python3 meizi_availability.py 2026-08-29
```

该接口为匿名查询，脚本不读取、不保存、也不发送 `token`。该馆按固定场次预订，脚本会显示如 `08:00-10:00 ¥100/场次`。按场地查看或输出 JSON：

```bash
python3 meizi_availability.py 2026-08-29 --view court
python3 meizi_availability.py 2026-08-29 --view json
```

离线解析 HAR 中已抓取的某天：

```bash
python3 meizi_availability.py 2026-08-29 --har "/path/to/capture.har" --offline
```

`--har` 只用于离线回放抓包中的结果，实时查询无需 HAR。

## 青羽

```bash
python3 qingyu_availability.py 2026-08-29
```

该接口为匿名查询，脚本不读取、不保存、也不在请求体中发送 `token`。默认按时间列出可预订场地：

```text
15:00-16:00  羽毛球场7(¥55), 羽毛球场8(¥55)
```

按场地查看，连续的空闲小时会自动合并：

```bash
python3 qingyu_availability.py 2026-08-29 --view court
```

输出 JSON，便于后续聚合多个场馆：

```bash
python3 qingyu_availability.py 2026-08-29 --view json
```

## 离线验证抓包结果

`--offline` 不请求服务器，只解析 HAR 里已经录制的那一天：

```bash
python3 qingyu_availability.py 2026-08-29 --har "/path/to/capture.har" --offline
```

`--har` 只用于离线回放。HAR 里可能包含 token、订单号和手机号，请勿将它上传到公开仓库或发给无关人员。

## 测试

```bash
python3 -m unittest -v
```
