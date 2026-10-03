import { isNotEmpty } from '@mantine/form';

// SiliconDust device ID checksum (libhdhomerun hdhomerun_discover_validate_device_id)
const ID_LOOKUP = [
  0xa, 0x5, 0xf, 0x6, 0x7, 0xc, 0x1, 0xb, 0x9, 0x2, 0x8, 0xd, 0x4, 0x3, 0xe,
  0x0,
];

export const isValidHdhrDeviceId = (value) => {
  if (!/^[0-9a-fA-F]{8}$/.test(value || '')) return false;
  let checksum = 0;
  for (let i = 0; i < 8; i++) {
    const nibble = parseInt(value[i], 16);
    checksum ^= i % 2 === 0 ? ID_LOOKUP[nibble] : nibble;
  }
  return checksum === 0;
};

export const getStreamSettingsFormInitialValues = () => {
  return {
    default_user_agent: '',
    default_stream_profile: '',
    m3u_hash_key: [],
    default_output_format: 'mpegts',
    hdhr_output_profile_id: null,
    hdhr_discovery_enabled: true,
    hdhr_friendly_name: 'Dispatcharr HDHomeRun',
    hdhr_device_id: '',
    hdhr_tuner_count: null,
    hdhr_advertised_url: '',
  };
};

export const getStreamSettingsFormValidation = () => {
  return {
    default_user_agent: isNotEmpty('Select a user agent'),
    default_stream_profile: isNotEmpty('Select a stream profile'),
    hdhr_friendly_name: (value) =>
      (value || '').trim().length > 64
        ? 'Must be 64 characters or fewer'
        : null,
    hdhr_device_id: (value) =>
      !value || isValidHdhrDeviceId(value)
        ? null
        : '8 hex digits with a valid HDHomeRun checksum (leave blank to auto-generate)',
    hdhr_tuner_count: (value) =>
      value == null ||
      value === '' ||
      (Number.isInteger(Number(value)) && value >= 1 && value <= 255)
        ? null
        : 'Leave blank for auto, or enter 1-255',
    hdhr_advertised_url: (value) =>
      !value || /^https?:\/\/[^/?#\s]+\/?$/.test(value.trim())
        ? null
        : 'Must be an http(s) URL with host and optional port, no path (e.g. http://192.168.1.10:9191)',
  };
};
