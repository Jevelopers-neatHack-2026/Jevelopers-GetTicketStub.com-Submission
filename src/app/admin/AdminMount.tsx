"use client";
// The one place the dashboard renders into. The server page decides who may be here; this component only
// receives what that decision produced. To switch from the fixture to the published team-dashboard package,
// replace the FixtureMount import below with the package's mount (same AdminMountProps) and keep the rest.
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { AdminHostBridge, AdminMountProps } from "./contract";
import { FixtureMount } from "./fixture/FixtureMount";

export function AdminMount(props: AdminMountProps) {
  const router = useRouter();
  const host = useMemo<AdminHostBridge>(
    () => ({
      navigate: (href) => {
        // Only paths below the base: a mount can't send the browser anywhere else through us.
        if (href === props.nav.base || href.startsWith(`${props.nav.base}/`)) router.push(href);
      },
    }),
    [router, props.nav.base],
  );
  return <FixtureMount {...props} host={host} />;
}
