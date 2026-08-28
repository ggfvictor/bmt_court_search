#!/usr/bin/env python3
"""查询青羽的羽毛球场空闲时段。

脚本只使用 Python 标准库，实时查询为匿名请求，不读取或发送 token。
HAR 只用于离线解析和读取门店请求体配置。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date as Date
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = "https://room.yunvip123.cn/prod-api/room/smallProgram/bookingBoard"
SHOP_ID = "477064449329168"
VENUE_NAME = "青羽"
DESK_TYPE_ID = "480416004035600"
DEFAULT_TIMEOUT_SECONDS = 15.0


class QueryError(RuntimeError):
    """用户可理解的查询错误。"""


@dataclass(frozen=True)
class HarProfile:
    """从 HAR 中读取的请求配置。"""

    url: str
    payload: dict[str, Any]
    headers: dict[str, str]
    response: dict[str, Any] | None


@dataclass(frozen=True)
class FreeSlot:
    """一个可预订的场地时段。"""

    court: str
    start: str
    end: str
    price: float | int | None


def parse_date(value: str) -> str:
    """校验 YYYY-MM-DD 日期。"""
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"日期 {value!r} 无效，请使用 YYYY-MM-DD，例如 2026-08-29"
        ) from exc
    if parsed.isoformat() != value:
        raise argparse.ArgumentTypeError(
            f"日期 {value!r} 无效，请使用 YYYY-MM-DD，例如 2026-08-29"
        )
    return value


def _header_map(headers: Iterable[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for header in headers:
        name = header.get("name")
        value = header.get("value")
        if isinstance(name, str) and isinstance(value, str):
            result[name.lower()] = value
    return result


def load_har(path: Path) -> HarProfile:
    """找到 HAR 中的 bookingBoard 请求并读取配置。"""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise QueryError(f"找不到 HAR 文件：{path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise QueryError(f"无法读取 HAR 文件 {path}：{exc}") from exc

    entries = document.get("log", {}).get("entries", [])
    entry = next(
        (
            item
            for item in entries
            if item.get("request", {}).get("method") == "POST"
            and str(item.get("request", {}).get("url", "")).rstrip("/").endswith(
                "/room/smallProgram/bookingBoard"
            )
        ),
        None,
    )
    if entry is None:
        raise QueryError("HAR 中没有找到 bookingBoard POST 请求")

    request = entry.get("request", {})
    try:
        payload = json.loads(request.get("postData", {}).get("text", ""))
    except json.JSONDecodeError as exc:
        raise QueryError("HAR 中 bookingBoard 的请求体不是有效 JSON") from exc
    if not isinstance(payload, dict):
        raise QueryError("HAR 中 bookingBoard 的请求体格式不正确")
    # 该查询接口无需身份信息；HAR 即使带 token 也不保留。
    payload.pop("token", None)

    captured_headers = _header_map(request.get("headers", []))
    # 只保留此接口可能需要的头；Cookie/Authorization 等不转发。
    safe_headers = {
        name: captured_headers[name]
        for name in ("x-merchant-id", "user-agent", "referer")
        if name in captured_headers
    }

    response: dict[str, Any] | None = None
    response_text = entry.get("response", {}).get("content", {}).get("text")
    if isinstance(response_text, str) and response_text:
        try:
            candidate = json.loads(response_text)
            if isinstance(candidate, dict):
                response = candidate
        except json.JSONDecodeError:
            pass

    return HarProfile(
        url=str(request.get("url") or API_URL),
        payload=payload,
        headers=safe_headers,
        response=response,
    )


def request_board(
    query_date: str,
    profile: HarProfile | None,
    timeout: float,
) -> dict[str, Any]:
    """请求实时预订看板。"""
    payload: dict[str, Any] = {
        "date": query_date,
        "deskTypeId": DESK_TYPE_ID,
        "shopId": SHOP_ID,
        "shopName": VENUE_NAME,
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Merchant-Id": SHOP_ID,
    }
    url = API_URL

    if profile is not None:
        # 保留 HAR 中的非账号门店配置，但始终使用输入日期。
        payload.update(
            {
                key: value
                for key, value in profile.payload.items()
                if key not in {"date", "token", "shopName"}
            }
        )
        headers.update(profile.headers)
        url = profile.url

    payload["date"] = query_date
    payload["shopName"] = VENUE_NAME
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = Request(url, data=body, headers=headers, method="POST")

    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL 受本脚本/HAR 控制
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read(500).decode("utf-8", errors="replace")
        raise QueryError(f"服务器返回 HTTP {exc.code}：{detail}") from exc
    except URLError as exc:
        raise QueryError(f"网络请求失败：{exc.reason}") from exc
    except TimeoutError as exc:
        raise QueryError(f"请求超时（{timeout:g} 秒）") from exc

    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise QueryError("服务器返回了非 JSON 内容") from exc
    if not isinstance(result, dict):
        raise QueryError("服务器响应格式不正确")
    return result


def extract_free_slots(board: dict[str, Any]) -> list[FreeSlot]:
    """从看板响应中只提取 status=0 的可预订格子。"""
    errno = board.get("errno")
    if errno != 200:
        message = board.get("errmsg") or "未知错误"
        raise QueryError(f"接口查询失败（errno={errno!r}）：{message}")

    data = board.get("data")
    groups = data.get("itemArr") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        raise QueryError("响应中缺少 data.itemArr，接口格式可能已变化")

    free: list[FreeSlot] = []
    for group in groups:
        items = group if isinstance(group, list) else [group]
        for item in items:
            if not isinstance(item, dict) or item.get("status") != 0:
                continue
            court = item.get("deskName")
            start = item.get("businessBegins")
            end = item.get("businessEnds")
            if not all(isinstance(value, str) for value in (court, start, end)):
                continue
            price = item.get("money")
            if not isinstance(price, (int, float)) or isinstance(price, bool):
                price = None
            free.append(FreeSlot(court=court, start=start, end=end, price=price))

    return sorted(free, key=lambda slot: (slot.start, natural_court_key(slot.court)))


def natural_court_key(name: str) -> tuple[str, int, str]:
    """让场地10排在场地9后，而不是场地1后。"""
    prefix = name.rstrip("0123456789")
    suffix = name[len(prefix) :]
    return prefix, int(suffix) if suffix else -1, name


def format_price(price: float | int | None) -> str:
    if price is None:
        return ""
    amount = f"{float(price):.2f}".rstrip("0").rstrip(".")
    return f"¥{amount}"


def print_by_time(slots: list[FreeSlot]) -> None:
    grouped: dict[tuple[str, str], list[FreeSlot]] = defaultdict(list)
    for slot in slots:
        grouped[(slot.start, slot.end)].append(slot)

    for start, end in sorted(grouped):
        entries = []
        for slot in sorted(grouped[(start, end)], key=lambda item: natural_court_key(item.court)):
            price = format_price(slot.price)
            entries.append(f"{slot.court}{f'({price})' if price else ''}")
        print(f"{start}-{end}  {', '.join(entries)}")


def _merge_court_slots(slots: list[FreeSlot]) -> list[tuple[str, str, set[float | int]]]:
    """合并一个场地前后相连的空闲时段。"""
    ordered = sorted(slots, key=lambda slot: slot.start)
    merged: list[tuple[str, str, set[float | int]]] = []
    for slot in ordered:
        prices: set[float | int] = set() if slot.price is None else {slot.price}
        if merged and merged[-1][1] == slot.start:
            start, _, previous_prices = merged[-1]
            merged[-1] = (start, slot.end, previous_prices | prices)
        else:
            merged.append((slot.start, slot.end, prices))
    return merged


def print_by_court(slots: list[FreeSlot]) -> None:
    grouped: dict[str, list[FreeSlot]] = defaultdict(list)
    for slot in slots:
        grouped[slot.court].append(slot)

    for court in sorted(grouped, key=natural_court_key):
        periods = []
        for start, end, prices in _merge_court_slots(grouped[court]):
            price_text = "/".join(format_price(price) for price in sorted(prices))
            periods.append(f"{start}-{end}{f'({price_text}/小时)' if price_text else ''}")
        print(f"{court}  {', '.join(periods)}")


def print_json(query_date: str, shop_name: str, slots: list[FreeSlot]) -> None:
    output = {
        "date": query_date,
        "shop": shop_name,
        "available": [
            {
                "court": slot.court,
                "start": slot.start,
                "end": slot.end,
                "price": slot.price,
            }
            for slot in slots
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="查询青羽指定日期的羽毛球场空闲时段"
    )
    parser.add_argument("date", type=parse_date, help="查询日期，格式 YYYY-MM-DD")
    parser.add_argument(
        "--har",
        type=Path,
        help="读取抓包中的门店请求配置（忽略 token）",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="不联网，直接解析 --har 中已录制的响应（只能查当时抓包的日期）",
    )
    parser.add_argument(
        "--view",
        choices=("time", "court", "json"),
        default="time",
        help="输出视图：time=按时间，court=按场地，json=机器可读（默认 time）",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"网络超时秒数（默认 {DEFAULT_TIMEOUT_SECONDS:g}）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.timeout <= 0:
        print("错误：--timeout 必须大于 0", file=sys.stderr)
        return 2

    try:
        profile = load_har(args.har) if args.har else None
        if args.offline:
            if profile is None:
                raise QueryError("--offline 必须和 --har 一起使用")
            captured_date = profile.payload.get("date")
            if captured_date != args.date:
                raise QueryError(
                    f"HAR 录制的是 {captured_date!r}，不是 {args.date!r}；"
                    "去掉 --offline 才能发起实时查询"
                )
            if profile.response is None:
                raise QueryError("HAR 中没有可解析的 JSON 响应")
            board = profile.response
        else:
            board = request_board(args.date, profile, args.timeout)

        slots = extract_free_slots(board)
        shop_name = VENUE_NAME

        if args.view == "json":
            print_json(args.date, shop_name, slots)
            return 0

        print(f"{shop_name} | {args.date} | 可预订 {len(slots)} 个场地小时")
        print("=" * 48)
        if not slots:
            print("当天没有可预订的场地时段。")
        elif args.view == "court":
            print_by_court(slots)
        else:
            print_by_time(slots)
        return 0
    except QueryError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
