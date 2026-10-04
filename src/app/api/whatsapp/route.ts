import { NextResponse } from "next/server";

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = (m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

// Escala padrão caso a profissional não tenha horário personalizado
const DEFAULT_SCHEDULE = [
  { dayIndex: 0, isWorking: false, open: "09:00", close: "14:00" }, // Domingo
  { dayIndex: 1, isWorking: false, open: "09:00", close: "18:00" }, // Segunda
  { dayIndex: 2, isWorking: true,  open: "09:00", close: "19:00" }, // Terça
  { dayIndex: 3, isWorking: true,  open: "09:00", close: "19:00" }, // Quarta
  { dayIndex: 4, isWorking: true,  open: "09:00", close: "20:00" }, // Quinta
  { dayIndex: 5, isWorking: true,  open: "09:00", close: "20:00" }, // Sexta
  { dayIndex: 6, isWorking: true,  open: "08:30", close: "18:00" }  // Sábado
];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, professionalName, date, duration = 30 } = body;

    if (action === "GET_AVAILABLE_HOURS") {
      const dateObj = new Date(date + "T00:00:00");
      const dayIndex = dateObj.getDay();

      const dayConfig = DEFAULT_SCHEDULE.find(d => d.dayIndex === dayIndex);

      if (!dayConfig || !dayConfig.isWorking) {
        return NextResponse.json({
          available: false,
          message: `A profissional ${professionalName} não atende neste dia da semana (está de folga).`,
          slots: []
        });
      }

      const openMin = timeToMinutes(dayConfig.open);
      const closeMin = timeToMinutes(dayConfig.close);

      // Simulação de intervalos livres de 45 em 45 minutos dentro do turno
      const slots: string[] = [];
      for (let time = openMin; time + duration <= closeMin; time += 45) {
        slots.push(minutesToTime(time));
      }

      // Devolve os horários formatados prontos para o Typebot exibir
      const formattedText = slots.slice(0, 6).map((s, idx) => `${idx + 1}️⃣ ${s}`).join("\n");

      return NextResponse.json({
        available: true,
        slots: slots.slice(0, 6),
        formattedMessage: formattedText
      });
    }

    return NextResponse.json({ error: "Ação não reconhecida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
