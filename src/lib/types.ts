export type PreferenceType = "islamic" | "christian" | "general";
export type UserRole = "user" | "moderator" | "admin";
export type RecoveryStage = "day_1_30" | "day_31_90" | "day_90_plus";

export type Profile = {
  id: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  avatar_url: string | null;
  preference_type: PreferenceType | null;
  recovery_stage: RecoveryStage;
  timezone: string;
  day_cutoff_hour: number;
  current_streak: number;
  highest_streak: number;
  clean_since: string | null;
  last_active_day: string | null;
  onboarding_done: boolean;
  weekly_goal: number;
  trust_score: number;
  suspended_until: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyTask = {
  task_id: string;
  title: string;
  description: string;
  category: string;
  estimated_minutes: number;
  is_done: boolean;
  completed_at: string | null;
};

export type CheckinResult = {
  day_key: string;
  current_streak: number;
  highest_streak: number;
  recovery_stage: RecoveryStage;
};

export type Room = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  is_private: boolean;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  is_flagged_by_ai: boolean;
  moderation_status: "allowed" | "flagged" | "blocked";
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type MessageReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type JobCategory = {
  id: number;
  slug: string;
  name: string;
};

export type Job = {
  id: string;
  user_id: string;
  category_id: number | null;
  job_type: "micro" | "part_time" | "full_time" | "gig" | "internship";
  title: string;
  description: string;
  price_minor: number;
  currency: string;
  price_type: "fixed" | "hourly" | "negotiable";
  status: "open" | "in_progress" | "filled" | "closed" | "disputed";
  is_ai_clean: boolean;
  estimated_hours: number | null;
  deadline_at: string | null;
  applications_count: number;
  created_at: string;
  category_name: string | null;
  poster_name: string | null;
};

export type JobApplication = {
  id: string;
  job_id: string;
  user_id: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
};

export type Notification = {
  id: string;
  type:
    | "sos_response"
    | "job_match"
    | "job_application"
    | "application_status"
    | "moderation_notice"
    | "streak_milestone"
    | "system";
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type PanicAlert = {
  id: string;
  user_id: string;
  day_key: string;
  source: string;
  message: string | null;
  urge_level: number | null;
  ai_response: string | null;
  status: "open" | "acknowledged" | "resolved";
  severity: "critical" | "warning" | "info";
  acknowledged_at: string | null;
  created_at: string;
};
