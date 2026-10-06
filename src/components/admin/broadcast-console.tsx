"use client";

import { useState, useTransition } from "react";

import { sendBroadcastAction } from "@/app/actions/admin";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";

/** A pickable member, narrowed from get_admin_members. */
export type BroadcastRecipient = {
  id: string;
  display_name: string | null;
  phone: string | null;
};

/**
 * The console outbox. Reaches one member or everyone as a bell notification,
 * which is the only door the notifications table has for staff (0010).
 */
export function BroadcastConsole({
  members,
}: {
  members: BroadcastRecipient[];
}) {
  const { dict } = useI18n();
  const [scope, setScope] = useState<"everyone" | "one">("everyone");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const canSend =
    title.trim().length > 0 &&
    (scope === "everyone" || userId.length > 0) &&
    !pending;

  function send() {
    if (!canSend) return;

    startTransition(async () => {
      setError(null);
      setResultCount(null);
      const result = await sendBroadcastAction({
        title: title.trim(),
        body: body.trim() || undefined,
        link: link.trim() || undefined,
        userId: scope === "everyone" ? null : userId,
      });
      if (result.ok) {
        setResultCount(result.count ?? 0);
        setTitle("");
        setBody("");
        setLink("");
      } else setError(result.error ?? dict.admin.noPermission);
    });
  }

  if (resultCount !== null) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent"
      >
        {interpolate(dict.admin.sentBroadcast, { n: resultCount })}
        <button
          type="button"
          onClick={() => setResultCount(null)}
          className="mt-2 block text-sm font-medium underline underline-offset-2"
        >
          {dict.admin.composeAnother}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-muted">
          {dict.admin.recipient}
        </legend>
        <RadioRow
          checked={scope === "everyone"}
          onChange={() => setScope("everyone")}
          label={dict.admin.recipientEveryone}
        />
        <RadioRow
          checked={scope === "one"}
          onChange={() => setScope("one")}
          label={dict.admin.recipientOne}
        />

        {scope === "one" && (
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            aria-label={dict.admin.chooseMember}
            className="h-11 w-full rounded-xl border border-line bg-sunken px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          >
            <option value="">{dict.admin.chooseMember}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name || dict.admin.memberUnnamed}
                {member.phone ? ` · ${member.phone}` : ""}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="broadcast-title" className="text-sm font-medium text-muted">
          {dict.admin.broadcastPlaceholderTitle}
        </label>
        <input
          id="broadcast-title"
          type="text"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={dict.admin.broadcastPlaceholderTitle}
          className="h-11 w-full rounded-xl border border-line bg-sunken px-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="broadcast-body" className="text-sm font-medium text-muted">
          {dict.admin.broadcastPlaceholderBody}
        </label>
        <textarea
          id="broadcast-body"
          rows={5}
          maxLength={2000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={dict.admin.broadcastPlaceholderBody}
          className="w-full resize-y rounded-xl border border-line bg-sunken px-3 py-2.5 text-base leading-relaxed text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="broadcast-link" className="text-sm font-medium text-muted">
          {dict.admin.broadcastPlaceholderLink}
        </label>
        <input
          id="broadcast-link"
          type="text"
          maxLength={500}
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder={dict.admin.broadcastPlaceholderLink}
          className="h-11 w-full rounded-xl border border-line bg-sunken px-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div>
        <button
          type="button"
          disabled={!canSend}
          onClick={send}
          className={cn(
            "rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast transition",
            "hover:bg-accent-strong disabled:opacity-50",
          )}
        >
          {pending ? dict.common.working : dict.admin.sendBroadcast}
        </button>
      </div>
    </div>
  );
}

function RadioRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="radio"
        name="broadcast-scope"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  );
}