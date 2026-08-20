import type { Metadata } from 'next';
import CowExperience from '@/components/CowExperience';

export const metadata: Metadata = {
  title: 'Niu Lai AI — A talking 3D bull',
  description: 'Talk with Niu Lai, a friendly 3D bull with a voice of his own.',
};

export default function EnglishHome() {
  return <CowExperience locale="en" />;
}
