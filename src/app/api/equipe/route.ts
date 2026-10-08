import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Esta API de login foi descontinuada. Use Supabase Auth." },
    { status: 410 },
  );
}
