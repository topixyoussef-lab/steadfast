import { requireStaff } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import {
  BroadcastConsole,
  type BroadcastRecipient,
} from "@/components/admin/broadcast-console";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.messages };
}

export default async function AdminMessagesPage() {
  const staff = await requireStaff();
  const dict = await getDictionary();

  const supabase = await createClient();
  // Same capped list the member directory uses; one admin reaching one person
  // does not need more than the top 200 by streak.
  const { data } = await supabase.rpc("get_admin_members", { p_limit: 200 });

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.console.messages}
        </h1>
        <p className="text-sm text-muted">{dict.console.messagesIntro}</p>
      </header>

      {staff.role !== "admin" ? (
        <p className="text-sm text-danger">{dict.admin.noPermission}</p>
      ) : (
        <BroadcastConsole members={(data ?? []) as BroadcastRecipient[]} />
      )}
    </main>
  );
}