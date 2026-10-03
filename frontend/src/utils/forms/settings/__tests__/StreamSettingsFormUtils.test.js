import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StreamSettingsFormUtils from '../StreamSettingsFormUtils';
import { isNotEmpty } from '@mantine/form';

vi.mock('@mantine/form', () => ({
  isNotEmpty: vi.fn((message) => message),
}));

describe('StreamSettingsFormUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStreamSettingsFormInitialValues', () => {
    it('should return initial values with correct defaults', () => {
      const result =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();

      expect(result).toEqual({
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
      });
    });

    it('should return null for hdhr_output_profile_id', () => {
      const result =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();

      expect(result['hdhr_output_profile_id']).toBeNull();
    });

    it('should return empty array for m3u-hash-key', () => {
      const result =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();

      expect(result['m3u_hash_key']).toEqual([]);
      expect(Array.isArray(result['m3u_hash_key'])).toBe(true);
    });

    it('should return a new object each time', () => {
      const result1 =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();
      const result2 =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();

      expect(result1).toEqual(result2);
      expect(result1).not.toBe(result2);
    });

    it('should return a new array instance for m3u-hash-key each time', () => {
      const result1 =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();
      const result2 =
        StreamSettingsFormUtils.getStreamSettingsFormInitialValues();

      expect(result1['m3u_hash_key']).not.toBe(result2['m3u_hash_key']);
    });
  });

  describe('getStreamSettingsFormValidation', () => {
    it('should return validation functions for required fields', () => {
      const result = StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(Object.keys(result)).toEqual([
        'default_user_agent',
        'default_stream_profile',
        'hdhr_friendly_name',
        'hdhr_device_id',
        'hdhr_tuner_count',
        'hdhr_advertised_url',
      ]);
    });

    it('should use isNotEmpty validator for default_user_agent', () => {
      StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(isNotEmpty).toHaveBeenCalledWith('Select a user agent');
    });

    it('should use isNotEmpty validator for default_stream_profile', () => {
      StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(isNotEmpty).toHaveBeenCalledWith('Select a stream profile');
    });

    it('should not include validation for preferred_region', () => {
      const result = StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(result).not.toHaveProperty('preferred_region');
    });

    it('should not include validation for auto-import-mapped-files', () => {
      const result = StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(result).not.toHaveProperty('auto_import_mapped_files');
    });

    it('should not include validation for m3u-hash-key', () => {
      const result = StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(result).not.toHaveProperty('m3u_hash_key');
    });

    it('should return correct validation error messages', () => {
      const result = StreamSettingsFormUtils.getStreamSettingsFormValidation();

      expect(result['default_user_agent']).toBe('Select a user agent');
      expect(result['default_stream_profile']).toBe('Select a stream profile');
      expect(result).not.toHaveProperty('preferred_region');
    });
  });

  describe('isValidHdhrDeviceId', () => {
    it('accepts IDs with a valid SiliconDust checksum', () => {
      // lookup[1]=0x5 ^ lookup[0]*3 (0xA^0xA^0xA=0xA) = 0xF -> last nibble F
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('1000000F')).toBe(
        true
      );
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('1d711646')).toBe(
        true
      );
    });

    it('rejects wrong checksum, wrong length and non-hex', () => {
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('12345678')).toBe(
        false
      );
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('1000000')).toBe(
        false
      );
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('zzzzzzzz')).toBe(
        false
      );
      expect(StreamSettingsFormUtils.isValidHdhrDeviceId('')).toBe(false);
    });
  });

  describe('HDHR validation rules', () => {
    const rules = StreamSettingsFormUtils.getStreamSettingsFormValidation();

    it('allows blank device ID (auto-generate) and rejects invalid ones', () => {
      expect(rules.hdhr_device_id('')).toBeNull();
      expect(rules.hdhr_device_id('1000000F')).toBeNull();
      expect(rules.hdhr_device_id('12345678')).toMatch(/checksum/);
    });

    it('allows blank tuner count (auto) and enforces 1-255', () => {
      expect(rules.hdhr_tuner_count(null)).toBeNull();
      expect(rules.hdhr_tuner_count('')).toBeNull();
      expect(rules.hdhr_tuner_count(4)).toBeNull();
      expect(rules.hdhr_tuner_count(0)).toMatch(/1-255/);
      expect(rules.hdhr_tuner_count(256)).toMatch(/1-255/);
    });

    it('limits friendly name to 64 chars', () => {
      expect(rules.hdhr_friendly_name('Lounge')).toBeNull();
      expect(rules.hdhr_friendly_name('x'.repeat(65))).toMatch(/64/);
    });

    it('validates hdhr_advertised_url as an http(s) origin', () => {
      const rules = StreamSettingsFormUtils.getStreamSettingsFormValidation();
      expect(rules.hdhr_advertised_url('')).toBeNull();
      expect(rules.hdhr_advertised_url('http://192.168.1.10:9191')).toBeNull();
      expect(rules.hdhr_advertised_url('https://tv.example.com/')).toBeNull();
      expect(rules.hdhr_advertised_url('192.168.1.10:9191')).toMatch(/http/);
      expect(rules.hdhr_advertised_url('http://host/hdhr')).toMatch(/no path/);
    });
  });
});
