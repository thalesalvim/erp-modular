import 'server-only';

import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OwnAgendaPage } from '@/components/agenda/OwnAgendaView';

export default async function OwnAppointmentsPage() {
  // Evaluate the server-only flag per request, never cache an enabled build.
  await connection();
  if (process.env.HANDYHUB_OWN_AGENDA_ENABLED !== 'true') notFound();
  return <OwnAgendaPage />;
}
