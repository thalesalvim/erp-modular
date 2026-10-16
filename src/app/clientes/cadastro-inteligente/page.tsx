import { redirect } from 'next/navigation';

/** Compatibility URL only. Registration lives in the existing compact Home modal. */
export default function CustomerPreparationPage() {
  redirect('/');
}
