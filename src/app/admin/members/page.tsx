import { requireStaff } from "@/lib/dal";
import { MemberDirectory } from "@/components/admin/member-directory";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.members };
}

export default async function AdminMembersPage() {
  await requireStaff();
  const dict = await getDictionary();

  const supabase = await createClient();
  // The function caps at 200 internally, which is the largest list the console
  // paginates through anyway.
  const { data } = await supabase.rpc("get_admin_members", { p_limit: 200 });

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.console.members}</h1>
        <p className="text-sm text-muted">{dict.console.membersIntro}</p>
      </header>

      <MemberDirectory members={data ?? []} dict={dict} />
    </main>
  );
}