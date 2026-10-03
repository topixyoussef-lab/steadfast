import "server-only";

/**
 * Bridge to the Python moderation service.
 *
 * Every function returns null when the service is unreachable, and the caller
 * decides what that means. That distinction matters: for chat we fail closed,
 * but for the panic button we must always answer, because a member pressing
 * SOS during an outage is exactly the person we cannot leave without help.
 */

const TIMEOUT_MS = 4000;

export type Decision = "allow" | "flag" | "block";

export type ModerateResult = {
  decision: Decision;
  severity: "info" | "warning" | "critical";
  categories: string[];
  matched_terms: string[];
  reason: string;
  engine: string;
  latency_ms: number;
  request_id: string;
};

export type CopingStep = { title: string; detail: string };

export type PanicResult = {
  response: string;
  steps: CopingStep[];
  grounding: string[];
  escalate_to_admins: boolean;
  cache_key: string;
  urge_level: number;
  latency_ms: number;
};

function config() {
  const url = process.env.PYTHON_API_URL;
  const token = process.env.PYTHON_API_TOKEN;
  return { url, token };
}

async function call<T>(path: string, body: unknown): Promise<T | null> {
  const { url, token } = config();
  if (!url || !token) return null;

  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Timeout, connection refused, bad JSON. All treated the same way.
    return null;
  }
}

export function moderateMessage(
  content: string,
  meta: {
    userId?: string;
    roomId?: string;
    preferenceType?: string | null;
  },
): Promise<ModerateResult | null> {
  return call<ModerateResult>("/moderate", {
    content,
    user_id: meta.userId,
    room_id: meta.roomId,
    preference_type: meta.preferenceType,
  });
}

export function requestPanicSupport(payload: {
  urgeLevel: number;
  preferenceType: string | null;
  currentStreak: number;
  trigger: string | null;
  timezone: string | null;
  message: string | null;
}): Promise<PanicResult | null> {
  return call<PanicResult>("/panic", {
    urge_level: payload.urgeLevel,
    preference_type: payload.preferenceType,
    current_streak: payload.currentStreak,
    trigger: payload.trigger,
    timezone: payload.timezone,
    message: payload.message,
  });
}

/**
 * Last-resort crisis copy, served from the Next.js process when Python is
 * down. Deliberately generic: it names real actions and real services rather
 * than pretending to be the tailored responder.
 */
export function offlinePanicResponse(urgeLevel: number): PanicResult {
  const critical = urgeLevel >= 8;

  return {
    response: critical
      ? "Our support service is not responding right now, but you still need help. " +
        "Please contact emergency services or your local crisis line, and tell one person where you are."
      : "Our support service is not responding right now. Here is what still works: " +
        "get away from the screen, put cold water on your face, and message one person.",
    steps: critical
      ? [
          {
            title: "Call emergency services",
            detail: "If you might hurt yourself or anyone else, do this first.",
          },
          {
            title: "Call your country crisis line",
            detail: "Free and confidential.",
          },
          {
            title: "Move to where people are",
            detail: "Lobby, café, a friend's place. Anywhere with witnesses.",
          },
        ]
      : [
          {
            title: "Stand up and leave the room",
            detail: "Distance beats willpower.",
          },
          {
            title: "Cold water on your face and wrists",
            detail: "Thirty seconds.",
          },
          {
            title: "Message one person",
            detail: "Ask them to stay on the line for five minutes.",
          },
        ],
    grounding: [
      "Put both feet on the floor and press down for ten seconds.",
      "Name five things you can see, four you can hear, three you can touch.",
      "Breathe out longer than you breathe in.",
      "Drink a full glass of water, slowly.",
    ],
    escalate_to_admins: urgeLevel >= 6,
    cache_key: `offline-${urgeLevel}`,
    urge_level: urgeLevel,
    latency_ms: 0,
  };
}