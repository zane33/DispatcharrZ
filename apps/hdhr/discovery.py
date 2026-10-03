"""SiliconDust HDHomeRun UDP discovery (libhdhomerun hdhomerun_pkt.h / hdhomerun_discover.c).

Frame: u16 type (BE) | u16 payload len (BE) | TLV payload | u32 CRC32 (LE, zlib poly).
TLV: u8 tag | var-len (1 byte <128, else 2 bytes: (len & 0x7F) | 0x80, len >> 7) | value.
Plex, Emby, Jellyfin and Channels DVR broadcast DISCOVER_REQ to UDP 65001 and read the
BaseURL tag from DISCOVER_RPY, then GET {BaseURL}/discover.json.
"""

import hashlib
import logging
import os
import socket
import struct
import zlib

logger = logging.getLogger(__name__)

DISCOVER_UDP_PORT = 65001
TYPE_DISCOVER_REQ = 0x0002
TYPE_DISCOVER_RPY = 0x0003
TAG_DEVICE_TYPE = 0x01
TAG_DEVICE_ID = 0x02
TAG_TUNER_COUNT = 0x10
TAG_LINEUP_URL = 0x27
TAG_BASE_URL = 0x2A
DEVICE_TYPE_TUNER = 0x00000001
WILDCARD = 0xFFFFFFFF

# hdhomerun_discover_validate_device_id lookup table
_ID_LOOKUP = [0xA, 0x5, 0xF, 0x6, 0x7, 0xC, 0x1, 0xB, 0x9, 0x2, 0x8, 0xD, 0x4, 0x3, 0xE, 0x0]


def _id_checksum(device_id):
    checksum = 0
    for shift in range(28, -1, -4):
        nibble = (device_id >> shift) & 0xF
        checksum ^= _ID_LOOKUP[nibble] if shift % 8 == 4 else nibble
    return checksum


def validate_device_id(device_id):
    """True when ``device_id`` (int or 8-hex str) passes the SiliconDust checksum."""
    try:
        value = int(device_id, 16) if isinstance(device_id, str) else int(device_id)
    except (TypeError, ValueError):
        return False
    if isinstance(device_id, str) and len(device_id) != 8:
        return False
    return 0 <= value <= WILDCARD and _id_checksum(value) == 0


def generate_device_id(seed=None):
    """Deterministic 8-hex device ID with a valid checksum nibble.

    Seeded from Django SECRET_KEY by default so a wiped settings row regenerates
    the same ID and clients keep their tuner mapping.
    """
    if seed is None:
        from django.conf import settings

        seed = settings.SECRET_KEY
    digest = hashlib.sha256(str(seed).encode()).digest()
    # Real SiliconDust IDs start with 0x1; keep the prefix so clients don't balk.
    value = 0x10000000 | (int.from_bytes(digest[:4], "big") & 0x0FFFFFF0)
    value |= _id_checksum(value)  # last nibble is direct, so this zeroes the total
    return f"{value:08X}"


def _tlv(tag, value):
    length = len(value)
    if length < 128:
        return bytes([tag, length]) + value
    return bytes([tag, (length & 0x7F) | 0x80, length >> 7]) + value


def build_packet(pkt_type, tags):
    """``tags`` is a list of (tag, bytes) pairs."""
    payload = b"".join(_tlv(tag, value) for tag, value in tags)
    frame = struct.pack(">HH", pkt_type, len(payload)) + payload
    return frame + struct.pack("<I", zlib.crc32(frame) & 0xFFFFFFFF)


def parse_packet(data):
    """Return (type, {tag: bytes}) or None if the frame is malformed or CRC fails."""
    if len(data) < 8:
        return None
    pkt_type, length = struct.unpack(">HH", data[:4])
    if len(data) != 4 + length + 4:
        return None
    frame, (crc,) = data[:-4], struct.unpack("<I", data[-4:])
    if zlib.crc32(frame) & 0xFFFFFFFF != crc:
        return None
    tags, pos, end = {}, 4, 4 + length
    while pos < end:
        tag = frame[pos]
        pos += 1
        if pos >= end:
            return None
        vlen = frame[pos]
        pos += 1
        if vlen & 0x80:
            if pos >= end:
                return None
            vlen = (vlen & 0x7F) | (frame[pos] << 7)
            pos += 1
        if pos + vlen > end:
            return None
        tags[tag] = frame[pos : pos + vlen]
        pos += vlen
    return pkt_type, tags


def build_discover_request(device_type=WILDCARD, device_id=WILDCARD):
    return build_packet(
        TYPE_DISCOVER_REQ,
        [(TAG_DEVICE_TYPE, struct.pack(">I", device_type)), (TAG_DEVICE_ID, struct.pack(">I", device_id))],
    )


def build_discover_reply(device_id, tuner_count, base_url):
    """``device_id`` is an int or 8-hex string; ``base_url`` has no trailing slash."""
    if isinstance(device_id, str):
        device_id = int(device_id, 16)
    return build_packet(
        TYPE_DISCOVER_RPY,
        [
            (TAG_DEVICE_TYPE, struct.pack(">I", DEVICE_TYPE_TUNER)),
            (TAG_DEVICE_ID, struct.pack(">I", device_id)),
            (TAG_TUNER_COUNT, bytes([min(max(int(tuner_count), 1), 255)])),
            (TAG_BASE_URL, base_url.encode()),
            (TAG_LINEUP_URL, f"{base_url}/lineup.json".encode()),
        ],
    )


def local_ip_for(peer_ip):
    """The local address the kernel would route to ``peer_ip`` from (what Plex can reach us on)."""
    family = socket.AF_INET6 if ":" in peer_ip else socket.AF_INET
    with socket.socket(family, socket.SOCK_DGRAM) as probe:
        probe.connect((peer_ip, 9))
        return probe.getsockname()[0]


def _should_reply(tags, our_device_id):
    """Honour the request's device_id filter; device_type is filtered client-side by libhdhomerun."""
    wanted = tags.get(TAG_DEVICE_ID)
    if wanted is None or len(wanted) != 4:
        return True
    wanted_id = struct.unpack(">I", wanted)[0]
    return wanted_id in (WILDCARD, int(our_device_id, 16))


def handle_request(data, peer_ip, hdhr_settings, port):
    """Pure helper: return the reply bytes for ``data`` or None. Testable without sockets."""
    parsed = parse_packet(data)
    if parsed is None or parsed[0] != TYPE_DISCOVER_REQ:
        return None
    if not hdhr_settings["discovery_enabled"] or not _should_reply(parsed[1], hdhr_settings["device_id"]):
        return None
    base_url = f"http://{local_ip_for(peer_ip)}:{port}/hdhr"
    return build_discover_reply(hdhr_settings["device_id"], hdhr_settings["tuner_count"], base_url)


def serve(stop_event=None, bind=("0.0.0.0", DISCOVER_UDP_PORT)):
    """Blocking UDP responder. Re-reads settings per request so the UI toggle applies live."""
    from core.models import CoreSettings
    from dispatcharr.utils import ip_network_allowed

    port = os.environ.get("DISPATCHARR_PORT", "9191")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind(bind)
    sock.settimeout(1.0)
    logger.info("HDHomeRun discovery listening on UDP %s", bind[1])
    try:
        while stop_event is None or not stop_event.is_set():
            try:
                data, (peer_ip, peer_port) = sock.recvfrom(2048)
            except socket.timeout:
                continue
            try:
                # Same allowlist as /hdhr/*.json: discovery leaks the base URL.
                if not ip_network_allowed(peer_ip, "M3U_EPG"):
                    continue
                reply = handle_request(data, peer_ip, CoreSettings.get_hdhr_settings(), port)
                if reply:
                    sock.sendto(reply, (peer_ip, peer_port))
                    logger.debug("HDHomeRun discovery reply sent to %s:%s", peer_ip, peer_port)
            except Exception:
                logger.exception("HDHomeRun discovery: failed handling packet from %s", peer_ip)
    finally:
        sock.close()
