"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Scissors,
  Plus,
  Pencil,
  Trash2,
  Calendar as CalendarIcon,
  CheckCircle2,
  Boxes,
  TrendingDown,
  ShoppingBag,
  LayoutDashboard,
  Settings as SettingsIcon,
  CalendarDays,
  Tag,
  Receipt,
  LogOut,
  ChevronRight,
  AlertOctagon,
  RefreshCw,
  AlertTriangle,
  Clock,
  Users as UsersIcon,
  Briefcase,
  CheckSquare,
  Square,
  Award,
  CreditCard,
  PackageCheck,
  Sparkles,
  Flower2,
  Building2,
  Palette,
  Download,
  Moon,
  Sun,
  ShieldCheck,
  FileText,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  PieChart,
  Lock,
  Zap,
  Target,
  SlidersHorizontal,
  Check,
  BarChart3,
  Percent,
  DollarSign,
  ArrowLeft
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getTenantFromCloud, getAllTenantDataCloud, saveAllTenantDataCloud } from '@/lib/dbService';

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

export interface EmployeeSchedule {
  dayIndex: number;
  dayName: string;
  isWorking: boolean;
  openTime: string;
  closeTime: string;
}

const DEFAULT_EMPLOYEE_SCHEDULE: EmployeeSchedule[] = [
  { dayIndex: 0, dayName: "Domingo", isWorking: false, openTime: "09:00", closeTime: "14:00" },
  { dayIndex: 1, dayName: "Segunda-feira", isWorking: false, openTime: "09:00", closeTime: "18:00" },
  { dayIndex: 2, dayName: "Terça-feira", isWorking: true, openTime: "09:00", closeTime: "19:00" },
  { dayIndex: 3, dayName: "Quarta-feira", isWorking: true, openTime: "09:00", closeTime: "19:00" },
  { dayIndex: 4, dayName: "Quinta-feira", isWorking: true, openTime: "09:00", closeTime: "20:00" },
  { dayIndex: 5, dayName: "Sexta-feira", isWorking: true, openTime: "09:00", closeTime: "20:00" },
  { dayIndex: 6, dayName: "Sábado", isWorking: true, openTime: "08:30", closeTime: "18:00" }
];

export interface Promotion {
  id: string;
  title: string;
  targetItems: string[];
  duration: string;
  discountPercent: number;
  isAllPromo: boolean;
  active: boolean;
}

export interface SaleItem {
  id: string;
  date: string;
  clientName: string;
  productName: string;
  sellerName?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  paymentMethod: string;
  status: string;
  notes?: string;
}

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [isTenantBlocked, setIsTenantBlocked] = useState(false);
  const [currentCompany, setCurrentCompany] = useState<any>(null);
  const [isMasterBypassActive, setIsMasterBypassActive] = useState(false);
  
  const [activeUserName, setActiveUserName] = useState<string>("Gestor");
  const [activeUserRole, setActiveUserRole] = useState<string>("Gestor");
  const [activeUserEmail, setActiveUserEmail] = useState<string>("");

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  const [darkMode, setDarkMode] = useState(false);

  const bgClass = darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-100 text-slate-800";
  const cardBgClass = darkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-200 text-slate-800";
  const headerBgClass = darkMode ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-800";

  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [rolesList, setRolesList] = useState<string[]>(["Cabeleireiro", "Manicure", "Barbeiro", "Esteticista"]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stockMoves, setStockMoves] = useState<any[]>([]);
  const [sales, setSales] = useState<SaleItem[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);

  const [dreViewMode, setDreViewMode] = useState<"values" | "percent" | "chart">("values");

  const [goals, setGoals] = useState({
    daily: 500,
    weekly: 3000,
    monthly: 12000
  });
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [tempDailyGoal, setTempDailyGoal] = useState(500);
  const [tempWeeklyGoal, setTempWeeklyGoal] = useState(3000);
  const [tempMonthlyGoal, setTempMonthlyGoal] = useState(12000);

  const [visibleWidgets, setVisibleWidgets] = useState({
    goalsBlock: true,
    quickStats: true,
    teamProductivity: true,
    stockAlerts: true
  });
  const [isWidgetCustomizerOpen, setIsWidgetCustomizerOpen] = useState(false);

  const [salonConfig, setSalonConfig] = useState({
    name: "Painel Operacional",
    analysisMonth: "2026-10"
  });

  const [isConsultancyModalOpen, setIsConsultancyModalOpen] = useState(false);
  const [consultancyDate, setConsultancyDate] = useState(new Date().toISOString().split("T")[0]);
  const [consultancyTime, setConsultancyTime] = useState("14:00");
  const [consultancyAgendaNotes, setConsultancyAgendaNotes] = useState("");
  const [isInvoiceHistoryOpen, setIsInvoiceHistoryOpen] = useState(false);
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false);

  const [selectedPlanToUpgrade, setSelectedPlanToUpgrade] = useState<any | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  const recordSystemLog = (actionDesc: string) => {
    if (!currentCompany) return;
    try {
      const savedLogs = localStorage.getItem("saas_system_audit_logs") || "[]";
      const logsList = JSON.parse(savedLogs);
      const newLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleString("pt-BR"),
        companyName: currentCompany.company_name || currentCompany.companyName,
        action: actionDesc,
        author: `${activeUserName} (${activeUserRole})`
      };
      localStorage.setItem("saas_system_audit_logs", JSON.stringify([newLog, ...logsList]));
    } catch (e) {}
  };

  useEffect(() => {
    setIsMounted(true);
    const initializeApp = async () => {
      const params = new URLSearchParams(window.location.search);
      const slugParam = params.get("c") || localStorage.getItem("saas_active_tenant") || "studio-hair";
      const masterBypassParam = params.get("master_bypass");
      const storedBypass = localStorage.getItem("master_bypass_auth");
      const bypassLoginName = localStorage.getItem("master_bypass_login_name");
      const bypassLoginRole = localStorage.getItem("master_bypass_login_role");

      const { data: savedTenants, error } = await supabase.from('tenants').select('*');
      
      let found = null;
      if (!error && savedTenants && savedTenants.length > 0) {
        found = savedTenants.find((t: any) => t.slug === slugParam) || savedTenants[0];
      }

      if (!found) {
        found = {
          slug: "studio-hair",
          company_name: "Studio Hair & Beauty",
          status: "Ativo",
          planName: "Pro",
          owner_name: "Gisele Alvim",
          owner_email: "gisele@gmail.com",
          logins: [
            { user: "gisele", email: "gisele@gmail.com", passwordHash: hashPassword("123456"), role: "Gestor", name: "Gisele Alvim" }
          ]
        };
      }

      if (found) {
        setCurrentCompany(found);
        setSalonConfig(prev => ({ ...prev, name: found.company_name || found.companyName || "Studio Hair & Beauty" }));
        setIsTenantBlocked(found.status === "Bloqueado");
        loadTenantData(found.slug);

        if (masterBypassParam && masterBypassParam === storedBypass) {
          setIsMasterBypassActive(true);
          setActiveUserName(bypassLoginName || found.owner_name || found.ownerName || "Gisele Alvim");
          setActiveUserRole(bypassLoginRole || "Dono");
          setActiveUserEmail(found.owner_email || found.ownerEmail || "gisele@gmail.com");
          setIsLogged(true);
          setActiveTab("dashboard");
          recordSystemLog("Acesso Master Support Mode Ativado");
        }
      }
    };
    initializeApp();

    const savedGoals = localStorage.getItem("saas_dashboard_goals");
    if (savedGoals) {
      try {
        const parsedG = JSON.parse(savedGoals);
        setGoals(parsedG);
        setTempDailyGoal(parsedG.daily);
        setTempWeeklyGoal(parsedG.weekly);
        setTempMonthlyGoal(parsedG.monthly);
      } catch (e) {}
    }

    const savedWidgets = localStorage.getItem("saas_dashboard_widgets");
    if (savedWidgets) {
      try {
        setVisibleWidgets(JSON.parse(savedWidgets));
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (!currentCompany?.slug) return;
    const interval = setInterval(async () => {
      const { data: savedTenants } = await supabase.from('tenants').select('*');
      if (savedTenants && Array.isArray(savedTenants)) {
        try {
          const freshFound = savedTenants.find((t: any) => t.slug === currentCompany.slug);
          if (freshFound) {
            setCurrentCompany(freshFound);
          }
        } catch (e) {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [currentCompany?.slug]);

  useEffect(() => {
    if (isLogged && activeTab) {
      recordSystemLog(`Acessou a aba / menu: ${activeTab}`);
    }
  }, [activeTab, isLogged]);

  useEffect(() => {
    if (isLogged && activeUserEmail && currentCompany) {
      const userPrefsKey = `saas_prefs_${currentCompany.slug}_${activeUserEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const savedPrefs = localStorage.getItem(userPrefsKey);
      if (savedPrefs) {
        try {
          const parsed = JSON.parse(savedPrefs);
          if (typeof parsed.darkMode === "boolean") setDarkMode(parsed.darkMode);
          if (parsed.primaryColor) {
            setCurrentCompany((prev: any) => ({ ...prev, primaryColor: parsed.primaryColor }));
          }
        } catch (e) {}
      }
    }
  }, [isLogged, activeUserEmail, currentCompany?.slug]);

  const saveUserPreferences = (newDark: boolean, newColor: string) => {
    if (!currentCompany || !activeUserEmail) return;
    const userPrefsKey = `saas_prefs_${currentCompany.slug}_${activeUserEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
    localStorage.setItem(userPrefsKey, JSON.stringify({ darkMode: newDark, primaryColor: newColor }));
  };

  // CARREGAMENTO ULTRA-RÁPIDO UNIFICADO (1 ÚNICA REQUISIÇÃO HTTP)
  const loadTenantData = async (slug: string) => {
    const cachedData = localStorage.getItem(`saas_cache_${slug}`);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        if (parsed.employees) setEmployees(parsed.employees);
        if (parsed.customers) setCustomers(parsed.customers);
        if (parsed.services) setServices(parsed.services);
        if (parsed.rolesList) setRolesList(parsed.rolesList);
        if (parsed.promotions) setPromotions(parsed.promotions);
        if (parsed.products) setProducts(parsed.products);
        if (parsed.stockMoves) setStockMoves(parsed.stockMoves);
        if (parsed.sales) setSales(parsed.sales);
        if (parsed.expenses) setExpenses(parsed.expenses);
        if (parsed.appointments) setAppointments(parsed.appointments);
        if (parsed.attendances) setAttendances(parsed.attendances);
      } catch (e) {}
    }

    try {
      const cloudData = await getAllTenantDataCloud(slug);
      if (cloudData) {
        if (cloudData.employees) setEmployees(cloudData.employees);
        if (cloudData.customers) setCustomers(cloudData.customers);
        if (cloudData.services) setServices(cloudData.services);
        if (cloudData.rolesList) setRolesList(cloudData.rolesList);
        if (cloudData.promotions) setPromotions(cloudData.promotions);
        if (cloudData.products) setProducts(cloudData.products);
        if (cloudData.stockMoves) setStockMoves(cloudData.stockMoves);
        if (cloudData.sales) setSales(cloudData.sales);
        if (cloudData.expenses) setExpenses(cloudData.expenses);
        if (cloudData.appointments) setAppointments(cloudData.appointments);
        if (cloudData.attendances) setAttendances(cloudData.attendances);

        localStorage.setItem(`saas_cache_${slug}`, JSON.stringify(cloudData));
      }
    } catch (e) {
      console.error("Erro ao sincronizar dados unificados da nuvem:", e);
    }
  };

  // SALVAMENTO GLOBAL UNIFICADO
  const saveTenantData = async (key: string, data: any) => {
    if (!currentCompany) return;
    
    const currentPayload = {
      employees,
      customers,
      services,
      rolesList,
      promotions,
      products,
      stockMoves,
      sales,
      expenses,
      appointments,
      attendances,
      [key]: data
    };

    await saveAllTenantDataCloud(currentCompany.slug, currentPayload);
    localStorage.setItem(`saas_cache_${currentCompany.slug}`, JSON.stringify(currentPayload));
  };

  const updateCompanyInMasterDb = async (updatedFields: any) => {
    const updatedCompany = { ...currentCompany, ...updatedFields };
    setCurrentCompany(updatedCompany);
    if (updatedFields.companyName || updatedFields.company_name) {
      setSalonConfig(prev => ({ ...prev, name: updatedFields.companyName || updatedFields.company_name }));
    }
    const { error } = await supabase
      .from('tenants')
      .update(updatedFields)
      .eq('slug', currentCompany.slug);
    if (error) {
      console.error("Erro ao atualizar tenant na nuvem:", error);
    }
  };

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");

    try {
      const { data: savedTenants, error } = await supabase.from('tenants').select('*');
      
      const tenantsList = (!error && savedTenants && savedTenants.length > 0) ? savedTenants : [currentCompany];

      let authCompany = null;
      let matchedRole = "Gestor";
      let matchedName = "Usuário";
      let matchedEmail = "";

      const cleanInput = loginUser.trim().toLowerCase();
      const cleanPass = loginPass.trim();
      const securePassHash = hashPassword(cleanPass);

      for (const tenant of tenantsList) {
        if (!tenant) continue;
        const tenantLogins = tenant.logins || [];
        const match = tenantLogins.find(
          (l: any) =>
            (l.user.toLowerCase() === cleanInput || (l.email && l.email.toLowerCase() === cleanInput)) &&
            (l.passwordHash === cleanPass || l.passwordHash === securePassHash)
        );
        if (match) {
          authCompany = tenant;
          matchedRole = match.role || "Gestor";
          matchedName = match.name || tenant.owner_name || tenant.ownerName || "Usuário";
          matchedEmail = match.email || match.user || cleanInput;
          break;
        }
      }

      if (authCompany) {
        if (authCompany.status === "Bloqueado") {
          setIsTenantBlocked(true);
          return;
        }

        if (rememberCredentials) {
          localStorage.setItem("machine_remember_creds", "true");
          localStorage.setItem("machine_saved_user", loginUser.trim());
          localStorage.setItem("machine_saved_pass", loginPass.trim());
        } else {
          localStorage.removeItem("machine_remember_creds");
          localStorage.removeItem("machine_saved_user");
          localStorage.removeItem("machine_saved_pass");
        }

        setCurrentCompany(authCompany);
        setActiveUserName(matchedName);
        setActiveUserRole(matchedRole);
        setActiveUserEmail(matchedEmail);
        setSalonConfig(prev => ({ ...prev, name: authCompany.company_name || authCompany.companyName }));
        await loadTenantData(authCompany.slug);
        setIsLogged(true);

        recordSystemLog(`Login efetuado com sucesso (${matchedRole})`);

        const rNorm = matchedRole.toLowerCase();
        if (rNorm.includes("colaborador")) {
          setActiveTab("calendar");
        } else {
          setActiveTab("dashboard");
        }

      } else {
        setLoginError("Usuário, e-mail ou senha incorretos.");
      }
    } catch (err) {
      console.error(err);
      setLoginError("Erro na autenticação com a nuvem.");
    }
  };

  const handleLogout = () => {
    recordSystemLog("Logout do sistema realizado");
    localStorage.removeItem("saas_active_tenant");
    localStorage.removeItem("master_bypass_auth");
    localStorage.removeItem("master_bypass_slug");
    localStorage.removeItem("master_bypass_login_name");
    localStorage.removeItem("master_bypass_login_role");
    setIsLogged(false);
    if (isMasterBypassActive) {
      window.location.href = "/master";
    } else {
      window.location.href = "/";
    }
  };

  const stockSummary = useMemo(() => {
    return products.map(prod => {
      const entries = stockMoves.filter(m => m.productName === prod.name && m.type === "Entrada").reduce((a, b) => a + b.quantity, 0);
      const losses = stockMoves.filter(m => m.productName === prod.name && m.type === "Perda").reduce((a, b) => a + b.quantity, 0);
      const completedSales = sales.filter(s => s.productName === prod.name && s.status === "Concluída").reduce((a, b) => a + b.quantity, 0);
      const currentStock = Number(prod.initialStock || 0) + entries - losses - completedSales;
      const minStockLimit = Number(prod.minStock) || 5;
      return {
        ...prod,
        currentStock,
        minStockLimit,
        needsRestock: currentStock <= minStockLimit
      };
    });
  }, [products, stockMoves, sales]);

  const availableStockForSale = useMemo(() => {
    return products;
  }, [products]);

  const roleNorm = activeUserRole.toLowerCase();
  const isManager = roleNorm.includes("dono") || roleNorm.includes("gestor") || roleNorm.includes("gerente") || roleNorm.includes("administrador");

  const hasDREAccess = useMemo(() => {
    const pName = (currentCompany?.planName || currentCompany?.plan_name || "").toLowerCase();
    const isUltra = pName.includes("ultra");
    const moduleAllowed = currentCompany?.allowedModules?.dre === true;
    return isUltra || moduleAllowed;
  }, [currentCompany?.planName, currentCompany?.plan_name, currentCompany?.allowedModules]);

  const filteredSales = useMemo(() => {
    if (isManager) return sales;
    return sales.filter(s => s.sellerName?.toLowerCase() === activeUserName.toLowerCase() || s.sellerName === activeUserName);
  }, [sales, isManager, activeUserName]);

  const filteredAppointments = useMemo(() => {
    if (isManager || activeUserRole.toLowerCase().includes("recepção") || activeUserRole.toLowerCase().includes("caixa")) {
      return appointments;
    }
    return appointments.filter(a => a.professionalName?.toLowerCase() === activeUserName.toLowerCase());
  }, [appointments, isManager, activeUserRole, activeUserName]);

  const filteredAttendances = useMemo(() => {
    if (isManager || activeUserRole.toLowerCase().includes("recepção") || activeUserRole.toLowerCase().includes("caixa")) {
      return attendances;
    }
    return attendances.filter(a => a.professionalName?.toLowerCase() === activeUserName.toLowerCase());
  }, [attendances, isManager, activeUserRole, activeUserName]);

  const operationalDashboardMetrics = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const todayAppointments = appointments.filter(a => a.date === todayStr);
    const todayAttendances = attendances.filter(a => a.date === todayStr && a.status === "Atendido");
    const todaySales = sales.filter(s => s.date === todayStr && s.status === "Concluída");

    const totalTodayRevenue = todayAttendances.reduce((acc, a) => acc + (Number(a.netValue) || 0), 0) +
                              todaySales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);

    const month = salonConfig.analysisMonth;
    const monthlyAttendances = attendances.filter(a => a.date?.startsWith(month) && a.status === "Atendido");
    const monthlySales = sales.filter(s => s.date?.startsWith(month) && s.status === "Concluída");
    const totalMonthRevenue = monthlyAttendances.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0) +
                              monthlySales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weeklyAttendances = attendances.filter(a => new Date(a.date) >= weekAgo && a.status === "Atendido");
    const weeklySales = sales.filter(s => new Date(s.date) >= weekAgo && s.status === "Concluída");
    const totalWeeklyRevenue = weeklyAttendances.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0) +
                               weeklySales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    const lowStockItems = stockSummary.filter(p => p.needsRestock);

    const teamPerformance = employees.map(emp => {
      const count = todayAttendances.filter(a => a.professionalName?.toLowerCase() === emp.name.toLowerCase()).length;
      return { name: emp.name, count, role: emp.systemRole || emp.role || "Profissional" };
    }).sort((a, b) => b.count - a.count);

    return {
      todayCount: todayAppointments.length + todayAttendances.length,
      doneCount: todayAttendances.length,
      totalTodayRevenue,
      totalWeeklyRevenue,
      totalMonthRevenue,
      lowStockItems,
      teamPerformance
    };
  }, [appointments, attendances, sales, stockSummary, employees, salonConfig.analysisMonth]);

  const dreAdvancedMetrics = useMemo(() => {
    const month = salonConfig.analysisMonth;
    const monthlyAttendances = attendances.filter(a => a.date?.startsWith(month) && a.status === "Atendido");
    const serviceRevenue = monthlyAttendances.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0);

    const monthlySales = sales.filter(s => s.date?.startsWith(month) && s.status === "Concluída");
    const productRevenue = monthlySales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    const grossRevenue = serviceRevenue + productRevenue;
    const totalClientsServed = monthlyAttendances.length;
    const ticketMedio = totalClientsServed > 0 ? serviceRevenue / totalClientsServed : 0;

    const monthlyExpenses = expenses.filter(e => e.date?.startsWith(month) && e.status === "Pago");
    const paidExpenses = monthlyExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const estimatedNetResult = grossRevenue - paidExpenses;
    const netMarginPercent = grossRevenue > 0 ? (estimatedNetResult / grossRevenue) * 100 : 0;

    const servicesRanking = Object.entries(
      monthlyAttendances.reduce((acc: any, a) => {
        const sName = a.serviceName || "Serviço Geral";
        if (!acc[sName]) acc[sName] = { qty: 0, total: 0 };
        acc[sName].qty += 1;
        acc[sName].total += Number(a.netValue) || 0;
        return acc;
      }, {})
    ).map(([name, data]: any) => ({ name, ...data })).sort((a: any, b: any) => b.total - a.total);

    const productsRanking = Object.entries(
      monthlySales.reduce((acc: any, s) => {
        const pName = s.productName || "Produto Geral";
        if (!acc[pName]) acc[pName] = { qty: 0, total: 0 };
        acc[pName].qty += Number(s.quantity) || 1;
        acc[pName].total += Number(s.total) || 0;
        return acc;
      }, {})
    ).map(([name, data]: any) => ({ name, ...data })).sort((a: any, b: any) => b.total - a.total);

    return {
      serviceRevenue,
      productRevenue,
      grossRevenue,
      paidExpenses,
      estimatedNetResult,
      netMarginPercent,
      totalClientsServed,
      ticketMedio,
      servicesRanking,
      productsRanking
    };
  }, [salonConfig.analysisMonth, attendances, sales, expenses]);

  const exportDashboardCSV = () => {
    recordSystemLog("Exportou relatório executivo DRE em CSV");
    const csvContent = [
      ["RELATORIO EXECUTIVO DRE GERENCIAL E CURVA ABC - " + salonConfig.name],
      ["Mes de Competencia", salonConfig.analysisMonth],
      ["Receita Bruta de Servicos", dreAdvancedMetrics.serviceRevenue.toFixed(2)],
      ["Receita Bruta de Produtos", dreAdvancedMetrics.productRevenue.toFixed(2)],
      ["Receita Bruta Total", dreAdvancedMetrics.grossRevenue.toFixed(2)],
      ["Total de Despesas Operacionais", dreAdvancedMetrics.paidExpenses.toFixed(2)],
      ["Lucro Liquido Real", dreAdvancedMetrics.estimatedNetResult.toFixed(2)],
      ["Margem Liquida (%)", dreAdvancedMetrics.netMarginPercent.toFixed(2) + "%"],
      ["Ticket Medio por Cliente", dreAdvancedMetrics.ticketMedio.toFixed(2)],
      ["Total de Clientes Atendidos", dreAdvancedMetrics.totalClientsServed]
    ].map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `dre_avancado_${salonConfig.analysisMonth}_${currentCompany?.slug || 'empresa'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getThemeClasses = (colorName = "pink") => {
    switch (colorName) {
      case "indigo": return { activeBg: "bg-indigo-600", activeText: "text-indigo-600", buttonBg: "bg-indigo-600 hover:bg-indigo-700" };
      case "emerald": return { activeBg: "bg-emerald-600", activeText: "text-emerald-600", buttonBg: "bg-emerald-600 hover:bg-emerald-700" };
      case "purple": return { activeBg: "bg-purple-600", activeText: "text-purple-600", buttonBg: "bg-purple-600 hover:bg-purple-700" };
      case "amber": return { activeBg: "bg-amber-600", activeText: "text-amber-600", buttonBg: "bg-amber-600 hover:bg-amber-700" };
      case "rose": return { activeBg: "bg-rose-600", activeText: "text-rose-600", buttonBg: "bg-rose-600 hover:bg-rose-700" };
      case "pink":
      default: return { activeBg: "bg-pink-600", activeText: "text-pink-600", buttonBg: "bg-pink-600 hover:bg-pink-700" };
    }
  };

  const theme = getThemeClasses(currentCompany?.primary_color || currentCompany?.primaryColor || "pink");

  const renderCompanyLogo = (sizeClass = "w-6 h-6", iconSize = 22) => {
    const lType = currentCompany?.logo_type || currentCompany?.logoType;
    const lUrl = currentCompany?.logo_url || currentCompany?.logoUrl;
    if (lType === "image" && lUrl) {
      return <img src={lUrl} alt="Logo" className={`${sizeClass} object-contain rounded`} />;
    }
    const iconType = currentCompany?.logo_icon || currentCompany?.logoIcon || "scissors";
    return (
      <div className={theme.activeText}>
        {iconType === "scissors" && <Scissors size={iconSize} />}
        {iconType === "barber" && <Sparkles size={iconSize} />}
        {iconType === "spa" && <Flower2 size={iconSize} />}
        {iconType === "nails" && <Sparkles size={iconSize} />}
        {iconType === "store" && <ShoppingBag size={iconSize} />}
        {iconType === "building" && <Building2 size={iconSize} />}
      </div>
    );
  };

  const [modalType, setModalType] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("Cabelos");
  const [formDuration, setFormDuration] = useState(30);
  const [formPrice, setFormPrice] = useState(50);
  const [formCost, setFormCost] = useState(15);
  const [formMinStock, setFormMinStock] = useState(5);
  const [formPhone, setFormPhone] = useState("");
  const [formAmount, setFormAmount] = useState(100);
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formTime, setTempTime] = useState("10:00");
  const [formClientName, setFormClientName] = useState("");
  const [formServiceName, setFormServiceName] = useState("");
  const [formProfessionalName, setFormProfessionalName] = useState("");
  const [formGrossValue, setFormGrossValue] = useState(50);
  const [formPaymentMethod, setFormPaymentMethod] = useState("Pix");
  const [formNotes, setFormNotes] = useState("");

  const [serviceAssignedRole, setServiceAssignedRole] = useState("Cabeleireiro");

  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  const [promoTargetItems, setPromoTargetItems] = useState<string[]>([]);
  const [promoDuration, setPromoDuration] = useState("7 dias");
  const [promoDiscount, setPromoDiscount] = useState(15);
  const [promoIsAll, setPromoIsAll] = useState(false);

  const [expenseCategory, setExpenseCategory] = useState("Operacional");
  const [expenseIsRecurrent, setExpenseIsRecurrent] = useState(false);

  const [empRoles, setEmpRoles] = useState<string[]>([]);
  const [empEmail, setEmpEmail] = useState("");
  const [empPass, setEmpPass] = useState("");
  const [empSystemRole, setEmpSystemRole] = useState<"Gestor" | "Colaborador">("Colaborador");

  const [saleProductName, setSaleProductName] = useState("");
  const [saleClientName, setSaleClientName] = useState("");
  const [saleQuantity, setSaleQuantity] = useState(1);
  const [saleUnitPrice, setSaleUnitPrice] = useState(0);
  const [salePaymentMethod, setSalePaymentMethod] = useState("Pix");

  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [apptDate, setApptDate] = useState(new Date().toISOString().split("T")[0]);
  const [apptHour, setApptHour] = useState("10");
  const [apptMinute, setApptMinute] = useState("00");
  const apptTime = `${apptHour}:${apptMinute}`;

  const [apptClientName, setApptClientName] = useState("");
  const [apptServiceName, setApptServiceName] = useState("");
  const [apptProfessionalName, setApptProfessionalName] = useState("");
  const [apptNotes, setApptNotes] = useState("");

  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [selectedAppointmentToFinalize, setSelectedAppointmentToFinalize] = useState<any | null>(null);
  const [finalizePaymentMethod, setFinalizePaymentMethod] = useState("Pix");
  const [finalizeNotes, setFinalizeNotes] = useState("");

  const [selectedEmpForSchedule, setSelectedEmpForSchedule] = useState<any | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const loggedEmployeeObject = useMemo(() => {
    if (isManager) return null;
    return employees.find(e => e.name.toLowerCase() === activeUserName.toLowerCase()) || null;
  }, [isManager, employees, activeUserName]);

  if (!isMounted) return <div className="min-h-screen bg-slate-950" />;

  if (isTenantBlocked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-lg bg-slate-900 border border-rose-500/40 rounded-3xl p-8 shadow-2xl text-center space-y-5">
          <div className="inline-flex p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 mb-2"><AlertOctagon size={48} /></div>
          <h1 className="text-2xl font-black text-white">Acesso Temporariamente Suspenso</h1>
          <p className="text-xs text-slate-400">O acesso a esta empresa encontra-se temporariamente suspenso por pendências no contrato.</p>
          <div className="pt-4 border-t border-slate-800 flex justify-end text-xs">
            <button onClick={() => window.location.reload()} className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"><RefreshCw size={13} /><span>Verificar</span></button>
          </div>
        </div>
      </div>
    );
  }

  if (!isLogged) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400 mb-1">
              <Building2 size={32} />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">Portal do Cliente</h1>
            <p className="text-xs text-slate-400">Informe suas credenciais para acessar o painel.</p>
          </div>

          <form onSubmit={handleClientLogin} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">E-mail ou Usuário</label>
              <input type="text" required value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Seu e-mail ou usuário de acesso" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition" />
            </div>
            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">Senha</label>
              <input type="password" required value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="••••••••" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition" />
            </div>
            <div className="pt-1">
              <label onClick={() => setRememberCredentials(!rememberCredentials)} className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-white transition">
                {rememberCredentials ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} className="text-slate-600" />}
                <span>Salvar dados para entrar nos próximos acessos</span>
              </label>
            </div>
            {loginError && <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-center font-medium">{loginError}</div>}
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl uppercase tracking-wider transition shadow-lg cursor-pointer text-xs">Entrar no Painel</button>
          </form>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-medium">Ambiente Seguro Corporativo</span>
          </div>
        </div>
      </div>
    );
  }

  const allTabs = [
    ...(isManager ? [{ id: "dashboard", label: "Dashboard Geral", icon: <LayoutDashboard size={17} /> }] : []),
    { id: "calendar", label: "Agenda de Horários", icon: <CalendarIcon size={17} /> },
    { id: "atendimentos", label: "Atendimentos", icon: <CheckCircle2 size={17} /> },
    ...(isManager ? [{ id: "services", label: "Serviços & Preços", icon: <Scissors size={17} /> }] : []),
    ...(isManager ? [{ id: "promotions", label: "Promoções & Descontos", icon: <Tag size={17} /> }] : []),
    { id: "pos", label: "Vendas", icon: <ShoppingBag size={17} /> },
    { id: "stock", label: "Estoque & Alertas", icon: <Boxes size={17} /> },
    ...(isManager ? [{ id: "expenses", label: "Despesas Operacionais", icon: <TrendingDown size={17} /> }] : []),
    ...(isManager ? [{ id: "team", label: "Equipe de Colaboradores", icon: <Briefcase size={17} /> }] : []),
    { id: "customers", label: "Base de Clientes", icon: <UsersIcon size={17} /> },
    { id: "my_schedule", label: "Meu Banco de Horas & Funções", icon: <Clock size={17} /> },
    { id: "dre", label: "Módulo DRE Gerencial", icon: <PieChart size={17} /> },
    { id: "my_plan", label: "Meu Plano & Consultorias", icon: <Award size={17} /> },
    { id: "settings", label: "Configurações", icon: <SettingsIcon size={17} /> }
  ];

  const visibleTabs = allTabs.filter(tab => {
    if (tab.id === "my_schedule") return !isManager;
    if (tab.id === "my_plan") return isManager;
    if (tab.id === "dre") return isManager;
    const roleNormalized = activeUserRole.toLowerCase();
    if (roleNormalized.includes("gestor") || roleNormalized.includes("gerente") || roleNormalized.includes("dono")) return true;
    if (roleNormalized.includes("colaborador")) {
      return ["calendar", "settings", "my_schedule"].includes(tab.id);
    }
    if (!currentCompany?.allowedModules) return true;
    return currentCompany.allowedModules[tab.id] !== false;
  });

  return (
    <div className={`flex h-screen font-sans ${bgClass}`}>
      <aside className="w-64 bg-slate-900 text-white flex flex-col justify-between p-4 shadow-xl">
        <div>
          {isMasterBypassActive && (
            <div className="mb-4 p-2.5 bg-amber-500/20 border border-amber-500/40 rounded-xl space-y-1.5 text-center">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 block">Modo Suporte Master</span>
              <a href="/master" className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white font-bold py-1.5 px-3 rounded-lg block transition shadow cursor-pointer">
                ← Voltar ao Master
              </a>
            </div>
          )}

          <div className="mb-6 px-2">
            <div className="flex items-center gap-2 font-bold text-lg mb-1">
              {renderCompanyLogo("w-6 h-6", 22)}
              <span className="tracking-tight text-white truncate">{salonConfig.name}</span>
            </div>
            
            <div className="flex items-center justify-between bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700/60 mt-2">
              <span className="text-xs font-bold text-slate-200 truncate max-w-[120px]">{activeUserName}</span>
              <span className="text-[9px] bg-pink-500/20 text-pink-300 font-extrabold px-2 py-0.5 rounded uppercase tracking-wider">{activeUserRole}</span>
            </div>
          </div>

          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 px-2">Menu Operacional</div>

          <nav className="flex flex-col gap-1 overflow-y-auto max-h-[calc(100vh-250px)] pr-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === tab.id ? `${theme.activeBg} text-white shadow-md` : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="border-t border-slate-800 pt-3 px-2 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold">Unidade:</p>
            <p className="text-xs font-bold text-pink-300 truncate max-w-[120px]">{salonConfig.name}</p>
          </div>
          <div>
            <button
              onClick={handleLogout}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow"
              title="Sair ou Trocar de Conta"
            >
              <LogOut size={15} />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className={`h-16 border-b px-8 flex items-center justify-between shadow-sm ${headerBgClass}`}>
          <div className="flex items-center gap-2 text-sm opacity-80">
            <span className="font-semibold">{salonConfig.name}</span>
            <ChevronRight size={16} />
            <span className="capitalize font-bold">{activeTab === "my_schedule" ? "Meu Banco de Horas & Funções" : activeTab === "my_plan" ? "Meu Plano & Consultorias" : activeTab === "dre" ? "Módulo DRE Gerencial" : activeTab}</span>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === "calendar" && (
              <button onClick={() => { setEditingId(null); setApptClientName(customers[0]?.name || ""); setApptServiceName(services[0]?.name || ""); setApptProfessionalName(isManager ? (employees[0]?.name || "") : activeUserName); setApptNotes(""); setApptHour("10"); setApptMinute("00"); setIsApptModalOpen(true); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Novo Agendamento</button>
            )}
            {activeTab === "atendimentos" && (
              <button onClick={() => { setEditingId(null); setFormDate(new Date().toISOString().split("T")[0]); setTempTime("10:00"); setFormClientName(customers[0]?.name || ""); setFormServiceName(services[0]?.name || ""); setFormProfessionalName(isManager ? (employees[0]?.name || "") : activeUserName); setFormGrossValue(services[0]?.price || 50); setFormPaymentMethod("Pix"); setFormNotes(""); setModalType("attendance"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Lançar Atendimento</button>
            )}
            {activeTab === "pos" && (
              <button onClick={() => { if (availableStockForSale.length === 0) { alert("Sem produtos cadastrados."); return; } const firstP = availableStockForSale[0]; setEditingId(null); setSaleProductName(firstP.name); setSaleUnitPrice(firstP.price); setSaleQuantity(1); setSaleClientName(customers[0]?.name || ""); setSalePaymentMethod("Pix"); setModalType("sale"); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer"><Plus size={16} /> + Nova Venda</button>
            )}
            {activeTab === "services" && isManager && (
              <button onClick={() => { setEditingId(null); setFormName(""); setFormCategory("Cabelos"); setFormDuration(30); setFormPrice(50); setServiceAssignedRole(rolesList[0] || "Cabeleireiro"); setModalType("service"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Novo Serviço</button>
            )}
            {activeTab === "promotions" && isManager && (
              <button onClick={() => { setEditingId(null); setFormName(""); setPromoTargetItems([]); setPromoDuration("7 dias"); setPromoDiscount(1); setPromoIsAll(false); setModalType("promotion"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Cadastrar Promoção</button>
            )}
            {activeTab === "team" && isManager && (
              <div className="flex items-center gap-2">
                <button onClick={() => setIsRolesModalOpen(true)} className="bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer"><Briefcase size={14} /> Gerenciar Funções/Cargos</button>
                <button onClick={() => { setEditingId(null); setFormName(""); setFormPhone(""); setEmpRoles([rolesList[0] || "Cabeleireiro"]); setEmpEmail(""); setEmpPass(""); setEmpSystemRole("Colaborador"); setModalType("employee"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Cadastrar Colaborador</button>
              </div>
            )}
            {activeTab === "stock" && isManager && (
              <button onClick={() => { setEditingId(null); setFormName(""); setFormCategory("Cabelos"); setFormCost(15); setFormPrice(35); setFormMinStock(5); setFormDuration(10); setModalType("product"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Novo Produto</button>
            )}
            {activeTab === "expenses" && isManager && (
              <button onClick={() => { setEditingId(null); setFormName(""); setFormAmount(100); setExpenseCategory("Operacional"); setExpenseIsRecurrent(false); setFormDate(new Date().toISOString().split("T")[0]); setModalType("expense"); }} className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer"><Plus size={16} /> Cadastrar Despesas</button>
            )}
            {activeTab === "customers" && (
              <button onClick={() => { setEditingId(null); setFormName(""); setFormPhone(""); setFormNotes(""); setModalType("customer"); }} className={`${theme.buttonBg} text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow cursor-pointer`}><Plus size={16} /> Cadastrar Cliente</button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === "dashboard" && isManager && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`p-5 rounded-2xl border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${cardBgClass}`}>
                <div>
                  <h2 className="text-xl font-black flex items-center gap-2">
                    <Zap className="text-amber-500" size={24} />
                    Painel Operacional do Dia ({salonConfig.name})
                  </h2>
                  <p className="text-xs opacity-70 mt-0.5">Monte e personalize os blocos do seu painel do seu jeito.</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <button onClick={() => setIsWidgetCustomizerOpen(true)} className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 shadow cursor-pointer transition">
                    <SlidersHorizontal size={15} />
                    <span>Personalizar Dashboard</span>
                  </button>

                  <button onClick={() => {
                    setTempDailyGoal(goals.daily);
                    setTempWeeklyGoal(goals.weekly);
                    setTempMonthlyGoal(goals.monthly);
                    setIsGoalModalOpen(true);
                  }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 shadow cursor-pointer transition">
                    <Target size={15} />
                    <span>Editar Metas</span>
                  </button>

                  <div className={`flex items-center gap-2 border px-3 py-1.5 rounded-xl ${darkMode ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-200"}`}>
                    <span className="text-xs font-bold opacity-80">Mês:</span>
                    <input type="month" value={salonConfig.analysisMonth} onChange={e => setSalonConfig({ ...salonConfig, analysisMonth: e.target.value })} className="bg-transparent text-xs font-black outline-none cursor-pointer" />
                  </div>
                </div>
              </div>

              {visibleWidgets.goalsBlock && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className={`p-5 rounded-2xl border shadow-sm space-y-2 ${cardBgClass}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase tracking-wider opacity-60">Meta Diária</span>
                      <span className="text-xs font-black text-indigo-500">R$ {operationalDashboardMetrics.totalTodayRevenue.toFixed(2)} / R$ {goals.daily.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (operationalDashboardMetrics.totalTodayRevenue / (goals.daily || 1)) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] opacity-70">Progresso do caixa de hoje</p>
                  </div>

                  <div className={`p-5 rounded-2xl border shadow-sm space-y-2 ${cardBgClass}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase tracking-wider opacity-60">Meta Semanal</span>
                      <span className="text-xs font-black text-emerald-500">R$ {operationalDashboardMetrics.totalWeeklyRevenue.toFixed(2)} / R$ {goals.weekly.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (operationalDashboardMetrics.totalWeeklyRevenue / (goals.weekly || 1)) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] opacity-70">Progresso dos últimos 7 dias</p>
                  </div>

                  <div className={`p-5 rounded-2xl border shadow-sm space-y-2 ${cardBgClass}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase tracking-wider opacity-60">Meta Mensal</span>
                      <span className="text-xs font-black text-pink-500">R$ {operationalDashboardMetrics.totalMonthRevenue.toFixed(2)} / R$ {goals.monthly.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-pink-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (operationalDashboardMetrics.totalMonthRevenue / (goals.monthly || 1)) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] opacity-70">Progresso do mês vigente</p>
                  </div>
                </div>
              )}

              {visibleWidgets.quickStats && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className={`p-5 rounded-2xl border shadow-sm ${cardBgClass}`}>
                    <span className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-1">Atendimentos Hoje</span>
                    <p className="text-2xl font-black text-indigo-500">{operationalDashboardMetrics.doneCount} <span className="text-xs opacity-60">realizados</span></p>
                    <p className="text-[11px] opacity-70 mt-1">{operationalDashboardMetrics.todayCount} agendamentos totais no dia</p>
                  </div>

                  <div className={`p-5 rounded-2xl border shadow-sm ${cardBgClass}`}>
                    <span className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-1">Caixa Rápido (Hoje)</span>
                    <p className="text-2xl font-black text-emerald-500">R$ {operationalDashboardMetrics.totalTodayRevenue.toFixed(2)}</p>
                    <p className="text-[11px] opacity-70 mt-1">Entradas em serviços e produtos de hoje</p>
                  </div>

                  <div className={`p-5 rounded-2xl border shadow-sm ${cardBgClass}`}>
                    <span className="text-xs font-bold uppercase tracking-wider opacity-60 block mb-1">Alertas de Estoque</span>
                    <p className="text-2xl font-black text-amber-500">{operationalDashboardMetrics.lowStockItems.length} <span className="text-xs opacity-60">produtos críticos</span></p>
                    <p className="text-[11px] opacity-70 mt-1">Abaixo do nível mínimo recomendado</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {visibleWidgets.teamProductivity && (
                  <div className={`p-5 rounded-2xl border shadow-sm space-y-3 ${cardBgClass}`}>
                    <h3 className="font-bold text-sm flex items-center gap-2 border-b pb-2"><Briefcase size={17} className="text-pink-600" /><span>Produtividade da Equipe Hoje</span></h3>
                    {operationalDashboardMetrics.teamPerformance.length === 0 ? (
                      <p className="text-xs opacity-60 py-4 text-center">Nenhum profissional registrado.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 text-xs">
                        {operationalDashboardMetrics.teamPerformance.map((emp, idx) => (
                          <div key={idx} className="py-2.5 flex justify-between items-center">
                            <div>
                              <strong>{emp.name}</strong>
                              <span className="text-[10px] opacity-60 block">{emp.role}</span>
                            </div>
                            <span className="bg-pink-500/10 text-pink-600 font-bold px-2.5 py-1 rounded-lg">{emp.count} atendimentos</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {visibleWidgets.stockAlerts && (
                  <div className={`p-5 rounded-2xl border shadow-sm space-y-3 ${cardBgClass}`}>
                    <h3 className="font-bold text-sm flex items-center gap-2 border-b pb-2"><Boxes size={17} className="text-amber-500" /><span>Produtos Críticos em Estoque</span></h3>
                    {operationalDashboardMetrics.lowStockItems.length === 0 ? (
                      <p className="text-xs opacity-60 py-4 text-center">Estoque regular, nenhum alerta crítico.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 text-xs">
                        {operationalDashboardMetrics.lowStockItems.map((prod, idx) => (
                          <div key={idx} className="py-2.5 flex justify-between items-center">
                            <div>
                              <strong className="text-rose-500">{prod.name}</strong>
                              <span className="text-[10px] opacity-60 block">Mínimo: {prod.minStockLimit} un</span>
                            </div>
                            <span className="font-black text-rose-500">{prod.currentStock} un restantes</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden ${cardBgClass}`}>
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-bold text-slate-900 text-sm">Agenda de Atendimentos</h3>
                  <button onClick={() => { setEditingId(null); setApptClientName(customers[0]?.name || ""); setApptServiceName(services[0]?.name || ""); setApptProfessionalName(employees[0]?.name || ""); setApptNotes(""); setApptHour("10"); setApptMinute("00"); setIsApptModalOpen(true); }} className={`${theme.buttonBg} text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow cursor-pointer`}>+ Novo Agendamento</button>
                </div>
                {filteredAppointments.length === 0 ? (
                  <div className="p-12 text-center opacity-60 text-xs">Nenhum agendamento marcado.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredAppointments.map(item => (
                      <div key={item.id} className="p-4 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                          <span className="font-black text-sm bg-slate-100 text-slate-900 px-3 py-1.5 rounded-xl">{item.time}</span>
                          <div>
                            <strong className="text-sm">{item.clientName}</strong>
                            <p className="text-xs text-pink-600 font-semibold">{item.serviceName} • {item.professionalName} • {item.date}</p>
                            {item.notes ? <p className="text-[11px] opacity-60 italic">Obs: {item.notes}</p> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => { 
                            setEditingId(item.id); 
                            setApptClientName(item.clientName); 
                            setApptServiceName(item.serviceName); 
                            setApptProfessionalName(item.professionalName); 
                            setApptDate(item.date); 
                            const parts = (item.time || "10:00").split(":");
                            setApptHour(parts[0] || "10");
                            setApptMinute(parts[1] || "00");
                            setApptNotes(item.notes || ""); 
                            setIsApptModalOpen(true); 
                          }} className="p-2 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar"><Pencil size={15} /></button>
                          <button onClick={() => { if (!confirm("Excluir agendamento?")) return; recordSystemLog(`Excluiu agendamento de ${item.clientName}`); const updated = appointments.filter(a => a.id !== item.id); setAppointments(updated); saveTenantData("appointments", updated); }} className="p-2 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={15} /></button>
                          
                          <button onClick={() => { setSelectedAppointmentToFinalize(item); setFinalizePaymentMethod("Pix"); setFinalizeNotes(""); setIsFinalizeModalOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer shadow">
                            Finalizar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "atendimentos" && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Atendimentos</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {filteredAttendances.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhum atendimento.</p> : filteredAttendances.map(a => <div key={a.id} className="py-2.5 flex justify-between items-center"><div><strong>{a.clientName}</strong> - {a.serviceName} ({a.professionalName}) • <span className="font-bold">R$ {Number(a.netValue).toFixed(2)} ({a.paymentMethod})</span> {a.notes ? <span className="opacity-60 italic">[{a.notes}]</span> : ""}</div><div className="flex items-center gap-2"><button onClick={() => { setEditingId(a.id); setFormDate(a.date); setTempTime(a.time || "10:00"); setFormClientName(a.clientName); setFormServiceName(a.serviceName); setFormProfessionalName(a.professionalName); setFormGrossValue(a.netValue); setFormPaymentMethod(a.paymentMethod || "Pix"); setFormNotes(a.notes || ""); setModalType("attendance"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir atendimento?")) return; recordSystemLog(`Excluiu atendimento de ${a.clientName}`); const updated = attendances.filter(item => item.id !== a.id); setAttendances(updated); saveTenantData("attendances", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "services" && isManager && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Serviços & Preços</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {services.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhum serviço.</p> : services.map(s => <div key={s.id} className="py-2.5 flex justify-between items-center"><div><strong>{s.name}</strong> ({s.duration} min) • Função: <span className="text-indigo-600 font-bold">{s.assignedRole || "Geral"}</span> • <span className="font-black text-pink-600">R$ {Number(s.price).toFixed(2)}</span></div><div className="flex items-center gap-2"><button onClick={() => { setEditingId(s.id); setFormName(s.name); setFormCategory(s.category || "Cabelos"); setFormDuration(s.duration || 30); setFormPrice(s.price); setServiceAssignedRole(s.assignedRole || rolesList[0] || "Cabeleireiro"); setModalType("service"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar Serviço"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir serviço?")) return; recordSystemLog(`Excluiu o serviço ${s.name}`); const updated = services.filter(item => item.id !== s.id); setServices(updated); saveTenantData("services", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "promotions" && isManager && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Promoção</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {promotions.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhuma promoção.</p> : promotions.map(p => <div key={p.id} className="py-2.5 flex justify-between items-center"><span>{p.title} • Itens: {p.isAllPromo ? "Tudo em Promoção" : (p.targetItems || []).join(", ")} • Validade: {p.duration} • Desconto: <strong className="text-pink-600">{p.discountPercent}%</strong></span><div className="flex items-center gap-2"><button onClick={() => { setEditingId(p.id); setFormName(p.title); setPromoTargetItems(p.targetItems || []); setPromoDuration(p.duration); setPromoDiscount(p.discountPercent); setPromoIsAll(p.isAllPromo); setModalType("promotion"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar Promoção"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir promoção?")) return; recordSystemLog(`Excluiu promoção ${p.title}`); const updated = promotions.filter(item => item.id !== p.id); setPromotions(updated); saveTenantData("promotions", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "pos" && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Vendas</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {filteredSales.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhuma venda.</p> : filteredSales.map(s => <div key={s.id} className="py-2.5 flex justify-between items-center"><span>{s.productName} ({s.quantity} un) - {s.clientName} • Vendedor: <strong>{s.sellerName || "Geral"}</strong> • Pagamento: <strong>{s.paymentMethod}</strong> • <strong className="text-emerald-600">R$ {Number(s.total).toFixed(2)}</strong></span><div className="flex items-center gap-2"><button onClick={() => { setEditingId(s.id); setSaleProductName(s.productName); setSaleClientName(s.clientName); setSaleQuantity(s.quantity); setSaleUnitPrice(s.unitPrice); setSalePaymentMethod(s.paymentMethod || "Pix"); setModalType("sale"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar Venda"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir venda?")) return; recordSystemLog(`Excluiu a venda do produto ${s.productName}`); const updated = sales.filter(item => item.id !== s.id); setSales(updated); saveTenantData("sales", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir Venda"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "stock" && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-base">Estoque & Alertas de Reposição</h3>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {products.length === 0 ? (
                    <p className="opacity-60 py-4 text-center">Nenhum produto cadastrado.</p>
                  ) : (
                    stockSummary.map(p => (
                      <div key={p.id} className="py-3 flex justify-between items-center">
                        <div>
                          <strong className="text-sm block">{p.name}</strong>
                          <span className="opacity-60">Mín: {p.minStockLimit} un • Venda: R$ {Number(p.price).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          {p.needsRestock ? (
                            <span className="bg-amber-100 text-amber-800 border border-amber-300 font-bold px-3 py-1 rounded-xl text-[11px] flex items-center gap-1">
                              <AlertTriangle size={13} />
                              <span>Atenção: Fazer Pedido!</span>
                            </span>
                          ) : (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-3 py-1 rounded-xl text-[11px]">
                              Regular
                            </span>
                          )}
                          <span className={`font-black text-sm ${p.currentStock <= 0 ? "text-rose-600" : ""}`}>
                            {p.currentStock} un
                          </span>
                          {isManager && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setEditingId(p.id); setFormName(p.name); setFormCategory(p.category || "Cabelos"); setFormCost(p.cost || 10); setFormPrice(p.price); setFormDuration(p.initialStock || p.currentStock); setFormMinStock(p.minStockLimit); setModalType("product"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar Produto"><Pencil size={14} /></button>
                              <button onClick={() => { if (!confirm("Excluir produto?")) return; recordSystemLog(`Excluiu o produto ${p.name}`); const updated = products.filter(item => item.id !== p.id); setProducts(updated); saveTenantData("products", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir Produto"><Trash2 size={14} /></button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "expenses" && isManager && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Despesas Operacionais</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {expenses.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhuma despesa.</p> : expenses.map(e => <div key={e.id} className="py-2.5 flex justify-between items-center"><span>{e.date} - <strong>{e.description}</strong> {e.isRecurrent ? "(Recorrente)" : ""} • <span className="font-black text-rose-600">R$ {Number(e.amount).toFixed(2)}</span></span><div className="flex items-center gap-2"><button onClick={() => { setEditingId(e.id); setFormName(e.description); setFormAmount(e.amount); setExpenseCategory(e.category || "Operacional"); setExpenseIsRecurrent(e.isRecurrent || false); setFormDate(e.date || new Date().toISOString().split("T")[0]); setModalType("expense"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar Despesa"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir despesa?")) return; recordSystemLog(`Excluiu despesa: ${e.description}`); const updated = expenses.filter(item => item.id !== e.id); setExpenses(updated); saveTenantData("expenses", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "team" && isManager && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Equipe de Colaboradores</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {employees.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhum colaborador.</p> : employees.map(e => <div key={e.id} className="py-3 flex justify-between items-center"><div><strong>{e.name}</strong> - Funções: <span className="text-indigo-600 font-bold">{(e.roles || [e.role || "Cabeleireiro"]).join(", ")}</span> • Acesso: <span className="text-pink-600 font-bold">{e.systemRole || "Colaborador"}</span> ({e.phone})</div><div className="flex items-center gap-2"><button onClick={() => setSelectedEmpForSchedule(e)} className="bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded-xl cursor-pointer">Configurar Escala</button><button onClick={() => { setEditingId(e.id); setFormName(e.name); setFormPhone(e.phone || ""); setEmpRoles(e.roles || [e.role || rolesList[0] || "Cabeleireiro"]); setEmpEmail(e.email || ""); setEmpPass(""); setEmpSystemRole(e.systemRole || "Colaborador"); setModalType("employee"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir colaborador?")) return; recordSystemLog(`Excluiu colaborador: ${e.name}`); const updated = employees.filter(item => item.id !== e.id); setEmployees(updated); saveTenantData("employees", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "customers" && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className={`rounded-2xl border shadow-sm overflow-hidden p-6 space-y-4 ${cardBgClass}`}>
                <h3 className="font-bold text-base">Base de Clientes</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {customers.length === 0 ? <p className="opacity-60 py-4 text-center">Nenhum cliente.</p> : customers.map(c => <div key={c.id} className="py-2.5 flex justify-between items-center"><span>{c.name} ({c.phone}) {c.notes ? <span className="opacity-60 italic">[{c.notes}]</span> : ""}</span><div className="flex items-center gap-2"><button onClick={() => { setEditingId(c.id); setFormName(c.name); setFormPhone(c.phone || ""); setFormNotes(c.notes || ""); setModalType("customer"); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-indigo-600 rounded-lg cursor-pointer" title="Editar"><Pencil size={14} /></button><button onClick={() => { if (!confirm("Excluir cliente?")) return; recordSystemLog(`Excluiu cadastro do cliente: ${c.name}`); const updated = customers.filter(item => item.id !== c.id); setCustomers(updated); saveTenantData("customers", updated); }} className="p-1.5 bg-slate-100 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer" title="Excluir"><Trash2 size={14} /></button></div></div>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "my_schedule" && !isManager && loggedEmployeeObject && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className={`p-6 rounded-2xl border shadow-sm space-y-5 ${cardBgClass}`}>
                <div className="border-b pb-3">
                  <h3 className="font-bold text-base">Meu Banco de Horas & Funções Diárias</h3>
                  <p className="text-xs opacity-70">Gerencie sua carga horária e suas funções ativas por dia sem precisar do dono.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="font-bold block mb-1">Minhas Funções Ativas (Alterar conforme o dia)</label>
                    <div className={`border p-3 rounded-xl space-y-2 ${darkMode ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-800"}`}>
                      {rolesList.map((r, idx) => {
                        const currentEmpRoles = loggedEmployeeObject.roles || [loggedEmployeeObject.role];
                        const isSelected = currentEmpRoles.includes(r);
                        return (
                          <div key={idx} onClick={() => {
                            let nextRoles = [...currentEmpRoles];
                            if (isSelected) {
                              if (nextRoles.length <= 1) { alert("Mantenha ao menos 1 função."); return; }
                              nextRoles = nextRoles.filter(role => role !== r);
                            } else {
                              nextRoles.push(r);
                            }
                            const updatedEmp = { ...loggedEmployeeObject, roles: nextRoles, role: nextRoles[0] };
                            const updatedList = employees.map(e => e.id === updatedEmp.id ? updatedEmp : e);
                            setEmployees(updatedList);
                            saveTenantData("employees", updatedList);
                            recordSystemLog(`Atualizou suas próprias funções ativas`);
                          }} className={`flex items-center gap-2 cursor-pointer p-1.5 rounded ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-200"}`}>
                            {isSelected ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} className="opacity-50" />}
                            <span className="font-bold">{r}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold mb-2">Minha Escala de Horários (Banco de Horas)</h4>
                    <div className={`divide-y border rounded-xl overflow-hidden max-h-72 overflow-y-auto ${darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
                      {loggedEmployeeObject.schedule?.map((day: EmployeeSchedule) => (
                        <div key={day.dayIndex} className={`p-3 flex items-center justify-between gap-3 ${darkMode ? "bg-slate-950 text-slate-200" : "bg-white text-slate-800"}`}>
                          <div className="w-36 flex items-center gap-2">
                            <button type="button" onClick={() => {
                              const upSchedule = loggedEmployeeObject.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, isWorking: !d.isWorking } : d);
                              const updatedEmp = { ...loggedEmployeeObject, schedule: upSchedule };
                              const updatedList = employees.map(e => e.id === updatedEmp.id ? updatedEmp : e);
                              setEmployees(updatedList);
                              saveTenantData("employees", updatedList);
                              recordSystemLog(`Atualizou escala de trabalho`);
                            }} className={`px-2.5 py-1 rounded-lg font-bold border text-[11px] cursor-pointer ${day.isWorking ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-slate-100 text-slate-500"}`}>{day.isWorking ? "Trabalha" : "Folga"}</button>
                            <strong>{day.dayName}</strong>
                          </div>
                          {day.isWorking && (
                            <div className="flex items-center gap-2">
                              <input type="time" value={day.openTime} onChange={e => {
                                const upSchedule = loggedEmployeeObject.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, openTime: e.target.value } : d);
                                const updatedEmp = { ...loggedEmployeeObject, schedule: upSchedule };
                                const updatedList = employees.map(e => e.id === updatedEmp.id ? updatedEmp : e);
                                setEmployees(updatedList);
                                saveTenantData("employees", updatedList);
                              }} className={`border rounded p-1 ${darkMode ? "bg-slate-900 border-slate-700 text-white" : ""}`} />
                              <span>às</span>
                              <input type="time" value={day.closeTime} onChange={e => {
                                const upSchedule = loggedEmployeeObject.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, closeTime: e.target.value } : d);
                                const updatedEmp = { ...loggedEmployeeObject, schedule: upSchedule };
                                const updatedList = employees.map(e => e.id === updatedEmp.id ? updatedEmp : e);
                                setEmployees(updatedList);
                                saveTenantData("employees", updatedList);
                              }} className={`border rounded p-1 ${darkMode ? "bg-slate-900 border-slate-700 text-white" : ""}`} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "dre" && isManager && (
            <div className={`max-w-4xl mx-auto p-6 rounded-2xl border shadow-sm space-y-6 text-xs font-sans ${cardBgClass}`}>
              {hasDREAccess ? (
                <div className="space-y-6">
                  <div className="border-b pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h3 className="text-base font-bold flex items-center gap-2 text-white"><PieChart className="text-indigo-400" size={20} /><span>Resumo Mensal Avançado & DRE Gerencial</span></h3>
                      <p className="text-xs text-slate-400 mt-0.5">Visão consolidada de lucros, ticket médio por cliente e curva ABC de produtos e serviços.</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                        <button onClick={() => setDreViewMode("values")} className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${dreViewMode === "values" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
                          <DollarSign size={13} /><span>R$</span>
                        </button>
                        <button onClick={() => setDreViewMode("percent")} className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${dreViewMode === "percent" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
                          <Percent size={13} /><span>%</span>
                        </button>
                        <button onClick={() => setDreViewMode("chart")} className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${dreViewMode === "chart" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
                          <BarChart3 size={13} /><span>Gráfico</span>
                        </button>
                      </div>

                      <button onClick={exportDashboardCSV} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow cursor-pointer transition">
                        <Download size={14} />
                        <span>Exportar CSV</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">Receita Bruta Total</span>
                      <p className="text-xl font-black text-emerald-400">R$ {dreAdvancedMetrics.grossRevenue.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 block mb-1">Ticket Médio / Cliente</span>
                      <p className="text-xl font-black text-blue-400">R$ {dreAdvancedMetrics.ticketMedio.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 block mb-1">Total de Despesas</span>
                      <p className="text-xl font-black text-rose-400">R$ {dreAdvancedMetrics.paidExpenses.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 block mb-1">Margem Líquida</span>
                      <p className="text-xl font-black text-indigo-300">{dreAdvancedMetrics.netMarginPercent.toFixed(1)}%</p>
                    </div>
                  </div>

                  {dreViewMode === "chart" ? (
                    <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl space-y-5">
                      <h4 className="font-bold text-white text-sm">Visualização Gráfica do Desempenho Mensal</h4>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-xs mb-1 font-semibold">
                            <span className="text-emerald-400">Receita de Serviços (R$ {dreAdvancedMetrics.serviceRevenue.toFixed(2)})</span>
                            <span>{dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.serviceRevenue / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%</span>
                          </div>
                          <div className="w-full bg-slate-900 h-4 rounded-full overflow-hidden border border-slate-800">
                            <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${dreAdvancedMetrics.grossRevenue > 0 ? (dreAdvancedMetrics.serviceRevenue / dreAdvancedMetrics.grossRevenue) * 100 : 0}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-xs mb-1 font-semibold">
                            <span className="text-indigo-400">Receita de Produtos (R$ {dreAdvancedMetrics.productRevenue.toFixed(2)})</span>
                            <span>{dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.productRevenue / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%</span>
                          </div>
                          <div className="w-full bg-slate-900 h-4 rounded-full overflow-hidden border border-slate-800">
                            <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${dreAdvancedMetrics.grossRevenue > 0 ? (dreAdvancedMetrics.productRevenue / dreAdvancedMetrics.grossRevenue) * 100 : 0}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-xs mb-1 font-semibold">
                            <span className="text-rose-400">Despesas Operacionais (R$ {dreAdvancedMetrics.paidExpenses.toFixed(2)})</span>
                            <span>{dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.paidExpenses / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%</span>
                          </div>
                          <div className="w-full bg-slate-900 h-4 rounded-full overflow-hidden border border-slate-800">
                            <div className="bg-rose-500 h-full rounded-full transition-all duration-500" style={{ width: `${dreAdvancedMetrics.grossRevenue > 0 ? Math.min(100, (dreAdvancedMetrics.paidExpenses / dreAdvancedMetrics.grossRevenue) * 100) : 0}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800 bg-slate-950 text-slate-100">
                      <div className="p-3.5 bg-slate-900 font-bold flex justify-between text-white">
                        <span>Linha do DRE Gerencial</span>
                        <span>{dreViewMode === "percent" ? "Participação (%)" : "Valor (R$)"}</span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-slate-300">(+) Receita Bruta de Serviços</span>
                        <span className="font-bold text-emerald-400">
                          {dreViewMode === "percent" ? `${dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.serviceRevenue / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%` : `R$ ${dreAdvancedMetrics.serviceRevenue.toFixed(2)}`}
                        </span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-slate-300">(+) Receita de Venda de Produtos</span>
                        <span className="font-bold text-emerald-400">
                          {dreViewMode === "percent" ? `${dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.productRevenue / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%` : `R$ ${dreAdvancedMetrics.productRevenue.toFixed(2)}`}
                        </span>
                      </div>
                      <div className="p-3 flex justify-between bg-slate-900/50">
                        <strong className="text-white">(=) Receita Operacional Líquida</strong>
                        <strong className="text-white">
                          {dreViewMode === "percent" ? "100.0%" : `R$ ${dreAdvancedMetrics.grossRevenue.toFixed(2)}`}
                        </strong>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-slate-300">(-) Despesas Operacionais e Custos Pagos</span>
                        <span className="font-bold text-rose-400">
                          {dreViewMode === "percent" ? `- ${dreAdvancedMetrics.grossRevenue > 0 ? ((dreAdvancedMetrics.paidExpenses / dreAdvancedMetrics.grossRevenue) * 100).toFixed(1) : 0}%` : `- R$ ${dreAdvancedMetrics.paidExpenses.toFixed(2)}`}
                        </span>
                      </div>
                      <div className="p-4 flex justify-between bg-indigo-600/30 text-white font-black text-sm border-t-2 border-indigo-500">
                        <span>(=) LUCRO LÍQUIDO DO EXERCÍCIO</span>
                        <span className="text-emerald-400">
                          {dreViewMode === "percent" ? `${dreAdvancedMetrics.netMarginPercent.toFixed(1)}%` : `R$ ${dreAdvancedMetrics.estimatedNetResult.toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                      <h4 className="font-bold text-white flex items-center gap-1.5"><Scissors size={15} className="text-pink-500" /><span>Serviços Mais Procurados no Mês</span></h4>
                      {dreAdvancedMetrics.servicesRanking.length === 0 ? (
                        <p className="text-slate-500 italic py-2">Nenhum serviço prestado no mês.</p>
                      ) : (
                        <div className="divide-y divide-slate-900 text-xs">
                          {dreAdvancedMetrics.servicesRanking.map((s: any, i: number) => (
                            <div key={i} className="py-2 flex justify-between items-center">
                              <div><strong className="text-slate-200">{s.name}</strong><span className="text-[10px] text-slate-500 block">{s.qty} atendimentos</span></div>
                              <span className="font-bold text-emerald-400">R$ {s.total.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                      <h4 className="font-bold text-white flex items-center gap-1.5"><ShoppingBag size={15} className="text-indigo-400" /><span>Produtos Mais Vendidos no Mês</span></h4>
                      {dreAdvancedMetrics.productsRanking.length === 0 ? (
                        <p className="text-slate-500 italic py-2">Nenhum produto vendido no mês.</p>
                      ) : (
                        <div className="divide-y divide-slate-900 text-xs">
                          {dreAdvancedMetrics.productsRanking.map((p: any, i: number) => (
                            <div key={i} className="py-2 flex justify-between items-center">
                              <div><strong className="text-slate-200">{p.name}</strong><span className="text-[10px] text-slate-500 block">{p.qty} unidades vendidas</span></div>
                              <span className="font-bold text-indigo-400">R$ {p.total.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center space-y-4">
                  <div className="inline-flex p-4 bg-indigo-600/20 text-indigo-400 rounded-3xl border border-indigo-500/30">
                    <Lock size={40} />
                  </div>
                  <h3 className="text-lg font-black text-white">Módulo DRE Gerencial Exclusivo do Plano Ultra</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">O DRE automatizado e o resumo mensal avançado oferecem controle de ticket médio, curva ABC de produtos e margem de lucro. Faça upgrade para o Plano Ultra ou solicite liberação com o Master!</p>
                  <button onClick={() => setActiveTab("my_plan")} className="bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs px-6 py-3 rounded-xl cursor-pointer shadow">
                    ✨ Conhecer o Plano Ultra
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "my_plan" && isManager && (
            <div className={`max-w-6xl mx-auto p-6 rounded-2xl border shadow-sm space-y-6 text-xs font-sans ${cardBgClass}`}>
              <div className="border-b pb-4 flex justify-between items-center">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2"><Award className="text-pink-600" size={20} /><span>Plano & Consultorias do Estabelecimento</span></h3>
                  <p className="text-xs opacity-70 mt-0.5">Visualize seu plano contratado, altere sua assinatura e consulte suas consultorias restantes no mês.</p>
                </div>
                <span className="bg-emerald-500/20 text-emerald-400 font-extrabold px-3 py-1 rounded-full text-xs">Assinatura Ativa</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`p-5 rounded-2xl border ${darkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                  <span className="text-[11px] font-bold uppercase tracking-wider opacity-60 block mb-1">Plano Atual</span>
                  <h4 className="text-lg font-black text-pink-600">{currentCompany?.planName || currentCompany?.plan_name || "Pro"}</h4>
                  <p className="text-sm font-bold mt-1">R$ {Number(currentCompany?.monthlyFee || currentCompany?.monthly_fee || 149.90).toFixed(2)} <span className="text-[11px] opacity-60">/ mês</span></p>
                  <p className="text-[11px] opacity-70 mt-3">Vencimento todo dia {currentCompany?.dueDay || currentCompany?.due_day || 10} de cada mês.</p>
                </div>

                <div className={`p-5 rounded-2xl border flex flex-col justify-between ${darkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider opacity-60 block mb-1">Consultorias Restantes (Outubro/2026)</span>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className="text-3xl font-black text-indigo-500">1</span>
                      <span className="text-xs font-bold opacity-70">de 1 consultoria disponível</span>
                    </div>
                    <p className="text-[11px] opacity-70 mt-2">Atendimento técnico e estratégico com especialista SaaS.</p>
                  </div>
                  <button onClick={() => setIsConsultancyModalOpen(true)} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl cursor-pointer shadow">
                    📅 Agendar Consultoria
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button onClick={() => setShowUpgradeOptions(!showUpgradeOptions)} className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2.5 rounded-xl cursor-pointer shadow flex items-center gap-2">
                  <span>{showUpgradeOptions ? "Ocultar Opções de Planos" : "Deseja alterar o plano?"}</span>
                  {showUpgradeOptions ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>

              {showUpgradeOptions && (
                <div className="space-y-4 pt-2">
                  <h4 className="font-bold text-sm">Opções de Planos e Consultorias Especializadas</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      {
                        name: "Básico",
                        price: "R$ 89,90",
                        modules: [
                          "• PDV limitado",
                          "• Dashboard",
                          "• Agenda",
                          "• Atendimento",
                          "• Serviços",
                          "• Venda",
                          "• Estoque",
                          "• Clientes"
                        ]
                      },
                      {
                        name: "Pro",
                        price: "R$ 149,90",
                        modules: [
                          "• Dashboard",
                          "• Agenda",
                          "• Atendimento",
                          "• Serviços",
                          "• Promoções",
                          "• Vendas",
                          "• Estoque",
                          "• Despesas",
                          "• Minha equipe",
                          "• Cadastro de clientes",
                          "• Resumo mensal"
                        ],
                        current: true
                      },
                      {
                        name: "Ultra",
                        price: "R$ 299,90",
                        modules: [
                          "• Dashboard",
                          "• Agenda",
                          "• Atendimento",
                          "• Serviços",
                          "• Promoções",
                          "• Vendas",
                          "• Estoque",
                          "• Despesas",
                          "• Minha equipe",
                          "• Cadastro de clientes",
                          "• Resumo mensal avançado",
                          "• Módulo DRE Gerencial",
                          "• 1 Consultorias mensais"
                        ]
                      },
                      {
                        name: "Consultoria",
                        price: "Sob Negociação",
                        isConsultancyCard: true,
                        modules: [
                          "• Mensal (1x no mês)",
                          "• Quinzenal (2x no mês)",
                          "• Semanal (4x no mês)",
                          "• Avulsa (Sessão única)",
                          "• Alinhamento direto c/ suporte"
                        ]
                      }
                    ].map((p, idx) => {
                      const currentPName = (currentCompany?.planName || currentCompany?.plan_name || "").toLowerCase();
                      const isCurrent = !p.isConsultancyCard && currentPName.includes(p.name.toLowerCase());
                      return (
                        <div key={idx} className={`p-4 rounded-2xl border flex flex-col justify-between space-y-3 ${isCurrent ? "border-pink-500 bg-pink-500/5" : "border-slate-300 dark:border-slate-800"}`}>
                          <div>
                            <div className="flex justify-between items-start">
                              <strong className="text-sm font-black">{p.name}</strong>
                              {isCurrent && <span className="text-[9px] bg-pink-500 text-white px-2 py-0.5 rounded-full font-bold">Atual</span>}
                            </div>
                            <p className="text-base font-black text-pink-600 mt-1">{p.price}</p>
                            
                            <div className="mt-3 space-y-1 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800 max-h-48 overflow-y-auto">
                              {p.modules.map((mod, i) => (
                                <p key={i} className="text-[11px] opacity-90">{mod}</p>
                              ))}
                            </div>
                          </div>

                          {p.isConsultancyCard ? (
                            <button onClick={() => {
                              recordSystemLog("Clicou em negociar plano de consultoria");
                              alert("💬 Redirecionando para negociação de consultoria direta com o suporte Master.");
                            }} className="w-full py-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer flex items-center justify-center gap-1.5 shadow">
                              <MessageCircle size={14} />
                              <span>Negociar Consultoria</span>
                            </button>
                          ) : (
                            <button onClick={() => {
                              if (isCurrent) { alert("Este já é o seu plano atual."); return; }
                              setSelectedPlanToUpgrade(p);
                              setIsPlanModalOpen(true);
                            }} className={`w-full py-2 rounded-xl font-bold cursor-pointer ${isCurrent ? "bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}>
                              {isCurrent ? "Plano Atual" : "Selecionar Plano"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t space-y-3">
                <div onClick={() => setIsInvoiceHistoryOpen(!isInvoiceHistoryOpen)} className="flex justify-between items-center cursor-pointer select-none bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <h4 className="font-bold text-sm flex items-center gap-2"><FileText size={16} className="text-indigo-500" /><span>Histórico de Comprovantes de Mensalidades</span></h4>
                  <div className="flex items-center gap-1 text-slate-400 font-bold">
                    <span>{isInvoiceHistoryOpen ? "Ocultar" : "Abrir Histórico"}</span>
                    {isInvoiceHistoryOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {isInvoiceHistoryOpen && (
                  <div className="space-y-2 pt-2">
                    {currentCompany?.invoices?.length > 0 ? (
                      currentCompany.invoices.map((inv: any, idx: number) => (
                        <div key={idx} className={`p-3 rounded-xl border flex justify-between items-center ${darkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                          <div>
                            <strong>Competência: {inv.referenceMonth}</strong>
                            <p className="text-[11px] opacity-70">Valor: R$ {Number(inv.amount || 0).toFixed(2)} • Vencimento: {inv.dueDate} • Status: <strong className="text-emerald-500">{inv.status}</strong></p>
                          </div>
                          <div className="flex items-center gap-2">
                            {inv.receiptUrl ? (
                              <a href={inv.receiptUrl} target="_blank" rel="noreferrer" className="text-pink-500 font-bold hover:underline">
                                📄 Ver Comprovante
                              </a>
                            ) : (
                              <span className="text-[11px] opacity-50 italic">Pago via Pix Corporativo</span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="opacity-60 italic">Nenhum histórico de fatura disponível.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className={`max-w-3xl mx-auto p-6 rounded-2xl border shadow-sm space-y-6 text-xs font-sans ${cardBgClass}`}>
              <h3 className="font-bold text-sm">Configurações & Identidade Visual da Unidade</h3>
              
              <div className="flex justify-between items-center p-3 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800">
                <div>
                  <strong className="block text-sm">Aparência do Sistema</strong>
                  <span className="opacity-70">Alternar entre Modo Dia e Modo Noite</span>
                </div>
                <button
                  onClick={() => {
                    const nextDark = !darkMode;
                    setDarkMode(nextDark);
                    saveUserPreferences(nextDark, currentCompany?.primary_color || currentCompany?.primaryColor || "pink");
                  }}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl cursor-pointer shadow transition"
                >
                  {darkMode ? <Sun size={16} /> : <Moon size={16} />}
                  <span>{darkMode ? "Modo Dia" : "Modo Noite"}</span>
                </button>
              </div>

              {isManager && (
                <div>
                  <label className="block mb-1 font-semibold">Nome da Empresa</label>
                  <input
                    value={salonConfig.name}
                    onChange={e => {
                      const newName = e.target.value;
                      setSalonConfig({ ...salonConfig, name: newName });
                      updateCompanyInMasterDb({ company_name: newName });
                    }}
                    className="w-full border border-slate-300 p-2.5 rounded-xl outline-none bg-transparent"
                  />
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-slate-200">
                <label className="font-semibold block flex items-center gap-1.5">
                  <Palette size={15} className="text-indigo-600" />
                  <span>Cor de Destaque do Sistema (Tema Visual • Salvo para seu login)</span>
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { id: "pink", label: "Rosa Pink", bg: "bg-pink-600" },
                    { id: "indigo", label: "Azul Inova", bg: "bg-indigo-600" },
                    { id: "emerald", label: "Verde Esmeralda", bg: "bg-emerald-600" },
                    { id: "purple", label: "Roxo Elegante", bg: "bg-purple-600" },
                    { id: "amber", label: "Laranja Ouro", bg: "bg-amber-600" },
                    { id: "rose", label: "Vermelho Vinho", bg: "bg-rose-600" }
                  ].map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const updated = { ...currentCompany, primary_color: c.id };
                        setCurrentCompany(updated);
                        if (isManager) {
                          updateCompanyInMasterDb({ primary_color: c.id });
                        }
                        saveUserPreferences(darkMode, c.id);
                      }}
                      className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 cursor-pointer transition ${
                        (currentCompany?.primary_color || currentCompany?.primaryColor || "pink") === c.id ? "border-slate-900 ring-2 ring-slate-900/20" : "border-slate-200"
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full ${c.bg}`} />
                      <span className="text-[10px] font-bold text-slate-700">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {isManager && (
                <div className="space-y-3 pt-4 border-t border-slate-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <strong className="block">Logotipo ou Ícone do Ramo</strong>
                      <span className="opacity-70">Escolha o símbolo do seu ramo ou envie uma imagem PNG própria.</span>
                    </div>
                    <input
                      type="file"
                      ref={logoInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file || !currentCompany) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const base64 = event.target?.result as string;
                          updateCompanyInMasterDb({ logo_type: "image", logo_url: base64 });
                          alert("Logotipo atualizado com sucesso!");
                        };
                        reader.readAsDataURL(file);
                      }}
                      accept="image/png,image/jpeg"
                      className="hidden"
                    />
                    <button onClick={() => logoInputRef.current?.click()} className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3.5 py-2 rounded-xl cursor-pointer">
                      Enviar Imagem PNG
                    </button>
                  </div>

                  <div className="space-y-2 pt-1">
                    <span className="font-semibold block">Ícones por ramo:</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { id: "scissors", label: "Salão", icon: <Scissors size={18} /> },
                        { id: "barber", label: "Barber", icon: <Sparkles size={18} /> },
                        { id: "spa", label: "Spa", icon: <Flower2 size={18} /> },
                        { id: "nails", label: "Unhas", icon: <Sparkles size={18} /> },
                        { id: "store", label: "Loja", icon: <ShoppingBag size={18} /> },
                        { id: "building", label: "Geral", icon: <Building2 size={18} /> }
                      ].map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => updateCompanyInMasterDb({ logo_type: "icon", logo_icon: item.id })}
                          className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 cursor-pointer transition ${
                            (currentCompany?.logo_icon || currentCompany?.logoIcon) === item.id ? "bg-slate-900 border-slate-900 text-white" : "border-slate-200"
                          }`}
                        >
                          {item.icon}
                          <span className="text-[10px] font-bold">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {isWidgetCustomizerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-1.5"><SlidersHorizontal className="text-indigo-600" size={18} /><span>Personalizar Dashboard</span></h2>
              <button onClick={() => setIsWidgetCustomizerOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>
            <p className="text-slate-600">Marque os blocos que você deseja exibir na sua tela inicial:</p>

            <div className="space-y-2 py-2">
              {[
                { key: "goalsBlock", label: "Bloco de Metas (Diária, Semanal e Mensal)" },
                { key: "quickStats", label: "Estatísticas Rápidas (Atendimentos e Caixa)" },
                { key: "teamProductivity", label: "Produtividade da Equipe Hoje" },
                { key: "stockAlerts", label: "Produtos Críticos em Estoque" }
              ].map(w => {
                const isChecked = (visibleWidgets as any)[w.key];
                return (
                  <div key={w.key} onClick={() => {
                    const nextW = { ...visibleWidgets, [w.key]: !isChecked };
                    setVisibleWidgets(nextW);
                    localStorage.setItem("saas_dashboard_widgets", JSON.stringify(nextW));
                  }} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition select-none">
                    {isChecked ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} className="text-slate-400" />}
                    <span className="font-bold text-slate-800">{w.label}</span>
                  </div>
                );
              })}
            </div>

            <button onClick={() => setIsWidgetCustomizerOpen(false)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
              Concluir Personalização
            </button>
          </div>
        </div>
      )}

      {isGoalModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-1.5"><Target className="text-indigo-600" size={18} /><span>Configurar Metas de Faturamento</span></h2>
              <button onClick={() => setIsGoalModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>
            <p className="text-slate-600">Defina os valores de metas para acompanhar o progresso diário, semanal e mensal no painel.</p>

            <form onSubmit={e => {
              e.preventDefault();
              const newG = { daily: Number(tempDailyGoal), weekly: Number(tempWeeklyGoal), monthly: Number(tempMonthlyGoal) };
              setGoals(newG);
              localStorage.setItem("saas_dashboard_goals", JSON.stringify(newG));
              recordSystemLog("Atualizou as metas de faturamento do dashboard");
              alert("✅ Metas atualizadas com sucesso!");
              setIsGoalModalOpen(false);
            }} className="space-y-3">
              <div>
                <label className="font-bold block mb-1">Meta Diária (R$) *</label>
                <input type="number" step="10" required value={tempDailyGoal} onChange={e => setTempDailyGoal(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" />
              </div>
              <div>
                <label className="font-bold block mb-1">Meta Semanal (R$) *</label>
                <input type="number" step="50" required value={tempWeeklyGoal} onChange={e => setTempWeeklyGoal(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" />
              </div>
              <div>
                <label className="font-bold block mb-1">Meta Mensal (R$) *</label>
                <input type="number" step="100" required value={tempMonthlyGoal} onChange={e => setTempMonthlyGoal(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" />
              </div>

              <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
                Salvar Metas
              </button>
            </form>
          </div>
        </div>
      )}

      {isPlanModalOpen && selectedPlanToUpgrade && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold">Alterar para o plano {selectedPlanToUpgrade.name}</h2>
              <button onClick={() => setIsPlanModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>
            <p className="text-slate-600">Escolha quando deseja que a alteração entre em vigor:</p>

            <div className="space-y-3 pt-2">
              <button onClick={() => {
                const newFee = selectedPlanToUpgrade.name === "Básico" ? 89.90 : selectedPlanToUpgrade.name === "Ultra" ? 299.90 : 149.90;
                updateCompanyInMasterDb({ plan_name: selectedPlanToUpgrade.name, monthly_fee: newFee });
                recordSystemLog(`Alterou plano para ${selectedPlanToUpgrade.name} (Efetivo Agora)`);
                alert(`⚠ Aviso: A alteração para o plano ${selectedPlanToUpgrade.name} foi aplicada agora.\n\nA próxima fatura será calculada com base nos dias usados proporcionalmente.`);
                setIsPlanModalOpen(false);
                setShowUpgradeOptions(false);
              }} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
                ⚡ Alterar Agora (Cálculo Proporcional)
              </button>

              <button onClick={() => {
                recordSystemLog(`Agendou alteração de plano para ${selectedPlanToUpgrade.name} no próximo mês`);
                alert(`✅ Agendado com sucesso!\n\nA alteração para o plano ${selectedPlanToUpgrade.name} entrará em vigor no próximo ciclo de faturamento.`);
                setIsPlanModalOpen(false);
                setShowUpgradeOptions(false);
              }} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
                📅 Alterar no Próximo Mês
              </button>
            </div>
          </div>
        </div>
      )}

      {isConsultancyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-1.5"><Award className="text-indigo-600" size={18} /><span>Solicitar Consultoria</span></h2>
              <button onClick={() => setIsConsultancyModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>
            <p className="text-slate-600">Informe sua data, horário e a pauta/dúvidas principais para a reunião de 1 hora.</p>

            <form onSubmit={e => {
              e.preventDefault();
              recordSystemLog(`Solicitou agendamento de consultoria para o dia ${consultancyDate} às ${consultancyTime} | Pauta: ${consultancyAgendaNotes}`);
              alert(`🚀 Solicitação enviada com sucesso!\n\nAlerta enviado via WhatsApp e E-mail para o Master.\nData preferida: ${consultancyDate} às ${consultancyTime}.\nPauta: ${consultancyAgendaNotes}\n\nEntraremos em contato em breve para confirmar!`);
              setIsConsultancyModalOpen(false);
              setConsultancyAgendaNotes("");
            }} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold block mb-1">Data de Preferência *</label>
                  <input type="date" required value={consultancyDate} onChange={e => setConsultancyDate(e.target.value)} className="w-full border p-2.5 rounded-xl" />
                </div>
                <div>
                  <label className="font-bold block mb-1">Horário de Preferência *</label>
                  <input type="time" required value={consultancyTime} onChange={e => setConsultancyTime(e.target.value)} className="w-full border p-2.5 rounded-xl" />
                </div>
              </div>

              <div>
                <label className="font-bold block mb-1">Principais Dúvidas / Pauta da Reunião *</label>
                <textarea rows={3} required placeholder="Ex: Preciso de ajuda para estruturar o fluxo de caixa e metas da equipe..." value={consultancyAgendaNotes} onChange={e => setConsultancyAgendaNotes(e.target.value)} className="w-full border p-2.5 rounded-xl outline-none" />
              </div>

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-900 text-[11px]">
                ℹ️ Alerta disparado automaticamente para o WhatsApp e E-mail Master.
              </div>

              <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
                Enviar Solicitação de Consultoria
              </button>
            </form>
          </div>
        </div>
      )}

      {isRolesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold">Gerenciar Funções / Cargos</h2>
              <button onClick={() => setIsRolesModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {rolesList.map((role, idx) => (
                <div key={idx} className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border">
                  <strong>{role}</strong>
                  <button onClick={() => {
                    if (rolesList.length <= 1) { alert("Mantenha ao menos 1 função."); return; }
                    const updated = rolesList.filter((_, i) => i !== idx);
                    setRolesList(updated);
                    saveTenantData("rolesList", updated);
                  }} className="text-rose-600 hover:bg-rose-50 p-1 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <form onSubmit={e => {
              e.preventDefault();
              if (!newRoleName.trim()) return;
              if (rolesList.includes(newRoleName.trim())) { alert("Função já cadastrada."); return; }
              const updated = [...rolesList, newRoleName.trim()];
              setRolesList(updated);
              saveTenantData("rolesList", updated);
              setNewRoleName("");
            }} className="flex gap-2 pt-2 border-t">
              <input placeholder="Nova função (ex: Barbeiro)" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} className="flex-1 border p-2.5 rounded-xl outline-none" />
              <button type="submit" className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl cursor-pointer">+ Adicionar</button>
            </form>
          </div>
        </div>
      )}

      {isFinalizeModalOpen && selectedAppointmentToFinalize && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center">
              <h2 className="text-base font-bold">Finalizar Atendimento</h2>
              <button onClick={() => setIsFinalizeModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
              <p>Cliente: <strong>{selectedAppointmentToFinalize.clientName}</strong></p>
              <p>Serviço: <strong className="text-pink-600">{selectedAppointmentToFinalize.serviceName}</strong></p>
              <p>Profissional: <strong>{selectedAppointmentToFinalize.professionalName}</strong></p>
              <p>Valor: <strong className="text-emerald-600 font-black">R$ {(selectedAppointmentToFinalize.price || 45).toFixed(2)}</strong></p>
            </div>

            <form onSubmit={e => {
              e.preventDefault();
              const item = selectedAppointmentToFinalize;
              const newAtt = {
                id: `at-${Date.now()}`,
                date: item.date,
                time: item.time,
                clientName: item.clientName,
                serviceName: item.serviceName,
                professionalName: item.professionalName,
                grossValue: item.price || 45,
                discount: 0,
                netValue: item.price || 45,
                paymentMethod: finalizePaymentMethod,
                notes: finalizeNotes,
                status: "Atendido"
              };
              const upAppts = appointments.filter(a => a.id !== item.id);
              const upAtts = [newAtt, ...attendances];
              setAppointments(upAppts);
              setAttendances(upAtts);
              saveTenantData("appointments", upAppts);
              saveTenantData("attendances", upAtts);
              recordSystemLog(`Finalizou atendimento para ${item.clientName}`);
              setIsFinalizeModalOpen(false);
              setSelectedAppointmentToFinalize(null);
            }} className="space-y-3">
              <div>
                <label className="font-bold block mb-1">Forma de Pagamento *</label>
                <select value={finalizePaymentMethod} onChange={e => setFinalizePaymentMethod(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                  <option value="Pix">Pix</option>
                  <option value="Cartão de Crédito">Cartão de Crédito</option>
                  <option value="Cartão de Débito">Cartão de Débito</option>
                  <option value="Dinheiro">Dinheiro</option>
                </select>
              </div>

              <div>
                <label className="font-bold block mb-1">Observações do Atendimento</label>
                <textarea rows={3} placeholder="Ex: Cliente pediu corte em camadas..." value={finalizeNotes} onChange={e => setFinalizeNotes(e.target.value)} className="w-full border p-2.5 rounded-xl outline-none" />
              </div>

              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl cursor-pointer shadow">
                Confirmar Pagamento & Concluir
              </button>
            </form>
          </div>
        </div>
      )}

      {isApptModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center"><h2 className="text-base font-bold">{editingId ? "Editar Agendamento" : "Novo Agendamento"}</h2><button onClick={() => setIsApptModalOpen(false)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button></div>
            <form onSubmit={e => {
              e.preventDefault();
              const selectedSrv = services.find(s => s.name === apptServiceName) || services[0];
              const assignedProf = apptProfessionalName || (isManager ? (employees[0]?.name || "") : activeUserName);

              const conflict = appointments.find(a => {
                if (editingId && a.id === editingId) return false;
                return a.date === apptDate && a.time === apptTime && a.professionalName.toLowerCase() === assignedProf.toLowerCase();
              });

              if (conflict) {
                alert(`⚠ Atenção: O profissional "${assignedProf}" já possui um agendamento marcado para este mesmo dia e horário (${apptTime})! Escolha outro horário para evitar conflito.`);
                return;
              }

              if (editingId) {
                const updated = appointments.map(a => a.id === editingId ? { ...a, date: apptDate, time: apptTime, clientName: apptClientName, serviceName: apptServiceName, professionalName: assignedProf, price: Number(selectedSrv?.price) || 45, notes: apptNotes } : a);
                setAppointments(updated);
                saveTenantData("appointments", updated);
                recordSystemLog(`Editou agendamento de ${apptClientName} para ${apptTime}`);
              } else {
                const newAppt = { id: `a-${Date.now()}`, date: apptDate, time: apptTime, clientName: apptClientName || "Cliente", serviceName: selectedSrv?.name || "Serviço", professionalName: assignedProf, price: Number(selectedSrv?.price) || 45, notes: apptNotes, status: "Agendado" };
                const updated = [newAppt, ...appointments];
                setAppointments(updated);
                saveTenantData("appointments", updated);
                recordSystemLog(`Criou novo agendamento para ${apptClientName} às ${apptTime}`);
              }
              setIsApptModalOpen(false);
            }} className="space-y-3">
              <div><label className="font-bold block mb-1">Nome da Cliente *</label><input required placeholder="Cliente" value={apptClientName} onChange={e => setApptClientName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold block mb-1">Serviço *</label>
                  <select value={apptServiceName} onChange={e => setApptServiceName(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                    {services.map(s => <option key={s.id} value={s.name}>{s.name} (R$ {s.price})</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-bold block mb-1">Profissional *</label>
                  <select value={apptProfessionalName || (isManager ? (employees[0]?.name || "") : activeUserName)} onChange={e => setApptProfessionalName(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                    {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="font-bold block mb-1">Data *</label><input type="date" required value={apptDate} onChange={e => setApptDate(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div>
                  <label className="font-bold block mb-1">Horário *</label>
                  <div className="flex items-center gap-1">
                    <select value={apptHour} onChange={e => setApptHour(e.target.value)} className="w-1/2 border p-2.5 rounded-xl bg-white font-bold">
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="font-black">:</span>
                    <select value={apptMinute} onChange={e => setApptMinute(e.target.value)} className="w-1/2 border p-2.5 rounded-xl bg-white font-bold text-indigo-600">
                      {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div><label className="font-bold block mb-1">Observações do Agendamento</label><textarea rows={2} placeholder="Ex: Chegar com 10 min de antecedência..." value={apptNotes} onChange={e => setApptNotes(e.target.value)} className="w-full border p-2.5 rounded-xl outline-none" /></div>
              <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Agendamento</button>
            </form>
          </div>
        </div>
      )}

      {modalType && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center"><h2 className="text-base font-bold capitalize">{editingId ? `Editar ${modalType}` : `Cadastrar ${modalType}`}</h2><button onClick={() => setModalType(null)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button></div>

            {modalType === "service" && (
              <form onSubmit={e => {
                e.preventDefault();
                if (editingId) {
                  const updated = services.map(s => s.id === editingId ? { ...s, name: formName, category: formCategory, duration: Number(formDuration), price: Number(formPrice), assignedRole: serviceAssignedRole } : s);
                  setServices(updated);
                  saveTenantData("services", updated);
                  recordSystemLog(`Editou o serviço ${formName}`);
                } else {
                  const newS = { id: `s-${Date.now()}`, name: formName, category: formCategory, duration: Number(formDuration), price: Number(formPrice), assignedRole: serviceAssignedRole };
                  const updated = [...services, newS];
                  setServices(updated);
                  saveTenantData("services", updated);
                  recordSystemLog(`Cadastrou novo serviço: ${formName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Nome do Serviço *</label><input required placeholder="Corte" value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Categoria</label><input value={formCategory} onChange={e => setFormCategory(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                  <div>
                    <label className="font-bold block mb-1">Atribuir à Função *</label>
                    <select value={serviceAssignedRole} onChange={e => setServiceAssignedRole(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                      {rolesList.map((r, idx) => <option key={idx} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Duração (min)</label><input type="number" value={formDuration} onChange={e => setFormDuration(Number(e.target.value))} className="w-full border p-2.5 rounded-xl" /></div>
                  <div><label className="font-bold block mb-1">Preço (R$) *</label><input type="number" step="0.01" required value={formPrice} onChange={e => setFormPrice(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" /></div>
                </div>
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Serviço</button>
              </form>
            )}

            {modalType === "product" && (
              <form onSubmit={e => {
                e.preventDefault();
                if (editingId) {
                  const updated = products.map(p => p.id === editingId ? { ...p, name: formName, category: formCategory, cost: Number(formCost), price: Number(formPrice), initialStock: Number(formDuration), minStock: Number(formMinStock) || 5 } : p);
                  setProducts(updated);
                  saveTenantData("products", updated);
                  recordSystemLog(`Editou o produto ${formName}`);
                } else {
                  const newPr = { id: `pr-${Date.now()}`, name: formName, category: formCategory, cost: Number(formCost), price: Number(formPrice), initialStock: Number(formDuration), minStock: Number(formMinStock) || 5 };
                  const updated = [...products, newPr];
                  setProducts(updated);
                  saveTenantData("products", updated);
                  recordSystemLog(`Cadastrou novo produto: ${formName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Nome do Produto *</label><input required placeholder="Shampoo" value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div className="grid grid-cols-2 gap-2"><div><label className="font-bold block mb-1">Custo (R$)</label><input type="number" step="0.01" value={formCost} onChange={e => setFormCost(Number(e.target.value))} className="w-full border p-2.5 rounded-xl" /></div><div><label className="font-bold block mb-1">Venda (R$)</label><input type="number" step="0.01" value={formPrice} onChange={e => setFormPrice(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" /></div></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Estoque Inicial *</label><input type="number" required value={formDuration} onChange={e => setFormDuration(Number(e.target.value))} className="w-full border p-2.5 rounded-xl" /></div>
                  <div><label className="font-bold block mb-1">Estoque Mínimo *</label><input type="number" required value={formMinStock} onChange={e => setFormMinStock(Number(e.target.value))} className="w-full border p-2.5 rounded-xl" /></div>
                </div>
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Produto</button>
              </form>
            )}

            {modalType === "sale" && (
              <form onSubmit={e => {
                e.preventDefault();
                const qty = Number(saleQuantity) || 1;
                const prc = Number(saleUnitPrice) || 0;
                
                if (editingId) {
                  const oldSale = sales.find(s => s.id === editingId);
                  const oldQty = oldSale && oldSale.productName === saleProductName ? oldSale.quantity : 0;
                  const diffQty = qty - oldQty;
                  if (diffQty > 0) {
                    const targetProduct = stockSummary.find(p => p.name === saleProductName);
                    if (!targetProduct || targetProduct.currentStock < diffQty) {
                      alert(`⚠ Estoque insuficiente para o acréscimo! Saldo disponível: ${targetProduct?.currentStock || 0}`);
                      return;
                    }
                  }
                } else {
                  const targetProduct = stockSummary.find(p => p.name === saleProductName);
                  if (!targetProduct || targetProduct.currentStock < qty) {
                    alert(`⚠ Estoque insuficiente! O produto "${saleProductName}" possui apenas ${targetProduct?.currentStock || 0} unidades disponíveis.`);
                    return;
                  }
                }

                if (editingId) {
                  const updated = sales.map(s => s.id === editingId ? { ...s, productName: saleProductName, clientName: saleClientName || "Cliente", quantity: qty, unitPrice: prc, total: qty * prc, paymentMethod: salePaymentMethod, sellerName: s.sellerName || activeUserName } : s);
                  setSales(updated);
                  saveTenantData("sales", updated);
                  recordSystemLog(`Editou venda do produto ${saleProductName}`);
                } else {
                  const newS = { id: `v-${Date.now()}`, date: formDate, clientName: saleClientName || "Cliente", productName: saleProductName, quantity: qty, unitPrice: prc, total: qty * prc, paymentMethod: salePaymentMethod, sellerName: activeUserName, status: "Concluída" };
                  const updated = [newS, ...sales];
                  setSales(updated);
                  saveTenantData("sales", updated);
                  recordSystemLog(`Registrou nova venda do produto ${saleProductName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div>
                  <label className="font-bold block mb-1">Produto do Estoque *</label>
                  <select value={saleProductName} onChange={e => { setSaleProductName(e.target.value); const p = availableStockForSale.find(prod => prod.name === e.target.value); if (p) setSaleUnitPrice(p.price); }} className="w-full border p-2.5 rounded-xl bg-white">
                    {availableStockForSale.map(p => <option key={p.id} value={p.name}>{p.name} (Disponível: {p.currentStock})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Quantidade *</label><input type="number" min="1" value={saleQuantity} onChange={e => setSaleQuantity(Number(e.target.value))} className="w-full border p-2.5 rounded-xl" /></div>
                  <div><label className="font-bold block mb-1">Preço Un. (R$)</label><input type="number" step="0.01" value={saleUnitPrice} onChange={e => setSaleUnitPrice(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" /></div>
                </div>
                <div>
                  <label className="font-bold block mb-1">Forma de Pagamento *</label>
                  <select value={salePaymentMethod} onChange={e => setSalePaymentMethod(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                    <option value="Pix">Pix</option>
                    <option value="Cartão de Crédito">Cartão de Crédito</option>
                    <option value="Cartão de Débito">Cartão de Débito</option>
                    <option value="Dinheiro">Dinheiro</option>
                  </select>
                </div>
                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer">Salvar Venda</button>
              </form>
            )}

            {modalType === "employee" && (
              <form onSubmit={e => {
                e.preventDefault();
                const primaryRole = empRoles[0] || rolesList[0] || "Cabeleireiro";
                if (editingId) {
                  const updated = employees.map(emp => emp.id === editingId ? { ...emp, name: formName, phone: formPhone, roles: empRoles, role: primaryRole, systemRole: empSystemRole } : emp);
                  setEmployees(updated);
                  saveTenantData("employees", updated);
                  recordSystemLog(`Editou colaborador: ${formName} (${empSystemRole})`);

                  if (currentCompany && currentCompany.logins) {
                    const updatedLogins = currentCompany.logins.map((l: any) => l.name === formName ? { ...l, role: empSystemRole } : l);
                    updateCompanyInMasterDb({ logins: updatedLogins });
                  }
                } else {
                  const newEmp = { id: `e-${Date.now()}`, name: formName, phone: formPhone, roles: empRoles, role: primaryRole, systemRole: empSystemRole, schedule: DEFAULT_EMPLOYEE_SCHEDULE };
                  const updated = [...employees, newEmp];
                  setEmployees(updated);
                  saveTenantData("employees", updated);
                  recordSystemLog(`Cadastrou novo colaborador: ${formName} (${empSystemRole})`);

                  if (currentCompany && empEmail && empPass) {
                    const secureHash = hashPassword(empPass);
                    const newLogin = { name: formName, email: empEmail, user: empEmail.split("@")[0], passwordHash: secureHash, role: empSystemRole };
                    const updatedLogins = [...(currentCompany.logins || []), newLogin];
                    updateCompanyInMasterDb({ logins: updatedLogins });
                  }
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Nome Completo *</label><input required placeholder="Mariana" value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div><label className="font-bold block mb-1">WhatsApp *</label><input required placeholder="(19) 99999-9999" value={formPhone} onChange={e => setFormPhone(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                
                <div>
                  <label className="font-bold block mb-1">Cargo no Sistema (Gestor ou Colaborador) *</label>
                  <select value={empSystemRole} onChange={e => setEmpSystemRole(e.target.value as any)} className="w-full border p-2.5 rounded-xl bg-white font-bold text-pink-600">
                    <option value="Gestor">Gestor (Acesso administrativo ao painel)</option>
                    <option value="Colaborador">Colaborador (Acesso restrito à agenda própria)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold block mb-1">Funções / Especialidades (Múltipla Escolha)</label>
                  <div className="max-h-32 overflow-y-auto border p-2.5 rounded-xl space-y-1.5 bg-slate-50">
                    {rolesList.map((r, idx) => {
                      const isSelected = empRoles.includes(r);
                      return (
                        <div key={idx} onClick={() => {
                          if (isSelected) {
                            setEmpRoles(empRoles.filter(role => role !== r));
                          } else {
                            setEmpRoles([...empRoles, r]);
                          }
                        }} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-200 rounded">
                          {isSelected ? <CheckSquare size={15} className="text-indigo-600" /> : <Square size={15} className="text-slate-400" />}
                          <span>{r}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!editingId && (
                  <div className="p-3 bg-slate-50 border rounded-xl space-y-2">
                    <span className="font-bold text-indigo-600 block">Acesso de Login (E-mail e Senha):</span>
                    <input type="email" placeholder="funcionario@email.com" value={empEmail} onChange={e => setEmpEmail(e.target.value)} className="w-full border p-2 rounded-lg bg-white" />
                    <input type="password" placeholder="Senha inicial" value={empPass} onChange={e => setEmpPass(e.target.value)} className="w-full border p-2 rounded-lg bg-white" />
                  </div>
                )}
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Colaborador</button>
              </form>
            )}

            {modalType === "customer" && (
              <form onSubmit={e => {
                e.preventDefault();
                if (editingId) {
                  const updated = customers.map(c => c.id === editingId ? { ...c, name: formName, phone: formPhone, notes: formNotes } : c);
                  setCustomers(updated);
                  saveTenantData("customers", updated);
                  recordSystemLog(`Editou cliente: ${formName}`);
                } else {
                  const newC = { id: `c-${Date.now()}`, name: formName, phone: formPhone, notes: formNotes };
                  const updated = [...customers, newC];
                  setCustomers(updated);
                  saveTenantData("customers", updated);
                  recordSystemLog(`Cadastrou novo cliente: ${formName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Nome do Cliente *</label><input required placeholder="Ana" value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div><label className="font-bold block mb-1">WhatsApp *</label><input required placeholder="(19) 99999-9999" value={formPhone} onChange={e => setFormPhone(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div><label className="font-bold block mb-1">Observações</label><textarea rows={2} placeholder="Preferências, alergias..." value={formNotes} onChange={e => setFormNotes(e.target.value)} className="w-full border p-2.5 rounded-xl outline-none" /></div>
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Cliente</button>
              </form>
            )}

            {modalType === "expense" && (
              <form onSubmit={e => {
                e.preventDefault();
                if (editingId) {
                  const updated = expenses.map(ex => ex.id === editingId ? { ...ex, date: formDate, description: formName, amount: Number(formAmount), category: expenseCategory, isRecurrent: expenseIsRecurrent } : ex);
                  setExpenses(updated);
                  saveTenantData("expenses", updated);
                  recordSystemLog(`Editou despesa: ${formName}`);
                } else {
                  const newExp = { id: `e-${Date.now()}`, date: formDate, description: formName, amount: Number(formAmount), category: expenseCategory, isRecurrent: expenseIsRecurrent, status: "Pago" };
                  const updated = [newExp, ...expenses];
                  
                  if (expenseIsRecurrent) {
                    const [yyyy, mm, dd] = formDate.split("-");
                    let nextMonth = Number(mm) + 1;
                    let nextYear = Number(yyyy);
                    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
                    const nextDateStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${dd}`;
                    const nextExp = { id: `e-${Date.now() + 1}`, date: nextDateStr, description: formName + " (Recorrente)", amount: Number(formAmount), category: expenseCategory, isRecurrent: true, status: "Pago" };
                    updated.push(nextExp);
                  }

                  setExpenses(updated);
                  saveTenantData("expenses", updated);
                  recordSystemLog(`Cadastrou nova despesa: ${formName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Descrição *</label><input required placeholder="Aluguel, Luz..." value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Categoria *</label><input required placeholder="Operacional" value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                  <div><label className="font-bold block mb-1">Valor (R$) *</label><input type="number" step="0.01" required value={formAmount} onChange={e => setFormAmount(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" /></div>
                </div>
                <div className="pt-1">
                  <label onClick={() => setExpenseIsRecurrent(!expenseIsRecurrent)} className="flex items-center gap-2 cursor-pointer select-none">
                    {expenseIsRecurrent ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
                    <span className="font-bold">Despesa Recorrente (repetir automaticamente todo mês)</span>
                  </label>
                </div>
                <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl cursor-pointer">Salvar Despesa</button>
              </form>
            )}

            {modalType === "promotion" && (
              <form onSubmit={e => {
                e.preventDefault();
                if (editingId) {
                  const updated = promotions.map(p => p.id === editingId ? { ...p, title: formName, targetItems: promoTargetItems, duration: promoDuration, discountPercent: Number(promoDiscount), isAllPromo: promoIsAll } : p);
                  setPromotions(updated);
                  saveTenantData("promotions", updated);
                  recordSystemLog(`Editou promoção: ${formName}`);
                } else {
                  const newP: Promotion = { id: `p-${Date.now()}`, title: formName, targetItems: promoTargetItems, duration: promoDuration, discountPercent: Number(promoDiscount), isAllPromo: promoIsAll, active: true };
                  const updated = [...promotions, newP];
                  setPromotions(updated);
                  saveTenantData("promotions", updated);
                  recordSystemLog(`Criou nova promoção: ${formName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Nome da Promoção *</label><input required placeholder="Super Terça" value={formName} onChange={e => setFormName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                
                <div>
                  <label className="font-bold block mb-1">Selecionar Serviços e Produtos (Múltipla Escolha)</label>
                  <div className="max-h-36 overflow-y-auto border p-2.5 rounded-xl space-y-1.5 bg-slate-50">
                    {[...services.map(s => s.name), ...products.map(p => p.name)].map((item, idx) => {
                      const isSelected = promoTargetItems.includes(item);
                      return (
                        <div key={idx} onClick={() => {
                          if (isSelected) {
                            setPromoTargetItems(promoTargetItems.filter(i => i !== item));
                          } else {
                            setPromoTargetItems([...promoTargetItems, item]);
                          }
                        }} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-200 rounded">
                          {isSelected ? <CheckSquare size={15} className="text-indigo-600" /> : <Square size={15} className="text-slate-400" />}
                          <span>{item}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Tempo de Validade *</label><input required placeholder="Ex: 7 dias" value={promoDuration} onChange={e => setPromoDuration(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                  <div><label className="font-bold block mb-1">Desconto (%) *</label><input type="number" min="1" required value={promoDiscount} onChange={e => setPromoDiscount(Math.max(1, Number(e.target.value)))} className="w-full border p-2.5 rounded-xl font-bold" /></div>
                </div>
                <div className="pt-1">
                  <label onClick={() => setPromoIsAll(!promoIsAll)} className="flex items-center gap-2 cursor-pointer select-none">
                    {promoIsAll ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
                    <span className="font-bold">Aplicar em Tudo (Tudo em Promoção)</span>
                  </label>
                </div>
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Promoção</button>
              </form>
            )}

            {modalType === "attendance" && (
              <form onSubmit={e => {
                e.preventDefault();
                const assignedProf = isManager ? formProfessionalName : activeUserName;
                if (editingId) {
                  const updated = attendances.map(a => a.id === editingId ? { ...a, date: formDate, time: formTime, clientName: formClientName, serviceName: formServiceName, professionalName: assignedProf, netValue: Number(formGrossValue), paymentMethod: formPaymentMethod, notes: formNotes } : a);
                  setAttendances(updated);
                  saveTenantData("attendances", updated);
                  recordSystemLog(`Editou atendimento de ${formClientName}`);
                } else {
                  const newAtt = { id: `at-${Date.now()}`, date: formDate, time: formTime, clientName: formClientName || "Cliente", serviceName: formServiceName, professionalName: assignedProf, grossValue: Number(formGrossValue), netValue: Number(formGrossValue), paymentMethod: formPaymentMethod, notes: formNotes, status: "Atendido" };
                  const updated = [newAtt, ...attendances];
                  setAttendances(updated);
                  saveTenantData("attendances", updated);
                  recordSystemLog(`Lançou atendimento para ${formClientName}`);
                }
                setModalType(null);
              }} className="space-y-3">
                <div><label className="font-bold block mb-1">Cliente *</label><input required value={formClientName} onChange={e => setFormClientName(e.target.value)} className="w-full border p-2.5 rounded-xl" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Serviço</label><select value={formServiceName} onChange={e => { setFormServiceName(e.target.value); const s = services.find(srv => srv.name === e.target.value); if (s) setFormGrossValue(s.price); }} className="w-full border p-2.5 rounded-xl bg-white">{services.map(s => <option key={s.id} value={s.name}>{s.name} - R$ {s.price}</option>)}</select></div>
                  <div>
                    <label className="font-bold block mb-1">Profissional</label>
                    {isManager ? (
                      <select value={formProfessionalName} onChange={e => setFormProfessionalName(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                        {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                      </select>
                    ) : (
                      <input disabled value={activeUserName} className="w-full border p-2.5 rounded-xl bg-slate-100 font-bold" />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="font-bold block mb-1">Valor (R$)</label><input type="number" step="0.01" value={formGrossValue} onChange={e => setFormGrossValue(Number(e.target.value))} className="w-full border p-2.5 rounded-xl font-bold" /></div>
                  <div>
                    <label className="font-bold block mb-1">Pagamento</label>
                    <select value={formPaymentMethod} onChange={e => setFormPaymentMethod(e.target.value)} className="w-full border p-2.5 rounded-xl bg-white">
                      <option value="Pix">Pix</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Dinheiro">Dinheiro</option>
                    </select>
                  </div>
                </div>
                <div><label className="font-bold block mb-1">Observações</label><textarea rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} className="w-full border p-2.5 rounded-xl outline-none" /></div>
                <button type="submit" className={`w-full ${theme.buttonBg} text-white font-bold py-3 rounded-xl cursor-pointer`}>Salvar Atendimento</button>
              </form>
            )}
          </div>
        </div>
      )}

      {selectedEmpForSchedule && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-4 text-xs text-slate-800">
            <div className="border-b pb-3 flex justify-between items-center"><h2 className="text-base font-bold">Escala de {selectedEmpForSchedule.name}</h2><button onClick={() => setSelectedEmpForSchedule(null)} className="text-slate-400 font-bold text-base cursor-pointer">✕</button></div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pr-1">
              {selectedEmpForSchedule.schedule?.map((day: EmployeeSchedule) => (
                <div key={day.dayIndex} className="py-3 flex items-center justify-between gap-3">
                  <div className="w-32 flex items-center gap-2">
                    <button type="button" onClick={() => { const up = selectedEmpForSchedule.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, isWorking: !d.isWorking } : d); const empUp = { ...selectedEmpForSchedule, schedule: up }; setSelectedEmpForSchedule(empUp); const list = employees.map(e => e.id === empUp.id ? empUp : e); setEmployees(list); saveTenantData("employees", list); }} className={`px-2.5 py-1 rounded-lg font-bold border text-[11px] cursor-pointer ${day.isWorking ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-slate-100 text-slate-500"}`}>{day.isWorking ? "Trabalha" : "Folga"}</button>
                    <strong>{day.dayName}</strong>
                  </div>
                  {day.isWorking && (
                    <div className="flex items-center gap-2">
                      <input type="time" value={day.openTime} onChange={e => { const up = selectedEmpForSchedule.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, openTime: e.target.value } : d); const empUp = { ...selectedEmpForSchedule, schedule: up }; setSelectedEmpForSchedule(empUp); const list = employees.map(e => e.id === empUp.id ? empUp : e); setEmployees(list); saveTenantData("employees", list); }} className="border rounded p-1" />
                      <span>às</span>
                      <input type="time" value={day.closeTime} onChange={e => { const up = selectedEmpForSchedule.schedule.map((d: EmployeeSchedule) => d.dayIndex === day.dayIndex ? { ...d, closeTime: e.target.value } : d); const empUp = { ...selectedEmpForSchedule, schedule: up }; setSelectedEmpForSchedule(empUp); const list = employees.map(e => e.id === empUp.id ? empUp : e); setEmployees(list); saveTenantData("employees", list); }} className="border rounded p-1" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-2 border-t flex justify-end"><button onClick={() => setSelectedEmpForSchedule(null)} className={`${theme.buttonBg} text-white font-bold px-5 py-2 rounded-xl cursor-pointer`}>Concluir</button></div>
          </div>
        </div>
      )}
    </div>
  );
}