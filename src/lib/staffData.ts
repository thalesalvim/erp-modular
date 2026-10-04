export interface WorkDayConfig {
  dayIndex: number;
  dayName: string;
  isWorking: boolean;
  open: string;
  close: string;
  lunchStart?: string;
  lunchEnd?: string;
}

export interface StaffUser {
  id: string;
  name: string;
  login: string;
  passwordHash: string;
  role: "ADMIN" | "PROFISSIONAL";
  schedule: WorkDayConfig[];
}

const DEFAULT_WEEK: WorkDayConfig[] = [
  { dayIndex: 0, dayName: "Domingo", isWorking: false, open: "09:00", close: "14:00" },
  { dayIndex: 1, dayName: "Segunda-feira", isWorking: false, open: "09:00", close: "18:00" },
  { dayIndex: 2, dayName: "Terça-feira", isWorking: true,  open: "09:00", close: "19:00" },
  { dayIndex: 3, dayName: "Quarta-feira", isWorking: true,  open: "09:00", close: "19:00" },
  { dayIndex: 4, dayName: "Quinta-feira", isWorking: true,  open: "09:00", close: "20:00" },
  { dayIndex: 5, dayName: "Sexta-feira", isWorking: true,  open: "09:00", close: "20:00" },
  { dayIndex: 6, dayName: "Sábado", isWorking: true,  open: "08:30", close: "18:00" }
];

export const staffDatabase: StaffUser[] = [
  {
    id: "1",
    name: "Gisele",
    login: "gisele",
    passwordHash: "123456",
    role: "PROFISSIONAL",
    schedule: JSON.parse(JSON.stringify(DEFAULT_WEEK))
  },
  {
    id: "2",
    name: "Thaís",
    login: "thais",
    passwordHash: "123456",
    role: "PROFISSIONAL",
    schedule: JSON.parse(JSON.stringify(DEFAULT_WEEK))
  }
];
