export type TenantStatus = "Ativo" | "Bloqueado" | "Pendente" | "Cancelado";

export interface ContractDocument {
  name: string;
  size: string;
  uploadedAt: string;
}

export interface TenantInvoice {
  id: string;
  referenceMonth: string;
  amount: number;
  dueDate: string;
  status: "Aberto" | "Pago" | "Atrasado";
  paidAt?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  receiptName?: string;
}

export interface TenantLogin {
  name: string;
  email?: string;
  user: string;
  passwordHash: string;
  role: string;
}

export interface TenantAccount {
  id: string;
  slug: string;
  companyName: string;
  document: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  planName: string;
  monthlyFee: number;
  dueDay: number;
  status: TenantStatus;
  autoBlockGraceDays: number;
  allowedModules: Record<string, boolean>;
  invoices: TenantInvoice[];
  logins: TenantLogin[];
  contractDocument: ContractDocument | null;
  internalNotes: string;
  logoType?: "icon" | "image";
  logoIcon?: string;
  logoUrl?: string;
  primaryColor?: string;
  createdAt: string;
}

export const INITIAL_TENANTS: TenantAccount[] = [
  {
    id: "tenant-1",
    slug: "studio-hair",
    companyName: "Studio Hair",
    document: "15.515.656/0001-99",
    ownerName: "Gisele Alvim",
    ownerEmail: "fdsfds@gmail.com",
    ownerPhone: "19999999999",
    planName: "Pro (Gestão Completa)",
    monthlyFee: 149.90,
    dueDay: 10,
    status: "Ativo",
    autoBlockGraceDays: 5,
    allowedModules: {
      dashboard: true,
      calendar: true,
      atendimentos: true,
      services: true,
      promotions: true,
      pos: true,
      stock: true,
      expenses: true,
      team: true,
      customers: true,
      settings: true
    },
    invoices: [
      {
        id: "inv-init-1",
        referenceMonth: "2026-10",
        amount: 149.90,
        dueDate: "2026-10-10",
        status: "Aberto"
      }
    ],
    logins: [
      {
        name: "Gisele Alvim",
        email: "fdsfds@gmail.com",
        user: "gisele",
        passwordHash: "Isabela123!",
        role: "Proprietária / Gestora Principal"
      }
    ],
    contractDocument: {
      name: "proposta_implantacao_salao.docx",
      size: "45.2 KB",
      uploadedAt: "2026-03-01"
    },
    internalNotes: "Novo contrato cadastrado pelo Master.",
    logoType: "icon",
    logoIcon: "scissors",
    primaryColor: "pink",
    createdAt: "2026-03-01"
  }
];
