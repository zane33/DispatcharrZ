from django.test import TestCase
from django.urls import resolve

from apps.channels.models import Channel, ChannelProfile, ChannelProfileMembership
from core.models import OutputProfile


def _op(name, **kw):
    return OutputProfile.objects.create(
        name=name, command="ffmpeg", parameters="-i pipe:0 -c copy -f mpegts pipe:1", locked=False, **kw
    )


class HDHRProfileRouteTests(TestCase):
    """`/hdhr/<name>/` resolves a ChannelProfile or (fallback) an OutputProfile by name."""

    def setUp(self):
        self.out = _op("720p Transcode")
        self.cp = ChannelProfile.objects.create(name="Sports")
        self.in_profile = Channel.objects.create(name="In", channel_number=1)
        self.other = Channel.objects.create(name="Out", channel_number=2)
        ChannelProfileMembership.objects.create(channel_profile=self.cp, channel=self.in_profile, enabled=True)

    def lineup(self, path):
        resp = self.client.get(path, REMOTE_ADDR="127.0.0.1")
        self.assertEqual(resp.status_code, 200, path)
        return resp.json()

    def test_output_profile_by_name(self):
        lineup = self.lineup("/hdhr/720p%20Transcode/lineup.json")
        self.assertEqual(len(lineup), 2)  # no channel-profile filter
        for ch in lineup:
            self.assertTrue(ch["URL"].endswith(f"?output_profile={self.out.id}"))
        disc = self.lineup("/hdhr/720p%20Transcode/discover.json")
        self.assertTrue(disc["BaseURL"].endswith("/hdhr/720p%20Transcode"))
        self.assertEqual(disc["LineupURL"], disc["BaseURL"] + "/lineup.json")

    def test_channel_profile_by_name_unchanged(self):
        lineup = self.lineup("/hdhr/Sports/lineup.json")
        self.assertEqual([c["GuideName"] for c in lineup], ["In"])
        self.assertNotIn("output_profile", lineup[0]["URL"])

    def test_combined_channel_and_output_profile_by_name(self):
        lineup = self.lineup("/hdhr/Sports/720p%20Transcode/lineup.json")
        self.assertEqual([c["GuideName"] for c in lineup], ["In"])
        self.assertTrue(lineup[0]["URL"].endswith(f"?output_profile={self.out.id}"))
        disc = self.lineup("/hdhr/Sports/720p%20Transcode/discover.json")
        self.assertTrue(disc["BaseURL"].endswith("/hdhr/Sports/720p%20Transcode"))
        self.assertEqual(self.lineup("/hdhr/Sports/720p%20Transcode/lineup_status.json")["Source"], "Cable")

    def test_collision_channel_profile_wins(self):
        _op("Sports")
        with self.assertLogs("apps.hdhr.api_views", level="WARNING") as logs:
            lineup = self.lineup("/hdhr/Sports/lineup.json")
        self.assertEqual([c["GuideName"] for c in lineup], ["In"])
        self.assertNotIn("output_profile", lineup[0]["URL"])
        self.assertTrue(any("names both" in line for line in logs.output))

    def test_inactive_output_profile_name_is_not_matched(self):
        _op("Dormant", is_active=False)
        self.assertEqual(self.lineup("/hdhr/Dormant/lineup.json"), [])  # treated as unknown channel profile

    def test_legacy_numeric_routes_still_work(self):
        lineup = self.lineup(f"/hdhr/output_profile/{self.out.id}/lineup.json")
        self.assertEqual(len(lineup), 2)
        self.assertTrue(lineup[0]["URL"].endswith(f"?output_profile={self.out.id}"))
        lineup = self.lineup(f"/hdhr/Sports/output_profile/{self.out.id}/lineup.json")
        self.assertEqual([c["GuideName"] for c in lineup], ["In"])
        self.assertTrue(lineup[0]["URL"].endswith(f"?output_profile={self.out.id}"))
        disc = self.lineup(f"/hdhr/output_profile/{self.out.id}/discover.json")
        self.assertTrue(disc["BaseURL"].endswith(f"/hdhr/output_profile/{self.out.id}"))

    def test_url_resolver_ordering(self):
        # literal 'output_profile/<int>' beats the generic <str>/<str> route
        m = resolve("/hdhr/output_profile/5/lineup.json")
        self.assertEqual(m.url_name, "lineup_with_output")
        self.assertEqual(m.kwargs, {"output_profile_id": 5})
        m = resolve("/hdhr/Sports/output_profile/5/lineup.json")
        self.assertEqual(m.url_name, "lineup_with_profile_and_output")
        m = resolve("/hdhr/Sports/720p Transcode/lineup.json")
        self.assertEqual(m.url_name, "lineup_with_profile")
        self.assertEqual(m.kwargs, {"profile_path": "Sports/720p Transcode"})
        m = resolve("/hdhr/720p Transcode/lineup.json")
        self.assertEqual(m.url_name, "lineup_with_profile")


    def test_output_profile_name_containing_slash(self):
        # "Plex/TV" must resolve as ONE output profile, not channel "Plex" + output "TV".
        op = _op("Plex/TV")
        lineup = self.lineup("/hdhr/Plex%2FTV/lineup.json")
        self.assertEqual(len(lineup), 2)
        for ch in lineup:
            self.assertTrue(ch["URL"].endswith(f"?output_profile={op.id}"))
        # combined form with a slashed output profile name
        lineup = self.lineup("/hdhr/Sports/Plex%2FTV/lineup.json")
        self.assertEqual([c["GuideName"] for c in lineup], ["In"])
        self.assertTrue(lineup[0]["URL"].endswith(f"?output_profile={op.id}"))
