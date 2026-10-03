import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Mirrors the jsonb returned by get_admin_user_detail(). */
export type AuthFacts = {
  last_sign_in_at: string | null;
  phone: string | null;
  created_at: string | null;
  phone_confirmed_at: string | null;
  provider: string | null;
  banned_until: string | null;
};

export type DossierStats = {
  checkins_total: number;
  checkins_30d: number;
  avg_mood: number | null;
  avg_urge: number | null;
  last_checkin_day: string | null;
  tasks_done: number;
  tasks_done_30d: number;
  active_days: number;
  jobs_posted: number;
  jobs_open: number;
  apps_made: number;
  apps_received: number;
  messages: number;
  messages_flagged: number;
  messages_blocked: number;
  messages_deleted: number;
  panic_total: number;
  panic_open: number;
  panic_24h: number;
  notifications: number;
  notifications_unread: number;
};

export type Dossier = {
  profile: Profile;
  auth: AuthFacts;
  is_suspended: boolean;
  stats: DossierStats;
  checkins: Array<{
    day_key: string;
    mood: number | null;
    urge_level: number | null;
    note: string | null;
    created_at: string;
  }>;
  task_completions: Array<{
    day_key: string;
    completed_at: string;
    title: string;
    category: string;
    estimated_minutes: number;
  }>;
  panic_alerts: Array<{
    id: string;
    day_key: string;
    source: string;
    message: string | null;
    urge_level: number | null;
    ai_response: string | null;
    status: string;
    severity: string;
    acknowledged_at: string | null;
    created_at: string;
  }>;
  chat_messages: Array<{
    id: string;
    room_id: string;
    room_title: string | null;
    room_slug: string | null;
    content: string;
    is_flagged_by_ai: boolean;
    moderation_status: string;
    reply_to: string | null;
    edited_at: string | null;
    deleted_at: string | null;
    created_at: string;
  }>;
  moderation_log: Array<{
    id: number;
    room_id: string | null;
    content_preview: string | null;
    status: string;
    severity: string;
    categories: string[];
    matched_terms: string[];
    latency_ms: number | null;
    created_at: string;
  }>;
  jobs: Array<{
    id: string;
    title: string;
    job_type: string;
    status: string;
    price_minor: number;
    currency: string;
    price_type: string;
    is_ai_clean: boolean;
    applications_count: number;
    created_at: string;
    deadline_at: string | null;
  }>;
  job_applications: Array<{
    id: string;
    job_id: string;
    job_title: string;
    status: string;
    message: string | null;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: string | null;
    created_at: string;
  }>;
};

export type DossierResult =
  | { status: "ok"; dossier: Dossier }
  | { status: "missing" }
  | { status: "unavailable" };

/**
 * Everything the console knows about one member.
 *
 * Ordinary table reads cannot do this: check-ins, task completions,
 * notifications and job applications are own-rows-only under row level
 * security, so the answer has to come from the security-definer function in
 * migration 0003. Until that is applied the RPC is simply missing, which is a
 * setup state rather than a bug, so it is reported as its own outcome instead
 * of being folded into "not found".
 */
export const getUserDossier = cache(
  async (userId: string): Promise<DossierResult> => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("get_admin_user_detail", {
      p_user_id: userId,
    });

    if (error) {
      // P0002 is the RAISE from inside the function: no such member.
      return error.code === "P0002" ? { status: "missing" } : { status: "unavailable" };
    }

    if (!data) return { status: "missing" };

    return { status: "ok", dossier: data as Dossier };
  },
);