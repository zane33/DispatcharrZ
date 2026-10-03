import useSettingsStore from '../../../store/settings.jsx';
import useWarningsStore from '../../../store/warnings.jsx';
import useUserAgentsStore from '../../../store/userAgents.jsx';
import useStreamProfilesStore from '../../../store/streamProfiles.jsx';
import useOutputProfilesStore from '../../../store/outputProfiles.jsx';
import React, { useEffect, useState } from 'react';
import {
  getChangedGroupSettings,
  parseGroupSettings,
  rehashStreams,
  saveGroupSettings,
} from '../../../utils/pages/SettingsUtils.js';
import useSettingsSaveGuard from '../../../hooks/useSettingsSaveGuard.jsx';
import {
  Alert,
  Button,
  Flex,
  MultiSelect,
  NumberInput,
  Select,
  Switch,
  TextInput,
} from '@mantine/core';
import ConfirmationDialog from '../../ConfirmationDialog.jsx';
import { useForm } from '@mantine/form';
import {
  getStreamSettingsFormInitialValues,
  getStreamSettingsFormValidation,
} from '../../../utils/forms/settings/StreamSettingsFormUtils.js';

const STREAM_GROUP = 'stream_settings';

const StreamSettingsForm = React.memo(({ active }) => {
  const settings = useSettingsStore((s) => s.settings);
  const suppressWarning = useWarningsStore((s) => s.suppressWarning);
  const isWarningSuppressed = useWarningsStore((s) => s.isWarningSuppressed);
  const userAgents = useUserAgentsStore((s) => s.userAgents);
  const streamProfiles = useStreamProfilesStore((s) => s.profiles);
  const outputProfiles = useOutputProfilesStore((s) => s.profiles);

  // Store pending changed settings when showing the dialog
  const [pendingChangedSettings, setPendingChangedSettings] = useState(null);

  const [saved, setSaved] = useState(false);
  const [rehashingStreams, setRehashingStreams] = useState(false);
  const [rehashSuccess, setRehashSuccess] = useState(false);
  const [rehashConfirmOpen, setRehashConfirmOpen] = useState(false);

  // Add a new state to track the dialog type
  const [rehashDialogType, setRehashDialogType] = useState(null); // 'save' or 'rehash'
  const { isSavingRef, runSave } = useSettingsSaveGuard();
  // Auto tuner count as the backend computes it (TunerCount in discover.json)
  const [autoTunerCount, setAutoTunerCount] = useState(null);
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    try {
      fetch('/hdhr/discover.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setAutoTunerCount(d.TunerCount))
        .catch(() => {});
    } catch {
      // ignore - description just omits the computed value
    }
  }, []);

  const form = useForm({
    mode: 'controlled',
    initialValues: getStreamSettingsFormInitialValues(),
    validate: getStreamSettingsFormValidation(),
  });

  useEffect(() => {
    if (!active) {
      setSaved(false);
      setRehashSuccess(false);
    }
  }, [active]);

  useEffect(() => {
    if (settings && !isSavingRef.current) {
      form.setValues(parseGroupSettings(settings, STREAM_GROUP));
    }
  }, [settings]);

  const executeSettingsSaveAndRehash = async () => {
    setRehashConfirmOpen(false);
    setSaved(false);

    // Use the stored pending values that were captured before the dialog was shown
    const changedSettings = pendingChangedSettings || {};

    try {
      await runSave(async () => {
        await saveGroupSettings(settings, STREAM_GROUP, changedSettings);
        setPendingChangedSettings(null);
        const latestSettings = useSettingsStore.getState().settings;
        if (latestSettings) {
          form.setValues(parseGroupSettings(latestSettings, STREAM_GROUP));
        }
        setSaved(true);
      });
    } catch (error) {
      // Error notifications are already shown by API functions
      // Just don't show the success message
      console.error('Error saving settings:', error);
      setPendingChangedSettings(null);
    }
  };

  const executeRehashStreamsOnly = async () => {
    setRehashingStreams(true);
    setRehashSuccess(false);
    setRehashConfirmOpen(false);

    try {
      await rehashStreams();
      setRehashSuccess(true);
      setTimeout(() => setRehashSuccess(false), 5000);
    } catch (error) {
      console.error('Error rehashing streams:', error);
    } finally {
      setRehashingStreams(false);
    }
  };

  const onRehashStreams = async () => {
    // Skip warning if it's been suppressed
    if (isWarningSuppressed('rehash-streams')) {
      return executeRehashStreamsOnly();
    }

    setRehashDialogType('rehash'); // Set dialog type to rehash
    setRehashConfirmOpen(true);
  };

  const handleRehashConfirm = () => {
    if (rehashDialogType === 'save') {
      executeSettingsSaveAndRehash();
    } else {
      executeRehashStreamsOnly();
    }
  };

  const onSubmit = async () => {
    setSaved(false);

    const values = form.getValues();
    const changedSettings = getChangedGroupSettings(
      values,
      settings,
      STREAM_GROUP
    );

    // Check if m3u_hash_key changed from the grouped stream_settings
    const currentHashKey =
      settings['stream_settings']?.value?.m3u_hash_key || '';
    const newHashKey = values['m3u_hash_key']?.join(',') || '';
    const m3uHashKeyChanged = currentHashKey !== newHashKey;

    // If M3U hash key changed, show warning (unless suppressed)
    if (m3uHashKeyChanged && !isWarningSuppressed('rehash-streams')) {
      // Store the changed settings before showing dialog
      setPendingChangedSettings(changedSettings);
      setRehashDialogType('save'); // Set dialog type to save
      setRehashConfirmOpen(true);
      return;
    }

    try {
      await runSave(async () => {
        await saveGroupSettings(settings, STREAM_GROUP, changedSettings);
        const latestSettings = useSettingsStore.getState().settings;
        if (latestSettings) {
          form.setValues(parseGroupSettings(latestSettings, STREAM_GROUP));
        }
        setSaved(true);
      });
    } catch (error) {
      // Error notifications are already shown by API functions
      // Just don't show the success message
      console.error('Error saving settings:', error);
    }
  };

  return (
    <>
      <form onSubmit={form.onSubmit(onSubmit)}>
        {saved && (
          <Alert variant="light" color="green" title="Saved Successfully" />
        )}
        <Select
          searchable
          {...form.getInputProps('default_user_agent')}
          id="default_user_agent"
          name="default_user_agent"
          label="Default User Agent"
          description="User agent string sent when fetching streams. Some providers require a specific value to serve content."
          data={userAgents.map((option) => ({
            value: `${option.id}`,
            label: option.name,
          }))}
        />
        <Select
          searchable
          {...form.getInputProps('default_stream_profile')}
          id="default_stream_profile"
          name="default_stream_profile"
          label="Default Stream Profile"
          description="Used when a channel has no profile. Live and catchup use the channel's effective profile; Redirect here also applies to VOD."
          data={streamProfiles.map((option) => ({
            value: `${option.id}`,
            label: option.name,
          }))}
        />
        <Select
          {...form.getInputProps('default_output_format')}
          id="default_output_format"
          name="default_output_format"
          label="Default Output Format"
          description="Container format used when proxying streams. MPEG-TS is broadly compatible with media players and devices; fMP4 has better support for modern codecs like AV1 and is preferred by some newer clients."
          data={[
            { value: 'mpegts', label: 'MPEG-TS' },
            { value: 'fmp4', label: 'fMP4 (fragmented MP4)' },
          ]}
        />
        <Select
          label="HDHR Default Output Profile"
          description="Output profile applied to all HDHR stream URLs when no profile is specified in the URL path."
          clearable
          searchable
          placeholder="No transcoding (pass-through)"
          value={
            form.values['hdhr_output_profile_id'] != null
              ? `${form.values['hdhr_output_profile_id']}`
              : null
          }
          onChange={(value) =>
            form.setFieldValue(
              'hdhr_output_profile_id',
              value ? parseInt(value, 10) : null
            )
          }
          data={outputProfiles
            .filter((p) => p.is_active)
            .map((p) => ({ value: `${p.id}`, label: p.name }))}
        />

        <Switch
          {...form.getInputProps('hdhr_discovery_enabled', {
            type: 'checkbox',
          })}
          id="hdhr_discovery_enabled"
          name="hdhr_discovery_enabled"
          label="Broadcast HDHomeRun discovery (Plex/Emby/Jellyfin auto-detect)"
          description="Answer HDHomeRun discovery broadcasts on UDP 65001. Requires host networking in Docker; otherwise add the tuner manually via /hdhr/discover.json."
          mt="sm"
        />
        <TextInput
          {...form.getInputProps('hdhr_friendly_name')}
          id="hdhr_friendly_name"
          name="hdhr_friendly_name"
          label="HDHomeRun Device Name"
          description="Name shown by Plex/Emby/Jellyfin when the tuner is detected."
        />
        <TextInput
          {...form.getInputProps('hdhr_device_id')}
          id="hdhr_device_id"
          name="hdhr_device_id"
          label="HDHomeRun Device ID"
          description="8 hex digits with a valid SiliconDust checksum. Leave blank to auto-generate a stable ID. Changing it makes clients see a new tuner."
          placeholder="Auto-generated"
        />
        <NumberInput
          id="hdhr_tuner_count"
          name="hdhr_tuner_count"
          label="HDHomeRun Tuner Count"
          description={`Concurrent streams advertised to clients. Blank = auto from M3U profile limits${
            autoTunerCount != null ? ` (currently ${autoTunerCount})` : ''
          }.`}
          placeholder="Auto"
          min={1}
          max={255}
          allowDecimal={false}
          value={form.values['hdhr_tuner_count'] ?? ''}
          onChange={(value) =>
            form.setFieldValue(
              'hdhr_tuner_count',
              value === '' || value == null ? null : Number(value)
            )
          }
          error={form.errors['hdhr_tuner_count']}
        />

        <MultiSelect
          id="m3u_hash_key"
          name="m3u_hash_key"
          label="M3U Hash Key"
          description="Fields used to generate a stable identifier for each stream. Changing this requires rehashing all streams."
          data={[
            {
              value: 'name',
              label: 'Name',
            },
            {
              value: 'url',
              label: 'URL',
            },
            {
              value: 'tvg_id',
              label: 'TVG-ID',
            },
            {
              value: 'm3u_id',
              label: 'M3U ID',
            },
            {
              value: 'group',
              label: 'Group',
            },
          ]}
          {...form.getInputProps('m3u_hash_key')}
        />

        {rehashSuccess && (
          <Alert
            variant="light"
            color="green"
            title="Rehash task queued successfully"
          />
        )}

        <Flex mih={50} gap="xs" justify="space-between" align="flex-end">
          <Button
            onClick={onRehashStreams}
            loading={rehashingStreams}
            variant="outline"
            color="blue"
          >
            Rehash Streams
          </Button>
          <Button type="submit" disabled={form.submitting} variant="default">
            Save
          </Button>
        </Flex>
      </form>

      <ConfirmationDialog
        opened={rehashConfirmOpen}
        onClose={() => {
          setRehashConfirmOpen(false);
          setRehashDialogType(null);
          // Clear pending values when dialog is cancelled
          setPendingChangedSettings(null);
        }}
        onConfirm={handleRehashConfirm}
        title={
          rehashDialogType === 'save'
            ? 'Save Settings and Rehash Streams'
            : 'Confirm Stream Rehash'
        }
        message={
          <div style={{ whiteSpace: 'pre-line' }}>
            {`Are you sure you want to rehash all streams?

This process may take a while depending on the number of streams.
Do not shut down Dispatcharr until the rehashing is complete.
M3U refreshes will be blocked until this process finishes.

Please ensure you have time to let this complete before proceeding.`}
          </div>
        }
        confirmLabel={
          rehashDialogType === 'save' ? 'Save and Rehash' : 'Start Rehash'
        }
        cancelLabel="Cancel"
        actionKey="rehash-streams"
        onSuppressChange={suppressWarning}
        size="md"
      />
    </>
  );
});

export default StreamSettingsForm;
