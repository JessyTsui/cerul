import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/demo-api";

export async function GET() {
  return NextResponse.json(getDashboardSnapshot());
}
