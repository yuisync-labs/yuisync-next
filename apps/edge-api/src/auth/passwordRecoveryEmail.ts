export type RecoveryEmailBindings = {
  AUTH_EMAIL_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

export function recoveryEmailConfigured(bindings: RecoveryEmailBindings): boolean {
  return Boolean(bindings.AUTH_EMAIL_API_KEY?.trim() && bindings.AUTH_EMAIL_FROM?.trim())
}

export async function sendPasswordRecoveryEmail(bindings: RecoveryEmailBindings, email: string, url: string): Promise<void> {
  if (!recoveryEmailConfigured(bindings)) throw new Error('RECOVERY_EMAIL_NOT_CONFIGURED')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${bindings.AUTH_EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: bindings.AUTH_EMAIL_FROM,
      to: [email],
      subject: 'Redefina sua senha do YuiSync',
      text: `Recebemos um pedido para redefinir sua senha. O link expira em 15 minutos e pode ser usado uma vez:\n\n${url}\n\nSe você não pediu essa alteração, ignore este e-mail.`,
    }),
    signal: AbortSignal.timeout(10000),
  })
  // Provider responses can contain addresses; never propagate their body to logs.
  await response.body?.cancel()
  if (!response.ok) throw new Error('RECOVERY_EMAIL_DELIVERY_FAILED')
}

export async function sendCustomerActivationEmail(
  bindings: RecoveryEmailBindings,
  email: string,
  activationUrl: string,
  businessName: string,
): Promise<void> {
  if (!recoveryEmailConfigured(bindings)) throw new Error('ACTIVATION_EMAIL_NOT_CONFIGURED')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${bindings.AUTH_EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: bindings.AUTH_EMAIL_FROM,
      to: [email],
      subject: 'Ative seu acesso ao YuiSync',
      text: `Sua assinatura foi confirmada. Ative o acesso de ${businessName} e comece a primeira configuração do YuiSync:\n\n${activationUrl}\n\nO link expira em 24 horas e pode ser usado uma vez. Se você não reconhece esta compra, fale com o suporte YuiSync.`,
    }),
    signal: AbortSignal.timeout(10000),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error('ACTIVATION_EMAIL_DELIVERY_FAILED')
}
