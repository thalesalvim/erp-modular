// Sistema Central de Notificações e Faturação Recorrente
export const saasNotifications = {
  sendWelcome: (name: string, email: string, phone: string, company: string) => {
    const text = `🎉 Olá ${name}! A sua empresa "${company}" foi ativada com sucesso. O seu plano de mensalidade recorrente por cartão está configurado. Bem-vindo(a)!`;
    console.log(`[EMAIL - Boas-vindas]: ${email} -> ${text}`);
    console.log(`[WHATSAPP - Boas-vindas]: ${phone} -> ${text}`);
    return true;
  },

  sendRecurringChargeAlert: (name: string, email: string, phone: string, amount: number, cardLast4: string) => {
    const text = `💳 Olá ${name}, a sua mensalidade no valor de R$ ${amount.toFixed(2)} foi cobrada com sucesso no cartão final ${cardLast4} (Cobrança Recorrente - Parcela Mensal sem reter limite total). Obrigado!`;
    console.log(`[EMAIL - Cobrança Recorrente]: ${email} -> ${text}`);
    console.log(`[WHATSAPP - Cobrança Recorrente]: ${phone} -> ${text}`);
    return true;
  },

  send2FACode: (name: string, email: string, phone: string, code: string) => {
    const text = `🔒 Olá ${name}, o seu código de verificação 2FA (Autenticação de Dois Fatores) para novo acesso é: *${code}*. Válido por 10 minutos.`;
    console.log(`[EMAIL - Código 2FA]: ${email} -> ${text}`);
    console.log(`[WHATSAPP - Código 2FA]: ${phone} -> ${text}`);
    return true;
  },

  sendNewDeviceAlert: (name: string, email: string, phone: string, device: string) => {
    const text = `⚠️ Alerta de Segurança: Detectámos um início de sessão na sua conta a partir de um novo dispositivo/navegador (${device}). Se não foi você, altere a senha imediatamente.`;
    console.log(`[EMAIL - Novo Dispositivo]: ${email} -> ${text}`);
    console.log(`[WHATSAPP - Novo Dispositivo]: ${phone} -> ${text}`);
    return true;
  }
};
