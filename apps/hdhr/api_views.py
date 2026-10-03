from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from apps.accounts.permissions import Authenticated, permission_classes_by_action
from django.http import JsonResponse, HttpResponseForbidden, HttpResponse
import logging
from xml.sax.saxutils import escape
from django.utils.encoding import escape_uri_path
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes
from django.shortcuts import get_object_or_404
from django.db import models
from apps.channels.models import Channel, ChannelProfile, Stream
from .models import HDHRDevice
from .serializers import HDHRDeviceSerializer
from dispatcharr.utils import network_access_allowed
from core.utils import build_absolute_uri_with_port

# Configure logger
logger = logging.getLogger(__name__)


def _hdhr_network_check(request):
    """Return a 403 JsonResponse if the client IP is not allowed by the
    M3U_EPG network access policy. HDHR discovery endpoints expose channel
    inventory and stream URLs, so they share the same allowlist as M3U/EPG.
    """
    if not network_access_allowed(request, "M3U_EPG"):
        return JsonResponse({"error": "Forbidden"}, status=403)
    return None


# 🔹 1) HDHomeRun Device API
class HDHRDeviceViewSet(viewsets.ModelViewSet):
    """Handles CRUD operations for HDHomeRun devices"""

    queryset = HDHRDevice.objects.all()
    serializer_class = HDHRDeviceSerializer

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            return [Authenticated()]


# 🔹 2) Discover API
class DiscoverAPIView(APIView):
    """Returns device discovery information"""
    permission_classes = [AllowAny]

    @extend_schema(
        description="Retrieve HDHomeRun device discovery information",
    )
    def get(self, request, channel_profile=None, output_profile=None, output_profile_id=None):
        blocked = _hdhr_network_check(request)
        if blocked is not None:
            return blocked

        # Echo whatever path form the client used (by-name, legacy numeric, combined).
        base_url = build_absolute_uri_with_port(request, escape_uri_path(request.path.rsplit("/", 1)[0]))

        from core.models import CoreSettings
        hdhr = CoreSettings.get_hdhr_settings()

        slug_parts = [p for p in [channel_profile, output_profile, str(output_profile_id) if output_profile_id is not None else None] if p]
        # Profile variants need their own ID so clients see distinct tuners, but it
        # must stay a checksum-valid 8-hex ID or libhdhomerun clients (Plex) drop it.
        from .discovery import generate_device_id
        device_ID = generate_device_id(f"{hdhr['device_id']}:{'/'.join(slug_parts)}") if slug_parts else hdhr["device_id"]
        friendly_name = f"{hdhr['friendly_name']} - {' / '.join(slug_parts)}" if slug_parts else hdhr["friendly_name"]

        data = {
            "FriendlyName": friendly_name,
            "ModelNumber": "HDTC-2US",
            "FirmwareName": "hdhomerun3_atsc",
            "FirmwareVersion": "20200101",
            "DeviceID": device_ID,
            "DeviceAuth": "test_auth_token",
            "BaseURL": base_url,
            "LineupURL": f"{base_url}/lineup.json",
            "TunerCount": hdhr["tuner_count"],
        }
        return JsonResponse(data)


_name_collisions_warned = set()


def _resolve_hdhr_profiles(channel_profile=None, output_profile=None, output_profile_id=None):
    """Map `<str>` URL segments (names) to (channel_profile_name | None, output_profile_id | None).

    `/hdhr/<name>/` is a ChannelProfile name if one exists, else an active OutputProfile
    name. On collision the ChannelProfile wins (warned once per name); use the combined
    `/hdhr/<channel_profile>/<output_profile>/` form to get both.
    """
    from core.models import OutputProfile

    if output_profile is not None:
        op = OutputProfile.objects.filter(name=output_profile, is_active=True).first()
        if op is None:
            logger.warning("HDHR output profile '%s' not found or inactive", output_profile)
        output_profile_id = op.id if op else output_profile_id

    if channel_profile is not None:
        is_channel_profile = ChannelProfile.objects.filter(name=channel_profile).exists()
        op = OutputProfile.objects.filter(name=channel_profile, is_active=True).first()
        if op is not None and not is_channel_profile:
            return None, op.id
        if op is not None and channel_profile not in _name_collisions_warned:
            _name_collisions_warned.add(channel_profile)
            logger.warning(
                "HDHR: '%s' names both a ChannelProfile and an OutputProfile; using the ChannelProfile. "
                "Use /hdhr/<channel_profile>/<output_profile>/ to select both.", channel_profile,
            )
    return channel_profile, output_profile_id


def _resolve_hdhr_output_profile_id(output_profile_id):
    """Return a validated output profile ID for HDHR lineup stream URLs.

    Priority: URL path segment -> system default -> None (pass-through).
    """
    from core.models import OutputProfile, CoreSettings
    candidate = output_profile_id if output_profile_id is not None else CoreSettings.get_hdhr_output_profile_id()
    if candidate is None:
        return None
    try:
        OutputProfile.objects.get(id=candidate, is_active=True)
        return candidate
    except OutputProfile.DoesNotExist:
        source = "URL" if output_profile_id is not None else "system default"
        logger.warning("HDHR output profile id=%s (%s) not found or inactive - serving without transcoding", candidate, source)
        return None


# 🔹 3) Lineup API
class LineupAPIView(APIView):
    """Returns available channel lineup"""
    permission_classes = [AllowAny]

    @extend_schema(
        description="Retrieve the available channel lineup",
    )
    def get(self, request, channel_profile=None, output_profile=None, output_profile_id=None):
        blocked = _hdhr_network_check(request)
        if blocked is not None:
            return blocked

        from apps.channels.managers import with_effective_values
        from apps.channels.utils import format_channel_number

        channel_profile, output_profile_id = _resolve_hdhr_profiles(channel_profile, output_profile, output_profile_id)

        if channel_profile is not None:
            try:
                cp = ChannelProfile.objects.get(name=channel_profile)
            except ChannelProfile.DoesNotExist:
                return JsonResponse([], safe=False)
            base_qs = Channel.objects.filter(
                channelprofilemembership__channel_profile=cp,
                channelprofilemembership__enabled=True,
            )
        else:
            base_qs = Channel.objects.all()

        channels = (
            with_effective_values(base_qs)
            .exclude(hidden_from_output=True)
            .order_by("effective_channel_number")
        )

        resolved_output_profile_id = _resolve_hdhr_output_profile_id(output_profile_id)

        _stream_url_prefix = build_absolute_uri_with_port(request, "/proxy/ts/stream/")
        _output_profile_qs = (
            f"?output_profile={resolved_output_profile_id}"
            if resolved_output_profile_id is not None
            else ""
        )

        lineup = []
        for ch in channels:
            formatted = format_channel_number(ch.effective_channel_number, empty=None)
            if formatted is None:
                continue
            formatted_channel_number = str(formatted)

            stream_url = f"{_stream_url_prefix}{ch.uuid}{_output_profile_qs}"

            lineup.append(
                {
                    "GuideNumber": formatted_channel_number,
                    "GuideName": ch.effective_name,
                    "URL": stream_url,
                    "Guide_ID": formatted_channel_number,
                    "Station": formatted_channel_number,
                }
            )
        return JsonResponse(lineup, safe=False)


# 🔹 4) Lineup Status API
class LineupStatusAPIView(APIView):
    """Returns the current status of the HDHR lineup"""
    permission_classes = [AllowAny]

    @extend_schema(
        description="Retrieve the HDHomeRun lineup status",
    )
    def get(self, request, channel_profile=None, output_profile=None, output_profile_id=None):
        blocked = _hdhr_network_check(request)
        if blocked is not None:
            return blocked

        data = {
            "ScanInProgress": 0,
            "ScanPossible": 0,
            "Source": "Cable",
            "SourceList": ["Cable"],
        }
        return JsonResponse(data)


# 🔹 5) Device XML API
class HDHRDeviceXMLAPIView(APIView):
    """Returns HDHomeRun device configuration in XML"""
    permission_classes = [AllowAny]

    @extend_schema(
        description="Retrieve the HDHomeRun device XML configuration",
    )
    def get(self, request):
        blocked = _hdhr_network_check(request)
        if blocked is not None:
            return blocked

        base_url = build_absolute_uri_with_port(request, "/hdhr/").rstrip("/")

        from core.models import CoreSettings
        hdhr = CoreSettings.get_hdhr_settings()

        xml_response = f"""<?xml version="1.0" encoding="utf-8"?>
        <root>
            <DeviceID>{hdhr["device_id"]}</DeviceID>
            <FriendlyName>{escape(hdhr["friendly_name"])}</FriendlyName>
            <ModelNumber>HDTC-2US</ModelNumber>
            <FirmwareName>hdhomerun3_atsc</FirmwareName>
            <FirmwareVersion>20200101</FirmwareVersion>
            <DeviceAuth>test_auth_token</DeviceAuth>
            <BaseURL>{base_url}</BaseURL>
            <LineupURL>{base_url}/lineup.json</LineupURL>
        </root>"""

        return HttpResponse(xml_response, content_type="application/xml")
