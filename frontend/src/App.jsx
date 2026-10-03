import React, { useEffect, useRef } from 'react';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useLocation,
} from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login, { LoginLoadingCard } from './pages/Login';
import Channels from './pages/Channels';
import ContentSources from './pages/ContentSources';
import Guide from './pages/Guide';
import Stats from './pages/Stats';
import LogFilesPage from './pages/LogFiles';
import LogFileViewPage from './pages/LogFileView';
import DVR from './pages/DVR';
import Settings from './pages/Settings';
import PluginsPage from './pages/Plugins';
import PluginBrowsePage from './pages/PluginBrowse';
import ConnectPage from './pages/Connect';
import Users from './pages/Users';
import LogosPage from './pages/Logos';
import VODsPage from './pages/VODs';
import useAuthStore from './store/auth';
import useBrowserStorage from './hooks/useBrowserStorage';
import FloatingVideo from './components/FloatingVideo';
import { WebsocketProvider } from './WebSocket';
import { Box, AppShell, Burger, Group, MantineProvider, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import useIsMobile from './hooks/useIsMobile';
import logo from './images/logo.png';
import '@mantine/core/styles.css'; // Ensure Mantine global styles load
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/dates/styles.css';
import './index.css';
import mantineTheme from './mantineTheme';
import API from './api';
import { Notifications } from '@mantine/notifications';
import M3URefreshNotification from './components/M3URefreshNotification';
import ErrorBoundary from './components/ErrorBoundary';
import { defaultRoute, getSafeNextPath } from './utils/loginRedirect';
import 'allotment/dist/style.css';

const drawerWidth = 240;
const miniDrawerWidth = 60;

const LoginRedirect = () => {
  const location = useLocation();
  const target = getSafeNextPath(location.pathname + location.search);
  const next = target ? `?next=${encodeURIComponent(target)}` : '';
  return <Navigate to={`/login${next}`} replace />;
};

const App = () => {
  const [open, setOpen] = useBrowserStorage('dispatcharr_sidebar_open', true);
  const isMobile = useIsMobile();
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] =
    useDisclosure(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const authReady = isAuthenticated && isInitialized;
  const isCheckingAuth = useAuthStore((s) => s.isCheckingAuth);
  const logout = useAuthStore((s) => s.logout);
  const initData = useAuthStore((s) => s.initData);
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const setSuperuserStatus = useAuthStore((s) => s.setSuperuserStatus);

  const authCheckStarted = useRef(false);
  const superuserCheckStarted = useRef(false);

  const toggleDrawer = () => {
    setOpen((prev) => !prev);
  };

  // Check if a superuser exists on first load.
  useEffect(() => {
    if (superuserCheckStarted.current) return;
    superuserCheckStarted.current = true;

    async function checkSuperuser() {
      try {
        const response = await API.fetchSuperUser();
        setSuperuserStatus(response);
      } catch (error) {
        console.error('Error checking superuser status:', error);
        // Preserve the existing fail-open UI behavior if the status check fails.
        setSuperuserStatus({ superuser_exists: true });
        // If authentication error, redirect to login
        if (error.status === 401) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('tokenExpiration');
          window.location.href = '/login';
        }
      }
    }
    checkSuperuser();
  }, [setSuperuserStatus]);

  // Authentication check
  useEffect(() => {
    if (authCheckStarted.current) return;
    authCheckStarted.current = true;

    const checkAuth = async () => {
      try {
        const loggedIn = await initializeAuth();
        if (loggedIn) {
          await initData();
          // Logos are now loaded at the end of initData, no need for background loading
        } else {
          await logout();
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        await logout();
      }
    };

    checkAuth();
  }, [initializeAuth, initData, logout]);

  return (
    <MantineProvider
      defaultColorScheme="dark"
      theme={mantineTheme}
      withGlobalStyles
      withNormalizeCSS
    >
      <ErrorBoundary name="application">
        <WebsocketProvider>
          <Router>
            <AppShell
              // Header only exists on mobile (< sm); desktop keeps height 0.
              header={{ height: { base: authReady ? 50 : 0, sm: 0 } }}
              navbar={{
                width: authReady ? (open ? drawerWidth : miniDrawerWidth) : 0,
                breakpoint: 'sm',
                collapsed: { mobile: !mobileNavOpened },
              }}
            >
              {authReady && (
                <AppShell.Header
                  hiddenFrom="sm"
                  style={{
                    backgroundColor: '#1A1A1E',
                    borderBottom: '1px solid #2A2A2E',
                  }}
                >
                  <Group h="100%" px="sm" gap="sm" wrap="nowrap">
                    <Burger
                      opened={mobileNavOpened}
                      onClick={toggleMobileNav}
                      size="sm"
                      aria-label="Toggle navigation"
                    />
                    <img width={26} src={logo} alt="Dispatcharr" />
                    <Text fw={600} size="lg">
                      Dispatcharr
                    </Text>
                  </Group>
                </AppShell.Header>
              )}
              {authReady && (
                <Sidebar
                  drawerWidth={drawerWidth}
                  miniDrawerWidth={miniDrawerWidth}
                  collapsed={isMobile ? false : !open}
                  toggleDrawer={isMobile ? closeMobileNav : toggleDrawer}
                  onNavigate={closeMobileNav}
                />
              )}

              <AppShell.Main>
                <Box
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    // transition: 'margin-left 0.3s',
                    backgroundColor: '#18181b',
                    // dvh: mobile browser chrome; offset: mobile header height (0 on desktop)
                    height:
                      'calc(100dvh - var(--app-shell-header-offset, 0px))',
                    color: 'white',
                  }}
                >
                  <Box>
                    {isCheckingAuth ? (
                      <LoginLoadingCard />
                    ) : (
                      <Routes>
                        {authReady ? (
                          <>
                            <Route path="/channels" element={<Channels />} />
                            <Route
                              path="/sources"
                              element={<ContentSources />}
                            />
                            <Route path="/guide" element={<Guide />} />
                            <Route path="/dvr" element={<DVR />} />
                            <Route path="/stats" element={<Stats />} />
                            <Route path="/logs" element={<LogFilesPage />} />
                            <Route
                              path="/logs/:name"
                              element={<LogFileViewPage />}
                            />
                            <Route
                              path="/plugins/browse"
                              element={<PluginBrowsePage />}
                            />
                            <Route path="/plugins" element={<PluginsPage />} />
                            <Route path="/connect" element={<ConnectPage />} />
                            <Route path="/users" element={<Users />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="/logos" element={<LogosPage />} />
                            <Route path="/vods" element={<VODsPage />} />
                          </>
                        ) : (
                          <Route path="/login" element={<Login />} />
                        )}
                        <Route
                          path="*"
                          element={
                            authReady ? (
                              <Navigate to={defaultRoute} replace />
                            ) : (
                              <LoginRedirect />
                            )
                          }
                        />
                      </Routes>
                    )}
                  </Box>
                </Box>
              </AppShell.Main>
            </AppShell>
            <M3URefreshNotification />
            <Notifications containerWidth={350} />
          </Router>
        </WebsocketProvider>

        <FloatingVideo />
      </ErrorBoundary>
    </MantineProvider>
  );
};

export default App;
