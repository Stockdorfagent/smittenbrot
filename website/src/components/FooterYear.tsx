'use client';

import { useEffect, useState } from 'react';

/**
 * Renders the current year in the browser so the footer copyright updates
 * automatically on 1 January without a redeploy. Starts at 2026 for the
 * initial (server) render, then corrects to the real year after hydration.
 */
export default function FooterYear() {
  const [year, setYear] = useState(2026);
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);
  return <>{year}</>;
}
