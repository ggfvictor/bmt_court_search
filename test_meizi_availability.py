import io
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qsl, urlsplit

import meizi_availability as ma


def sample_board():
    courts = [
        {
            "fieldName": "1号场地",
            "viewBlocks": [
                {
                    "code": "morning",
                    "startTime": 480,
                    "endTime": 600,
                    "amount": 10000,
                },
                {
                    "code": "evening",
                    "startTime": 1080,
                    "endTime": 1320,
                    "amount": 20000,
                },
            ],
            "locks": {"evening": {"visitFieldId": 1}},
        },
        {
            "fieldName": "2号场地",
            "viewBlocks": [
                {
                    "code": "morning",
                    "startTime": 480,
                    "endTime": 600,
                    "amount": 10000,
                }
            ],
            "locks": {},
        },
    ]
    return {
        "code": 200,
        "response": [{"code": 200, "message": "", "response": courts}],
        "message": "",
    }


class MeiziAvailabilityTests(unittest.TestCase):
    def test_venue_name(self):
        self.assertEqual(ma.VENUE_NAME, "梅子")

    def test_unlocked_future_blocks_are_available(self):
        now = datetime(2026, 8, 28, 21, 13, tzinfo=ma.CHINA_TZ)
        blocks = ma.extract_free_blocks(sample_board(), "2026-08-29", now=now)
        self.assertEqual(
            blocks,
            [
                ma.FreeBlock("1号场地", 480, 600, 10000),
                ma.FreeBlock("2号场地", 480, 600, 10000),
            ],
        )

    def test_started_blocks_are_not_reported_for_today(self):
        now = datetime(2026, 8, 28, 21, 13, tzinfo=ma.CHINA_TZ)
        blocks = ma.extract_free_blocks(sample_board(), "2026-08-28", now=now)
        self.assertEqual(blocks, [])

    def test_load_har_keeps_dates_and_only_needed_headers(self):
        har = {
            "log": {
                "entries": [
                    {
                        "startedDateTime": "2026-08-28T21:13:14+08:00",
                        "request": {
                            "method": "GET",
                            "url": ma.API_URL
                            + "?detailId=279&matchId=60&weekNo=06&date=2026-08-29",
                            "headers": [
                                {"name": "sourceType", "value": "wx"},
                                {"name": "token", "value": "secret"},
                                {"name": "Authorization", "value": "do-not-copy"},
                            ],
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
            profile = ma.load_har(path)
        self.assertEqual(profile.headers, {"sourcetype": "wx"})
        self.assertIn("2026-08-29", profile.responses)
        self.assertEqual(
            profile.responses["2026-08-29"].captured_at,
            datetime(2026, 8, 28, 21, 13, 14, tzinfo=ma.CHINA_TZ),
        )

    def test_live_request_sends_no_token(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            sample_board()
        ).encode("utf-8")
        with mock.patch.object(ma, "urlopen", return_value=response) as mocked_urlopen:
            result = ma.request_board("2026-08-29", profile=None, timeout=15)

        request = mocked_urlopen.call_args.args[0]
        sent_headers = {name.lower() for name, _ in request.header_items()}
        self.assertNotIn("token", sent_headers)
        params = dict(parse_qsl(urlsplit(request.full_url).query))
        self.assertEqual(params["date"], "2026-08-29")
        self.assertEqual(params["weekNo"], "06")
        self.assertEqual(result["code"], 200)

    def test_offline_requires_a_captured_date(self):
        har = {
            "log": {
                "entries": [
                    {
                        "request": {
                            "method": "GET",
                            "url": ma.API_URL
                            + "?detailId=279&matchId=60&weekNo=06&date=2026-08-29",
                            "headers": [{"name": "token", "value": "secret"}],
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
                code = ma.main(["2026-08-30", "--har", str(path), "--offline"])
        self.assertEqual(code, 1)
        self.assertIn("已录制日期：2026-08-29", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
