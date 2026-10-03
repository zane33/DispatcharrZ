import { useMediaQuery } from '@mantine/hooks';

// Shared breakpoint: true below Mantine's `sm` (48em / 768px).
// Pair with `hiddenFrom="sm"` / `visibleFrom="sm"` for CSS-only cases.
export default function useIsMobile() {
  return useMediaQuery('(max-width: 48em)');
}
