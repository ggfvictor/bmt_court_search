#!/usr/bin/env python3
"""查询梅子的羽毛球场可预订时段。

脚本只使用 Python 标准库，实时查询为匿名请求，不读取或发送 token。
HAR 只用于离线解析和读取场馆请参数。
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
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


API_URL = "https://api.like-sports.cn:8008/api-c/venue/field"
VENUE_ID = "279"
MATCH_ID = "60"
VENUE_NAME = "梅子"
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
    params: dict[str, str]
    headers: dict[str, str]
    responses: dict[str, CapturedResponse]


@dataclass(frozen=True)
class FreeBlock:
    """一个可直接预订的固定场次。"""

    court: str
    start_minutes: int
    end_minutes: int
    amount_cents: int | None


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


def _header_map(headers: Iterable[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for header in headers:
        name = header.get("name")
        value = header.get("value")
        if isinstance(name, str) and isinstance(value, str):
            result[name.lower()] = value
    return result


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
    """读取 HAR 中的 field 请求，保留多个已抓取日期。"""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise QueryError(f"找不到 HAR 文件：{path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise QueryError(f"无法读取 HAR 文件 {path}：{exc}") from exc

    entries = [
        entry
        for entry in document.get("log", {}).get("entries", [])
        if entry.get("request", {}).get("method") == "GET"
        and "/api-c/venue/field" in str(entry.get("request", {}).get("url", ""))
    ]
    if not entries:
        raise QueryError("HAR 中没有找到 /api-c/venue/field GET 请求")

    template_request = entries[0].get("request", {})
    template_url = str(template_request.get("url") or API_URL)
    split_url = urlsplit(template_url)
    base_url = urlunsplit((split_url.scheme, split_url.netloc, split_url.path, "", ""))
    params = dict(parse_qsl(split_url.query, keep_blank_values=True))
    captured_headers = _header_map(template_request.get("headers", []))
    # 只转发此小程序接口所需的头，不扩大复制其他鉴权信息。
    headers = {
        name: captured_headers[name]
        for name in ("sourcetype", "version", "user-agent", "referer")
        if name in captured_headers
    }

    responses: dict[str, CapturedResponse] = {}
    for entry in entries:
        request = entry.get("request", {})
        request_url = urlsplit(str(request.get("url", "")))
        request_params = dict(parse_qsl(request_url.query, keep_blank_values=True))
        query_date = request_params.get("date")
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
        url=base_url,
        params=params,
        headers=headers,
        responses=responses,
    )


def _check_api_code(container: dict[str, Any]) -> None:
    code = container.get("code")
    if code != 200:
        message = container.get("message") or "未知错误"
        raise QueryError(f"接口查询失败（code={code!r}）：{message}")


def _extract_courts(board: dict[str, Any]) -> list[dict[str, Any]]:
    """解开该接口的一层或多层 code/response 包装。"""
    current: dict[str, Any] = board
    for _ in range(5):
        _check_api_code(current)
        response = current.get("response")
        if not isinstance(response, list):
            raise QueryError("响应中缺少 response 数组，接口格式可能已变化")
        if response and all(
            isinstance(item, dict) and "fieldName" in item and "viewBlocks" in item
            for item in response
        ):
            return response
        if len(response) == 1 and isinstance(response[0], dict):
            current = response[0]
            continue
        if not response:
            return []
        raise QueryError("无法识别场地数据结构，接口格式可能已变化")
    raise QueryError("接口响应嵌套层数异常")


def request_board(
    query_date: str,
    profile: HarProfile | None,
    timeout: float,
) -> dict[str, Any]:
    parsed_date = Date.fromisoformat(query_date)
    params = {
        "detailId": VENUE_ID,
        "matchId": MATCH_ID,
        "weekNo": f"{parsed_date.isoweekday():02d}",
        "date": query_date,
    }
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "sourceType": "wx",
    }
    url = API_URL
    if profile is not None:
        params.update(
            {
                key: value
                for key, value in profile.params.items()
                if key not in {"date", "weekNo"}
            }
        )
        headers.update(profile.headers)
        url = profile.url

    params["date"] = query_date
    params["weekNo"] = f"{parsed_date.isoweekday():02d}"
    request_url = f"{url}?{urlencode(params)}"
    request = Request(request_url, headers=headers, method="GET")

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


def extract_free_blocks(
    board: dict[str, Any],
    query_date: str,
    now: datetime | None = None,
) -> list[FreeBlock]:
    """提取未出现在 locks 中、且尚未开始的场次。"""
    courts = _extract_courts(board)
    target_date = Date.fromisoformat(query_date)
    current = (now or datetime.now(CHINA_TZ)).astimezone(CHINA_TZ)
    current_minutes = current.hour * 60 + current.minute

    free: list[FreeBlock] = []
    for court in courts:
        court_name = court.get("fieldName")
        blocks = court.get("viewBlocks")
        locks = court.get("locks") or {}
        if not isinstance(court_name, str) or not isinstance(blocks, list):
            continue
        if not isinstance(locks, dict):
            locks = {}

        for block in blocks:
            if not isinstance(block, dict):
                continue
            code = block.get("code")
            start = block.get("startTime")
            end = block.get("endTime")
            if code in locks or not isinstance(start, int) or not isinstance(end, int):
                continue
            # 服务器的 locks 不包含已开始的当日场次，需在客户端排除。
            if target_date < current.date():
                continue
            if target_date == current.date() and start <= current_minutes:
                continue
            amount = block.get("amount")
            if not isinstance(amount, int) or isinstance(amount, bool):
                amount = None
            free.append(
                FreeBlock(
                    court=court_name,
                    start_minutes=start,
                    end_minutes=end,
                    amount_cents=amount,
                )
            )

    return sorted(
        free,
        key=lambda block: (
            block.start_minutes,
            block.end_minutes,
            natural_court_key(block.court),
        ),
    )


def natural_court_key(name: str) -> tuple[str, int, str]:
    prefix = name.rstrip("0123456789号场地")
    digits = "".join(character for character in name if character.isdigit())
    return prefix, int(digits) if digits else -1, name


def format_time(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def format_amount(cents: int | None) -> str:
    if cents is None:
        return ""
    amount = f"{cents / 100:.2f}".rstrip("0").rstrip(".")
    return f"¥{amount}"


def print_by_time(blocks: list[FreeBlock]) -> None:
    grouped: dict[tuple[int, int, int | None], list[str]] = defaultdict(list)
    for block in blocks:
        grouped[(block.start_minutes, block.end_minutes, block.amount_cents)].append(
            block.court
        )
    for start, end, cents in sorted(
        grouped,
        key=lambda item: (item[0], item[1], item[2] if item[2] is not None else -1),
    ):
        courts = sorted(grouped[(start, end, cents)], key=natural_court_key)
        amount = format_amount(cents)
        price_text = f" {amount}/场次" if amount else ""
        print(f"{format_time(start)}-{format_time(end)}{price_text}  {', '.join(courts)}")


def print_by_court(blocks: list[FreeBlock]) -> None:
    grouped: dict[str, list[FreeBlock]] = defaultdict(list)
    for block in blocks:
        grouped[block.court].append(block)
    for court in sorted(grouped, key=natural_court_key):
        periods = []
        for block in sorted(grouped[court], key=lambda item: item.start_minutes):
            amount = format_amount(block.amount_cents)
            periods.append(
                f"{format_time(block.start_minutes)}-{format_time(block.end_minutes)}"
                f"{f'({amount})' if amount else ''}"
            )
        print(f"{court}  {', '.join(periods)}")


def print_json(query_date: str, blocks: list[FreeBlock]) -> None:
    output = {
        "date": query_date,
        "venue": VENUE_NAME,
        "available": [
            {
                "court": block.court,
                "start": format_time(block.start_minutes),
                "end": format_time(block.end_minutes),
                "amount": block.amount_cents / 100 if block.amount_cents is not None else None,
            }
            for block in blocks
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="查询梅子指定日期的羽毛球场可预订时段"
    )
    parser.add_argument("date", type=parse_date, help="查询日期，格式 YYYY-MM-DD")
    parser.add_argument(
        "--har",
        type=Path,
        help="读取抓包中的场馆请求参数（忽略 token）",
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
        print("=" * 56)
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
