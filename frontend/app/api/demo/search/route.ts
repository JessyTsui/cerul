import { NextResponse } from "next/server";
import { simulateDemoSearch, validateDemoSearchRequestBody } from "@/lib/demo-api";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const validation = validateDemoSearchRequestBody(body);

  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 },
    );
  }

  return NextResponse.json(simulateDemoSearch(validation.value));
}
