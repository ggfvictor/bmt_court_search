import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import qingyu_availability as qa


class AvailabilityTests(unittest.TestCase):
    def test_venue_name(self):
        self.assertEqual(qa.VENUE_NAME, "青羽")

    def test_extracts_only_status_zero_without_private_order_fields(self):
        board = {
            "errno": 200,
            "errmsg": "操作成功",
            "data": {
                "itemArr": [
                    [
                        {
                            "deskName": "羽毛球场1",
                            "businessBegins": "09:00",
                            "businessEnds": "10:00",
                            "status": 0,
                            "money": 55.0,
                        },
                        {
                            "deskName": "羽毛球场1",
                            "businessBegins": "10:00",
                            "businessEnds": "11:00",
                            "status": 2,
                            "mobile": "REDACTED",
                            "billCode": "REDACTED",
                        },
                    ],
                    [
                        {
                            "deskName": "羽毛球场2",
                            "businessBegins": "09:00",
                            "businessEnds": "10:00",
                            "status": 1,
                        }
                    ],
                ]
            },
        }
        self.assertEqual(
            qa.extract_free_slots(board),
            [qa.FreeSlot("羽毛球场1", "09:00", "10:00", 55.0)],
        )

    def test_merges_adjacent_periods_for_court_view(self):
        slots = [
            qa.FreeSlot("羽毛球场1", "09:00", "10:00", 55),
            qa.FreeSlot("羽毛球场1", "10:00", "11:00", 55),
            qa.FreeSlot("羽毛球场1", "12:00", "13:00", 60),
        ]
        self.assertEqual(
            qa._merge_court_slots(slots),
            [("09:00", "11:00", {55}), ("12:00", "13:00", {60})],
        )

    def test_load_har_finds_request_and_response(self):
        har = {
            "log": {
                "entries": [
                    {
                        "request": {
                            "method": "POST",
                            "url": qa.API_URL,
                            "headers": [
                                {"name": "X-Merchant-Id", "value": "shop"},
                                {"name": "Authorization", "value": "must-not-copy"},
                            ],
                            "postData": {
                                "text": json.dumps(
                                    {
                                        "date": "2026-08-29",
                                        "token": "secret",
                                        "shopId": "shop",
                                    }
                                )
                            },
                        },
                        "response": {
                            "content": {
                                "text": json.dumps(
                                    {"errno": 200, "data": {"itemArr": []}}
                                )
                            }
                        },
                    }
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.har"
            path.write_text(json.dumps(har), encoding="utf-8")
            profile = qa.load_har(path)
        self.assertNotIn("token", profile.payload)
        self.assertEqual(profile.headers, {"x-merchant-id": "shop"})
        self.assertEqual(profile.response["errno"], 200)

    def test_live_request_sends_no_token(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"errno": 200, "data": {"itemArr": []}}
        ).encode("utf-8")
        with mock.patch.object(qa, "urlopen", return_value=response) as mocked_urlopen:
            result = qa.request_board("2026-08-29", profile=None, timeout=15)

        request = mocked_urlopen.call_args.args[0]
        sent_headers = {name.lower() for name, _ in request.header_items()}
        self.assertNotIn("token", sent_headers)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertNotIn("token", payload)
        self.assertEqual(payload["date"], "2026-08-29")
        self.assertEqual(payload["shopName"], "青羽")
        self.assertEqual(result["errno"], 200)

    def test_offline_rejects_date_other_than_captured_date(self):
        har = {
            "log": {
                "entries": [
                    {
                        "request": {
                            "method": "POST",
                            "url": qa.API_URL,
                            "headers": [],
                            "postData": {
                                "text": json.dumps(
                                    {"date": "2026-08-29", "token": "secret"}
                                )
                            },
                        },
                        "response": {
                            "content": {
                                "text": json.dumps(
                                    {"errno": 200, "data": {"itemArr": []}}
                                )
                            }
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
                code = qa.main(["2026-08-28", "--har", str(path), "--offline"])
        self.assertEqual(code, 1)
        self.assertIn("录制的是", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
