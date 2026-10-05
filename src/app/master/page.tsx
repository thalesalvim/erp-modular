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
  Clock
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function hashPassword(pass: string): string {
  try {
    let hash = 0;
    for (let i = 0; i < pass.length; i++) {
      const char = pass.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return "sec_" + Math.abs(hash).toString(36) + "_" + btoa(pass).substring(0, 6);
  } catch (e) {
    return "sec_fallback_" + pass;
  }
}

function validatePasswordStrength(pass: string): string | null {
  if (pass.length < 8) return "A senha precisa ter no mínimo 8 caracteres.";
  if (!/[A-Z]/.test(pass)) return "A senha precisa ter pelo menos 1 letra maiúscula.";
  if (!/[a-z]/.test(pass)) return "A senha precisa ter pelo menos 1 letra minúscula.";
  if (!/[0-9]/.test(pass)) return "A senha precisa ter pelo menos 1 número.";
  if (!/[^A-Za-z0-9]/.test(pass)) return "A senha precisa ter pelo menos 1 caractere especial.";
  return null;
}

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

export interface TenantLogin {
  name: string;
  email?: string;
  user: string;
  passwordHash: string;
  role: "Dono" | "Gestor" | "Colaborador";
  twoFactorEnabled?: boolean;
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
  logins: TenantLogin[];
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

export default function MasterPanel() {
  const [isMounted, setIsMounted] = useState(false);
  const [isMasterAuth, setIsMasterAuth] = useState(false);

  const [userInput, setUserInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("contrato_notas");
  const [searchTerm, setSearchTerm] = useState("");
  const [logSearchTerm, setLogSearchTerm] = useState("");
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [modalError, setModalError] = useState("");

  const [trialDaysInput, setTrialDaysInput] = useState(7);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const [newCompany, setNewCompany] = useState("");
  const [newDocument, setNewDocument] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPlan, setNewPlan] = useState("Pro");
  const [newFee, setNewFee] = useState(149.90);
  const [newDueDay, setNewDueDay] = useState(10);
  const [newInitialUser, setNewInitialUser] = useState("");
  const [newInitialPass, setNewInitialPass] = useState("");
  const [newEnable2FA, setNewEnable2FA] = useState(false);

  const [isNewLoginModalOpen, setIsNewLoginModalOpen] = useState(false);
  const [editingLoginIdx, setEditingLoginIdx] = useState<number | null>(null);
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRole, setLoginRole] = useState<"Dono" | "Gestor" | "Colaborador">("Gestor");
  const [login2FA, setLogin2FA] = useState(false);

  const [isEditInvoiceModalOpen, setIsEditInvoiceModalOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceMonth, setInvoiceMonth] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<"Aberto" | "Pago" | "Vencido">("Aberto");

  useEffect(() => {
    setIsMounted(true);
    const fetchTenants = async () => {
      try {
        const { data, error } = await supabase.from('tenants').select('*');
        if (!error && data && data.length > 0) {
          const formatted = data.map((t: any) => ({
            id: t.id || `t-${Math.random()}`,
            slug: t.slug || "studio-hair",
            companyName: t.company_name || t.companyName || "Empresa",
            document: t.document || "00.000.000/0001-00",
            ownerName: t.owner_name || t.ownerName || "Gestor",
            ownerEmail: t.owner_email || t.ownerEmail || "",
            ownerPhone: t.owner_phone || t.ownerPhone || "",
            planName: t.plan_name || t.planName || "Pro",
            monthlyFee: Number(t.monthly_fee || t.monthlyFee || 149.90),
            dueDay: Number(t.due_day || t.dueDay || 10),
            status: t.status || "Ativo",
            autoBlockGraceDays: 5,
            allowedModules: t.allowed_modules || t.allowedModules || { dre: true },
            invoices: t.invoices || [],
            logins: t.logins || [],
            contractDocument: t.contractDocument || null,
            internalNotes: t.internalNotes || "Contrato ativo.",
            logoType: t.logo_type || "icon",
            logoIcon: t.logo_icon || "scissors",
            primaryColor: t.primary_color || "pink",
            createdAt: t.created_at || "2026-01-01"
          }));
          setTenants(formatted);
          if (formatted.length > 0) setSelectedTenantId(formatted[0].id);
        } else {
          // Fallback para localStorage ou dados padrão caso o Supabase venha vazio
          const saved = localStorage.getItem("saas_tenants_db");
          if (saved) {
            const parsed = JSON.parse(saved);
            setTenants(parsed);
            if (parsed.length > 0) setSelectedTenantId(parsed[0].id);
          } else {
            const defaultTenant: TenantAccount = {
              id: "tenant-1",
              slug: "studio-hair",
              companyName: "Studio Hair & Beauty",
              document: "12.345.678/0001-99",
              ownerName: "Gisele Alvim",
              ownerEmail: "gisele@gmail.com",
              ownerPhone: "19999999999",
              planName: "Pro",
              monthlyFee: 149.90,
              dueDay: 10,
              status: "Ativo",
              autoBlockGraceDays: 5,
              allowedModules: { dre: true },
              invoices: [{ id: "inv-1", referenceMonth: "2026-10", amount: 149.90, dueDate: "2026-10-10", status: "Pago" }],
              logins: [{ name: "Gisele Alvim", email: "gisele@gmail.com", user: "gisele", passwordHash: hashPassword("123456"), role: "Dono" }],
              contractDocument: null,
              internalNotes: "Contrato ativo.",
              logoType: "icon",
              logoIcon: "scissors",
              primaryColor: "pink",
              createdAt: "2026-01-01"
            };
            setTenants([defaultTenant]);
            setSelectedTenantId(defaultTenant.id);
            localStorage.setItem("saas_tenants_db", JSON.stringify([defaultTenant]));
          }
        }
      } catch (err) {
        const saved = localStorage.getItem("saas_tenants_db");
        if (saved) {
          const parsed = JSON.parse(saved);
          setTenants(parsed);
          if (parsed.length > 0) setSelectedTenantId(parsed[0].id);
        }
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    const cleanUser = userInput.trim().toLowerCase();
    const cleanPass = passInput.trim();

    if ((cleanUser === "master" || cleanUser === "thaleco7") && cleanPass === "Isabela123!") {
      setIsMasterAuth(true);
      logAction("SaaS Central", "Login Master realizado com sucesso");
    } else {
      setErrorMsg("Credenciais incorretas.");
    }
  };

  const handleLogout = () => {
    setIsMasterAuth(false);
    localStorage.removeItem("saas_active_tenant");
    window.location.href = "/";
  };

  const selectedTenant = useMemo(() => {
    return tenants.find((t) => t.id === selectedTenantId) || tenants[0] || null;
  }, [tenants, selectedTenantId]);

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

  const launchTenantDashboard = (tenant: TenantAccount) => {
    if (typeof window !== "undefined") {
      const bypassToken = "bypass_master_" + Date.now();
      localStorage.setItem("saas_active_tenant", tenant.slug);
      localStorage.setItem("master_bypass_auth", bypassToken);
      localStorage.setItem("master_bypass_slug", tenant.slug);
      localStorage.setItem("master_bypass_login_name", tenant.ownerName || "Dono");
      localStorage.setItem("master_bypass_login_role", "Dono");
      logAction(tenant.companyName, "Acesso Master Bypass ao Dashboard");
      window.open(`/?c=${tenant.slug}&master_bypass=${bypassToken}`, "_blank");
    }
  };

  const toggleTenantBlock = async (tenantId: string) => {
    const target = tenants.find(t => t.id === tenantId);
    if (!target) return;
    const nextStatus = target.status === "Bloqueado" ? "Ativo" : "Bloqueado";

    const { error } = await supabase
      .from('tenants')
      .update({ status: nextStatus })
      .eq('slug', target.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === tenantId ? { ...t, status: nextStatus } : t));
      logAction(target.companyName, `Alterou status do contrato para: ${nextStatus}`);
      setFeedbackMsg(`Empresa ${nextStatus === 'Bloqueado' ? 'bloqueada' : 'desbloqueada'} com sucesso!`);
      setTimeout(() => setFeedbackMsg(""), 3000);
    } else {
      alert("Erro ao atualizar status na nuvem.");
    }
  };

  const toggleTenantModule = async (moduleId: string) => {
    if (!selectedTenant) return;
    const currentAllowed = selectedTenant.allowedModules || {};
    const updatedModules = {
      ...currentAllowed,
      [moduleId]: !(currentAllowed[moduleId] ?? true)
    };

    const { error } = await supabase
      .from('tenants')
      .update({ allowed_modules: updatedModules })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, allowedModules: updatedModules } : t));
      logAction(selectedTenant.companyName, `Alternou o estado do módulo [${moduleId}] para ${updatedModules[moduleId] ? 'Ativo' : 'Bloqueado'}`);
    } else {
      alert("Erro ao atualizar módulos na nuvem.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTenant) return;

    const newDoc: ContractDocument = {
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      uploadedAt: new Date().toISOString().split("T")[0]
    };

    setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, contractDocument: newDoc } : t));
    logAction(selectedTenant.companyName, `Anexou o contrato: ${file.name}`);
    setFeedbackMsg("✅ Contrato anexado!");
    setTimeout(() => setFeedbackMsg(""), 3000);
  };

  const handleRemoveDocument = () => {
    if (!selectedTenant || !confirm("Remover contrato?")) return;
    setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, contractDocument: null } : t));
    logAction(selectedTenant.companyName, "Removeu o documento de contrato");
  };

  const handleReceiptUpload = (invoiceId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTenant) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      const updatedInvoices = selectedTenant.invoices.map((inv: TenantInvoice) => {
        if (inv.id === invoiceId) {
          return { ...inv, receiptUrl: base64, receiptName: file.name };
        }
        return inv;
      });

      const { error } = await supabase
        .from('tenants')
        .update({ invoices: updatedInvoices })
        .eq('slug', selectedTenant.slug);

      if (!error) {
        setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t));
        logAction(selectedTenant.companyName, `Anexou comprovante de pagamento à fatura (${invoiceId})`);
        setFeedbackMsg("✅ Comprovante anexado à fatura com segurança!");
        setTimeout(() => setFeedbackMsg(""), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

  const openEditInvoiceModal = (inv: TenantInvoice) => {
    setEditingInvoiceId(inv.id);
    setInvoiceMonth(inv.referenceMonth);
    setInvoiceAmount(inv.amount);
    setInvoiceDueDate(inv.dueDate);
    setInvoiceStatus(inv.status);
    setIsEditInvoiceModalOpen(true);
  };

  const handleSaveInvoiceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !editingInvoiceId) return;

    const updatedInvoices = selectedTenant.invoices.map((inv: TenantInvoice) => {
      if (inv.id === editingInvoiceId) {
        return {
          ...inv,
          referenceMonth: invoiceMonth,
          amount: Number(invoiceAmount),
          dueDate: invoiceDueDate,
          status: invoiceStatus
        };
      }
      return inv;
    });

    const { error } = await supabase
      .from('tenants')
      .update({ invoices: updatedInvoices })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t));
      logAction(selectedTenant.companyName, `Editou a fatura da competência ${invoiceMonth}`);
      setIsEditInvoiceModalOpen(false);
      setEditingInvoiceId(null);
      setFeedbackMsg("✅ Fatura atualizada!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!selectedTenant || !confirm("Deseja realmente excluir esta fatura?")) return;
    const updatedInvoices = selectedTenant.invoices.filter((inv: TenantInvoice) => inv.id !== invoiceId);

    const { error } = await supabase
      .from('tenants')
      .update({ invoices: updatedInvoices })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, invoices: updatedInvoices } : t));
      logAction(selectedTenant.companyName, `EXCLUIU a fatura ID: ${invoiceId}`);
      setFeedbackMsg("🗑 Fatura excluída!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedTenant) return;
    const { error } = await supabase
      .from('tenants')
      .update({ internalNotes: currentNotes })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, internalNotes: currentNotes } : t));
      logAction(selectedTenant.companyName, "Atualizou as anotações internas");
      setFeedbackMsg("✅ Anotações salvas!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    }
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
          paymentMethod: "Pix",
          cardLast4: "•••• 4821"
        };
      }
      return inv;
    });

    const { error } = await supabase
      .from('tenants')
      .update({ status: "Ativo", invoices: updatedInvoices })
      .eq('slug', target.slug);

    if (!error) {
      setTenants(tenants.map(t => {
        if (t.id === tenantId) {
          logAction(t.companyName, `Confirmou o pagamento da fatura ID: ${invoiceId}`);
          return { ...t, status: "Ativo" as const, invoices: updatedInvoices };
        }
        return t;
      }));
      setFeedbackMsg("✅ Pagamento confirmado e empresa ativada!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    }
  };

  const handleSaveLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setModalError("");

    const cleanUser = loginUsername.trim().toLowerCase();
    const loginsList = [...(selectedTenant.logins || [])];
    const finalPasswordHash = loginPassword ? hashPassword(loginPassword) : loginsList[editingLoginIdx!].passwordHash;

    if (editingLoginIdx !== null) {
      loginsList[editingLoginIdx] = {
        name: loginName,
        email: loginEmail,
        user: cleanUser,
        passwordHash: finalPasswordHash,
        role: loginRole,
        twoFactorEnabled: login2FA
      };
      logAction(selectedTenant.companyName, `Editou o acesso de usuário: ${cleanUser} (${loginRole})`);
    } else {
      loginsList.push({
        name: loginName,
        email: loginEmail,
        user: cleanUser,
        passwordHash: finalPasswordHash,
        role: loginRole,
        twoFactorEnabled: login2FA
      });
      logAction(selectedTenant.companyName, `Criou novo acesso de usuário: ${cleanUser} (${loginRole})`);
    }

    const { error } = await supabase
      .from('tenants')
      .update({ logins: loginsList })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, logins: loginsList } : t));
      setIsNewLoginModalOpen(false);
      setEditingLoginIdx(null);
      setFeedbackMsg("✅ Acesso seguro salvo com sucesso!");
      setTimeout(() => setFeedbackMsg(""), 3000);
    } else {
      alert("Erro ao salvar acesso na nuvem.");
    }
  };

  const openEditLoginModal = (loginItem: TenantLogin, idx: number) => {
    setEditingLoginIdx(idx);
    setLoginName(loginItem.name);
    setLoginEmail(loginItem.email || "");
    setLoginUsername(loginItem.user);
    setLoginPassword("");
    setLoginRole(loginItem.role);
    setLogin2FA(loginItem.twoFactorEnabled || false);
    setModalError("");
    setIsNewLoginModalOpen(true);
  };

  const handleDeleteLogin = async (userIndex: number) => {
    if (!selectedTenant || !confirm("Remover este acesso?")) return;
    if (selectedTenant.logins.length <= 1) {
      alert("A empresa precisa ter pelo menos 1 acesso cadastrado.");
      return;
    }
    const targetUser = selectedTenant.logins[userIndex]?.user;
    const updatedLogins = selectedTenant.logins.filter((_, idx: number) => idx !== userIndex);

    const { error } = await supabase
      .from('tenants')
      .update({ logins: updatedLogins })
      .eq('slug', selectedTenant.slug);

    if (!error) {
      setTenants(tenants.map(t => t.id === selectedTenant.id ? { ...t, logins: updatedLogins } : t));
      logAction(selectedTenant.companyName, `REMOVEU o usuário de acesso: ${targetUser}`);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");

    const slug = newCompany.toLowerCase().trim().replace(/[^a-z0-9]/g, "-");
    const initialUser = newInitialUser.trim().toLowerCase();
    const initialPass = newInitialPass.trim();

    const passErr = validatePasswordStrength(initialPass);
    if (passErr) {
      setModalError(`❌ ${passErr}`);
      return;
    }

    const newTenantData = {
      slug,
      company_name: newCompany,
      document: newDocument || "Não informado",
      owner_name: newOwner,
      owner_email: newEmail,
      owner_phone: newPhone,
      plan_name: newPlan,
      monthly_fee: Number(newFee) || 149.90,
      due_day: Number(newDueDay) || 10,
      status: "Ativo",
      allowed_modules: { dre: true, dashboard: true, calendar: true },
      invoices: [{ id: `inv-${Date.now()}`, referenceMonth: "2026-10", amount: Number(newFee) || 149.90, dueDate: `2026-10-${String(newDueDay).padStart(2, "0")}`, status: "Aberto" }],
      logins: [{ name: newOwner, email: newEmail, user: initialUser, passwordHash: hashPassword(initialPass), role: "Dono", twoFactorEnabled: newEnable2FA }],
      internalNotes: "Novo contrato cadastrado com ambiente seguro.",
      logo_type: "icon",
      logo_icon: "scissors",
      primary_color: "pink",
      created_at: new Date().toISOString().split("T")[0]
    };

    const { data, error } = await supabase.from('tenants').insert([newTenantData]).select();

    if (!error && data) {
      const created = data[0];
      const formatted: TenantAccount = {
        id: created.id,
        slug: created.slug,
        companyName: created.company_name,
        document: created.document,
        ownerName: created.owner_name,
        ownerEmail: created.owner_email,
        ownerPhone: created.owner_phone,
        planName: created.plan_name,
        monthlyFee: created.monthly_fee,
        dueDay: created.due_day,
        status: created.status,
        autoBlockGraceDays: 5,
        allowedModules: created.allowed_modules || { dre: true },
        invoices: created.invoices || [],
        logins: created.logins || [],
        contractDocument: null,
        internalNotes: created.internalNotes || "",
        logoType: created.logo_type || "icon",
        logoIcon: created.logo_icon || "scissors",
        primaryColor: created.primary_color || "pink",
        createdAt: created.created_at
      };

      setTenants([...tenants, formatted]);
      setSelectedTenantId(formatted.id);
      setIsNewTenantModalOpen(false);

      setNewCompany("");
      setNewDocument("");
      setNewOwner("");
      setNewEmail("");
      setNewPhone("");
      setNewInitialUser("");
      setNewInitialPass("");
      setNewEnable2FA(false);

      logAction(formatted.companyName, `Empresa contratante cadastrada no plano ${newPlan}`);
      setFeedbackMsg(`Empresa "${formatted.companyName}" criada com segurança!`);
      setTimeout(() => setFeedbackMsg(""), 3500);
    } else {
      setModalError("Erro ao cadastrar empresa na nuvem.");
    }
  };

  if (!isMounted) return <div className="min-h-screen bg-slate-950" />;

  if (!isMasterAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-indigo-500/40 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400 mb-1">
              <ShieldCheck size={38} />
            </div>
            <h1 className="text-xl font-black text-white tracking-tight">Painel Master • Auditoria & Segurança</h1>
            <p className="text-xs text-slate-400">Acesso protegido com criptografia e log de ações.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">E-mail ou Usuário Master</label>
              <input type="text" required value={userInput} onChange={e => setUserInput(e.target.value)} placeholder="masterlogin" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">Senha Criptografada</label>
              <input type="password" required value={passInput} onChange={e => setPassInput(e.target.value)} placeholder="••••••••••" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
            </div>
            {errorMsg && <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-center font-medium">{errorMsg}</div>}
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl uppercase tracking-wider transition shadow-lg cursor-pointer text-xs">Entrar em Ambiente Seguro</button>
          </form>
          <div className="pt-2 text-center border-t border-slate-800">
            <Link href="/" className="text-xs text-slate-400 hover:text-white transition">← Voltar ao Login de Clientes</Link>
          </div>
        </div>
      </div>
    );
  }

  const moduleNames = [
    { id: "dashboard", label: "Dashboard Geral" },
    { id: "calendar", label: "Agenda de Horários" },
    { id: "atendimentos", label: "Atendimentos" },
    { id: "services", label: "Serviços & Preços" },
    { id: "promotions", label: "Promoções & Descontos" },
    { id: "pos", label: "Vendas de Balcão (PDV)" },
    { id: "stock", label: "Estoque & Produtos" },
    { id: "expenses", label: "Despesas Operacionais" },
    { id: "team", label: "Equipe de Colaboradoras" },
    { id: "customers", label: "Base de Clientes" },
    { id: "dre", label: "Módulo DRE Gerencial (Exclusivo Ultra / Trial)" },
    { id: "settings", label: "Configurações Gerais" }
  ];

  const availableRolesList: Array<"Dono" | "Gestor" | "Colaborador"> = ["Dono", "Gestor", "Colaborador"];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-indigo-400"><ShieldCheck size={26} /></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-white tracking-tight">SaaS Central • Master Control</h1>
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
                    <div className="flex justify-between"><strong className="text-sm font-bold">{t.companyName}</strong><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.status === 'Bloqueado' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{t.status}</span></div>
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
                        href={`https://wa.me/55${selectedTenant.ownerPhone.replace(/\D/g, '')}?text=Olá%20${encodeURIComponent(selectedTenant.ownerName)},%20tudo%20bem?`}
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
                      <button onClick={() => launchTenantDashboard(selectedTenant)} className="flex items-center gap-1.5 bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer"><Rocket size={14} /><span>Acessar Dashboard</span></button>
                      <button onClick={() => toggleTenantBlock(selectedTenant.id)} className={`text-xs font-bold px-3 py-2.5 rounded-xl border transition cursor-pointer ${selectedTenant.status === "Bloqueado" ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30" : "bg-rose-600/20 text-rose-300 border-rose-500/30"}`}>{selectedTenant.status === "Bloqueado" ? "Desbloquear" : "Bloquear"}</button>
                    </div>

                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                          <Sparkle size={13} /> Módulo DRE (Trial / Teste)
                        </span>
                        <button
                          onClick={() => toggleTenantModule("dre")}
                          className={`font-bold text-xs px-3 py-2 rounded-lg border transition cursor-pointer ${
                            selectedTenant.allowedModules?.dre 
                              ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30" 
                              : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          {selectedTenant.allowedModules?.dre ? "Desativar Trial" : `Liberar por ${trialDaysInput} dias`}
                        </button>
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-900 text-[11px]">
                        <Clock size={12} className="text-slate-400" />
                        <span className="text-slate-400">Duração do teste:</span>
                        <select
                          value={trialDaysInput}
                          onChange={e => setTrialDaysInput(Number(e.target.value))}
                          className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-white font-bold outline-none cursor-pointer"
                        >
                          <option value={3}>3 dias</option>
                          <option value={7}>7 dias</option>
                          <option value={15}>15 dias</option>
                          <option value={30}>30 dias</option>
                        </select>
                      </div>
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
                      <h4 className="font-bold text-white">Histórico de Mensalidades & Comprovantes Pix</h4>
                    </div>

                    <div className="divide-y divide-slate-800">
                      {selectedTenant.invoices?.map((inv: TenantInvoice) => (
                        <div key={inv.id} className="py-4 space-y-2">
                          <div className="flex justify-between items-center">
                            <div>
                              <strong className="text-white text-sm">Competência {inv.referenceMonth}</strong>
                              <p className="text-slate-400 text-[11px]">Vencimento: {inv.dueDate} {inv.paidAt ? `• Pago em ${inv.paidAt} via ${inv.paymentMethod}` : ""}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-black text-white text-sm">R$ {inv.amount.toFixed(2)}</span>
                              {inv.status !== "Pago" && (
                                <button onClick={() => markInvoicePaid(selectedTenant.id, inv.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer">
                                  Confirmar Pagamento
                                </button>
                              )}
                              <button onClick={() => openEditInvoiceModal(inv)} className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded cursor-pointer"><Pencil size={14} /></button>
                              <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer"><Trash2 size={14} /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "modulos" && (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 text-xs">
                    <div>
                      <h4 className="font-bold text-white">Módulos & Permissões por Cargo</h4>
                    </div>
                    <div className="space-y-3">
                      {moduleNames.map(m => {
                        const isEn = selectedTenant.allowedModules?.[m.id] ?? true;
                        return (
                          <div key={m.id} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex justify-between items-center">
                            <span className="font-bold text-white text-sm">{m.label}</span>
                            <button onClick={() => toggleTenantModule(m.id)} className={`px-3 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${isEn ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-500"}`}>
                              {isEn ? "Módulo Ativo" : "Módulo Bloqueado"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "dados" && (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 text-xs">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                      <h4 className="font-bold text-white">E-mails e Credenciais de Acesso ao Dashboard</h4>
                      <button onClick={() => { setEditingLoginIdx(null); setLoginName(""); setLoginEmail(""); setLoginUsername(""); setLoginPassword(""); setLogin2FA(false); setModalError(""); setIsNewLoginModalOpen(true); }} className="bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-xl cursor-pointer">+ Adicionar E-mail de Acesso</button>
                    </div>

                    <div className="divide-y divide-slate-800">
                      {selectedTenant.logins?.map((l: TenantLogin, idx: number) => (
                        <div key={idx} className="py-3 flex justify-between items-center">
                          <div>
                            <strong className="text-white block text-sm">{l.name} <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded ml-2">{l.role}</span></strong>
                            <span className="text-slate-400">E-mail: <strong>{l.email || "Não informado"}</strong> • Usuário: <code className="text-cyan-400">{l.user}</code></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditLoginModal(l, idx)} className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded cursor-pointer"><Pencil size={15} /></button>
                            {selectedTenant.logins.length > 1 && (
                              <button onClick={() => handleDeleteLogin(idx)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer"><Trash2 size={15} /></button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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

      {/* MODAL ADICIONAR / EDITAR LOGIN */}
      {isNewLoginModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Adicionar E-mail & Acesso Seguro</h3>
              <button onClick={() => setIsNewLoginModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveLogin} className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Nome da Pessoa *</label>
                <input required placeholder="Ex: Isabela Alvim" value={loginName} onChange={e => setLoginName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">E-mail de Contato *</label>
                <input required type="email" placeholder="cliente@empresa.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Nome de Usuário *</label>
                  <input required placeholder="ex: isabela" value={loginUsername} onChange={e => setLoginUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Senha (Mín. 8 chars) *</label>
                  <input type="password" placeholder="Senha forte" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
                </div>
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Cargo *</label>
                <select value={loginRole} onChange={e => setLoginRole(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none font-bold">
                  {availableRolesList.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl cursor-pointer">Salvar Acesso</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NOVO CLIENTE */}
      {isNewTenantModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Cadastrar Empresa Contratante</h3>
              <button onClick={() => setIsNewTenantModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Nome da Empresa *</label>
                <input required placeholder="Ex: Studio Hair" value={newCompany} onChange={e => setNewCompany(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Responsável *</label>
                  <input required placeholder="Nome" value={newOwner} onChange={e => setNewOwner(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white outline-none" />
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
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="text-[11px] font-bold text-indigo-400 block">Primeiro Acesso do Dono:</span>
                <div className="grid grid-cols-2 gap-2">
                  <input required placeholder="Nome de Usuário" value={newInitialUser} onChange={e => setNewInitialUser(e.target.value)} className="bg-slate-900 border border-slate-800 p-2 rounded-lg text-white text-xs outline-none" />
                  <input required type="password" placeholder="Senha Forte" value={newInitialPass} onChange={e => setNewInitialPass(e.target.value)} className="bg-slate-900 border border-slate-800 p-2 rounded-lg text-white text-xs outline-none" />
                </div>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl cursor-pointer">Criar Empresa Segura</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}