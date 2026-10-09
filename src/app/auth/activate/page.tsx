import { PasswordFlow } from '@/components/auth/PasswordFlow';
import { requirePasswordFlow } from '@/lib/auth/password-flow-server';
export const dynamic = 'force-dynamic';
export default async function ActivateAccountPage() {
  return <PasswordFlow kind="invite" authorized={Boolean(await requirePasswordFlow('invite'))} />;
}
