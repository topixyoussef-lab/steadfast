"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  acknowledgeAlertAction,
  clearAllChatMessagesAction,
  clearAllModerationLogAction,
  clearAllNotificationsAction,
  clearMessageAction,
  deleteMemberAccountAction,
  deleteMessageAction,
  deleteModerationLogAction,
  deleteNotificationAction,
  liftSuspensionAction,
  resolveAlertAction,
  setMemberRoleAction,
  suspendUserAction,
} from "@/app/actions/admin";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";

function Row({
  label,
  onClick,
  variant = "ghost",
  disabled,
}: {
  label: string;
  onClick: () => void;
  variant?: "ghost" | "danger" | "danger-solid" | "accent";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-9 rounded-xl px-3 text-xs font-medium transition disabled:opacity-50",
        variant === "ghost" &&
          "border border-line text-muted hover:border-line-strong hover:text-ink",
        variant === "accent" && "bg-accent text-accent-contrast hover:bg-accent-strong",
        variant === "danger" &&
          "border border-danger/40 text-danger hover:bg-danger-soft",
        // canvas flips with the theme, so it stays legible against the solid
        // red in both schemes without needing a --danger-contrast token.
        variant === "danger-solid" && "bg-danger text-canvas hover:opacity-90",
      )}
    >
      {label}
    </button>
  );
}

export function AlertActions({ alertId }: { alertId: string }) {
  const { dict } = useI18n();
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (kind: "acknowledge" | "resolve") =>
    startTransition(async () => {
      const result =
        kind === "acknowledge"
          ? await acknowledgeAlertAction({ alertId })
          : await resolveAlertAction({ alertId });
      if (result.ok) setDone(kind === "acknowledge" ? "acknowledged" : "resolved");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {done === "resolved" ? (
        <span className="text-[11px] text-accent">{dict.admin.alertClosed}</span>
      ) : (
        <>
          {done !== "acknowledged" && (
            <Row
              label={dict.admin.iHaveThis}
              variant="accent"
              disabled={pending}
              onClick={() => run("acknowledge")}
            />
          )}
          <Row
            label={done === "acknowledged" ? dict.admin.resolveAlert : dict.admin.skipForNow}
            variant={done === "acknowledged" ? "accent" : "ghost"}
            disabled={pending}
            onClick={() => run("resolve")}
          />
        </>
      )}
    </div>
  );
}

export function MessageActions({ messageId }: { messageId: string }) {
  const { dict } = useI18n();
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (removed) {
    return <span className="text-[11px] text-faint">{dict.admin.removed}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Row
        label={dict.admin.looksFine}
        variant="accent"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await clearMessageAction({ messageId });
            if (result.ok) setRemoved(true);
            else setError(result.error ?? dict.admin.noPermission);
          })
        }
      />
      <Row
        label={dict.admin.remove}
        variant="danger"
        disabled={pending}
        onClick={() => {
          // chat_admin_delete is a hard delete with no undo, so it asks first.
          if (!window.confirm(dict.admin.confirmDeleteMessage)) return;

          startTransition(async () => {
            setError(null);
            const result = await deleteMessageAction({ messageId });
            if (result.ok) setRemoved(true);
            else setError(result.error ?? dict.admin.noPermission);
          });
        }}
      />
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Purge one moderation_log row.
 *
 * The wording matters more here than on a message delete: this row is the
 * audit record, so the confirm says that the record goes too rather than
 * implying only a list entry is being cleared.
 */
export function LogRowActions({ logId }: { logId: string }) {
  const { dict } = useI18n();
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (removed) {
    return <span className="text-[11px] text-faint">{dict.admin.removed}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Row
        label={dict.admin.deleteLogRow}
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(dict.admin.confirmDeleteLogRow)) return;

          startTransition(async () => {
            setError(null);
            const result = await deleteModerationLogAction({ logId });
            if (result.ok) setRemoved(true);
            else setError(result.error ?? dict.admin.noPermission);
          });
        }}
      />
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function SuspensionActions({
  userId,
  suspended,
}: {
  userId: string;
  suspended: boolean;
}) {
  const { dict } = useI18n();
  const [isSuspended, setSuspended] = useState(suspended);
  const [pending, startTransition] = useTransition();

  if (isSuspended) {
    return (
      <Row
        label={dict.admin.reinstateMember}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await liftSuspensionAction({ userId });
            if (result.ok) setSuspended(false);
          })
        }
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {[7, 30].map((days) => (
        <Row
          key={days}
          label={interpolate(dict.admin.suspendForDays, { n: days })}
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await suspendUserAction({ userId, days });
              if (result.ok) setSuspended(true);
            })
          }
        />
      ))}
    </div>
  );
}

/**
 * Grant or revoke the admin role. Errors are shown inline (unlike the other
 * actions here) because the server refuses some changes on purpose — own
 * role, moderator callers — and silence would look like a broken button.
 */
export function RoleActions({
  userId,
  role,
}: {
  userId: string;
  role: string;
}) {
  const { dict } = useI18n();
  const [current, setCurrent] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (next: "user" | "admin") =>
    startTransition(async () => {
      setError(null);
      const result = await setMemberRoleAction({ userId, role: next });
      if (result.ok) setCurrent(next);
      else setError(result.error ?? dict.admin.noPermission);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {current !== "admin" && (
        <Row
          label={dict.admin.appointAdmin}
          variant="accent"
          disabled={pending}
          onClick={() => run("admin")}
        />
      )}
      {current === "admin" && (
        <Row
          label={dict.admin.removeAdmin}
          variant="danger"
          disabled={pending}
          onClick={() => run("user")}
        />
      )}
      {current === "moderator" && (
        <Row
          label={dict.admin.demoteMember}
          variant="danger"
          disabled={pending}
          onClick={() => run("user")}
        />
      )}
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/** The word a bulk or account-level delete has to be spelled out. */
const CONFIRM_WORD = "DELETE";

/**
 * Shared shell for the irreversible actions.
 *
 * `window.confirm` is one stray click away from wiping a member's history, so
 * these two arm first: the button only reveals this panel, and the write only
 * goes out once the word has been typed. `Cancel` forgets what was typed, so
 * backing out and re-arming starts from blank rather than from a stale value
 * that already satisfies the check.
 */
function ConfirmPanel({
  warning,
  detail,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  warning: string;
  detail?: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { dict } = useI18n();
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3">
      <p className="text-xs font-medium text-danger">{warning}</p>
      {detail && <p className="text-[11px] text-muted">{detail}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          aria-label={interpolate(dict.admin.typeDeleteToConfirm, {
            word: CONFIRM_WORD,
          })}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && armed && !pending) onConfirm();
          }}
          placeholder={interpolate(dict.admin.typeDeleteToConfirm, {
            word: CONFIRM_WORD,
          })}
          className="h-9 min-w-40 rounded-xl border border-line bg-surface px-3 text-xs uppercase outline-none transition placeholder:normal-case placeholder:text-faint focus:border-danger"
        />
        <Row
          label={confirmLabel}
          variant="danger-solid"
          disabled={!armed || pending}
          onClick={onConfirm}
        />
        <Row label={dict.admin.cancel} disabled={pending} onClick={onCancel} />
      </div>

      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function NotificationActions({ notificationId }: { notificationId: string }) {
  const { dict } = useI18n();
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (removed) {
    return <span className="text-[11px] text-faint">{dict.admin.removed}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Row
        label={dict.admin.deleteNotification}
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(dict.admin.confirmDeleteNotification)) return;

          startTransition(async () => {
            setError(null);
            const result = await deleteNotificationAction({ notificationId });
            if (result.ok) setRemoved(true);
            else setError(result.error ?? dict.admin.noPermission);
          });
        }}
      />
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Clear a member's whole notification history.
 *
 * `count` comes from the dossier the page already rendered, and it goes into
 * the warning, so whoever clicks knows the size of the thing they are about to
 * erase before arming rather than after.
 */
export function ClearAllNotificationsActions({
  userId,
  count,
}: {
  userId: string;
  count: number;
}) {
  const { dict } = useI18n();
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) return <span className="text-[11px] text-accent">{done}</span>;

  if (!armed) {
    return (
      <Row
        label={dict.admin.clearAllNotifications}
        variant="danger"
        onClick={() => setArmed(true)}
      />
    );
  }

  return (
    <ConfirmPanel
      warning={interpolate(dict.admin.confirmClearAllNotifications, { n: count })}
      confirmLabel={dict.admin.confirmAndDelete}
      pending={pending}
      error={error}
      onCancel={() => {
        setArmed(false);
        setError(null);
      }}
      onConfirm={() =>
        startTransition(async () => {
          setError(null);
          const result = await clearAllNotificationsAction({ userId });
          if (result.ok) {
            setArmed(false);
            setDone(
              interpolate(dict.admin.notificationsCleared, { n: result.deleted ?? 0 }),
            );
          } else setError(result.error ?? dict.admin.noPermission);
        })
      }
    />
  );
}

/**
 * Delete a member's account outright.
 *
 * The heaviest thing in the console, so it gets the typed confirmation plus a
 * note about what survives. On success there is no page left to render, so the
 * component navigates back to the member list rather than leaving a dead
 * dossier on screen.
 */
export function DeleteAccountActions({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const { dict } = useI18n();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!armed) {
    return (
      <Row
        label={dict.admin.deleteAccount}
        variant="danger"
        onClick={() => setArmed(true)}
      />
    );
  }

  return (
    <ConfirmPanel
      warning={`${displayName} — ${dict.admin.deleteAccountWarning}`}
      detail={dict.admin.deleteAccountKeepsLog}
      confirmLabel={dict.admin.confirmAndDelete}
      pending={pending}
      error={error}
      onCancel={() => {
        setArmed(false);
        setError(null);
      }}
      onConfirm={() =>
        startTransition(async () => {
          setError(null);
          const result = await deleteMemberAccountAction({ userId });
          if (result.ok) {
            setArmed(false);
            router.push("/admin/members");
            router.refresh();
          } else setError(result.error ?? dict.admin.noPermission);
        })
      }
    />
  );
}

/**
 * Empty the moderation log. Same two-step typed confirmation as the other
 * irreversible deletes; the page re-fetches so the counts refresh after.
 */
export function WipeLogActions({ count }: { count: number }) {
  const { dict } = useI18n();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done)
    return <span className="text-[11px] text-accent">{done}</span>;

  if (!armed) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Row
            label={dict.admin.wipeLogTitle}
            variant="danger"
            onClick={() => setArmed(true)}
          />
          <span className="text-[11px] text-faint">
            {interpolate(dict.admin.wipeLogCount, { n: count })}
          </span>
        </div>
        <p className="text-[11px] text-faint">{dict.admin.wipeLogBody}</p>
      </div>
    );
  }

  return (
    <ConfirmPanel
      warning={interpolate(dict.admin.wipeLogConfirm, { n: count })}
      confirmLabel={dict.admin.confirmAndDelete}
      pending={pending}
      error={error}
      onCancel={() => {
        setArmed(false);
        setError(null);
      }}
      onConfirm={() =>
        startTransition(async () => {
          setError(null);
          const result = await clearAllModerationLogAction();
          if (result.ok) {
            setArmed(false);
            setDone(interpolate(dict.admin.wipeLogDone, { n: result.deleted ?? count }));
            router.refresh();
          } else setError(result.error ?? dict.admin.noPermission);
        })
      }
    />
  );
}

/**
 * Delete every chat message and every stored file. The heaviest wipe, so the
 * counts go straight into the typed confirmation.
 */
export function WipeChatActions({
  count,
  files,
}: {
  count: number;
  files: number;
}) {
  const { dict } = useI18n();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done)
    return (
      <span className="text-[11px] text-accent">{done}</span>
    );

  if (!armed) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Row
            label={dict.admin.wipeChatTitle}
            variant="danger"
            onClick={() => setArmed(true)}
          />
          <span className="text-[11px] text-faint">
            {interpolate(dict.admin.wipeChatCount, { n: count })}
          </span>
        </div>
        <p className="text-[11px] text-faint">{dict.admin.wipeChatBody}</p>
      </div>
    );
  }

  return (
    <ConfirmPanel
      warning={interpolate(dict.admin.wipeChatConfirm, {
        n: count,
        m: files,
      })}
      confirmLabel={dict.admin.confirmAndDelete}
      pending={pending}
      error={error}
      onCancel={() => {
        setArmed(false);
        setError(null);
      }}
      onConfirm={() =>
        startTransition(async () => {
          setError(null);
          const result = await clearAllChatMessagesAction();
          if (result.ok) {
            setArmed(false);
            setDone(
              interpolate(dict.admin.wipeChatDone, {
                n: result.messages ?? count,
                m: result.files ?? files,
              }),
            );
            router.refresh();
          } else setError(result.error ?? dict.admin.noPermission);
        })
      }
    />
  );
}