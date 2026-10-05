"use client";

import { useState, useTransition } from "react";

import {
  setRoomChatLockedAction,
  setRoomMediaEnabledAction,
  setRoomVoiceEnabledAction,
} from "@/app/actions/admin";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * The three room switches, for one room.
 *
 * Each switch shows the state it is about to be in, not the state it is in,
 * because the button is the action. The labels are phrased as the answer to
 * "can I post here?" rather than as a setting name: "Open to posting" reads as a
 * fact about the room, where "chat_locked" reads as a column name.
 *
 * Closing a room asks first. It takes the room offline for every member at
 * once, it is not per-person, and there is no undo beyond pressing the same
 * button again -- so the confirm names the consequence rather than just asking.
 */
export function RoomSwitchActions({
  roomId,
  isPrivate,
  initial,
}: {
  roomId: string;
  isPrivate: boolean;
  initial: { chat_locked: boolean; voice_enabled: boolean; media_enabled: boolean };
}) {
  const { dict } = useI18n();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(
    apply: (next: typeof state) => typeof state,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setState(apply);
        setSaved(true);
      } else {
        setError(result.error ?? dict.admin.noPermission);
      }
    });
  }

  // A closed room makes the other two switches meaningless -- nothing can be
  // posted at all -- so they are shown as off and cannot be turned, rather than
  // being left in a state that suggests they still do something.
  const closed = state.chat_locked;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {isPrivate && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            {dict.roomControls.staffOnlyBadge}
          </span>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            closed ? "bg-danger-soft text-danger" : "bg-sunken text-muted",
          )}
        >
          {closed ? dict.roomControls.closed : dict.roomControls.open}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Switch
          label={dict.roomControls.chatLocked}
          on={!closed}
          disabled={pending}
          onClick={() => {
            const next = !state.chat_locked;
            if (next && !window.confirm(dict.roomControls.confirmLockRoom)) return;
            run(
              () => ({ ...state, chat_locked: next }),
              () => setRoomChatLockedAction({ roomId, locked: next }),
            );
          }}
        />

        <Switch
          label={dict.roomControls.voiceEnabled}
          on={!closed && state.voice_enabled}
          disabled={pending || closed}
          onClick={() => {
            const next = !state.voice_enabled;
            run(
              () => ({ ...state, voice_enabled: next }),
              () => setRoomVoiceEnabledAction({ roomId, enabled: next }),
            );
          }}
        />

        <Switch
          label={dict.roomControls.mediaEnabled}
          on={!closed && state.media_enabled}
          disabled={pending || closed}
          onClick={() => {
            const next = !state.media_enabled;
            run(
              () => ({ ...state, media_enabled: next }),
              () => setRoomMediaEnabledAction({ roomId, enabled: next }),
            );
          }}
        />
      </div>

      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
      {saved && !pending && !error && (
        <span className="text-[11px] text-accent">
          {dict.roomControls.saved}
        </span>
      )}
    </div>
  );
}

function Switch({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-line text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          on ? "bg-accent" : "bg-line-strong",
        )}
      />
      {label}
    </button>
  );
}
