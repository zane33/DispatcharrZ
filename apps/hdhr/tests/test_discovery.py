import struct
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from apps.hdhr import discovery as d
from core.models import CoreSettings, STREAM_SETTINGS_KEY

# Exact DISCOVER_REQ bytes Jellyfin broadcasts (HdHomerunHost.cs) - pins our CRC/framing to a real client.
JELLYFIN_REQ = bytes([0, 2, 0, 12, 1, 4, 255, 255, 255, 255, 2, 4, 255, 255, 255, 255, 115, 204, 125, 143])


class PacketTests(SimpleTestCase):
    def test_request_matches_real_client_bytes(self):
        self.assertEqual(d.build_discover_request(), JELLYFIN_REQ)

    def test_reply_roundtrip(self):
        pkt = d.build_discover_reply("1058A2E9", 7, "http://192.168.3.148:9191/hdhr")
        pkt_type, tags = d.parse_packet(pkt)
        self.assertEqual(pkt_type, d.TYPE_DISCOVER_RPY)
        self.assertEqual(struct.unpack(">I", tags[d.TAG_DEVICE_TYPE])[0], d.DEVICE_TYPE_TUNER)
        self.assertEqual(tags[d.TAG_DEVICE_ID].hex().upper(), "1058A2E9")
        self.assertEqual(tags[d.TAG_TUNER_COUNT], b"\x07")
        self.assertEqual(tags[d.TAG_BASE_URL], b"http://192.168.3.148:9191/hdhr")
        self.assertEqual(tags[d.TAG_LINEUP_URL], b"http://192.168.3.148:9191/hdhr/lineup.json")

    def test_bad_crc_and_truncation_rejected(self):
        pkt = bytearray(JELLYFIN_REQ)
        pkt[-1] ^= 0xFF
        self.assertIsNone(d.parse_packet(bytes(pkt)))
        self.assertIsNone(d.parse_packet(JELLYFIN_REQ[:-1]))

    def test_long_tag_length_encoding(self):
        url = "http://x/" + "a" * 200
        _, tags = d.parse_packet(d.build_discover_reply(0x10000000, 1, url))
        self.assertEqual(tags[d.TAG_BASE_URL].decode(), url)

    def test_device_id_checksum(self):
        gen = d.generate_device_id(seed="x")
        self.assertRegex(gen, r"^1[0-9A-F]{7}$")
        self.assertTrue(d.validate_device_id(gen))
        self.assertEqual(gen, d.generate_device_id(seed="x"))
        self.assertNotEqual(gen, d.generate_device_id(seed="y"))
        self.assertFalse(d.validate_device_id("12345678"))
        self.assertFalse(d.validate_device_id("zz"))

    def test_handle_request_respects_enabled_and_id_filter(self):
        settings = {"discovery_enabled": True, "device_id": "1058A2E9", "tuner_count": 2}
        with patch.object(d, "local_ip_for", return_value="10.0.0.5"):
            reply = d.handle_request(JELLYFIN_REQ, "10.0.0.9", settings, "9191")
            self.assertEqual(d.parse_packet(reply)[1][d.TAG_BASE_URL], b"http://10.0.0.5:9191/hdhr")
            self.assertIsNone(d.handle_request(JELLYFIN_REQ, "10.0.0.9", {**settings, "discovery_enabled": False}, "9191"))
            other = d.build_discover_request(device_id=0x10000000)
            self.assertIsNone(d.handle_request(other, "10.0.0.9", settings, "9191"))
            self.assertIsNone(d.handle_request(b"garbage", "10.0.0.9", settings, "9191"))

    def test_handle_request_uses_advertised_url_over_detected_ip(self):
        settings = {"discovery_enabled": True, "device_id": "1058A2E9", "tuner_count": 2,
                    "advertised_url": "https://tv.example.com:8443"}
        with patch.object(d, "local_ip_for", return_value="172.21.0.2"):
            reply = d.handle_request(JELLYFIN_REQ, "10.0.0.9", settings, "9191")
        self.assertEqual(d.parse_packet(reply)[1][d.TAG_BASE_URL], b"https://tv.example.com:8443/hdhr")

    def test_normalize_advertised_url(self):
        self.assertEqual(d.normalize_advertised_url(None), "")
        self.assertEqual(d.normalize_advertised_url("  "), "")
        self.assertEqual(d.normalize_advertised_url("http://192.168.1.10:9191/"), "http://192.168.1.10:9191")
        self.assertEqual(d.normalize_advertised_url("https://tv.example.com"), "https://tv.example.com")
        for bad in ("192.168.1.10:9191", "ftp://x", "http://", "http://h/hdhr", "http://h?x=1", "http://h:99999"):
            self.assertIsNone(d.normalize_advertised_url(bad), bad)


class DiscoverJsonTests(TestCase):
    def test_discover_json_reflects_settings_and_generates_id(self):
        # Row may already exist from data migrations; merge like the settings API does.
        CoreSettings._update_group(
            STREAM_SETTINGS_KEY,
            "Stream Settings",
            {"hdhr_friendly_name": "Lounge Tuner", "hdhr_tuner_count": 4, "hdhr_device_id": ""},
        )
        resp = self.client.get("/hdhr/discover.json", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["FriendlyName"], "Lounge Tuner")
        self.assertEqual(data["TunerCount"], 4)
        self.assertTrue(d.validate_device_id(data["DeviceID"]))
        # Generated ID is persisted so UDP + HTTP agree
        self.assertEqual(CoreSettings.get_stream_settings()["hdhr_device_id"], data["DeviceID"])
        xml = self.client.get("/hdhr/device.xml", REMOTE_ADDR="127.0.0.1").content.decode()
        self.assertIn(f"<DeviceID>{data['DeviceID']}</DeviceID>", xml)
        self.assertIn("<FriendlyName>Lounge Tuner</FriendlyName>", xml)
