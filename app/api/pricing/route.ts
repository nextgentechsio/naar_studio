import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  getPricingSnapshots,
  getTodayPricing,
  savePricingSnapshot,
  type PricingSnapshot,
} from "@/lib/replicate/pricing";

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const today = getTodayPricing();

    return NextResponse.json({
      success: true,
      today,
      snapshots: getPricingSnapshots(),
    });
  } catch (error) {
    console.error("Pricing GET error:", error);

    return NextResponse.json(
      { error: "Failed to read pricing data" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  // Pricing affects everyone's cost reports
  const auth = await requireUser([
    "super_admin",
    "admin",
  ]);
  if (auth.response) return auth.response;

  try {
    const body = (await request.json()) as PricingSnapshot;

    if (!body.date || !Array.isArray(body.prices)) {
      return NextResponse.json(
        { error: "date and prices are required" },
        { status: 400 }
      );
    }

    savePricingSnapshot({
      date: body.date,
      prices: body.prices,
    });

    return NextResponse.json({
      success: true,
      message: "Pricing snapshot saved",
      snapshot: body,
    });
  } catch (error) {
    console.error("Pricing POST error:", error);

    return NextResponse.json(
      { error: "Failed to save pricing data" },
      { status: 500 }
    );
  }
}