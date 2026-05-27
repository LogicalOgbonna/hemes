import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rows = await query(
      "SELECT id, title, completed, created_at FROM todos WHERE id = $1",
      [id]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const result = await query(
      "UPDATE todos SET completed = $1 WHERE id = $2 RETURNING id, title, completed, created_at",
      [!rows[0].completed, id]
    );

    return NextResponse.json(result[0]);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update todo" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await query("DELETE FROM todos WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete todo" },
      { status: 500 }
    );
  }
}
