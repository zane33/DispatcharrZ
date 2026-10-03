from django.urls import path
from rest_framework.routers import DefaultRouter
from .api_views import (
    HDHRDeviceViewSet,
    DiscoverAPIView,
    LineupAPIView,
    LineupStatusAPIView,
    HDHRDeviceXMLAPIView,
)

app_name = 'hdhr'

router = DefaultRouter()
router.register(r'devices', HDHRDeviceViewSet, basename='hdhr-device')

urlpatterns = [
    # channel_profile + output_profile_id  (/hdhr/<channel_profile>/output_profile/<id>/...)
    path('<str:channel_profile>/output_profile/<int:output_profile_id>/discover.json', DiscoverAPIView.as_view(), name='discover_with_profile_and_output'),
    path('<str:channel_profile>/output_profile/<int:output_profile_id>/lineup.json', LineupAPIView.as_view(), name='lineup_with_profile_and_output'),
    path('<str:channel_profile>/output_profile/<int:output_profile_id>/lineup_status.json', LineupStatusAPIView.as_view(), name='lineup_status_with_profile_and_output'),

    # output_profile_id only  (/hdhr/output_profile/<id>/...)
    path('output_profile/<int:output_profile_id>/discover.json', DiscoverAPIView.as_view(), name='discover_with_output'),
    path('output_profile/<int:output_profile_id>/lineup.json', LineupAPIView.as_view(), name='lineup_with_output'),
    path('output_profile/<int:output_profile_id>/lineup_status.json', LineupStatusAPIView.as_view(), name='lineup_status_with_output'),

    # Profiles by NAME: /hdhr/<output_profile>/, /hdhr/<channel_profile>/ or
    # /hdhr/<channel_profile>/<output_profile>/. One greedy <path> segment because
    # profile names may themselves contain '/'; _resolve_hdhr_profiles splits it.
    # Must stay below the literal 'output_profile/<int>' routes so those keep matching first.
    path('<path:profile_path>/discover.json', DiscoverAPIView.as_view(), name='discover_with_profile'),
    path('<path:profile_path>/lineup.json', LineupAPIView.as_view(), name='lineup_with_profile'),
    path('<path:profile_path>/lineup_status.json', LineupStatusAPIView.as_view(), name='lineup_status_with_profile'),

    # bare endpoints
    path('discover.json', DiscoverAPIView.as_view(), name='discover_no_profile'),
    path('lineup.json', LineupAPIView.as_view(), name='lineup_no_profile'),
    path('lineup_status.json', LineupStatusAPIView.as_view(), name='lineup_status_no_profile'),

    path('device.xml', HDHRDeviceXMLAPIView.as_view(), name='device_xml'),
]

urlpatterns += router.urls
