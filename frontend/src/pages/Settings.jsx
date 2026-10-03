import React, { Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Anchor,
  Box,
  Divider,
  Loader,
  NavLink,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { getVisibleSettingsGroups } from '../config/settingsNav';
import useAuthStore from '../store/auth';
import { USER_LEVELS } from '../constants';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

const SettingsPage = () => {
  const authUser = useAuthStore((s) => s.user);
  const location = useLocation();
  const isAdmin = authUser.user_level >= USER_LEVELS.ADMIN;

  const activeSection = location.hash.replace('#', '') || null;

  const visibleGroups = getVisibleSettingsGroups(isAdmin);
  const allSections = visibleGroups.flatMap((g) => g.sections);
  const activeSectionConfig = activeSection
    ? (allSections.find((s) => s.id === activeSection) ?? null)
    : null;
  const ActiveComponent = activeSectionConfig?.Component ?? null;

  return (
    <Box p={10} maw={900} mx="auto">
      {ActiveComponent ? (
        <Paper withBorder p="md" radius="md">
          {/* Phones have no settings sub-nav in the sidebar; give a way back. */}
          <Anchor component={Link} to="/settings" size="sm" hiddenFrom="sm">
            ← All settings
          </Anchor>
          <Text size="lg" fw={600} mb={6}>
            {activeSectionConfig.label}
          </Text>
          <Divider mb="md" />
          <ErrorBoundary inline>
            <Suspense fallback={<Loader />}>
              <ActiveComponent active={true} />
            </Suspense>
          </ErrorBoundary>
        </Paper>
      ) : (
        <>
          <Box
            visibleFrom="sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 200,
            }}
          >
            <Text c="dimmed" size="sm">
              Select a setting from the sidebar
            </Text>
          </Box>
          <Stack gap="md" hiddenFrom="sm">
            {visibleGroups.map((group) => (
              <Paper key={group.id} withBorder radius="md" p="xs">
                <Text size="xs" c="dimmed" fw={600} tt="uppercase" px="sm" py={4}>
                  {group.label}
                </Text>
                {group.sections.map((section) => (
                  <NavLink
                    key={section.id}
                    component={Link}
                    to={`/settings#${section.id}`}
                    label={section.label}
                    leftSection={<section.icon size={16} />}
                  />
                ))}
              </Paper>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
};

export default SettingsPage;
