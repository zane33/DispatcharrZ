import React, { useCallback, useRef, useState } from 'react';
import ChannelsTable from '../components/tables/ChannelsTable';
import StreamsTable from '../components/tables/StreamsTable';
import { Box, SegmentedControl, Stack } from '@mantine/core';
import { Allotment } from 'allotment';
import { USER_LEVELS } from '../constants';
import useAuthStore from '../store/auth';
import useLogosStore from '../store/logos';
import useBrowserStorage from '../hooks/useBrowserStorage';
import useIsMobile from '../hooks/useIsMobile';
import ErrorBoundary from '../components/ErrorBoundary';

const PageContent = () => {
  const authUser = useAuthStore((s) => s.user);
  const fetchChannelAssignableLogos = useLogosStore(
    (s) => s.fetchChannelAssignableLogos
  );
  const enableLogoRendering = useLogosStore((s) => s.enableLogoRendering);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState('channels');

  const channelsReady = useRef(false);
  const streamsReady = useRef(false);
  const logosTriggered = useRef(false);

  const [allotmentSizes, setAllotmentSizes] = useBrowserStorage(
    'channels-splitter-sizes',
    [60, 40]
  );

  // Only load logos when BOTH tables are ready
  const tryLoadLogos = useCallback(() => {
    if (
      channelsReady.current &&
      streamsReady.current &&
      !logosTriggered.current
    ) {
      logosTriggered.current = true;
      // Use requestAnimationFrame to defer logo loading until after browser paint
      // This ensures EPG column is fully rendered before logos start loading
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          enableLogoRendering();
          fetchChannelAssignableLogos();
        });
      });
    }
  }, [fetchChannelAssignableLogos, enableLogoRendering]);

  const handleChannelsReady = useCallback(() => {
    channelsReady.current = true;
    tryLoadLogos();
  }, [tryLoadLogos]);

  const handleStreamsReady = useCallback(() => {
    streamsReady.current = true;
    tryLoadLogos();
  }, [tryLoadLogos]);

  const handleSplitChange = (sizes) => {
    setAllotmentSizes(sizes);
  };

  const handleResize = (sizes) => {
    setAllotmentSizes(sizes);
  };

  if (!authUser.id) return <></>;

  if (authUser.user_level <= USER_LEVELS.STANDARD) {
    handleStreamsReady();
    return (
      <Box style={{ padding: 10 }}>
        <ChannelsTable onReady={handleChannelsReady} />
      </Box>
    );
  }

  if (isMobile) {
    // One table at a time; both stay mounted so onReady/logo loading still fires.
    const show = (tab) => ({
      display: mobileTab === tab ? 'flex' : 'none',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
    });
    return (
      <Stack
        gap="xs"
        p="xs"
        h="calc(100dvh - var(--app-shell-header-offset, 0px))"
        style={{ overflow: 'hidden' }}
      >
        <SegmentedControl
          fullWidth
          value={mobileTab}
          onChange={setMobileTab}
          data={[
            { label: 'Channels', value: 'channels' },
            { label: 'Streams', value: 'streams' },
          ]}
        />
        <Box style={show('channels')}>
          <ChannelsTable onReady={handleChannelsReady} />
        </Box>
        <Box style={show('streams')}>
          <StreamsTable onReady={handleStreamsReady} />
        </Box>
      </Stack>
    );
  }

  return (
    <Box h={'100vh'} w={'100%'} display={'flex'} style={{ overflowX: 'auto' }}>
      <Allotment
        defaultSizes={allotmentSizes}
        h={'100%'}
        w={'100%'}
        miw={'625px'}
        className="custom-allotment"
        minSize={100}
        onChange={handleSplitChange}
        onResize={handleResize}
      >
        <Box p={10} miw={'100px'} style={{ overflowX: 'auto' }}>
          <Box miw={'625px'}>
            <ChannelsTable onReady={handleChannelsReady} />
          </Box>
        </Box>
        <Box p={10} miw={'100px'} style={{ overflowX: 'auto' }}>
          <Box miw={'625px'}>
            <StreamsTable onReady={handleStreamsReady} />
          </Box>
        </Box>
      </Allotment>
    </Box>
  );
};

const ChannelsPage = () => {
  return (
    <ErrorBoundary inline>
      <PageContent />
    </ErrorBoundary>
  );
};

export default ChannelsPage;
