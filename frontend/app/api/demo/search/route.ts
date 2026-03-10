import { NextResponse } from "next/server";
import { simulateDemoSearch } from "@/lib/demo-api";
import type { DemoMode } from "@/lib/demo-api";

type SearchRequestBody = {
  mode?: DemoMode;
  query?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as SearchRequestBody;
  const mode = body.mode ?? "knowledge";
  const query = body.query ?? "";

  return NextResponse.json(simulateDemoSearch({ mode, query }));
}
