import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { DailyTask, Profile } from "@/lib/types";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase.rpc("get_my_profile");

  if (error) {
    // The auth trigger may not have landed yet on a brand-new account.
    return null;
  }

  return (data as Profile) ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireProfile(): Promise<Profile> {
  await requireUser();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireOnboarded(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.onboarding_done) redirect("/onboarding");
  if (profile.suspended_until && new Date(profile.suspended_until) > new Date()) {
    redirect("/suspended");
  }
  return profile;
}

export async function requireStaff(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "moderator") {
    redirect("/dashboard");
  }
  return profile;
}

/**
 * Ids holding a staff role. The profiles read policy exposes a row to its owner
 * or to staff only, so the chat cannot resolve roles with a join and needs this
 * service-role list as a prop. Degrades to no badges rather than breaking the
 * room.
 */
export const getStaffUserIds = cache(async (): Promise<string[]> => {
  try {
    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["admin", "moderator"]);

    if (error) return [];
    return ((data as { id: string }[]) ?? []).map((row) => row.id);
  } catch {
    return [];
  }
});

export type CheckinRow = {
  day_key: string;
  mood: number | null;
  urge_level: number | null;
  note: string | null;
};

/**
 * Today's rotation. get_daily_tasks() is security definer but derives
 * everything from auth.uid(), so it has to run on the user client.
 *
 * A failure returns an empty list rather than throwing: a member with a broken
 * task feed should still see their streak and their check-in.
 */
export const getTodayTasks = cache(async (): Promise<DailyTask[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_daily_tasks", { p_count: 3 });

  if (error) {
    return [];
  }

  return (data as DailyTask[]) ?? [];
});

/**
 * Count of unread notifications. Drives the bell badge in the member shell, so
 * a bad query must not break the whole nav: it returns 0 instead.
 */
export const getUnreadNotificationCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) return 0;

  return count ?? 0;
});

/** Most recent check-ins, newest first. Covers the weekly strip. */
export const getRecentCheckins = cache(
  async (limit: number): Promise<CheckinRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("checkins")
      .select("day_key, mood, urge_level, note")
      .order("day_key", { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }

    return (data as CheckinRow[]) ?? [];
  },
);
