import { redirect } from "next/navigation";
import { normalizeReferralCode } from "@/lib/referral";

type ReferralPageProps = {
  params: Promise<{
    code?: string;
  }>;
};

export default async function ReferralPage({ params }: ReferralPageProps) {
  const resolvedParams = await params;
  const code = normalizeReferralCode(resolvedParams.code);

  if (!code) {
    redirect("/signup");
  }

  redirect(`/signup?ref=${encodeURIComponent(code)}`);
}
