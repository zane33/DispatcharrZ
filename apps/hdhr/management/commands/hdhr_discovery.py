"""Run the HDHomeRun UDP discovery responder (own process; see docker/uwsgi*.ini attach-daemon)."""

from django.core.management.base import BaseCommand

from apps.hdhr.discovery import serve


class Command(BaseCommand):
    help = "Answer HDHomeRun UDP 65001 discovery broadcasts so Plex/Emby/Jellyfin auto-detect Dispatcharr"

    def handle(self, *args, **options):
        serve()
