import { NextResponse } from "next/server";
import { staffDatabase } from "@/lib/staffData";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "LOGIN") {
      const { login, password } = body;
      const user = staffDatabase.find(
        (u) => u.login.toLowerCase() === login.toLowerCase() && u.passwordHash === password
      );

      if (!user) {
        return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
      }

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          schedule: user.schedule
        }
      });
    }

    if (action === "UPDATE_SCHEDULE") {
      const { userId, newSchedule } = body;
      const user = staffDatabase.find((u) => u.id === userId);

      if (!user) {
        return NextResponse.json({ error: "Profissional não encontrada." }, { status: 404 });
      }

      user.schedule = newSchedule;

      return NextResponse.json({
        success: true,
        message: "Escala atualizada com sucesso!"
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
