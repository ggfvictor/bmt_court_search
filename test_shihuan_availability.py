import io
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import shihuan_availability as sa


def sample_board():
    return {
        "code": 200,
        "data": {
            "booking_array": [
                {
                    "booking_infos": [
                        {
                            "fieldName": "1号场",
                            "showStartTime": "08:30",
                            "showEndTime": "11:30",
                            "price": 55,
                            "total": 165,
                            "state": {"no": 0, "state": "可预订"},
                        },
                        {
                            "fieldName": "2号场",
                            "showStartTime": "08:30",
                            "showEndTime": "11:30",
                            "price": 55,
                            "total": 165,
                            "state": {"no": 1, "state": "不可预订"},
                            "orderInfo": {"private": "must-not-output"},
                        },
                    ]
                }
            ],
            "time_slot": ["08:30", "11:30"],
            "field_slot": ["1号场", "2号场"],
        },
    }


class ShihuanAvailabilityTests(unittest.TestCase):
    def test_venue_name(self):
        self.assertEqual(sa.VENUE_NAME, "十环")

    def test_extracts_only_explicitly_bookable_blocks(self):
        now = datetime(2026, 8, 28, 21, 22, tzinfo=sa.CHINA_TZ)
        blocks = sa.extract_free_blocks(sample_board(), "2026-08-29", now=now)
        self.assertEqual(blocks, [sa.FreeBlock("1号场", "08:30", "11:30", 55, 165)])

    def test_started_blocks_are_not_reported_for_today(self):
        now = datetime(2026, 8, 28, 9, 0, tzinfo=sa.CHINA_TZ)
        self.assertEqual(sa.extract_free_blocks(sample_board(), "2026-08-28", now=now), [])

    def test_china_midnight_timestamp_conversion(self):
        self.assertEqual(sa.date_to_timestamp_ms("2026-08-29"), 1787932800000)
        self.assertEqual(sa.timestamp_ms_to_date(1787932800000), "2026-08-29")

    def test_load_har_ignores_all_captured_identity_headers(self):
        har = {
            "log": {
                "entries": [
                    {
                        "startedDateTime": "2026-08-28T21:22:45+08:00",
                        "request": {
                            "method": "POST",
                            "url": sa.API_URL,
                            "headers": [
                                {"name": "appId", "value": "app"},
                                {"name": "memberId", "value": "member"},
                                {"name": "token", "value": "secret"},
                                {"name": "openid", "value": "openid"},
                                {"name": "Authorization", "value": "do-not-copy"},
                            ],
                            "postData": {
                                "text": json.dumps(
                                    {
                                        "orderDateNum": 1787932800000,
                                        "_venue": "venue",
                                        "_item": "item",
                                        "_org": "org",
                                    }
                                )
                            },
                        },
                        "response": {
                            "content": {"text": json.dumps(sample_board())}
                        },
                    }
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.har"
            path.write_text(json.dumps(har), encoding="utf-8")
            profile = sa.load_har(path)
        self.assertFalse(hasattr(profile, "headers"))
        self.assertIn("2026-08-29", profile.responses)

    def test_live_request_sends_no_identity_headers(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            sample_board()
        ).encode("utf-8")
        with mock.patch.object(sa, "urlopen", return_value=response) as mocked_urlopen:
            result = sa.request_board("2026-08-29", profile=None, timeout=15)

        request = mocked_urlopen.call_args.args[0]
        sent_headers = {name.lower() for name, _ in request.header_items()}
        self.assertTrue(
            {"appid", "memberid", "token", "openid"}.isdisjoint(sent_headers)
        )
        self.assertEqual(result["code"], 200)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["_venue"], sa.VENUE_ID)
        self.assertEqual(payload["_item"], sa.ITEM_ID)
        self.assertEqual(payload["_org"], sa.ORG_ID)

    def test_offline_requires_a_captured_date(self):
        har = {
            "log": {
                "entries": [
                    {
                        "request": {
                            "method": "POST",
                            "url": sa.API_URL,
                            "headers": [],
                            "postData": {
                                "text": json.dumps({"orderDateNum": 1787932800000})
                            },
                        },
                        "response": {
                            "content": {"text": json.dumps(sample_board())}
                        },
                    }
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.har"
            path.write_text(json.dumps(har), encoding="utf-8")
            stderr = io.StringIO()
            with mock.patch("sys.stderr", stderr):
                code = sa.main(["2026-08-30", "--har", str(path), "--offline"])
        self.assertEqual(code, 1)
        self.assertIn("已录制日期：2026-08-29", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
