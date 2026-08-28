#!/usr/bin/env python3
"""查询十环指定日期的羽毛球可预订场次。

脚本只使用 Python 标准库，实时查询为匿名请求，不发送任何账号头。
HAR 只用于离线解析和读取场馆请求体配置。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = "https://fdsaas.hulasports.com/api/orderlists/get/book"
VENUE_NAME = "十环"
VENUE_ID = "65289508c73b5c1db29bb137"
ITEM_ID = "62947fdc6267fd52ab099a3e"
ORG_ID = "5de4af96c87e5e70532e3a44"
DEFAULT_TIMEOUT_SECONDS = 15.0
CHINA_TZ = timezone(timedelta(hours=8))


class QueryError(RuntimeError):
    """用户可理解的查询错误。"""


@dataclass(frozen=True)
class CapturedResponse:
    body: dict[str, Any]
    captured_at: datetime | None


@dataclass(frozen=True)
class HarProfile:
    """从 HAR 中提取的请求模板和离线响应。"""

    url: str
    payload: dict[str, Any]
    responses: dict[str, CapturedResponse]


@dataclass(frozen=True)
class FreeBlock:
    """一个可直接预订的场地时段。"""

    court: str
    start: str
    end: str
    hourly_price: float | int | None
    total_price: float | int | None


def parse_date(value: str) -> str:
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


def date_to_timestamp_ms(query_date: str) -> int:
    parsed = Date.fromisoformat(query_date)
    midnight = datetime(parsed.year, parsed.month, parsed.day, tzinfo=CHINA_TZ)
    return int(midnight.timestamp() * 1000)


def timestamp_ms_to_date(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=CHINA_TZ).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _parse_capture_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=CHINA_TZ)
    return parsed.astimezone(CHINA_TZ)


def load_har(path: Path) -> HarProfile:
    """读取 HAR 中 get/book 的请求体配置和响应，忽略所有头。"""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise QueryError(f"找不到 HAR 文件：{path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise QueryError(f"无法读取 HAR 文件 {path}：{exc}") from exc

    entries = [
        entry
        for entry in document.get("log", {}).get("entries", [])
        if entry.get("request", {}).get("method") == "POST"
        and str(entry.get("request", {}).get("url", "")).rstrip("/").endswith(
            "/api/orderlists/get/book"
        )
    ]
    if not entries:
        raise QueryError("HAR 中没有找到 /api/orderlists/get/book POST 请求")

    template_request = entries[0].get("request", {})
    try:
        template_payload = json.loads(
            template_request.get("postData", {}).get("text", "")
        )
    except json.JSONDecodeError as exc:
        raise QueryError("HAR 中 get/book 的请求体不是有效 JSON") from exc
    if not isinstance(template_payload, dict):
        raise QueryError("HAR 中 get/book 的请求体格式不正确")

    responses: dict[str, CapturedResponse] = {}
    for entry in entries:
        request = entry.get("request", {})
        try:
            payload = json.loads(request.get("postData", {}).get("text", ""))
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        query_date = timestamp_ms_to_date(payload.get("orderDateNum"))
        response_text = entry.get("response", {}).get("content", {}).get("text")
        if not query_date or query_date in responses or not isinstance(response_text, str):
            continue
        try:
            body = json.loads(response_text)
        except json.JSONDecodeError:
            continue
        if isinstance(body, dict):
            responses[query_date] = CapturedResponse(
                body=body,
                captured_at=_parse_capture_time(entry.get("startedDateTime")),
            )

    return HarProfile(
        url=str(template_request.get("url") or API_URL),
        payload=template_payload,
        responses=responses,
    )


def request_board(
    query_date: str,
    profile: HarProfile | None,
    timeout: float,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "orderDateNum": date_to_timestamp_ms(query_date),
        "_venue": VENUE_ID,
        "_item": ITEM_ID,
        "_org": ORG_ID,
        "passBaseOn": "start",
        "showLine": "row",
        "showPassTime": False,
        "delayMins": 150,
    }
    url = API_URL
    if profile is not None:
        payload.update(profile.payload)
        url = profile.url
    payload["orderDateNum"] = date_to_timestamp_ms(query_date)

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = Request(url, data=body, headers=headers, method="POST")

    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL 由脚本/HAR 控制
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


def time_to_minutes(value: str) -> int | None:
    try:
        hour_text, minute_text = value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except (ValueError, AttributeError):
        return None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        return None
    return hour * 60 + minute


def extract_free_blocks(
    board: dict[str, Any],
    query_date: str,
    now: datetime | None = None,
) -> list[FreeBlock]:
    """提取 state.no=0 且状态文字为“可预订”的未开始场次。"""
    code = board.get("code")
    if code != 200:
        message = board.get("message") or board.get("msg") or "未知错误"
        raise QueryError(f"接口查询失败（code={code!r}）：{message}")

    data = board.get("data")
    booking_array = data.get("booking_array") if isinstance(data, dict) else None
    if not isinstance(booking_array, list):
        raise QueryError("响应中缺少 data.booking_array，接口格式可能已变化")

    target_date = Date.fromisoformat(query_date)
    current = (now or datetime.now(CHINA_TZ)).astimezone(CHINA_TZ)
    current_minutes = current.hour * 60 + current.minute
    free: list[FreeBlock] = []

    for row in booking_array:
        infos = row.get("booking_infos") if isinstance(row, dict) else None
        if not isinstance(infos, list):
            continue
        for item in infos:
            if not isinstance(item, dict):
                continue
            state = item.get("state")
            if not isinstance(state, dict):
                continue
            if state.get("no") != 0 or state.get("state") != "可预订":
                continue
            court = item.get("fieldName")
            start = item.get("showStartTime")
            end = item.get("showEndTime")
            if not all(isinstance(value, str) for value in (court, start, end)):
                continue
            start_minutes = time_to_minutes(start)
            if start_minutes is None:
                continue
            # 二次保护：即使服务器未把已开始场次标记为不可订，也不误报。
            if target_date < current.date():
                continue
            if target_date == current.date() and start_minutes <= current_minutes:
                continue

            hourly = item.get("price")
            total = item.get("total")
            if not isinstance(hourly, (int, float)) or isinstance(hourly, bool):
                hourly = None
            if not isinstance(total, (int, float)) or isinstance(total, bool):
                total = None
            free.append(
                FreeBlock(
                    court=court,
                    start=start,
                    end=end,
                    hourly_price=hourly,
                    total_price=total,
                )
            )

    return sorted(
        free,
        key=lambda block: (
            time_to_minutes(block.start) or 0,
            natural_court_key(block.court),
        ),
    )


def natural_court_key(name: str) -> tuple[int, str]:
    digits = "".join(character for character in name if character.isdigit())
    return int(digits) if digits else -1, name


def format_money(value: float | int | None) -> str:
    if value is None:
        return ""
    amount = f"{float(value):.2f}".rstrip("0").rstrip(".")
    return f"¥{amount}"


def price_description(block: FreeBlock) -> str:
    parts = []
    if block.hourly_price is not None:
        parts.append(f"{format_money(block.hourly_price)}/小时")
    if block.total_price is not None:
        parts.append(f"合计{format_money(block.total_price)}")
    return "，".join(parts)


def print_by_time(blocks: list[FreeBlock]) -> None:
    grouped: dict[
        tuple[str, str, float | int | None, float | int | None], list[str]
    ] = defaultdict(list)
    for block in blocks:
        grouped[(block.start, block.end, block.hourly_price, block.total_price)].append(
            block.court
        )
    for key in sorted(grouped, key=lambda item: time_to_minutes(item[0]) or 0):
        start, end, hourly, total = key
        courts = sorted(grouped[key], key=natural_court_key)
        description = price_description(
            FreeBlock("", start, end, hourly_price=hourly, total_price=total)
        )
        price_text = f" {description}" if description else ""
        print(f"{start}-{end}{price_text}  {', '.join(courts)}")


def print_by_court(blocks: list[FreeBlock]) -> None:
    grouped: dict[str, list[FreeBlock]] = defaultdict(list)
    for block in blocks:
        grouped[block.court].append(block)
    for court in sorted(grouped, key=natural_court_key):
        periods = []
        for block in sorted(
            grouped[court], key=lambda item: time_to_minutes(item.start) or 0
        ):
            description = price_description(block)
            periods.append(
                f"{block.start}-{block.end}{f'({description})' if description else ''}"
            )
        print(f"{court}  {', '.join(periods)}")


def print_json(query_date: str, blocks: list[FreeBlock]) -> None:
    output = {
        "date": query_date,
        "venue": VENUE_NAME,
        "available": [
            {
                "court": block.court,
                "start": block.start,
                "end": block.end,
                "hourlyPrice": block.hourly_price,
                "totalPrice": block.total_price,
            }
            for block in blocks
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="查询十环指定日期的羽毛球可预订场地"
    )
    parser.add_argument("date", type=parse_date, help="查询日期，格式 YYYY-MM-DD")
    parser.add_argument(
        "--har",
        type=Path,
        help="读取抓包中的请求体配置（忽略所有请求头）",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="不联网，解析 --har 中已录制的指定日期",
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
        captured_at: datetime | None = None
        if args.offline:
            if profile is None:
                raise QueryError("--offline 必须和 --har 一起使用")
            capture = profile.responses.get(args.date)
            if capture is None:
                dates = "、".join(sorted(profile.responses)) or "无"
                raise QueryError(f"HAR 没有录制 {args.date}；已录制日期：{dates}")
            board = capture.body
            captured_at = capture.captured_at
        else:
            board = request_board(args.date, profile, args.timeout)

        blocks = extract_free_blocks(board, args.date, now=captured_at)
        if args.view == "json":
            print_json(args.date, blocks)
            return 0

        print(f"{VENUE_NAME} | {args.date} | 可预订 {len(blocks)} 个场次")
        print("=" * 64)
        if not blocks:
            print("当天没有尚未开始的可预订场次。")
        elif args.view == "court":
            print_by_court(blocks)
        else:
            print_by_time(blocks)
        return 0
    except QueryError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
