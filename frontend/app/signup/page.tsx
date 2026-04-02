import { redirect } from "next/navigation";

type SignupPageProps = {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
    ref?: string | string[];
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  params.set("mode", "signup");

  for (const key of ["next", "error", "error_description", "ref"] as const) {
    const rawValue = resolvedSearchParams[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    if (value) {
      params.set(key, value);
    }
  }

  redirect(`/login?${params.toString()}`);
}
