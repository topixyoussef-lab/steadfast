import type { ReactNode } from "react";

import { MemberNav } from "@/components/shell/member-nav";
import { getUnreadNotificationCount, requireProfile } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Shell for the signed-in member area: a sidebar plus a content column that
 * takes whatever width is left, so nothing is pinned to a narrow centred
 * column on a wide screen.
 *
 * The admin console deliberately sits outside this group under `/admin` and
 * brings its own chrome.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [profile, dict, unread] = await Promise.all([
    requireProfile(),
    getDictionary(),
    getUnreadNotificationCount(),
  ]);

  const isStaff = profile.role === "admin" || profile.role === "moderator";

  return (
    <div className="flex min-h-dvh w-full flex-col lg:flex-row">
      <MemberNav dict={dict} unread={unread} isStaff={isStaff} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}