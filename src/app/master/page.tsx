"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Building2,
  DollarSign,
  AlertTriangle,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  Plus,
  Receipt,
  Search,
  Cpu,
  Mail,
  ExternalLink,
  Rocket,
  FileText,
  UploadCloud,
  FileCheck,
  Trash2,
  Save,
  MessageSquare,
  LogOut,
  KeyRound,
  Scissors,
  Sparkles,
  Flower2,
  ShoppingBag,
  Pencil,
  Phone,
  Paperclip,
  CheckCircle,
  CheckSquare,
  Square,
  Activity,
  Award,
  Sparkle,
  Clock,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from '@/components/auth/AuthProvider';
import { AuthLoginForm } from '@/components/auth/AuthEntry';

export interface SystemLog {
  id: string;
  timestamp: string;
  companyName: string;
  action: string;
  author: string;
}

export interface TenantInvoice {
  id: string;
  referenceMonth: string;
  amount: number;
  dueDate: string;
  status: "Aberto" | "Pago" | "Vencido";
  paidAt?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  receiptName?: string;
  cardLast4?: string;
}

export interface ContractDocument {
  name: string;
  size: string;
  uploadedAt: string;
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
  status: "Ativo" | "Bloqueado" | "Pendente" | "Cancelado";
  autoBlockGraceDays: number;
  allowedModules: { [key: string]: boolean };
  moduleRoles?: { [key: string]: string[] };
  invoices: TenantInvoice[];
  contractDocument: ContractDocument | null;
  internalNotes: string;
  logoType: "icon" | "image";
  logoIcon: string;
  logoUrl?: string;
  primaryColor: string;
  createdAt: string;
}

const MASTER_PLANS_LIST = [
  { name: "Básico", price: 89.90, desc: "PDV limitado, Dashboard, Agenda, Atendimento, Serviços, Venda, Estoque, Clientes" },
  { name: "Pro", price: 149.90, desc: "Dashboard, Agenda, Atendimento, Serviços, Promoções, Vendas, Estoque, Despesas, Minha equipe, Cadastro de clientes, Resumo mensal" },
  { name: "Ultra", price: 299.90, desc: "Dashboard completo, Agenda, Atendimentos, Serviços, Promoções, Vendas, Estoque, Despesas, Equipe, Clientes, Módulo DRE Gerencial, 1 Consultoria mensal" },
  { name: "Consultoria Mensal", price: 99.90, desc: "Consultoria 1x no mês" },
  { name: "Consultoria Quinzenal", price: 179.90, desc: "Consultoria 2x no mês" },
  { name: "Consultoria Semanal", price: 319.90, desc: "Consultoria 4x no mês" },
  { name: "Consultoria Avulsa", price: 120.00, desc: "Sessão única de consultoria" }
];

const MASTER_TENANT_COLUMNS = [
  'id', 'slug', 'company_name', 'owner_name', 'owner_email', 'plan_name', 'monthly_fee',
  'due_day', 'status', 'allowed_modules', 'invoices', 'logo_type', 'logo_icon', 'logo_url',
  'primary_color', 'created_at',
].join(',');

const PLAN_DEFAULT_MODULES: Record<string, Record<string, boolean>> = {
  "Básico": {
    dashboard: true,
    calendar: true,
    atendimentos: true,
    services: true,
    promotions: false,
    pos: true,
    stock: true,
    expenses: false,
    team: false,
    customers: true,
    dre: false,
    settings: true
  },
  "Pro": {
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
    dre: false,
    settings: true
  },
  "Ultra": {
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
    dre: true,
    settings: true
  }
};

const MODULE_NAMES_LIST = [
  { id: "dashboard", label: "Dashboard Geral" },
  { id: "calendar", label: "Agenda de Horários" },
  { id: "atendimentos", label: "Atendimentos" },
  { id: "services", label: "Serviços & Preços" },
  { id: "promotions", label: "Promoções & Descontos" },
  { id: "pos", label: "Vendas de Balcão (PDV)" },
  { id: "stock", label: "Estoque & Produtos" },
  { id: "expenses", label: "Despesas Operacionais" },
  { id: "team", label: "Equipe de Colaboradores" },
  { id: "customers", label: "Base de Clientes" },
  { id: "dre", label: "Módulo DRE Gerencial (Exclusivo Ultra)" },
  { id: "settings", label: "Configurações Gerais" }
];
const AVAILABLE_ROLES_LIST = ["Dono", "Gestor", "Colaborador"];

function MasterWorkspace() {
  const auth = useAuth();

  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("contrato_notas");
  const [searchTerm, setSearchTerm] = useState("");
  const [logSearchTerm, setLogSearchTerm] = useState("");
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [modalError, setModalError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditTenantModalOpen, setIsEditTenantModalOpen] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editOwnerName, setEditOwnerName] = useState("");
  const [editOwnerEmail, setEditOwnerEmail] = useState("");
  const [editOwnerPhone, setEditOwnerPhone] = useState("");
  const [editMonthlyFee, setEditMonthlyFee] = useState(149.90);
  const [editPlanName, setEditPlanName] = useState("Pro");

  const [newCompany, setNewCompany] = useState("");
  const [newDocument, setNewDocument] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPlan, setNewPlan] = useState("Pro");
  const [newFee, setNewFee] = useState(149.90);
  const [newDueDay, setNewDueDay] = useState(10);

  const [isEditInvoiceModalOpen, setIsEditInvoiceModalOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceMonth, setInvoiceMonth] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<"Aberto" | "Pago" | "Vencido">("Aberto");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("Pix");
  const [invoiceCardInput, setInvoiceCardInput] = useState("");

  const [collapsedInvoices, setCollapsedInvoices] = useState<{ [id: string]: boolean }>({});

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const { data, error } = await supabase.from('tenants').select(MASTER_TENANT_COLUMNS);
        if (error) throw error;
        if (!error && data && data.length > 0) {
          const formatted: TenantAccount[] = data.map((t: any) => ({
            id: t.id,
            slug: t.slug || "studio-hair",
            companyName: t.company_name || t.companyName || "Empresa",
            document: t.document || "00.000.000/0001-00",
            ownerName: t.owner_name || t.ownerName || "Gestor",
            ownerEmail: t.owner_email || t.ownerEmail || "",
            ownerPhone: t.owner_phone || t.ownerPhone || "",
            planName: t.plan_name || t.planName || "Pro",
            monthlyFee: Number(t.monthly_fee || t.monthlyFee || 149.90),
            dueDay: Number(t.due_day || t.dueDay || 10),
            status: (t.status || "Ativo") as "Ativo" | "Bloqueado" | "Pendente" | "Cancelado",
            autoBlockGraceDays: 5,
            allowedModules: t.allowed_modules || t.allowedModules || { dre: true },
            moduleRoles: t.module_roles || t.moduleRoles || {},
            invoices: t.invoices || [],
            contractDocument: t.contractDocument || null,
            internalNotes: t.internalNotes || "Contrato ativo.",
            logoType: t.logo_type || "icon",
            logoIcon: t.logo_icon || "scissors",
            primaryColor: t.primary_color || "pink",
            createdAt: t.created_at || "2026-01-01"
          }));
          setTenants(formatted);
          if (formatted.length > 0 && !selectedTenantId) {
            setSelectedTenantId(formatted[0].id);
          }
        }
      } catch {
        setFeedbackMsg('Não foi possível carregar empresas do servidor.');
      }
    };
    fetchTenants();

    const savedLogs = localStorage.getItem("saas_system_audit_logs");
    if (savedLogs) {
      try { setSystemLogs(JSON.parse(savedLogs)); } catch (e) {}
    }
  }, []);

  const logAction = (companyName: string, action: string, author: string = "Master Admin") => {
    const newLog: SystemLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toLocaleString("pt-BR"),
      companyName,
      action,
      author
    };
    const updated = [newLog, ...systemLogs];
    setSystemLogs(updated);
    localStorage.setItem("saas_system_audit_logs", JSON.stringify(updated));
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch {
      setFeedbackMsg('A sessão foi encerrada localmente; valide a conectividade ao Auth.');
    }
  };
  const selectedTenant = useMemo(() => {
    return tenants.find((t) => t.id === selectedTenantId) || tenants[0] || null;
  }, [tenants, selectedTenantId]);

  const sortedInvoices = useMemo(() => {
    if (!selectedTenant || !selectedTenant.invoices) return [];
    return [...selectedTenant.invoices].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
  }, [selectedTenant]);

  const filteredSystemLogs = useMemo(() => {
    return systemLogs.filter((log: SystemLog) => {
      const matchCompany = selectedTenant ? log.companyName.toLowerCase() === selectedTenant.companyName.toLowerCase() : true;
      const term = logSearchTerm.toLowerCase();
      const matchSearch =
        !term ||
        log.action.toLowerCase().includes(term) ||
        log.timestamp.toLowerCase().includes(term) ||
        log.author.toLowerCase().includes(term);
      return matchCompany && matchSearch;
    });
  }, [systemLogs, selectedTenant, logSearchTerm]);

  const [currentNotes, setCurrentNotes] = useState("");

  useEffect(() => {
    if (selectedTenant) {
      setCurrentNotes(selectedTenant.internalNotes || "");
    }
  }, [selectedTenantId, selectedTenant]);

  const saasMetrics = useMemo(() => {
    const totalMRR = tenants.filter(t => t.status !== "Cancelado").reduce((acc, t) => acc + t.monthlyFee, 0);
    const activeCount = tenants.filter(t => t.status === "Ativo").length;
    const blockedCount = tenants.filter(t => t.status === "Bloqueado").length;
    const pendingCount = tenants.filter(t => t.status === "Pendente").length;
    return { totalMRR, activeCount, blockedCount, pendingCount };
  }, [tenants]);

  const toggleTenantBlock = async (tenantId: string) => {
    const target = tenants.find(t => t.id === tenantId);
    if (!target) return;
    const nextStatus: "Ativo" | "Bloqueado" = target.status === "Bloqueado" ? "Ativo" : "Bloqueado";

    const updatedList = tenants.map(t => t.id === tenantId ? { ...t, status: nextStatus } : t);
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ status: nextStatus })
        .eq('slug', target.slug);
    } catch (e) {}

    logAction(target.companyName, `Status alterado para ${nextStatus}`);
    setFeedbackMsg(`👑 Empresa ${nextStatus === 'Bloqueado' ? 'Bloqueada' : 'Desbloqueada'} com sucesso!`);
    setTimeout(() => setFeedbackMsg(""), 3500);
  };

  const handleToggleModuleInstant = async (moduleId: string) => {
    if (!selectedTenant) return;
    const currentAllowed = selectedTenant.allowedModules || {};
    const nextState = !(currentAllowed[moduleId] ?? true);

    const updatedModules = {
      ...currentAllowed,
      [moduleId]: nextState
    };

    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { 
      ...t, 
      allowedModules: updatedModules 
    } : t);
    
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({
          allowed_modules: updatedModules,
          ...(moduleId === 'dre' ? { dre: nextState } : {})
        })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(selectedTenant.companyName, `Módulo [${moduleId}] alterado para ${nextState ? 'Ativo' : 'Bloqueado'}`);
    setFeedbackMsg(`⚡ Módulo ${nextState ? 'ativado' : 'bloqueado'}!`);
    setTimeout(() => setFeedbackMsg(""), 2500);
  };

  const handleToggleRoleInstant = async (moduleId: string, roleName: string) => {
    if (!selectedTenant) return;
    const currentModuleRoles = selectedTenant.moduleRoles || {};
    const rolesForModule = currentModuleRoles[moduleId] || ["Dono", "Gestor", "Colaborador"];
    
    let updatedRolesForModule = [];
    if (rolesForModule.includes(roleName)) {
      updatedRolesForModule = rolesForModule.filter((r: string) => r !== roleName);
    } else {
      updatedRolesForModule = [...rolesForModule, roleName];
    }

    const updatedModuleRoles = {
      ...currentModuleRoles,
      [moduleId]: updatedRolesForModule
    };

    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, moduleRoles: updatedModuleRoles } : t);
    setTenants(updatedList);
    

    logAction(selectedTenant.companyName, `Alterou permissão do cargo [${roleName}] no módulo [${moduleId}]`);
    setFeedbackMsg(`✅ Acesso do cargo ${roleName} atualizado!`);
    setTimeout(() => setFeedbackMsg(""), 2000);
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>, invoiceId: string) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTenant) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Url = event.target?.result as string;

      const updatedInvoices = selectedTenant.invoices.map((inv: TenantInvoice) => {
        if (inv.id === invoiceId) {
          return {
            ...inv,
            receiptUrl: base64Url,
            receiptName: file.name
          };
        }
        return inv;
      });

      const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t);
      setTenants(updatedList);
      

      try {
        await supabase
          .from('tenants')
          .update({ invoices: updatedInvoices })
          .eq('slug', selectedTenant.slug);
      } catch (e) {}

      logAction(selectedTenant.companyName, `Anexou comprovante à fatura ID: ${invoiceId}`);
      setFeedbackMsg("✅ Comprovante anexado!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateNextInvoice = async () => {
    if (!selectedTenant) return;
    const invoices = selectedTenant.invoices || [];

    let nextYear = 2026;
    let nextMonthNum = 11;

    if (invoices.length > 0) {
      const sorted = [...invoices].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
      const lastInv = sorted[sorted.length - 1];
      const [yStr, mStr] = (lastInv.referenceMonth || "2026-10").split("-");
      let y = Number(yStr);
      let m = Number(mStr) + 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      nextYear = y;
      nextMonthNum = m;
    }

    const nextMonthStr = `${nextYear}-${String(nextMonthNum).padStart(2, "0")}`;
    const nextDueDate = `${nextMonthStr}-${String(selectedTenant.dueDay || 10).padStart(2, "0")}`;

    const alreadyExists = invoices.some((inv: TenantInvoice) => inv.referenceMonth === nextMonthStr);
    if (alreadyExists) {
      alert(`⚠️ Já existe uma fatura gerada para a competência ${nextMonthStr}.`);
      return;
    }

    const newInvoice: TenantInvoice = {
      id: `inv-${Date.now()}`,
      referenceMonth: nextMonthStr,
      amount: selectedTenant.monthlyFee,
      dueDate: nextDueDate,
      status: "Aberto",
      paymentMethod: "Pix"
    };

    const updatedInvoices = [...invoices, newInvoice];
    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t);
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ invoices: updatedInvoices })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(selectedTenant.companyName, `Gerou nova fatura para ${nextMonthStr}`);
    setFeedbackMsg(`✅ Fatura de ${nextMonthStr} gerada!`);
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const openEditTenantModal = (t: TenantAccount) => {
    setEditCompanyName(t.companyName);
    setEditOwnerName(t.ownerName);
    setEditOwnerEmail(t.ownerEmail);
    setEditOwnerPhone(t.ownerPhone);
    setEditMonthlyFee(t.monthlyFee);
    setEditPlanName(t.planName);
    setIsEditTenantModalOpen(true);
  };

  const handleSaveTenantEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;

    const newAllowedMods = PLAN_DEFAULT_MODULES[editPlanName] || selectedTenant.allowedModules;
    const newFeeVal = editPlanName === "Básico" ? 89.90 : editPlanName === "Ultra" ? 299.90 : 149.90;

    const updatedList = tenants.map(t => {
      if (t.id === selectedTenant.id) {
        return {
          ...t,
          companyName: editCompanyName,
          ownerName: editOwnerName,
          ownerEmail: editOwnerEmail,
          ownerPhone: editOwnerPhone,
          monthlyFee: Number(editMonthlyFee || newFeeVal),
          planName: editPlanName,
          allowedModules: newAllowedMods
        };
      }
      return t;
    });

    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({
          company_name: editCompanyName,
          owner_name: editOwnerName,
          owner_email: editOwnerEmail,
          owner_phone: editOwnerPhone,
          monthly_fee: Number(editMonthlyFee || newFeeVal),
          plan_name: editPlanName,
          allowed_modules: newAllowedMods
        })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(editCompanyName, `Atualizou plano para ${editPlanName}`);
    setIsEditTenantModalOpen(false);
    setFeedbackMsg(`✅ Empresa atualizada para o plano ${editPlanName}!`);
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleDeleteTenant = async () => {
    if (!selectedTenant) return;
    const confirmName = prompt(`⚠ ATENÇÃO!\n\nVocê vai excluir permanentemente a empresa "${selectedTenant.companyName}".\n\nDigite o nome exato da empresa para confirmar:`);
    
    if (confirmName !== selectedTenant.companyName) {
      alert("Nome incorreto. A exclusão foi cancelada.");
      return;
    }

    const targetSlug = selectedTenant.slug;
    const targetName = selectedTenant.companyName;

    try {
      await supabase.from('tenants').delete().eq('slug', targetSlug);
    } catch (e) {}

    const remaining = tenants.filter(t => t.id !== selectedTenant.id);
    setTenants(remaining);
    
    if (remaining.length > 0) {
      setSelectedTenantId(remaining[0].id);
    } else {
      setSelectedTenantId("");
    }

    logAction(targetName, "EXCLUIU permanentemente a empresa");
    setFeedbackMsg(`🗑 Empresa "${targetName}" excluída!`);
    setTimeout(() => setFeedbackMsg(""), 4000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTenant) return;

    const newDoc: ContractDocument = {
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      uploadedAt: new Date().toISOString().split("T")[0]
    };

    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, contractDocument: newDoc } : t);
    setTenants(updatedList);
    
    logAction(selectedTenant.companyName, `Anexou o contrato: ${file.name}`);
    setFeedbackMsg("✅ Contrato anexado!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleRemoveDocument = () => {
    if (!selectedTenant || !confirm("Remover contrato?")) return;
    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, contractDocument: null } : t);
    setTenants(updatedList);
    
    logAction(selectedTenant.companyName, "Removeu o contrato");
  };

  const openEditInvoiceModal = (inv: TenantInvoice) => {
    setEditingInvoiceId(inv.id);
    setInvoiceMonth(inv.referenceMonth);
    setInvoiceAmount(inv.amount);
    setInvoiceDueDate(inv.dueDate);
    setInvoiceStatus(inv.status);
    setInvoicePaymentMethod(inv.paymentMethod || "Pix");
    setInvoiceCardInput("");
    setIsEditInvoiceModalOpen(true);
  };

  const handleSaveInvoiceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !editingInvoiceId) return;

    let secureCardLast4 = undefined;
    if (invoicePaymentMethod === "Cartão de Crédito" && invoiceCardInput.trim()) {
      const cleanDigits = invoiceCardInput.replace(/\D/g, "");
      const last4 = cleanDigits.slice(-4);
      if (last4.length === 4) {
        secureCardLast4 = `•••• ${last4}`;
      }
    }

    const updatedInvoices = selectedTenant.invoices.map((inv: TenantInvoice) => {
      if (inv.id === editingInvoiceId) {
        return {
          ...inv,
          referenceMonth: invoiceMonth,
          amount: Number(invoiceAmount),
          dueDate: invoiceDueDate,
          status: invoiceStatus,
          paymentMethod: invoicePaymentMethod,
          ...(secureCardLast4 ? { cardLast4: secureCardLast4 } : {})
        };
      }
      return inv;
    });

    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t);
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ invoices: updatedInvoices })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(selectedTenant.companyName, `Editou a fatura ${invoiceMonth}`);
    setIsEditInvoiceModalOpen(false);
    setEditingInvoiceId(null);
    setFeedbackMsg("✅ Fatura atualizada!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!selectedTenant || !confirm("Excluir fatura?")) return;
    const updatedInvoices = selectedTenant.invoices.filter((inv: TenantInvoice) => inv.id !== invoiceId);

    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t);
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ invoices: updatedInvoices })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(selectedTenant.companyName, `Excluiu a fatura ID: ${invoiceId}`);
    setFeedbackMsg("🗑 Fatura excluída!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleSaveNotes = async () => {
    if (!selectedTenant) return;
    const updatedList = tenants.map(t => t.id === selectedTenant.id ? { ...t, internalNotes: currentNotes } : t);
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ internalNotes: currentNotes })
        .eq('slug', selectedTenant.slug);
    } catch (e) {}

    logAction(selectedTenant.companyName, "Atualizou anotações internas");
    setFeedbackMsg("✅ Anotações salvas!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const markInvoicePaid = async (tenantId: string, invoiceId: string) => {
    const target = tenants.find(t => t.id === tenantId);
    if (!target) return;

    const updatedInvoices = target.invoices.map((inv: TenantInvoice) => {
      if (inv.id === invoiceId) {
        return {
          ...inv,
          status: "Pago" as const,
          paidAt: new Date().toISOString().split("T")[0],
          paymentMethod: inv.paymentMethod || "Pix"
        };
      }
      return inv;
    });

    const updatedList = tenants.map(t => {
      if (t.id === tenantId) {
        return { ...t, status: "Ativo" as const, invoices: updatedInvoices };
      }
      return t;
    });
    setTenants(updatedList);
    

    try {
      await supabase
        .from('tenants')
        .update({ status: "Ativo", invoices: updatedInvoices })
        .eq('slug', target.slug);
    } catch (e) {}

    logAction(target.companyName, `Confirmou pagamento da fatura ID: ${invoiceId}`);
    setFeedbackMsg("✅ Pagamento confirmado e empresa ativada!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");

    const checkEmail = newEmail.trim().toLowerCase();
    if (!checkEmail.includes('@')) {
      setModalError('Informe um e-mail de contato válido.');
      return;
    }
    const slug = newCompany.toLowerCase().trim().replace(/[^a-z0-9]/g, '-');
    const defaultModsForNew = PLAN_DEFAULT_MODULES[newPlan] || PLAN_DEFAULT_MODULES["Pro"];

    const newTenantData = {
      slug,
      company_name: newCompany,
      owner_name: newOwner,
      owner_email: checkEmail,
      plan_name: newPlan,
      monthly_fee: Number(newFee) || 149.90,
      due_day: Number(newDueDay) || 10,
      status: "Ativo" as const,
      allowed_modules: defaultModsForNew,
      invoices: [{ id: `inv-${Date.now()}`, referenceMonth: "2026-10", amount: Number(newFee) || 149.90, dueDate: `2026-10-${String(newDueDay).padStart(2, "0")}`, status: "Aberto" as const }],
      logo_type: "icon",
      logo_icon: "scissors",
      primary_color: "pink",
      created_at: new Date().toISOString().split("T")[0]
    };

    let createdId = '';
    try {
      const { data, error } = await supabase.from('tenants').insert([newTenantData]).select('id').single();
      if (error || !data?.id) {
        setModalError('Não foi possível cadastrar a empresa. Nenhuma credencial Auth foi criada.');
        return;
      }
      createdId = data.id;
    } catch {
      setModalError('Não foi possível cadastrar a empresa. Nenhuma credencial Auth foi criada.');
      return;
    }

    const formatted: TenantAccount = {
      id: createdId,
      slug,
      companyName: newCompany,
      document: newDocument || "Não informado",
      ownerName: newOwner,
      ownerEmail: checkEmail,
      ownerPhone: newPhone,
      planName: newPlan,
      monthlyFee: Number(newFee) || 149.90,
      dueDay: Number(newDueDay) || 10,
      status: "Ativo",
      autoBlockGraceDays: 5,
      allowedModules: defaultModsForNew,
      invoices: [{ id: `inv-${Date.now()}`, referenceMonth: "2026-10", amount: Number(newFee) || 149.90, dueDate: `2026-10-${String(newDueDay).padStart(2, "0")}`, status: "Aberto" }],
      contractDocument: null,
      internalNotes: "Novo contrato cadastrado.",
      logoType: "icon",
      logoIcon: "scissors",
      primaryColor: "pink",
      createdAt: new Date().toISOString().split("T")[0]
    };

    const updatedList = [...tenants, formatted];
    setTenants(updatedList);
    setSelectedTenantId(formatted.id);
    

    setIsNewTenantModalOpen(false);
    setNewCompany("");
    setNewDocument("");
    setNewOwner("");
    setNewEmail("");
    setNewPhone("");

    logAction(formatted.companyName, `Cadastrou empresa no plano ${newPlan}`);
    setFeedbackMsg(`Empresa "${formatted.companyName}" cadastrada. O primeiro owner Auth deve ser provisionado pela Camada 1B.`);
    setTimeout(() => setFeedbackMsg(""), 3500);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-indigo-400"><ShieldCheck size={26} /></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-white tracking-tight">HandyHub • Master Control</h1>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <Lock size={10} /> AMBIENTE SEGURO & LOGS
              </span>
            </div>
            <p className="text-xs text-slate-400">Auditoria de ações, senhas protegidas e controle total.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {feedbackMsg && <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 rounded-xl">{feedbackMsg}</span>}
          <button onClick={() => { setIsNewTenantModalOpen(true); setModalError(""); }} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow cursor-pointer"><Plus size={15} /> Cadastrar Nova Empresa</button>
          <button onClick={handleLogout} className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-950 border border-slate-700 text-slate-300 font-bold text-xs px-3.5 py-2.5 rounded-xl transition cursor-pointer"><LogOut size={15} /><span>Sair</span></button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl"><span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">MRR Total</span><p className="text-2xl font-black text-emerald-400">R$ {saasMetrics.totalMRR.toFixed(2)}</p></div>
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl"><span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Empresas Ativas</span><p className="text-2xl font-black text-white">{saasMetrics.activeCount}</p></div>
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl"><span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Inadimplentes</span><p className="text-2xl font-black text-rose-400">{saasMetrics.blockedCount}</p></div>
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl"><span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Faturas Abertas</span><p className="text-2xl font-black text-amber-400">{saasMetrics.pendingCount}</p></div>
        </div>

        {tenants.length === 0 ? (
          <div className="bg-slate-900 border border-dashed border-slate-800 rounded-3xl p-12 text-center space-y-4">
            <Building2 size={36} className="mx-auto text-indigo-400" />
            <h3 className="text-base font-bold text-white">Nenhuma empresa cadastrada</h3>
            <button onClick={() => setIsNewTenantModalOpen(true)} className="bg-indigo-600 text-white font-bold text-xs px-5 py-2.5 rounded-xl cursor-pointer">+ Cadastrar Primeiro Cliente</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider border-b border-slate-800 pb-3">Carteira de Clientes</h2>
              <input type="text" placeholder="Buscar empresa..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none" />
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {tenants.filter(t => t.companyName.toLowerCase().includes(searchTerm.toLowerCase())).map((t) => (
                  <div key={t.id} onClick={() => setSelectedTenantId(t.id)} className={`p-3.5 rounded-2xl border transition cursor-pointer space-y-2 ${selectedTenant?.id === t.id ? "bg-indigo-600/15 border-indigo-500 text-white" : "bg-slate-950/60 border-slate-800 text-slate-300"}`}>
                    <div className="flex justify-between items-center">
                      <strong className="text-sm font-bold">{t.companyName}</strong>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.status === 'Bloqueado' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{t.status}</span>
                        <button onClick={(e) => { e.stopPropagation(); openEditTenantModal(t); }} className="p-1 hover:bg-slate-800 text-indigo-400 rounded" title="Editar Empresa"><Pencil size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedTenantId(t.id); handleDeleteTenant(); }} className="p-1 hover:bg-slate-800 text-rose-400 rounded" title="Excluir Empresa"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-slate-400"><span>{t.ownerName}</span><span className="font-black text-indigo-300">R$ {t.monthlyFee.toFixed(2)}</span></div>
                  </div>
                ))}
              </div>
            </div>

            {selectedTenant && (
              <div className="lg:col-span-2 space-y-5">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-white">{selectedTenant.companyName}</h3>
                    <p className="text-xs text-slate-400 mt-1">Responsável: <strong>{selectedTenant.ownerName}</strong> • {selectedTenant.ownerPhone}</p>
                    <p className="text-xs text-indigo-400 font-semibold mt-0.5">Plano: {selectedTenant.planName} • R$ {selectedTenant.monthlyFee.toFixed(2)}/mês</p>
                    
                    <div className="flex items-center gap-2 mt-3">
                      <a
                        href={`https://wa.me/${selectedTenant.ownerPhone.replace(/\D/g, '').startsWith('55') || selectedTenant.ownerPhone.replace(/\D/g, '').length > 11 ? selectedTenant.ownerPhone.replace(/\D/g, '') : '55' + selectedTenant.ownerPhone.replace(/\D/g, '')}?text=Olá%20${encodeURIComponent(selectedTenant.ownerName)},%20tudo%20bem?`}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 font-bold text-[11px] px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition"
                      >
                        <Phone size={13} />
                        <span>Chamar no WhatsApp</span>
                      </a>
                      <a
                        href={`mailto:${selectedTenant.ownerEmail}?subject=Suporte%20ou%20Aviso%20-%20SaaS`}
                        className="bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-300 font-bold text-[11px] px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition"
                      >
                        <Mail size={13} />
                        <span>Enviar E-mail</span>
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button disabled title="Acesso assistido requer fluxo server-side da Camada 1B" className="flex items-center gap-1.5 rounded-xl bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-400 disabled:cursor-not-allowed"><Rocket size={14} /><span>Suporte indisponível</span></button>
                      <button onClick={() => toggleTenantBlock(selectedTenant.id)} className={`text-xs font-bold px-3 py-2.5 rounded-xl border transition cursor-pointer ${selectedTenant.status === "Bloqueado" ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30" : "bg-rose-600/20 text-rose-300 border-rose-500/30"}`}>{selectedTenant.status === "Bloqueado" ? "Desbloquear" : "Bloquear"}</button>
                    </div>
                  </div>
                </div>

                <div className="flex border-b border-slate-800 gap-4 text-xs font-bold overflow-x-auto">
                  <button onClick={() => setActiveTab("contrato_notas")} className={`pb-3 transition cursor-pointer whitespace-nowrap ${activeTab === "contrato_notas" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400"}`}>Contrato & Notas</button>
                  <button onClick={() => setActiveTab("faturas")} className={`pb-3 transition cursor-pointer whitespace-nowrap ${activeTab === "faturas" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400"}`}>Faturas & Comprovantes</button>
                  <button onClick={() => setActiveTab("modulos")} className={`pb-3 transition cursor-pointer whitespace-nowrap ${activeTab === "modulos" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400"}`}>Módulos & Cargos</button>
                  <button onClick={() => setActiveTab("dados")} className={`pb-3 transition cursor-pointer whitespace-nowrap ${activeTab === "dados" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400"}`}>E-mails & Logins de Acesso</button>
                  <button onClick={() => setActiveTab("logs")} className={`pb-3 transition cursor-pointer whitespace-nowrap flex items-center gap-1 ${activeTab === "logs" ? "text-amber-400 border-b-2 border-amber-500" : "text-slate-400"}`}><Activity size={13} /> Audit Logs (Master)</button>
                </div>

                {activeTab === "contrato_notas" && (
                  <div className="space-y-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 text-xs">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                      <h4 className="font-bold text-white">Contrato de Prestação de Serviços</h4>
                      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                      <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-xl cursor-pointer">Anexar Contrato</button>
                    </div>
                    {selectedTenant.contractDocument ? <div className="p-3 bg-slate-950 rounded-xl flex justify-between items-center"><span>{selectedTenant.contractDocument.name}</span><button onClick={handleRemoveDocument} className="text-rose-400"><Trash2 size={14} /></button></div> : <p className="text-slate-500">Nenhum contrato anexado.</p>}
                    
                    <div className="pt-4 border-t border-slate-800 space-y-2">
                      <div className="flex justify-between items-center"><strong className="text-white">Anotações Internas</strong><button onClick={handleSaveNotes} className="bg-emerald-600 text-white font-bold px-3 py-1.5 rounded-xl cursor-pointer">Salvar Anotações</button></div>
                      <textarea rows={3} value={currentNotes} onChange={e => setCurrentNotes(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none" />
                    </div>
                  </div>
                )}

                {activeTab === "faturas" && (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 text-xs">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                      <h4 className="font-bold text-white">Histórico de Mensalidades & Comprovantes</h4>
                      <button onClick={handleGenerateNextInvoice} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-xl cursor-pointer shadow transition flex items-center gap-1.5">
                        <Plus size={14} /> Gerar Próxima Fatura
                      </button>
                    </div>

                    <div className="divide-y divide-slate-800">
                      {sortedInvoices.map((inv: TenantInvoice) => {
                        const isCollapsed = collapsedInvoices[inv.id] ?? false;
                        return (
                          <div key={inv.id} className="py-4 space-y-3">
                            <div className="flex justify-between items-center">
                              <div>
                                <strong className="text-white text-sm">Competência {inv.referenceMonth}</strong>
                                <p className="text-slate-400 text-[11px]">Vencimento: {inv.dueDate} • Forma: <strong className="text-indigo-300">{inv.paymentMethod || "Pix"}</strong> {inv.cardLast4 ? `(${inv.cardLast4})` : ""} • Status: <span className={inv.status === 'Pago' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{inv.status}</span> {inv.paidAt ? `(Pago em ${inv.paidAt})` : ""}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-black text-white text-sm">R$ {inv.amount.toFixed(2)}</span>
                                {inv.status !== "Pago" && (
                                  <button onClick={() => markInvoicePaid(selectedTenant.id, inv.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer">
                                    Marcar Pago
                                  </button>
                                )}
                                <button onClick={() => openEditInvoiceModal(inv)} className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded cursor-pointer" title="Editar Fatura"><Pencil size={14} /></button>
                                <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 text-rose-400 hover:bg-rose-50 rounded cursor-pointer" title="Excluir Fatura"><Trash2 size={14} /></button>
                                
                                <button 
                                  onClick={() => setCollapsedInvoices(prev => ({ ...prev, [inv.id]: !isCollapsed }))} 
                                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer flex items-center gap-1"
                                >
                                  {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                                  <span className="text-[10px]">{isCollapsed ? "Expandir" : "Fechar"}</span>
                                </button>
                              </div>
                            </div>

                            {!isCollapsed && (
                              <div className="flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800 animate-fadeIn">
                                <span className="text-slate-400">Comprovante de Pagamento:</span>
                                <div className="flex items-center gap-2">
                                  {inv.receiptUrl ? (
                                    <a href={inv.receiptUrl} target="_blank" rel="noreferrer" className="text-emerald-400 font-bold hover:underline flex items-center gap-1">
                                      📄 {inv.receiptName || "Ver Comprovante"}
                                    </a>
                                  ) : (
                                    <span className="text-slate-500 italic">Nenhum arquivo anexado</span>
                                  )}
                                  <input type="file" onChange={(e) => handleReceiptUpload(e, inv.id)} className="hidden" id={`receipt-${inv.id}`} accept="image/*,application/pdf" />
                                  <label htmlFor={`receipt-${inv.id}`} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded-lg cursor-pointer font-bold">
                                    {inv.receiptUrl ? "Substituir" : "Anexar Comprovante"}
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "modulos" && (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 text-xs">
                    <div className="border-b border-slate-800 pb-3">
                      <h4 className="font-bold text-white mb-1">Módulos & Controle de Acesso por Cargo</h4>
                      <p className="text-slate-400 text-[11px]">As alterações são salvas instantaneamente ao clicar nos botões.</p>
                    </div>

                    <div className="space-y-3">
                      {MODULE_NAMES_LIST.map(m => {
                        const isEn = selectedTenant.allowedModules?.[m.id] ?? true;
                        const allowedRolesForMod = selectedTenant.moduleRoles?.[m.id] || ["Dono", "Gestor", "Colaborador"];

                        return (
                          <div key={m.id} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white text-sm">{m.label}</span>
                              <button 
                                type="button"
                                onClick={() => handleToggleModuleInstant(m.id)} 
                                className={`px-3 py-1.5 rounded-lg font-bold text-[11px] cursor-pointer transition ${isEn ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}
                              >
                                {isEn ? "Módulo Ativo" : "Módulo Bloqueado"}
                              </button>
                            </div>

                            <div className="flex items-center gap-2 pt-2 border-t border-slate-900 text-[11px]">
                              <span className="text-slate-400 font-semibold mr-1">Cargos com acesso:</span>
                              {AVAILABLE_ROLES_LIST.map(r => {
                                const hasRoleAccess = allowedRolesForMod.includes(r);
                                return (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() => handleToggleRoleInstant(m.id, r)}
                                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                                      hasRoleAccess 
                                        ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300" 
                                        : "bg-slate-900 border-slate-800 text-slate-600"
                                    }`}
                                  >
                                    {r} {hasRoleAccess ? "✓" : "×"}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "dados" && (
                  <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-xs">
                    <h4 className="border-b border-slate-800 pb-3 font-bold text-white">Acessos e memberships</h4>
                    <p className="mt-3 text-slate-300">`tenants.logins` deixou de ser fonte de autenticação. Convites usam Supabase Auth e associação por tenant_id; o provisionamento do primeiro owner fica para a Camada 1B.</p>
                  </div>
                )}
                {activeTab === "logs" && (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 text-xs">
                    <h4 className="font-bold text-amber-400 flex items-center gap-1.5"><Activity size={15} /> Log de Auditoria: {selectedTenant.companyName}</h4>
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {filteredSystemLogs.length === 0 ? (
                        <p className="text-slate-500 py-8 text-center italic">Nenhum registro de log encontrado.</p>
                      ) : (
                        filteredSystemLogs.map((log: SystemLog) => (
                          <div key={log.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center">
                            <div>
                              <span className="text-slate-200 font-semibold">{log.action}</span>
                              <span className="text-[11px] text-slate-500 block">Autor: {log.author}</span>
                            </div>
                            <span className="text-[11px] text-amber-400 font-mono">{log.timestamp}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL EDITAR EMPRESA & PLANO */}
      {isEditTenantModalOpen && selectedTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Editar Empresa & Mudar Plano</h3>
              <button onClick={() => setIsEditTenantModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveTenantEdit} className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Nome da Empresa *</label>
                <input required value={editCompanyName} onChange={e => setEditCompanyName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Responsável *</label>
                  <input required value={editOwnerName} onChange={e => setEditOwnerName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">E-mail Principal *</label>
                  <input required type="email" value={editOwnerEmail} onChange={e => setEditOwnerEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">WhatsApp *</label>
                  <input required value={editOwnerPhone} onChange={e => setEditOwnerPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Plano Contratado *</label>
                  <select value={editPlanName} onChange={e => {
                    const sel = e.target.value;
                    setEditPlanName(sel);
                    if (sel === "Básico") setEditMonthlyFee(89.90);
                    else if (sel === "Pro") setEditMonthlyFee(149.90);
                    else if (sel === "Ultra") setEditMonthlyFee(299.90);
                  }} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-indigo-300 font-bold outline-none">
                    <option value="Básico">Básico</option>
                    <option value="Pro">Pro</option>
                    <option value="Ultra">Ultra</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Mensalidade (R$) *</label>
                <input required type="number" step="0.01" value={editMonthlyFee} onChange={e => setEditMonthlyFee(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-emerald-400 font-bold outline-none" />
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl cursor-pointer">Salvar Alterações</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDITAR FATURA */}
      {isEditInvoiceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Editar Fatura & Forma de Pagamento</h3>
              <button onClick={() => setIsEditInvoiceModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveInvoiceEdit} className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Competência (AAAA-MM) *</label>
                <input required placeholder="2026-11" value={invoiceMonth} onChange={e => setInvoiceMonth(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Valor (R$) *</label>
                  <input required type="number" step="0.01" value={invoiceAmount} onChange={e => setInvoiceAmount(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-emerald-400 font-bold outline-none" />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Vencimento *</label>
                  <input required type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Forma de Pagamento *</label>
                <select value={invoicePaymentMethod} onChange={e => setInvoicePaymentMethod(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none font-bold">
                  <option value="Pix">Pix</option>
                  <option value="Boleto">Boleto</option>
                  <option value="Cartão de Crédito">Cartão de Crédito</option>
                </select>
              </div>

              {invoicePaymentMethod === "Cartão de Crédito" && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl space-y-1">
                  <label className="text-indigo-300 font-bold block">Segurança de Dados do Cartão (PCI Compliant)</label>
                  <p className="text-slate-400 text-[10px]">Insira apenas os 4 últimos dígitos.</p>
                  <input type="text" maxLength={4} placeholder="Ex: 4821" value={invoiceCardInput} onChange={e => setInvoiceCardInput(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2 rounded-lg text-white font-mono" />
                </div>
              )}

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Status *</label>
                <select value={invoiceStatus} onChange={e => setInvoiceStatus(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none font-bold">
                  <option value="Aberto">Aberto</option>
                  <option value="Pago">Pago</option>
                  <option value="Vencido">Vencido</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl cursor-pointer">Salvar Fatura</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR / EDITAR LOGIN */}
      {/* MODAL NOVO CLIENTE */}
      {isNewTenantModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Cadastrar Empresa Contratante</h3>
              <button onClick={() => setIsNewTenantModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            {modalError && <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl font-bold text-center">{modalError}</div>}

            <form onSubmit={handleCreateTenant} className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Nome da Empresa *</label>
                <input required placeholder="Ex: Nome do Salão ou Loja" value={newCompany} onChange={e => setNewCompany(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Responsável *</label>
                  <input required placeholder="Nome do Dono" value={newOwner} onChange={e => setNewOwner(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">E-mail Principal *</label>
                  <input required type="email" placeholder="contato@empresa.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Plano Inicial *</label>
                  <select value={newPlan} onChange={e => {
                    const selName = e.target.value;
                    setNewPlan(selName);
                    const foundP = MASTER_PLANS_LIST.find(p => p.name === selName);
                    if (foundP) setNewFee(foundP.price);
                  }} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none font-bold">
                    {MASTER_PLANS_LIST.map(p => <option key={p.name} value={p.name}>{p.name} (R$ {p.price.toFixed(2)})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Mensalidade (R$) *</label>
                  <input required type="number" step="0.01" value={newFee} onChange={e => setNewFee(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-emerald-400 font-bold outline-none" />
                </div>
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Telefone / WhatsApp *</label>
                <input required placeholder="(19) 99999-9999" value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>

              <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl cursor-pointer">Criar Empresa Segura</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MasterAccessGate() {
  const { user, loading, signOut } = useAuth();
  const [status, setStatus] = useState<'checking' | 'allowed' | 'denied' | 'unavailable'>('checking');

  useEffect(() => {
    if (!user) {
      setStatus('checking');
      return;
    }
    const controller = new AbortController();
    setStatus('checking');
    void fetch('/api/auth/platform-admin', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setStatus('unavailable');
          return;
        }
        setStatus(result.isPlatformAdmin === true ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unavailable');
      });
    return () => controller.abort();
  }, [user?.id]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">Validando sessão…</main>;
  if (!user) return <AuthLoginForm />;
  if (status === 'allowed') return <MasterWorkspace />;
  if (status === 'checking') return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">Verificando platform_admin…</main>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-slate-100">
      <section className="max-w-md space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-7 text-center">
        <h1 className="text-lg font-black">{status === 'denied' ? 'Acesso restrito' : 'Master indisponível'}</h1>
        <p className="text-sm text-slate-300">
          {status === 'denied'
            ? 'Esta conta autenticada não está registrada como platform_admin.'
            : 'A validação server-side de platform_admin não está disponível. Solicite a configuração administrativa do servidor.'}
        </p>
        <button onClick={() => void signOut().catch(() => undefined)} className="rounded-xl bg-slate-700 px-4 py-3 text-xs font-bold">Sair</button>
      </section>
    </main>
  );
}

export default function MasterPanel() {
  return <MasterAccessGate />;
}
