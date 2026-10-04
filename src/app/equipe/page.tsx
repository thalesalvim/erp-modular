"use client";

import React, { useState, useEffect } from "react";
import { Users, CalendarDays, LogOut, Clock } from "lucide-react";

export default function TeamPortal() {
  const [isMounted, setIsMounted] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loggedEmployee, setLoggedEmployee] = useState<any>(null);

  useEffect(() => {
    setIsMounted(true);
    try {
      if (localStorage.getItem("team_portal_auth") === "true") {
        setIsLogged(true);
        const empData = localStorage.getItem("team_logged_employee");
        if (empData) {
          setLoggedEmployee(JSON.parse(empData));
        }
      }
    } catch (e) {
      console.error("Erro ao carregar sessão da equipe", e);
    }
  }, []);

  const handleTeamLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    const savedTenants = localStorage.getItem("saas_tenants_db");
    if (!savedTenants) {
      setErrorMsg("Nenhuma unidade cadastrada no sistema.");
      return;
    }

    try {
      const list = JSON.parse(savedTenants);
      let foundEmp = null;

      for (const tenant of list) {
        const empListJson = localStorage.getItem(saas_\_employees);
        const empList = empListJson ? JSON.parse(empListJson) : [];
        const match = empList.find((emp: any) => 
          emp.name.toLowerCase().includes(cleanUser) || (emp.email && emp.email.toLowerCase() === cleanUser)
        );
        if (match) {
          foundEmp = { ...match, companyName: tenant.companyName };
          break;
        }
      }

      if (foundEmp) {
        localStorage.setItem("team_portal_auth", "true");
        localStorage.setItem("team_logged_employee", JSON.stringify(foundEmp));
        setLoggedEmployee(foundEmp);
        setIsLogged(true);
      } else {
        setErrorMsg("Colaboradora não encontrada. Verifique com o gestor.");
      }
    } catch {
      setErrorMsg("Erro ao validar acesso.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("team_portal_auth");
    localStorage.removeItem("team_logged_employee");
    setIsLogged(false);
  };

  if (!isMounted) return <div className="min-h-screen bg-slate-950" />;

  if (!isLogged) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3.5 bg-pink-500/10 border border-pink-500/20 rounded-2xl text-pink-400 mb-1">
              <Users size={32} />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">Portal da Colaboradora</h1>
            <p className="text-xs text-slate-400">Consulte sua escala e horários de atendimento.</p>
          </div>

          <form onSubmit={handleTeamLogin} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">Seu Nome / Usuário</label>
              <input
                type="text"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Ex: Mariana"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-pink-500 transition"
              />
            </div>

            <div>
              <label className="text-slate-300 font-bold block mb-1 uppercase tracking-wider">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-pink-500 transition"
              />
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-center font-medium">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-3.5 rounded-xl uppercase tracking-wider transition shadow-lg shadow-pink-600/30 cursor-pointer text-xs"
            >
              Acessar Minha Escala
            </button>
          </form>

          <div className="pt-4 border-t border-slate-800 text-center">
            <a href="/" className="text-xs text-slate-400 hover:text-white transition">
              ← Voltar ao Login Principal
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-pink-600/20 border border-pink-500/40 rounded-xl text-pink-400">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-base font-black text-white">Painel da Profissional: {loggedEmployee?.name}</h1>
            <p className="text-xs text-slate-400">Unidade: {loggedEmployee?.companyName || "Estabelecimento"}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-950 border border-slate-700 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer"
        >
          <LogOut size={14} />
          <span>Sair</span>
        </button>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-8 space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <CalendarDays size={18} className="text-pink-500" />
                Sua Escala de Trabalho Semanal
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Estes são os seus dias e horários cadastrados na unidade.</p>
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 text-xs">
            {loggedEmployee?.schedule?.map((day: any) => (
              <div key={day.dayIndex} className="py-3.5 flex items-center justify-between">
                <div className="w-36">
                  <strong className="text-white block">{day.dayName}</strong>
                  <span className={	ext-[11px] font-semibold \}>
                    {day.isWorking ? "Trabalha" : "Folga"}
                  </span>
                </div>

                <div>
                  {day.isWorking ? (
                    <div className="flex items-center gap-2 text-slate-300 font-mono">
                      <Clock size={14} className="text-pink-400" />
                      <span>{day.openTime} às {day.closeTime}</span>
                      {day.lunchStart && <span className="text-slate-500 text-[11px]">(Almoço: {day.lunchStart} - {day.lunchEnd})</span>}
                    </div>
                  ) : (
                    <span className="text-slate-500 italic">Descanso / Folga</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
