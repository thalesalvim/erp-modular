export type ModuleKey = 
  | "dashboard" 
  | "service_orders" 
  | "calendar" 
  | "atendimentos"
  | "pos" 
  | "stock"
  | "expenses"
  | "customers" 
  | "catalog" 
  | "settings"
  | "subscriptions" 
  | "financial";

export interface BusinessProfile {
  id: string;
  name: string;
  type: "SALON" | "METALWORK" | "SOCCER_SCHOOL" | "NURSERY" | "LANDSCAPING" | "OTHER";
  segment: string;
  document: string;
  phone: string;
  status: "ACTIVE" | "BLOCKED";
  enabledModules: ModuleKey[];
  createdAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "SUPER_ADMIN" | "TENANT_ADMIN";
  tenantId?: string;
}

export const INITIAL_CLIENTS: BusinessProfile[] = [
  {
    id: "tenant-salao",
    name: "Studio Hair",
    type: "SALON",
    segment: "Salão de Beleza & Estética",
    document: "23.456.789/0001-01",
    phone: "(19) 97654-3210",
    status: "ACTIVE",
    enabledModules: ["dashboard", "calendar", "atendimentos", "pos", "stock", "expenses", "customers", "settings"],
    createdAt: "2026-09-01"
  },
  {
    id: "tenant-serralheria",
    name: "Serralheria Confiança",
    type: "METALWORK",
    segment: "Serralheria & Estruturas Metálicas",
    document: "12.345.678/0001-90",
    phone: "(19) 99876-5432",
    status: "ACTIVE",
    enabledModules: ["dashboard", "service_orders", "customers", "financial"],
    createdAt: "2026-09-05"
  },
  {
    id: "tenant-escolinha",
    name: "Escolinha Futuro Craque",
    type: "SOCCER_SCHOOL",
    segment: "Escola de Futebol & Esportes",
    document: "34.567.890/0001-12",
    phone: "(19) 96543-2109",
    status: "ACTIVE",
    enabledModules: ["dashboard", "subscriptions", "calendar", "customers", "financial"],
    createdAt: "2026-09-10"
  },
  {
    id: "tenant-mudas",
    name: "Viveiro Verde Vida",
    type: "NURSERY",
    segment: "Loja de Mudas & Plantas",
    document: "45.678.901/0001-23",
    phone: "(19) 95432-1098",
    status: "ACTIVE",
    enabledModules: ["dashboard", "pos", "stock", "customers", "financial"],
    createdAt: "2026-09-12"
  },
  {
    id: "tenant-jardinagem",
    name: "Verde Jardim Paisagismo",
    type: "LANDSCAPING",
    segment: "Jardinagem & Paisagismo",
    document: "98.765.432/0001-10",
    phone: "(19) 98765-4321",
    status: "ACTIVE",
    enabledModules: ["dashboard", "service_orders", "calendar", "customers", "financial"],
    createdAt: "2026-09-15"
  }
];

export const INITIAL_USERS: UserAccount[] = [
  {
    id: "admin-master",
    name: "Thales Alvim (Super Admin)",
    email: "thalesalvim997@gmail.com",
    password: "Isabela123!",
    role: "SUPER_ADMIN"
  },
  {
    id: "u-salao",
    name: "Gisele Gonçalves",
    email: "salao@omnigestor.com",
    password: "123",
    role: "TENANT_ADMIN",
    tenantId: "tenant-salao"
  }
];

export const DEMO_CLIENTS = INITIAL_CLIENTS;
export const DEMO_USERS = INITIAL_USERS;
